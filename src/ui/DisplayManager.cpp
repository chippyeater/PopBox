#include "DisplayManager.h"
#include <SPIFFS.h>

// 颜色常量
static const uint32_t COLOR_BG        = 0x1A1A2E;  // 深蓝背景
static const uint32_t COLOR_HEADER_BG = 0x16213E;
static const uint32_t COLOR_CHAT_BG   = 0x0F3460;
static const uint32_t COLOR_BTN_IDLE  = 0x533483;
static const uint32_t COLOR_BTN_REC   = 0xE94560;
static const uint32_t COLOR_TEXT      = 0xF5F5F5;
static const uint32_t COLOR_NAME      = 0xFFD700;
static const uint32_t COLOR_STATUS_OK = 0x00C9A7;

void DisplayManager::begin() {
    M5.Display.setColorDepth(16);
    M5.Display.fillScreen(COLOR_BG);
    M5.Display.setTextWrap(true);
}

void DisplayManager::drawFull(const String& characterName, AppState state,
                               const String& replyText) {
    M5.Display.fillScreen(COLOR_BG);
    _drawHeader(characterName, state);
    _drawChatArea(replyText);
    _drawMicButton(state);
}

void DisplayManager::updateChatText(const String& text) {
    _drawChatArea(text);
}

void DisplayManager::updateStatus(AppState state) {
    // 仅重绘状态文字区域，避免全屏刷新
    int32_t statusX = AVATAR_X + AVATAR_SIZE + 8;
    int32_t statusY = AVATAR_Y + 28;
    M5.Display.fillRect(statusX, statusY, SCREEN_W - statusX - 4, 20,
                        COLOR_HEADER_BG);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(_stateLabelColor(state));
    M5.Display.setCursor(statusX, statusY + 2);
    M5.Display.print(_stateLabel(state));

    // 重绘麦克风按钮（颜色跟随状态）
    _drawMicButton(state);
}

bool DisplayManager::drawAvatar(const char* path) {
    if (!SPIFFS.exists(path)) {
        // 头像不存在时绘制占位圆形
        M5.Display.fillCircle(AVATAR_X + AVATAR_SIZE / 2,
                              AVATAR_Y + AVATAR_SIZE / 2,
                              AVATAR_SIZE / 2, 0x44475A);
        M5.Display.setTextSize(2);
        M5.Display.setTextColor(COLOR_TEXT);
        M5.Display.setCursor(AVATAR_X + AVATAR_SIZE / 2 - 8,
                             AVATAR_Y + AVATAR_SIZE / 2 - 8);
        M5.Display.print("?");
        return false;
    }

    M5.Display.drawJpgFile(SPIFFS, path,
                           AVATAR_X, AVATAR_Y,
                           AVATAR_SIZE, AVATAR_SIZE);
    return true;
}

// ── 私有方法 ──────────────────────────────────────────────────

void DisplayManager::_drawHeader(const String& name, AppState state) {
    M5.Display.fillRect(0, 0, SCREEN_W, 108, COLOR_HEADER_BG);

    // 名字
    int32_t textX = AVATAR_X + AVATAR_SIZE + 8;
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(COLOR_NAME);
    M5.Display.setCursor(textX, AVATAR_Y + 6);
    M5.Display.print(name);

    // 状态
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(_stateLabelColor(state));
    M5.Display.setCursor(textX, AVATAR_Y + 30);
    M5.Display.print(_stateLabel(state));

    // 分隔线
    M5.Display.drawFastHLine(0, 108, SCREEN_W, 0x334466);
}

void DisplayManager::_drawChatArea(const String& text) {
    M5.Display.fillRect(CHAT_TEXT_X - 2, CHAT_TEXT_Y - 4,
                        CHAT_TEXT_W + 4, CHAT_TEXT_H + 4, COLOR_CHAT_BG);

    if (text.isEmpty()) return;

    M5.Display.setTextSize(1);
    M5.Display.setTextColor(COLOR_TEXT);
    M5.Display.setTextWrap(true);
    M5.Display.setCursor(CHAT_TEXT_X + 4, CHAT_TEXT_Y + 4);

    // 手动换行以适配中文（M5GFX 对中文自动换行支持有限）
    // [EXTENSION POINT] 后续可替换为富文本渲染器
    M5.Display.drawString(text, CHAT_TEXT_X + 4, CHAT_TEXT_Y + 4,
                          CHAT_TEXT_W - 8);
}

void DisplayManager::_drawMicButton(AppState state) {
    bool recording = (state == AppState::RECORDING);
    uint32_t btnColor = recording ? COLOR_BTN_REC : COLOR_BTN_IDLE;

    M5.Display.fillRoundRect(SCREEN_W / 2 - 70, MIC_BTN_Y,
                             140, MIC_BTN_H, 8, btnColor);
    M5.Display.setTextSize(1);
    M5.Display.setTextColor(COLOR_TEXT);

    const char* label = recording ? "■ 停止" : "● 点击说话";
    int16_t lw = strlen(label) * 6;
    M5.Display.setCursor(SCREEN_W / 2 - lw / 2,
                         MIC_BTN_Y + MIC_BTN_H / 2 - 4);
    M5.Display.print(label);
}

const char* DisplayManager::_stateLabel(AppState s) {
    switch (s) {
        case AppState::IDLE:             return "● 待机";
        case AppState::RECORDING:        return "● 录音中...";
        case AppState::PROCESSING:       return "● 思考中...";
        case AppState::DISPLAYING_REPLY: return "● 回复";
        default:                         return "";
    }
}

uint32_t DisplayManager::_stateLabelColor(AppState s) {
    switch (s) {
        case AppState::RECORDING:  return COLOR_BTN_REC;
        case AppState::PROCESSING: return 0xFFA500;
        default:                   return COLOR_STATUS_OK;
    }
}
