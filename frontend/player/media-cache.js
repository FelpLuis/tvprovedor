/*
 * UpDown Digital — cache local de mídias.
 *
 * Cada arquivo é guardado no Cache Storage com a chave /player/cache/<sha256>.
 * O service worker (sw.js) atende essa URL a partir do cache, inclusive com
 * requisições Range (necessárias para <video>), permitindo reproduzir sem internet.
 */
(function (global) {
  'use strict';

  var CACHE_NAME = 'uds-media-v1';
  var KEY_PREFIX = '/player/cache/';
  // acima deste tamanho a verificação por hash consumiria memória demais na TV;
  // nesses casos verificamos o tamanho exato e o hash informado pelo servidor
  var HASH_VERIFY_MAX_BYTES = 150 * 1024 * 1024;
  var objectUrls = {};

  function supported() {
    return typeof caches !== 'undefined';
  }

  function keyFor(sha) {
    return KEY_PREFIX + sha;
  }

  function openCache() {
    return caches.open(CACHE_NAME);
  }

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return out;
  }

  function verify(blob, item) {
    if (blob.size !== item.size) {
      return Promise.reject(new Error('tamanho divergente (' + blob.size + ' != ' + item.size + ')'));
    }
    var canHash = global.crypto && global.crypto.subtle && blob.size <= HASH_VERIFY_MAX_BYTES;
    if (!canHash || !blob.arrayBuffer) {
      return Promise.resolve(true);
    }
    return blob.arrayBuffer()
      .then(function (buf) { return global.crypto.subtle.digest('SHA-256', buf); })
      .then(function (digest) {
        if (toHex(digest) !== item.sha256) { throw new Error('hash SHA-256 divergente'); }
        return true;
      });
  }

  function has(sha) {
    if (!supported()) { return Promise.resolve(false); }
    return openCache().then(function (c) { return c.match(keyFor(sha)); }).then(function (r) { return !!r; });
  }

  function fetchWithTimeout(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    return fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (timer) { clearTimeout(timer); } return r; },
        function (e) { if (timer) { clearTimeout(timer); } throw e; });
  }

  function download(item) {
    // tempo limite proporcional ao tamanho (mín. 2 min, ~ 256 KB/s)
    var timeout = Math.max(120000, Math.ceil(item.size / 262144) * 1000);
    return fetchWithTimeout(item.url, timeout).then(function (resp) {
      if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
      return resp.blob();
    }).then(function (blob) {
      return verify(blob, item).then(function () { return blob; });
    }).then(function (blob) {
      var headers = new Headers({
        'Content-Type': item.mime,
        'Content-Length': String(blob.size),
        'X-Cached-At': new Date().toISOString()
      });
      return openCache().then(function (c) {
        return c.put(new Request(keyFor(item.sha256)), new Response(blob, { status: 200, headers: headers }));
      });
    });
  }

  /**
   * Garante que todos os itens estejam no cache. Baixa em sequência (evita
   * saturar a rede/memória da TV) e só resolve se TODOS ficaram disponíveis.
   */
  function ensureAll(items, onProgress) {
    if (!supported()) { return Promise.resolve({ ok: true, cached: false }); }
    var unique = [];
    var seen = {};
    items.forEach(function (it) {
      if (!seen[it.sha256]) { seen[it.sha256] = true; unique.push(it); }
    });
    var done = 0;
    var failures = [];
    var chain = Promise.resolve();
    unique.forEach(function (it) {
      chain = chain.then(function () {
        return has(it.sha256).then(function (present) {
          if (present) { return null; }
          return download(it).catch(function (err) {
            // uma segunda tentativa antes de desistir deste item
            return download(it).catch(function (err2) {
              failures.push({ name: it.name, error: String((err2 && err2.message) || err2 || err) });
            });
          });
        }).then(function () {
          done += 1;
          if (onProgress) { onProgress(done, unique.length, it); }
        });
      });
    });
    return chain.then(function () {
      return { ok: failures.length === 0, cached: true, failures: failures };
    });
  }

  /** Remove do cache arquivos que não pertencem a nenhuma playlist em uso. */
  function prune(keepShas) {
    if (!supported()) { return Promise.resolve(0); }
    var keep = {};
    keepShas.forEach(function (s) { keep[keyFor(s)] = true; });
    return openCache().then(function (c) {
      return c.keys().then(function (reqs) {
        var removals = reqs.filter(function (r) {
          return !keep[new URL(r.url).pathname];
        }).map(function (r) { return c.delete(r); });
        return Promise.all(removals).then(function () { return removals.length; });
      });
    });
  }

  function clear() {
    Object.keys(objectUrls).forEach(function (k) { URL.revokeObjectURL(objectUrls[k]); });
    objectUrls = {};
    return supported() ? caches.delete(CACHE_NAME) : Promise.resolve(true);
  }

  /**
   * URL para reprodução. Com service worker ativo, usa a rota de cache (suporta
   * Range e não ocupa memória). Sem service worker, cria um blob: a partir do
   * cache. Sem Cache Storage, usa a URL assinada da rede.
   */
  function playbackUrl(item) {
    var swActive = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!supported()) { return Promise.resolve(item.url); }
    if (swActive) { return Promise.resolve(keyFor(item.sha256)); }
    if (objectUrls[item.sha256]) { return Promise.resolve(objectUrls[item.sha256]); }
    return openCache().then(function (c) { return c.match(keyFor(item.sha256)); }).then(function (r) {
      if (!r) { return item.url; }
      return r.blob().then(function (b) {
        objectUrls[item.sha256] = URL.createObjectURL(b);
        return objectUrls[item.sha256];
      });
    });
  }

  function releaseUnused(keepShas) {
    var keep = {};
    keepShas.forEach(function (s) { keep[s] = true; });
    Object.keys(objectUrls).forEach(function (sha) {
      if (!keep[sha]) { URL.revokeObjectURL(objectUrls[sha]); delete objectUrls[sha]; }
    });
  }

  function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  global.MediaCache = {
    supported: supported,
    ensureAll: ensureAll,
    prune: prune,
    clear: clear,
    playbackUrl: playbackUrl,
    releaseUnused: releaseUnused,
    estimate: estimate,
    requestPersistence: requestPersistence,
    keyFor: keyFor
  };
})(window);
