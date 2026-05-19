#pragma once
#include "Character.h"

// ─────────────────────────────────────────────────────────────
// CharacterManager — 角色加载与管理
//
// MVP: 从 SPIFFS 的 character.json 加载单个角色
//
// [EXTENSION POINT] 后续扩展入口：
//   loadFromRecognition(imagePath) — 拍照 → 云端识别 → 填充角色
//   enrichFromWeb(character)       — 网络搜索 → 丰富角色故事
//   switchCharacter(id)            — 多角色切换
// ─────────────────────────────────────────────────────────────
class CharacterManager {
public:
    // 从 SPIFFS JSON 加载角色，失败返回 false
    bool loadFromSPIFFS(const char* jsonPath);

    // 返回当前角色（只读引用）
    const Character& current() const { return _character; }

    bool hasCharacter() const { return _character.isValid(); }

    // [EXTENSION POINT] 从拍照识别结果加载角色（后续实现）
    // bool loadFromRecognition(const uint8_t* imageData, size_t imageLen);

    // [EXTENSION POINT] 通过网络搜索丰富当前角色信息（后续实现）
    // bool enrichFromWeb();

private:
    Character _character;

    bool _parseJson(const String& json);
};
