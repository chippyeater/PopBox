#include "SpeechToText.h"
#include "../config.h"
#include "../net/BackendResolver.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// 检查 WiFi 状态并尝试重连，返回 true 表示已连接
static bool _ensureWiFi() {
    if (WiFi.status() == WL_CONNECTED) return true;
    Serial.printf("[STT] WiFi 已断开（状态 %d），尝试重连 %s ...\n",
                  (int)WiFi.status(), WIFI_SSID);
    WiFi.reconnect();
    for (int i = 0; i < 20; i++) {
        ::delay(500);
        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("[STT] WiFi 重连成功，IP: %s\n",
                          WiFi.localIP().toString().c_str());
            return true;
        }
    }
    Serial.println("[STT] WiFi 重连失败");
    return false;
}

String SpeechToText::recognize(const int16_t* pcmData, size_t sampleCount,
                                int sampleRate) {
    if (!pcmData || sampleCount == 0) return "";
    if (!_ensureWiFi()) return "";

    size_t byteLen = sampleCount * sizeof(int16_t);

    for (int attempt = 0; attempt < 2; ++attempt) {
        String url = BackendResolver::url("/api/stt");
        Serial.printf("[STT] 请求后端: %s (%u bytes)\n",
                      url.c_str(), (unsigned)byteLen);

        HTTPClient http;
        http.begin(url);
        http.addHeader("Content-Type", "application/octet-stream");
        http.addHeader("X-Sample-Rate", String(sampleRate));
        http.setTimeout(35000);

        int code = http.POST((uint8_t*)pcmData, byteLen);

        if (code == 200) {
            String resp = http.getString();
            http.end();

            JsonDocument doc;
            if (deserializeJson(doc, resp)) {
                Serial.println("[STT] 响应解析失败");
                return "";
            }

            String transcript = doc["transcript"].as<String>();
            Serial.printf("[STT] 识别结果: %s\n", transcript.c_str());
            return transcript;
        }

        String err = http.getString();
        Serial.printf("[STT] 后端返回错误: %d — %s\n", code, err.c_str());
        http.end();

        if (attempt == 0 && code < 0) {
            Serial.println("[STT] 连接失败，重置后端发现并重试一次");
            BackendResolver::reset();
            BackendResolver::resolve(5000);
            continue;
        }
        return "";
    }

    return "";
}

// base64 方法保留供后续直接调用 STT API 备用
String SpeechToText::_base64Encode(const uint8_t* data, size_t len) {
    // 现已通过后端代理，此方法暂不使用
    (void)data; (void)len;
    return "";
}
