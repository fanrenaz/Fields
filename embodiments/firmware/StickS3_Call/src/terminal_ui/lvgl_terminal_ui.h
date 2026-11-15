#ifndef FIELDS_STICKS3_LVGL_TERMINAL_UI_H
#define FIELDS_STICKS3_LVGL_TERMINAL_UI_H

#include "lvgl_terminal_scene.h"

#include <M5Unified.h>

namespace fields {
namespace terminal {
namespace ui {

// M5-only LVGL display driver.  Widgets and ViewModel binding live in
// LvglTerminalScene so the SDL host uses the exact same screen tree.
class LvglTerminalUi {
 public:
  LvglTerminalUi();

  void begin(M5GFX& display);
  void render(const ViewModel& view);
  void tick();

 private:
  static void flush(lv_disp_drv_t* driver, const lv_area_t* area, lv_color_t* color);
  static LvglTerminalUi* active_instance_;

  static const uint16_t kWidth = 240;
  static const uint16_t kHeight = 135;
  static const uint16_t kDrawRows = 20;
  M5GFX* display_;
  lv_color_t draw_buffer_a_[kWidth * kDrawRows];
  lv_disp_draw_buf_t draw_buffer_;
  lv_disp_drv_t display_driver_;
  LvglTerminalScene scene_;
  bool started_;
};

}  // namespace ui
}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_LVGL_TERMINAL_UI_H
