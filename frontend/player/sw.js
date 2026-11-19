/*
 * Service worker do player.
 * - Mantém o "app shell" do player disponível offline (reinício da TV sem internet).
 * - Atende /player/cache/<sha256> a partir do cache de mídias, com suporte a Range.
 * - Nunca armazena respostas da API.
 */
'use strict';

var SHELL_CACHE = 'uds-shell-v3';
var MEDIA_CACHE = 'uds-media-v1';
var SHELL = [
  '/player/',
  '/player/index.html',
  '/player/player.css',
  '/player/player.js',
  '/player/media-cache.js',
  '/player/dashboard.js',
  '/player/manifest.webmanifest',
  '/player/icon-192.png',
  '/player/brand/logo-updown.png',
  '/player/brand/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) {
        return n.indexOf('uds-shell-') === 0 && n !== SHELL_CACHE;
      }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function parseRange(header, size) {
  var m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) { return null; }
  var start, end;
  if (m[1] === '') { // sufixo: últimos N bytes
    var n = parseInt(m[2], 10);
    if (isNaN(n)) { return null; }
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (isNaN(start) || isNaN(end) || start > end || start >= size) { return 'invalid'; }
  return { start: start, end: end };
}

function serveMedia(request) {
  var key = new URL(request.url).pathname;
  return caches.open(MEDIA_CACHE).then(function (c) { return c.match(key); }).then(function (cached) {
    if (!cached) {
      return new Response('Mídia não está no cache', { status: 404 });
    }
    var rangeHeader = request.headers.get('range');
    if (!rangeHeader) { return cached; }
    return cached.blob().then(function (blob) {
      var range = parseRange(rangeHeader, blob.size);
      if (range === null) { return cached; }
      if (range === 'invalid') {
        return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + blob.size } });
      }
      var part = blob.slice(range.start, range.end + 1);
      return new Response(part, {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
          'Content-Length': String(part.size),
          'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + blob.size,
          'Accept-Ranges': 'bytes'
        }
      });
    });
  });
}

function shellNetworkFirst(request) {
  return fetch(request).then(function (resp) {
    if (resp && resp.ok) {
      var copy = resp.clone();
      caches.open(SHELL_CACHE).then(function (c) { c.put(request, copy); });
    }
    return resp;
  }).catch(function () {
    return caches.open(SHELL_CACHE).then(function (c) {
      return c.match(request, { ignoreSearch: true }).then(function (r) {
        return r || c.match('/player/index.html');
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }
  if (url.pathname.indexOf('/player/cache/') === 0) {
    event.respondWith(serveMedia(req));
    return;
  }
  if (url.pathname.indexOf('/api/') === 0) { return; } // sempre rede
  if (url.pathname.indexOf('/player/') === 0 || url.pathname === '/player') {
    event.respondWith(shellNetworkFirst(req));
  }
});
