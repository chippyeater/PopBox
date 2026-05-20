#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"
#include "SpriteRenderer.h"

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

    // charIdx/charTotal: 当前角色序号和总数（显示 "1/3"），传 0 则不显示
    void drawFull(const String& characterName, AppState state,
                  const String& replyText = "",
                  int charIdx = 0, int charTotal = 0);
    void updateChatText(const String& text);
    void updateStatus(AppState state, int charIdx = 0, int charTotal = 0);
    // 绘制像素精灵头像（替代 JPEG）
    void drawSprite(const SpriteColors& colors, AppState state);
    // 仅更新精灵表情（状态变化时调用，不重绘整个头像区域）
    void updateSpriteExpression(const SpriteColors& colors, AppState state);

    void updateCharacterName(const String& name, int charIdx = 0, int charTotal = 0);

private:
    void _drawHeader(const String& name, AppState state, int charIdx = 0, int charTotal = 0);
    void _drawChatArea(const String& text);
    void _drawBottomBar(AppState state);

    static const char* _stateLabel(AppState s);
    static uint32_t    _stateLabelColor(AppState s);

    String   _lastCharName;
    AppState _lastState = AppState::IDLE;
};
