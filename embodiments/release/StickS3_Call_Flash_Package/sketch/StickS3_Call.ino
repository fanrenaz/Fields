/*
 * StickS3 Call MVP firmware
 *
 * The firmware intentionally keeps a small, explicit implementation of the
 * v2 Embodiment terminal protocol. TypeScript consumers use
 * @fields/contracts/embodiment; this
 * endpoint only needs the stable JSON names and S3AU binary framing.
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <M5Unified.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>

#if __has_include("config.h")
#include "config.h"
#else
#define STICKS3_WIFI_SSID ""
#define STICKS3_WIFI_PASSWORD ""
#define STICKS3_TERMINAL_TOKEN ""
#define STICKS3_TERMINAL_ID "sticks3-dev"
#define STICKS3_EMBODIMENT_HOST "127.0.0.1"
#define STICKS3_EMBODIMENT_PORT 8788
#define STICKS3_EMBODIMENT_PATH "/embodiment/ws"
#define STICKS3_EMBODIMENT_TLS 0
#endif

namespace Protocol {
// Embodiment JSON is deliberately v2. S3AU framing remains independently v1.
constexpr uint8_t JSON_VERSION = 2;
constexpr uint8_t AUDIO_VERSION = 1;
constexpr uint8_t AUDIO_FINAL = 0x01;
constexpr uint16_t AUDIO_HEADER_LENGTH = 20;
constexpr uint16_t AUDIO_MAX_PAYLOAD = 1024;
constexpr uint32_t AUDIO_SAMPLE_RATE = 16000;
constexpr uint32_t AUDIO_SAMPLES_PER_FRAME = 512;
constexpr uint32_t AUDIO_RING_BYTES = 16 * 1024;
constexpr uint32_t AUDIO_PREBUFFER_FRAMES = 8;
constexpr uint32_t AUDIO_MAX_RECORDING_MS = 60 * 1000;
constexpr uint32_t PING_INTERVAL_MS = 15 * 1000;
constexpr uint32_t PONG_TIMEOUT_MS = 5 * 1000;
constexpr uint8_t MAX_PONG_MISSES = 2;
constexpr uint32_t PAIRING_ACK_FLUSH_MS = 500;
constexpr uint32_t TLS_CLOCK_RETRY_MS = 5 * 1000;
constexpr time_t TLS_MIN_VALID_EPOCH = 1'704'067'200;  // 2024-01-01 UTC
constexpr char AUDIO_MAGIC[4] = {'S', '3', 'A', 'U'};
}

#if STICKS3_EMBODIMENT_TLS
// ISRG Root X1 is the trust anchor for the current fields.example.com certificate
// chain. TLS connections must verify this chain rather than using an insecure
// client or a rotating leaf-certificate fingerprint.
constexpr char FIELDS_PRODUCTION_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)PEM";
#endif

WebSocketsClient bridge;
Preferences terminalPreferences;

enum class CallState : uint8_t {
  Idle,
  Ringing,
  ConnectedIdle,
  Playing,
  Waiting,
  Recording,
  Ending,
};

CallState callState = CallState::Idle;
String activeCallId;
String activeTurnId;
String activeAgentLabel;
String activePurpose;
String bootId;
String activeTerminalId;
String activeTerminalToken;
uint32_t activeTerminalTokenVersion = 0;
String pairingSessionId;
String pairingCode;
uint32_t pairingExpiresAtMs = 0;
bool pairingMode = false;
String downlinkStreamId;
String bridgeHeaders;
uint32_t downlinkStream = 0;
uint32_t uplinkStream = 0;
uint32_t uplinkSeq = 0;
uint32_t uplinkFrameCount = 0;
uint32_t uplinkBytes = 0;
uint32_t downlinkExpectedSeq = 0;
uint32_t downlinkFrameCount = 0;
uint32_t downlinkReceivedBytes = 0;
bool downlinkFinalSeen = false;
bool downlinkPlayedSent = false;
// A WebSocket upgrade is not yet a usable Runtime session. This becomes true
// only after the Runtime validates terminal.hello and responds terminal.ready.
bool bridgeConnected = false;
bool bridgeReady = false;
bool helloSent = false;
uint32_t tlsClockRetryAt = 0;
// Do not write an application frame from the WebSocketsClient connection
// callback. With TLS/proxy connections the callback can run while the client
// is still unwinding its upgrade parser; queue hello for the next main-loop
// iteration instead.
bool helloPending = false;
bool socketConnecting = false;
bool bridgeInitialized = false;
bool credentialReconnectPending = false;
uint32_t credentialReconnectAt = 0;
uint32_t wifiRetryAt = 0;
uint32_t reconnectDelayMs = 1000;
uint32_t recordingStartedAt = 0;
uint32_t lastUiDynamicUpdate = 0;
uint32_t uiNoticeExpiresAt = 0;
uint8_t uiAudioLevel = 0;
bool uiNeedsFullRedraw = true;
bool uiHasRendered = false;
CallState lastRenderedCallState = CallState::Idle;
bool lastRenderedBridgeConnected = false;
bool lastRenderedBridgeReady = false;
wl_status_t lastRenderedWifiStatus = WL_IDLE_STATUS;
String lastRenderedAgentLabel;
String lastRenderedCallId;
String lastRenderedPairingCode;
bool lastRenderedPairingMode = false;
String uiNotice;
uint32_t lastPingAt = 0;
uint32_t pingSentAt = 0;
uint8_t missedPongs = 0;
bool pingPending = false;
String pendingPingId;

// A byte ring is used for downlink audio.  It is deliberately >=16 KiB and
// stores payload only; S3AU headers are validated before bytes enter the ring.
uint8_t audioRing[Protocol::AUDIO_RING_BYTES];
size_t ringHead = 0;
size_t ringTail = 0;
size_t ringUsed = 0;
int16_t micChunk[Protocol::AUDIO_SAMPLES_PER_FRAME];
int16_t speakerChunk[Protocol::AUDIO_SAMPLES_PER_FRAME];
uint8_t pendingMicFrame[Protocol::AUDIO_MAX_PAYLOAD];
bool pendingMicFrameReady = false;

void endRecording();
String makeId(const char *prefix);

bool loadStoredTerminalCredentials() {
  if (!terminalPreferences.begin("fields_embodiment", true)) return false;
  const String storedTerminalId = terminalPreferences.getString("terminal_id", "");
  const String storedTerminalToken = terminalPreferences.getString("terminal_token", "");
  const uint32_t storedTokenVersion = terminalPreferences.getUInt("terminal_token_version", 0);
  terminalPreferences.end();
  if (storedTerminalId.isEmpty() || storedTerminalToken.isEmpty() || storedTokenVersion == 0) return false;
  activeTerminalId = storedTerminalId;
  activeTerminalToken = storedTerminalToken;
  activeTerminalTokenVersion = storedTokenVersion;
  return true;
}

bool saveTerminalCredentials(const String &terminalId, const String &terminalToken, uint32_t tokenVersion) {
  if (terminalId.isEmpty() || terminalToken.isEmpty() || tokenVersion == 0) return false;
  if (!terminalPreferences.begin("fields_embodiment", false)) return false;
  const bool saved = terminalPreferences.putString("terminal_id", terminalId) == terminalId.length() &&
                     terminalPreferences.putString("terminal_token", terminalToken) == terminalToken.length() &&
                     terminalPreferences.putUInt("terminal_token_version", tokenVersion) == sizeof(tokenVersion);
  terminalPreferences.end();
  if (!saved) return false;
  activeTerminalId = terminalId;
  activeTerminalToken = terminalToken;
  activeTerminalTokenVersion = tokenVersion;
  return true;
}

void clearStoredTerminalCredentials() {
  if (!terminalPreferences.begin("fields_embodiment", false)) return;
  terminalPreferences.remove("terminal_id");
  terminalPreferences.remove("terminal_token");
  terminalPreferences.remove("terminal_token_version");
  terminalPreferences.end();
}

bool loadTerminalCredentials() {
  if (loadStoredTerminalCredentials()) {
    Serial.println("[credentials] using paired terminal credentials from NVS");
    return true;
  }
  activeTerminalId = STICKS3_TERMINAL_ID;
  activeTerminalToken = STICKS3_TERMINAL_TOKEN;
  activeTerminalTokenVersion = 0;
  if (activeTerminalId.length() && activeTerminalToken.length()) {
    Serial.println("[credentials] using compile-time terminal credentials");
    return true;
  }
  return false;
}

void enterPairingMode() {
  pairingMode = true;
  pairingSessionId = "";
  pairingCode = "";
  pairingExpiresAtMs = 0;
  activeTerminalId = "";
  activeTerminalToken = "";
  activeTerminalTokenVersion = 0;
  bridgeReady = false;
}

const char *stateLabel() {
  switch (callState) {
    case CallState::Idle: return "空闲";
    case CallState::Ringing: return "来电";
    case CallState::ConnectedIdle: return "已接通";
    case CallState::Playing: return "播放中";
    case CallState::Waiting: return "等待说话";
    case CallState::Recording: return "录音中";
    case CallState::Ending: return "正在挂断";
  }
  return "未知";
}

uint16_t uiRgb(uint8_t red, uint8_t green, uint8_t blue) {
  return static_cast<uint16_t>(((red & 0xf8) << 8) |
                               ((green & 0xfc) << 3) |
                               (blue >> 3));
}

uint16_t stateColor() {
  switch (callState) {
    case CallState::Ringing: return uiRgb(255, 190, 0);
    case CallState::Playing: return uiRgb(70, 180, 255);
    case CallState::Recording: return uiRgb(255, 80, 90);
    case CallState::Ending: return uiRgb(255, 140, 40);
    case CallState::ConnectedIdle:
    case CallState::Waiting: return uiRgb(50, 220, 150);
    case CallState::Idle: return uiRgb(130, 140, 155);
  }
  return uiRgb(255, 255, 255);
}

const char *buttonHint() {
  switch (callState) {
    case CallState::Ringing: return "按左键接听   按右键拒接";
    case CallState::Waiting: return "按左键说话   按右键挂断";
    case CallState::Recording: return "按左键停止   按右键挂断";
    case CallState::Playing: return "按右键挂断";
    case CallState::ConnectedIdle: return "按右键挂断";
    case CallState::Ending: return "请稍候";
    case CallState::Idle: return "等待来电";
  }
  return "";
}

uint8_t audioLevel(const int16_t *samples, size_t count) {
  int32_t peak = 0;
  for (size_t i = 0; i < count; ++i) {
    const int32_t sample = samples[i];
    const int32_t absolute = sample < 0 ? -sample : sample;
    if (absolute > peak) peak = absolute;
  }
  const int32_t scaled = (peak * 100) / 32768;
  return static_cast<uint8_t>(scaled > 100 ? 100 : scaled);
}

void drawLevelMeter(int16_t x, int16_t y, int16_t width, int16_t height) {
  const uint16_t background = uiRgb(35, 42, 52);
  const uint16_t foreground = callState == CallState::Recording
                                ? uiRgb(255, 80, 90)
                                : uiRgb(70, 180, 255);
  M5.Display.fillRect(x, y, width, height, background);
  const int16_t fillWidth = static_cast<int16_t>((width * uiAudioLevel) / 100);
  if (fillWidth > 0) M5.Display.fillRect(x, y, fillWidth, height, foreground);
}

void drawAgentAvatar(int16_t centerX, int16_t centerY) {
  const uint16_t accent = stateColor();
  const uint16_t background = uiRgb(25, 30, 40);
  M5.Display.fillCircle(centerX, centerY, 14, background);
  M5.Display.drawCircle(centerX, centerY, 14, accent);
  M5.Display.fillCircle(centerX - 4, centerY - 3, 1, TFT_WHITE);
  M5.Display.fillCircle(centerX + 4, centerY - 3, 1, TFT_WHITE);
  M5.Display.fillRoundRect(centerX - 7, centerY + 3, 14, 5, 2, accent);
  if (bridgeReady) {
    M5.Display.fillCircle(centerX + 10, centerY + 10, 3, uiRgb(50, 220, 150));
  }
}

String truncateUtf8(const String &input, size_t maxCodePoints) {
  String output;
  size_t offset = 0;
  size_t count = 0;
  while (offset < input.length() && count < maxCodePoints) {
    const uint8_t first = static_cast<uint8_t>(input.charAt(offset));
    size_t width = 1;
    if ((first & 0x80) == 0) width = 1;
    else if ((first & 0xe0) == 0xc0) width = 2;
    else if ((first & 0xf0) == 0xe0) width = 3;
    else if ((first & 0xf8) == 0xf0) width = 4;
    if (offset + width > input.length()) break;
    for (size_t i = 0; i < width; ++i) output += input.charAt(offset + i);
    offset += width;
    count++;
  }
  if (offset < input.length()) output += "...";
  return output;
}

void drawAgentName(int16_t x, int16_t y) {
  const String label = activeAgentLabel.length() ? activeAgentLabel : "Fields";
  M5.Display.setFont(&fonts::efontCN_12);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(x, y);
  M5.Display.print("智能体 ");
  M5.Display.print(truncateUtf8(label, 12));
}

String makeId(const char *prefix) {
  char value[40];
  uint32_t a = esp_random();
  uint32_t b = esp_random();
  snprintf(value, sizeof(value), "%s-%08lx%08lx", prefix,
           static_cast<unsigned long>(a), static_cast<unsigned long>(b));
  return String(value);
}

const char *connectionLabel() {
  if (pairingMode) return pairingCode.length() ? "等待 Owner 认领" : "正在请求配对码";
  if (bridgeReady) return "服务在线";
  if (WiFi.status() != WL_CONNECTED) return "正在连接网络";
  if (bridgeConnected || socketConnecting) return "正在连接服务";
  return "服务离线";
}

void drawDynamicUi() {
  const int16_t screenWidth = static_cast<int16_t>(M5.Display.width());
  const uint16_t muted = uiRgb(145, 155, 170);
  const uint16_t accent = stateColor();
  M5.Display.fillRect(0, 84, screenWidth, M5.Display.height() - 84, TFT_BLACK);
  drawLevelMeter(8, 86, screenWidth - 16, 6);

  M5.Display.setFont(&fonts::efontCN_12);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(muted, TFT_BLACK);
  M5.Display.setCursor(8, 96);
  if (pairingMode) {
    M5.Display.print("在 Owner 控制台输入配对码");
  } else if (callState == CallState::Recording) {
    const uint32_t elapsed = min<uint32_t>(millis() - recordingStartedAt, Protocol::AUDIO_MAX_RECORDING_MS);
    M5.Display.print("录音 ");
    M5.Display.print(elapsed / 1000);
    M5.Display.print(" / 60 秒");
  } else if (callState == CallState::Playing) {
    M5.Display.print("正在播放语音");
  } else {
    M5.Display.print("音频就绪");
  }

  M5.Display.setTextColor(pairingMode ? accent : TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(8, 109);
  if (pairingMode) {
    M5.Display.setFont(&fonts::efontCN_16);
    M5.Display.print(pairingCode.length() ? pairingCode : "------");
  } else {
    M5.Display.print(buttonHint());
  }
  if (uiNotice.length()) {
    M5.Display.setFont(&fonts::efontCN_10);
    M5.Display.setTextColor(accent, TFT_BLACK);
    M5.Display.setCursor(8, 123);
    M5.Display.print(truncateUtf8(uiNotice, 20));
  }
}

void renderUi() {
  const int16_t screenWidth = static_cast<int16_t>(M5.Display.width());
  const uint16_t accent = stateColor();
  const uint16_t muted = uiRgb(145, 155, 170);
  const uint16_t panel = uiRgb(20, 25, 32);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextWrap(false);
  M5.Display.fillRect(0, 0, screenWidth, 21, panel);
  M5.Display.setFont(&fonts::efontCN_14);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_WHITE, panel);
  M5.Display.setCursor(8, 4);
  M5.Display.print("语音通话");
  M5.Display.fillCircle(screenWidth - 12, 10, 4,
                        bridgeReady ? uiRgb(50, 220, 150) : uiRgb(100, 110, 120));

  M5.Display.setTextColor(accent, TFT_BLACK);
  M5.Display.setCursor(8, 25);
  M5.Display.print(stateLabel());
  drawAgentName(8, 43);
  drawAgentAvatar(screenWidth - 20, 44);

  M5.Display.setFont(&fonts::efontCN_12);
  M5.Display.setTextColor(bridgeReady ? uiRgb(50, 220, 150) : muted, TFT_BLACK);
  M5.Display.setCursor(8, 59);
  M5.Display.print(connectionLabel());
  if (activeCallId.length()) {
    M5.Display.setTextColor(muted, TFT_BLACK);
    M5.Display.setCursor(8, 72);
    M5.Display.print("通话 ");
    M5.Display.print(activeCallId.substring(0, min<size_t>(10, activeCallId.length())));
  }
  drawDynamicUi();
}

void showStatus(const char *line = nullptr) {
  const uint32_t now = millis();
  if (line != nullptr) {
    uiNotice = line;
    uiNoticeExpiresAt = now + 1800;
    uiNeedsFullRedraw = true;
  } else if (uiNotice.length() && now >= uiNoticeExpiresAt) {
    uiNotice = "";
    uiNeedsFullRedraw = true;
  }

  const wl_status_t wifiStatus = WiFi.status();
  if (!uiHasRendered || callState != lastRenderedCallState ||
      bridgeConnected != lastRenderedBridgeConnected || bridgeReady != lastRenderedBridgeReady ||
      wifiStatus != lastRenderedWifiStatus ||
      activeAgentLabel != lastRenderedAgentLabel || activeCallId != lastRenderedCallId ||
      pairingMode != lastRenderedPairingMode || pairingCode != lastRenderedPairingCode) {
    uiNeedsFullRedraw = true;
  }
  if (uiNeedsFullRedraw) {
    renderUi();
    uiNeedsFullRedraw = false;
    uiHasRendered = true;
    lastRenderedCallState = callState;
    lastRenderedBridgeConnected = bridgeConnected;
    lastRenderedBridgeReady = bridgeReady;
    lastRenderedWifiStatus = wifiStatus;
    lastRenderedAgentLabel = activeAgentLabel;
    lastRenderedCallId = activeCallId;
    lastRenderedPairingMode = pairingMode;
    lastRenderedPairingCode = pairingCode;
    lastUiDynamicUpdate = now;
    return;
  }
  if ((callState == CallState::Recording || callState == CallState::Playing) &&
      now - lastUiDynamicUpdate >= 200) {
    drawDynamicUi();
    lastUiDynamicUpdate = now;
  }
}

void commonEvent(JsonDocument &doc, const char *type) {
  doc["schema_version"] = Protocol::JSON_VERSION;
  doc["type"] = type;
  doc["event_id"] = makeId("evt");
}

bool sendDocument(JsonDocument &doc) {
  if (!bridgeConnected || !bridge.isConnected()) return false;
  String text;
  serializeJson(doc, text);
  return bridge.sendTXT(text);
}

bool sendHello() {
  JsonDocument doc;
  commonEvent(doc, "terminal.hello");
  doc["terminal_id"] = activeTerminalId;
  doc["boot_id"] = bootId;
  JsonObject caps = doc["capabilities"].to<JsonObject>();
  caps["audio_input"] = "pcm16le_16000_mono";
  caps["audio_output"] = "pcm16le_16000_mono";
  caps["max_audio_payload_bytes"] = Protocol::AUDIO_MAX_PAYLOAD;
  caps["display"] = true;
  JsonArray buttons = caps["buttons"].to<JsonArray>();
  buttons.add("a");
  buttons.add("b");
  const bool sent = sendDocument(doc);
  helloSent = sent;
  Serial.printf("[bridge] terminal.hello %s (%u bytes)\n", sent ? "queued" : "send failed",
                static_cast<unsigned>(measureJson(doc)));
  return sent;
}

bool sendPairingHello() {
  if (!pairingMode) return false;
  JsonDocument doc;
  doc["schema_version"] = Protocol::JSON_VERSION;
  doc["type"] = "pairing.hello";
  doc["label"] = "M5StickS3";
  return sendDocument(doc);
}

void sendPong(const char *eventId) {
  JsonDocument doc;
  commonEvent(doc, "system.pong");
  doc["ping_event_id"] = eventId;
  doc["sent_at_ms"] = millis();
  sendDocument(doc);
}

void sendPing() {
  JsonDocument doc;
  commonEvent(doc, "system.ping");
  doc["sent_at_ms"] = millis();
  pendingPingId = doc["event_id"].as<String>();
  pingSentAt = millis();
  pingPending = true;
  sendDocument(doc);
}

void sendCallAction(const char *type) {
  if (activeCallId.length() == 0) return;
  JsonDocument doc;
  commonEvent(doc, type);
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  sendDocument(doc);
}

void sendAudioStart(const char *direction) {
  JsonDocument doc;
  commonEvent(doc, "audio.start");
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  doc["turn_id"] = activeTurnId;
  doc["stream_id"] = direction[0] == 'u' ? uplinkStream : downlinkStream;
  doc["direction"] = direction;
  doc["sample_rate_hz"] = Protocol::AUDIO_SAMPLE_RATE;
  doc["bits_per_sample"] = 16;
  doc["channels"] = 1;
  sendDocument(doc);
}

void sendAudioReady(uint32_t stream) {
  JsonDocument doc;
  commonEvent(doc, "audio.ready");
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  doc["turn_id"] = activeTurnId;
  doc["stream_id"] = stream;
  doc["buffer_bytes"] = Protocol::AUDIO_RING_BYTES;
  sendDocument(doc);
}

void sendAudioProgress(uint32_t stream, uint32_t seq) {
  JsonDocument doc;
  commonEvent(doc, "audio.progress");
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  doc["turn_id"] = activeTurnId;
  doc["stream_id"] = stream;
  doc["received_seq"] = seq;
  sendDocument(doc);
}

void sendAudioEnd(uint32_t stream, uint32_t frames, uint32_t bytes, int32_t finalSeq) {
  JsonDocument doc;
  commonEvent(doc, "audio.end");
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  doc["turn_id"] = activeTurnId;
  doc["stream_id"] = stream;
  doc["frame_count"] = frames;
  doc["total_bytes"] = bytes;
  if (finalSeq < 0) doc["final_seq"] = nullptr;
  else doc["final_seq"] = finalSeq;
  sendDocument(doc);
}

void sendTurnComplete(const char *outcome, const char *reason = nullptr) {
  JsonDocument doc;
  commonEvent(doc, "turn.complete");
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  doc["turn_id"] = activeTurnId;
  doc["outcome"] = outcome;
  if (reason == nullptr) doc["reason"] = nullptr;
  else doc["reason"] = reason;
  sendDocument(doc);
}

void sendAudioPlayed(uint32_t stream, const char *status) {
  JsonDocument doc;
  commonEvent(doc, "audio.played");
  doc["terminal_id"] = activeTerminalId;
  doc["call_id"] = activeCallId;
  doc["turn_id"] = activeTurnId;
  doc["stream_id"] = stream;
  doc["status"] = status;
  sendDocument(doc);
}

bool sendTerminalCredentialsAck(uint32_t tokenVersion) {
  JsonDocument doc;
  commonEvent(doc, "terminal.credentials_ack");
  doc["terminal_id"] = activeTerminalId;
  doc["terminal_token_version"] = tokenVersion;
  return sendDocument(doc);
}

void sendError(const char *code, const char *message, bool fatal = false) {
  JsonDocument doc;
  commonEvent(doc, "terminal.error");
  doc["terminal_id"] = activeTerminalId;
  doc["code"] = code;
  doc["message"] = message;
  if (activeCallId.length()) doc["call_id"] = activeCallId;
  else doc["call_id"] = nullptr;
  if (activeTurnId.length()) doc["turn_id"] = activeTurnId;
  else doc["turn_id"] = nullptr;
  uint32_t stream = downlinkStream ? downlinkStream : uplinkStream;
  if (stream) doc["stream_id"] = stream;
  else doc["stream_id"] = nullptr;
  doc["fatal"] = fatal;
  sendDocument(doc);
}

void logWifiState(const char *prefix) {
  String ip = WiFi.localIP().toString();
  Serial.printf("[%s] wifi_status=%d ip=%s bridge=%s:%u\n", prefix,
                static_cast<int>(WiFi.status()), ip.c_str(), STICKS3_EMBODIMENT_HOST,
                static_cast<unsigned>(STICKS3_EMBODIMENT_PORT));
}

void clearAudio() {
  ringHead = ringTail = ringUsed = 0;
  downlinkStream = 0;
  downlinkExpectedSeq = 0;
  downlinkFrameCount = 0;
  downlinkReceivedBytes = 0;
  downlinkFinalSeen = false;
  downlinkPlayedSent = false;
  uiAudioLevel = 0;
  M5.Speaker.stop();
}

void finishCallLocally() {
  M5.Speaker.stop();
  M5.Mic.end();
  clearAudio();
  activeCallId = "";
  activeTurnId = "";
  activeAgentLabel = "";
  activePurpose = "";
  callState = CallState::Idle;
  showStatus("等待来电");
}

bool ringPush(const uint8_t *data, size_t length) {
  if (length > Protocol::AUDIO_RING_BYTES - ringUsed) return false;
  size_t first = length < static_cast<size_t>(Protocol::AUDIO_RING_BYTES - ringTail)
                     ? length : static_cast<size_t>(Protocol::AUDIO_RING_BYTES - ringTail);
  memcpy(audioRing + ringTail, data, first);
  if (length > first) memcpy(audioRing, data + first, length - first);
  ringTail = (ringTail + length) % Protocol::AUDIO_RING_BYTES;
  ringUsed += length;
  return true;
}

bool ringPop(uint8_t *data, size_t length) {
  if (length > ringUsed) return false;
  size_t first = length < static_cast<size_t>(Protocol::AUDIO_RING_BYTES - ringHead)
                     ? length : static_cast<size_t>(Protocol::AUDIO_RING_BYTES - ringHead);
  memcpy(data, audioRing + ringHead, first);
  if (length > first) memcpy(data + first, audioRing, length - first);
  ringHead = (ringHead + length) % Protocol::AUDIO_RING_BYTES;
  ringUsed -= length;
  return true;
}

uint32_t readU32LE(const uint8_t *p) {
  return static_cast<uint32_t>(p[0]) |
         (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}

void writeU16LE(uint8_t *p, uint16_t value) {
  p[0] = static_cast<uint8_t>(value & 0xff);
  p[1] = static_cast<uint8_t>((value >> 8) & 0xff);
}

void writeU32LE(uint8_t *p, uint32_t value) {
  p[0] = static_cast<uint8_t>(value & 0xff);
  p[1] = static_cast<uint8_t>((value >> 8) & 0xff);
  p[2] = static_cast<uint8_t>((value >> 16) & 0xff);
  p[3] = static_cast<uint8_t>((value >> 24) & 0xff);
}

bool validateAudioFrame(const uint8_t *data, size_t length,
                        uint32_t &stream, uint32_t &seq, uint8_t &flags,
                        uint32_t &payloadLength) {
  if (length < Protocol::AUDIO_HEADER_LENGTH || memcmp(data, Protocol::AUDIO_MAGIC, 4) != 0) return false;
  if (data[4] != Protocol::AUDIO_VERSION || (data[5] & ~Protocol::AUDIO_FINAL) != 0) return false;
  if (data[6] != 20 || data[7] != 0) return false;
  stream = readU32LE(data + 8);
  seq = readU32LE(data + 12);
  payloadLength = readU32LE(data + 16);
  flags = data[5];
  if (stream == 0 || payloadLength == 0 || payloadLength > Protocol::AUDIO_MAX_PAYLOAD || (payloadLength & 1) != 0) return false;
  if (length != Protocol::AUDIO_HEADER_LENGTH + payloadLength) return false;
  if ((flags & Protocol::AUDIO_FINAL) == 0 && payloadLength != Protocol::AUDIO_MAX_PAYLOAD) return false;
  return true;
}

bool sendUplinkFrame(const uint8_t *pcm, uint32_t payloadLength, bool final) {
  if (payloadLength == 0 || payloadLength > Protocol::AUDIO_MAX_PAYLOAD || (payloadLength & 1) != 0) return false;
  if (!final && payloadLength != Protocol::AUDIO_MAX_PAYLOAD) return false;
  uint8_t frame[Protocol::AUDIO_HEADER_LENGTH + Protocol::AUDIO_MAX_PAYLOAD];
  memcpy(frame, Protocol::AUDIO_MAGIC, 4);
  frame[4] = Protocol::AUDIO_VERSION;
  frame[5] = final ? Protocol::AUDIO_FINAL : 0;
  writeU16LE(frame + 6, Protocol::AUDIO_HEADER_LENGTH);
  writeU32LE(frame + 8, uplinkStream);
  writeU32LE(frame + 12, uplinkSeq);
  writeU32LE(frame + 16, payloadLength);
  memcpy(frame + Protocol::AUDIO_HEADER_LENGTH, pcm, payloadLength);
  if (!bridge.sendBIN(frame, Protocol::AUDIO_HEADER_LENGTH + payloadLength)) {
    Serial.println("[bridge] uplink audio send failed; closing websocket");
    bridge.disconnect();
    return false;
  }
  uplinkSeq++;
  uplinkFrameCount++;
  uplinkBytes += payloadLength;
  if ((uplinkFrameCount % 8) == 0) sendAudioProgress(uplinkStream, uplinkSeq - 1);
  return true;
}

void sendMicFrame() {
  if (callState != CallState::Recording || M5.Speaker.isPlaying()) return;
  if (!M5.Mic.record(micChunk, Protocol::AUDIO_SAMPLES_PER_FRAME,
                     Protocol::AUDIO_SAMPLE_RATE, false)) {
    sendError("internal_error", "microphone capture failed");
    endRecording();
    return;
  }
  uiAudioLevel = audioLevel(micChunk, Protocol::AUDIO_SAMPLES_PER_FRAME);
  // Hold one complete capture block until recording stops. That guarantees
  // the protocol's final flag appears on the actual last S3AU frame, even
  // when a turn ends exactly on a 1024-byte boundary.
  if (pendingMicFrameReady && !sendUplinkFrame(pendingMicFrame, Protocol::AUDIO_MAX_PAYLOAD, false)) return;
  memcpy(pendingMicFrame, micChunk, Protocol::AUDIO_MAX_PAYLOAD);
  pendingMicFrameReady = true;
}

void beginRecording() {
  if (callState != CallState::Waiting || activeCallId.length() == 0) return;
  if (M5.Speaker.isPlaying()) return;
  uplinkStream = esp_random();
  if (uplinkStream == 0) uplinkStream = 1;
  uplinkSeq = 0;
  uplinkFrameCount = 0;
  uplinkBytes = 0;
  pendingMicFrameReady = false;
  recordingStartedAt = millis();
  M5.Mic.begin();
  sendAudioStart("uplink");
  sendAudioReady(uplinkStream);
  callState = CallState::Recording;
  showStatus("按左键停止录音");
}

void endRecording() {
  if (callState != CallState::Recording) return;
  M5.Mic.end();
  if (pendingMicFrameReady) {
    sendUplinkFrame(pendingMicFrame, Protocol::AUDIO_MAX_PAYLOAD, true);
    pendingMicFrameReady = false;
  }
  sendAudioEnd(uplinkStream, uplinkFrameCount, uplinkBytes,
              uplinkSeq == 0 ? -1 : static_cast<int32_t>(uplinkSeq - 1));
  sendTurnComplete(uplinkFrameCount == 0 ? "no_speech" : "replied");
  callState = CallState::Waiting;
  showStatus("正在上传");
}

void playDownlinkIfReady() {
  if (callState != CallState::Playing || downlinkPlayedSent) return;
  const bool prebuffered = ringUsed >= Protocol::AUDIO_PREBUFFER_FRAMES * Protocol::AUDIO_MAX_PAYLOAD;
  const bool hasFullFrame = ringUsed >= Protocol::AUDIO_MAX_PAYLOAD &&
                            (prebuffered || downlinkFinalSeen);
  const bool hasFinalTail = downlinkFinalSeen && ringUsed > 0 &&
                            ringUsed < Protocol::AUDIO_MAX_PAYLOAD;
  if (!M5.Speaker.isPlaying() && (hasFullFrame || hasFinalTail)) {
    const size_t bytesToPlay = hasFullFrame ? Protocol::AUDIO_MAX_PAYLOAD : ringUsed;
    if (ringPop(reinterpret_cast<uint8_t *>(speakerChunk), bytesToPlay)) {
      const size_t samplesToPlay = bytesToPlay / sizeof(int16_t);
      uiAudioLevel = audioLevel(speakerChunk, samplesToPlay);
      M5.Speaker.playRaw(speakerChunk, samplesToPlay,
                         Protocol::AUDIO_SAMPLE_RATE, false, 1, -1, false);
    }
  }
  if (downlinkFinalSeen && ringUsed == 0 && !M5.Speaker.isPlaying()) {
    sendAudioPlayed(downlinkStream, "played");
    downlinkPlayedSent = true;
    callState = CallState::Waiting;
    showStatus("按左键开始说话");
  }
}

void handleAudioFrame(uint8_t *payload, size_t length) {
  uint32_t stream = 0, seq = 0, payloadLength = 0;
  uint8_t flags = 0;
  if (!validateAudioFrame(payload, length, stream, seq, flags, payloadLength) ||
      stream != downlinkStream || seq != downlinkExpectedSeq) {
    sendError("invalid_audio_frame", "unexpected audio frame");
    return;
  }
  if (!ringPush(payload + Protocol::AUDIO_HEADER_LENGTH, payloadLength)) {
    sendError("invalid_audio_frame", "audio ring buffer full");
    return;
  }
  downlinkExpectedSeq++;
  downlinkFrameCount++;
  downlinkReceivedBytes += payloadLength;
  if ((flags & Protocol::AUDIO_FINAL) != 0) downlinkFinalSeen = true;
  if ((downlinkFrameCount % 8) == 0) sendAudioProgress(stream, seq);
}

bool isForThisTerminal(JsonDocument &doc) {
  return activeTerminalId == (doc["terminal_id"] | "");
}

bool isForActiveCall(JsonDocument &doc, bool requireTurn = false) {
  if (!isForThisTerminal(doc) || activeCallId.length() == 0 ||
      activeCallId != (doc["call_id"] | "")) return false;
  return !requireTurn || (activeTurnId.length() > 0 && activeTurnId == (doc["turn_id"] | ""));
}

void handleJson(uint8_t *payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    sendError("invalid_message", "invalid JSON");
    return;
  }
  const char *type = doc["type"] | "";
  const uint8_t version = doc["schema_version"] | 0;
  if (version != Protocol::JSON_VERSION) {
    sendError("unsupported_version", "unsupported schema version", true);
    return;
  }
  if (strcmp(type, "pairing.code") == 0) {
    if (!pairingMode) return;
    const String sessionId = doc["pairing_session_id"] | "";
    const String code = doc["code"] | "";
    if (sessionId.length() < 16 || code.length() != 6) {
      showStatus("配对码无效");
      return;
    }
    pairingSessionId = sessionId;
    pairingCode = code;
    pairingExpiresAtMs = doc["expires_at_ms"] | 0;
    showStatus("请认领配对码");
    return;
  }
  if (strcmp(type, "pairing.credentials") == 0) {
    const String pairedTerminalId = doc["terminal_id"] | "";
    const String pairedTerminalToken = doc["terminal_token"] | "";
    const uint32_t tokenVersion = doc["terminal_token_version"] | 0;
    if (!saveTerminalCredentials(pairedTerminalId, pairedTerminalToken, tokenVersion)) {
      showStatus("保存配对凭据失败");
      return;
    }
    if (!pairingMode) {
      if (!sendTerminalCredentialsAck(tokenVersion)) {
        showStatus("发送凭据确认失败");
        return;
      }
      showStatus("终端凭据已更新");
      return;
    }
    // Acknowledge only after NVS commit, before reconnecting with the new
    // credential. Give the frame time to leave the TLS socket before closing
    // the pairing connection and reopening with the persisted credential.
    if (!sendTerminalCredentialsAck(tokenVersion)) {
      clearStoredTerminalCredentials();
      enterPairingMode();
      showStatus("发送配对确认失败");
      return;
    }
    pairingMode = false;
    pairingCode = "";
    pairingExpiresAtMs = 0;
    credentialReconnectAt = millis() + Protocol::PAIRING_ACK_FLUSH_MS;
    credentialReconnectPending = true;
    showStatus("配对完成，正在连接");
    return;
  }
  if (strcmp(type, "pairing.invalid") == 0) {
    const String code = doc["code"] | "";
    if (code == "credential_invalid" || code == "revoked") clearStoredTerminalCredentials();
    enterPairingMode();
    bridgeInitialized = false;
    bridge.disconnect();
    showStatus("配对已失效，正在重试");
    return;
  }
  if (strcmp(type, "terminal.ready") == 0) {
    // terminal.ready is a Runtime acknowledgement; there is no response event.
    helloSent = true;
    bridgeReady = true;
    // Only a completed protocol handshake marks a connection healthy enough
    // to reset exponential reconnect backoff.
    reconnectDelayMs = 1000;
    Serial.println("[bridge] terminal.ready received; Runtime session is ready");
    showStatus("服务在线");
    return;
  }
  if (strcmp(type, "system.ping") == 0) {
    sendPong(doc["event_id"] | "");
    return;
  }
  if (strcmp(type, "system.pong") == 0) {
    const char *pingId = doc["ping_event_id"] | "";
    if (pendingPingId == pingId) {
      pingPending = false;
      missedPongs = 0;
    }
    return;
  }
  if (strcmp(type, "call.incoming") == 0) {
    if (!isForThisTerminal(doc) || strlen(doc["call_id"] | "") == 0) {
      sendError("invalid_message", "invalid incoming call");
      return;
    }
    if (callState != CallState::Idle) {
      sendError("invalid_state", "terminal is already in a call");
      return;
    }
    activeCallId = doc["call_id"] | "";
    activeAgentLabel = doc["caller_label"] | "Fields";
    activePurpose = doc["purpose"] | "";
    callState = CallState::Ringing;
    showStatus("按左键接听或按右键拒接");
    return;
  }
  if (strcmp(type, "call.connected") == 0) {
    if (!isForActiveCall(doc)) return;
    callState = CallState::ConnectedIdle;
    showStatus("通话已接通");
    return;
  }
  if (strcmp(type, "turn.listen") == 0) {
    if (!isForActiveCall(doc) || strlen(doc["turn_id"] | "") == 0) return;
    activeTurnId = doc["turn_id"] | "";
    callState = CallState::Waiting;
    showStatus("按左键开始说话");
    return;
  }
  if (strcmp(type, "audio.start") == 0 && strcmp(doc["direction"] | "", "downlink") == 0) {
    if (!isForActiveCall(doc, true) || (doc["stream_id"] | 0) == 0) return;
    downlinkStream = doc["stream_id"] | 0;
    clearAudio();
    downlinkStream = doc["stream_id"] | 0;
    callState = CallState::Playing;
    sendAudioReady(downlinkStream);
    showStatus("正在播放");
    return;
  }
  if (strcmp(type, "audio.end") == 0 && callState == CallState::Playing) {
    if (!isForActiveCall(doc, true) || (doc["stream_id"] | 0) != downlinkStream) return;
    downlinkFinalSeen = true;
    playDownlinkIfReady();
    return;
  }
  if (strcmp(type, "call.hangup") == 0 || strcmp(type, "call.ended") == 0) {
    if (!isForActiveCall(doc)) return;
    finishCallLocally();
    return;
  }
}

void onSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      bridgeConnected = true;
      bridgeReady = false;
      socketConnecting = false;
      missedPongs = 0;
      pingPending = false;
      helloSent = false;
      helloPending = true;
      Serial.println(pairingMode ? "[pairing] websocket connected; pairing hello queued" : "[bridge] websocket connected; terminal hello queued");
      showStatus("已连接");
      break;
    case WStype_DISCONNECTED: {
      bridgeConnected = false;
      bridgeReady = false;
      helloSent = false;
      helloPending = false;
      socketConnecting = true;
      const bool credentialInvalidated = payload != nullptr &&
          ((length == sizeof("credential invalid") - 1 && memcmp(payload, "credential invalid", length) == 0) ||
           (length == sizeof("credential revoked") - 1 && memcmp(payload, "credential revoked", length) == 0));
      if (!pairingMode && credentialInvalidated) {
        clearStoredTerminalCredentials();
        enterPairingMode();
        bridgeInitialized = false;
      }
      if (callState != CallState::Idle) finishCallLocally();
      const uint32_t retryDelay = reconnectDelayMs + random(0, 1000);
      bridge.setReconnectInterval(retryDelay);
      reconnectDelayMs = min<uint32_t>(reconnectDelayMs * 2, 30000);
      Serial.printf("[bridge] websocket disconnected: %.*s; retry in %lu ms\n",
                    static_cast<int>(length), payload == nullptr ? "" : reinterpret_cast<const char *>(payload),
                    static_cast<unsigned long>(retryDelay));
      showStatus("正在重连");
      break;
    }
    case WStype_ERROR:
      Serial.printf("[bridge] websocket error: %.*s\n", static_cast<int>(length),
                    payload == nullptr ? "" : reinterpret_cast<const char *>(payload));
      break;
    case WStype_TEXT:
      handleJson(payload, length);
      break;
    case WStype_BIN:
      handleAudioFrame(payload, length);
      break;
    default:
      break;
  }
}

void startSocket() {
#if STICKS3_EMBODIMENT_TLS
  if (time(nullptr) < Protocol::TLS_MIN_VALID_EPOCH) {
    if (millis() >= tlsClockRetryAt) {
      configTime(0, 0, "time.cloudflare.com", "pool.ntp.org");
      tlsClockRetryAt = millis() + Protocol::TLS_CLOCK_RETRY_MS;
      Serial.println("[tls] waiting for NTP clock synchronization");
      showStatus("正在校准时间");
    }
    return;
  }
#endif
  Serial.printf("[bridge] connecting to ws://%s:%u%s\n", STICKS3_EMBODIMENT_HOST,
                static_cast<unsigned>(STICKS3_EMBODIMENT_PORT), STICKS3_EMBODIMENT_PATH);
  // WebSocketsClient retains this pointer and appends its own CRLF after the
  // extra-header block. Do not include a trailing CRLF here: that would end
  // the HTTP upgrade early and make its following User-Agent look like a
  // malformed WebSocket frame to the Runtime.
  if (pairingMode) bridgeHeaders = "";
  else bridgeHeaders = String("X-Terminal-Id: ") + activeTerminalId + "\r\nX-Terminal-Token: " + activeTerminalToken;
  bridge.setExtraHeaders(bridgeHeaders.c_str());
#if STICKS3_EMBODIMENT_TLS
  bridge.beginSslWithCA(STICKS3_EMBODIMENT_HOST, STICKS3_EMBODIMENT_PORT,
                        STICKS3_EMBODIMENT_PATH, FIELDS_PRODUCTION_ROOT_CA);
#else
  bridge.begin(STICKS3_EMBODIMENT_HOST, STICKS3_EMBODIMENT_PORT, STICKS3_EMBODIMENT_PATH);
#endif
  bridge.onEvent(onSocketEvent);
  // Keep the library's own retry timer aligned with the explicit
  // 1/2/4/8/16/30-second backoff below.
  bridge.setReconnectInterval(reconnectDelayMs);
  socketConnecting = true;
  bridgeInitialized = true;
}

void handleButtons() {
  if (M5.BtnA.wasPressed()) {
    if (callState == CallState::Ringing) {
      sendCallAction("call.answer");
      callState = CallState::ConnectedIdle;
      showStatus("正在接听");
    } else if (callState == CallState::Waiting) {
      beginRecording();
    } else if (callState == CallState::Recording) {
      endRecording();
    }
  }
  if (M5.BtnB.wasPressed()) {
    if (callState == CallState::Ringing) {
      sendCallAction("call.decline");
      finishCallLocally();
    } else if (callState != CallState::Idle) {
      if (callState == CallState::Recording) endRecording();
      sendCallAction("call.hangup");
      callState = CallState::Ending;
      showStatus("正在挂断");
    }
  }
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Speaker.setVolume(96);
  randomSeed(esp_random());
  bootId = makeId("boot");
  if (!loadTerminalCredentials()) enterPairingMode();
  Serial.println("\n[boot] StickS3 Call MVP starting");
  showStatus("正在启动");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  Serial.printf("[wifi] connecting to configured network\n");
  WiFi.begin(STICKS3_WIFI_SSID, STICKS3_WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 10000) {
    delay(50);
    M5.update();
  }
  if (WiFi.status() == WL_CONNECTED) {
    logWifiState("wifi connected");
    startSocket();
  } else {
    wifiRetryAt = millis() + 1000;
    logWifiState("wifi initial connection failed");
    showStatus("无线网络未连接");
  }
}

void loop() {
  M5.update();
  if (WiFi.status() != WL_CONNECTED) {
    bridgeConnected = false;
    bridgeReady = false;
    socketConnecting = false;
    if (millis() >= wifiRetryAt) {
      WiFi.reconnect();
      wifiRetryAt = millis() + reconnectDelayMs + random(0, 1000);
      logWifiState("wifi reconnect requested");
      showStatus("正在连接网络");
    }
  } else {
    if (!bridgeInitialized) startSocket();
    bridge.loop();
    if (bridgeConnected && helloPending) {
      helloPending = false;
      if (pairingMode) sendPairingHello();
      else sendHello();
    }
  }

  if (credentialReconnectPending &&
      static_cast<int32_t>(millis() - credentialReconnectAt) >= 0) {
    credentialReconnectPending = false;
    bridgeInitialized = false;
    bridge.disconnect();
  }

  if (bridgeConnected && millis() - lastPingAt >= Protocol::PING_INTERVAL_MS) {
    lastPingAt = millis();
    if (pingPending && millis() - pingSentAt >= Protocol::PONG_TIMEOUT_MS) {
      missedPongs++;
      pingPending = false;
      if (missedPongs >= Protocol::MAX_PONG_MISSES) bridge.disconnect();
    }
    sendPing();
  }
  if (pingPending && millis() - pingSentAt >= Protocol::PONG_TIMEOUT_MS) {
    missedPongs++;
    pingPending = false;
    if (missedPongs >= Protocol::MAX_PONG_MISSES) bridge.disconnect();
  }

  handleButtons();
  if (callState == CallState::Recording) {
    if (millis() - recordingStartedAt >= Protocol::AUDIO_MAX_RECORDING_MS) endRecording();
    else sendMicFrame();
  }
  playDownlinkIfReady();
  showStatus();
  delay(1);
}
