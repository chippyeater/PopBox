#include "ChatUI.h"
#include <WiFi.h>
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
      _idleStartMs(0), _lastExpression("idle"),
      _lastTapTime(0), _tapCount(0) {}

void ChatUI::begin() {
    _display.begin();
    // 始终显示欢迎/入住界面，无论是否有角色
    _display.drawNoCharacter();
    _display.showBottomBar(true);
    _state = AppState::NO_CHARACTER;
}

void ChatUI::update() {
    M5.update();

    // ── 音频泵（驱动录音和 VAD 监听）──
    _recorder.update();

    // ── 声波动画（CHATTING 状态显示用户语音能量）──
    if (_state == AppState::CHATTING) {
        int lvl = _recorder.getAudioLevel();
        if (lvl > 0) _display.drawWaveIcon(lvl);
    }

    // ── 语音结束处理（仅 CHATTING 状态下的对话）──
    if (_recorder.speechJustEnded()) {
        size_t samples = _recorder.getSampleCount();
        Serial.printf("[ChatUI] 语音结束: %zu 采样 (%.1f 秒), 状态=%d WiFi=%d\n",
                      samples, (float)samples / AUDIO_SAMPLE_RATE,
                      (int)_state, (int)WiFi.status());
        _recorder.stopListening();

        if (_state == AppState::CHATTING) {
            _processAndReply();
        }
        return;
    }

    // ── 手动录音完成（按钮模式） ──
    if (_isRecording) {
        if (!_recorder.isRecording()) {
            _isRecording = false;
            _processAndReply();
            return;
        }
        return;
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
        _recorder.stopListening();
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

    // ── 识别按钮（NO_CHARACTER / CHARACTER_SELECT 均可触发）──
    if (_isTouchOnRecognizeButton(t.x, t.y)) {
        _onRecognizeTap();
        return;
    }

    // ── NO_CHARACTER：点击进入角色选择 ──
    if (_state == AppState::NO_CHARACTER) {
        // 在识别按钮已被排除的前提下，任何点击都进入选择
        if (_charMgr.count() > 0) {
            _enterCharacterSelect();
        }
        return;
    }

    // ── CHARACTER_SELECT：点击角色卡片入住 ──
    if (_state == AppState::CHARACTER_SELECT) {
        int charIndex;
        if (_isTouchOnCharacterCard(t.x, t.y, charIndex)) {
            _onCharacterSelect(charIndex);
        }
        return;
    }

    // ── IDLE：换角色 / 双击屏幕唤醒 ──
    if (_state == AppState::IDLE) {
        // 点击左上角"换角色"按钮 → 回到角色选择
        if (t.x >= SWITCH_BTN_X && t.x <= SWITCH_BTN_X + SWITCH_BTN_W
            && t.y >= SWITCH_BTN_Y && t.y <= SWITCH_BTN_Y + SWITCH_BTN_H) {
            _enterCharacterSelect();
            return;
        }
        // 双击唤醒
        uint32_t now = millis();
        if (now - _lastTapTime < 500 && _tapCount == 1) {
            _tapCount = 0;
            _lastTapTime = 0;
            _onDoubleTapWake();
            return;
        }
        _tapCount = 1;
        _lastTapTime = now;
        return;
    }

    // ── CHATTING：单击回到待机 ──
    if (_state == AppState::CHATTING) {
        _onMicButtonTap();
    }
}

void ChatUI::_onMicButtonTap() {
    if (_state == AppState::RECOGNIZING
        || _state == AppState::PHYSICAL) return;
    if (_state == AppState::NO_CHARACTER) return;

    // 单击回到待机
    if (_state == AppState::CHATTING) {
        const auto& ch = _charMgr.current();
        _lastExpression = "idle";
        _display.drawIdle(ch.name, ch.avatarPath, _lastExpression);
        _display.showBottomBar(false);
        _state = AppState::IDLE;
        _idleStartMs = millis();
        _recorder.stopListening();
        return;
    }

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
    if (_state != AppState::NO_CHARACTER
        && _state != AppState::CHARACTER_SELECT) return;
    _runRecognition();
}

// ── 对话流程 ──────────────────────────────────────────────────────

void ChatUI::_processAndReply() {
    _display.hideBottomBar();

    const auto& ch = _charMgr.current();
    _lastExpression = "idle";
    _display.drawSplitLayout(ch.name, ch.avatarPath, "……", _lastExpression);
    _display.showBottomBar(false);

    size_t samples = _recorder.getSampleCount();
    float seconds = (float)samples / AUDIO_SAMPLE_RATE;
    Serial.printf("[ChatUI] 开始 STT: %zu 采样 (%.1f 秒), WiFi=%d\n",
                  samples, seconds, (int)WiFi.status());

    String userText = _stt.recognize(_recorder.getBuffer(), samples);
    _recorder.clearBuffer();

    // 把用户说的话显示在屏幕上
    if (userText.length() > 0) {
        _display.updateRightText(userText);
    }

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
    _tts.speak(reply, ch.voice);
    _recorder.resumeMic();

    _setState(AppState::CHATTING);
    _recorder.startListening();  // 连续对话：继续监听下一句
}

// ── 双击屏幕唤醒 ──────────────────────────────────────────────────

void ChatUI::_onDoubleTapWake() {
    const auto& ch = _charMgr.current();
    _lastReplyText = "你好呀～我是" + ch.name + "！\n今天想聊点什么呢？";
    _lastExpression = "happy";
    _display.drawSplitLayout(ch.name, ch.avatarPath, _lastReplyText, _lastExpression);
    _display.showBottomBar(false);
    _state = AppState::CHATTING;
    _idleStartMs = millis();
    _recorder.startListening();
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
    _tts.speak(_lastReplyText, ch.voice);
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

// ── 角色选择流程 ──────────────────────────────────────────────────

void ChatUI::_enterCharacterSelect() {
    int count = _charMgr.count();
    int n = (count > 3) ? 3 : count;
    String names[3];
    String avatars[3];
    for (int i = 0; i < n; i++) {
        names[i]   = _charMgr.characterAt(i).name;
        avatars[i] = _charMgr.characterAt(i).avatarPath;
    }
    _display.drawCharacterSelect(names, avatars, n);
    _state = AppState::CHARACTER_SELECT;
    _idleStartMs = millis();
}

void ChatUI::_onCharacterSelect(int index) {
    _charMgr.selectCharacter(index);
    const auto& ch = _charMgr.current();
    _lastExpression = "idle";
    _display.drawIdle(ch.name, ch.avatarPath, _lastExpression);
    _display.showBottomBar(false);
    _state = AppState::IDLE;
    _idleStartMs = millis();
    Serial.printf("[ChatUI] 角色入住 → %s\n", ch.name.c_str());
}

bool ChatUI::_isTouchOnCharacterCard(int32_t x, int32_t y, int& outIndex) {
    if (_state != AppState::CHARACTER_SELECT) return false;

    int n = _charMgr.count();
    if (n > 3) n = 3;
    int totalW = n * CARD_W + (n - 1) * CARD_GAP;
    int startX = (SCREEN_W - totalW) / 2;

    for (int i = 0; i < n; i++) {
        int cx = startX + i * (CARD_W + CARD_GAP);
        if (x >= cx && x <= cx + CARD_W && y >= CARD_Y && y <= CARD_Y + CARD_H) {
            outIndex = i;
            return true;
        }
    }
    return false;
}

// ── 触摸区域 ──────────────────────────────────────────────────────

bool ChatUI::_isTouchOnRecognizeButton(int32_t x, int32_t y) {
    if (_state == AppState::NO_CHARACTER) {
        // 欢迎页底部"识别角色"按钮（宽大居中）
        static constexpr int BW = 160, BH = 30, BY = 182;
        int bx = (SCREEN_W - BW) / 2;
        return (x >= bx && x <= bx + BW && y >= BY && y <= BY + BH);
    }
    if (_state == AppState::CHARACTER_SELECT) {
        // 选择页底部"拍照识别"按钮（居中宽大）
        static constexpr int BW = 160, BH = 30, BY = 182;
        int bx = (SCREEN_W - BW) / 2;
        return (x >= bx && x <= bx + BW && y >= BY && y <= BY + BH);
    }
    return false;
}
