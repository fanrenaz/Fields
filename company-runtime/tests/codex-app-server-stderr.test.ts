import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { ProcessCodexAppServerTransport } from "../src/application/adapter/codex-app-server-client.js";

test("Company Runtime transport never forwards Codex stderr to the parent process", async () => {
  const marker = "CODEX_PROVIDER_DIAGNOSTIC_MUST_NOT_ESCAPE";
  const originalWrite = process.stderr.write;
  const writes: string[] = [];
  process.stderr.write = ((chunk: unknown, ..._rest: unknown[]) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  const transport = new ProcessCodexAppServerTransport([
    process.execPath,
    "-e",
    `process.stderr.write(${JSON.stringify(marker)}); setTimeout(() => process.exit(0), 25);`,
  ], { workdir: process.cwd() });
  try {
    await delay(80);
  } finally {
    await transport.close();
    process.stderr.write = originalWrite;
  }
  assert.equal(writes.some((value) => value.includes(marker)), false);
});
