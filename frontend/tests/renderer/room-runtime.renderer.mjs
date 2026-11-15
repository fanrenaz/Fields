import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { build } from "esbuild";

async function main() {
  const desktopRoot = new URL("../../", import.meta.url);
  const bundle = await build({
    entryPoints: [new URL("./room-runtime-harness.ts", import.meta.url).pathname],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    absWorkingDir: desktopRoot.pathname,
  });
  const harnessJs = bundle.outputFiles[0].text;
  const control = createControlServer(harnessJs);
  const address = await control.listen();

  let chrome;
  try {
    chrome = await launchChrome();
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await runScenario(chrome, address, control, viewport);
    }
    assert.equal(control.requests.some((request) => /repair|ensure/u.test(request.path)), false);
    console.log(JSON.stringify({
      status: "passed",
      viewports: ["1280x720", "1920x1080"],
      requests: control.requests.length,
    }));
  } finally {
    await settleCleanup(chrome?.close(), control.close());
  }
}

async function runScenario(chromeProcess, origin, server, viewport) {
  server.reset();
  const cdp = await chromeProcess.page();
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: origin });
    await cdp.waitFor("Page.loadEventFired");
    await waitFor(cdp, "Boolean(window.roomRuntimeSmoke)");

    await evaluate(cdp, "window.roomRuntimeSmoke.select('room-a')");
    await waitFor(cdp, "document.querySelector('#root').dataset.phase === 'selected'");
    assert.equal((await snapshot(cdp)).dataReady, "true");
    await waitForRequest(server, (request) => request.path === "/api/data/members");
    await waitForRequest(server, (request) => request.path === "/api/data/messages");
    await waitForRequest(server, (request) => request.path === "/api/data/filesystem");
    assert.equal(server.requests.some((request) => request.path.startsWith("/api/runtime/")), false);
    assert.ok(server.dataRequests().some((request) => request.path === "/api/data/members"));
    assert.ok(server.dataRequests().some((request) => request.path === "/api/data/messages"));
    assert.ok(server.dataRequests().some((request) => request.path === "/api/data/filesystem"));

    const messagesBeforeRetry = server.requests.filter((request) => request.path === "/api/data/messages").length;
    await evaluate(cdp, "window.roomRuntimeSmoke.retry()");
    await waitForRequestCount(server, "/api/data/messages", messagesBeforeRetry + 1);

    await evaluate(cdp, "window.roomRuntimeSmoke.select('room-b'); window.roomRuntimeSmoke.select('room-a')");
    await waitFor(cdp, "document.querySelector('#root').dataset.activeRoom === 'room-a' && document.querySelector('#root').dataset.dataReady === 'true'", 3_000);
    assert.equal((await snapshot(cdp)).activeRoom, "room-a");

    const metrics = await evaluate(cdp, "({ width: innerWidth, height: innerHeight })");
    assert.deepEqual(metrics, viewport);
  } finally {
    await cdp.close();
  }
}

function createControlServer(harnessSource) {
  const state = {
    requests: [],
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") return send(response, 200, "text/html", "<!doctype html><html><body><main id='root'></main><script src='/harness.js'></script></body></html>");
    if (url.pathname === "/harness.js") return send(response, 200, "text/javascript", harnessSource);
    const body = await readJson(request);
    const roomId = body.room_id ?? url.searchParams.get("room_id") ?? "";
    state.requests.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/api/rooms") return json(response, { items: [], page: { next_cursor: null } });
    if (url.pathname === "/api/data/members") return json(response, { room_id: roomId, items: [] });
    if (url.pathname === "/api/data/messages") return json(response, { room_id: roomId, items: [], page: { next_cursor: null } });
    if (url.pathname === "/api/data/filesystem") return json(response, filesystemResult(roomId, body.path));
    if (url.pathname.includes("/subscribe") || url.pathname.includes("/unsubscribe")) return json(response, { ok: true });
    return json(response, { room_id: roomId, items: [] });
  });
  return Object.assign(state, {
    reset() {
      state.requests.length = 0;
    },
    dataRequests: () => state.requests.filter((request) => request.path.startsWith("/api/data/")),
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    })),
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}

async function launchChrome() {
  const userDataDir = await mkdtemp(join(tmpdir(), "fields-room-smoke-"));
  const port = await reservePort();
  const child = spawn(process.env.CHROME_BIN ?? "google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`, "about:blank",
  ], { stdio: "ignore" });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return {
        page: async () => new CdpClient(targets.find((target) => target.type === "page").webSocketDebuggerUrl),
        close: async () => {
          await terminateChild(child);
          await removeDirectory(userDataDir);
        },
      };
    } catch {
      await delay(100);
    }
  }
  await terminateChild(child).finally(() => removeDirectory(userDataDir));
  throw new Error("Headless Chrome did not expose its debugging endpoint.");
}

async function removeDirectory(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function settleCleanup(...operations) {
  const results = await Promise.allSettled(operations);
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Browser smoke cleanup failed.");
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, 2_000)) return;
  child.kill("SIGKILL");
  if (!await waitForChildExit(child, 2_000)) {
    throw new Error("Headless Chrome did not terminate after SIGKILL.");
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.events = new Map();
    this.open = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? pending?.reject(new Error(message.error.message)) : pending?.resolve(message.result);
      } else {
        const waiters = this.events.get(message.method) ?? [];
        this.events.delete(message.method);
        for (const resolve of waiters) resolve(message.params);
      }
    });
  }
  async send(method, params = {}) {
    await this.open;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }
  waitFor(method) {
    return new Promise((resolve) => this.events.set(method, [...(this.events.get(method) ?? []), resolve]));
  }
  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function snapshot(cdp) {
  return evaluate(cdp, "window.roomRuntimeSmoke.snapshot()");
}

async function waitFor(cdp, expression, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return;
    await delay(50);
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

async function waitForRequest(server, predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.requests.some(predicate)) return;
    await delay(25);
  }
  throw new Error("Expected HTTP request was not observed.");
}

async function waitForRequestCount(server, path, count) {
  return waitForRequest(server, () => server.requests.filter((request) => request.path === path).length >= count);
}

function filesystemResult(roomId, path = ".") {
  return {
    room_id: roomId,
    root_path: "/workspace",
    parent: { id: path, path, name: path, is_folder: true, size_bytes: null, modified_at_ms: null },
    children: [],
  };
}

function readJson(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

function json(response, body, status = 200) {
  send(response, status, "application/json", JSON.stringify(body));
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function reservePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

await main();
await import("./company-onboarding.renderer.mjs");
