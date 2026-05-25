#include "DisplayManager.h"
#include <SPIFFS.h>

// ── 白色主题配色 ──────────────────────────────────────────────
static const uint32_t C_BG      = 0xFFFFFF;
static const uint32_t C_NEON    = 0xFF6B35;  // 暖橙
static const uint32_t C_PURPLE  = 0xFF8C94;  // 柔粉
static const uint32_t C_RED     = 0xE94560;
static const uint32_t C_TEXT    = 0x2D2D2D;
static const uint32_t C_MUTED   = 0xCCCCCC;
static const uint32_t C_BORDER  = 0xE8E8E8;
static const uint32_t C_SHAD_P  = 0xFFD0D5;
static const uint32_t C_SHAD_Y  = 0xFFE0CC;
static const uint32_t C_SHAD_R  = 0xFFC0C0;
static const uint32_t C_BTN_DIS = 0xD0D0D0;
static const uint32_t C_SHD_DIS = 0xC0C0C0;
static const uint32_t C_TXT_DIS = 0x999999;
static const uint32_t C_CARD    = 0xFFF5EE;  // 卡片暖白
static const uint32_t BTN_R     = 8;          // 按钮圆角

static const lgfx::IFont* FONT_S = &lgfx::v1::fonts::efontCN_12;
static const lgfx::IFont* FONT_M = &lgfx::v1::fonts::efontCN_14;
static const lgfx::IFont* FONT_L = &lgfx::v1::fonts::efontCN_16;

// ══════════════════════════════════════════════════════════════════
// 公开方法
// ══════════════════════════════════════════════════════════════════

void DisplayManager::begin() {
    M5.Display.setColorDepth(16);
    M5.Display.setTextWrap(false);
    M5.Display.fillScreen(C_BG);
    progressStep = 0;
}

// ── 无人入住 ────────────────────────────────────────────────────
void DisplayManager::drawNoCharacter() {
    M5.Display.fillScreen(C_BG);
    M5.Display.setFont(FONT_L);
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(C_MUTED);
    const char* msg = "正在等待人物入住";
    int tw = M5.Display.textWidth(msg);
    int th = M5.Display.fontHeight();
    M5.Display.setCursor((SCREEN_W - tw) / 2, (SCREEN_H - th) / 2);
    M5.Display.print(msg);
    M5.Display.setTextSize(1);
    _lastState = AppState::NO_CHARACTER;
}

// ── 全屏待机 ────────────────────────────────────────────────────
void DisplayManager::drawIdle(const String& name, const String& avatarPath,
                               const String& expression) {
    M5.Display.fillScreen(C_BG);

    int aw = 128, ah = 128;
    int ax = (SCREEN_W - aw) / 2;
    int ay = 36;

    // 头像（无框）
    _drawAvatar(ax, ay, aw, ah, _resolveAvatarPath(avatarPath, expression));

    _drawNameAt((SCREEN_W - M5.Display.textWidth(name.c_str())) / 2,
                175, name);

    // 待机提示：双击唤醒
    M5.Display.setFont(FONT_S);
    M5.Display.setTextColor(C_MUTED);
    const char* hint = "敲一敲唤醒我哦";
    int hintW = M5.Display.textWidth(hint);
    M5.Display.setCursor((SCREEN_W - hintW) / 2, 200);
    M5.Display.print(hint);

    // 左上角"换角色"按钮
    M5.Display.fillRoundRect(SWITCH_BTN_X, SWITCH_BTN_Y, SWITCH_BTN_W, SWITCH_BTN_H,
                              10, C_BORDER);
    M5.Display.setTextColor(C_TEXT);
    M5.Display.setFont(FONT_S);
    M5.Display.setCursor(SWITCH_BTN_X + 8, SWITCH_BTN_Y + 5);
    M5.Display.print("← 换角色");

    _lastState = AppState::IDLE;
}

// ── 角色选择 ────────────────────────────────────────────────────
void DisplayManager::drawCharacterSelect(const String names[],
                                          const String avatarPaths[],
                                          int count) {
    M5.Display.fillScreen(C_BG);

    // 标题
    M5.Display.setFont(FONT_L);
    M5.Display.setTextColor(C_TEXT);
    const char* title = "选择一位角色入住";
    int tw = M5.Display.textWidth(title);
    M5.Display.setCursor((SCREEN_W - tw) / 2, 16);
    M5.Display.print(title);

    int n = (count > 3) ? 3 : count;
    int totalW = n * CARD_W + (n - 1) * CARD_GAP;
    int startX = (SCREEN_W - totalW) / 2;

    for (int i = 0; i < n; i++) {
        int cx = startX + i * (CARD_W + CARD_GAP);

        // 卡片阴影 + 背景
        M5.Display.fillRoundRect(cx + 2, CARD_Y + 2, CARD_W, CARD_H, 8, C_SHAD_Y);
        M5.Display.fillRoundRect(cx, CARD_Y, CARD_W, CARD_H, 8, C_CARD);

        // 头像（透明底，缩放适配卡片大小）
        int ax = cx + (CARD_W - AVATAR_S) / 2;
        _drawAvatarTransparent(ax, CARD_Y + 8, AVATAR_S, AVATAR_S, avatarPaths[i], 0.52f);

        // 名字
        String name = names[i];
        M5.Display.setFont(FONT_M);
        M5.Display.setTextColor(C_NEON);
        int nw = M5.Display.textWidth(name.c_str());
        M5.Display.setCursor(cx + (CARD_W - nw) / 2, CARD_Y + 8 + AVATAR_S + 6);
        M5.Display.print(name);
    }

    // 底部"拍照识别"按钮（宽大居中）
    static constexpr int RECOG_BTN_W = 160;
    static constexpr int RECOG_BTN_H = 30;
    static constexpr int RECOG_BTN_Y = 182;
    int btnX = (SCREEN_W - RECOG_BTN_W) / 2;
    M5.Display.fillRect(0, RECOG_BTN_Y - 4, SCREEN_W, RECOG_BTN_H + 8, C_BG);
    _drawButton(btnX, RECOG_BTN_Y, RECOG_BTN_W, RECOG_BTN_H, C_PURPLE, C_SHAD_P, "拍照识别", false);

    _lastState = AppState::CHARACTER_SELECT;
}

// ── 识别中 ──────────────────────────────────────────────────────
void DisplayManager::drawRecognizing(int step) {
    M5.Display.fillScreen(C_BG);

    M5.Display.setFont(FONT_L);
    M5.Display.setTextColor(C_NEON);
    M5.Display.setCursor(90, 90);
    M5.Display.print("识别中");

    int barW = 160, barH = 8, barX = (SCREEN_W - barW) / 2, barY = 120;
    M5.Display.drawRoundRect(barX, barY, barW, barH, 4, C_NEON);

    int pos = (step % 40);
    if (pos > 19) pos = 39 - pos;
    int fillW = map(pos, 0, 19, 4, barW - 4);
    M5.Display.fillRoundRect(barX + 2, barY + 2, fillW, barH - 4, 3, C_NEON);

    _lastState = AppState::RECOGNIZING;
}

// ── 左右分栏 ────────────────────────────────────────────────────
void DisplayManager::drawSplitLayout(const String& name,
                                      const String& avatarPath,
                                      const String& text,
                                      const String& expression) {
    M5.Display.fillScreen(C_BG);

    // 竖分隔线
    M5.Display.fillRect(160, 0, 2, SCREEN_H, C_BORDER);

    // 左半：大图头像（无框）+ 底部名字
    int ax = SPRITE_X, ay = SPRITE_Y;

    _drawAvatar(ax, ay, AVATAR_L_W, AVATAR_L_H,
                _resolveAvatarPath(avatarPath, expression));

    // 名字在左半底部居中
    M5.Display.setFont(FONT_L);
    int nameW = M5.Display.textWidth(name.c_str());
    int nameX = (160 - nameW) / 2;
    _drawNameAt(max(0, nameX), NAME_Y, name);

    // 右半：文字
    _lastRightText = text;
    _drawRightText(text);
}

// ── 更新右侧文字 ────────────────────────────────────────────────
void DisplayManager::updateRightText(const String& text) {
    _lastRightText = text;
    _drawRightText(text);
}

// ══════════════════════════════════════════════════════════════════
// 底部按钮
// ══════════════════════════════════════════════════════════════════

void DisplayManager::showBottomBar(bool showRecognize) {
    M5.Display.fillRect(0, BTN_Y, SCREEN_W, BTN_H + BTN_S + 2, C_BG);

    if (showRecognize) {
        // 宽大居中"识别角色"按钮
        static constexpr int BW = 160, BH = 30, BY = 182;
        int bx = (SCREEN_W - BW) / 2;
        _drawButton(bx, BY, BW, BH, C_NEON, C_SHAD_Y, "识别角色", false);
    }
    // 普通状态下不再画说话按钮，改为由 drawWaveIcon 绘制声波动画
}

void DisplayManager::hideBottomBar() {
    M5.Display.fillRect(0, BTN_Y, SCREEN_W, BTN_H + BTN_S + 2, C_BG);
}

// ── 声波动画指示器 ──────────────────────────────────────────────
void DisplayManager::drawWaveIcon(int level) {
    // 只重绘声波区域，不刷全屏
    const int barW = 4, gap = 5, n = 3;
    const int totalW = n * barW + (n - 1) * gap;  // 22px
    const int startX = (SCREEN_W - totalW) / 2;
    const int baseY  = BTN_Y + BTN_H - 5;
    const int maxH   = 14;

    // 清除声波区域（稍微大一点避免残影）
    M5.Display.fillRect(startX - 2, baseY - maxH - 2, totalW + 4, maxH + 8, C_BG);

    for (int i = 0; i < n; i++) {
        float breathe = sinf(millis() / 600.0f + i * 2.1f) * 0.35f + 0.5f;
        int h;
        if (level <= 0) {
            // 待机：轻微呼吸
            h = 3 + (int)(breathe * 3);
        } else if (level < 30) {
            // 小声：呼吸 + 微动
            float mix = level / 30.0f;
            h = 3 + (int)((breathe * 3 * (1 - mix) + level / 100.0f * maxH * breathe * mix));
        } else {
            // 说话中：随音频能量起伏
            float wave = sinf(millis() / 180.0f + i * 1.8f) * 0.25f + 0.55f;
            h = 3 + (int)(level / 100.0f * maxH * wave);
        }
        h = constrain(h, 2, maxH);

        int x = startX + i * (barW + gap);
        int y = baseY - h;
        M5.Display.fillRoundRect(x, y, barW, h, 2, C_NEON);
    }
}

// ══════════════════════════════════════════════════════════════════
// 私有方法
// ══════════════════════════════════════════════════════════════════

void DisplayManager::_drawAvatar(int32_t x, int32_t y, int32_t w, int32_t h,
                                  const String& avatarPath, float scale) {
    if (!SPIFFS.exists(avatarPath)) return;
    fs::File file = SPIFFS.open(avatarPath, "r");
    if (!file) return;

    size_t len = file.size();
    uint8_t* buf = (uint8_t*)malloc(len);
    if (!buf) { file.close(); return; }

    file.read(buf, len);
    file.close();

    M5.Display.drawJpg(buf, len, x, y, w, h, 0, 0, scale, 0.0f);
    free(buf);
}

void DisplayManager::_drawAvatarTransparent(int32_t x, int32_t y, int32_t w,
                                              int32_t h,
                                              const String& avatarPath,
                                              float scale) {
    // 优先尝试 PNG（支持透明底）
    String pngPath = avatarPath;
    int dot = pngPath.lastIndexOf('.');
    if (dot > 0) {
        pngPath = pngPath.substring(0, dot) + ".png";
        if (SPIFFS.exists(pngPath)) {
            fs::File file = SPIFFS.open(pngPath, "r");
            if (file) {
                size_t len = file.size();
                uint8_t* buf = (uint8_t*)malloc(len);
                if (buf) {
                    file.read(buf, len);
                    file.close();
                    M5.Display.drawPng(buf, len, x, y, w, h, 0, 0, scale);
                    free(buf);
                    return;
                }
                file.close();
            }
        }
    }
    // 无 PNG 则退回 JPG
    _drawAvatar(x, y, w, h, avatarPath, scale);
}

void DisplayManager::_drawRightText(const String& text) {
    int cy = RIGHT_Y;
    int ch = BTN_Y - cy - 4;
    M5.Display.fillRect(RIGHT_X - 4, cy, RIGHT_W + 8, ch, C_BG);

    if (text.isEmpty()) return;

    int maxLines = ch / 16;
    String lines[20];
    int lineCount = 0;
    _wrapText(text, RIGHT_W, lines, lineCount, maxLines);

    M5.Display.setFont(FONT_S);
    M5.Display.setTextColor(C_TEXT);
    M5.Display.setTextWrap(false);
    for (int i = 0; i < lineCount; i++) {
        M5.Display.setCursor(RIGHT_X, cy + 4 + i * 16);
        M5.Display.print(lines[i]);
    }
}

void DisplayManager::_drawNameAt(int32_t x, int32_t y, const String& name) {
    M5.Display.setFont(FONT_L);
    M5.Display.setTextColor(C_NEON);
    M5.Display.setCursor(x, y);
    M5.Display.print(name);
}

void DisplayManager::_drawButton(int32_t x, int32_t y, int32_t w, int32_t h,
                                  uint32_t col, uint32_t shadowCol,
                                  const char* label, bool disabled) {
    M5.Display.fillRoundRect(x + 2, y + 2, w, h, BTN_R, shadowCol);
    M5.Display.fillRoundRect(x, y, w, h, BTN_R, col);

    if (label) {
        M5.Display.setFont(FONT_S);
        uint32_t textCol = disabled ? C_TXT_DIS : 0xFFFFFF;
        M5.Display.setTextColor(textCol);
        int32_t tw = M5.Display.textWidth(label);
        int32_t th = M5.Display.fontHeight();
        M5.Display.setCursor(x + (w - tw) / 2, y + (h - th) / 2);
        M5.Display.print(label);
    }
}

// ── 表情变体路径解析 ────────────────────────────────────────────
// 在 basePath 扩展名前插入 _expression，不存在时回退到 basePath
String DisplayManager::_resolveAvatarPath(const String& basePath,
                                           const String& expression) {
    if (expression.isEmpty() || expression == "idle") return basePath;
    int dot = basePath.lastIndexOf('.');
    if (dot < 0) return basePath;
    String variant = basePath.substring(0, dot) + "_" + expression
                   + basePath.substring(dot);
    if (SPIFFS.exists(variant)) return variant;
    return basePath;
}

// ── UTF-8 文本换行 ──────────────────────────────────────────────
static int32_t utf8Next(const String& s, int32_t i) {
    if (i >= (int32_t)s.length()) return i;
    uint8_t c = (uint8_t)s[i];
    if ((c & 0x80) == 0x00) return i + 1;
    if ((c & 0xE0) == 0xC0) return min(i + 2, (int32_t)s.length());
    if ((c & 0xF0) == 0xE0) return min(i + 3, (int32_t)s.length());
    if ((c & 0xF8) == 0xF0) return min(i + 4, (int32_t)s.length());
    return i + 1;
}

void DisplayManager::_wrapText(const String& text, int32_t maxWidth,
                                String* lines, int& lineCount, int maxLines) {
    lineCount = 0;
    int32_t start = 0;
    int32_t len = text.length();

    while (start < len && lineCount < maxLines) {
        while (start < len && (text[start] == '\r' || text[start] == '\n')) start++;
        if (start >= len) break;

        int32_t pos = start;
        int32_t lastFit = start;
        while (pos < len) {
            if (text[pos] == '\r' || text[pos] == '\n') break;
            int32_t next = utf8Next(text, pos);
            String cand = text.substring(start, next);
            if (M5.Display.textWidth(cand.c_str()) > maxWidth) break;
            lastFit = next;
            pos = next;
        }
        if (lastFit == start) lastFit = utf8Next(text, start);
        lines[lineCount++] = text.substring(start, lastFit);
        start = lastFit;
    }
}
