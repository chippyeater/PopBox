#include "ChatUI.h"
#include <WiFi.h>
#include <M5Unified.h>
#include <driver/periph_ctrl.h>

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
ChatUI::ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
               SpeechToText& stt, TextToSpeech& tts, LLMClient& llm,
               DisplayManager& display, CameraManager& camera)
    : _charMgr(charMgr), _recorder(recorder), _stt(stt),
      _tts(tts), _llm(llm), _display(display), _camera(camera),
      _state(AppState::CHARACTER_COUNT), _isRecording(false),
      _idleStartMs(0), _lastExpression("idle"),
      _lastTapTime(0), _tapCount(0) {}

void ChatUI::begin() {
    _display.begin();
    // 开机第一屏：选择 1 人或 2 人入住 → 拍照识别
    _display.drawCountSelection(_charMgr.count());
    _state = AppState::CHARACTER_COUNT;
    _idleStartMs = millis();
}

void ChatUI::update() {
    M5.update();

    // ── 音频泵（驱动录音和 VAD 监听）──
    _recorder.update();

    // ── 声波动画（CHATTING 状态始终显示呼吸指示器）──
    if (_state == AppState::CHATTING) {
        int lvl = _recorder.getAudioLevel();
        _display.drawWaveIcon(lvl);  // level=0 时显示呼吸动画
    }

    // ── 语音结束处理（仅 CHATTING 状态下的对话）──
    if (_recorder.speechJustEnded()) {
        // TTS 冷却期内忽略，防止播报回声被误识别为用户说话
        if (millis() < _ttsCooldownUntil) {
            _recorder.clearBuffer();
            _recorder.startListening();
            return;
        }

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

    // CHATTING → IDLE 超时 / 群聊自动延续
    if (_state == AppState::CHATTING
        && millis() - _idleStartMs > _idleTimeoutMs) {
        if (_isGroupChat) {
            // 用户10s没说话，角色自动继续聊
            _autoContinueGroupChat();
            return;
        }
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

    // ── 角色数量选择（点左半＝1人，右半＝2人）──
    if (_state == AppState::CHARACTER_COUNT) {
        _onCountSelect(t.x < SCREEN_W / 2 ? 1 : 2);
        return;
    }

    // ── 识别按钮（NO_CHARACTER / CHARACTER_SELECT 均可触发）──
    if (_isTouchOnRecognizeButton(t.x, t.y)) {
        _onRecognizeTap();
        return;
    }

    // ── NO_CHARACTER（仅作为错误恢复页面）：点击回到角色数量选择 ──
    if (_state == AppState::NO_CHARACTER) {
        _display.drawCountSelection(_charMgr.count());
        _state = AppState::CHARACTER_COUNT;
        _idleStartMs = millis();
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
        // 点击左上角"换角色"按钮 → 回到角色数量选择（1人/2人）
        if (t.x >= SWITCH_BTN_X && t.x <= SWITCH_BTN_X + SWITCH_BTN_W
            && t.y >= SWITCH_BTN_Y && t.y <= SWITCH_BTN_Y + SWITCH_BTN_H) {
            _isGroupChat = false;
            _display.drawCountSelection(_charMgr.count());
            _state = AppState::CHARACTER_COUNT;
            _idleStartMs = millis();
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
        if (_isGroupChat) {
            const auto& a = _charMgr.current();
            const auto& b = _charMgr.secondary();
            _display.drawGroupIdle(a.name, a.avatarPath, b.name, b.avatarPath);
        } else {
            const auto& ch = _charMgr.current();
            _lastExpression = "idle";
            _display.drawIdle(ch.name, ch.avatarPath, _lastExpression);
        }
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
    _display.drawCountSelection(_charMgr.count());
    _state = AppState::CHARACTER_COUNT;
    _idleStartMs = millis();
}

void ChatUI::_onCountSelect(int count) {
    Serial.printf("[ChatUI] 选择 %d 人入住\n", count);
    _pendingCharCount = count;
    if (count == 1) _isGroupChat = false;
    _runRecognition();
}

// ── 对话流程 ──────────────────────────────────────────────────────

void ChatUI::_processAndReply() {
    _display.hideBottomBar();

    if (_isGroupChat) {
        _processGroupReply();
        return;
    }

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
    _ttsCooldownUntil = millis() + TTS_COOLDOWN_MS;

    _idleTimeoutMs = IDLE_TIMEOUT_MS;  // 对话继续，恢复30s超时
    _setState(AppState::CHATTING);
    _recorder.startListening();  // 连续对话：继续监听下一句
}

// ── 群聊对话流程 ──────────────────────────────────────────────────

void ChatUI::_processGroupReply() {
    const auto& charA = _charMgr.current();
    const auto& charB = _charMgr.secondary();
    if (!charB.isValid()) {
        // 没有第二角色，降级到单聊
        _isGroupChat = false;
        _processAndReply();
        return;
    }

    _display.drawGroupLayout(charA.name, charB.name, "……");
    _display.showBottomBar(false);

    size_t samples = _recorder.getSampleCount();
    Serial.printf("[ChatUI] 群聊 STT: %zu 采样 (%.1f 秒)\n",
                  samples, (float)samples / AUDIO_SAMPLE_RATE);

    String userText = _stt.recognize(_recorder.getBuffer(), samples);
    _recorder.clearBuffer();

    if (userText.isEmpty()) {
        String errMsg = "[系统]没听清楚，再说一遍？";
        _lastReplyText = errMsg;
        _display.drawGroupLayout(charA.name, charB.name, errMsg);
        _idleTimeoutMs = IDLE_TIMEOUT_MS;
        _setState(AppState::CHATTING);
        _recorder.startListening();
        return;
    }

    // 显示用户说的话
    _display.appendGroupText("我", userText);

    // 调用群聊 API
    auto replies = _llm.groupChat(charA, charB, userText);

    if (replies.empty()) {
        String fallback = "[系统]网络开小差了…";
        _display.appendGroupText("系统", "网络开小差了…");
        _idleTimeoutMs = IDLE_TIMEOUT_MS;
        _setState(AppState::CHATTING);
        _recorder.startListening();
        return;
    }

    // 先暂停麦克风（所有 TTS 共用一次暂停/恢复，避免中间切换 I2S 状态导致噪音和崩溃）
    _recorder.pauseMic();

    // 逐条回复：依次显示文字 + 播放语音（串行，一条播完再播下一条）
    _lastReplyText = "";
    for (size_t i = 0; i < replies.size(); i++) {
        const auto& reply = replies[i];
        String clean = stripTtsMarkers(reply.reply);
        _lastReplyText += "[" + reply.name + "]" + reply.reply;
        if (i < replies.size() - 1) _lastReplyText += "\n";

        // 先显示本条回复
        _display.appendGroupText(reply.name, clean);

        // 再播语音：speak 内部自行管理 I2S 初始化和 AW88298 功放配置
        String voiceId;
        if (reply.characterId == charA.id) voiceId = charA.voice;
        else if (reply.characterId == charB.id) voiceId = charB.voice;
        if (voiceId.length() > 0) {
            _tts.speak(reply.reply, voiceId);
        }
    }

    // 所有 TTS 播完后恢复麦克风
    _recorder.resumeMic();
    _ttsCooldownUntil = millis() + TTS_COOLDOWN_MS;  // 冷却期内忽略回声

    // 群聊模式：用户10s没说话则角色自动延续对话
    _idleTimeoutMs = 10000;
    _setState(AppState::CHATTING);
    _recorder.startListening();
}

// ── 群聊自动延续（心跳模式） ─────────────────────────────────

void ChatUI::_autoContinueGroupChat() {
    const auto& charA = _charMgr.current();
    const auto& charB = _charMgr.secondary();
    if (!charB.isValid()) {
        _display.drawGroupIdle(charA.name, charA.avatarPath, "", "");
        _display.showBottomBar(false);
        _state = AppState::IDLE;
        _idleStartMs = millis();
        _recorder.stopListening();
        return;
    }

    // 心跳：角色之间继续聊，不需要用户输入
    _display.showBottomBar(false);
    auto replies = _llm.groupChat(charA, charB, "__heartbeat__");

    if (replies.empty()) {
        _display.drawGroupIdle(charA.name, charA.avatarPath, charB.name, charB.avatarPath);
        _display.showBottomBar(false);
        _state = AppState::IDLE;
        _idleStartMs = millis();
        _recorder.stopListening();
        return;
    }

    _recorder.pauseMic();

    for (size_t i = 0; i < replies.size(); i++) {
        const auto& reply = replies[i];
        String clean = stripTtsMarkers(reply.reply);
        _lastReplyText += "\n[" + reply.name + "]" + reply.reply;

        _display.appendGroupText(reply.name, clean);

        String voiceId;
        if (reply.characterId == charA.id) voiceId = charA.voice;
        else if (reply.characterId == charB.id) voiceId = charB.voice;
        if (voiceId.length() > 0) {
            _tts.speak(reply.reply, voiceId);
        }
    }

    _recorder.resumeMic();
    _ttsCooldownUntil = millis() + TTS_COOLDOWN_MS;  // 冷却期内忽略回声

    // 继续等待10s，可再次自动延续或由用户接话
    _idleTimeoutMs = 10000;
    _setState(AppState::CHATTING);
    _recorder.startListening();
}

// ── 群聊问候 ──────────────────────────────────────────────────────

void ChatUI::_showGroupGreeting() {
    const auto& a = _charMgr.current();
    const auto& b = _charMgr.secondary();
    _lastExpression = "happy";

    // 角色 A 先打招呼
    String greetA = a.name + " 来啦！\n你好呀～我是" + a.name + "！";
    _display.drawGroupLayout(a.name, b.name, greetA);
    _display.showBottomBar(false);

    // 角色 B 再打招呼
    String greetB = greetA + "\n" + b.name + " 也到了！\n嗨～我是" + b.name + "！";
    _display.appendGroupText(b.name, "嗨～我是" + b.name + "！");
    _lastReplyText = greetB;

    // TODO: TTS 在此处崩溃（spk_task stack），摄像头操作后 I2S 状态异常，
    //       先跳过 TTS 验证群聊流程，后续修复音频后再恢复
    // _recorder.pauseMic();
    // _tts.speak("你好呀～我是" + a.name + "！", a.voice);
    // _recorder.resumeMic();
    // _recorder.pauseMic();
    // _tts.speak("嗨～我是" + b.name + "，我们一起聊天吧！", b.voice);
    // _recorder.resumeMic();

    // 问候完后进入待机，等待双击唤醒
    _display.drawGroupIdle(a.name, a.avatarPath, b.name, b.avatarPath);
    _display.showBottomBar(false);
    _state = AppState::IDLE;
    _idleStartMs = millis();
}

void ChatUI::_showGroupIdle() {
    const auto& a = _charMgr.current();
    const auto& b = _charMgr.secondary();
    _lastExpression = "idle";
    _display.drawGroupIdle(a.name, a.avatarPath, b.name, b.avatarPath);
    _display.showBottomBar(false);
    _state = AppState::IDLE;
    _idleStartMs = millis();
}

// ── 双击屏幕唤醒 ──────────────────────────────────────────────────

void ChatUI::_onDoubleTapWake() {
    if (_isGroupChat) {
        const auto& a = _charMgr.current();
        const auto& b = _charMgr.secondary();
        _lastReplyText = "开始聊天吧！请说话～";
        _display.drawGroupLayout(a.name, b.name, _lastReplyText);
        _display.showBottomBar(false);
        _idleTimeoutMs = IDLE_TIMEOUT_MS;
        _state = AppState::CHATTING;
        _idleStartMs = millis();
        // resumeMic 跳过：群聊模式下从未 pauseMic，麦克风硬件仍处于初始化状态
        // 若调用 resumeMic → M5.Speaker.end() 会做 AW88298 I2C 写入，摄像头后将闪退
        _recorder.startListening();
        return;
    }
    const auto& ch = _charMgr.current();
    _lastReplyText = "你好呀～我是" + ch.name + "！\n今天想聊点什么呢？";
    _lastExpression = "happy";
    _display.drawSplitLayout(ch.name, ch.avatarPath, _lastReplyText, _lastExpression);
    _display.showBottomBar(false);
    _idleTimeoutMs = 5000;
    _state = AppState::CHATTING;
    _idleStartMs = millis();
    // resumeMic 跳过：_showGreeting / _processAndReply 已让麦克风处于运行状态，
    // 重复 resumeMic → M5.Mic.begin() 在 I2S 已安装时失败，导致麦克风无声
    _recorder.startListening();
}

// ── 识别流程 ──────────────────────────────────────────────────────

static void _showRetryCountSelection(DisplayManager& display, CharacterManager& charMgr,
                                      AppState& state, uint32_t& idleStartMs) {
    display.drawCountSelection(charMgr.count());
    display.showBottomBar(true);
    state = AppState::CHARACTER_COUNT;
    idleStartMs = millis();
}

void ChatUI::_runRecognition() {
    // 摄像头会占用 I2S 外设，先停麦克风避免冲突
    _recorder.pauseMic();

    if (!_camera.isReady()) {
        if (!_camera.begin()) {
            _recorder.resumeMic();
            _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
            return;
        }
    }

    // ── 第一次拍照 ──
    if (!_waitForCaptureTap()) {
        _camera.end();
        _restoreM5();
        _recorder.resumeMic();
        _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
        return;
    }

    CameraFrame frame = _camera.capture();
    if (!frame.valid) {
        frame.release();
        _camera.end();
        _restoreM5();
        _recorder.resumeMic();
        _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
        return;
    }

    size_t lenA = frame.len;
    uint8_t* bufA = (uint8_t*)malloc(lenA);
    if (bufA) memcpy(bufA, frame.data, lenA);
    frame.release();

    if (!bufA) {
        _camera.end();
        _restoreM5();
        _recorder.resumeMic();
        _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
        return;
    }

    // ── 双人模式：同一 session 里拍第二张（不做显示操作，避免 SPI 冲突）──
    if (_pendingCharCount == 2) {
        M5.Speaker.tone(2000, 100);
        delay(500);

        if (!_waitForCaptureTap()) {
            _camera.end();
            _restoreM5();
            _recorder.resumeMic();
            free(bufA);
            _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
            return;
        }

        CameraFrame frameB = _camera.capture();
        if (!frameB.valid) {
            frameB.release();
            _camera.end();
            _restoreM5();
            _recorder.resumeMic();
            free(bufA);
            _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
            return;
        }

        size_t lenB = frameB.len;
        uint8_t* bufB = (uint8_t*)malloc(lenB);
        if (bufB) memcpy(bufB, frameB.data, lenB);
        frameB.release();

        _camera.end();
        _restoreM5();
        _recorder.resumeMic();

        if (!bufB) {
            free(bufA);
            _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
            return;
        }

        // 识别动画
        _display.drawRecognizing(0);
        for (int i = 0; i < 80; i++) {
            _display.drawRecognizing(i);
            delay(30);
        }

        // 识别第一位
        bool okA = _charMgr.loadFromRecognition(bufA, lenA);
        free(bufA);
        if (!okA) {
            free(bufB);
            _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
            return;
        }
        int idxA = _charMgr.currentIndex();

        // 识别第二位
        bool okB = _charMgr.loadFromRecognition(bufB, lenB);
        free(bufB);
        if (!okB) {
            _pendingCharCount = 0;
            _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
            return;
        }
        int idxB = _charMgr.currentIndex();

        _pendingCharCount = 0;
        _charMgr.setDualMode(idxA, idxB);
        _isGroupChat = true;
        _showGroupIdle();
        return;
    }

    // ── 单人模式 ──
    _camera.end();
    _restoreM5();
    _recorder.resumeMic();

    _display.drawRecognizing(0);
    for (int i = 0; i < 80; i++) {
        _display.drawRecognizing(i);
        delay(30);
    }

    bool ok = _charMgr.loadFromRecognition(bufA, lenA);
    free(bufA);

    if (!ok) {
        _showRetryCountSelection(_display, _charMgr, _state, _idleStartMs);
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
    // 问候完后进入待机，等待双击唤醒
    _lastExpression = "idle";
    _display.drawIdle(ch.name, ch.avatarPath, _lastExpression);
    _display.showBottomBar(false);
    _state = AppState::IDLE;
    _idleStartMs = millis();
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
    // 重新启用 LCD_CAM 外设（esp_camera_deinit 可能将其关闭）
    periph_module_enable(PERIPH_LCD_CAM_MODULE);
    // LCD_CAM 与 I2S 可能共享电源域，重开 LCD_CAM 可能复位 I2S，
    // 显式重开 I2S 外设时钟保证扬声器/麦克风可用
    periph_module_enable(PERIPH_I2S1_MODULE);
    ::delay(5);

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
    _isGroupChat = false;
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
