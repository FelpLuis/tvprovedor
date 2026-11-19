import { get, post, patch, put, del } from '../api.js';
import { h, clear, btn, formModal, confirmDialog, toast, toastError, emptyState, modal } from '../ui.js';
import { session } from '../session.js';

async function openGroupForm(group, onDone) {
  const playlists = await get('/playlists');
  formModal({
    title: group ? `Editar grupo ${group.name}` : 'Novo grupo',
    values: group || {},
    fields: [
      { name: 'name', label: 'Nome', required: true, placeholder: 'NOC', full: true },
      { name: 'playlist_id', label: 'Playlist padrão do grupo', type: 'select', numeric: true, full: true,
        options: [[null, '— nenhuma —'], ...playlists.map((p) => [p.id, p.name])],
        help: 'Usada pelas TVs de mídia do grupo que não têm playlist própria.' },
      { name: 'description', label: 'Descrição', type: 'textarea', full: true },
    ],
    submit: async (v) => {
      if (group) await patch(`/groups/${group.id}`, v); else await post('/groups', v);
      toast(group ? 'Grupo atualizado' : 'Grupo criado', 'success');
      onDone();
    },
  });
}

async function openGroupPlaylist(group, onDone) {
  const playlists = await get('/playlists');
  formModal({
    title: `Programação do grupo ${group.name}`,
    values: { playlist_id: group.playlist_id },
    fields: [{ name: 'playlist_id', label: 'Playlist padrão', type: 'select', numeric: true, full: true,
      options: [[null, '— nenhuma —'], ...playlists.map((p) => [p.id, p.name])],
      help: 'Aplica-se às TVs de mídia do grupo sem playlist própria.' }],
    submit: async (v) => { await put(`/groups/${group.id}/playlist`, v); toast('Programação do grupo atualizada', 'success'); onDone(); },
  });
}

async function showScreens(group) {
  const screens = await get(`/screens?group_id=${group.id}`);
  modal({
    title: `TVs do grupo ${group.name}`,
    body: screens.length ? h('ul', null, screens.map((s) => h('li', null, `${s.identifier} — ${s.name}`))) : emptyState('Nenhuma TV neste grupo.'),
  });
}

async function groupPower(g, action) {
  const label = action === 'on' ? 'ligar' : 'desligar';
  if (!await confirmDialog(`${action === 'on' ? 'Ligar' : 'Desligar'} grupo`, `Deseja ${label} as ${g.screen_count} TV(s) do grupo ${g.name}? Vale até a próxima mudança do horário de funcionamento de cada TV.`)) return;
  try {
    const r = await post(`/groups/${g.id}/power`, { action });
    toast(`${r.screens} TV(s): comando enviado. Aplicado em até 1 minuto.`, 'success');
  } catch (e) { toastError(e); }
}

export async function render(root) {
  const wrap = h('div');
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Grupos'), h('div', { class: 'grow' }),
      session.can('admin') ? btn('Novo grupo', () => openGroupForm(null, load).catch(toastError), { cls: 'primary', ico: 'plus' }) : null),
    h('p', { class: 'muted', style: 'margin-top:-8px' }, 'Organize as TVs por setor e envie uma programação para várias TVs de uma vez.'),
    wrap);

  async function load() {
    const groups = await get('/groups');
    if (!groups.length) {
      clear(wrap, h('div', { class: 'table-wrap' }, emptyState('Nenhum grupo cadastrado.')));
      return;
    }
    clear(wrap, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Grupo', 'Descrição', 'TVs', 'Playlist padrão', ''].map((t) => h('th', null, t)))),
      h('tbody', null, groups.map((g) => h('tr', null,
        h('td', null, h('b', null, g.name)),
        h('td', { class: 'muted' }, g.description || '—'),
        h('td', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); showScreens(g).catch(toastError); } }, String(g.screen_count))),
        h('td', null, g.playlist ? g.playlist.name : '—'),
        h('td', { class: 'nowrap', style: 'text-align:right' },
          session.can('operator') ? btn('Programação', () => openGroupPlaylist(g, load).catch(toastError), { cls: 'sm' }) : null, ' ',
          session.can('operator') ? btn('Ligar', () => groupPower(g, 'on'), { cls: 'sm', disabled: !g.screen_count }) : null, ' ',
          session.can('operator') ? btn('Desligar', () => groupPower(g, 'off'), { cls: 'sm', disabled: !g.screen_count }) : null, ' ',
          session.can('admin') ? btn('Editar', () => openGroupForm(g, load).catch(toastError), { cls: 'sm' }) : null, ' ',
          session.can('admin') ? btn('Excluir', async () => {
            if (!await confirmDialog('Excluir grupo', `Excluir o grupo ${g.name}?`, { danger: true, okLabel: 'Excluir' })) return;
            try { await del(`/groups/${g.id}`); toast('Grupo excluído', 'success'); load(); } catch (e) { toastError(e); }
          }, { cls: 'sm danger', disabled: g.screen_count > 0, title: g.screen_count ? 'Só é possível excluir grupos vazios' : '' }) : null)))))));
  }
  await load();
}
