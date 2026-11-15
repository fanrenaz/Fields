export {
  CompanyMailService,
  MailServiceError,
} from "./service.js";
export {
  MAIL_CONNECTION_CONFIGURATION_INVALID,
  MAIL_CONNECTION_SSRF_BLOCKED,
  MailConnectionPolicyError,
  isForbiddenAddress,
  pinnedLookup,
  resolveMailConnection,
  resolvePublicEndpoint,
} from "./connection-policy.js";
export {
  mailThreadId,
  normalizeMessageId,
  sanitizeMailHtml,
} from "./html.js";
