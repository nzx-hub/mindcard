/*
 * MindCard storage adapter.
 *
 * Browser: no-op; the app keeps using localStorage.
 * Tauri: load a disk snapshot into localStorage before the app boots, then
 * mirror every mindcard:* write to %LOCALAPPDATA%/<app>/storage.
 *
 * Writes are asynchronous and coalesced, so the existing synchronous app code
 * does not need to become async.
 */
(function () {
  'use strict';

  var invoke = null;
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    invoke = window.__TAURI__.core.invoke;
  } else if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
    invoke = window.__TAURI_INTERNALS__.invoke;
  }

  var isDesktop = !!invoke;
  var storage = window.localStorage;
  var proto = window.Storage && window.Storage.prototype;
  var nativeSet = proto && proto.setItem;
  var nativeGet = proto && proto.getItem;
  var nativeRemove = proto && proto.removeItem;
  var nativeKey = proto && proto.key;

  var pending = {};
  var flushTimer = null;
  var chain = Promise.resolve();
  var patched = false;
  var error = null;

  function isMindcard(key) {
    return typeof key === 'string' && key.indexOf('mindcard:') === 0;
  }

  function localKeys() {
    var keys = [];
    try {
      var n = storage.length;
      for (var i = 0; i < n; i++) {
        var k = nativeKey.call(storage, i);
        if (isMindcard(k)) keys.push(k);
      }
    } catch (e) {
      error = e;
    }
    return keys;
  }

  function warn(message, e) {
    error = e || new Error(message);
    if (window.console && console.warn) console.warn('MindCard storage:', message, e || '');
    try {
      window.dispatchEvent(new CustomEvent('mindcard:storage-error', { detail: message }));
    } catch (ignore) { }
  }

  function enqueue(kind, key, value) {
    if (!isDesktop || !isMindcard(key)) return;
    if (kind === 'remove') {
      pending[key] = { kind: 'remove', key: key };
    } else {
      pending[key] = { kind: 'set', key: key, value: value };
    }
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 40);
    }
  }

  function flush() {
    flushTimer = null;
    var keys = Object.keys(pending);
    if (!keys.length) return;
    var ops = keys.map(function (key) { return pending[key]; });
    pending = {};

    ops.forEach(function (op) {
      chain = chain.then(function () {
        var request = op.kind === 'remove'
          ? invoke('storage_remove', { key: op.key })
          : invoke('storage_set', { key: op.key, value: op.value });
        return request.catch(function (e) {
          warn('写入磁盘失败，' + (op.key || ''), e);
        });
      });
    });
  }

  function installPatch() {
    if (patched || !isDesktop || !proto || !nativeSet || !nativeGet || !nativeRemove) return;
    patched = true;

    proto.setItem = function (key, value) {
      var result = nativeSet.call(this, key, String(value));
      if (this === storage) enqueue('set', key, String(value));
      return result;
    };
    proto.removeItem = function (key) {
      var result = nativeRemove.call(this, key);
      if (this === storage) enqueue('remove', key);
      return result;
    };
  }

  function applyDisk(entries) {
    var disk = {};
    (entries || []).forEach(function (entry) {
      if (entry && isMindcard(entry.key)) disk[entry.key] = String(entry.value);
    });

    var diskKeys = Object.keys(disk);
    var local = localKeys();

    if (!diskKeys.length) {
      // First desktop run: keep existing WebView localStorage and seed disk.
      if (!local.length) return Promise.resolve();
      return Promise.all(local.map(function (key) {
        return invoke('storage_set', { key: key, value: nativeGet.call(storage, key) });
      })).catch(function (e) {
        warn('迁移旧数据失败', e);
      });
    }

    // Disk is authoritative; remove stale cached keys, then hydrate.
    local.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(disk, key)) {
        try { nativeRemove.call(storage, key); } catch (e) { warn('清理旧缓存失败', e); }
      }
    });
    diskKeys.forEach(function (key) {
      try { nativeSet.call(storage, key, disk[key]); } catch (e) { warn('载入磁盘数据失败', e); }
    });
    return Promise.resolve();
  }

  function boot() {
    if (!isDesktop) return Promise.resolve();
    return invoke('storage_load')
      .then(applyDisk)
      .catch(function (e) {
        warn('读取磁盘数据失败，暂时使用 localStorage', e);
      })
      .then(function () {
        installPatch();
      });
  }

  if (isDesktop) {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  var api = {
    isDesktop: isDesktop,
    ready: boot(),
    flush: flush
  };
  Object.defineProperty(api, 'error', {
    get: function () { return error; }
  });

  window.MindCardStorage = api;
})();