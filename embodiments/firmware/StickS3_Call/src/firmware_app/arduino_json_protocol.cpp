#include "arduino_json_protocol.h"

#include <cstring>

namespace fields {
namespace terminal {
namespace arduino_json {

namespace {

std::string field(JsonVariantConst value) {
  return value.is<const char*>() ? std::string(value.as<const char*>()) : std::string();
}

InboundType inbound_type(const char* type) {
  if (std::strcmp(type, "pairing.code") == 0) return InboundType::PairingCode;
  if (std::strcmp(type, "pairing.credentials") == 0) return InboundType::PairingCredentials;
  if (std::strcmp(type, "pairing.invalid") == 0) return InboundType::PairingInvalid;
  if (std::strcmp(type, "terminal.ready") == 0) return InboundType::TerminalReady;
  if (std::strcmp(type, "system.ping") == 0) return InboundType::SystemPing;
  if (std::strcmp(type, "system.pong") == 0) return InboundType::SystemPong;
  if (std::strcmp(type, "call.incoming") == 0) return InboundType::CallIncoming;
  if (std::strcmp(type, "call.connected") == 0) return InboundType::CallConnected;
  if (std::strcmp(type, "turn.listen") == 0) return InboundType::TurnListen;
  if (std::strcmp(type, "audio.start") == 0) return InboundType::AudioStart;
  if (std::strcmp(type, "audio.end") == 0) return InboundType::AudioEnd;
  if (std::strcmp(type, "call.hangup") == 0) return InboundType::CallHangup;
  if (std::strcmp(type, "call.ended") == 0) return InboundType::CallEnded;
  return InboundType::Unknown;
}

const char* outbound_type(OutboundType type) {
  switch (type) {
    case OutboundType::TerminalHello: return "terminal.hello";
    case OutboundType::PairingHello: return "pairing.hello";
    case OutboundType::SystemPing: return "system.ping";
    case OutboundType::SystemPong: return "system.pong";
    case OutboundType::CallAnswer: return "call.answer";
    case OutboundType::CallDecline: return "call.decline";
    case OutboundType::CallHangup: return "call.hangup";
    case OutboundType::AudioStart: return "audio.start";
    case OutboundType::AudioReady: return "audio.ready";
    case OutboundType::AudioProgress: return "audio.progress";
    case OutboundType::AudioEnd: return "audio.end";
    case OutboundType::TurnComplete: return "turn.complete";
    case OutboundType::AudioPlayed: return "audio.played";
    case OutboundType::CredentialsAck: return "terminal.credentials_ack";
    case OutboundType::TerminalError: return "terminal.error";
  }
  return 0;
}

void terminal_call(JsonDocument* document, const OutboundMessage& message) {
  (*document)["terminal_id"] = message.terminal_id.c_str();
  (*document)["call_id"] = message.call_id.c_str();
}

}  // namespace

bool decode_inbound(const uint8_t* payload, size_t length, InboundMessage* message) {
  if (!payload || !message) return false;
  JsonDocument document;
  if (deserializeJson(document, payload, length)) return false;
  const uint8_t schema_version = document["schema_version"] | 0;
  if (schema_version != kJsonVersion) return false;

  InboundMessage result;
  result.type = inbound_type(document["type"] | "");
  result.event_id = field(document["event_id"]);
  result.ping_event_id = field(document["ping_event_id"]);
  result.terminal_id = field(document["terminal_id"]);
  result.call_id = field(document["call_id"]);
  result.turn_id = field(document["turn_id"]);
  result.pairing_session_id = field(document["pairing_session_id"]);
  result.code = field(document["code"]);
  result.terminal_token = field(document["terminal_token"]);
  result.caller_label = field(document["caller_label"]);
  result.purpose = field(document["purpose"]);
  result.direction = field(document["direction"]);
  result.terminal_token_version = document["terminal_token_version"] | 0;
  result.expires_at_ms = document["expires_at_ms"] | 0;
  result.stream_id = document["stream_id"] | 0;
  *message = result;
  return true;
}

bool encode_outbound(const OutboundMessage& message, JsonDocument* document) {
  if (!document) return false;
  const char* type = outbound_type(message.type);
  if (!type) return false;
  document->clear();
  (*document)["schema_version"] = kJsonVersion;
  (*document)["type"] = type;
  if (!message.event_id.empty()) (*document)["event_id"] = message.event_id.c_str();

  switch (message.type) {
    case OutboundType::PairingHello:
      (*document)["label"] = message.reason.c_str();
      break;
    case OutboundType::TerminalHello: {
      (*document)["terminal_id"] = message.terminal_id.c_str();
      (*document)["boot_id"] = message.boot_id.c_str();
      JsonObject capabilities = (*document)["capabilities"].to<JsonObject>();
      capabilities["audio_input"] = "pcm16le_16000_mono";
      capabilities["audio_output"] = "pcm16le_16000_mono";
      capabilities["max_audio_payload_bytes"] = kAudioMaxPayload;
      capabilities["display"] = true;
      JsonArray buttons = capabilities["buttons"].to<JsonArray>();
      buttons.add("a");
      buttons.add("b");
      break;
    }
    case OutboundType::SystemPing:
      (*document)["sent_at_ms"] = message.sent_at_ms;
      break;
    case OutboundType::SystemPong:
      (*document)["ping_event_id"] = message.ping_event_id.c_str();
      (*document)["sent_at_ms"] = message.sent_at_ms;
      break;
    case OutboundType::CredentialsAck:
      (*document)["terminal_id"] = message.terminal_id.c_str();
      (*document)["terminal_token_version"] = message.terminal_token_version;
      break;
    case OutboundType::CallAnswer:
    case OutboundType::CallDecline:
    case OutboundType::CallHangup:
      terminal_call(document, message);
      break;
    case OutboundType::AudioStart:
      terminal_call(document, message);
      (*document)["turn_id"] = message.turn_id.c_str();
      (*document)["stream_id"] = message.stream_id;
      (*document)["direction"] = message.direction.c_str();
      (*document)["sample_rate_hz"] = kAudioSampleRate;
      (*document)["bits_per_sample"] = 16;
      (*document)["channels"] = 1;
      break;
    case OutboundType::AudioReady:
      terminal_call(document, message);
      (*document)["turn_id"] = message.turn_id.c_str();
      (*document)["stream_id"] = message.stream_id;
      (*document)["buffer_bytes"] = message.buffer_bytes;
      break;
    case OutboundType::AudioProgress:
      terminal_call(document, message);
      (*document)["turn_id"] = message.turn_id.c_str();
      (*document)["stream_id"] = message.stream_id;
      (*document)["received_seq"] = message.sequence;
      break;
    case OutboundType::AudioEnd:
      terminal_call(document, message);
      (*document)["turn_id"] = message.turn_id.c_str();
      (*document)["stream_id"] = message.stream_id;
      (*document)["frame_count"] = message.frame_count;
      (*document)["total_bytes"] = message.total_bytes;
      if (message.final_sequence_present) (*document)["final_seq"] = message.final_sequence;
      else (*document)["final_seq"] = nullptr;
      break;
    case OutboundType::TurnComplete:
      terminal_call(document, message);
      (*document)["turn_id"] = message.turn_id.c_str();
      (*document)["outcome"] = message.outcome.c_str();
      if (message.reason.empty()) (*document)["reason"] = nullptr;
      else (*document)["reason"] = message.reason.c_str();
      break;
    case OutboundType::AudioPlayed:
      terminal_call(document, message);
      (*document)["turn_id"] = message.turn_id.c_str();
      (*document)["stream_id"] = message.stream_id;
      (*document)["status"] = message.status.c_str();
      break;
    case OutboundType::TerminalError:
      (*document)["terminal_id"] = message.terminal_id.c_str();
      (*document)["code"] = message.error_code.c_str();
      (*document)["message"] = message.error_message.c_str();
      if (message.call_id.empty()) (*document)["call_id"] = nullptr;
      else (*document)["call_id"] = message.call_id.c_str();
      if (message.turn_id.empty()) (*document)["turn_id"] = nullptr;
      else (*document)["turn_id"] = message.turn_id.c_str();
      if (message.stream_id == 0) (*document)["stream_id"] = nullptr;
      else (*document)["stream_id"] = message.stream_id;
      (*document)["fatal"] = message.fatal;
      break;
  }
  return true;
}

}  // namespace arduino_json
}  // namespace terminal
}  // namespace fields
