import { z } from "zod";

const opaqueIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/u);
const spanIdSchema = z.string().regex(/^[0-9a-f]{16}$/u);

/**
 * Browser-to-Backend telemetry is deliberately provider-neutral and narrow.
 * It contains only pre-classified operation metadata; it cannot carry text,
 * URLs, exception detail, cookies, credentials, or arbitrary attributes.
 */
export const browserTelemetryEventNameSchema = z.enum([
  "browser.document_load",
  "browser.fetch",
  "browser.xhr",
  "browser.web_vital",
  "browser.error",
  "browser.unhandled_rejection",
  "browser.react_error",
]);
export type BrowserTelemetryEventName = z.infer<typeof browserTelemetryEventNameSchema>;

export const browserTelemetryErrorClassSchema = z.enum([
  "react_render",
  "first_party_script",
  "browser_extension",
  "external_script",
  "resource_load",
  "unhandled_promise",
  "executor_onboarding_executor_list",
  "executor_onboarding_assignment",
  "executor_onboarding_progress",
  "executor_access_assignment",
  "executor_access_options",
  "executor_access_binding",
  "company_file_preview_html",
  "company_file_preview_image",
  "company_file_preview_office",
  "company_file_preview_pdf",
  "company_file_preview_text",
  "company_file_preview_video",
  "unknown",
]);
export type BrowserTelemetryErrorClass = z.infer<typeof browserTelemetryErrorClassSchema>;

export const browserTelemetryRouteSchema = z.enum([
  "app",
  "auth",
  "trpc",
  "embodiment",
  "external",
]);
export type BrowserTelemetryRoute = z.infer<typeof browserTelemetryRouteSchema>;

export const browserTelemetryStatusSchema = z.enum(["unset", "ok", "error"]);
export type BrowserTelemetryStatus = z.infer<typeof browserTelemetryStatusSchema>;

export const browserTelemetryRecordSchema = z.strictObject({
  trace_id: traceIdSchema,
  span_id: spanIdSchema,
  parent_span_id: spanIdSchema.nullable(),
  name: browserTelemetryEventNameSchema,
  occurred_at_ms: z.number().int().nonnegative(),
  duration_ms: z.number().finite().nonnegative().max(900_000),
  status: browserTelemetryStatusSchema,
  error_class: browserTelemetryErrorClassSchema.nullable(),
  route: browserTelemetryRouteSchema,
  company_id: opaqueIdSchema.nullable(),
  room_id: opaqueIdSchema.nullable(),
  actor_id: opaqueIdSchema.nullable(),
  sandbox_id: opaqueIdSchema.nullable(),
  thread_id: opaqueIdSchema.nullable(),
  turn_id: opaqueIdSchema.nullable(),
  operation_id: opaqueIdSchema.nullable(),
});
export type BrowserTelemetryRecord = z.infer<typeof browserTelemetryRecordSchema>;

export const browserTelemetryBatchSchema = z.strictObject({
  records: z.array(browserTelemetryRecordSchema).min(1).max(64),
});
export type BrowserTelemetryBatch = z.infer<typeof browserTelemetryBatchSchema>;

export const desktopTelemetryEventNameSchema = z.enum([
  "desktop.app.starting",
  "desktop.app.ready",
  "desktop.app.start_failed",
  "desktop.renderer.unresponsive",
  "desktop.renderer.recovered",
  "desktop.renderer.exited",
  "desktop.update.check_completed",
  "desktop.update.check_failed",
  "desktop.update.available",
  "desktop.update.download_completed",
  "desktop.update.download_failed",
  "desktop.update.install_started",
  "desktop.update.install_failed",
  "desktop.update.cleanup_failed",
  "desktop.runtime.state_invalid",
  "desktop.runtime.trial_rolled_back",
  "desktop.runtime.release_invalid",
  "desktop.runtime.trial_healthy",
  "desktop.settings.load_failed",
  "desktop.browser.tunnel_connected",
  "desktop.browser.tunnel_failed",
  "desktop.browser.tunnel_closed",
]);
export type DesktopTelemetryEventName = z.infer<typeof desktopTelemetryEventNameSchema>;

export const desktopTelemetryErrorCodeSchema = z.enum([
  "network",
  "http_error",
  "invalid_manifest",
  "download_size_mismatch",
  "download_integrity_mismatch",
  "invalid_signature",
  "shell_too_old",
  "runtime_unhealthy",
  "file_io",
  "renderer_crashed",
  "renderer_killed",
  "renderer_oom",
  "renderer_launch_failed",
  "proxy_unavailable",
  "tunnel_connection_lost",
  "settings_read_failed",
  "unknown",
]);
export type DesktopTelemetryErrorCode = z.infer<typeof desktopTelemetryErrorCodeSchema>;

export const desktopTelemetryRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  event: desktopTelemetryEventNameSchema,
  occurred_at_ms: z.number().int().nonnegative(),
  status: z.enum(["ok", "error"]),
  code: desktopTelemetryErrorCodeSchema.nullable(),
  duration_ms: z.number().finite().nonnegative().max(900_000).nullable(),
  desktop_session_id: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  ),
  platform: z.enum(["win32", "darwin", "linux"]),
  arch: z.enum(["x64", "arm64"]),
});
export type DesktopTelemetryRecord = z.infer<typeof desktopTelemetryRecordSchema>;

export const desktopTelemetryBatchSchema = z.strictObject({
  records: z.array(desktopTelemetryRecordSchema).min(1).max(32),
  dropped_count: z.number().int().nonnegative().max(1_000_000),
});
export type DesktopTelemetryBatch = z.infer<typeof desktopTelemetryBatchSchema>;
