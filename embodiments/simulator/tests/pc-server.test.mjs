import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { createPcSimulatorServer } from "../dist/index.js";

test("PC server protects its control channel and never exposes terminal credentials", async (t) => {
  const originalToken = process.env.STICKS3_TERMINAL_TOKEN;
  process.env.STICKS3_TERMINAL_TOKEN = "must-not-reach-the-browser";
  t.after(() => {
    if (originalToken === undefined) delete process.env.STICKS3_TERMINAL_TOKEN;
    else process.env.STICKS3_TERMINAL_TOKEN = originalToken;
  });
  const server = createPcSimulatorServer({ port: 0, nonce: "test-browser-nonce", runnerPath: "/not-a-runner" });
  const address = await server.start();
  t.after(() => server.stop());
  const origin = `http://${address.host}:${address.port}`;

  const page = await fetch(origin);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /test-browser-nonce/);
  assert.doesNotMatch(html, /must-not-reach-the-browser/);

  const first = await openSocket(`${origin.replace("http", "ws")}/pc/ws?nonce=${server.nonce}`, origin);
  t.after(() => first.close());
  assert.equal((await waitJson(first, (message) => message.type === "snapshot")).controller_state, "ready");
  first.send(JSON.stringify({ type: "activate" }));
  const unavailable = await waitJson(first, (message) => message.type === "error" && message.code === "runner_unavailable");
  assert.equal(unavailable.recoverable, true);
  assert.equal(JSON.stringify(first.jsonMessages).includes("must-not-reach-the-browser"), false);

  const second = await openSocket(`${origin.replace("http", "ws")}/pc/ws?nonce=${server.nonce}`, origin);
  const busy = await waitJson(second, (message) => message.type === "error");
  assert.equal(busy.code, "controller_busy");
  second.close();
});

test("PC server supplies a validated base path and browser keepalive", async (t) => {
  const server = createPcSimulatorServer({ port: 0, basePath: "/simulator/" });
  const address = await server.start();
  t.after(() => server.stop());
  const page = await fetch(`http://${address.host}:${address.port}`);
  assert.match(await page.text(), /name="pc-base-path" content="\/simulator\/"/);
  assert.throws(() => createPcSimulatorServer({ basePath: "/simulator" }), /STICKS3_PC_BASE_PATH/u);
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const browserClient = await readFile(resolve(testDirectory, "../web/app.js"), "utf8");
  assert.match(browserClient, /setInterval\(\(\) => send\(\{ type: "keepalive" \}\), 20_000\)/u);
});

test("PC server forwards validated fd3 frames with a display envelope separate from audio", async (t) => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const fixture = resolve(testDirectory, "fixtures/frame-runner.mjs");
  const server = createPcSimulatorServer({
    port: 0,
    nonce: "frame-browser-nonce",
    runnerPath: process.execPath,
    runnerArgs: [fixture],
  });
  const address = await server.start();
  t.after(() => server.stop());
  const origin = `http://${address.host}:${address.port}`;
  const socket = await openSocket(`${origin.replace("http", "ws")}/pc/ws?nonce=${server.nonce}`, origin);
  t.after(() => socket.close());

  socket.send(JSON.stringify({ type: "activate" }));
  const frame = await waitBinary(socket, (bytes) => bytes[0] === 0x01 && bytes.subarray(1, 5).toString("ascii") === "S3FR");
  assert.equal(frame[0], 0x01);
  assert.equal(frame[5], 1);
  assert.equal(frame.readUInt16LE(7), 20);
  assert.equal(frame.readUInt32LE(9), 7);
  assert.equal(frame.readUInt16LE(13), 2);
  assert.equal(frame.readUInt16LE(15), 1);
  assert.equal(frame.readUInt32LE(17), 4);
  assert.deepEqual([...frame.subarray(21)], [0x00, 0xf8, 0xe0, 0x07]);

  const browserClient = await readFile(resolve(testDirectory, "../web/app.js"), "utf8");
  assert.match(browserClient, /PC_BINARY_FRAME = 0x01/u);
  assert.match(browserClient, /PC_BINARY_DOWNLINK_PCM = 0x02/u);
  assert.match(browserClient, /drawFrame\(bytes\.subarray\(1\)\)/u);
  assert.doesNotMatch(browserClient, /answer-button|pairing-code|event-list/u);
});

async function openSocket(url, origin) {
  const socket = new WebSocket(url, { origin });
  socket.jsonMessages = [];
  socket.binaryMessages = [];
  socket.on("message", (data, isBinary) => {
    if (isBinary) socket.binaryMessages.push(Buffer.from(data));
    else socket.jsonMessages.push(JSON.parse(data.toString("utf8")));
  });
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return socket;
}

function waitBinary(socket, predicate, timeoutMs = 2_000) {
  const existing = socket.binaryMessages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("timed out waiting for PC frame")); }, timeoutMs);
    const onMessage = (data, isBinary) => {
      if (!isBinary) return;
      const bytes = Buffer.from(data);
      if (!predicate(bytes)) return;
      clearTimeout(timer); socket.off("message", onMessage); resolve(bytes);
    };
    socket.on("message", onMessage);
  });
}

function waitJson(socket, predicate, timeoutMs = 2_000) {
  const existing = socket.jsonMessages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("timed out waiting for PC server message")); }, timeoutMs);
    const onMessage = (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString("utf8"));
      if (!predicate(message)) return;
      clearTimeout(timer); socket.off("message", onMessage); resolve(message);
    };
    socket.on("message", onMessage);
  });
}
