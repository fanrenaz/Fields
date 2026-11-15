import { z } from "zod";

export const pcClientCommand = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("keepalive") }),
  z.strictObject({ type: z.literal("activate") }),
  // The browser controls the virtual device as physical A/B buttons.  The
  // semantic commands remain accepted while older browser tabs drain.
  z.strictObject({ type: z.literal("button.a") }),
  z.strictObject({ type: z.literal("button.b") }),
  z.strictObject({ type: z.literal("answer") }),
  z.strictObject({ type: z.literal("decline") }),
  z.strictObject({ type: z.literal("record.start") }),
  z.strictObject({ type: z.literal("record.stop") }),
  z.strictObject({ type: z.literal("hangup") }),
  z.strictObject({
    type: z.literal("playback.complete"),
    stream_id: z.number().int().positive(),
    status: z.enum(["played", "failed"]),
  }),
]);

export type PcClientCommand = z.infer<typeof pcClientCommand>;

/** Browser WebSocket binary envelope kinds. */
export const PC_BINARY_FRAME = 0x01;
export const PC_BINARY_DOWNLINK_PCM = 0x02;

/**
 * Runner fd 3 frame record.  The record is little endian and consists of:
 * `S3FR`, version, pixel format, header bytes, sequence, width, height,
 * payload bytes, then pixels.  The server forwards the complete record after
 * the `PC_BINARY_FRAME` envelope byte.
 */
export const PC_FRAME_MAGIC = "S3FR";
export const PC_FRAME_VERSION = 1;
export const PC_FRAME_HEADER_BYTES = 20;
export const PC_FRAME_FORMAT_RGB565LE = 1;
export const PC_FRAME_FORMAT_RGBA8888 = 2;

export type PcSnapshot = {
  type: "snapshot";
  controller_state: "ready" | "connecting" | "pairing" | "connected" | "error";
  terminal_state: "offline" | "idle" | "ringing" | "connected" | "playing" | "waiting" | "recording" | "ended";
  terminal_id: string;
  pairing: {
    state: "unpaired" | "code" | "persisting" | "reconnecting" | "paired";
    code: string | null;
    expires_at_ms: number | null;
  };
  call: {
    call_id: string;
    caller_label: string;
    purpose: string | null;
  } | null;
};

export type PcServerMessage =
  | PcSnapshot
  | { type: "pairing.status"; pairing: PcSnapshot["pairing"] }
  | { type: "terminal.event"; event: Record<string, unknown> }
  | { type: "downlink.start"; stream_id: number; byte_length: number; sample_rate_hz: 16_000 }
  | { type: "downlink.end"; stream_id: number }
  | { type: "recording.limit"; max_duration_ms: 60_000 }
  | { type: "error"; code: string; message: string; recoverable: boolean };
