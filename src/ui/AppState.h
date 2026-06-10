#pragma once

// ─────────────────────────────────────────────────────────────
// PopBox 硬件界面状态
// ─────────────────────────────────────────────────────────────
enum class AppState {
    MODE_SELECT,        // 模式选择：日常群聊 / 辩论模式
    DAILY_INVITE,       // 日常群聊邀请入群：识别红蓝双方
    DAILY_STAGE,        // 日常群聊舞台 UI：只显示状态，不显示文本
    DEBATE_ENTRY,       // 辩论选手入场：识别红蓝双方
    DEBATE_TOPIC,       // 辩题采集：监听用户说出今日辩题
    DEBATE_READY,       // 辩题已识别，等待开始
    DEBATE_TURN,        // 辩论回合：角色发言 / 倒计时 / 进度条
    DEBATE_BOOM,        // 爆灯反馈
    DEBATE_RESULT,      // 胜利结算
    NO_CHARACTER,       // 无人入住：全屏"等待人物入住" → 点击进入选择
    CHARACTER_SELECT,   // 角色选择：展示所有角色卡片
    CHARACTER_COUNT,    // 角色数量选择：选择1人或2人入住
    RECOGNIZING,        // 识别中：文字 + 进度条
    GREETING,           // 打招呼：左半精灵+名字 / 右半招呼语
    CHATTING,           // 交流中：左半精灵+名字 / 右半角色说话
    IDLE,               // 待机：全屏精灵+名字
    PHYSICAL,           // 物理交互：特殊像素反馈
};
