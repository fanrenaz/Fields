import {
  companyTerminalControlErrorSchema,
  companyTerminalRevokeResultSchema,
  companyTerminalsListResultSchema,
  pairingClaimInputSchema,
  pairingClaimResultSchema,
  type CompanyTerminalControlError,
  type CompanyTerminalRevokeResult,
  type CompanyTerminalsListResult,
  type PairingClaimResult,
} from "@fields/contracts/public/embodiment";

import { authFetch } from "../boundary/auth-client";
import { backendApiUrl } from "../boundary/backend-url";

export class TerminalApiError extends Error {
  readonly code: CompanyTerminalControlError["code"] | null;
  readonly retryable: boolean;

  constructor(input: { code: CompanyTerminalControlError["code"] | null; retryable: boolean; message: string }) {
    super(input.message);
    this.name = "TerminalApiError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export async function listTerminals(): Promise<CompanyTerminalsListResult> {
  return request("/api/v1/embodiment/terminals", { method: "GET" }, companyTerminalsListResultSchema);
}

export async function claimTerminal(input: { code: string; label?: string }): Promise<PairingClaimResult> {
  const body = pairingClaimInputSchema.parse(input);
  return request("/api/v1/embodiment/terminals/pairing/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, pairingClaimResultSchema);
}

export async function revokeTerminal(terminalId: string): Promise<CompanyTerminalRevokeResult> {
  return request(`/api/v1/embodiment/terminals/${encodeURIComponent(terminalId)}/revoke`, {
    method: "POST",
  }, companyTerminalRevokeResultSchema);
}

export async function rotateTerminal(terminalId: string): Promise<PairingClaimResult> {
  return request(`/api/v1/embodiment/terminals/${encodeURIComponent(terminalId)}/rotate`, {
    method: "POST",
  }, pairingClaimResultSchema);
}

async function request<T>(
  pathname: string,
  init: RequestInit,
  schema: { parse(input: unknown): T },
): Promise<T> {
  const response = await authFetch(backendApiUrl(pathname), init);
  const body = await responseJson(response);
  if (!response.ok) {
    const parsed = companyTerminalControlErrorSchema.safeParse(body);
    if (parsed.success) throw new TerminalApiError(parsed.data);
    throw new TerminalApiError({ code: null, retryable: response.status >= 500, message: `Terminal request failed (${response.status}).` });
  }
  return schema.parse(body);
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}
