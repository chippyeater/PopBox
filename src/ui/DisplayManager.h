#pragma once
#include <Arduino.h>
#include <M5Unified.h>
#include "../config.h"
#include "AppState.h"

// 全局配色与字体常量（DisplayManager.cpp 中实现）
extern const uint32_t C_NEON;
extern const lgfx::IFont* FONT_L;

// ─────────────────────────────────────────────────────────────
// DisplayManager — 屏幕布局渲染
//
// 按状态渲染不同布局：
//   NO_CHARACTER     → 全屏"正在等待人物入住"
//   CHARACTER_SELECT → 角色选择卡片（最多3人一排）
//   RECOGNIZING      → 识别中文字 + 进度条
//   GREETING         → 左半角色头像+名字 / 右半招呼语
//   CHATTING         → 左半角色头像+名字 / 右半角色回复
//   IDLE             → 全屏角色头像+名字居中
//   PHYSICAL         → 由外部调 Special 动效
// ─────────────────────────────────────────────────────────────

// 角色选择卡片布局常量（DisplayManager 与 ChatUI 共享）
static constexpr int CARD_W    = 95;
static constexpr int CARD_H    = 108;
static constexpr int CARD_GAP  = 12;
static constexpr int CARD_Y    = 50;
static constexpr int AVATAR_S  = 66;

// IDLE 状态"换角色"按钮
static constexpr int SWITCH_BTN_X = 4;
static constexpr int SWITCH_BTN_Y = 4;
static constexpr int SWITCH_BTN_W = 76;
static constexpr int SWITCH_BTN_H = 33;

class DisplayManager {
public:
    void begin();

    enum class StageSide { None, Red, Blue };

    // 全屏状态：无人入住 / 角色数量选择 / 待机
    void drawModeSelect();
    void drawPartyEntry(const String& title, const String& redName,
                        const String& blueName, const String& bottomText);
    void drawPartyEntry(bool debate, bool redReady, bool blueReady);
    void drawDailyStage(const String& redExpression, const String& blueExpression,
                        StageSide speaker, int audioLevel);
    void drawDebateTopic(const String& redName, const String& blueName,
                         const String& topic, const String& bottomText,
                         int audioLevel);
    void drawDebateTopicEntry(bool topicReady, int audioLevel);
    void drawDebateTurn(const String& redName, const String& blueName,
                        StageSide speaker, int secondsLeft, int score,
                        const String& redExpression, const String& blueExpression);
    void drawDebateBoom(StageSide target, int score, int secondsLeft);
    void drawDebateResult(StageSide winner, int winCount);
    void drawNoCharacter();
    void drawCountSelection(int existingCount);
    void drawIdle(const String& name, const String& avatarPath,
                  const String& expression = "");

    // 角色选择：展示角色卡片（姓名 + 头像）
    void drawCharacterSelect(const String names[], const String avatarPaths[], int count);

    // 识别中：文字 + 进度条动画
    void drawRecognizing(int step);

    // 第一位角色识别成功：展示角色名 + 提示识别第二位
    void drawFirstRecognitionResult(const String& name);

    // 左右分栏：打招呼 / 交流（avatarPath 为 /avatar.jpg 等）
    void drawSplitLayout(const String& name, const String& avatarPath,
                         const String& text, const String& expression = "");

    // 群聊布局：绘制顶部标题栏（不绘制消息），消息通过 appendGroupText 逐条添加
    void drawGroupLayout(const String& nameA, const String& avatarA,
                         const String& nameB, const String& avatarB);
    // 群聊待机：双角色头像 + 名字
    void drawGroupIdle(const String& nameA, const String& avatarPathA,
                       const String& nameB, const String& avatarPathB);
    // 追加一条消息（说话人头像 + 名字 + 文字），逐条追加不重绘历史
    void appendGroupText(const String& speakerName, const String& text);

    // 清空群聊消息区域（保留顶部栏），供每条新回复独占全屏
    void clearGroupMessages();

    // 更新右侧文字（不刷新左半）
    void updateRightText(const String& text);

    // 底部按钮栏
    void showBottomBar(bool showRecognize);
    void hideBottomBar();

    // 声波动画指示器（level 0-100，0 = 待机呼吸，>0 = 音频能量）
    void drawWaveIcon(int level);
    void drawDailyUserWave(int level);

    // 识别进度条动画步进（内部用）
    int  progressStep;

private:
    void _drawRightText(const String& text);
    void _drawAvatar(int32_t x, int32_t y, int32_t w, int32_t h,
                     const String& avatarPath, float scale = 1.0f);
    void _drawAvatarTransparent(int32_t x, int32_t y, int32_t w, int32_t h,
                                const String& avatarPath, float scale = 1.0f);
    void _drawPngAsset(const String& path, int32_t x, int32_t y, int32_t w,
                       int32_t h, float scale = 1.0f);
    void _drawStageExpression(StageSide side, const String& expression,
                              int32_t x, int32_t y, int32_t w, int32_t h);
    void _drawDebateProgress(int score, int y);
    void _drawWaveBars(int centerX, int baseY, int maxH, int level,
                       uint32_t color, bool clearBackground);
    void _drawPromptBox(int32_t x, int32_t y, int32_t w, int32_t h,
                        const String& text, bool button);
    void _drawBottomPrompt(const String& text);
    void _drawNameAt(int32_t x, int32_t y, const String& name);
    void _drawButton(int32_t x, int32_t y, int32_t w, int32_t h,
                     uint32_t col, uint32_t shadowCol, const char* label,
                     bool disabled = false);
    void _wrapText(const String& text, int32_t maxWidth,
                   String* lines, int& lineCount, int maxLines);
    String _resolveAvatarPath(const String& basePath, const String& expression);

    // 群聊消息渲染状态
    int     _groupMsgY = 36;
    String  _groupNameA, _groupNameB;
    String  _groupAvatarA, _groupAvatarB;

    String   _lastRightText;
    AppState _lastState = AppState::NO_CHARACTER;
};
