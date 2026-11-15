export type ComposerReferenceTarget =
  | { type: "room"; id: string }
  | { type: "member"; id: string; room_id: string }
  | { type: "resource"; id: string; room_id: string }
  | { type: "memory"; id: string; room_id: string }
  | { type: "file"; id: string; version_id: string; room_id: string }
  | { type: "message"; room_id: string; message_id: string }
  | { type: "thread"; room_id: string; thread_id: string; message_id?: string }
  | { type: "context"; room_id: string; tab: "basis" | "changes" | "risks" };

export type ComposerReferenceOption = {
  label: string;
  target: ComposerReferenceTarget;
};
