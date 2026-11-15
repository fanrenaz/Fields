import { initTRPC } from "@trpc/server";
import { SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import { TRPCError } from "@trpc/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { CompanyRuntimeTrpcContext } from "./context.js";
import {
  AssetStoreError,
  isRetryableAssetStoreError,
} from "../../application/assets/service.js";
import { CompanyProxyError } from "../../application/company-proxy/service.js";

const baseTrpc = initTRPC.context<CompanyRuntimeTrpcContext>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        asset_error: cause instanceof AssetStoreError
          ? {
            code: cause.code,
            retryable: isRetryableAssetStoreError(cause.code),
          }
          : null,
        proxy_error: cause instanceof CompanyProxyError
          ? { code: cause.code, retryable: cause.retryable }
          : null,
      },
    };
  },
});

const tracingMiddleware = baseTrpc.middleware(async ({ ctx, path, type, next }) => {
  const parentContext = ctx.traceparent
    ? propagation.extract(context.active(), { traceparent: ctx.traceparent }, traceparentGetter)
    : context.active();
  return context.with(parentContext, async () => {
    const span = trace.getTracer("fields.company-runtime.trpc").startSpan(`trpc.${type}`, {
      attributes: {
        "fields.procedure": path,
        "fields.operation_category": "runtime_call",
      },
    });
    try {
      const result = await context.with(trace.setSpan(context.active(), span), () => next());
      if (!result.ok) span.setStatus({ code: SpanStatusCode.ERROR });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
});

const traceparentGetter = {
  get(carrier: { traceparent: string }, key: string): string | undefined {
    return key === "traceparent" ? carrier.traceparent : undefined;
  },
  keys(): string[] {
    return ["traceparent"];
  },
};

export const t = {
  ...baseTrpc,
  procedure: baseTrpc.procedure.use(tracingMiddleware),
};

export const internalProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!(await internalControlTokenMatches(ctx.authorization, ctx.controlTokenFile))) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Internal control authentication is required." });
  }
  return next({ ctx });
});

export async function internalControlTokenMatches(authorization: string | undefined, tokenFile: string): Promise<boolean> {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (!supplied || supplied.length > 4096 || /[\r\n]/u.test(supplied)) return false;
  let expected: string;
  try {
    expected = (await readFile(tokenFile, "utf8")).trim();
  } catch {
    return false;
  }
  if (!expected || expected.length > 4096 || /[\r\n]/u.test(expected)) return false;
  const left = createHash("sha256").update(supplied).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
