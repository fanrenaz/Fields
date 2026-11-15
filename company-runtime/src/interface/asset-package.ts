import { runtimeAssetZipPackageInputSchema } from "@fields/contracts/internal/asset";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ASSET_ZIP_MAX_COMPRESSED_BYTES,
  AssetStoreError,
  isRetryableAssetStoreError,
  type CompanyAssetStore,
} from "../application/assets/service.js";
import { internalControlTokenMatches } from "./trpc/core.js";

export function registerAssetPackageRoutes(
  app: FastifyInstance,
  input: {
    assetStore: CompanyAssetStore;
    controlTokenFile: string;
  },
): void {
  app.post("/internal/assets/drafts/package", async (request, reply) => {
    if (!(await authorize(request, reply, input.controlTokenFile))) return reply;
    if (declaredTooLarge(request)) return tooLarge(reply);
    const query = queryInput(request.query);
    const parsed = runtimeAssetZipPackageInputSchema.safeParse(query);
    if (!parsed.success) return invalidInput(reply);
    try {
      return reply.send(await input.assetStore.importZipStream(
        parsed.data,
        request.body as AsyncIterable<unknown>,
      ));
    } catch (error) {
      return assetFailure(reply, error);
    }
  });
}

function queryInput(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  return {
    ...input,
    expected_content_sha256: input.expected_content_sha256 === ""
      ? null
      : input.expected_content_sha256,
    package_size_bytes: Number(input.package_size_bytes),
  };
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

function declaredTooLarge(request: FastifyRequest): boolean {
  const raw = request.headers["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && Number(value) > ASSET_ZIP_MAX_COMPRESSED_BYTES;
}

function invalidInput(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({
    error: "asset_package_input_invalid",
    retryable: false,
  });
}

function tooLarge(reply: FastifyReply): FastifyReply {
  return reply.code(413).send({
    error: "asset_zip_size_invalid",
    retryable: false,
  });
}

function assetFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (!(error instanceof AssetStoreError)) {
    return reply.code(500).send({
      error: "asset_package_store_failed",
      retryable: true,
    });
  }
  const retryable = isRetryableAssetStoreError(error.code);
  const statusCode = error.code === "asset_zip_size_invalid"
    ? 413
    : retryable
      ? 503
      : error.code === "asset_operation_conflict"
      || error.code === "asset_reference_conflict"
        ? 409
        : 400;
  return reply.code(statusCode).send({
    error: error.code,
    retryable,
  });
}
