#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"

// 应用状态，决定 UI 显示内容
enum class AppState {
    IDLE,               // 待机，显示角色头像和提示语
    RECORDING,          // 录音中
    PROCESSING,         // 处理中（STT / LLM）
    DISPLAYING_REPLY,   // 展示角色回复

    // [EXTENSION POINT] 后续状态
    // RECOGNIZING_PHOTO,
    // FETCHING_WEB_INFO,
};

// ─────────────────────────────────────────────────────────────
// DisplayManager — 屏幕布局与绘制
//
// 屏幕布局（320×240）：
//   ┌────────────────────────────────┐
//   │ [头像 90×90]   角色名          │  ← 头部区域 (0~105)
//   │                状态文字        │
//   ├────────────────────────────────┤
//   │                                │  ← 聊天区域 (110~205)
//   │         角色回复文字           │
//   ├────────────────────────────────┤
//   │          [ 点击说话 ]          │  ← 底部按钮 (210~240)
//   └────────────────────────────────┘
// ─────────────────────────────────────────────────────────────
class DisplayManager {
public:
    void begin();

    // 绘制完整界面（初次或状态切换时调用）
    void drawFull(const String& characterName, AppState state,
                  const String& replyText = "");

    // 仅更新聊天文字区域（回复滚动更新时调用）
    void updateChatText(const String& text);

    // 仅更新状态栏文字
    void updateStatus(AppState state);

    // 绘制角色头像（从 SPIFFS JPEG）
    bool drawAvatar(const char* path);

private:
    M5Canvas _canvas; // 离屏缓冲，防止闪烁

    void _drawHeader(const String& name, AppState state);
    void _drawChatArea(const String& text);
    void _drawMicButton(AppState state);

    static const char* _stateLabel(AppState s);
    static uint32_t    _stateLabelColor(AppState s);
};
