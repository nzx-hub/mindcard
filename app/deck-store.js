/* MindCard · 卡组运行时
 * 负责：内置/导入卡组、活动卡组、格式校验、Markdown 解析、适配旧版引擎。
 * 在 app.js 之前加载，并把 window.CHAPTERS / window.CARDS 准备好。
 */
(function () {
  'use strict';

  var BUILTIN = window.MC_BUILTIN || [];
  var KEY_INDEX = 'mindcard:deck-index';
  var KEY_DECK = 'mindcard:deck:';
  var KEY_ACTIVE = 'mindcard:active';
  var KEY_TRASH = 'mindcard:deck-trash';
  var KEY_GLOBAL = 'mindcard:settings';
  var KEY_LEGACY = 'mindcard:decks';
  var deckCache = {};

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  }
  function readJSON(key, fallback) {
    var raw = safeGet(key);
    if (!raw) return fallback;
    try {
      var obj = JSON.parse(raw);
      return obj == null ? fallback : obj;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, obj, label) {
    if (!safeSet(key, JSON.stringify(obj))) {
      throw new Error('浏览器存储空间不足，无法保存' + (label || '数据') + '，请先导出备份并清理空间');
    }
  }

  function readIndex() {
    var arr = readJSON(KEY_INDEX, []);
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (x) { return typeof x === 'string'; });
  }
  function writeIndex(ids) {
    // 索引丢失可以靠扫描恢复，因此写入失败不阻断
    safeSet(KEY_INDEX, JSON.stringify(ids));
  }
  function addToIndex(id) {
    var ids = readIndex();
    if (ids.indexOf(id) < 0) { ids.push(id); writeIndex(ids); }
  }
  function removeFromIndex(id) {
    writeIndex(readIndex().filter(function (x) { return x !== id; }));
  }
  function scanDeckIds() {
    var ids = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY_DECK) === 0) ids.push(k.slice(KEY_DECK.length));
      }
    } catch (e) { }
    return ids;
  }
  function importedIds() {
    var ids = readIndex().slice();
    scanDeckIds().forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    return ids;
  }
  function loadImportedDeck(id) {
    if (deckCache[id]) return deckCache[id];
    var raw = safeGet(KEY_DECK + id);
    if (!raw) return null;
    try {
      var d = JSON.parse(raw);
      if (d && d.id === id && Array.isArray(d.cards)) { deckCache[id] = d; return d; }
    } catch (e) { }
    return null;
  }
  function storeDeck(deck, label) {
    if (!safeSet(KEY_DECK + deck.id, JSON.stringify(deck))) {
      throw new Error('浏览器存储空间不足，无法保存' + (label || '卡组') + '，请先导出备份并清理空间');
    }
    deckCache[deck.id] = deck;
    addToIndex(deck.id);
  }

  /* 把旧版“所有卡组塞在一个键”的数据迁移到一卡组一键 */
  (function migrateLegacy() {
    var raw = safeGet(KEY_LEGACY);
    if (!raw) return;
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      var migrated = [], valid = 0;
      Object.keys(obj).forEach(function (id) {
        var d = obj[id];
        if (d && d.id === id && Array.isArray(d.cards)) {
          valid++;
          try { storeDeck(d, '迁移卡组'); migrated.push(id); } catch (e) { }
        }
      });
      if (migrated.length && migrated.length === valid) safeRemove(KEY_LEGACY);
    } catch (e) { }
  })();

  function allDecks() {
    var list = BUILTIN.slice();
    importedIds().forEach(function (id) {
      if (list.some(function (d) { return d.id === id; })) return;
      var d = loadImportedDeck(id);
      if (d) list.push(d);
    });
    return list;
  }
  function findDeck(id) {
    if (!id) return null;
    var found = BUILTIN.filter(function (d) { return d.id === id; })[0];
    if (found) return found;
    return loadImportedDeck(id);
  }
  function isBuiltin(id) {
    return BUILTIN.some(function (d) { return d.id === id; });
  }
  function activeId() {
    var fromUrl = null;
    try { fromUrl = new URLSearchParams(location.search).get('deck'); } catch (e) { }
    var id = fromUrl || safeGet(KEY_ACTIVE);
    return findDeck(id) ? id : (BUILTIN[0] ? BUILTIN[0].id : null);
  }
  function setActive(id) {
    if (!findDeck(id)) return;
    safeSet(KEY_ACTIVE, id);
    // 如果当前 URL 带 ?deck=，同步更新，避免切换后被旧链接拉回去
    try {
      var url = new URL(location.href);
      if (url.searchParams.has('deck')) {
        url.searchParams.set('deck', id);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    } catch (e) { }
  }

  function saveImported(deck) {
    if (isBuiltin(deck.id)) throw new Error('这个 id 与内置卡组冲突，请换一个 id');
    storeDeck(deck, '卡组');
    setActive(deck.id);
  }
  function saveDeckDirect(deck) {
    if (isBuiltin(deck.id)) throw new Error('这个 id 与内置卡组冲突');
    storeDeck(deck, '卡组');
  }
  function updateDeck(deck) {
    if (isBuiltin(deck.id)) throw new Error('内置卡组不能直接修改，请先复制为自定义卡组');
    if (!loadImportedDeck(deck.id)) throw new Error('这个卡组不存在，可能已被删除');
    storeDeck(deck, '卡组修改');
  }
  function deleteImported(id) {
    safeRemove(KEY_DECK + id);
    delete deckCache[id];
    removeFromIndex(id);
    if (safeGet(KEY_ACTIVE) === id && BUILTIN[0]) setActive(BUILTIN[0].id);
  }

  /* ---------------- 卡组回收站 ---------------- */
  function readTrash() {
    var t = readJSON(KEY_TRASH, {});
    return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  }
  function writeTrash(t) {
    if (!safeSet(KEY_TRASH, JSON.stringify(t))) throw new Error('存储空间不足，无法更新回收站');
  }
  function trashDeck(id) {
    var deck = findDeck(id);
    if (!deck || isBuiltin(id)) return;
    var t = readTrash();
    t[id] = { deck: deck, at: Date.now() };
    writeTrash(t);
    deleteImported(id);
  }
  function trashedDecks() {
    var t = readTrash(), out = [];
    Object.keys(t).forEach(function (id) {
      if (t[id] && t[id].deck) out.push({ id: id, deck: t[id].deck, at: t[id].at || 0 });
    });
    return out.sort(function (a, b) { return b.at - a.at; });
  }
  function restoreDeck(id) {
    var t = readTrash(), item = t[id];
    if (!item || !item.deck) return false;
    storeDeck(item.deck, '恢复卡组');
    delete t[id];
    writeTrash(t);
    setActive(id);
    return true;
  }
  function purgeTrash(id) {
    var t = readTrash();
    delete t[id];
    writeTrash(t);
    safeRemove('mindcard:progress:' + id);
    safeRemove('mindcard:progress:' + id + ':bak');
  }
  function importTrash(list) {
    if (!Array.isArray(list)) return;
    var t = readTrash();
    list.forEach(function (item) {
      if (item && item.deck && item.deck.id && !isBuiltin(item.deck.id)) {
        t[item.deck.id] = { deck: item.deck, at: item.at || Date.now() };
      }
    });
    writeTrash(t);
  }

  /* ---------------- 全局设置 ---------------- */
  function globalSettings() {
    var s = readJSON(KEY_GLOBAL, {});
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  }
  function saveGlobalSettings(obj) {
    writeJSON(KEY_GLOBAL, obj, '设置');
  }

  /* ---------------- 校验 ---------------- */

  function validateDeck(deck, allowEmptyCards) {
    var errors = [];
    if (!deck || typeof deck !== 'object' || Array.isArray(deck)) return ['不是有效的 JSON 对象'];
    if (deck.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
    if (!deck.id || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(deck.id)) {
      errors.push('id 不合规：只能用小写字母、数字、短横线，2-64 位');
    }
    if (!deck.title || typeof deck.title !== 'string') errors.push('缺少 title');
    if (deck.mode && deck.mode !== 'short' && deck.mode !== 'long') errors.push('mode 只能是 short 或 long');
    if (!Array.isArray(deck.chapters) || !deck.chapters.length) errors.push('chapters 不能为空');
    if (!Array.isArray(deck.cards)) errors.push('cards 必须是数组');
    else if (!allowEmptyCards && !deck.cards.length) errors.push('cards 不能为空');
    if (errors.length) return errors;

    var chIds = {};
    deck.chapters.forEach(function (c) {
      if (!c || typeof c.id !== 'string') { errors.push('章节缺少 id'); return; }
      if (!/^ch-[a-z0-9-]{1,48}$/.test(c.id)) errors.push('章节 id 不合规：' + c.id);
      if (chIds[c.id]) errors.push('章节 id 重复：' + c.id);
      chIds[c.id] = true;
      if (!c.name) errors.push('章节缺少 name：' + c.id);
    });

    var cardIds = {}, questions = {};
    deck.cards.forEach(function (c, i) {
      var at = '第 ' + (i + 1) + ' 张卡';
      if (!c || typeof c !== 'object') { errors.push(at + '不是对象'); return; }
      if (!c.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(c.id)) errors.push(at + '的 id 不合规');
      if (cardIds[c.id]) errors.push('卡片 id 重复：' + c.id);
      cardIds[c.id] = true;
      if (!chIds[c.chapter]) errors.push(at + '引用了不存在的章节：' + c.chapter);
      if (['recall', 'cloze', 'choice', 'judge', 'code'].indexOf(c.type) < 0) {
        errors.push(at + '的类型不合规：' + c.type);
      }
      if (!String(c.question || '').trim() && !c.questionImage) errors.push(at + '缺少 question 或 questionImage');
      if (!String(c.answer || '').trim() && !c.answerImage) errors.push(at + '缺少 answer 或 answerImage');
      if (c.questionImage && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(c.questionImage)) {
        errors.push(at + '的题目图片格式不合规');
      }
      if (c.answerImage && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(c.answerImage)) {
        errors.push(at + '的答案图片格式不合规');
      }
      if (c.questionImage && String(c.questionImage).length > 2000000) errors.push(at + '的题目图片太大');
      if (c.answerImage && String(c.answerImage).length > 2000000) errors.push(at + '的答案图片太大');
      if (c.type === 'choice') {
        if (!Array.isArray(c.options) || c.options.length < 2) errors.push(at + '缺少 options');
        else if (typeof c.answerIndex !== 'number' || c.answerIndex < 0 || c.answerIndex >= c.options.length) {
          errors.push(at + '的 answerIndex 越界');
        }
      }
      if (c.type === 'judge' && typeof c.correct !== 'boolean') errors.push(at + '缺少 correct');
      if (c.type === 'cloze' && (!Array.isArray(c.accept) || !c.accept.length)) errors.push(at + '缺少 accept');
      var q = String(c.question || '').replace(/[\s，。；：、,.!?！？（）()]/g, '').toLowerCase();
      if (q && questions[q]) errors.push('题目重复：' + c.id + ' 与 ' + questions[q]);
      else if (q) questions[q] = c.id;
    });

    return errors;
  }

  /* ---------------- Markdown → Deck ---------------- */

  function hash(str) {
    var h = 5381, i;
    for (i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function slug(title) {
    var s = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (s.length >= 2) return s.slice(0, 50);
    return 'deck-' + hash(String(title || 'deck'));
  }
  function cleanName(name) {
    return name.replace(/^第\s*[0-9一二三四五六七八九十百]+\s*[章讲节篇]\s*/, '').trim() || name;
  }

  var Q_RE = /^(?:Q|问|问题)\s*[:：]\s*(.+)$/i;
  var A_RE = /^(?:A|答|答案)\s*[:：]\s*(.+)$/i;
  var HEAD_RE = /^(#{1,6})\s+(.+?)\s*$/;
  var BULLET_RE = /^\s*(?:[-*+•·]|\d+[.、)])\s+(.+?)\s*$/;
  var CH_RE = /^第\s*[0-9一二三四五六七八九十百]+\s*[章讲节篇]/;
  var DEF_RE = /^(.{2,40}?)\s*[:：]\s*(.{6,})$/;

  function parseMarkdown(text, titleHint) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var chapters = [], cards = [], seen = {}, current = null, pendingQ = null;
    var title = '';

    function addChapter(name) {
      name = name.trim();
      if (!name) return;
      if (current && current.name === name) return;
      var cid = 'ch-' + String(chapters.length + 1).padStart(2, '0');
      current = { id: cid, order: chapters.length + 1, name: name, short: cleanName(name).slice(0, 10) };
      chapters.push(current);
    }
    function ensureChapter() {
      if (!current) addChapter('全部内容');
      return current;
    }
    function addCard(q, a, tag) {
      q = String(q || '').replace(/\s+/g, ' ').trim();
      a = String(a || '').replace(/\r/g, '').split('\n').map(function (line) {
        return line.replace(/[ \t]+/g, ' ').trim();
      }).join('\n').trim();
      if (q.length < 2 || a.length < 1 || q === a) return;
      var key = q.replace(/[\s，。；：、,.!?！？]/g, '').toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      var ch = ensureChapter();
      cards.push({
        id: 'c-' + String(cards.length + 1).padStart(4, '0'),
        chapter: ch.id,
        type: 'recall',
        tag: tag || '导入',
        question: q,
        answer: a
      });
    }
    function addTable(rows) {
      if (rows.length < 2) return;
      var body = rows.slice(1);
      body.forEach(function (row) {
        if (row.length < 2) return;
        var q = (row[0] || '').trim(), a = (row[1] || '').trim();
        if (!q || !a) return;
        if (/^(问题|知识点|术语|项目|概念)$/.test(q) && /^(答案|解释|定义|说明)$/.test(a)) return;
        addCard(q, a, '表格');
      });
    }

    var i = 0;
    while (i < lines.length) {
      var line = lines[i], t = line.trim();

      // 代码围栏：整段跳过，避免里面的 # / | 被误判
      if (/^(```|~~~)/.test(t)) {
        var fence = t.slice(0, 3);
        i++;
        while (i < lines.length) {
          var endLine = lines[i].trim();
          i++;
          if (endLine.indexOf(fence) === 0) break;
        }
        pendingQ = null;
        continue;
      }

      if (t.indexOf('|') === 0 && t.split('|').length >= 3) {
        var tableLines = [];
        while (i < lines.length && lines[i].trim().indexOf('|') === 0) {
          tableLines.push(lines[i].trim()); i++;
        }
        var rows = [];
        tableLines.forEach(function (tl) {
          if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(tl)) return;
          var cells = tl.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (x) { return x.trim(); });
          rows.push(cells);
        });
        addTable(rows);
        continue;
      }

      if (!t) { pendingQ = null; i++; continue; }

      var mh = HEAD_RE.exec(line);
      if (mh) {
        var level = mh[1].length, name = mh[2].trim();
        if (level === 1 && !title) { title = name; }
        else if (level <= 2) { addChapter(name); }
        pendingQ = null; i++; continue;
      }
      if (CH_RE.test(t) && t.length <= 60) {
        addChapter(t); pendingQ = null; i++; continue;
      }
      var mq = Q_RE.exec(t);
      if (mq) { pendingQ = mq[1].trim(); i++; continue; }

      var ma = A_RE.exec(t);
      if (ma && pendingQ) {
        var answerLines = [ma[1]];
        i++;
        while (i < lines.length) {
          var nt = lines[i].trim();
          if (!nt) break;
          if (/^(```|~~~)/.test(nt)) {
            var fm = nt.slice(0, 3);
            answerLines.push(lines[i]); i++;
            while (i < lines.length) {
              answerLines.push(lines[i]);
              var closed = lines[i].trim().indexOf(fm) === 0;
              i++;
              if (closed) break;
            }
            continue;
          }
          if (Q_RE.test(nt) || A_RE.test(nt) || HEAD_RE.test(nt) || CH_RE.test(nt) ||
              BULLET_RE.test(nt) || nt.charAt(0) === '|') break;
          answerLines.push(lines[i]); i++;
        }
        addCard(pendingQ, answerLines.join('\n'), '问答');
        pendingQ = null;
        continue;
      }
      if (pendingQ) { addCard(pendingQ, t, '问答'); pendingQ = null; i++; continue; }

      var mb = BULLET_RE.exec(line);
      if (mb) {
        var md = DEF_RE.exec(mb[1].trim());
        if (md && !/^(注意|提示|说明|例如|比如|总结|补充)$/.test(md[1].trim())) {
          addCard(md[1].trim(), md[2].trim(), '要点');
        }
        i++; continue;
      }
      i++;
    }

    if (!title) title = titleHint || '导入的卡组';
    if (!chapters.length) addChapter('全部内容');
    var deck = {
      schemaVersion: 1,
      id: slug(title),
      title: title,
      description: '由 Markdown / 文本导入',
      language: 'zh-CN',
      author: '',
      license: '未声明',
      tags: ['导入'],
      source: { type: 'md' },
      chapters: chapters,
      cards: cards
    };
    return deck;
  }

  /* ---------------- 适配旧版引擎 ---------------- */

  function adapt(deck) {
    var index = {};
    var chapters = deck.chapters.map(function (c, i) {
      index[c.id] = i + 1;
      return { id: i + 1, name: c.name, short: c.short || cleanName(c.name).slice(0, 6) };
    });
    var cards = deck.cards.map(function (c) {
      var o = {
        id: c.id,
        ch: index[c.chapter] || 1,
        type: c.type,
        tag: c.tag || '',
        q: c.question || '',
        a: c.answer || ''
      };
      if (c.questionImage) o.qImage = c.questionImage;
      if (c.answerImage) o.aImage = c.answerImage;
      if (c.accept) o.accept = c.accept.slice();
      if (c.type === 'choice') { o.opts = c.options.slice(); o.ans = c.answerIndex; }
      if (c.type === 'judge') o.ans = c.correct ? 0 : 1;
      if (c.pre) o.pre = c.pre;
      return o;
    });
    return { chapters: chapters, cards: cards };
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    var active = findDeck(activeId()) || BUILTIN[0] || null;
    if (!active) {
      active = {
        schemaVersion: 1, id: 'empty-deck', title: '空卡组',
        chapters: [{ id: 'ch-01', name: '全部内容' }],
        cards: [{ id: 'c-0001', chapter: 'ch-01', type: 'recall', question: '导入一个卡组开始', answer: '点击顶部「卡组」导入 JSON 或 Markdown。' }]
      };
    }
    setActive(active.id);

    var adapted = adapt(active);
    window.CHAPTERS = adapted.chapters;
    window.CARDS = adapted.cards;
    window.MC_DECK_META = active;
    window.MindCardDecks = {
      all: allDecks,
      find: findDeck,
      active: active,
      activeId: activeId,
      setActive: setActive,
      isBuiltin: isBuiltin,
      saveImported: saveImported,
      saveDeckDirect: saveDeckDirect,
      updateDeck: updateDeck,
      deleteImported: deleteImported,
      trashDeck: trashDeck,
      trashedDecks: trashedDecks,
      restoreDeck: restoreDeck,
      purgeTrash: purgeTrash,
      importTrash: importTrash,
      globalSettings: globalSettings,
      saveGlobalSettings: saveGlobalSettings,
      validateDeck: validateDeck,
      parseMarkdown: parseMarkdown,
      adapt: adapt
    };
  }

  if (window.MindCardStorage && window.MindCardStorage.isDesktop) {
    window.MindCardStorage.ready.then(boot, boot);
  } else {
    boot();
  }
})();
