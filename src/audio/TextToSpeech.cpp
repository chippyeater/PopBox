#include "TextToSpeech.h"
#include "../config.h"
#include <WiFi.h>
#include <M5Unified.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// 检查 WiFi 状态并尝试重连
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

    // CoreS3 AW88298 功放通过 I2C 控制。
    // M5.Mic.end() 可能污染 I2C 总线，先恢复再初始化扬声器。
    M5.In_I2C.begin();
    delay(50);
    if (!M5.Speaker.begin()) {
        Serial.println("[TTS] M5.Speaker.begin() 失败");
        free(audio);
        return false;
    }
    M5.Speaker.setVolume(255);

    // 用非阻塞方式播放，手动控制等待时间
    //（CoreS3 上 waitComplete=true 不阻塞）
    if (!M5.Speaker.playWav(audio, received, 24000, 1, false)) {
        Serial.println("[TTS] playWav 失败");
        M5.Speaker.end();
        free(audio);
        return false;
    }

    // 计算音频时长（16-bit mono WAV）并等待播放完成
    unsigned long audioMs = (unsigned long)received / 48;  // bytes / (24000*2/1000)
    Serial.printf("[TTS] 播放中: %u 字节 ≈ %lu ms\n", (unsigned)received, audioMs);
    unsigned long tStart = millis();
    while (M5.Speaker.isPlaying(0) && millis() - tStart < audioMs + 1000) {
        M5.update();
        delay(10);
    }
    Serial.printf("[TTS] 播放完成, 实际等待 %lu ms\n", millis() - tStart);

    M5.Speaker.end();
    free(audio);
    return true;
}
