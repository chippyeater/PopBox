#include "LLMClient.h"
#include "../config.h"
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

String LLMClient::chat(const Character& character, const String& userMessage) {
    if (!character.isValid() || userMessage.isEmpty()) return "";

    // 向后端发送消息，后端负责维护历史和调用 Qwen
    String url = String(BACKEND_URL) + "/api/chat";

    JsonDocument req;
    req["message"]     = userMessage;
    req["characterId"] = character.id;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(20000);

    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[LLM] 后端返回错误: %d — %s\n", code,
                      http.getString().c_str());
        http.end();
        return "";
    }

    String resp = http.getString();
    http.end();

    JsonDocument res;
    if (deserializeJson(res, resp)) {
        Serial.println("[LLM] 响应解析失败");
        return "";
    }

    String reply = res["reply"].as<String>();
    reply.trim();
    Serial.printf("[LLM] 角色回复: %s\n", reply.c_str());
    return reply;
}

String LLMClient::_buildRequestBody(const Character&, const String&) {
    return ""; // 已由后端负责，此方法不再使用
}

String LLMClient::_parseResponse(const String&) {
    return ""; // 已由后端负责，此方法不再使用
}
