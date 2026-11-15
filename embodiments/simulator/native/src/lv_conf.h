#ifndef FIELDS_STICKS3_PC_LV_CONF_H
#define FIELDS_STICKS3_PC_LV_CONF_H
#define LV_CONF_H

// Host configuration mirrors the visual contract used by the pinned
// lv_m5_emulator LVGL8 profile while keeping the PC target framebuffer-only.
#include <stdint.h>

#define LV_COLOR_DEPTH 16
#define LV_COLOR_16_SWAP 0
#define LV_COLOR_SCREEN_TRANSP 1
#define LV_MEM_CUSTOM 0
#define LV_MEM_SIZE (64U * 1024U)
#define LV_MEM_BUF_MAX_NUM 16
#define LV_DISP_DEF_REFR_PERIOD 30
#define LV_INDEV_DEF_READ_PERIOD 30
#define LV_TICK_CUSTOM 0
#define LV_DPI_DEF 130
#define LV_DRAW_COMPLEX 1
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_SIMSUN_16_CJK 0
#define LV_USE_LOG 0

#endif  // FIELDS_STICKS3_PC_LV_CONF_H
