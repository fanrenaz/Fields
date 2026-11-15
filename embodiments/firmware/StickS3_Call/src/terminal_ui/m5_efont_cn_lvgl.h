#ifndef FIELDS_STICKS3_M5_EFONT_CN_LVGL_H
#define FIELDS_STICKS3_M5_EFONT_CN_LVGL_H

// M5GFX bundles the Electronic Font Open Laboratory (efont) Chinese bitmap
// font.  This adapter exposes the official efontCN_16 data through LVGL 8's
// font callbacks, so the physical StickS3 and the PC renderer keep one LVGL
// scene and one Chinese glyph set.

#ifndef LV_CONF_INCLUDE_SIMPLE
#define LV_CONF_INCLUDE_SIMPLE
#endif

#include <lvgl.h>

namespace fields {
namespace terminal {
namespace ui {

extern const lv_font_t m5_efont_cn_16;

}  // namespace ui
}  // namespace terminal
}  // namespace fields

#endif  // FIELDS_STICKS3_M5_EFONT_CN_LVGL_H
