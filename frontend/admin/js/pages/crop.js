// Recorte de dashboard: escolher, clicando na página, as partes que a TV deve mostrar.
import { patch } from '../api.js';
import { h, clear, btn, modal, toast, toastError } from '../ui.js';

const ARRANGE = [
  ['grid', 'Grade (divide a tela igualmente)'],
  ['columns', 'Lado a lado (colunas)'],
  ['rows', 'Empilhado (linhas)'],
  ['original', 'Como está na página'],
];

// classes geradas por frameworks (ex.: css-1x2y3z, sc-abc123) mudam a cada versão do site
const stableClass = (c) => /^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}|^(css|sc|jsx|svelte|emotion)-/.test(c) &&
  !/^(hover|active|focus|selected|open|show|visible|uds-)/.test(c);

function unique(doc, sel) {
  try { return doc.querySelectorAll(sel).length === 1; } catch { return false; }
}

/** Seletor CSS curto e único para o elemento (id > classes estáveis > posição). */
export function selectorFor(el) {
  const doc = el.ownerDocument;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));
  const simple = (e) => {
    if (e.id && !/\d{4,}/.test(e.id) && unique(doc, `#${esc(e.id)}`)) return { sel: `#${esc(e.id)}`, done: true };
    const tag = e.tagName.toLowerCase();
    const cls = [...e.classList].filter(stableClass).slice(0, 3).map((c) => `.${esc(c)}`).join('');
    let sel = tag + cls;
    if (unique(doc, sel)) return { sel, done: true };
    const parent = e.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === e.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(e) + 1})`;
    }
    return { sel, done: false };
  };
  const parts = [];
  for (let e = el, depth = 0; e && e !== doc.documentElement && depth < 10; e = e.parentElement, depth++) {
    const s = simple(e);
    parts.unshift(s.sel);
    const full = parts.join(' > ');
    if (s.done || unique(doc, full)) return full;
  }
  return parts.join(' > ');
}

function describe(el) {
  const r = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const kind = tag === 'canvas' ? '3D/gráfico (canvas)' : tag === 'svg' ? 'gráfico (svg)' : tag;
  return `${kind} · ${Math.round(r.width)}×${Math.round(r.height)}${text ? ` · "${text}"` : ''}`;
}

export function openCropEditor(d, proxiedHref, onDone) {
  const crop = { keep: [], arrange: 'grid', background: '#0b0730', ...(d.options.crop || {}) };
  let picks = (crop.keep || []).map((sel) => ({ sel, label: sel }));
  let picking = true;
  let hoverEl = null;
  let lastPicked = null;

  const frame = h('iframe', { class: 'crop-frame', title: 'Página do dashboard' });
  const list = h('div', { class: 'crop-list' });
  const arrangeSel = h('select', null, ARRANGE.map(([v, l]) => h('option', { value: v, selected: v === crop.arrange }, l)));
  const bgInput = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(crop.background) ? crop.background : '#0b0730', title: 'Cor do fundo' });
  const modeBtn = btn('', () => setPicking(!picking), { cls: 'sm' });
  const status = h('span', { class: 'muted small' });

  function setPicking(v) {
    picking = v;
    modeBtn.textContent = picking ? 'Modo: selecionar partes' : 'Modo: usar a página (login, navegar)';
    modeBtn.className = `btn sm ${picking ? 'primary' : ''}`;
    clearHover();
  }

  const doc = () => { try { return frame.contentDocument; } catch { return null; } };

  function marker(d2) {
    let m = d2.getElementById('uds-crop-marker');
    if (!m) {
      m = d2.createElement('div');
      m.id = 'uds-crop-marker';
      m.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #00ceff;' +
        'background:rgba(0,206,255,.15);box-shadow:0 0 0 9999px rgba(5,0,30,.25);transition:all .08s';
      d2.documentElement.appendChild(m);
    }
    return m;
  }
  function highlight(el) {
    const d2 = doc();
    if (!d2 || !el) return;
    const r = el.getBoundingClientRect();
    Object.assign(marker(d2).style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    status.textContent = describe(el);
  }
  function clearHover() {
    hoverEl = null;
    const d2 = doc();
    const m = d2 && d2.getElementById('uds-crop-marker');
    if (m) m.style.display = 'none';
    status.textContent = '';
  }

  function renderList() {
    clear(list, picks.length ? picks.map((p, i) => h('div', { class: 'crop-item' },
      h('span', { class: 'badge primary' }, String(i + 1)),
      h('div', { class: 'grow' }, h('div', { class: 'small' }, p.label), h('div', { class: 'mono small muted', style: 'word-break:break-all' }, p.sel)),
      btn('↑', () => moveItem(i, -1), { cls: 'sm', title: 'Mover para cima' }),
      btn('Remover', () => { picks.splice(i, 1); renderList(); }, { cls: 'sm danger' })))
      : h('div', { class: 'muted small' }, 'Nenhuma parte escolhida: a TV mostra a página inteira. Clique nas partes da página (ex.: o 3D e o resumo).'));
  }
  function moveItem(i, dir) {
    const j = i + dir;
    if (j < 0) return;
    [picks[i], picks[j]] = [picks[j], picks[i]];
    renderList();
  }

  function pick(el) {
    const sel = selectorFor(el);
    if (picks.some((p) => p.sel === sel)) { toast('Essa parte já foi escolhida', 'info'); return; }
    picks.push({ sel, label: describe(el), el });
    lastPicked = el;
    renderList();
  }

  function parentOfLast() {
    const p = picks[picks.length - 1];
    const d2 = doc();
    let el = (p && p.el && p.el.isConnected) ? p.el : (d2 && p ? d2.querySelector(p.sel) : null);
    if (!el || !el.parentElement || el.parentElement === d2.body) { toast('Não há nível acima', 'info'); return; }
    el = el.parentElement;
    picks[picks.length - 1] = { sel: selectorFor(el), label: describe(el), el };
    highlight(el);
    renderList();
  }

  function attach() {
    const d2 = doc();
    if (!d2) { status.textContent = 'A página saiu do proxy — não é possível selecionar.'; return; }
    d2.addEventListener('mousemove', (ev) => {
      if (!picking) return;
      const el = d2.elementFromPoint(ev.clientX, ev.clientY);
      if (el && el.id !== 'uds-crop-marker' && el !== hoverEl) { hoverEl = el; highlight(el); }
    }, true);
    const block = (ev) => { if (picking) { ev.preventDefault(); ev.stopPropagation(); } };
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'submit'].forEach((t) => d2.addEventListener(t, block, true));
    d2.addEventListener('click', (ev) => {
      if (!picking) return;
      ev.preventDefault(); ev.stopPropagation();
      const el = d2.elementFromPoint(ev.clientX, ev.clientY);
      if (el && el !== d2.body && el !== d2.documentElement) pick(el);
    }, true);
  }

  async function save(close) {
    const keep = picks.map((p) => p.sel);
    const options = { ...d.options };
    if (keep.length) options.crop = { ...(d.options.crop || {}), keep, arrange: arrangeSel.value, background: bgInput.value };
    else delete options.crop;
    try {
      await patch(`/dashboards/${d.id}`, { options });
      d.options = options;
      toast(keep.length ? 'Recorte salvo. As TVs aplicam ao recarregar o dashboard.' : 'Recorte removido', 'success');
      if (close) close();
      if (onDone) onDone();
    } catch (e) { toastError(e); }
  }

  function preview() {
    window.__udsNoCrop = false;
    setPicking(false);
    toast('Salve para ver o resultado igual à TV; esta prévia usa o recorte já salvo.', 'info');
    frame.src = proxiedHref(d);
  }

  frame.addEventListener('load', () => { if (window.__udsNoCrop) attach(); });
  window.__udsNoCrop = true;  // o editor mostra a página inteira
  frame.src = proxiedHref(d);
  setPicking(true);
  renderList();

  modal({
    title: `Recortar: ${d.name}`,
    wide: true,
    onClose: () => { delete window.__udsNoCrop; },
    body: h('div', { class: 'crop-editor' },
      h('div', { class: 'alert info' },
        'Passe o mouse e clique nas partes que a TV deve mostrar (ex.: o 3D e o resumo de equipamentos). ',
        'Se pegar uma parte pequena demais, use "Subir um nível". Se a página pedir login ou precisar navegar até a tela certa, ',
        'troque para "usar a página" e depois volte a selecionar.'),
      h('div', { class: 'row', style: 'margin:8px 0' }, modeBtn,
        btn('Subir um nível', parentOfLast, { cls: 'sm', title: 'Troca a última parte escolhida pelo bloco que a contém' }),
        btn('Recarregar página', () => { window.__udsNoCrop = true; frame.src = proxiedHref(d); }, { cls: 'sm', ico: 'refresh' }),
        btn('Prévia do recorte salvo', preview, { cls: 'sm' }), h('div', { class: 'grow' }), status),
      h('div', { class: 'crop-body' }, frame,
        h('div', { class: 'crop-side' },
          h('h3', null, 'Partes escolhidas'), list,
          h('div', { class: 'field' }, h('label', null, 'Organização na TV'), arrangeSel),
          h('div', { class: 'field' }, h('label', null, 'Fundo'), bgInput)))),
    actions: [
      (close) => btn('Remover recorte', () => { picks = []; save(close); }, { cls: 'danger' }),
      (close) => btn('Cancelar', () => close()),
      (close) => btn('Salvar recorte', () => save(close), { cls: 'primary' }),
    ],
  });
}
