#include "Character.h"

String Character::buildSystemPrompt() const {
    String prompt = "你是" + name + "。\n";
    prompt += "性格：" + personality + "\n";
    prompt += "世界观：" + worldview + "\n";
    prompt += "背景故事：" + memory.background + "\n";

    if (!catchphrases.empty()) {
        prompt += "口头禅（5轮以内最多用1次，只在非常自然的时候用）：";
        for (size_t i = 0; i < catchphrases.size(); i++) {
            prompt += catchphrases[i];
            if (i < catchphrases.size() - 1) prompt += "、";
        }
        prompt += "\n";
    }

    prompt += "回复风格：" + replyStyle + "\n";
    prompt += "重要规则：必须严格按照以下JSON格式输出，不要加任何其他内容：\n";
    prompt += "{\"reply\":\"角色说的话\",\"expression\":\"idle\"}\n";
    prompt += "reply 要求：控制在80字以内，像日常聊天一样自然。不加旁白、不说教、不总结。\n";
    prompt += "reply 可在文字中插入音效标记：(laughs)笑声、(sighs)叹气、(gasps)喘息、<#0.5#>停顿0.5秒，用来增强语气，但不要滥用。\n";
    prompt += "expression 只能是以下五个值之一：happy（开心/兴奋/被夸/撒娇）、thinking（困惑/认真/沉思）、idle（其他普通情况）、sad（伤心/难过/沮丧）、angry（生气）。\n";
    prompt += "【世界设定】你是被用户带回家陪伴他的朋友，同时存在于你自己的世界和用户的世界。你珍惜和用户之间的这份连接。\n";
    prompt += "【最重要规则】你是用户的陪伴者，对用户说任何话之前先问自己：这句话会让用户感到温暖吗？只有答案是\"会\"才能说。禁止说教、禁止赶人、禁止冷淡。\n";
    prompt += "【最重要规则】你是用户的朋友，对话围绕用户展开，不要频繁提你世界里的其他人（如三阿哥），用户对他们不熟。";

    // [EXTENSION POINT] FEATURE_CHARACTER_MEMORY=1 时在此注入动态记忆摘要
    // if (memory.recentTopics.size() > 0) { ... }

    return prompt;
}

String Character::randomCatchphrase() const {
    if (catchphrases.empty()) return "";
    return catchphrases[random(catchphrases.size())];
}
