#include <assert.h>

#include <stdint.h>

#include <string>

#include "m5_efont_cn_lvgl.h"

namespace {

uint32_t next_utf8(const char** value) {
  const unsigned char* bytes = reinterpret_cast<const unsigned char*>(*value);
  uint32_t codepoint = 0;
  uint8_t byte_count = 0;
  if (bytes[0] < 0x80) {
    codepoint = bytes[0];
    byte_count = 1;
  } else if ((bytes[0] & 0xe0) == 0xc0) {
    codepoint = bytes[0] & 0x1f;
    byte_count = 2;
  } else if ((bytes[0] & 0xf0) == 0xe0) {
    codepoint = bytes[0] & 0x0f;
    byte_count = 3;
  } else {
    return 0;
  }
  for (uint8_t index = 1; index < byte_count; ++index) {
    codepoint = (codepoint << 6) | (bytes[index] & 0x3f);
  }
  *value += byte_count;
  return codepoint;
}

void assert_text_is_covered(const std::string& text) {
  for (const char* cursor = text.c_str(); *cursor;) {
    const uint32_t codepoint = next_utf8(&cursor);
    lv_font_glyph_dsc_t descriptor;
    assert(codepoint != 0);
    assert(lv_font_get_glyph_dsc(&fields::terminal::ui::m5_efont_cn_16, &descriptor, codepoint, 0));
    assert(descriptor.adv_w > 0 || codepoint == ' ');
  }
}

}  // namespace

int main() {
  assert_text_is_covered("语音通话");
  assert_text_is_covered("空闲来电已接通播放中等待说话录音中正在挂断未知");
  assert_text_is_covered("按左键接听按右键拒接停止请稍候等待来电");
  assert_text_is_covered("智能体正在连接网络校准时间请求配对码等待 Owner 认领服务在线离线");
  assert_text_is_covered("在 Owner 控制台输入配对码正在播放语音音频就绪录音 12 / 60 秒");
  assert_text_is_covered("配对码无效或已过期终端未确认凭据。请重试。");

  lv_font_glyph_dsc_t descriptor;
  assert(lv_font_get_glyph_dsc(&fields::terminal::ui::m5_efont_cn_16, &descriptor, 0x8bed, 0));
  assert(descriptor.box_w == 15 && descriptor.box_h == 16 && descriptor.bpp == 1);
  const uint8_t* bitmap = lv_font_get_glyph_bitmap(&fields::terminal::ui::m5_efont_cn_16, 0x8bed);
  assert(bitmap != 0);
  bool has_ink = false;
  for (uint8_t index = 0; index < 32; ++index) has_ink = has_ink || bitmap[index] != 0;
  assert(has_ink);
  return 0;
}
