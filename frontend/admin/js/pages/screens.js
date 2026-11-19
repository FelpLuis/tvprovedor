import { get, post, patch, put, del } from '../api.js';
import {
  h, clear, btn, modal, formModal, confirmDialog, toast, toastError, buildForm,
  fmtAgo, fmtDate, fmtBytes, statusBadge, emptyState, debounce,
  PROFILES, PROFILE_KIND, COMMANDS, PLAYBACK, ORIENTATIONS, RESOLUTIONS, suggestResolution, WEEKDAYS,
} from '../ui.js';
import { session } from '../session.js';

async function loadRefs() {
  const [groups, playlists, dashboards, cameras] = await Promise.all([get('/groups'), get('/playlists'), get('/dashboards'), get('/cameras')]);
  return { groups, playlists, dashboards, cameras };
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
    { name: 'camera_ids', label: 'Câmeras do mosaico (na ordem em que forem marcadas)', type: 'multiselect', full: true,
      options: refs.cameras.filter((c) => c.is_active).map((c) => [c.id, `${c.name}${c.location ? ' — ' + c.location : ''}`]),
      empty: 'Nenhuma câmera cadastrada. Cadastre em Câmeras.' },
    { name: 'camera_layout', label: 'Mosaico', type: 'select', default: 'auto',
      options: [['auto', 'Automático (pela quantidade)'], ['1', '1 câmera'], ['4', '2 × 2'], ['9', '3 × 3'], ['16', '4 × 4']] },
    { name: 'camera_cycle_seconds', label: 'Rodízio de páginas (s)', type: 'number', min: 0, max: 3600, default: 0,
      help: 'Com mais câmeras que espaços no mosaico, troca de página neste intervalo. 0 = sem rodízio.' },
    { name: 'status', label: 'Status', type: 'select', options: [['active', 'Ativa'], ['disabled', 'Desativada']] },
    { name: 'description', label: 'Descrição', type: 'textarea', full: true },
    { type: 'section', label: 'Tela' },
    { name: 'orientation', label: 'Orientação', type: 'select', options: Object.entries(ORIENTATIONS),
      help: 'Retrato gira o conteúdo para TVs instaladas na vertical.' },
    { name: 'resolution_preset', label: 'Resolução de exibição', type: 'select', options: RESOLUTIONS,
      onchange: (v, inputs) => updateDisplay(inputs),
      help: 'O conteúdo é montado nesta resolução e ajustado à tela. Resoluções menores deixam tudo maior.' },
    { name: 'res_w', label: 'Largura (px)', type: 'number', min: 320, max: 7680 },
    { name: 'res_h', label: 'Altura (px)', type: 'number', min: 240, max: 4320 },
    { name: 'screen_inches', label: 'Tamanho da TV (polegadas)', type: 'number', min: 7, max: 150,
      onchange: (v, inputs) => updateDisplay(inputs), help: ' ' },
    { name: 'safe_margin_percent', label: 'Margem de segurança (%)', type: 'number', min: 0, max: 10, default: 0,
      help: 'Use 2% a 5% se a TV cortar as bordas (overscan). Confira com o comando "Identificar tela".' },
    { name: 'fullscreen', label: 'Tela cheia (modo quiosque)', type: 'checkbox', default: true, full: true,
      help: 'No app UpDown Digital a tela cheia é aplicada automaticamente. No navegador, é preciso pressionar OK uma vez.' },
  ];
  function updateDisplay(inputs) {
    const custom = inputs.resolution_preset.el.value === 'custom';
    inputs.res_w.el.closest('.field').classList.toggle('hidden', !custom);
    inputs.res_h.el.closest('.field').classList.toggle('hidden', !custom);
    const help = inputs.screen_inches.el.closest('.field').querySelector('.help');
    help.textContent = suggestResolution(Number(inputs.screen_inches.el.value)) || 'Para inventário e sugestão de resolução.';
  }
  function updateProfile(profile, inputs) {
    const isMedia = profile === 'MEDIA_PLAYER';
    const isCam = profile === 'CAMERA_PLAYER';
    inputs.playlist_id.el.closest('.field').classList.toggle('hidden', !isMedia);
    inputs.dashboard_id.el.closest('.field').classList.toggle('hidden', isMedia || isCam);
    inputs.refresh_seconds.el.closest('.field').classList.toggle('hidden', isMedia || isCam);
    ['camera_ids', 'camera_layout', 'camera_cycle_seconds'].forEach((k) => inputs[k].el.closest('.field').classList.toggle('hidden', !isCam));
    const sel = inputs.dashboard_id.el;
    const cur = sel.value;
    clear(sel, dashOpts(profile).map(([v, l]) => h('option', { value: v === null ? '' : v }, l)));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  }
  return { fields, updateProfile, updateDisplay };
}

/** Converte o valor salvo ("auto" | "LxA") nos campos do formulário. */
function displayValues(screen) {
  const res = (screen && screen.resolution) || 'auto';
  const known = RESOLUTIONS.some(([v]) => v === res);
  const out = { orientation: (screen && screen.orientation) || 'landscape', resolution_preset: known ? res : 'custom',
    fullscreen: screen ? screen.fullscreen !== false : true };
  if (!known) {
    const [w, hgt] = res.split('x').map(Number);
    out.res_w = w; out.res_h = hgt;
  }
  return out;
}

function cleanScreenValues(v) {
  const out = { ...v };
  if (out.resolution_preset === 'custom') {
    if (!out.res_w || !out.res_h) throw new Error('Informe largura e altura da resolução personalizada.');
    out.resolution = `${Math.max(out.res_w, out.res_h)}x${Math.min(out.res_w, out.res_h)}`;
  } else {
    out.resolution = out.resolution_preset || 'auto';
  }
  if (out.safe_margin_percent === null || out.safe_margin_percent === undefined) out.safe_margin_percent = 0;
  delete out.resolution_preset; delete out.res_w; delete out.res_h;
  if (out.profile === 'MEDIA_PLAYER') { out.dashboard_id = null; out.refresh_seconds = null; } else { out.playlist_id = null; }
  if (out.profile === 'CAMERA_PLAYER') { out.dashboard_id = null; out.refresh_seconds = null; }
  if (out.camera_cycle_seconds === null || out.camera_cycle_seconds === undefined) out.camera_cycle_seconds = 0;
  if (!out.camera_layout) out.camera_layout = 'auto';
  if (!Array.isArray(out.camera_ids)) out.camera_ids = [];
  return out;
}

export async function openScreenForm(screen, onDone) {
  const refs = await loadRefs();
  const values = { ...(screen || { profile: 'MEDIA_PLAYER', status: 'active' }), ...displayValues(screen) };
  const { fields, updateProfile, updateDisplay } = screenFields(refs, values);
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
  updateDisplay(m.form.inputs);
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
  const initial = { profile: 'MEDIA_PLAYER', ...displayValues(null) };
  const { fields, updateProfile, updateDisplay } = screenFields(refs, initial);
  const form = buildForm(fields.filter((f) => f.name !== 'status'), initial);
  updateProfile('MEDIA_PLAYER', form.inputs);
  updateDisplay(form.inputs);
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
        try {
          if (modeSel.value === 'existing') body.screen_id = Number(existingSel.value);
          else {
            const v = cleanScreenValues(form.values());
            v.status = 'active';
            body.screen = v;
          }
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
    ['power', 'Energia e som'],
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
      if (current === 'power') clear(pane, powerPane(s, changed));
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

function displayConfigured(s) {
  const res = s.resolution === 'auto' ? 'resolução automática' : `${s.resolution.replace('x', '×')}`;
  return [ORIENTATIONS[s.orientation] || s.orientation, res, s.screen_inches ? `${s.screen_inches}"` : null,
    s.safe_margin_percent ? `margem ${s.safe_margin_percent}%` : null, s.fullscreen === false ? 'sem tela cheia' : 'tela cheia']
    .filter(Boolean).join(' · ');
}

function displayDetected(d) {
  if (!d || !d.viewport) return null;
  const phys = d.dpr ? ` (≈ ${Math.round(d.viewport[0] * d.dpr)}×${Math.round(d.viewport[1] * d.dpr)} px físicos)` : '';
  const stage = d.logical ? ` · palco ${d.logical[0]}×${d.logical[1]}, escala ${d.scale}` : '';
  const client = d.client === 'app' ? `app ${d.app || ''} · ${d.device || ''} · Android ${d.android || '?'} · ` : (d.client ? 'navegador · ' : '');
  const setup = d.setup && d.setup !== 'ok' ? ` · permissões pendentes: ${d.setup}` : '';
  const upd = d.update ? ` · atualização: ${d.update}` : '';
  return `${client}${d.viewport[0]}×${d.viewport[1]} px · DPR ${d.dpr}${phys} · aparelho em ${d.device_orientation || "?"}${stage}${setup}${upd}`;
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
    kv('Tela configurada', displayConfigured(s)),
    kv('Tela detectada', displayDetected(s.display_info)),
    s.profile === 'CAMERA_PLAYER' ? kv('CFTV (informado pela TV)', (s.display_info || {}).cameras || (s.online ? 'sem informação (TV sem o app?)' : 'TV offline')) : null,
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

function powerPane(s, changed) {
  const canEdit = session.can('operator');
  const p = s.power || {};
  const d = s.display_info || {};
  const reported = !s.online ? 'sem contato' : (d.power === 'off' ? 'em espera' : 'ligada');
  const control = d.client === 'app'
    ? (d.power_control === 'device_admin' ? 'espera real (tela apagada; com HDMI-CEC a TV também desliga)' : 'tela preta (libere o controle de energia com o script de instalação)')
    : (d.client ? 'navegador: apenas tela preta' : '—');
  const act = (action, label, cls) => btn(label, async () => {
    try { await post(`/screens/${s.id}/power`, { action }); toast('Enviado. A TV aplica em até 1 minuto.', 'success'); changed(); } catch (e) { toastError(e); }
  }, { cls: `sm ${cls || ''}`, disabled: !canEdit });

  // editor de horário
  const sched = s.power_schedule || { enabled: false, slots: [] };
  const enabled = h('input', { type: 'checkbox', checked: !!sched.enabled });
  const slotsEl = h('div', { class: 'stack', style: 'gap:8px' });
  const slots = (sched.slots && sched.slots.length ? sched.slots : [{ days: [0, 1, 2, 3, 4], on: '07:00', off: '19:00' }])
    .map((x) => ({ ...x, days: [...x.days] }));
  function drawSlots() {
    clear(slotsEl, slots.map((slot, i) => h('div', { class: 'row', style: 'gap:6px' },
      WEEKDAYS.map((name, day) => {
        const cb = h('input', { type: 'checkbox', checked: slot.days.includes(day), disabled: !canEdit });
        cb.addEventListener('change', () => {
          slot.days = cb.checked ? [...new Set([...slot.days, day])].sort() : slot.days.filter((x) => x !== day);
        });
        return h('label', { class: 'check small' }, cb, name);
      }),
      h('span', { class: 'muted small' }, 'liga'),
      (() => { const t = h('input', { type: 'time', value: slot.on, style: 'width:auto', disabled: !canEdit }); t.addEventListener('change', () => { slot.on = t.value; }); return t; })(),
      h('span', { class: 'muted small' }, 'desliga'),
      (() => { const t = h('input', { type: 'time', value: slot.off, style: 'width:auto', disabled: !canEdit }); t.addEventListener('change', () => { slot.off = t.value; }); return t; })(),
      canEdit ? btn('', () => { slots.splice(i, 1); drawSlots(); }, { cls: 'ghost icon-only sm danger', ico: 'trash', title: 'Remover faixa' }) : null)));
  }
  drawSlots();

  // volume
  const volCtl = h('input', { type: 'checkbox', checked: s.volume !== null && s.volume !== undefined, disabled: !canEdit });
  const vol = h('input', { type: 'range', min: 0, max: 100, value: s.volume ?? 50, style: 'width:240px', disabled: !canEdit });
  const volLabel = h('span', { class: 'mono' }, `${vol.value}%`);
  vol.addEventListener('input', () => { volLabel.textContent = `${vol.value}%`; });

  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: `badge ${p.state === 'off' ? '' : 'success'}` }, h('span', { class: 'dot' }), p.state === 'off' ? 'Desligada (espera)' : 'Ligada'),
        h('span', null, p.reason || ''), h('div', { class: 'grow' }),
        act('on', 'Ligar agora', 'primary'), act('off', 'Desligar agora', 'danger'),
        p.source === 'manual' ? act('auto', 'Voltar ao automático') : null),
      h('dl', { class: 'kv small', style: 'margin-top:12px' },
        h('dt', null, 'Estado informado pela TV'), h('dd', null, reported),
        h('dt', null, 'Controle de energia'), h('dd', null, control),
        h('dt', null, 'Volume atual da TV'), h('dd', null, d.volume !== undefined ? `${d.volume}%` : '—'))),
    h('div', { class: 'card' },
      h('h3', null, 'Horário de funcionamento'),
      h('label', { class: 'check' }, enabled, 'Ligar e desligar automaticamente nestes horários'),
      h('div', { class: 'muted small', style: 'margin:6px 0 10px' }, 'Fora das faixas a TV fica em espera. Faixas em que o horário de desligar é menor que o de ligar atravessam a meia-noite. "Ligar/Desligar agora" vale até a próxima mudança do horário.'),
      slotsEl,
      canEdit ? h('div', { class: 'row', style: 'margin-top:10px' },
        btn('Adicionar faixa', () => { slots.push({ days: [5], on: '08:00', off: '12:00' }); drawSlots(); }, { cls: 'sm', ico: 'plus' }),
        btn('Salvar horário', async () => {
          const bad = slots.find((x) => !x.days.length || !x.on || !x.off || x.on === x.off);
          if (bad) { toastError(new Error('Cada faixa precisa de pelo menos um dia e horários diferentes de ligar e desligar.')); return; }
          try { await put(`/screens/${s.id}/power-schedule`, { enabled: enabled.checked, slots }); toast('Horário salvo', 'success'); changed(); } catch (e) { toastError(e); }
        }, { cls: 'sm primary' })) : null),
    h('div', { class: 'card' },
      h('h3', null, 'Som'),
      h('div', { class: 'row' }, h('label', { class: 'check' }, volCtl, 'Definir o volume da TV'), vol, volLabel,
        canEdit ? btn('Salvar volume', async () => {
          try { await put(`/screens/${s.id}/volume`, { volume: volCtl.checked ? Number(vol.value) : null }); toast('Volume enviado', 'success'); changed(); } catch (e) { toastError(e); }
        }, { cls: 'sm primary' }) : null),
      h('div', { class: 'muted small', style: 'margin-top:6px' }, 'No app Android o volume do aparelho é ajustado; no navegador, apenas o volume dos vídeos.')));
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

/** Instruções do app Android TV: instalação sem ADB, sem depender do IP da TV. */
export function openAppInfo() {
  const apk = `${location.origin}/app/updown-digital.apk`;
  const short = `${location.host}/apk`;
  const code = (txt) => h('pre', { class: 'mono small', style: 'margin:0; padding:10px; background:var(--bg); border:1px solid var(--border); border-radius:8px; white-space:pre-wrap; word-break:break-all' }, txt);
  const step = (n, title, ...body) => h('div', { class: 'stack', style: 'gap:6px' }, h('h3', { style: 'margin:8px 0 0' }, `${n}. ${title}`), ...body);
  modal({
    title: 'App Android TV — UpDown Digital', wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert info' }, h('b', null, 'O IP da TV não importa. '),
        'Depois de instalado, é a TV que se conecta a ', h('b', null, location.host), ' pela internet; ',
        'o gerenciador nunca precisa do IP nem de acesso à rede das TVs. IP dinâmico, outra rede ou outra filial funcionam normalmente.'),
      h('div', null, h('a', { class: 'btn primary', href: apk, download: 'updown-digital.apk' }, 'Baixar APK'),
        h('span', { class: 'muted small', style: 'margin-left:10px' }, apk)),
      step(1, 'Instalar na TV (uma única vez, sem ADB)',
        h('p', { class: 'small', style: 'margin:0' }, h('b', null, 'Opção A — app Downloader: '),
          'na Play Store da TV, instale o app gratuito "Downloader". Abra-o e digite o endereço curto abaixo; quando o download terminar, toque em Instalar (permita "fontes desconhecidas" para o Downloader se for pedido).'),
        code(short),
        h('p', { class: 'small', style: 'margin:0' }, h('b', null, 'Opção B — pen drive: '),
          'copie o APK para um pen drive e abra-o na TV com um gerenciador de arquivos.')),
      step(2, 'Configurar pelo controle remoto',
        h('p', { class: 'small', style: 'margin:0' }, 'Abra o app UpDown Digital. Ele pergunta, uma vez, as permissões para: abrir sozinho ao ligar a TV, ligar/desligar pelo gerenciador, religar no horário, atualizar-se sozinho e virar a tela inicial (modo quiosque). Basta confirmar com OK. ',
          'Se algo for recusado, envie o comando ', h('b', null, 'Configurar app na TV'), ' nos detalhes da TV.')),
      step(3, 'Ativar no gerenciador',
        h('p', { class: 'small', style: 'margin:0' }, 'A TV mostra um código: use ', h('b', null, 'Ativar TV'), ' e defina orientação, resolução, tela cheia, horário e volume.')),
      step(4, 'Atualizações',
        h('p', { class: 'small', style: 'margin:0' }, 'O app procura versões novas no servidor ao abrir e a cada 6 horas, e se atualiza sozinho (algumas TVs pedem um OK na tela). ',
          'Para forçar, envie o comando ', h('b', null, 'Atualizar app'), '.')),
      h('details', null, h('summary', { class: 'small muted' }, 'Avançado: instalação em lote por ADB (opcional)'),
        h('p', { class: 'small', style: 'margin:8px 0' }, 'Para preparar muitas TVs de uma vez, num notebook na mesma rede das TVs (só durante a instalação):'),
        code('scripts/instalar_tv.sh IP_DA_TV --quiosque')),
      h('div', { class: 'alert small' }, 'Para sair do app na manutenção, pressione VOLTAR 5 vezes seguidas.')),
  });
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
    ? [btn('App Android TV', () => openAppInfo(), { ico: 'tv' }),
      btn('Ativar TV', () => openActivation(load).catch(toastError), { cls: 'primary', ico: 'key' }),
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
        h('td', null, h('div', null, s.name), h('div', { class: 'muted small' }, [s.location, s.department, s.orientation !== 'landscape' ? ORIENTATIONS[s.orientation].split(' (')[0] : null, s.resolution !== 'auto' ? s.resolution.replace('x', '×') : null].filter(Boolean).join(' · '))),
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

