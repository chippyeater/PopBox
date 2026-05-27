#pragma once
#include <Arduino.h>
#include "DisplayManager.h"
#include "../character/CharacterManager.h"
#include "../audio/AudioRecorder.h"
#include "../audio/SpeechToText.h"
#include "../audio/TextToSpeech.h"
#include "../ai/LLMClient.h"
#include "../camera/CameraManager.h"

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
    bool     _isRecording;
    int      _pendingCharCount = 0;   // 0=未选, 1或2=已选
    bool     _capturingSecond  = false; // 双人模式正在拍第二个
    uint32_t _idleStartMs;
    String   _lastReplyText;
    String   _lastExpression;

    // ── 群聊状态 ──────────────────────────────────────────────
    bool     _isGroupChat     = false;
    int      _groupReplyIndex = 0;     // 当前播放到第几条回复

    void _setState(AppState s);
    void _handleTouch();
    void _onMicButtonTap();
    void _onRecognizeTap();
    void _enterCharacterSelect();
    void _onCharacterSelect(int index);
    void _processAndReply();
    void _processGroupReply();
    void _runRecognition();
    void _onCountSelect(int count);
    void _runSecondRecognition();
    bool _waitForCaptureTap();
    void _restoreM5();
    void _showGreeting();
    void _showGroupGreeting();
    void _onDoubleTapWake();

    bool _isTouchOnRecognizeButton(int32_t x, int32_t y);
    bool _isTouchOnCharacterCard(int32_t x, int32_t y, int& outIndex);

    uint32_t _lastTapTime;
    uint8_t  _tapCount;
};
