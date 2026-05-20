require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app  = express();
const PORT = process.env.PORT || 3000;

// 原始二进制流：PCM 音频 & JPEG 图片
// 注意：精确匹配路径，避免影响子路径（如 /api/recognize/upload）
const rawImage = express.raw({ type: ['image/jpeg', 'image/*', 'application/octet-stream'], limit: '8mb' });
app.use('/api/stt', express.raw({ type: 'application/octet-stream', limit: '4mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 目录 ─────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const CHARS_DIR = path.join(DATA_DIR, 'characters');
[DATA_DIR, CHARS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── 对话历史配置 ──────────────────────────────────────────────
const MAX_TURNS = parseInt(process.env.MAX_HISTORY_TURNS || '10');

// ── 角色库 ────────────────────────────────────────────────────
const CHARACTER_PATH = path.join(__dirname, '../data/character.json');

const characterLibrary = new Map();  // id → character object
let   currentCharacterId = null;

function getCurrentCharacter() {
    if (currentCharacterId && characterLibrary.has(currentCharacterId))
        return characterLibrary.get(currentCharacterId);
    if (characterLibrary.size > 0)
        return characterLibrary.values().next().value;
    return null;
}

function saveCharacterToLibrary(charObj) {
    if (!charObj?.id) return;
    characterLibrary.set(charObj.id, charObj);
    try {
        fs.writeFileSync(
            path.join(CHARS_DIR, `${charObj.id}.json`),
            JSON.stringify(charObj, null, 2), 'utf-8'
        );
    } catch (e) { console.warn('[Characters] 保存失败:', e.message); }
}

function setCurrentCharacter(id) {
    if (!characterLibrary.has(id)) return false;
    currentCharacterId = id;
    // 同步 hardware 兼容的 character.json
    try { fs.writeFileSync(CHARACTER_PATH, JSON.stringify(characterLibrary.get(id), null, 2), 'utf-8'); } catch {}
    try { fs.writeFileSync(path.join(DATA_DIR, 'current.json'), JSON.stringify({ id }, null, 2), 'utf-8'); } catch {}
    console.log(`[Characters] 当前角色 → ${characterLibrary.get(id).name}`);
    return true;
}

function loadCharacterLibrary() {
    // 加载所有已保存角色
    const files = fs.readdirSync(CHARS_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
        try {
            const obj = JSON.parse(fs.readFileSync(path.join(CHARS_DIR, f), 'utf-8'));
            if (obj.id) characterLibrary.set(obj.id, obj);
        } catch {}
    }

    // 如果角色库为空，从 character.json 迁移默认角色
    if (characterLibrary.size === 0) {
        let defaultChar = null;
        try { defaultChar = JSON.parse(fs.readFileSync(CHARACTER_PATH, 'utf-8')); } catch {}
        if (!defaultChar) {
            defaultChar = {
                id: 'xiao_ling', name: '小铃',
                catchphrases: ['哎呀～', '真的假的！', '这个嘛……'],
                personality:  '活泼好奇，有点迷糊但内心温暖',
                worldview:    '来自「星盒世界」，相信每件物品都有自己的灵魂',
                background:   '某个下雨天被装进盲盒，睡了很久直到被你打开',
                reply_style:  '简短口语化，50字以内，偶尔用口头禅'
            };
        }
        saveCharacterToLibrary(defaultChar);
    }

    // 恢复上次的当前角色
    try {
        const cur = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'current.json'), 'utf-8'));
        if (cur.id && characterLibrary.has(cur.id)) currentCharacterId = cur.id;
    } catch {}
    if (!currentCharacterId) currentCharacterId = characterLibrary.keys().next().value;

    console.log(`[Characters] 已加载 ${characterLibrary.size} 个角色，当前: ${getCurrentCharacter()?.name}`);
}

// 兼容旧变量名
let character = null; // 在 loadCharacterLibrary 后通过 getCurrentCharacter() 使用

// ── 系统提示词 ────────────────────────────────────────────────
function buildSystemPrompt(ch) {
    let p = `你是${ch.name}，一个来自「星盒世界」的盲盒角色。\n`;
    p += `性格：${ch.personality}\n`;
    p += `世界观：${ch.worldview}\n`;
    p += `背景故事：${ch.background}\n`;
    if (ch.catchphrases?.length) {
        p += `口头禅（偶尔自然使用）：${ch.catchphrases.join('、')}\n`;
    }
    p += `回复风格：${ch.reply_style}\n`;
    p += '重要规则：必须严格按照以下JSON格式输出，不要加任何其他内容：\n';
    p += '{"reply":"角色说的话（不超过50字，不加旁白）","expression":"idle"}\n';
    p += 'expression 只能是以下三个值之一：happy（开心/兴奋/被夸/撒娇）、thinking（困惑/认真/沉思）、idle（其他普通情况）。';
    return p;
}

// ══════════════════════════════════════════════════════════════
// 对话历史管理
// ══════════════════════════════════════════════════════════════

// 内存缓存
const historyCache = {};

function historyFile(characterId) {
    return path.join(DATA_DIR, `history_${characterId}.json`);
}

// 启动时从文件加载所有历史
function loadAllHistory() {
    try {
        const files = fs.readdirSync(DATA_DIR)
            .filter(f => f.startsWith('history_') && f.endsWith('.json'));
        for (const f of files) {
            const id = f.replace('history_', '').replace('.json', '');
            const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
            historyCache[id] = JSON.parse(raw);
            console.log(`[History] 已加载 ${id}：${historyCache[id].length} 条消息`);
        }
    } catch (e) {
        console.warn('[History] 加载历史失败:', e.message);
    }
}

function saveHistory(characterId) {
    try {
        fs.writeFileSync(
            historyFile(characterId),
            JSON.stringify(historyCache[characterId] || [], null, 2),
            'utf-8'
        );
    } catch (e) {
        console.error('[History] 保存失败:', e.message);
    }
}

function getHistory(characterId) {
    if (!historyCache[characterId]) historyCache[characterId] = [];
    return historyCache[characterId];
}

// 追加一轮对话（user + assistant），超出 MAX_TURNS 时丢弃最旧一轮
function appendTurn(characterId, userMsg, assistantMsg) {
    const hist = getHistory(characterId);
    hist.push({ role: 'user',      content: userMsg,      ts: Date.now() });
    hist.push({ role: 'assistant', content: assistantMsg, ts: Date.now() });
    // 一轮 = 2 条消息
    while (hist.length > MAX_TURNS * 2) hist.splice(0, 2);
    saveHistory(characterId);
}

loadAllHistory();
loadCharacterLibrary();

// ══════════════════════════════════════════════════════════════
// API 路由
// ══════════════════════════════════════════════════════════════

// ── GET /api/character（当前角色，向下兼容）───────────────────
app.get('/api/character', (req, res) => {
    const ch = getCurrentCharacter();
    res.json({ id: ch?.id, name: ch?.name, avatarUrl: '/avatar.jpg' });
});

// ── GET /api/characters（角色收藏夹列表）─────────────────────
app.get('/api/characters', (req, res) => {
    const list = Array.from(characterLibrary.values()).map(ch => ({
        ...ch,
        isCurrent: ch.id === currentCharacterId
    }));
    res.json(list);
});

// ── PUT /api/characters/current/:id（切换当前角色）───────────
app.put('/api/characters/current/:id', (req, res) => {
    const { id } = req.params;
    if (!setCurrentCharacter(id)) {
        return res.status(404).json({ error: `角色 ${id} 不存在` });
    }
    res.json({ ok: true, current: getCurrentCharacter() });
});

// ── DELETE /api/characters/:id（删除角色）────────────────────
app.delete('/api/characters/:id', (req, res) => {
    const { id } = req.params;
    if (!characterLibrary.has(id)) return res.status(404).json({ error: '角色不存在' });
    if (characterLibrary.size <= 1) return res.status(400).json({ error: '至少保留一个角色' });

    characterLibrary.delete(id);
    try { fs.unlinkSync(path.join(CHARS_DIR, `${id}.json`)); } catch {}

    // 如果删的是当前角色，切换到第一个
    if (id === currentCharacterId) {
        currentCharacterId = characterLibrary.keys().next().value;
        setCurrentCharacter(currentCharacterId);
    }
    console.log(`[Characters] 已删除: ${id}`);
    res.json({ ok: true });
});

// ── POST /api/stt — 硬件专用，接收原始 PCM 音频 ──────────────
// Content-Type: application/octet-stream
// Header: X-Sample-Rate: 16000
app.post('/api/stt', async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: '未收到音频数据' });
    }

    const apiKey    = process.env.GOOGLE_STT_API_KEY;
    const sampleRate = parseInt(req.headers['x-sample-rate'] || '16000');

    if (!apiKey || apiKey === 'your_google_stt_api_key_here') {
        return res.status(500).json({ error: 'Google STT API Key 未配置' });
    }

    const audioB64 = req.body.toString('base64');
    const url = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;
    const body = {
        config: { encoding: 'LINEAR16', sampleRateHertz: sampleRate, languageCode: 'zh-CN' },
        audio:  { content: audioB64 }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const t = await response.text();
            console.error('[STT] 错误:', t);
            return res.status(502).json({ error: `STT 返回错误: ${response.status}` });
        }
        const data       = await response.json();
        const transcript = data?.results?.[0]?.alternatives?.[0]?.transcript || '';
        console.log(`[STT] 识别结果: "${transcript}"`);
        res.json({ transcript });
    } catch (err) {
        console.error('[STT] 请求失败:', err.message);
        res.status(500).json({ error: '网络请求失败' });
    }
});

// ── POST /api/chat ─────────────────────────────────────────────
// Body: { message: string, characterId?: string }
app.post('/api/chat', async (req, res) => {
    const { message, characterId = currentCharacterId } = req.body;
    if (!message?.trim()) {
        return res.status(400).json({ error: '消息不能为空' });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return res.status(500).json({ error: 'DashScope API Key 未配置' });
    }

    // 组装带历史的消息列表
    const ch       = characterLibrary.get(characterId) || getCurrentCharacter();
    const history  = getHistory(characterId);
    const messages = [
        { role: 'system', content: buildSystemPrompt(ch) },
        // 历史对话（只取 content，去掉 ts 字段）
        ...history.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: message }
    ];

    const model = process.env.QWEN_CHAT_MODEL || 'qwen-turbo';
    const url   = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    try {
        const response = await fetch(url, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85 })
        });

        if (!response.ok) {
            const t = await response.text();
            console.error('[LLM] 错误:', t);
            return res.status(502).json({ error: `Qwen 返回错误: ${response.status}` });
        }

        const data = await response.json();
        const raw  = data?.choices?.[0]?.message?.content?.trim() || '';

        // 解析 JSON，容错处理
        let reply = raw, expression = 'idle';
        try {
            const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed  = JSON.parse(jsonStr);
            reply      = parsed.reply      || raw;
            expression = ['idle','happy','thinking'].includes(parsed.expression)
                         ? parsed.expression : 'idle';
        } catch {
            // 模型没按格式输出时直接用原始文本
        }

        // 持久化这一轮对话（存纯文本）
        appendTurn(characterId, message, reply);

        console.log(`[Chat] (${characterId}) 用户: ${message} | 角色: ${reply} | 表情: ${expression}`);
        res.json({ reply, expression });

    } catch (err) {
        console.error('[LLM] 请求失败:', err.message);
        res.status(500).json({ error: '网络请求失败' });
    }
});

// ── GET /api/history/:characterId ────────────────────────────
app.get('/api/history/:characterId', (req, res) => {
    res.json(getHistory(req.params.characterId));
});

// ── DELETE /api/history/:characterId ─────────────────────────
app.delete('/api/history/:characterId', (req, res) => {
    const id = req.params.characterId;
    historyCache[id] = [];
    saveHistory(id);
    console.log(`[History] 已清空 ${id} 的对话历史`);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// 角色识别
//
// 新流程：单次 VL 调用直接提取完整人设
//   图片 → qwen-vl（看图 + 内置知识）→ 结构化 JSON（含名字/性格/背景/台词）
//   → 若关键字段空缺 → qwen-plus + enable_search 补充搜索
//
// 解决的问题：旧流程先问名字再搜索，VL 模型可能只返回系列名导致搜索偏差。
// 新流程让 VL 模型直接给出它知道的全部信息，名字和系列都明确区分。
// ══════════════════════════════════════════════════════════════

const VL_PROMPT = `请识别图中的角色，用 JSON 格式返回所有你知道的信息：
{
  "name": "角色本人的名字（精确到个体，如'派蒙'，而不是系列名'原神'）",
  "series": "所属作品/IP/系列名称",
  "personality": "性格特点，2-3句话",
  "worldview": "所在世界观和作品背景，1-2句话",
  "background": "角色背景故事，2-3句话",
  "catchphrases": ["角色的代表性台词或口头禅，列2-4条"],
  "reply_style": "说话风格，1句话"
}
要求：
- 只输出 JSON，不要 markdown 代码块标记，不要任何其他文字
- name 字段必须是角色个人名字，不能只写作品名
- 如果有多个角色，只写最主要的那一个
- 不确定的字段填写你的最佳推测，不要留空`;

// 带超时的 fetch 封装（防止 API 无响应时永久挂起）
async function fetchWithTimeout(url, options, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { ...options, signal: controller.signal });
        return resp;
    } finally {
        clearTimeout(timer);
    }
}

// Step1: VL 模型看图，直接输出完整结构化角色信息
async function extractCharacterFromImage(imageBuffer, mimeType = 'image/jpeg') {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model  = process.env.QWEN_VL_MODEL || 'qwen-vl-max';
    const url    = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    console.log(`[识别 VL] 调用模型: ${model}`);

    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    const requestBody = {
        model,
        messages: [{
            role: 'user',
            content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: VL_PROMPT }
            ]
        }],
        max_tokens:      1200,  // Qwen3 thinking 模式会先消耗 token 思考，需要更大空间
        enable_thinking: false, // 关闭 Qwen3 系列的思考模式，直接输出答案
    };

    console.log(`[识别 VL] 发送请求...`);

    let resp;
    try {
        resp = await fetchWithTimeout(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body:    JSON.stringify(requestBody)
        }, 45000);
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('VL API 请求超时（45s），请检查网络或稍后重试');
        throw err;
    }

    const data = await resp.json();

    if (!resp.ok || data.error) {
        console.error('[识别 VL] API 错误:', JSON.stringify(data, null, 2));
        throw new Error(`VL API 错误: ${JSON.stringify(data.error) || resp.status}`);
    }

    // Qwen3 thinking 模式下 content 可能包含 <think>...</think>，需要剥离
    let raw = data?.choices?.[0]?.message?.content?.trim() || '';
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    console.log(`[识别 VL] 原始回复:\n${raw}`);

    if (!raw) throw new Error('VL 模型返回空内容，请确认模型支持视觉输入');

    // 提取 JSON（模型有时会加 markdown 代码块标记）
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`VL 模型未返回有效 JSON，实际内容: ${raw.slice(0, 200)}`);

    return JSON.parse(match[0]);
}

// Step2（补充）: 当 VL 输出字段缺失时，用 qwen-plus + 联网搜索补全
async function supplementWithSearch(name, series) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const searchModel = process.env.QWEN_SEARCH_MODEL || 'qwen-plus';
    const url    = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

    const query = series ? `${series}里的角色${name}` : name;
    const prompt = `请搜索「${query}」的角色资料，用 JSON 格式返回（中文）：
{
  "personality": "性格，2-3句",
  "worldview": "世界观/背景，1-2句",
  "background": "背景故事，2-3句",
  "catchphrases": ["台词1","台词2","台词3"],
  "reply_style": "说话风格，1句"
}
只返回 JSON，不加任何代码块标记。`;

    let resp;
    try {
        resp = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type':    'application/json',
                'Authorization':   `Bearer ${apiKey}`,
                'X-DashScope-SSE': 'disable'
            },
            body: JSON.stringify({
                model: searchModel,
                input: { messages: [{ role: 'user', content: prompt }] },
                parameters: { enable_search: true, result_format: 'message', max_tokens: 500 }
            })
        }, 30000);
    } catch (err) {
        if (err.name === 'AbortError') { console.warn('[识别 搜索] 超时，跳过补充搜索'); return {}; }
        throw err;
    }

    const data    = await resp.json();
    const content = data?.output?.choices?.[0]?.message?.content || '';
    console.log(`[识别 搜索] 原始回复:\n${content}`);

    try {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
    } catch (e) {
        console.warn('[识别 搜索] JSON 解析失败:', e.message);
    }
    return {};
}

// 判断 VL 输出是否缺失关键信息，决定是否补充搜索
function needsSupplementSearch(info) {
    const missing = [
        !info.personality || info.personality.length < 5,
        !info.background  || info.background.length  < 10,
        !info.catchphrases || info.catchphrases.length === 0
    ];
    return missing.filter(Boolean).length >= 2;
}

// 合并 VL 信息和搜索信息（VL 的结果优先，搜索填补空缺）
function mergeInfo(vlInfo, searchInfo) {
    return {
        personality:  vlInfo.personality  || searchInfo.personality  || '',
        worldview:    vlInfo.worldview    || searchInfo.worldview    || '',
        background:   vlInfo.background   || searchInfo.background   || '',
        catchphrases: (vlInfo.catchphrases?.length ? vlInfo.catchphrases : searchInfo.catchphrases) || [],
        reply_style:  vlInfo.reply_style  || searchInfo.reply_style  || '简短口语化，50字以内'
    };
}

function buildCharacterObject(vlInfo, supplementInfo = {}) {
    const merged = mergeInfo(vlInfo, supplementInfo);
    const name   = vlInfo.name || '未知角色';
    const id     = name.replace(/[^\w]/g, '_').toLowerCase().slice(0, 24) || `char_${Date.now()}`;
    return {
        id,
        name,
        series:      vlInfo.series || '',
        avatar:      '/avatar.jpg',
        catchphrases: merged.catchphrases,
        personality:  merged.personality,
        worldview:    merged.worldview,
        background:   merged.background,
        reply_style:  merged.reply_style
    };
}

// ── 像素精灵配色生成（识别完成后调用，速度快无需搜索）────────
async function generateSpriteColors(charObj) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model  = process.env.QWEN_CHAT_MODEL || 'qwen-turbo';
    const url    = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    const prompt = `角色「${charObj.name}」（${charObj.series || ''}）的外观形象。
请根据该角色的经典配色方案，返回以下颜色（十六进制格式，如 #FF5566）：
{"hair":"发色","clothes":"主服装色","skin":"肤色（默认#FFDDB5）","blush":"腮红色（默认#FF8FA0）"}
只返回JSON，不加其他文字。`;

    try {
        const resp = await fetchWithTimeout(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 80
            })
        }, 15000);

        const data    = await resp.json();
        const content = data?.choices?.[0]?.message?.content?.trim() || '';
        const match   = content.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
    } catch (e) {
        console.warn('[配色] 生成失败:', e.message);
    }
    return null; // 失败时由前端/硬件使用默认配色
}

// ── 识别流程核心（硬件和网页共用）───────────────────────────
async function runRecognition(imageBuffer, mimeType, res) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return res.status(500).json({ error: 'DashScope API Key 未配置' });
    }

    console.log(`[识别] 开始，图片: ${imageBuffer.length} 字节, 类型: ${mimeType}`);

    try {
        // Step1: VL 模型看图 → 完整角色信息
        const vlInfo = await extractCharacterFromImage(imageBuffer, mimeType);

        if (!vlInfo.name || vlInfo.name === '未知' || vlInfo.name === '未知角色') {
            return res.status(422).json({ error: '未能识别出已知角色，请换一张更清晰的图片' });
        }
        console.log(`[识别] VL 识别 → ${vlInfo.name}（${vlInfo.series || '未知系列'}）`);

        // Step2: 按需补充联网搜索
        let supplementInfo = {};
        if (needsSupplementSearch(vlInfo)) {
            console.log(`[识别] 关键字段缺失，启动补充搜索: ${vlInfo.name} / ${vlInfo.series}`);
            supplementInfo = await supplementWithSearch(vlInfo.name, vlInfo.series);
        }

        const charObj = buildCharacterObject(vlInfo, supplementInfo);
        console.log(`[识别] 完成 → ${charObj.name}，口头禅: ${charObj.catchphrases.join(' / ')}`);

        // Step3: 生成专属像素配色（快速，无需搜索）
        const spriteColors = await generateSpriteColors(charObj);
        if (spriteColors) {
            charObj.spriteColors = spriteColors;
            console.log(`[配色] ${charObj.name}: 发色=${spriteColors.hair} 服装=${spriteColors.clothes}`);
        }

        // 保存到角色收藏夹并设为当前
        saveCharacterToLibrary(charObj);
        setCurrentCharacter(charObj.id);

        res.json({ ...charObj, isCurrent: true });
    } catch (err) {
        console.error('[识别] 流程失败:', err.message);
        res.status(500).json({ error: `识别失败: ${err.message}` });
    }
}

// ── POST /api/recognize（硬件专用，发送原始图片二进制）────────
app.post('/api/recognize', rawImage, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: '未收到图片数据' });
    }
    const mimeType = req.headers['content-type'] || 'image/jpeg';
    await runRecognition(req.body, mimeType, res);
});

// ── POST /api/recognize/upload（网页模拟器用）────────────────
app.post('/api/recognize/upload', rawImage, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: '未收到图片数据' });
    }
    const mimeType = req.headers['content-type'] || 'image/jpeg';
    await runRecognition(req.body, mimeType, res);
});

// ── 启动 ──────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    // 显示本机局域网 IP，方便填入 CoreS3 的 config.h
    const ifaces = os.networkInterfaces();
    let localIP  = 'localhost';
    for (const name of Object.values(ifaces)) {
        for (const iface of name) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
    }

    console.log('\n PopBox 后端服务已启动');
    console.log(`   浏览器访问:  http://localhost:${PORT}`);
    console.log(`   CoreS3 填写: http://${localIP}:${PORT}`);
    console.log(`   对话历史保存到: ${DATA_DIR}\n`);
});
