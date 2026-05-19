#include "SpeechToText.h"
#include "../config.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <mbedtls/base64.h>

String SpeechToText::recognize(const int16_t* pcmData, size_t sampleCount,
                                int sampleRate) {
    if (!pcmData || sampleCount == 0) return "";

    // 将 PCM16 编码为 base64
    size_t byteLen = sampleCount * sizeof(int16_t);
    String audioB64 = _base64Encode((const uint8_t*)pcmData, byteLen);
    if (audioB64.isEmpty()) {
        Serial.println("[STT] base64 编码失败");
        return "";
    }

    // 构建请求 JSON
    JsonDocument req;
    req["config"]["encoding"]        = "LINEAR16";
    req["config"]["sampleRateHertz"] = sampleRate;
    req["config"]["languageCode"]    = STT_LANGUAGE_CODE;
    req["audio"]["content"]          = audioB64;

    String body;
    serializeJson(req, body);

    // HTTPS 请求
    String url = "https://speech.googleapis.com/v1/speech:recognize?key=";
    url += GOOGLE_STT_API_KEY;

    WiFiClientSecure client;
    client.setInsecure(); // MVP：跳过证书验证
    HTTPClient https;
    https.begin(client, url);
    https.addHeader("Content-Type", "application/json");
    https.setTimeout(15000);

    int code = https.POST(body);
    if (code != 200) {
        Serial.printf("[STT] HTTP 错误: %d\n", code);
        https.end();
        return "";
    }

    String resp = https.getString();
    https.end();

    // 解析响应
    JsonDocument res;
    if (deserializeJson(res, resp)) {
        Serial.println("[STT] 响应解析失败");
        return "";
    }

    // 取第一个候选结果
    String text = res["results"][0]["alternatives"][0]["transcript"]
                      .as<String>();
    Serial.printf("[STT] 识别结果: %s\n", text.c_str());
    return text;
}

String SpeechToText::_base64Encode(const uint8_t* data, size_t len) {
    size_t encodedLen = ((len + 2) / 3) * 4 + 1;

    // 分配到 PSRAM（音频数据可能较大）
    uint8_t* buf = (uint8_t*)heap_caps_malloc(
        encodedLen, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    );
    if (!buf) buf = (uint8_t*)malloc(encodedLen);
    if (!buf) return "";

    size_t olen = 0;
    mbedtls_base64_encode(buf, encodedLen, &olen, data, len);
    buf[olen] = '\0';

    String result = String((char*)buf);
    free(buf);
    return result;
}
