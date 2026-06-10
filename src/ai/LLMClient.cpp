#include "LLMClient.h"
#include "../config.h"
#include "../net/BackendResolver.h"
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

    String url = BackendResolver::url("/api/chat");

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

    String url = BackendResolver::url("/api/group-chat");

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

DebateStartResponse LLMClient::startDebate(const Character& red,
                                           const Character& blue,
                                           const String& topic) {
    DebateStartResponse out;
    if (!red.isValid() || !blue.isValid() || topic.isEmpty()) return out;
    if (!_ensureWiFi()) return out;

    JsonDocument req;
    req["redId"] = red.id;
    req["blueId"] = blue.id;
    req["topic"] = topic;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    http.begin(BackendResolver::url("/api/debate/start"));
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(15000);
    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[LLM] Debate start backend error: %d - %s\n",
                      code, http.getString().c_str());
        http.end();
        return out;
    }

    JsonDocument res;
    DeserializationError err = deserializeJson(res, http.getStream());
    http.end();
    if (err) {
        Serial.printf("[LLM] Debate start JSON parse failed: %s\n", err.c_str());
        return out;
    }

    out.ok = true;
    out.sessionId = res["sessionId"].as<String>();
    out.speaker = res["speaker"] | String("red");
    out.score = res["score"] | 50;
    out.durationSec = res["durationSec"] | 60;
    return out;
}

DebateTurnResponse LLMClient::nextDebateTurn(const String& sessionId,
                                             const String& event) {
    DebateTurnResponse out;
    if (sessionId.isEmpty()) return out;
    if (!_ensureWiFi()) return out;

    JsonDocument req;
    req["sessionId"] = sessionId;
    req["event"] = event;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    http.begin(BackendResolver::url("/api/debate/turn"));
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(25000);
    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[LLM] Debate turn backend error: %d - %s\n",
                      code, http.getString().c_str());
        http.end();
        return out;
    }

    JsonDocument res;
    DeserializationError err = deserializeJson(res, http.getStream());
    http.end();
    if (err) {
        Serial.printf("[LLM] Debate turn JSON parse failed: %s\n", err.c_str());
        return out;
    }

    out.ok = true;
    out.speaker = res["speaker"] | String("red");
    out.text = res["text"].as<String>();
    out.text.trim();
    out.redReaction = res["redReaction"] | String("silent");
    out.blueReaction = res["blueReaction"] | String("speechless");
    out.score = res["score"] | 50;
    out.winner = res["winner"] | String("");
    return out;
}

String LLMClient::_buildRequestBody(const Character&, const String&) {
    return ""; // 已由后端负责，此方法不再使用
}

String LLMClient::_parseResponse(const String&) {
    return ""; // 已由后端负责，此方法不再使用
}
