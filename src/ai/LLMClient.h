#pragma once
#include <Arduino.h>
#include <vector>
#include "../character/Character.h"

// ─────────────────────────────────────────────────────────────
// LLMResponse — LLM 返回的单角色结构化数据
// ─────────────────────────────────────────────────────────────
struct LLMResponse {
    String reply;
    String expression;  // "idle" | "happy" | "thinking"
};

// ─────────────────────────────────────────────────────────────
// GroupReply — 群聊模式下单个角色的回复
// ─────────────────────────────────────────────────────────────
struct GroupReply {
    String characterId;
    String name;
    String reply;
    String expression;  // "idle" | "happy" | "thinking" | "sad" | "angry"
};

struct DebateStartResponse {
    bool ok = false;
    String sessionId;
    String speaker;  // "red" | "blue"
    int score = 50;
    int durationSec = 60;
};

struct DebateTurnResponse {
    bool ok = false;
    String speaker;       // "red" | "blue"
    String text;
    String redReaction;
    String blueReaction;
    int score = 50;       // 0=blue wins, 100=red wins
    String winner;        // "" | "red" | "blue"
};

// ─────────────────────────────────────────────────────────────
// LLMClient — 调用后端 API 生成角色回复
//
// [EXTENSION POINT] 后续可替换为 Claude / GPT 等其他 LLM
// 只需修改 _buildRequestBody() 和解析逻辑即可，接口不变
// ─────────────────────────────────────────────────────────────
class LLMClient {
public:
    // 根据角色人设和用户输入生成单角色回复
    // 失败时 reply 为空字符串
    LLMResponse chat(const Character& character, const String& userMessage);

    // 双角色群聊：一次请求生成两个角色的回复
    // 返回 vector 可能为 2~4 条，失败时为空
    std::vector<GroupReply> groupChat(const Character& charA,
                                       const Character& charB,
                                       const String& userMessage);

    DebateStartResponse startDebate(const Character& red,
                                     const Character& blue,
                                     const String& topic);
    DebateTurnResponse nextDebateTurn(const String& sessionId,
                                       const String& event = "next");

private:
    String _buildRequestBody(const Character& character,
                             const String& userMessage);
    String _parseResponse(const String& json);
};
