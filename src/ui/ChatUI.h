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
    void triggerDebateBoom(DisplayManager::StageSide side);

private:
    enum class FlowMode { None, Daily, Debate };

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
    uint32_t _idleStartMs;
    String   _lastReplyText;
    String   _lastExpression;

    // ── 群聊状态 ──────────────────────────────────────────────
    bool     _isGroupChat     = false;
    static constexpr uint32_t IDLE_TIMEOUT_MS = 30000;
    uint32_t _idleTimeoutMs   = IDLE_TIMEOUT_MS;  // 当前闲置超时（首次5s，之后30s）

    void _setState(AppState s);
    void _handleTouch();
    void _enterModeSelect();
    void _enterInvite(FlowMode mode);
    void _onModeSelect(int32_t x);
    bool _recognizeStageSide(DisplayManager::StageSide side);
    void _afterStageRecognition();
    void _startDailyStage();
    void _processDailyStageSpeech();
    void _processDebateTopic();
    void _startDebate();
    void _requestDebateTurn();
    void _finishDebateIfNeeded();
    void _onMicButtonTap();
    void _onRecognizeTap();
    void _enterCharacterSelect();
    void _onCharacterSelect(int index);
    void _processAndReply();
    void _processGroupReply();
    void _autoContinueGroupChat();
    void _runRecognition();
    void _onCountSelect(int count);
    bool _waitForCaptureTap();
    void _restoreM5();
    void _showGreeting();
    void _showGroupGreeting();
    void _showGroupIdle();
    void _onDoubleTapWake();

    bool _isTouchOnRecognizeButton(int32_t x, int32_t y);
    bool _isTouchOnCharacterCard(int32_t x, int32_t y, int& outIndex);

    uint32_t _lastTapTime;
    uint8_t  _tapCount;
    uint32_t _ttsCooldownUntil = 0;
    static constexpr uint32_t TTS_COOLDOWN_MS = 2000;  // TTS 后忽略麦克风输入，防止回声反馈

    FlowMode _flowMode = FlowMode::None;
    int      _redIndex = -1;
    int      _blueIndex = -1;
    String   _redName;
    String   _blueName;
    String   _dailyRedExpression = "silent";
    String   _dailyBlueExpression = "silent";
    DisplayManager::StageSide _dailySpeaker = DisplayManager::StageSide::None;

    String   _debateTopic;
    String   _debateSessionId;
    DisplayManager::StageSide _debateSpeaker = DisplayManager::StageSide::Red;
    String   _debateRedExpression = "silent";
    String   _debateBlueExpression = "speechless";
    int      _debateScore = DEBATE_INITIAL_SCORE; // 0=蓝方胜, 100=红方胜
    int      _redWinCount = 0;
    int      _blueWinCount = 0;
    uint32_t _debateTurnStartedMs = 0;
    uint32_t _debateBoomShownAtMs = 0;
    int      _lastDebateSecond = -1;
};
