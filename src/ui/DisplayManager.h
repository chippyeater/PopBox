#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"
#include "AppState.h"
#include "SpriteRenderer.h"

class DisplayManager {
public:
    void begin();

    void drawFull(const String& characterName, AppState state,
                  const String& replyText = "",
                  int charIdx = 0, int charTotal = 0);

    // 对话气泡接口
    void addMessage(const String& text, bool isUser);  // 追加一条消息
    void clearMessages();                              // 切换角色时清空
    void showThinking();                               // 显示"思考中…"占位
    void removeThinking();                             // 移除占位，由 addMessage 自动调用

    void updateStatus(AppState state, int charIdx = 0, int charTotal = 0);
    void updateChatText(const String& text);  // 兼容旧调用（单行提示）
    void drawSprite(const SpriteColors& colors, AppState state);
    void updateSpriteExpression(const SpriteColors& colors, AppState state);
    void updateCharacterName(const String& name, int charIdx = 0, int charTotal = 0);

private:
    // 消息历史
    static const int MSG_MAX = 6;
    struct ChatMsg {
        bool    isUser;
        String  text;
        bool    isThinking;  // 临时占位气泡
    };
    ChatMsg _msgs[MSG_MAX];
    int     _msgCount    = 0;
    bool    _hasThinking = false;

    void _drawHeader(const String& name, AppState state, int charIdx = 0, int charTotal = 0);
    void _drawChatHistory();
    void _drawBottomBar(AppState state);
    void _drawStatusBadge(int32_t x, int32_t y, AppState state);

    String   _lastCharName;
    AppState _lastState = AppState::IDLE;
};
