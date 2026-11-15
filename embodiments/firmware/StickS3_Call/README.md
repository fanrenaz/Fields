# StickS3 Embodiment terminal firmware

Arduino firmware for M5StickS3. It connects to the Fields Backend Embodiment
Runtime at `/embodiment/ws`, speaks canonical Embodiment terminal JSON v2, and
uses independent S3AU v1 binary framing for half-duplex voice.

The sketch is only the M5/ESP32 adapter. Its portable C++11 pieces are:

- `src/terminal_core/`: terminal protocol, pairing, reconnect, heartbeat and
  S3AU state machine.
- `src/firmware_app/`: one application entrypoint around that core, used by
  the StickS3 adapter and the PC firmware simulator.
- `src/terminal_ui/terminal_view_model.*`: hardware-neutral screen state and
  Chinese product copy shared by device and simulator.
- `src/terminal_ui/lvgl_terminal_scene.*`: the shared LVGL 8 widget tree and
  ViewModel binding, used unchanged by StickS3 and the PC host renderer.
- `src/terminal_ui/lvgl_terminal_ui.*`: the StickS3-only LVGL display driver
  and M5GFX framebuffer flush adapter.

The M5-specific code owns only Wi-Fi, NVS, WebSocketsClient, audio, physical
buttons and the LVGL display driver. It does not keep a second pairing,
reconnect, heartbeat, S3AU or screen-state implementation.

## Build

1. Copy `config.example.h` to ignored `config.h` and set Wi-Fi plus the Runtime
   address. `STICKS3_TERMINAL_ID` and `STICKS3_TERMINAL_TOKEN` are used only
   when this terminal has no NVS credential.
2. Install `M5Unified`, `M5GFX` 0.2.25 or newer, `WebSockets` 2.7.2 or newer,
   and **LVGL 8.3.11** from Arduino Library Manager. Install the bundled,
   pinned ArduinoJson 7.4.3 source under `third_party/ArduinoJson` as an
   Arduino library; do not substitute a different release. The renderer adapts
   M5GFX's official `efontCN_16` into an
   LVGL 8 font at runtime, so the StickS3 and PC renderer share one LVGL scene
   and the same 7,545-glyph Chinese font. The efont source is pinned at
   `third_party/M5GFX`; it is used by the native build while Arduino links the
   matching M5GFX library. The firmware has an explicit LVGL 8 compile guard
   so it cannot silently build against LVGL 9.

`efontCN_16` is copyright (c) 2000-2001 The Electronic Font Open Laboratory
and is distributed under the BSD 3-Clause license. Its complete license text
is retained at `third_party/M5GFX/src/lgfx/Fonts/efont/COPYRIGHT.txt`.
3. Compile:

```text
arduino-cli compile --fqbn m5stack:esp32:m5stack_sticks3 StickS3_Call
```

For `wss://fields.example.com/embodiment/ws`, set the host to `fields.example.com`, port
to `443`, path to `/embodiment/ws`, and TLS to `1`. The firmware verifies the
current ISRG trust chain; do not use an insecure client or a leaf certificate
fingerprint. It first synchronizes its clock through NTP, because certificate
validity cannot be checked with an unset device clock.

## Pairing and credentials

At boot, firmware prefers `terminal_id`, `terminal_token`, and
`terminal_token_version` stored in ESP32 NVS namespace `fields_embodiment`. If
no valid NVS credentials exist, it uses complete compile-time terminal
credentials; if both are absent it connects without credential headers and
enters pairing.

The display shows the six-character Backend pairing code. An Owner claims it
through the Backend Embodiment terminal API. The original WebSocket receives
one credential message, writes it to NVS, and reconnects with `X-Terminal-Id`
plus `X-Terminal-Token`. Firmware sends `terminal.credentials_ack` only after
the NVS write; the Backend activates the terminal only after that
acknowledgement. The token is never printed. Normal disconnections retain NVS
credentials; only an explicit Runtime credential-invalid signal removes them
and starts a new pairing attempt.

The Runtime can deliver a rotated `pairing.credentials` frame while a paired
socket is online. Firmware writes it to NVS first, then sends
`terminal.credentials_ack` with the `terminal_token_version`; this lets the
Backend keep the old token valid if durable delivery fails.

## Controls and audio

- **A** answers an incoming call; while waiting it starts recording; while
  recording it ends and submits the turn.
- **B** declines or ends a call. If used while recording, it first emits the
  terminal audio frame before hanging up.

Audio is 16 kHz mono PCM16LE. Mic capture is 512 samples (1024 bytes). The
firmware defers one capture block so every finished recording emits an S3AU
final frame, including a recording whose last payload is exactly 1024 bytes.
The final frame may contain any even payload length from 2 to 1024 bytes;
empty recordings emit no binary frame. Downlink uses a 16 KiB ring buffer,
plays a final short even-sized payload after the final flag arrives, and sends
`audio.played` only after the speaker queue drains.

## Focused portable check

The portable application and view-model check needs no Arduino toolchain:

```text
g++ -std=c++11 -Wall -Wextra -Werror -I src -I third_party/ArduinoJson/src \
  src/terminal_core/terminal_core.cpp \
  src/firmware_app/firmware_application.cpp \
  src/firmware_app/arduino_json_protocol.cpp \
  src/terminal_ui/terminal_view_model.cpp \
  tests/terminal_view_model_test.cpp \
  -o /tmp/sticks3-terminal-view-model-test && /tmp/sticks3-terminal-view-model-test
```

This is a narrow unit check. Building or flashing the physical device still
uses the Arduino CLI command above and real M5Stack libraries; it never uses a
fake Wi-Fi, TLS, WebSocket or credential fallback.
