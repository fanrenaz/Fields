export type DesktopRuntimeConfig = Readonly<{
  backendTrpcUrl?: string;
  desktopVersion?: string;
  homeTurnTimeoutMs?: string;
}>;

function envValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** The sole browser-facing boundary for Vite's compile-time environment. */
export function runtimeConfig(environment: Partial<ImportMetaEnv> | undefined = import.meta.env): DesktopRuntimeConfig {
  return {
    backendTrpcUrl: envValue(environment?.VITE_FIELDS_BACKEND_TRPC_URL),
    desktopVersion: envValue(environment?.VITE_FIELDS_DESKTOP_VERSION),
    homeTurnTimeoutMs: envValue(environment?.VITE_FIELDS_HOME_TURN_TIMEOUT_MS),
  };
}

export const desktopRuntimeConfig = runtimeConfig();
