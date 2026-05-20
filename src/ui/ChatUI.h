#pragma once
#include <Arduino.h>
#include "DisplayManager.h"
#include "../character/CharacterManager.h"
#include "../audio/AudioRecorder.h"
#include "../audio/SpeechToText.h"
#include "../ai/LLMClient.h"
#include "../camera/CameraManager.h"

// ─────────────────────────────────────────────────────────────
// ChatUI — 顶层交互控制器
//
// 状态机：
//   IDLE ──[左键]──► RECORDING ──[左键]──► PROCESSING ──► DISPLAYING_REPLY
//   IDLE ──[右键]──► RECOGNIZING（拍照 → 识别 → 加载新角色）──► IDLE
// ─────────────────────────────────────────────────────────────
class ChatUI {
public:
    ChatUI(CharacterManager& charMgr,
           AudioRecorder&    recorder,
           SpeechToText&     stt,
           LLMClient&        llm,
           DisplayManager&   display,
           CameraManager&    camera);

    void begin();
    void update();

private:
    CharacterManager& _charMgr;
    AudioRecorder&    _recorder;
    SpeechToText&     _stt;
    LLMClient&        _llm;
    DisplayManager&   _display;
    CameraManager&    _camera;

    AppState _state;
    String   _lastReply;

    void _handleTouch();
    void _onMicButtonTap();
    void _onRecognizeButtonTap();
    void _processAndReply();
    void _runRecognition();

    bool _isTouchOnMicButton(int32_t x, int32_t y);
    bool _isTouchOnRecognizeButton(int32_t x, int32_t y);
};
