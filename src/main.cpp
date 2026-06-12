#include <Arduino.h>
#include <M5Unified.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <SPIFFS.h>

#include "config.h"
#include "character/CharacterManager.h"
#include "audio/AudioRecorder.h"
#include "audio/SpeechToText.h"
#include "audio/TextToSpeech.h"
#include "ai/LLMClient.h"
#include "camera/CameraManager.h"
#include "ui/DisplayManager.h"
#include "ui/ChatUI.h"
#include "net/BackendResolver.h"

// ── 全局模块实例 ─────────────────────────────────────────────
CharacterManager charMgr;
AudioRecorder    recorder;
SpeechToText     stt;
TextToSpeech     tts;
LLMClient        llm;
CameraManager    camera;
DisplayManager   display;
ChatUI*          chatUI = nullptr;

// ── 辅助函数 ─────────────────────────────────────────────────

static void connectWiFi() {
    Serial.printf("[WiFi] 正在连接 %s ...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    uint8_t attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        ::delay(500);
        Serial.print(".");
        attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] 已连接，IP: %s\n", WiFi.localIP().toString().c_str());
        // 启用 mDNS，并通过 _http._tcp 服务发现 PopBox 后端
        if (MDNS.begin("popboxclient")) {
            Serial.println("[mDNS] 已启动，开始发现 PopBox 后端服务");
            BackendResolver::resolve();
        }
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

// ── setup ─────────────────────────────────────────────────────

void setup() {
    auto cfg = M5.config();
    M5.begin(cfg);

    Serial.begin(115200);
    Serial.println("\n[PopBox] 启动中...");

    if (!SPIFFS.begin(true)) {
        showBootError("SPIFFS 初始化失败");
        return;
    }

    display.begin();
    M5.Display.setTextColor(0xFFFFFF);
    M5.Display.setCursor(10, 10);
    M5.Display.println("PopBox 启动中...");

    // 连接 WiFi（同时解析 mDNS）
    connectWiFi();

    // 初始化爆灯按钮 & LED（GPIO 模式）
    pinMode(PIN_BTN_RED,  INPUT_PULLUP);
    pinMode(PIN_BTN_BLUE, INPUT_PULLUP);
    pinMode(PIN_LED_RED,  OUTPUT);
    pinMode(PIN_LED_BLUE, OUTPUT);
    digitalWrite(PIN_LED_RED,  LOW);
    digitalWrite(PIN_LED_BLUE, LOW);

    // 从后端拉取角色列表（自动降级到 SPIFFS 离线缓存）
    if (!charMgr.fetchAll()) {
        showBootError("角色数据加载失败\n请确认后端已启动");
        return;
    }

    // 初始化麦克风（对话录音需要）
    recorder.begin();

    // 相机延迟初始化：CoreS3 相机 I2C 初始化失败会污染 I2C 总线，
    // 导致触摸控制器失效。改为识别时按需初始化（在 ChatUI._runRecognition 中）。
    Serial.println("[PopBox] 相机将在首次识别时初始化");

    chatUI = new ChatUI(charMgr, recorder, stt, tts, llm, display, camera);
    chatUI->begin();

    Serial.println("[PopBox] 启动完成 ✓");
}

// ── 周期 WiFi 健康检查 ──────────────────────────────────────────
static uint32_t lastWifiCheck = 0;

static void checkWiFi() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.printf("[WiFi] 检测到断开, 尝试重连 %s ...\n", WIFI_SSID);
        WiFi.reconnect();
    }
}

// ── loop ──────────────────────────────────────────────────────

void loop() {
    if (chatUI) chatUI->update();
    else {
        // chatUI 未初始化：显示错误时仍需 M5.update() 防止看门狗触发
        M5.update();
    }

    // 每 5 秒检查一次 WiFi
    if (millis() - lastWifiCheck > 5000) {
        lastWifiCheck = millis();
        checkWiFi();
    }

    ::delay(10);
}
