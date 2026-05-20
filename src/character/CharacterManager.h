#pragma once
#include "Character.h"

// ─────────────────────────────────────────────────────────────
// CharacterManager — 角色加载与管理
//
// 加载来源：
//   1. SPIFFS JSON（默认，MVP）
//   2. 拍照识别 → 后端两步识别（FEATURE_PHOTO_RECOGNITION=1）
//
// 识别流程（后端负责）：
//   Step1: qwen-vl-plus 看图 → 角色名
//   Step2: qwen-turbo + enable_search 联网搜索 → 填充人设
//   → 保存到 SPIFFS character.json 供下次启动直接加载
// ─────────────────────────────────────────────────────────────
class CharacterManager {
public:
    // 从 SPIFFS JSON 加载角色
    bool loadFromSPIFFS(const char* jsonPath);

    // 拍照识别并加载新角色（FEATURE_PHOTO_RECOGNITION=1 时可用）
    // imageData: JPEG 字节流，imageLen: 字节数
    // 成功后自动保存到 SPIFFS 并更新当前角色
    bool loadFromRecognition(const uint8_t* imageData, size_t imageLen);

    const Character& current()      const { return _character; }
    bool             hasCharacter() const { return _character.isValid(); }

    // [EXTENSION POINT] 多角色切换（后续实现）
    // bool switchCharacter(const String& id);

private:
    Character _character;

    bool _parseJson(const String& json);
    bool _saveToSPIFFS(const char* jsonPath);
};
