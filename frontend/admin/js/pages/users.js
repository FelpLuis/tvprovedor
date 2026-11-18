import { get, post, patch, del } from '../api.js';
import { h, clear, btn, formModal, confirmDialog, toast, toastError, fmtDate, ROLES } from '../ui.js';
import { session } from '../session.js';

const ROLE_HELP = 'Administrador: acesso completo. Operador: mídias, playlists, programação e comandos. Visualizador: somente consulta.';

function openForm(u, onDone) {
  formModal({
    title: u ? `Editar ${u.username}` : 'Novo usuário',
    values: u || { role: 'viewer', is_active: true },
    fields: [
      { name: 'username', label: 'Usuário', required: true, disabled: !!u },
      { name: 'full_name', label: 'Nome completo' },
      { name: 'email', label: 'E-mail', type: 'email', nullable: true },
      { name: 'role', label: 'Perfil de acesso', type: 'select', options: Object.entries(ROLES), help: ROLE_HELP, full: true },
      { name: 'password', label: u ? 'Nova senha (opcional)' : 'Senha', type: 'password', autocomplete: 'new-password',
        help: 'Mínimo de 10 caracteres, combinando letras e números/símbolos.', omitEmpty: !!u },
      u ? { name: 'is_active', label: 'Usuário ativo', type: 'checkbox' } : null,
    ].filter(Boolean),
    submit: async (v) => {
      if (v.email === '') v.email = null;
      if (u) await patch(`/users/${u.id}`, v); else await post('/users', v);
      toast('Usuário salvo', 'success');
      onDone();
    },
  });
}

export async function render(root) {
  const wrap = h('div');
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Usuários'), h('div', { class: 'grow' }),
      btn('Novo usuário', () => openForm(null, load), { cls: 'primary', ico: 'plus' })),
    wrap);
  async function load() {
    const users = await get('/users');
    clear(wrap, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Usuário', 'Nome', 'E-mail', 'Perfil', 'Status', 'Último acesso', ''].map((t) => h('th', null, t)))),
      h('tbody', null, users.map((u) => h('tr', null,
        h('td', { class: 'mono' }, u.username),
        h('td', null, u.full_name || '—'),
        h('td', null, u.email || '—'),
        h('td', null, h('span', { class: `badge ${u.role === 'admin' ? 'primary' : ''}` }, ROLES[u.role])),
        h('td', null, h('span', { class: `badge ${u.is_active ? 'success' : 'danger'}` }, u.is_active ? 'Ativo' : 'Inativo')),
        h('td', { class: 'nowrap' }, fmtDate(u.last_login_at)),
        h('td', { class: 'nowrap', style: 'text-align:right' },
          btn('Editar', () => openForm(u, load), { cls: 'sm' }), ' ',
          u.id !== session.user.id ? btn('Excluir', async () => {
            if (!await confirmDialog('Excluir usuário', `Excluir ${u.username}?`, { danger: true, okLabel: 'Excluir' })) return;
            try { await del(`/users/${u.id}`); toast('Usuário excluído', 'success'); load(); } catch (e) { toastError(e); }
          }, { cls: 'sm danger' }) : null)))))));
  }
  await load();
}
