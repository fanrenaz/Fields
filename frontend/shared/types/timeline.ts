import type { ComposerReferenceTarget } from "./composer";

export type RoomMessageSender = {
  type: "human" | "agent";
  id: string;
  display_name: string;
  mark: string;
  avatar_resource_id: string | null;
};

export type RoomMessageBody = {
  format: "inline_markdown";
  markdown: string;
  plain_text: string;
};

export type RoomMessageReplyTo = {
  message_ids: string[];
  preview: string | { key: string; values?: Record<string, string | number> };
};

export type RoomMessageInteraction = {
  id: string;
  kind: "delegation_check";
  label: string;
  status: "pending" | "approved" | "rejected" | string;
  responses: Array<{
    value: "approve" | "reject";
    label: string;
  }>;
} | (import("@fields/contracts/public/agent-activity").AgentQuestionInteraction & {
  kind: "request_user_input";
});

export type TimelineMessage =
  | {
    id: string;
    kind: "system";
    sequence?: number;
    occurred_at: number;
    body: RoomMessageBody;
  }
  | {
    id: string;
    kind: "message";
    sequence?: number;
    occurred_at: number;
    sender: RoomMessageSender;
    body: RoomMessageBody;
    revision?: number;
    edited_at_ms?: number | null;
    deleted_at_ms?: number | null;
    reply_to: RoomMessageReplyTo | null;
    interactions?: RoomMessageInteraction[];
    thread_id: string | null;
    agent_turn?: {
      trigger_message_id: string;
      execution_id: string;
      cascade_id: string;
      status: "queued" | "running" | "completed" | "failed" | "interrupted";
      started_at_ms: number | null;
      completed_at_ms: number | null;
      duration_ms: number | null;
    };
    agent_reply_version?: {
      group_id: string;
      version_number: number;
      version_count: number;
      selected: boolean;
      selection_revision?: number;
      latest_successful: boolean;
      source_execution_id: string | null;
    };
    references?: ComposerReferenceTarget[];
    generation?: {
      state: "waiting" | "streaming";
    };
    delivery?: {
      state: "pending" | "error";
      client_message_id?: string;
      message?: string | { key: string; values?: Record<string, string | number> } | null;
    };
  };

export type SourceRouteNotice = {
  from: "Search overlay" | "Inbox overlay";
  source: string;
  object: string;
} | null;
