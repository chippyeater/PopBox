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

    // 按索引访问角色
    const Character& characterAt(int index) const;

    // 切换到指定索引的角色
    bool selectCharacter(int index);

    const Character& current()      const { return _current; }
    bool             hasCharacter() const { return _current.isValid(); }
    int              count()        const { return (int)_cache.size(); }
    int              currentIndex() const { return _currentIndex; }

    // ── 双角色（群聊）支持 ──────────────────────────────────────
    // 设置群聊双角色模式并通知后端
    bool setDualMode(int idxA, int idxB);
    // 获取第二个角色（必须先调用 setDualMode 或 dual setup）
    const Character& secondary() const { return _secondary; }
    bool hasSecondary() const { return _secondary.isValid(); }
    int  secondaryIndex() const { return _secondaryIndex; }

private:
    Character              _current;
    Character              _secondary;          // 群聊第二角色
    int                    _secondaryIndex = -1; // -1 = 未设置
    std::vector<Character> _cache;
    int                    _currentIndex = 0;

    bool _parseCharacter(const String& json, Character& out);
    void _saveOfflineCache();
    void _loadOfflineCache();
    bool _notifyBackend(const String& characterId);  // PUT /api/characters/current/:id
    bool _notifyDualBackend(const String& id1, const String& id2); // PUT /api/characters/dual/:id1/:id2
};
