#include <assert.h>

#include <string>
#include <vector>

#include "framebuffer.h"
#include "arduino_json_protocol.h"
#include "test_faults.h"

using fields::sticks3::FramebufferRenderer;
using fields::sticks3::TestFaultScenario;
using fields::terminal::Snapshot;

int main() {
  std::vector<uint16_t> pixels(4, 0x1234);
  std::vector<uint8_t> record;
  assert(fields::sticks3::make_frame_record(0x01020304, 2, 2, pixels, &record));
  assert(record.size() == 28);
  assert(std::string(reinterpret_cast<const char*>(&record[0]), 4) == "S3FR");
  assert(record[4] == 1 && record[5] == 1 && record[6] == 20 && record[7] == 0);
  assert(record[8] == 4 && record[9] == 3 && record[10] == 2 && record[11] == 1);
  assert(record[12] == 2 && record[14] == 2 && record[16] == 8);
  assert(record[20] == 0x34 && record[21] == 0x12);

  fields::terminal::ui::ViewModel view;
  view.pairing = true;
  view.primary_label = "AB12CD";
  FramebufferRenderer renderer;
  assert(renderer.make_view_record(view, &record));
  assert(record.size() == 20 + 240 * 135 * 2);
  assert(std::string(reinterpret_cast<const char*>(&record[0]), 4) == "S3FR");

  TestFaultScenario scenario = TestFaultScenario::None;
  std::string error;
  assert(!fields::sticks3::parse_test_fault_scenario("", "wifi_offline", &scenario, &error));
  assert(fields::sticks3::parse_test_fault_scenario("1", "ws_close", &scenario, &error));
  assert(scenario == TestFaultScenario::WebSocketClose);
  assert(fields::sticks3::test_fault_uses_virtual_transport(scenario));
  assert(fields::sticks3::parse_test_fault_scenario("1", "tls_failure", &scenario, &error));
  assert(fields::sticks3::test_fault_fails_connect(scenario));

  fields::terminal::InboundMessage inbound;
  const std::string inbound_json =
      "{\"schema_version\":2,\"type\":\"pairing.code\",\"pairing_session_id\":\"test-session-0001\",\"code\":\"AB12CD\",\"expires_at_ms\":123}";
  assert(fields::terminal::arduino_json::decode_inbound(
      reinterpret_cast<const uint8_t*>(inbound_json.data()), inbound_json.size(), &inbound));
  assert(inbound.type == fields::terminal::InboundType::PairingCode);
  assert(inbound.code == "AB12CD");
  assert(!fields::terminal::arduino_json::decode_inbound(
      reinterpret_cast<const uint8_t*>("{invalid"), 8, &inbound));

  fields::terminal::OutboundMessage outbound;
  outbound.type = fields::terminal::OutboundType::PairingHello;
  outbound.reason = "PC soft terminal";
  JsonDocument document;
  assert(fields::terminal::arduino_json::encode_outbound(outbound, &document));
  std::string outbound_json;
  assert(serializeJson(document, outbound_json) > 0);
  assert(outbound_json.find("pairing.hello") != std::string::npos);
  return 0;
}
