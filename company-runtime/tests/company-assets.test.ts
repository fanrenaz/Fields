import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AssetStoreError,
  CompanyAssetStore,
  discoverMcpList,
  isPublicAddress,
  normalizeMcpToolCallResult,
  normalizeMcpTools,
  PinnedMcpSession,
} from "../src/application/assets/service.js";

test("MCP human API normalization exposes only browser-safe tool fields", () => {
  assert.deepEqual(normalizeMcpTools([{
    name: "create_issue",
    title: "Create issue",
    description: "Creates a repository issue.",
    inputSchema: { type: "object", properties: { title: { type: "string" } } },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      unknown: "removed",
    },
    _meta: { authorization: "removed" },
  }]), [{
    name: "create_issue",
    title: "Create issue",
    description: "Creates a repository issue.",
    input_schema: { type: "object", properties: { title: { type: "string" } } },
    annotations: {
      read_only_hint: false,
      destructive_hint: true,
    },
  }]);

  assert.deepEqual(normalizeMcpToolCallResult("create_issue", {
    content: [{ type: "text", text: "created" }],
    structuredContent: { number: 42 },
    isError: false,
    _meta: { headers: { authorization: "removed" } },
  }), {
    tool_name: "create_issue",
    is_error: false,
    text: ["created"],
    structured_content: { number: 42 },
  });
});

test("MCP human API normalization rejects duplicate tools and non-text results", () => {
  assert.throws(() => normalizeMcpTools([
    { name: "same", inputSchema: {} },
    { name: "same", inputSchema: {} },
  ]), (error: unknown) => (
    error instanceof AssetStoreError && error.code === "asset_mcp_response_invalid"
  ));
  assert.throws(() => normalizeMcpToolCallResult("read", {
    content: [{ type: "image", data: "not-forwarded" }],
  }), (error: unknown) => (
    error instanceof AssetStoreError && error.code === "asset_mcp_response_unsupported"
  ));
});

test("asset network policy rejects private and IPv4-mapped private addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "169.254.1.2",
    "100.64.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.19.255.254",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:ac10:0001",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "2001::1",
    "2002:7f00:1::",
    "fec0::1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("MCP endpoint policy rejects query and fragment credential channels", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-mcp-url-"));
  const store = new CompanyAssetStore(workdir);
  try {
    for (const endpoint_url of [
      "https://example.com/mcp?api_key=secret",
      "https://example.com/mcp#secret",
    ]) {
      await assert.rejects(
        store.storeMcp({
          operation_id: `operation-${Buffer.from(endpoint_url).toString("hex")}`,
          request_fingerprint: "a".repeat(64),
          draft_id: "draft-mcp-url",
          expected_content_sha256: null,
          endpoint_url,
          authentication: "none",
          bearer_token: null,
        }),
        (error: unknown) => (
          error instanceof AssetStoreError
          && error.code === "asset_public_https_required"
        ),
      );
    }
    const ipv6 = await store.storeMcp({
      operation_id: "operation-ipv6-literal",
      request_fingerprint: "3".repeat(64),
      draft_id: "draft-mcp-ipv6",
      expected_content_sha256: null,
      endpoint_url: "https://[2606:4700:4700::1111]:8443/mcp",
      authentication: "none",
      bearer_token: null,
    });
    assert.equal(
      ipv6.source.type === "mcp" && ipv6.source.endpoint_url,
      "https://[2606:4700:4700::1111]:8443/mcp",
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("ZIP import rejects traversal and deduplicates normalized content", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-store-"));
  const store = new CompanyAssetStore(workdir);
  try {
    await assert.rejects(
      store.importZip({
        draft_id: "draft-slip",
        expected_content_sha256: null,
        kind: "skill",
        file_name: "slip.zip",
        package_base64: zip([{ path: "../escape.txt", contents: "escape" }]).toString("base64"),
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && (error.code === "asset_zip_slip" || error.code === "asset_zip_path_invalid")
      ),
    );

    const packageBytes = zip([{
      path: "SKILL.md",
      contents: "---\nname: Research Skill\ndescription: Test\n---\n",
    }]);
    const first = await store.importZip({
      draft_id: "draft-one",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "skill.zip",
      package_base64: packageBytes.toString("base64"),
    });
    const second = await store.importZip({
      draft_id: "draft-two",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "skill.zip",
      package_base64: packageBytes.toString("base64"),
    });
    assert.equal(first.content_sha256, second.content_sha256);
    assert.equal(first.inferred_name, "Research Skill");
    assert.deepEqual(
      await readdir(join(workdir, "assets", "blobs")),
      [first.content_sha256],
    );
    const storedSkill = join(
      workdir,
      "assets",
      "blobs",
      first.content_sha256,
      "SKILL.md",
    );
    assert.equal((await stat(storedSkill)).mode & 0o777, 0o400);
    assert.equal(
      (await stat(join(workdir, "assets", "blobs", first.content_sha256))).mode & 0o777,
      0o500,
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("immutable asset archives restore an evicted Runtime cache from object storage", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-object-cache-"));
  const objects = new Map<string, Uint8Array>();
  const objectStore = {
    has: async (digest: string) => objects.has(digest),
    putIfAbsent: async (digest: string, archive: Uint8Array) => {
      if (!objects.has(digest)) objects.set(digest, archive);
    },
    get: async (digest: string) => {
      const archive = objects.get(digest);
      if (!archive) throw new Error("missing object");
      return archive;
    },
  };
  const store = new CompanyAssetStore(workdir, { objectStore });
  try {
    const stored = await store.importZip({
      draft_id: "draft-object-cache",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "skill.zip",
      package_base64: zip([{
        path: "SKILL.md",
        contents: "---\nname: Object Skill\ndescription: Test\n---\n",
      }]).toString("base64"),
    });
    assert.equal(objects.size, 1);
    await removeTestTree(join(workdir, "assets", "blobs", stored.content_sha256));
    const content = await store.contentRead(stored.content_sha256, "SKILL.md");
    assert.match(content.text ?? "", /Object Skill/u);
  } finally {
    await removeTestTree(workdir);
  }
});

test("content-addressed packages reject filesystem tampering", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-integrity-"));
  const store = new CompanyAssetStore(workdir);
  try {
    const stored = await store.importZip({
      draft_id: "draft-integrity",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "skill.zip",
      package_base64: zip([{
        path: "SKILL.md",
        contents: "---\nname: Integrity Skill\ndescription: Test\n---\n",
      }]).toString("base64"),
    });
    const contentPath = join(
      workdir,
      "assets",
      "blobs",
      stored.content_sha256,
      "SKILL.md",
    );
    await chmod(contentPath, 0o600);
    await writeFile(contentPath, "tampered");

    await assert.rejects(
      store.contentRead(stored.content_sha256, "SKILL.md"),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_content_integrity_failed"
      ),
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("streamed ZIP import accepts multi-megabyte bodies, verifies digest, and drains replays", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-stream-"));
  const store = new CompanyAssetStore(workdir);
  const packageBytes = zip([
    {
      path: "SKILL.md",
      contents: "---\nname: Stream Skill\ndescription: Test\n---\n",
    },
    {
      path: "payload.txt",
      contents: "x".repeat(2 * 1024 * 1024),
    },
  ]);
  const input = {
    operation_id: "stream-operation",
    request_fingerprint: "f".repeat(64),
    draft_id: "draft-stream",
    expected_content_sha256: null,
    kind: "skill" as const,
    file_name: "stream.zip",
    package_sha256: createHash("sha256").update(packageBytes).digest("hex"),
    package_size_bytes: packageBytes.byteLength,
  };
  try {
    const stored = await store.importZipStream(input, chunked(packageBytes));
    assert.equal(stored.inferred_name, "Stream Skill");

    let replayBytes = 0;
    const replayBody = (async function* replayChunks() {
      for await (const chunk of chunked(packageBytes)) {
        replayBytes += chunk.byteLength;
        yield chunk;
      }
    })();
    assert.deepEqual(await store.importZipStream(input, replayBody), stored);
    assert.equal(replayBytes, packageBytes.byteLength);

    await assert.rejects(
      store.importZipStream({
        ...input,
        operation_id: "stream-digest-mismatch",
        request_fingerprint: "0".repeat(64),
        draft_id: "draft-stream-mismatch",
        package_sha256: "1".repeat(64),
      }, chunked(packageBytes)),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_zip_digest_mismatch"
      ),
    );

    const boundary = Buffer.alloc(25 * 1024 * 1024);
    await assert.rejects(
      store.importZipStream({
        ...input,
        operation_id: "stream-boundary",
        request_fingerprint: "2".repeat(64),
        draft_id: "draft-stream-boundary",
        package_sha256: createHash("sha256").update(boundary).digest("hex"),
        package_size_bytes: boundary.byteLength,
      }, chunked(boundary)),
      (error: unknown) => (
        !(error instanceof AssetStoreError)
        || (
          error.code !== "asset_zip_size_invalid"
          && error.code !== "asset_zip_digest_mismatch"
        )
      ),
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("ZIP import rejects duplicate paths, special entries, and more than 2,000 entries", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-zip-policy-"));
  const store = new CompanyAssetStore(workdir);
  try {
    for (const entries of [
      [
        { path: "SKILL.md", contents: "---\nname: Duplicate Skill\n---\n" },
        { path: "SKILL.md", contents: "duplicate" },
      ],
      [
        {
          path: "SKILL.md",
          contents: "../outside",
          externalAttributes: 0o120777 << 16,
        },
      ],
    ]) {
      await assert.rejects(
        store.importZip({
          draft_id: `draft-${Math.random()}`,
          expected_content_sha256: null,
          kind: "skill",
          file_name: "invalid.zip",
          package_base64: zip(entries).toString("base64"),
        }),
        AssetStoreError,
      );
    }
    const directories = Array.from({ length: 2_001 }, (_, index) => ({
      path: `directory-${String(index)}/`,
      contents: "",
      externalAttributes: 0o040700 << 16,
    }));
    await assert.rejects(
      store.importZip({
        draft_id: "draft-entry-limit",
        expected_content_sha256: null,
        kind: "skill",
        file_name: "many-directories.zip",
        package_base64: zip(directories).toString("base64"),
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_zip_expansion_limit"
      ),
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("Backend-authoritative draft updates clean old cache blobs without racing deduplicated imports", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-cas-"));
  const store = new CompanyAssetStore(workdir);
  const firstPackage = zip([{
    path: "SKILL.md",
    contents: "---\nname: First Skill\n---\n",
  }]);
  const secondPackage = zip([{
    path: "SKILL.md",
    contents: "---\nname: Second Skill\n---\n",
  }]);
  try {
    const first = await store.importZip({
      operation_id: "cas-first",
      request_fingerprint: "a".repeat(64),
      draft_id: "draft-cas",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "first.zip",
      package_base64: firstPackage.toString("base64"),
    });
    await store.importZip({
      operation_id: "cas-control-plane-authorized",
      request_fingerprint: "b".repeat(64),
      draft_id: "draft-cas",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "second.zip",
      package_base64: secondPackage.toString("base64"),
    });
    assert.equal((await readdir(join(workdir, "assets", "blobs"))).length, 2);

    const second = await store.importZip({
      operation_id: "cas-update",
      request_fingerprint: "c".repeat(64),
      draft_id: "draft-cas",
      expected_content_sha256: first.content_sha256,
      kind: "skill",
      file_name: "second.zip",
      package_base64: secondPackage.toString("base64"),
    });
    assert.deepEqual(await readdir(join(workdir, "assets", "blobs")), [second.content_sha256]);

    const [deduplicatedOne, deduplicatedTwo] = await Promise.all([
      store.importZip({
        draft_id: "draft-dedup-one",
        expected_content_sha256: null,
        kind: "skill",
        file_name: "second.zip",
        package_base64: secondPackage.toString("base64"),
      }),
      store.importZip({
        draft_id: "draft-dedup-two",
        expected_content_sha256: null,
        kind: "skill",
        file_name: "second.zip",
        package_base64: secondPackage.toString("base64"),
      }),
    ]);
    assert.equal(deduplicatedOne.content_sha256, deduplicatedTwo.content_sha256);
    await Promise.all([
      store.releaseDraft("draft-cas"),
      store.releaseDraft("draft-dedup-one"),
    ]);
    await stat(join(workdir, "assets", "blobs", second.content_sha256));
    await store.releaseDraft("draft-dedup-two");
    await stat(join(workdir, "assets", "blobs", second.content_sha256));
  } finally {
    await removeTestTree(workdir);
  }
});

test("Git import accepts public HTTPS URLs without a .git suffix and pins HEAD", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-git-"));
  const fakeGit = join(workdir, "fake-git.mjs");
  const cloneMarker = join(workdir, "clone-count");
  const cloneArguments = join(workdir, "clone-arguments");
  await writeFile(fakeGit, `#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args.includes("clone")) {
  const marker = ${JSON.stringify(cloneMarker)};
  const count = Number(await readFile(marker, "utf8").catch(() => "0")) + 1;
  await writeFile(marker, String(count));
  await writeFile(${JSON.stringify(cloneArguments)}, JSON.stringify(args));
  const target = args.at(-1);
  await mkdir(target, { recursive: true });
  await writeFile(new URL("SKILL.md", \`file://\${target}/\`), "---\\nname: Git Skill\\ndescription: Imported\\n---\\n");
} else if (args.includes("rev-parse")) {
  process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");
}
`, { mode: 0o700 });
  await chmod(fakeGit, 0o700);
  const store = new CompanyAssetStore(workdir, { gitCommand: fakeGit });
  try {
    const result = await store.importGit({
      operation_id: "git-operation",
      request_fingerprint: "b".repeat(64),
      draft_id: "draft-git",
      expected_content_sha256: null,
      kind: "skill",
      repository_url: "https://example.com:8443/repository",
      subdirectory: null,
    });
    assert.equal(result.source.type, "git");
    assert.equal(result.source.type === "git" && result.source.commit_sha,
      "0123456789abcdef0123456789abcdef01234567");
    const replay = await store.importGit({
      operation_id: "git-operation",
      request_fingerprint: "b".repeat(64),
      draft_id: "draft-git",
      expected_content_sha256: null,
      kind: "skill",
      repository_url: "https://example.com:8443/repository",
      subdirectory: null,
    });
    assert.equal(replay.content_sha256, result.content_sha256);
    assert.equal(await readFile(cloneMarker, "utf8"), "1");
    assert.match(await readFile(cloneArguments, "utf8"), /example\.com:8443:/u);
  } finally {
    await removeTestTree(workdir);
  }
});

test("Git import kills clones that exceed the live isolated filesystem limit", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-git-limit-"));
  const fakeGit = join(workdir, "fake-large-git.mjs");
  const heartbeat = join(workdir, "git-grandchild-heartbeat");
  await writeFile(fakeGit, `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const target = process.argv.at(-1);
await mkdir(target, { recursive: true });
spawn(process.execPath, ["-e", ${JSON.stringify(`
  const { writeFileSync } = require("node:fs");
  setInterval(() => writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 10);
`)}], { stdio: "ignore" });
while (!await readFile(${JSON.stringify(heartbeat)}, "utf8").catch(() => null)) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
await writeFile(new URL("oversized.pack", \`file://\${target}/\`), Buffer.alloc(2_048));
setInterval(() => undefined, 1_000);
`, { mode: 0o700 });
  await chmod(fakeGit, 0o700);
  const store = new CompanyAssetStore(workdir, {
    gitCommand: fakeGit,
    gitCloneMaxBytes: 1_024,
  });
  try {
    await assert.rejects(
      store.importGit({
        operation_id: "git-limit-operation",
        request_fingerprint: "d".repeat(64),
        draft_id: "draft-git-limit",
        expected_content_sha256: null,
        kind: "skill",
        repository_url: "https://8.8.8.8/repository",
        subdirectory: null,
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_process_resource_limit"
      ),
    );
    const stoppedHeartbeat = await readFile(heartbeat, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await readFile(heartbeat, "utf8"), stoppedHeartbeat);
  } finally {
    await removeTestTree(workdir);
  }
});

test("Codex validation discovers Skill and Plugin capabilities without executing package scripts", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-codex-"));
  const fakeCodex = join(workdir, "fake-codex.mjs");
  const executedMarker = join(workdir, "package-script-executed");
  await writeFile(fakeCodex, `#!/usr/bin/env node
import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result = {};
  if (request.method === "skills/list") {
    result = { data: [{ skills: [{
      name: "Research Skill",
      path: new URL("SKILL.md", \`file://\${request.params.cwds[0]}/\`).pathname,
      scope: "repo",
      enabled: true,
    }], errors: [] }] };
  } else if (request.method === "plugin/read") {
    result = { plugin: {
      summary: { name: "research-plugin", localVersion: "1.2.3" },
      skills: [{ name: "Plugin Skill" }],
      hooks: [],
      apps: [],
      appTemplates: [],
      mcpServers: ["plugin-mcp"],
      scheduledTasks: [],
    } };
  }
  process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
  }
`, { mode: 0o700 });
  await chmod(fakeCodex, 0o700);
  let validationClock = 100;
  const store = new CompanyAssetStore(workdir, {
    codexCommand: fakeCodex,
    nowMs: () => validationClock++,
  });
  try {
    const skill = await store.importZip({
      draft_id: "draft-skill",
      expected_content_sha256: null,
      kind: "skill",
      file_name: "skill.zip",
      package_base64: zip([{
        path: "SKILL.md",
        contents: "---\nname: Research Skill\ndescription: Test\n---\n",
      }]).toString("base64"),
    });
    const skillValidation = await store.validate({
      operation_id: "validation-skill",
      request_fingerprint: "8".repeat(64),
      draft_id: "draft-skill",
      asset_id: "asset-skill",
      kind: "skill",
      content_sha256: skill.content_sha256,
      source: skill.source,
    });
    assert.equal(skillValidation.validation.status, "valid");
    assert.deepEqual(skillValidation.capabilities.entries, [{
      kind: "skill",
      name: "Research Skill",
    }]);
    assert.deepEqual(await store.validate({
      operation_id: "validation-skill",
      request_fingerprint: "8".repeat(64),
      draft_id: "draft-skill",
      asset_id: "asset-skill",
      kind: "skill",
      content_sha256: skill.content_sha256,
      source: skill.source,
    }), skillValidation);

    const plugin = await store.importZip({
      draft_id: "draft-plugin",
      expected_content_sha256: null,
      kind: "plugin",
      file_name: "plugin.zip",
      package_base64: zip([
        {
          path: ".codex-plugin/plugin.json",
          contents: JSON.stringify({ name: "research-plugin", version: "1.2.3" }),
        },
        {
          path: "package.json",
          contents: JSON.stringify({
            scripts: { install: `touch ${executedMarker}` },
          }),
        },
      ]).toString("base64"),
    });
    const pluginValidation = await store.validate({
      operation_id: "validation-plugin",
      request_fingerprint: "9".repeat(64),
      draft_id: "draft-plugin",
      asset_id: "asset-plugin",
      kind: "plugin",
      content_sha256: plugin.content_sha256,
      source: plugin.source,
    });
    assert.equal(pluginValidation.validation.status, "valid");
    assert.deepEqual(pluginValidation.capabilities.entries, [
      { kind: "skill", name: "Plugin Skill" },
      { kind: "mcp", name: "plugin-mcp" },
    ]);
    await assert.rejects(readFile(executedMarker), { code: "ENOENT" });
  } finally {
    await removeTestTree(workdir);
  }
});

test("Plugin import rejects unsafe identities and non-formal versions before publishing CAS content", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-plugin-policy-"));
  const store = new CompanyAssetStore(workdir);
  try {
    for (const [name, version] of [
      ["../../escape", "1.2.3"],
      ["/tmp/escape", "1.2.3"],
      ["slash/name", "1.2.3"],
      ["back\\name", "1.2.3"],
      [" white ", "1.2.3"],
      ["插件", "1.2.3"],
      ["fields-core", "1.2.3"],
      ["valid-plugin", "01.2.3"],
      ["valid-plugin", "1.2.3-beta.1"],
      ["valid-plugin", "1.2.3+build"],
      ["valid-plugin", "9007199254740992.0.0"],
    ] as const) {
      await assert.rejects(
        store.importZip({
          draft_id: `draft-${Buffer.from(`${name}:${version}`).toString("hex")}`,
          expected_content_sha256: null,
          kind: "plugin",
          file_name: "plugin.zip",
          package_base64: zip([{
            path: ".codex-plugin/plugin.json",
            contents: JSON.stringify({ name, version }),
          }]).toString("base64"),
        }),
        AssetStoreError,
      );
    }
    assert.deepEqual(await readdir(join(workdir, "assets", "blobs")), []);
    assert.deepEqual(await readdir(join(workdir, "assets", "refs", "drafts")), []);
  } finally {
    await removeTestTree(workdir);
  }
});

test("MCP store recovers one operation across object package and credential crash windows", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-mcp-operation-"));
  const store = new CompanyAssetStore(workdir);
  const input = {
    operation_id: "mcp-store-operation",
    request_fingerprint: "e".repeat(64),
    draft_id: "draft-mcp-operation",
    expected_content_sha256: null,
    endpoint_url: "https://8.8.8.8:8443/mcp",
    authentication: "bearer" as const,
    bearer_token: "operation-secret",
  };
  try {
    const stored = await store.storeMcp(input);
    const packageReceiptPath = join(
      workdir,
      "assets",
      "operations",
      "packages",
      `${input.operation_id}.json`,
    );
    const credentialReceiptPath = join(
      workdir,
      "assets",
      "operations",
      "credentials",
      `${input.operation_id}.json`,
    );
    const packageReceipt = JSON.parse(
      await readFile(packageReceiptPath, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(packageReceiptPath, `${JSON.stringify({
      ...packageReceipt,
      status: "staged",
    })}\n`);
    await writeFile(credentialReceiptPath, `${JSON.stringify({
      request_fingerprint: input.request_fingerprint,
      status: "pending",
      target: "draft",
      target_id: input.draft_id,
      endpoint_url: input.endpoint_url,
      authentication: input.authentication,
      credential_present: true,
    })}\n`);
    await rm(join(workdir, "assets", "credentials", "drafts", `${input.draft_id}.json`));

    assert.deepEqual(await store.storeMcp(input), stored);
    assert.equal(
      (JSON.parse(await readFile(packageReceiptPath, "utf8")) as { status: string }).status,
      "completed",
    );
    assert.match(
      await readFile(
        join(workdir, "assets", "credentials", "drafts", `${input.draft_id}.json`),
        "utf8",
      ),
      /operation-secret/u,
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("staged MCP endpoint updates preserve credentials until an explicit post-commit removal", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-mcp-staged-"));
  const store = new CompanyAssetStore(workdir);
  const draftId = "draft-mcp-staged";
  const credentialPath = join(
    workdir,
    "assets",
    "credentials",
    "drafts",
    `${draftId}.json`,
  );
  try {
    await store.replaceCredential({
      operation_id: "mcp-old-credential",
      request_fingerprint: "4".repeat(64),
      reference: { type: "draft", draft_id: draftId },
      endpoint_url: "https://8.8.8.8/old",
      authentication: "bearer",
      bearer_token: "old-secret",
    });
    const staged = await store.storeMcp({
      operation_id: "mcp-staged-update",
      request_fingerprint: "5".repeat(64),
      draft_id: draftId,
      expected_content_sha256: null,
      endpoint_url: "https://8.8.8.8/new",
      authentication: "bearer",
    });
    assert.equal(
      staged.source.type === "mcp" && staged.source.credential_configured,
      false,
    );
    assert.match(await readFile(credentialPath, "utf8"), /old-secret/u);
    assert.match(await readFile(credentialPath, "utf8"), /8\.8\.8\.8\/old/u);

    await store.replaceCredential({
      operation_id: "mcp-staged-update",
      request_fingerprint: "5".repeat(64),
      reference: { type: "draft", draft_id: draftId },
      endpoint_url: "https://8.8.8.8/new",
      authentication: "bearer",
      bearer_token: null,
    });
    await assert.rejects(stat(credentialPath), { code: "ENOENT" });
  } finally {
    await removeTestTree(workdir);
  }
});

test("Bearer credentials stay outside content blobs and retain owner-only mode", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-credential-"));
  const store = new CompanyAssetStore(workdir);
  try {
    await store.replaceCredential({
      operation_id: "credential-operation-one",
      request_fingerprint: "1".repeat(64),
      reference: { type: "draft", draft_id: "draft-mcp" },
      endpoint_url: "https://example.com/mcp",
      authentication: "bearer",
      bearer_token: "super-secret",
    });
    const credentialPath = join(
      workdir,
      "assets",
      "credentials",
      "drafts",
      "draft-mcp.json",
    );
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
    assert.match(await readFile(credentialPath, "utf8"), /super-secret/u);
    assert.equal(
      (await readdir(join(workdir, "assets", "blobs"))).some((name) => name.includes("secret")),
      false,
    );
    await store.replaceCredential({
      operation_id: "credential-operation-one",
      request_fingerprint: "1".repeat(64),
      reference: { type: "draft", draft_id: "draft-mcp" },
      endpoint_url: "https://example.com/mcp",
      authentication: "bearer",
      bearer_token: "must-not-overwrite-first-operation",
    });
    assert.doesNotMatch(await readFile(credentialPath, "utf8"), /must-not-overwrite/u);
    const operationReceipt = await readFile(join(
      workdir,
      "assets",
      "operations",
      "credentials",
      "credential-operation-one.json",
    ), "utf8");
    assert.doesNotMatch(operationReceipt, /super-secret|must-not-overwrite/u);
    assert.doesNotMatch(
      operationReceipt,
      /66d9c17f4c4ab861b45d9fd7a6566f382d7f3cdd5155a4a7fca59d253b33c4e7/u,
    );
    await store.replaceCredential({
      operation_id: "credential-operation-two",
      request_fingerprint: "2".repeat(64),
      reference: { type: "draft", draft_id: "draft-mcp" },
      endpoint_url: "https://example.com/mcp",
      authentication: "bearer",
      bearer_token: null,
    });
    await assert.rejects(stat(credentialPath), { code: "ENOENT" });
  } finally {
    await removeTestTree(workdir);
  }
});

test("Bearer credentials remain isolated by draft, version, and endpoint", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-credential-scope-"));
  const store = new CompanyAssetStore(workdir);
  try {
    await Promise.all([
      store.replaceCredential({
        operation_id: "credential-draft-one",
        request_fingerprint: "3".repeat(64),
        reference: { type: "draft", draft_id: "draft-one" },
        endpoint_url: "https://example.com/one",
        authentication: "bearer",
        bearer_token: "token-one",
      }),
      store.replaceCredential({
        operation_id: "credential-draft-two",
        request_fingerprint: "4".repeat(64),
        reference: { type: "draft", draft_id: "draft-two" },
        endpoint_url: "https://example.com/two",
        authentication: "bearer",
        bearer_token: "token-two",
      }),
      store.replaceCredential({
        operation_id: "credential-version-one",
        request_fingerprint: "5".repeat(64),
        reference: { type: "version", version_id: "version-one" },
        endpoint_url: "https://example.com/one",
        authentication: "bearer",
        bearer_token: "published-token",
      }),
    ]);
    const credentialRoot = join(workdir, "assets", "credentials");
    assert.match(await readFile(join(credentialRoot, "drafts", "draft-one.json"), "utf8"), /token-one/u);
    assert.match(await readFile(join(credentialRoot, "drafts", "draft-two.json"), "utf8"), /token-two/u);
    assert.match(
      await readFile(join(credentialRoot, "versions", "version-one.json"), "utf8"),
      /published-token/u,
    );
    await store.replaceCredential({
      operation_id: "credential-draft-one-clear",
      request_fingerprint: "6".repeat(64),
      reference: { type: "draft", draft_id: "draft-one" },
      endpoint_url: "https://example.com/changed",
      authentication: "bearer",
      bearer_token: null,
    });
    await assert.rejects(
      stat(join(credentialRoot, "drafts", "draft-one.json")),
      { code: "ENOENT" },
    );
    await stat(join(credentialRoot, "drafts", "draft-two.json"));
    await stat(join(credentialRoot, "versions", "version-one.json"));
  } finally {
    await removeTestTree(workdir);
  }
});

test("staged credential operations preserve active secrets until commit and support abort", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-credential-stage-"));
  const store = new CompanyAssetStore(workdir);
  const activePath = join(
    workdir,
    "assets",
    "credentials",
    "drafts",
    "draft-stage.json",
  );
  const stagedInput = {
    operation_id: "credential-staged-operation",
    request_fingerprint: "a".repeat(64),
    target_revision: 2,
    expected_operation_id: null,
    reference: { type: "draft" as const, draft_id: "draft-stage" },
    endpoint_url: "https://8.8.8.8/mcp",
    authentication: "bearer" as const,
    bearer_token: "next-secret",
  };
  try {
    await store.replaceCredential({
      ...stagedInput,
      operation_id: "credential-active-old",
      request_fingerprint: "b".repeat(64),
      bearer_token: "old-secret",
    });
    await store.stageCredential(stagedInput);
    assert.match(await readFile(activePath, "utf8"), /old-secret/u);
    await store.abortCredential(stagedInput);
    assert.match(await readFile(activePath, "utf8"), /old-secret/u);

    await store.stageCredential(stagedInput);
    assert.match(await readFile(activePath, "utf8"), /old-secret/u);
    await store.commitCredential(stagedInput);
    await store.commitCredential(stagedInput);
    assert.match(await readFile(activePath, "utf8"), /next-secret/u);
    const stagedPath = join(
      workdir,
      "assets",
      "credentials",
      "staged",
      `${stagedInput.operation_id}.json`,
    );
    await assert.rejects(
      stat(stagedPath),
      { code: "ENOENT" },
    );
    await writeFile(stagedPath, JSON.stringify({
      ...stagedInput,
      bearer_token: "completed-crash-secret",
    }), { mode: 0o600 });
    await store.commitCredential(stagedInput);
    await assert.rejects(stat(stagedPath), { code: "ENOENT" });
    await writeFile(stagedPath, JSON.stringify({
      ...stagedInput,
      bearer_token: "completed-abort-crash-secret",
    }), { mode: 0o600 });
    await store.abortCredential(stagedInput);
    await assert.rejects(stat(stagedPath), { code: "ENOENT" });

    const receiptCrashInput = {
      ...stagedInput,
      operation_id: "credential-state-receipt-crash",
      request_fingerprint: "c".repeat(64),
      target_revision: 3,
      expected_operation_id: stagedInput.operation_id,
      bearer_token: "receipt-crash-secret",
    };
    await store.stageCredential(receiptCrashInput);
    const receiptCrashStagePath = join(
      workdir,
      "assets",
      "credentials",
      "staged",
      `${receiptCrashInput.operation_id}.json`,
    );
    const receiptCrashOperationPath = join(
      workdir,
      "assets",
      "operations",
      "credentials",
      `${receiptCrashInput.operation_id}.json`,
    );
    const committedState = {
      endpoint_url: receiptCrashInput.endpoint_url,
      authentication: receiptCrashInput.authentication,
      bearer_token: receiptCrashInput.bearer_token,
      operation_id: receiptCrashInput.operation_id,
      target_revision: receiptCrashInput.target_revision,
    };
    await writeFile(activePath, JSON.stringify(committedState), { mode: 0o600 });
    assert.equal(
      (JSON.parse(await readFile(receiptCrashOperationPath, "utf8")) as { status: string }).status,
      "staged",
    );
    await store.commitCredential(receiptCrashInput);
    assert.deepEqual(JSON.parse(await readFile(activePath, "utf8")), committedState);
    assert.equal(
      (JSON.parse(await readFile(receiptCrashOperationPath, "utf8")) as { status: string }).status,
      "completed",
    );
    await assert.rejects(stat(receiptCrashStagePath), { code: "ENOENT" });

    const orphanInput = {
      operation_id: "credential-orphaned-stage",
      request_fingerprint: "d".repeat(64),
    };
    const orphanPath = join(
      workdir,
      "assets",
      "credentials",
      "staged",
      `${orphanInput.operation_id}.json`,
    );
    await writeFile(orphanPath, JSON.stringify({
      reference: { type: "draft", draft_id: "draft-stage" },
      endpoint_url: "https://8.8.8.8/mcp",
      authentication: "bearer",
      bearer_token: "orphan-crash-secret",
    }), { mode: 0o600 });
    await store.abortCredential(orphanInput);
    await assert.rejects(stat(orphanPath), { code: "ENOENT" });
    assert.doesNotMatch(
      await readFile(join(
        workdir,
        "assets",
        "operations",
        "credentials",
        `${stagedInput.operation_id}.json`,
      ), "utf8"),
      /old-secret|next-secret/u,
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("credential target fence orders concurrent commits and discards superseded stages", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-credential-fence-"));
  const store = new CompanyAssetStore(workdir);
  const activePath = join(
    workdir,
    "assets",
    "credentials",
    "drafts",
    "draft-fence.json",
  );
  const base = {
    reference: { type: "draft" as const, draft_id: "draft-fence" },
    endpoint_url: "https://8.8.8.8/mcp",
    authentication: "bearer" as const,
  };
  const first = {
    ...base,
    operation_id: "credential-fence-a",
    request_fingerprint: "d".repeat(64),
    target_revision: 2,
    expected_operation_id: null,
    bearer_token: "token-a",
  };
  const second = {
    ...base,
    operation_id: "credential-fence-b",
    request_fingerprint: "e".repeat(64),
    target_revision: 3,
    expected_operation_id: first.operation_id,
    bearer_token: "token-b",
  };
  try {
    await store.replaceCredential({
      ...base,
      operation_id: "credential-fence-original",
      request_fingerprint: "f".repeat(64),
      bearer_token: "token-original",
    });
    await store.stageCredential(first);
    await store.stageCredential(second);
    await store.commitCredential(second);
    assert.match(await readFile(activePath, "utf8"), /token-b/u);
    await store.commitCredential(first);
    assert.match(await readFile(activePath, "utf8"), /token-b/u);

    const stale = {
      ...first,
      operation_id: "credential-fence-stale",
      request_fingerprint: "1".repeat(64),
      bearer_token: "token-stale",
    };
    await store.stageCredential(stale);
    await store.commitCredential(stale);
    assert.match(await readFile(activePath, "utf8"), /token-b/u);
    await assert.rejects(
      stat(join(
        workdir,
        "assets",
        "credentials",
        "staged",
        `${stale.operation_id}.json`,
      )),
      { code: "ENOENT" },
    );

    const conflicting = {
      ...second,
      operation_id: "credential-fence-conflict",
      request_fingerprint: "2".repeat(64),
      bearer_token: "token-conflict",
    };
    await store.stageCredential(conflicting);
    await assert.rejects(
      store.commitCredential(conflicting),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_operation_conflict"
      ),
    );
    assert.match(await readFile(activePath, "utf8"), /token-b/u);
  } finally {
    await removeTestTree(workdir);
  }
});

test("credential tombstones publish as a version revision-one baseline", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-credential-publish-"));
  const store = new CompanyAssetStore(workdir);
  const draftId = "draft-credential-publish";
  const versionId = "version-credential-publish";
  const endpointUrl = "https://8.8.8.8/mcp";
  const draftReference = { type: "draft" as const, draft_id: draftId };
  const stored = await store.storeMcp({
    operation_id: "credential-publish-package",
    request_fingerprint: "3".repeat(64),
    draft_id: draftId,
    expected_content_sha256: null,
    endpoint_url: endpointUrl,
    authentication: "bearer",
  });
  const configured = {
    operation_id: "credential-publish-configured",
    request_fingerprint: "4".repeat(64),
    reference: draftReference,
    target_revision: 4,
    expected_operation_id: null,
    endpoint_url: endpointUrl,
    authentication: "bearer" as const,
    bearer_token: "draft-secret",
  };
  const cleared = {
    ...configured,
    operation_id: "credential-publish-cleared",
    request_fingerprint: "5".repeat(64),
    target_revision: 5,
    expected_operation_id: configured.operation_id,
    bearer_token: null,
  };
  const versionCredential = {
    operation_id: "credential-version-configured",
    request_fingerprint: "6".repeat(64),
    reference: { type: "version" as const, version_id: versionId },
    target_revision: 2,
    expected_operation_id: cleared.operation_id,
    endpoint_url: endpointUrl,
    authentication: "bearer" as const,
    bearer_token: "version-secret",
  };
  try {
    await store.stageCredential(configured);
    await store.commitCredential(configured);
    await store.stageCredential(cleared);
    await store.commitCredential(cleared);

    const refreshed = await store.storeMcp({
      operation_id: "credential-publish-refresh",
      request_fingerprint: "7".repeat(64),
      draft_id: draftId,
      expected_content_sha256: stored.content_sha256,
      endpoint_url: endpointUrl,
      authentication: "bearer",
    });
    assert.equal(
      refreshed.source.type === "mcp" && refreshed.source.credential_configured,
      false,
    );

    await store.publishReference(draftId, versionId, stored.content_sha256);
    const versionPath = join(
      workdir,
      "assets",
      "credentials",
      "versions",
      `${versionId}.json`,
    );
    assert.deepEqual(
      JSON.parse(await readFile(versionPath, "utf8")),
      {
        endpoint_url: endpointUrl,
        authentication: "bearer",
        bearer_token: null,
        operation_id: cleared.operation_id,
        target_revision: 1,
      },
    );

    await store.stageCredential(versionCredential);
    await store.commitCredential(versionCredential);
    assert.deepEqual(
      JSON.parse(await readFile(versionPath, "utf8")),
      {
        endpoint_url: endpointUrl,
        authentication: "bearer",
        bearer_token: "version-secret",
        operation_id: versionCredential.operation_id,
        target_revision: 2,
      },
    );
  } finally {
    await removeTestTree(workdir);
  }
});

test("pinned MCP session negotiates a supported version and sends it on JSON, SSE, and notifications", async () => {
  const observed: Array<{
    method: string;
    protocolVersion: string | undefined;
    cursor: string | undefined;
  }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method: string;
      params?: { cursor?: string };
    };
    observed.push({
      method: payload.method,
      protocolVersion: Array.isArray(request.headers["mcp-protocol-version"])
        ? request.headers["mcp-protocol-version"][0]
        : request.headers["mcp-protocol-version"],
      cursor: payload.params?.cursor,
    });
    if (payload.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    const result = payload.method === "initialize"
      ? {
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: "local-mcp", version: "1.0.0" },
      }
      : payload.params?.cursor
        ? { tools: [{ name: "second" }] }
        : { tools: [{ name: "first" }], nextCursor: "page-two" };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id,
      result,
    });
    if (payload.params?.cursor) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: message\ndata: ${body}\n\n`);
    } else {
      response.writeHead(200, {
        "content-type": "application/json",
        ...(payload.method === "initialize"
          ? { "mcp-session-id": "session-one" }
          : {}),
      });
      response.end(body);
    }
  });
  const endpoint = await listen(server);
  const budget = { bytes: 0, entries: 0, deadlineMs: Date.now() + 5_000 };
  const session = new PinnedMcpSession(
    endpoint,
    null,
    budget,
    localMcpPost,
  );
  try {
    await session.initialize({
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    await session.notify("notifications/initialized");
    assert.deepEqual(
      (await discoverMcpList(session, "tools/list", "tools", budget))
        .map((entry) => entry.name),
      ["first", "second"],
    );
    assert.equal(observed[0]?.protocolVersion, undefined);
    assert.deepEqual(
      observed.slice(1).map((entry) => entry.protocolVersion),
      ["2025-03-26", "2025-03-26", "2025-03-26"],
    );
    assert.deepEqual(
      observed.filter((entry) => entry.method === "tools/list")
        .map((entry) => entry.cursor),
      [undefined, "page-two"],
    );
    assert.equal(budget.entries, 2);
    assert.ok(budget.bytes > 0);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

test("pinned MCP initialization rejects malformed, unsupported, reflected, redirected, and timed-out responses", async () => {
  const token = "initialization-secret";
  const fixtures: Array<{
    name: string;
    result?: unknown;
    statusCode?: number;
    body?: Buffer;
    token?: string | null;
    expectedCode: string;
  }> = [
    {
      name: "malformed",
      result: { protocolVersion: "2025-03-26", capabilities: {} },
      expectedCode: "asset_mcp_response_invalid",
    },
    {
      name: "unsupported",
      result: {
        protocolVersion: "2099-01-01",
        capabilities: {},
        serverInfo: { name: "future", version: "1" },
      },
      expectedCode: "asset_mcp_response_invalid",
    },
    {
      name: "reflected",
      result: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: token, version: "1" },
      },
      token,
      expectedCode: "asset_mcp_secret_reflection",
    },
    {
      name: "redirected",
      statusCode: 302,
      body: Buffer.alloc(0),
      expectedCode: "asset_mcp_redirect_forbidden",
    },
  ];
  for (const fixture of fixtures) {
    const session = new PinnedMcpSession(
      new URL("https://203.0.113.10/mcp"),
      fixture.token ?? null,
      { bytes: 0, entries: 0, deadlineMs: Date.now() + 5_000 },
      async (_endpoint, body) => {
        const request = JSON.parse(body.toString("utf8")) as { id: number };
        return {
          statusCode: fixture.statusCode ?? 200,
          headers: { "content-type": "application/json" },
          body: fixture.body ?? Buffer.from(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: fixture.result,
          })),
        };
      },
    );
    await assert.rejects(
      session.initialize({
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === fixture.expectedCode
      ),
      fixture.name,
    );
  }

  const server = createServer(() => undefined);
  const endpoint = await listen(server);
  try {
    const timedOut = new PinnedMcpSession(
      endpoint,
      null,
      { bytes: 0, entries: 0, deadlineMs: Date.now() + 50 },
      localMcpPost,
    );
    await assert.rejects(
      timedOut.initialize({
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_mcp_timeout"
      ),
    );
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

test("pinned MCP aggregate budget stops whitespace-heavy pagination during download", async () => {
  const whitespace = " ".repeat(1_900_000);
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method: string;
    };
    if (payload.method === "initialize") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: { name: "budget", version: "1" },
        },
      }));
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(`${whitespace}${JSON.stringify({
      jsonrpc: "2.0",
      id: payload.id,
      result: { tools: [] },
    })}`);
  });
  const endpoint = await listen(server);
  const budget = { bytes: 0, entries: 0, deadlineMs: Date.now() + 10_000 };
  const session = new PinnedMcpSession(endpoint, null, budget, localMcpPost);
  try {
    await session.initialize({
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    for (let page = 0; page < 4; page += 1) {
      await session.request("tools/list", { cursor: String(page) });
    }
    await assert.rejects(
      session.request("tools/list", { cursor: "overflow" }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_mcp_discovery_limit"
      ),
    );
    assert.ok(budget.bytes <= 8 * 1024 * 1024);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

test("pinned MCP wall-clock deadline stops a response that continuously trickles bytes", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    const trickle = setInterval(() => response.write(" "), 10);
    response.once("close", () => clearInterval(trickle));
  });
  const endpoint = await listen(server);
  const startedAt = Date.now();
  try {
    const session = new PinnedMcpSession(
      endpoint,
      null,
      { bytes: 0, entries: 0, deadlineMs: startedAt + 100 },
      localMcpPost,
    );
    await assert.rejects(
      session.initialize({
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_mcp_timeout"
      ),
    );
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

test("workspace ZIP import requires authoritative Home or Room Thread mapping", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-thread-"));
  const packageBytes = zip([{
    path: "SKILL.md",
    contents: "---\nname: Thread Skill\ndescription: Test\n---\n",
  }]);
  const homeRoot = join(workdir, "members", "member-1", "workspace");
  const roomRoot = homeRoot;
  await Promise.all([
    mkdir(homeRoot, { recursive: true }),
    mkdir(roomRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(homeRoot, "home.zip"), packageBytes),
    writeFile(join(roomRoot, "room.zip"), packageBytes),
    writeFile(join(workdir, "outside.zip"), packageBytes),
  ]);
  const baseInput = {
    draft_id: "draft-thread",
    expected_content_sha256: null,
    kind: "skill" as const,
    member_id: "member-1",
    thread_id: "thread-1",
    workspace_relative_path: "home.zip",
  };
  try {
    await assert.rejects(
      new CompanyAssetStore(workdir).importWorkspaceZip(baseInput),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_thread_workspace_unavailable"
      ),
    );

    const home = new CompanyAssetStore(workdir, {
      threadWorkspaceResolver: {
        resolve: async () => ({
          scope: "home",
          member_id: "member-1",
          thread_id: "thread-1",
          root: homeRoot,
        }),
      },
    });
    const homeOperation = {
      ...baseInput,
      operation_id: "workspace-home-operation",
      request_fingerprint: "7".repeat(64),
    };
    const importedHome = await home.importWorkspaceZip(homeOperation);
    assert.equal(importedHome.inferred_name, "Thread Skill");
    await rm(join(homeRoot, "home.zip"));
    assert.equal(
      (await home.importWorkspaceZip(homeOperation)).content_sha256,
      importedHome.content_sha256,
    );

    const room = new CompanyAssetStore(workdir, {
      threadWorkspaceResolver: {
        resolve: async () => ({
          scope: "room",
          member_id: "member-1",
          thread_id: "thread-1",
          room_id: "room-1",
          root: roomRoot,
        }),
      },
    });
    assert.equal((await room.importWorkspaceZip({
      ...baseInput,
      draft_id: "draft-room",
      workspace_relative_path: "room.zip",
    })).inferred_name, "Thread Skill");

    const conflict = new CompanyAssetStore(workdir, {
      threadWorkspaceResolver: {
        resolve: async () => ({
          scope: "home",
          member_id: "forged-member",
          thread_id: "thread-1",
          root: homeRoot,
        }),
      },
    });
    await assert.rejects(
      conflict.importWorkspaceZip({
        ...baseInput,
        draft_id: "draft-conflict",
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_thread_workspace_conflict"
      ),
    );
    await assert.rejects(
      home.importWorkspaceZip({
        ...baseInput,
        draft_id: "draft-traversal",
        workspace_relative_path: "../../../outside.zip",
      }),
      (error: unknown) => (
        error instanceof AssetStoreError
        && error.code === "asset_workspace_path_forbidden"
      ),
    );
    const outsideDirectory = join(workdir, "outside-directory");
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(join(outsideDirectory, "linked.zip"), packageBytes);
    await symlink(outsideDirectory, join(homeRoot, "linked-directory"));
    await symlink(join(outsideDirectory, "linked.zip"), join(homeRoot, "linked-file.zip"));
    for (const workspaceRelativePath of [
      "linked-directory/linked.zip",
      "linked-file.zip",
    ]) {
      await assert.rejects(
        home.importWorkspaceZip({
          ...baseInput,
          draft_id: `draft-${workspaceRelativePath}`,
          workspace_relative_path: workspaceRelativePath,
        }),
        (error: unknown) => (
          error instanceof AssetStoreError
          && error.code === "asset_workspace_path_invalid"
        ),
      );
    }
  } finally {
    await removeTestTree(workdir);
  }
});

function zip(entries: Array<{
  path: string;
  contents: string;
  externalAttributes?: number;
}>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const contents = Buffer.from(entry.contents);
    const checksum = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.externalAttributes ?? (0o100600 << 16)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + contents.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<URL> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local server did not bind");
  return new URL(`https://127.0.0.1:${address.port}/mcp`);
}

async function localMcpPost(
  endpoint: URL,
  body: Buffer,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const resolveOnce = (value: {
      statusCode: number;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolvePromise(value);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(error);
    };
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: endpoint.port,
      path: endpoint.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(body.byteLength),
        ...extraHeaders,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxResponseBytes) {
          request.destroy(new AssetStoreError(
            "asset_mcp_response_too_large",
            "MCP discovery response exceeded the safety limit.",
          ));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", rejectOnce);
      response.once("end", () => resolveOnce({
        statusCode: response.statusCode ?? 500,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    const deadline = setTimeout(() => request.destroy(new AssetStoreError(
      "asset_mcp_timeout",
      "MCP discovery exceeded its wall-clock timeout.",
    )), timeoutMs);
    deadline.unref();
    request.once("error", rejectOnce);
    request.end(body);
  });
}

async function* chunked(bytes: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
    yield bytes.subarray(offset, offset + 64 * 1024);
  }
}

async function removeTestTree(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await removeTestTree(join(root, entry.name));
    }
  }
  await rm(root, { recursive: true, force: true });
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
