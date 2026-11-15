#ifndef FIELDS_STICKS3_TERMINAL_VIEW_MODEL_H
#define FIELDS_STICKS3_TERMINAL_VIEW_MODEL_H

// The renderer boundary has no Arduino, M5 or LVGL types.  It is shared by
// the StickS3 display adapter and the PC LVGL simulator, so neither target
// derives terminal screen state independently.

#include <stdint.h>

#include <string>

#include "../terminal_core/terminal_core.h"

namespace fields {
namespace terminal {
namespace ui {

struct RuntimeStatus {
  RuntimeStatus();

  bool wifi_connected;
  bool tls_clock_ready;
  uint32_t recording_elapsed_ms;
  uint8_t audio_level;
  std::string notice;
};

struct ViewModel {
  ViewModel();

  bool online;
  bool pairing;
  bool recording;
  uint8_t audio_level;
  std::string title;
  std::string state_label;
  std::string agent_label;
  std::string connection_label;
  std::string detail_label;
  std::string primary_label;
  std::string notice;
};

ViewModel make_view_model(const Snapshot& snapshot, const RuntimeStatus& runtime);

}  // namespace ui
}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_TERMINAL_VIEW_MODEL_H
