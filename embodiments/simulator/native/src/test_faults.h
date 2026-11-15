#ifndef FIELDS_STICKS3_TEST_FAULTS_H
#define FIELDS_STICKS3_TEST_FAULTS_H

#include <string>

namespace fields {
namespace sticks3 {

// These scenarios exist only inside the native test runner.  They never
// select a fallback transport in the browser service: a caller must opt in
// with STICKS3_PC_TEST_MODE=1 before a scenario can be selected.
enum class TestFaultScenario {
  None,
  WifiOffline,
  NtpUnready,
  TlsFailure,
  WebSocketClose,
  NvsSaveFailure,
  InvalidJson,
};

bool parse_test_fault_scenario(const std::string& test_mode,
                               const std::string& scenario,
                               TestFaultScenario* result,
                               std::string* error);
const char* test_fault_scenario_name(TestFaultScenario scenario);
bool test_fault_fails_connect(TestFaultScenario scenario);
bool test_fault_uses_virtual_transport(TestFaultScenario scenario);

}  // namespace sticks3
}  // namespace fields

#endif  // FIELDS_STICKS3_TEST_FAULTS_H
