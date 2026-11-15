import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeS3auFrame,
  encodeS3auFrame,
  companyTerminalControlErrorSchema,
  companyTerminalsListResultSchema,
  embodimentCallMcpToolNameSchema,
  pairingCodeMessageSchema,
  pairingClaimResultSchema,
  pairingCredentialsSchema,
  pairingTerminalHelloSchema,
  terminalHelloSchema,
} from "../dist/public/embodiment.js";

test("Embodiment rejects v1 Device JSON, credential fields, and Call MCP aliases", () => {
  assert.equal(terminalHelloSchema.safeParse({
    schema_version: 1,
    event_id: "event_one",
    type: "device.hello",
    device_id: "device_one",
    boot_id: "boot_one",
    capabilities: {
      audio_input: "pcm16le_16000_mono",
      audio_output: "pcm16le_16000_mono",
      max_audio_payload_bytes: 1024,
      display: true,
      buttons: ["a"],
    },
  }).success, false);
  assert.equal(pairingCredentialsSchema.safeParse({
    schema_version: 2,
    type: "pairing.credentials",
    device_id: "device_one",
    device_token: "t".repeat(32),
    token_version: 1,
  }).success, false);
  assert.equal(embodimentCallMcpToolNameSchema.safeParse("call.start").success, false);
  assert.equal(embodimentCallMcpToolNameSchema.parse("embodiment.call.start"), "embodiment.call.start");
});

test("unpaired pairing.hello has no pre-issued session and pairing.code assigns one", () => {
  assert.deepEqual(pairingTerminalHelloSchema.parse({ schema_version: 2, type: "pairing.hello", label: "Desk" }), {
    schema_version: 2,
    type: "pairing.hello",
    label: "Desk",
  });
  assert.equal(pairingTerminalHelloSchema.safeParse({ schema_version: 2, type: "pairing.hello", pairing_session_id: "preissued" }).success, false);
  assert.deepEqual(pairingCodeMessageSchema.parse({ schema_version: 2, type: "pairing.code", pairing_session_id: "p".repeat(24), code: "A1B2C3", expires_at_ms: 1 }), {
    schema_version: 2,
    type: "pairing.code",
    pairing_session_id: "p".repeat(24),
    code: "A1B2C3",
    expires_at_ms: 1,
  });
  assert.deepEqual(pairingCredentialsSchema.parse({ schema_version: 2, type: "pairing.credentials", terminal_id: "terminal_one", terminal_token: "t".repeat(32), terminal_token_version: 2 }), {
    schema_version: 2,
    type: "pairing.credentials",
    terminal_id: "terminal_one",
    terminal_token: "t".repeat(32),
    terminal_token_version: 2,
  });
  assert.equal(pairingCredentialsSchema.safeParse({ schema_version: 2, type: "pairing.credentials", terminal_id: "terminal_one", terminal_token: "t".repeat(32), terminal_token_version: 2, event_id: "must-not-leak-into-pairing" }).success, false);
});

test("Company terminal browser projections exclude credentials and preserve unknown Runtime availability", () => {
  const listing = companyTerminalsListResultSchema.parse({
    items: [{
      terminal_id: "terminal_one",
      label: "Kitchen",
      status: "active",
      paired_at_ms: 1,
      connection_status: "unknown",
    }],
  });
  assert.equal(listing.items[0].connection_status, "unknown");
  assert.equal(companyTerminalsListResultSchema.safeParse({
    items: [{
      terminal_id: "terminal_one",
      label: "Kitchen",
      status: "active",
      paired_at_ms: 1,
      connection_status: "online",
      terminal_token: "must-not-cross-the-browser-boundary",
    }],
  }).success, false);
  assert.equal(pairingClaimResultSchema.safeParse({
    terminal: { terminal_id: "terminal_one", label: "Kitchen", status: "active", paired_at_ms: 1, terminal_token_version: 1 },
  }).success, false);
  assert.equal(companyTerminalControlErrorSchema.safeParse({ code: "EMBODIMENT_TERMINAL_RUNTIME_UNAVAILABLE", message: "Unavailable", retryable: true }).success, true);
});

test("S3AU accepts only full non-final frames and an even final frame", () => {
  const full = encodeS3auFrame({ flags: 0, stream_id: 4, seq: 0, payload: new Uint8Array(1024) });
  assert.equal(decodeS3auFrame(full).payload.byteLength, 1024);
  const final = encodeS3auFrame({ flags: 1, stream_id: 4, seq: 1, payload: new Uint8Array(2) });
  assert.equal(decodeS3auFrame(final).flags, 1);
  assert.throws(() => encodeS3auFrame({ flags: 0, stream_id: 4, seq: 2, payload: new Uint8Array(2) }));
});
