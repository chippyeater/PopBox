#include "LLMClient.h"
#include "../config.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// 检查 WiFi 状态并尝试重连
static bool _ensureWiFi() {
    if (WiFi.status() == WL_CONNECTED) return true;
    Serial.printf("[LLM] WiFi 已断开（状态 %d），尝试重连 %s ...\n",
                  (int)WiFi.status(), WIFI_SSID);
    WiFi.reconnect();
    for (int i = 0; i < 20; i++) {
        ::delay(500);
        if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("[LLM] WiFi 重连成功，IP: %s\n",
                          WiFi.localIP().toString().c_str());
            return true;
        }
    }
    Serial.println("[LLM] WiFi 重连失败");
    return false;
}

LLMResponse LLMClient::chat(const Character& character, const String& userMessage) {
    LLMResponse resp;
    if (!character.isValid() || userMessage.isEmpty()) return resp;
    if (!_ensureWiFi()) return resp;

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
        return resp;
    }

    // 直接从 HTTP 流解析 JSON，避免 getString() 在 chunked 编码下读不完整
    JsonDocument res;
    DeserializationError err = deserializeJson(res, http.getStream());
    http.end();

    if (err) {
        Serial.printf("[LLM] JSON解析失败: %s\n", err.c_str());
        return resp;
    }

    resp.reply = res["reply"].as<String>();
    resp.reply.trim();

    resp.expression = res["expression"].as<String>();
    resp.expression.toLowerCase();
    if (resp.expression != "happy" && resp.expression != "thinking" &&
        resp.expression != "sad"   && resp.expression != "angry") {
        resp.expression = "idle";
    }

    Serial.printf("[LLM] 角色回复: %s [表情: %s]\n", resp.reply.c_str(), resp.expression.c_str());
    return resp;
}

// ── 双角色群聊 ────────────────────────────────────────────────
std::vector<GroupReply> LLMClient::groupChat(const Character& charA,
                                              const Character& charB,
                                              const String& userMessage) {
    std::vector<GroupReply> replies;
    if (!charA.isValid() || !charB.isValid() || userMessage.isEmpty()) return replies;
    if (!_ensureWiFi()) return replies;

    String url = String(BACKEND_URL) + "/api/group-chat";

    JsonDocument req;
    req["message"] = userMessage;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(25000);

    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[LLM] GroupChat 后端返回错误: %d\n", code);
        http.end();
        return replies;
    }

    JsonDocument res;
    DeserializationError err = deserializeJson(res, http.getStream());
    http.end();

    if (err) {
        Serial.printf("[LLM] GroupChat JSON解析失败: %s\n", err.c_str());
        return replies;
    }

    JsonArray arr = res["replies"].as<JsonArray>();
    for (JsonObject r : arr) {
        GroupReply gr;
        gr.characterId = r["characterId"].as<String>();
        gr.name        = r["name"].as<String>();
        gr.reply       = r["reply"].as<String>();
        gr.reply.trim();
        gr.expression  = r["expression"].as<String>();
        gr.expression.toLowerCase();
        if (gr.expression != "happy" && gr.expression != "thinking" &&
            gr.expression != "sad"   && gr.expression != "angry") {
            gr.expression = "idle";
        }
        if (gr.reply.length() > 0) {
            replies.push_back(gr);
        }
    }

    Serial.printf("[LLM] GroupChat 收到 %d 条回复\n", (int)replies.size());
    for (const auto& r : replies) {
        Serial.printf("  [%s] %s [%s]\n", r.name.c_str(), r.reply.c_str(), r.expression.c_str());
    }
    return replies;
}

String LLMClient::_buildRequestBody(const Character&, const String&) {
    return ""; // 已由后端负责，此方法不再使用
}

String LLMClient::_parseResponse(const String&) {
    return ""; // 已由后端负责，此方法不再使用
}
