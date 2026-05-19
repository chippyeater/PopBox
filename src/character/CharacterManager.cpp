#include "CharacterManager.h"
#include <ArduinoJson.h>
#include <SPIFFS.h>

bool CharacterManager::loadFromSPIFFS(const char* jsonPath) {
    if (!SPIFFS.exists(jsonPath)) {
        Serial.printf("[Character] 文件不存在: %s\n", jsonPath);
        return false;
    }

    File f = SPIFFS.open(jsonPath, "r");
    if (!f) {
        Serial.println("[Character] 无法打开角色 JSON");
        return false;
    }

    String json = f.readString();
    f.close();

    return _parseJson(json);
}

bool CharacterManager::_parseJson(const String& json) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        Serial.printf("[Character] JSON 解析失败: %s\n", err.c_str());
        return false;
    }

    _character.id          = doc["id"].as<String>();
    _character.name        = doc["name"].as<String>();
    _character.avatarPath  = doc["avatar"].as<String>();
    _character.personality = doc["personality"].as<String>();
    _character.worldview   = doc["worldview"].as<String>();
    _character.replyStyle  = doc["reply_style"].as<String>();
    _character.memory.background = doc["background"].as<String>();

    _character.catchphrases.clear();
    for (JsonVariant v : doc["catchphrases"].as<JsonArray>()) {
        _character.catchphrases.push_back(v.as<String>());
    }

    if (!_character.isValid()) {
        Serial.println("[Character] 角色数据不完整（缺少 id 或 name）");
        return false;
    }

    Serial.printf("[Character] 已加载角色: %s\n", _character.name.c_str());
    return true;
}
