#include "SpriteRenderer.h"

// AppState → 精灵模板
const uint8_t (*SpriteRenderer::spriteForState(AppState state))[SpriteData::COLS] {
    switch (state) {
        case AppState::RECOGNIZING:
            return SpriteData::THINKING;
        case AppState::GREETING:
            return SpriteData::HAPPY;
        case AppState::PHYSICAL:
            return SpriteData::SHOCK;
        default:
            return SpriteData::IDLE;
    }
}

// 颜色索引 → RGB888
uint32_t SpriteRenderer::_resolve(int idx, const SpriteColors& colors) {
    switch (idx) {
        case 1: return SpriteColors::toRGB(
                    colors.skin.isEmpty() ? "#E8B089" : colors.skin);
        case 2: return SpriteColors::toRGB(
                    colors.hair.isEmpty() ? "#F47F20" : colors.hair);
        case 3: return 0x2A2A2A;  // 深色固定
        case 4: return SpriteColors::toRGB(
                    colors.clothes.isEmpty() ? "#FF6B35" : colors.clothes);
        case 5: return SpriteColors::toRGB(
                    colors.blush.isEmpty() ? "#FFB0B0" : colors.blush);
        default: return 0x000000;
    }
}

void SpriteRenderer::draw(int32_t x, int32_t y, int pixelSize,
                           const uint8_t sprite[SpriteData::ROWS][SpriteData::COLS],
                           const SpriteColors& colors) {
    for (int r = 0; r < SpriteData::ROWS; r++) {
        for (int c = 0; c < SpriteData::COLS; c++) {
            uint8_t v = sprite[r][c];
            if (v == 0) continue;
            uint32_t color = _resolve(v, colors);
            M5.Display.fillRect(
                x + c * pixelSize,
                y + r * pixelSize,
                pixelSize, pixelSize,
                color
            );
        }
    }
}

void SpriteRenderer::drawForState(int32_t x, int32_t y, int pixelSize,
                                   AppState state, const SpriteColors& colors) {
    draw(x, y, pixelSize, spriteForState(state), colors);
}
