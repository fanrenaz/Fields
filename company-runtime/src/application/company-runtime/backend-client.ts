import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type {
  BackendRuntimeRouter,
} from "@fields/contracts/internal/router/backend-runtime";

export type BackendRuntimeClient = ReturnType<typeof createBackendRuntimeClient>;
export type BackendRuntimeClientFactory = (
  apiUrl: string,
  options: { token: string },
) => BackendRuntimeClient;

export class BackendRuntimeClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackendRuntimeClientError";
    this.code = code;
  }
}

export function createBackendRuntimeClient(apiUrl: string, options: { token: string }) {
  return createTRPCProxyClient<BackendRuntimeRouter>({
    links: [
      httpBatchLink({
        url: backendRuntimeTrpcUrl(apiUrl),
        headers: () => ({ Authorization: `Bearer ${options.token}` }),
      }),
    ],
  });
}

export function backendRuntimeTrpcUrl(apiUrl: string): string {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/trpc")) return baseUrl;
  return `${baseUrl}/trpc`;
}

export function normalizeBackendRuntimeError(error: unknown): BackendRuntimeClientError {
  if (error instanceof BackendRuntimeClientError) return error;
  if (error instanceof TRPCClientError) {
    const data = isRecord(error.data) ? error.data : {};
    return new BackendRuntimeClientError(
      typeof data.code === "string" ? data.code : "backend_runtime_error",
      error.message,
    );
  }
  return new BackendRuntimeClientError(
    "backend_runtime_error",
    error instanceof Error ? error.message : "Backend runtime callback failed.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
