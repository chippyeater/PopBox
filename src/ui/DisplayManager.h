#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"

// 屏幕布局（320×240）：
//   ┌──────────────────────────────────┐
//   │ [头像 90×90]   角色名            │  ← 头部 (0~108)
//   │                状态文字          │
//   ├──────────────────────────────────┤
//   │         角色回复文字             │  ← 聊天区 (110~205)
//   ├──────────────────────────────────┤
//   │  [● 点击说话 ]   [📷 识别角色]  │  ← 底部双按钮 (208~240)
//   └──────────────────────────────────┘

enum class AppState {
    IDLE,
    RECORDING,
    PROCESSING,
    DISPLAYING_REPLY,
    RECOGNIZING,    // 拍照 + 后端识别中
};

class DisplayManager {
public:
    void begin();

    void drawFull(const String& characterName, AppState state,
                  const String& replyText = "");
    void updateChatText(const String& text);
    void updateStatus(AppState state);
    bool drawAvatar(const char* path);

    // 重绘角色名（识别后更新）
    void updateCharacterName(const String& name);

private:
    void _drawHeader(const String& name, AppState state);
    void _drawChatArea(const String& text);
    void _drawBottomBar(AppState state);

    static const char* _stateLabel(AppState s);
    static uint32_t    _stateLabelColor(AppState s);

    String _lastCharName;
};
