#include "CharacterManager.h"
#include "RecognitionClient.h"
#include "../config.h"
#include <ArduinoJson.h>
#include <SPIFFS.h>

bool CharacterManager::loadFromSPIFFS(const char* jsonPath) {
    if (!SPIFFS.exists(jsonPath)) {
        Serial.printf("[Character] 文件不存在: %s\n", jsonPath);
        return false;
    }
    File f = SPIFFS.open(jsonPath, "r");
    if (!f) { Serial.println("[Character] 无法打开角色 JSON"); return false; }
    String json = f.readString();
    f.close();
    return _parseJson(json);
}

bool CharacterManager::loadFromRecognition(const uint8_t* imageData,
                                            size_t imageLen) {
    RecognitionClient client;
    Character newChar;

    if (!client.recognize(imageData, imageLen, newChar)) {
        Serial.println("[Character] 识别失败");
        return false;
    }

    _character = newChar;

    // 保存到 SPIFFS，下次启动直接读取
    if (_saveToSPIFFS(CHARACTER_JSON_PATH)) {
        Serial.printf("[Character] 新角色已保存: %s\n", _character.name.c_str());
    }
    return true;
}

bool CharacterManager::_saveToSPIFFS(const char* jsonPath) {
    JsonDocument doc;
    doc["id"]          = _character.id;
    doc["name"]        = _character.name;
    doc["avatar"]      = _character.avatarPath;
    doc["personality"] = _character.personality;
    doc["worldview"]   = _character.worldview;
    doc["background"]  = _character.memory.background;
    doc["reply_style"] = _character.replyStyle;

    JsonArray arr = doc["catchphrases"].to<JsonArray>();
    for (const auto& cp : _character.catchphrases) arr.add(cp);

    File f = SPIFFS.open(jsonPath, "w");
    if (!f) { Serial.println("[Character] SPIFFS 写入失败"); return false; }
    serializeJson(doc, f);
    f.close();
    return true;
}

bool CharacterManager::_parseJson(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) {
        Serial.println("[Character] JSON 解析失败");
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
    for (JsonVariant v : doc["catchphrases"].as<JsonArray>())
        _character.catchphrases.push_back(v.as<String>());

    if (!_character.isValid()) {
        Serial.println("[Character] 角色数据不完整");
        return false;
    }
    Serial.printf("[Character] 已加载角色: %s\n", _character.name.c_str());
    return true;
}
