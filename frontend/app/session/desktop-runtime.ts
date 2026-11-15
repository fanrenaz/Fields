export type DesktopRuntimeInfo = {
  version: string;
};

export function desktopRuntimeInfo(
  version = desktopRuntimeConfig.desktopVersion,
): DesktopRuntimeInfo {
  const normalizedVersion = version?.trim();
  return { version: normalizedVersion && normalizedVersion.length > 0 ? normalizedVersion : "dev" };
}

export function isDesktopConnectionFailure(message: unknown, online: boolean): boolean {
  if (!online) return true;
  return typeof message === "object"
    && message !== null
    && "key" in message
    && (message as { key?: unknown }).key === "auth.authenticationUnavailable";
}

export function desktopConnectionMessageKey(online: boolean):
  | "auth.desktopBackendUnavailable"
  | "auth.desktopOffline" {
  return online ? "auth.desktopBackendUnavailable" : "auth.desktopOffline";
}
import { desktopRuntimeConfig } from "../../shared/config/runtime";
