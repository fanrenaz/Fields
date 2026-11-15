# StickS3 Embodiment terminal firmware

This flash-package sketch mirrors
[`firmware/StickS3_Call/StickS3_Call.ino`](../../../firmware/StickS3_Call/StickS3_Call.ino).
It speaks Embodiment terminal protocol v2 to the Runtime over one
authenticated WebSocket. S3AU binary frames remain v1.

## Build

1. Copy `config.example.h` to `config.h` and set local Wi-Fi. Keep the terminal
   token empty to use the Owner pairing flow. The production Runtime endpoint
   is preconfigured as `wss://fields.example.com/embodiment/ws`.
2. Install `M5Unified`, `M5GFX`, `ArduinoJson`, and `WebSockets` 2.7.2 or newer.
3. Compile:

```text
arduino-cli compile --fqbn m5stack:esp32:m5stack_sticks3 StickS3_Call
```

## Controls

- **A**: answer an incoming call; while waiting, start recording; while
  recording, stop and submit the turn.
- **B**: decline an incoming call or hang up an active call.

系统状态、按钮提示、通话信息和 Agent 名称均使用中文显示。终端与
Embodiment Runtime 之间的 JSON 事件名保持协议约定的英文，便于机器解析。
