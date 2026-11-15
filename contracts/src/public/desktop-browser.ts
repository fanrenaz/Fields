import { z } from "zod";

export const desktopBrowserStatusSchema = z.strictObject({
  enabled: z.boolean(),
  updated_at_ms: z.number().int().nonnegative().nullable(),
  proxy: z.strictObject({
    enabled: z.boolean(),
    protocol: z.enum(["http", "https", "socks5"]).nullable(),
    revision: z.number().int().nonnegative(),
  }),
});
export type DesktopBrowserStatus = z.infer<typeof desktopBrowserStatusSchema>;

export const desktopBrowserSetInputSchema = z.strictObject({
  enabled: z.boolean(),
});
export type DesktopBrowserSetInput = z.infer<typeof desktopBrowserSetInputSchema>;

export const desktopBrowserTunnelStartInputSchema = z.strictObject({
  client_nonce: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/u),
});
export type DesktopBrowserTunnelStartInput = z.infer<typeof desktopBrowserTunnelStartInputSchema>;

export const desktopBrowserTunnelStartResultSchema = z.strictObject({
  websocket_path: z.literal("/api/v1/desktop-browser/tunnel"),
  token: z.string().min(32).max(256),
  storage_partition: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/u),
  expires_at_ms: z.number().int().nonnegative(),
});
export type DesktopBrowserTunnelStartResult = z.infer<typeof desktopBrowserTunnelStartResultSchema>;
