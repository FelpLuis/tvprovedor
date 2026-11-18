import { get } from '../api.js';
import { h, clear, fmtDate, emptyState, btn, toastError } from '../ui.js';

const ACTIONS = {
  'auth.login': 'Login', 'auth.login_failed': 'Falha de login', 'auth.password_changed': 'Senha alterada',
  'user.created': 'Usuário criado', 'user.updated': 'Usuário alterado', 'user.deleted': 'Usuário excluído',
  'screen.created': 'TV cadastrada', 'screen.updated': 'TV alterada', 'screen.deleted': 'TV excluída',
  'screen.activated': 'TV ativada', 'screen.paired': 'Dispositivo pareado', 'screen.revoked': 'Dispositivo revogado',
  'screen.playlist_set': 'Playlist da TV', 'screen.playlist_bulk_set': 'Playlist em lote',
  'screen.command_sent': 'Comando enviado', 'screen.command_ack': 'Comando executado',
  'group.created': 'Grupo criado', 'group.updated': 'Grupo alterado', 'group.deleted': 'Grupo excluído', 'group.playlist_set': 'Playlist do grupo',
  'media.uploaded': 'Mídia enviada', 'media.updated': 'Mídia alterada', 'media.deleted': 'Mídia excluída',
  'playlist.created': 'Playlist criada', 'playlist.updated': 'Playlist alterada', 'playlist.deleted': 'Playlist excluída', 'playlist.duplicated': 'Playlist duplicada',
  'dashboard.created': 'Dashboard criado', 'dashboard.updated': 'Dashboard alterado', 'dashboard.deleted': 'Dashboard excluído',
};

export async function render(root) {
  const entity = h('select', null, [['', 'Todas as entidades'], ['screen', 'TVs'], ['group', 'Grupos'], ['media', 'Mídias'],
    ['playlist', 'Playlists'], ['dashboard', 'Dashboards'], ['user', 'Usuários']].map(([v, l]) => h('option', { value: v }, l)));
  const action = h('select', null, h('option', { value: '' }, 'Todas as ações'),
    [['auth', 'Autenticação'], ['screen.command', 'Comandos remotos'], ['screen.activated', 'Ativações']].map(([v, l]) => h('option', { value: v }, l)));
  const wrap = h('div');
  clear(root, h('div', { class: 'page-head' }, h('h1', null, 'Logs de auditoria'), h('div', { class: 'grow' }),
    btn('Atualizar', () => load().catch(toastError), { ico: 'refresh', cls: 'ghost' })),
  h('div', { class: 'toolbar' }, entity, action), wrap);

  async function load() {
    const p = new URLSearchParams({ limit: '300' });
    if (entity.value) p.set('entity_type', entity.value);
    if (action.value) p.set('action', action.value);
    const rows = await get('/audit-logs?' + p.toString());
    if (!rows.length) { clear(wrap, h('div', { class: 'table-wrap' }, emptyState('Nenhum registro.'))); return; }
    clear(wrap, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Data', 'Autor', 'Ação', 'Entidade', 'Detalhes', 'IP'].map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', { class: 'nowrap' }, fmtDate(r.created_at)),
        h('td', null, r.actor_name, r.actor_type !== 'user' ? h('span', { class: 'badge', style: 'margin-left:6px' }, r.actor_type === 'device' ? 'TV' : 'sistema') : null),
        h('td', null, h('span', { class: `badge ${r.action.endsWith('failed') ? 'danger' : ''}` }, ACTIONS[r.action] || r.action)),
        h('td', { class: 'muted' }, r.entity_type ? `${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}` : '—'),
        h('td', { class: 'small mono', style: 'max-width:420px; word-break:break-word' }, r.details ? JSON.stringify(r.details) : ''),
        h('td', { class: 'small mono' }, r.ip || '—')))))));
  }
  entity.addEventListener('change', () => load().catch(toastError));
  action.addEventListener('change', () => load().catch(toastError));
  await load();
}
