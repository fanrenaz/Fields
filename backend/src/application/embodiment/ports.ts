import type { EmbodimentCallOwner } from "../../domain/embodiment/index.js";

export type RuntimeEmbodimentHeaders = {
  memberId?: string;
  kind?: string;
  runtimeId?: string;
  authorization?: string;
};

export type CompanyTerminalRecord = {
  terminal_id: string;
  company_id: string;
  label: string;
  status: "active" | "revoked";
  current_token_version: number;
  created_at_ms: number;
  paired_at_ms: number;
  revoked_at_ms: number | null;
  updated_at_ms: number;
};

export interface TerminalRepositoryPort {
  list(companyId: string): Promise<CompanyTerminalRecord[]>;
  create(companyId: string, terminalId: string, label: string, token: string): Promise<CompanyTerminalRecord>;
  authenticate(terminalId: string, token: string): Promise<CompanyTerminalRecord | null>;
  prepareRotation(companyId: string, terminalId: string, token: string): Promise<{ terminal: CompanyTerminalRecord; terminal_token_version: number }>;
  promotePending(companyId: string, terminalId: string, version: number): Promise<void>;
  revoke(companyId: string, terminalId: string): Promise<CompanyTerminalRecord>;
}

export interface RuntimeCallAuthorizationPort {
  authorize(headers: RuntimeEmbodimentHeaders): Promise<EmbodimentCallOwner | null>;
}

/** Authenticates only Backend-to-Embodiment internal control requests. */
export interface InternalControlAuthorizationPort {
  matches(authorization: string | string[] | undefined): Promise<boolean>;
}

/** Keeps speech-provider implementation details outside the Runtime worker. */
export interface EmbodimentSpeechPort {
  synthesize(text: string): Promise<Uint8Array>;
  transcribe(pcm16le: Uint8Array): Promise<string | null>;
}

export interface EmbodimentRuntimeGatewayPort {
  start(body: unknown): Promise<unknown>;
  exchange(body: unknown): Promise<unknown>;
  end(body: unknown): Promise<unknown>;
  deliverPairingCredentials(body: unknown): Promise<{ delivered: boolean; confirmed: boolean }>;
  connectedTerminalIds(): Promise<Set<string> | null>;
  disconnectTerminal(terminalId: string): Promise<boolean>;
}
