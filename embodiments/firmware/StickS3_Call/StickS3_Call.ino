/*
 * StickS3 Call MVP firmware
 *
 * This sketch is intentionally only the ESP32/M5 adapter.  The portable
 * firmware application owns protocol transitions; the LVGL renderer consumes
 * its shared ViewModel.  No display, browser or log path receives a terminal
 * credential.
 */
#include <Arduino.h>
#include <M5Unified.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>

#include "src/firmware_app/arduino_json_protocol.h"
#include "src/firmware_app/firmware_application.h"
#include "src/terminal_ui/lvgl_terminal_ui.h"
#include "src/terminal_ui/terminal_view_model.h"

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

constexpr uint32_t kAudioSamplesPerFrame = 512;
constexpr uint32_t kWifiRetryMs = 1000;
constexpr uint32_t kTlsClockRetryMs = 5000;
constexpr time_t kTlsMinValidEpoch = 1'704'067'200;  // 2024-01-01 UTC

#if STICKS3_EMBODIMENT_TLS
// ISRG Root X1 verifies the fields.example.com certificate chain.  Do not replace
// it with an insecure client or a rotating leaf-certificate fingerprint.
constexpr char kFieldsProductionRootCa[] = R"PEM(
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

using fields::terminal::Button;
using fields::terminal::Config;
using fields::terminal::Credentials;
using fields::terminal::FirmwareApplication;
using fields::terminal::InboundMessage;
using fields::terminal::OutboundMessage;
using fields::terminal::Ports;
using fields::terminal::Snapshot;
using fields::terminal::TransportCloseReason;
using fields::terminal::ui::LvglTerminalUi;
using fields::terminal::ui::RuntimeStatus;

WebSocketsClient bridge;
Preferences terminal_preferences;
FirmwareApplication* terminal_application = nullptr;
LvglTerminalUi terminal_ui;
RuntimeStatus ui_runtime;

String active_terminal_id;
String active_terminal_token;
uint32_t active_terminal_token_version = 0;
String bridge_headers;
String ui_notice;
uint32_t ui_notice_expires_at = 0;
uint32_t recording_started_at = 0;
uint8_t ui_audio_level = 0;
fields::terminal::CallState last_rendered_call_state = fields::terminal::CallState::Idle;

bool core_socket_pump = false;
bool core_connect_deferred = false;
bool core_wifi_available = false;
bool core_playback_active = false;
bool ignore_next_socket_disconnect = false;
bool tls_clock_waiting = false;
uint32_t wifi_retry_at = 0;
uint32_t tls_clock_retry_at = 0;
int16_t mic_chunk[kAudioSamplesPerFrame];

void start_socket();

bool load_stored_terminal_credentials(Credentials* credentials) {
  if (!credentials || !terminal_preferences.begin("fields_embodiment", true)) return false;
  const String terminal_id = terminal_preferences.getString("terminal_id", "");
  const String terminal_token = terminal_preferences.getString("terminal_token", "");
  const uint32_t token_version = terminal_preferences.getUInt("terminal_token_version", 0);
  terminal_preferences.end();
  if (terminal_id.isEmpty() || terminal_token.isEmpty() || token_version == 0) return false;
  credentials->terminal_id = terminal_id.c_str();
  credentials->terminal_token = terminal_token.c_str();
  credentials->terminal_token_version = token_version;
  if (!credentials->valid()) return false;
  active_terminal_id = terminal_id;
  active_terminal_token = terminal_token;
  active_terminal_token_version = token_version;
  return true;
}

bool save_terminal_credentials(const Credentials& credentials) {
  if (!credentials.valid() || !terminal_preferences.begin("fields_embodiment", false)) return false;
  const String terminal_id(credentials.terminal_id.c_str());
  const String terminal_token(credentials.terminal_token.c_str());
  const bool saved = terminal_preferences.putString("terminal_id", terminal_id) == terminal_id.length() &&
                     terminal_preferences.putString("terminal_token", terminal_token) == terminal_token.length() &&
                     terminal_preferences.putUInt("terminal_token_version", credentials.terminal_token_version) ==
                         sizeof(credentials.terminal_token_version);
  terminal_preferences.end();
  if (!saved) return false;
  active_terminal_id = terminal_id;
  active_terminal_token = terminal_token;
  active_terminal_token_version = credentials.terminal_token_version;
  return true;
}

void clear_stored_terminal_credentials() {
  if (terminal_preferences.begin("fields_embodiment", false)) {
    terminal_preferences.remove("terminal_id");
    terminal_preferences.remove("terminal_token");
    terminal_preferences.remove("terminal_token_version");
    terminal_preferences.end();
  }
  active_terminal_id = "";
  active_terminal_token = "";
  active_terminal_token_version = 0;
}

bool send_document(JsonDocument& document) {
  if (!bridge.isConnected()) return false;
  String text;
  serializeJson(document, text);
  return bridge.sendTXT(text);
}

void set_notice(const char* notice, uint32_t duration_ms = 1800) {
  ui_notice = notice ? notice : "";
  ui_notice_expires_at = millis() + duration_ms;
}

uint8_t pcm_audio_level(const int16_t* samples, size_t count) {
  int32_t peak = 0;
  for (size_t index = 0; index < count; ++index) {
    const int32_t sample = samples[index];
    const int32_t absolute = sample < 0 ? -sample : sample;
    if (absolute > peak) peak = absolute;
  }
  const int32_t scaled = (peak * 100) / 32768;
  return static_cast<uint8_t>(scaled > 100 ? 100 : scaled);
}

class M5TerminalPorts final : public Ports {
 public:
  uint32_t now_ms() const override { return millis(); }
  uint32_t random_u32() override { return esp_random(); }

  bool load_credentials(Credentials* credentials) override {
    return load_stored_terminal_credentials(credentials);
  }

  bool save_credentials(const Credentials& credentials) override {
    return save_terminal_credentials(credentials);
  }

  void clear_credentials() override { clear_stored_terminal_credentials(); }

  void request_connect(const std::string&, const Credentials* credentials) override {
    if (credentials) {
      active_terminal_id = credentials->terminal_id.c_str();
      active_terminal_token = credentials->terminal_token.c_str();
      active_terminal_token_version = credentials->terminal_token_version;
    } else {
      active_terminal_id = "";
      active_terminal_token = "";
      active_terminal_token_version = 0;
    }
    if (WiFi.status() != WL_CONNECTED) {
      core_connect_deferred = true;
      return;
    }
    start_socket();
  }

  void disconnect_transport() override {
    // Keep pumping until WebSocketsClient emits its close callback.  Stopping
    // first drops the callback and leaves the shared reconnect scheduler idle.
    if (bridge.isConnected()) bridge.disconnect();
  }

  bool enqueue_text(const OutboundMessage& message) override {
    JsonDocument document;
    return fields::terminal::arduino_json::encode_outbound(message, &document) && send_document(document);
  }

  bool enqueue_binary(const uint8_t* bytes, size_t length) override {
    return bytes && length && bridge.isConnected() && bridge.sendBIN(const_cast<uint8_t*>(bytes), length);
  }

  void set_capture_enabled(bool enabled) override {
    if (enabled) M5.Mic.begin();
    else M5.Mic.end();
  }

  void stop_playback() override {
    core_playback_active = false;
    M5.Speaker.stop();
  }

  void begin_downlink_audio(uint32_t) override {}
  bool downlink_output_busy() const override { return core_playback_active || M5.Speaker.isPlaying(); }

  void enqueue_downlink_pcm(const int16_t* samples, size_t count) override {
    if (!samples || count == 0) return;
    core_playback_active = true;
    M5.Speaker.playRaw(samples, count, fields::terminal::kAudioSampleRate, false, 1, 0);
  }

  void end_downlink_audio(uint32_t) override {}
  void publish_snapshot(const Snapshot&) override {}

  void publish_safe_event(const char* name, const char* detail) override {
    Serial.printf("[terminal] %s %s\n", name ? name : "", detail ? detail : "");
    if (name && strcmp(name, "recording.limit") == 0) set_notice("录音已达 60 秒");
  }
};

M5TerminalPorts terminal_ports;

void handle_core_json(uint8_t* payload, size_t length) {
  if (!terminal_application) return;
  InboundMessage message;
  if (!fields::terminal::arduino_json::decode_inbound(payload, length, &message)) {
    message.type = fields::terminal::InboundType::Unknown;
  }
  terminal_application->on_message(message);
}

TransportCloseReason close_reason(const uint8_t* payload, size_t length) {
  if (payload && length == sizeof("credential invalid") - 1 &&
      memcmp(payload, "credential invalid", length) == 0) return TransportCloseReason::CredentialInvalid;
  if (payload && length == sizeof("credential revoked") - 1 &&
      memcmp(payload, "credential revoked", length) == 0) return TransportCloseReason::CredentialRevoked;
  return TransportCloseReason::Network;
}

void on_socket_event(WStype_t type, uint8_t* payload, size_t length) {
  if (!terminal_application) return;
  switch (type) {
    case WStype_CONNECTED:
      core_socket_pump = true;
      terminal_application->on_transport_open();
      break;
    case WStype_DISCONNECTED:
      core_socket_pump = false;
      if (ignore_next_socket_disconnect) {
        ignore_next_socket_disconnect = false;
        break;
      }
      terminal_application->on_transport_closed(close_reason(payload, length));
      break;
    case WStype_TEXT:
      handle_core_json(payload, length);
      break;
    case WStype_BIN:
      terminal_application->on_binary(payload, length);
      break;
    case WStype_ERROR:
      Serial.println("[bridge] websocket error");
      break;
    default:
      break;
  }
}

void start_socket() {
#if STICKS3_EMBODIMENT_TLS
  if (time(nullptr) < kTlsMinValidEpoch) {
    tls_clock_waiting = true;
    ui_runtime.tls_clock_ready = false;
    if (millis() >= tls_clock_retry_at) {
      configTime(0, 0, "time.cloudflare.com", "pool.ntp.org");
      tls_clock_retry_at = millis() + kTlsClockRetryMs;
      set_notice("正在校准时间", kTlsClockRetryMs + 500);
    }
    return;
  }
#endif
  tls_clock_waiting = false;
  ui_runtime.tls_clock_ready = true;
  const bool pairing = active_terminal_id.isEmpty() || active_terminal_token.isEmpty();
  bridge_headers = pairing ? "" : String("X-Terminal-Id: ") + active_terminal_id +
                                      "\r\nX-Terminal-Token: " + active_terminal_token;
  bridge.setExtraHeaders(bridge_headers.c_str());
  bridge.onEvent(on_socket_event);
  // TerminalCore is the only reconnect scheduler.  WebSocketsClient must not
  // create a second retry loop behind its back.
  bridge.setReconnectInterval(60000);
#if STICKS3_EMBODIMENT_TLS
  bridge.beginSslWithCA(STICKS3_EMBODIMENT_HOST, STICKS3_EMBODIMENT_PORT,
                        STICKS3_EMBODIMENT_PATH, kFieldsProductionRootCa);
#else
  bridge.begin(STICKS3_EMBODIMENT_HOST, STICKS3_EMBODIMENT_PORT, STICKS3_EMBODIMENT_PATH);
#endif
  core_socket_pump = true;
}

void refresh_ui() {
  if (!terminal_application) return;
  const Snapshot& snapshot = terminal_application->snapshot();
  if (snapshot.call_state == fields::terminal::CallState::Recording &&
      last_rendered_call_state != fields::terminal::CallState::Recording) {
    recording_started_at = millis();
  }
  last_rendered_call_state = snapshot.call_state;
  if (ui_notice.length() && millis() >= ui_notice_expires_at) ui_notice = "";
  ui_runtime.wifi_connected = WiFi.status() == WL_CONNECTED;
  ui_runtime.recording_elapsed_ms = snapshot.call_state == fields::terminal::CallState::Recording
                                        ? millis() - recording_started_at
                                        : 0;
  ui_runtime.audio_level = ui_audio_level;
  ui_runtime.notice = ui_notice.c_str();
  terminal_ui.render(fields::terminal::ui::make_view_model(snapshot, ui_runtime));
  terminal_ui.tick();
}

void setup() {
  auto configuration = M5.config();
  M5.begin(configuration);
  Serial.begin(115200);
  M5.Display.setRotation(1);
  M5.Speaker.setVolume(96);
  terminal_ui.begin(M5.Display);
  Serial.println("\n[boot] StickS3 Call MVP starting");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(STICKS3_WIFI_SSID, STICKS3_WIFI_PASSWORD);
  const uint32_t started_at = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started_at < 10000) {
    M5.update();
    terminal_ui.tick();
    delay(50);
  }
  core_wifi_available = WiFi.status() == WL_CONNECTED;
  wifi_retry_at = millis() + kWifiRetryMs;
  if (!core_wifi_available) set_notice("无线网络未连接", 3000);

  Config config;
  const String scheme = STICKS3_EMBODIMENT_TLS ? "wss://" : "ws://";
  const String endpoint = scheme + STICKS3_EMBODIMENT_HOST + ":" +
                          String(STICKS3_EMBODIMENT_PORT) + STICKS3_EMBODIMENT_PATH;
  config.endpoint = endpoint.c_str();
  config.pairing_label = "M5StickS3";
  config.fallback_credentials.terminal_id = STICKS3_TERMINAL_ID;
  config.fallback_credentials.terminal_token = STICKS3_TERMINAL_TOKEN;
  config.fallback_credentials.terminal_token_version =
      config.fallback_credentials.terminal_token.empty() ? 0 : 1;
  terminal_application = new FirmwareApplication(terminal_ports, config);
  terminal_application->start();
  refresh_ui();
}

void loop() {
  M5.update();
  const bool wifi_available = WiFi.status() == WL_CONNECTED;
  if (!wifi_available) {
    if (core_wifi_available && terminal_application &&
        (terminal_application->snapshot().transport_open || terminal_application->snapshot().connecting)) {
      ignore_next_socket_disconnect = true;
      terminal_application->on_transport_closed(TransportCloseReason::Network);
      if (bridge.isConnected()) bridge.disconnect();
    }
    core_wifi_available = false;
    if (millis() >= wifi_retry_at) {
      WiFi.reconnect();
      wifi_retry_at = millis() + kWifiRetryMs;
      set_notice("正在连接网络", kWifiRetryMs + 250);
    }
  } else {
    if (!core_wifi_available) {
      core_wifi_available = true;
      if (core_connect_deferred && terminal_application) {
        core_connect_deferred = false;
        terminal_application->on_transport_closed(TransportCloseReason::Network);
      }
    }
    if (tls_clock_waiting) {
#if STICKS3_EMBODIMENT_TLS
      if (time(nullptr) >= kTlsMinValidEpoch && terminal_application) {
        tls_clock_waiting = false;
        ui_runtime.tls_clock_ready = true;
        terminal_application->on_transport_closed(TransportCloseReason::Network);
      } else if (millis() >= tls_clock_retry_at) {
        configTime(0, 0, "time.cloudflare.com", "pool.ntp.org");
        tls_clock_retry_at = millis() + kTlsClockRetryMs;
      }
#endif
    }
    if (core_socket_pump) bridge.loop();
  }

  if (terminal_application) {
    if (M5.BtnA.wasPressed()) terminal_application->on_button(Button::A);
    if (M5.BtnB.wasPressed()) terminal_application->on_button(Button::B);
    if (terminal_application->snapshot().call_state == fields::terminal::CallState::Recording &&
        M5.Mic.record(mic_chunk, kAudioSamplesPerFrame, fields::terminal::kAudioSampleRate, false)) {
      ui_audio_level = pcm_audio_level(mic_chunk, kAudioSamplesPerFrame);
      terminal_application->on_uplink_pcm(mic_chunk, kAudioSamplesPerFrame);
    } else if (ui_audio_level > 0) {
      ui_audio_level = static_cast<uint8_t>((ui_audio_level * 4) / 5);
    }
    if (core_playback_active && !M5.Speaker.isPlaying()) {
      core_playback_active = false;
      terminal_application->on_playback_complete();
    }
    terminal_application->tick();
  }
  refresh_ui();
  delay(1);
}
