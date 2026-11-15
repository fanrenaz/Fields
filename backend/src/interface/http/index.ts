/** HTTP transport adapters only. */
export {
  FIELDS_INVITATION_ID_HEADER,
  FIELDS_REGISTRATION_CREDENTIAL_HEADER,
  resolveInvitationPreviewHttpRequest,
  type InvitationPreviewHttpOutput,
} from "./invitation-preview.js";
export {
  handleBetterAuthHttpRoute,
  type BetterAuthHttpRequest,
  type BetterAuthHttpResponse,
  type BetterAuthRouteDispatcher,
} from "./better-auth-route.js";
export { BrowserTelemetryRelay, type BrowserTelemetryHttpResult } from "./browser-telemetry.js";
export { clientTelemetryContext, type ClientTelemetryContext } from "./client-telemetry.js";
export { DesktopTelemetryRelay, type DesktopTelemetryHttpResult } from "./desktop-telemetry.js";
