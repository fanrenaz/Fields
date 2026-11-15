const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");

test("PWA manifest is scoped under the Gateway app prefix with install icons", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/app/home");
  assert.equal(manifest.scope, "/app/");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "512x512"]);
  for (const icon of manifest.icons) assert.equal(fs.existsSync(path.join(root, "public", icon.src.replace("/app/", ""))), true);
});

test("service worker does not implement offline fetch caching", () => {
  const source = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  assert.equal(source.includes('addEventListener("fetch"'), false);
  assert.equal(source.includes("caches."), false);
  assert.equal(source.includes('addEventListener("push"'), true);
  assert.equal(source.includes('addEventListener("notificationclick"'), true);
});

test("PWA metadata is mode-specific and absent from the desktop HTML template", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const vite = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");
  assert.equal(html.includes("manifest.webmanifest"), false);
  assert.match(vite, /mode === "pwa" \? "\/app\/" : "\/"/u);
  assert.match(vite, /\/app\/manifest\.webmanifest/u);
});
