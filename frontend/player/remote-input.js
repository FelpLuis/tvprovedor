/*
 * UpDown Digital — reprodução de mouse/teclado dentro de uma página (controle ao vivo).
 *
 * Usado pela TV (eventos vindos do gerenciador) e pelo espelho no gerenciador, para que as duas
 * telas reajam igual. As coordenadas chegam normalizadas (0..1) e são convertidas para o tamanho
 * da página em cada lado. Funciona em páginas da mesma origem (dashboards abertos pelo proxy).
 */
(function (global) {
  'use strict';

  function clamp01(v) { v = Number(v); return isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }

  function RemoteInput(getFrame) {
    this.getFrame = getFrame;
    this.target = null;   // alvo do arrasto (simula a "captura" do ponteiro)
    this.over = null;     // elemento sob o ponteiro (hover)
    this.downAt = null;
  }

  RemoteInput.prototype._ctx = function () {
    var f = this.getFrame();
    if (!f) { return null; }
    try {
      var win = f.contentWindow, doc = f.contentDocument;
      if (!win || !doc || !doc.documentElement) { return null; }
      return { win: win, doc: doc };
    } catch (e) {
      return null;  // página fora do proxy (outra origem)
    }
  };

  RemoteInput.prototype.apply = function (m) {
    var c = this._ctx();
    if (!c || !m) { return false; }
    if (m.k === 'key') { return this._key(c.win, c.doc, m); }
    var win = c.win, doc = c.doc;
    var x = clamp01(m.x) * win.innerWidth, y = clamp01(m.y) * win.innerHeight;
    var el = doc.elementFromPoint(x, y) || doc.body;
    if (!el) { return false; }
    var opts = {
      bubbles: true, cancelable: true, composed: true, view: win,
      clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y,
      button: m.b || 0, buttons: m.bs || 0,
      ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, metaKey: !!m.meta,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: m.bs ? 0.5 : 0
    };
    var P = win.PointerEvent || win.MouseEvent, M = win.MouseEvent;
    var fire = function (t, type, C, o) {
      try { return t.dispatchEvent(new C(type, o || opts)); } catch (e) { return true; }
    };
    var self = this;
    var hover = function (to) {
      if (to === self.over) { return; }
      if (self.over && self.over.isConnected) {
        fire(self.over, 'pointerout', P); fire(self.over, 'mouseout', M);
        fire(self.over, 'pointerleave', P); fire(self.over, 'mouseleave', M);
      }
      if (to) {
        fire(to, 'pointerover', P); fire(to, 'mouseover', M);
        fire(to, 'pointerenter', P); fire(to, 'mouseenter', M);
      }
      self.over = to;
    };

    if (m.k === 'move') {
      var t = this.target && this.target.isConnected ? this.target : el;
      if (!this.target) { hover(el); }
      fire(t, 'pointermove', P); fire(t, 'mousemove', M);
    } else if (m.k === 'down') {
      hover(el);
      this.target = el;
      this.downAt = [x, y];
      if (fire(el, 'pointerdown', P)) { fire(el, 'mousedown', M); }
      var focusable = el.closest && el.closest('input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable=true]');
      if (focusable && focusable.focus) { try { focusable.focus(); } catch (e) { /* ignora */ } }
    } else if (m.k === 'up') {
      var t2 = this.target && this.target.isConnected ? this.target : el;
      fire(t2, 'pointerup', P); fire(t2, 'mouseup', M);
      var moved = this.downAt ? Math.abs(x - this.downAt[0]) + Math.abs(y - this.downAt[1]) : 99;
      if (moved < 8) {
        if ((m.b || 0) === 0) { fire(t2, 'click', M); }
        if (m.b === 2) { fire(t2, 'contextmenu', M); }
      }
      this.target = null;
      this.downAt = null;
    } else if (m.k === 'dbl') {
      fire(el, 'dblclick', M);
    } else if (m.k === 'leave') {
      hover(null);
    } else if (m.k === 'wheel') {
      var wo = {};
      for (var k in opts) { if (opts.hasOwnProperty(k)) { wo[k] = opts[k]; } }
      wo.deltaX = Number(m.dx) || 0; wo.deltaY = Number(m.dy) || 0; wo.deltaMode = 0;
      var W = win.WheelEvent || M;
      if (fire(el, 'wheel', W, wo)) {
        // ninguém tratou a rolagem: rola o primeiro elemento rolável (ou a página)
        for (var s = el; s && s !== doc.documentElement; s = s.parentElement) {
          var cs = win.getComputedStyle(s);
          if ((s.scrollHeight > s.clientHeight + 2 && /(auto|scroll)/.test(cs.overflowY)) ||
              (s.scrollWidth > s.clientWidth + 2 && /(auto|scroll)/.test(cs.overflowX))) {
            s.scrollBy(wo.deltaX, wo.deltaY);
            return true;
          }
        }
        win.scrollBy(wo.deltaX, wo.deltaY);
      }
    }
    return true;
  };

  RemoteInput.prototype._key = function (win, doc, m) {
    var t = doc.activeElement || doc.body;
    if (!t) { return false; }
    var o = {
      key: String(m.key || '').slice(0, 32), code: String(m.code || '').slice(0, 32),
      bubbles: true, cancelable: true, composed: true, view: win,
      ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, metaKey: !!m.meta
    };
    var K = win.KeyboardEvent;
    if (m.kd === 'up') {
      try { t.dispatchEvent(new K('keyup', o)); } catch (e) { /* ignora */ }
      return true;
    }
    var allowed = true;
    try { allowed = t.dispatchEvent(new K('keydown', o)); } catch (e) { /* ignora */ }
    if (!allowed) { return true; }
    var editable = t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName);
    if (!editable) { return true; }
    var key = o.key;
    try {
      if (key.length === 1 && !o.ctrlKey && !o.metaKey) {
        if (!doc.execCommand || !doc.execCommand('insertText', false, key)) {
          t.value = (t.value || '') + key;
          t.dispatchEvent(new win.Event('input', { bubbles: true }));
        }
      } else if (key === 'Backspace') {
        if (!doc.execCommand || !doc.execCommand('delete', false)) {
          t.value = String(t.value || '').slice(0, -1);
          t.dispatchEvent(new win.Event('input', { bubbles: true }));
        }
      } else if (key === 'Enter' && t.tagName === 'INPUT' && t.form) {
        if (t.form.requestSubmit) { t.form.requestSubmit(); } else { t.form.submit(); }
      }
    } catch (e) { /* ignora */ }
    return true;
  };

  global.UdsRemoteInput = RemoteInput;
})(window);
