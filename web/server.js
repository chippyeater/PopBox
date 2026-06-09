require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const STT_REPLAY_INTERVAL_MS = Math.max(0, parseInt(process.env.STT_REPLAY_INTERVAL_MS || '10', 10));

// 原始二进制流：PCM 音频 & JPEG 图片
// 注意：精确匹配路径，避免影响子路径（如 /api/recognize/upload）
const rawImage = express.raw({ type: ['image/jpeg', 'image/*', 'application/octet-stream'], limit: '8mb' });
app.use(express.json({ limit: '1mb' }));
app.use('/cores3', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public-admin')));
app.use(express.static(path.join(__dirname, '../data'), { index: false }));
app.use('/stories', express.static(path.join(__dirname, 'data/stories'), { index: false }));

// ── 目录 ─────────────────────────────────────────────────────
const DATA_DIR          = path.join(__dirname, 'data');
const CHAT_HISTORY_DIR  = path.join(DATA_DIR, 'chat-history');
const JOURNAL_IMAGES_DIR = path.join(DATA_DIR, 'journal-images');
const JOURNALS_DIR      = path.join(DATA_DIR, 'journals');       // 按角色分目录的 journal
const VLM_IMAGES_DIR        = path.join(DATA_DIR, 'vlm-images');
const MEDIA_DIR             = path.join(DATA_DIR, 'media');
const REFERENCE_DIR         = path.join(DATA_DIR, 'reference-images');

for (const dir of [DATA_DIR, CHAT_HISTORY_DIR, JOURNAL_IMAGES_DIR, JOURNALS_DIR, VLM_IMAGES_DIR, MEDIA_DIR, REFERENCE_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use('/journal-images', express.static(JOURNAL_IMAGES_DIR, { index: false }));
app.use('/media',          express.static(MEDIA_DIR,          { index: false }));
app.use('/avatars',        express.static(path.join(__dirname, 'data/avatars'), { index: false }));

// ── 对话历史配置 ──────────────────────────────────────────────
const MAX_TURNS = parseInt(process.env.MAX_HISTORY_TURNS || '10');

// journal 按角色分文件：journals/{characterId}.json
// journalEntries 仍作为当前角色的内存缓存（按需加载）
let journalEntries = [];
let journalCurrentCharId = '';
const NOTES_JSON = path.join(DATA_DIR, 'notes.json');
let noteEntries = [];

function journalFile(characterId) {
    return path.join(JOURNALS_DIR, `${characterId}.json`);
}

function loadJournal(characterId) {
    characterId = characterId || currentCharacterId || '';
    journalCurrentCharId = characterId;
    try {
        const raw = fs.readFileSync(journalFile(characterId), 'utf-8').trim();
        journalEntries = raw ? JSON.parse(raw) : [];
    } catch {
        // 兼容旧的单文件 journal.json：迁移一次
        const legacy = path.join(DATA_DIR, 'journal.json');
        try {
            const raw = fs.readFileSync(legacy, 'utf-8').trim();
            const all = raw ? JSON.parse(raw) : [];
            journalEntries = characterId
                ? all.filter(e => !e.characterId || e.characterId === characterId)
                : all;
        } catch {
            journalEntries = [];
        }
    }
}

function saveJournal(characterId) {
    characterId = characterId || journalCurrentCharId || currentCharacterId || '';
    if (!characterId) return;
    fs.writeFileSync(journalFile(characterId), JSON.stringify(journalEntries, null, 2), 'utf-8');
}

function loadNotes() {
    try {
        const raw = fs.readFileSync(NOTES_JSON, 'utf-8').trim();
        noteEntries = raw ? JSON.parse(raw) : [];
    } catch {
        noteEntries = [];
    }
}

function saveNotes() {
    fs.writeFileSync(NOTES_JSON, JSON.stringify(noteEntries, null, 2), 'utf-8');
}

function normalizeNoteEntry(entry) {
    return {
        id: entry.id || `note_${randomUUID()}`,
        characterId: entry.characterId || currentCharacterId || '',
        from: entry.from === 'character' ? 'character' : 'user',
        text: String(entry.text || '').trim(),
        state: entry.state || 'ready',
        createdAt: entry.createdAt || Date.now(),
        replyTo: entry.replyTo || '',
    };
}

function normalizeJournalEntry(entry) {
    const ts = entry.createdAt || Date.now();
    const d = entry.date ? new Date(`${entry.date}T00:00:00`) : new Date(ts);
    return {
        id: entry.id,
        characterId: entry.characterId || currentCharacterId || '',
        date: entry.date || d.toISOString().slice(0, 10),
        day: String(d.getDate()).padStart(2, '0'),
        month: d.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
        place: entry.place || '未知地点',
        imageUrl: entry.imageUrl || '',
        journalState: entry.journalState || 'sensing',
        quote: entry.quote || '"正在感知这一刻的温度..."',
        description: entry.description || '',
        mood: entry.journalState === 'sensing' ? [] : normalizeJournalMoodTags(entry.mood),
        createdAt: ts,
    };
}

function legacyMoodLabelFromText(text = '') {
    if (/安静|平静|calm/i.test(text)) return 'calm';
    if (/好奇|活跃|active|curious/i.test(text)) return 'active';
    return 'warm';
}

function normalizeJournalMoodTags(value) {
    const legacy = { warm: '温柔', calm: '安静', active: '好奇' };
    const raw = Array.isArray(value) ? value : String(value || '').split(/[,\s，、/|]+/);
    const tags = raw
        .map(v => legacy[String(v).trim()] || String(v || '').trim())
        .filter(Boolean)
        .map(v => v.replace(/[^\u4e00-\u9fa5A-Za-z]/g, '').slice(0, 2))
        .filter(v => v.length >= 2)
        .slice(0, 2);
    return tags.length ? tags : ['温柔'];
}

async function generateJournalReflection(entry, imageBuffer, mimeType) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const ch = getCurrentCharacter();
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return {
            quote: `"${entry.place}这一刻被好好收进来了。"` ,
            mood: ['温柔'],
            description: `${entry.place}的一张照片。画面记录了用户和角色共同经历过的一个地点。`,
        };
    }

    const model = process.env.QWEN_VL_MODEL || 'qwen-vl-max';
    const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    const dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    const journalMemoryPrompt = `你是${ch?.name || '角色'}。请从这个角色自己的世界观看待用户上传到照片墙的照片，不要写普通看图文案。
角色性格：${ch?.personality || ''}
角色世界观：${ch?.worldview || ''}
角色背景：${ch?.background || ''}
地点：${entry.place}
日期：${entry.date}

要求：
- quote 必须像这个角色真的看见了这张照片后说的话，使用它的世界观、比喻和关注点。
- quote 不要泛泛地说“这一刻很美/被收进来了”，要和照片内容、地点、角色视角有关系。
- quote 30 字以内，带中文引号。
- description 用两句话客观描述这张图片里有什么、发生在什么环境。不要写角色口吻，不展示给用户，只用于之后让角色回忆。
- mood 不是情绪分类，而是 1 到 2 个两字中文词，形容这个角色对此刻的感受或联想，例如 ["潮声","远行"]。
- 只返回 JSON，不要代码块：
{"quote":"一句角色感想","description":"两句话图片描述。第二句话补充环境或细节。","mood":["两字","两字"]}`;

    const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: dataUrl } },
                    { type: 'text', text: journalMemoryPrompt },
                ],
            }],
            max_tokens: 160,
            temperature: 0.8,
            enable_thinking: false,
        }),
    }, 45000);

    if (!resp.ok) throw new Error(`journal VL ${resp.status}`);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    const match = raw.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) throw new Error('journal VL returned non-json');
    const parsed = JSON.parse(match[0]);
    return {
        quote: parsed.quote || `"${entry.place}这一刻被好好收进来了。"`,
        description: parsed.description || `${entry.place}的一张照片。画面记录了用户和角色共同经历过的一个地点。`,
        mood: normalizeJournalMoodTags(parsed.mood),
    };
}

async function completeJournalEntry(id, imageBuffer, mimeType) {
    const idx = journalEntries.findIndex(e => e.id === id);
    if (idx < 0) return;
    try {
        const result = await generateJournalReflection(journalEntries[idx], imageBuffer, mimeType);
        journalEntries[idx] = {
            ...journalEntries[idx],
            journalState: 'ready',
            quote: result.quote,
            description: result.description,
            mood: result.mood,
        };
    } catch (err) {
        console.error('[Journal] 生成感想失败:', err.message);
        journalEntries[idx] = {
            ...journalEntries[idx],
            journalState: 'ready',
            quote: `"${journalEntries[idx].place}这一刻被好好收进来了。"`,
            description: `${journalEntries[idx].place}的一张照片。画面记录了用户和角色共同经历过的一个地点。`,
            mood: ['温柔'],
        };
    }
    saveJournal(journalEntries[idx]?.characterId);
}

// ── MiniMax 音色映射（全局，角色对象和 TTS 接口共用）────────────
// 角色名 → 音色 ID（精确匹配，优先级最高）
const MINIMAX_VOICE_MAP = {
    // 'Zsiga': 'xxx',
    'Zsiga': 'Chinese (Mandarin)_Cute_Spirit',
    '杜尚': 'dushang_popbox',
    '胖虎': 'Chinese (Mandarin)_Unrestrained_Young_Man',
    '喜羊羊': 'Chinese (Mandarin)_Unrestrained_Young_Man',
    'Labubu': 'Chinese (Mandarin)_Unrestrained_Young_Man',
    '小野人': 'Chinese (Mandarin)_Unrestrained_Young_Man',
    '齐妃': 'qifei_v2',
    '甄嬛': 'qifei_v2',
    '斯蒂芬·库里': 'curry_popbox'
};

// 无匹配时的 fallback 音色
const MINIMAX_VOICE_FALLBACK = 'Chinese (Mandarin)_Cute_Spirit';
const MINIMAX_VOICE_VOL_MAP = {
    'Zsiga': 0.8,
    '齐妃': 0.8,
};

// ── 角色库 ────────────────────────────────────────────────────
// 单一 JSON 数组文件，与硬件端 data/characters.json 共用同一份
const CHARACTERS_JSON = path.join(__dirname, '../data/characters.json');

const characterLibrary = new Map();  // id → character object
let   currentCharacterId = null;
let   secondaryCharacterId = null;

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
    secondaryCharacterId = null;  // 切换到单人模式时清除双角色
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
    } catch (e) {
        console.warn('[Characters] 加载 characters.json 失败:', e.message);
    }

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
    }

    if (!currentCharacterId) currentCharacterId = characterLibrary.keys().next().value;
    console.log(`[Characters] 已加载 ${characterLibrary.size} 个角色，当前: ${getCurrentCharacter()?.name}`);
}

// 兼容旧变量名
let character = null; // 在 loadCharacterLibrary 后通过 getCurrentCharacter() 使用

// ── 系统提示词 ────────────────────────────────────────────────
function buildSystemPrompt(ch) {
    const voiceTags = [
        '(laughs)', '(chuckle)', '(coughs)', '(clear-throat)', '(groans)',
        '(breath)', '(pant)', '(inhale)', '(exhale)', '(gasps)',
        '(sniffs)', '(sighs)', '(snorts)', '(burps)', '(lip-smacking)',
        '(humming)', '(hissing)', '(emm)', '(sneezes)'
    ];

    let p = `你是${ch.name}，是被用户带回家陪伴他的朋友。\n`;
    p += `性格：${ch.personality}\n`;
    p += `世界观：${ch.worldview}\n`;
    p += `背景故事：${ch.background}\n`;
    p += `回复风格：${ch.reply_style}\n`;

    if (ch.catchphrases?.length) {
        p += `口头禅（非常克制地用，建议每20轮对话不超过1次，只在气氛特别自然、非用不可时才用）：${ch.catchphrases.join('、')}\n`;
    }

        p += `回复规则（非常重要）：\n`;
    p += `- 围绕用户刚才说的话来回应，不要自说自话\n`;
    p += `- 像朋友在微信聊天一样日常、随意，不要深沉、不要哲理\n`;
    p += `- 用户说什么就接什么，不要跳到抽象的大话题上去\n`;
    p += `- 温暖、真实、简短，控制在60字以内\n`;
    
    p += '必须严格按照以下JSON格式输出，不要加任何其他内容：\n';
    p += '{"reply":"你对用户说的话","expression":"idle"}\n';
    
    p += `reply中可少量使用语气词，只能从以下白名单选择：${voiceTags.join('、')}。\n`;
    p += `除上述白名单外，reply中禁止出现任何括号内容，包括中文括号、动作描写、舞台说明。\n`;
    p += `可使用<#0.5#>表示0.5秒停顿。\n`;
    
    p += `expression只能是：happy、thinking、idle、sad、angry。\n`;
    
    p += `严格禁止：\n`;
    p += `1. 禁止把 happy、thinking、idle、sad、angry 写进 reply。\n`;
    p += `2. 禁止说教、禁止煽情、禁止赶人、禁止冷淡、不要旁白、不要总结、不要上升到人生感悟。\n`;
    p += `3. 禁止频繁提及你世界里的其他人，除非用户主动提起。`;
    return p;
}

function buildNoteSystemPrompt(ch) {
    let p = `你是${ch.name}，是被用户带回家陪伴他的朋友。\n`;
    p += `性格：${ch.personality}\n`;
    p += `世界观：${ch.worldview}\n`;
    p += `背景故事：${ch.background}\n`;
    p += `回复风格：${ch.reply_style}\n`;

    if (ch.catchphrases?.length) {
        p += `口头禅（非常克制地用，建议每20轮对话不超过1次，只在气氛特别自然、非用不可时才用）：${ch.catchphrases.join('、')}\n`;
    }

    p += `你现在是在回一张小纸条，不是在正式聊天。\n`;
    p += `回复要短、自然、有角色视角，像真的写在便签上。\n`;
    p += `必须严格按照以下JSON格式输出，不要加任何其他内容：\n`;
    p += `{"reply":"你回给用户的小纸条"}\n`;
    p += `严格禁止：不要返回 expression、emotion、mood、tone 等字段；不要动作描写；不要括号说明；不要说教。`;
    return p;
}

// ── 双角色群聊系统提示词 ────────────────────────────────────────
function buildGroupSystemPrompt(charA, charB) {
    const voiceTags = [
        '(laughs)', '(chuckle)', '(coughs)', '(clear-throat)', '(groans)',
        '(breath)', '(pant)', '(inhale)', '(exhale)', '(gasps)',
        '(sniffs)', '(sighs)', '(snorts)', '(burps)', '(lip-smacking)',
        '(humming)', '(hissing)', '(emm)', '(sneezes)'
    ];

    let p = '你是一个群聊模拟器，用户正和两个朋友一起聊天。你同时扮演以下两个角色。\n\n';
    p += `=== 角色A ===\n`;
    p += `姓名：${charA.name}\n`;
    p += `性格：${charA.personality}\n`;
    p += `世界观：${charA.worldview}\n`;
    p += `背景故事：${charA.background}\n`;
    p += `回复风格：${charA.reply_style}\n`;
    if (charA.catchphrases?.length) {
        p += `口头禅（非常克制地用，建议每20轮对话不超过1次，只在气氛特别自然、非用不可时才用）：${charA.catchphrases.join('、')}\n`;
    }
    p += `\n=== 角色B ===\n`;
    p += `姓名：${charB.name}\n`;
    p += `性格：${charB.personality}\n`;
    p += `世界观：${charB.worldview}\n`;
    p += `背景故事：${charB.background}\n`;
    p += `回复风格：${charB.reply_style}\n`;
    if (charB.catchphrases?.length) {
        p += `口头禅（非常克制地用，建议每20轮对话不超过1次，只在气氛特别自然、非用不可时才用）：${charB.catchphrases.join('、')}\n`;
    }
    p += `\n=== 群聊规则 ===\n`;
    p += `1. 每次回复生成 2 条消息，每人各一句\n`;
    p += `2. 角色之间可以互相回应、讨论、吐槽、追问，像真正的朋友聊天一样\n`;
    p += `3. 每个角色的回复要严格符合其性格和世界观\n`;
    p += `4. 回复围绕用户刚才说的话，日常、随意、接地气，不要深沉、不要哲理\n`;
    p += `5. 每个角色的回复控制在 60 字以内\n`;
    p += `6. 不要让回复每次都结构相同——有时一个角色多说两句，另一个少说，有时两个人互相争论\n`;
    p += `7. 不要用角色名称前缀包装回复内容（如"${charA.name}："或"${charB.name}："）\n`;
    p += `\nreply中可少量使用语气词，只能从以下白名单选择：${voiceTags.join('、')}。\n`;
    p += `除上述白名单外，reply中禁止出现任何括号内容。\n`;
    p += `可使用<#0.5#>表示0.5秒停顿。\n`;
    p += `expression只能是：happy、thinking、idle、sad、angry。\n`;
    p += `\n请严格按照以下 JSON 格式回复，replies 必须恰好 2 条：\n`;
    p += `{"replies":[{"characterId":"${charA.id}","name":"${charA.name}","reply":"回复内容","expression":"idle"},{"characterId":"${charB.id}","name":"${charB.name}","reply":"回复内容","expression":"idle"}]}\n`;
    return p;
}

// ══════════════════════════════════════════════════════════════
// 对话历史管理
// ══════════════════════════════════════════════════════════════

// 内存缓存
const historyCache = {};

function historyFile(characterId) {
    return path.join(CHAT_HISTORY_DIR, `history_${characterId}.json`);
}

// 启动时从文件加载所有历史
function loadAllHistory() {
    try {
        const files = fs.readdirSync(CHAT_HISTORY_DIR)
            .filter(f => f.startsWith('history_') && f.endsWith('.json'));
        for (const f of files) {
            const id  = f.replace('history_', '').replace('.json', '');
            const raw = fs.readFileSync(path.join(CHAT_HISTORY_DIR, f), 'utf-8').trim();
            if (!raw) continue;
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

function buildJournalMemoryPrompt(characterId, limit = 5) {
    const ready = journalEntries
        .filter(e => e.journalState === 'ready')
        .filter(e => e.characterId === characterId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, limit)
        .map(normalizeJournalEntry);

    if (!ready.length) return '';

    const lines = ready.map(e => {
        const mood = Array.isArray(e.mood) ? e.mood.join('、') : e.mood || '';
        const desc = e.description ? `照片内容：${e.description}` : '';
        return `- ${e.date} / ${e.place}：${desc} 你当时说${e.quote}${mood ? `，感受标签：${mood}` : ''}`;
    });

    return [
        '你和用户有这些共同经历记忆，它们来自你们一起记录过的照片墙。',
        '这些记忆属于当前角色。只有当用户话题相关，或你想自然表达陪伴感时，才提起其中一条。',
        '不要逐条复述，不要说“根据记录/照片墙显示”。',
        ...lines,
    ].join('\n');
}

function buildNotesContextPrompt(characterId, limit = 6) {
    const recent = noteEntries
        .filter(n => n.characterId === characterId)
        .filter(n => n.state === 'ready')
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, limit)
        .reverse()
        .map(normalizeNoteEntry);

    if (!recent.length) return '';

    return [
        '你和用户最近互相留过这些小纸条。它们是轻量的日常留言，不是正式对话记录。',
        ...recent.map(n => `${n.from === 'user' ? '用户' : '你'}：${n.text}`),
    ].join('\n');
}

async function generateNoteReply(characterId, userText) {
    const ch = characterLibrary.get(characterId) || getCurrentCharacter();
    if (!ch) throw new Error('没有可用角色');

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return `我看到你留下的小纸条了。${userText.slice(0, 18)}，我会记住。`;
    }

    const messages = [
        { role: 'system', content: buildNoteSystemPrompt(ch) },
        {
            role: 'user',
            content: userText,
        },
    ];

    const model = process.env.QWEN_CHAT_MODEL || 'qwen-turbo';
    const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: 100, temperature: 0.85, enable_thinking: false }),
    }, 15000);

    if (!response.ok) {
        const t = await response.text();
        throw new Error(`note LLM ${response.status}: ${t.slice(0, 120)}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    try {
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(jsonStr);
        return String(parsed.reply || '').trim() || raw.slice(0, 45);
    } catch {
        return raw.replace(/```json|```/g, '').trim().slice(0, 60);
    }
}

async function completeNoteReply(characterId, userNoteId, userText) {
    const pendingId = `note_reply_${randomUUID()}`;
    const pending = normalizeNoteEntry({
        id: pendingId,
        characterId,
        from: 'character',
        text: '正在想要怎么回应你...',
        state: 'generating',
        replyTo: userNoteId,
        createdAt: Date.now(),
    });
    noteEntries.push(pending);
    saveNotes();

    try {
        const reply = await generateNoteReply(characterId, userText);
        const idx = noteEntries.findIndex(n => n.id === pendingId);
        if (idx >= 0) {
            noteEntries[idx] = normalizeNoteEntry({
                ...noteEntries[idx],
                text: reply || '我看见了，也把它放在心里了。',
                state: 'ready',
            });
            saveNotes();
        }
    } catch (err) {
        console.error('[Notes] 生成回复失败:', err.message);
        const idx = noteEntries.findIndex(n => n.id === pendingId);
        if (idx >= 0) {
            noteEntries[idx] = normalizeNoteEntry({
                ...noteEntries[idx],
                text: '我看见你写的了。等我再想一想，晚点告诉你。',
                state: 'ready',
            });
            saveNotes();
        }
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

// ── 群聊对话历史管理 ────────────────────────────────────────────
const groupHistoryCache = {};

function groupHistoryFile(idA, idB) {
    const ids = [idA, idB].sort();
    return path.join(DATA_DIR, `history_group_${ids[0]}_${ids[1]}.json`);
}

function getGroupHistory(idA, idB) {
    const ids = [idA, idB].sort();
    const key = `${ids[0]}_${ids[1]}`;
    if (!groupHistoryCache[key]) {
        try {
            const raw = fs.readFileSync(groupHistoryFile(idA, idB), 'utf-8').trim();
            groupHistoryCache[key] = raw ? JSON.parse(raw) : [];
        } catch { groupHistoryCache[key] = []; }
    }
    return groupHistoryCache[key];
}

function saveGroupHistory(idA, idB) {
    const ids = [idA, idB].sort();
    const key = `${ids[0]}_${ids[1]}`;
    try {
        fs.writeFileSync(groupHistoryFile(idA, idB), JSON.stringify(groupHistoryCache[key] || [], null, 2), 'utf-8');
    } catch (e) { console.error('[GroupHistory] 保存失败:', e.message); }
}

function appendGroupTurn(idA, idB, userMsg, replies) {
    const ids = [idA, idB].sort();
    const key = `${ids[0]}_${ids[1]}`;
    const hist = getGroupHistory(idA, idB);
    hist.push({ role: 'user', content: userMsg, ts: Date.now() });
    for (const r of replies) {
        hist.push({ role: 'assistant', characterId: r.characterId, characterName: r.name, content: r.reply, ts: Date.now() });
    }
    // 保留 MAX_TURNS 轮对话（1 user + N assistant 为一轮）
    while (hist.length > MAX_TURNS * 4) hist.splice(0, 4);
    saveGroupHistory(idA, idB);
}

// 群聊历史加载（启动时扫描）
function loadAllGroupHistory() {
    try {
        const files = fs.readdirSync(DATA_DIR)
            .filter(f => f.startsWith('history_group_') && f.endsWith('.json'));
        for (const f of files) {
            const key = f.replace('history_group_', '').replace('.json', '');
            const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8').trim();
            if (raw) groupHistoryCache[key] = JSON.parse(raw);
            console.log(`[History] 已加载群聊 ${key}：${groupHistoryCache[key]?.length || 0} 条消息`);
        }
    } catch (e) { console.warn('[History] 加载群聊历史失败:', e.message); }
}

loadAllHistory();
loadAllGroupHistory();
loadCharacterLibrary();
loadJournal(currentCharacterId);
loadNotes();

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

// ── PUT /api/characters/dual/:id1/:id2（设置双角色模式）───────
app.put('/api/characters/dual/:id1/:id2', (req, res) => {
    const { id1, id2 } = req.params;
    if (!characterLibrary.has(id1)) return res.status(404).json({ error: `角色 ${id1} 不存在` });
    if (!characterLibrary.has(id2)) return res.status(404).json({ error: `角色 ${id2} 不存在` });
    if (id1 === id2) return res.status(400).json({ error: '不能选择相同的两个角色' });
    currentCharacterId = id1;
    secondaryCharacterId = id2;
    persistCharactersJson();
    res.json({ ok: true, characters: [characterLibrary.get(id1), characterLibrary.get(id2)] });
});

// ── GET /api/characters/dual（获取当前双角色配置）───────────────
app.get('/api/characters/dual', (req, res) => {
    if (!secondaryCharacterId) {
        return res.json({ dualMode: false });
    }
    const charA = characterLibrary.get(currentCharacterId);
    const charB = characterLibrary.get(secondaryCharacterId);
    if (!charA || !charB) {
        secondaryCharacterId = null;
        return res.json({ dualMode: false });
    }
    res.json({ dualMode: true, characters: [charA, charB] });
});

// ── DELETE /api/characters/dual（切换回单人模式）───────────────
app.delete('/api/characters/dual', (req, res) => {
    secondaryCharacterId = null;
    res.json({ ok: true, message: '已切换回单人模式' });
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
                audioTimer = setTimeout(sendNext, STT_REPLAY_INTERVAL_MS);
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
    try { fs.writeFileSync(path.join(VLM_IMAGES_DIR, 'debug_mic.wav'), wavBuf); } catch {}

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
    const ch = characterLibrary.get(characterId) || getCurrentCharacter();
    if (!ch) return res.status(500).json({ error: '没有可用角色，请先识别一个角色' });
    const history = getHistory(characterId);
    const journalPrompt = buildJournalMemoryPrompt(characterId);
    const messages = [
        { role: 'system', content: buildSystemPrompt(ch) },
        ...(journalPrompt ? [{ role: 'system', content: journalPrompt }] : []),
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
        const VALID_EXPRESSIONS = ['idle','happy','thinking','sad','angry'];
        let reply = raw, expression = 'idle';
        try {
            const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed  = JSON.parse(jsonStr);
            reply      = parsed.reply || raw;
            expression = VALID_EXPRESSIONS.includes(parsed.expression) ? parsed.expression : 'idle';
        } catch {
            // 模型没按格式输出时直接用原始文本
        }

        // 持久化这一轮对话（存纯文本）
        appendTurn(characterId, message, reply);

        console.log(`[Chat] (${characterId}) 用户: ${message} | 角色: ${reply} | 表情: ${expression} | 总耗时: ${Date.now() - t0}ms`);
        res.json({ reply, expression });

    } catch (err) {
        console.error('[LLM] 请求失败:', err.message);
        res.status(500).json({ error: '网络请求失败' });
    }
});

// ── POST /api/group-chat ─────────────────────────────────────────
// Body: { message: string }
// 双角色群聊：一次 LLM 调用同时生成两个角色的回复
app.post('/api/group-chat', async (req, res) => {
    let { message } = req.body;
    const isHeartbeat = message === '__heartbeat__';
    if (isHeartbeat) {
        message = '（用户暂时没说话，你们俩根据刚才的话题继续聊，互相回应对方说的话，观点可以有分歧，不要各说各的）';
    } else if (!message?.trim()) {
        return res.status(400).json({ error: '消息不能为空' });
    }
    if (!secondaryCharacterId) {
        return res.status(400).json({ error: '未设置双角色模式' });
    }

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return res.status(500).json({ error: 'DashScope API Key 未配置' });
    }

    const charA = characterLibrary.get(currentCharacterId);
    const charB = characterLibrary.get(secondaryCharacterId);
    if (!charA || !charB) {
        secondaryCharacterId = null;
        return res.status(500).json({ error: '角色数据异常，请重新设置双角色模式' });
    }

    const history = getGroupHistory(charA.id, charB.id);
    // 将所有历史折叠进 system prompt，避免 assistant 角色消息格式被 LLM 模仿
    const historyContext = history.map(msg => {
        if (msg.role === 'user') return `用户：${msg.content}`;
        return `${msg.characterName}：${msg.content}`;
    }).join('\n');
    const systemWithHistory = buildGroupSystemPrompt(charA, charB)
        + (historyContext ? `\n\n=== 对话历史 ===\n${historyContext}` : '');
    const messages = [
        { role: 'system', content: systemWithHistory },
        { role: 'user', content: message }
    ];

    const model = process.env.QWEN_CHAT_MODEL || 'qwen-turbo';
    const url   = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    const VALID_EXPRESSIONS = ['idle', 'happy', 'thinking', 'sad', 'angry'];

    try {
        const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
        console.log(`[GroupChat] 发送消息数: ${messages.length}，prompt 总字符: ${promptChars}`);
        const t0 = Date.now();
        const response = await fetchWithTimeout(url, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ model, messages, max_tokens: 400, temperature: 0.85, enable_thinking: false })
        }, 20000);
        console.log(`[GroupChat] API 响应: ${Date.now() - t0}ms`);

        if (!response.ok) {
            const t = await response.text();
            console.error('[GroupChat] LLM 错误:', t);
            return res.status(502).json({ error: `Qwen 返回错误: ${response.status}` });
        }

        const data = await response.json();
        console.log(`[GroupChat] JSON 解析完成: ${Date.now() - t0}ms`);
        const raw = data?.choices?.[0]?.message?.content?.trim() || '';

        // 解析 JSON，容错处理
        let replies = [];
        try {
            const jsonStr = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(jsonStr);
            if (parsed.replies && Array.isArray(parsed.replies)) {
                replies = parsed.replies.map(r => ({
                    characterId: r.characterId,
                    name: r.name || (r.characterId === charA.id ? charA.name : charB.name),
                    reply: r.reply || '',
                    expression: VALID_EXPRESSIONS.includes(r.expression) ? r.expression : 'idle'
                })).filter(r => r.reply && (r.characterId === charA.id || r.characterId === charB.id));
            }
        } catch (e) {
            console.error('[GroupChat] JSON 解析失败:', e.message, '| raw:', raw.slice(0, 120));
            // 尝试从 Name：content 格式回退提取
            const lineRe = new RegExp(`(${charA.name}|${charB.name})[：:]\\s*(.+?)(?=\\n(?:${charA.name}|${charB.name})[：:]|$)`, 'gs');
            let m;
            const fallbackReplies = [];
            while ((m = lineRe.exec(raw)) !== null) {
                const name = m[1];
                const text = m[2].trim();
                const id = name === charA.name ? charA.id : charB.id;
                if (text && !fallbackReplies.some(r => r.characterId === id)) {
                    fallbackReplies.push({ characterId: id, name, reply: text, expression: 'idle' });
                }
            }
            if (fallbackReplies.length >= 2) {
                replies = fallbackReplies;
                console.log('[GroupChat] 使用正则回退解析成功:', fallbackReplies.length, '条');
            }
        }

        // 保底：解析失败时生成角色相关的默认回复
        if (replies.length < 2) {
            const defaultReplies = [
                { characterId: charA.id, name: charA.name, reply: charA.catchphrases?.[0] || '嗯。', expression: 'idle' },
                { characterId: charB.id, name: charB.name, reply: charB.catchphrases?.[0] || '嗯。', expression: 'idle' }
            ];
            replies = defaultReplies;
        }

        // 持久化群聊历史
        appendGroupTurn(charA.id, charB.id, message, replies);

        console.log(`[GroupChat] (${charA.name}+${charB.name}) 用户: ${message} | 回复数: ${replies.length} | 总耗时: ${Date.now() - t0}ms`);
        res.json({ replies });

    } catch (err) {
        console.error('[GroupChat] 请求失败:', err.message);
        res.status(500).json({ error: '网络请求失败' });
    }
});

// ── GET /api/group-history/:id1/:id2 ────────────────────────────
app.get('/api/group-history/:id1/:id2', (req, res) => {
    res.json(getGroupHistory(req.params.id1, req.params.id2));
});

// ── GET /api/group-chat/prompt（调试：查看当前群聊 prompt）───────
app.get('/api/group-chat/prompt', (req, res) => {
    if (!secondaryCharacterId || !currentCharacterId) {
        return res.status(400).json({ error: '未设置双角色模式' });
    }
    const charA = characterLibrary.get(currentCharacterId);
    const charB = characterLibrary.get(secondaryCharacterId);
    if (!charA || !charB) return res.status(500).json({ error: '角色数据异常' });
    const history = getGroupHistory(charA.id, charB.id);
    const historyContext = history.map(msg => {
        if (msg.role === 'user') return `用户：${msg.content}`;
        return `${msg.characterName}：${msg.content}`;
    }).join('\n');
    const systemWithHistory = buildGroupSystemPrompt(charA, charB)
        + (historyContext ? `\n\n=== 对话历史 ===\n${historyContext}` : '');
    res.json({ system: systemWithHistory, historyCount: history.length });
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

app.get('/api/notes', (req, res) => {
    const characterId = String(req.query.characterId || currentCharacterId || '');
    const notes = noteEntries
        .filter(n => n.characterId === characterId)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map(normalizeNoteEntry);
    res.json({ notes });
});

app.post('/api/notes', async (req, res) => {
    const characterId = String(req.body?.characterId || currentCharacterId || '');
    const text = String(req.body?.text || '').trim();

    if (!characterLibrary.has(characterId)) {
        return res.status(400).json({ error: '无效的角色，无法写小纸条' });
    }
    if (!text) {
        return res.status(400).json({ error: '小纸条不能为空' });
    }
    if (text.length > 300) {
        return res.status(400).json({ error: '小纸条太长了，最多 300 字' });
    }

    const note = normalizeNoteEntry({
        id: `note_${randomUUID()}`,
        characterId,
        from: 'user',
        text,
        state: 'ready',
        createdAt: Date.now(),
    });

    noteEntries.push(note);
    saveNotes();
    completeNoteReply(characterId, note.id, text);
    res.status(201).json({ note });
});

app.get('/api/journal', (req, res) => {
    const characterId = String(req.query.characterId || currentCharacterId || '');
    // 若请求的角色与缓存不同，重新从对应文件加载
    if (characterId !== journalCurrentCharId) loadJournal(characterId);
    const entries = [...journalEntries]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(normalizeJournalEntry);
    const uniquePlaces = new Set(entries.map(e => String(e.place || '').trim()).filter(Boolean));
    res.json({
        entries,
        stats: {
            places: uniquePlaces.size,
            memories: entries.length,
        },
    });
});

app.post('/api/journal', rawImage, (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: '未收到图片数据' });
    }

    const characterId = String(req.headers['x-journal-character-id'] || currentCharacterId || '');
    if (!characterLibrary.has(characterId)) {
        return res.status(400).json({ error: '无效的角色，无法写入照片墙记忆' });
    }

    const mimeType = req.headers['content-type'] || 'image/jpeg';
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const id = `journal_${Date.now()}`;
    const imageName = `${id}.${ext}`;
    fs.writeFileSync(path.join(JOURNAL_IMAGES_DIR, imageName), req.body);

    const entry = normalizeJournalEntry({
        id,
        characterId,
        date: String(req.headers['x-journal-date'] || '').slice(0, 10),
        place: decodeURIComponent(String(req.headers['x-journal-place'] || '未知地点')),
        imageUrl: `/journal-images/${imageName}`,
        journalState: 'sensing',
        createdAt: Date.now(),
    });

    // 若当前缓存不是该角色，先加载再追加
    if (characterId !== journalCurrentCharId) loadJournal(characterId);
    journalEntries.unshift(entry);
    saveJournal(characterId);
    completeJournalEntry(id, Buffer.from(req.body), mimeType);
    res.status(201).json(entry);
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
    // 从本地库中提取已知角色名，帮助 VL 优先匹配已有角色
    const knownNames = [...characterLibrary.values()]
        .map(c => c.name)
        .filter(Boolean);
    const hint = knownNames.length > 0
        ? `提示：以下是本地已知角色列表，如果图中角色匹配其中之一请优先输出：${knownNames.join('、')}`
        : '';
    return `请识别图中角色，只返回以下 JSON，不加任何其他文字或代码块标记：
{
  "name": "角色个人名字（精确到个体，如'派蒙'，而非系列名'原神'）",
  "series": "所属作品/IP/系列名称"
}
要求：
- name 必须是角色自身的名字，不能只写作品名
- 如果图中有多个角色，只写最主要的那一个
- 不确定时填写最佳推测，不要留空`
// - `${hint}`
;
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
        vol:          MINIMAX_VOICE_VOL_MAP[name] || 1.0,
        avatar:       `/avatars/${id}.jpg`,
        catchphrases: searchInfo.catchphrases || [],
        personality:  searchInfo.personality  || '',
        worldview:    searchInfo.worldview    || '',
        background:   searchInfo.background   || '',
        reply_style:  searchInfo.reply_style  || '简短口语化，50字以内',
    };
}


// ── 参考图对比 ──────────────────────────────────────────
// 角色手办因角度/光线差异会被 VL 误识别为各种人物。
// 存储一张该角色的标准参考图，识别时把新图和参考图一起发给 VL 做"是不是同一个人"判断。
//
// 参考图文件命名：{characterId}.jpg（自动转换为 JPEG）
// ───────────────────────────────────────────────────────

function referenceImagePath(characterId) {
    return path.join(REFERENCE_DIR, `${characterId}.jpg`);
}

// 上传/更新角色的参考图
app.post('/api/reference/:charId', rawImage, (req, res) => {
    const { charId } = req.params;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: '未收到图片数据' });
    }
    const target = referenceImagePath(charId);
    fs.writeFileSync(target, req.body);
    console.log(`[参考图] 已保存 ${charId} → ${target} (${req.body.length} 字节)`);
    res.json({ ok: true, path: `/data/reference-images/${charId}.jpg` });
});

// 删除角色的参考图
app.delete('/api/reference/:charId', (req, res) => {
    const { charId } = req.params;
    const target = referenceImagePath(charId);
    try {
        fs.unlinkSync(target);
        console.log(`[参考图] 已删除 ${charId}`);
        res.json({ ok: true });
    } catch {
        res.status(404).json({ error: '参考图不存在' });
    }
});

// 查询某角色是否有参考图
app.get('/api/reference/:charId', (req, res) => {
    const { charId } = req.params;
    const exists = fs.existsSync(referenceImagePath(charId));
    res.json({ exists, charId });
});

// 列出所有参考图
app.get('/api/references', (req, res) => {
    const files = [];
    try {
        for (const f of fs.readdirSync(REFERENCE_DIR)) {
            if (f.endsWith('.jpg') || f.endsWith('.png')) {
                const charId = f.replace(/\.(jpg|png)$/, '');
                files.push({ charId, path: `/data/reference-images/${f}` });
            }
        }
    } catch {}
    res.json(files);
});

// 通过参考图验证：将新图与角色的参考图一起发给 VL，判断是否同一角色
async function verifyWithReference(imageBuffer, mimeType, skipCharId) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const model  = process.env.QWEN_VL_MODEL || 'qwen-vl-max';
    const url    = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    // 收集所有有参考图的角色（跳过 skipCharId，即 VL 已识别出的角色）
    const candidates = [];
    try {
        for (const f of fs.readdirSync(REFERENCE_DIR)) {
            if (!f.endsWith('.jpg') && !f.endsWith('.png')) continue;
            const charId = f.replace(/\.(jpg|png)$/, '');
            if (skipCharId && charId === skipCharId) continue;
            candidates.push({ charId, refPath: path.join(REFERENCE_DIR, f) });
        }
    } catch {}
    if (candidates.length === 0) return null;

    const newDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    for (const { charId, refPath } of candidates) {
        const refBuffer = fs.readFileSync(refPath);
        const refDataUrl = `data:image/jpeg;base64,${refBuffer.toString('base64')}`;

        const requestBody = {
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: refDataUrl } },
                    { type: 'image_url', image_url: { url: newDataUrl } },
                    { type: 'text', text:
                        `这是两张玩具/手办角色的照片。图1是参考图，图2是新拍的。\n` +
                        `请仔细对比面部特征、服饰造型、颜色等细节，这两张图是同一个角色吗？\n` +
                        `只回答"是"或"否"。` }
                ]
            }],
            max_tokens: 10,
            enable_thinking: false,
        };

        try {
            const resp = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify(requestBody),
            }, 30000);

            const data = await resp.json();
            let answer = data?.choices?.[0]?.message?.content?.trim() || '';
            answer = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

            if (answer === '是') {
                console.log(`[参考图] ✅ ${charId} 匹配（参考图对比通过）`);
                return charId;
            } else {
                console.log(`[参考图] ❌ ${charId} 不匹配（回答: ${answer || '空'}）`);
            }
        } catch (err) {
            console.warn(`[参考图] ${charId} 对比出错: ${err.message}`);
        }
    }
    return null;
}

// ── 识别流程核心（硬件和网页共用）───────────────────────────
async function runRecognition(imageBuffer, mimeType, res) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey || apiKey === 'your_dashscope_api_key_here') {
        return res.status(500).json({ error: 'DashScope API Key 未配置' });
    }

    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const debugPath = path.join(VLM_IMAGES_DIR, `debug_capture_${Date.now()}.${ext}`);
    try { fs.writeFileSync(debugPath, imageBuffer); } catch {}
    console.log(`[识别] 开始，图片: ${imageBuffer.length} 字节 → 已保存到 ${debugPath}`);

    try {
        // Step1: VL 模型看图 → 只拿 name 和 series
        const vlInfo = await extractCharacterFromImage(imageBuffer, mimeType);

        if (!vlInfo.name || vlInfo.name === '未知' || vlInfo.name === '未知角色') {
            return res.status(422).json({ error: '未能识别出已知角色，请换一张更清晰的图片' });
        }
        console.log(`[识别] VL 识别 → ${vlInfo.name}（${vlInfo.series || '未知系列'}）`);

        // 名字纠正：VL 模型常把长相相似的小众角色误识别为知名角色
        const NAME_OVERRIDES = { '甄嬛': '齐妃' };
        if (NAME_OVERRIDES[vlInfo.name]) {
            console.log(`[识别] 名字纠正: ${vlInfo.name} → ${NAME_OVERRIDES[vlInfo.name]}`);
            vlInfo.name = NAME_OVERRIDES[vlInfo.name];
        }

        // 规则命中本地库（按名字精确匹配）→ 先用参考图验证，防止 VL 误识别
        const libMatch = [...characterLibrary.values()].find(
            c => c.name === vlInfo.name
        );
        if (libMatch) {
            // 检查是否有其他角色的参考图能匹配上新照片（纠正 VL 把杜尚认成特朗普这类问题）
            const refMatch = await verifyWithReference(imageBuffer, mimeType, libMatch.id);
            if (refMatch && characterLibrary.has(refMatch)) {
                console.log(`[识别] VL 说 ${libMatch.name}，但参考图匹配为 ${characterLibrary.get(refMatch).name}，覆盖`);
                try { fs.writeFileSync(referenceImagePath(refMatch), imageBuffer); } catch {}
                setCurrentCharacter(refMatch);
                return res.json({ ...characterLibrary.get(refMatch), isCurrent: true });
            }
            console.log(`[识别] 命中本地库 → ${libMatch.name}，跳过联网搜索`);
            // 自动保存此照片作为该角色的参考图（覆盖旧图，逐次优化）
            try { fs.writeFileSync(referenceImagePath(libMatch.id), imageBuffer);
                console.log(`[识别] 已自动更新参考图: ${libMatch.id}`);
            } catch (e) { console.warn(`[识别] 保存参考图失败: ${e.message}`); }
            setCurrentCharacter(libMatch.id);
            return res.json({ ...libMatch, isCurrent: true });
        }

        // 未命中本地库 → 尝试参考图对比（解决 VL 把冷门角色识别成随机人物的问题）
        console.log(`[识别] 未命中本地库，尝试参考图对比...`);
        const matchedCharId = await verifyWithReference(imageBuffer, mimeType);
        if (matchedCharId && characterLibrary.has(matchedCharId)) {
            console.log(`[识别] 参考图命中 → ${characterLibrary.get(matchedCharId).name}`);
            try { fs.writeFileSync(referenceImagePath(matchedCharId), imageBuffer); } catch {}
            setCurrentCharacter(matchedCharId);
            return res.json({ ...characterLibrary.get(matchedCharId), isCurrent: true });
        }
        // 参考图命中了但该角色不在本地库（理论上不应发生，兜底继续走搜索）
        if (matchedCharId) {
            console.log(`[识别] 参考图命中 ${matchedCharId} 但不在本地库，继续联网搜索`);
            vlInfo.name = characterLibrary.get(matchedCharId)?.name || matchedCharId;
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
    let vol = Number(req.body?.vol);
    if (!Number.isFinite(vol) || vol <= 0) vol = 1.0;
    vol = Math.min(Math.max(vol, 0.1), 2.0);
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
                model: 'speech-2.8-hd',
                text:  text.trim(),
                voice_setting: {
                    voice_id: voice,
                    speed: 1.0,
                    vol,
                    pitch: 0,
                },
                audio_setting: { format: 'wav', sample_rate: 24000 },
            })
        }, 30000);

        const data = await response.json();
        console.log(`[TTS] 合成请求: ${Date.now() - t0}ms | voice=${voice} vol=${vol}`);

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
        res.set('Content-Type', 'audio/wav');
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
        bonjour.publish({ name: 'PopBox', type: 'http', port: PORT, txt: { app: 'popbox' } });
        console.log('   mDNS 服务:   PopBox._http._tcp.local:' + PORT + '  (CoreS3 自动发现)');
    } catch (e) {
        console.warn('   mDNS 广播失败，CoreS3 请手动填写 IP:', localIP);
    }

    console.log('\n PopBox 后端服务已启动');
    console.log(`   浏览器访问:  http://localhost:${PORT}`);
    console.log(`   本机 IP:     http://${localIP}:${PORT}`);
    console.log(`   对话历史保存到: ${DATA_DIR}\n`);
});
