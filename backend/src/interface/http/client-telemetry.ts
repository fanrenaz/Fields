import type { IncomingHttpHeaders } from "node:http";

export const CLIENT_KIND_HEADER = "x-fields-client-kind";
export const CLIENT_VERSION_HEADER = "x-fields-client-version";
export const RUNTIME_RELEASE_HEADER = "x-fields-runtime-release";

export type ClientTelemetryContext = Readonly<{
  kind: "web" | "desktop" | "unknown";
  version: string | null;
  runtimeRelease: string | null;
}>;

const DESKTOP_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RUNTIME_RELEASE_PATTERN = /^[0-9a-f]{40}$/u;

export function clientTelemetryContext(
  headers: IncomingHttpHeaders,
  defaultKind: "web" | "unknown" = "unknown",
): ClientTelemetryContext {
  const kind = firstHeader(headers[CLIENT_KIND_HEADER]);
  const version = firstHeader(headers[CLIENT_VERSION_HEADER]);
  const runtimeRelease = firstHeader(headers[RUNTIME_RELEASE_HEADER]);
  if (kind === undefined && version === undefined && runtimeRelease === undefined) {
    return { kind: defaultKind, version: null, runtimeRelease: null };
  }
  if (
    kind === "desktop"
    && version !== undefined
    && DESKTOP_VERSION_PATTERN.test(version)
    && (runtimeRelease === undefined || RUNTIME_RELEASE_PATTERN.test(runtimeRelease))
  ) {
    return { kind: "desktop", version, runtimeRelease: runtimeRelease ?? null };
  }
  return { kind: "unknown", version: null, runtimeRelease: null };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
