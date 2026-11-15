import {
  embodimentCallEndInputSchema as callEndInputSchema,
  embodimentCallEndResultSchema as callEndResultSchema,
  embodimentCallExchangeInputSchema as callExchangeInputSchema,
  embodimentCallExchangeResultSchema as callExchangeResultSchema,
  embodimentCallStartInputSchema as callStartInputSchema,
  embodimentCallStartResultSchema as callStartResultSchema,
  embodimentCallToolErrorResultSchema as callToolErrorResultSchema,
  companyTerminalsListResultSchema,
  type EmbodimentCallEndInput as CallEndInput,
  type EmbodimentCallEndResult as CallEndResult,
  type EmbodimentCallExchangeInput as CallExchangeInput,
  type EmbodimentCallExchangeResult as CallExchangeResult,
  type EmbodimentCallStartInput as CallStartInput,
  type EmbodimentCallStartResult as CallStartResult,
  type EmbodimentCallToolErrorResult as CallToolErrorResult,
  type CompanyTerminalsListResult,
} from "@fields/contracts/public/embodiment";
import { z } from "zod";

export const EMBODIMENT_CALL_TOOL_TIMEOUT_MS = 240_000;

export type CompanyCallRuntimeIdentity = {
  company_id: string;
};

export type CallStartToolResult = CallStartResult | CallToolErrorResult;
export type CallExchangeToolResult = CallExchangeResult | CallToolErrorResult;
export type CallEndToolResult = CallEndResult | CallToolErrorResult;
export type TerminalListToolResult = CompanyTerminalsListResult;

export class CallMcpError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CallMcpError";
    this.code = code;
    this.details = details;
  }
}

export function parseCallStartInput(args: Record<string, unknown>): CallStartInput {
  return parseInput(callStartInputSchema.safeParse(args), "embodiment.call.start");
}

export function parseCallExchangeInput(args: Record<string, unknown>): CallExchangeInput {
  return parseInput(callExchangeInputSchema.safeParse(args), "embodiment.call.exchange");
}

export function parseCallEndInput(args: Record<string, unknown>): CallEndInput {
  return parseInput(callEndInputSchema.safeParse(args), "embodiment.call.end");
}

const zeroArgumentInputSchema = z.strictObject({});

export function parseTerminalListInput(args: Record<string, unknown>): Record<string, never> {
  return parseInput(zeroArgumentInputSchema.safeParse(args), "embodiment.terminal.list");
}

export async function callStartFromCompanyRuntime(input: {
  apiUrl: string;
  callbackToken: string;
  memberId: string;
  runtime: CompanyCallRuntimeIdentity;
  call: CallStartInput;
}): Promise<CallStartToolResult> {
  return requestCall(input, "start", input.call, (body) => callStartResultSchema.or(callToolErrorResultSchema).safeParse(body));
}

export async function callExchangeFromCompanyRuntime(input: {
  apiUrl: string;
  callbackToken: string;
  memberId: string;
  runtime: CompanyCallRuntimeIdentity;
  call: CallExchangeInput;
}): Promise<CallExchangeToolResult> {
  return requestCall(input, "exchange", input.call, (body) => callExchangeResultSchema.or(callToolErrorResultSchema).safeParse(body));
}

export async function callEndFromCompanyRuntime(input: {
  apiUrl: string;
  callbackToken: string;
  memberId: string;
  runtime: CompanyCallRuntimeIdentity;
  call: CallEndInput;
}): Promise<CallEndToolResult> {
  return requestCall(input, "end", input.call, (body) => callEndResultSchema.or(callToolErrorResultSchema).safeParse(body));
}

export async function listTerminalsFromCompanyRuntime(input: {
  apiUrl: string;
  callbackToken: string;
  memberId: string;
  runtime: CompanyCallRuntimeIdentity;
}): Promise<TerminalListToolResult> {
  let response: Response;
  try {
    response = await fetch(terminalListEndpoint(input.apiUrl), {
      method: "GET",
      headers: runtimeHeaders(input),
      signal: AbortSignal.timeout(EMBODIMENT_CALL_TOOL_TIMEOUT_MS),
    });
  } catch (error) {
    throw terminalRequestError(error);
  }
  const responseBody = await readJson(response);
  if (!response.ok) throw terminalHttpError(response.status);
  const parsed = companyTerminalsListResultSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new CallMcpError("embodiment_terminal_contract_invalid", "Backend returned an invalid terminal list.");
  }
  return parsed.data;
}

async function requestCall<T>(
  input: {
    apiUrl: string;
    callbackToken: string;
    memberId: string;
    runtime: CompanyCallRuntimeIdentity;
  },
  operation: "start" | "exchange" | "end",
  body: CallStartInput | CallExchangeInput | CallEndInput,
  parseSuccess: (body: unknown) => { success: true; data: T } | { success: false },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(callEndpoint(input.apiUrl, operation), {
      method: "POST",
      headers: {
        ...runtimeHeaders(input),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EMBODIMENT_CALL_TOOL_TIMEOUT_MS),
    });
  } catch (error) {
    throw requestError(error);
  }

  const responseBody = await readJson(response);
  if (!response.ok) {
    throw httpError(response.status, responseBody);
  }
  const parsed = parseSuccess(responseBody);
  if (!parsed.success) {
    throw new CallMcpError("embodiment_call_contract_invalid", "Backend returned an invalid Embodiment Call result.");
  }
  return parsed.data;
}

function parseInput<T>(
  result: { success: true; data: T } | { success: false },
  toolName: string,
): T {
  if (result.success) return result.data;
  throw new CallMcpError("embodiment_call_invalid_argument", `${toolName} parameters are invalid.`);
}

function callEndpoint(apiUrl: string, operation: "start" | "exchange" | "end"): string {
  return `${apiBase(apiUrl)}/embodiment/call/${operation}`;
}

function terminalListEndpoint(apiUrl: string): string {
  return `${apiBase(apiUrl)}/embodiment/terminals/runtime`;
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  return base.endsWith("/trpc")
    ? `${base.slice(0, -"/trpc".length)}/api/v1`
    : base.endsWith("/api/v1")
      ? base
      : `${base}/api/v1`;
}

function runtimeHeaders(input: {
  callbackToken: string;
  memberId: string;
  runtime: CompanyCallRuntimeIdentity;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${input.callbackToken}`,
    "X-Fields-Member-Id": input.memberId,
    "X-Fields-Runtime-Kind": "company",
    "X-Fields-Runtime-Id": input.runtime.company_id,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function requestError(error: unknown): CallMcpError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new CallMcpError("embodiment_call_timeout", "Embodiment Call request timed out.");
  }
  return new CallMcpError("embodiment_call_backend_unavailable", "Backend Embodiment service is unavailable.");
}

function terminalRequestError(error: unknown): CallMcpError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new CallMcpError("embodiment_terminal_timeout", "Terminal list request timed out.");
  }
  return new CallMcpError("embodiment_terminal_backend_unavailable", "Backend terminal service is unavailable.");
}

function httpError(status: number, body: unknown): CallMcpError {
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return new CallMcpError("embodiment_call_contract_invalid", "Backend rejected the Embodiment Call request.", { status });
  }
  if (status === 401 || status === 403) {
    return new CallMcpError("embodiment_call_identity_invalid", "Embodiment runtime identity is not authorized.", { status });
  }
  if (status === 408 || status === 504) {
    return new CallMcpError("embodiment_call_timeout", "Embodiment Call request timed out.", { status });
  }
  if (body && typeof body === "object") {
    return new CallMcpError("embodiment_call_backend_failed", "Backend Embodiment service failed.", { status });
  }
  return new CallMcpError("embodiment_call_backend_failed", "Backend Embodiment service failed.", { status });
}

function terminalHttpError(status: number): CallMcpError {
  if (status === 401 || status === 403) {
    return new CallMcpError("embodiment_terminal_identity_invalid", "Embodiment runtime identity is not authorized.", { status });
  }
  if (status === 408 || status === 504) {
    return new CallMcpError("embodiment_terminal_timeout", "Terminal list request timed out.", { status });
  }
  return new CallMcpError("embodiment_terminal_backend_failed", "Backend terminal service failed.", { status });
}
