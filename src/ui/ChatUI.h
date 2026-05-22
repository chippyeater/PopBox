#pragma once
#include <Arduino.h>
#include "DisplayManager.h"
#include "../character/CharacterManager.h"
#include "../audio/AudioRecorder.h"
#include "../audio/SpeechToText.h"
#include "../audio/TextToSpeech.h"
#include "../ai/LLMClient.h"
#include "../camera/CameraManager.h"

// ─────────────────────────────────────────────────────────────
// ChatUI — 顶层交互控制器
//
// 触摸交互：
//   点击头像区域    → 切换到下一个已收藏角色
//   点击识别角色键  → 拍照识别新角色（加入收藏夹）
//   点击麦克风键    → 开始/停止录音
// ─────────────────────────────────────────────────────────────
class ChatUI {
public:
    ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
           SpeechToText& stt, TextToSpeech& tts, LLMClient& llm,
           DisplayManager& display, CameraManager& camera);

    void begin();
    void update();

private:
    CharacterManager& _charMgr;
    AudioRecorder&    _recorder;
    SpeechToText&     _stt;
    TextToSpeech&     _tts;
    LLMClient&        _llm;
    DisplayManager&   _display;
    CameraManager&    _camera;

    AppState _state;
    void _setState(AppState s);
    void _handleTouch();
    void _onMicButtonTap();
    void _onAvatarTap();          // 点击头像：切换角色
    void _processAndReply();
    void _runRecognition();
    bool _waitForCaptureTap();
    void _restoreM5();  // 相机用完后恢复 I2C/Touch

    bool _isTouchOnMicButton(int32_t x, int32_t y);
    bool _isTouchOnRecognizeButton(int32_t x, int32_t y);
    bool _isTouchOnAvatar(int32_t x, int32_t y);
};
