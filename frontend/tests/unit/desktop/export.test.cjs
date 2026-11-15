const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = readFileSync(
  path.resolve(__dirname, "../../../desktop/export.cjs"),
  "utf8",
);

test("desktop export uses Vite's public build API", () => {
  assert.match(source, /await import\("vite"\)/u);
  assert.match(source, /await build\(\{\s*root: desktopRoot,\s*mode: "desktop"/u);
  assert.doesNotMatch(source, /vite\/bin\/vite\.js/u);
  assert.doesNotMatch(source, /require\.resolve\(/u);
});

test("desktop export retains its packaged runtime projection", () => {
  assert.match(source, /VITE_FIELDS_BACKEND_TRPC_URL: "\/api\/v1\/trpc"/u);
  assert.doesNotMatch(source, /VITE_FIELDS_DESKTOP:/u);
  assert.match(source, /VITE_FIELDS_DESKTOP_VERSION: packageJson\.version/u);
});
