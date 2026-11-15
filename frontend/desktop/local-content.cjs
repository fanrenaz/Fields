const fs = require("node:fs/promises");
const path = require("node:path");

const PRODUCTION_ORIGIN = "https://fields.example.com";
const NETWORK_PATH_PREFIXES = ["/api", "/embodiment", "/desktop"];

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webm", "video/webm"],
  [".ttf", "font/ttf"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "frame-src 'self' data: https://view.officeapps.live.com",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
].join("; ");

function isNetworkPath(pathname) {
  return NETWORK_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function networkRequest(request, url) {
  const method = String(request.method || "GET").toUpperCase();
  if (
    url.origin !== PRODUCTION_ORIGIN
    || !isNetworkPath(url.pathname)
    || method === "GET"
    || method === "HEAD"
  ) {
    return request;
  }

  const headers = new Headers(request.headers);
  const origin = headers.get("origin");
  if (origin && origin !== "null") return request;

  // Electron's custom HTTPS protocol boundary omits Origin from renderer
  // mutation requests. Restore the origin represented by the local bundled UI
  // so the production auth/API CSRF checks receive normal same-origin input.
  headers.set("origin", PRODUCTION_ORIGIN);
  return new Request(request, { headers });
}

function responseHeaders(contentType, length) {
  return {
    "Cache-Control": "no-cache",
    "Content-Length": String(length),
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function rawPathname(url) {
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?/iu.exec(url);
  return match?.[1] || "/";
}

function safeRelativePath(requestUrl) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname(requestUrl));
  } catch {
    return null;
  }

  const slashPath = decoded.replace(/^\/+/, "");
  if (slashPath.includes("\0") || slashPath.includes("\\")) return null;
  if (slashPath.split("/").some((segment) => segment === "..")) return null;

  const normalized = path.posix.normalize(slashPath);
  if (normalized === ".") return "";
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

function localFilePath(webRoot, relativePath) {
  const root = path.resolve(webRoot);
  const candidate = path.resolve(root, ...relativePath.split("/"));
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function isSpaRoute(relativePath) {
  return relativePath.length === 0 || path.posix.extname(relativePath).length === 0;
}

function recoveryHtml(version) {
  const safeVersion = escapeHtml(version || "unknown");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fields</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#111;color:#f5f5f5;font:16px system-ui,sans-serif}.card{max-width:32rem;padding:2rem}h1{font-size:1.5rem}p{line-height:1.5;color:#bbb}button{padding:.7rem 1rem;border:0;border-radius:.5rem;font:inherit;cursor:pointer}</style></head>
<body><main class="card"><h1>Fields could not load</h1><p>The installed application files are unavailable or damaged.</p><p>Version ${safeVersion}</p><form action="/" method="get"><button type="submit">Try again</button></form></main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function builtInRecoveryResponse(method, version, status = 500) {
  const body = Buffer.from(recoveryHtml(version));
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: responseHeaders("text/html; charset=utf-8", body.byteLength),
  });
}

function createLocalContentHandler({ net, webRoot, version, readFile = fs.readFile }) {
  if (!net || typeof net.fetch !== "function") throw new TypeError("net.fetch is required");
  if (!webRoot) throw new TypeError("webRoot is required");

  return async function handleLocalContent(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return builtInRecoveryResponse(request.method, version, 400);
    }

    if (url.origin !== PRODUCTION_ORIGIN || isNetworkPath(url.pathname)) {
      return net.fetch(networkRequest(request, url), { bypassCustomProtocolHandlers: true });
    }

    const method = String(request.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const relativePath = safeRelativePath(request.url);
    if (relativePath === null) return builtInRecoveryResponse(method, version, 400);

    const requestedPath = isSpaRoute(relativePath) ? "index.html" : relativePath;
    const filePath = localFilePath(webRoot, requestedPath);
    if (!filePath) return builtInRecoveryResponse(method, version, 400);

    try {
      const body = await readFile(filePath);
      const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
      return new Response(method === "HEAD" ? null : body, {
        status: 200,
        headers: responseHeaders(contentType, body.byteLength),
      });
    } catch {
      return builtInRecoveryResponse(method, version);
    }
  };
}

async function registerLocalContentProtocol({ protocol, net, webRoot, version }) {
  if (!protocol || typeof protocol.handle !== "function") throw new TypeError("protocol.handle is required");
  const handler = createLocalContentHandler({ net, webRoot, version });
  await protocol.handle("https", handler);
  return handler;
}

module.exports = {
  PRODUCTION_ORIGIN,
  createLocalContentHandler,
  isNetworkPath,
  registerLocalContentProtocol,
  safeRelativePath,
};
