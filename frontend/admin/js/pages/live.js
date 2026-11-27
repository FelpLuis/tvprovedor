// Controle ao vivo: espelho do dashboard da TV + mouse/teclado repassados para a TV em tempo real.
import { get, post } from '../api.js';
import { h, clear, btn, toast, toastError } from '../ui.js';

function loadRemoteInput() {
  if (window.UdsRemoteInput) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/player/remote-input.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('não foi possível carregar o módulo de controle'));
    document.head.appendChild(s);
  });
}

export async function render(root, params = []) {
  await loadRemoteInput();
  const screens = (await get('/screens')).filter((s) => s.activated);
  let screenId = Number(params[0]) || (screens.find((s) => s.profile !== 'MEDIA_PLAYER') || screens[0] || {}).id;

  const sel = h('select', { style: 'max-width:340px', onchange: () => { location.hash = `#/ao-vivo/${sel.value}`; } },
    screens.map((s) => h('option', { value: s.id, selected: s.id === screenId }, `${s.identifier} — ${s.name}`)));
  const tvBadge = h('span', { class: 'badge' }, 'conectando…');
  const contentInfo = h('span', { class: 'muted small' });
  const hint = h('div', { class: 'alert info', style: 'margin-bottom:12px' }, 'Conectando ao servidor…');
  const stage = h('div', { class: 'live-stage' });
  const mirror = h('iframe', { class: 'live-mirror', title: 'Espelho da TV', referrerpolicy: 'no-referrer-when-downgrade' });
  const overlay = h('div', { class: 'live-overlay', tabindex: '0', title: 'Clique para controlar. Teclado: clique aqui e digite.' });
  stage.append(mirror, overlay);

  let ws = null;
  let closed = false;
  let status = null;
  let logical = [1920, 1080];
  let retry = null;
  const remote = new window.UdsRemoteInput(() => mirror);

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function layout() {
    const w = stage.clientWidth || 800;
    const scale = w / logical[0];
    stage.style.height = `${Math.round(logical[1] * scale)}px`;
    mirror.style.width = `${logical[0]}px`;
    mirror.style.height = `${logical[1]}px`;
    mirror.style.transform = `scale(${scale})`;
  }

  const reloadTv = async () => {
    try {
      await post(`/screens/${screenId}/commands`, { command: 'reload_page' });
      toast('Pedido enviado: a TV recarrega o player em até 30 segundos e conecta ao controle ao vivo.', 'success', 7000);
    } catch (e) { toastError(e); }
  };

  function setTv(online) {
    tvBadge.className = `badge ${online ? 'success' : 'danger'}`;
    tvBadge.textContent = online ? 'TV conectada' : 'TV desconectada';
    if (!online) {
      hint.className = 'alert warning';
      clear(hint,
        h('div', null, h('b', null, 'A TV não está conectada ao controle ao vivo. '),
          'Se ela está ligada e exibindo conteúdo, provavelmente ainda roda o player antigo (de antes da atualização do servidor). ',
          'Recarregue o player da TV uma vez — a partir daí ela se atualiza sozinha. ',
          'Se a TV estiver desligada ou sem internet, ela conecta assim que voltar.'),
        h('div', { style: 'margin-top:8px' }, btn('Recarregar player da TV', reloadTv, { cls: 'sm primary', ico: 'refresh' })));
    }
  }

  function applyStatus(st) {
    status = st;
    const size = Array.isArray(st.page) && st.page[0] > 0 ? st.page : st.logical;
    if (Array.isArray(size) && size[0] > 0) { logical = size; layout(); }
    contentInfo.textContent = st.content ? `Exibindo: ${st.content}` : '';
    const ok = st.mode === 'dashboard' && st.dashboard && st.dashboard.proxied && st.proxy_path;
    if (!ok) {
      hint.className = 'alert warning';
      hint.textContent = st.mode === 'dashboard'
        ? 'O controle ao vivo funciona com dashboards no modo "Dentro do player (proxy)". Altere o modo de exibição deste dashboard.'
        : 'Esta TV não está exibindo um dashboard agora. Programe um dashboard (modo "Dentro do player") para controlar pelo mouse.';
      return;
    }
    hint.className = 'alert info';
    clear(hint);
    hint.textContent = 'Use o mouse sobre a imagem: clicar, arrastar (girar o 3D), rolar (zoom) e digitar. A TV repete cada movimento. ' +
      'Se as telas ficarem diferentes, use "Sincronizar".';
    if (!mirror.dataset.src || mirror.dataset.dash !== String(st.dashboard.id)) {
      mirror.dataset.src = st.proxy_path;
      mirror.dataset.dash = String(st.dashboard.id);
      mirror.src = st.proxy_path;
    }
  }

  function connect() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(`${proto}${location.host}/api/screens/${screenId}/live`);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'tv') setTv(m.online);
      else if (m.t === 'status') { setTv(true); applyStatus(m); }
    };
    ws.onclose = (ev) => {
      if (closed) return;
      setTv(false);
      if (ev.code === 4403) { tvBadge.textContent = 'sem permissão'; return; }
      retry = setTimeout(connect, 3000);
    };
  }

  // ------------------------------------------------------------ eventos do mouse/teclado
  const norm = (ev) => {
    const r = overlay.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  };
  const mods = (ev) => ({ ctrl: ev.ctrlKey, shift: ev.shiftKey, alt: ev.altKey, meta: ev.metaKey });
  const emit = (e) => { send({ t: 'input', e }); remote.apply(e); };

  let pendingMove = null;
  let raf = 0;
  overlay.addEventListener('pointerdown', (ev) => {
    overlay.focus();
    overlay.setPointerCapture(ev.pointerId);
    emit({ k: 'down', ...norm(ev), b: ev.button, bs: ev.buttons, ...mods(ev) });
    ev.preventDefault();
  });
  overlay.addEventListener('pointermove', (ev) => {
    pendingMove = { k: 'move', ...norm(ev), b: ev.button, bs: ev.buttons, ...mods(ev) };
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pendingMove) { emit(pendingMove); pendingMove = null; } });
  });
  overlay.addEventListener('pointerup', (ev) => {
    if (pendingMove) { emit(pendingMove); pendingMove = null; }
    emit({ k: 'up', ...norm(ev), b: ev.button, bs: ev.buttons, ...mods(ev) });
  });
  overlay.addEventListener('pointerleave', () => emit({ k: 'leave', x: 0, y: 0 }));
  overlay.addEventListener('dblclick', (ev) => emit({ k: 'dbl', ...norm(ev), ...mods(ev) }));
  overlay.addEventListener('contextmenu', (ev) => ev.preventDefault());
  overlay.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const f = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1;
    emit({ k: 'wheel', ...norm(ev), dx: ev.deltaX * f, dy: ev.deltaY * f, ...mods(ev) });
  }, { passive: false });
  const key = (kd) => (ev) => {
    if (ev.key === 'Tab' || (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) || /^(Arrow|Enter|Backspace|Escape|Delete|Home|End|Page| )/.test(ev.key)) ev.preventDefault();
    emit({ k: 'key', kd, key: ev.key, code: ev.code, ...mods(ev) });
  };
  overlay.addEventListener('keydown', key('down'));
  overlay.addEventListener('keyup', key('up'));

  const sync = () => {
    if (!status || !status.proxy_path) return;
    mirror.src = status.proxy_path;
    send({ t: 'reload' });
    toast('Sincronizando: as duas telas recarregam o dashboard', 'info');
  };

  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Controle ao vivo'), h('div', { class: 'grow' }),
      sel, tvBadge,
      btn('Sincronizar', sync, { ico: 'refresh', title: 'Recarrega o dashboard no espelho e na TV ao mesmo tempo' }),
      btn('Tela cheia', () => { (stage.requestFullscreen || stage.webkitRequestFullscreen || (() => {})).call(stage); }, { title: 'Usar o espelho em tela cheia' })),
    hint, h('div', { class: 'row', style: 'margin-bottom:8px' }, contentInfo), stage);

  if (!screens.length) { clear(hint, 'Nenhuma TV ativada.'); return undefined; }
  layout();
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onResize);
    if (ws) ws.close();
  };
}
