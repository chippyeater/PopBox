#include "DisplayManager.h"
#include <SPIFFS.h>

// ── RGB888 颜色（M5GFX 自动转换，与 web style.css 一致）─────────
static const uint32_t C_BG      = 0x090909;  // 背景
static const uint32_t C_PANEL   = 0x111114;  // 头部面板
static const uint32_t C_NEON    = 0xCCFF00;  // 霓虹黄绿
static const uint32_t C_PURPLE  = 0x8B2FE8;  // 紫色
static const uint32_t C_RED     = 0xE94560;  // 录音红
static const uint32_t C_TEXT    = 0xFFFFFF;  // 白色文字
static const uint32_t C_MUTED   = 0x555566;  // 灰色辅助文字
static const uint32_t C_BORDER  = 0x2A2A35;  // 边框
static const uint32_t C_SHAD_P  = 0x5010A0;  // 紫色阴影
static const uint32_t C_SHAD_Y  = 0x88AA00;  // 黄绿阴影
static const uint32_t C_SHAD_R  = 0x901030;  // 红色阴影
static const uint32_t C_CHAT_BG = 0x0D0D10;  // 聊天区背景

// 字体
static const lgfx::IFont* FONT_S = &lgfx::v1::fonts::efontCN_12;
static const lgfx::IFont* FONT_M = &lgfx::v1::fonts::efontCN_14;
static const lgfx::IFont* FONT_L = &lgfx::v1::fonts::efontCN_16;

// 布局常量（屏幕 320×240）
static const int32_t HDR_H   = 108;  // 头部高度
static const int32_t BTN_Y   = 206;  // 按钮顶部 y
static const int32_t BTN_H   = 30;   // 按钮高度
static const int32_t BTN_S   = 3;    // 阴影偏移
static const int32_t BTN_CUT = 10;   // 右下切角大小
static const int32_t MIC_X   = 6;    // 左按钮 x
static const int32_t MIC_W   = 182;  // 左按钮宽
static const int32_t CAM_X   = 196;  // 右按钮 x
static const int32_t CAM_W   = 118;  // 右按钮宽

// ── 工具：带硬阴影 + 右下切角的按钮 ───────────────────────────
static void drawButton(int32_t x, int32_t y, int32_t w, int32_t h,
                       uint32_t col, uint32_t shadowCol, const char* label,
                       const lgfx::IFont* font = nullptr) {
    // 1. 阴影
    M5.Display.fillRect(x + BTN_S, y + BTN_S, w, h, shadowCol);
    // 2. 按钮主体
    M5.Display.fillRect(x, y, w, h, col);
    // 3. 右下切角（覆盖按钮 + 阴影的组合右下角）
    M5.Display.fillTriangle(
        x + w + BTN_S - BTN_CUT, y + h + BTN_S,
        x + w + BTN_S,            y + h + BTN_S - BTN_CUT,
        x + w + BTN_S,            y + h + BTN_S,
        C_BG
    );
    // 4. 三个 corner marks（左上、右上、左下），2px 厚度
    const int32_t CL = 6;  // L形臂长
    uint32_t cm = (col == C_NEON) ? 0x000000 : 0x888888;
    // TL
    M5.Display.fillRect(x+3,        y+3,        CL, 1, cm);
    M5.Display.fillRect(x+3,        y+3,        1, CL, cm);
    // TR
    M5.Display.fillRect(x+w-CL-3,   y+3,        CL, 1, cm);
    M5.Display.fillRect(x+w-4,      y+3,        1, CL, cm);
    // BL
    M5.Display.fillRect(x+3,        y+h-4,      CL, 1, cm);
    M5.Display.fillRect(x+3,        y+h-CL-3,   1, CL, cm);
    // 5. 标签居中
    if (label) {
        const lgfx::IFont* f = font ? font : FONT_S;
        M5.Display.setFont(f);
        uint32_t textCol = (col == C_NEON) ? 0x000000 : C_TEXT;
        M5.Display.setTextColor(textCol);
        int32_t tw = M5.Display.textWidth(label);
        int32_t th = M5.Display.fontHeight();
        M5.Display.setCursor(x + (w - tw) / 2, y + (h - th) / 2);
        M5.Display.print(label);
    }
}

// ── 工具：头像角标（L 形霓虹绿） ─────────────────────────────
static void drawAvatarCorners() {
    const int32_t AX = AVATAR_X, AY = AVATAR_Y, AS = AVATAR_SIZE;
    const int32_t L = 10, T = 2, G = 3;  // 臂长、厚度、外距
    int32_t x0 = AX - G, y0 = AY - G;
    int32_t x1 = AX + AS + G - T, y1 = AY + AS + G - T;
    // TL
    M5.Display.fillRect(x0,      y0,  L, T, C_NEON);
    M5.Display.fillRect(x0,      y0,  T, L, C_NEON);
    // TR
    M5.Display.fillRect(x1-L+T,  y0,  L, T, C_NEON);
    M5.Display.fillRect(x1,      y0,  T, L, C_NEON);
    // BL
    M5.Display.fillRect(x0,      y1,  L, T, C_NEON);
    M5.Display.fillRect(x0,      y1-L+T, T, L, C_NEON);
    // BR
    M5.Display.fillRect(x1-L+T,  y1,  L, T, C_NEON);
    M5.Display.fillRect(x1,      y1-L+T, T, L, C_NEON);
}

// ── 状态对应文字 ─────────────────────────────────────────────
static const char* stateLabel(AppState s) {
    switch (s) {
        case AppState::RECORDING:        return "录音中";
        case AppState::PROCESSING:       return "思考中";
        case AppState::RECOGNIZING:      return "识别中";
        case AppState::DISPLAYING_REPLY: return "回复";
        default:                         return "待机";
    }
}

static uint32_t stateBadgeColor(AppState s) {
    switch (s) {
        case AppState::RECORDING:        return C_RED;
        case AppState::PROCESSING:       return C_NEON;
        case AppState::RECOGNIZING:      return 0x00BFFF;  // cyan
        default:                         return C_MUTED;
    }
}

// ── DisplayManager 公开方法 ───────────────────────────────────

void DisplayManager::begin() {
    M5.Display.setColorDepth(16);
    M5.Display.setTextWrap(false);
    M5.Display.fillScreen(C_BG);
}

void DisplayManager::drawFull(const String& characterName, AppState state,
                               const String& replyText, int charIdx, int charTotal) {
    _lastCharName = characterName;
    M5.Display.fillScreen(C_BG);
    _drawHeader(characterName, state, charIdx, charTotal);
    _drawChatHistory();
    _drawBottomBar(state);
}

void DisplayManager::updateStatus(AppState state, int charIdx, int charTotal) {
    // 只刷新状态徽章区域
    int32_t bx = AVATAR_X + AVATAR_SIZE + 14;
    int32_t by = AVATAR_Y + 38;
    int32_t bw = SCREEN_W - bx - 8;
    M5.Display.fillRect(bx, by, bw, 30, C_PANEL);
    _drawStatusBadge(bx, by, state);
    if (charTotal > 1) {
        M5.Display.setFont(FONT_S);
        M5.Display.setTextColor(C_MUTED);
        M5.Display.setCursor(bx, by + 20);
        M5.Display.printf("%d / %d", charIdx, charTotal);
    }
    _drawBottomBar(state);
}

void DisplayManager::updateCharacterName(const String& name, int charIdx, int charTotal) {
    _lastCharName = name;
    int32_t tx = AVATAR_X + AVATAR_SIZE + 14;
    M5.Display.fillRect(tx, AVATAR_Y, SCREEN_W - tx - 4, 36, C_PANEL);
    M5.Display.setFont(FONT_L);
    M5.Display.setTextColor(C_NEON);
    M5.Display.setCursor(tx, AVATAR_Y + 8);
    M5.Display.print(name);
    if (charTotal > 1) {
        M5.Display.setFont(FONT_S);
        M5.Display.setTextColor(C_MUTED);
        M5.Display.setCursor(tx, AVATAR_Y + 32);
        M5.Display.printf("%d / %d", charIdx, charTotal);
    }
}

void DisplayManager::drawSprite(const SpriteColors& colors, AppState state) {
    // 霓虹绿背景
    M5.Display.fillRect(AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE, C_NEON);
    // pixelSize=4 → 64×64，在 90×90 框内居中（偏移 13px）
    SpriteRenderer::drawForState(
        AVATAR_X + 13, AVATAR_Y + 13, 4,
        state, colors.hasColors() ? colors : SpriteColors::defaults()
    );
    drawAvatarCorners();
    _lastState = state;
}

void DisplayManager::updateSpriteExpression(const SpriteColors& colors, AppState state) {
    if (state == _lastState) return;
    drawSprite(colors, state);
}

// ── 私有方法 ─────────────────────────────────────────────────

void DisplayManager::_drawStatusBadge(int32_t x, int32_t y, AppState state) {
    uint32_t col = stateBadgeColor(state);
    const char* label = stateLabel(state);
    // 边框矩形
    int32_t bw = 72, bh = 18;
    M5.Display.drawRect(x, y, bw, bh, col);
    // 状态方块（dot）
    M5.Display.fillRect(x + 6, y + 5, 8, 8, col);
    // 文字
    M5.Display.setFont(FONT_S);
    M5.Display.setTextColor(col);
    M5.Display.setCursor(x + 18, y + 3);
    M5.Display.print(label);
}

void DisplayManager::_drawHeader(const String& name, AppState state,
                                  int charIdx, int charTotal) {
    // 头部背景
    M5.Display.fillRect(0, 0, SCREEN_W, HDR_H, C_PANEL);
    // 分隔线（紫色，2px）
    M5.Display.fillRect(0, HDR_H - 2, SCREEN_W, 2, C_BORDER);

    int32_t tx = AVATAR_X + AVATAR_SIZE + 14;

    // 角色名（霓虹绿大字）
    M5.Display.setFont(FONT_L);
    M5.Display.setTextColor(C_NEON);
    M5.Display.setCursor(tx, AVATAR_Y + 8);
    M5.Display.print(name);

    // 状态徽章
    _drawStatusBadge(tx, AVATAR_Y + 36, state);

    // 角色序号
    if (charTotal > 1) {
        M5.Display.setFont(FONT_S);
        M5.Display.setTextColor(C_MUTED);
        M5.Display.setCursor(tx, AVATAR_Y + 62);
        M5.Display.printf("%d / %d", charIdx, charTotal);
    }

    // 右上装饰竖线（类似 web 的 slash-group）
    for (int i = 0; i < 4; i++) {
        int32_t lx = SCREEN_W - 20 + i * 4;
        M5.Display.fillRect(lx, 8, 2, 14, C_BORDER);
    }
}

// ── 消息历史接口 ─────────────────────────────────────────────

void DisplayManager::addMessage(const String& text, bool isUser) {
    removeThinking();
    if (_msgCount == MSG_MAX) {
        for (int i = 0; i < MSG_MAX - 1; i++) _msgs[i] = _msgs[i+1];
        _msgCount = MSG_MAX - 1;
    }
    _msgs[_msgCount++] = { isUser, text, false };
    _drawChatHistory();
}

void DisplayManager::clearMessages() {
    _msgCount    = 0;
    _hasThinking = false;
    _drawChatHistory();
}

void DisplayManager::showThinking() {
    if (_hasThinking) return;
    if (_msgCount < MSG_MAX) {
        _msgs[_msgCount++] = { false, "...", true };
        _hasThinking = true;
        _drawChatHistory();
    }
}

void DisplayManager::removeThinking() {
    if (!_hasThinking) return;
    for (int i = 0; i < _msgCount; i++) {
        if (_msgs[i].isThinking) {
            for (int j = i; j < _msgCount - 1; j++) _msgs[j] = _msgs[j+1];
            _msgCount--;
            break;
        }
    }
    _hasThinking = false;
}

static int32_t utf8NextIndex(const String& s, int32_t i) {
    if (i >= (int32_t)s.length()) return i;
    uint8_t c = (uint8_t)s[i];
    if ((c & 0x80) == 0x00) return i + 1;
    if ((c & 0xE0) == 0xC0) return min(i + 2, (int32_t)s.length());
    if ((c & 0xF0) == 0xE0) return min(i + 3, (int32_t)s.length());
    if ((c & 0xF8) == 0xF0) return min(i + 4, (int32_t)s.length());
    return i + 1;
}

static int32_t wrapTextLines(const String& text, String* lines,
                             int32_t maxLines, int32_t maxWidth) {
    int32_t count = 0;
    int32_t start = 0;
    const int32_t len = text.length();

    while (start < len && count < maxLines) {
        while (start < len && (text[start] == '\r' || text[start] == '\n' || text[start] == ' ')) {
            start++;
        }
        if (start >= len) break;

        int32_t pos = start;
        int32_t lastFit = start;
        while (pos < len) {
            if (text[pos] == '\r' || text[pos] == '\n') break;
            int32_t next = utf8NextIndex(text, pos);
            String candidate = text.substring(start, next);
            if (M5.Display.textWidth(candidate.c_str()) > maxWidth) break;
            lastFit = next;
            pos = next;
        }

        if (lastFit == start) lastFit = utf8NextIndex(text, start);
        lines[count++] = text.substring(start, lastFit);
        start = lastFit;
    }
    return count;
}

// 兼容旧的单行文字调用（临时提示如"识别中…"）
void DisplayManager::updateChatText(const String& text) {
    int32_t cy = HDR_H + 2;
    int32_t ch = BTN_Y - cy - 2;
    M5.Display.fillRect(0, cy, SCREEN_W, ch, C_CHAT_BG);
    if (text.isEmpty()) return;
    M5.Display.setFont(FONT_S);
    M5.Display.setTextColor(C_MUTED);
    M5.Display.setTextWrap(true);
    M5.Display.setCursor(8, cy + 8);
    M5.Display.print(text);
    M5.Display.setTextWrap(false);
}

// ── 消息气泡渲染 ─────────────────────────────────────────────

void DisplayManager::_drawChatHistory() {
    const int32_t CY     = HDR_H + 2;
    const int32_t CH     = BTN_Y - CY - 2;
    const int32_t LINE_H = 14;
    const int32_t GAP    = 3;
    const int32_t PADX   = 8;
    const int32_t PADY   = 4;
    const int32_t MARG   = 8;
    const int32_t MAX_W  = SCREEN_W - MARG * 2 - 4;
    const int32_t TEXT_W = MAX_W - PADX * 2;

    M5.Display.fillRect(0, CY, SCREEN_W, CH, C_CHAT_BG);
    if (_msgCount == 0) return;

    M5.Display.setFont(FONT_S);
    M5.Display.setTextWrap(false);

    int32_t bottom = CY + CH;
    for (int i = _msgCount - 1; i >= 0 && bottom > CY; i--) {
        const ChatMsg& m = _msgs[i];
        String text = m.isThinking ? String("...") : m.text;

        int32_t available = bottom - CY;
        int32_t maxLines = min((int32_t)8, max((int32_t)1, (available - PADY * 2) / LINE_H));
        String lines[8];
        int32_t lineCount = wrapTextLines(text, lines, maxLines, TEXT_W);
        if (lineCount <= 0) continue;

        int32_t bubbleH = lineCount * LINE_H + PADY * 2;
        int32_t y = bottom - bubbleH;
        if (y < CY) break;

        int32_t maxLineW = 0;
        for (int32_t l = 0; l < lineCount; l++) {
            maxLineW = max(maxLineW, M5.Display.textWidth(lines[l].c_str()));
        }
        int32_t bw = min(MAX_W, max((int32_t)(maxLineW + PADX * 2), (int32_t)36));
        int32_t bx = m.isUser ? (SCREEN_W - bw - MARG) : MARG;

        if (m.isUser) {
            M5.Display.fillRect(bx, y, bw, bubbleH, C_PURPLE);
            M5.Display.setTextColor(0xFFFFFF);
        } else {
            uint32_t bgCol  = m.isThinking ? (uint32_t)0x222233 : (uint32_t)0x1C1C30;
            uint32_t txtCol = m.isThinking ? (uint32_t)0x888899 : (uint32_t)0xFFFFFF;
            M5.Display.fillRect(bx, y, bw, bubbleH, bgCol);
            M5.Display.drawRect(bx, y, bw, bubbleH, 0x444466);
            M5.Display.setTextColor(txtCol);
        }

        for (int32_t l = 0; l < lineCount; l++) {
            M5.Display.setCursor(bx + PADX, y + PADY + l * LINE_H);
            M5.Display.print(lines[l]);
        }

        bottom = y - GAP;
    }
    M5.Display.setTextWrap(false);
}

void DisplayManager::_drawBottomBar(AppState state) {
    // 按钮背景条
    M5.Display.fillRect(0, BTN_Y - 4, SCREEN_W, BTN_H + BTN_S + 6, C_BG);

    bool recording   = (state == AppState::RECORDING);
    bool busy        = (state == AppState::PROCESSING || state == AppState::RECOGNIZING);
    bool recognizing = (state == AppState::RECOGNIZING);

    // 左：麦克风按钮（紫色 / 录音时红色 / 忙时暗色）
    uint32_t micCol  = recording ? C_RED    : (busy ? 0x222230 : C_PURPLE);
    uint32_t micShad = recording ? C_SHAD_R : (busy ? 0x111118 : C_SHAD_P);
    const char* micLabel = recording ? "■  停止" : (busy ? "等待中" : "●  说话");
    drawButton(MIC_X, BTN_Y, MIC_W, BTN_H, micCol, micShad, micLabel, FONT_S);

    // 右：识别按钮（霓虹黄绿 / 识别时暗）
    uint32_t camCol  = recognizing ? 0x88AA00 : C_NEON;
    uint32_t camShad = recognizing ? 0x445500 : C_SHAD_Y;
    const char* camLabel = recognizing ? "识别中" : "识别角色";
    drawButton(CAM_X, BTN_Y, CAM_W, BTN_H, camCol, camShad, camLabel, FONT_S);
}
