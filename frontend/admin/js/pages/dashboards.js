import { get, post, patch, del } from '../api.js';
import { h, clear, btn, formModal, confirmDialog, toast, toastError, emptyState, DASH_KINDS } from '../ui.js';
import { session } from '../session.js';

const AUTH = [
  ['none', 'Sem autenticação (rede interna / público)'],
  ['public_embed', 'Link de incorporação oficial'],
  ['browser_session', 'Sessão já autenticada no navegador da TV'],
];
const MODES = [['iframe', 'Dentro do player (recomendado)'], ['redirect', 'Abrir página diretamente (sites que bloqueiam iframe)']];

const GUIDE = {
  grafana: 'Grafana: use a URL do dashboard (/d/...). O modo kiosk é adicionado automaticamente. Para exibir sem login, use um usuário Viewer dedicado, snapshot público ou "public dashboards". Pode ser necessário habilitar allow_embedding=true no grafana.ini.',
  powerbi: 'Power BI: use o link oficial de incorporação (Arquivo → Inserir relatório → Site ou portal / Publicar na Web, conforme política e licenciamento). Não coloque usuário/senha na URL.',
  zabbix: 'Zabbix: use a URL do dashboard (zabbix.php?action=dashboard.view&dashboardid=N). O modo kiosk é adicionado automaticamente. Use uma conta somente leitura com privilégios mínimos.',
  updown_bi: 'UpDown BI: dashboards próprios alimentados pela API do IXC Soft (Fase 5). Informe a rota interna do dashboard.',
  other: 'Outro: qualquer página compatível com exibição em iframe.',
};

function fields(values) {
  const guide = h('div', { class: 'alert info small full' }, GUIDE[values.kind || 'grafana']);
  return {
    guide,
    list: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'kind', label: 'Plataforma', type: 'select', options: Object.entries(DASH_KINDS), onchange: (v) => { guide.textContent = GUIDE[v]; } },
      { name: 'url', label: 'URL', required: true, full: true, placeholder: 'https://grafana.updown.com.br/d/...' },
      { name: 'refresh_seconds', label: 'Recarregar a cada (s)', type: 'number', min: 0, default: 300, help: '0 = não recarregar' },
      { name: 'auth_type', label: 'Autenticação', type: 'select', options: AUTH },
      { name: 'display_mode', label: 'Modo de exibição', type: 'select', options: MODES, full: true,
        help: 'No modo direto, o player perde o controle da TV (sem heartbeat) até voltar para /player.' },
      { name: 'kiosk', label: 'Modo kiosk (Grafana/Zabbix)', type: 'checkbox', default: true },
      { name: 'theme', label: 'Tema (Grafana)', type: 'select', options: [['', 'Padrão'], ['dark', 'Escuro'], ['light', 'Claro']] },
      { name: 'load_timeout_seconds', label: 'Tempo limite de carregamento (s)', type: 'number', min: 10, default: 60 },
      { name: 'full_reload_hours', label: 'Recarga completa do player (h)', type: 'number', min: 1, default: 12 },
      { name: 'is_active', label: 'Ativo', type: 'checkbox', default: true },
      { name: 'notes', label: 'Observações', type: 'textarea', full: true },
    ],
  };
}

function toBody(v, previous = {}) {
  const options = { ...(previous || {}) };
  options.kiosk = v.kiosk;
  if (v.theme) options.theme = v.theme; else delete options.theme;
  if (v.load_timeout_seconds) options.load_timeout_seconds = v.load_timeout_seconds;
  if (v.full_reload_hours) options.full_reload_hours = v.full_reload_hours;
  const { kiosk, theme, load_timeout_seconds, full_reload_hours, ...rest } = v;
  return { ...rest, refresh_seconds: v.refresh_seconds || 0, options };
}

function openForm(d, onDone) {
  const values = d ? { ...d, ...d.options, kiosk: d.options.kiosk !== false } : { kind: 'grafana', auth_type: 'none', display_mode: 'iframe' };
  const f = fields(values);
  formModal({
    title: d ? `Editar ${d.name}` : 'Novo dashboard', wide: true, fields: f.list, values, extra: f.guide,
    submit: async (v) => {
      const body = toBody(v, d && d.options);
      if (d) await patch(`/dashboards/${d.id}`, body); else await post('/dashboards', body);
      toast('Dashboard salvo', 'success');
      onDone();
    },
  });
}

export async function render(root) {
  const wrap = h('div');
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Dashboards BI'), h('div', { class: 'grow' }),
      session.can('admin') ? btn('Novo dashboard', () => openForm(null, load), { cls: 'primary', ico: 'plus' }) : null),
    h('div', { class: 'alert', style: 'margin-bottom:16px' },
      'Credenciais de Grafana, Power BI, Zabbix e IXC nunca devem ficar na URL ou no player. ',
      'Use links de incorporação oficiais, contas de privilégio mínimo ou sessão autenticada no navegador da TV.'),
    wrap);
  async function load() {
    const ds = await get('/dashboards');
    if (!ds.length) { clear(wrap, h('div', { class: 'table-wrap' }, emptyState('Nenhum dashboard cadastrado.'))); return; }
    clear(wrap, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Nome', 'Plataforma', 'URL', 'Atualização', 'TVs', 'Status', ''].map((t) => h('th', null, t)))),
      h('tbody', null, ds.map((d) => h('tr', null,
        h('td', null, h('b', null, d.name)),
        h('td', null, h('span', { class: 'badge primary' }, DASH_KINDS[d.kind])),
        h('td', { class: 'small mono', style: 'max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap', title: d.url }, d.url),
        h('td', null, d.refresh_seconds ? `${d.refresh_seconds}s` : '—'),
        h('td', null, String(d.screen_count)),
        h('td', null, h('span', { class: `badge ${d.is_active ? 'success' : ''}` }, d.is_active ? 'Ativo' : 'Inativo')),
        h('td', { class: 'nowrap', style: 'text-align:right' },
          h('a', { class: 'btn sm', href: d.url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir'), ' ',
          session.can('admin') ? btn('Editar', () => openForm(d, load), { cls: 'sm' }) : null, ' ',
          session.can('admin') ? btn('Excluir', async () => {
            if (!await confirmDialog('Excluir dashboard', `Excluir "${d.name}"?`, { danger: true, okLabel: 'Excluir' })) return;
            try { await del(`/dashboards/${d.id}`); toast('Dashboard excluído', 'success'); load(); } catch (e) { toastError(e); }
          }, { cls: 'sm danger' }) : null)))))));
  }
  await load();
}
