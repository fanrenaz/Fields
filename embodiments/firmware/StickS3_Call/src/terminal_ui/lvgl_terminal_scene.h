#ifndef FIELDS_STICKS3_LVGL_TERMINAL_SCENE_H
#define FIELDS_STICKS3_LVGL_TERMINAL_SCENE_H

// This is the shared LVGL 8 scene: it owns widgets and binds ViewModel to
// them, but does not know whether LVGL is flushing to M5GFX or SDL.  Both the
// StickS3 and the PC firmware simulator must use this class.

#include <stdint.h>

#include "m5_efont_cn_lvgl.h"

#include "terminal_view_model.h"

namespace fields {
namespace terminal {
namespace ui {

class LvglTerminalScene {
 public:
  LvglTerminalScene();

  // The caller initializes LVGL and its display driver.  `screen` is normally
  // lv_scr_act(); width and height are the actual terminal framebuffer size.
  void begin(lv_obj_t* screen, int16_t width, int16_t height);
  void render(const ViewModel& view);
  bool started() const;

 private:
  void set_label(lv_obj_t* label, const std::string& text);

  int16_t width_;
  int16_t height_;
  lv_obj_t* state_label_;
  lv_obj_t* agent_label_;
  lv_obj_t* connection_label_;
  lv_obj_t* detail_label_;
  lv_obj_t* primary_label_;
  lv_obj_t* notice_label_;
  lv_obj_t* online_dot_;
  lv_obj_t* audio_level_;
  bool started_;
};

}  // namespace ui
}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_LVGL_TERMINAL_SCENE_H
