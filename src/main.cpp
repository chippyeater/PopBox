#include <Arduino.h>
#include <M5Unified.h>
#include <WiFi.h>
#include <SPIFFS.h>

#include "config.h"
#include "character/CharacterManager.h"
#include "audio/AudioRecorder.h"
#include "audio/SpeechToText.h"
#include "ai/LLMClient.h"
#include "ui/DisplayManager.h"
#include "ui/ChatUI.h"

// ── 全局模块实例 ─────────────────────────────────────────────
CharacterManager charMgr;
AudioRecorder    recorder;
SpeechToText     stt;
LLMClient        llm;
DisplayManager   display;
ChatUI*          chatUI = nullptr;

// ── 辅助函数 ─────────────────────────────────────────────────

static void connectWiFi() {
    Serial.printf("[WiFi] 正在连接 %s ...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    uint8_t attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] 已连接，IP: %s\n",
                      WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[WiFi] 连接失败！请检查 config.h 中的 WiFi 配置");
    }
}

static void showBootError(const char* msg) {
    M5.Display.fillScreen(0x000000);
    M5.Display.setTextColor(0xFF0000);
    M5.Display.setTextSize(1);
    M5.Display.setCursor(10, 10);
    M5.Display.println("启动失败:");
    M5.Display.println(msg);
}

// ── setup ────────────────────────────────────────────────────

void setup() {
    // M5Unified 初始化（自动检测 CoreS3 硬件）
    auto cfg = M5.config();
    M5.begin(cfg);

    Serial.begin(115200);
    Serial.println("\n[PopBox] 启动中...");

    // SPIFFS
    if (!SPIFFS.begin(true)) {
        showBootError("SPIFFS 初始化失败");
        return;
    }

    // 显示初始化
    display.begin();
    M5.Display.setTextColor(0xFFFFFF);
    M5.Display.setCursor(10, 10);
    M5.Display.println("PopBox 启动中...");

    // WiFi
    connectWiFi();

    // 加载角色
    if (!charMgr.loadFromSPIFFS(CHARACTER_JSON_PATH)) {
        showBootError("角色数据加载失败\n请检查 data/character.json");
        return;
    }

    // 麦克风
    if (!recorder.begin()) {
        showBootError("麦克风初始化失败");
        return;
    }

    // 初始化 UI 控制器
    chatUI = new ChatUI(charMgr, recorder, stt, llm, display);
    chatUI->begin();

    Serial.println("[PopBox] 启动完成 ✓");
}

// ── loop ─────────────────────────────────────────────────────

void loop() {
    if (chatUI) {
        chatUI->update();
    }
    // 小延迟降低 CPU 占用
    delay(10);
}
