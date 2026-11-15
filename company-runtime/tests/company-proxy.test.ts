import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CompanyProxyError,
  CompanyProxyService,
} from "../src/application/company-proxy/service.js";

test("Company proxy persists Runtime-owned credentials and exposes only a safe status", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-proxy-"));
  const transitions: string[] = [];
  try {
    const proxy = new CompanyProxyService(workdir, {
      prepare: async () => { transitions.push("prepare"); },
      activate: async () => { transitions.push("activate"); },
      rollback: async () => { transitions.push("rollback"); },
      stopExecutorAppServers: async () => { transitions.push("stop-executors"); },
      closeBrowserTunnels: async () => { transitions.push("close-browser-tunnels"); },
      hasPendingAuthorization: () => false,
      probe: async () => { transitions.push("probe"); },
      nowMs: () => 1234,
    });
    await proxy.initialize();

    const status = await proxy.set({
      protocol: "socks5",
      endpoint_host: "proxy.internal",
      endpoint_port: 1080,
      credentials: { username: "codex-user", password: "secret-password" },
      expected_revision: 0,
    });

    assert.deepEqual(transitions, [
      "probe",
      "prepare",
      "stop-executors",
      "close-browser-tunnels",
      "activate",
    ]);
    assert.deepEqual(status, {
      enabled: true,
      protocol: "socks5",
      endpoint_host: "proxy.internal",
      endpoint_port: 1080,
      authentication: "username_password",
      revision: 1,
      updated_at_ms: 1234,
    });
    assert.equal(JSON.stringify(status).includes("secret-password"), false);
    assert.equal(proxy.environment().ALL_PROXY, "socks5h://codex-user:secret-password@proxy.internal:1080");
    assert.equal(proxy.environment().NO_PROXY, "localhost,127.0.0.1,::1");
    const path = join(workdir, "company", "proxy.json");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, "utf8")).includes("secret-password"), true);

    const restored = new CompanyProxyService(workdir, {
      prepare: async () => undefined,
      activate: async () => undefined,
      rollback: async () => undefined,
      stopExecutorAppServers: async () => undefined,
      hasPendingAuthorization: () => false,
    });
    await restored.initialize();
    assert.equal(restored.status().revision, 1);
    assert.equal(restored.status().authentication, "username_password");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company proxy restores its prior configuration when activation fails", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-proxy-rollback-"));
  let failActivation = false;
  let rollbacks = 0;
  try {
    const proxy = new CompanyProxyService(workdir, {
      prepare: async () => undefined,
      activate: async () => {
        if (failActivation) throw new Error("restart failed");
      },
      rollback: async () => { rollbacks += 1; },
      stopExecutorAppServers: async () => undefined,
      hasPendingAuthorization: () => false,
      probe: async () => undefined,
    });
    await proxy.initialize();
    await proxy.set({
      protocol: "http",
      endpoint_host: "old.proxy",
      endpoint_port: 8080,
      credentials: null,
      expected_revision: 0,
    });
    failActivation = true;

    await assert.rejects(
      proxy.set({
        protocol: "https",
        endpoint_host: "new.proxy",
        endpoint_port: 8443,
        credentials: null,
        expected_revision: 1,
      }),
      (error: unknown) => error instanceof CompanyProxyError
        && error.code === "company_proxy_reconfigure_failed",
    );
    assert.equal(rollbacks, 1);
    assert.equal(proxy.status().endpoint_host, "old.proxy");
    assert.equal(proxy.status().revision, 1);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
