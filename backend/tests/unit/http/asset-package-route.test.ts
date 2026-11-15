import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Fastify, { type FastifyRequest } from "fastify";

import type { CompanyAssetApplication } from "../../../src/application/company/ports/company-assets.js";
import { ApplicationError } from "../../../src/application/platform/errors.js";
import {
  abortOnDisconnect,
  registerAssetPackageHttpApi,
} from "../../../src/interface/http/asset-package.js";
import { registerFilesystemTransferHttpApi } from "../../../src/interface/http/filesystem-transfer.js";

const session = {
  actor_id: "member-one",
  company_id: "company-one",
  display_name: "Member",
  actor_type: "human",
  company_role: "member",
  company_status: "active",
} as const;

const draft = {
  draft_id: "draft-one",
  asset_id: "asset-one",
  kind: "skill",
  name: "Research helper",
  slug: "research-helper",
  description: "",
  version: "1.0.0",
  revision: 2,
  source: { type: "zip", file_name: "skill.zip" },
  content_sha256: "a".repeat(64),
  files: [],
  validation: {
    status: "pending",
    validated_at_ms: null,
    validator: null,
    issues: [],
    capabilities: { entries: [], credential_configured: false },
  },
  created_by_actor_id: "member-one",
  updated_by_actor_id: "member-one",
  created_at_ms: 1,
  updated_at_ms: 2,
} as const;

test("asset package HTTP production registration authenticates, validates headers, streams limits, and cleans spool files", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fields-asset-route-"));
  const app = Fastify({ logger: false });
  let authenticated = true;
  let uploadError: Error | null = null;
  let uploadedBytes = 0;
  const assets = {
    uploadPackage: async (
      _companyId: string,
      _actorId: string,
      input: Parameters<CompanyAssetApplication["uploadPackage"]>[2],
    ) => {
      if (uploadError) throw uploadError;
      uploadedBytes = 0;
      for await (const chunk of input.package_body) {
        uploadedBytes += chunk.byteLength;
      }
      assert.equal(input.signal instanceof AbortSignal, true);
      return { draft };
    },
  } as unknown as CompanyAssetApplication;
  registerFilesystemTransferHttpApi(app, {
    resolveSession: async () => session,
    runtime: {
      homeFilesystemUpload: async () => { throw new Error("not used"); },
      homeFilesystemDownload: async () => { throw new Error("not used"); },
    },
  });
  registerAssetPackageHttpApi(app, {
    assets,
    resolveSession: async () => authenticated ? session : null,
    temporaryRoot,
  });
  const send = (payload: Buffer, headers: Record<string, string> = {}) => app.inject({
    method: "POST",
    url: "/api/v1/assets/drafts/draft-one/package",
    headers: {
      "content-type": "application/octet-stream",
      "x-fields-expected-revision": "1",
      "x-fields-idempotency-key": "upload-one",
      ...headers,
    },
    payload,
  });
  try {
    authenticated = false;
    assert.equal((await send(Buffer.from("unauthorized"))).statusCode, 401);
    authenticated = true;

    const missingHeaders = await app.inject({
      method: "POST",
      url: "/api/v1/assets/drafts/draft-one/package",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("missing"),
    });
    assert.equal(missingHeaders.statusCode, 400);
    assert.equal(missingHeaders.json().retryable, false);
    assert.equal((await send(Buffer.from("invalid"), {
      "x-fields-expected-revision": "0",
    })).statusCode, 400);

    const multiMegabyte = Buffer.alloc(2 * 1024 * 1024, 7);
    assert.equal((await send(multiMegabyte)).statusCode, 200);
    assert.equal(uploadedBytes, multiMegabyte.byteLength);
    assert.deepEqual(await readdir(temporaryRoot), []);

    const boundary = Buffer.alloc(25 * 1024 * 1024);
    assert.equal((await send(boundary, {
      "x-fields-idempotency-key": "upload-boundary",
    })).statusCode, 200);
    assert.equal(uploadedBytes, boundary.byteLength);
    assert.deepEqual(await readdir(temporaryRoot), []);

    assert.equal((await send(Buffer.alloc(25 * 1024 * 1024 + 1), {
      "x-fields-idempotency-key": "upload-over-limit",
    })).statusCode, 413);
    assert.deepEqual(await readdir(temporaryRoot), []);

    uploadError = new ApplicationError("ASSET_RUNTIME_BUSY", true);
    const retryable = await send(Buffer.from("retry"), {
      "x-fields-idempotency-key": "upload-retry",
    });
    assert.equal(retryable.statusCode, 503);
    assert.deepEqual(retryable.json(), {
      error: "ASSET_RUNTIME_BUSY",
      retryable: true,
    });
    assert.deepEqual(await readdir(temporaryRoot), []);

    uploadError = new Error("database connection lost");
    const unknown = await send(Buffer.from("unknown"), {
      "x-fields-idempotency-key": "upload-unknown",
    });
    assert.equal(unknown.statusCode, 503);
    assert.deepEqual(unknown.json(), {
      error: "asset_package_unavailable",
      retryable: true,
    });
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await app.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("asset package disconnect controller covers upload aborts and incomplete reply closes", () => {
  const requestRaw = new EventEmitter();
  const replyRaw = Object.assign(new EventEmitter(), { writableEnded: false });
  const connection = abortOnDisconnect(
    { raw: requestRaw } as unknown as FastifyRequest,
    { raw: replyRaw } as never,
  );
  assert.equal(connection.signal.aborted, false);
  replyRaw.emit("close");
  assert.equal(connection.signal.aborted, true);
  connection.dispose();
  assert.equal(requestRaw.listenerCount("aborted"), 0);
  assert.equal(replyRaw.listenerCount("close"), 0);

  const completedRequest = new EventEmitter();
  const completedReply = Object.assign(new EventEmitter(), { writableEnded: true });
  const completed = abortOnDisconnect(
    { raw: completedRequest } as unknown as FastifyRequest,
    { raw: completedReply } as never,
  );
  completedReply.emit("close");
  assert.equal(completed.signal.aborted, false);
  completedRequest.emit("aborted");
  assert.equal(completed.signal.aborted, true);
  completed.dispose();
});
