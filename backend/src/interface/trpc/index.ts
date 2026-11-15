/** tRPC transport assembly and provider-neutral context adapters. */
export { createBackendTrpcContext, type BackendTrpcContextDependencies } from "./context.js";
export {
  ProductSessionResolver,
  ProductSessionUnavailableError,
  requireProductAuthContext,
  resolveProductAuthContext,
  type ProductAuthContext,
  type ProductAuthSessionResolver,
  type VerifiedProductAuthSession,
} from "./product-session.js";
export { createBackendTrpcRouter } from "./router.js";
