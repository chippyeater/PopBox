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
    const elCountModal    = $('count-modal');
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
    let pendingCharCount = 0;    // 0=未选, 1或2=已选
    let capturingSecond  = false; // 双人模式正在选第二张
    let firstCharacterId   = null; // 双人模式第一张图的角色 ID
    let firstCharacterData = null; // 双人模式第一个角色的完整数据
    let isGroupChat        = false;
    let groupCharacters    = [];
    let ttsQueue           = [];
    let isTtsPlaying       = false;
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
        elCharName.textContent = '—';
        elChatHistory.innerHTML = '<div class="msg-system">点击「识别角色」拍照入住角色<br>或从收藏夹选择一个角色开始聊天</div>';
    }

    async function loadCharacters() {
        try {
            const res  = await fetch('/api/characters');
            const list = await res.json();
            renderCharCards(list);
        } catch { }
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

        setAvatarExpression('idle');
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

    function addCharMsg(text, ts, nameOverride, extraClass) {
        removeThinker();
        const wrap = document.createElement('div');
        wrap.className = `msg-char ${extraClass || ''}`;
        wrap.appendChild(makeHeader(nameOverride || charName || '角色', ts));
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

        if (!characterId && !isGroupChat) {
            showError('请先识别或选择一个角色');
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

    // ── 群聊停止关键词 ──────────────────────────────────────
    const STOP_KEYWORDS = ['不聊了', '不说了', '下次再', '先这样', '拜拜', '晚安', '睡了', '休息', '先睡了', '到此为止', '结束', '下次聊'];

    function isStopMessage(text) {
        return STOP_KEYWORDS.some(kw => text.includes(kw));
    }

    function stopGroupChatAuto() {
        clearTimeout(idleTimer);
        idleTimer = null;
        addSystemMsg('群聊已停止。你可以继续单独聊天。');
    }

    // ── 发送消息给后端 ───────────────────────────────────────
    let idleTimer = null;

    async function sendMessage(userText, isHeartbeat) {
        if (!userText.trim()) {
            setState('idle');
            return;
        }

        if (!characterId && !isGroupChat) {
            showError('请先选择或识别一个角色');
            setState('idle');
            return;
        }

        if (!isHeartbeat) {
            addUserMsg(userText);
        }
        // 群聊模式检测用户退出意图
        if (isGroupChat && !isHeartbeat && isStopMessage(userText)) {
            stopGroupChatAuto();
            setState('idle');
            return;
        }
        setState('processing');
        showThinker();

        if (isGroupChat) {
            try {
                const res  = await fetch('/api/group-chat', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ message: isHeartbeat ? '__heartbeat__' : userText })
                });
                const data = await res.json();

                if (!res.ok || data.error) {
                    showError(data.error || '服务器错误');
                    removeThinker();
                    setState('idle');
                    return;
                }

                // 渲染两个角色的回复（不同颜色气泡）
                const replies = data.replies || [];
                for (const r of replies) {
                    const charClass = groupCharacters.length >= 2 && r.characterId === groupCharacters[0].id
                        ? 'msg-char-a' : 'msg-char-b';
                    addCharMsg(r.reply, null, r.name, charClass);
                }

                setState('idle');

                // 播放 TTS 序列
                const queue = replies
                    .map(r => {
                        const gc = groupCharacters.find(c => c.id === r.characterId);
                        return { text: r.reply, voice: gc?.voice || '' };
                    })
                    .filter(r => r.voice);
                playTtsSequence(queue);

                // 空闲心跳：45秒后角色们自动继续聊
                clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    if (isGroupChat && state !== 'processing') {
                        sendMessage('__heartbeat__', true);
                    }
                }, 45000);

            } catch (err) {
                showError('网络请求失败：' + err.message);
                removeThinker();
                setState('idle');
            }
            return;
        }

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
    async function fetchAudio(text, voice) {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        const res = await fetch('/api/tts', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text, voice: voice || charVoice })
        });
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        const blob  = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        currentAudio = audio;
        audio.onended = () => { currentAudio = null; };
        return audio;
    }

    // ── TTS 序列播放（群聊用）──────────────────────────────────
    function playTtsSequence(queue) {
        ttsQueue = queue.slice();
        if (isTtsPlaying) return;
        playNextTts();
    }

    function playNextTts() {
        if (ttsQueue.length === 0) {
            isTtsPlaying = false;
            return;
        }
        isTtsPlaying = true;
        const { text, voice } = ttsQueue.shift();
        fetchAudio(text, voice).then(audio => {
            if (audio) {
                audio.onended = () => {
                    currentAudio = null;
                    playNextTts();
                };
                audio.play();
            } else {
                playNextTts();
            }
        }).catch(() => playNextTts());
    }

    // ── 群聊模式管理 ─────────────────────────────────────────────
    let pickerSelected = [];

    function openGroupPicker() {
        if (isGroupChat) {
            exitGroupChat();
            return;
        }
        pickerSelected = [];
        updatePickerConfirmBtn();
        const list = document.getElementById('group-picker-list');
        if (!list) return;
        // 从角色库渲染
        fetch('/api/characters').then(res => res.json()).then(chars => {
            list.innerHTML = chars.map(ch => `
                <div class="group-picker-item" data-id="${ch.id}"
                     onclick="app.toggleGroupPickerItem('${ch.id}')">
                    <div class="picker-check">○</div>
                    <div class="picker-info">
                        <div class="picker-name">${ch.name}</div>
                        <div class="picker-series">${ch.series || '独立角色'}</div>
                    </div>
                    <div class="picker-num"></div>
                </div>
            `).join('');
        }).catch(() => showError('加载角色列表失败'));
        document.getElementById('group-picker-modal').style.display = 'flex';
    }

    function closeGroupPicker() {
        document.getElementById('group-picker-modal').style.display = 'none';
        pickerSelected = [];
    }

    function toggleGroupPickerItem(id) {
        const idx = pickerSelected.indexOf(id);
        if (idx >= 0) {
            pickerSelected.splice(idx, 1);
        } else {
            if (pickerSelected.length >= 2) {
                showError('最多选择两位角色');
                return;
            }
            pickerSelected.push(id);
        }
        // 更新 UI
        const items = document.querySelectorAll('.group-picker-item');
        items.forEach(el => {
            const elId = el.dataset.id;
            const pos = pickerSelected.indexOf(elId);
            el.classList.toggle('selected', pos >= 0);
            el.querySelector('.picker-check').textContent = pos >= 0 ? '⦿' : '○';
            el.querySelector('.picker-num').textContent = pos >= 0 ? `${pos + 1}` : '';
        });
        updatePickerConfirmBtn();
    }

    function updatePickerConfirmBtn() {
        const btn = document.getElementById('group-picker-confirm');
        if (!btn) return;
        const disabled = pickerSelected.length < 2;
        btn.disabled = disabled;
        btn.textContent = disabled ? `已选 ${pickerSelected.length}/2 位角色` : '开始群聊';
    }

    async function confirmGroupChat() {
        if (pickerSelected.length < 2) return;
        const [id1, id2] = pickerSelected;
        closeGroupPicker();

        try {
            const dualRes = await fetch(`/api/characters/dual/${id1}/${id2}`, { method: 'PUT' });
            const dualData = await dualRes.json();
            if (!dualRes.ok) return showError(dualData.error || '群聊设置失败');
            await setupGroupChat();
        } catch (e) {
            showError('启动群聊失败: ' + e.message);
        }
    }

    async function setupGroupChat() {
        try {
            const res = await fetch('/api/characters/dual');
            const data = await res.json();
            if (!data.dualMode) throw new Error('未设置双角色模式');
            isGroupChat = true;
            groupCharacters = data.characters.map(c => ({
                id: c.id, name: c.name, voice: c.voice
            }));
            elCharName.textContent = `${groupCharacters[0].name} + ${groupCharacters[1].name}`;
            elStatus.textContent = '群聊';
            if (elBadge) {
                elBadge.className = 'status-badge recognizing';
            }
            // 刷新角色卡片（让群聊按钮变为退出）
            await loadCharacters();
            await loadAndRenderGroupHistory(groupCharacters[0].id, groupCharacters[1].id);
        } catch (e) {
            showError('进入群聊模式失败: ' + e.message);
            isGroupChat = false;
        }
    }

    function exitGroupChat() {
        clearTimeout(idleTimer);
        isGroupChat = false;
        groupCharacters = [];
        if (elBadge) elBadge.className = 'status-badge idle';
        elStatus.textContent = '待机';
        // 重新加载当前单人角色
        loadCharacters().then(() => {
            loadAndRenderHistory(characterId, charName);
        });
    }

    async function loadAndRenderGroupHistory(id1, id2) {
        elChatHistory.innerHTML = '';
        try {
            const res = await fetch(`/api/group-history/${id1}/${id2}`);
            const hist = await res.json();
            if (!hist.length) {
                elChatHistory.innerHTML = '<div class="msg-system">三人聊天开始了，打个招呼吧～</div>';
                return;
            }
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
                    const charClass = groupCharacters.length >= 2 && msg.characterId === groupCharacters[0].id
                        ? 'msg-char-a' : 'msg-char-b';
                    wrap.className = `msg-char ${charClass}`;
                    wrap.appendChild(makeHeader(msg.characterName || '角色', msg.ts));
                    const body = document.createElement('div');
                    body.textContent = msg.content;
                    wrap.appendChild(body);
                    elChatHistory.appendChild(wrap);
                }
            }
            scrollToBottom();
        } catch (e) {
            elChatHistory.innerHTML = '<div class="msg-system">群聊历史加载失败</div>';
        }
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
        // 角色数 >= 2 时显示群聊按钮
        const groupBtn = document.getElementById('group-chat-btn');
        if (groupBtn) {
            groupBtn.style.display = list.length >= 2 ? '' : 'none';
            groupBtn.textContent = isGroupChat ? '退出群聊' : '';
            groupBtn.innerHTML = isGroupChat
                ? '退出群聊'
                : `<svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                     <circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/>
                     <circle cx="14" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/>
                     <path d="M2 17c0-3 2.5-5 5-5h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                     <path d="M19 17c0-3-2.5-5-5-5h-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                     <path d="M7 12c0-2 1.5-3 3.5-3s3.5 1 3.5 3" stroke="currentColor" stroke-width="1.5"/>
                   </svg>
                   群聊`;
        }
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
        if (id === characterId && !isGroupChat) return;
        try {
            const res  = await fetch(`/api/characters/current/${id}`, { method: 'PUT' });
            const data = await res.json();
            if (!res.ok) return showError(data.error || '切换失败');
            characterId    = id;
            charName       = data.current?.name   || '';
            charVoice      = data.current?.voice  || '';
            charAvatarBase = data.current?.avatar || '';
            isGroupChat    = false;  // 切换到单人角色退出群聊
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
        // 双人模式进行中：直接打开文件选择器继续拍第二位
        if (capturingSecond) {
            elImgUpload.click();
            return;
        }
        elCountModal.style.display = 'block';
    }

    function closeCountModal() {
        elCountModal.style.display = 'none';
    }

    function onCountSelected(count) {
        elCountModal.style.display = 'none';
        pendingCharCount = count;
        capturingSecond = false;
        if (count === 1) {
            firstCharacterId = null;
            firstCharacterData = null;
        }
        elImgUpload.click();
    }

    async function onImageSelected(input) {
        console.log('[Upload] onImageSelected called, files:', input?.files?.length);
        const file = input.files && input.files[0];
        if (!file) { console.warn('[Upload] no file'); return; }
        console.log('[Upload] file:', file.name, file.type, file.size);
        input.value = '';

        setState('recognizing');
        elRecResult.style.display = 'none';

        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log('[Upload] read', arrayBuffer.length, 'bytes');
            const res = await fetch('/api/recognize/upload', {
                method:  'POST',
                headers: { 'Content-Type': file.type || 'image/jpeg' },
                body:    arrayBuffer
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                showError(data.error || '识别失败');
                setState('idle');
                pendingCharCount = 0;
                capturingSecond = false;
                return;
            }

            characterId    = data.id   || characterId;
            charName       = data.name || '未知角色';
            charVoice      = data.voice   || '';
            charAvatarBase = data.avatar  || '';
            elCharName.textContent = charName;
            setAvatarExpression('idle');
            setState('idle');

            // 双人模式：拍完第一个需要拍第二个
            if (pendingCharCount === 2 && !capturingSecond) {
                firstCharacterId = data.id;
                firstCharacterData = { ...data };
                capturingSecond = true;
                setState('idle');
                addCharMsg(`✅ ${data.name} 已入住！请再点击「识别角色」选择第二位角色。`);
                return;
            }

            // 双人模式：第二张拍完 → 自动进入群聊模式
            if (firstCharacterId) {
                try {
                    await fetch(`/api/characters/dual/${firstCharacterId}/${data.id}`, { method: 'PUT' });
                    // 展示两个角色的识别信息
                    const combinedGreeting = `双人组合已就位！${firstCharacterData.name} 和 ${data.name} 一起来陪你聊天啦～`;
                    addCharMsg(combinedGreeting);
                    await setupGroupChat();
                    setState('idle');
                } catch (e) {
                    showError('双人模式设置失败: ' + e.message);
                    setState('idle');
                }
                firstCharacterId = null;
                firstCharacterData = null;
                pendingCharCount = 0;
                capturingSecond = false;
                return;
            }

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
        pendingCharCount = 0;
        capturingSecond = false;
    }

    // ── 启动 ─────────────────────────────────────────────────
    init();

    return { onMicTap, sendText, onRecognizeTap, onCountSelected, closeCountModal, onImageSelected,
             switchCharacter, deleteCharacter, exitGroupChat,
             openGroupPicker, closeGroupPicker, toggleGroupPickerItem, confirmGroupChat };
})();
