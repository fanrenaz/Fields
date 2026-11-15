# StickS3 Embodiment Terminal Protocol v2

`@fields/contracts/embodiment` is the executable source of truth for the
Embodiment terminal JSON, pairing, and S3AU contracts. This document describes
the terminal-facing use of those strict v2 contracts; it does not define a
compatibility schema.

## Terminal WebSocket

The Embodiment Runtime owns `GET /embodiment/ws`. A paired terminal supplies
both headers below, then sends `terminal.hello` within five seconds.

```text
X-Terminal-Id: <terminal_id>
X-Terminal-Token: <per-terminal-token>
```

The token must never appear in a URL, log, API response, or browser message.
After validation, the Runtime sends `terminal.ready`; only then may the
terminal process Call events or S3AU frames. A normal network disconnect keeps
local credentials and retries with backoff. An explicit Runtime
credential-invalid signal (`pairing.invalid`, or a policy-close reason of
`credential invalid` or `credential revoked`) is the only condition that
clears local credentials and returns the terminal to pairing.

## Pairing and credential rotation

An unpaired terminal connects to the same endpoint without credential headers
and sends the exact opening frame:

```json
{"schema_version":2,"type":"pairing.hello","label":"M5StickS3"}
```

The Runtime returns a six-character `pairing.code`, including the
Runtime-issued `pairing_session_id` and expiry. An Owner claims the code
through the Embodiment terminal API. The original WebSocket receives exactly
one `pairing.credentials` message containing `terminal_id`, `terminal_token`,
and `terminal_token_version`.

The terminal must durably store those values before sending
`terminal.credentials_ack` with its `terminal_token_version`; the Backend does
not activate a newly paired terminal until it receives that acknowledgement.
The terminal then reconnects with the normal headers. A token rotation follows
the same sequence on an existing connection: persist first, acknowledge
second. Until the acknowledgement arrives, the Runtime retains the old token.

The PC simulator retains credentials only in its Node process. Firmware saves
them in ESP32 NVS namespace `fields_embodiment`. Compile-time terminal
credentials in `config.h` are used only when no NVS credentials exist.

## Terminal JSON

All normal terminal events are strict UTF-8 JSON with `schema_version: 2` and
snake-case fields. The discriminated union contains:

```text
terminal.hello / terminal.ready / terminal.error
terminal.credentials_ack
system.ping / system.pong
call.incoming / call.answer / call.decline
call.connected / call.hangup / call.ended
turn.listen / turn.complete
audio.start / audio.ready / audio.progress / audio.end / audio.played
```

The Runtime sends application `system.ping` every 15 seconds. The terminal
must reply with `system.pong`; two missed five-second windows end the WebSocket.
An incoming replacement connection for the same terminal ends its live call.

## S3AU PCM frames

Each binary WebSocket message contains one 16 kHz mono PCM16LE frame. S3AU is
an independent binary framing protocol and remains version `1` while terminal
JSON is version `2`:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 4 | ASCII `S3AU` |
| 4 | 1 | version `1` |
| 5 | 1 | flags; bit 0 is `final` |
| 6 | 2 | header length `20` |
| 8 | 4 | non-zero `stream_id` |
| 12 | 4 | monotonically increasing `seq` |
| 16 | 4 | PCM payload length |
| 20 | N | PCM payload |

Payloads must be even byte lengths. A non-final frame is exactly 1024 bytes;
the final frame is 2–1024 bytes. Empty audio sends no binary frame and reports
`audio.end` with `final_seq: null`. Firmware and simulator retain one complete
uplink block while recording so the actual final S3AU frame, including an
exact 1024-byte final block, has the final flag.
