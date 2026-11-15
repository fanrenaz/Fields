import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { registerFilesystemTransferHttpApi } from "../../../../src/interface/http/filesystem-transfer.js";

test("filesystem transfer HTTP API authenticates and streams Home uploads and downloads", async () => {
  const app = Fastify();
  let uploaded = Buffer.alloc(0);
  registerFilesystemTransferHttpApi(app, {
    resolveSession: async () => ({
      actor_id: "member-1",
      company_id: "company-1",
      display_name: "Member",
      actor_type: "human",
      company_role: "member",
      company_status: "active",
    }),
    runtime: {
      homeFilesystemUpload: async (_companyId, _memberId, _input, body) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        uploaded = Buffer.concat(chunks);
        return Response.json({
          id: "folder/data.bin",
          path: "folder/data.bin",
          name: "data.bin",
          is_folder: false,
          size_bytes: uploaded.byteLength,
          modified_at_ms: 1,
        });
      },
      homeFilesystemDownload: async () => new Response(Buffer.from([0, 255, 1]), {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "3",
          "content-disposition": "attachment; filename=\"data.bin\"",
        },
      }),
      homeConversationImportUpload: async (companyId, memberId, name, body) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        assert.equal(companyId, "company-1");
        assert.equal(memberId, "member-1");
        assert.equal(name, "conversations.json");
        assert.equal(Buffer.concat(chunks).toString("utf8"), "[]");
        return Response.json({
          import_id: "import-1",
          status: "queued",
          total_conversations: 0,
          processed_conversations: 0,
          skipped_conversations: 0,
          created_threads: 0,
          error_code: null,
          created_at_ms: 1,
          completed_at_ms: null,
        }, { status: 202 });
      },
    },
  });
  try {
    const uploadBytes = Buffer.alloc(2 * 1024 * 1024, 7);
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/files/home/upload?parent_path=folder&name=data.bin",
      headers: { "content-type": "application/octet-stream" },
      payload: uploadBytes,
    });
    assert.equal(upload.statusCode, 200);
    assert.deepEqual(uploaded, uploadBytes);
    assert.equal(upload.json().path, "folder/data.bin");

    const download = await app.inject({
      method: "GET",
      url: "/api/v1/files/home/download?path=folder%2Fdata.bin",
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-disposition"], "attachment; filename=\"data.bin\"");
    assert.deepEqual(download.rawPayload, Buffer.from([0, 255, 1]));

    const conversationImport = await app.inject({
      method: "POST",
      url: "/api/v1/home/conversation-imports?name=conversations.json",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("[]"),
    });
    assert.equal(conversationImport.statusCode, 200);
    assert.equal(conversationImport.json().import_id, "import-1");
  } finally {
    await app.close();
  }
});

test("filesystem transfer HTTP API no longer exposes Room filesystem routes", async () => {
  const app = Fastify();
  registerFilesystemTransferHttpApi(app, {
    resolveSession: async () => ({
      actor_id: "member-1",
      company_id: "company-1",
      display_name: "Member",
      actor_type: "human",
      company_role: "member",
      company_status: "active",
    }),
    runtime: {
      homeFilesystemUpload: async () => {
        throw new Error("not used");
      },
      homeFilesystemDownload: async () => {
        throw new Error("not used");
      },
    },
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/files/room/download?room_id=room-1&path=data.bin",
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
