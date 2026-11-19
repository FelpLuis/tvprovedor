/*
 * UpDown Digital — player para Android TV (PWA).
 *
 * Fluxo:
 *   1. Sem token: solicita código de ativação e aguarda o administrador ativar.
 *   2. Com token: busca a configuração, baixa as mídias para o cache local e
 *      inicia a reprodução (ou o dashboard) conforme o perfil fixo da TV.
 *   3. Heartbeat periódico: informa o estado, recebe comandos remotos e detecta
 *      mudanças de configuração (hash). Uma nova playlist só substitui a atual
 *      depois que todos os arquivos estiverem baixados e verificados.
 *   4. Sem conexão: continua reproduzindo a última configuração válida.
 */
(function () {
  'use strict';

  var PLAYER_VERSION = '1.0.0';
  var API = '/api/player';
  var LS_TOKEN = 'uds.token';
  var LS_CONFIG = 'uds.config';
  var LS_PAIRING = 'uds.pairing';
  var VIDEO_STALL_SECONDS = 20;
  var MIN_ITEM_MS = 1000;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    token: null,
    config: null,          // configuração em execução
    pendingReady: null,    // nova configuração já baixada, aplicada ao fim do item atual
    syncing: false,
    online: true,
    failedHeartbeats: 0,
    playbackState: 'idle',
    currentContent: null,
    lastError: null,
    heartbeatTimer: null,
    heartbeatInterval: 30,
    startedAt: new Date(),
    lastHeartbeatAt: null,
    downloadProgress: null,
    poweredOff: false,
    lastPower: null,
    mediaVolume: 1
  };

  // ---------------------------------------------------------------- utilidades

  function log() {
    if (window.console) { console.log.apply(console, ['[UDS]'].concat([].slice.call(arguments))); }
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { log('localStorage indisponível', e); }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
  }

  function HttpError(status, body) {
    this.status = status;
    this.body = body;
    this.message = 'HTTP ' + status;
  }

  function request(method, path, body, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000) : null;
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
    if (state.token) { headers['Authorization'] = 'Bearer ' + state.token; }
    return fetch(API + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (resp) {
      if (timer) { clearTimeout(timer); }
      return resp.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!resp.ok) { throw new HttpError(resp.status, data); }
        return data;
      });
    }, function (err) {
      if (timer) { clearTimeout(timer); }
      throw err;
    });
  }

  function show(id) {
    ['stage', 'dashboard', 'activation', 'message', 'standby'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  function setError(msg) {
    state.lastError = msg ? String(msg).slice(0, 1900) : null;
    if (msg) { log('erro:', msg); }
  }

  function setOnline(online) {
    state.online = online;
    $('offline-badge').classList.toggle('hidden', online);
  }

  // ---------------------------------------------------------------- disposição da tela
  //
  // Todo o conteúdo fica no elemento #display ("palco lógico"). Conforme a configuração da TV:
  //  - rotation 90/270: o palco fica em pé (retrato) e é girado para a TV instalada na vertical;
  //  - width/height: resolução fixa de renderização, escalada para caber na tela real
  //    (mesmo layout em TVs de polegadas e resoluções diferentes);
  //  - safe_margin_percent: margem para TVs que cortam as bordas (overscan).

  var ORIENTATION_LABEL = { 0: 'paisagem', 90: 'retrato', 180: 'paisagem invertida', 270: 'retrato invertido' };

  var LS_DISPLAY = 'uds.display';

  // App Android "UpDown Digital": expõe window.UpDownNative (tela cheia, informações do aparelho)
  var NATIVE = window.UpDownNative || null;
  var nativeInfo = null;
  if (NATIVE) {
    try { nativeInfo = JSON.parse(NATIVE.getInfo()); } catch (e) { nativeInfo = null; }
  }

  /** Configuração do gerenciador; antes da ativação, a última disposição usada nesta TV. */
  function displaySettings() {
    if (state.config && state.config.display) { return state.config.display; }
    try {
      var saved = JSON.parse(lsGet(LS_DISPLAY) || 'null');
      if (saved && typeof saved.rotation === 'number') { return saved; }
    } catch (e) { /* ignora */ }
    return { rotation: 0, width: null, height: null, safe_margin_percent: 0 };
  }

  function applyDisplay() {
    var d = displaySettings();
    var el = $('display');
    var rot = d.rotation || 0;
    var pw = window.innerWidth || document.documentElement.clientWidth;
    var ph = window.innerHeight || document.documentElement.clientHeight;
    var sideways = rot === 90 || rot === 270;
    var availW = sideways ? ph : pw;
    var availH = sideways ? pw : ph;
    var margin = Math.min(Math.max(d.safe_margin_percent || 0, 0), 10) / 100;
    var innerW = availW * (1 - 2 * margin);
    var innerH = availH * (1 - 2 * margin);
    var lw, lh, scale;
    if (d.width && d.height) {
      lw = d.width; lh = d.height;
      scale = Math.min(innerW / lw, innerH / lh);
    } else {
      lw = Math.round(innerW); lh = Math.round(innerH);
      scale = 1;
    }
    el.style.width = lw + 'px';
    el.style.height = lh + 'px';
    el.style.left = ((pw - lw) / 2) + 'px';
    el.style.top = ((ph - lh) / 2) + 'px';
    el.style.transform = 'rotate(' + rot + 'deg) scale(' + scale + ')';
    el.style.setProperty('--vmin', (Math.min(lw, lh) / 100) + 'px');
    el.style.setProperty('--vw', (lw / 100) + 'px');
    var wantFullscreen = d.fullscreen !== false;
    if (NATIVE) {
      try { NATIVE.setFullscreen(wantFullscreen); } catch (e) { /* ignora */ }
    }
    var so = window.screen && window.screen.orientation && window.screen.orientation.type;
    state.display = {
      viewport: [pw, ph],
      screen: [window.screen ? window.screen.width : pw, window.screen ? window.screen.height : ph],
      dpr: window.devicePixelRatio || 1,
      device_orientation: so || (pw >= ph ? 'landscape' : 'portrait'),
      logical: [lw, lh],
      rotation: rot,
      scale: Math.round(scale * 1000) / 1000,
      fullscreen: wantFullscreen,
      client: NATIVE ? 'app' : 'navegador'
    };
    if (nativeInfo) {
      state.display.app = String(nativeInfo.app || '');
      state.display.device = String(nativeInfo.device || '');
      state.display.android = String(nativeInfo.android || '');
    }
  }

  function displaySummary() {
    var x = state.display;
    if (!x) { return '-'; }
    return 'palco ' + x.logical[0] + '×' + x.logical[1] + ' (' + ORIENTATION_LABEL[x.rotation] +
      ', escala ' + x.scale + ') · navegador ' + x.viewport[0] + '×' + x.viewport[1] +
      ' · DPR ' + x.dpr + ' (≈ ' + Math.round(x.viewport[0] * x.dpr) + '×' + Math.round(x.viewport[1] * x.dpr) + ' físicos)';
  }

  var identifyTimer = null;
  function showIdentify(seconds) {
    applyDisplay();
    var cfg = state.config;
    var d = displaySettings();
    var x = state.display;
    $('identify-title').textContent = cfg ? cfg.screen.identifier + ' — ' + cfg.screen.name : 'TV não ativada';
    $('identify-text').textContent = [
      'Orientação:        ' + ORIENTATION_LABEL[x.rotation] + ' (' + x.rotation + '°)',
      'Resolução do palco: ' + x.logical[0] + ' × ' + x.logical[1] + (d.width ? ' (fixa)' : ' (automática)'),
      'Escala aplicada:   ' + x.scale,
      'Navegador:         ' + x.viewport[0] + ' × ' + x.viewport[1] + ' px CSS · DPR ' + x.dpr,
      'Pixels físicos:    ≈ ' + Math.round(x.viewport[0] * x.dpr) + ' × ' + Math.round(x.viewport[1] * x.dpr),
      'Tela do aparelho:  ' + x.screen[0] + ' × ' + x.screen[1] + ' · ' + x.device_orientation,
      'Polegadas:         ' + (d.inches ? d.inches + '"' : 'não informado'),
      'Margem segurança:  ' + (d.safe_margin_percent || 0) + '%',
      'Tela cheia:        ' + (d.fullscreen === false ? 'desativada' : 'ativada'),
      'Player:            ' + PLAYER_VERSION + (nativeInfo ? ' · app ' + nativeInfo.app + ' · ' + nativeInfo.device + ' · Android ' + nativeInfo.android : ' · navegador'),
      '',
      'Os cantos amarelos devem aparecer inteiros. Se estiverem cortados, aumente a margem de segurança.'
    ].join('\n');
    $('identify').classList.remove('hidden');
    clearTimeout(identifyTimer);
    identifyTimer = setTimeout(function () { $('identify').classList.add('hidden'); }, (seconds || 30) * 1000);
  }

  // ---------------------------------------------------------------- energia e som

  function nativeCall(name) {
    if (!NATIVE || typeof NATIVE[name] !== 'function') { return undefined; }
    try { return NATIVE[name].apply(NATIVE, [].slice.call(arguments, 1)); } catch (e) { return undefined; }
  }

  /** O app guarda o token para consultar o servidor enquanto a tela estiver apagada. */
  function shareCredentials() {
    if (state.token) { nativeCall('setCredentials', state.token, location.origin); }
  }

  function applyAudio(audio) {
    var vol = audio && typeof audio.volume === 'number' ? audio.volume : null;
    if (NATIVE && typeof NATIVE.setVolume === 'function') {
      state.mediaVolume = 1;  // o app ajusta o volume do aparelho
      if (vol !== null) { nativeCall('setVolume', vol); }
    } else {
      state.mediaVolume = vol === null ? 1 : vol / 100;
    }
    var v = document.querySelector('.layer video');
    if (v) { v.volume = state.mediaVolume; }
  }

  /** Estado de energia vindo do servidor (gerenciador ou horário de funcionamento). */
  function applyPower(p) {
    state.lastPower = p;
    if (p.state === 'off') {
      // atualiza no app o horário para religar sozinho (funciona mesmo sem rede)
      nativeCall('setPower', false, p.next_on_ms || 0);
      if (!state.poweredOff) {
        state.poweredOff = true;
        state.reportSoon = true;
        log('energia: espera —', p.reason);
        stopAll();
        show('standby');
        state.playbackState = 'standby';
        state.currentContent = null;
      }
    } else if (state.poweredOff) {
      state.poweredOff = false;
      state.reportSoon = true;
      log('energia: ligada —', p.reason);
      nativeCall('setPower', true, 0);
      if (state.config) { applyConfig(state.config); } else { boot(); }
    }
  }

  function displayReport() {
    var r = {};
    var k;
    for (k in state.display) { if (state.display.hasOwnProperty(k)) { r[k] = state.display[k]; } }
    r.power = state.poweredOff ? 'off' : 'on';
    var vol = nativeCall('getVolume');
    if (typeof vol === 'number' && vol >= 0) { r.volume = vol; }
    var ctl = nativeCall('getPowerControl');
    if (ctl) { r.power_control = ctl; }
    var setupStatus = nativeCall('getSetupStatus');
    if (setupStatus) { r.setup = String(setupStatus); }
    var upd = nativeCall('getUpdateStatus');
    if (upd) { r.update = String(upd); }
    var camStatus = nativeCall('getCameraStatus');
    if (camStatus) { r.cameras = String(camStatus); }
    return r;
  }

  // ---------------------------------------------------------------- mensagens / relógio

  var clockTimer = null;
  function showMessage(title, text) {
    $('message-title').textContent = title;
    $('message-text').textContent = text || '';
    show('message');
    var tick = function () {
      var d = new Date();
      $('message-clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    };
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 10000);
  }

  // ---------------------------------------------------------------- ativação

  var activationTimer = null;

  function startActivation() {
    stopAll();
    state.token = null;
    state.config = null;
    show('activation');
    $('activation-host').textContent = location.host;
    var saved = null;
    try { saved = JSON.parse(lsGet(LS_PAIRING) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.expiresAt > Date.now()) {
      displayCode(saved);
      pollActivation(saved);
    } else {
      requestCode();
    }
  }

  function displayCode(p) {
    $('activation-code').textContent = p.code.slice(0, 3) + ' ' + p.code.slice(3);
    $('activation-status').textContent = 'Aguardando ativação no painel…';
  }

  function requestCode() {
    clearTimeout(activationTimer);
    $('activation-status').textContent = 'Gerando código…';
    request('POST', '/activation-codes', { player_version: PLAYER_VERSION }).then(function (data) {
      var p = {
        code: data.code,
        secret: data.pairing_secret,
        expiresAt: Date.now() + data.expires_in * 1000,
        poll: data.poll_interval || 5
      };
      lsSet(LS_PAIRING, JSON.stringify(p));
      displayCode(p);
      pollActivation(p);
    }).catch(function (err) {
      var wait = err && err.status === 429 ? 60 : 15;
      $('activation-status').textContent = 'Sem comunicação com o servidor. Nova tentativa em ' + wait + 's.';
      activationTimer = setTimeout(requestCode, wait * 1000);
    });
  }

  function pollActivation(p) {
    clearTimeout(activationTimer);
    activationTimer = setTimeout(function () {
      if (Date.now() > p.expiresAt) { lsDel(LS_PAIRING); requestCode(); return; }
      request('POST', '/activation-codes/poll', { code: p.code, pairing_secret: p.secret }).then(function (data) {
        if (data.status === 'activated') {
          lsDel(LS_PAIRING);
          state.token = data.token;
          lsSet(LS_TOKEN, data.token);
          shareCredentials();
          $('activation-status').textContent = 'TV ativada: ' + data.screen.name;
          setTimeout(boot, 800);
        } else {
          pollActivation(p);
        }
      }).catch(function (err) {
        if (err && (err.status === 410 || err.status === 404)) {
          lsDel(LS_PAIRING);
          requestCode();
        } else {
          $('activation-status').textContent = 'Sem conexão. Tentando novamente…';
          pollActivation(p);
        }
      });
    }, p.poll * 1000);
  }

  // ---------------------------------------------------------------- reprodução de mídia

  var media = {
    playlist: null,
    index: -1,
    timer: null,
    stallTimer: null,
    activeLayer: null,
    consecutiveFailures: 0,
    generation: 0
  };

  function layers() { return [$('layer-a'), $('layer-b')]; }

  function stopMedia() {
    media.generation += 1;
    clearTimeout(media.timer);
    clearInterval(media.stallTimer);
    layers().forEach(function (l) {
      var v = l.querySelector('video');
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
      l.innerHTML = '';
      l.classList.remove('visible');
    });
    media.activeLayer = null;
    media.playlist = null;
  }

  function startMedia(playlist) {
    stopMedia();
    media.playlist = playlist;
    media.index = -1;
    media.consecutiveFailures = 0;
    var stage = $('stage');
    stage.className = 'stage fit-' + (playlist.fit_mode || 'contain');
    show('stage');
    next();
  }

  function next() {
    var pl = media.playlist;
    if (!pl || !pl.items.length) { return; }
    // troca de playlist sempre na fronteira entre itens: nunca interrompe um conteúdo
    if (state.pendingReady) {
      var cfg = state.pendingReady;
      state.pendingReady = null;
      applyConfig(cfg);
      return;
    }
    if (media.consecutiveFailures >= pl.items.length) {
      state.playbackState = 'error';
      showMessage('Falha na reprodução', 'Nenhum conteúdo pôde ser exibido. Nova tentativa em 30 segundos.');
      var gen = media.generation;
      media.timer = setTimeout(function () {
        if (gen !== media.generation) { return; }
        media.consecutiveFailures = 0;
        show('stage');
        next();
      }, 30000);
      return;
    }
    media.index = (media.index + 1) % pl.items.length;
    playItem(pl.items[media.index], pl);
  }

  function swapIn(el, pl) {
    var ls = layers();
    var target = media.activeLayer === ls[0] ? ls[1] : ls[0];
    var previous = media.activeLayer;
    target.innerHTML = '';
    target.appendChild(el);
    var fade = pl.transition === 'fade';
    ls.forEach(function (l) { l.classList.toggle('no-transition', !fade); });
    // força o navegador a aplicar o estado inicial antes da transição
    void target.offsetWidth;
    target.classList.add('visible');
    if (previous) {
      previous.classList.remove('visible');
      var gen = media.generation;
      setTimeout(function () {
        if (gen !== media.generation || media.activeLayer === previous) { return; }
        var v = previous.querySelector('video');
        if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
        previous.innerHTML = '';
      }, fade ? 900 : 50);
    }
    media.activeLayer = target;
  }

  function itemFailed(item, reason) {
    media.consecutiveFailures += 1;
    setError('Falha ao reproduzir "' + item.name + '": ' + reason);
    clearTimeout(media.timer);
    clearInterval(media.stallTimer);
    var gen = media.generation;
    media.timer = setTimeout(function () { if (gen === media.generation) { next(); } }, MIN_ITEM_MS);
  }

  function playItem(item, pl) {
    var gen = media.generation;
    clearTimeout(media.timer);
    clearInterval(media.stallTimer);
    MediaCache.playbackUrl(item).then(function (url) {
      if (gen !== media.generation) { return; }
      if (item.kind === 'image') { playImage(item, url, pl, gen); } else { playVideo(item, url, pl, gen); }
    }).catch(function (err) { itemFailed(item, String(err)); });
  }

  function playImage(item, url, pl, gen) {
    var img = new Image();
    img.alt = '';
    var started = false;
    var begin = function () {
      if (started || gen !== media.generation) { return; }
      started = true;
      swapIn(img, pl);
      markPlaying(item);
      var secs = item.duration || pl.default_image_seconds || 10;
      media.timer = setTimeout(function () { if (gen === media.generation) { next(); } },
        Math.max(MIN_ITEM_MS, secs * 1000));
    };
    img.onerror = function () { if (!started) { started = true; itemFailed(item, 'imagem inválida'); } };
    img.src = url;
    if (img.decode) {
      img.decode().then(begin, function () {
        // decode() pode falhar em alguns navegadores mesmo com imagem válida
        if (img.complete && img.naturalWidth) { begin(); } else { img.onload = begin; }
      });
    } else {
      img.onload = begin;
    }
  }

  function playVideo(item, url, pl, gen) {
    var v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.controls = false;
    v.disablePictureInPicture = true;
    v.muted = false;
    v.volume = state.mediaVolume;
    var started = false;
    var lastTime = -1;
    var stalledFor = 0;

    var finish = function () {
      if (gen !== media.generation) { return; }
      clearInterval(media.stallTimer);
      clearTimeout(media.timer);
      next();
    };
    v.onended = finish;
    v.onerror = function () {
      if (gen !== media.generation) { return; }
      var code = v.error ? v.error.code : '?';
      itemFailed(item, 'erro de vídeo (código ' + code + ')');
    };
    v.onplaying = function () {
      if (started || gen !== media.generation) { return; }
      started = true;
      swapIn(v, pl);
      markPlaying(item);
      if (item.max_duration) {
        media.timer = setTimeout(finish, item.max_duration * 1000);
      }
      // watchdog: vídeo travado por muito tempo -> próximo item
      media.stallTimer = setInterval(function () {
        if (gen !== media.generation) { clearInterval(media.stallTimer); return; }
        if (v.paused && !v.ended) { v.play().catch(function () { /* ignora */ }); }
        if (v.currentTime === lastTime) {
          stalledFor += 1;
          if (stalledFor >= VIDEO_STALL_SECONDS) { itemFailed(item, 'vídeo travado'); }
        } else {
          stalledFor = 0;
          lastTime = v.currentTime;
        }
      }, 1000);
    };
    v.src = url;
    var tryPlay = function () {
      var p = v.play();
      if (p && p.catch) {
        p.catch(function () {
          // autoplay com som bloqueado pelo navegador: reproduz sem som
          if (gen !== media.generation) { return; }
          v.muted = true;
          v.play().catch(function (err) { itemFailed(item, 'autoplay bloqueado: ' + err); });
        });
      }
    };
    tryPlay();
    // se não começar em 30s, desiste deste item
    media.timer = setTimeout(function () {
      if (!started && gen === media.generation) { itemFailed(item, 'vídeo não iniciou'); }
    }, 30000);
  }

  function markPlaying(item) {
    media.consecutiveFailures = 0;
    state.playbackState = state.online ? 'playing' : 'offline_cache';
    state.currentContent = item.name;
    if (state.lastError && state.lastError.indexOf(item.name) >= 0) { setError(null); }
  }

  // ---------------------------------------------------------------- dashboards

  var dashboard = new DashboardPlayer($('dashboard'), {
    isOnline: function () { return state.online; },
    onState: function (s, detail) {
      if (s === 'playing') {
        state.playbackState = 'playing';
        state.currentContent = detail;
        setError(null);
      } else if (s === 'error') {
        state.playbackState = 'error';
        setError(detail);
      } else {
        state.playbackState = s;
        state.currentContent = detail;
      }
    }
  });
  var fullReloadTimer = null;

  // ---------------------------------------------------------------- CFTV (câmeras)

  /** As câmeras (RTSP) são reproduzidas pelo app, direto da rede local, por cima desta página. */
  function startCameras(cfg) {
    var cams = cfg.cameras;
    state.currentContent = 'Câmeras: ' + cams.items.map(function (c) { return c.name; }).join(', ').slice(0, 200);
    if (NATIVE && typeof NATIVE.showCameras === 'function') {
      var d = displaySettings();
      var payload = {
        layout: cams.layout, slots: cams.slots, cycle_seconds: cams.cycle_seconds, items: cams.items,
        rotation: d.rotation || 0, safe_margin_percent: d.safe_margin_percent || 0
      };
      show('stage');
      nativeCall('showCameras', JSON.stringify(payload));
      state.playbackState = 'playing';
    } else {
      state.playbackState = 'error';
      setError('CFTV requer o app UpDown Digital (o navegador não reproduz RTSP)');
      showMessage('Câmeras (CFTV)', 'Esta TV precisa do app UpDown Digital para exibir as câmeras.');
    }
  }

  // ---------------------------------------------------------------- configuração

  function stopAll() {
    nativeCall('hideCameras');
    stopMedia();
    dashboard.stop();
    clearTimeout(fullReloadTimer);
    clearInterval(clockTimer);
  }

  function playlistShas(cfg) {
    if (!cfg || !cfg.playlist) { return []; }
    return cfg.playlist.items.map(function (i) { return i.sha256; });
  }

  function applyConfig(cfg) {
    var previous = state.config;
    state.config = cfg;
    lsSet(LS_CONFIG, JSON.stringify(cfg));
    stopAll();
    if (cfg.display) { lsSet(LS_DISPLAY, JSON.stringify(cfg.display)); }
    applyDisplay();
    applyAudio(cfg.audio);
    if (state.poweredOff) {
      // em espera: guarda a configuração, mas não reproduz nada até a TV ser ligada
      show('standby');
      state.playbackState = 'standby';
      renderInfo();
      return;
    }
    if (cfg.mode === 'media') {
      startMedia(cfg.playlist);
      MediaCache.releaseUnused(playlistShas(cfg));
    } else if (cfg.mode === 'dashboard') {
      show('dashboard');
      dashboard.start(cfg.dashboard);
      var hours = cfg.dashboard.full_reload_hours || 12;
      // recarga completa periódica: evita vazamentos de memória de páginas de BI
      fullReloadTimer = setTimeout(function () { if (state.online) { location.reload(); } }, hours * 3600 * 1000);
    } else if (cfg.mode === 'cameras') {
      startCameras(cfg);
    } else if (cfg.mode === 'disabled') {
      state.playbackState = 'idle';
      showMessage('TV desativada', cfg.screen.name);
    } else {
      state.playbackState = 'idle';
      state.currentContent = null;
      showMessage(cfg.screen.name, 'Nenhum conteúdo programado para esta TV.');
    }
    // mantém no cache apenas o que a configuração atual usa
    if (cfg.mode !== 'media' || (previous && previous.config_hash !== cfg.config_hash)) {
      MediaCache.prune(playlistShas(cfg)).then(function (n) { if (n) { log('cache: removidos', n); } });
    }
    // informa o painel logo após aplicar a nova configuração
    if (state.token && previous && previous.config_hash !== cfg.config_hash) { scheduleHeartbeat(3); }
    renderInfo();
  }

  /** Busca a configuração e, se mudou, prepara a troca sem interromper a reprodução. */
  function sync(force) {
    if (state.syncing) { return Promise.resolve(); }
    state.syncing = true;
    return request('GET', '/config').then(function (cfg) {
      setOnline(true);
      var running = state.config;
      if (!force && running && running.config_hash === cfg.config_hash) { return null; }
      if (cfg.mode !== 'media') {
        applyConfig(cfg);
        return null;
      }
      // baixa tudo antes de trocar; libera espaço de arquivos que não serão mais usados
      var keep = playlistShas(running).concat(playlistShas(cfg));
      state.playbackState = running ? state.playbackState : 'loading';
      if (!running || running.mode !== 'media') { showMessage(cfg.screen.name, 'Baixando conteúdo…'); }
      return MediaCache.prune(keep).then(function () {
        return MediaCache.ensureAll(cfg.playlist.items, function (done, total) {
          state.downloadProgress = done + '/' + total;
          if (!running || running.mode !== 'media') {
            $('message-text').textContent = 'Baixando conteúdo… ' + done + ' de ' + total;
          }
        });
      }).then(function (result) {
        state.downloadProgress = null;
        if (!result.ok) {
          var names = result.failures.map(function (f) { return f.name + ' (' + f.error + ')'; }).join('; ');
          setError('Falha no download: ' + names);
          // sem playlist anterior válida, reproduz o que estiver disponível
          if (!running || running.mode !== 'media') { applyConfig(cfg); }
          return null;
        }
        if (running && running.mode === 'media' && media.playlist && !force) {
          state.pendingReady = cfg; // aplica ao final do item atual
        } else {
          applyConfig(cfg);
        }
        return null;
      });
    }).catch(function (err) {
      handleAuthError(err);
      if (!(err instanceof HttpError)) { setOnline(false); }
      throw err;
    }).then(function () { state.syncing = false; }, function (err) { state.syncing = false; throw err; });
  }

  function handleAuthError(err) {
    if (!(err instanceof HttpError)) { return false; }
    if (err.status === 401) {
      // token revogado/expirado: volta para a ativação
      lsDel(LS_TOKEN);
      lsDel(LS_CONFIG);
      MediaCache.clear();
      startActivation();
      return true;
    }
    if (err.status === 403) {
      stopAll();
      state.playbackState = 'idle';
      showMessage('TV desativada', 'Esta TV foi desativada no painel administrativo.');
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- heartbeat e comandos

  function scheduleHeartbeat(delaySec) {
    clearTimeout(state.heartbeatTimer);
    state.heartbeatTimer = setTimeout(heartbeat, (delaySec || state.heartbeatInterval) * 1000);
  }

  function heartbeat() {
    if (!state.token) { return; }
    if (NATIVE) {
      try { NATIVE.ping(); } catch (e) { /* ignora */ }
    }
    MediaCache.estimate().then(function (storage) {
      var body = {
        player_version: PLAYER_VERSION,
        playback_state: state.playbackState,
        connection_state: state.failedHeartbeats ? 'degraded' : 'online',
        current_content: state.currentContent,
        config_hash: state.config ? state.config.config_hash : null,
        error: state.lastError,
        storage: storage,
        display: displayReport()
      };
      if (state.downloadProgress) { body.storage = Object.assign({}, storage || {}, { downloading: state.downloadProgress }); }
      return request('POST', '/heartbeat', body);
    }).then(function (resp) {
      state.failedHeartbeats = 0;
      state.lastHeartbeatAt = new Date();
      setOnline(true);
      if (state.playbackState === 'offline_cache') { state.playbackState = 'playing'; }
      if (resp.heartbeat_interval) { state.heartbeatInterval = resp.heartbeat_interval; }
      if (resp.new_token) {
        // renovação: o novo token passa a valer no primeiro uso
        state.token = resp.new_token;
        lsSet(LS_TOKEN, resp.new_token);
        shareCredentials();
      }
      if (resp.power) { applyPower(resp.power); }
      var cmds = resp.commands || [];
      cmds.forEach(runCommand);
      var hash = state.config ? state.config.config_hash : null;
      var pendingHash = state.pendingReady ? state.pendingReady.config_hash : null;
      if (resp.config_hash !== hash && resp.config_hash !== pendingHash) {
        sync(false).catch(function () { /* tratado em sync */ });
      }
      // confirma logo ao painel quando a TV liga ou entra em espera
      scheduleHeartbeat(state.reportSoon ? 3 : undefined);
      state.reportSoon = false;
    }).catch(function (err) {
      if (handleAuthError(err)) { return; }
      state.failedHeartbeats += 1;
      if (!(err instanceof HttpError) || err.status >= 500) {
        setOnline(false);
        if (state.playbackState === 'playing') { state.playbackState = 'offline_cache'; }
      }
      // espera progressiva até 2 minutos
      scheduleHeartbeat(Math.min(state.heartbeatInterval * Math.pow(2, Math.min(state.failedHeartbeats, 3)), 120));
    }).then(renderInfo);
  }

  function ack(cmd, success, result) {
    return request('POST', '/commands/' + cmd.id + '/ack', { success: success, result: result || null })
      .catch(function (e) { log('falha no ack', e); });
  }

  function runCommand(cmd) {
    log('comando remoto:', cmd.command);
    switch (cmd.command) {
      case 'reload_config':
      case 'refresh_content':
        sync(true).then(function () { ack(cmd, true, 'configuração recarregada'); },
          function (e) { ack(cmd, false, String(e && e.message)); });
        break;
      case 'restart_playback':
        if (state.config) { applyConfig(state.config); }
        ack(cmd, true, 'reprodução reiniciada');
        break;
      case 'reload_page':
        ack(cmd, true, 'recarregando página').then(function () { location.reload(); });
        break;
      case 'update_app':
        if (NATIVE && typeof NATIVE.checkUpdate === 'function') {
          ack(cmd, true, nativeCall('checkUpdate') + ' (resultado aparece nos detalhes da TV)');
        } else {
          ack(cmd, false, 'disponível apenas no app UpDown Digital');
        }
        break;
      case 'app_setup':
        if (NATIVE && typeof NATIVE.runSetup === 'function') {
          nativeCall('runSetup');
          ack(cmd, true, 'assistente aberto na TV');
        } else {
          ack(cmd, false, 'disponível apenas no app UpDown Digital');
        }
        break;
      case 'identify':
        showIdentify(30);
        ack(cmd, true, displaySummary());
        break;
      case 'clear_cache':
        MediaCache.clear().then(function () {
          return ack(cmd, true, 'cache limpo');
        }).then(function () { location.reload(); });
        break;
      default:
        ack(cmd, false, 'comando desconhecido');
    }
  }

  // ---------------------------------------------------------------- info / tela cheia / energia

  function renderInfo() {
    var el = $('info');
    if (el.classList.contains('hidden')) { return; }
    var cfg = state.config;
    el.textContent = [
      'UpDown Digital — player ' + PLAYER_VERSION,
      'TV: ' + (cfg ? cfg.screen.identifier + ' — ' + cfg.screen.name : '(não ativada)'),
      'Perfil: ' + (cfg ? cfg.screen.profile : '-') + '  modo: ' + (cfg ? cfg.mode : '-'),
      'Estado: ' + state.playbackState + (state.currentContent ? ' — ' + state.currentContent : ''),
      'Servidor: ' + location.host + '  ' + (state.online ? 'online' : 'SEM CONEXÃO'),
      'Último heartbeat: ' + (state.lastHeartbeatAt ? state.lastHeartbeatAt.toLocaleTimeString() : '-'),
      'Config: ' + (cfg ? cfg.config_hash.slice(0, 12) : '-') + (state.downloadProgress ? '  baixando ' + state.downloadProgress : ''),
      'Tela: ' + displaySummary(),
      'Service worker: ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'ativo' : 'inativo'),
      state.lastError ? 'Erro: ' + state.lastError : ''
    ].join('\n');
  }

  function requestFullscreen() {
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn && !document.fullscreenElement && !document.webkitFullscreenElement) {
      try { fn.call(el); } catch (e) { /* ignora */ }
    }
    $('fullscreen-hint').classList.add('hidden');
  }

  var wakeLock = null;
  function keepAwake() {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { /* ignora */ });
    }
  }

  function setupUi() {
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'Enter' || k === ' ' || e.keyCode === 23) { requestFullscreen(); }
      if (k === 'i' || k === 'I' || k === 'Info' || k === 'ContextMenu' || e.keyCode === 82 || e.keyCode === 457) {
        $('info').classList.toggle('hidden');
        renderInfo();
      }
    });
    document.addEventListener('click', requestFullscreen);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { keepAwake(); }
    });
    if (!document.fullscreenElement && (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
      var standalone = window.matchMedia && window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
      if (!standalone && !NATIVE && displaySettings().fullscreen !== false) {
        $('fullscreen-hint').classList.remove('hidden');
        setTimeout(function () { $('fullscreen-hint').classList.add('hidden'); }, 15000);
      }
    }
    window.addEventListener('online', function () { scheduleHeartbeat(1); });
    var resizeTimer = null;
    var onResize = function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyDisplay, 200); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    applyDisplay();
    window.addEventListener('offline', function () { setOnline(false); });
    // erro inesperado de script: registra para aparecer no painel (heartbeat)
    window.addEventListener('error', function (e) {
      setError('erro de script: ' + (e.message || e));
    });
    keepAwake();
    setInterval(renderInfo, 5000);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) { return Promise.resolve(); }
    return navigator.serviceWorker.register('/player/sw.js', { scope: '/player/' }).then(function (reg) {
      if (navigator.serviceWorker.controller) { return; }
      // primeira instalação: aguarda o SW assumir para servir o cache de mídia
      return new Promise(function (resolve) {
        var done = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () { if (!done) { done = true; resolve(); } });
        setTimeout(function () { if (!done) { done = true; resolve(); } }, 4000);
      });
    }).catch(function (e) { log('service worker indisponível', e); });
  }

  // ---------------------------------------------------------------- inicialização

  function boot() {
    state.token = lsGet(LS_TOKEN);
    if (!state.token) { startActivation(); return; }
    shareCredentials();
    var stored = null;
    try { stored = JSON.parse(lsGet(LS_CONFIG) || 'null'); } catch (e) { stored = null; }

    sync(true).catch(function (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) { return; }
      // sem servidor: reproduz a última configuração válida a partir do cache
      if (stored && !state.config) {
        log('servidor indisponível; usando configuração salva');
        applyConfig(stored);
        state.playbackState = 'offline_cache';
      } else if (!state.config) {
        showMessage('Sem conexão com o servidor', 'Nova tentativa em instantes…');
        setTimeout(boot, 20000);
      }
    }).then(function () {
      if (state.token) { scheduleHeartbeat(2); }
    });
  }

  // chamado pelo app Android ao acender a tela (horário ou "Ligar agora")
  window.__udsWake = function () { scheduleHeartbeat(1); };

  setupUi();
  MediaCache.requestPersistence();
  registerServiceWorker().then(boot);
})();
