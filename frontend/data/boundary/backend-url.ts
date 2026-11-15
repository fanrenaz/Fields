import { desktopRuntimeConfig } from "../../shared/config/runtime";

const BACKEND_TRPC_PATH = "/api/v1/trpc";
const FALLBACK_BACKEND_ORIGIN = "http://127.0.0.1:4102";

export function backendTrpcHttpUrl(configuredUrl = desktopRuntimeConfig.backendTrpcUrl): string {
  const url = backendUrl(configuredUrl);
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported backend tRPC URL protocol: ${url.protocol}`);
  }
  return url.toString();
}

export function backendTrpcWsUrl(configuredUrl = desktopRuntimeConfig.backendTrpcUrl): string {
  const url = new URL(backendTrpcHttpUrl(configuredUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function backendAuthBaseUrl(configuredUrl = desktopRuntimeConfig.backendTrpcUrl): string {
  return new URL(backendTrpcHttpUrl(configuredUrl)).origin;
}

/** Same Backend origin as tRPC, for public REST routes with their own contracts. */
export function backendApiUrl(pathname: string, configuredUrl = desktopRuntimeConfig.backendTrpcUrl): string {
  if (!pathname.startsWith("/api/")) {
    throw new Error(`Backend API pathname must begin with /api/: ${pathname}`);
  }
  const url = new URL(backendTrpcHttpUrl(configuredUrl));
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function backendUrl(configuredUrl: string | undefined): URL {
  const trimmedUrl = configuredUrl?.trim();
  const url = new URL(
    trimmedUrl && trimmedUrl.length > 0 ? trimmedUrl : BACKEND_TRPC_PATH,
    runtimeOrigin(),
  );
  url.pathname = trpcPathname(url.pathname);
  url.search = "";
  url.hash = "";
  return url;
}

function trpcPathname(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/$/, "");
  if (normalizedPathname.endsWith(BACKEND_TRPC_PATH)) {
    return normalizedPathname;
  }
  if (normalizedPathname.endsWith("/api/v1")) {
    return `${normalizedPathname}/trpc`;
  }
  return `${normalizedPathname}${BACKEND_TRPC_PATH}`;
}

function runtimeOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return FALLBACK_BACKEND_ORIGIN;
}
