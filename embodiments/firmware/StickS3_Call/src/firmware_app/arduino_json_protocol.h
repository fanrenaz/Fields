#ifndef FIELDS_STICKS3_ARDUINO_JSON_PROTOCOL_H
#define FIELDS_STICKS3_ARDUINO_JSON_PROTOCOL_H

#include <ArduinoJson.h>

#include "../terminal_core/terminal_core.h"

namespace fields {
namespace terminal {
namespace arduino_json {

// These functions deliberately expose only typed core messages.  Raw JSON
// must not become UI/browser state and outbound messages never contain a
// terminal token.
bool decode_inbound(const uint8_t* payload, size_t length, InboundMessage* message);
bool encode_outbound(const OutboundMessage& message, JsonDocument* document);

}  // namespace arduino_json
}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_ARDUINO_JSON_PROTOCOL_H
