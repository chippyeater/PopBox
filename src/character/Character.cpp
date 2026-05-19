#include "Character.h"

String Character::buildSystemPrompt() const {
    String prompt = "你是" + name + "，一个来自「星盒世界」的盲盒角色。\n";
    prompt += "性格：" + personality + "\n";
    prompt += "世界观：" + worldview + "\n";
    prompt += "背景故事：" + memory.background + "\n";

    if (!catchphrases.empty()) {
        prompt += "你的口头禅（偶尔自然地使用）：";
        for (size_t i = 0; i < catchphrases.size(); i++) {
            prompt += catchphrases[i];
            if (i < catchphrases.size() - 1) prompt += "、";
        }
        prompt += "\n";
    }

    prompt += "回复风格：" + replyStyle + "\n";
    prompt += "重要规则：只输出角色说的话，不加任何旁白或动作描写，不超过50个字。";

    // [EXTENSION POINT] FEATURE_CHARACTER_MEMORY=1 时在此注入动态记忆摘要
    // if (memory.recentTopics.size() > 0) { ... }

    return prompt;
}

String Character::randomCatchphrase() const {
    if (catchphrases.empty()) return "";
    return catchphrases[random(catchphrases.size())];
}
