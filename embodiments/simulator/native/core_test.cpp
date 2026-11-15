#include <assert.h>

#include <string>
#include <vector>

#include "terminal_core.h"

using namespace fields::terminal;

class TestPorts final : public Ports {
 public:
  uint32_t now = 0;
  Credentials saved;
  bool connect_requested = false;
  bool disconnect_requested = false;
  bool credentials_cleared = false;
  bool save_should_fail = false;
  std::vector<OutboundMessage> sent;

  uint32_t now_ms() const override { return now; }
  uint32_t random_u32() override { return 7; }
  bool load_credentials(Credentials*) override { return false; }
  bool save_credentials(const Credentials& credentials) override {
    if (save_should_fail) return false;
    saved = credentials;
    return true;
  }
  void clear_credentials() override { credentials_cleared = true; saved.clear(); }
  void request_connect(const std::string&, const Credentials*) override { connect_requested = true; }
  void disconnect_transport() override { disconnect_requested = true; }
  bool enqueue_text(const OutboundMessage& message) override { sent.push_back(message); return true; }
  bool enqueue_binary(const uint8_t*, size_t) override { return true; }
  void set_capture_enabled(bool) override {}
  void stop_playback() override {}
  void begin_downlink_audio(uint32_t) override {}
  bool downlink_output_busy() const override { return false; }
  void enqueue_downlink_pcm(const int16_t*, size_t) override {}
  void end_downlink_audio(uint32_t) override {}
  void publish_snapshot(const Snapshot&) override {}
  void publish_safe_event(const char*, const char*) override {}
};

int main() {
  TestPorts ports;
  Config config;
  config.endpoint = "ws://runtime/embodiment/ws";
  TerminalCore core(ports, config);
  core.start();
  core.tick();
  assert(ports.connect_requested);
  core.on_transport_open();
  core.tick();
  assert(!ports.sent.empty() && ports.sent.back().type == OutboundType::PairingHello);

  InboundMessage credentials;
  credentials.type = InboundType::PairingCredentials;
  credentials.terminal_id = "terminal-1";
  credentials.terminal_token.assign(32, 't');
  credentials.terminal_token_version = 1;
  core.on_message(credentials);
  assert(ports.saved.valid());
  assert(ports.sent.back().type == OutboundType::CredentialsAck);
  ports.now = 499;
  core.tick();
  assert(!ports.disconnect_requested);
  ports.now = 500;
  core.tick();
  assert(ports.disconnect_requested);

  ports.disconnect_requested = false;
  InboundMessage revoked;
  revoked.type = InboundType::PairingInvalid;
  revoked.code = "revoked";
  core.on_message(revoked);
  assert(ports.credentials_cleared);
  assert(!core.credentials().valid());
  assert(core.snapshot().pairing_mode);
  assert(ports.disconnect_requested);

  std::vector<uint8_t> frame;
  const uint8_t pcm[] = {1, 0};
  assert(TerminalCore::make_s3au(1, 0, true, pcm, sizeof(pcm), &frame));
  assert(TerminalCore::validate_s3au(&frame[0], frame.size(), 0, 0, 0, 0));

  TestPorts persistence_failure_ports;
  TerminalCore persistence_failure_core(persistence_failure_ports, config);
  persistence_failure_core.start();
  persistence_failure_core.tick();
  persistence_failure_core.on_transport_open();
  persistence_failure_core.tick();
  persistence_failure_ports.save_should_fail = true;
  InboundMessage persistence_failure;
  persistence_failure.type = InboundType::PairingCredentials;
  persistence_failure.terminal_id = "terminal-save-failure";
  persistence_failure.terminal_token.assign(32, 't');
  persistence_failure.terminal_token_version = 1;
  persistence_failure_core.on_message(persistence_failure);
  assert(!persistence_failure_ports.saved.valid());
  assert(!persistence_failure_ports.sent.empty());
  assert(persistence_failure_ports.sent.back().type == OutboundType::TerminalError);
  assert(persistence_failure_ports.sent.back().error_code == "internal_error");
  return 0;
}
