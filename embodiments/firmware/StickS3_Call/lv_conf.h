/**
 * LVGL 8 configuration for the physical M5StickS3 sketch.
 *
 * Keep this next to the sketch so Arduino's include search can resolve it
 * when LV_CONF_INCLUDE_SIMPLE is set before including lvgl.h.
 */
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH 16
#define LV_COLOR_16_SWAP 0

// The shared terminal scene uses the M5GFX efont adapter instead.
#define LV_FONT_SIMSUN_16_CJK 0

#endif  // LV_CONF_H
