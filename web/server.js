require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 加载角色 JSON（从硬件版复用） ────────────────────────────
const CHARACTER_PATH = path.join(__dirname, '../data/character.json');
let character = null;
try {
    character = JSON.parse(fs.readFileSync(CHARACTER_PATH, 'utf-8'));
    console.log(`[PopBox] 已加载角色: ${character.name}`);
} catch (e) {
    console.warn('[PopBox] 未找到 data/character.json，使用内置默认角色');
    character = {
        id: 'xiao_ling', name: '小铃',
        catchphrases: ['哎呀～', '真的假的！', '这个嘛……'],
        personality: '活泼好奇，有点迷糊但内心温暖',
        worldview: '来自「星盒世界」，相信每件物品都有自己的灵魂',
        background: '某个下雨天被装进盲盒，睡了很久直到被你打开',
        reply_style: '简短口语化，50字以内，偶尔用口头禅'
    };
}

// ── 构建系统提示词（与硬件版逻辑一致） ──────────────────────
function buildSystemPrompt(ch) {
    let p = `你是${ch.name}，一个来自「星盒世界」的盲盒角色。\n`;
    p += `性格：${ch.personality}\n`;
    p += `世界观：${ch.worldview}\n`;
    p += `背景故事：${ch.background}\n`;
    if (ch.catchphrases?.length) {
        p += `口头禅（偶尔自然使用）：${ch.catchphrases.join('、')}\n`;
    }
    p += `回复风格：${ch.reply_style}\n`;
    p += '重要规则：只输出角色说的话，不加旁白，不超过50个字。';
    return p;
}

// ── API: 获取角色信息（供前端显示） ─────────────────────────
app.get('/api/character', (req, res) => {
    res.json({
        name:        character.name,
        catchphrases: character.catchphrases,
        avatarUrl:   '/avatar.jpg'   // 对应 public/avatar.jpg
    });
});

// ── API: 发送消息给角色 ──────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message?.trim()) {
        return res.status(400).json({ error: '消息不能为空' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
        return res.status(500).json({
            error: 'Gemini API Key 未配置，请编辑 web/.env 文件'
        });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
        system_instruction: {
            parts: [{ text: buildSystemPrompt(character) }]
        },
        contents: [
            { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: {
            maxOutputTokens: 80,
            temperature: 0.85
        }
        // [EXTENSION POINT] 后续加入多轮对话 history
    };

    try {
        // Node 18+ 内置 fetch；如使用更低版本可改为 https.request
        const response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[LLM] API 错误:', errText);
            return res.status(502).json({ error: `Gemini 返回错误: ${response.status}` });
        }

        const data  = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        console.log(`[Chat] 用户: ${message} | 小铃: ${reply}`);
        res.json({ reply });

    } catch (err) {
        console.error('[LLM] 请求失败:', err.message);
        res.status(500).json({ error: '网络请求失败，请检查网络连接' });
    }
});

app.listen(PORT, () => {
    console.log(`\n🎁 PopBox 网页模拟器已启动`);
    console.log(`   打开浏览器访问: http://localhost:${PORT}\n`);
});
