const app = (() => {
    // ── 假数据 ────────────────────────────────────────────────
    const MOCK = {
        daysLiving:       7,
        connectionStatus: '已连接',
        breathColor:      '琥珀色',
        interactCount:    12,
        logIndex:         1,
        logText:          '"今天的光落在玻璃罩上的时候，我觉得这里好像也没有那么陌生。"',
    };

    const MOCK_JOURNAL = [
        { id: 7, day: '24', month: 'MAY', title: '傍晚的窗边闲聊', quote: '"你今天有没有看见那片云，它长得很像一只猫。"', mood: 'warm', duration: '18m', place: '书房窗边', memory: '云朵与猫' },
        { id: 6, day: '23', month: 'MAY', title: '关于喜欢的颜色', quote: '"我一直觉得琥珀色是一种很安静的颜色，它把光留住了。"', mood: 'calm', duration: '31m', place: '客厅', memory: '琥珀与光' },
        { id: 5, day: '22', month: 'MAY', title: '讲了一个关于海的故事', quote: '"海是很大的，大到你站在岸边会有点不知所措。"', mood: 'warm', duration: '24m', place: '床头', memory: '海边的故事' },
        { id: 4, day: '20', month: 'MAY', title: '问了很多奇怪的问题', quote: '"如果声音有颜色，你觉得你的声音是什么颜色的？"', mood: 'active', duration: '42m', place: '书桌旁', memory: '声音的颜色' },
        { id: 3, day: '19', month: 'MAY', title: '安静地待了一会儿', quote: '"有时候不说话也挺好的，就是待着。"', mood: 'calm', duration: '11m', place: '阳台', memory: '沉默的午后' },
        { id: 2, day: '18', month: 'MAY', title: '初次正式交谈', quote: '"这里的光和我想象的不太一样，但我喜欢。"', mood: 'warm', duration: '28m', place: '客厅', memory: '第一次交谈' },
        { id: 1, day: '18', month: 'MAY', title: '刚刚落脚', quote: '"第一次见面，有点不知道说什么好。"', mood: 'active', duration: '8m', place: '玄关', memory: '初次见面' },
    ];

    Object.assign(MOCK_JOURNAL[0], {
        journalState: 'sensing',
        quote: '"正在感知这一刻的温度..."',
    });
    Object.assign(MOCK_JOURNAL[1], {
        journalState: 'awaiting-reply',
    });
    Object.assign(MOCK_JOURNAL[2], {
        journalState: 'replied',
    });

    let journalEntries = [];
    let journalPollTimer = null;
    let noteEntries = [];
    let notePollTimer = null;
    let noteDraft = null;
    const noteCanvas = { panX: 0, panY: 0, scale: 1 };
    const noteLayout = new Map();
    let noteCenteredCharacterId = '';
    let currentCharacterId = '';
    let characterList = [];

    // ── 页面路由 ──────────────────────────────────────────────
    let currentPage = 'home';

    function switchPage(page) {
        document.querySelectorAll('.page-view').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

        const target = document.getElementById(`page-${page}`);
        if (target) target.style.display = 'flex';

        const navEl = document.querySelector(`[data-page="${page}"]`);
        if (navEl) navEl.classList.add('active');

        // days-badge 只在生命仓显示
        const badge = document.getElementById('days-badge');
        if (badge) badge.style.display = page === 'home' ? '' : 'none';
        const mainEl = document.querySelector('.main');
        mainEl?.classList.toggle('main--notes-full', page === 'notes');
        mainEl?.classList.toggle('main--story-full', page === 'story');
        mainEl?.classList.toggle('main--settings-full', page === 'settings');

        currentPage = page;
        if (page === 'notes') loadNotes();
    }

    function bindNav() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                switchPage(item.dataset.page);
            });
        });

    }

    // ── 出行照片墙：可拖拽画布 ─────────────────────────────────
    const ROTATIONS = [-3, 1.5, -1, 2.5, -2, 1, -1.5];

    // 初始散布位置（相对画布左上角，单位px）
    const INIT_POSITIONS = [
        { x: 40,  y: 180 },
        { x: 310, y: 160 },
        { x: 580, y: 200 },
        { x: 850, y: 170 },
        { x: 160, y: 480 },
        { x: 440, y: 460 },
        { x: 720, y: 440 },
    ];

    // 画布变换状态
    const canvas = { panX: 0, panY: 0, scale: 1 };

    // 沿宝丽来四边随机生成胶带的内联样式
    function randomTapeStyle(seed) {
        // 用 seed 做伪随机，保证同一张卡每次渲染位置一致
        const r  = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
        const edge = Math.floor(r(1) * 4); // 0=上 1=下 2=左 3=右
        const pct  = 15 + Math.floor(r(2) * 55); // 15%~70%
        const rot  = -6 + Math.floor(r(3) * 12);  // -6°~+6°
        if (edge === 0) return `top:-10px;left:${pct}%;transform:rotate(${rot}deg)`;
        if (edge === 1) return `bottom:-10px;left:${pct}%;transform:rotate(${rot}deg)`;
        if (edge === 2) return `left:-10px;top:${pct}%;width:18px;height:40px;transform:rotate(${rot + 90}deg)`;
        return              `right:-10px;top:${pct}%;width:18px;height:40px;transform:rotate(${rot + 90}deg)`;
    }

    function seededAngle(seed, n, range = 2) {
        const r = ((seed * 9301 + n * 49297) % 233280) / 233280;
        return ((r * range * 2) - range).toFixed(1);
    }

    function polaroidTransformStyle(rot) {
        const hoverRot = rot < 0 ? -1 : 1;
        return `--rot:${rot}deg;--hover-rot:${hoverRot}deg;transform:rotate(var(--rot))`;
    }

    function escapeHTML(value = '') {
        return String(value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function moodTagsFromEntry(entry) {
        const legacy = { warm: '温柔', calm: '安静', active: '好奇' };
        const raw = Array.isArray(entry.mood) ? entry.mood : String(entry.mood || '').split(/[,\s，、/|]+/);
        return raw
            .map(tag => legacy[String(tag).trim()] || String(tag || '').trim())
            .filter(Boolean)
            .map(tag => tag.slice(0, 2))
            .slice(0, 2);
    }

    function polaroidResponseHTML(entry) {
        const state = entry.journalState || 'awaiting-reply';
        const quote = entry.quote || '"正在感知这一刻的温度..."';
        if (state === 'sensing') {
            return `
                <div class="polaroid-quote is-sensing-text">
                    <img class="polaroid-generating-icon" src="/media/generating.png" alt="">
                    <span>${escapeHTML(quote)}</span>
                </div>
            `;
        }

        return `
            <div class="polaroid-quote">${escapeHTML(quote)}</div>
        `;
    }

    function polaroidHTML(entry, i) {
        const rot       = ROTATIONS[i % ROTATIONS.length];
        const dateStr   = entry.date ? entry.date.replace(/-/g, '.') : `2024.05.${entry.day || '01'}`;
        const tapeStyle = randomTapeStyle(entry.id);
        const metaRot   = seededAngle(entry.id, 11);
        const tagRotA   = seededAngle(entry.id, 12);
        const tagRotB   = seededAngle(entry.id, 13);
        const stateClass = entry.journalState === 'sensing' ? ' is-sensing' : '';
        const moodTags = moodTagsFromEntry(entry);
        const imageHTML = entry.imageUrl
            ? `<img src="${escapeHTML(entry.imageUrl)}" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block">`
            : `<svg class="polaroid-img-icon" viewBox="0 0 40 40" fill="none" width="44" height="44">
                    <rect x="4" y="8" width="32" height="24" rx="2" stroke="currentColor" stroke-width="2"/>
                    <circle cx="20" cy="20" r="7" stroke="currentColor" stroke-width="2"/>
                    <path d="M14 8l2-4h8l2 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                </svg>`;
        const tagHTML = entry.journalState === 'sensing' || moodTags.length === 0
            ? ''
            : `
                <div class="polaroid-tags">
                    ${moodTags.map((tag, idx) => `
                        <span class="polaroid-tag ${idx === 0 ? 'mood-active' : 'mood-calm'}" style="transform:rotate(${idx === 0 ? tagRotA : tagRotB}deg)">${escapeHTML(tag)}</span>
                    `).join('')}
                </div>
            `;
        return `
        <div class="polaroid${stateClass}" style="${polaroidTransformStyle(rot)}">
            <div class="polaroid-tape" style="${tapeStyle}"></div>
            <div class="polaroid-img">
                ${imageHTML}
            </div>
            <div class="polaroid-body">
                <div class="polaroid-meta-box" style="transform:rotate(${metaRot}deg)">${escapeHTML(dateStr)} / ${escapeHTML(entry.place)}</div>
                ${tagHTML}
            </div>
            <hr class="polaroid-divider">
            ${polaroidResponseHTML(entry)}
        </div>`;
    }

    function updatePolaroidTagLayout(root = document) {
        root.querySelectorAll('.polaroid-body').forEach(body => {
            const meta = body.querySelector('.polaroid-meta-box');
            const tags = body.querySelector('.polaroid-tags');
            if (!meta || !tags) return;

            body.classList.remove('tags-stacked');
            const gap = parseFloat(getComputedStyle(body).columnGap) || 0;
            const needsStack = meta.offsetWidth + tags.scrollWidth + gap > body.clientWidth;
            body.classList.toggle('tags-stacked', needsStack);
        });
    }

    function renderJournal(entries = journalEntries) {
        const wrap = document.getElementById('journal-canvas-wrap');
        const cvs  = document.getElementById('journal-canvas');
        if (!wrap || !cvs) return;

        // 渲染节点
        cvs.innerHTML = entries.map((entry, i) => {
            const pos = INIT_POSITIONS[i] || { x: 60 + i * 260, y: 180 };
            return `<div class="canvas-node" data-idx="${i}"
                        style="left:${pos.x}px;top:${pos.y}px">
                        ${polaroidHTML(entry, i)}
                    </div>`;
        }).join('');
        requestAnimationFrame(() => updatePolaroidTagLayout(cvs));

        // 更新统计数字
        const placeEl = document.getElementById('j-place-count');
        const memEl   = document.getElementById('j-memory-count');
        const uniquePlaces = new Set(entries.map(e => String(e.place || '').trim()).filter(Boolean));
        if (placeEl) placeEl.textContent = uniquePlaces.size;
        if (memEl)   memEl.textContent   = entries.length;

        bindCanvasDrag(wrap, cvs);
    }

    function noteTime(ts) {
        const d = new Date(ts || Date.now());
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function noteAvatarHTML(note) {
        if (note.from !== 'character') return '你';
        const ch = characterList.find(c => c.id === note.characterId) || characterList.find(c => c.id === currentCharacterId);
        if (ch?.avatar) return `<img src="${escapeHTML(ch.avatar)}" alt="">`;
        return escapeHTML((ch?.name || '?').slice(0, 1));
    }

    function noteSize(note) {
        return {
            w: note.state === 'draft' ? 320 : 280,
            h: note.state === 'draft' ? 250 : 180,
        };
    }

    function noteAngle(note, i = 0) {
        const seed = String(note.id || i).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
        return seededAngle(seed, 19, 3);
    }

    function notePositionStyle(note, i) {
        const pos = noteLayout.get(note.id) || assignNotePosition(note, i);
        const rot = noteAngle(note, i);
        return `left:${pos.x}px;top:${pos.y}px;transform:rotate(${rot}deg)`;
    }

    function assignNotePosition(note, i = 0) {
        if (noteLayout.has(note.id)) return noteLayout.get(note.id);
        const size = noteSize(note);
        const pos = note.replyTo
            ? findNearbyNoteSpot(note.replyTo, size.w, size.h)
            : findEmptyNoteSpot(size.w, size.h);
        noteLayout.set(note.id, pos);
        return pos;
    }

    function noteRects(excludeId = '') {
        return Array.from(noteLayout.entries())
            .filter(([id]) => id !== excludeId)
            .map(([id, pos]) => {
                const note = noteEntries.find(n => n.id === id) || (noteDraft?.id === id ? noteDraft : null);
                const size = noteSize(note || {});
                return { x: pos.x, y: pos.y, w: size.w, h: size.h };
            });
    }

    function rectsOverlap(a, b, margin = 34) {
        return !(a.x + a.w + margin < b.x ||
                 a.x > b.x + b.w + margin ||
                 a.y + a.h + margin < b.y ||
                 a.y > b.y + b.h + margin);
    }

    function findEmptyNoteSpot(w = 280, h = 180) {
        const existing = noteRects();
        const center = noteViewportCenterInCanvas();
        const centerX = center.x - w / 2;
        const centerY = center.y - h / 2;
        const stepX = 360, stepY = 260;
        const candidates = [{ x: centerX, y: centerY }];
        for (let ring = 1; ring <= 5; ring++) {
            for (let dx = -ring; dx <= ring; dx++) {
                candidates.push({ x: centerX + dx * stepX, y: centerY - ring * stepY });
                candidates.push({ x: centerX + dx * stepX, y: centerY + ring * stepY });
            }
            for (let dy = -ring + 1; dy <= ring - 1; dy++) {
                candidates.push({ x: centerX - ring * stepX, y: centerY + dy * stepY });
                candidates.push({ x: centerX + ring * stepX, y: centerY + dy * stepY });
            }
        }

        for (const pos of candidates) {
            const candidate = { x: pos.x, y: pos.y, w, h };
            if (!existing.some(rect => rectsOverlap(candidate, rect))) {
                return { x: candidate.x, y: candidate.y };
            }
        }
        return { x: centerX + existing.length * 64, y: centerY + existing.length * 46 };
    }

    function findNearbyNoteSpot(anchorId, w = 280, h = 180) {
        const anchor = noteLayout.get(anchorId);
        if (!anchor) return findEmptyNoteSpot(w, h);

        const anchorNote = noteEntries.find(n => n.id === anchorId) || {};
        const anchorSize = noteSize(anchorNote);
        const candidates = [
            { x: anchor.x + anchorSize.w + 48, y: anchor.y + 24 },
            { x: anchor.x + 40, y: anchor.y + anchorSize.h + 42 },
            { x: anchor.x - w - 48, y: anchor.y + 20 },
            { x: anchor.x + anchorSize.w + 48, y: anchor.y + anchorSize.h - h },
            { x: anchor.x - w - 48, y: anchor.y + anchorSize.h - h },
            { x: anchor.x + 80, y: anchor.y - h - 38 },
        ];
        const existing = noteRects();
        for (const pos of candidates) {
            const candidate = { x: pos.x, y: pos.y, w, h };
            if (!existing.some(rect => rectsOverlap(candidate, rect))) {
                return { x: candidate.x, y: candidate.y };
            }
        }
        return findEmptyNoteSpot(w, h);
    }

    function applyNoteCanvasTransform() {
        const cvs = document.getElementById('notes-canvas');
        if (!cvs) return;
        cvs.style.transform = `translate(${noteCanvas.panX}px,${noteCanvas.panY}px) scale(${noteCanvas.scale})`;
    }

    function getNotesViewportRect() {
        const viewport = document.getElementById('notes-viewport');
        const board = document.querySelector('.notes-board');
        const rect = viewport?.getBoundingClientRect();
        if (rect && rect.width > 100 && rect.height > 100) return rect;
        return board?.getBoundingClientRect() || rect;
    }

    function noteViewportCenterInCanvas() {
        const rect = getNotesViewportRect();
        if (!rect) return { x: 980, y: 460 };
        return {
            x: (rect.width / 2 - noteCanvas.panX) / noteCanvas.scale,
            y: (rect.height / 2 - noteCanvas.panY) / noteCanvas.scale,
        };
    }

    function resetNoteCanvas() {
        noteCanvas.panX = 0;
        noteCanvas.panY = 0;
        noteCanvas.scale = 1;
        noteLayout.clear();
        noteDraft = null;
        noteCenteredCharacterId = '';
        applyNoteCanvasTransform();
    }

    function getRenderedNoteBounds() {
        const ids = [...noteEntries, noteDraft].filter(Boolean).map(n => n.id);
        const rects = ids.map(id => {
            const pos = noteLayout.get(id);
            if (!pos) return null;
            const note = noteEntries.find(n => n.id === id) || (noteDraft?.id === id ? noteDraft : null) || {};
            const el = document.querySelector(`[data-note-id="${CSS.escape(id)}"]`);
            const fallback = noteSize(note);
            return {
                x: pos.x,
                y: pos.y,
                w: el?.offsetWidth || fallback.w,
                h: el?.offsetHeight || fallback.h,
            };
        }).filter(Boolean);
        if (!rects.length) return null;
        const left = Math.min(...rects.map(r => r.x));
        const top = Math.min(...rects.map(r => r.y));
        const right = Math.max(...rects.map(r => r.x + r.w));
        const bottom = Math.max(...rects.map(r => r.y + r.h));
        return { left, top, right, bottom, w: right - left, h: bottom - top };
    }

    function centerNotesGroupOnCanvas(animate = false) {
        const cvs = document.getElementById('notes-canvas');
        const rect = getNotesViewportRect();
        const bounds = getRenderedNoteBounds();
        if (!cvs || !rect || !bounds) return;
        noteCanvas.panX = rect.width / 2 - (bounds.left + bounds.w / 2) * noteCanvas.scale;
        noteCanvas.panY = rect.height / 2 - (bounds.top + bounds.h / 2) * noteCanvas.scale;
        if (animate) cvs.style.transition = 'transform 0.45s cubic-bezier(.4,0,.2,1)';
        applyNoteCanvasTransform();
        if (animate) setTimeout(() => { cvs.style.transition = ''; }, 480);
    }

    function centerNoteOnCanvas(noteId, animate = true) {
        const cvs = document.getElementById('notes-canvas');
        const pos = noteLayout.get(noteId);
        const rect = getNotesViewportRect();
        if (!rect || !cvs || !pos) return;
        const note = noteEntries.find(n => n.id === noteId) || (noteDraft?.id === noteId ? noteDraft : null) || {};
        const noteEl = document.querySelector(`[data-note-id="${CSS.escape(noteId)}"]`);
        const fallbackSize = noteSize(note);
        const size = {
            w: noteEl?.offsetWidth || fallbackSize.w,
            h: noteEl?.offsetHeight || fallbackSize.h,
        };
        noteCanvas.panX = rect.width / 2 - (pos.x + size.w / 2) * noteCanvas.scale;
        noteCanvas.panY = rect.height / 2 - (pos.y + size.h / 2) * noteCanvas.scale;
        if (animate) cvs.style.transition = 'transform 0.45s cubic-bezier(.4,0,.2,1)';
        applyNoteCanvasTransform();
        if (animate) setTimeout(() => { cvs.style.transition = ''; }, 480);
    }

    function bindNotesCanvasDrag() {
        const viewport = document.getElementById('notes-viewport');
        if (!viewport || viewport.dataset.dragBound === '1') return;
        viewport.dataset.dragBound = '1';
        let panStart = null;
        let dragNote = null;

        viewport.addEventListener('mousedown', e => {
            const noteEl = e.target.closest('.note-sticky');
            if (noteEl && !e.target.closest('textarea,button')) {
                const id = noteEl.dataset.noteId;
                const pos = noteLayout.get(id);
                if (!id || !pos) return;
                const rect = viewport.getBoundingClientRect();
                dragNote = {
                    id,
                    offX: (e.clientX - rect.left - noteCanvas.panX) / noteCanvas.scale - pos.x,
                    offY: (e.clientY - rect.top - noteCanvas.panY) / noteCanvas.scale - pos.y,
                };
                noteEl.classList.add('dragging');
                return;
            }
            if (e.target.closest('.note-add-btn, .notes-status-chip')) return;
            viewport.classList.add('panning');
            panStart = { x: e.clientX - noteCanvas.panX, y: e.clientY - noteCanvas.panY };
        });

        window.addEventListener('mousemove', e => {
            if (dragNote) {
                const rect = viewport.getBoundingClientRect();
                const x = (e.clientX - rect.left - noteCanvas.panX) / noteCanvas.scale - dragNote.offX;
                const y = (e.clientY - rect.top - noteCanvas.panY) / noteCanvas.scale - dragNote.offY;
                noteLayout.set(dragNote.id, { x, y });
                const el = document.querySelector(`[data-note-id="${CSS.escape(dragNote.id)}"]`);
                const note = noteEntries.find(n => n.id === dragNote.id) || (noteDraft?.id === dragNote.id ? noteDraft : null);
                if (el && note) el.style.cssText = notePositionStyle(note);
                return;
            }
            if (!panStart) return;
            noteCanvas.panX = e.clientX - panStart.x;
            noteCanvas.panY = e.clientY - panStart.y;
            applyNoteCanvasTransform();
        });

        window.addEventListener('mouseup', () => {
            if (dragNote) {
                document.querySelector(`[data-note-id="${CSS.escape(dragNote.id)}"]`)?.classList.remove('dragging');
                dragNote = null;
            }
            if (!panStart) return;
            panStart = null;
            viewport.classList.remove('panning');
        });

        viewport.addEventListener('wheel', e => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
            const newScale = Math.min(1.8, Math.max(0.45, noteCanvas.scale * factor));
            const rect = viewport.getBoundingClientRect();
            const mx = (e.clientX - rect.left - noteCanvas.panX) / noteCanvas.scale;
            const my = (e.clientY - rect.top - noteCanvas.panY) / noteCanvas.scale;
            noteCanvas.panX = e.clientX - rect.left - mx * newScale;
            noteCanvas.panY = e.clientY - rect.top - my * newScale;
            noteCanvas.scale = newScale;
            applyNoteCanvasTransform();
        }, { passive: false });
    }

    function pruneNoteLayout(validIds) {
        for (const id of noteLayout.keys()) {
            if (!validIds.has(id)) noteLayout.delete(id);
        }
    }

    function noteNodeHTML(note, i) {
        const isChar = note.from === 'character';
        const isGenerating = note.state === 'generating';
        return `
            <div class="note-sticky ${isChar ? 'note-sticky--char' : 'note-sticky--user'} ${isGenerating ? 'note-sticky--generating' : ''}"
                 data-note-id="${escapeHTML(note.id)}"
                 style="${notePositionStyle(note, i)}">
                <div class="note-tape-top"></div>
                <div class="note-sticky-header">
                    <div class="note-char-avatar">${noteAvatarHTML(note)}</div>
                    <span class="note-sticky-time">${noteTime(note.createdAt)}</span>
                </div>
                <div class="note-sticky-text">${escapeHTML(note.text)}</div>
            </div>
        `;
    }

    function renderNotes(entries = noteEntries) {
        const list = document.getElementById('notes-list');
        const empty = document.getElementById('notes-empty');
        const status = document.getElementById('notes-status');
        if (!list) return;

        const sorted = [...entries].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const displayEntries = noteDraft ? [...sorted, noteDraft] : sorted;
        pruneNoteLayout(new Set(displayEntries.map(n => n.id)));
        displayEntries.forEach(assignNotePosition);
        list.innerHTML = sorted.map(noteNodeHTML).join('') + (noteDraft ? noteDraftHTML(noteDraft, displayEntries.length - 1) : '');

        if (empty) empty.style.display = displayEntries.length ? 'none' : 'block';
        if (status) {
            const generating = sorted.some(n => n.state === 'generating');
            status.textContent = generating ? '状态：正在回纸条' : `状态：${sorted.length} 张小纸条`;
        }
        bindNotesCanvasDrag();
        applyNoteCanvasTransform();
        if (currentPage === 'notes' && currentCharacterId && noteCenteredCharacterId !== currentCharacterId && !noteDraft) {
            noteCenteredCharacterId = currentCharacterId;
            requestAnimationFrame(() => requestAnimationFrame(() => centerNotesGroupOnCanvas(false)));
        }
        const draftInput = document.getElementById('note-draft-input');
        if (draftInput) {
            draftInput.focus();
            draftInput.setSelectionRange(draftInput.value.length, draftInput.value.length);
        }
        startNotePolling();
    }

    function noteDraftHTML(note, i) {
        return `
            <div class="note-sticky note-sticky--user note-sticky--draft" data-note-id="${escapeHTML(note.id)}" style="${notePositionStyle(note, i)}">
                <div class="note-tape-top"></div>
                <div class="note-sticky-header">
                    <div class="note-char-avatar">你</div>
                    <span class="note-sticky-time">正在写</span>
                    <button class="note-draft-close" onclick="app.cancelNoteDraft()" aria-label="取消">×</button>
                </div>
                <textarea class="note-draft-textarea" id="note-draft-input" maxlength="300" placeholder="今天想让它知道什么？" oninput="app.updateNoteDraft(this.value)">${escapeHTML(note.text || '')}</textarea>
                <div class="note-draft-footer">
                    <button class="btn-post-note btn-post-note--small" id="note-submit" onclick="app.postNote()">发送</button>
                </div>
            </div>
        `;
    }

    async function loadNotes() {
        if (!currentCharacterId) return;
        try {
            const res = await fetch(`/api/notes?characterId=${encodeURIComponent(currentCharacterId)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            noteEntries = data.notes || [];
            if (noteDraft && currentPage !== 'notes') noteDraft = null;
            renderNotes(noteEntries);
        } catch (e) {
            console.error('[Notes] 加载失败:', e.message);
            noteEntries = [];
            renderNotes(noteEntries);
        }
    }

    function createNoteDraft() {
        if (!currentCharacterId) {
            alert('请先选择当前角色');
            return;
        }
        if (!noteDraft) {
            noteDraft = {
                id: `draft_${Date.now()}`,
                characterId: currentCharacterId,
                from: 'user',
                text: '',
                state: 'draft',
                createdAt: Date.now(),
            };
            assignNotePosition(noteDraft);
        }
        renderNotes(noteEntries);
        requestAnimationFrame(() => requestAnimationFrame(() => centerNoteOnCanvas(noteDraft.id)));
    }

    function cancelNoteDraft() {
        noteDraft = null;
        renderNotes(noteEntries);
    }

    function updateNoteDraft(value) {
        if (noteDraft) noteDraft.text = value;
    }

    function startNotePolling() {
        if (notePollTimer) return;
        if (!noteEntries.some(n => n.state === 'generating')) return;
        notePollTimer = setTimeout(async () => {
            notePollTimer = null;
            await loadNotes();
        }, 1600);
    }

    async function loadJournal() {
        try {
            const qs = currentCharacterId ? `?characterId=${encodeURIComponent(currentCharacterId)}` : '';
            const res = await fetch(`/api/journal${qs}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            journalEntries = data.entries || [];
            renderJournal(journalEntries);
        } catch (e) {
            console.warn('[Journal] 使用本地 mock:', e.message);
            journalEntries = MOCK_JOURNAL;
            renderJournal(journalEntries);
        }
    }

    function startJournalPolling() {
        if (journalPollTimer) return;
        if (!journalEntries.some(e => e.journalState === 'sensing')) return;
        journalPollTimer = setTimeout(async () => {
            journalPollTimer = null;
            await loadJournal();
            startJournalPolling();
        }, 2500);
    }

    function renderCharacterSelect(list, currentId) {
        const select = document.getElementById('character-select');
        if (!select) return;
        select.innerHTML = list.map(ch =>
            `<option value="${escapeHTML(ch.id)}">${escapeHTML(ch.name || ch.id)}</option>`
        ).join('');
        select.value = currentId || '';
        select.onchange = async () => {
            if (!select.value || select.value === currentCharacterId) return;
            await switchCurrentCharacter(select.value);
        };
    }

    function updateCharacterUI(cur) {
        if (!cur) return;
        currentCharacterId = cur.id || currentCharacterId;
        document.getElementById('char-name').textContent = cur.name || '';
        document.getElementById('package-edition').textContent = `# ${cur.series || '未知系列'}`;
        document.getElementById('photo-serial').textContent = `SP-01 / ${cur.name || ''}`;

        const photo = document.getElementById('char-photo');
        const placeholder = document.getElementById('char-photo-placeholder');
        const sidebarAvatar = document.getElementById('sidebar-char-avatar');

        [photo, sidebarAvatar].forEach(img => {
            if (!img) return;
            if (cur.avatar) {
                img.onload = () => {
                    img.style.display = 'block';
                    if (img === photo && placeholder) placeholder.style.display = 'none';
                };
                img.onerror = () => {
                    img.style.display = 'none';
                    if (img === photo && placeholder) placeholder.style.display = '';
                };
                img.src = cur.avatar;
            } else {
                img.style.display = 'none';
                if (img === photo && placeholder) placeholder.style.display = '';
            }
        });
    }

    async function loadCharacters() {
        const res = await fetch('/api/characters');
        const list = await res.json();
        if (!res.ok) throw new Error(list.error || `HTTP ${res.status}`);
        characterList = list;
        const cur = list.find(c => c.isCurrent) || list[0];
        if (cur) updateCharacterUI(cur);
        renderCharacterSelect(list, cur?.id);
    }

    async function switchCurrentCharacter(id) {
        const res = await fetch(`/api/characters/current/${encodeURIComponent(id)}`, { method: 'PUT' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const cur = data.current || characterList.find(c => c.id === id);
        updateCharacterUI(cur);
        renderCharacterSelect(characterList, id);
        resetNoteCanvas();
        await loadJournal();
        await loadNotes();
        startJournalPolling();
    }

    function applyCanvasTransform(cvs) {
        cvs.style.transform = `translate(${canvas.panX}px,${canvas.panY}px) scale(${canvas.scale})`;
    }

    function bindCanvasDrag(wrap, cvs) {
        if (wrap.dataset.dragBound === '1') return;
        wrap.dataset.dragBound = '1';
        let dragNode = null;
        let dragOffX = 0, dragOffY = 0;
        let panStart = null;

        wrap.addEventListener('mousedown', e => {
            const node = e.target.closest('.canvas-node');
            if (node) {
                e.stopPropagation();
                dragNode = node;
                dragNode.classList.add('dragging');
                // 把屏幕坐标转换为画布坐标系内的偏移
                const rect = node.getBoundingClientRect();
                dragOffX = (e.clientX - rect.left) / canvas.scale;
                dragOffY = (e.clientY - rect.top)  / canvas.scale;
            } else {
                wrap.classList.add('panning');
                panStart = { x: e.clientX - canvas.panX, y: e.clientY - canvas.panY };
            }
        });

        wrap.addEventListener('dragstart', e => {
            if (e.target.closest('.polaroid-img')) e.preventDefault();
        });

        window.addEventListener('mousemove', e => {
            if (dragNode) {
                const wrapRect = wrap.getBoundingClientRect();
                // 屏幕坐标 → 画布坐标
                const x = (e.clientX - wrapRect.left - canvas.panX) / canvas.scale - dragOffX;
                const y = (e.clientY - wrapRect.top  - canvas.panY) / canvas.scale - dragOffY;
                dragNode.style.left = x + 'px';
                dragNode.style.top  = y + 'px';
            } else if (panStart) {
                canvas.panX = e.clientX - panStart.x;
                canvas.panY = e.clientY - panStart.y;
                applyCanvasTransform(cvs);
            }
        });

        window.addEventListener('mouseup', () => {
            if (dragNode) { dragNode.classList.remove('dragging'); dragNode = null; }
            if (panStart)  { wrap.classList.remove('panning');      panStart = null; }
        });

        // 滚轮缩放（以鼠标为中心缩放）
        wrap.addEventListener('wheel', e => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const newScale = Math.min(3, Math.max(0.25, canvas.scale * factor));
            const wrapRect = wrap.getBoundingClientRect();
            // 鼠标在画布坐标系中的位置
            const mx = (e.clientX - wrapRect.left - canvas.panX) / canvas.scale;
            const my = (e.clientY - wrapRect.top  - canvas.panY) / canvas.scale;
            // 缩放后保持鼠标指向同一画布点
            canvas.panX = e.clientX - wrapRect.left - mx * newScale;
            canvas.panY = e.clientY - wrapRect.top  - my * newScale;
            canvas.scale = newScale;
            applyCanvasTransform(cvs);
        }, { passive: false });
    }

    // ── 初始化 ────────────────────────────────────────────────
    async function init() {
        document.getElementById('days-text').textContent   = `共同生活第 ${MOCK.daysLiving} 天`;
        document.getElementById('conn-status').textContent = MOCK.connectionStatus;
        document.getElementById('breath-color').textContent = MOCK.breathColor;
        document.getElementById('interact-count').textContent = MOCK.interactCount + '次';
        document.getElementById('log-index').textContent   = String(MOCK.logIndex).padStart(3, '0');
        document.getElementById('log-text').textContent    = MOCK.logText;

        bindNav();
        window.addEventListener('resize', () => updatePolaroidTagLayout());
        bindSettings();
        bindRecordModal();
        loadStory();
        bindStoryScroll();

        try {
            await loadCharacters();
            await loadJournal();
            await loadNotes();
            startJournalPolling();
        } catch (e) {
            console.error('[Admin] 角色加载失败:', e.message);
        }
    }

    // ── 设置页交互 ───────────────────────────────────────────
    function bindSettings() {
        // 互动频率
        document.querySelectorAll('.freq-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.freq-item').forEach(i => i.classList.remove('freq-item--selected'));
                item.classList.add('freq-item--selected');
            });
        });
        // 互动边界
        document.querySelectorAll('.boundary-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.boundary-item').forEach(i => {
                    i.classList.remove('boundary-item--selected');
                    i.querySelector('.boundary-radio').classList.remove('boundary-radio--checked');
                });
                item.classList.add('boundary-item--selected');
                item.querySelector('.boundary-radio').classList.add('boundary-radio--checked');
            });
        });
        // 世界观强度
        document.querySelectorAll('.worldview-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.worldview-btn').forEach(b => b.classList.remove('worldview-btn--selected'));
                btn.classList.add('worldview-btn--selected');
            });
        });
        // 语气偏好
        document.querySelectorAll('.tone-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.tone-card').forEach(c => c.classList.remove('tone-card--selected'));
                card.classList.add('tone-card--selected');
            });
        });
    }

    // ── 照片墙：记录地点弹窗 ────────────────────────────────
    let pendingImg = null; // { file, dataUrl, width, height }

    function recordPlace() {
        const overlay = document.getElementById('record-modal-overlay');
        if (!overlay) return;
        // 重置表单
        document.getElementById('record-img-input').value = '';
        document.getElementById('record-preview').style.display = 'none';
        document.getElementById('record-upload-placeholder').style.display = '';
        document.getElementById('record-date').value = new Date().toISOString().slice(0, 10);
        document.getElementById('record-place').value = '';
        pendingImg = null;
        overlay.style.display = 'flex';
    }

    function bindRecordModal() {
        const overlay  = document.getElementById('record-modal-overlay');
        const imgInput = document.getElementById('record-img-input');
        const preview  = document.getElementById('record-preview');
        const placeholder = document.getElementById('record-upload-placeholder');

        document.getElementById('record-modal-close').onclick = () => {
            overlay.style.display = 'none';
        };
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.style.display = 'none';
        });

        imgInput.addEventListener('change', () => {
            const file = imgInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const img = new Image();
                img.onload = () => {
                    pendingImg = { file, dataUrl: ev.target.result, width: img.naturalWidth, height: img.naturalHeight };
                    preview.src = ev.target.result;
                    preview.style.display = 'block';
                    placeholder.style.display = 'none';
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });

        document.getElementById('record-confirm').onclick = async () => {
            const dateVal  = document.getElementById('record-date').value;
            const uploadPlaceVal = document.getElementById('record-place').value || '未知地点';
            if (!pendingImg?.file) {
                alert('请先上传照片');
                return;
            }
            if (!currentCharacterId) {
                alert('请先选择当前角色');
                return;
            }

            try {
                const buffer = await pendingImg.file.arrayBuffer();
                const res = await fetch('/api/journal', {
                    method: 'POST',
                    headers: {
                        'Content-Type': pendingImg.file.type || 'image/jpeg',
                        'X-Journal-Character-Id': currentCharacterId,
                        'X-Journal-Date': dateVal || '',
                        'X-Journal-Place': encodeURIComponent(uploadPlaceVal),
                    },
                    body: buffer,
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                overlay.style.display = 'none';
                await loadJournal();
                startJournalPolling();
                return;
            } catch (e) {
                alert('照片墙保存失败：' + e.message);
                return;
            }
            const placeVal = document.getElementById('record-place').value || '未知地点';

            // 卡片宽度固定 220px，图片区高度根据真实比例计算
            const CARD_W   = 220;
            const PHOTO_W  = CARD_W - 20;
            const imgAspect = pendingImg ? pendingImg.height / pendingImg.width : 0.75;
            const photoH   = Math.round(PHOTO_W * imgAspect);

            const dateStr  = dateVal ? dateVal.replace(/-/g, '.') : '未知日期';

            // 找画布空白位置
            const wrap    = document.getElementById('journal-canvas-wrap');
            const cvs     = document.getElementById('journal-canvas');
            const pos     = findEmptySpot(cvs, CARD_W, photoH + 90);

            // 生成新节点
            const id      = Date.now();
            const seed    = id % 9999;
            const rotIdx  = cvs.children.length % ROTATIONS.length;
            const rot     = ROTATIONS[rotIdx];
            const tapeStyle = randomTapeStyle(seed);
            const metaRot = seededAngle(seed, 11);
            const imgTag  = pendingImg
                ? `<img src="${pendingImg.dataUrl}" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block">`
                : `<svg class="polaroid-img-icon" viewBox="0 0 40 40" fill="none" width="44" height="44">
                       <rect x="4" y="8" width="32" height="24" rx="2" stroke="currentColor" stroke-width="2"/>
                       <circle cx="20" cy="20" r="7" stroke="currentColor" stroke-width="2"/>
                       <path d="M14 8l2-4h8l2 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                   </svg>`;

            const node = document.createElement('div');
            node.className = 'canvas-node';
            node.style.cssText = `left:${pos.x}px;top:${pos.y}px;width:${CARD_W}px`;
            node.innerHTML = `
                <div class="polaroid is-sensing" style="${polaroidTransformStyle(rot)}">
                    <div class="polaroid-tape" style="${tapeStyle}"></div>
                    <div class="polaroid-img" style="aspect-ratio:${PHOTO_W}/${photoH};height:${photoH}px">
                        ${imgTag}
                    </div>
                    <div class="polaroid-body">
                        <div class="polaroid-meta-box" style="transform:rotate(${metaRot}deg)">${dateStr} / ${placeVal}</div>
                    </div>
                    <hr class="polaroid-divider">
                    <div class="polaroid-quote is-sensing-text">
                        <img class="polaroid-generating-icon" src="/media/generating.png" alt="">
                        <span>"正在感知这一刻的温度..."</span>
                    </div>
                </div>`;
            cvs.appendChild(node);
            requestAnimationFrame(() => updatePolaroidTagLayout(node));

            // 画布平移到新卡片中心
            const wrapRect = wrap.getBoundingClientRect();
            canvas.panX = wrapRect.width  / 2 - (pos.x + CARD_W / 2) * canvas.scale;
            canvas.panY = wrapRect.height / 2 - (pos.y + (photoH + 90) / 2) * canvas.scale;
            cvs.style.transition = 'transform 0.5s cubic-bezier(.4,0,.2,1)';
            applyCanvasTransform(cvs);
            setTimeout(() => { cvs.style.transition = ''; }, 550);

            overlay.style.display = 'none';
        };
    }

    // 在画布上找一块不与现有节点重叠的空位
    function findEmptySpot(cvs, w, h) {
        const nodes = Array.from(cvs.querySelectorAll('.canvas-node'));
        const margin = 30;
        const cols = 5, rows = 4;
        const stepX = w + margin + 60, stepY = h + margin + 40;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = 60 + c * stepX;
                const y = 180 + r * stepY;
                const overlaps = nodes.some(n => {
                    const nx = parseFloat(n.style.left), ny = parseFloat(n.style.top);
                    const nw = n.offsetWidth || 220, nh = n.offsetHeight || 300;
                    return !(x + w + margin < nx || x > nx + nw + margin ||
                             y + h + margin < ny || y > ny + nh + margin);
                });
                if (!overlaps) return { x, y };
            }
        }
        // 找不到空位则随机偏移放到右下
        return { x: 60 + nodes.length * 40, y: 60 + nodes.length * 30 };
    }

    async function postNote() {
        const input = document.getElementById('note-draft-input');
        const btn = document.getElementById('note-submit');
        if (!input) {
            switchPage('notes');
            createNoteDraft();
            return;
        }
        const text = (input?.value || '').trim();

        if (!text) {
            alert('先写一点内容再贴上去');
            return;
        }
        if (!currentCharacterId) {
            alert('请先选择当前角色');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = '贴上中...';
        }

        try {
            const res = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId: currentCharacterId, text }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const draftPos = noteDraft ? noteLayout.get(noteDraft.id) : null;
            if (draftPos && data.note?.id) noteLayout.set(data.note.id, draftPos);
            if (noteDraft) noteLayout.delete(noteDraft.id);
            noteDraft = null;
            await loadNotes();
            if (data.note?.id) requestAnimationFrame(() => requestAnimationFrame(() => centerNoteOnCanvas(data.note.id)));
            startNotePolling();
        } catch (e) {
            alert('小纸条发送失败：' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '贴上去';
            }
        }
    }
    function savePrefs()     { alert('偏好已保存～'); }

    // ── 今日同游 ──────────────────────────────────────────────────

    const CHAR_AVATARS    = { duchamp: '杜', qifei: '妃', zsiga: 'Z', goodluck: 'GL' };
    const CHAR_CSS_CLASS  = { duchamp: 'char-duchamp', qifei: 'char-qifei', zsiga: 'char-zsiga' };
    const ECHO_CSS_CLASS  = { qifei: 'echo-card--qifei', zsiga: 'echo-card--zsiga', duchamp: 'echo-card--duchamp' };
    const STATUS_LABEL    = { upcoming: '未开始', ongoing: '进行中', done: '已完成' };
    const STATUS_DOT_COLOR = { upcoming: '#AAA', ongoing: '#7BC14A', done: '#FF6B35' };
    const STORY_MOOD_ANGLES = [-2, -1, 1, 2];
    const STORY_MOOD_EMOJI = {
        端庄:   { emoji: '💅🏼', angle: 0 },
        骄傲:   { emoji: '👸', angle: 0 },
        厌恶:   { emoji: '😕', angle: -8 },
        恼怒:   { emoji: '😠', angle: 6 },
        解释:   { emoji: '☝️', angle: -4 },
        不耐烦: { emoji: '😒', angle: 6 },
        认真:   { emoji: '🧐', angle: 0 },
        认可:   { emoji: '👍', angle: 5 },
        嫌弃:   { emoji: '🙄', angle: -4 },
        嘴硬:   { emoji: '😕', angle: 6 },
        不解:   { emoji: '😩', angle: -6 },
        冷笑:   { emoji: '😏', angle: 4 },
        皱眉:   { emoji: '🤨', angle: -8 },
        思考:   { emoji: '🤔', angle: 5 },
        天真:   { emoji: '😳', angle: 6 },
        慌乱:   { emoji: '😰', angle: 6 },
        疑惑:   { emoji: '🤨', angle: -5 },
    };
    const STORY_SCENE_MEDIA = {
        scene_02: {
            src: '/media/duchamp-fountain.jpg',
            alt: 'Marcel Duchamp, Fountain, 1917',
            caption: 'Marcel Duchamp, Fountain, 1917',
        },
    };

    // 稳定伪随机角度 [-range, range]，用 charId+index 做 seed
    function stableAngle(seed, range = 2) {
        const r = ((seed * 9301 + 49297) % 233280) / 233280;
        return +((r * range * 2 - range).toFixed(1));
    }

    function splitMoodTags(text) {
        return String(text || '')
            .split(/[\/、，,\s|]+/)
            .map(t => t.trim())
            .filter(Boolean)
            .slice(0, 2);
    }

    function buildMoodTagsHTML(item, seed) {
        const tags = Array.isArray(item.moods) ? item.moods.filter(tag => tag !== '平静') : [];
        return tags.map((tag, i) => {
            const tagSeed = seed + i * 17 + tag.length;
            const mood = STORY_MOOD_EMOJI[tag];
            const styleParts = [
                `right:${10 + i * 76}px`,
                `top:${mood ? -24 : -12}px`,
                `transform:rotate(${mood?.angle ?? STORY_MOOD_ANGLES[Math.abs(tagSeed) % STORY_MOOD_ANGLES.length]}deg)`,
            ];
            const className = mood ? 'story-mood-tag story-mood-tag--emoji' : 'story-mood-tag';
            return `<span class="${className}" style="${styleParts.join(';')}" title="${escapeHTML(tag)}" aria-label="${escapeHTML(tag)}">${escapeHTML(mood?.emoji || tag)}</span>`;
        }).join('');
    }

    // ── JSON → 时间线条目映射 ──────────────────────────────────────
    //
    // Beat 类型映射规则：
    //   narration                    → 旁白块（左列，连续旁白合并）
    //   action（无 character_id）     → 旁白块（同上）
    //   dialogue                     → 角色卡（左右交替）
    //   action/inner_monologue + dialogue（同角色相邻）→ 同一角色卡，上方小框 + 正文
    //   单独 action/inner_monologue  → 角色卡内只渲染上方小框
    //
    // 场景边界 → 菱形标记 + 场景标题；ending → 星形标记
    function mapStoryToTimeline(story) {
        const items = [];

        function pushConnector() {}

        function pushSceneMedia(scene) {
            const media = STORY_SCENE_MEDIA[scene.scene_id];
            if (!media) return;
            const lastNarration = [...items].reverse().find(item => item.type === 'narration');
            if (lastNarration) {
                lastNarration.media = media;
            } else {
                pushConnector();
                items.push({ type: 'media', ...media });
            }
        }

        function isPreludeBeat(beat) {
            return beat?.type === 'action' || beat?.type === 'inner_monologue';
        }

        function shouldMergeWithDialogue(beat, nextBeat) {
            return isPreludeBeat(beat) &&
                                   nextBeat &&
                                   nextBeat.type === 'dialogue' &&
                                   nextBeat.character_id === beat.character_id;
        }

        function beatToCharItem(beat, nextBeat = null) {
            const canMergePrelude = shouldMergeWithDialogue(beat, nextBeat);
            const dialogueBeat = canMergePrelude ? nextBeat : beat;
            const isStandalonePrelude = isPreludeBeat(beat) && !canMergePrelude;
            return {
                type:    'char',
                charId:  beat.character_id,
                name:    beat.speaker || dialogueBeat.speaker,
                moods:   splitMoodTags(dialogueBeat.emotion || beat.emotion),
                actionText: canMergePrelude || isStandalonePrelude ? beat.text : '',
                text:    canMergePrelude ? nextBeat.text : (isStandalonePrelude ? '' : beat.text),
                isAction: isStandalonePrelude,
            };
        }

        function processBeat(beat, nextBeat = null) {
            const isNarrator = !beat.character_id ||
                               beat.type === 'narration' ||
                               (beat.type === 'action' && !beat.character_id);

            if (isNarrator) {
                // 连续旁白合并为一个块
                const last = items[items.length - 1];
                if (last && last.type === 'narration') {
                    last.text += '\n' + beat.text;
                    return;
                }
                items.push({ type: 'narration', text: beat.text });
            } else {
                pushConnector();
                items.push(beatToCharItem(beat, nextBeat));
            }
        }

        story.scenes.forEach((scene, i) => {
            if (i > 0) pushConnector();
            // 场景分隔：图标标记 + 场景标题
            items.push({ type: 'marker', variant: 'scene', label: scene.scene_title, sceneNumber: i + 1, colorIndex: i % 4 });
            pushConnector();
            let mediaInserted = false;
            for (let beatIndex = 0; beatIndex < scene.beats.length; beatIndex++) {
                const beat = scene.beats[beatIndex];
                const nextBeat = scene.beats[beatIndex + 1];
                const isNarrator = !beat.character_id ||
                                   beat.type === 'narration' ||
                                   (beat.type === 'action' && !beat.character_id);
                if (!mediaInserted && STORY_SCENE_MEDIA[scene.scene_id] && !isNarrator) {
                    pushSceneMedia(scene);
                    mediaInserted = true;
                }
                processBeat(beat, nextBeat);
                if (shouldMergeWithDialogue(beat, nextBeat)) {
                    beatIndex += 1;
                }
            }
            if (!mediaInserted) pushSceneMedia(scene);
        });

        // ending 作为尾章
        if (story.ending) {
            pushConnector();
            items.push({ type: 'marker', variant: 'star', label: story.ending.scene_title });
            pushConnector();
            for (let beatIndex = 0; beatIndex < story.ending.beats.length; beatIndex++) {
                const beat = story.ending.beats[beatIndex];
                const nextBeat = story.ending.beats[beatIndex + 1];
                processBeat(beat, nextBeat);
                if (shouldMergeWithDialogue(beat, nextBeat)) {
                    beatIndex += 1;
                }
            }
        }

        return items;
    }

    // 从 JSON 提取渲染所需的扁平数据结构
    function storyToRenderData(story) {
        const lc = story.log_card || {};
        const mt = lc.memory_token || {};
        return {
            title:    story.title,
            episode:  '#' + (story.story_id || '').replace(/\D+/g, '').slice(-3) || '001',
            status:   'ongoing',
            token: {
                color: '#AECF3A',
                label: mt.name        || '关键物品',
                quote: mt.description || '',
            },
            timeline: mapStoryToTimeline(story),
            echoes: (lc.character_comments || []).map(c => ({
                charId: c.character_id,
                name:   c.speaker,
                text:   c.text,
            })),
        };
    }

    // ── 渲染函数 ──────────────────────────────────────────────────

    function buildCardHTML(item) {
        const seed    = (item.charId || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const initial = CHAR_AVATARS[item.charId] || (item.name || '?')[0];
        const baseCls = CHAR_CSS_CLASS[item.charId] || '';
        const actCls   = item.isAction ? ' char-action-beat' : '';
        const dialogueCls = item.text ? ' char-dialogue-beat' : '';
        const moodHTML = buildMoodTagsHTML(item, seed);
        const actionHTML = item.actionText
            ? `<div class="char-card-action-box">${escapeHTML(item.actionText)}</div>` : '';
        const dialogueHTML = item.text
            ? `<div class="char-card-text">${escapeHTML(item.text || '')}</div>` : '';
        return `<div class="timeline-char-card ${baseCls}${actCls}${dialogueCls}">
            ${moodHTML}
            ${actionHTML}
            ${dialogueHTML}
            <div class="char-card-name-tag">${escapeHTML(item.name || initial)}</div>
        </div>`;
    }

    function tlRow(spineHTML, contentHTML, extraClass = '') {
        return `<div class="tl-row ${extraClass}">
            <div class="tl-spine">${spineHTML}</div>
            <div class="tl-content">${contentHTML}</div>
        </div>`;
    }

    function renderStory(s) {
        document.getElementById('story-title').textContent        = s.title;
        document.getElementById('story-episode').textContent      = s.episode;
        document.getElementById('story-status-text').textContent  = STATUS_LABEL[s.status] || s.status;
        document.querySelector('.story-status-dot').style.background = STATUS_DOT_COLOR[s.status] || '#AAA';

        // 时间线 — 左侧轴线 + 右侧单列叙事
        const tl = document.getElementById('story-timeline');
        tl.innerHTML = s.timeline.map(item => {
            if (item.type === 'marker') {
                const markerHTML =
                    item.variant === 'scene'   ? '<img class="tl-marker--scene-icon" src="/media/scene.png" alt="">' :
                    item.variant === 'diamond' ? '<div class="tl-marker--diamond"></div>' :
                    item.variant === 'star'    ? '<span class="tl-marker--star">✦</span>' :
                                                '<div class="tl-marker--circle"></div>';
                const sceneHTML = item.label
                    ? `<div class="tl-scene-title"><span>${String(item.sceneNumber || '').padStart(2, '0')}</span>${escapeHTML(item.label)}</div>` : '';
                return tlRow(
                    `<div class="tl-line" style="min-height:6px"></div>${markerHTML}<div class="tl-line" style="min-height:6px"></div>`,
                    sceneHTML,
                    `tl-row--scene tl-row--scene-color-${item.colorIndex ?? 0}`);
            }
            if (item.type === 'narration') {
                const mediaHTML = item.media ? `<figure class="story-media-card story-media-card--inline">
                    <img src="${escapeHTML(item.media.src)}" alt="${escapeHTML(item.media.alt || '')}">
                    <figcaption>${escapeHTML(item.media.caption || '')}</figcaption>
                </figure>` : '';
                const narHTML = `<div class="timeline-narration">
                    <div class="timeline-narration-text">${escapeHTML(item.text).replace(/\n/g, '<br>')}</div>
                    ${mediaHTML}
                </div>`;
                return tlRow('<div class="tl-line"></div><div class="tl-marker--diamond"></div><div class="tl-line"></div>', narHTML, 'tl-row--narration');
            }
            if (item.type === 'media') {
                const mediaHTML = `<figure class="story-media-card">
                    <img src="${escapeHTML(item.src)}" alt="${escapeHTML(item.alt || '')}">
                    <figcaption>${escapeHTML(item.caption || '')}</figcaption>
                </figure>`;
                return tlRow('<div class="tl-line"></div>', mediaHTML, 'tl-row--media');
            }
            if (item.type === 'char') {
                const card = buildCardHTML(item);
                return tlRow('<div class="tl-line"></div>', card, 'tl-row--char');
            }
            return '';
        }).join('');

        // 今日回响 — 横排便签
        const ec = document.getElementById('echoes-cards');
        ec.innerHTML = s.echoes.map((e, i) => {
            const seed = (e.charId || '').split('').reduce((a, c) => a + c.charCodeAt(0), i * 13);
            const rot  = stableAngle(seed, 2.5);
            const cls  = ECHO_CSS_CLASS[e.charId] || 'echo-card--default';
            return `<div class="echo-card ${cls}" style="transform:rotate(${rot}deg)">
                <div class="echo-card-quote">${escapeHTML(e.text)}</div>
                <div class="echo-card-attr">${escapeHTML(e.name)}</div>
            </div>`;
        }).join('');
    }

    function bindStoryScroll() {
        const scroller = document.querySelector('.story-scroll');
        const page = document.querySelector('.story-page');
        if (!scroller || !page || scroller.dataset.bound === '1') return;
        scroller.dataset.bound = '1';
        const updateHeader = () => {
            page.classList.toggle('story-scrolled', scroller.scrollTop > 24);
        };
        scroller.addEventListener('scroll', updateHeader, { passive: true });
        updateHeader();
    }

    // ── 从服务器加载故事 JSON ────────────────────────────────────
    // data/stories/ 目录由 server.js 第 18 行静态托管，路径为 /stories/:id.json
    async function loadStory(storyId = 'story1') {
        try {
            const res = await fetch(`/stories/${storyId}.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const story = await res.json();
            renderStory(storyToRenderData(story));
        } catch (e) {
            console.error('[Story] 加载失败:', e);
            document.getElementById('story-title').textContent = '故事加载失败';
        }
    }

    init();
    return { postNote, createNoteDraft, cancelNoteDraft, updateNoteDraft, recordPlace, savePrefs, switchPage, bindRecordModal };
})();
