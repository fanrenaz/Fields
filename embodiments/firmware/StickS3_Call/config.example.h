#pragma once

// Copy to config.h (which is ignored by git) and fill in local values.
#define STICKS3_WIFI_SSID "your-wifi"
#define STICKS3_WIFI_PASSWORD "your-password"
#define STICKS3_TERMINAL_TOKEN "replace-with-terminal-token"
#define STICKS3_TERMINAL_ID "sticks3-001"

// Call Runtime terminal WebSocket listener. Use the LAN address of its gateway.
#define STICKS3_EMBODIMENT_HOST "192.168.1.10"
#define STICKS3_EMBODIMENT_PORT 8788
#define STICKS3_EMBODIMENT_PATH "/embodiment/ws"

// A TLS endpoint requires WebSockets 2.7.2+; the firmware pins the current
// fields.example.com ISRG trust chain when this is true.
#define STICKS3_EMBODIMENT_TLS 0
