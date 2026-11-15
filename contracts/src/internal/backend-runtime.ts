import { z } from "zod";

export const companyRuntimeCallbackErrorCodeSchema = z.enum([
  "RUNTIME_CALLBACK_UNAUTHORIZED",
  "COMPANY_RUNTIME_LEASE_STALE",
  "EXECUTION_NOT_FOUND",
  "EXECUTION_SCOPE_MISMATCH",
  "EXECUTION_NOT_ACTIVE",
]);
export type CompanyRuntimeCallbackErrorCode = z.infer<typeof companyRuntimeCallbackErrorCodeSchema>;
