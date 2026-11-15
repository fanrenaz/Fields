import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AgentRoomExecutionResult,
  HomeMutationReceipt,
  HomeQuestionHistoryEntry,
  HomeProjectRecord,
  MemberThreadRecord,
} from "./manager.js";
import type { MemberWorkspaceLayout } from "../../infrastructure/filesystem/workspace.js";
import {
  agentRoomExecutionCompletionSchema,
  type AgentRoomExecutionCompletion,
} from "@fields/contracts/internal/agent-room";
import { agentQuestionInteractionSchema } from "@fields/contracts/public/agent-activity";

const MEMBER_RUNTIME_STATE_FILE = "fields-runtime-state.json";

export type PersistedMemberRuntimeState = {
  projects: HomeProjectRecord[];
  threads: MemberThreadRecord[];
  executions: AgentRoomExecutionResult[];
  pendingCompletions: AgentRoomExecutionCompletion[];
  homeMutationReceipts: HomeMutationReceipt[];
  homeQuestions: HomeQuestionHistoryEntry[];
};

export async function readMemberRuntimeState(
  layout: MemberWorkspaceLayout,
): Promise<PersistedMemberRuntimeState> {
  const path = memberRuntimeStatePath(layout);
  let raw: unknown;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error("Member runtime state must be one regular file.");
    }
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { projects: [], threads: [], executions: [], pendingCompletions: [], homeMutationReceipts: [], homeQuestions: [] };
    }
    throw error;
  }
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2)) {
    throw new Error("Member runtime state has an unsupported format.");
  }
  return {
    projects: Array.isArray(raw.projects) ? raw.projects.filter(isHomeProjectRecord) : [],
    threads: Array.isArray(raw.threads)
      ? raw.threads.filter(isMemberThreadRecord).map((thread) => ({
        ...thread,
        workspaceRoots: [...thread.workspaceRoots],
      }))
      : [],
    executions: Array.isArray(raw.executions)
      ? raw.executions.filter(isAgentRoomExecutionResult)
      : [],
    pendingCompletions: Array.isArray(raw.pendingCompletions)
      ? raw.pendingCompletions.flatMap((completion) => {
        const parsed = agentRoomExecutionCompletionSchema.safeParse(completion);
        return parsed.success ? [parsed.data] : [];
      })
      : [],
    homeMutationReceipts: Array.isArray(raw.homeMutationReceipts)
      ? raw.homeMutationReceipts.filter(isHomeMutationReceipt)
      : [],
    homeQuestions: Array.isArray(raw.homeQuestions)
      ? raw.homeQuestions.filter(isHomeQuestionHistoryEntry)
      : [],
  };
}

export async function writeMemberRuntimeState(
  layout: MemberWorkspaceLayout,
  state: PersistedMemberRuntimeState,
): Promise<void> {
  const path = memberRuntimeStatePath(layout);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({
    version: 2,
    projects: state.projects,
    threads: state.threads,
    executions: state.executions,
    pendingCompletions: state.pendingCompletions,
    homeMutationReceipts: state.homeMutationReceipts,
    homeQuestions: state.homeQuestions,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export function memberRuntimeStatePath(layout: MemberWorkspaceLayout): string {
  return join(layout.codexHome, MEMBER_RUNTIME_STATE_FILE);
}

function isMemberThreadRecord(value: unknown): value is MemberThreadRecord {
  return isRecord(value)
    && typeof value.key === "string"
    && (typeof value.roomId === "string" || value.roomId === null)
    && typeof value.threadId === "string"
    && Array.isArray(value.workspaceRoots)
    && value.workspaceRoots.every((root) => typeof root === "string");
}

function isHomeProjectRecord(value: unknown): value is HomeProjectRecord {
  return isRecord(value)
    && typeof value.projectId === "string"
    && typeof value.name === "string"
    && typeof value.createdAtMs === "number"
    && typeof value.updatedAtMs === "number";
}

function isAgentRoomExecutionResult(value: unknown): value is AgentRoomExecutionResult {
  return isRecord(value)
    && typeof value.executionId === "string"
    && typeof value.idempotencyKey === "string"
    && typeof value.memberId === "string"
    && typeof value.roomId === "string"
    && typeof value.agentRoomThreadKey === "string"
    && typeof value.codexThreadId === "string"
    && (typeof value.codexTurnId === "string" || value.codexTurnId === null)
    && typeof value.completed === "boolean"
    && typeof value.agentText === "string"
    && !("outputMessages" in value)
    && (
      value.completion === null
      || agentRoomExecutionCompletionSchema.safeParse(value.completion).success
    )
    && typeof value.completionPending === "boolean"
    && typeof value.replayed === "boolean";
}

function isHomeMutationReceipt(value: unknown): value is HomeMutationReceipt {
  return isRecord(value)
    && typeof value.memberId === "string"
    && typeof value.idempotencyKey === "string"
    && typeof value.fingerprint === "string"
    && isRecord(value.result)
    && (
      value.result.type === "fork"
      || value.result.type === "select"
      || value.result.type === "delete"
    );
}

function isHomeQuestionHistoryEntry(value: unknown): value is HomeQuestionHistoryEntry {
  if (!isRecord(value) || typeof value.memberId !== "string" || typeof value.threadId !== "string"
    || typeof value.turnId !== "string") return false;
  const parsed = agentQuestionInteractionSchema.safeParse(value.interaction);
  return parsed.success && parsed.data.status === "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
