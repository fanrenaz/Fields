#include "m5_efont_cn_lvgl.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

// The Arduino M5GFX library compiles this official data source itself.  The
// native PC target explicitly compiles the same source from the pinned M5GFX
// submodule (see simulator/native/CMakeLists.txt).
extern "C" const uint8_t lgfx_efont_cn_16[];

namespace fields {
namespace terminal {
namespace ui {

namespace {

const uint8_t kEfontHeaderBytes = 23;
const uint8_t kMaximumGlyphWidth = 16;
const uint8_t kMaximumGlyphHeight = 16;
const uint8_t kBitmapBytes = kMaximumGlyphWidth * kMaximumGlyphHeight / 8;

struct BitReader {
  explicit BitReader(const uint8_t* source) : source(source), bit_position(0) {}

  uint32_t read_unsigned(uint8_t count) {
    const uint8_t previous_position = bit_position;
    uint32_t value = source[0] >> previous_position;
    uint8_t next_position = previous_position + count;
    if (next_position >= 8) {
      next_position -= 8;
      value |= static_cast<uint32_t>(*++source) << (8 - previous_position);
    }
    bit_position = next_position;
    return value & ((static_cast<uint32_t>(1) << count) - 1);
  }

  int16_t read_signed(uint8_t count) {
    return static_cast<int16_t>(read_unsigned(count)) - (static_cast<int16_t>(1) << (count - 1));
  }

  const uint8_t* source;
  uint8_t bit_position;
};

struct Glyph {
  Glyph() : source(0), width(0), height(0), offset_x(0), offset_y(0), advance(0) {}

  const uint8_t* source;
  uint8_t width;
  uint8_t height;
  int16_t offset_x;
  int16_t offset_y;
  int16_t advance;
};

const uint8_t* find_glyph(uint32_t letter) {
  if (letter > 0xffff) return 0;

  const uint16_t encoding = static_cast<uint16_t>(letter);
  const uint8_t* glyph = &lgfx_efont_cn_16[kEfontHeaderBytes];
  if (encoding <= 255) {
    if (encoding >= 'a') {
      glyph += (static_cast<uint16_t>(lgfx_efont_cn_16[19]) << 8) | lgfx_efont_cn_16[20];
    } else if (encoding >= 'A') {
      glyph += (static_cast<uint16_t>(lgfx_efont_cn_16[17]) << 8) | lgfx_efont_cn_16[18];
    }
    for (; glyph[1] != 0; glyph += glyph[1]) {
      if (glyph[0] == encoding) return glyph + 2;
    }
    return 0;
  }

  glyph += (static_cast<uint16_t>(lgfx_efont_cn_16[21]) << 8) | lgfx_efont_cn_16[22];
  const uint8_t* unicode_lookup = glyph;
  uint16_t range_last = 0;
  do {
    glyph += (static_cast<uint16_t>(unicode_lookup[0]) << 8) | unicode_lookup[1];
    range_last = (static_cast<uint16_t>(unicode_lookup[2]) << 8) | unicode_lookup[3];
    unicode_lookup += 4;
  } while (range_last < encoding);

  for (; true; glyph += glyph[2]) {
    const uint16_t glyph_encoding = (static_cast<uint16_t>(glyph[0]) << 8) | glyph[1];
    if (glyph_encoding == 0) return 0;
    if (glyph_encoding == encoding) return glyph + 3;
  }
}

bool decode_glyph(uint32_t letter, Glyph* output) {
  if (!output) return false;
  const uint8_t* source = find_glyph(letter);
  if (!source) return false;

  BitReader reader(source);
  Glyph glyph;
  glyph.source = source;
  glyph.width = static_cast<uint8_t>(reader.read_unsigned(lgfx_efont_cn_16[4]));
  glyph.height = static_cast<uint8_t>(reader.read_unsigned(lgfx_efont_cn_16[5]));
  glyph.offset_x = reader.read_signed(lgfx_efont_cn_16[6]);
  glyph.offset_y = reader.read_signed(lgfx_efont_cn_16[7]);
  glyph.advance = reader.read_signed(lgfx_efont_cn_16[8]);
  if (glyph.width > kMaximumGlyphWidth || glyph.height > kMaximumGlyphHeight || glyph.advance < 0) {
    return false;
  }
  *output = glyph;
  return true;
}

int16_t baseline_from_top() {
  return static_cast<int16_t>(static_cast<int8_t>(lgfx_efont_cn_16[10]) +
                              static_cast<int8_t>(lgfx_efont_cn_16[12]));
}

bool get_glyph_dsc(const lv_font_t*, lv_font_glyph_dsc_t* output, uint32_t letter, uint32_t) {
  Glyph glyph;
  if (!output || !decode_glyph(letter, &glyph)) return false;
  output->resolved_font = &m5_efont_cn_16;
  output->adv_w = static_cast<uint16_t>(glyph.advance);
  output->box_w = glyph.width;
  output->box_h = glyph.height;
  output->ofs_x = glyph.offset_x;
  output->ofs_y = static_cast<int16_t>(baseline_from_top() - glyph.offset_y - glyph.height);
  output->bpp = 1;
  output->is_placeholder = 0;
  return true;
}

struct BitmapCache {
  BitmapCache() : letter(0), valid(false) { memset(bitmap, 0, sizeof(bitmap)); }

  uint32_t letter;
  bool valid;
  uint8_t bitmap[kBitmapBytes];
};

BitmapCache bitmap_cache;

bool rasterize(const Glyph& glyph, uint8_t* bitmap) {
  if (!bitmap) return false;
  memset(bitmap, 0, kBitmapBytes);
  BitReader reader(glyph.source);
  reader.read_unsigned(lgfx_efont_cn_16[4]);
  reader.read_unsigned(lgfx_efont_cn_16[5]);
  reader.read_signed(lgfx_efont_cn_16[6]);
  reader.read_signed(lgfx_efont_cn_16[7]);
  reader.read_signed(lgfx_efont_cn_16[8]);

  uint8_t x = 0;
  uint8_t y = 0;
  uint16_t safety_counter = 0;
  while (y < glyph.height) {
    const uint32_t run_length[2] = {
        reader.read_unsigned(lgfx_efont_cn_16[2]),
        reader.read_unsigned(lgfx_efont_cn_16[3]),
    };
    bool foreground = false;
    do {
      uint32_t remaining = run_length[foreground ? 1 : 0];
      while (remaining > 0) {
        const uint32_t segment = (remaining > glyph.width - x) ? glyph.width - x : remaining;
        if (foreground) {
          for (uint32_t index = 0; index < segment; ++index) {
            // LVGL stores glyph rows as one continuous bitstream; rows whose
            // width is not divisible by eight must not receive byte padding.
            const uint32_t bit_index = y * glyph.width + x + index;
            bitmap[bit_index / 8] |= static_cast<uint8_t>(0x80u >> (bit_index & 7));
          }
        }
        remaining -= segment;
        x = static_cast<uint8_t>(x + segment);
        if (x == glyph.width) {
          x = 0;
          ++y;
          if (y == glyph.height) return true;
        }
      }
      foreground = !foreground;
      if (++safety_counter > 4096) return false;
    } while (foreground || reader.read_unsigned(1) != 0);
  }
  return true;
}

const uint8_t* get_glyph_bitmap(const lv_font_t*, uint32_t letter) {
  if (bitmap_cache.valid && bitmap_cache.letter == letter) return bitmap_cache.bitmap;
  Glyph glyph;
  if (!decode_glyph(letter, &glyph) || !rasterize(glyph, bitmap_cache.bitmap)) return 0;
  bitmap_cache.letter = letter;
  bitmap_cache.valid = true;
  return bitmap_cache.bitmap;
}

}  // namespace

const lv_font_t m5_efont_cn_16 = {
    get_glyph_dsc,
    get_glyph_bitmap,
    16,
    2,
    LV_FONT_SUBPX_NONE,
    -1,
    1,
    0,
    0,
#if LV_USE_USER_DATA
    0,
#endif
};

}  // namespace ui
}  // namespace terminal
}  // namespace fields
