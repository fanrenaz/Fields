#include "test_faults.h"

namespace fields {
namespace sticks3 {

const char* test_fault_scenario_name(TestFaultScenario scenario) {
  switch (scenario) {
    case TestFaultScenario::None: return "none";
    case TestFaultScenario::WifiOffline: return "wifi_offline";
    case TestFaultScenario::NtpUnready: return "ntp_unready";
    case TestFaultScenario::TlsFailure: return "tls_failure";
    case TestFaultScenario::WebSocketClose: return "ws_close";
    case TestFaultScenario::NvsSaveFailure: return "nvs_save_failure";
    case TestFaultScenario::InvalidJson: return "invalid_json";
  }
  return "none";
}

bool parse_test_fault_scenario(const std::string& test_mode,
                               const std::string& scenario,
                               TestFaultScenario* result,
                               std::string* error) {
  if (!result) return false;
  *result = TestFaultScenario::None;
  if (scenario.empty()) return true;
  if (test_mode != "1") {
    if (error) *error = "STICKS3_PC_TEST_FAULT_SCENARIO requires STICKS3_PC_TEST_MODE=1";
    return false;
  }
  if (scenario == "wifi_offline") *result = TestFaultScenario::WifiOffline;
  else if (scenario == "ntp_unready") *result = TestFaultScenario::NtpUnready;
  else if (scenario == "tls_failure") *result = TestFaultScenario::TlsFailure;
  else if (scenario == "ws_close") *result = TestFaultScenario::WebSocketClose;
  else if (scenario == "nvs_save_failure") *result = TestFaultScenario::NvsSaveFailure;
  else if (scenario == "invalid_json") *result = TestFaultScenario::InvalidJson;
  else {
    if (error) *error = "unknown STICKS3_PC_TEST_FAULT_SCENARIO";
    return false;
  }
  return true;
}

bool test_fault_fails_connect(TestFaultScenario scenario) {
  return scenario == TestFaultScenario::WifiOffline ||
      scenario == TestFaultScenario::NtpUnready ||
      scenario == TestFaultScenario::TlsFailure;
}

bool test_fault_uses_virtual_transport(TestFaultScenario scenario) {
  return scenario == TestFaultScenario::WebSocketClose ||
      scenario == TestFaultScenario::NvsSaveFailure ||
      scenario == TestFaultScenario::InvalidJson;
}

}  // namespace sticks3
}  // namespace fields
