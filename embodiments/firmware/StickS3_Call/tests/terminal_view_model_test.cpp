#include <assert.h>

#include "../src/firmware_app/arduino_json_protocol.h"
#include "../src/terminal_ui/terminal_view_model.h"

int main() {
  using fields::terminal::CallState;
  using fields::terminal::Snapshot;
  using fields::terminal::ui::RuntimeStatus;
  using fields::terminal::ui::ViewModel;
  using fields::terminal::ui::make_view_model;

  Snapshot pairing;
  pairing.pairing_mode = true;
  pairing.pairing_code = "AB12CD";
  RuntimeStatus runtime;
  runtime.wifi_connected = true;
  ViewModel pairing_view = make_view_model(pairing, runtime);
  assert(pairing_view.pairing);
  assert(pairing_view.primary_label == "AB12CD");
  assert(pairing_view.connection_label == "等待 Owner 认领");
  assert(pairing_view.detail_label == "在 Owner 控制台输入配对码");

  Snapshot recording;
  recording.pairing_mode = false;
  recording.terminal_ready = true;
  recording.call_state = CallState::Recording;
  recording.active_agent_label = "Fields";
  recording.audio_level = 63;
  runtime.recording_elapsed_ms = 12500;
  ViewModel recording_view = make_view_model(recording, runtime);
  assert(recording_view.online);
  assert(recording_view.recording);
  assert(recording_view.state_label == "录音中");
  assert(recording_view.agent_label == "智能体 Fields");
  assert(recording_view.detail_label == "录音 12 / 60 秒");
  assert(recording_view.audio_level == 63);

  runtime.wifi_connected = false;
  ViewModel offline_view = make_view_model(recording, runtime);
  assert(offline_view.connection_label == "正在连接网络");

  fields::terminal::OutboundMessage audio_end;
  audio_end.type = fields::terminal::OutboundType::AudioEnd;
  audio_end.terminal_id = "terminal-123";
  audio_end.call_id = "call-123";
  audio_end.turn_id = "turn-123";
  audio_end.stream_id = 7;
  audio_end.final_sequence_present = false;
  JsonDocument document;
  assert(fields::terminal::arduino_json::encode_outbound(audio_end, &document));
  assert(document["final_seq"].isNull());

  const char pairing_invalid[] =
      "{\"schema_version\":2,\"type\":\"pairing.invalid\",\"code\":\"revoked\"}";
  fields::terminal::InboundMessage inbound;
  assert(fields::terminal::arduino_json::decode_inbound(
      reinterpret_cast<const uint8_t*>(pairing_invalid), sizeof(pairing_invalid) - 1, &inbound));
  assert(inbound.type == fields::terminal::InboundType::PairingInvalid);
  assert(inbound.code == "revoked");
  return 0;
}
