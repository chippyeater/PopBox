#pragma once
#include <Arduino.h>
#include "DisplayManager.h"
#include "../character/CharacterManager.h"
#include "../audio/AudioRecorder.h"
#include "../audio/SpeechToText.h"
#include "../ai/LLMClient.h"

// ─────────────────────────────────────────────────────────────
// ChatUI — 顶层交互控制器
// 管理状态机、触摸输入、调用各模块、更新显示
//
// 状态机流转：
//   IDLE ──[点击]──► RECORDING
//   RECORDING ──[点击]──► PROCESSING（STT → LLM）
//   PROCESSING ──[完成]──► DISPLAYING_REPLY
//   DISPLAYING_REPLY ──[自动/点击]──► IDLE
// ─────────────────────────────────────────────────────────────
class ChatUI {
public:
    ChatUI(CharacterManager& charMgr,
           AudioRecorder&    recorder,
           SpeechToText&     stt,
           LLMClient&        llm,
           DisplayManager&   display);

    void begin();
    void update(); // 在 loop() 中调用

private:
    CharacterManager& _charMgr;
    AudioRecorder&    _recorder;
    SpeechToText&     _stt;
    LLMClient&        _llm;
    DisplayManager&   _display;

    AppState _state;
    String   _lastReply;

    void _handleTouch();
    void _onMicButtonTap();
    void _processAndReply();

    bool _isTouchOnMicButton(int32_t x, int32_t y);
};
