// ─────────────────────────────────────────────────────────────
// PopBox Web 模拟器
// 使用浏览器 Web Speech API（免费，无需 STT Key）
// ─────────────────────────────────────────────────────────────

const app = (() => {
    // ── DOM 引用 ─────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const elCharName      = $('char-name');
    const elStatus        = $('status-text');
    const elBadge         = $('status-badge');
    const elChatHistory   = $('chat-history');
    const elMicBtn        = $('mic-btn');
    const elMicLabel      = $('mic-label');
    const elTextInput     = $('text-input');
    const elError         = $('error-banner');
    const elCamBtn        = $('cam-btn');
    const elImgUpload     = $('img-upload');
    const elRecResult     = $('recognition-result');
    const elResultContent = $('result-content');
    const elCharCards     = $('char-cards');
    const elCharCount     = $('char-panel-count');

    // ── 状态 ─────────────────────────────────────────────────
    let state = 'idle';
    let recognition = null;
    let speechSupported = false;
    let characterId     = 'xiao_ling';
    let charName        = '';
    let charVoice       = '';
    let charAvatarBase  = '';   // 当前角色头像基础路径
    let thinkingEl      = null;
    let currentAudio    = null;
    const elAvatar = document.getElementById('avatar-img');

    // 和硬件 _resolveAvatarPath 逻辑相同：在扩展名前插入 _expression
    // 尝试加载变体，失败则 fallback 到基础路径
    function setAvatarExpression(expression) {
        if (!elAvatar || !charAvatarBase) return;
        const tryLoad = (src, fallback) => {
            const img = new Image();
            img.onload  = () => { elAvatar.src = src; elAvatar.style.display = ''; };
            img.onerror = () => fallback ? tryLoad(fallback, null)
                                         : (elAvatar.style.display = 'none');
            img.src = src;
        };
        if (!expression || expression === 'idle') {
            tryLoad(charAvatarBase, null);
            return;
        }
        const dot = charAvatarBase.lastIndexOf('.');
        const variant = dot >= 0
            ? charAvatarBase.slice(0, dot) + '_' + expression + charAvatarBase.slice(dot)
            : charAvatarBase;
        tryLoad(variant, charAvatarBase);
    }

    // ── 初始化 ───────────────────────────────────────────────
    async function init() {
        await loadCharacters();
        initSpeechRecognition();
    }

    async function loadCharacters() {
        try {
            const res  = await fetch('/api/characters');
            const list = await res.json();
            renderCharCards(list);
            const cur = list.find(c => c.isCurrent) || list[0];
            if (cur) {
                elCharName.textContent = cur.name;
                charName       = cur.name;
                characterId    = cur.id;
                charVoice      = cur.voice  || '';
                charAvatarBase = cur.avatar || '';
                setAvatarExpression('idle');
            }
        } catch {
            elCharName.textContent = '小铃';
            charName = '小铃';
        }
    }

    function initSpeechRecognition() {
        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            speechSupported = false;
            elMicLabel.textContent = '● 语音不可用';
            elMicBtn.style.opacity = '0.5';
            console.warn('[Speech] 浏览器不支持 Web Speech API（建议使用 Chrome）');
            return;
        }

        speechSupported = true;
        recognition = new SpeechRecognition();
        recognition.lang          = 'zh-CN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log('[Speech] 识别结果:', transcript);
            sendMessage(transcript);
        };

        recognition.onerror = (event) => {
            console.error('[Speech] 错误:', event.error);
            if (event.error === 'no-speech') {
                showError('没有检测到语音，请再试一次');
            } else if (event.error === 'not-allowed') {
                showError('麦克风权限被拒绝，请在浏览器中允许麦克风访问');
            }
            setState('idle');
        };

        recognition.onend = () => {
            if (state === 'recording') setState('idle');
        };
    }

    // ── 状态管理 ─────────────────────────────────────────────
    function setState(newState) {
        state = newState;
        hideError();

        const statusMap = {
            idle:        { text: '待机',    cls: 'idle',       btn: 'idle',       mic: '点击说话', cam: '识别角色' },
            recording:   { text: '录音中',  cls: 'recording',  btn: 'recording',  mic: '■ 停止',   cam: '识别角色' },
            processing:  { text: '思考中',  cls: 'processing', btn: 'processing', mic: '⏳ 思考中', cam: '识别角色' },
            recognizing: { text: '识别中',  cls: 'processing', btn: 'processing', mic: '点击说话', cam: '识别中…' },
        };

        const s = statusMap[newState] || statusMap.idle;
        elStatus.textContent = s.text;
        if (elBadge) elBadge.className = `status-badge ${s.cls}`;

        elMicBtn.className = 'btn btn-purple' + (
            newState === 'recording'  ? ' recording' :
            newState === 'processing' ? ' busy' : ''
        );
        elMicLabel.textContent = s.mic;

        if (elCamBtn) {
            const elCamLabel = document.getElementById('cam-label');
            if (elCamLabel) elCamLabel.textContent = s.cam;
            elCamBtn.className = 'btn btn-yellow' +
                (newState === 'recognizing' ? ' recognizing' : '');
        }

        setAvatarExpression(newState === 'processing' ? 'thinking' : 'idle');
    }

    // ── 聊天历史渲染 ─────────────────────────────────────────
    function clearPlaceholder() {
        const ph = elChatHistory.querySelector('.msg-system');
        if (ph) ph.remove();
    }

    function addUserMsg(text, ts) {
        clearPlaceholder();
        const el = document.createElement('div');
        el.className = 'msg-user';
        el.appendChild(makeHeader('YOU', ts));
        const body = document.createElement('div');
        body.textContent = text;
        el.appendChild(body);
        elChatHistory.appendChild(el);
        scrollToBottom();
    }

    function stripTtsMarkers(text) {
        return text
            .replace(/\(laughs?\)|(\(sighs?\))|(\(gasps?\))|(\(cries?\))|(\(whispers?\))/gi, '')
            .replace(/<#[\d.]+#>/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function addCharMsg(text, ts) {
        removeThinker();
        const wrap = document.createElement('div');
        wrap.className = 'msg-char';
        wrap.appendChild(makeHeader(charName || '角色', ts));
        const body = document.createElement('div');
        body.textContent = stripTtsMarkers(text);
        wrap.appendChild(body);
        elChatHistory.appendChild(wrap);
        scrollToBottom();
    }

    function showThinker() {
        removeThinker();
        thinkingEl = document.createElement('div');
        thinkingEl.className = 'msg-thinking';
        thinkingEl.textContent = '思考中';
        elChatHistory.appendChild(thinkingEl);
        scrollToBottom();
    }

    function removeThinker() {
        if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
    }

    function scrollToBottom() {
        elChatHistory.scrollTop = elChatHistory.scrollHeight;
    }

    function fmtTime(ts) {
        const d = new Date(ts || Date.now());
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    function makeHeader(label, ts) {
        const h = document.createElement('div');
        h.className = 'msg-header';
        const l = document.createElement('span');
        l.className = 'msg-label';
        l.textContent = label;
        const t = document.createElement('span');
        t.className = 'msg-time';
        t.textContent = fmtTime(ts);
        h.appendChild(l);
        h.appendChild(t);
        return h;
    }

    // 清空聊天区并渲染历史记录
    async function loadAndRenderHistory(charId, name) {
        elChatHistory.innerHTML = '';
        try {
            const res  = await fetch(`/api/history/${charId}`);
            const hist = await res.json();
            if (!hist.length) {
                elChatHistory.innerHTML = '<div class="msg-system">还没有聊天记录，打个招呼吧～</div>';
                return;
            }
            // 按对话对渲染（user 在前，assistant 紧跟）
            for (const msg of hist) {
                if (msg.role === 'user') {
                    const el = document.createElement('div');
                    el.className = 'msg-user';
                    el.appendChild(makeHeader('YOU', msg.ts));
                    const body = document.createElement('div');
                    body.textContent = msg.content;
                    el.appendChild(body);
                    elChatHistory.appendChild(el);
                } else {
                    const wrap = document.createElement('div');
                    wrap.className = 'msg-char';
                    wrap.appendChild(makeHeader(name || charName, msg.ts));
                    const body = document.createElement('div');
                    body.textContent = msg.content;
                    wrap.appendChild(body);
                    elChatHistory.appendChild(wrap);
                }
            }
            scrollToBottom();
        } catch (e) {
            elChatHistory.innerHTML = '<div class="msg-system">历史记录加载失败</div>';
        }
    }

    // ── 麦克风按钮点击 ───────────────────────────────────────
    function onMicTap() {
        if (!speechSupported) {
            showError('此浏览器不支持语音输入，请使用底部文字输入框，或改用 Chrome 浏览器');
            return;
        }

        if (state === 'idle' || state === 'reply') {
            setState('recording');
            recognition.start();
        } else if (state === 'recording') {
            recognition.stop();
            setState('processing');
        } else if (state === 'processing') {
            // 忽略
        }
    }

    // ── 文字输入发送 ─────────────────────────────────────────
    function sendText() {
        const msg = elTextInput.value.trim();
        if (!msg || state === 'processing') return;
        elTextInput.value = '';
        sendMessage(msg);
    }

    // ── 发送消息给后端 ───────────────────────────────────────
    async function sendMessage(userText) {
        if (!userText.trim()) {
            setState('idle');
            return;
        }

        addUserMsg(userText);
        setState('processing');
        showThinker();

        try {
            const res  = await fetch('/api/chat', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ message: userText, characterId })
            });
            const data = await res.json();

            if (!res.ok || data.error) {
                showError(data.error || '服务器错误');
                removeThinker();
                setState('idle');
                return;
            }

            // 等 TTS 音频准备好后再揭示消息、恢复状态、播放
            let audio = null;
            try {
                audio = await fetchAudio(data.reply);
            } catch (e) {
                console.error('[TTS] 加载失败:', e.message);
                showError('TTS 失败: ' + e.message);
            }
            addCharMsg(data.reply);
            setState('idle');
            if (data.expression) setAvatarExpression(data.expression);
            if (audio) audio.play();

        } catch (err) {
            showError('网络请求失败：' + err.message);
            removeThinker();
            setState('idle');
        }
    }

    // ── TTS：fetch 音频，返回准备好的 Audio 对象（不自动播放）──
    async function fetchAudio(text) {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        const res = await fetch('/api/tts', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text, voice: charVoice })
        });
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        const blob  = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        currentAudio = audio;
        audio.onended = () => { currentAudio = null; };
        return audio;
    }

    // ── 错误提示 ─────────────────────────────────────────────
    function showError(msg) {
        elError.textContent = '⚠ ' + msg;
        elError.style.display = 'block';
    }
    function hideError() {
        elError.style.display = 'none';
    }

    // ── 角色卡片渲染 ─────────────────────────────────────────
    function renderCharCards(list) {
        if (!elCharCards) return;
        elCharCount.textContent = `${list.length} 个角色`;
        elCharCards.innerHTML = list.map(ch => `
            <div class="char-card ${ch.isCurrent ? 'active' : ''}"
                 onclick="app.switchCharacter('${ch.id}')">
                <span class="char-card-del" onclick="event.stopPropagation();app.deleteCharacter('${ch.id}')" title="删除">×</span>
                <div class="char-card-name">${ch.name}</div>
                <div class="char-card-series">${ch.series || ''}</div>
            </div>
        `).join('');
    }

    async function switchCharacter(id) {
        if (id === characterId) return;
        try {
            const res  = await fetch(`/api/characters/current/${id}`, { method: 'PUT' });
            const data = await res.json();
            if (!res.ok) return showError(data.error || '切换失败');
            characterId    = id;
            charName       = data.current?.name   || '';
            charVoice      = data.current?.voice  || '';
            charAvatarBase = data.current?.avatar || '';
            elCharName.textContent = charName;
            setAvatarExpression('idle');
            setState('idle');
            await loadAndRenderHistory(id, charName);
            await loadCharacters();
        } catch (e) { showError('切换失败: ' + e.message); }
    }

    async function deleteCharacter(id) {
        if (!confirm(`确定删除这个角色吗？对话历史也会保留。`)) return;
        try {
            const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) return showError(data.error || '删除失败');
            await loadCharacters();
            if (id === characterId) {
                const res2 = await fetch('/api/character');
                const cur  = await res2.json();
                elCharName.textContent = cur.name;
                charName    = cur.name;
                characterId = cur.id;
            }
        } catch (e) { showError('删除失败: ' + e.message); }
    }

    // ── 识别角色 ─────────────────────────────────────────────
    function onRecognizeTap() {
        if (state === 'processing' || state === 'recognizing') return;
        elImgUpload.click();
    }

    async function onImageSelected(input) {
        const file = input.files[0];
        if (!file) return;
        input.value = '';

        setState('recognizing');
        elRecResult.style.display = 'none';

        try {
            const arrayBuffer = await file.arrayBuffer();
            const res = await fetch('/api/recognize/upload', {
                method:  'POST',
                headers: { 'Content-Type': file.type || 'image/jpeg' },
                body:    arrayBuffer
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                showError(data.error || '识别失败');
                setState('idle');
                return;
            }

            characterId    = data.id   || characterId;
            charName       = data.name || '未知角色';
            charVoice      = data.voice   || '';
            charAvatarBase = data.avatar  || '';
            elCharName.textContent = charName;
            setAvatarExpression('idle');
            setState('idle');
            const greeting = `${data.catchphrases?.[0] || ''}我是${charName}！很高兴认识你～`;
            addCharMsg(greeting);
            fetchAudio(greeting).then(audio => audio?.play()).catch(() => {});
            await loadCharacters();

            elResultContent.innerHTML = `
                <b>角色：</b>${data.name}<br>
                <b>性格：</b>${data.personality || '-'}<br>
                <b>世界观：</b>${data.worldview || '-'}<br>
                <b>背景：</b>${data.background || '-'}<br>
                <b>口头禅：</b>${(data.catchphrases || []).join('、') || '-'}
            `;
            elRecResult.style.display = 'block';

        } catch (err) {
            showError('识别请求失败：' + err.message);
            setState('idle');
        }
    }

    // ── 启动 ─────────────────────────────────────────────────
    init();

    return { onMicTap, sendText, onRecognizeTap, onImageSelected,
             switchCharacter, deleteCharacter };
})();
