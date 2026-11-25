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
  };

  global.DashboardPlayer = DashboardPlayer;
})(window);
