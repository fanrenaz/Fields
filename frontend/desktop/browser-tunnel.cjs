const crypto = require("node:crypto");
const net = require("node:net");

const MAX_PROXY_HEADER_BYTES = 16 * 1024;
const MAX_PENDING_STREAM_BYTES = 1024 * 1024;

class DesktopBrowserTunnel {
  constructor(reportTelemetry = () => undefined) {
    this.server = null;
    this.webSocket = null;
    this.streams = new Map();
    this.nextStreamId = 1;
    this.username = "fields";
    this.password = crypto.randomBytes(24).toString("base64url");
    this.reportTelemetry = reportTelemetry;
  }

  async start({ websocketUrl, token, clientNonce }) {
    await this.stop();
    try {
      this.server = net.createServer((socket) => this.accept(socket));
      await new Promise((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(0, "127.0.0.1", resolve);
      });
      await this.connectWebSocket(websocketUrl, token, clientNonce);
      this.reportTelemetry("desktop.browser.tunnel_connected");
      return {
        host: "127.0.0.1",
        port: this.server.address().port,
        username: this.username,
        password: this.password,
      };
    } catch (error) {
      await this.stop();
      this.reportTelemetry("desktop.browser.tunnel_failed", { status: "error", code: "proxy_unavailable" });
      throw error;
    }
  }

  async stop() {
    for (const stream of this.streams.values()) stream.socket.destroy();
    this.streams.clear();
    this.webSocket?.close();
    this.webSocket = null;
    if (this.server) {
      const server = this.server;
      this.server = null;
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  }

  connectWebSocket(websocketUrl, token, clientNonce) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl, [
        "fields-browser-v1",
        `fields-token.${token}`,
        `fields-nonce.${clientNonce}`,
      ]);
      socket.binaryType = "arraybuffer";
      const fail = () => {
        socket.close();
        reject(new Error("Fields browser tunnel is unavailable."));
      };
      socket.addEventListener("error", fail, { once: true });
      socket.addEventListener("close", fail, { once: true });
      socket.addEventListener("open", () => {
        socket.removeEventListener("error", fail);
        socket.removeEventListener("close", fail);
        this.webSocket = socket;
        resolve();
      }, { once: true });
      socket.addEventListener("message", (event) => this.receive(event.data));
      socket.addEventListener("close", () => {
        const unexpected = this.webSocket === socket;
        if (unexpected) {
          this.webSocket = null;
          this.reportTelemetry("desktop.browser.tunnel_closed", { status: "error", code: "tunnel_connection_lost" });
        }
        for (const stream of this.streams.values()) stream.socket.destroy();
        this.streams.clear();
      });
    });
  }

  accept(socket) {
    let header = Buffer.alloc(0);
    const readHeader = (data) => {
      header = Buffer.concat([header, data]);
      const headerEnd = header.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        if (header.length > MAX_PROXY_HEADER_BYTES) socket.destroy();
        return;
      }
      socket.off("data", readHeader);
      const request = header.subarray(0, headerEnd + 4).toString("latin1");
      const remainder = header.subarray(headerEnd + 4);
      const [line] = request.split("\r\n");
      const match = /^CONNECT ([^:\s]+):(\d+) HTTP\/1\.[01]$/u.exec(line || "");
      if (!this.authorized(request)) {
        socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Fields\"\r\nConnection: close\r\n\r\n");
        return;
      }
      if (!match || Number(match[2]) !== 443 || !this.webSocket) {
        socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        return;
      }
      const streamId = this.allocateStreamId();
      this.streams.set(streamId, { socket, opened: false, pending: [], pendingBytes: 0 });
      socket.on("data", (chunk) => this.sendData(streamId, chunk));
      socket.on("end", () => this.sendControl({ v: 1, type: "half_close", stream_id: streamId }));
      socket.on("close", () => {
        this.sendControl({ v: 1, type: "close", stream_id: streamId });
        this.streams.delete(streamId);
      });
      socket.on("error", () => this.streams.delete(streamId));
      this.sendControl({ v: 1, type: "open", stream_id: streamId, host: match[1], port: 443 });
      if (remainder.length > 0) this.sendData(streamId, remainder);
    };
    socket.on("data", readHeader);
  }

  authorized(request) {
    const expected = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return request.split("\r\n").some((line) => line.toLowerCase() === `proxy-authorization: basic ${expected}`.toLowerCase());
  }

  receive(raw) {
    if (typeof raw === "string") {
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      const stream = this.streams.get(message.stream_id);
      if (!stream) return;
      if (message.type === "opened") {
        stream.opened = true;
        stream.socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        for (const chunk of stream.pending) this.sendData(message.stream_id, chunk);
        stream.pending = [];
        stream.pendingBytes = 0;
      } else if (message.type === "half_close") {
        stream.socket.end();
      } else if (message.type === "close" || message.type === "error") {
        if (!stream.opened) stream.socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        stream.socket.destroy();
        this.streams.delete(message.stream_id);
      }
      return;
    }
    const frame = Buffer.from(raw);
    if (frame.length < 5) return;
    const stream = this.streams.get(frame.readUInt32BE(0));
    stream?.socket.write(frame.subarray(4));
  }

  sendData(streamId, chunk) {
    const stream = this.streams.get(streamId);
    if (!stream?.opened) {
      if (!stream || stream.pendingBytes + chunk.length > MAX_PENDING_STREAM_BYTES) {
        stream?.socket.destroy();
        this.streams.delete(streamId);
        return;
      }
      stream.pending.push(Buffer.from(chunk));
      stream.pendingBytes += chunk.length;
      return;
    }
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) return;
    const frame = Buffer.allocUnsafe(4 + chunk.length);
    frame.writeUInt32BE(streamId, 0);
    chunk.copy(frame, 4);
    this.webSocket.send(frame);
  }

  sendControl(message) {
    if (this.webSocket?.readyState === WebSocket.OPEN) this.webSocket.send(JSON.stringify(message));
  }

  allocateStreamId() {
    while (this.streams.has(this.nextStreamId)) this.nextStreamId += 1;
    const value = this.nextStreamId;
    this.nextStreamId = value === 0xffffffff ? 1 : value + 1;
    return value;
  }
}

module.exports = { DesktopBrowserTunnel };
