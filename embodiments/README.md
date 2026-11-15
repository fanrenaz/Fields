# StickS3 Embodiment terminal clients

This directory contains the terminal-side clients for Fields Embodiment: the
M5StickS3 Arduino firmware and a PC browser-audio simulator. The canonical
product service is the Backend Embodiment Runtime; terminal clients never
expose provider credentials or become a product authority.

## Runtime boundary

```text
Room/Home Agent MCP -> Backend API -> Backend Embodiment Runtime -> /embodiment/ws -> Terminal client
```

The Backend owns Company Terminals, Owner pairing claims, per-terminal token
rotation/revocation, call authorization, and all active-call state. A terminal
uses only the Embodiment terminal JSON, Pairing, and S3AU contracts from
`@fields/contracts/embodiment`. It has no direct MCP, database, or browser
control-plane access.

## Terminal clients

- [`firmware/StickS3_Call`](firmware/StickS3_Call) is the M5StickS3 terminal.
  It prefers NVS pairing credentials and only uses ignored `config.h` values
  when no NVS terminal credential exists.
- [`simulator`](simulator) provides deterministic fixture tests and the PC soft
  terminal. Its browser page handles audio and controls but never receives the
  per-terminal token.
- [`docs/protocol-v2.md`](docs/protocol-v2.md) explains the canonical
  terminal-facing transport.

## Pairing

An unpaired terminal opens `/embodiment/ws` without credential headers and
sends `pairing.hello`. The Runtime creates the pairing session and returns a
six-character code. After an Owner claims that code, the original socket
receives one credential frame; the terminal stores it locally and reconnects
with `X-Terminal-Id` plus `X-Terminal-Token`. Ordinary connection failures keep
those credentials. Only an explicit Runtime credential-invalid signal starts
pairing again.

The first release gate is the PC simulator: `pair -> call.start -> playback ->
record -> transcript -> call.end`. The firmware has the same v2 protocol
behavior and is compiled with Arduino CLI; real-terminal acceptance follows
the PC gate.
