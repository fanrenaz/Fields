import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const publicSubpaths = [
  "agent-activity",
  "agent-room",
  "asset",
  "company",
  "embodiment",
  "executor",
  "home",
  "observability",
  "room",
  "search",
];
const sourceExtensions = /\.(?:[cm]?[jt]s|tsx)$/u;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "artifacts") continue;
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(url));
    else if (sourceExtensions.test(entry.name)) files.push(url);
  }
  return files;
}

test("package exports enforce explicit public, router, and internal boundaries", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.exports["."], undefined);
  for (const subpath of publicSubpaths) {
    const packageExport = manifest.exports[`./public/${subpath}`];
    assert.ok(packageExport);
    assert.equal(packageExport.require, packageExport.import);
  }
  assert.ok(manifest.exports["./router/backend"]);
  assert.ok(manifest.exports["./internal/company-runtime"]);
  assert.ok(manifest.exports["./internal/router/backend-runtime"]);
  assert.ok(manifest.exports["./internal/router/company-runtime"]);
  assert.ok(manifest.exports["./internal/agent-room"]);
  assert.ok(manifest.exports["./internal/agent-runtime"]);
  assert.ok(manifest.exports["./internal/asset"]);
  assert.equal(manifest.exports["./embodiment"], undefined);
  assert.equal(manifest.exports["./internal/company-runtime-router"], undefined);
  assert.equal(manifest.exports["./internal/sandbox-runtime"], undefined);
  assert.equal(manifest.exports["./home-client"], undefined);
  assert.equal(manifest.exports["./room-client"], undefined);

  const internalRuntime = await import("../dist/internal/company-runtime.js");
  assert.ok(internalRuntime.companyRuntimeMemberCleanupInputSchema);
  assert.ok(internalRuntime.companyRuntimeMemberCleanupResultSchema);
});

test("every public contract entry loads under browser conditions without server modules", async () => {
  const urls = publicSubpaths.map((subpath) =>
    new URL(`../dist/public/${subpath}.js`, import.meta.url).href);
  const result = spawnSync(process.execPath, [
    "--conditions=browser",
    "--input-type=module",
    "--eval",
    `await Promise.all(${JSON.stringify(urls)}.map((url) => import(url)));`,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const sourceDirectory = new URL("../src/public/", import.meta.url);
  const sources = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
  for (const source of sources) {
    const contents = await readFile(new URL(source, sourceDirectory), "utf8");
    assert.doesNotMatch(contents, /@trpc\/server|\/internal\/|\/router\//u, source);
  }
});

test("generated Company Runtime declarations preserve composed input and switch result types", async () => {
  const runtimeDeclaration = await readFile(
    new URL("../dist/internal/company-runtime.d.ts", import.meta.url),
    "utf8",
  );
  const routerDeclaration = await readFile(
    new URL("../dist/internal/router/company-runtime.d.ts", import.meta.url),
    "utf8",
  );
  for (const schemaName of [
    "companyRuntimeHomeThreadListInputSchema",
    "companyRuntimeHomeThreadSearchInputSchema",
    "companyRuntimeHomeThreadReadInputSchema",
    "companyRuntimeHomeTurnSubmitInputSchema",
    "companyRuntimeHomeTurnEventsInputSchema",
    "companyRuntimeHomeFilesystemSearchInputSchema",
    "companyRuntimeHomeFilesystemListInputSchema",
    "companyRuntimeHomeFilesystemCreateInputSchema",
    "companyRuntimeHomeFilesystemRenameInputSchema",
    "companyRuntimeHomeFilesystemDeleteInputSchema",
    "companyRuntimeHomeFilesystemEventsInputSchema",
  ]) {
    assert.doesNotMatch(runtimeDeclaration, new RegExp(`${schemaName}: any`, "u"));
  }
  assert.doesNotMatch(
    routerDeclaration,
    /switchExecutor[\s\S]{0,800}\[x: string\]: any;/u,
  );
});

test("repository consumers use explicit contract subpaths", async () => {
  const repository = new URL("../../", import.meta.url);
  const roots = ["backend/", "company-runtime/", "contracts/", "frontend/", "scripts/", "tools/"];
  for (const root of roots) {
    for (const file of await sourceFiles(new URL(root, repository))) {
      if (file.href === import.meta.url || file.pathname.includes("/tests/fixtures/")) continue;
      const contents = await readFile(file, "utf8");
      assert.doesNotMatch(contents, /from\s+["']@fields\/contracts["']/u, file.pathname);
      assert.doesNotMatch(contents, /@fields\/contracts\/embodiment(?:["'])/u, file.pathname);
      assert.doesNotMatch(contents, /@fields\/contracts\/internal\/company-runtime-router/u, file.pathname);
      if (file.pathname.includes("/frontend/")) {
        assert.doesNotMatch(contents, /from\s+["']@fields\/contracts\/internal\//u, file.pathname);
        for (const match of contents.matchAll(/import\s+([^;]+)\s+from\s+["']@fields\/contracts\/router\/[^"']+["'];/gu)) {
          assert.match(match[0], /^import\s+type\s+/u, file.pathname);
        }
      }
    }
  }
});
