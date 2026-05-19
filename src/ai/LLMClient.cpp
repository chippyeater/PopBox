#include "LLMClient.h"
#include "../config.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

String LLMClient::chat(const Character& character, const String& userMessage) {
    if (!character.isValid() || userMessage.isEmpty()) return "";

    String body = _buildRequestBody(character, userMessage);

    String url = "https://generativelanguage.googleapis.com/v1beta/models/";
    url += GEMINI_MODEL;
    url += ":generateContent?key=";
    url += GEMINI_API_KEY;

    WiFiClientSecure client;
    client.setInsecure(); // MVP：跳过证书验证
    HTTPClient https;
    https.begin(client, url);
    https.addHeader("Content-Type", "application/json");
    https.setTimeout(20000);

    int code = https.POST(body);
    if (code != 200) {
        Serial.printf("[LLM] HTTP 错误: %d — %s\n", code,
                      https.getString().c_str());
        https.end();
        return "";
    }

    String resp = https.getString();
    https.end();

    return _parseResponse(resp);
}

String LLMClient::_buildRequestBody(const Character& character,
                                     const String& userMessage) {
    JsonDocument doc;

    // 系统指令（角色人设 Prompt）
    doc["system_instruction"]["parts"][0]["text"] =
        character.buildSystemPrompt();

    // 用户消息
    doc["contents"][0]["role"]            = "user";
    doc["contents"][0]["parts"][0]["text"] = userMessage;

    // 生成参数
    doc["generationConfig"]["maxOutputTokens"] = LLM_MAX_OUTPUT_TOKENS;
    doc["generationConfig"]["temperature"]     = LLM_TEMPERATURE;

    // [EXTENSION POINT] FEATURE_CHARACTER_MEMORY=1 时注入历史对话
    // for (auto& turn : conversationHistory) { ... }

    String out;
    serializeJson(doc, out);
    return out;
}

String LLMClient::_parseResponse(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) {
        Serial.println("[LLM] 响应解析失败");
        return "";
    }

    String text = doc["candidates"][0]["content"]["parts"][0]["text"]
                      .as<String>();
    text.trim();
    Serial.printf("[LLM] 角色回复: %s\n", text.c_str());
    return text;
}
