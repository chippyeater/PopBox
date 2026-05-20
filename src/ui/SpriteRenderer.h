#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "SpriteData.h"
#include "DisplayManager.h"  // AppState 定义

// ─────────────────────────────────────────────────────────────
// SpriteColors — 角色专属配色
// hex 字符串格式："#FFDDB5" 或 "FFDDB5"
// ─────────────────────────────────────────────────────────────
struct SpriteColors {
    String skin;     // 皮肤  (颜色索引 1)
    String hair;     // 头发  (颜色索引 2)
    String clothes;  // 服装  (颜色索引 4)
    String blush;    // 腮红  (颜色索引 5)

    bool hasColors() const { return !hair.isEmpty(); }

    // 带默认值的工厂方法
    static SpriteColors defaults() {
        return { "#FFDDB5", "#5A3E2B", "#6B5BCD", "#FF8FA0" };
    }

    // hex 字符串转 RGB888 uint32_t
    static uint32_t toRGB(const String& hex) {
        String h = hex.startsWith("#") ? hex.substring(1) : hex;
        return (uint32_t)strtoul(h.c_str(), nullptr, 16);
    }
};

// ─────────────────────────────────────────────────────────────
// SpriteRenderer — 绘制像素精灵到 M5GFX 屏幕
// ─────────────────────────────────────────────────────────────
class SpriteRenderer {
public:
    // AppState → 表情模板
    static const uint8_t (*spriteForState(AppState state))[SpriteData::COLS];

    // 绘制精灵
    // x, y: 左上角坐标；pixelSize: 每格渲染的像素数（5 = 80×80）
    static void draw(int32_t x, int32_t y, int pixelSize,
                     const uint8_t sprite[SpriteData::ROWS][SpriteData::COLS],
                     const SpriteColors& colors);

    // 快捷方法：按 AppState 选表情后绘制
    static void drawForState(int32_t x, int32_t y, int pixelSize,
                             AppState state, const SpriteColors& colors);

private:
    static uint32_t _resolve(int idx, const SpriteColors& colors);
};
