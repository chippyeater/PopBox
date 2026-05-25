#include "CharacterManager.h"
#include "RecognitionClient.h"
#include "../config.h"
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <WiFiClient.h>
#include <HTTPClient.h>

static const char* OFFLINE_CACHE_PATH = "/characters.json";

// ── 从后端拉取全部角色 ────────────────────────────────────────
bool CharacterManager::fetchAll() {
    // 先解析主机名（最多等 5s），避免 mDNS 卡死整个启动流程
    String backendUrl = BACKEND_URL;
    {
        int slashSlash = backendUrl.indexOf("://") + 3;
        int colonOrSlash = backendUrl.indexOf(':', slashSlash);
        if (colonOrSlash < 0) colonOrSlash = backendUrl.indexOf('/', slashSlash);
        String host = backendUrl.substring(slashSlash,
                      colonOrSlash > 0 ? colonOrSlash : backendUrl.length());
        if (host.endsWith(".local")) {
            IPAddress ip;
            bool ok = (WiFi.hostByName(host.c_str(), ip) != 0);
            if (!ok) {
                Serial.printf("[Characters] mDNS 解析超时 (%s)，降级到离线缓存\n", host.c_str());
                _loadOfflineCache();
                return _current.isValid();
            }
            // 替换 hostname 为解析到的 IP
            backendUrl.replace(host, ip.toString());
            Serial.printf("[Characters] mDNS → %s\n", ip.toString().c_str());
        }
    }

    String url = backendUrl + "/api/characters";
    HTTPClient http;
    http.begin(url);
    http.setTimeout(8000);
    int code = http.GET();
    if (code != 200) {
        Serial.printf("[Characters] 拉取失败 (%d)，降级到离线缓存\n", code);
        http.end();
        _loadOfflineCache();
        return _current.isValid();
    }

    String body = http.getString();
    http.end();

    JsonDocument doc;
    if (deserializeJson(doc, body)) {
        Serial.println("[Characters] 列表解析失败");
        _loadOfflineCache();
        return _current.isValid();
    }

    _cache.clear();
    int currentIdx = 0;
    int i = 0;
    for (JsonObject obj : doc.as<JsonArray>()) {
        Character ch;
        String json;
        serializeJson(obj, json);
        if (_parseCharacter(json, ch)) {
            if (obj["isCurrent"].as<bool>()) currentIdx = i;
            _cache.push_back(ch);
            i++;
        }
    }

    if (_cache.empty()) {
        Serial.println("[Characters] 角色列表为空");
        return false;
    }

    _currentIndex = currentIdx;
    _current      = _cache[_currentIndex];
    _saveOfflineCache();

    Serial.printf("[Characters] 已加载 %d 个角色，当前: %s (%d/%d)\n",
                  (int)_cache.size(), _current.name.c_str(),
                  _currentIndex + 1, (int)_cache.size());
    return true;
}

// ── SPIFFS 单文件兜底加载（旧接口兼容）───────────────────────
bool CharacterManager::loadFromSPIFFS(const char* jsonPath) {
    if (!SPIFFS.exists(jsonPath)) return false;
    File f = SPIFFS.open(jsonPath, "r");
    if (!f) return false;
    String json = f.readString();
    f.close();
    Character ch;
    if (!_parseCharacter(json, ch)) return false;
    _cache       = { ch };
    _currentIndex = 0;
    _current      = ch;
    return true;
}

// ── 拍照识别：新角色加入收藏夹 ───────────────────────────────
bool CharacterManager::loadFromRecognition(const uint8_t* imageData,
                                            size_t imageLen) {
    RecognitionClient client;
    Character newChar;
    if (!client.recognize(imageData, imageLen, newChar)) return false;

    // 检查是否已存在（按 id 去重）
    bool found = false;
    for (int i = 0; i < (int)_cache.size(); i++) {
        if (_cache[i].id == newChar.id) {
            _cache[i]     = newChar;  // 更新已有角色
            _currentIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        _cache.push_back(newChar);
        _currentIndex = (int)_cache.size() - 1;
    }

    _current = newChar;
    _saveOfflineCache();
    _notifyBackend(newChar.id);
    Serial.printf("[Characters] 新角色: %s，收藏夹共 %d 个\n",
                  newChar.name.c_str(), (int)_cache.size());
    return true;
}

// ── 切换到下一个角色 ──────────────────────────────────────────
bool CharacterManager::switchToNext() {
    if (_cache.size() <= 1) return false;
    _currentIndex = (_currentIndex + 1) % (int)_cache.size();
    _current      = _cache[_currentIndex];
    _notifyBackend(_current.id);
    Serial.printf("[Characters] 切换 → %s (%d/%d)\n",
                  _current.name.c_str(), _currentIndex + 1, (int)_cache.size());
    return true;
}

// ── 私有方法 ──────────────────────────────────────────────────

bool CharacterManager::_parseCharacter(const String& json, Character& out) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) return false;
    out.id          = doc["id"].as<String>();
    out.name        = doc["name"].as<String>();
    out.avatarPath  = doc["avatar"]      | String("/avatar.jpg");
    out.voice       = doc["voice"]       | String("");
    out.personality = doc["personality"].as<String>();
    out.worldview   = doc["worldview"].as<String>();
    out.replyStyle  = doc["reply_style"].as<String>();
    out.memory.background = doc["background"].as<String>();
    out.catchphrases.clear();
    for (JsonVariant v : doc["catchphrases"].as<JsonArray>())
        out.catchphrases.push_back(v.as<String>());

    // 像素精灵配色（可选字段）
    if (doc["spriteColors"].is<JsonObject>()) {
        auto sc = doc["spriteColors"].as<JsonObject>();
        out.spriteColors.skin    = sc["skin"]    | String("");
        out.spriteColors.hair    = sc["hair"]    | String("");
        out.spriteColors.clothes = sc["clothes"] | String("");
        out.spriteColors.blush   = sc["blush"]   | String("");
    }
    return out.isValid();
}

void CharacterManager::_saveOfflineCache() {
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < (int)_cache.size(); i++) {
        JsonObject obj = arr.add<JsonObject>();
        const auto& ch = _cache[i];
        obj["id"]          = ch.id;
        obj["name"]        = ch.name;
        obj["avatar"]      = ch.avatarPath;
        obj["voice"]       = ch.voice;
        obj["personality"] = ch.personality;
        obj["worldview"]   = ch.worldview;
        obj["background"]  = ch.memory.background;
        obj["reply_style"] = ch.replyStyle;
        obj["isCurrent"]   = (i == _currentIndex);
        if (ch.spriteColors.hasColors()) {
            obj["spriteColors"]["skin"]    = ch.spriteColors.skin;
            obj["spriteColors"]["hair"]    = ch.spriteColors.hair;
            obj["spriteColors"]["clothes"] = ch.spriteColors.clothes;
            obj["spriteColors"]["blush"]   = ch.spriteColors.blush;
        }
        JsonArray cps = obj["catchphrases"].to<JsonArray>();
        for (const auto& cp : ch.catchphrases) cps.add(cp);
    }
    File f = SPIFFS.open(OFFLINE_CACHE_PATH, "w");
    if (f) { serializeJson(doc, f); f.close(); }
}

void CharacterManager::_loadOfflineCache() {
    if (!SPIFFS.exists(OFFLINE_CACHE_PATH)) {
        loadFromSPIFFS(CHARACTER_JSON_PATH); // 最终兜底
        return;
    }
    File f = SPIFFS.open(OFFLINE_CACHE_PATH, "r");
    if (!f) return;
    String json = f.readString();
    f.close();

    JsonDocument doc;
    if (deserializeJson(doc, json)) return;
    _cache.clear();
    int currentIdx = 0, i = 0;
    for (JsonObject obj : doc.as<JsonArray>()) {
        Character ch;
        String s; serializeJson(obj, s);
        if (_parseCharacter(s, ch)) {
            if (obj["isCurrent"].as<bool>()) currentIdx = i;
            _cache.push_back(ch);
            i++;
        }
    }
    if (!_cache.empty()) {
        _currentIndex = currentIdx;
        _current      = _cache[_currentIndex];
    }
    Serial.printf("[Characters] 离线缓存加载 %d 个角色\n", (int)_cache.size());
}

bool CharacterManager::_notifyBackend(const String& characterId) {
    String url = String(BACKEND_URL) + "/api/characters/current/" + characterId;
    HTTPClient http;
    http.begin(url);
    http.setTimeout(5000);
    // PUT with empty body
    int code = http.sendRequest("PUT", "");
    http.end();
    return code == 200;
}
