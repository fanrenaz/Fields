import type { ProductSession } from "@fields/contracts/public/company";
import { assetPackageUploadResultSchema } from "@fields/contracts/public/asset";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";

import type { CompanyAssetApplication } from "../../application/company/ports/company-assets.js";
import { isApplicationError } from "../../application/platform/errors.js";
import {
  ASSET_ZIP_MAX_BYTES,
  AssetPackageTooLargeError,
  spoolAssetPackage,
  type SpooledPackage,
} from "./asset-package-spool.js";

export function registerAssetPackageHttpApi(
  app: FastifyInstance,
  dependencies: {
    assets: CompanyAssetApplication;
    resolveSession(request: FastifyRequest): Promise<ProductSession | null>;
    temporaryRoot?: string;
  },
): void {
  app.post<{ Params: { draft_id: string } }>(
    "/api/v1/assets/drafts/:draft_id/package",
    async (request, reply) => {
      const session = await dependencies.resolveSession(request);
      if (!session) {
        return reply.code(401).send({ error: "unauthorized", retryable: false });
      }
      if (session.company_status !== "active") {
        return reply.code(412).send({
          error: "company_runtime_not_ready",
          retryable: true,
        });
      }
      if (declaredTooLarge(request)) return tooLarge(reply);
      let expectedRevision: number;
      let idempotencyKey: string;
      try {
        expectedRevision = requiredPositiveIntegerHeader(
          request,
          "x-fields-expected-revision",
        );
        idempotencyKey = requiredHeader(request, "x-fields-idempotency-key");
      } catch (error) {
        return reply.code(400).send({
          error: publicAssetPackageError(error),
          retryable: false,
        });
      }
      const connection = abortOnDisconnect(request, reply);
      let packageFile: SpooledPackage | null = null;
      let statusCode = 200;
      let responseBody: unknown;
      try {
        packageFile = await spoolAssetPackage(
          request.body as AsyncIterable<unknown>,
          dependencies.temporaryRoot,
        );
        const result = await dependencies.assets.uploadPackage(
          session.company_id,
          session.actor_id,
          {
            draft_id: request.params.draft_id,
            expected_revision: expectedRevision,
            idempotency_key: idempotencyKey,
            package_sha256: packageFile.sha256,
            package_size_bytes: packageFile.sizeBytes,
            package_body: createReadStream(packageFile.path),
            signal: connection.signal,
          },
        );
        responseBody = assetPackageUploadResultSchema.parse(result);
      } catch (error) {
        if (error instanceof AssetPackageTooLargeError) {
          statusCode = 413;
          responseBody = {
            error: "asset_package_too_large",
            retryable: false,
          };
        } else if (isApplicationError(error)) {
          statusCode = error.retryable ? 503 : 409;
          responseBody = {
            error: error.code,
            retryable: error.retryable,
          };
        } else if (
          error instanceof Error
          && (
            error.message === "asset_package_empty"
            || error.message === "asset_package_header_invalid"
          )
        ) {
          statusCode = 400;
          responseBody = {
            error: publicAssetPackageError(error),
            retryable: false,
          };
        } else {
          statusCode = 503;
          responseBody = {
            error: "asset_package_unavailable",
            retryable: true,
          };
        }
      } finally {
        connection.dispose();
        if (packageFile) {
          await rm(packageFile.directory, { recursive: true, force: true });
        }
      }
      return reply.code(statusCode).send(responseBody);
    },
  );
}

function requiredHeader(request: FastifyRequest, name: string): string {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new Error("asset_package_header_invalid");
  }
  return value;
}

function requiredPositiveIntegerHeader(request: FastifyRequest, name: string): number {
  const value = Number(requiredHeader(request, name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("asset_package_header_invalid");
  }
  return value;
}

export function abortOnDisconnect(
  request: FastifyRequest,
  reply: FastifyReply,
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const abortIncompleteReply = (): void => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", abortIncompleteReply);
  return {
    signal: controller.signal,
    dispose() {
      request.raw.off("aborted", abort);
      reply.raw.off("close", abortIncompleteReply);
    },
  };
}

function declaredTooLarge(request: FastifyRequest): boolean {
  const header = request.headers["content-length"];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && Number(value) > ASSET_ZIP_MAX_BYTES;
}

function tooLarge(reply: FastifyReply): FastifyReply {
  return reply.code(413).send({
    error: "asset_package_too_large",
    retryable: false,
  });
}

function publicAssetPackageError(error: unknown): string {
  if (
    error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && error.code.startsWith("ASSET_")
  ) {
    return error.code;
  }
  return "asset_package_invalid";
}
