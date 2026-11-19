// Utilitários de interface. Todo texto vindo da API é inserido via textContent (sem innerHTML).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'html') el.innerHTML = v; // somente para ícones estáticos
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  tv: '<path d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18z"/>',
  group: '<path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1a4.2 4.2 0 0 1 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/>',
  media: '<path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z"/>',
  playlist: '<path d="M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z"/>',
  chart: '<path d="M5 9h3v10H5zm5.5-4h3v14h-3zM16 13h3v6h-3z"/>',
  users: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z"/>',
  settings: '<path d="M19.4 13a7.8 7.8 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.8 7.8 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.3 7.3 0 0 0 1.7 1L11 21h4l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  key: '<path d="M7 14a2 2 0 1 1 2-2 2 2 0 0 1-2 2zm5.6-4A6 6 0 1 0 12.6 14H17v4h4v-4h2v-4z"/>',
  menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
  sun: '<path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"/>',
  logout: '<path d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4z"/>',
  up: '<path d="M7 14l5-5 5 5z"/>',
  down: '<path d="M7 10l5 5 5-5z"/>',
  trash: '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>',
  drag: '<path d="M9 4h2v2H9zm4 0h2v2h-2zM9 9h2v2H9zm4 0h2v2h-2zm-4 5h2v2H9zm4 0h2v2h-2zm-4 5h2v2H9zm4 0h2v2h-2z"/>',
  video: '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/>',
  image: '<path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z"/>',
  refresh: '<path d="M17.6 6.4A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4z"/>',
  copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

export function btn(label, onclick, { cls = '', ico, type = 'button', title, disabled } = {}) {
  return h('button', { class: `btn ${cls}`, type, onclick, title, disabled }, ico ? icon(ico) : null, label);
}

// ---------------------------------------------------------------- toast / modal

export function toast(message, kind = 'info', ms = 4500) {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function toastError(err) {
  toast(err && err.message ? err.message : String(err), 'error', 7000);
}

export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => a(close))) : null;
  const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', { style: 'margin:0' }, title),
      h('button', { class: 'btn ghost icon-only right', onclick: close, 'aria-label': 'Fechar' }, '✕')),
    h('div', { class: 'modal-body' }, body),
    foot);
  back.appendChild(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  const first = box.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, el: box };
}

export function confirmDialog(title, text, { okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: h('p', { style: 'margin:0; white-space:pre-line' }, text),
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        (close) => btn('Cancelar', () => close()),
        (close) => btn(okLabel, () => { answered = true; close(); resolve(true); }, { cls: danger ? 'danger' : 'primary' }),
      ],
    });
  });
}

/** Abre um formulário em modal; `submit(values)` deve retornar uma Promise. */
export function formModal({ title, fields, values = {}, submitLabel = 'Salvar', submit, wide = false, extra }) {
  const form = buildForm(fields, values);
  const err = h('div', { class: 'error-text hidden' });
  const m = modal({
    title, wide,
    body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); doSubmit(); } },
      form.el, extra || null, err, h('button', { type: 'submit', class: 'hidden' })),
    actions: [
      (close) => btn('Cancelar', () => close()),
      () => btn(submitLabel, () => doSubmit(), { cls: 'primary' }),
    ],
  });
  async function doSubmit() {
    err.classList.add('hidden');
    try {
      await submit(form.values());
      m.close();
    } catch (e) {
      err.textContent = e.message || String(e);
      err.classList.remove('hidden');
    }
  }
  return { ...m, form };
}

// ---------------------------------------------------------------- formulários

/**
 * fields: [{name, label, type: text|number|select|textarea|checkbox|password, options: [[v,l]], help, full, required}]
 */
export function buildForm(fields, values = {}) {
  const inputs = {};
  const grid = h('div', { class: 'form-grid' });
  for (const f of fields) {
    if (f.type === 'section') { grid.appendChild(h('h3', { class: 'full', style: 'margin:8px 0 0' }, f.label)); continue; }
    const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
    let input;
    const val = values[f.name] !== undefined ? values[f.name] : f.default;
    if (f.type === 'select') {
      input = h('select', { id, name: f.name },
        f.options.map(([v, l]) => h('option', { value: v === null ? '' : v }, l)));
      input.value = val === null || val === undefined ? '' : String(val);
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.name, placeholder: f.placeholder }, val || '');
    } else if (f.type === 'checkbox') {
      input = h('input', { id, name: f.name, type: 'checkbox', checked: !!val });
    } else if (f.type === 'multiselect') {
      // lista de opções marcáveis; a ordem de marcação é preservada
      const chosen = (val || []).map(Number);
      input = h('div', { id, class: 'multiselect', style: 'display:flex; flex-direction:column; gap:4px; max-height:220px; overflow:auto; padding:8px; border:1px solid var(--border); border-radius:8px' });
      input._chosen = chosen;
      const draw = () => clear(input, f.options.length ? f.options.map(([v, l]) => {
        const cb = h('input', { type: 'checkbox', checked: chosen.includes(Number(v)) });
        cb.addEventListener('change', () => {
          const n = Number(v);
          if (cb.checked) { if (!chosen.includes(n)) chosen.push(n); } else { chosen.splice(chosen.indexOf(n), 1); }
          draw();
        });
        const pos = chosen.indexOf(Number(v));
        return h('label', { class: 'check small' }, cb, pos >= 0 ? h('b', null, `${pos + 1}. `) : null, l);
      }) : h('span', { class: 'muted small' }, f.empty || 'Nenhuma opção'));
      draw();
    } else {
      input = h('input', { id, name: f.name, type: f.type || 'text', value: val === null || val === undefined ? '' : val,
        placeholder: f.placeholder, min: f.min, max: f.max, required: f.required, autocomplete: f.autocomplete || 'off' });
    }
    if (f.disabled) input.disabled = true;
    inputs[f.name] = { el: input, def: f };
    const wrap = f.type === 'checkbox'
      ? h('div', { class: `field ${f.full ? 'full' : ''}` }, h('label', { class: 'check', for: id }, input, f.label),
        f.help ? h('div', { class: 'help' }, f.help) : null)
      : h('div', { class: `field ${f.full ? 'full' : ''}` }, h('label', { for: id }, f.label), input,
        f.help ? h('div', { class: 'help' }, f.help) : null);
    if (f.onchange) input.addEventListener('change', () => f.onchange(input.value, inputs));
    grid.appendChild(wrap);
  }
  return {
    el: grid,
    inputs,
    values() {
      const out = {};
      for (const [name, { el, def }] of Object.entries(inputs)) {
        if (def.disabled) continue;
        if (def.type === 'checkbox') out[name] = el.checked;
        else if (def.type === 'multiselect') out[name] = [...el._chosen];
        else if (def.type === 'number') out[name] = el.value === '' ? null : Number(el.value);
        else if (def.type === 'select' && def.numeric) out[name] = el.value === '' ? null : Number(el.value);
        else if (def.type === 'select' && def.nullable) out[name] = el.value === '' ? null : el.value;
        else out[name] = el.value;
        if (def.omitEmpty && (out[name] === '' || out[name] === null)) delete out[name];
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- formatação

export function fmtBytes(n) {
  if (n === null || n === undefined) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

export function fmtAgo(iso) {
  if (!iso) return 'nunca';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function fmtDuration(sec) {
  if (sec === null || sec === undefined) return '-';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}min ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export const PROFILES = {
  MEDIA_PLAYER: 'Mídia (imagens e vídeos)',
  GRAFANA_PLAYER: 'Grafana',
  POWERBI_PLAYER: 'Power BI',
  ZABBIX_PLAYER: 'Zabbix',
  UPDOWN_BI_PLAYER: 'UpDown BI',
  CAMERA_PLAYER: 'Câmeras (CFTV)',
};
export const PROFILE_KIND = {
  GRAFANA_PLAYER: ['grafana', 'other'],
  POWERBI_PLAYER: ['powerbi', 'other'],
  ZABBIX_PLAYER: ['zabbix', 'other'],
  UPDOWN_BI_PLAYER: ['updown_bi', 'other'],
};
export const ORIENTATIONS = {
  landscape: 'Paisagem (horizontal)',
  portrait: 'Retrato (TV em pé, girada 90°)',
  landscape_flipped: 'Paisagem invertida (180°)',
  portrait_flipped: 'Retrato invertido (270°)',
};
// resoluções do "palco" do player, em paisagem; em retrato largura e altura são invertidas
export const RESOLUTIONS = [
  ['auto', 'Automática (resolução detectada na TV)'],
  ['1280x720', 'HD 1280×720 — textos maiores; TVs até 32"'],
  ['1366x768', 'HD 1366×768 — TVs 32" e monitores'],
  ['1920x1080', 'Full HD 1920×1080 — TVs 40" a 55" (recomendado)'],
  ['2560x1440', 'QHD 2560×1440'],
  ['3840x2160', '4K 3840×2160 — TVs 55" ou mais'],
  ['custom', 'Personalizada…'],
];
export function suggestResolution(inches) {
  if (!inches) return '';
  if (inches <= 32) return 'Sugestão para ' + inches + '": HD 1280×720 ou 1366×768 (textos e dashboards maiores).';
  if (inches < 55) return 'Sugestão para ' + inches + '": Full HD 1920×1080.';
  return 'Sugestão para ' + inches + '": Full HD 1920×1080 para dashboards legíveis, ou 4K 3840×2160 para conteúdo em 4K.';
}

export const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export const DASH_KINDS = { grafana: 'Grafana', powerbi: 'Power BI', zabbix: 'Zabbix', updown_bi: 'UpDown BI', other: 'Outro' };
export const ROLES = { admin: 'Administrador', operator: 'Operador', viewer: 'Visualizador' };
export const COMMANDS = {
  reload_config: 'Atualizar configuração',
  refresh_content: 'Sincronizar conteúdo',
  restart_playback: 'Reiniciar reprodução',
  reload_page: 'Recarregar player',
  clear_cache: 'Limpar cache local',
  identify: 'Identificar tela',
  update_app: 'Atualizar app',
  app_setup: 'Configurar app na TV',
};
export const PLAYBACK = {
  playing: 'Reproduzindo', idle: 'Ocioso', loading: 'Carregando', error: 'Erro',
  offline_cache: 'Offline (cache)', redirect: 'Redirecionado', standby: 'Em espera',
};

export function statusBadge(screen) {
  if (!screen.activated) return h('span', { class: 'badge warning' }, h('span', { class: 'dot' }), 'Não ativada');
  if (screen.status === 'disabled') return h('span', { class: 'badge' }, h('span', { class: 'dot' }), 'Desativada');
  if (!screen.online) return h('span', { class: 'badge danger' }, h('span', { class: 'dot' }), 'Offline');
  if (screen.power && screen.power.state === 'off') return h('span', { class: 'badge' }, h('span', { class: 'dot' }), 'Em espera');
  if (screen.last_error) return h('span', { class: 'badge warning' }, h('span', { class: 'dot' }), 'Online com erro');
  return h('span', { class: 'badge success' }, h('span', { class: 'dot' }), 'Online');
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('div', null, text), action ? h('div', { style: 'margin-top:12px' }, action) : null);
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
