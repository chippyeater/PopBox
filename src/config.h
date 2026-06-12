#pragma once

// ─────────────────────────────────────────
// WiFi
// ─────────────────────────────────────────
#define WIFI_SSID     "禁止摸鱼的Mate 70"
#define WIFI_PASSWORD "12345678cst"

// ─────────────────────────────────────────
// 后端服务器地址
// 后端通过 mDNS 广播为 popbox.local，无需填写 IP
// 若 mDNS 不可用，改为 http://192.168.x.x:3000
// ─────────────────────────────────────────
#define BACKEND_URL "http://100.78.239.167:3000"  // 填入你的实际 IP，mDNS 调试中

// ── 屏幕尺寸 ══════════════════════════════════════════════════
#define SCREEN_W        320
#define SCREEN_H        240

// ── 底部按钮栏 ════════════════════════════════════════════════
#define BTN_Y           214
#define BTN_H           22
#define BTN_S           4

// ── 左右分栏布局 ══════════════════════════════════════════════
#define SPRITE_X        12
#define SPRITE_Y        24
#define AVATAR_L_W      136
#define AVATAR_L_H      136
#define NAME_Y          175
#define RIGHT_X         168
#define RIGHT_W         144
#define RIGHT_Y         24

// ── 头像（全屏待机用） ════════════════════════════════════════
#define AVATAR_IDLE_W   128
#define AVATAR_IDLE_H   128

// ── 音频配置 ══════════════════════════════════════════════════
#define AUDIO_SAMPLE_RATE    16000
#define AUDIO_BUFFER_SAMPLES 160000   // 10 秒 @ 16kHz 16bit
#define VAD_RMS_THRESHOLD    1500     // 环境噪声高时调大；太难触发时调小
#define VAD_MAX_SPEECH_FRAMES 260     // 256 samples/frame，约 4.2 秒强制收尾

// ── SPIFFS 路径 ═══════════════════════════════════════════════
#define CHARACTER_JSON_PATH  "/character.json"

// ── 调试开关 ══════════════════════════════════════════════════
// 0 = 正常拍照识别角色
// 1 = 跳过舞台识别，直接预填孙悟空 / 林黛玉（仅调试群聊流程用）
#ifndef POPBOX_PREFILL_TEST_CHARACTERS
#define POPBOX_PREFILL_TEST_CHARACTERS 0
#endif

// ── 实体按钮爆灯 & LED ═══════════════════════════════════════
#define PIN_BTN_RED   18   // Grove C
#define PIN_LED_RED    2   // Grove A
#define PIN_BTN_BLUE   9   // Grove B (via Hub, GPIO9)
#define PIN_LED_BLUE   8   // Grove B (via Hub, GPIO8)

// ── 辩论模式配置 ══════════════════════════════════════════════
#define DEBATE_INITIAL_SCORE      50
#define DEBATE_BOOM_DELTA         15
#define DEBATE_WIN_SCORE          100
#define DEBATE_TURN_SECONDS       60
