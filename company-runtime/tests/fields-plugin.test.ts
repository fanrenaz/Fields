import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FIELDS_CORE_MCP_SERVER_NAMES,
  defaultFieldsPluginTemplatePath,
  materializeFieldsPluginMarketplace,
  verifyMaterializedFieldsPluginMarketplace,
} from "../src/application/codex/fields-plugin.js";

test("Fields Core Plugin marketplace materialization is atomic, complete, and identity-free", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-plugin-marketplace-"));
  try {
    const first = await materializeFieldsPluginMarketplace(workdir, {
      runtimeUrl: "http://127.0.0.1:4110/",
    });
    const firstLink = await readlink(join(first.root, "current"));
    const second = await materializeFieldsPluginMarketplace(workdir, {
      runtimeUrl: "https://runtime.example.test",
    });
    const secondLink = await readlink(join(second.root, "current"));

    assert.equal(first.pluginId, "fields-core@fields");
    assert.equal(second.version, "1.0.10");
    assert.notEqual(firstLink, secondLink);
    assert.equal((await readdir(join(second.root, "releases"))).length, 1);

    const manifest = JSON.parse(await readFile(
      join(second.pluginRoot, ".codex-plugin", "plugin.json"),
      "utf8",
    )) as Record<string, unknown>;
    const marketplace = JSON.parse(await readFile(second.marketplacePath, "utf8")) as {
      name: string;
      plugins: Array<{ name: string; source: { source: string; path: string } }>;
    };
    const mcpSource = await readFile(join(second.pluginRoot, ".mcp.json"), "utf8");
    const mcp = JSON.parse(mcpSource) as {
      mcpServers: Record<string, {
        url: string;
        enabled?: boolean;
        env_http_headers: Record<string, string>;
        bearer_token_env_var?: string;
        http_headers?: Record<string, string>;
      }>;
    };

    assert.equal(manifest.name, "fields-core");
    assert.equal(manifest.version, second.version);
    assert.equal(manifest.mcpServers, "./.mcp.json");
    assert.equal(marketplace.name, "fields");
    assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ["fields-core"]);
    assert.deepEqual(Object.keys(mcp.mcpServers).sort(), [...FIELDS_CORE_MCP_SERVER_NAMES].sort());
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      assert.equal(
        server.url,
        `https://runtime.example.test/mcp/${
          name === "fields_room_messages"
            ? "room-messages"
            : name.replace("fields_", "")
        }`,
      );
      assert.deepEqual(server.env_http_headers, {
        "X-Fields-Member-Id": "FIELDS_MCP_MEMBER_ID",
      });
      assert.equal(
        server.bearer_token_env_var,
        name === "fields_mail" ? "FIELDS_MAIL_MCP_TOKEN" : undefined,
      );
      assert.equal(server.http_headers, undefined);
    }
    assert.equal(mcp.mcpServers.fields_room_messages.enabled, false);
    assert.equal(mcp.mcpServers.fields_embodiment.enabled, undefined);
    assert.equal(mcp.mcpServers.fields_search.enabled, undefined);
    assert.equal(mcp.mcpServers.fields_assets.enabled, undefined);
    assert.equal(mcp.mcpServers.fields_mail.enabled, undefined);
    assert.doesNotMatch(mcpSource, /\{\{FIELDS_COMPANY_RUNTIME_URL\}\}/u);
    assert.doesNotMatch(mcpSource, /room[_-]?id\s*["':=]/iu);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Fields Core Plugin materialization rejects credential-bearing runtime URLs", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-plugin-url-"));
  try {
    await assert.rejects(
      materializeFieldsPluginMarketplace(workdir, {
        runtimeUrl: "https://user:secret@runtime.example.test",
        templatePath: defaultFieldsPluginTemplatePath(),
      }),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "fields_plugin_runtime_url_invalid"
      ),
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("materialized Fields Core Plugin verification rejects MCP defaults and unsupported capability drift", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-plugin-health-"));
  const runtimeUrl = "https://runtime.example.test";
  try {
    const first = await materializeFieldsPluginMarketplace(workdir, { runtimeUrl });
    const mcpPath = join(first.pluginRoot, ".mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    mcp.mcpServers.fields_room_messages!.enabled = true;
    await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`, "utf8");

    await assert.rejects(
      verifyMaterializedFieldsPluginMarketplace(first, { runtimeUrl }),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "fields_plugin_template_invalid"
      ),
    );

    const second = await materializeFieldsPluginMarketplace(workdir, { runtimeUrl });
    const manifestPath = join(second.pluginRoot, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.skills = "./skills";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      verifyMaterializedFieldsPluginMarketplace(second, { runtimeUrl }),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "fields_plugin_template_invalid"
      ),
    );

    const third = await materializeFieldsPluginMarketplace(workdir, { runtimeUrl });
    await mkdir(join(third.pluginRoot, "skills"));
    await assert.rejects(
      verifyMaterializedFieldsPluginMarketplace(third, { runtimeUrl }),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "fields_plugin_template_invalid"
      ),
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
