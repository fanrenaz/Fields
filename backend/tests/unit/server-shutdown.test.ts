import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import test from "node:test";

import { Pool } from "pg";

import type { HumanInvitationAdmissionPolicyUseCase } from "../../src/application/actor/index.js";
import type { FieldsAuth } from "../../src/infrastructure/auth/better-auth/fields-auth.js";
import { runServer } from "../../src/index.js";

const invitationPolicy: HumanInvitationAdmissionPolicyUseCase = {
  async assertEmailSignUpAllowed() {},
  async previewInvitation() {
    return { company_name: "Fields" };
  },
  async assertInvitationCreationAllowed() {},
  async assertInvitationAcceptanceAllowed() {},
  async assertMappedOrganization() {},
};

test("runServer propagates shutdown cleanup failure and closes once across both signals", async () => {
  const cleanupError = new Error("database cleanup failed");
  const originalDatabaseUrl = process.env.FIELDS_BACKEND_DATABASE_URL;
  const originalPoolEnd = Pool.prototype.end;
  const originalSigintListeners = new Set(process.listeners("SIGINT"));
  const originalSigtermListeners = new Set(process.listeners("SIGTERM"));
  const port = await unusedPort();
  let cleanupCalls = 0;
  let runPromise: Promise<number> | null = null;
  let sigint: NodeJS.SignalsListener | null = null;

  process.env.FIELDS_BACKEND_DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit";
  Pool.prototype.end = (async () => {
    cleanupCalls += 1;
    throw cleanupError;
  });

  try {
    runPromise = runServer({
      host: "127.0.0.1",
      port,
      auth: {} as FieldsAuth,
      invitationPolicy,
      authBaseURL: "http://127.0.0.1:4102",
      authTrustedOrigins: ["http://127.0.0.1:3102"],
      clientOrigins: ["http://127.0.0.1:3102"],
    });

    sigint = addedSignalListener("SIGINT", originalSigintListeners);
    const sigterm = addedSignalListener("SIGTERM", originalSigtermListeners);
    await waitForListening(port);

    sigint("SIGINT");
    sigterm("SIGTERM");

    await assert.rejects(
      withTimeout(runPromise, 2_000),
      (error: unknown) => error === cleanupError,
    );
    assert.equal(cleanupCalls, 1);
    assert.equal(addedSignalListeners("SIGINT", originalSigintListeners).length, 0);
    assert.equal(addedSignalListeners("SIGTERM", originalSigtermListeners).length, 0);
  } finally {
    sigint?.("SIGINT");
    await runPromise?.catch(() => undefined);
    Pool.prototype.end = originalPoolEnd;
    if (originalDatabaseUrl === undefined) {
      delete process.env.FIELDS_BACKEND_DATABASE_URL;
    } else {
      process.env.FIELDS_BACKEND_DATABASE_URL = originalDatabaseUrl;
    }
  }
});

function addedSignalListener(
  signal: NodeJS.Signals,
  originalListeners: ReadonlySet<NodeJS.SignalsListener>,
): NodeJS.SignalsListener {
  const listeners = addedSignalListeners(signal, originalListeners);
  assert.equal(listeners.length, 1);
  return listeners[0];
}

function addedSignalListeners(
  signal: NodeJS.Signals,
  originalListeners: ReadonlySet<NodeJS.SignalsListener>,
): NodeJS.SignalsListener[] {
  return process.listeners(signal).filter((listener) => !originalListeners.has(listener));
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function waitForListening(port: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return;
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
  }
  throw new Error(`Backend did not listen on port ${port} before the deadline.`);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Operation did not settle within ${timeoutMs}ms.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
