#include "RecognitionClient.h"
#include "../net/BackendResolver.h"
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

bool RecognitionClient::recognize(const uint8_t* jpegData, size_t jpegLen,
                                   Character& outCharacter) {
    if (!jpegData || jpegLen == 0) return false;

    String url = BackendResolver::url("/api/recognize");

    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "image/jpeg");
    http.setTimeout(40000);  // 识别 + 联网搜索最多 40 秒

    int code = http.POST((uint8_t*)jpegData, jpegLen);
    if (code != 200) {
        Serial.printf("[Recognition] 后端返回错误: %d — %s\n",
                      code, http.getString().c_str());
        http.end();
        return false;
    }

    String resp = http.getString();
    http.end();

    return _parseCharacterJson(resp, outCharacter);
}

bool RecognitionClient::_parseCharacterJson(const String& json,
                                             Character& out) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) {
        Serial.println("[Recognition] JSON 解析失败");
        return false;
    }

    if (doc["error"].is<const char*>()) {
        Serial.printf("[Recognition] 后端错误: %s\n",
                      doc["error"].as<const char*>());
        return false;
    }

    out.id          = doc["id"].as<String>();
    out.name        = doc["name"].as<String>();
    out.avatarPath  = doc["avatar"] | String("/avatar.jpg");
    out.voice       = doc["voice"] | String("");
    out.vol         = doc["vol"] | 1.0f;
    out.personality = doc["personality"].as<String>();
    out.worldview   = doc["worldview"].as<String>();
    out.replyStyle  = doc["reply_style"].as<String>();
    out.memory.background = doc["background"].as<String>();

    out.catchphrases.clear();
    for (JsonVariant v : doc["catchphrases"].as<JsonArray>()) {
        out.catchphrases.push_back(v.as<String>());
    }

    if (!out.isValid()) {
        Serial.println("[Recognition] 返回的角色数据不完整");
        return false;
    }

    Serial.printf("[Recognition] 识别成功: %s\n", out.name.c_str());
    return true;
}
