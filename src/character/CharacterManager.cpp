#include "CharacterManager.h"
#include "RecognitionClient.h"
#include "../config.h"
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <WiFiClient.h>
#include <HTTPClient.h>

// URL 编码（用于含中文的字符 ID → URL 路径）
static String _urlEncode(const String& s) {
    String out;
    out.reserve(s.length() * 3);
    for (size_t i = 0; i < s.length(); i++) {
        char c = s[i];
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            out += c;
        } else {
            char buf[4];
            snprintf(buf, sizeof(buf), "%%%02X", (unsigned char)c);
            out += buf;
        }
    }
    return out;
}

static const char* OFFLINE_CACHE_PATH = "/characters.json";

// 中文名头像路径 → ASCII 别名映射（ESP32 HTTPClient 对百分号编码的中文路径支持不佳）
static const char* _asciiFallback(const String& path) {
    struct { const char* cn; const char* ascii; } map[] = {
        { "/avatars/斯蒂芬·库里.jpg",        "/avatars/curry.jpg" },
        { "/avatars/斯蒂芬·库里_happy.jpg",  "/avatars/curry_happy.jpg" },
        { "/avatars/斯蒂芬·库里_sad.jpg",    "/avatars/curry_sad.jpg" },
        { "/avatars/斯蒂芬·库里_angry.jpg",  "/avatars/curry_angry.jpg" },
        { "/avatars/斯蒂芬·库里_thinking.jpg","/avatars/curry_thinking.jpg" },
    };
    for (auto& fb : map) {
        if (path == fb.cn) return fb.ascii;
    }
    return nullptr;
}

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
    _ensureAvatarFiles();  // 下载头像到 SPIFFS

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
    // 下载新角色的头像（包括表情变体）
    _ensureAvatarFiles();
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

// ── 按索引选择角色 ─────────────────────────────────────────────
const Character& CharacterManager::characterAt(int index) const {
    return _cache[index];
}

bool CharacterManager::selectCharacter(int index) {
    if (index < 0 || index >= (int)_cache.size()) return false;
    _currentIndex = index;
    _current      = _cache[_currentIndex];
    _notifyBackend(_current.id);
    Serial.printf("[Characters] 选择 → %s (%d/%d)\n",
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
    String url = String(BACKEND_URL) + "/api/characters/current/" + _urlEncode(characterId);
    HTTPClient http;
    http.begin(url);
    http.setTimeout(5000);
    // PUT with empty body
    int code = http.sendRequest("PUT", "");
    http.end();
    return code == 200;
}

// ── 双角色（群聊）模式 ──────────────────────────────────────────

bool CharacterManager::setDualMode(int idxA, int idxB) {
    if (idxA < 0 || idxA >= (int)_cache.size()) return false;
    if (idxB < 0 || idxB >= (int)_cache.size()) return false;
    if (idxA == idxB) return false;

    _currentIndex   = idxA;
    _current        = _cache[idxA];
    _secondaryIndex = idxB;
    _secondary      = _cache[idxB];

    bool ok = _notifyDualBackend(_current.id, _secondary.id);
    Serial.printf("[Characters] 群聊模式: %s + %s (后端%s)\n",
                  _current.name.c_str(), _secondary.name.c_str(),
                  ok ? "同步成功" : "同步失败");
    return true;
}

// ── 头像下载 ──────────────────────────────────────────────────────

void CharacterManager::_ensureAvatarFiles() {
    Serial.printf("[Avatar] 开始下载头像 (%d 个角色)...\n", (int)_cache.size());
    static constexpr const char* expressions[] = {"happy", "sad", "angry", "thinking"};
    int downloaded = 0, skipped = 0;

    for (const auto& ch : _cache) {
        if (ch.avatarPath.isEmpty() || ch.avatarPath == "/avatar.jpg") continue;
        if (_downloadFile(ch.avatarPath)) downloaded++;

        int dot = ch.avatarPath.lastIndexOf('.');
        if (dot < 0) continue;
        String prefix = ch.avatarPath.substring(0, dot);
        String ext    = ch.avatarPath.substring(dot);
        for (const char* expr : expressions) {
            if (_downloadFile(prefix + "_" + expr + ext)) downloaded++;
        }
    }
    Serial.printf("[Avatar] 完成: %d 个文件可用\n", downloaded);
}

bool CharacterManager::_downloadFile(const String& path) {
    if (SPIFFS.exists(path)) return true;  // 已有

    // 对路径做 URL 编码（只编码非 ASCII 字符），保证中文文件名能正确请求
    String encoded;
    for (int i = 0; i < (int)path.length(); i++) {
        char c = path[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
            || (c >= '0' && c <= '9') || c == '/' || c == '.'
            || c == '-' || c == '_' || c == '~') {
            encoded += c;
        } else {
            char hex[4];
            snprintf(hex, sizeof(hex), "%%%02X", (uint8_t)c);
            encoded += hex;
        }
    }

    String url = String(BACKEND_URL) + encoded;
    HTTPClient http;
    http.begin(url);
    http.setTimeout(5000);
    int code = http.GET();
    if (code != 200) {
        http.end();
        // 中文路径可能下载失败，尝试 ASCII 别名
        const char* fallback = _asciiFallback(path);
        if (fallback && strcmp(fallback, path.c_str()) != 0) {
            return _downloadFile(fallback);
        }
        return false;  // 404（变体不存在）或网络错误
    }

    int contentLen = http.getSize();
    if (contentLen == 0) { http.end(); return false; }

    WiFiClient* stream = http.getStreamPtr();
    File f = SPIFFS.open(path, "w");
    if (!f) { http.end(); return false; }

    uint8_t buf[256];
    size_t total = 0;
    uint32_t lastDataAt = millis();
    while (http.connected()) {
        int avail = stream->available();
        if (avail > 0) {
            int n = stream->readBytes(buf, min((size_t)avail, sizeof(buf)));
            f.write(buf, n);
            total += n;
            lastDataAt = millis();
            if (contentLen > 0 && total >= (size_t)contentLen) break;
        } else {
            if (contentLen > 0) break;       // 有 Content-Length 且无新数据
            if (millis() - lastDataAt > 5000) break;  // 未知长度超时
            delay(5);
        }
    }
    f.close();
    http.end();

    if (total == 0) return false;
    Serial.printf("[Avatar] 已下载: %s (%u 字节)\n", path.c_str(), (unsigned)total);
    return true;
}

bool CharacterManager::_notifyDualBackend(const String& id1, const String& id2) {
    String url = String(BACKEND_URL) + "/api/characters/dual/" + _urlEncode(id1) + "/" + _urlEncode(id2);
    HTTPClient http;
    http.begin(url);
    http.setTimeout(5000);
    int code = http.sendRequest("PUT", "");
    http.end();
    return code == 200;
}
