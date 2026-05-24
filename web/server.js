require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// 原始二进制流：PCM 音频 & JPEG 图片
// 注意：精确匹配路径，避免影响子路径（如 /api/recognize/upload）
const rawImage = express.raw({ type: ['image/jpeg', 'image/*', 'application/octet-stream'], limit: '8mb' });
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '../data'), { index: false }));

// ── 目录 ─────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 对话历史配置 ──────────────────────────────────────────────
const MAX_TURNS = parseInt(process.env.MAX_HISTORY_TURNS || '10');

// ── MiniMax 音色映射（全局，角色对象和 TTS 接口共用）────────────
// 角色名 → 音色 ID（精确匹配，优先级最高）
const MINIMAX_VOICE_MAP = {
    // 'Zsiga': 'xxx',
    'Zsiga': 'Chinese (Mandarin)_Cute_Spirit',
    '杜尚': 'Chinese (Mandarin)_Unrestrained_Young_Man',
    '齐妃': 'Chinese (Mandarin)_Kind-hearted_Antie'
};

// 无匹配时的 fallback 音色
const MINIMAX_VOICE_FALLBACK = 'Chinese (Mandarin)_Cute_Spirit';

// ── 角色库 ────────────────────────────────────────────────────
// 单一 JSON 数组文件，与硬件端 data/characters.json 共用同一份
const CHARACTERS_JSON = path.join(__dirname, '../data/characters.json');

const characterLibrary = new Map();  // id → character object
let   currentCharacterId = null;

function getCurrentCharacter() {
    if (currentCharacterId && characterLibrary.has(currentCharacterId))
        return characterLibrary.get(currentCharacterId);
    if (characterLibrary.size > 0)
        return characterLibrary.values().next().value;
    return null;
}

function persistCharactersJson() {
    const arr = Array.from(characterLibrary.values()).map(ch => ({
        ...ch,
        isCurrent: ch.id === currentCharacterId
    }));
    try {
        fs.writeFileSync(CHARACTERS_JSON, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (e) { console.warn('[Characters] 写入 characters.json 失败:', e.message); }
}

function saveCharacterToLibrary(charObj) {
    if (!charObj?.id) return;
    characterLibrary.set(charObj.id, charObj);
    persistCharactersJson();
}

function setCurrentCharacter(id) {
    if (!characterLibrary.has(id)) return false;
    currentCharacterId = id;
    persistCharactersJson();
    try { fs.writeFileSync(path.join(DATA_DIR, 'current.json'), JSON.stringify({ id }, null, 2), 'utf-8'); } catch {}
    console.log(`[Characters] 当前角色 → ${characterLibrary.get(id).name}`);
    return true;
}

function loadCharacterLibrary() {
    try {
        const arr = JSON.parse(fs.readFileSync(CHARACTERS_JSON, 'utf-8'));
        for (const obj of arr) {
            if (obj.id) {
                characterLibrary.set(obj.id, obj);
                if (obj.isCurrent) currentCharacterId = obj.id;
            }
        }
    } catch {}

    if (characterLibrary.size === 0) {
        const defaultChar = {
            id: 'xiao_ling', name: '小铃', avatar: '',
            catchphrases: ['哎呀～', '真的假的！', '这个嘛……'],
            personality:  '活泼好奇，有点迷糊但内心温暖',
            worldview:    '来自「星盒世界」，相信每件物品都有自己的灵魂',
            background:   '某个下雨天被装进盲盒，睡了很久直到被你打开',
            reply_style:  '简短口语化，50字以内，偶尔用口头禅'
        };
        characterLibrary.set(defaultChar.id, defaultChar);
        persistCharactersJson();
    }

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
    p += '{"reply":"角色说的话","expression":"idle","emotion":"calm"}\n';
    p += 'reply 要求：以角色身份自然回应，话说到位即止，不铺陈、不重复、不强行补充。不加旁白。\n';
    p += 'reply 可在文字中插入音效标记：(laughs)笑声、(sighs)叹气、(gasps)喘息、<#0.5#>停顿0.5秒，用来增强语气，但不要滥用。\n';
    p += 'expression 只能是以下三个值之一：happy（开心/兴奋/被夸/撒娇）、thinking（困惑/认真/沉思）、idle（其他普通情况）。\n';
    p += 'emotion 只能是以下值之一：happy、sad、angry、fearful、disgusted、surprised、calm、fluent、whisper。根据角色当前情绪选择最贴切的。';
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

// ── POST /api/stt — 硬件专用，接收原始 PCM，经 DashScope 实时识别 WebSocket 转写 ──
const sttRaw = express.raw({ type: 'application/octet-stream', limit: '4mb' });

function pcmToWav(pcmBuf, sampleRate) {
    const ch = 1, bits = 16;
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0);                 hdr.writeUInt32LE(36 + pcmBuf.length, 4);
    hdr.write('WAVE', 8);                 hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16);            hdr.writeUInt16LE(1, 20);
    hdr.writeUInt16LE(ch, 22);            hdr.writeUInt32LE(sampleRate, 24);
    hdr.writeUInt32LE(sampleRate * ch * bits / 8, 28);
    hdr.writeUInt16LE(ch * bits / 8, 32); hdr.writeUInt16LE(bits, 34);
    hdr.write('data', 36);                hdr.writeUInt32LE(pcmBuf.length, 40);
    return Buffer.concat([hdr, pcmBuf]);
}

function sendWsJson(ws, body) {
    ws.send(JSON.stringify(body));
}

function runRealtimeStt(pcmBuf, sampleRate, apiKey) {
    return new Promise((resolve, reject) => {
        const taskId = randomUUID();
        const model = process.env.DASHSCOPE_REALTIME_STT_MODEL || 'paraformer-realtime-v2';
        const wsUrl = process.env.DASHSCOPE_REALTIME_STT_WS || 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
        const ws = new WebSocket(wsUrl, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'user-agent': 'PopBox-STT/1.0'
            }
        });

        let settled = false;
        let finalText = '';
        let latestText = '';
        let audioStarted = false;
        let audioTimer = null;

        const cleanup = () => {
            if (audioTimer) clearTimeout(audioTimer);
            audioTimer = null;
        };

        const finish = (err, transcript = '') => {
            if (settled) return;
            settled = true;
            cleanup();
            try { ws.close(); } catch {}
            if (err) reject(err);
            else resolve(transcript.trim());
        };

        const timeout = setTimeout(() => finish(new Error('STT realtime timeout')), 30000);
        const clearMainTimeout = () => clearTimeout(timeout);

        const sendAudioChunks = () => {
            if (audioStarted) return;
            audioStarted = true;
            const bytesPer100ms = Math.max(2, Math.floor(sampleRate * 2 / 10));
            let offset = 0;

            const sendNext = () => {
                if (settled || ws.readyState !== WebSocket.OPEN) return;
                if (offset >= pcmBuf.length) {
                    sendWsJson(ws, {
                        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                        payload: { input: {} }
                    });
                    return;
                }
                const end = Math.min(offset + bytesPer100ms, pcmBuf.length);
                ws.send(pcmBuf.subarray(offset, end));
                offset = end;
                audioTimer = setTimeout(sendNext, 100);
            };

            sendNext();
        };

        ws.on('open', () => {
            sendWsJson(ws, {
                header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
                payload: {
                    task_group: 'audio',
                    task: 'asr',
                    function: 'recognition',
                    model,
                    parameters: {
                        format: 'pcm',
                        sample_rate: sampleRate,
                        language_hints: ['zh', 'en'],
                        disfluency_removal_enabled: false,
                        semantic_punctuation_enabled: false,
                        punctuation_prediction_enabled: true,
                        inverse_text_normalization_enabled: true
                    },
                    input: {}
                }
            });
        });

        ws.on('message', data => {
            let event;
            try {
                event = JSON.parse(data.toString());
            } catch {
                return;
            }

            const name = event?.header?.event;
            if (name === 'task-started') {
                sendAudioChunks();
                return;
            }
            if (name === 'result-generated') {
                const sentence = event?.payload?.output?.sentence;
                const text = sentence?.text || '';
                if (!text || sentence?.heartbeat) return;
                latestText = text;
                if (sentence?.sentence_end) finalText += text;
                return;
            }
            if (name === 'task-finished') {
                clearMainTimeout();
                finish(null, finalText || latestText);
                return;
            }
            if (name === 'task-failed') {
                clearMainTimeout();
                finish(new Error(event?.header?.error_message || event?.header?.error_code || 'STT task failed'));
            }
        });

        ws.on('error', err => {
            clearMainTimeout();
            finish(err);
        });
        ws.on('close', () => {
            clearMainTimeout();
            if (!settled) finish(new Error('STT websocket closed before task finished'));
        });
    });
}

app.post('/api/stt', sttRaw, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: '未收到音频数据' });
    }

    const apiKey     = process.env.DASHSCOPE_API_KEY;
    const sampleRate = parseInt(req.headers['x-sample-rate'] || '16000');

    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return res.status(500).json({ error: 'DashScope API Key 未配置' });
    }

    const wavBuf = pcmToWav(req.body, sampleRate);
    try { fs.writeFileSync(path.join(DATA_DIR, 'debug_mic.wav'), wavBuf); } catch {}

    try {
        const transcript = await runRealtimeStt(req.body, sampleRate, apiKey);
        console.log(`[STT] realtime result: "${transcript}"`);
        res.json({ transcript });
    } catch (err) {
        console.error('[STT] realtime failed:', err.message);
        res.status(500).json({ error: '实时语音识别请求失败' });
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
        const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
        console.log(`[Chat] 发送消息数: ${messages.length}，prompt 总字符: ${promptChars}`);
        const t0 = Date.now();
        const response = await fetchWithTimeout(url, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ model, messages, max_tokens: 120, temperature: 0.85, enable_thinking: false })
        }, 15000);
        console.log(`[Chat] API 响应: ${Date.now() - t0}ms`);

        if (!response.ok) {
            const t = await response.text();
            console.error('[LLM] 错误:', t);
            return res.status(502).json({ error: `Qwen 返回错误: ${response.status}` });
        }

        const data = await response.json();
        console.log(`[Chat] JSON 解析完成: ${Date.now() - t0}ms`);
        const raw  = data?.choices?.[0]?.message?.content?.trim() || '';

        // 解析 JSON，容错处理
        const VALID_EMOTIONS = ['happy','sad','angry','fearful','disgusted','surprised','calm','fluent','whisper'];
        let reply = raw, expression = 'idle', emotion = 'calm';
        try {
            const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed  = JSON.parse(jsonStr);
            reply      = parsed.reply      || raw;
            expression = ['idle','happy','thinking'].includes(parsed.expression) ? parsed.expression : 'idle';
            emotion    = VALID_EMOTIONS.includes(parsed.emotion) ? parsed.emotion : 'calm';
        } catch {
            // 模型没按格式输出时直接用原始文本
        }

        // 持久化这一轮对话（存纯文本）
        appendTurn(characterId, message, reply);

        console.log(`[Chat] (${characterId}) 用户: ${message} | 角色: ${reply} | 表情: ${expression} | emotion: ${emotion} | 总耗时: ${Date.now() - t0}ms`);
        res.json({ reply, expression, emotion });

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

function buildVlPrompt() {
    return `请识别图中角色，只返回以下 JSON，不加任何其他文字或代码块标记：
{
  "name": "角色个人名字（精确到个体，如'派蒙'，而非系列名'原神'）",
  "series": "所属作品/IP/系列名称"
}
要求：
- name 必须是角色自身的名字，不能只写作品名
- 如果图中有多个角色，只写最主要的那一个
- 不确定时填写最佳推测，不要留空`;
}

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

// Step1: VL 模型看图，只输出 name 和 series
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
                { type: 'text', text: buildVlPrompt() }
            ]
        }],
        max_tokens:      200,
        enable_thinking: false,
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

function buildCharacterObject(nameStr, series, searchInfo = {}) {
    const name = nameStr || '未知角色';
    const id   = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 32) || `char_${Date.now()}`;

    return {
        id,
        name,
        series:       series || '',
        voice:        MINIMAX_VOICE_MAP[name] || MINIMAX_VOICE_FALLBACK,
        avatar:       `/${id}.jpg`,
        catchphrases: searchInfo.catchphrases || [],
        personality:  searchInfo.personality  || '',
        worldview:    searchInfo.worldview    || '',
        background:   searchInfo.background   || '',
        reply_style:  searchInfo.reply_style  || '简短口语化，50字以内',
    };
}


// ── 识别流程核心（硬件和网页共用）───────────────────────────
async function runRecognition(imageBuffer, mimeType, res) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return res.status(500).json({ error: 'DashScope API Key 未配置' });
    }

    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const debugPath = path.join(DATA_DIR, `debug_capture_${Date.now()}.${ext}`);
    try { fs.writeFileSync(debugPath, imageBuffer); } catch {}
    console.log(`[识别] 开始，图片: ${imageBuffer.length} 字节 → 已保存到 ${debugPath}`);

    try {
        // Step1: VL 模型看图 → 只拿 name 和 series
        const vlInfo = await extractCharacterFromImage(imageBuffer, mimeType);

        if (!vlInfo.name || vlInfo.name === '未知' || vlInfo.name === '未知角色') {
            return res.status(422).json({ error: '未能识别出已知角色，请换一张更清晰的图片' });
        }
        console.log(`[识别] VL 识别 → ${vlInfo.name}（${vlInfo.series || '未知系列'}）`);

        // 规则命中本地库（按名字精确匹配）→ 直接复用，跳过搜索
        const libMatch = [...characterLibrary.values()].find(
            c => c.name === vlInfo.name
        );
        if (libMatch) {
            console.log(`[识别] 命中本地库 → ${libMatch.name}，跳过联网搜索`);
            setCurrentCharacter(libMatch.id);
            return res.json({ ...libMatch, isCurrent: true });
        }

        // Step2: 未命中 → 联网搜索全部字段
        console.log(`[识别] 未命中本地库，启动联网搜索: ${vlInfo.name} / ${vlInfo.series}`);
        const searchInfo = await supplementWithSearch(vlInfo.name, vlInfo.series);

        const charObj = buildCharacterObject(vlInfo.name, vlInfo.series, searchInfo);
        console.log(`[识别] 完成 → ${charObj.name}，口头禅: ${charObj.catchphrases.join(' / ')}`);

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

// ── POST /api/tts ─────────────────────────────────────────────
// Body: { text: string, voice: string }
// 返回: audio/mp3 二进制流
app.post('/api/tts', async (req, res) => {
    const { text, voice } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text 不能为空' });
    if (!voice)        return res.status(400).json({ error: 'voice 不能为空' });

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'MINIMAX_API_KEY 未配置' });

    const url = 'https://api.minimaxi.com/v1/t2a_v2';

    try {
        const t0 = Date.now();
        const response = await fetchWithTimeout(url, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'speech-02-hd',
                text:  text.trim(),
                voice_setting: {
                    voice_id: voice,
                    speed: 1.0,
                    vol:   1.0,
                    pitch: 0,
                },
                audio_setting: { format: 'mp3', sample_rate: 32000 },
            })
        }, 30000);

        const data = await response.json();
        console.log(`[TTS] 合成请求: ${Date.now() - t0}ms | voice=${voice}`);

        if (!response.ok || data.base_resp?.status_code !== 0) {
            console.error('[TTS] 错误:', JSON.stringify(data));
            return res.status(502).json({ error: data.base_resp?.status_msg || `TTS 错误: ${response.status}` });
        }

        const hexAudio = data?.data?.audio;
        if (!hexAudio) {
            console.error('[TTS] 响应中无音频数据:', JSON.stringify(data));
            return res.status(502).json({ error: 'TTS 未返回音频数据' });
        }

        const audioBuffer = Buffer.from(hexAudio, 'hex');
        console.log(`[TTS] 总计: ${Date.now() - t0}ms | size=${audioBuffer.length}B`);
        res.set('Content-Type', 'audio/mpeg');
        res.send(audioBuffer);

    } catch (err) {
        if (err.name === 'AbortError') return res.status(504).json({ error: 'TTS 超时' });
        console.error('[TTS] 请求失败:', err.message);
        res.status(500).json({ error: '网络请求失败' });
    }
});

// ── POST /api/debug/mic — 接收硬件录音，保存为 WAV 供浏览器下载验证 ──
const micRaw = express.raw({ type: 'application/octet-stream', limit: '8mb' });
app.post('/api/debug/mic', micRaw, (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return res.status(400).json({ error: '无数据' });
    const sampleRate = parseInt(req.headers['x-sample-rate'] || '16000');
    const wavBuf = pcmToWav(req.body, sampleRate);
    const wavPath = path.join(DATA_DIR, 'debug_mic.wav');
    fs.writeFileSync(wavPath, wavBuf);
    console.log(`[MicDebug] 已保存 ${wavBuf.length} 字节 WAV → ${wavPath}`);
    res.json({ ok: true, bytes: wavBuf.length, seconds: req.body.length / 2 / sampleRate });
});

app.get('/api/debug/mic', (req, res) => {
    const wavPath = path.join(DATA_DIR, 'debug_mic.wav');
    if (!fs.existsSync(wavPath)) return res.status(404).json({ error: '还没有录音' });
    res.download(wavPath, 'debug_mic.wav');
});

// ── 启动 ──────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    const ifaces = os.networkInterfaces();
    let localIP  = 'localhost';
    for (const name of Object.values(ifaces)) {
        for (const iface of name) {
            if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
        }
    }

    try {
        const { Bonjour } = require('bonjour-service');
        const bonjour = new Bonjour();
        bonjour.publish({ name: 'PopBox', type: 'http', port: PORT, host: 'popbox.local' });
        console.log('   mDNS 广播:   http://popbox.local:' + PORT + '  (CoreS3 使用此地址)');
    } catch (e) {
        console.warn('   mDNS 广播失败，CoreS3 请手动填写 IP:', localIP);
    }

    console.log('\n PopBox 后端服务已启动');
    console.log(`   浏览器访问:  http://localhost:${PORT}`);
    console.log(`   本机 IP:     http://${localIP}:${PORT}`);
    console.log(`   对话历史保存到: ${DATA_DIR}\n`);
});
