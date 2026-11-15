import type { TFunction } from "i18next";
import type {
  AgentRoomErrorCode,
} from "@fields/contracts/public/agent-room";
import type {
  CompanyRuntimeErrorCode,
} from "@fields/contracts/public/company";
import type {
  MemberExecutorErrorCode,
} from "@fields/contracts/public/executor";
import type {
  RoomMessageErrorCode,
} from "@fields/contracts/public/room";

export type UiMessage = {
  key: string;
  values?: Record<string, string | number>;
};

export type UiMessageValue = UiMessage | string | null | undefined;

export function message(key: string, values?: Record<string, string | number>): UiMessage {
  return values ? { key, values } : { key };
}

export function translateMessage(t: TFunction, value: UiMessageValue): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : t(value.key, value.values);
}

/** Mark a desktop fallback before it crosses an async boundary. */
export class UiMessageError extends Error {
  readonly messageDescriptor: UiMessage;

  constructor(key: string, values?: Record<string, string | number>) {
    super(key);
    this.messageDescriptor = message(key, values);
  }
}

export function messageFromError(error: unknown, fallbackKey: string): UiMessageValue {
  if (error instanceof UiMessageError) return error.messageDescriptor;
  if (error instanceof Error && isProductErrorCode(error.message)) {
    return message(`productErrors.${error.message}`);
  }
  return message(fallbackKey);
}

function isProductErrorCode(value: string): boolean {
  return productErrorCodes.has(value);
}

type ProductErrorCode =
  | AgentRoomErrorCode
  | CompanyRuntimeErrorCode
  | MemberExecutorErrorCode
  | RoomMessageErrorCode;

const productErrorCodes: ReadonlySet<string> = new Set<ProductErrorCode>([
  "MEMBER_NOT_FOUND",
  "AGENT_MEMBER_REQUIRED",
  "MEMBER_EXECUTOR_NOT_CONFIGURED",
  "EXECUTOR_NOT_FOUND",
  "EXECUTOR_NOT_AVAILABLE",
  "EXECUTOR_NOT_ALLOWED",
  "EXECUTOR_MODEL_NOT_ALLOWED",
  "EXECUTOR_REASONING_EFFORT_NOT_ALLOWED",
  "EXECUTOR_THREAD_MODEL_SELECTION_REQUIRED",
  "MEMBER_EXECUTOR_SWITCH_IN_PROGRESS",
  "MEMBER_EXECUTOR_DRAIN_FAILED",
  "MEMBER_EXECUTOR_RESUME_FAILED",
  "COMPANY_RUNTIME_NOT_PROVISIONED",
  "COMPANY_RUNTIME_UNAVAILABLE",
  "COMPANY_RUNTIME_LEASE_STALE",
  "ROOM_NOT_FOUND",
  "ROOM_MEMBER_NOT_FOUND",
  "AGENT_NOT_IN_ROOM",
  "AGENT_NOT_READY_FOR_ROOM",
  "TRIGGER_POLICY_VERSION_CONFLICT",
  "EXECUTION_NOT_FOUND",
  "MESSAGE_NOT_FOUND",
  "MESSAGE_REPLY_TARGET_INVALID",
  "MESSAGE_IDEMPOTENCY_CONFLICT",
  "FORBIDDEN",
]);
