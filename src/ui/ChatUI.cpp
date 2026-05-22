#include "ChatUI.h"
#include <M5Unified.h>

static constexpr uint32_t LONG_PRESS_MS = 600;

ChatUI::ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
               SpeechToText& stt, TextToSpeech& tts, LLMClient& llm,
               DisplayManager& display, CameraManager& camera)
    : _charMgr(charMgr), _recorder(recorder), _stt(stt),
      _tts(tts), _llm(llm), _display(display), _camera(camera),
      _state(AppState::IDLE) {}

void ChatUI::begin() {
    const auto& ch = _charMgr.current();
    _display.drawFull(ch.name, AppState::IDLE, "",
                      _charMgr.currentIndex() + 1, _charMgr.count());
    _display.drawSprite(ch.spriteColors, AppState::IDLE);
}

void ChatUI::update() {
    M5.update();
    if (_state == AppState::RECORDING) {
        _recorder.update();
        if (!_recorder.isRecording()) { _processAndReply(); return; }
    }
    _handleTouch();
}

// 状态变更：同时更新状态栏 + 精灵表情
void ChatUI::_setState(AppState s) {
    _state = s;
    _display.updateStatus(s, _charMgr.currentIndex() + 1, _charMgr.count());
    _display.updateSpriteExpression(_charMgr.current().spriteColors, s);
}

// ── 触摸处理 ──────────────────────────────────────────────────

void ChatUI::_handleTouch() {
    if (M5.Touch.getCount() == 0) return;
    auto t = M5.Touch.getDetail(0);
    if (!t.wasPressed()) return;

    if (_isTouchOnMicButton(t.x, t.y)) {
        _onMicButtonTap();
    } else if (_isTouchOnRecognizeButton(t.x, t.y)) {
        // 识别角色按钮：直接触发拍照识别
        if (_state == AppState::IDLE || _state == AppState::DISPLAYING_REPLY) {
            _runRecognition();
        }
    } else if (_isTouchOnAvatar(t.x, t.y)) {
        // 头像区：切换到下一个收藏角色
        _onAvatarTap();
    }
}

void ChatUI::_onMicButtonTap() {
    if (_state == AppState::PROCESSING || _state == AppState::RECOGNIZING) return;
    if (_state == AppState::IDLE || _state == AppState::DISPLAYING_REPLY) {
        _recorder.startRecording();
        _setState(AppState::RECORDING);
    } else if (_state == AppState::RECORDING) {
        _recorder.stopRecording();
        _processAndReply();
    }
}

void ChatUI::_onAvatarTap() {
    if (_state == AppState::PROCESSING || _state == AppState::RECOGNIZING) return;
    if (_charMgr.count() <= 1) {
        _display.updateChatText("收藏夹只有一个角色\n点击识别角色按钮添加新角色");
        return;
    }
    _charMgr.switchToNext();
    const auto& ch = _charMgr.current();
    _display.clearMessages();
    _display.drawFull(ch.name, AppState::DISPLAYING_REPLY, "",
                      _charMgr.currentIndex() + 1, _charMgr.count());
    _display.drawSprite(ch.spriteColors, AppState::DISPLAYING_REPLY);
    _display.addMessage(ch.randomCatchphrase() + "我来啦！", false);
    _state = AppState::DISPLAYING_REPLY;
}

// ── 对话流程 ──────────────────────────────────────────────────

void ChatUI::_processAndReply() {
    _setState(AppState::PROCESSING);
    _display.showThinking();

    String userText = _stt.recognize(_recorder.getBuffer(),
                                     _recorder.getSampleCount());
    _recorder.clearBuffer();

    String reply;
    if (userText.isEmpty()) {
        reply = "哎呀～我没听清楚，再说一遍？";
    } else {
        _display.addMessage(userText, true);  // 先显示用户说的话
        _display.showThinking();
        reply = _llm.chat(_charMgr.current(), userText);
        if (reply.isEmpty())
            reply = "[ERROR] 角色回复为空";
    }

    _setState(AppState::DISPLAYING_REPLY);
    _display.addMessage(reply, false);
    _recorder.pauseMic();
    _tts.speak(reply);
    _recorder.resumeMic();
}

// ── 识别流程 ──────────────────────────────────────────────────

void ChatUI::_runRecognition() {
    // 懒初始化：首次识别时才启动相机（避免 I2C 总线影响触摸控制器）
    if (!_camera.isReady()) {
        _display.updateChatText("正在启动相机...");
        if (!_camera.begin()) {
            _display.updateChatText("相机启动失败，无法识别");
            _setState(AppState::IDLE);
            return;
        }
    }
    _setState(AppState::RECOGNIZING);
    if (!_waitForCaptureTap()) {
        _camera.end();
        _restoreM5();
        _display.updateChatText("拍照已取消");
        _setState(AppState::IDLE);
        return;
    }
    _display.updateChatText("正在拍照...");

    CameraFrame frame = _camera.capture();
    if (!frame.valid) {
        frame.release();
        _camera.end();
        _restoreM5();
        _display.updateChatText("拍照失败，请重试");
        _setState(AppState::IDLE);
        return;
    }
    _display.updateChatText("正在识别角色...");

    // 拷贝图像数据后立即释放相机，还 I2C 给 M5（触摸需要）
    size_t imgLen = frame.len;
    uint8_t* imgBuf = (uint8_t*)malloc(imgLen);
    if (imgBuf) memcpy(imgBuf, frame.data, imgLen);
    frame.release();
    _camera.end();
    _restoreM5();

    if (!imgBuf) {
        _display.updateChatText("内存不足，请重试");
        _setState(AppState::IDLE);
        return;
    }

    bool ok = _charMgr.loadFromRecognition(imgBuf, imgLen);
    free(imgBuf);

    if (!ok) {
        _display.updateChatText("未能识别角色，请换清晰图片");
        _setState(AppState::IDLE);
        return;
    }

    const auto& newChar = _charMgr.current();
    _display.clearMessages();
    _display.drawFull(newChar.name, AppState::DISPLAYING_REPLY, "",
                      _charMgr.currentIndex() + 1, _charMgr.count());
    _display.drawSprite(newChar.spriteColors, AppState::DISPLAYING_REPLY);
    _display.addMessage(newChar.randomCatchphrase() + "我是" + newChar.name + "！", false);
    _state = AppState::DISPLAYING_REPLY;
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
    // 相机用完后，重新初始化 M5（恢复触摸/PMIC 的 I2C）
    bool i2cOk = M5.In_I2C.begin();
    M5.Touch.begin(&M5.Display);
    for (int i = 0; i < 3; ++i) {
        M5.update();
        ::delay(10);
    }
    _display.begin();
    Serial.printf("[ChatUI] M5 restored, touch I2C %s\n", i2cOk ? "ok" : "failed");
}

// ── 触摸区域 ──────────────────────────────────────────────────

bool ChatUI::_isTouchOnMicButton(int32_t x, int32_t y) {
    return (x >= 4 && x <= 189 && y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}

bool ChatUI::_isTouchOnRecognizeButton(int32_t x, int32_t y) {
    return (x >= 193 && x <= 316 && y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}

bool ChatUI::_isTouchOnAvatar(int32_t x, int32_t y) {
    return (x >= AVATAR_X && x <= AVATAR_X + AVATAR_SIZE &&
            y >= AVATAR_Y && y <= AVATAR_Y + AVATAR_SIZE);
}
