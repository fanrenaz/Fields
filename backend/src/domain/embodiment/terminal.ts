/**
 * Embodiment owns physical-terminal identity. The deployed table keeps its
 * historical `company_devices` column names, which must never leak here.
 */
export type TerminalStatus = "active" | "revoked";

export class TerminalNotFoundError extends Error {}

export type CompanyTerminal = {
  terminal_id: string;
  company_id: string;
  label: string;
  status: TerminalStatus;
  current_token_version: number;
  created_at_ms: number;
  paired_at_ms: number;
  revoked_at_ms: number | null;
  updated_at_ms: number;
};

export function isActiveCompanyTerminal(terminal: CompanyTerminal, companyId: string): boolean {
  return terminal.company_id === companyId && terminal.status === "active";
}
