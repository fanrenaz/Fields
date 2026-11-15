#include "lvgl_terminal_scene.h"

#if LVGL_VERSION_MAJOR != 8
#error "StickS3_Call requires LVGL 8.x; install LVGL 8.3.11 from Arduino Library Manager."
#endif

namespace fields {
namespace terminal {
namespace ui {

namespace {

lv_color_t color(uint8_t red, uint8_t green, uint8_t blue) {
  return lv_color_make(red, green, blue);
}

void apply_text(lv_obj_t* object, lv_color_t value, const lv_font_t* font, lv_text_align_t align) {
  lv_obj_set_style_text_color(object, value, LV_PART_MAIN);
  lv_obj_set_style_text_font(object, font, LV_PART_MAIN);
  lv_obj_set_style_text_align(object, align, LV_PART_MAIN);
  lv_label_set_long_mode(object, LV_LABEL_LONG_DOT);
}

}  // namespace

LvglTerminalScene::LvglTerminalScene()
    : width_(0), height_(0), state_label_(0), agent_label_(0), connection_label_(0), detail_label_(0),
      primary_label_(0), notice_label_(0), online_dot_(0), audio_level_(0), started_(false) {}

void LvglTerminalScene::begin(lv_obj_t* screen, int16_t width, int16_t height) {
  if (started_ || !screen || width < 80 || height < 80) return;
  width_ = width;
  height_ = height;
  lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(screen, color(0, 0, 0), LV_PART_MAIN);

  lv_obj_t* header = lv_obj_create(screen);
  lv_obj_set_size(header, width_, 22);
  lv_obj_set_pos(header, 0, 0);
  lv_obj_clear_flag(header, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_border_width(header, 0, LV_PART_MAIN);
  lv_obj_set_style_radius(header, 0, LV_PART_MAIN);
  lv_obj_set_style_bg_color(header, color(20, 25, 32), LV_PART_MAIN);
  lv_obj_t* title = lv_label_create(header);
  lv_label_set_text(title, "语音通话");
  lv_obj_set_pos(title, 8, 4);
  apply_text(title, color(255, 255, 255), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  online_dot_ = lv_obj_create(header);
  lv_obj_set_size(online_dot_, 8, 8);
  lv_obj_set_pos(online_dot_, width_ - 14, 7);
  lv_obj_set_style_radius(online_dot_, LV_RADIUS_CIRCLE, LV_PART_MAIN);
  lv_obj_set_style_border_width(online_dot_, 0, LV_PART_MAIN);

  state_label_ = lv_label_create(screen);
  lv_obj_set_size(state_label_, width_ - 16, 18);
  lv_obj_set_pos(state_label_, 8, 27);
  apply_text(state_label_, color(70, 180, 255), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  agent_label_ = lv_label_create(screen);
  lv_obj_set_size(agent_label_, width_ - 16, 16);
  lv_obj_set_pos(agent_label_, 8, 47);
  apply_text(agent_label_, color(255, 255, 255), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  connection_label_ = lv_label_create(screen);
  lv_obj_set_size(connection_label_, width_ - 16, 14);
  lv_obj_set_pos(connection_label_, 8, 66);
  apply_text(connection_label_, color(145, 155, 170), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  audio_level_ = lv_bar_create(screen);
  lv_obj_set_size(audio_level_, width_ - 16, 6);
  lv_obj_set_pos(audio_level_, 8, 84);
  lv_bar_set_range(audio_level_, 0, 100);
  lv_obj_set_style_bg_color(audio_level_, color(35, 42, 52), LV_PART_MAIN);
  lv_obj_set_style_bg_color(audio_level_, color(70, 180, 255), LV_PART_INDICATOR);
  detail_label_ = lv_label_create(screen);
  lv_obj_set_size(detail_label_, width_ - 16, 14);
  lv_obj_set_pos(detail_label_, 8, 95);
  apply_text(detail_label_, color(145, 155, 170), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  primary_label_ = lv_label_create(screen);
  lv_obj_set_size(primary_label_, width_ - 16, 18);
  lv_obj_set_pos(primary_label_, 8, 109);
  apply_text(primary_label_, color(255, 255, 255), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  notice_label_ = lv_label_create(screen);
  lv_obj_set_size(notice_label_, width_ - 16, 11);
  lv_obj_set_pos(notice_label_, 8, height_ - 12);
  apply_text(notice_label_, color(255, 190, 0), &m5_efont_cn_16, LV_TEXT_ALIGN_LEFT);
  started_ = true;
}

void LvglTerminalScene::set_label(lv_obj_t* label, const std::string& text) {
  lv_label_set_text(label, text.c_str());
}

void LvglTerminalScene::render(const ViewModel& view) {
  if (!started_) return;
  set_label(state_label_, view.state_label);
  set_label(agent_label_, view.agent_label);
  set_label(connection_label_, view.connection_label);
  set_label(detail_label_, view.detail_label);
  set_label(primary_label_, view.primary_label);
  set_label(notice_label_, view.notice);
  lv_obj_set_style_bg_color(online_dot_, view.online ? color(50, 220, 150) : color(100, 110, 120), LV_PART_MAIN);
  lv_obj_set_style_text_color(state_label_, view.recording ? color(255, 80, 90) : color(70, 180, 255), LV_PART_MAIN);
  lv_obj_set_style_text_color(primary_label_, view.pairing ? color(255, 190, 0) : color(255, 255, 255), LV_PART_MAIN);
  lv_obj_set_style_bg_color(audio_level_, view.recording ? color(255, 80, 90) : color(70, 180, 255), LV_PART_INDICATOR);
  lv_bar_set_value(audio_level_, view.audio_level, LV_ANIM_OFF);
}

bool LvglTerminalScene::started() const { return started_; }

}  // namespace ui
}  // namespace terminal
}  // namespace fields
