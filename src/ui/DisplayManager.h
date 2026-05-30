#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"
#include "AppState.h"

// 全局配色与字体常量（DisplayManager.cpp 中实现）
extern const uint32_t C_NEON;
extern const lgfx::IFont* FONT_L;

// ─────────────────────────────────────────────────────────────
// DisplayManager — 屏幕布局渲染
//
// 按状态渲染不同布局：
//   NO_CHARACTER     → 全屏"正在等待人物入住"
//   CHARACTER_SELECT → 角色选择卡片（最多3人一排）
//   RECOGNIZING      → 识别中文字 + 进度条
//   GREETING         → 左半角色头像+名字 / 右半招呼语
//   CHATTING         → 左半角色头像+名字 / 右半角色回复
//   IDLE             → 全屏角色头像+名字居中
//   PHYSICAL         → 由外部调 Special 动效
// ─────────────────────────────────────────────────────────────

// 角色选择卡片布局常量（DisplayManager 与 ChatUI 共享）
static constexpr int CARD_W    = 95;
static constexpr int CARD_H    = 108;
static constexpr int CARD_GAP  = 12;
static constexpr int CARD_Y    = 50;
static constexpr int AVATAR_S  = 66;

// IDLE 状态"换角色"按钮
static constexpr int SWITCH_BTN_X = 4;
static constexpr int SWITCH_BTN_Y = 4;
static constexpr int SWITCH_BTN_W = 76;
static constexpr int SWITCH_BTN_H = 22;

class DisplayManager {
public:
    void begin();

    // 全屏状态：无人入住 / 角色数量选择 / 待机
    void drawNoCharacter();
    void drawCountSelection(int existingCount);
    void drawIdle(const String& name, const String& avatarPath,
                  const String& expression = "");

    // 角色选择：展示角色卡片（姓名 + 头像）
    void drawCharacterSelect(const String names[], const String avatarPaths[], int count);

    // 识别中：文字 + 进度条动画
    void drawRecognizing(int step);

    // 第一位角色识别成功：展示角色名 + 提示识别第二位
    void drawFirstRecognitionResult(const String& name);

    // 左右分栏：打招呼 / 交流（avatarPath 为 /avatar.jpg 等）
    void drawSplitLayout(const String& name, const String& avatarPath,
                         const String& text, const String& expression = "");

    // 群聊布局：全屏显示对话文本，不显示头像
    void drawGroupLayout(const String& nameA, const String& nameB,
                         const String& conversationText);
    // 群聊待机：双角色头像 + 名字
    void drawGroupIdle(const String& nameA, const String& avatarPathA,
                       const String& nameB, const String& avatarPathB);
    // 更新群聊文字（追加一行新的角色回复，保留上下文）
    void appendGroupText(const String& speakerName, const String& text);

    // 更新右侧文字（不刷新左半）
    void updateRightText(const String& text);

    // 底部按钮栏
    void showBottomBar(bool showRecognize);
    void hideBottomBar();

    // 声波动画指示器（level 0-100，0 = 待机呼吸，>0 = 音频能量）
    void drawWaveIcon(int level);

    // 识别进度条动画步进（内部用）
    int  progressStep;

private:
    void _drawRightText(const String& text);
    void _drawAvatar(int32_t x, int32_t y, int32_t w, int32_t h,
                     const String& avatarPath, float scale = 1.0f);
    void _drawAvatarTransparent(int32_t x, int32_t y, int32_t w, int32_t h,
                                const String& avatarPath, float scale = 1.0f);
    void _drawNameAt(int32_t x, int32_t y, const String& name);
    void _drawButton(int32_t x, int32_t y, int32_t w, int32_t h,
                     uint32_t col, uint32_t shadowCol, const char* label,
                     bool disabled = false);
    void _wrapText(const String& text, int32_t maxWidth,
                   String* lines, int& lineCount, int maxLines);
    String _resolveAvatarPath(const String& basePath, const String& expression);
    void _drawGroupText(const String& text);  // 群聊文本区域绘制

    String   _lastRightText;
    AppState _lastState = AppState::NO_CHARACTER;
};
