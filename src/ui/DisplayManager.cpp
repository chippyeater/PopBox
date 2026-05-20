#include "DisplayManager.h"
#include <SPIFFS.h>

// 颜色常量
static const uint32_t COLOR_BG        = 0x1A1A2E;
static const uint32_t COLOR_HEADER_BG = 0x16213E;
static const uint32_t COLOR_CHAT_BG   = 0x0F3460;
static const uint32_t COLOR_BTN_IDLE  = 0x533483;
static const uint32_t COLOR_BTN_REC   = 0xE94560;
static const uint32_t COLOR_TEXT      = 0xF5F5F5;
static const uint32_t COLOR_NAME      = 0xFFD700;
static const uint32_t COLOR_STATUS_OK = 0x00C9A7;

// efontCN：M5GFX 内置简体中文字体，覆盖 GB2312 常用汉字 6763 字
static const lgfx::IFont* FONT_SMALL  = &lgfx::v1::fonts::efontCN_12;
static const lgfx::IFont* FONT_MEDIUM = &lgfx::v1::fonts::efontCN_14;
static const lgfx::IFont* FONT_LARGE  = &lgfx::v1::fonts::efontCN_16;

void DisplayManager::begin() {
    M5.Display.setColorDepth(16);
    M5.Display.setTextWrap(true);
    M5.Display.setFont(FONT_SMALL);
    M5.Display.fillScreen(COLOR_BG);
}

void DisplayManager::drawFull(const String& characterName, AppState state,
                               const String& replyText) {
    _lastCharName = characterName;
    M5.Display.fillScreen(COLOR_BG);
    _drawHeader(characterName, state);
    _drawChatArea(replyText);
    _drawBottomBar(state);
}

void DisplayManager::updateChatText(const String& text) {
    _drawChatArea(text);
}

void DisplayManager::updateStatus(AppState state) {
    int32_t statusX = AVATAR_X + AVATAR_SIZE + 8;
    int32_t statusY = AVATAR_Y + 28;
    M5.Display.fillRect(statusX, statusY, SCREEN_W - statusX - 4, 22,
                        COLOR_HEADER_BG);
    M5.Display.setFont(FONT_SMALL);
    M5.Display.setTextColor(_stateLabelColor(state));
    M5.Display.setCursor(statusX, statusY + 2);
    M5.Display.print(_stateLabel(state));
    _drawBottomBar(state);
}

void DisplayManager::updateCharacterName(const String& name) {
    _lastCharName = name;
    int32_t textX = AVATAR_X + AVATAR_SIZE + 8;
    M5.Display.fillRect(textX, AVATAR_Y, SCREEN_W - textX - 4, 28, COLOR_HEADER_BG);
    M5.Display.setFont(FONT_LARGE);
    M5.Display.setTextColor(COLOR_NAME);
    M5.Display.setCursor(textX, AVATAR_Y + 6);
    M5.Display.print(name);
}

bool DisplayManager::drawAvatar(const char* path) {
    bool exists = SPIFFS.exists(path);
    Serial.printf("[Display] drawAvatar: path=%s exists=%d\n", path, exists);

    if (!exists) {
        // 占位圆形 + "？"
        M5.Display.fillCircle(AVATAR_X + AVATAR_SIZE / 2,
                              AVATAR_Y + AVATAR_SIZE / 2,
                              AVATAR_SIZE / 2, 0x44475A);
        M5.Display.setFont(FONT_LARGE);
        M5.Display.setTextColor(COLOR_TEXT);
        M5.Display.setCursor(AVATAR_X + AVATAR_SIZE / 2 - 10,
                             AVATAR_Y + AVATAR_SIZE / 2 - 10);
        M5.Display.print("?");
        return false;
    }

    File f = SPIFFS.open(path, "r");
    if (!f) {
        Serial.println("[Display] 头像文件打开失败");
        return false;
    }

    size_t   size = f.size();
    Serial.printf("[Display] 头像文件大小: %zu 字节\n", size);

    uint8_t* buf = (uint8_t*)heap_caps_malloc(size,
                       MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!buf) buf = (uint8_t*)malloc(size);
    if (!buf) {
        Serial.println("[Display] 头像缓冲区分配失败");
        f.close();
        return false;
    }

    f.read(buf, size);
    f.close();

    M5.Display.drawJpg(buf, size, AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
    free(buf);
    Serial.println("[Display] 头像绘制完成");
    return true;
}

// ── 私有方法 ──────────────────────────────────────────────────

void DisplayManager::_drawHeader(const String& name, AppState state) {
    M5.Display.fillRect(0, 0, SCREEN_W, 108, COLOR_HEADER_BG);

    int32_t textX = AVATAR_X + AVATAR_SIZE + 8;

    // 角色名（大字）
    M5.Display.setFont(FONT_LARGE);
    M5.Display.setTextColor(COLOR_NAME);
    M5.Display.setCursor(textX, AVATAR_Y + 6);
    M5.Display.print(name);

    // 状态（小字）
    M5.Display.setFont(FONT_SMALL);
    M5.Display.setTextColor(_stateLabelColor(state));
    M5.Display.setCursor(textX, AVATAR_Y + 32);
    M5.Display.print(_stateLabel(state));

    M5.Display.drawFastHLine(0, 108, SCREEN_W, 0x334466);
}

void DisplayManager::_drawChatArea(const String& text) {
    M5.Display.fillRect(CHAT_TEXT_X - 2, CHAT_TEXT_Y - 4,
                        CHAT_TEXT_W + 4, CHAT_TEXT_H + 4, COLOR_CHAT_BG);

    if (text.isEmpty()) return;

    M5.Display.setFont(FONT_SMALL);
    M5.Display.setTextColor(COLOR_TEXT);
    M5.Display.setTextWrap(true);
    M5.Display.setCursor(CHAT_TEXT_X + 4, CHAT_TEXT_Y + 4);
    M5.Display.print(text);

    // [EXTENSION POINT] 后续可替换为富文本渲染器（气泡、滚动等）
}

// 底部双按钮：[● 说话 / 停止]  [识别角色]
void DisplayManager::_drawBottomBar(AppState state) {
    bool recognizing = (state == AppState::RECOGNIZING);
    bool recording   = (state == AppState::RECORDING);
    bool busy        = (state == AppState::PROCESSING || recognizing);

    // 左侧麦克风按钮（宽 185px）
    uint32_t micColor = recording ? COLOR_BTN_REC : (busy ? 0x2a2a2a : COLOR_BTN_IDLE);
    M5.Display.fillRoundRect(4, MIC_BTN_Y, 185, MIC_BTN_H, 6, micColor);
    M5.Display.setFont(FONT_SMALL);
    M5.Display.setTextColor(COLOR_TEXT);
    const char* micLabel = recording ? "■  停止" : (busy ? "等待中..." : "●  点击说话");
    int32_t mlw = M5.Display.textWidth(micLabel);
    M5.Display.setCursor(4 + (185 - mlw) / 2, MIC_BTN_Y + MIC_BTN_H / 2 - 6);
    M5.Display.print(micLabel);

    // 右侧识别按钮（宽 126px）
    uint32_t camColor = recognizing ? COLOR_BTN_REC : (busy ? 0x2a2a2a : 0x1a5a3a);
    M5.Display.fillRoundRect(193, MIC_BTN_Y, 123, MIC_BTN_H, 6, camColor);
    const char* camLabel = recognizing ? "识别中..." : "识别角色";
    int32_t clw = M5.Display.textWidth(camLabel);
    M5.Display.setCursor(193 + (123 - clw) / 2, MIC_BTN_Y + MIC_BTN_H / 2 - 6);
    M5.Display.print(camLabel);
}

const char* DisplayManager::_stateLabel(AppState s) {
    switch (s) {
        case AppState::IDLE:             return "● 待机";
        case AppState::RECORDING:        return "● 录音中...";
        case AppState::PROCESSING:       return "● 思考中...";
        case AppState::DISPLAYING_REPLY: return "● 回复完成";
        case AppState::RECOGNIZING:      return "● 识别角色中...";
        default:                         return "";
    }
}

uint32_t DisplayManager::_stateLabelColor(AppState s) {
    switch (s) {
        case AppState::RECORDING:  return COLOR_BTN_REC;
        case AppState::PROCESSING:  return 0xFFA500;
        case AppState::RECOGNIZING: return 0x00BFFF;
        default:                   return COLOR_STATUS_OK;
    }
}
