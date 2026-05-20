#include "ChatUI.h"
#include <M5Unified.h>

static constexpr uint32_t LONG_PRESS_MS = 600;

ChatUI::ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
               SpeechToText& stt, LLMClient& llm,
               DisplayManager& display, CameraManager& camera)
    : _charMgr(charMgr), _recorder(recorder), _stt(stt),
      _llm(llm), _display(display), _camera(camera),
      _state(AppState::IDLE), _camPressStart(0), _camPressing(false) {}

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
    if (M5.Touch.getCount() == 0) {
        if (_camPressing) {
            uint32_t dur = millis() - _camPressStart;
            _camPressing = false;
            if (dur >= LONG_PRESS_MS) {
                _onRecognizeButtonLongPress();
            } else {
                _onRecognizeButtonShortTap();
            }
        }
        return;
    }
    auto t = M5.Touch.getDetail(0);
    if (t.wasPressed()) {
        if (_isTouchOnMicButton(t.x, t.y)) {
            _onMicButtonTap();
        } else if (_isTouchOnRecognizeButton(t.x, t.y)) {
            _camPressStart = millis();
            _camPressing   = true;
        }
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

void ChatUI::_onRecognizeButtonShortTap() {
    if (_state == AppState::PROCESSING || _state == AppState::RECOGNIZING) return;
    if (_charMgr.count() <= 1) {
        _display.updateChatText("收藏夹只有一个角色，长按可拍照添加");
        return;
    }
    _charMgr.switchToNext();
    const auto& ch = _charMgr.current();
    _display.drawFull(ch.name, AppState::DISPLAYING_REPLY,
                      ch.randomCatchphrase() + "我来啦！",
                      _charMgr.currentIndex() + 1, _charMgr.count());
    _display.drawSprite(ch.spriteColors, AppState::DISPLAYING_REPLY);
    _state = AppState::DISPLAYING_REPLY;
}

void ChatUI::_onRecognizeButtonLongPress() {
    if (_state != AppState::IDLE && _state != AppState::DISPLAYING_REPLY) return;
    _runRecognition();
}

// ── 对话流程 ──────────────────────────────────────────────────

void ChatUI::_processAndReply() {
    _setState(AppState::PROCESSING);
    _display.updateChatText("...");

    String userText = _stt.recognize(_recorder.getBuffer(),
                                     _recorder.getSampleCount());
    _recorder.clearBuffer();

    String reply;
    if (userText.isEmpty()) {
        reply = "哎呀～我没听清楚，再说一遍？";
    } else {
        reply = _llm.chat(_charMgr.current(), userText);
        if (reply.isEmpty())
            reply = _charMgr.current().randomCatchphrase() + "我现在有点想不到说什么……";
    }

    _setState(AppState::DISPLAYING_REPLY);
    _display.updateChatText(reply);
}

// ── 识别流程 ──────────────────────────────────────────────────

void ChatUI::_runRecognition() {
    if (!_camera.isReady()) {
        _display.updateChatText("相机未就绪，无法识别");
        return;
    }
    _setState(AppState::RECOGNIZING);
    _display.updateChatText("正在拍照...");

    CameraFrame frame = _camera.capture();
    if (!frame.valid) {
        frame.release();
        _display.updateChatText("拍照失败，请重试");
        _setState(AppState::IDLE);
        return;
    }
    _display.updateChatText("正在识别角色...");

    bool ok = _charMgr.loadFromRecognition(frame.data, frame.len);
    frame.release();

    if (!ok) {
        _display.updateChatText("未能识别角色，请换清晰图片");
        _setState(AppState::IDLE);
        return;
    }

    const auto& newChar = _charMgr.current();
    _display.drawFull(newChar.name, AppState::DISPLAYING_REPLY,
                      newChar.randomCatchphrase() + "我是" + newChar.name + "！",
                      _charMgr.currentIndex() + 1, _charMgr.count());
    _display.drawSprite(newChar.spriteColors, AppState::DISPLAYING_REPLY);
    _state = AppState::DISPLAYING_REPLY;
}

// ── 触摸区域 ──────────────────────────────────────────────────

bool ChatUI::_isTouchOnMicButton(int32_t x, int32_t y) {
    return (x >= 4 && x <= 189 && y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}

bool ChatUI::_isTouchOnRecognizeButton(int32_t x, int32_t y) {
    return (x >= 193 && x <= 316 && y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}
