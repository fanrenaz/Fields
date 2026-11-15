#include "terminal_core.h"

#include <algorithm>
#include <cstring>
#include <sstream>

namespace fields {
namespace terminal {

namespace {

uint32_t read_u32_le(const uint8_t* value) {
  return static_cast<uint32_t>(value[0]) |
      (static_cast<uint32_t>(value[1]) << 8) |
      (static_cast<uint32_t>(value[2]) << 16) |
      (static_cast<uint32_t>(value[3]) << 24);
}

void write_u16_le(uint8_t* value, uint16_t number) {
  value[0] = static_cast<uint8_t>(number & 0xff);
  value[1] = static_cast<uint8_t>((number >> 8) & 0xff);
}

void write_u32_le(uint8_t* value, uint32_t number) {
  value[0] = static_cast<uint8_t>(number & 0xff);
  value[1] = static_cast<uint8_t>((number >> 8) & 0xff);
  value[2] = static_cast<uint8_t>((number >> 16) & 0xff);
  value[3] = static_cast<uint8_t>((number >> 24) & 0xff);
}

bool reached(uint32_t now, uint32_t due) {
  return static_cast<int32_t>(now - due) >= 0;
}

bool valid_pairing_code(const std::string& code) {
  if (code.size() != 6) return false;
  for (size_t index = 0; index < code.size(); ++index) {
    const char character = code[index];
    if (!((character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9'))) return false;
  }
  return true;
}

}  // namespace

InboundMessage::InboundMessage()
    : type(InboundType::Unknown), terminal_token_version(0), expires_at_ms(0), stream_id(0) {}

Credentials::Credentials() : terminal_token_version(0) {}

bool Credentials::valid() const {
  return !terminal_id.empty() && terminal_token.size() >= 32 && terminal_token_version > 0;
}

void Credentials::clear() {
  terminal_id.clear();
  terminal_token.clear();
  terminal_token_version = 0;
}

OutboundMessage::OutboundMessage()
    : sent_at_ms(0), stream_id(0), sequence(0), frame_count(0), total_bytes(0),
      terminal_token_version(0), buffer_bytes(0), final_sequence_present(false),
      final_sequence(0), fatal(false) {}

Snapshot::Snapshot()
    : call_state(CallState::Idle), pairing_mode(true), transport_open(false), terminal_ready(false),
      connecting(false), pairing_expires_at_ms(0), audio_level(0) {}

Config::Config()
    : pairing_label("PC soft terminal"), pairing_ack_flush_ms(kPairingAckFlushMs),
      reconnect_initial_ms(1000), reconnect_max_ms(30000) {}

TerminalCore::TerminalCore(Ports& ports, const Config& config)
    : ports_(ports), config_(config), started_(false), hello_pending_(false),
      ping_pending_(false), credential_reconnect_pending_(false), downlink_final_seen_(false),
      downlink_played_sent_(false), playback_inflight_(false), downlink_end_emitted_(false),
      pending_uplink_frame_ready_(false), connect_scheduled_(false), next_connect_at_ms_(0),
      credential_reconnect_at_ms_(0), reconnect_delay_ms_(config.reconnect_initial_ms),
      last_ping_at_ms_(0), ping_sent_at_ms_(0), recording_started_at_ms_(0),
      uplink_stream_id_(0), uplink_sequence_(0), uplink_frame_count_(0), uplink_bytes_(0),
      pending_uplink_bytes_(0), downlink_stream_id_(0), downlink_expected_sequence_(0),
      downlink_frame_count_(0), downlink_received_bytes_(0), missed_pongs_(0), ring_head_(0),
      ring_tail_(0), ring_used_(0) {
  std::memset(ring_, 0, sizeof(ring_));
  std::memset(pending_uplink_frame_, 0, sizeof(pending_uplink_frame_));
}

void TerminalCore::start() {
  if (started_) return;
  started_ = true;
  boot_id_ = make_id("boot");
  Credentials loaded;
  if (ports_.load_credentials(&loaded) && loaded.valid()) {
    credentials_ = loaded;
    snapshot_.pairing_mode = false;
  } else if (config_.fallback_credentials.valid()) {
    credentials_ = config_.fallback_credentials;
    snapshot_.pairing_mode = false;
  } else {
    enter_pairing_mode();
  }
  schedule_connect(0);
  publish_snapshot();
}

void TerminalCore::tick() {
  if (!started_) return;
  const uint32_t now = ports_.now_ms();
  request_connect_if_due();
  if (credential_reconnect_pending_ && reached(now, credential_reconnect_at_ms_)) {
    credential_reconnect_pending_ = false;
    disconnect_for_reconnect();
  }
  if (snapshot_.transport_open && hello_pending_) {
    hello_pending_ = false;
    if (snapshot_.pairing_mode) send_pairing_hello();
    else send_hello();
  }
  if (snapshot_.transport_open && now - last_ping_at_ms_ >= kPingIntervalMs) {
    last_ping_at_ms_ = now;
    if (ping_pending_ && now - ping_sent_at_ms_ >= kPongTimeoutMs) {
      ++missed_pongs_;
      ping_pending_ = false;
      if (missed_pongs_ >= kMaxPongMisses) {
        ports_.disconnect_transport();
        return;
      }
    }
    send_ping();
  }
  if (ping_pending_ && now - ping_sent_at_ms_ >= kPongTimeoutMs) {
    ++missed_pongs_;
    ping_pending_ = false;
    if (missed_pongs_ >= kMaxPongMisses) {
      ports_.disconnect_transport();
      return;
    }
  }
  if (snapshot_.call_state == CallState::Recording &&
      now - recording_started_at_ms_ >= kAudioMaxRecordingMs) {
    end_recording();
    publish_safe_event("recording.limit", "60000");
  }
  play_downlink_if_ready();
}

void TerminalCore::on_clock() { tick(); }

void TerminalCore::on_transport_open() {
  snapshot_.transport_open = true;
  snapshot_.terminal_ready = false;
  snapshot_.connecting = false;
  hello_pending_ = true;
  ping_pending_ = false;
  missed_pongs_ = 0;
  publish_snapshot();
}

void TerminalCore::on_transport_closed(TransportCloseReason reason) {
  snapshot_.transport_open = false;
  snapshot_.terminal_ready = false;
  snapshot_.connecting = false;
  hello_pending_ = false;
  ping_pending_ = false;
  credential_reconnect_pending_ = false;
  if (snapshot_.call_state != CallState::Idle) reset_call();
  if (!snapshot_.pairing_mode &&
      (reason == TransportCloseReason::CredentialInvalid ||
       reason == TransportCloseReason::CredentialRevoked)) {
    ports_.clear_credentials();
    credentials_.clear();
    enter_pairing_mode();
  }
  const uint32_t jitter = ports_.random_u32() % 1000;
  const uint32_t delay = reconnect_delay_ms_ + jitter;
  reconnect_delay_ms_ = std::min(config_.reconnect_max_ms, reconnect_delay_ms_ * 2);
  schedule_connect(delay);
  publish_snapshot();
}

void TerminalCore::on_message(const InboundMessage& message) {
  switch (message.type) {
    case InboundType::PairingCode:
      if (!snapshot_.pairing_mode || message.pairing_session_id.size() < 16 ||
          !valid_pairing_code(message.code)) {
        send_error("invalid_message", "invalid pairing code", false);
        return;
      }
      snapshot_.pairing_session_id = message.pairing_session_id;
      snapshot_.pairing_code = message.code;
      snapshot_.pairing_expires_at_ms = message.expires_at_ms;
      publish_safe_event("pairing.code", message.code.c_str());
      publish_snapshot();
      return;
    case InboundType::PairingCredentials: {
      Credentials next;
      next.terminal_id = message.terminal_id;
      next.terminal_token = message.terminal_token;
      next.terminal_token_version = message.terminal_token_version;
      if (!next.valid()) {
        send_error("invalid_message", "invalid terminal credentials", false);
        return;
      }
      const bool initial_pairing = snapshot_.pairing_mode;
      const Credentials previous = credentials_;
      if (!ports_.save_credentials(next)) {
        send_error("internal_error", "terminal credential persistence failed", false);
        if (initial_pairing) enter_pairing_mode();
        return;
      }
      credentials_ = next;
      if (!send_credentials_ack(next.terminal_token_version)) {
        if (previous.valid()) {
          ports_.save_credentials(previous);
          credentials_ = previous;
        } else {
          ports_.clear_credentials();
          credentials_.clear();
        }
        if (initial_pairing) enter_pairing_mode();
        return;
      }
      publish_safe_event("pairing.credentials", initial_pairing ? "initial" : "rotation");
      if (initial_pairing) {
        snapshot_.pairing_mode = false;
        snapshot_.pairing_code.clear();
        snapshot_.pairing_expires_at_ms = 0;
        credential_reconnect_at_ms_ = ports_.now_ms() + config_.pairing_ack_flush_ms;
        credential_reconnect_pending_ = true;
      }
      publish_snapshot();
      return;
    }
    case InboundType::PairingInvalid:
      if (message.code == "credential_invalid" || message.code == "revoked") {
        ports_.clear_credentials();
        credentials_.clear();
      }
      enter_pairing_mode();
      ports_.disconnect_transport();
      publish_snapshot();
      return;
    case InboundType::TerminalReady:
      if (!message_is_for_terminal(message)) return;
      snapshot_.terminal_ready = true;
      reconnect_delay_ms_ = config_.reconnect_initial_ms;
      publish_safe_event("terminal.ready", "");
      publish_snapshot();
      return;
    case InboundType::SystemPing:
      send_pong(message.event_id);
      return;
    case InboundType::SystemPong:
      if (message.ping_event_id == pending_ping_id_) {
        ping_pending_ = false;
        missed_pongs_ = 0;
      }
      return;
    case InboundType::CallIncoming:
      if (!message_is_for_terminal(message) || message.call_id.empty()) {
        send_error("invalid_message", "invalid incoming call", false);
        return;
      }
      if (snapshot_.call_state != CallState::Idle) {
        send_error("invalid_state", "terminal is already in a call", false);
        return;
      }
      snapshot_.active_call_id = message.call_id;
      snapshot_.active_agent_label = message.caller_label.empty() ? "Fields" : message.caller_label;
      snapshot_.active_purpose = message.purpose;
      snapshot_.call_state = CallState::Ringing;
      publish_safe_event("call.incoming", message.call_id.c_str());
      publish_snapshot();
      return;
    case InboundType::CallConnected:
      if (!message_is_for_active_call(message, false)) return;
      snapshot_.call_state = CallState::ConnectedIdle;
      publish_snapshot();
      return;
    case InboundType::TurnListen:
      if (!message_is_for_active_call(message, false) || message.turn_id.empty()) return;
      snapshot_.active_turn_id = message.turn_id;
      snapshot_.call_state = CallState::Waiting;
      publish_snapshot();
      return;
    case InboundType::AudioStart:
      if (message.direction != "downlink" || !message_is_for_active_call(message, true) ||
          message.stream_id == 0) return;
      clear_downlink();
      downlink_stream_id_ = message.stream_id;
      snapshot_.call_state = CallState::Playing;
      ports_.begin_downlink_audio(downlink_stream_id_);
      send_audio_ready(downlink_stream_id_);
      publish_snapshot();
      return;
    case InboundType::AudioEnd:
      if (snapshot_.call_state != CallState::Playing ||
          !message_is_for_active_call(message, true) || message.stream_id != downlink_stream_id_) return;
      downlink_final_seen_ = true;
      play_downlink_if_ready();
      return;
    case InboundType::CallHangup:
    case InboundType::CallEnded:
      if (!message_is_for_active_call(message, false)) return;
      reset_call();
      publish_snapshot();
      return;
    case InboundType::Unknown:
    default:
      send_error("unsupported_event", "unsupported terminal event", false);
      return;
  }
}

void TerminalCore::on_binary(const uint8_t* bytes, size_t length) {
  handle_downlink_audio(bytes, length);
}

void TerminalCore::on_button(Button button) {
  if (button == Button::A) {
    if (snapshot_.call_state == CallState::Ringing) {
      send_call_action(OutboundType::CallAnswer);
      snapshot_.call_state = CallState::ConnectedIdle;
      publish_snapshot();
    } else if (snapshot_.call_state == CallState::Waiting) {
      begin_recording();
    } else if (snapshot_.call_state == CallState::Recording) {
      end_recording();
    }
    return;
  }
  if (snapshot_.call_state == CallState::Ringing) {
    send_call_action(OutboundType::CallDecline);
    reset_call();
  } else if (snapshot_.call_state != CallState::Idle) {
    if (snapshot_.call_state == CallState::Recording) end_recording();
    send_call_action(OutboundType::CallHangup);
    snapshot_.call_state = CallState::Ending;
  }
  publish_snapshot();
}

void TerminalCore::on_uplink_pcm(const int16_t* samples, size_t count) {
  if (snapshot_.call_state != CallState::Recording || samples == 0 || count == 0) return;
  const uint8_t* bytes = reinterpret_cast<const uint8_t*>(samples);
  size_t remaining = count * sizeof(int16_t);
  while (remaining > 0) {
    if (pending_uplink_bytes_ == kAudioMaxPayload) {
      std::vector<uint8_t> frame;
      if (!make_s3au(uplink_stream_id_, uplink_sequence_, false, pending_uplink_frame_,
                     pending_uplink_bytes_, &frame)) {
        send_error("internal_error", "audio framing failed", false);
        end_recording();
        return;
      }
      if (!ports_.enqueue_binary(&frame[0], frame.size())) {
        ports_.disconnect_transport();
        return;
      }
      ++uplink_sequence_;
      ++uplink_frame_count_;
      uplink_bytes_ += static_cast<uint32_t>(pending_uplink_bytes_);
      if ((uplink_frame_count_ % 8) == 0) send_audio_progress(uplink_stream_id_, uplink_sequence_ - 1);
      pending_uplink_bytes_ = 0;
      pending_uplink_frame_ready_ = false;
    }
    const size_t take = std::min(kAudioMaxPayload - pending_uplink_bytes_, remaining);
    std::memcpy(pending_uplink_frame_ + pending_uplink_bytes_, bytes, take);
    pending_uplink_bytes_ += take;
    bytes += take;
    remaining -= take;
    pending_uplink_frame_ready_ = pending_uplink_bytes_ == kAudioMaxPayload;
  }
}

void TerminalCore::on_playback_complete(bool played) {
  if (snapshot_.call_state != CallState::Playing || !downlink_end_emitted_) return;
  if (downlink_final_seen_ && ring_used_ == 0 && !downlink_played_sent_) {
    send_audio_played(downlink_stream_id_, played ? "played" : "failed");
    downlink_played_sent_ = true;
    snapshot_.call_state = CallState::Waiting;
    publish_snapshot();
  }
  play_downlink_if_ready();
}

const Snapshot& TerminalCore::snapshot() const { return snapshot_; }
const Credentials& TerminalCore::credentials() const { return credentials_; }

bool TerminalCore::validate_s3au(const uint8_t* bytes, size_t length, uint32_t* stream_id,
                                  uint32_t* sequence, uint8_t* flags, uint32_t* payload_length) {
  if (!bytes || length < kAudioHeaderLength || std::memcmp(bytes, "S3AU", 4) != 0 ||
      bytes[4] != kAudioVersion || (bytes[5] & ~kAudioFinal) != 0 || bytes[6] != 20 || bytes[7] != 0) return false;
  const uint32_t stream = read_u32_le(bytes + 8);
  const uint32_t seq = read_u32_le(bytes + 12);
  const uint32_t payload = read_u32_le(bytes + 16);
  if (stream == 0 || payload == 0 || payload > kAudioMaxPayload || (payload & 1) != 0 ||
      length != kAudioHeaderLength + payload || ((bytes[5] & kAudioFinal) == 0 && payload != kAudioMaxPayload)) return false;
  if (stream_id) *stream_id = stream;
  if (sequence) *sequence = seq;
  if (flags) *flags = bytes[5];
  if (payload_length) *payload_length = payload;
  return true;
}

bool TerminalCore::make_s3au(uint32_t stream_id, uint32_t sequence, bool final,
                             const uint8_t* pcm, size_t pcm_length, std::vector<uint8_t>* frame) {
  if (!frame || !pcm || stream_id == 0 || pcm_length == 0 || pcm_length > kAudioMaxPayload ||
      (pcm_length & 1) != 0 || (!final && pcm_length != kAudioMaxPayload)) return false;
  frame->assign(kAudioHeaderLength + pcm_length, 0);
  uint8_t* output = &(*frame)[0];
  std::memcpy(output, "S3AU", 4);
  output[4] = kAudioVersion;
  output[5] = final ? kAudioFinal : 0;
  write_u16_le(output + 6, static_cast<uint16_t>(kAudioHeaderLength));
  write_u32_le(output + 8, stream_id);
  write_u32_le(output + 12, sequence);
  write_u32_le(output + 16, static_cast<uint32_t>(pcm_length));
  std::memcpy(output + kAudioHeaderLength, pcm, pcm_length);
  return true;
}

void TerminalCore::publish_snapshot() { ports_.publish_snapshot(snapshot_); }
void TerminalCore::publish_safe_event(const char* name, const char* detail) { ports_.publish_safe_event(name, detail); }

void TerminalCore::schedule_connect(uint32_t delay_ms) {
  next_connect_at_ms_ = ports_.now_ms() + delay_ms;
  connect_scheduled_ = true;
  snapshot_.connecting = true;
}

void TerminalCore::request_connect_if_due() {
  if (!connect_scheduled_ || snapshot_.transport_open || !reached(ports_.now_ms(), next_connect_at_ms_)) return;
  connect_scheduled_ = false;
  ports_.request_connect(config_.endpoint, snapshot_.pairing_mode ? 0 : &credentials_);
}

void TerminalCore::enter_pairing_mode() {
  snapshot_.pairing_mode = true;
  snapshot_.pairing_code.clear();
  snapshot_.pairing_session_id.clear();
  snapshot_.pairing_expires_at_ms = 0;
}

void TerminalCore::disconnect_for_reconnect() {
  snapshot_.transport_open = false;
  snapshot_.terminal_ready = false;
  ports_.disconnect_transport();
  schedule_connect(0);
  publish_snapshot();
}

void TerminalCore::reset_call() {
  ports_.set_capture_enabled(false);
  ports_.stop_playback();
  if (downlink_stream_id_ != 0 && !downlink_end_emitted_) ports_.end_downlink_audio(downlink_stream_id_);
  clear_downlink();
  snapshot_.active_call_id.clear();
  snapshot_.active_turn_id.clear();
  snapshot_.active_agent_label.clear();
  snapshot_.active_purpose.clear();
  snapshot_.call_state = CallState::Idle;
  pending_uplink_bytes_ = 0;
  pending_uplink_frame_ready_ = false;
}

void TerminalCore::clear_downlink() {
  ring_head_ = ring_tail_ = ring_used_ = 0;
  downlink_stream_id_ = 0;
  downlink_expected_sequence_ = 0;
  downlink_frame_count_ = 0;
  downlink_received_bytes_ = 0;
  downlink_final_seen_ = false;
  downlink_played_sent_ = false;
  playback_inflight_ = false;
  downlink_end_emitted_ = false;
}

void TerminalCore::send_hello() {
  OutboundMessage message;
  message.type = OutboundType::TerminalHello;
  message.terminal_id = credentials_.terminal_id;
  message.boot_id = boot_id_;
  send_event(&message);
}

void TerminalCore::send_pairing_hello() {
  OutboundMessage message;
  message.type = OutboundType::PairingHello;
  message.reason = config_.pairing_label;
  send_event(&message);
}

void TerminalCore::send_ping() {
  OutboundMessage message;
  message.type = OutboundType::SystemPing;
  if (send_event(&message)) {
    pending_ping_id_ = message.event_id;
    ping_sent_at_ms_ = ports_.now_ms();
    ping_pending_ = true;
  }
}

void TerminalCore::send_pong(const std::string& ping_event_id) {
  OutboundMessage message;
  message.type = OutboundType::SystemPong;
  message.ping_event_id = ping_event_id;
  send_event(&message);
}

void TerminalCore::send_call_action(OutboundType type) {
  if (snapshot_.active_call_id.empty()) return;
  OutboundMessage message;
  message.type = type;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  send_event(&message);
}

void TerminalCore::send_audio_start(const char* direction, uint32_t stream_id) {
  OutboundMessage message;
  message.type = OutboundType::AudioStart;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  message.turn_id = snapshot_.active_turn_id;
  message.direction = direction;
  message.stream_id = stream_id;
  send_event(&message);
}

void TerminalCore::send_audio_ready(uint32_t stream_id) {
  OutboundMessage message;
  message.type = OutboundType::AudioReady;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  message.turn_id = snapshot_.active_turn_id;
  message.stream_id = stream_id;
  message.buffer_bytes = kAudioRingBytes;
  send_event(&message);
}

void TerminalCore::send_audio_progress(uint32_t stream_id, uint32_t sequence) {
  OutboundMessage message;
  message.type = OutboundType::AudioProgress;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  message.turn_id = snapshot_.active_turn_id;
  message.stream_id = stream_id;
  message.sequence = sequence;
  send_event(&message);
}

void TerminalCore::send_audio_end(uint32_t stream_id, uint32_t frame_count, uint32_t total_bytes,
                                  bool final_sequence_present, uint32_t final_sequence) {
  OutboundMessage message;
  message.type = OutboundType::AudioEnd;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  message.turn_id = snapshot_.active_turn_id;
  message.stream_id = stream_id;
  message.frame_count = frame_count;
  message.total_bytes = total_bytes;
  message.final_sequence_present = final_sequence_present;
  message.final_sequence = final_sequence;
  send_event(&message);
}

void TerminalCore::send_turn_complete(const char* outcome, const char* reason) {
  OutboundMessage message;
  message.type = OutboundType::TurnComplete;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  message.turn_id = snapshot_.active_turn_id;
  message.outcome = outcome;
  if (reason) message.reason = reason;
  send_event(&message);
}

void TerminalCore::send_audio_played(uint32_t stream_id, const char* status) {
  OutboundMessage message;
  message.type = OutboundType::AudioPlayed;
  message.terminal_id = credentials_.terminal_id;
  message.call_id = snapshot_.active_call_id;
  message.turn_id = snapshot_.active_turn_id;
  message.stream_id = stream_id;
  message.status = status;
  send_event(&message);
}

bool TerminalCore::send_credentials_ack(uint32_t token_version) {
  OutboundMessage message;
  message.type = OutboundType::CredentialsAck;
  message.terminal_id = credentials_.terminal_id;
  message.terminal_token_version = token_version;
  return send_event(&message);
}

void TerminalCore::send_error(const char* code, const char* message, bool fatal) {
  OutboundMessage event;
  event.type = OutboundType::TerminalError;
  event.terminal_id = credentials_.terminal_id;
  event.call_id = snapshot_.active_call_id;
  event.turn_id = snapshot_.active_turn_id;
  event.stream_id = downlink_stream_id_ ? downlink_stream_id_ : uplink_stream_id_;
  event.error_code = code;
  event.error_message = message;
  event.fatal = fatal;
  send_event(&event);
}

bool TerminalCore::send_event(OutboundMessage* message) {
  if (!message || !snapshot_.transport_open) return false;
  if (message->event_id.empty() && message->type != OutboundType::PairingHello) message->event_id = make_id("event");
  message->sent_at_ms = ports_.now_ms();
  return ports_.enqueue_text(*message);
}

std::string TerminalCore::make_id(const char* prefix) {
  std::ostringstream output;
  output << prefix << "-" << ports_.random_u32() << "-" << ports_.now_ms();
  return output.str();
}

bool TerminalCore::message_is_for_terminal(const InboundMessage& message) const {
  return !credentials_.terminal_id.empty() && message.terminal_id == credentials_.terminal_id;
}

bool TerminalCore::message_is_for_active_call(const InboundMessage& message, bool require_turn) const {
  if (!message_is_for_terminal(message) || snapshot_.active_call_id.empty() ||
      message.call_id != snapshot_.active_call_id) return false;
  return !require_turn || (!snapshot_.active_turn_id.empty() && message.turn_id == snapshot_.active_turn_id);
}

void TerminalCore::begin_recording() {
  if (snapshot_.call_state != CallState::Waiting || snapshot_.active_call_id.empty() ||
      snapshot_.active_turn_id.empty()) return;
  uplink_stream_id_ = ports_.random_u32();
  if (uplink_stream_id_ == 0) uplink_stream_id_ = 1;
  uplink_sequence_ = 0;
  uplink_frame_count_ = 0;
  uplink_bytes_ = 0;
  pending_uplink_bytes_ = 0;
  pending_uplink_frame_ready_ = false;
  recording_started_at_ms_ = ports_.now_ms();
  ports_.set_capture_enabled(true);
  send_audio_start("uplink", uplink_stream_id_);
  send_audio_ready(uplink_stream_id_);
  snapshot_.call_state = CallState::Recording;
  publish_snapshot();
}

void TerminalCore::end_recording() {
  if (snapshot_.call_state != CallState::Recording) return;
  ports_.set_capture_enabled(false);
  if (pending_uplink_bytes_ > 0) {
    std::vector<uint8_t> frame;
    if (make_s3au(uplink_stream_id_, uplink_sequence_, true, pending_uplink_frame_, pending_uplink_bytes_, &frame) &&
        ports_.enqueue_binary(&frame[0], frame.size())) {
      ++uplink_sequence_;
      ++uplink_frame_count_;
      uplink_bytes_ += static_cast<uint32_t>(pending_uplink_bytes_);
    }
  }
  pending_uplink_bytes_ = 0;
  pending_uplink_frame_ready_ = false;
  send_audio_end(uplink_stream_id_, uplink_frame_count_, uplink_bytes_, uplink_sequence_ > 0, uplink_sequence_ - 1);
  send_turn_complete(uplink_frame_count_ == 0 ? "no_speech" : "replied", 0);
  snapshot_.call_state = CallState::Waiting;
  publish_snapshot();
}

void TerminalCore::handle_downlink_audio(const uint8_t* bytes, size_t length) {
  uint32_t stream = 0;
  uint32_t sequence = 0;
  uint32_t payload_length = 0;
  uint8_t flags = 0;
  if (!validate_s3au(bytes, length, &stream, &sequence, &flags, &payload_length) ||
      snapshot_.call_state != CallState::Playing || stream != downlink_stream_id_ ||
      sequence != downlink_expected_sequence_) {
    send_error("invalid_audio_frame", "unexpected audio frame", false);
    return;
  }
  if (!ring_push(bytes + kAudioHeaderLength, payload_length)) {
    send_error("invalid_audio_frame", "audio ring buffer full", false);
    return;
  }
  ++downlink_expected_sequence_;
  ++downlink_frame_count_;
  downlink_received_bytes_ += payload_length;
  if ((flags & kAudioFinal) != 0) downlink_final_seen_ = true;
  if ((downlink_frame_count_ % 8) == 0) send_audio_progress(stream, sequence);
  play_downlink_if_ready();
}

void TerminalCore::play_downlink_if_ready() {
  if (snapshot_.call_state != CallState::Playing || ports_.downlink_output_busy()) return;
  const bool prebuffered = ring_used_ >= kAudioPrebufferFrames * kAudioMaxPayload;
  const bool has_full_frame = ring_used_ >= kAudioMaxPayload && (prebuffered || downlink_final_seen_);
  const bool has_final_tail = downlink_final_seen_ && ring_used_ > 0 && ring_used_ < kAudioMaxPayload;
  if (has_full_frame || has_final_tail) {
    const size_t bytes_to_play = has_full_frame ? kAudioMaxPayload : ring_used_;
    std::vector<uint8_t> pcm(bytes_to_play);
    if (!ring_pop(&pcm[0], bytes_to_play)) return;
    ports_.enqueue_downlink_pcm(reinterpret_cast<const int16_t*>(&pcm[0]), bytes_to_play / sizeof(int16_t));
    playback_inflight_ = true;
  }
  if (downlink_final_seen_ && ring_used_ == 0 && !ports_.downlink_output_busy() && !downlink_end_emitted_) {
    ports_.end_downlink_audio(downlink_stream_id_);
    downlink_end_emitted_ = true;
  }
}

bool TerminalCore::ring_push(const uint8_t* bytes, size_t length) {
  if (!bytes || length > kAudioRingBytes - ring_used_) return false;
  const size_t first = std::min(length, kAudioRingBytes - ring_tail_);
  std::memcpy(ring_ + ring_tail_, bytes, first);
  if (length > first) std::memcpy(ring_, bytes + first, length - first);
  ring_tail_ = (ring_tail_ + length) % kAudioRingBytes;
  ring_used_ += length;
  return true;
}

bool TerminalCore::ring_pop(uint8_t* bytes, size_t length) {
  if (!bytes || length > ring_used_) return false;
  const size_t first = std::min(length, kAudioRingBytes - ring_head_);
  std::memcpy(bytes, ring_ + ring_head_, first);
  if (length > first) std::memcpy(bytes + first, ring_, length - first);
  ring_head_ = (ring_head_ + length) % kAudioRingBytes;
  ring_used_ -= length;
  return true;
}

}  // namespace terminal
}  // namespace fields
