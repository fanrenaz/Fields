#ifndef FIELDS_STICKS3_FRAMEBUFFER_H
#define FIELDS_STICKS3_FRAMEBUFFER_H

#include <stdint.h>

#include <string>
#include <vector>

#include <lvgl.h>

#include "lvgl_terminal_scene.h"
#include "terminal_view_model.h"

namespace fields {
namespace sticks3 {

static const uint16_t kFrameWidth = 240;
static const uint16_t kFrameHeight = 135;
static const uint8_t kFrameVersion = 1;
static const uint8_t kFramePixelFormatRgb565Le = 1;
static const uint16_t kFrameHeaderBytes = 20;

// Makes the fixed fd 3 record consumed by the PC bridge.  The wire record is
// `S3FR`, version, RGB565LE, header length, sequence, width, height, payload
// bytes, then exactly width*height RGB565LE pixels.
bool make_frame_record(uint32_t sequence, uint16_t width, uint16_t height,
                       const std::vector<uint16_t>& pixels,
                       std::vector<uint8_t>* record);
bool write_frame_record(int descriptor, const std::vector<uint8_t>& record);

// Headless LVGL display target.  It owns no parallel widget tree: the scene is
// the same LVGL8 widget tree that the M5 display adapter renders.
class FramebufferRenderer {
 public:
  FramebufferRenderer();
  bool make_view_record(const fields::terminal::ui::ViewModel& view,
                        std::vector<uint8_t>* record);

 private:
  static void flush(lv_disp_drv_t* driver, const lv_area_t* area,
                    lv_color_t* color_buffer);
  static FramebufferRenderer* active_instance_;

  void begin();
  void copy_flush(const lv_area_t* area, const lv_color_t* color_buffer);

  uint32_t sequence_;
  bool started_;
  lv_disp_draw_buf_t draw_buffer_;
  lv_disp_drv_t display_driver_;
  lv_disp_t* display_;
  std::vector<lv_color_t> draw_pixels_;
  std::vector<uint16_t> framebuffer_;
  fields::terminal::ui::LvglTerminalScene scene_;
};

}  // namespace sticks3
}  // namespace fields

#endif  // FIELDS_STICKS3_FRAMEBUFFER_H
