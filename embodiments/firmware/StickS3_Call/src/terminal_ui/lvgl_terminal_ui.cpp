#include "lvgl_terminal_ui.h"

namespace fields {
namespace terminal {
namespace ui {

LvglTerminalUi* LvglTerminalUi::active_instance_ = 0;

LvglTerminalUi::LvglTerminalUi()
    : display_(0), started_(false) {}

void LvglTerminalUi::begin(M5GFX& display) {
  if (started_) return;
  display_ = &display;
  active_instance_ = this;
  lv_init();
  lv_disp_draw_buf_init(&draw_buffer_, draw_buffer_a_, 0, kWidth * kDrawRows);
  lv_disp_drv_init(&display_driver_);
  display_driver_.hor_res = kWidth;
  display_driver_.ver_res = kHeight;
  display_driver_.flush_cb = flush;
  display_driver_.draw_buf = &draw_buffer_;
  lv_disp_drv_register(&display_driver_);

  scene_.begin(lv_scr_act(), kWidth, kHeight);
  started_ = true;
}

void LvglTerminalUi::render(const ViewModel& view) {
  if (!started_) return;
  scene_.render(view);
}

void LvglTerminalUi::tick() {
  if (started_) lv_timer_handler();
}

void LvglTerminalUi::flush(lv_disp_drv_t* driver, const lv_area_t* area, lv_color_t* color_buffer) {
  LvglTerminalUi* ui = active_instance_;
  if (ui && ui->display_) {
    const int32_t width = area->x2 - area->x1 + 1;
    const int32_t height = area->y2 - area->y1 + 1;
    ui->display_->pushImage(area->x1, area->y1, width, height,
                            reinterpret_cast<uint16_t*>(color_buffer));
  }
  lv_disp_flush_ready(driver);
}

}  // namespace ui
}  // namespace terminal
}  // namespace fields
