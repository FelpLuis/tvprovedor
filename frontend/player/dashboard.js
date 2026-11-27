/*
 * UpDown Digital — player de dashboards (Grafana, Power BI, Zabbix, UpDown BI).
 *
 * - Exibe a URL em um iframe de tela cheia.
 * - Atualiza periodicamente usando dois iframes: o novo carrega "por trás" e só
 *   substitui o atual quando terminar de carregar (sem tela preta).
 * - Watchdog: se a página não carregar dentro do tempo limite, tenta novamente
 *   com espera progressiva.
 * - Sem conexão, mantém a última página exibida em vez de recarregar.
 */
(function (global) {
  'use strict';

  function DashboardPlayer(container, hooks) {
    this.container = container;
    this.hooks = hooks || {};
    this.cfg = null;
    this.current = null;
    this.pending = null;
    this.refreshTimer = null;
    this.loadTimer = null;
    this.retryDelay = 10;
    this.lastLoadedAt = null;
  }

  DashboardPlayer.prototype.start = function (cfg) {
    this.stop();
    this.cfg = cfg;
    this.retryDelay = 10;
    this.container.classList.remove('hidden');
    if (cfg.display_mode === 'redirect') {
      // sites que bloqueiam iframe (X-Frame-Options/CSP): abre a página diretamente.
      // O player deixa de controlar a TV até ela retornar para /player.
      this._report('redirect', cfg.name);
      global.location.replace(cfg.url);
      return;
    }
    this._load(true);
  };

  DashboardPlayer.prototype.stop = function () {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.loadTimer);
    this.refreshTimer = this.loadTimer = null;
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
    this.current = this.pending = null;
    this.cfg = null;
  };

  DashboardPlayer.prototype.reload = function () {
    if (this.cfg) { this._load(false); }
  };

  DashboardPlayer.prototype._report = function (state, detail) {
    if (this.hooks.onState) { this.hooks.onState(state, detail); }
  };

  DashboardPlayer.prototype._isOnline = function () {
    return this.hooks.isOnline ? this.hooks.isOnline() : navigator.onLine !== false;
  };

  DashboardPlayer.prototype._scheduleRefresh = function () {
    var self = this;
    clearTimeout(this.refreshTimer);
    var secs = this.cfg && this.cfg.refresh_seconds;
    if (!secs) { return; }
    this.refreshTimer = setTimeout(function () {
      // durante o controle ao vivo não recarrega a página (perderia o que está sendo mostrado)
      if (self.hooks.holdRefresh && self.hooks.holdRefresh()) { self._scheduleRefresh(); return; }
      if (self._isOnline()) {
        self._load(false);
      } else {
        self._scheduleRefresh(); // tenta no próximo ciclo
      }
    }, secs * 1000);
  };

  DashboardPlayer.prototype._load = function (first) {
    var self = this;
    var cfg = this.cfg;
    if (!cfg) { return; }
    clearTimeout(this.loadTimer);
    if (this.pending && this.pending.parentNode) { this.pending.parentNode.removeChild(this.pending); }

    var frame = document.createElement('iframe');
    frame.setAttribute('allow', 'fullscreen; autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    frame.setAttribute('scrolling', 'no');
    this.pending = frame;
    var settled = false;

    frame.onload = function () {
      // carregamentos seguintes da mesma página (ex.: o site mandou para a tela de login):
      // avisa de novo para o login automático agir
      if (settled && self.current === frame) {
        if (self.hooks.onLoad) { self.hooks.onLoad(frame, cfg); }
        return;
      }
      if (settled || self.pending !== frame) { return; }
      settled = true;
      clearTimeout(self.loadTimer);
      var old = self.current;
      self.current = frame;
      self.pending = null;
      frame.classList.add('visible');
      if (old && old.parentNode) {
        setTimeout(function () { if (old.parentNode) { old.parentNode.removeChild(old); } }, 600);
      }
      self.retryDelay = 10;
      self.lastLoadedAt = new Date();
      self._report('playing', cfg.name);
      if (self.hooks.onLoad) { self.hooks.onLoad(frame, cfg); }
      self._scheduleRefresh();
    };

    var timeout = (cfg.load_timeout_seconds || 60) * 1000;
    this.loadTimer = setTimeout(function () {
      if (settled) { return; }
      settled = true;
      if (frame.parentNode) { frame.parentNode.removeChild(frame); }
      if (self.pending === frame) { self.pending = null; }
      self._report('error', 'Dashboard "' + cfg.name + '" não carregou em ' + (timeout / 1000) + 's');
      var wait = self.retryDelay;
      self.retryDelay = Math.min(self.retryDelay * 2, 300);
      self.refreshTimer = setTimeout(function () { self._load(false); }, wait * 1000);
    }, timeout);

    if (first) { this._report('loading', cfg.name); }
    frame.src = cfg.url; // um iframe novo sempre recarrega a página por completo
    this.container.appendChild(frame);
    this._sizeFrame(frame);
  };

  /**
   * Tamanho da página: muitas TVs informam ao navegador uma tela pequena (ex.: 960×540 com DPR 2)
   * e painéis feitos para Full HD cortam. A página é desenhada no tamanho de referência e reduzida
   * para caber (como uma imagem), igual ao que se vê num PC.
   */
  DashboardPlayer.prototype.pageSize = function () {
    var cw = this.container.clientWidth || window.innerWidth;
    var ch = this.container.clientHeight || window.innerHeight;
    var mode = (this.cfg && this.cfg.page_size) || 'auto';
    var m = /^(\d+)x(\d+)$/.exec(mode);
    if (m) {
      var w = +m[1], hh = +m[2];
      if (ch > cw) { var t = w; w = hh; hh = t; }  // TV em retrato: mesmo tamanho, em pé
      return [w, hh];
    }
    var short = Math.min(cw, ch);
    if (mode === 'native' || short >= 900) { return [cw, ch]; }
    var k = 1080 / short;  // automático: como uma tela Full HD com o formato desta TV
    return [Math.round(cw * k), Math.round(ch * k)];
  };

  DashboardPlayer.prototype._sizeFrame = function (frame) {
    var cw = this.container.clientWidth || window.innerWidth;
    var ch = this.container.clientHeight || window.innerHeight;
    var size = this.pageSize();
    if (size[0] === cw && size[1] === ch) {
      frame.style.width = frame.style.height = frame.style.transform = frame.style.left = frame.style.top = '';
      return;
    }
    var scale = Math.min(cw / size[0], ch / size[1]);
    frame.style.width = size[0] + 'px';
    frame.style.height = size[1] + 'px';
    frame.style.transformOrigin = '0 0';
    frame.style.transform = 'scale(' + scale + ')';
    frame.style.left = Math.round((cw - size[0] * scale) / 2) + 'px';
    frame.style.top = Math.round((ch - size[1] * scale) / 2) + 'px';
  };

  /** A tela mudou (orientação, resolução): reajusta as páginas abertas. */
  DashboardPlayer.prototype.resize = function () {
    if (this.current) { this._sizeFrame(this.current); }
    if (this.pending) { this._sizeFrame(this.pending); }
  };

  global.DashboardPlayer = DashboardPlayer;
})(window);
