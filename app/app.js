/* MindCard · 通用记忆卡引擎（v0.2） */
(function () {
  'use strict';

  function startMindCard() {

  /* ================= 基础常量 ================= */
  var DECK = window.MC_DECK_META || { id: 'default', title: '记忆卡', chapters: [], cards: [] };
  var STORE = 'mindcard:progress:' + DECK.id;
  var DAY = 86400000, MIN = 60000;
  var LADDER = [10 * MIN, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY, 60 * DAY, 120 * DAY, 240 * DAY];
  var MAXSTEP = LADDER.length - 1;
  var CHAPTERS = window.CHAPTERS || [];
  var ALL_CARDS = (window.CARDS || []).slice();
  var ALL_BY_ID = {};
  ALL_CARDS.forEach(function (c) { ALL_BY_ID[c.id] = c; });
  var CARDS = [];
  var byId = {};
  var CHNAME = {}, CHSHORT = {};
  CHAPTERS.forEach(function (c) { CHNAME[c.id] = c.name; CHSHORT[c.id] = c.short; });

  var TYPELABEL = { cloze: '填空', choice: '选择', judge: '判断', recall: '简答', code: '代码/计算' };
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  var GRADES = [
    { g: 0, label: '忘记', color: 'var(--rose)' },
    { g: 1, label: '模糊', color: 'var(--gold)' },
    { g: 2, label: '记住', color: 'var(--accent)' },
    { g: 3, label: '简单', color: 'var(--blue)' }
  ];

  /* ================= 状态 ================= */
  var GLOBAL = (window.MindCardDecks && window.MindCardDecks.globalSettings()) || {};
  var storageNotice = null;
  var lastBackupAt = 0;

  function defaultState() {
    return {
      v: 1, created: Date.now(), cards: {}, log: [], hidden: {},
      settings: { newPerDay: 20, reviewLimit: 160, theme: 'light', examDate: '' }
    };
  }
  function validState(s) {
    if (!(s && s.v === 1 && s.cards && typeof s.cards === 'object' && !Array.isArray(s.cards))) return false;
    if (s.log != null && !Array.isArray(s.log)) return false;
    if (s.hidden != null && (typeof s.hidden !== 'object' || Array.isArray(s.hidden))) return false;
    var ids = Object.keys(s.cards);
    for (var i = 0; i < ids.length; i++) {
      var st = s.cards[ids[i]];
      if (st && (typeof st !== 'object' || typeof st.due !== 'number' || isNaN(st.due))) return false;
    }
    return true;
  }
  var S = loadState() || defaultState();
  S.settings = Object.assign({ newPerDay: 20, reviewLimit: 160, theme: 'light', examDate: '' }, S.settings || {});
  S.cards = S.cards || {};
  S.log = Array.isArray(S.log) ? S.log : [];
  S.hidden = (S.hidden && typeof S.hidden === 'object' && !Array.isArray(S.hidden)) ? S.hidden : {};
  if (!GLOBAL.theme) GLOBAL.theme = S.settings.theme || 'light';

  CARDS = ALL_CARDS.filter(function (c) { return !S.hidden[c.id]; });
  CARDS.forEach(function (c) { byId[c.id] = c; });

  function loadState() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE);
      // 兼容旧版单课程应用的进度键（由卡组通过 legacyProgressKey 声明）
      if (!raw && DECK.legacyProgressKey) raw = localStorage.getItem(DECK.legacyProgressKey);
      if (!raw) {
        try {
          var missingBak = localStorage.getItem(STORE + ':bak');
          if (missingBak) {
            var mb = JSON.parse(missingBak);
            if (validState(mb)) {
              storageNotice = '检测到当前卡组主进度缺失，已从备份恢复。建议立即导出备份。';
              return mb;
            }
          }
        } catch (e) { }
        return null;
      }

      var s = null;
      try { s = JSON.parse(raw); } catch (e) { s = null; }
      if (validState(s)) return s;

      // 主数据损坏：保留现场，再尝试备份
      try { localStorage.setItem('mindcard:corrupt:' + Date.now(), raw); } catch (e) { }
      try {
        var bak = localStorage.getItem(STORE + ':bak');
        if (bak) {
          var b = JSON.parse(bak);
          if (validState(b)) {
            storageNotice = '检测到进度数据损坏，已从上次备份恢复。建议立即导出备份。';
            return b;
          }
        }
      } catch (e) { }
      storageNotice = '检测到进度数据损坏，且没有可用备份。已保留原始数据，请导出排查。';
      return null;
    } catch (e) { return null; }
  }
  function save() {
    try {
      if (S.log.length > 6000) S.log = S.log.slice(-6000);
      var json = JSON.stringify(S);
      // 每分钟留一份上一版本，主数据损坏时可回退
      try {
        var prev = localStorage.getItem(STORE);
        if (prev && Date.now() - lastBackupAt > 60000) {
          localStorage.setItem(STORE + ':bak', prev);
          lastBackupAt = Date.now();
        }
      } catch (e) { }
      localStorage.setItem(STORE, json);
      hideStorageWarning('save');
      return true;
    } catch (e) {
      showStorageWarning('保存失败：浏览器存储不可用或空间不足。本次修改没有写入，请立即导出备份。', 'save');
      return false;
    }
  }

  /* ================= 时间与格式化 ================= */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function dayStart(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function dateStr(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + WEEK[d.getDay()];
  }
  function fmtGap(ms) {
    if (ms < 0) ms = 0;
    if (ms < 60 * MIN) return Math.max(1, Math.round(ms / MIN)) + ' 分钟';
    if (ms < DAY) return Math.round(ms / (60 * MIN)) + ' 小时';
    if (ms < 30 * DAY) return Math.round(ms / DAY) + ' 天';
    if (ms < 365 * DAY) return Math.round(ms / (30 * DAY)) + ' 个月';
    return Math.round(ms / (365 * DAY)) + ' 年';
  }
  function fmtDuration(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
  function md(s) {
    var parts = String(s == null ? '' : s).split(/```[a-zA-Z]*\n?/);
    return parts.map(function (p, i) {
      if (i % 2 === 1) return '<pre class="code">' + esc(p.replace(/\n$/, '')) + '</pre>';
      return inline(p);
    }).join('');
  }

  /* ================= SRS 算法 ================= */
  function intervalFor(step, ease) {
    var base = LADDER[Math.min(Math.max(step, 0), MAXSTEP)];
    var f = Math.max(0.8, Math.min(1.35, ease / 2.5));
    return Math.round(base * f);
  }
  function scheduleCore(prev, g) {
    var now = Date.now();
    var isNew = !prev;
    var st = prev ? Object.assign({}, prev) : { step: -1, ease: 2.5, reps: 0, lapses: 0, due: 0, last: 0, lastG: null };
    var step = st.step < 0 ? 0 : st.step;
    var ease = st.ease || 2.5;
    var due;

    st.reps = (st.reps || 0) + 1;
    st.last = now;
    st.lastG = g;

    if (isNew) {
      if (g === 0) { step = 0; due = now + 10 * MIN; }
      else if (g === 1) { step = 0; due = now + 30 * MIN; }
      else if (g === 2) { step = 1; due = now + intervalFor(1, ease); }
      else { step = 2; ease = Math.min(3.2, ease + 0.1); due = now + intervalFor(2, ease); }
    } else if (g === 0) {
      st.lapses = (st.lapses || 0) + 1;
      step = 0; ease = Math.max(1.3, ease - 0.2); due = now + 10 * MIN;
    } else if (g === 1) {
      step = Math.max(1, step); ease = Math.max(1.3, ease - 0.05);
      due = now + Math.max(30 * MIN, Math.round(intervalFor(step, ease) * 0.6));
    } else if (g === 2) {
      step = Math.min(MAXSTEP, step + 1);
      due = now + intervalFor(step, ease);
    } else {
      step = Math.min(MAXSTEP, step + 2);
      ease = Math.min(3.2, ease + 0.15);
      due = now + Math.round(intervalFor(step, ease) * 1.3);
    }
    st.step = step; st.ease = ease; st.due = due;
    return st;
  }
  function schedule(cardId, g) { return scheduleCore(S.cards[cardId], g); }
  function previewGap(cardId, g) {
    var st = scheduleCore(S.cards[cardId], g);
    return fmtGap(st.due - Date.now());
  }
  function stOf(id) { return S.cards[id]; }
  function isMastered(st) { return st && st.step >= 5; }

  /* ================= 统计 ================= */
  function todayStats() {
    var start = dayStart();
    var t = S.log.filter(function (l) { return l.t >= start; });
    var set = {};
    t.forEach(function (l) { set[l.id] = 1; });
    return {
      entries: t.length,
      distinct: Object.keys(set).length,
      news: t.filter(function (l) { return l.n === 1; }).length,
      correct: t.filter(function (l) { return l.g >= 2; }).length
    };
  }
  function streak() {
    var days = {};
    S.log.forEach(function (l) { days[dayKey(l.t)] = 1; });
    var n = 0, d = new Date();
    if (!days[dayKey(d.getTime())]) d.setDate(d.getDate() - 1);
    while (days[dayKey(d.getTime())]) {
      n++; d.setDate(d.getDate() - 1);
      if (n > 3650) break;
    }
    return n;
  }
  function dueNow() {
    var now = Date.now();
    return CARDS.filter(function (c) { var st = S.cards[c.id]; return st && st.due <= now; });
  }
  function newLeft() {
    var unlearned = CARDS.filter(function (c) { return !S.cards[c.id]; }).length;
    var quota = Math.max(0, S.settings.newPerDay - todayStats().news);
    return Math.min(unlearned, quota);
  }
  function masteredCount() {
    return CARDS.filter(function (c) { return isMastered(S.cards[c.id]); }).length;
  }
  function learnedCount() {
    return CARDS.filter(function (c) { return !!S.cards[c.id]; }).length;
  }
  function forecast(days) {
    var out = [], base = dayStart();
    for (var i = 0; i < days; i++) out.push(0);
    CARDS.forEach(function (c) {
      var st = S.cards[c.id];
      if (!st) return;
      if (st.due < base) { out[0]++; return; }
      var idx = Math.floor((st.due - base) / DAY);
      if (idx >= 0 && idx < days) out[idx]++;
    });
    return out;
  }
  function examInfo() {
    var d = S.settings.examDate;
    if (!d) return null;
    var target = new Date(d + 'T00:00:00').getTime();
    if (isNaN(target)) return null;
    return { days: Math.ceil((target - dayStart()) / DAY), date: d };
  }
  function chapterStat(chId) {    var arr = CARDS.filter(function (c) { return c.ch === chId; });
    var learned = 0, mastered = 0;
    arr.forEach(function (c) {
      var st = S.cards[c.id];
      if (st) learned++;
      if (isMastered(st)) mastered++;
    });
    return { total: arr.length, learned: learned, mastered: mastered };
  }

  /* ================= 会话 ================= */
  var session = null;
  var ui = { q: '', filter: 'all', chapter: 0, pendingDeck: null, editDirty: false, editMetaDirty: false, editQuery: '', editFilter: 'all', editDeckId: '', cardQImage: '', cardAImage: '', showNewDeck: false };

  function buildSession(opts) {
    opts = opts || {};
    var mode = opts.mode || 'daily';
    var ch = opts.chapter || 0;
    var now = Date.now();
    var scope = CARDS.filter(function (c) { return !ch || c.ch === ch; });
    var queue = [];

    if (mode === 'single' && opts.id) {
      queue = [opts.id];
    } else if (mode === 'daily') {
      var ts = todayStats();
      var rLimit = Math.max(0, S.settings.reviewLimit - ts.entries);
      var reviews = scope.filter(function (c) { var st = S.cards[c.id]; return st && st.due <= now; })
        .sort(function (a, b) { return S.cards[a.id].due - S.cards[b.id].due; })
        .slice(0, rLimit);
      var nLimit = Math.max(0, S.settings.newPerDay - ts.news);
      var news = scope.filter(function (c) { return !S.cards[c.id]; }).slice(0, nLimit);
      queue = reviews.concat(news);
      if (ch) {
        // 按章复习时放宽每日新卡限制
        var rest = scope.filter(function (c) { return !S.cards[c.id]; });
        queue = reviews.concat(rest);
      }
    } else if (mode === 'chapter') {
      var due = scope.filter(function (c) { var st = S.cards[c.id]; return st && st.due <= now; })
        .sort(function (a, b) { return S.cards[a.id].due - S.cards[b.id].due; });
      var fresh = scope.filter(function (c) { return !S.cards[c.id]; });
      queue = due.concat(fresh);
    } else if (mode === 'ahead') {
      queue = scope.slice().sort(function (a, b) {
        var sa = S.cards[a.id], sb = S.cards[b.id];
        if (!sa && !sb) return 0;
        if (!sa) return 1;
        if (!sb) return -1;
        return sa.due - sb.due;
      }).slice(0, opts.limit || 30);
    }

    if (!queue.length) { toast('这里暂时没有需要复习的卡片'); return false; }
    queue = queue.map(function (c) { return typeof c === 'string' ? c : c.id; });
    session = {
      queue: queue, idx: 0, mode: mode, chapter: ch,
      start: Date.now(), revealed: false, choice: null,
      clozeVal: '', clozeOk: null, history: [],
      counts: [0, 0, 0, 0], unique: {}, relearn: {}, initialTotal: queue.length
    };
    return true;
  }

  function currentCard() {
    if (!session) return null;
    var id = session.queue[session.idx];
    return id ? byId[id] : null;
  }

  function goStudy() {
    if (currentRoute().path === 'study') render();
    else location.hash = '#/study';
    window.scrollTo(0, 0);
  }
  function begin(opts) {
    var ok = buildSession(opts);
    if (!ok && opts && opts.mode === 'daily') {
      ok = buildSession({ mode: 'ahead', limit: 30 });
      if (ok) toast('今日到期已清空，进入自由复习');
    }
    if (ok) goStudy();
  }

  function grade(g) {
    var card = currentCard();
    if (!card || !session) return;
    var isNew = !S.cards[card.id];

    session.history = session.history || [];
    session.history.push({
      cardId: card.id,
      prev: S.cards[card.id] ? JSON.parse(JSON.stringify(S.cards[card.id])) : null,
      logLen: S.log.length,
      idx: session.idx,
      queue: session.queue.slice(),
      counts: session.counts.slice(),
      unique: Object.assign({}, session.unique),
      relearn: Object.assign({}, session.relearn),
      finished: !!session.finished
    });
    if (session.history.length > 30) session.history.shift();

    var st = schedule(card.id, g);
    S.cards[card.id] = st;
    S.log.push({ t: Date.now(), id: card.id, g: g, n: isNew ? 1 : 0 });
    save();

    session.counts[g]++;
    session.unique[card.id] = 1;

    // “忘记”的卡片在本轮稍后再出现一次（最多 2 次）
    if (g === 0 && (session.relearn[card.id] || 0) < 2) {
      session.relearn[card.id] = (session.relearn[card.id] || 0) + 1;
      var at = Math.min(session.queue.length, session.idx + 3);
      session.queue.splice(at, 0, card.id);
    }

    session.idx++;
    session.revealed = false;
    session.choice = null;
    session.clozeVal = '';
    session.clozeOk = null;
    if (session.idx >= session.queue.length) {
      session.finished = true;
    }
    render();
  }

  function undoGrade() {
    if (!session || !session.history || !session.history.length) return;
    var snap = session.history.pop();
    if (snap.prev) S.cards[snap.cardId] = snap.prev;
    else delete S.cards[snap.cardId];
    S.log.length = snap.logLen;
    save();
    session.idx = snap.idx;
    session.queue = snap.queue;
    session.counts = snap.counts;
    session.unique = snap.unique;
    session.relearn = snap.relearn;
    session.finished = false;
    session.revealed = true;
    session.choice = null;
    session.clozeVal = '';
    session.clozeOk = null;
    render();
    toast('已撤销上一张的评分');
  }
  function skipCard() {
    if (!session) return;
    if (session.idx >= session.queue.length - 1) {
      toast('这是最后一张，先评分吧');
      return;
    }
    var id = session.queue.splice(session.idx, 1)[0];
    session.queue.push(id);
    session.revealed = false;
    session.choice = null;
    session.clozeVal = '';
    session.clozeOk = null;
    render();
    toast('已跳过，稍后会再出现');
  }

  /* ================= 提示 ================= */
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900);
  }

  function ensureStorageWarning() {
    var el = document.getElementById('storageWarning');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'storageWarning';
    el.className = 'storage-warning';
    el.innerHTML = '<div class="sw-text"></div><div class="sw-actions">' +
      '<button class="btn sm" data-act="export-all">导出全部备份</button>' +
      '<button class="btn ghost sm" data-act="reload-app">刷新页面</button></div>';
    document.body.appendChild(el);
    return el;
  }
  function showStorageWarning(msg, kind) {
    var el = ensureStorageWarning();
    el.querySelector('.sw-text').textContent = msg;
    el.dataset.kind = kind || 'info';
    el.classList.add('show');
  }
  function hideStorageWarning(kind) {
    var el = document.getElementById('storageWarning');
    if (!el) return;
    if (kind && el.dataset.kind !== kind) return;
    el.classList.remove('show');
  }

  /* ================= 视图：今日 ================= */
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  function hasSheet() {
    return false;
  }

  /* ================= 卡组生命周期：短期 / 长期 ================= */
  function deckMode(deck) {
    if (!deck) return 'short';
    if (MindCardDecks.isBuiltin(deck.id)) return 'builtin';
    return deck.mode === 'long' ? 'long' : 'short';
  }
  function isEditableDeck(deck) {
    return deckMode(deck) === 'short';
  }
  function shortLimit() {
    var n = parseInt(GLOBAL.shortDeckLimit, 10);
    if (isNaN(n)) return 20;
    return Math.max(1, Math.min(20, n));
  }
  function shortDecks() {
    return MindCardDecks.all().filter(function (d) { return deckMode(d) === 'short'; });
  }
  function canAddShort(excludeId) {
    var list = shortDecks();
    // 覆盖一个已经存在的短期卡组不增加数量，即使当前已经超限也允许
    if (excludeId && list.some(function (d) { return d.id === excludeId; })) return true;
    return list.length < shortLimit();
  }
  function modeLabel(mode) {
    return mode === 'long' ? '长期' : (mode === 'builtin' ? '内置' : '短期');
  }

  /* ================= 图片题 ================= */
  function isImageData(data) {
    return typeof data === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(data);
  }
  function imageTag(data, alt, cls) {
    if (!isImageData(data)) return '';
    return '<img class="card-img' + (cls ? ' ' + cls : '') + '" src="' +
      data.replace(/"/g, '&quot;') + '" alt="' + esc(alt || '图片') + '" loading="lazy">';
  }
  function imageFieldContent(which, data) {
    if (isImageData(data)) {
      return '<div class="img-preview"><img src="' + data.replace(/"/g, '&quot;') + '" alt="图片预览">' +
        '<button class="btn ghost sm" data-act="remove-image" data-which="' + which + '">移除图片</button></div>';
    }
    return '<button class="btn ghost sm" data-act="pick-image" data-which="' + which + '">上传图片</button>' +
      '<span class="tiny muted">也可以直接粘贴截图</span>';
  }
  function imageFieldHtml(which, data) {
    var label = which === 'q' ? '题目图片' : '答案图片';
    return '<div class="field"><label>' + label + '（可选，可只放图片）</label>' +
      '<div class="image-field" id="' + which + 'ImageBox">' + imageFieldContent(which, data) + '</div>' +
      '<input type="file" id="' + which + 'ImageFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>' +
      '</div>';
  }
  function refreshImageBox(which) {
    var box = document.getElementById(which + 'ImageBox');
    if (!box) return;
    box.innerHTML = imageFieldContent(which, which === 'q' ? ui.cardQImage : ui.cardAImage);
  }
  function setCardImage(which, data) {
    if (which === 'q') ui.cardQImage = data;
    else ui.cardAImage = data;
    ui.editDirty = true;
    refreshImageBox(which);
  }
  function processImageFile(file, which) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
      alert('只支持 PNG / JPEG / WebP / GIF 图片。');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      alert('图片超过 12 MB，请先裁剪或压缩。');
      return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      try {
        var maxSide = 1400;
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        var mime = 'image/webp';
        var out = canvas.toDataURL(mime, 0.82);
        if (out.indexOf('data:image/webp') !== 0) {
          mime = 'image/jpeg';
          out = canvas.toDataURL(mime, 0.82);
        }
        var quality = 0.82;
        while (out.length > 420000 && quality > 0.5) {
          quality -= 0.08;
          out = canvas.toDataURL(mime, quality);
        }
        if (out.length > 600000) {
          alert('图片压缩后仍然太大（约 ' + Math.round(out.length / 1024) + ' KB）。请裁剪后再试。');
          return;
        }
        setCardImage(which, out);
        toast('图片已加入（约 ' + Math.round(out.length / 1024) + ' KB）');
      } catch (e) {
        alert('处理图片失败：' + e.message);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      alert('无法读取这张图片，请换一张试试。');
    };
    img.src = url;
  }
  function onPaste(e) {
    if (currentRoute().path !== 'edit') return;
    var id = e.target && e.target.id;
    if (id !== 'cardQuestion' && id !== 'cardAnswer') return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile();
        if (f) {
          e.preventDefault();
          processImageFile(f, id === 'cardQuestion' ? 'q' : 'a');
        }
        break;
      }
    }
  }

  function viewToday() {
    var due = dueNow();
    var nLeft = newLeft();
    var ts = todayStats();
    var done = ts.distinct;
    var target = done + due.length + nLeft;
    var ringPct = target ? Math.min(100, Math.round((done / target) * 100)) : 100;
    var streakN = streak();
    var exam = examInfo();
    var examText = '';
    if (exam) {
      examText = exam.days >= 0
        ? '<span class="chip gold" style="margin-left:8px">距考试还有 <b>' + exam.days + '</b> 天</span>'
        : '<span class="chip" style="margin-left:8px">考试日期已过</span>';
    }
    var fc = forecast(7);
    var maxFc = Math.max.apply(null, fc.concat([1]));

    var fcHtml = fc.map(function (n, i) {
      var h = Math.max(4, Math.round((n / maxFc) * 100));
      var d = new Date(); d.setDate(d.getDate() + i);
      var label = i === 0 ? '今天' : (d.getMonth() + 1) + '/' + d.getDate();
      return '<div class="day"><div class="n">' + n + '</div>' +
        '<div class="col' + (n === 0 ? ' zero' : '') + '" style="height:' + h + '%"></div>' +
        '<div class="d' + (i === 0 ? ' today' : '') + '">' + label + '</div></div>';
    }).join('');

    var chHtml = CHAPTERS.map(function (ch) {
      var s = chapterStat(ch.id);
      var p = pct(s.mastered, s.total);
      return '<a class="chrow" href="#/library?ch=' + ch.id + '">' +
        '<span class="idx">' + pad(ch.id) + '</span>' +
        '<span class="name">' + esc(ch.name) + '</span>' +
        '<span class="bar"><i style="width:' + p + '%"></i></span>' +
        '<span class="pct">' + s.mastered + '/' + s.total + '</span></a>';
    }).join('');

    return '' +
      '<section class="hero">' +
      '<div><p class="eyebrow">' + dateStr() + ' · ' + esc(DECK.title) + '</p>' +
      '<h1>今天要复习 <em>' + (due.length + nLeft) + '</em> 张卡片</h1>' +
      '<p class="lead">到期复习 <b>' + due.length + '</b> 张 · 新卡 <b>' + nLeft + '</b> 张 · 已连续打卡 <b>' + streakN + '</b> 天' + examText + '</p>' +
      '<div class="hero-actions">' +
      '<button class="btn" data-act="start-daily">开始今日复习' + (due.length + nLeft === 0 ? '（自由模式）' : '') + '</button>' +
      '<button class="btn ghost" data-act="start-ahead">提前复习 30 张</button>' +
      (hasSheet() ? '<a class="btn ghost" href="#/sheet">速查手册</a>' : '<a class="btn ghost" href="#/decks">切换卡组</a>') +
      '</div></div>' +
      '<div class="hero-side"><div class="ring" style="--p:' + ringPct + '">' +
      '<div class="val"><b>' + ringPct + '%</b><span>今日进度</span></div></div>' +
      '<div class="caption">已复习 ' + done + ' 张 / 目标 ' + target + ' 张</div></div>' +
      '</section>' +

      '<div class="stat-grid">' +
      '<div class="stat cool"><span class="k">已掌握卡片</span><span class="v">' + masteredCount() + '<small>/ ' + CARDS.length + '</small></span></div>' +
      '<div class="stat"><span class="k">已学卡片</span><span class="v">' + learnedCount() + '<small>/ ' + CARDS.length + '</small></span></div>' +
      '<div class="stat warm"><span class="k">连续打卡</span><span class="v">' + streakN + '<small>天</small></span></div>' +
      '<div class="stat"><span class="k">今日复习次数</span><span class="v">' + ts.entries + '<small>次</small></span></div>' +
      '</div>' +

      '<div class="cols">' +
      '<section class="panel"><div class="panel-head"><h2>未来 7 天到期预测</h2><span class="muted">按当前记忆进度</span></div>' +
      '<div class="forecast">' + fcHtml + '</div>' +
      '<p class="tiny muted" style="margin-top:10px">柱高表示当天到期的卡片数量。提前预习可以削峰。</p></section>' +

      '<section class="panel"><div class="panel-head"><h2>艾宾浩斯遗忘曲线</h2><span class="muted">间隔重复</span></div>' +
      curveSVG() +
      '<div class="ladder">' + ['10分', '1天', '2天', '4天', '7天', '15天', '30天', '60天', '120天'].map(function (x, i) {
        return '<span class="' + (i < 3 ? 'on' : '') + '">' + x + '</span>';
      }).join('') + '</div>' +
      '<p class="tiny muted" style="margin-top:10px">每次评分都会重排下次复习时间；答错则回到 10 分钟后重新学习。</p></section>' +
      '</div>' +

      '<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>章节掌握度</h2>' +
      '<a class="muted tiny" href="#/library">查看全部卡片 →</a></div>' +
      '<div class="chapters">' + chHtml + '</div></section>' +

      '<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>怎么用</h2></div>' +
      '<div class="grid-tips">' +
      '<p>① 每天点「开始今日复习」，按系统排好的顺序过卡；先自己回想，再看答案。</p>' +
      '<p>② 按真实感受评分：<b>忘记 / 模糊 / 记住 / 简单</b>。评分越诚实，复习节奏越准。</p>' +
      '<p>③ 需要突击时用「提前复习」，但别每天都透支，否则到期卡片会堆积。</p>' +
      '<p>④ 考前用「卡库」筛选易错卡，按章节把薄弱点过一遍。</p>' +
      '</div></section>';
  }

  function curveSVG() {
    var W = 340, H = 140, padL = 8, padR = 8, padT = 10, padB = 18;
    var pts = [];
    var tMax = 30;
    for (var t = 0; t <= tMax; t += 0.25) {
      var x = padL + (Math.log(1 + t) / Math.log(1 + tMax)) * (W - padL - padR);
      var r = Math.exp(-t / 6);
      var y = padT + (1 - r) * (H - padT - padB);
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    var dots = [1, 2, 4, 7, 15, 30].map(function (d) {
      var x = padL + (Math.log(1 + d) / Math.log(1 + tMax)) * (W - padL - padR);
      var r = Math.exp(-d / 6);
      var y = padT + (1 - r) * (H - padT - padB);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.2" fill="var(--accent)"/>';
    }).join('');
    return '<div class="curve-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"/>' +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" points="' + pts.join(' ') + '"/>' +
      dots +
      '<text x="' + padL + '" y="' + (H - 4) + '" font-size="9" fill="var(--muted)">0</text>' +
      '<text x="' + (W - 34) + '" y="' + (H - 4) + '" font-size="9" fill="var(--muted)">30 天</text>' +
      '<text x="' + (W - 46) + '" y="' + (padT + 10) + '" font-size="9" fill="var(--muted)">保持率</text>' +
      '</svg></div>';
  }

  /* ================= 视图：复习 ================= */
  function viewStudy() {
    if (!session) { return '<div class="empty">还没有开始复习。<br><br><a class="btn" href="#/today">回到今日</a></div>'; }
    if (session.finished || session.idx >= session.queue.length) return viewSummary();

    var card = currentCard();
    if (!card) return viewSummary();

    var st = stOf(card.id);
    var status = !st ? '新卡' : (isMastered(st) ? '已掌握' : '复习中');
    var prog = Math.round((session.idx / session.queue.length) * 100);

    var body = '<div class="card-top">' +
      '<span class="chip accent">第 ' + card.ch + ' 章 · ' + esc(CHSHORT[card.ch] || '') + '</span>' +
      '<span class="chip">' + (TYPELABEL[card.type] || '卡片') + '</span>' +
      (card.tag && card.tag !== TYPELABEL[card.type] ? '<span class="chip">' + esc(card.tag) + '</span>' : '') +
      '<span class="right"><span class="chip' + (!st ? ' gold' : '') + '">' + status + '</span></span>' +
      '</div>' +
      '<div class="q">' + imageTag(card.qImage, '题目图片') + md(card.q) + '</div>' +
      (card.pre ? '<pre class="code">' + esc(card.pre) + '</pre>' : '');

    if (card.type === 'choice' || card.type === 'judge') {
      var opts = card.type === 'judge' ? ['正确（√）', '错误（×）'] : card.opts;
      body += '<div class="opts">' + opts.map(function (o, i) {
        var cls = 'opt';
        if (session.revealed) {
          if (i === card.ans) cls += ' correct';
          else if (session.choice === i) cls += ' wrong';
          else cls += ' dim';
        }
        return '<button class="' + cls + '" data-act="opt" data-i="' + i + '"' + (session.revealed ? ' disabled' : '') + '>' +
          '<span class="key">' + String.fromCharCode(65 + i) + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    } else if (card.type === 'cloze') {
      body += '<div class="cloze"><input id="clozeInput" autocomplete="off" placeholder="输入关键答案（多空用空格）" value="' + esc(session.clozeVal || '') + '"' + (session.revealed ? ' disabled' : '') + '>' +
        (session.revealed ? '' : '<button class="btn" data-act="cloze-submit">提交</button>') + '</div>' +
        '<div class="cloze-feedback ' + (session.clozeOk === true ? 'ok' : session.clozeOk === false ? 'no' : '') + '">' +
        (session.clozeOk === true ? '✓ 正确' : session.clozeOk === false ? '✗ 与参考答案不完全一致，对照下方答案' : '') + '</div>';
    }

    if (session.revealed) {
      body += '<div class="answer"><span class="label">答案 / 解析</span>' + imageTag(card.aImage, '答案图片') + md(card.a) + '</div>' +
        '<div class="card-foot"><div class="ratebar">' + GRADES.map(function (gr) {
          return '<button class="rate" data-act="rate" data-g="' + gr.g + '"><b>' + gr.label + '</b><span>' + previewGap(card.id, gr.g) + '</span><kbd>' + (gr.g + 1) + '</kbd></button>';
        }).join('') + '</div></div>';
    } else {
      body += '<div class="card-foot"><button class="reveal-btn" data-act="reveal">显示答案 <span class="muted">（空格）</span></button></div>';
    }

    return '<div class="study">' +
      '<div class="study-head"><div class="study-tools">' +
      '<button class="quit" data-act="quit">← 退出</button>' +
      (session.history && session.history.length ? '<button class="quit" data-act="undo-grade">撤销</button>' : '') +
      '<button class="quit" data-act="skip-card">跳过</button>' +
      '</div>' +
      '<div class="bar"><i style="width:' + prog + '%"></i></div>' +
      '<span class="counter">' + (session.idx + 1) + ' / ' + session.queue.length + '</span></div>' +
      '<article class="card">' + body + '</article>' +
      '<p class="kbd-hint"><kbd>空格</kbd> 显示答案　<kbd>1</kbd> 忘记　<kbd>2</kbd> 模糊　<kbd>3</kbd> 记住　<kbd>4</kbd> 简单　<kbd>U</kbd> 撤销</p>' +
      '</div>';
  }

  function viewSummary() {
    var s = session;
    var total = Object.keys(s.unique).length;
    var dur = Date.now() - s.start;
    var acc = total ? Math.round((s.counts[2] + s.counts[3]) / (s.counts[0] + s.counts[1] + s.counts[2] + s.counts[3]) * 100) : 0;
    return '<div class="summary">' +
      '<p class="eyebrow">本轮完成</p>' +
      '<div class="big">🎉</div>' +
      '<h1>复习了 ' + total + ' 张卡片</h1>' +
      '<p class="lead">用时 ' + fmtDuration(dur) + ' · 本轮正确率 ' + acc + '%</p>' +
      '<div class="summary-grid">' +
      '<div><b style="color:var(--rose)">' + s.counts[0] + '</b><span>忘记</span></div>' +
      '<div><b style="color:var(--gold)">' + s.counts[1] + '</b><span>模糊</span></div>' +
      '<div><b style="color:var(--accent)">' + s.counts[2] + '</b><span>记住</span></div>' +
      '<div><b style="color:var(--blue)">' + s.counts[3] + '</b><span>简单</span></div>' +
      '</div>' +
      '<div class="hero-actions" style="justify-content:center">' +
      '<a class="btn" href="#/today" data-act="clear-session">回到今日</a>' +
      '<button class="btn ghost" data-act="start-daily-again">再来一组</button>' +
      '<a class="btn ghost" href="#/stats">查看统计</a>' +
      '</div></div>';
  }

  /* ================= 视图：卡库 ================= */
  var FILTERS = [
    { k: 'all', label: '全部' },
    { k: 'new', label: '未学' },
    { k: 'learning', label: '学习中' },
    { k: 'mastered', label: '已掌握' },
    { k: 'leech', label: '易错' }
  ];

  function filterCards() {
    var q = ui.q.trim().toLowerCase();
    return CARDS.filter(function (c) {
      if (ui.chapter && c.ch !== ui.chapter) return false;
      if (q) {
        var hay = (c.q + ' ' + (c.a || '') + ' ' + (c.tag || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      var st = S.cards[c.id];
      var f = ui.filter;
      if (f === 'new' && st) return false;
      if (f === 'learning' && (!st || st.step >= 5)) return false;
      if (f === 'mastered' && !isMastered(st)) return false;
      if (f === 'leech' && !(st && st.lapses >= 2)) return false;
      return true;
    });
  }

  function viewLibrary() {
    var chHtml = CHAPTERS.map(function (ch) {
      var s = chapterStat(ch.id);
      var p = pct(s.learned, s.total);
      return '<div class="chcard" data-act="set-chapter" data-ch="' + ch.id + '" role="button" tabindex="0">' +
        '<div class="top"><span class="num">' + pad(ch.id) + '</span><span class="chip">' + s.total + ' 张</span></div>' +
        '<div class="name">' + esc(ch.name) + '</div>' +
        '<div class="bar"><i style="width:' + p + '%"></i></div>' +
        '<div class="meta"><span>已学 ' + s.learned + ' / ' + s.total + '</span><button class="go" data-act="start-chapter" data-ch="' + ch.id + '">复习 →</button></div>' +
        '</div>';
    }).join('');

    return '<div class="page-head"><div><p class="eyebrow">知识卡片</p><h1>卡库</h1>' +
      '<p class="lead">共 ' + CARDS.length + ' 张卡片，来自「' + esc(DECK.title) + '」。可搜索、按章筛选、单独复习或删除。</p></div>' +
      '<div class="right"><button class="btn ghost sm" data-act="start-ahead">提前复习</button></div></div>' +
      '<div class="chgrid">' + chHtml + '</div>' +
      '<div class="searchbar"><input id="searchCards" type="search" placeholder="搜索题干、答案或标签…" value="' + esc(ui.q) + '">' +
      '<div class="filters">' + FILTERS.map(function (f) {
        return '<button class="' + (ui.filter === f.k ? 'on' : '') + '" data-act="set-filter" data-f="' + f.k + '">' + f.label + '</button>';
      }).join('') + '</div></div>' +
      '<div id="libList">' + libraryListHtml() + '</div>';
  }

  function libraryListHtml() {
    var list = filterCards();
    var banner = ui.chapter ? '<div class="lib-active">正在查看：<b>第 ' + ui.chapter + ' 章 · ' + esc(CHNAME[ui.chapter] || '') + '</b>' +
      '<button data-act="clear-chapter">显示全部章节</button>' +
      '<button data-act="start-chapter" data-ch="' + ui.chapter + '">复习本章 →</button></div>' : '';
    if (!list.length) return banner + '<div class="empty">没有匹配的卡片，换个关键词试试。</div>';
    return banner + '<div class="cardlist">' + list.map(function (c) {
      var st = S.cards[c.id];
      var cls = !st ? 'new' : (isMastered(st) ? 'mastered' : (st.reps <= 1 ? 'learning' : 'review'));
      var status = !st ? '未学' : (st.due <= Date.now() ? '待复习' : '下次 ' + fmtGap(st.due - Date.now()) + '后');
      return '<div class="cardrow">' +
        '<span class="dot ' + cls + '"></span>' +
        '<div class="body">' + (c.qImage ? '<div class="thumb">' + imageTag(c.qImage, '题目图片', 'lib-thumb') + '</div>' : '') +
        '<div class="qq">' + esc(c.q || (c.qImage ? '（图片题）' : '')) + '</div>' +
        '<div class="mm">第 ' + c.ch + ' 章 · ' + (TYPELABEL[c.type] || '') + ' · ' + status +
        (st && st.lapses ? ' · 遗忘 ' + st.lapses + ' 次' : '') + '</div></div>' +
        '<button class="go" data-act="open-card" data-id="' + c.id + '">单卡复习</button>' +
        (isEditableDeck(DECK) ? '<button class="del" data-act="delete-card" data-id="' + c.id + '" title="删除这张卡片">删除</button>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function refreshLibraryList() {
    var el = document.getElementById('libList');
    if (el) el.innerHTML = libraryListHtml();
    var fs = document.querySelectorAll('[data-act="set-filter"]');
    fs.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-f') === ui.filter); });
  }

  /* ================= 视图：统计 ================= */
  function viewStats() {
    var total = CARDS.length;
    var learned = learnedCount();
    var mastered = masteredCount();
    var all = S.log.length;
    var good = S.log.filter(function (l) { return l.g >= 2; }).length;
    var rate = all ? Math.round((good / all) * 100) : 0;
    var fc = forecast(14);
    var maxFc = Math.max.apply(null, fc.concat([1]));

    var counts = [0, 0, 0, 0];
    S.log.forEach(function (l) { counts[l.g] = (counts[l.g] || 0) + 1; });

    // 84 天热力图
    var cells = '';
    var base = dayStart();
    var map = {};
    S.log.forEach(function (l) { var k = dayKey(l.t); map[k] = (map[k] || 0) + 1; });
    for (var i = 83; i >= 0; i--) {
      var key = dayKey(base - i * DAY);
      var n = map[key] || 0;
      var lv = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4;
      cells += '<div class="hm' + (lv ? ' l' + lv : '') + '" title="' + key + '：' + n + ' 次复习"></div>';
    }

    var fcHtml = fc.map(function (n, i) {
      var h = Math.max(3, Math.round((n / maxFc) * 100));
      var d = new Date(); d.setDate(d.getDate() + i);
      return '<div class="day"><div class="n">' + n + '</div><div class="col' + (n === 0 ? ' zero' : '') + '" style="height:' + h + '%"></div>' +
        '<div class="d' + (i === 0 ? ' today' : '') + '">' + (i === 0 ? '今天' : (d.getMonth() + 1) + '/' + d.getDate()) + '</div></div>';
    }).join('');

    var maxC = Math.max.apply(null, counts.concat([1]));
    var gradeBars = GRADES.map(function (g) {
      var c = counts[g.g] || 0;
      return '<div class="gradebar"><span>' + g.label + '</span>' +
        '<span class="track"><i style="width:' + Math.round((c / maxC) * 100) + '%;background:' + g.color + '"></i></span>' +
        '<span class="muted">' + c + '</span></div>';
    }).join('');

    var chRows = CHAPTERS.map(function (ch) {
      var s = chapterStat(ch.id);
      var p = pct(s.mastered, s.total);
      return '<a class="chrow" href="#/library?ch=' + ch.id + '">' +
        '<span class="idx">' + pad(ch.id) + '</span><span class="name">' + esc(ch.name) + '</span>' +
        '<span class="bar"><i style="width:' + p + '%"></i></span>' +
        '<span class="pct">' + s.mastered + '/' + s.total + '</span></a>';
    }).join('');

    return '<div class="page-head"><div><p class="eyebrow">学习数据</p><h1>统计</h1>' +
      '<p class="lead">所有记录只保存在本机浏览器中，可随时导出备份。</p></div></div>' +
      '<div class="stat-grid">' +
      '<div class="stat cool"><span class="k">已掌握</span><span class="v">' + mastered + '<small>/ ' + total + '</small></span></div>' +
      '<div class="stat"><span class="k">已学</span><span class="v">' + learned + '<small>/ ' + total + '</small></span></div>' +
      '<div class="stat"><span class="k">累计复习</span><span class="v">' + all + '<small>次</small></span></div>' +
      '<div class="stat warm"><span class="k">正确率（记住+简单）</span><span class="v">' + rate + '<small>%</small></span></div>' +
      '</div>' +

      '<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>复习热力图</h2><span class="muted">最近 12 周</span></div>' +
      '<div class="heatmap">' + cells + '</div>' +
      '<div class="hm-legend">少<span class="hm"></span><span class="hm l1"></span><span class="hm l2"></span><span class="hm l3"></span><span class="hm l4"></span>多</div></section>' +

      '<div class="cols even" style="margin-top:16px">' +
      '<section class="panel"><div class="panel-head"><h2>评分分布</h2></div><div class="gradebars">' + gradeBars + '</div>' +
      '<p class="tiny muted" style="margin-top:12px">如果「忘记」长期偏高，说明新卡节奏过快，可以调低每日新卡上限。</p></section>' +
      '<section class="panel"><div class="panel-head"><h2>未来 14 天到期</h2></div><div class="forecast" style="height:120px">' + fcHtml + '</div></section>' +
      '</div>' +

      '<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>章节掌握度</h2><span class="muted">已掌握 = 复习间隔 ≥ 15 天</span></div>' +
      '<div class="chapters">' + chRows + '</div></section>';
  }

  /* ================= 视图：速查 ================= */
  function sheetSection(title, body, open) {
    return '<details' + (open ? ' open' : '') + '><summary>' + title + '<span class="count">点击展开/收起</span></summary>' +
      '<div class="inner">' + body + '</div></details>';
  }

  function viewSheet() {
    return '<div class="page-head"><div><p class="eyebrow">考前速查</p><h1>速查手册</h1>' +
      '<p class="lead">公开示例没有内置速查表。</p></div></div>' +
      '<section class="panel"><p class="small">速查表是卡组的可选扩展。当前公开仓库只包含示例卡组，因此不提供课程速查表。' +
      '你可以用「卡库」筛选易错卡，或导入自己的卡组。</p>' +
      '<div class="hero-actions" style="margin-top:16px"><a class="btn" href="#/decks">前往卡组</a>' +
      '<a class="btn ghost" href="#/library">打开卡库</a></div></section>';
  }

  /* ================= 视图：卡组 ================= */
  function deckCardHtml(d, activeId) {
    var mode = deckMode(d);
    var builtin = mode === 'builtin';
    var editable = mode === 'short';
    var isActive = d.id === activeId;
    var badge = isActive ? '使用中' : modeLabel(mode);
    var badgeClass = isActive ? 'accent' : (mode === 'long' ? 'gold' : '');
    var actions = '';
    if (!isActive) actions += '<button class="btn sm" data-act="switch-deck" data-id="' + d.id + '">切换</button>';
    if (editable) actions += '<a class="btn ghost sm" href="#/edit?id=' + d.id + '">编辑</a>';
    if (!editable) actions += '<button class="btn ghost sm" data-act="clone-deck" data-id="' + d.id + '">另存为短期</button>';
    actions += '<button class="btn ghost sm" data-act="export-deck" data-id="' + d.id + '">导出</button>';
    if (editable) actions += '<button class="btn ghost sm" data-act="convert-long" data-id="' + d.id + '">转为长期</button>';
    if (!builtin) actions += '<button class="btn ghost sm" data-act="delete-deck" data-id="' + d.id + '" style="color:var(--rose);border-color:var(--rose)">删除</button>';
    return '<div class="deckcard' + (isActive ? ' active' : '') + '">' +
      '<div class="deck-top"><span class="chip ' + badgeClass + '">' + badge + '</span>' +
      '<span class="tiny muted">' + esc(d.language || '') + '</span></div>' +
      '<h3>' + esc(d.title) + '</h3>' +
      '<p class="tiny muted deck-desc">' + esc(d.subtitle || d.description || '—') + '</p>' +
      '<div class="deck-meta"><span>' + d.chapters.length + ' 章 · ' + d.cards.length + ' 卡</span>' +
      '<code>' + esc(d.id) + '</code></div>' +
      '<div class="deck-actions">' + actions + '</div></div>';
  }

  function viewDecks() {
    var all = MindCardDecks.all();
    var activeId = DECK.id;
    var shorts = all.filter(function (d) { return deckMode(d) === 'short'; });
    var longs = all.filter(function (d) { return deckMode(d) === 'long'; });
    var builtins = all.filter(function (d) { return deckMode(d) === 'builtin'; });
    var limit = shortLimit();
    var over = shorts.length > limit;
    var full = shorts.length >= limit;
    var showNew = !!ui.showNewDeck;

    var createPanel = '<section class="panel new-deck-panel"><div class="panel-head"><h2>新建短期卡组</h2>' +
      '<span class="muted">' + shorts.length + ' / ' + limit + '</span></div>' +
      (full ? '<p class="small" style="color:var(--gold)">短期卡组已达上限。请先把一个短期卡组“转为长期”或删除，再新建。</p>' : '') +
      '<div class="form-row">' +
      '<div class="field"><label>卡组名称</label><input id="newDeckName" maxlength="80" placeholder="例如：数据结构期末"></div>' +
      '<div class="field"><label>计划卡片数（仅展示）</label><input id="newDeckTarget" type="number" min="0" max="9999" placeholder="例如：40"></div>' +
      '</div>' +
      '<div class="field"><label>描述（可选）</label><input id="newDeckDesc" maxlength="200" placeholder="这门课考什么、怎么用"></div>' +
      '<div class="hero-actions"><button class="btn" data-act="create-deck"' + (full ? ' disabled' : '') + '>' +
      (full ? '短期卡组已满' : '创建并添加卡片') + '</button>' +
      '<button class="btn ghost" data-act="toggle-new-deck">取消</button></div>' +
      '</section>';

    function grid(list, emptyText) {
      if (!list.length) return '<div class="empty deck-empty">' + esc(emptyText) + '</div>';
      return '<div class="deckgrid">' + list.map(function (d) { return deckCardHtml(d, activeId); }).join('') + '</div>';
    }

    var pending = ui.pendingDeck;
    var preview = '';
    if (pending) {
      preview = '<div class="import-preview">' +
        '<div class="panel-head"><div><h3>预览：' + esc(pending.title) + '</h3>' +
        '<p class="tiny muted">' + pending.chapters.length + ' 章 · ' + pending.cards.length + ' 张卡片 · id：' + esc(pending.id) + '</p></div></div>' +
        '<ul class="preview-list">' + pending.cards.slice(0, 4).map(function (c) {
          return '<li><span class="chip">' + esc(TYPELABEL[c.type] || c.type) + '</span> ' + esc(c.question || (c.questionImage ? '（图片题）' : '')) +
            '<div class="tiny muted">→ ' + esc(c.answer || (c.answerImage ? '（图片答案）' : '')).slice(0, 80) + '</div></li>';
        }).join('') + '</ul>' +
        '<div class="hero-actions"><button class="btn" data-act="save-pending">保存并开始</button>' +
        '<button class="btn ghost" data-act="cancel-pending">取消</button></div></div>';
    }

    return '<div class="page-head"><div><p class="eyebrow">卡组</p><h1>卡组</h1>' +
      '<p class="lead">短期卡组可在网页里编辑，长期卡组只读；两者都可以导出为 JSON 文件保存到电脑。</p></div>' +
      '<div class="right"><button class="btn ghost sm" data-act="export-all">导出全部</button>' +
      '<button class="btn ghost sm" data-act="import-deck">导入卡组</button></div></div>' +

      '<section class="deck-section"><div class="section-head">' +
      '<h2>短期卡组</h2><span class="chip ' + (over ? 'gold' : 'accent') + '">' + shorts.length + ' / ' + limit + '</span>' +
      '<button class="icon-btn add-deck" data-act="toggle-new-deck" title="新建短期卡组" aria-label="新建短期卡组"' + (full ? ' disabled' : '') + '>+</button>' +
      '<span class="tiny muted">可编辑 · ' + (over ? '已超过上限，请转为长期或删除' : '上限 ' + limit + ' 个') + '</span></div>' +
      (showNew ? createPanel : '') +
      grid(shorts, '还没有短期卡组。点左上角「+」新建，或导入一个 JSON/Markdown。') + '</section>' +

      '<section class="deck-section"><div class="section-head">' +
      '<h2>长期卡组</h2><span class="chip gold">只读</span>' +
      '<span class="tiny muted">网页内不可编辑；需要修改时导出文件编辑后重新导入，或另存为短期副本</span></div>' +
      grid(longs, '还没有长期卡组。把短期卡组“转为长期”后会出现在这里。') + '</section>' +

      '<section class="deck-section"><div class="section-head">' +
      '<h2>内置示例</h2><span class="chip">只读</span>' +
      '<span class="tiny muted">随网页发布，不能删除或修改</span></div>' +
      grid(builtins, '没有内置卡组。') + '</section>' +

      '<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>导入已有内容</h2>' +
      '<span class="muted">导入默认成为短期卡组</span></div>' +
      '<p class="small">支持 <b>卡组 JSON</b> 与 <b>Markdown / TXT</b>。Markdown 里用 <code>Q:</code> / <code>A:</code>、两列表格或 <code>术语：定义</code> 来组织内容，识别率最高。</p>' +
      '<p class="small muted" style="margin-top:6px">导入的卡组和学习进度只保存在当前浏览器；内置卡组随网页发布，所有访问者都能看到。</p>' +
      (full ? '<p class="small" style="color:var(--gold)">短期卡组已满，导入前请先转长期或删除一个。</p>' : '') +
      '<div class="hero-actions" style="margin-top:14px">' +
      '<button class="btn" data-act="import-deck">导入 .json 卡组</button>' +
      '<button class="btn ghost" data-act="import-notes">用 .md / .txt 生成</button>' +
      '</div>' +
      '<input type="file" id="deckFile" accept=".json,application/json" hidden>' +
      '<input type="file" id="noteFile" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden>' +
      '<p class="tiny muted" style="margin-top:12px">Word / PPT / PDF 请先用仓库里的 <code>tools/convert.py</code> 转成卡组 JSON，再在这里导入。</p>' +
      preview + '</section>';
  }

  /* ================= 视图：编辑卡组 ================= */
  function viewEdit(query) {
    var m = /(?:^|&)id=([^&]+)/.exec(query || '');
    var id = '';
    try { id = m ? decodeURIComponent(m[1]) : ''; } catch (e) { id = ''; }
    var deck = MindCardDecks.find(id);
    if (!deck) {
      return '<div class="page-head"><div><p class="eyebrow">卡组编辑</p><h1>找不到卡组</h1>' +
        '<p class="lead">它可能已被删除。</p></div></div>' +
        '<div class="hero-actions"><a class="btn" href="#/decks">返回卡组</a></div>';
    }
    if (MindCardDecks.isBuiltin(deck.id)) {
      return '<div class="page-head"><div><p class="eyebrow">卡组编辑</p><h1>内置卡组不可编辑</h1>' +
        '<p class="lead">内置示例是只读的。你可以复制为短期卡组后修改，或直接导出。</p></div></div>' +
        '<div class="hero-actions"><button class="btn" data-act="clone-deck" data-id="' + deck.id + '">复制为短期卡组</button>' +
        '<button class="btn ghost" data-act="export-deck" data-id="' + deck.id + '">导出到文件</button>' +
        '<a class="btn ghost" href="#/decks">返回卡组</a></div>';
    }
    if (deckMode(deck) === 'long') {
      return '<div class="page-head"><div><p class="eyebrow">卡组编辑</p><h1>长期卡组（只读）</h1>' +
        '<p class="lead">长期卡组在网页内不能修改，但可以正常复习。需要修改时，导出 JSON 编辑后重新导入，或另存为短期副本。</p></div></div>' +
        '<section class="panel"><p class="small"><b>' + esc(deck.title) + '</b> · ' +
        (deck.cards || []).length + ' 张卡片 · 只读</p>' +
        '<div class="hero-actions" style="margin-top:16px">' +
        '<button class="btn" data-act="export-deck" data-id="' + deck.id + '">导出到文件</button>' +
        '<button class="btn ghost" data-act="clone-deck" data-id="' + deck.id + '">另存为短期副本</button>' +
        '<a class="btn ghost" href="#/decks">返回卡组</a></div></section>';
    }
    if (ui.editDeckId !== deck.id) {
      ui.editDeckId = deck.id;
      ui.editQuery = '';
      ui.editFilter = 'all';
      ui.editCardId = null;
      ui.editDirty = false;
      ui.editMetaDirty = false;
      ui.cardQImage = '';
      ui.cardAImage = '';
    }

    var cards = deck.cards || [];
    var edit = null;
    if (ui.editCardId) {
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].id === ui.editCardId) { edit = cards[i]; break; }
      }
    }
    var type = edit ? edit.type : (ui.cardType || 'recall');
    var target = deck.targetCards || 0;
    var countText = target ? (cards.length + ' / ' + target + ' 张') : (cards.length + ' 张');
    var chapterOpts = deck.chapters.map(function (c) {
      return '<option value="' + c.id + '"' + (edit && edit.chapter === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');

    var typeOpts = [['recall', '简答 / 自评'], ['cloze', '填空'], ['choice', '选择'], ['judge', '判断'], ['code', '代码 / 计算']];
    var typeSelect = typeOpts.map(function (t) {
      return '<option value="' + t[0] + '"' + (type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
    }).join('');

    var letters = 'ABCDEFGH';
    var answerIndex = edit && edit.type === 'choice' ? edit.answerIndex : 0;
    var indexOpts = '';
    for (var k = 0; k < 8; k++) {
      indexOpts += '<option value="' + k + '"' + (answerIndex === k ? ' selected' : '') + '>' + letters.charAt(k) + '</option>';
    }

    var fieldsCloze = edit && edit.type === 'cloze' ? '' : ' style="display:none"';
    var fieldsChoice = edit && edit.type === 'choice' ? '' : ' style="display:none"';
    var fieldsJudge = edit && edit.type === 'judge' ? '' : ' style="display:none"';
    var fieldsCode = edit && edit.type === 'code' ? '' : ' style="display:none"';

    var listHtml = editListHtml(deck);

    return '<div class="page-head"><div><p class="eyebrow">卡组编辑</p><h1>' + esc(deck.title) + '</h1>' +
      '<p class="lead">' + countText + ' · 编辑只保存在本机浏览器</p></div>' +
      '<div class="right"><a class="btn ghost sm" href="#/decks">返回卡组</a>' +
      '<button class="btn ghost sm" data-act="export-deck" data-id="' + deck.id + '">导出到文件</button>' +
      '<button class="btn ghost sm" data-act="convert-long" data-id="' + deck.id + '">转为长期</button>' +
      '<button class="btn sm" data-act="finish-edit" data-id="' + deck.id + '">完成，去复习</button></div></div>' +

      '<div class="cols even">' +
      '<section class="panel"><div class="panel-head"><h2>卡组信息</h2><span class="muted">' + countText + '</span></div>' +
      '<div class="field"><label>卡组名称</label><input id="deckTitle" maxlength="80" value="' + esc(deck.title) + '"></div>' +
      '<div class="field"><label>描述（可选）</label><input id="deckDesc" maxlength="200" value="' + esc(deck.description || '') + '"></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>章节名称</label><input id="deckChapter" maxlength="60" value="' + esc((deck.chapters[0] || {}).name || '我的卡片') + '"></div>' +
      '<div class="field"><label>计划卡片数（仅展示）</label><input id="deckTarget" type="number" min="0" max="9999" value="' + (target || '') + '" placeholder="例如 40"></div>' +
      '</div>' +
      '<p class="tiny muted" style="margin:-4px 0 12px">计划数只用于显示进度，不会限制实际添加数量。</p>' +
      '<div class="hero-actions"><button class="btn" data-act="save-deck-meta" data-id="' + deck.id + '">保存卡组信息</button></div>' +
      '</section>' +

      '<section class="panel"><div class="panel-head"><h2>' + (edit ? '编辑卡片' : '添加卡片') + '</h2>' +
      '<span class="muted">' + (edit ? '修改后保存' : '录入一张卡片') + '</span></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>题型</label><select id="cardType">' + typeSelect + '</select></div>' +
      '<div class="field"><label>标签（可选）</label><input id="cardTag" maxlength="20" value="' + esc(edit ? (edit.tag || '') : '') + '" placeholder="概念 / 公式 / 易错"></div>' +
      '</div>' +
      '<div class="field"><label>章节</label><select id="cardChapter">' + chapterOpts + '</select></div>' +
      '<div class="field"><label>问题 / 题干</label><textarea id="cardQuestion" placeholder="例如：什么是间隔重复？">' + esc(edit ? (edit.question || '') : '') + '</textarea></div>' +
      imageFieldHtml('q', ui.cardQImage) +
      '<div class="field"><label>答案 / 解析</label><textarea id="cardAnswer" placeholder="按考试要求写答案，可以换行。">' + esc(edit ? (edit.answer || '') : '') + '</textarea></div>' +
      imageFieldHtml('a', ui.cardAImage) +
      '<p class="tiny muted" style="margin:-4px 0 6px">图片会压缩后保存在本机；导出卡组 JSON 时会一起包含。只放图片也可以保存。</p>' +
      '<p class="tiny muted" style="margin:0 0 12px">如果填空题没有可接受答案、选择题少于 2 个选项，上传图片后会自动按“简答 / 自评”保存，避免无法判分。</p>' +

      '<div id="fields-cloze" class="type-fields"' + fieldsCloze + '>' +
      '<label>可接受答案（每行一个，判分时忽略大小写和空格）</label>' +
      '<textarea id="cardAccept" placeholder="SRS&#10;间隔重复系统">' + esc(edit && edit.accept ? edit.accept.join('\n') : '') + '</textarea></div>' +

      '<div id="fields-choice" class="type-fields"' + fieldsChoice + '>' +
      '<div class="field"><label>选项（每行一个，2～8 个）</label>' +
      '<textarea id="cardOptions" placeholder="选项 A&#10;选项 B&#10;选项 C">' + esc(edit && edit.options ? edit.options.join('\n') : '') + '</textarea></div>' +
      '<div class="field"><label>正确项</label><select id="cardAnswerIndex">' + indexOpts + '</select></div></div>' +

      '<div id="fields-judge" class="type-fields"' + fieldsJudge + '>' +
      '<div class="field"><label>判断结果</label><select id="cardCorrect">' +
      '<option value="true"' + (edit && edit.correct === true ? ' selected' : '') + '>正确（√）</option>' +
      '<option value="false"' + (edit && edit.correct === false ? ' selected' : '') + '>错误（×）</option>' +
      '</select></div></div>' +

      '<div id="fields-code" class="type-fields"' + fieldsCode + '>' +
      '<div class="field"><label>题干代码（可选）</label>' +
      '<textarea id="cardPre" placeholder="题干里单独展示的代码">' + esc(edit && edit.pre ? edit.pre : '') + '</textarea></div></div>' +

      '<div class="hero-actions">' +
      '<button class="btn" data-act="save-card" data-id="' + deck.id + '">' + (edit ? '保存修改' : '添加到卡组') + '</button>' +
      (edit ? '<button class="btn ghost" data-act="cancel-edit-card">取消编辑</button>' : '') +
      '</div></section>' +
      '</div>' +

      '<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>卡片列表</h2>' +
      '<span class="muted" id="editListCount">' + editListCountText(deck) + '</span></div>' +
      '<div class="searchbar" style="margin-bottom:12px">' +
      '<input id="editSearch" type="search" placeholder="搜索题干、答案或标签…" value="' + esc(ui.editQuery) + '">' +
      '<div class="filters">' +
      [['all', '全部'], ['recall', '简答'], ['cloze', '填空'], ['choice', '选择'], ['judge', '判断'], ['code', '代码']].map(function (f) {
        return '<button class="' + (ui.editFilter === f[0] ? 'on' : '') + '" data-act="edit-filter" data-f="' + f[0] + '">' + f[1] + '</button>';
      }).join('') +
      '</div></div>' +
      '<div id="editList">' + listHtml + '</div></section>';
  }

  function editFilteredCards(deck) {
    var q = (ui.editQuery || '').trim().toLowerCase();
    return (deck.cards || []).filter(function (c) {
      if (ui.editFilter !== 'all' && c.type !== ui.editFilter) return false;
      if (q) {
        var hay = ((c.question || '') + ' ' + (c.answer || '') + ' ' + (c.tag || '') +
          (c.questionImage ? ' 图片题' : '') + (c.answerImage ? ' 图片答案' : '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function editListCountText(deck) {
    var all = (deck.cards || []).length;
    var shown = editFilteredCards(deck).length;
    return shown === all ? (all + ' 张') : ('显示 ' + shown + ' / ' + all + ' 张');
  }
  function editListHtml(deck) {
    var all = deck.cards || [];
    var cards = editFilteredCards(deck);
    if (!all.length) return '<div class="empty">还没有卡片。用上面的表单添加第一张。</div>';
    if (!cards.length) return '<div class="empty">没有匹配的卡片，换个关键词或筛选条件。</div>';
    return '<div class="editlist">' + cards.map(function (c) {
      var idx = all.indexOf(c) + 1;
      var ans = String(c.answer || (c.answerImage ? '（图片答案）' : '')).replace(/\s+/g, ' ');
      if (ans.length > 70) ans = ans.slice(0, 70) + '…';
      return '<div class="editrow">' +
        '<span class="num">' + (idx < 10 ? '0' : '') + idx + '</span>' +
        '<div class="body">' + (c.questionImage ? '<div class="thumb">' + imageTag(c.questionImage, '题目图片', 'lib-thumb') + '</div>' : '') +
        '<div class="qq">' + esc(c.question || (c.questionImage ? '（图片题）' : '')) + '</div>' +
        '<div class="mm">' + esc(TYPELABEL[c.type] || c.type) + (c.tag ? ' · ' + esc(c.tag) : '') + ' · ' + esc(ans) + '</div></div>' +
        '<button class="go" data-act="edit-card" data-deck="' + deck.id + '" data-id="' + c.id + '">编辑</button>' +
        '<button class="del" data-act="delete-deck-card" data-deck="' + deck.id + '" data-id="' + c.id + '">删除</button>' +
        '</div>';
    }).join('') + '</div>';
  }
  function refreshEditList() {
    var deck = ui.editDeckId ? MindCardDecks.find(ui.editDeckId) : null;
    if (!deck) return;
    var el = document.getElementById('editList');
    if (el) el.innerHTML = editListHtml(deck);
    var cnt = document.getElementById('editListCount');
    if (cnt) cnt.textContent = editListCountText(deck);
    document.querySelectorAll('[data-act="edit-filter"]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-f') === ui.editFilter);
    });
  }

  /* ================= 视图：设置 ================= */
  function viewSettings() {
    var st = S.settings;
    var hidden = hiddenCards();
    var tdecks = MindCardDecks.trashedDecks();
    var src = DECK.source ? (DECK.source.type + (DECK.source.name ? ' · ' + DECK.source.name : '')) : '未声明';
    var hiddenHtml = hidden.length
      ? '<div class="trashlist">' + hidden.map(function (c) {
          var q = c.q.length > 36 ? c.q.slice(0, 36) + '…' : c.q;
          return '<div class="trashrow"><span>' + esc(q) + '</span>' +
            '<button class="btn ghost sm" data-act="restore-card" data-id="' + c.id + '">恢复</button></div>';
        }).join('') + '</div>' +
        '<div class="actions" style="margin-top:12px"><button class="btn ghost sm" data-act="restore-all">恢复全部</button></div>'
      : '<p class="small muted">暂无已删除的卡片。在卡库里点「删除」后会放到这里，可随时恢复。</p>';
    var tdecksHtml = tdecks.length
      ? '<div class="trashlist">' + tdecks.map(function (t) {
          return '<div class="trashrow"><span>' + esc(t.deck.title) +
            ' <span class="tiny muted">' + (t.at ? new Date(t.at).toLocaleDateString() : '') + '</span></span>' +
            '<button class="btn ghost sm" data-act="restore-deck" data-id="' + t.id + '">恢复</button>' +
            '<button class="btn ghost sm" data-act="purge-deck" data-id="' + t.id + '" style="color:var(--rose);border-color:var(--rose)">彻底删除</button></div>';
        }).join('') + '</div>'
      : '<p class="small muted">暂无已删除的卡组。删除卡组会先放到这里，学习进度保留。</p>';
    return '<div class="page-head"><div><p class="eyebrow">偏好设置</p><h1>设置与数据</h1>' +
      '<p class="lead">调整每日节奏，管理卡片，导出备份或重置学习记录。</p></div></div>' +
      '<div class="settings">' +
      '<section class="panel"><div class="panel-head"><h2>学习节奏</h2></div>' +
      '<div class="setrow"><div class="txt"><b>每日新卡上限</b><span>建议 15～25 张；临考可适当提高</span></div>' +
      '<input type="number" min="0" max="200" step="1" data-set="newPerDay" value="' + st.newPerDay + '"></div>' +
      '<div class="setrow"><div class="txt"><b>每日复习上限</b><span>到期卡片太多时，限制单日工作量</span></div>' +
      '<input type="number" min="10" max="999" step="10" data-set="reviewLimit" value="' + st.reviewLimit + '"></div>' +
      '<div class="setrow"><div class="txt"><b>考试日期</b><span>在首页显示倒计时，可不填</span></div>' +
      '<input type="date" data-set="examDate" value="' + esc(S.settings.examDate || '') + '"></div>' +
      '<div class="setrow"><div class="txt"><b>外观主题</b><span>深色模式适合夜间复习</span></div>' +
      '<select data-set="theme"><option value="light"' + ((GLOBAL.theme || 'light') === 'light' ? ' selected' : '') + '>浅色</option>' +
      '<option value="dark"' + (GLOBAL.theme === 'dark' ? ' selected' : '') + '>深色</option></select></div>' +
      '<div class="setrow"><div class="txt"><b>短期卡组上限</b><span>当前 ' + shortDecks().length + ' 个 · 可编辑卡组最多 1–20 个</span></div>' +
      '<input type="number" min="1" max="20" step="1" data-set="shortDeckLimit" value="' + shortLimit() + '"></div>' +
      '</section>' +

      '<section class="panel"><div class="panel-head"><h2>数据</h2><span class="muted">' + CARDS.length + ' 张卡片 · ' + S.log.length + ' 条复习记录</span></div>' +
      '<div class="setrow"><div class="txt"><b>导出学习进度</b><span>生成 JSON 备份，换设备时导入</span></div>' +
      '<div class="actions"><button class="btn sm" data-act="export">导出 JSON</button></div></div>' +
      '<div class="setrow"><div class="txt"><b>导入学习进度</b><span>导入将覆盖当前进度，请先导出备份</span></div>' +
      '<div class="actions"><button class="btn ghost sm" data-act="import">选择文件</button>' +
      '<input type="file" id="importFile" accept="application/json,.json" hidden></div></div>' +
      '<div class="setrow"><div class="txt"><b>导出当前卡组</b><span>只导出内容，不含学习进度，便于分享</span></div>' +
      '<div class="actions"><button class="btn ghost sm" data-act="export-deck" data-id="' + DECK.id + '">导出卡组</button></div></div>' +
      '<div class="setrow"><div class="txt"><b>导出全部备份</b><span>卡组 + 进度 + 设置，建议定期保存到网盘</span></div>' +
      '<div class="actions"><button class="btn sm" data-act="export-all">导出全部</button></div></div>' +
      '<div class="setrow"><div class="txt"><b>导入全部备份</b><span>覆盖同 id 卡组和进度，导入前请先导出一份</span></div>' +
      '<div class="actions"><button class="btn ghost sm" data-act="import-all">选择文件</button>' +
      '<input type="file" id="backupFile" accept="application/json,.json" hidden></div></div>' +
      '<div class="setrow"><div class="txt"><b>重置当前卡组进度</b><span>只清空「' + esc(DECK.title) + '」的卡片状态与记录，不可恢复</span></div>' +
      '<div class="actions"><button class="btn ghost sm" data-act="reset" style="color:var(--rose);border-color:var(--rose)">重置</button></div></div>' +
      '</section>' +

      '<section class="panel"><div class="panel-head"><h2>卡片回收站</h2><span class="muted">' + hidden.length + ' 张已删除</span></div>' +
      hiddenHtml + '</section>' +

      '<section class="panel"><div class="panel-head"><h2>卡组回收站</h2><span class="muted">' + tdecks.length + ' 个已删除</span></div>' +
      tdecksHtml + '</section>' +

      '<section class="panel"><div class="panel-head"><h2>这个软件怎么排复习</h2></div>' +
      '<p class="small">采用艾宾浩斯遗忘曲线 + 间隔重复（Leitner 阶梯）：新卡首次学习后，按 <b>10 分钟 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天 → 60 天 → 120 天 → 240 天</b> 逐步拉长间隔；每次按「忘记 / 模糊 / 记住 / 简单」评分，算法会缩短或跳级，并把越难的卡片越早重新安排。</p>' +
      '<p class="small" style="margin-top:10px">「忘记」的卡片会在本轮稍后重现，并回到 10 分钟后重新学习；连续答错的卡片会被标记为易错卡，在卡库中可筛选。</p>' +
      '<p class="small" style="margin-top:10px">所有数据只保存在本机：浏览器版使用 <code>localStorage</code>，桌面版写入应用数据目录，不上传网络。清理浏览器数据会导致进度丢失，请定期导出备份。</p></section>' +

      '<section class="panel"><div class="panel-head"><h2>当前卡组</h2><span class="muted"><code>' + esc(DECK.id) + '</code></span></div>' +
      '<p class="small"><b>' + esc(DECK.title) + '</b>' + (DECK.subtitle ? ' · ' + esc(DECK.subtitle) : '') + '</p>' +
      '<p class="small" style="margin-top:8px">类型：' +
      (deckMode(DECK) === 'long' ? '长期只读' : (MindCardDecks.isBuiltin(DECK.id) ? '内置只读' : '短期可编辑')) +
      ' · 短期卡组 ' + shortDecks().length + ' / ' + shortLimit() + '</p>' +
      (DECK.description ? '<p class="small" style="margin-top:8px">' + esc(DECK.description) + '</p>' : '') +
      '<p class="small" style="margin-top:8px">来源：' + esc(src) + ' · 许可：' + esc(DECK.license || '未声明') + '</p>' +
      '<div class="hero-actions" style="margin-top:12px"><a class="btn ghost sm" href="#/decks">管理卡组</a></div></section>' +
      '</div>';
  }

  /* ================= 路由与渲染 ================= */
  function currentRoute() {
    var h = (location.hash || '#/today').replace(/^#\//, '');
    var q = h.indexOf('?');
    var path = q >= 0 ? h.slice(0, q) : h;
    var query = q >= 0 ? h.slice(q + 1) : '';
    return { path: path || 'today', query: query };
  }

  function parseCh(query) {
    var m = /(?:^|&)ch=(\d+)/.exec(query || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  function render() {
    var route = currentRoute();
    var path = route.path;
    var view = document.getElementById('view');
    if (!view) return;

    try {

    if (path === 'library') {
      var ch = parseCh(route.query);
      if (ch) ui.chapter = ch;
    }

    var html = '';
    if (path === 'today') html = viewToday();
    else if (path === 'study') html = viewStudy();
    else if (path === 'library') html = viewLibrary();
    else if (path === 'decks') html = viewDecks();
    else if (path === 'edit') html = viewEdit(route.query);
    else if (path === 'stats') html = viewStats();
    else if (path === 'sheet') html = viewSheet();
    else if (path === 'settings') html = viewSettings();
    else { location.hash = '#/today'; return; }

    view.innerHTML = html;
    if (path === 'edit') toggleCardFields();
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('on', a.getAttribute('data-route') === path);
      if (a.getAttribute('data-route') === 'sheet') {
        a.style.display = hasSheet() ? '' : 'none';
      }
    });
    document.title = ({
      today: '今日复习', study: '复习中', library: '卡库', decks: '卡组', edit: '编辑卡组',
      stats: '统计', sheet: '速查手册', settings: '设置'
    }[path] || '记忆卡') + ' · ' + (DECK.title || 'MindCard');

    } catch (err) {
      console.error(err);
      view.innerHTML = '<div class="page-head"><div><p class="eyebrow">出错了</p><h1>页面渲染失败</h1>' +
        '<p class="lead">你的数据没有丢失，可以先导出备份再刷新。</p></div></div>' +
        '<section class="panel"><p class="small">错误信息：</p>' +
        '<pre class="code" style="white-space:pre-wrap">' + esc(String(err && (err.stack || err.message) || err)) + '</pre>' +
        '<div class="hero-actions" style="margin-top:16px">' +
        '<button class="btn" data-act="reload-app">重新加载</button>' +
        '<button class="btn ghost" data-act="export-all">导出全部备份</button></div></section>';
    }
  }

  /* ================= 事件 ================= */
  function onClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act === 'start-daily') { begin({ mode: 'daily' }); }
    else if (act === 'start-daily-again') { begin({ mode: 'daily' }); }
    else if (act === 'start-ahead') { begin({ mode: 'ahead', chapter: ui.chapter, limit: 30 }); }
    else if (act === 'start-chapter') {
      e.stopPropagation();
      var ch = +t.getAttribute('data-ch');
      begin({ mode: 'chapter', chapter: ch });
    }
    else if (act === 'set-chapter') {
      var cid = +t.getAttribute('data-ch');
      ui.chapter = (ui.chapter === cid) ? 0 : cid;
      refreshLibraryList();
      var listEl = document.getElementById('libList');
      if (listEl) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else if (act === 'set-filter') { ui.filter = t.getAttribute('data-f'); refreshLibraryList(); }
    else if (act === 'edit-filter') { ui.editFilter = t.getAttribute('data-f'); refreshEditList(); }
    else if (act === 'clear-chapter') { ui.chapter = 0; refreshLibraryList(); }
    else if (act === 'open-card') {
      begin({ mode: 'single', id: t.getAttribute('data-id') });
    }
    else if (act === 'delete-card') { deleteCard(t.getAttribute('data-id')); }
    else if (act === 'restore-card') { restoreCard(t.getAttribute('data-id')); }
    else if (act === 'restore-all') { restoreAllCards(); }
    else if (act === 'switch-deck') {
      MindCardDecks.setActive(t.getAttribute('data-id'));
      location.reload();
    }
    else if (act === 'delete-deck') { deleteDeck(t.getAttribute('data-id')); }
    else if (act === 'convert-long') { convertToLong(t.getAttribute('data-id')); }
    else if (act === 'export-deck') { exportDeckFile(t.getAttribute('data-id')); }
    else if (act === 'create-deck') { createDeckFromForm(); }
    else if (act === 'toggle-new-deck') {
      ui.showNewDeck = !ui.showNewDeck;
      render();
      if (ui.showNewDeck) {
        setTimeout(function () {
          var name = document.getElementById('newDeckName');
          if (name) name.focus();
        }, 0);
      }
    }
    else if (act === 'save-deck-meta') { saveDeckMeta(t.getAttribute('data-id')); }
    else if (act === 'save-card') { saveCardFromForm(t.getAttribute('data-id')); }
    else if (act === 'delete-deck-card') { deleteDeckCard(t.getAttribute('data-deck'), t.getAttribute('data-id')); }
    else if (act === 'cancel-edit-card') { ui.editCardId = null; ui.cardQImage = ''; ui.cardAImage = ''; render(); }
    else if (act === 'pick-image') {
      var imgInput = document.getElementById(t.getAttribute('data-which') + 'ImageFile');
      if (imgInput) imgInput.click();
    }
    else if (act === 'remove-image') {
      setCardImage(t.getAttribute('data-which'), '');
    }
    else if (act === 'finish-edit') {
      var fd = MindCardDecks.find(t.getAttribute('data-id'));
      if (fd && !fd.cards.length) { toast('先添加至少一张卡片'); return; }
      ui.editDirty = false;
      ui.editMetaDirty = false;
      MindCardDecks.setActive(t.getAttribute('data-id'));
      location.hash = '#/today';
      location.reload();
    }
    else if (act === 'clone-deck') { cloneDeck(t.getAttribute('data-id')); }
    else if (act === 'edit-card') {
      var deckId = t.getAttribute('data-deck');
      var cardId = t.getAttribute('data-id');
      var d = MindCardDecks.find(deckId);
      if (d) {
        for (var ci = 0; ci < d.cards.length; ci++) {
          if (d.cards[ci].id === cardId) {
            ui.editCardId = cardId;
            ui.cardType = d.cards[ci].type;
            ui.cardQImage = d.cards[ci].questionImage || '';
            ui.cardAImage = d.cards[ci].answerImage || '';
            render();
            var qEl = document.getElementById('cardQuestion');
            if (qEl) qEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }
    }
    else if (act === 'import-deck') {
      var df = document.getElementById('deckFile');
      if (df) df.click();
    }
    else if (act === 'import-all') {
      var bf = document.getElementById('backupFile');
      if (bf) bf.click();
    }
    else if (act === 'export-all') { exportAll(); }
    else if (act === 'restore-deck') { restoreTrashedDeck(t.getAttribute('data-id')); }
    else if (act === 'purge-deck') { purgeTrashedDeck(t.getAttribute('data-id')); }
    else if (act === 'reload-app') { location.reload(); }
    else if (act === 'import-notes') {
      var nf = document.getElementById('noteFile');
      if (nf) nf.click();
    }
    else if (act === 'save-pending') { savePendingDeck(); }
    else if (act === 'cancel-pending') { ui.pendingDeck = null; render(); }
    else if (act === 'reveal') {
      if (!session) return;
      session.revealed = true;
      if (session.choice == null && session.choice !== 0) session.choice = null;
      render();
    }
    else if (act === 'opt') {
      if (!session || session.revealed) return;
      var i = +t.getAttribute('data-i');
      session.choice = i;
      session.revealed = true;
      render();
    }
    else if (act === 'cloze-submit') {
      if (!session) return;
      var input = document.getElementById('clozeInput');
      if (!input) return;
      session.clozeVal = input.value;
      session.clozeOk = checkCloze(currentCard(), input.value);
      session.revealed = true;
      render();
    }
    else if (act === 'rate') { grade(+t.getAttribute('data-g')); }
    else if (act === 'undo-grade') { undoGrade(); }
    else if (act === 'skip-card') { skipCard(); }
    else if (act === 'quit') { session = null; location.hash = '#/today'; }
    else if (act === 'clear-session') { session = null; }
    else if (act === 'theme') { toggleTheme(); }
    else if (act === 'export') { exportData(); }
    else if (act === 'import') { var f = document.getElementById('importFile'); if (f) f.click(); }
    else if (act === 'reset') { resetData(); }
  }

  function checkCloze(card, val) {
    if (!card) return false;
    var norm = function (s) {
      return String(s).toUpperCase().replace(/\s+/g, '').replace(/[，。；、,.;：:]/g, '');
    };
    var v = String(val || '').trim();
    if (!v) return false;
    var acc = (card.accept || []).slice();
    if (!acc.length) return false;
    var parts = v.split(/[\s,，、;；/]+/).filter(Boolean);
    if (parts.length === 1) {
      return acc.some(function (a) { return norm(a) === norm(parts[0]); });
    }
    return parts.every(function (p) {
      return acc.some(function (a) { return norm(a) === norm(p); });
    });
  }

  function onInput(e) {
    if (e.target.id === 'searchCards') {
      ui.q = e.target.value;
      refreshLibraryList();
    }
    if (e.target.id === 'editSearch') {
      ui.editQuery = e.target.value;
      refreshEditList();
    }
    if (['deckTitle', 'deckDesc', 'deckChapter', 'deckTarget'].indexOf(e.target.id) >= 0) {
      ui.editMetaDirty = true;
    }
    if (['cardQuestion', 'cardAnswer', 'cardTag', 'cardAccept', 'cardOptions', 'cardPre'].indexOf(e.target.id) >= 0) {
      ui.editDirty = true;
    }
  }

  function onChange(e) {
    if (e.target.id === 'cardType') {
      ui.cardType = e.target.value;
      toggleCardFields();
      ui.editDirty = true;
    }
    if (['cardAnswerIndex', 'cardCorrect', 'cardChapter'].indexOf(e.target.id) >= 0) {
      ui.editDirty = true;
    }
    var key = e.target.getAttribute && e.target.getAttribute('data-set');
    if (key) {
      var v = e.target.value;
      if (key === 'theme') {
        setTheme(v === 'dark' ? 'dark' : 'light');
        toast('已保存');
        return;
      }
      if (key === 'shortDeckLimit') {
        var sl = Math.max(1, Math.min(20, parseInt(v, 10) || 20));
        GLOBAL.shortDeckLimit = sl;
        GLOBAL.shortLimitUpgraded = true;
        try { MindCardDecks.saveGlobalSettings(GLOBAL); }
        catch (e) { showStorageWarning('设置保存失败：' + e.message, 'save'); }
        e.target.value = sl;
        toast('短期卡组上限已设为 ' + sl);
        return;
      }
      if (key === 'newPerDay') v = Math.max(0, Math.min(200, parseInt(v, 10) || 0));
      if (key === 'reviewLimit') v = Math.max(10, Math.min(999, parseInt(v, 10) || 10));
      S.settings[key] = v;
      save();
      toast('已保存');
    }
    if (e.target.id === 'qImageFile' && e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0], 'q');
      e.target.value = '';
    }
    if (e.target.id === 'aImageFile' && e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0], 'a');
      e.target.value = '';
    }
    if (e.target.id === 'deckFile' && e.target.files && e.target.files[0]) {
      handleDeckFile(e.target.files[0]);
      e.target.value = '';
    }
    if (e.target.id === 'noteFile' && e.target.files && e.target.files[0]) {
      handleNoteFile(e.target.files[0]);
      e.target.value = '';
    }
    if (e.target.id === 'importFile' && e.target.files && e.target.files[0]) {
      importFile(e.target.files[0]);
      e.target.value = '';
    }
    if (e.target.id === 'backupFile' && e.target.files && e.target.files[0]) {
      importAll(e.target.files[0]);
      e.target.value = '';
    }
  }

  function onKey(e) {
    var path = currentRoute().path;
    if (path !== 'study' || !session) return;
    if (e.target.tagName === 'INPUT' && e.key !== 'Enter') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!session.revealed) {
        if (currentCard() && currentCard().type === 'cloze') {
          var input = document.getElementById('clozeInput');
          if (input) {
            session.clozeVal = input.value;
            session.clozeOk = checkCloze(currentCard(), input.value);
          }
        }
        session.revealed = true;
        render();
      }
      return;
    }
    if (session.revealed && ['1', '2', '3', '4'].indexOf(e.key) >= 0) {
      e.preventDefault();
      grade(parseInt(e.key, 10) - 1);
    }
    if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      undoGrade();
    }
  }

  /* ================= 主题 ================= */
  function applyTheme() {
    var theme = GLOBAL.theme || S.settings.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }
  function setTheme(theme) {
    GLOBAL.theme = theme;
    S.settings.theme = theme;
    try { MindCardDecks.saveGlobalSettings(GLOBAL); }
    catch (e) { showStorageWarning('主题设置保存失败：' + e.message, 'save'); }
    save();
    applyTheme();
  }
  function toggleTheme() {
    var next = (GLOBAL.theme || S.settings.theme) === 'dark' ? 'light' : 'dark';
    setTheme(next);
    toast(next === 'dark' ? '已切换深色模式' : '已切换浅色模式');
  }

  /* ================= 数据导入导出 ================= */
  function downloadJSON(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function dateTag() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  function exportData() {
    downloadJSON({
      v: 1, exported: new Date().toISOString(),
      deckId: DECK.id, deckTitle: DECK.title,
      cards: S.cards, log: S.log, hidden: S.hidden, settings: S.settings
    }, 'MindCard_进度_' + DECK.id + '_' + dateTag() + '.json');
    toast('已导出当前卡组进度');
  }
  function exportDeckFile(id) {
    var deck = MindCardDecks.find(id);
    if (!deck) { toast('找不到这个卡组'); return; }
    downloadJSON(deck, deck.id + '.json');
    toast('已导出卡组（不含学习进度）');
  }
  function readText(file, cb) {
    var MAX = 20 * 1024 * 1024;
    if (file.size > MAX) {
      alert('文件太大（超过 20 MB）。请拆分后再导入。');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result;
      var text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (e) {
        try { text = new TextDecoder('gbk').decode(buf); }
        catch (e2) { text = new TextDecoder('utf-8').decode(buf); }
      }
      cb(text);
    };
    reader.onerror = function () { alert('读取文件失败，请重试'); };
    reader.readAsArrayBuffer(file);
  }
  function validProgress(obj) {
    if (!obj || obj.v !== 1) return false;
    if (!obj.cards || typeof obj.cards !== 'object' || Array.isArray(obj.cards)) return false;
    var keys = Object.keys(obj.cards);
    for (var i = 0; i < keys.length; i++) {
      var st = obj.cards[keys[i]];
      if (!st || typeof st !== 'object' || typeof st.due !== 'number' || isNaN(st.due)) return false;
    }
    return true;
  }
  function importFile(file) {
    readText(file, function (text) {
      try {
        var obj = JSON.parse(text);
        if (obj && obj.schemaVersion === 1 && Array.isArray(obj.cards)) {
          throw new Error('这是卡组文件，请到「卡组」页用「导入 .json 卡组」导入。');
        }
        if (!validProgress(obj)) throw new Error('不是有效的进度备份（缺少 v/cards 或状态字段损坏）');
        if (obj.deckId && obj.deckId !== DECK.id) {
          if (!confirm('这是卡组「' + (obj.deckTitle || obj.deckId) + '」的进度，不是当前「' + DECK.title + '」。仍然导入到当前卡组？')) return;
        } else if (!confirm('导入将覆盖当前卡组的学习进度，确定继续？')) return;
        S.cards = obj.cards;
        S.log = Array.isArray(obj.log) ? obj.log : [];
        S.hidden = obj.hidden && typeof obj.hidden === 'object' && !Array.isArray(obj.hidden) ? obj.hidden : {};
        var st = obj.settings || {};
        if (typeof st.newPerDay === 'number') S.settings.newPerDay = Math.max(0, Math.min(200, st.newPerDay));
        if (typeof st.reviewLimit === 'number') S.settings.reviewLimit = Math.max(10, Math.min(999, st.reviewLimit));
        if (typeof st.examDate === 'string') S.settings.examDate = st.examDate;
        save();
        location.reload();
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    });
  }

  function exportAll() {
    var decks = MindCardDecks.all().filter(function (d) { return !MindCardDecks.isBuiltin(d.id); });
    var progress = {};
    decks.forEach(function (d) {
      try {
        var raw = localStorage.getItem('mindcard:progress:' + d.id);
        if (raw) {
          var st = JSON.parse(raw);
          if (validProgress(st)) progress[d.id] = st;
        }
      } catch (e) { }
    });
    var trash = MindCardDecks.trashedDecks().map(function (t) {
      return { deck: t.deck, at: t.at };
    });
    downloadJSON({
      app: 'MindCard', kind: 'backup', v: 1,
      exported: new Date().toISOString(),
      activeDeck: DECK.id,
      decks: decks,
      progress: progress,
      trash: trash,
      settings: GLOBAL
    }, 'MindCard_全部备份_' + dateTag() + '.json');
    toast('已导出全部卡组、进度和设置');
  }
  function importAll(file) {
    readText(file, function (text) {
      try {
        var obj = JSON.parse(text);
        if (!obj || obj.kind !== 'backup' || !Array.isArray(obj.decks)) {
          throw new Error('不是 MindCard 的“全部备份”文件');
        }
        if (!confirm('导入全部备份会覆盖同 id 的卡组和进度，确定继续？')) return;
        var count = 0;
        obj.decks.forEach(function (deck) {
          var errs = MindCardDecks.validateDeck(deck);
          if (errs.length) return;
          MindCardDecks.saveDeckDirect(deck);
          count++;
        });
        if (obj.progress && typeof obj.progress === 'object') {
          Object.keys(obj.progress).forEach(function (id) {
            var st = obj.progress[id];
            if (validProgress(st) && MindCardDecks.find(id)) {
              localStorage.setItem('mindcard:progress:' + id, JSON.stringify(st));
            }
          });
        }
        if (Array.isArray(obj.trash)) {
          try { MindCardDecks.importTrash(obj.trash); } catch (e) { }
        }
        if (obj.settings && typeof obj.settings === 'object') {
          if (typeof obj.settings.theme === 'string') {
            GLOBAL.theme = obj.settings.theme === 'dark' ? 'dark' : 'light';
          }
          if (obj.settings.shortDeckLimit != null) {
            GLOBAL.shortDeckLimit = Math.max(1, Math.min(20, parseInt(obj.settings.shortDeckLimit, 10) || 20));
            GLOBAL.shortLimitUpgraded = true;
          }
          MindCardDecks.saveGlobalSettings(GLOBAL);
        }
        alert('已导入 ' + count + ' 个卡组，即将刷新。');
        location.reload();
      } catch (e) {
        alert('导入全部备份失败：' + e.message);
      }
    });
  }
  function resetData() {
    if (!confirm('确定清空「' + DECK.title + '」的全部学习进度？此操作不可恢复。建议先导出备份。')) return;
    if (!confirm('再次确认：当前卡组的所有卡片状态与复习记录都将被删除。')) return;
    S.cards = {}; S.log = []; save(); session = null; render();
    try { localStorage.removeItem(STORE + ':bak'); } catch (e) { }
    toast('已重置当前卡组');
  }

  /* ================= 卡组导入 / 删除 ================= */
  function handleDeckFile(file) {
    readText(file, function (text) {
      var deck;
      try { deck = JSON.parse(text); }
      catch (e) { alert('JSON 解析失败：' + e.message); return; }
      var errs = MindCardDecks.validateDeck(deck);
      if (errs.length) {
        alert('卡组格式有问题：\n\n' + errs.slice(0, 8).join('\n') + (errs.length > 8 ? '\n…' : ''));
        return;
      }
      if (MindCardDecks.isBuiltin(deck.id)) {
        alert('这个卡组 id 与内置卡组冲突，请修改文件里的 id 后再导入。');
        return;
      }
      deck.mode = 'short';
      var existing = MindCardDecks.find(deck.id);
      if (!canAddShort(deck.id)) {
        alert('短期卡组已达上限（' + shortLimit() + ' 个）。请先把一个短期卡组转为长期，或删除一个。');
        return;
      }
      if (existing) {
        var oldDeck = existing;
        var oldIds = (oldDeck.cards || []).map(function (c) { return c.id; }).sort().join(',');
        var newIds = (deck.cards || []).map(function (c) { return c.id; }).sort().join(',');
        var sameIds = oldIds === newIds;
        var msg = '已存在同 id 的卡组「' + deck.title + '」，覆盖它？';
        if (deckMode(oldDeck) === 'long') msg += '\n\n这个卡组原来是长期只读，导入后会变成短期可编辑。';
        if (!sameIds) msg += '\n\n卡片 id 有变化，旧进度会错位，导入后会自动重置该卡组进度。';
        if (!confirm(msg)) return;
        if (!sameIds) {
          try {
            localStorage.removeItem('mindcard:progress:' + deck.id);
            localStorage.removeItem('mindcard:progress:' + deck.id + ':bak');
          } catch (e) { }
        }
      } else if (!confirm('导入卡组「' + deck.title + '」？\n' + deck.chapters.length + ' 章 · ' + deck.cards.length + ' 张卡片')) {
        return;
      }
      try {
        MindCardDecks.saveImported(deck);
        location.reload();
      } catch (e) { alert(e.message); }
    });
  }
  function uniqueDeckId(id) {
    if (!MindCardDecks.find(id)) return id;
    return id + '-' + Date.now().toString(36).slice(-4);
  }
  function handleNoteFile(file) {
    readText(file, function (text) {
      var deck;
      var hint = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      try { deck = MindCardDecks.parseMarkdown(text, hint); }
      catch (e) { alert('解析失败：' + e.message); return; }
      if (!deck.cards.length) {
        alert('没有识别到卡片。\n\n请在 Markdown 中使用：\nQ: 问题\nA: 答案\n或两列表格、或「术语：定义」的要点。');
        return;
      }
      if (!canAddShort()) {
        alert('短期卡组已达上限（' + shortLimit() + ' 个）。请先把一个短期卡组转为长期，或删除一个。');
        return;
      }
      deck.mode = 'short';
      deck.id = uniqueDeckId(deck.id);
      var errs = MindCardDecks.validateDeck(deck);
      if (errs.length) {
        alert('生成结果有问题：\n' + errs.slice(0, 6).join('\n'));
        return;
      }
      ui.pendingDeck = deck;
      render();
      toast('已生成 ' + deck.cards.length + ' 张卡片，确认后保存');
    });
  }
  function savePendingDeck() {
    var deck = ui.pendingDeck;
    if (!deck) return;
    if (!canAddShort(deck.id)) {
      alert('短期卡组已达上限（' + shortLimit() + ' 个）。请先处理已有的短期卡组。');
      return;
    }
    deck.mode = 'short';
    try {
      MindCardDecks.saveImported(deck);
      ui.pendingDeck = null;
      location.reload();
    } catch (e) { alert(e.message); }
  }
  function deleteDeck(id) {
    var deck = MindCardDecks.find(id);
    if (!deck || MindCardDecks.isBuiltin(id)) return;
    if (!confirm('删除卡组「' + deck.title + '」？\n\n会移到「设置 → 卡组回收站」，学习进度暂时保留，可随时恢复。')) return;
    try {
      MindCardDecks.trashDeck(id);
      if (DECK.id === id) location.reload();
      else { render(); toast('已移到卡组回收站'); }
    } catch (e) { alert(e.message); }
  }
  function convertToLong(id) {
    var deck = MindCardDecks.find(id);
    if (!deck || MindCardDecks.isBuiltin(id)) return;
    if (deckMode(deck) === 'long') return;
    var dirtyTip = (ui.editDirty || ui.editMetaDirty) ? '\n\n当前有未保存的编辑，转换后会丢失。' : '';
    if (!confirm('转为长期卡组「' + deck.title + '」？\n\n转为长期后网页内不能编辑卡片，但可以正常复习、统计和导出。\n需要修改时：导出 JSON 编辑后重新导入，或另存为短期副本。' + dirtyTip)) return;
    deck.mode = 'long';
    try {
      MindCardDecks.updateDeck(deck);
      ui.editDirty = false;
      ui.editMetaDirty = false;
      location.reload();
    } catch (e) { alert(e.message); }
  }
  function restoreTrashedDeck(id) {
    var item = MindCardDecks.trashedDecks().filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    if (deckMode(item.deck) === 'short' && !canAddShort(id)) {
      alert('短期卡组已达上限（' + shortLimit() + ' 个），无法恢复。请先转长期或删除一个。');
      return;
    }
    try {
      if (MindCardDecks.restoreDeck(id)) {
        toast('已恢复卡组');
        location.reload();
      }
    } catch (e) { alert(e.message); }
  }
  function purgeTrashedDeck(id) {
    var list = MindCardDecks.trashedDecks();
    var item = list.filter(function (x) { return x.id === id; })[0];
    if (!item) return;
    if (!confirm('彻底删除卡组「' + item.deck.title + '」及其学习进度？不可恢复。')) return;
    try {
      MindCardDecks.purgeTrash(id);
      render();
      toast('已彻底删除');
    } catch (e) { alert(e.message); }
  }

  /* ================= 卡组编辑 ================= */
  function newCardId() {
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
  }
  function toggleCardFields() {
    var sel = document.getElementById('cardType');
    if (!sel) return;
    var t = sel.value;
    ['cloze', 'choice', 'judge', 'code'].forEach(function (x) {
      var el = document.getElementById('fields-' + x);
      if (el) el.style.display = (t === x ? '' : 'none');
    });
  }
  function refreshActiveDeck(deck) {
    if (!deck || deck.id !== DECK.id) return;
    DECK = deck;
    window.MC_DECK_META = deck;
    var adapted = MindCardDecks.adapt(deck);
    CHAPTERS = adapted.chapters;
    ALL_CARDS = adapted.cards;
    window.CHAPTERS = adapted.chapters;
    window.CARDS = adapted.cards;
    if (window.MindCardDecks) window.MindCardDecks.active = deck;
    ALL_BY_ID = {};
    ALL_CARDS.forEach(function (c) { ALL_BY_ID[c.id] = c; });
    CARDS = ALL_CARDS.filter(function (c) { return !S.hidden[c.id]; });
    byId = {};
    CARDS.forEach(function (c) { byId[c.id] = c; });
    CHNAME = {}; CHSHORT = {};
    CHAPTERS.forEach(function (c) { CHNAME[c.id] = c.name; CHSHORT[c.id] = c.short; });
    session = null;
    ui.chapter = 0;
  }
  function createDeckFromForm() {
    if (!canAddShort()) {
      alert('短期卡组已达上限（' + shortLimit() + ' 个）。请先把一个短期卡组转为长期，或删除一个。');
      return;
    }
    var nameEl = document.getElementById('newDeckName');
    var descEl = document.getElementById('newDeckDesc');
    var targetEl = document.getElementById('newDeckTarget');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) name = '我的卡组';
    var target = targetEl ? parseInt(targetEl.value, 10) : 0;
    var deck = {
      schemaVersion: 1,
      id: 'custom-' + Date.now().toString(36),
      title: name,
      mode: 'short',
      description: descEl ? descEl.value.trim() : '',
      language: 'zh-CN',
      license: '未声明',
      tags: ['自定义'],
      source: { type: 'manual' },
      chapters: [{ id: 'ch-01', order: 1, name: '我的卡片', short: '卡片' }],
      cards: []
    };
    if (target > 0) deck.targetCards = target;
    try {
      MindCardDecks.saveImported(deck);
      location.hash = '#/edit?id=' + deck.id;
      location.reload();
    } catch (e) { alert(e.message); }
  }
  function saveDeckMeta(id) {
    var deck = MindCardDecks.find(id);
    if (!deck) return;
    if (deckMode(deck) !== 'short') {
      alert('长期卡组是只读的，不能修改卡组信息。');
      return;
    }
    var titleEl = document.getElementById('deckTitle');
    var descEl = document.getElementById('deckDesc');
    var chapterEl = document.getElementById('deckChapter');
    var targetEl = document.getElementById('deckTarget');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) { alert('卡组名称不能为空'); return; }
    deck.title = title;
    deck.description = descEl ? descEl.value.trim() : '';
    var chName = chapterEl ? chapterEl.value.trim() : '';
    if (chName && deck.chapters[0]) {
      deck.chapters[0].name = chName;
      deck.chapters[0].short = chName.slice(0, 10);
    }
    var target = targetEl ? parseInt(targetEl.value, 10) : 0;
    if (target > 0) deck.targetCards = target;
    else delete deck.targetCards;
    try {
      MindCardDecks.updateDeck(deck);
      refreshActiveDeck(deck);
      ui.editDirty = false;
      ui.editMetaDirty = false;
      render();
      toast('卡组信息已保存');
    } catch (e) { alert(e.message); }
  }
  function saveCardFromForm(deckId) {
    var deck = MindCardDecks.find(deckId);
    if (!deck) return;
    if (deckMode(deck) !== 'short') {
      alert('长期卡组是只读的，不能添加或修改卡片。');
      return;
    }
    var typeEl = document.getElementById('cardType');
    var qEl = document.getElementById('cardQuestion');
    var aEl = document.getElementById('cardAnswer');
    var tagEl = document.getElementById('cardTag');
    if (!typeEl || !qEl || !aEl) return;
    var type = typeEl.value;
    var q = qEl.value.trim();
    var a = aEl.value.trim();
    var qImage = isImageData(ui.cardQImage) ? ui.cardQImage : '';
    var aImage = isImageData(ui.cardAImage) ? ui.cardAImage : '';
    if (!q && !qImage) { alert('请填写问题 / 题干，或上传题目图片'); qEl.focus(); return; }
    if (!a && !aImage) { alert('请填写答案，或上传答案图片'); aEl.focus(); return; }

    var imageBacked = !!(qImage || aImage);
    var effectiveType = type;
    var typeDowngraded = false;

    var accept = [];
    if (type === 'cloze') {
      var accEl = document.getElementById('cardAccept');
      accept = (accEl ? accEl.value : '').split(/[\n,，、;；]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    var options = [];
    if (type === 'choice') {
      var optEl = document.getElementById('cardOptions');
      options = (optEl ? optEl.value : '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    if (type === 'cloze' && !accept.length) {
      if (imageBacked) {
        effectiveType = 'recall';
        typeDowngraded = true;
      } else {
        alert('填空题至少需要一个可接受答案（每行一个），或上传题目/答案图片');
        return;
      }
    }
    if (type === 'choice' && options.length < 2) {
      if (imageBacked) {
        effectiveType = 'recall';
        typeDowngraded = true;
      } else {
        alert('选择题至少需要 2 个选项，每行一个；只放图片时会按简答自评卡保存');
        return;
      }
    }
    if (type === 'choice' && options.length > 8) { alert('选择题最多 8 个选项'); return; }

    var card = {
      id: ui.editCardId || newCardId(),
      chapter: (function () {
        var cel = document.getElementById('cardChapter');
        return cel && cel.value ? cel.value : deck.chapters[0].id;
      })(),
      type: effectiveType,
      tag: tagEl ? tagEl.value.trim() : '',
      question: q,
      answer: a
    };
    if (qImage) card.questionImage = qImage;
    if (aImage) card.answerImage = aImage;

    if (type === 'cloze' && effectiveType === 'cloze') {
      card.accept = accept;
    }
    if (type === 'choice' && effectiveType === 'choice') {
      var idxEl = document.getElementById('cardAnswerIndex');
      var idx = idxEl ? parseInt(idxEl.value, 10) : 0;
      if (!(idx >= 0 && idx < options.length)) { alert('正确项超出选项范围'); return; }
      card.options = options;
      card.answerIndex = idx;
    }
    if (type === 'judge') {
      var corrEl = document.getElementById('cardCorrect');
      card.correct = corrEl ? corrEl.value === 'true' : true;
    }
    if (type === 'code') {
      var preEl = document.getElementById('cardPre');
      if (preEl && preEl.value.trim()) card.pre = preEl.value.trim();
    }

    if (ui.editCardId) {
      var found = false;
      for (var i = 0; i < deck.cards.length; i++) {
        if (deck.cards[i].id === ui.editCardId) { deck.cards[i] = card; found = true; break; }
      }
      if (!found) deck.cards.push(card);
    } else {
      deck.cards.push(card);
    }

    var errs = MindCardDecks.validateDeck(deck, true);
    if (errs.length) { alert('卡片有问题：\n' + errs.slice(0, 6).join('\n')); return; }
    var deckSize = JSON.stringify(deck).length;
    if (deckSize > 1800000 && !confirm('这个卡组已经比较大（约 ' + Math.round(deckSize / 1024) + ' KB，含图片）。\n\n浏览器存储空间有限，确定继续保存？')) return;
    try {
      MindCardDecks.updateDeck(deck);
      refreshActiveDeck(deck);
      ui.editCardId = null;
      ui.editDirty = false;
      ui.cardQImage = '';
      ui.cardAImage = '';
      ui.cardType = effectiveType;
      render();
      toast(typeDowngraded ? '图片题已按简答自评卡保存，当前共 ' + deck.cards.length + ' 张卡片' : '已保存，当前共 ' + deck.cards.length + ' 张卡片');
      var q2 = document.getElementById('cardQuestion');
      if (q2) q2.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { alert(e.message); }
  }
  function deleteDeckCard(deckId, cardId) {
    var deck = MindCardDecks.find(deckId);
    if (!deck) return;
    if (deckMode(deck) !== 'short') {
      alert('长期卡组是只读的，不能删除卡片。需要修改请先导出 JSON 或另存为短期副本。');
      return;
    }
    var card = null;
    for (var i = 0; i < deck.cards.length; i++) if (deck.cards[i].id === cardId) card = deck.cards[i];
    if (!card) return;
    if (!confirm('从卡组中删除这张卡片？\n\n「' + String(card.question).slice(0, 40) + '」')) return;
    deck.cards = deck.cards.filter(function (c) { return c.id !== cardId; });
    try {
      MindCardDecks.updateDeck(deck);
      if (deck.id === DECK.id) {
        delete S.cards[cardId];
        delete S.hidden[cardId];
        S.log = S.log.filter(function (l) { return l.id !== cardId; });
        save();
      } else {
        try {
          var pkey = 'mindcard:progress:' + deck.id;
          var raw = localStorage.getItem(pkey);
          if (raw) {
            var st = JSON.parse(raw);
            if (validProgress(st)) {
              delete st.cards[cardId];
              delete st.hidden[cardId];
              st.log = (st.log || []).filter(function (l) { return l.id !== cardId; });
              localStorage.setItem(pkey, JSON.stringify(st));
            }
          }
        } catch (e) { }
      }
      if (ui.editCardId === cardId) {
        ui.editCardId = null;
        ui.cardQImage = '';
        ui.cardAImage = '';
      }
      refreshActiveDeck(deck);
      render();
      toast('已删除卡片');
    } catch (e) { alert(e.message); }
  }
  function cloneDeck(id) {
    var src = MindCardDecks.find(id);
    if (!src) return;
    if (!canAddShort()) {
      alert('短期卡组已达上限（' + shortLimit() + ' 个）。请先把一个短期卡组转为长期，或删除一个。');
      return;
    }
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = 'custom-' + Date.now().toString(36);
    copy.title = src.title + '（短期副本）';
    copy.mode = 'short';
    copy.tags = ['自定义'];
    copy.source = { type: 'manual' };
    delete copy.legacyProgressKey;
    copy.cards = (copy.cards || []).map(function (c, i) {
      var x = JSON.parse(JSON.stringify(c));
      x.id = 'c-' + Date.now().toString(36) + '-' + i.toString(36);
      return x;
    });
    try {
      MindCardDecks.saveImported(copy);
      location.hash = '#/edit?id=' + copy.id;
      location.reload();
    } catch (e) { alert(e.message); }
  }

  /* ================= 删除 / 恢复卡片 ================= */
  function hiddenCards() {
    return Object.keys(S.hidden || {}).map(function (id) { return ALL_BY_ID[id]; }).filter(Boolean);
  }
  function deleteCard(id) {
    if (!isEditableDeck(DECK)) {
      alert('长期卡组是只读的，不能删除卡片。需要修改请先导出 JSON 或另存为短期副本。');
      return;
    }
    var card = byId[id];
    if (!card) return;
    var preview = card.q.length > 30 ? card.q.slice(0, 30) + '…' : card.q;
    if (!confirm('删除这张卡片？\n\n「' + preview + '」\n\n卡片会从卡库和复习计划中移除，这张卡的学习记录一并清除。\n删除后可在「设置 → 回收站」恢复。')) return;
    S.hidden[id] = Date.now();
    delete S.cards[id];
    S.log = S.log.filter(function (l) { return l.id !== id; });
    save();
    var idx = -1;
    for (var i = 0; i < CARDS.length; i++) { if (CARDS[i].id === id) { idx = i; break; } }
    if (idx >= 0) CARDS.splice(idx, 1);
    delete byId[id];
    session = null;
    render();
    toast('已删除，可在设置 → 回收站恢复');
  }
  function restoreCard(id) {
    if (!S.hidden[id]) return;
    delete S.hidden[id];
    save();
    location.reload();
  }
  function restoreAllCards() {
    if (!Object.keys(S.hidden).length) return;
    if (!confirm('恢复全部已删除的卡片？学习进度不会恢复，卡片将从新卡开始。')) return;
    S.hidden = {};
    save();
    location.reload();
  }

  /* ================= 初始化 ================= */
  function checkStorage() {
    try {
      var k = '__mindcard_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
    } catch (e) {
      showStorageWarning('浏览器存储不可用（可能是隐私模式或空间已满）。学习记录不会保存，请导出备份。', 'save');
    }
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
    } catch (e) { }
  }
  function init() {
    if (!GLOBAL.theme) {
      var sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      GLOBAL.theme = sysDark ? 'dark' : (S.settings.theme || 'light');
      try { MindCardDecks.saveGlobalSettings(GLOBAL); } catch (e) { }
    }
    if (!GLOBAL.shortLimitUpgraded) {
      // 旧默认值是 5，一次性升级到 20；用户之后手动改回 5 不会被再次覆盖
      var oldLimit = parseInt(GLOBAL.shortDeckLimit, 10);
      if (!oldLimit || oldLimit === 5) GLOBAL.shortDeckLimit = 20;
      GLOBAL.shortLimitUpgraded = true;
      try { MindCardDecks.saveGlobalSettings(GLOBAL); } catch (e) { }
    }
    if (!GLOBAL.shortDeckLimit) {
      GLOBAL.shortDeckLimit = 20;
      try { MindCardDecks.saveGlobalSettings(GLOBAL); } catch (e) { }
    }
    applyTheme();
    checkStorage();
    if (storageNotice) showStorageWarning(storageNotice, 'corrupt');

    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    window.addEventListener('hashchange', function () {
      var nextPath = currentRoute().path;
      if ((ui.editDirty || ui.editMetaDirty) && nextPath !== 'edit' && ui.editDeckId) {
        if (!confirm('有未保存的编辑，确定离开吗？')) {
          try {
            var u = new URL(location.href);
            u.hash = '#/edit?id=' + encodeURIComponent(ui.editDeckId);
            history.replaceState(null, '', u.pathname + u.search + u.hash);
          } catch (e) { }
          return;
        }
        ui.editDirty = false;
        ui.editMetaDirty = false;
      }
      if (nextPath !== 'edit') {
        ui.cardQImage = '';
        ui.cardAImage = '';
      }
      if (nextPath !== 'decks') ui.showNewDeck = false;
      session = (nextPath === 'study') ? session : null;
      render();
      window.scrollTo(0, 0);
    });
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key.indexOf('mindcard:') !== 0) return;
      if (e.key === STORE || e.key === STORE + ':bak') {
        showStorageWarning('另一个标签页更新了当前卡组的进度。刷新页面查看最新状态，避免互相覆盖。', 'sync');
      } else {
        showStorageWarning('另一个标签页修改了卡组或设置。刷新页面查看最新状态，避免互相覆盖。', 'sync');
      }
    });
    window.addEventListener('mindcard:storage-error', function (e) {
      showStorageWarning('桌面数据目录写入失败：' + (e.detail || '未知错误') + '。请立即导出备份。', 'save');
    });
    window.addEventListener('beforeunload', function (e) {
      if (ui.editDirty || ui.editMetaDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    var themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    if (!location.hash) location.hash = '#/today';
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  }

  if (window.MindCardStorage && window.MindCardStorage.isDesktop) {
    window.MindCardStorage.ready.then(startMindCard, startMindCard);
  } else {
    startMindCard();
  }
})();
