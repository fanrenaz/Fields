/** Better Auth adapter implementation boundary. */
export {
  BetterAuthOrganizationGateway,
  BetterAuthOrganizationGatewayError,
  type BetterAuthOrganizationApi,
} from "./organization-gateway.js";
export {
  BetterAuthProductSessionProjectionRepair,
  BetterAuthProductSessionProjectionRepairError,
  type HumanActorReconciliation,
} from "./product-session-projection-repair.js";
export {
  BetterAuthCommittedMembershipProjection,
  BetterAuthCommittedMembershipProjectionError,
} from "./committed-membership-projection.js";
export { BetterAuthInvitationAuthorityQuery } from "./invitation-authority-query.js";
export {
  createFieldsAuth,
  FieldsAuthConfigurationError,
  reconcileCommittedProjectionBestEffort,
  type CommittedProjectionAttempt,
  type FieldsAuth,
  type FieldsAuthOptions,
} from "./fields-auth.js";
export {
  dispatchBetterAuthHttpRequest,
  materializeBetterAuthHttpResponse,
  type BetterAuthHttpRequestInput,
  type BetterAuthHttpResponseOutput,
} from "./http.js";
export {
  AuthCredentialError,
  betterAuthHeadersFromHttp,
  betterAuthHeadersFromWebSocket,
  getBetterAuthSession,
  type BetterAuthConnectionParams,
  type VerifiedBetterAuthSession,
} from "./session.js";
