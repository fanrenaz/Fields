#include "firmware_application.h"

namespace fields {
namespace terminal {

FirmwareApplication::FirmwareApplication(Ports& ports, const Config& config)
    : core_(ports, config) {}

void FirmwareApplication::start() { core_.start(); }
void FirmwareApplication::tick() { core_.tick(); }
void FirmwareApplication::on_transport_open() { core_.on_transport_open(); }
void FirmwareApplication::on_transport_closed(TransportCloseReason reason) {
  core_.on_transport_closed(reason);
}
void FirmwareApplication::on_message(const InboundMessage& message) { core_.on_message(message); }
void FirmwareApplication::on_binary(const uint8_t* bytes, size_t length) { core_.on_binary(bytes, length); }
void FirmwareApplication::on_button(Button button) { core_.on_button(button); }
void FirmwareApplication::on_uplink_pcm(const int16_t* samples, size_t count) {
  core_.on_uplink_pcm(samples, count);
}
void FirmwareApplication::on_playback_complete(bool played) { core_.on_playback_complete(played); }
const Snapshot& FirmwareApplication::snapshot() const { return core_.snapshot(); }
const Credentials& FirmwareApplication::credentials() const { return core_.credentials(); }

}  // namespace terminal
}  // namespace fields
