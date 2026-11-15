export const S3AU_MAGIC = new Uint8Array([0x53, 0x33, 0x41, 0x55]);
export const S3AU_HEADER_LENGTH = 20;
export const S3AU_VERSION = 1;
export const S3AU_FINAL_FLAG = 0x01;
export const S3AU_MAX_PAYLOAD_BYTES = 1024;
export interface S3auAudioFrame { version: 1; flags: number; stream_id: number; seq: number; payload: Uint8Array; }
export interface S3auFrameExpectation { stream_id?: number; seq?: number; }
function assertUint32(name: string, value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${name} must be an unsigned 32-bit integer`); }
export function encodeS3auFrame(frame: Omit<S3auAudioFrame, "version"> & { version?: 1 }): Uint8Array {
  const version = frame.version ?? S3AU_VERSION;
  if (version !== S3AU_VERSION) throw new Error("unsupported S3AU version");
  if (!Number.isInteger(frame.flags) || frame.flags < 0 || frame.flags > 0xff || (frame.flags & ~S3AU_FINAL_FLAG) !== 0) throw new Error("reserved S3AU flags are set");
  assertUint32("stream_id", frame.stream_id); if (frame.stream_id === 0) throw new Error("stream_id must be non-zero"); assertUint32("seq", frame.seq);
  if (frame.payload.byteLength === 0 || frame.payload.byteLength > S3AU_MAX_PAYLOAD_BYTES || frame.payload.byteLength % 2 !== 0) throw new Error("S3AU payload must be an even number of bytes between 2 and 1024");
  if ((frame.flags & S3AU_FINAL_FLAG) === 0 && frame.payload.byteLength !== S3AU_MAX_PAYLOAD_BYTES) throw new Error("non-final S3AU frame must contain 1024 bytes");
  const bytes = new Uint8Array(S3AU_HEADER_LENGTH + frame.payload.byteLength); bytes.set(S3AU_MAGIC, 0); bytes[4] = version; bytes[5] = frame.flags;
  const view = new DataView(bytes.buffer); view.setUint16(6, S3AU_HEADER_LENGTH, true); view.setUint32(8, frame.stream_id, true); view.setUint32(12, frame.seq, true); view.setUint32(16, frame.payload.byteLength, true); bytes.set(frame.payload, S3AU_HEADER_LENGTH); return bytes;
}
export function decodeS3auFrame(input: Uint8Array, expected: S3auFrameExpectation = {}): S3auAudioFrame {
  if (input.byteLength < S3AU_HEADER_LENGTH) throw new Error("S3AU frame is shorter than header"); if (!S3AU_MAGIC.every((byte, index) => input[index] === byte)) throw new Error("invalid S3AU magic"); const view = new DataView(input.buffer, input.byteOffset, input.byteLength); if (input[4] !== S3AU_VERSION) throw new Error("unsupported S3AU version"); const flags = input[5]; if ((flags & ~S3AU_FINAL_FLAG) !== 0) throw new Error("reserved S3AU flags are set"); if (view.getUint16(6, true) !== S3AU_HEADER_LENGTH) throw new Error("invalid S3AU header length"); const stream_id = view.getUint32(8, true); const seq = view.getUint32(12, true); const payloadLength = view.getUint32(16, true); if (stream_id === 0) throw new Error("stream_id must be non-zero"); if (expected.stream_id !== undefined && expected.stream_id !== stream_id) throw new Error("unexpected S3AU stream_id"); if (expected.seq !== undefined && expected.seq !== seq) throw new Error("unexpected S3AU sequence"); if (payloadLength === 0 || payloadLength > S3AU_MAX_PAYLOAD_BYTES || payloadLength % 2 !== 0) throw new Error("invalid S3AU PCM payload length"); if (input.byteLength !== S3AU_HEADER_LENGTH + payloadLength) throw new Error("S3AU payload length mismatch"); if ((flags & S3AU_FINAL_FLAG) === 0 && payloadLength !== S3AU_MAX_PAYLOAD_BYTES) throw new Error("non-final S3AU frame must contain 1024 bytes"); return { version: S3AU_VERSION, flags, stream_id, seq, payload: input.slice(S3AU_HEADER_LENGTH) };
}
export const S3AU_HEADER_TEST_VECTOR_HEX = "5333415501011400040302012a000000040000000000ff7f";
