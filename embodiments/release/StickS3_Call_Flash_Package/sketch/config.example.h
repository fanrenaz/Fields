#pragma once

// Copy this file to config.h before compiling. config.h is intentionally not
// included in the distributed source package because it contains local Wi-Fi
// and terminal credentials.
#define STICKS3_WIFI_SSID "your-wifi"
#define STICKS3_WIFI_PASSWORD "your-password"

// Leave empty for the Owner pairing flow. Paired credentials are persisted in
// ESP32 NVS after the device displays and the Owner claims its pairing code.
#define STICKS3_TERMINAL_TOKEN ""
#define STICKS3_TERMINAL_ID "sticks3-001"

// Canonical production Embodiment Runtime endpoint.
#define STICKS3_EMBODIMENT_HOST "fields.example.com"
#define STICKS3_EMBODIMENT_PORT 443
#define STICKS3_EMBODIMENT_PATH "/embodiment/ws"
#define STICKS3_EMBODIMENT_TLS 1
