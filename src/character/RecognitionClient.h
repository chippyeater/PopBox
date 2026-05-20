#pragma once
#include <Arduino.h>
#include "Character.h"

// ─────────────────────────────────────────────────────────────
// RecognitionClient — 向后端发送图片，获取识别后的角色 JSON
//
// 流程（全部在后端执行）：
//   JPEG → /api/recognize → qwen-vl-plus 识别名字
//                        → qwen-turbo + 联网搜索 → 填充人设
//                        → 返回角色 JSON
// ─────────────────────────────────────────────────────────────
class RecognitionClient {
public:
    // 发送 JPEG 图片，成功时填充 outCharacter 并返回 true
    bool recognize(const uint8_t* jpegData, size_t jpegLen,
                   Character& outCharacter);

private:
    bool _parseCharacterJson(const String& json, Character& out);
};
