#include "framebuffer.h"

#include <cerrno>
#include <cstring>
#include <unistd.h>

namespace fields {
namespace sticks3 {

namespace {

void write_u16_le(uint8_t* bytes, uint16_t value) {
  bytes[0] = static_cast<uint8_t>(value & 0xff);
  bytes[1] = static_cast<uint8_t>((value >> 8) & 0xff);
}

void write_u32_le(uint8_t* bytes, uint32_t value) {
  bytes[0] = static_cast<uint8_t>(value & 0xff);
  bytes[1] = static_cast<uint8_t>((value >> 8) & 0xff);
  bytes[2] = static_cast<uint8_t>((value >> 16) & 0xff);
  bytes[3] = static_cast<uint8_t>((value >> 24) & 0xff);
}

}  // namespace

bool make_frame_record(uint32_t sequence, uint16_t width, uint16_t height,
                       const std::vector<uint16_t>& pixels,
                       std::vector<uint8_t>* record) {
  if (!record || width == 0 || height == 0 ||
      pixels.size() != static_cast<size_t>(width) * height) return false;
  const size_t payload_bytes = pixels.size() * sizeof(uint16_t);
  if (payload_bytes > 0xffffffffU) return false;
  record->assign(kFrameHeaderBytes + payload_bytes, 0);
  uint8_t* output = &(*record)[0];
  output[0] = 'S'; output[1] = '3'; output[2] = 'F'; output[3] = 'R';
  output[4] = kFrameVersion;
  output[5] = kFramePixelFormatRgb565Le;
  write_u16_le(output + 6, kFrameHeaderBytes);
  write_u32_le(output + 8, sequence);
  write_u16_le(output + 12, width);
  write_u16_le(output + 14, height);
  write_u32_le(output + 16, static_cast<uint32_t>(payload_bytes));
  for (size_t index = 0; index < pixels.size(); ++index) {
    write_u16_le(output + kFrameHeaderBytes + index * 2, pixels[index]);
  }
  return true;
}

bool write_frame_record(int descriptor, const std::vector<uint8_t>& record) {
  size_t written = 0;
  while (written < record.size()) {
    const ssize_t step = ::write(descriptor, &record[written], record.size() - written);
    if (step > 0) {
      written += static_cast<size_t>(step);
      continue;
    }
    if (step < 0 && errno == EINTR) continue;
    return false;
  }
  return true;
}

FramebufferRenderer* FramebufferRenderer::active_instance_ = 0;

FramebufferRenderer::FramebufferRenderer()
    : sequence_(0), started_(false), display_(0),
      draw_pixels_(static_cast<size_t>(kFrameWidth) * kFrameHeight),
      framebuffer_(static_cast<size_t>(kFrameWidth) * kFrameHeight, 0) {
  std::memset(&draw_buffer_, 0, sizeof(draw_buffer_));
  std::memset(&display_driver_, 0, sizeof(display_driver_));
}

void FramebufferRenderer::begin() {
  if (started_) return;
  lv_init();
  active_instance_ = this;
  lv_disp_draw_buf_init(&draw_buffer_, &draw_pixels_[0], 0, draw_pixels_.size());
  lv_disp_drv_init(&display_driver_);
  display_driver_.hor_res = kFrameWidth;
  display_driver_.ver_res = kFrameHeight;
  display_driver_.draw_buf = &draw_buffer_;
  display_driver_.flush_cb = flush;
  display_ = lv_disp_drv_register(&display_driver_);
  scene_.begin(lv_scr_act(), kFrameWidth, kFrameHeight);
  started_ = display_ != 0 && scene_.started();
}

void FramebufferRenderer::flush(lv_disp_drv_t* driver, const lv_area_t* area,
                                lv_color_t* color_buffer) {
  FramebufferRenderer* renderer = active_instance_;
  if (renderer && area && color_buffer) renderer->copy_flush(area, color_buffer);
  lv_disp_flush_ready(driver);
}

void FramebufferRenderer::copy_flush(const lv_area_t* area, const lv_color_t* color_buffer) {
  const int32_t x1 = area->x1 < 0 ? 0 : area->x1;
  const int32_t y1 = area->y1 < 0 ? 0 : area->y1;
  const int32_t x2 = area->x2 >= kFrameWidth ? kFrameWidth - 1 : area->x2;
  const int32_t y2 = area->y2 >= kFrameHeight ? kFrameHeight - 1 : area->y2;
  if (x1 > x2 || y1 > y2) return;
  const int32_t source_width = area->x2 - area->x1 + 1;
  for (int32_t y = y1; y <= y2; ++y) {
    const int32_t source_y = y - area->y1;
    for (int32_t x = x1; x <= x2; ++x) {
      const int32_t source_x = x - area->x1;
      const lv_color_t color = color_buffer[source_y * source_width + source_x];
      framebuffer_[static_cast<size_t>(y) * kFrameWidth + x] = color.full;
    }
  }
}

bool FramebufferRenderer::make_view_record(const fields::terminal::ui::ViewModel& view,
                                           std::vector<uint8_t>* record) {
  begin();
  if (!started_) return false;
  scene_.render(view);
  lv_refr_now(display_);
  ++sequence_;
  return make_frame_record(sequence_, kFrameWidth, kFrameHeight, framebuffer_, record);
}

}  // namespace sticks3
}  // namespace fields
