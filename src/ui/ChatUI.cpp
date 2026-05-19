#include "ChatUI.h"
#include <M5Unified.h>

ChatUI::ChatUI(CharacterManager& charMgr, AudioRecorder& recorder,
               SpeechToText& stt, LLMClient& llm, DisplayManager& display)
    : _charMgr(charMgr), _recorder(recorder), _stt(stt),
      _llm(llm), _display(display), _state(AppState::IDLE) {}

void ChatUI::begin() {
    const auto& ch = _charMgr.current();
    _display.drawFull(ch.name, AppState::IDLE, "");
    _display.drawAvatar(ch.avatarPath.c_str());
}

void ChatUI::update() {
    M5.update();

    // 录音中持续采集
    if (_state == AppState::RECORDING) {
        _recorder.update();

        // 缓冲区满时自动停止录音
        if (!_recorder.isRecording()) {
            _processAndReply();
            return;
        }
    }

    _handleTouch();
}

// ── 私有方法 ──────────────────────────────────────────────────

void ChatUI::_handleTouch() {
    if (M5.Touch.getCount() == 0) return;

    auto t = M5.Touch.getDetail(0);
    if (!t.wasPressed()) return;

    if (_isTouchOnMicButton(t.x, t.y)) {
        _onMicButtonTap();
    }
}

void ChatUI::_onMicButtonTap() {
    switch (_state) {
        case AppState::IDLE:
        case AppState::DISPLAYING_REPLY:
            // 开始录音
            _recorder.startRecording();
            _state = AppState::RECORDING;
            _display.updateStatus(AppState::RECORDING);
            break;

        case AppState::RECORDING:
            // 手动停止录音并处理
            _recorder.stopRecording();
            _processAndReply();
            break;

        default:
            // PROCESSING 中忽略触摸
            break;
    }
}

void ChatUI::_processAndReply() {
    _state = AppState::PROCESSING;
    _display.updateStatus(AppState::PROCESSING);
    _display.updateChatText("...");

    const auto& ch = _charMgr.current();

    // Step 1: 语音 → 文字
    String userText = _stt.recognize(
        _recorder.getBuffer(),
        _recorder.getSampleCount()
    );
    _recorder.clearBuffer();

    if (userText.isEmpty()) {
        _lastReply = "哎呀～我没听清楚，再说一遍？";
        Serial.println("[UI] STT 未识别到内容，使用默认回复");
    } else {
        // Step 2: 文字 → 角色回复
        _lastReply = _llm.chat(ch, userText);
        if (_lastReply.isEmpty()) {
            _lastReply = ch.randomCatchphrase() + "我现在有点想不到说什么……";
        }
    }

    // 展示回复
    _state = AppState::DISPLAYING_REPLY;
    _display.updateStatus(AppState::DISPLAYING_REPLY);
    _display.updateChatText(_lastReply);

    // [EXTENSION POINT] FEATURE_CHARACTER_MEMORY=1 时在此保存对话记录
}

bool ChatUI::_isTouchOnMicButton(int32_t x, int32_t y) {
    return (x >= SCREEN_W / 2 - 70 && x <= SCREEN_W / 2 + 70 &&
            y >= MIC_BTN_Y && y <= MIC_BTN_Y + MIC_BTN_H);
}
