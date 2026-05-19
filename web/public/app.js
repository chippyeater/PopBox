// ─────────────────────────────────────────────────────────────
// PopBox Web 模拟器
// 使用浏览器 Web Speech API（免费，无需 STT Key）
// ─────────────────────────────────────────────────────────────

const app = (() => {
    // ── DOM 引用 ─────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const elCharName   = $('char-name');
    const elStatus     = $('status-text');
    const elChatText   = $('chat-text');
    const elMicBtn     = $('mic-btn');
    const elMicLabel   = $('mic-label');
    const elTextInput  = $('text-input');
    const elError      = $('error-banner');

    // ── 状态 ─────────────────────────────────────────────────
    let state = 'idle';       // idle | recording | processing
    let recognition = null;   // Web Speech API 实例
    let speechSupported = false;

    // ── 初始化 ───────────────────────────────────────────────
    async function init() {
        await loadCharacter();
        initSpeechRecognition();
    }

    async function loadCharacter() {
        try {
            const res  = await fetch('/api/character');
            const data = await res.json();
            elCharName.textContent = data.name || '未知角色';
        } catch {
            elCharName.textContent = '小铃';
        }
    }

    function initSpeechRecognition() {
        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            speechSupported = false;
            elMicLabel.textContent = '● 语音不可用（请用文字输入）';
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
            // recognition 自动结束（非手动停止）时重置
            if (state === 'recording') setState('idle');
        };
    }

    // ── 状态管理 ─────────────────────────────────────────────
    function setState(newState, chatMsg) {
        state = newState;
        hideError();

        const statusMap = {
            idle:       { text: '● 待机',    cls: 'idle',       btn: 'idle',       mic: '● 点击说话' },
            recording:  { text: '● 录音中…', cls: 'recording',  btn: 'recording',  mic: '■ 停止' },
            processing: { text: '● 思考中…', cls: 'processing', btn: 'processing', mic: '⏳ 思考中…' },
        };

        const s = statusMap[newState] || statusMap.idle;
        elStatus.textContent = s.text;
        elStatus.className   = `status-text ${s.cls}`;
        elMicBtn.className   = `mic-btn ${s.btn}`;
        elMicLabel.textContent = s.mic;

        if (newState === 'recording') {
            elMicLabel.classList.add('recording-blink');
        } else {
            elMicLabel.classList.remove('recording-blink');
        }

        if (chatMsg !== undefined) {
            elChatText.textContent  = chatMsg;
            elChatText.className    = 'chat-text' + (chatMsg ? '' : ' placeholder');
        }
    }

    // ── 麦克风按钮点击 ───────────────────────────────────────
    function onMicTap() {
        if (!speechSupported) {
            showError('此浏览器不支持语音输入，请使用底部文字输入框，或改用 Chrome 浏览器');
            return;
        }

        if (state === 'idle' || state === 'reply') {
            setState('recording', '');
            recognition.start();

        } else if (state === 'recording') {
            recognition.stop();
            setState('processing', '…');
            // onresult 会自动触发 sendMessage

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

        setState('processing', `你说：${userText}\n\n思考中…`);

        try {
            const res  = await fetch('/api/chat', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ message: userText })
            });
            const data = await res.json();

            if (!res.ok || data.error) {
                showError(data.error || '服务器错误');
                setState('idle');
                return;
            }

            // 展示角色回复
            setState('idle', data.reply);
            elChatText.className = 'chat-text';

            // [EXTENSION POINT] 后续在此存入对话记忆

        } catch (err) {
            showError('网络请求失败：' + err.message);
            setState('idle');
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

    // ── 启动 ─────────────────────────────────────────────────
    init();

    return { onMicTap, sendText };
})();
