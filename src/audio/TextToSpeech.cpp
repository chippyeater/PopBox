#include "TextToSpeech.h"
#include "../config.h"
#include <WiFi.h>
#include <M5Unified.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── CoreS3 扬声器硬件直接控制（AW88298 + AW9523）───────────────
// M5Unified 的 _speaker_enabled_cb_cores3 不会设置 AW9523 GPIO 方向寄存器
// （复位后默认全为输入），导致 SPK_EN 无法真正拉高，功放不被供电。
// 这里直接操作 I2C 寄存器确保硬件正确初始化。

static constexpr uint8_t AW88298_ADDR = 0x36;
static constexpr uint8_t AW9523_ADDR  = 0x58;

static void _aw88298_write(uint8_t reg, uint16_t value) {
    value = __builtin_bswap16(value);
    bool ok = M5.In_I2C.writeRegister(AW88298_ADDR, reg, (const uint8_t*)&value, 2, 400000);
    if (!ok) Serial.printf("[TTS] AW88298[0x%02X] I2C FAIL\n", reg);
}

static void _speaker_hw_enable() {
    // 1. AW9523 P0_2 设为输出（清除配置寄存器 0x04 bit 2）
    M5.In_I2C.bitOff(AW9523_ADDR, 0x04, 0b00000100, 400000);

    // 2. AW9523 P0_2 拉高 → SPK_EN 使能功放供电
    M5.In_I2C.bitOn(AW9523_ADDR, 0x02, 0b00000100, 400000);

    // 3. AW88298 放大器寄存器配置
    _aw88298_write(0x61, 0x0673);  // boost disabled
    _aw88298_write(0x04, 0x4040);  // I2SEN=1, AMPPD=0, PWDN=0
    _aw88298_write(0x05, 0x0008);  // RMSE=0, HAGCE=0, HDCCE=0, HMUTE=0
    // rate_tbl[] = {4,5,6,8,10,11,15,20,22,44}, rate=(24000+1102)/2205=11 → idx=5
    _aw88298_write(0x06, 0x14C5);
    _aw88298_write(0x0C, 0x0064);  // volume 100
}

static void _speaker_hw_disable() {
    _aw88298_write(0x04, 0x4000);  // I2SEN=0, power down
}

// ── WiFi ──────────────────────────────────────────────────────

static bool _ensureWiFi() {
    if (WiFi.status() == WL_CONNECTED) return true;
    Serial.printf("[TTS] WiFi 已断开（状态 %d），尝试重连 %s ...\n",
                  (int)WiFi.status(), WIFI_SSID);
    WiFi.reconnect();
    for (int i = 0; i < 20; i++) {
        ::delay(500);
        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("[TTS] WiFi 重连成功，IP: %s\n",
                          WiFi.localIP().toString().c_str());
            return true;
        }
    }
    Serial.println("[TTS] WiFi 重连失败");
    return false;
}

static uint8_t* allocAudioBuffer(size_t len) {
    uint8_t* p = (uint8_t*)heap_caps_malloc(len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!p) p = (uint8_t*)malloc(len);
    return p;
}

bool TextToSpeech::speak(const String& text, const String& voice) {
    if (text.isEmpty()) return false;
    if (!_ensureWiFi()) return false;

    JsonDocument req;
    req["text"] = text;
    if (voice.length() > 0) req["voice"] = voice;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    http.begin(String(BACKEND_URL) + "/api/tts");
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(30000);

    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[TTS] backend error: %d - %s\n", code, http.getString().c_str());
        http.end();
        return false;
    }

    int contentLen = http.getSize();
    const size_t MAX_AUDIO_BYTES = 1536 * 1024;
    if (contentLen > 0 && (size_t)contentLen > MAX_AUDIO_BYTES) {
        Serial.printf("[TTS] audio too large: %d bytes\n", contentLen);
        http.end();
        return false;
    }

    uint8_t* audio = allocAudioBuffer(MAX_AUDIO_BYTES);
    if (!audio) {
        Serial.println("[TTS] audio buffer allocation failed");
        http.end();
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();
    size_t received = 0;
    uint32_t lastDataAt = millis();
    while (http.connected() && received < MAX_AUDIO_BYTES) {
        int avail = stream->available();
        if (avail > 0) {
            size_t toRead = min((size_t)avail, MAX_AUDIO_BYTES - received);
            int n = stream->readBytes(audio + received, toRead);
            if (n > 0) {
                received += n;
                lastDataAt = millis();
            }
            if (contentLen > 0 && received >= (size_t)contentLen) break;
        } else {
            if (contentLen > 0 && received >= (size_t)contentLen) break;
            if (millis() - lastDataAt > 5000) break;
            delay(10);
        }
    }
    http.end();

    if (received < 44 || memcmp(audio, "RIFF", 4) != 0) {
        Serial.printf("[TTS] invalid WAV, bytes=%u header=%02X %02X %02X %02X\n",
                      (unsigned)received, audio[0], audio[1], audio[2], audio[3]);
        free(audio);
        return false;
    }

    // ── 扬声器硬件初始化 ──
    _speaker_hw_enable();
    M5.Speaker.end();
    delay(20);
    M5.Speaker.begin();
    M5.Speaker.setVolume(200);

    if (!M5.Speaker.playWav(audio, received, 1, 0, false)) {
        Serial.println("[TTS] playWav 失败");
        M5.Speaker.end();
        free(audio);
        return false;
    }

    // 等待播放完成
    unsigned long audioMs = (unsigned long)received / 48;
    Serial.printf("[TTS] 播放中: %u 字节 ≈ %lu ms\n", (unsigned)received, audioMs);
    unsigned long tStart = millis();
    while (M5.Speaker.isPlaying(0) && millis() - tStart < audioMs + 1000) {
        M5.update();
        delay(10);
    }
    Serial.printf("[TTS] 播放完成, 实际等待 %lu ms\n", millis() - tStart);

    M5.Speaker.end();
    _speaker_hw_disable();
    free(audio);
    return true;
}
