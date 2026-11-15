import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";

import {
  homeFilesystemDownloadInputSchema,
  homeFilesystemEntrySchema,
  homeFilesystemUploadInputSchema,
  homeConversationImportSchema,
} from "@fields/contracts/public/home";
import type { ProductSession } from "@fields/contracts/public/company";

const FILESYSTEM_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const CONVERSATION_IMPORT_MAX_BYTES = 512 * 1024 * 1024;

type FilesystemTransferRuntime = {
  homeFilesystemUpload(
    companyId: string,
    memberId: string,
    input: { parent_path: string; name: string },
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Response>;
  homeFilesystemDownload(
    companyId: string,
    memberId: string,
    input: { path: string; disposition: "attachment" | "inline" },
    signal?: AbortSignal,
  ): Promise<Response>;
  homeConversationImportUpload?(
    companyId: string,
    memberId: string,
    name: string,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<Response>;
};

export function registerFilesystemTransferHttpApi(
  app: FastifyInstance,
  dependencies: {
    runtime: FilesystemTransferRuntime;
    resolveSession(request: FastifyRequest): Promise<ProductSession | null>;
  },
): void {
  app.addContentTypeParser(
    "application/octet-stream",
    (_request, payload, done) => done(null, payload),
  );

  app.post("/api/v1/files/home/upload", async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.resolveSession);
    if (!session) return reply;
    const input = homeFilesystemUploadInputSchema.safeParse(request.query);
    if (!input.success) return invalidInput(reply);
    if (declaredTooLarge(request)) return tooLarge(reply);
    const controller = abortOnDisconnect(request);
    try {
      const response = await dependencies.runtime.homeFilesystemUpload(
        session.company_id,
        session.actor_id,
        input.data,
        limitedBody(request.body as AsyncIterable<unknown>),
        controller.signal,
      );
      return relayUpload(reply, response, homeFilesystemEntrySchema);
    } catch (error) {
      return requestFailure(reply, error);
    }
  });

  app.post("/api/v1/home/conversation-imports", async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.resolveSession);
    if (!session) return reply;
    const query = importQuery(request.query);
    if (!query) return invalidInput(reply);
    if (!dependencies.runtime.homeConversationImportUpload) return reply.code(503).send({ error: "conversation_import_unavailable", retryable: true });
    if (declaredTooLarge(request, CONVERSATION_IMPORT_MAX_BYTES)) return tooLarge(reply, "conversation_import_too_large");
    const controller = abortOnDisconnect(request);
    try {
      const response = await dependencies.runtime.homeConversationImportUpload(
        session.company_id,
        session.actor_id,
        query.name,
        limitedBody(request.body as AsyncIterable<unknown>, CONVERSATION_IMPORT_MAX_BYTES, "conversation_import_too_large"),
        controller.signal,
      );
      return relayUpload(reply, response, homeConversationImportSchema);
    } catch (error) {
      return requestFailure(reply, error);
    }
  });

  app.get("/api/v1/files/home/download", async (request, reply) => {
    const session = await requireSession(request, reply, dependencies.resolveSession);
    if (!session) return reply;
    const input = homeFilesystemDownloadInputSchema.safeParse(request.query);
    if (!input.success) return invalidInput(reply);
    const controller = abortOnDisconnect(request);
    try {
      const response = await dependencies.runtime.homeFilesystemDownload(
        session.company_id,
        session.actor_id,
        { ...input.data, disposition: input.data.disposition ?? "attachment" },
        controller.signal,
      );
      return relayDownload(reply, response);
    } catch (error) {
      return requestFailure(reply, error);
    }
  });

}

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  resolve: (request: FastifyRequest) => Promise<ProductSession | null>,
): Promise<ProductSession | null> {
  const session = await resolve(request);
  if (!session) {
    reply.code(401).send({ error: "unauthorized", retryable: false });
    return null;
  }
  if (session.company_status !== "active") {
    reply.code(412).send({ error: "company_runtime_not_ready", retryable: true });
    return null;
  }
  return session;
}

async function relayUpload(
  reply: FastifyReply,
  response: Response,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
): Promise<FastifyReply> {
  if (!response.ok) return relayError(reply, response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    return reply.code(502).send({ error: "filesystem_runtime_response_invalid", retryable: true });
  }
  return reply.send(parsed.data);
}

async function relayDownload(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  if (!response.ok) return relayError(reply, response);
  if (!response.body) {
    return reply.code(502).send({ error: "filesystem_runtime_response_invalid", retryable: true });
  }
  for (const name of ["content-type", "content-length", "content-disposition"]) {
    const value = response.headers.get(name);
    if (value) reply.header(name, value);
  }
  return reply.send(Readable.fromWeb(response.body));
}

async function relayError(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  const body = await response.json().catch(() => ({
    error: "filesystem_runtime_unavailable",
    retryable: response.status >= 500,
  }));
  return reply.code(response.status).send(body);
}

function declaredTooLarge(request: FastifyRequest, limit = FILESYSTEM_UPLOAD_MAX_BYTES): boolean {
  const header = request.headers["content-length"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  const length = Number(value);
  return Number.isFinite(length) && length > limit;
}

async function* limitedBody(
  body: AsyncIterable<unknown>,
  limit = FILESYSTEM_UPLOAD_MAX_BYTES,
  errorCode = "filesystem_upload_too_large",
): AsyncGenerator<Uint8Array> {
  let bytes = 0;
  for await (const value of body) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    bytes += chunk.byteLength;
    if (bytes > limit) {
      throw new UploadTooLargeError(errorCode);
    }
    yield chunk;
  }
}

function abortOnDisconnect(request: FastifyRequest): AbortController {
  const controller = new AbortController();
  request.raw.once("aborted", () => controller.abort());
  return controller;
}

function invalidInput(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ error: "filesystem_transfer_input_invalid", retryable: false });
}

function tooLarge(reply: FastifyReply, code = "filesystem_upload_too_large"): FastifyReply {
  return reply.code(413).send({ error: code, retryable: false });
}

function importQuery(value: unknown): { name: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0 && name.length <= 255 ? { name } : null;
}

function requestFailure(reply: FastifyReply, error: unknown): FastifyReply {
  const tooLargeError = uploadTooLargeCause(error);
  if (tooLargeError) return tooLarge(reply, tooLargeError.code);
  if (error instanceof Error && error.name === "AbortError") return reply;
  return reply.code(503).send({ error: "filesystem_runtime_unavailable", retryable: true });
}

class UploadTooLargeError extends Error {
  constructor(readonly code: string) { super(code); }
}

function uploadTooLargeCause(error: unknown): UploadTooLargeError | null {
  let current = error;
  const visited = new Set<unknown>();
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof UploadTooLargeError) return current;
    visited.add(current);
    current = current.cause;
  }
  return null;
}
