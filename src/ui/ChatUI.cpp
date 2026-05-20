#include "ChatUI.h"
#include <M5Unified.h>

ChatUI::ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
               SpeechToText& stt, LLMClient& llm,
               DisplayManager& display, CameraManager& camera)
    : _charMgr(charMgr), _recorder(recorder), _stt(stt),
      _llm(llm), _display(display), _camera(camera),
      _state(AppState::IDLE) {}

void ChatUI::begin() {
    const auto& ch = _charMgr.current();
    _display.drawFull(ch.name, AppState::IDLE, "");
    _display.drawAvatar(ch.avatarPath.c_str());
}

void ChatUI::update() {
    M5.update();
    if (_state == AppState::RECORDING) {
        _recorder.update();
        if (!_recorder.isRecording()) {
            _processAndReply();
            return;
        }
    }
    _handleTouch();
}

// ── 触摸处理 ──────────────────────────────────────────────────

void ChatUI::_handleTouch() {
    if (M5.Touch.getCount() == 0) return;
    auto t = M5.Touch.getDetail(0);
    if (!t.wasPressed()) return;

    if (_isTouchOnMicButton(t.x, t.y)) {
        _onMicButtonTap();
    } else if (_isTouchOnRecognizeButton(t.x, t.y)) {
        _onRecognizeButtonTap();
    }
}

void ChatUI::_onMicButtonTap() {
    if (_state == AppState::PROCESSING || _state == AppState::RECOGNIZING) return;

    if (_state == AppState::IDLE || _state == AppState::DISPLAYING_REPLY) {
        _recorder.startRecording();
        _state = AppState::RECORDING;
        _display.updateStatus(AppState::RECORDING);
    } else if (_state == AppState::RECORDING) {
        _recorder.stopRecording();
        _processAndReply();
    }
}

void ChatUI::_onRecognizeButtonTap() {
    if (_state != AppState::IDLE && _state != AppState::DISPLAYING_REPLY) return;
    _runRecognition();
}

// ── 对话流程 ──────────────────────────────────────────────────

void ChatUI::_processAndReply() {
    _state = AppState::PROCESSING;
    _display.updateStatus(AppState::PROCESSING);
    _display.updateChatText("...");

    String userText = _stt.recognize(_recorder.getBuffer(),
                                     _recorder.getSampleCount());
    _recorder.clearBuffer();

    if (userText.isEmpty()) {
        _lastReply = "哎呀～我没听清楚，再说一遍？";
    } else {
        _lastReply = _llm.chat(_charMgr.current(), userText);
        if (_lastReply.isEmpty()) {
            _lastReply = _charMgr.current().randomCatchphrase() + "我现在有点想不到说什么……";
        }
    }

    _state = AppState::DISPLAYING_REPLY;
    _display.updateStatus(AppState::DISPLAYING_REPLY);
    _display.updateChatText(_lastReply);
}

// ── 识别流程 ──────────────────────────────────────────────────

void ChatUI::_runRecognition() {
    if (!_camera.isReady()) {
        _display.updateChatText("相机未就绪，无法识别");
        return;
    }

    _state = AppState::RECOGNIZING;
    _display.updateStatus(AppState::RECOGNIZING);
    _display.updateChatText("正在拍照...");

    // 拍照
    CameraFrame frame = _camera.capture();
    if (!frame.valid) {
        _display.updateChatText("拍照失败，请重试");
        frame.release();
        _state = AppState::IDLE;
        _display.updateStatus(AppState::IDLE);
        return;
    }

    _display.updateChatText("正在识别角色...");

    // 发送到后端识别
    bool ok = _charMgr.loadFromRecognition(frame.data, frame.len);
    frame.release(); // 立即释放相机帧内存

    if (!ok) {
        _display.updateChatText("未能识别角色，请换一张更清晰的图片");
        _state = AppState::IDLE;
        _display.updateStatus(AppState::IDLE);
        return;
    }

    // 识别成功：更新显示
    const auto& newChar = _charMgr.current();
    _display.updateCharacterName(newChar.name);
    _display.updateChatText(
        newChar.randomCatchphrase() + "我是" + newChar.name + "！很高兴认识你～"
    );

    _state = AppState::DISPLAYING_REPLY;
    _display.updateStatus(AppState::DISPLAYING_REPLY);
}

// ── 触摸区域判断 ──────────────────────────────────────────────

bool ChatUI::_isTouchOnMicButton(int32_t x, int32_t y) {
    // 左侧按钮：x 4~189，y MIC_BTN_Y~MIC_BTN_Y+MIC_BTN_H
    return (x >= 4 && x <= 189 &&
            y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}

bool ChatUI::_isTouchOnRecognizeButton(int32_t x, int32_t y) {
    // 右侧按钮：x 193~316，y MIC_BTN_Y~MIC_BTN_Y+MIC_BTN_H
    return (x >= 193 && x <= 316 &&
            y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}
