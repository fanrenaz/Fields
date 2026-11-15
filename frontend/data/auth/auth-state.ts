import type {
  ProductSession,
} from "@fields/contracts/public/company";

export type SignedOutAuthSurface = "bootstrap" | "login";

export function signedOutAuthSurface(bootstrapAvailable: boolean): SignedOutAuthSurface {
  return bootstrapAvailable ? "bootstrap" : "login";
}

export function productSessionFrom(value: unknown): ProductSession | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.actor_id !== "string" || candidate.actor_id.length === 0 ||
    typeof candidate.company_id !== "string" || candidate.company_id.length === 0 ||
    typeof candidate.display_name !== "string" || candidate.display_name.trim().length === 0 ||
    candidate.actor_type !== "human" ||
    (candidate.company_role !== "owner" && candidate.company_role !== "member") ||
    (candidate.company_status !== "provisioning"
      && candidate.company_status !== "active"
      && candidate.company_status !== "setup_failed")
  ) {
    return null;
  }
  return {
    actor_id: candidate.actor_id,
    company_id: candidate.company_id,
    display_name: candidate.display_name,
    actor_type: "human",
    company_role: candidate.company_role,
    company_status: candidate.company_status,
  };
}

export function isProductAccessError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const code = (data as { code?: unknown }).code;
  return code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "NOT_FOUND";
}

export function errorMessage(error: unknown, fallback: string): string {
  void error;
  return fallback;
}
