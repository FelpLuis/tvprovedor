import { get } from '../api.js';
import { h, clear, fmtAgo, fmtBytes, statusBadge, PROFILES, PLAYBACK, emptyState, btn } from '../ui.js';
import { openScreenDetail } from './screens.js';

function kpi(label, value, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
}

function screenCard(s, refresh) {
  const offline = s.activated && !s.online && s.status !== 'disabled';
  return h('div', { class: `screen-card ${offline ? 'offline' : ''}`, onclick: () => openScreenDetail(s.id, refresh) },
    h('div', { class: 'title' }, h('span', { class: 'mono' }, s.identifier), h('span', { class: 'grow' }, s.name), statusBadge(s)),
    h('div', { class: 'meta' },
      h('span', null, 'Grupo'), h('span', null, s.group ? s.group.name : '—'),
      h('span', null, 'Perfil'), h('span', null, PROFILES[s.profile]),
      h('span', null, 'Programado'), h('span', null, s.effective_content || 'Nada programado'),
      h('span', null, 'Exibindo'), h('span', null, s.online
        ? `${PLAYBACK[s.playback_state] || s.playback_state || '—'}${s.current_content ? ' · ' + s.current_content : ''}`
        : '—'),
      h('span', null, 'Último contato'), h('span', { title: s.last_seen_at || '' }, fmtAgo(s.last_seen_at))),
    s.last_error && s.activated ? h('div', { class: 'error-text small' }, s.last_error) : null);
}

export async function render(root) {
  const kpis = h('div', { class: 'kpis' });
  const grid = h('div', { class: 'screen-grid' });
  const storage = h('div', { class: 'muted small' });
  const filter = h('select', { style: 'width:auto', onchange: () => draw(last) },
    h('option', { value: '' }, 'Todas as TVs'), h('option', { value: 'offline' }, 'Somente offline'),
    h('option', { value: 'errors' }, 'Com erro'), h('option', { value: 'pending' }, 'Não ativadas'));
  let last = null;

  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Visão geral'), h('div', { class: 'grow' }), storage,
      btn('Atualizar', () => load(), { ico: 'refresh', cls: 'ghost' })),
    kpis,
    h('div', { class: 'page-head' }, h('h2', { style: 'margin:0' }, 'Telas'), h('div', { class: 'grow' }), filter),
    grid);

  function draw(o) {
    if (!o) return;
    clear(kpis,
      kpi('TVs cadastradas', o.screens_total),
      kpi('Online', o.screens_online, 'success'),
      kpi('Offline', o.screens_offline, o.screens_offline ? 'danger' : ''),
      kpi('Sem ativação', o.screens_not_activated, o.screens_not_activated ? 'warning' : ''),
      kpi('Com erro', o.screens_with_errors, o.screens_with_errors ? 'warning' : ''),
      kpi('Grupos', o.groups),
      kpi('Mídias', o.media),
      kpi('Playlists', o.playlists));
    storage.textContent = `Mídias: ${fmtBytes(o.storage.media_bytes)} · Disco livre: ${fmtBytes(o.storage.disk_free_bytes)}`;
    let list = o.screens;
    const f = filter.value;
    if (f === 'offline') list = list.filter((s) => s.activated && !s.online);
    if (f === 'errors') list = list.filter((s) => s.activated && s.last_error);
    if (f === 'pending') list = list.filter((s) => !s.activated);
    // offline primeiro para chamar atenção
    list = [...list].sort((a, b) => (Number(b.activated && !b.online) - Number(a.activated && !a.online)));
    if (!list.length) {
      clear(grid, emptyState(o.screens.length ? 'Nenhuma TV neste filtro.' : 'Nenhuma TV cadastrada ainda.',
        o.screens.length ? null : h('a', { class: 'btn primary', href: '#/tvs' }, 'Cadastrar / ativar TVs')));
    } else {
      clear(grid, list.map((s) => screenCard(s, load)));
    }
  }

  async function load() {
    last = await get('/overview');
    draw(last);
  }
  await load();
  const timer = setInterval(() => load().catch(() => {}), 15000);
  return () => clearInterval(timer);
}
