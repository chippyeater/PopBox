#include "SpeechToText.h"
#include "../config.h"
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

String SpeechToText::recognize(const int16_t* pcmData, size_t sampleCount,
                                int sampleRate) {
    if (!pcmData || sampleCount == 0) return "";

    // 向后端发送原始 PCM 二进制（后端负责调用 Google STT）
    // 比在设备端 base64 编码更省内存，请求体更小
    String url = String(BACKEND_URL) + "/api/stt";

    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "application/octet-stream");
    http.addHeader("X-Sample-Rate", String(sampleRate));
    http.setTimeout(15000);

    size_t byteLen = sampleCount * sizeof(int16_t);
    int code = http.POST((uint8_t*)pcmData, byteLen);

    if (code != 200) {
        Serial.printf("[STT] 后端返回错误: %d — %s\n", code,
                      http.getString().c_str());
        http.end();
        return "";
    }

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

// base64 方法保留供后续直接调用 STT API 备用
String SpeechToText::_base64Encode(const uint8_t* data, size_t len) {
    // 现已通过后端代理，此方法暂不使用
    (void)data; (void)len;
    return "";
}
