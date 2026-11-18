import { get, post, patch, put, del } from '../api.js';
import {
  h, clear, btn, modal, formModal, confirmDialog, toast, toastError, buildForm,
  fmtAgo, fmtDate, fmtBytes, statusBadge, emptyState, debounce,
  PROFILES, PROFILE_KIND, COMMANDS, PLAYBACK,
} from '../ui.js';
import { session } from '../session.js';

async function loadRefs() {
  const [groups, playlists, dashboards] = await Promise.all([get('/groups'), get('/playlists'), get('/dashboards')]);
  return { groups, playlists, dashboards };
}

const profileOptions = Object.entries(PROFILES);

function screenFields(refs, values = {}) {
  const dashOpts = (profile) => [[null, '— selecione —'], ...refs.dashboards
    .filter((d) => (PROFILE_KIND[profile] || []).includes(d.kind))
    .map((d) => [d.id, `${d.name}${d.is_active ? '' : ' (inativo)'}`])];
  const fields = [
    { name: 'identifier', label: 'Identificação única', placeholder: 'TV-01', required: true,
      help: 'Letras, números, hífen ou sublinhado. Ex.: TV-01' },
    { name: 'name', label: 'Nome da TV', placeholder: 'TV RECEPÇÃO', required: true },
    { name: 'location', label: 'Localização física', placeholder: 'Térreo — recepção' },
    { name: 'department', label: 'Setor / departamento', placeholder: 'Comercial' },
    { name: 'group_id', label: 'Grupo', type: 'select', numeric: true,
      options: [[null, '— sem grupo —'], ...refs.groups.map((g) => [g.id, g.name])] },
    { name: 'profile', label: 'Perfil de funcionamento (fixo)', type: 'select', options: profileOptions,
      onchange: (v, inputs) => updateProfile(v, inputs) },
    { name: 'playlist_id', label: 'Playlist', type: 'select', numeric: true,
      options: [[null, '— usar a do grupo —'], ...refs.playlists.map((p) => [p.id, p.name])] },
    { name: 'dashboard_id', label: 'Dashboard', type: 'select', numeric: true, options: dashOpts(values.profile || 'MEDIA_PLAYER') },
    { name: 'refresh_seconds', label: 'Intervalo de atualização (s)', type: 'number', min: 10,
      help: 'Somente dashboards. Vazio = usar o do dashboard.' },
    { name: 'status', label: 'Status', type: 'select', options: [['active', 'Ativa'], ['disabled', 'Desativada']] },
    { name: 'description', label: 'Descrição', type: 'textarea', full: true },
  ];
  function updateProfile(profile, inputs) {
    const isMedia = profile === 'MEDIA_PLAYER';
    inputs.playlist_id.el.closest('.field').classList.toggle('hidden', !isMedia);
    inputs.dashboard_id.el.closest('.field').classList.toggle('hidden', isMedia);
    inputs.refresh_seconds.el.closest('.field').classList.toggle('hidden', isMedia);
    const sel = inputs.dashboard_id.el;
    const cur = sel.value;
    clear(sel, dashOpts(profile).map(([v, l]) => h('option', { value: v === null ? '' : v }, l)));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  }
  return { fields, updateProfile };
}

function cleanScreenValues(v) {
  const out = { ...v };
  if (out.profile === 'MEDIA_PLAYER') { out.dashboard_id = null; out.refresh_seconds = null; } else { out.playlist_id = null; }
  return out;
}

export async function openScreenForm(screen, onDone) {
  const refs = await loadRefs();
  const values = screen || { profile: 'MEDIA_PLAYER', status: 'active' };
  const { fields, updateProfile } = screenFields(refs, values);
  const m = formModal({
    title: screen ? `Editar ${screen.identifier}` : 'Nova TV',
    fields, values, wide: true,
    submit: async (v) => {
      const body = cleanScreenValues(v);
      const saved = screen ? await patch(`/screens/${screen.id}`, body) : await post('/screens', body);
      toast(screen ? 'TV atualizada' : 'TV cadastrada', 'success');
      if (onDone) onDone(saved);
    },
  });
  updateProfile(values.profile, m.form.inputs);
}

export async function openActivation(onDone) {
  const refs = await loadRefs();
  const [pending, screens] = await Promise.all([get('/screens/activations/pending'), get('/screens')]);
  const codeInput = h('input', { class: 'code-input', maxlength: 8, placeholder: 'ABC123', autocomplete: 'off' });
  const modeSel = h('select', null, h('option', { value: 'new' }, 'Cadastrar nova TV'),
    h('option', { value: 'existing' }, 'Vincular a uma TV já cadastrada'));
  const existingSel = h('select', null, screens.map((s) => h('option', { value: s.id },
    `${s.identifier} — ${s.name}${s.activated ? ' (substituir dispositivo)' : ''}`)));
  const existingWrap = h('div', { class: 'field hidden' }, h('label', null, 'TV'), existingSel);
  const { fields, updateProfile } = screenFields(refs, { profile: 'MEDIA_PLAYER' });
  const form = buildForm(fields.filter((f) => f.name !== 'status'), { profile: 'MEDIA_PLAYER' });
  updateProfile('MEDIA_PLAYER', form.inputs);
  const newWrap = h('div', null, form.el);
  modeSel.addEventListener('change', () => {
    newWrap.classList.toggle('hidden', modeSel.value !== 'new');
    existingWrap.classList.toggle('hidden', modeSel.value !== 'existing');
  });
  if (!screens.length) modeSel.disabled = true;

  const pendingList = pending.length
    ? h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Códigos aguardando:'),
      pending.map((p) => h('button', { class: 'btn sm mono', type: 'button', title: `IP ${p.request_ip || '-'} · ${p.user_agent || ''}`,
        onclick: () => { codeInput.value = p.code; } }, p.code)))
    : h('div', { class: 'muted small' }, 'Nenhum código pendente no momento. Abra o player na TV para gerar um.');
  const err = h('div', { class: 'error-text hidden' });

  const m = modal({
    title: 'Ativar TV', wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert info' }, 'Na TV, abra ', h('b', { class: 'mono' }, `${location.origin}/player`),
        '. O código de 6 caracteres exibido na tela deve ser informado abaixo. O código expira e só pode ser usado uma vez.'),
      h('div', { class: 'field' }, h('label', null, 'Código exibido na TV'), codeInput), pendingList,
      h('div', { class: 'field' }, h('label', null, 'Destino'), modeSel), existingWrap, newWrap, err),
    actions: [
      (close) => btn('Cancelar', () => close()),
      (close) => btn('Ativar', async () => {
        err.classList.add('hidden');
        const body = { code: codeInput.value.trim() };
        if (modeSel.value === 'existing') body.screen_id = Number(existingSel.value);
        else {
          const v = cleanScreenValues(form.values());
          v.status = 'active';
          body.screen = v;
        }
        try {
          const s = await post('/screens/activate', body);
          toast(`${s.identifier} ativada. A TV iniciará a programação em instantes.`, 'success');
          close();
          if (onDone) onDone(s);
        } catch (e) {
          err.textContent = e.message;
          err.classList.remove('hidden');
        }
      }, { cls: 'primary', ico: 'key' }),
    ],
  });
  return m;
}

export async function openScreenDetail(id, onChange) {
  let s = await get(`/screens/${id}`);
  const body = h('div');
  const tabsEl = h('div', { class: 'tabs' });
  const pane = h('div');
  let current = 'info';
  const tabs = [
    ['info', 'Detalhes'],
    ['schedule', 'Programação'],
    ['commands', 'Comandos remotos'],
    ['history', 'Histórico'],
  ];
  const changed = async () => { s = await get(`/screens/${id}`); renderHead(); renderTab(); if (onChange) onChange(); };
  const head = h('div', { class: 'row', style: 'margin-bottom:12px' });

  function renderHead() {
    const actions = [];
    if (session.can('admin')) {
      actions.push(btn('Editar', () => openScreenForm(s, changed), { cls: 'sm' }));
      if (s.activated) {
        actions.push(btn('Revogar dispositivo', async () => {
          if (!await confirmDialog('Revogar dispositivo', `A TV ${s.identifier} perderá o acesso e voltará a exibir um código de ativação.`, { danger: true, okLabel: 'Revogar' })) return;
          try { await post(`/screens/${s.id}/revoke`); toast('Dispositivo revogado', 'success'); changed(); } catch (e) { toastError(e); }
        }, { cls: 'sm danger' }));
      }
      actions.push(btn('Excluir', async () => {
        if (!await confirmDialog('Excluir TV', `Excluir ${s.identifier} — ${s.name}? Esta ação não pode ser desfeita.`, { danger: true, okLabel: 'Excluir' })) return;
        try { await del(`/screens/${s.id}`); toast('TV excluída', 'success'); m.close(); if (onChange) onChange(); } catch (e) { toastError(e); }
      }, { cls: 'sm danger', ico: 'trash' }));
    }
    clear(head, statusBadge(s), h('span', { class: 'badge primary' }, PROFILES[s.profile]),
      s.in_sync ? h('span', { class: 'badge success' }, 'Configuração sincronizada')
        : (s.activated ? h('span', { class: 'badge warning' }, 'Sincronização pendente') : null),
      h('div', { class: 'grow' }), actions);
  }

  function renderTabs() {
    clear(tabsEl, tabs.map(([k, l]) => h('button', { class: k === current ? 'active' : '', onclick: () => { current = k; renderTabs(); renderTab(); } }, l)));
  }

  async function renderTab() {
    clear(pane, h('div', { class: 'muted' }, 'Carregando…'));
    try {
      if (current === 'info') clear(pane, infoPane(s));
      if (current === 'schedule') clear(pane, await schedulePane(s, changed));
      if (current === 'commands') clear(pane, await commandsPane(s));
      if (current === 'history') clear(pane, await historyPane(s));
    } catch (e) { clear(pane, h('div', { class: 'error-text' }, e.message)); }
  }

  clear(body, head, tabsEl, pane);
  renderHead(); renderTabs(); renderTab();
  const m = modal({ title: `${s.identifier} — ${s.name}`, body, wide: true });
  const timer = setInterval(async () => {
    if (!document.body.contains(body)) { clearInterval(timer); return; }
    try { s = await get(`/screens/${id}`); renderHead(); if (current === 'info') clear(pane, infoPane(s)); } catch { /* ignora */ }
  }, 15000);
}

function infoPane(s) {
  const st = s.storage_info || {};
  const kv = (k, v) => [h('dt', null, k), h('dd', null, v === null || v === undefined || v === '' ? '—' : v)];
  return h('dl', { class: 'kv' },
    kv('Identificação', h('span', { class: 'mono' }, s.identifier)),
    kv('Nome', s.name), kv('Localização', s.location), kv('Setor', s.department),
    kv('Grupo', s.group ? s.group.name : null), kv('Perfil', PROFILES[s.profile]),
    kv('Programado', s.effective_content || 'Nada programado'),
    kv('Exibindo agora', s.online ? `${PLAYBACK[s.playback_state] || s.playback_state || '—'}${s.current_content ? ' · ' + s.current_content : ''}` : 'Offline'),
    kv('Último contato', s.last_seen_at ? `${fmtAgo(s.last_seen_at)} (${fmtDate(s.last_seen_at)})` : 'nunca'),
    kv('Versão do player', s.player_version), kv('Conexão', s.connection_state),
    kv('IP', s.last_ip), kv('Navegador', s.user_agent),
    kv('Armazenamento local', st.usage !== undefined ? `${fmtBytes(st.usage)} de ${fmtBytes(st.quota)}${st.downloading ? ' · baixando ' + st.downloading : ''}` : null),
    kv('Último erro', s.last_error ? `${s.last_error} (${fmtDate(s.last_error_at)})` : null),
    kv('Ativada em', fmtDate(s.activated_at)), kv('Token expira em', fmtDate(s.token_expires_at)),
    kv('Cadastrada em', fmtDate(s.created_at)), kv('Descrição', s.description));
}

async function schedulePane(s, changed) {
  if (s.profile !== 'MEDIA_PLAYER') {
    return h('div', { class: 'stack' },
      h('p', { style: 'margin:0' }, 'Esta TV tem perfil ', h('b', null, PROFILES[s.profile]), ' e exibe: ',
        h('b', null, s.dashboard ? s.dashboard.name : 'nenhum dashboard selecionado'), '.'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Alterar o perfil ou o dashboard é uma ação administrativa (botão Editar).'));
  }
  const playlists = await get('/playlists');
  const sel = h('select', null, h('option', { value: '' }, s.group ? `— usar a do grupo ${s.group.name} —` : '— nenhuma —'),
    playlists.map((p) => h('option', { value: p.id }, `${p.name}${p.is_active ? '' : ' (inativa)'} · ${p.items.length} itens`)));
  sel.value = s.playlist_id || '';
  return h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', null, 'Playlist desta TV'), sel,
      h('div', { class: 'help' }, 'A TV baixa todos os arquivos antes de trocar e só muda ao terminar o item em exibição.')),
    session.can('operator')
      ? h('div', null, btn('Salvar programação', async () => {
        try {
          await put(`/screens/${s.id}/playlist`, { playlist_id: sel.value ? Number(sel.value) : null });
          toast('Programação atualizada', 'success');
          changed();
        } catch (e) { toastError(e); }
      }, { cls: 'primary' }))
      : h('div', { class: 'muted small' }, 'Somente operadores e administradores podem alterar a programação.'));
}

async function commandsPane(s) {
  const list = h('div');
  async function refresh() {
    const cmds = await get(`/screens/${s.id}/commands`);
    clear(list, cmds.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Comando', 'Status', 'Enviado', 'Concluído', 'Resultado'].map((t) => h('th', null, t)))),
      h('tbody', null, cmds.map((c) => h('tr', null,
        h('td', null, COMMANDS[c.command] || c.command),
        h('td', null, h('span', { class: `badge ${c.status === 'done' ? 'success' : c.status === 'failed' || c.status === 'expired' ? 'danger' : 'warning'}` }, c.status)),
        h('td', { class: 'nowrap' }, fmtDate(c.created_at)),
        h('td', { class: 'nowrap' }, fmtDate(c.completed_at)),
        h('td', null, c.result || '—')))))) : emptyState('Nenhum comando enviado.'));
  }
  await refresh();
  const buttons = session.can('operator') && s.activated
    ? h('div', { class: 'row' }, Object.entries(COMMANDS).map(([k, l]) => btn(l, async () => {
      if (k === 'clear_cache' && !await confirmDialog('Limpar cache', 'A TV apagará as mídias baixadas e fará o download novamente.')) return;
      try { await post(`/screens/${s.id}/commands`, { command: k }); toast('Comando enviado. Será executado no próximo contato da TV.', 'success'); refresh(); } catch (e) { toastError(e); }
    }, { cls: 'sm' })))
    : h('div', { class: 'muted small' }, s.activated ? 'Somente operadores e administradores podem enviar comandos.' : 'A TV ainda não foi ativada.');
  return h('div', { class: 'stack' }, buttons,
    h('div', { class: 'muted small' }, 'Os comandos são entregues no próximo heartbeat (até 30 segundos) e expiram em 10 minutos.'), list);
}

async function historyPane(s) {
  const rows = await get(`/screens/${s.id}/heartbeats?limit=200`);
  const reasons = { online: 'Voltou a ficar online', error: 'Erro', state_change: 'Mudança de estado', periodic: 'Periódico' };
  if (!rows.length) return emptyState('Sem registros de comunicação.');
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Data', 'Evento', 'Estado', 'Conteúdo', 'Versão', 'IP', 'Erro'].map((t) => h('th', null, t)))),
    h('tbody', null, rows.map((r) => h('tr', null,
      h('td', { class: 'nowrap' }, fmtDate(r.created_at)), h('td', null, reasons[r.reason] || r.reason),
      h('td', null, PLAYBACK[r.playback_state] || r.playback_state || '—'), h('td', null, r.current_content || '—'),
      h('td', null, r.player_version || '—'), h('td', { class: 'mono small' }, r.ip || '—'),
      h('td', { class: 'error-text small' }, r.error || ''))))));
}

export async function render(root) {
  const groups = await get('/groups');
  const q = h('input', { type: 'search', placeholder: 'Buscar nome, identificação, local…' });
  const groupSel = h('select', null, h('option', { value: '' }, 'Todos os grupos'), groups.map((g) => h('option', { value: g.id }, g.name)));
  const profileSel = h('select', null, h('option', { value: '' }, 'Todos os perfis'), Object.entries(PROFILES).map(([k, l]) => h('option', { value: k }, l)));
  const statusSel = h('select', null, h('option', { value: '' }, 'Qualquer status'), h('option', { value: 'online' }, 'Online'),
    h('option', { value: 'offline' }, 'Offline'), h('option', { value: 'pending' }, 'Não ativadas'));
  const tableWrap = h('div');

  const actions = session.can('admin')
    ? [btn('Ativar TV', () => openActivation(load).catch(toastError), { cls: 'primary', ico: 'key' }),
      btn('Nova TV', () => openScreenForm(null, load).catch(toastError), { ico: 'plus' })]
    : [];
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'TVs'), h('div', { class: 'grow' }), actions),
    h('div', { class: 'toolbar' }, q, groupSel, profileSel, statusSel),
    tableWrap);

  async function load() {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set('q', q.value.trim());
    if (groupSel.value) params.set('group_id', groupSel.value);
    if (profileSel.value) params.set('profile', profileSel.value);
    if (statusSel.value === 'online') params.set('online', 'true');
    if (statusSel.value === 'offline') { params.set('online', 'false'); params.set('activated', 'true'); }
    if (statusSel.value === 'pending') params.set('activated', 'false');
    const list = await get('/screens?' + params.toString());
    if (!list.length) { clear(tableWrap, h('div', { class: 'table-wrap' }, emptyState('Nenhuma TV encontrada.'))); return; }
    clear(tableWrap, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['TV', 'Nome', 'Grupo', 'Perfil', 'Status', 'Conteúdo', 'Último contato', 'Player'].map((t) => h('th', null, t)))),
      h('tbody', null, list.map((s) => h('tr', { class: `clickable ${s.activated && !s.online ? 'offline' : ''}`, onclick: () => openScreenDetail(s.id, load).catch(toastError) },
        h('td', { class: 'mono nowrap' }, s.identifier),
        h('td', null, h('div', null, s.name), h('div', { class: 'muted small' }, [s.location, s.department].filter(Boolean).join(' · '))),
        h('td', null, s.group ? s.group.name : '—'),
        h('td', null, PROFILES[s.profile]),
        h('td', null, statusBadge(s)),
        h('td', null, s.effective_content || h('span', { class: 'muted' }, 'Nada programado')),
        h('td', { class: 'nowrap', title: s.last_seen_at || '' }, fmtAgo(s.last_seen_at)),
        h('td', { class: 'muted small' }, s.player_version || '—')))))));
  }
  const reload = debounce(() => load().catch(toastError), 250);
  q.addEventListener('input', reload);
  [groupSel, profileSel, statusSel].forEach((el) => el.addEventListener('change', reload));
  await load();
  const timer = setInterval(() => load().catch(() => {}), 20000);
  return () => clearInterval(timer);
}

