import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";

import {
  homeFilesystemDownloadInputSchema,
  homeFilesystemUploadInputSchema,
} from "@fields/contracts/public/home";

import {
  downloadHomeFile,
  FilesystemTransferError,
  uploadHomeFile,
} from "../application/filesystem/transfer.js";
import { internalControlTokenMatches } from "./trpc/core.js";
import type { MemberRuntimeManager } from "../application/member-runtime/manager.js";

const homeUploadQuerySchema = homeFilesystemUploadInputSchema.extend({
  member_id: z.string().min(1),
});
const homeDownloadQuerySchema = homeFilesystemDownloadInputSchema.extend({
  member_id: z.string().min(1),
});

export function registerFilesystemTransferRoutes(
  app: FastifyInstance,
  input: { workdir: string; controlTokenFile: string; runtime?: MemberRuntimeManager },
): void {
  app.addContentTypeParser(
    "application/octet-stream",
    (_request, payload, done) => done(null, payload),
  );

  app.post("/internal/files/home/upload", async (request, reply) => {
    if (!(await authorize(request, reply, input.controlTokenFile))) return reply;
    const query = homeUploadQuerySchema.safeParse(request.query);
    if (!query.success) return invalidInput(reply);
    try {
      const entry = await uploadHomeFile({
        workdir: input.workdir,
        memberId: query.data.member_id,
        parentPath: query.data.parent_path,
        name: query.data.name,
        body: request.body as AsyncIterable<unknown>,
      });
      return reply.send(entry);
    } catch (error) {
      return transferFailure(reply, error);
    }
  });

  app.post("/internal/home/conversation-imports", async (request, reply) => {
    if (!(await authorize(request, reply, input.controlTokenFile))) return reply;
    const query = z.strictObject({
      member_id: z.string().min(1),
      name: z.string().min(1).max(255),
    }).safeParse(request.query);
    if (!query.success) return invalidInput(reply);
    if (!input.runtime) return reply.code(503).send({ error: "conversation_import_unavailable", retryable: true });
    try {
      const result = await input.runtime.createHomeConversationImport({
        memberId: query.data.member_id,
        name: query.data.name,
        body: request.body as AsyncIterable<unknown>,
      });
      return reply.code(202).send(result);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "conversation_import_failed";
      return reply.code(code === "conversation_import_too_large" ? 413 : 400).send({ error: code, retryable: false });
    }
  });

  app.get("/internal/files/home/download", async (request, reply) => {
    if (!(await authorize(request, reply, input.controlTokenFile))) return reply;
    const query = homeDownloadQuerySchema.safeParse(request.query);
    if (!query.success) return invalidInput(reply);
    try {
      const download = await downloadHomeFile({
        workdir: input.workdir,
        memberId: query.data.member_id,
        path: query.data.path,
      });
      return sendDownload(reply, download, query.data.disposition ?? "attachment");
    } catch (error) {
      return transferFailure(reply, error);
    }
  });

}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  controlTokenFile: string,
): Promise<boolean> {
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  if (await internalControlTokenMatches(authorization, controlTokenFile)) return true;
  reply.code(401).send({ error: "unauthorized", retryable: false });
  return false;
}

function sendDownload(
  reply: FastifyReply,
  download: { name: string; sizeBytes: number; stream: Readable },
  disposition: "attachment" | "inline",
): FastifyReply {
  reply.header("content-type", imageContentType(download.name) ?? "application/octet-stream");
  reply.header("content-length", String(download.sizeBytes));
  reply.header("content-disposition", contentDisposition(download.name, disposition));
  return reply.send(download.stream);
}

function invalidInput(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ error: "filesystem_transfer_input_invalid", retryable: false });
}

function transferFailure(reply: FastifyReply, error: unknown): FastifyReply {
  const failure = error instanceof FilesystemTransferError
    ? error
    : new FilesystemTransferError(
      "filesystem_transfer_failed",
      "Filesystem transfer failed.",
      500,
    );
  return reply.code(failure.statusCode).send({
    error: failure.code,
    retryable: failure.statusCode >= 500,
  });
}

function contentDisposition(name: string, disposition: "attachment" | "inline"): string {
  const ascii = name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function imageContentType(name: string): string | null {
  if (/\.jpe?g$/iu.test(name)) return "image/jpeg";
  if (/\.png$/iu.test(name)) return "image/png";
  if (/\.webp$/iu.test(name)) return "image/webp";
  return null;
}
