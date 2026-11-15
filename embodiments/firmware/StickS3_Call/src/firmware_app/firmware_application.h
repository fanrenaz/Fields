#ifndef FIELDS_STICKS3_FIRMWARE_APPLICATION_H
#define FIELDS_STICKS3_FIRMWARE_APPLICATION_H

// The application boundary is intentionally platform neutral.  ESP32 and the
// PC simulator both feed transport, input and audio facts into this object;
// protocol state remains owned by TerminalCore.

#include "../terminal_core/terminal_core.h"

namespace fields {
namespace terminal {

class FirmwareApplication {
 public:
  FirmwareApplication(Ports& ports, const Config& config);

  void start();
  void tick();
  void on_transport_open();
  void on_transport_closed(TransportCloseReason reason);
  void on_message(const InboundMessage& message);
  void on_binary(const uint8_t* bytes, size_t length);
  void on_button(Button button);
  void on_uplink_pcm(const int16_t* samples, size_t count);
  void on_playback_complete(bool played = true);

  const Snapshot& snapshot() const;
  const Credentials& credentials() const;

 private:
  TerminalCore core_;
};

}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_FIRMWARE_APPLICATION_H
