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
    uint32_t _idleStartMs;
    String   _lastReplyText;
    String   _lastExpression;

    void _setState(AppState s);
    void _handleTouch();
    void _onMicButtonTap();
    void _onRecognizeTap();
    void _processAndReply();
    void _processWakeWord();
    bool _isWakeWord(const String& text);
    void _runRecognition();
    bool _waitForCaptureTap();
    void _restoreM5();
    void _showGreeting();

    bool _isTouchOnMicButton(int32_t x, int32_t y);
    bool _isTouchOnRecognizeButton(int32_t x, int32_t y);
};
