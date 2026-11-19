import { get } from '../api.js';
import { h, clear, icon, fmtAgo, fmtBytes, statusBadge, PROFILES, PLAYBACK, emptyState, btn } from '../ui.js';
import { session } from '../session.js';
import { openScreenDetail } from './screens.js';

const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Anima um número até o valor final (só quando o valor muda). */
function countTo(el, target) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = target;
  if (REDUCED || from === target) { el.textContent = target; return; }
  const start = performance.now(), dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const KPIS = [
  ['screens_total', 'TVs cadastradas', 'tv', () => ''],
  ['screens_online', 'Online', 'play', () => 'success'],
  ['screens_offline', 'Offline', 'down', (v) => (v ? 'danger' : '')],
  ['screens_not_activated', 'Sem ativação', 'key', (v) => (v ? 'warning' : '')],
  ['screens_with_errors', 'Com erro', 'log', (v) => (v ? 'warning' : '')],
  ['groups', 'Grupos', 'group', () => ''],
  ['media', 'Mídias', 'media', () => ''],
  ['playlists', 'Playlists', 'playlist', () => ''],
];

function greeting() {
  const hgt = new Date().getHours();
  return hgt < 12 ? 'Bom dia' : hgt < 18 ? 'Boa tarde' : 'Boa noite';
}

function ring() {
  // SVG estático; apenas o comprimento do traço muda (números)
  const el = h('div', { class: 'ring', html: `
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#00ceff"/><stop offset="1" stop-color="#9b00ff"/></linearGradient></defs>
      <circle class="track" cx="60" cy="60" r="50" fill="none" stroke-width="10"/>
      <circle class="bar" cx="60" cy="60" r="50" fill="none" stroke-width="10" stroke-dasharray="314.16" stroke-dashoffset="314.16"/>
    </svg>` });
  const label = h('div', { class: 'ring-label' }, h('div', null, h('b', null, '0%'), h('span', null, 'online')));
  el.appendChild(label);
  el.set = (pct) => {
    el.querySelector('.bar').setAttribute('stroke-dashoffset', String(314.16 * (1 - pct)));
    label.querySelector('b').textContent = `${Math.round(pct * 100)}%`;
  };
  return el;
}

function screenCard(s, refresh) {
  const offline = s.activated && !s.online && s.status !== 'disabled';
  const playing = s.online && s.playback_state === 'playing';
  const now = s.online
    ? h('div', { class: 'now' },
      playing ? h('span', { class: 'eq' }, h('i'), h('i'), h('i')) : icon(s.playback_state === 'standby' ? 'down' : 'play'),
      h('span', { class: 'txt' }, `${PLAYBACK[s.playback_state] || s.playback_state || '—'}${s.current_content ? ' · ' + s.current_content : ''}`))
    : h('div', { class: 'now muted' }, icon('tv'), h('span', { class: 'txt' }, s.activated ? `Sem contato ${fmtAgo(s.last_seen_at)}` : 'Aguardando ativação'));
  return h('div', { class: `screen-card ${offline ? 'offline' : ''}`, onclick: () => openScreenDetail(s.id, refresh), tabindex: 0,
    onkeydown: (e) => { if (e.key === 'Enter') openScreenDetail(s.id, refresh); } },
  h('div', { class: 'title' },
    h('span', { class: 'tv-ico' }, icon(s.profile === 'CAMERA_PLAYER' ? 'video' : s.profile === 'MEDIA_PLAYER' ? 'media' : 'chart')),
    h('div', { class: 'grow', style: 'min-width:0' }, h('div', { style: 'overflow:hidden; text-overflow:ellipsis' }, s.name), h('div', { class: 'mono' }, s.identifier)),
    statusBadge(s)),
  now,
  h('div', { class: 'meta' },
    h('span', null, 'Grupo'), h('span', null, s.group ? s.group.name : '—'),
    h('span', null, 'Perfil'), h('span', null, PROFILES[s.profile]),
    h('span', null, 'Programado'), h('span', null, s.effective_content || 'Nada programado'),
    h('span', null, 'Último contato'), h('span', { title: s.last_seen_at || '' }, fmtAgo(s.last_seen_at))),
  s.last_error && s.activated ? h('div', { class: 'error-text small' }, s.last_error) : null);
}

export async function render(root) {
  const kpis = h('div', { class: 'kpis' });
  const cards = {};
  for (const [key, label, ico] of KPIS) {
    const value = h('div', { class: 'value' }, '0');
    const card = h('div', { class: 'kpi' }, h('div', { class: 'kpi-top' }, h('div', { class: 'label' }, label), h('span', { class: 'kpi-ico' }, icon(ico))), value);
    cards[key] = { card, value };
    kpis.appendChild(card);
  }
  const grid = h('div', { class: 'screen-grid' });
  const storage = h('div', { class: 'muted small' });
  const clock = h('div', { class: 'clock' });
  const summary = h('div', { class: 'muted small', style: 'margin-top:6px' });
  const donut = ring();
  const filter = h('select', { style: 'width:auto', onchange: () => draw(last, false) },
    h('option', { value: '' }, 'Todas as TVs'), h('option', { value: 'offline' }, 'Somente offline'),
    h('option', { value: 'errors' }, 'Com erro'), h('option', { value: 'pending' }, 'Não ativadas'));
  let last = null;
  const firstName = (session.user.full_name || session.user.username).split(' ')[0];

  clear(root,
    h('div', { class: 'card hero' },
      h('div', null,
        h('div', { class: 'hello' }, `${greeting()}, ${firstName} 👋`),
        h('h1', null, 'Visão geral das telas'),
        summary, clock),
      donut),
    h('div', { class: 'page-head', style: 'margin-bottom:12px' }, h('div', { class: 'grow' }), storage,
      btn('Atualizar', () => load(), { ico: 'refresh', cls: 'ghost' })),
    kpis,
    h('div', { class: 'page-head' }, h('h2', { style: 'margin:0' }, 'Telas'), h('div', { class: 'grow' }), filter),
    grid);

  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) +
      ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  const clockTimer = setInterval(tick, 1000);

  function draw(o, animateCards) {
    if (!o) return;
    for (const [key, , , cls] of KPIS) {
      const v = o[key];
      cards[key].card.className = `kpi ${cls(v)}`;
      countTo(cards[key].value, v);
    }
    const active = o.screens_online + o.screens_offline;
    donut.set(active ? o.screens_online / active : 0);
    summary.textContent = o.screens_total
      ? `${o.screens_online} de ${active} TVs ativadas estão online${o.screens_offline ? ` · ${o.screens_offline} precisam de atenção` : ' · tudo funcionando'}`
      : 'Nenhuma TV cadastrada ainda.';
    storage.textContent = `Mídias: ${fmtBytes(o.storage.media_bytes)} · Disco livre: ${fmtBytes(o.storage.disk_free_bytes)}`;
    let list = o.screens;
    const f = filter.value;
    if (f === 'offline') list = list.filter((s) => s.activated && !s.online);
    if (f === 'errors') list = list.filter((s) => s.activated && s.last_error);
    if (f === 'pending') list = list.filter((s) => !s.activated);
    // offline primeiro para chamar atenção
    list = [...list].sort((a, b) => (Number(b.activated && !b.online) - Number(a.activated && !a.online)));
    grid.classList.toggle('no-anim', !animateCards);
    if (!list.length) {
      clear(grid, emptyState(o.screens.length ? 'Nenhuma TV neste filtro.' : 'Nenhuma TV cadastrada ainda.',
        o.screens.length ? null : h('a', { class: 'btn primary', href: '#/tvs' }, 'Cadastrar / ativar TVs')));
    } else {
      clear(grid, list.map((s) => screenCard(s, load)));
    }
  }

  let first = true;
  async function load() {
    last = await get('/overview');
    draw(last, first);
    first = false;
    kpis.classList.add('no-anim');
  }
  await load();
  const timer = setInterval(() => load().catch(() => {}), 15000);
  return () => { clearInterval(timer); clearInterval(clockTimer); };
}
