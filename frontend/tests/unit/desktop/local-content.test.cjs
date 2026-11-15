const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createLocalContentHandler,
  isNetworkPath,
  registerLocalContentProtocol,
  safeRelativePath,
} = require("../../../desktop/local-content.cjs");

function harness(files = {}) {
  const calls = [];
  const net = {
    fetch(request, options) {
      calls.push({ request, options });
      return Promise.resolve(new Response("network"));
    },
  };
  const readFile = async (filePath) => {
    const name = filePath.replaceAll("\\", "/").split("/web/")[1];
    if (!(name in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return Buffer.from(files[name]);
  };
  return {
    calls,
    handler: createLocalContentHandler({ net, webRoot: "/app/web", version: "1.2.3", readFile }),
  };
}

test("network-owned paths and non-target HTTPS requests bypass the custom handler", async () => {
  const { calls, handler } = harness();
  for (const url of [
    "https://fields.example.com/api/v1/session",
    "https://fields.example.com/embodiment/socket",
    "https://fields.example.com/desktop/updates/RELEASES",
    "https://cdn.example.com/app.js",
  ]) {
    const response = await handler(new Request(url));
    assert.equal(await response.text(), "network");
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.options.bypassCustomProtocolHandlers === true));
  assert.equal(isNetworkPath("/apiary"), false);
});

test("restores the production Origin on same-origin network mutations", async () => {
  const { calls, handler } = harness();
  const body = JSON.stringify({ email: "person@example.test", password: "not-a-secret" });
  const original = new Request("https://fields.example.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  await handler(original);
  const forwarded = calls[0].request;
  assert.notEqual(forwarded, original);
  assert.equal(forwarded.headers.get("origin"), "https://fields.example.com");
  assert.equal(forwarded.method, "POST");
  assert.equal(await forwarded.text(), body);
});

test("does not replace an explicit Origin or modify unrelated requests", async () => {
  const { calls, handler } = harness();
  const explicit = new Request("https://fields.example.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: "https://untrusted.example" },
  });
  const external = new Request("https://cdn.example.com/api/upload", { method: "POST" });
  const sameOriginRead = new Request("https://fields.example.com/api/auth/get-session");

  await handler(explicit);
  await handler(external);
  await handler(sameOriginRead);
  assert.equal(calls[0].request, explicit);
  assert.equal(calls[1].request, external);
  assert.equal(calls[2].request, sameOriginRead);
});

test("serves local assets and SPA routes with MIME and security headers", async () => {
  const { calls, handler } = harness({
    "index.html": "<html>local UI</html>",
    "assets/app-123.js": "console.log('local')",
  });

  const route = await handler(new Request("https://fields.example.com/rooms/room-a?activity=1"));
  assert.equal(route.status, 200);
  assert.equal(await route.text(), "<html>local UI</html>");
  assert.equal(route.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(route.headers.get("content-security-policy"), /script-src 'self'/u);
  assert.match(route.headers.get("content-security-policy"), /frame-src 'self' data: https:\/\/view\.officeapps\.live\.com/u);
  assert.match(route.headers.get("content-security-policy"), /media-src 'self' blob: https:/u);
  assert.doesNotMatch(route.headers.get("content-security-policy"), /frame-src[^;]*https:\s/u);
  assert.equal(route.headers.get("x-content-type-options"), "nosniff");

  const asset = await handler(new Request("https://fields.example.com/assets/app-123.js?v=1"));
  assert.equal(await asset.text(), "console.log('local')");
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(calls.length, 0, "UI requests never fall back to the network");
});

test("HEAD returns local metadata without a body", async () => {
  const { handler } = harness({ "index.html": "12345" });
  const response = await handler(new Request("https://fields.example.com/", { method: "HEAD" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(await response.text(), "");
});

test("rejects traversal and malformed paths without reading or forwarding", async () => {
  const { calls, handler } = harness({ "index.html": "index" });
  for (const url of [
    "https://fields.example.com/../secret.js",
    "https://fields.example.com/%2e%2e/secret.js",
    "https://fields.example.com/a/%2E%2E/secret.js",
    "https://fields.example.com/a%5c..%5csecret.js",
    "https://fields.example.com/%E0%A4%A",
  ]) {
    const response = await handler({ url, method: "GET" });
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal(safeRelativePath("https://fields.example.com/safe/file.css"), "safe/file.css");
});

test("missing installed files return built-in recovery and never remote UI", async () => {
  const { calls, handler } = harness();
  const response = await handler(new Request("https://fields.example.com/assets/missing.js"));
  assert.equal(response.status, 500);
  assert.match(await response.text(), /installed application files are unavailable or damaged/u);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/u);
  assert.equal(calls.length, 0);
});

test("registration installs the handler for HTTPS", async () => {
  let registered;
  const protocol = {
    async handle(scheme, handler) {
      registered = { scheme, handler };
    },
  };
  const handler = await registerLocalContentProtocol({
    protocol,
    net: { fetch: () => Promise.resolve(new Response()) },
    webRoot: "/app/web",
    version: "1.2.3",
  });
  assert.equal(registered.scheme, "https");
  assert.equal(registered.handler, handler);
});
