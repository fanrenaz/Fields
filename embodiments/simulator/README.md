# StickS3 Call Simulator

The browser soft terminal is backed by a native C++11 `/embodiment/ws` client.
It compiles the same terminal core, LVGL scene, and M5GFX `efontCN_16` Chinese
font adapter as the M5StickS3 firmware, preserves the canonical Terminal JSON
and S3AU wire format, and exposes browser audio only through a private local
control channel.

```bash
pnpm --filter @sticks3-call/simulator run test
pnpm --filter @sticks3-call/simulator run pc
```

## PC soft terminal

`pnpm --filter @sticks3-call/simulator run pc` serves a virtual StickS3 device
on `127.0.0.1:8790`. Open it
locally, or use a VS Code HTTPS port forward so the browser can access the
microphone. Clicking **启用** unlocks browser audio and activates the native
runner; the Canvas receives its RGB565 LVGL framebuffer. Keyboard A/B and the
on-screen device buttons map to the physical StickS3 buttons.

When both `STICKS3_TERMINAL_ID` and `STICKS3_TERMINAL_TOKEN` are supplied, the
native Runner uses them for an initial direct connection. Otherwise the Runner
connects without credential headers, sends `pairing.hello`, and the browser
displays the Backend-issued six-character code. After an Owner claims it, the
Runner writes the one-shot terminal token to its credential file, ACKs it, then
waits 500ms before reconnecting with `X-Terminal-Id` and `X-Terminal-Token`.

The default credential file is `~/.fields/sticks3-call/pc-terminal.json`; set
`STICKS3_PC_CREDENTIAL_FILE` to override it. Its parent directory is `0700` and
the file is atomically written as `0600`. Node and the browser never receive the
token, stored credential JSON, Runtime headers, or speech-provider secrets.

For both initial pairing and an in-place token rotation, the Runner persists the
credential before it sends `terminal.credentials_ack`; the Backend does not
activate a newly paired terminal until that acknowledgement arrives. The browser
receives neither the token nor the acknowledgement payload.

`STICKS3_TERMINAL_WS_URL`, `STICKS3_PC_HOST`, and `STICKS3_PC_PORT` retain their
usual overrides. The browser connection is limited to one page, protected by a
per-process nonce, and closing that page disconnects the simulated terminal.

## Development environment access

The development host runs the PC soft terminal automatically as a direct
process. Open it
through the development gateway at `http://127.0.0.1:3102/simulator/` (or the
matching VS Code Tunnel URL). The gateway proxies the page, its same-origin
control WebSocket, and its audio-worklet assets; the simulator itself has no
host port. Its terminal connection reaches the Embodiment process in the same
development host container.
