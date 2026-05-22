#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"
#include "AppState.h"

// ─────────────────────────────────────────────────────────────
// DisplayManager — 屏幕布局渲染
//
// 按状态渲染不同布局：
//   NO_CHARACTER → 全屏"正在等待人物入住"
//   RECOGNIZING  → 识别中文字 + 进度条
//   GREETING     → 左半角色头像+名字 / 右半招呼语
//   CHATTING     → 左半角色头像+名字 / 右半角色回复
//   IDLE         → 全屏角色头像+名字居中
//   PHYSICAL     → 由外部调 Special 动效
// ─────────────────────────────────────────────────────────────
class DisplayManager {
public:
    void begin();

    // 全屏状态：无人入住 / 待机
    void drawNoCharacter();
    void drawIdle(const String& name, const String& avatarPath,
                  const String& expression = "");

    // 识别中：文字 + 进度条动画
    void drawRecognizing(int step);

    // 左右分栏：打招呼 / 交流（avatarPath 为 /avatar.jpg 等）
    void drawSplitLayout(const String& name, const String& avatarPath,
                         const String& text, const String& expression = "");

    // 更新右侧文字（不刷新左半）
    void updateRightText(const String& text);

    // 底部按钮栏
    void showBottomBar(bool showRecognize);
    void hideBottomBar();

    // 识别进度条动画步进（内部用）
    int  progressStep;

private:
    void _drawRightText(const String& text);
    void _drawAvatar(int32_t x, int32_t y, int32_t w, int32_t h,
                     const String& avatarPath);
    void _drawNameAt(int32_t x, int32_t y, const String& name);
    void _drawButton(int32_t x, int32_t y, int32_t w, int32_t h,
                     uint32_t col, uint32_t shadowCol, const char* label,
                     bool disabled = false);
    void _wrapText(const String& text, int32_t maxWidth,
                   String* lines, int& lineCount, int maxLines);
    String _resolveAvatarPath(const String& basePath, const String& expression);

    String   _lastRightText;
    AppState _lastState = AppState::NO_CHARACTER;
};
