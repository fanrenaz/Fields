#ifndef FIELDS_STICKS3_TERMINAL_CORE_H
#define FIELDS_STICKS3_TERMINAL_CORE_H

// This file deliberately uses only the C++11 standard library.  It is built
// by the Arduino/M5 adapter and by the desktop terminal runner; neither side
// gets a second implementation of terminal state or protocol ordering.

#include <stddef.h>
#include <stdint.h>

#include <string>
#include <vector>

namespace fields {
namespace terminal {

static const uint8_t kJsonVersion = 2;
static const uint8_t kAudioVersion = 1;
static const uint8_t kAudioFinal = 0x01;
static const size_t kAudioHeaderLength = 20;
static const size_t kAudioMaxPayload = 1024;
static const uint32_t kAudioSampleRate = 16000;
static const size_t kAudioRingBytes = 16 * 1024;
static const size_t kAudioPrebufferFrames = 8;
static const uint32_t kAudioMaxRecordingMs = 60 * 1000;
static const uint32_t kPingIntervalMs = 15 * 1000;
static const uint32_t kPongTimeoutMs = 5 * 1000;
static const uint8_t kMaxPongMisses = 2;
static const uint32_t kPairingAckFlushMs = 500;

enum class CallState : uint8_t {
  Idle,
  Ringing,
  ConnectedIdle,
  Playing,
  Waiting,
  Recording,
  Ending,
};

enum class Button : uint8_t { A, B };

enum class TransportCloseReason : uint8_t {
  Network,
  CredentialInvalid,
  CredentialRevoked,
  LocalDisconnect,
};

enum class InboundType : uint8_t {
  Unknown,
  PairingCode,
  PairingCredentials,
  PairingInvalid,
  TerminalReady,
  SystemPing,
  SystemPong,
  CallIncoming,
  CallConnected,
  TurnListen,
  AudioStart,
  AudioEnd,
  CallHangup,
  CallEnded,
};

// JSON adapters populate only the fields their message type owns.  This keeps
// ArduinoJson and Boost.JSON outside the portable state machine.
struct InboundMessage {
  InboundType type;
  std::string event_id;
  std::string ping_event_id;
  std::string terminal_id;
  std::string call_id;
  std::string turn_id;
  std::string pairing_session_id;
  std::string code;
  std::string terminal_token;
  std::string caller_label;
  std::string purpose;
  std::string direction;
  uint32_t terminal_token_version;
  uint32_t expires_at_ms;
  uint32_t stream_id;

  InboundMessage();
};

struct Credentials {
  std::string terminal_id;
  std::string terminal_token;
  uint32_t terminal_token_version;

  Credentials();
  bool valid() const;
  void clear();
};

enum class OutboundType : uint8_t {
  TerminalHello,
  PairingHello,
  SystemPing,
  SystemPong,
  CallAnswer,
  CallDecline,
  CallHangup,
  AudioStart,
  AudioReady,
  AudioProgress,
  AudioEnd,
  TurnComplete,
  AudioPlayed,
  CredentialsAck,
  TerminalError,
};

// The adapter owns JSON serialization.  `terminal_token` is intentionally not
// present: outbound events, snapshots and safe events cannot leak credentials.
struct OutboundMessage {
  OutboundType type;
  std::string event_id;
  std::string terminal_id;
  std::string boot_id;
  std::string ping_event_id;
  std::string call_id;
  std::string turn_id;
  std::string direction;
  std::string outcome;
  std::string reason;
  std::string status;
  std::string error_code;
  std::string error_message;
  uint32_t sent_at_ms;
  uint32_t stream_id;
  uint32_t sequence;
  uint32_t frame_count;
  uint32_t total_bytes;
  uint32_t terminal_token_version;
  uint32_t buffer_bytes;
  bool final_sequence_present;
  uint32_t final_sequence;
  bool fatal;

  OutboundMessage();
};

struct Snapshot {
  CallState call_state;
  bool pairing_mode;
  bool transport_open;
  bool terminal_ready;
  bool connecting;
  std::string pairing_code;
  std::string pairing_session_id;
  uint32_t pairing_expires_at_ms;
  std::string active_call_id;
  std::string active_turn_id;
  std::string active_agent_label;
  std::string active_purpose;
  uint8_t audio_level;

  Snapshot();
};

struct Config {
  // The port treats this as an opaque endpoint; terminal core never parses it.
  std::string endpoint;
  std::string pairing_label;
  Credentials fallback_credentials;
  uint32_t pairing_ack_flush_ms;
  uint32_t reconnect_initial_ms;
  uint32_t reconnect_max_ms;

  Config();
};

class Ports {
 public:
  virtual ~Ports() {}

  virtual uint32_t now_ms() const = 0;
  virtual uint32_t random_u32() = 0;

  virtual bool load_credentials(Credentials* credentials) = 0;
  virtual bool save_credentials(const Credentials& credentials) = 0;
  virtual void clear_credentials() = 0;

  // `credentials` is null only for a pairing connection.  Implementations may
  // use the private value for HTTP upgrade headers but must never surface it to
  // a browser, IPC event, snapshot, or log.
  virtual void request_connect(const std::string& endpoint,
                               const Credentials* credentials) = 0;
  virtual void disconnect_transport() = 0;
  virtual bool enqueue_text(const OutboundMessage& message) = 0;
  virtual bool enqueue_binary(const uint8_t* bytes, size_t length) = 0;

  virtual void set_capture_enabled(bool enabled) = 0;
  virtual void stop_playback() = 0;
  virtual void begin_downlink_audio(uint32_t stream_id) = 0;
  virtual bool downlink_output_busy() const = 0;
  virtual void enqueue_downlink_pcm(const int16_t* samples, size_t count) = 0;
  virtual void end_downlink_audio(uint32_t stream_id) = 0;
  virtual void publish_snapshot(const Snapshot& snapshot) = 0;
  virtual void publish_safe_event(const char* name, const char* detail) = 0;
};

class TerminalCore {
 public:
  TerminalCore(Ports& ports, const Config& config);

  void start();
  void tick();
  void on_clock();

  // Transport callbacks contain only transport facts.  The Arduino and PC
  // adapters parse close details into TransportCloseReason before calling in.
  void on_transport_open();
  void on_transport_closed(TransportCloseReason reason);
  void on_message(const InboundMessage& message);
  void on_binary(const uint8_t* bytes, size_t length);
  void on_button(Button button);
  void on_uplink_pcm(const int16_t* samples, size_t count);
  void on_playback_complete(bool played = true);

  const Snapshot& snapshot() const;
  const Credentials& credentials() const;

  static bool validate_s3au(const uint8_t* bytes, size_t length,
                            uint32_t* stream_id, uint32_t* sequence,
                            uint8_t* flags, uint32_t* payload_length);
  static bool make_s3au(uint32_t stream_id, uint32_t sequence, bool final,
                        const uint8_t* pcm, size_t pcm_length,
                        std::vector<uint8_t>* frame);

 private:
  void publish_snapshot();
  void publish_safe_event(const char* name, const char* detail);
  void schedule_connect(uint32_t delay_ms);
  void request_connect_if_due();
  void enter_pairing_mode();
  void disconnect_for_reconnect();
  void reset_call();
  void clear_downlink();
  void send_hello();
  void send_pairing_hello();
  void send_ping();
  void send_pong(const std::string& ping_event_id);
  void send_call_action(OutboundType type);
  void send_audio_start(const char* direction, uint32_t stream_id);
  void send_audio_ready(uint32_t stream_id);
  void send_audio_progress(uint32_t stream_id, uint32_t sequence);
  void send_audio_end(uint32_t stream_id, uint32_t frame_count,
                      uint32_t total_bytes, bool final_sequence_present,
                      uint32_t final_sequence);
  void send_turn_complete(const char* outcome, const char* reason);
  void send_audio_played(uint32_t stream_id, const char* status);
  bool send_credentials_ack(uint32_t token_version);
  void send_error(const char* code, const char* message, bool fatal);
  bool send_event(OutboundMessage* message);
  std::string make_id(const char* prefix);
  bool message_is_for_terminal(const InboundMessage& message) const;
  bool message_is_for_active_call(const InboundMessage& message,
                                  bool require_turn) const;
  void begin_recording();
  void end_recording();
  void handle_downlink_audio(const uint8_t* bytes, size_t length);
  void play_downlink_if_ready();
  bool ring_push(const uint8_t* bytes, size_t length);
  bool ring_pop(uint8_t* bytes, size_t length);

  Ports& ports_;
  Config config_;
  Credentials credentials_;
  Snapshot snapshot_;
  std::string boot_id_;
  std::string pending_ping_id_;
  bool started_;
  bool hello_pending_;
  bool ping_pending_;
  bool credential_reconnect_pending_;
  bool downlink_final_seen_;
  bool downlink_played_sent_;
  bool playback_inflight_;
  bool downlink_end_emitted_;
  bool pending_uplink_frame_ready_;
  bool connect_scheduled_;
  uint32_t next_connect_at_ms_;
  uint32_t credential_reconnect_at_ms_;
  uint32_t reconnect_delay_ms_;
  uint32_t last_ping_at_ms_;
  uint32_t ping_sent_at_ms_;
  uint32_t recording_started_at_ms_;
  uint32_t uplink_stream_id_;
  uint32_t uplink_sequence_;
  uint32_t uplink_frame_count_;
  uint32_t uplink_bytes_;
  size_t pending_uplink_bytes_;
  uint32_t downlink_stream_id_;
  uint32_t downlink_expected_sequence_;
  uint32_t downlink_frame_count_;
  uint32_t downlink_received_bytes_;
  uint8_t missed_pongs_;
  size_t ring_head_;
  size_t ring_tail_;
  size_t ring_used_;
  uint8_t ring_[kAudioRingBytes];
  uint8_t pending_uplink_frame_[kAudioMaxPayload];
};

}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_TERMINAL_CORE_H
