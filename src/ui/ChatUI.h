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
// 右键交互：
//   短按（< 600ms） → 切换到下一个已收藏角色
//   长按（≥ 600ms） → 拍照识别新角色（加入收藏夹）
// ─────────────────────────────────────────────────────────────
class ChatUI {
public:
    ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
           SpeechToText& stt, LLMClient& llm,
           DisplayManager& display, CameraManager& camera);

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
    uint32_t _camPressStart;  // 右键按下时间
    bool     _camPressing;    // 右键是否正在被按住

    void _setState(AppState s);  // 更新状态 + 精灵表情 + 状态栏
    void _handleTouch();
    void _onMicButtonTap();
    void _onRecognizeButtonShortTap();   // 切换角色
    void _onRecognizeButtonLongPress();  // 拍照识别
    void _processAndReply();
    void _runRecognition();

    bool _isTouchOnMicButton(int32_t x, int32_t y);
    bool _isTouchOnRecognizeButton(int32_t x, int32_t y);
};
