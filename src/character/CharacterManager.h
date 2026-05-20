#pragma once
#include "Character.h"
#include <vector>

// ─────────────────────────────────────────────────────────────
// CharacterManager — 角色加载、收藏夹管理和切换
//
// 角色来源：
//   1. 启动时从后端 /api/characters 拉取全部角色到内存
//   2. 无后端时从 SPIFFS /characters.json 加载（离线兜底）
//   3. 拍照识别 → 后端添加新角色 → 本地同步
//
// 切换：
//   switchToNext()  — 循环切换下一个
//   switchToId(id)  — 切换到指定 id（同步告知后端）
// ─────────────────────────────────────────────────────────────
class CharacterManager {
public:
    // 从后端拉取角色列表并缓存（启动时调用）
    // 失败时自动降级到 SPIFFS 离线缓存
    bool fetchAll();

    // 从 SPIFFS 单文件加载（兜底）
    bool loadFromSPIFFS(const char* jsonPath);

    // 拍照识别后加载新角色（自动加入收藏夹 + 设为当前）
    bool loadFromRecognition(const uint8_t* imageData, size_t imageLen);

    // 切换到下一个角色（循环）
    bool switchToNext();

    const Character& current()      const { return _current; }
    bool             hasCharacter() const { return _current.isValid(); }
    int              count()        const { return (int)_cache.size(); }
    int              currentIndex() const { return _currentIndex; }

private:
    Character              _current;
    std::vector<Character> _cache;
    int                    _currentIndex = 0;

    bool _parseCharacter(const String& json, Character& out);
    void _saveOfflineCache();
    void _loadOfflineCache();
    bool _notifyBackend(const String& characterId);  // PUT /api/characters/current/:id
};
