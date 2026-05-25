#pragma once
#include <Arduino.h>
#include <vector>
#include "../ui/SpriteRenderer.h"  // SpriteColors 定义

// ─────────────────────────────────────────────────────────────
// CharacterMemory — 角色记忆层
// MVP: 仅包含静态背景故事
// [EXTENSION POINT] FEATURE_CHARACTER_MEMORY=1 时启用动态记忆
// [EXTENSION POINT] FEATURE_PHOTO_RECOGNITION=1 时加入识别来源信息
// ─────────────────────────────────────────────────────────────
struct CharacterMemory {
    String background;      // 角色基础故事/背景

    // [EXTENSION POINT] 动态对话记忆（后续实现）
    // std::vector<String> recentTopics;
    // std::vector<String> userSharedFacts;

    // [EXTENSION POINT] 从网络搜索获取的角色资料（后续实现）
    // String webSourceUrl;
    // String enrichedLore;
};

// ─────────────────────────────────────────────────────────────
// Character — 角色核心数据模型
// ─────────────────────────────────────────────────────────────
struct Character {
    String              id;
    String              name;
    String              avatarPath;
    String              voice;          // MiniMax 音色 ID
    std::vector<String> catchphrases;
    String              personality;
    String              worldview;
    String              replyStyle;
    CharacterMemory     memory;
    SpriteColors        spriteColors;  // 像素精灵专属配色（无则使用默认值）

    // [EXTENSION POINT] 角色来源标记，用于后续识别流程
    // enum class Source { MANUAL, PHOTO_RECOGNITION, IMPORTED };
    // Source source = Source::MANUAL;

    bool isValid() const { return id.length() > 0 && name.length() > 0; }

    // 构造发送给 LLM 的系统提示词
    String buildSystemPrompt() const;

    // 随机返回一句口头禅
    String randomCatchphrase() const;
};
