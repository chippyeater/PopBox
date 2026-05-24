#include "ChatUI.h"
#include <M5Unified.h>

static constexpr uint32_t GREETING_DURATION_MS = 5000;

// 过滤 TTS 标记，仅用于屏幕显示
static String stripTtsMarkers(const String& text) {
    String result = text;
    // 括号语气词：(laughs) (sighs) (gasps) (cries) (whispers) 等
    String cleaned;
    cleaned.reserve(result.length());
    bool inParen = false;
    for (int i = 0; i < (int)result.length(); i++) {
        char c = result[i];
        if (c == '(') { inParen = true; continue; }
        if (c == ')') { inParen = false; continue; }
        if (!inParen) cleaned += c;
    }
    // 停顿标记 <#数字#>
    String out;
    out.reserve(cleaned.length());
    bool inTag = false;
    for (int i = 0; i < (int)cleaned.length(); i++) {
        if (cleaned[i] == '<' && i + 1 < (int)cleaned.length() && cleaned[i+1] == '#') {
            inTag = true; continue;
        }
        if (inTag && cleaned[i] == '>') { inTag = false; continue; }
        if (!inTag) out += cleaned[i];
    }
    // 去除多余空格
    out.trim();
    return out;
}
static constexpr uint32_t IDLE_TIMEOUT_MS      = 30000;

ChatUI::ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
               SpeechToText& stt, TextToSpeech& tts, LLMClient& llm,
               DisplayManager& display, CameraManager& camera)
    : _charMgr(charMgr), _recorder(recorder), _stt(stt),
      _tts(tts), _llm(llm), _display(display), _camera(camera),
      _state(AppState::NO_CHARACTER), _isRecording(false),
      _idleStartMs(0), _lastExpression("idle") {}

void ChatUI::begin() {
    _display.begin();
    if (_charMgr.count() > 0) {
        const auto& ch = _charMgr.current();
        _display.drawIdle(ch.name, ch.avatarPath, "idle");
        _display.showBottomBar(false);
        _state = AppState::IDLE;
    } else {
        _display.drawNoCharacter();
        _display.showBottomBar(true);
        _state = AppState::NO_CHARACTER;
    }
}

void ChatUI::update() {
    M5.update();

    if (_isRecording) {
        _recorder.update();
        if (!_recorder.isRecording()) {
            _processAndReply();
            return;
        }
    }

    // GREETING → CHATTING（表情从 happy → idle）
    if (_state == AppState::GREETING
        && millis() - _idleStartMs > GREETING_DURATION_MS) {
        const auto& ch = _charMgr.current();
        _lastExpression = "idle";
        _display.drawSplitLayout(ch.name, ch.avatarPath, _lastReplyText, _lastExpression);
        _display.showBottomBar(false);
        _state = AppState::CHATTING;
        _idleStartMs = millis();
        return;
    }

    // CHATTING → IDLE 超时
    if (_state == AppState::CHATTING
        && millis() - _idleStartMs > IDLE_TIMEOUT_MS) {
        const auto& ch = _charMgr.current();
        _lastExpression = "idle";
        _display.drawIdle(ch.name, ch.avatarPath, _lastExpression);
        _display.showBottomBar(false);
        _state = AppState::IDLE;
        _idleStartMs = millis();
        return;
    }

    _handleTouch();
}

// ── 内部状态 ──────────────────────────────────────────────────────

void ChatUI::_setState(AppState s) {
    _state = s;
    _idleStartMs = millis();
}

// ── 触摸处理 ──────────────────────────────────────────────────────

void ChatUI::_handleTouch() {
    if (M5.Touch.getCount() == 0) return;
    auto t = M5.Touch.getDetail(0);
    if (!t.wasPressed()) return;

    if (_isTouchOnRecognizeButton(t.x, t.y)) {
        _onRecognizeTap();
    } else if (_isTouchOnMicButton(t.x, t.y)) {
        _onMicButtonTap();
    }
}

void ChatUI::_onMicButtonTap() {
    if (_state == AppState::RECOGNIZING
        || _state == AppState::PHYSICAL) return;

    if (_state == AppState::NO_CHARACTER) return;

    if (!_isRecording) {
        _recorder.startRecording();
        _isRecording = true;
        _display.hideBottomBar();
    } else {
        _isRecording = false;
        _recorder.stopRecording();
        _processAndReply();
    }
}

void ChatUI::_onRecognizeTap() {
    if (_state != AppState::NO_CHARACTER) return;
    _runRecognition();
}

// ── 对话流程 ──────────────────────────────────────────────────────

void ChatUI::_processAndReply() {
    _display.hideBottomBar();

    const auto& ch = _charMgr.current();
    _lastExpression = "thinking";
    _display.drawSplitLayout(ch.name, ch.avatarPath, "……", _lastExpression);
    _display.showBottomBar(false);

    String userText = _stt.recognize(_recorder.getBuffer(),
                                     _recorder.getSampleCount());
    _recorder.clearBuffer();

    String reply;
    if (userText.isEmpty()) {
        reply = "哎呀～我没听清楚，再说一遍？";
        _lastExpression = "idle";
    } else {
        LLMResponse resp = _llm.chat(ch, userText);
        reply = resp.reply;
        _lastExpression = resp.expression;
        if (reply.isEmpty()) {
            reply = "[ERROR] 角色回复为空";
            _lastExpression = "idle";
        }
    }

    _lastReplyText = stripTtsMarkers(reply);
    _display.drawSplitLayout(ch.name, ch.avatarPath, _lastReplyText, _lastExpression);
    _display.showBottomBar(false);

    _recorder.pauseMic();
    _tts.speak(reply);
    _recorder.resumeMic();

    _setState(AppState::CHATTING);
}

// ── 识别流程 ──────────────────────────────────────────────────────

void ChatUI::_runRecognition() {
    if (!_camera.isReady()) {
        if (!_camera.begin()) {
            _display.drawNoCharacter();
            _display.showBottomBar(true);
            _state = AppState::NO_CHARACTER;
            return;
        }
    }

    if (!_waitForCaptureTap()) {
        _camera.end();
        _restoreM5();
        _display.drawNoCharacter();
        _display.showBottomBar(true);
        _state = AppState::NO_CHARACTER;
        return;
    }

    CameraFrame frame = _camera.capture();
    if (!frame.valid) {
        frame.release();
        _camera.end();
        _restoreM5();
        _display.drawNoCharacter();
        _display.showBottomBar(true);
        _state = AppState::NO_CHARACTER;
        return;
    }

    size_t imgLen = frame.len;
    uint8_t* imgBuf = (uint8_t*)malloc(imgLen);
    if (imgBuf) memcpy(imgBuf, frame.data, imgLen);
    frame.release();
    _camera.end();
    _restoreM5();

    if (!imgBuf) {
        _display.drawNoCharacter();
        _display.showBottomBar(true);
        _state = AppState::NO_CHARACTER;
        return;
    }

    // 识别中动画
    _display.drawRecognizing(0);
    for (int i = 0; i < 80; i++) {
        _display.drawRecognizing(i);
        delay(30);
    }

    bool ok = _charMgr.loadFromRecognition(imgBuf, imgLen);
    free(imgBuf);

    if (!ok) {
        _display.drawNoCharacter();
        _display.showBottomBar(true);
        _state = AppState::NO_CHARACTER;
        return;
    }

    _showGreeting();
}

void ChatUI::_showGreeting() {
    const auto& ch = _charMgr.current();
    _lastReplyText = "你好呀～\n我是" + ch.name + "！";
    _lastExpression = "happy";
    _display.drawSplitLayout(ch.name, ch.avatarPath, _lastReplyText, _lastExpression);
    _display.showBottomBar(false);
    _recorder.pauseMic();
    _tts.speak(_lastReplyText);
    _recorder.resumeMic();
    _setState(AppState::GREETING);
}

bool ChatUI::_waitForCaptureTap() {
    M5.In_I2C.begin();
    M5.Touch.begin(&M5.Display);

    while (M5.Touch.getCount() > 0) {
        M5.update();
        _camera.previewFrame();
        ::delay(30);
    }

    uint32_t start = millis();
    while (millis() - start < 30000) {
        M5.update();
        _camera.previewFrame();
        if (M5.Touch.getCount() > 0) {
            auto t = M5.Touch.getDetail(0);
            if (t.wasPressed() || t.isPressed()) return true;
        }
        ::delay(30);
    }
    return false;
}

void ChatUI::_restoreM5() {
    bool i2cOk = M5.In_I2C.begin();
    M5.Touch.begin(&M5.Display);
    for (int i = 0; i < 3; ++i) {
        M5.update();
        ::delay(10);
    }
    _display.begin();
    Serial.printf("[ChatUI] M5 restored, touch I2C %s\n",
                  i2cOk ? "ok" : "failed");
}

// ── 触摸区域 ──────────────────────────────────────────────────────

bool ChatUI::_isTouchOnMicButton(int32_t x, int32_t y) {
    if (!(y >= BTN_Y && y <= BTN_Y + BTN_H)) return false;
    if (_state == AppState::NO_CHARACTER) {
        return (x >= 6 && x <= 6 + 148);
    }
    return (x >= 10 && x <= 10 + 300);
}

bool ChatUI::_isTouchOnRecognizeButton(int32_t x, int32_t y) {
    if (_state != AppState::NO_CHARACTER) return false;
    return (x >= 166 && x <= 166 + 148
            && y >= BTN_Y && y <= BTN_Y + BTN_H);
}
