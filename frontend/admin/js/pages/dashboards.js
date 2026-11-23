import { get, post, patch, del } from '../api.js';
import { h, clear, btn, formModal, confirmDialog, toast, toastError, emptyState, DASH_KINDS } from '../ui.js';
import { session } from '../session.js';

const AUTH = [
  ['none', 'Sem autenticação (rede interna / público)'],
  ['login_form', 'Login e senha (o app entra sozinho na tela de login)'],
  ['http_basic', 'Autenticação HTTP (janela de usuário e senha do navegador)'],
  ['public_embed', 'Link de incorporação oficial'],
  ['browser_session', 'Sessão já autenticada no navegador da TV'],
];
const MODES = [
  ['proxy', 'Dentro do player, via servidor (recomendado: UpDown BI, páginas com login ou que bloqueiam iframe)'],
  ['iframe', 'Dentro do player, direto (páginas públicas que permitem iframe)'],
  ['redirect', 'Abrir página diretamente (perde o controle do player)'],
];

const GUIDE = {
  grafana: 'Grafana: use a URL do dashboard (/d/...). O modo kiosk é adicionado automaticamente. Para exibir sem login, use um usuário Viewer dedicado, snapshot público ou "public dashboards". Pode ser necessário habilitar allow_embedding=true no grafana.ini.',
  powerbi: 'Power BI: use o link oficial de incorporação (Arquivo → Inserir relatório → Site ou portal / Publicar na Web, conforme política e licenciamento). Não coloque usuário/senha na URL.',
  zabbix: 'Zabbix: use a URL do dashboard (zabbix.php?action=dashboard.view&dashboardid=N). O modo kiosk é adicionado automaticamente. Use uma conta somente leitura com privilégios mínimos.',
  updown_bi: 'UpDown BI: dashboards próprios alimentados pela API do IXC Soft (Fase 5). Informe a rota interna do dashboard.',
  other: 'Outro: qualquer página compatível com exibição em iframe.',
};

function fields(values, isEdit) {
  const guide = h('div', { class: 'alert info small full' }, GUIDE[values.kind || 'grafana']);
  return {
    guide,
    list: [
      { name: 'name', label: 'Nome', required: true },
      { name: 'kind', label: 'Plataforma', type: 'select', options: Object.entries(DASH_KINDS), onchange: (v) => { guide.textContent = GUIDE[v]; } },
      { name: 'url', label: 'URL', required: true, full: true, placeholder: 'https://grafana.updown.com.br/d/...' },
      { name: 'refresh_seconds', label: 'Recarregar a cada (s)', type: 'number', min: 0, default: 300, help: '0 = não recarregar' },
      { name: 'auth_type', label: 'Autenticação', type: 'select', options: AUTH, full: true,
        onchange: (v, inputs) => toggleAuth(v, inputs),
        help: 'Com "Login e senha", o app UpDown Digital preenche a tela de login e entra sozinho; a sessão fica salva e, se expirar, ele entra de novo.' },
      { name: 'username', label: 'Usuário', autocomplete: 'off', placeholder: 'tv.comercial', auth: true },
      { name: 'password', label: isEdit ? 'Senha (vazio = manter a atual)' : 'Senha', type: 'password', autocomplete: 'new-password', omitEmpty: isEdit, auth: true },
      { name: 'login_url', label: 'Página de login (opcional)', full: true, auth: true, placeholder: 'http://10.0.0.20:8080/login',
        help: 'Só se o login ficar em outro endereço: o app entra por ela e depois abre a URL do dashboard.' },
      { name: 'user_selector', label: 'Campo de usuário (avançado)', placeholder: '#email', auth: true,
        help: 'Seletor CSS; vazio = detectar sozinho.' },
      { name: 'submit_selector', label: 'Botão entrar (avançado)', placeholder: 'button[type=submit]', auth: true,
        help: 'Seletor CSS; vazio = detectar sozinho.' },
      { name: 'extra_hosts', label: 'Outros sites do login (avançado)', full: true, placeholder: 'login.exemplo.com.br, sso.fornecedor.com',
        help: 'Via servidor: sites do mesmo domínio do dashboard (ex.: portal.updown.com.br) já são aceitos. Informe aqui só portais de login de outros domínios.' },
      { name: 'display_mode', label: 'Modo de exibição', type: 'select', options: MODES, full: true,
        help: 'Via servidor: o UpDown Digital busca a página e a mostra dentro do player, sem o bloqueio de iframe, e o login é preenchido sozinho. A TV não precisa enxergar o BI; quem acessa é o servidor.' },
      { name: 'kiosk', label: 'Modo kiosk (Grafana/Zabbix)', type: 'checkbox', default: true },
      { name: 'theme', label: 'Tema (Grafana)', type: 'select', options: [['', 'Padrão'], ['dark', 'Escuro'], ['light', 'Claro']] },
      { name: 'load_timeout_seconds', label: 'Tempo limite de carregamento (s)', type: 'number', min: 10, default: 60 },
      { name: 'full_reload_hours', label: 'Recarga completa do player (h)', type: 'number', min: 1, default: 12 },
      { name: 'is_active', label: 'Ativo', type: 'checkbox', default: true },
      { name: 'notes', label: 'Observações', type: 'textarea', full: true },
    ],
  };
}

function toggleAuth(type, inputs) {
  const login = type === 'login_form' || type === 'http_basic';
  for (const [name, { el, def }] of Object.entries(inputs)) {
    if (!def.auth) continue;
    const onlyForm = ['login_url', 'user_selector', 'submit_selector'].includes(name);
    el.closest('.field').classList.toggle('hidden', !login || (onlyForm && type !== 'login_form'));
  }
}

function toBody(v, previous = {}) {
  const options = { ...(previous || {}) };
  const hosts = String(v.extra_hosts || '').split(/[\s,;]+/).map((x) => x.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  if (hosts.length) options.extra_hosts = hosts; else delete options.extra_hosts;
  delete v.extra_hosts;
  if (v.user_selector) options.user_selector = v.user_selector; else delete options.user_selector;
  if (v.submit_selector) options.submit_selector = v.submit_selector; else delete options.submit_selector;
  delete v.user_selector; delete v.submit_selector;
  options.kiosk = v.kiosk;
  if (v.theme) options.theme = v.theme; else delete options.theme;
  if (v.load_timeout_seconds) options.load_timeout_seconds = v.load_timeout_seconds;
  if (v.full_reload_hours) options.full_reload_hours = v.full_reload_hours;
  const { kiosk, theme, load_timeout_seconds, full_reload_hours, ...rest } = v;
  return { ...rest, refresh_seconds: v.refresh_seconds || 0, options };
}

function proxiedHref(d) {
  try { const u = new URL(d.url, location.origin); return `/dash/${d.id}${u.pathname}${u.search}`; } catch { return d.url; }
}

function openForm(d, onDone) {
  const values = d ? { ...d, ...d.options, extra_hosts: (d.options.extra_hosts || []).join(', '), kiosk: d.options.kiosk !== false } : { kind: 'updown_bi', auth_type: 'none', display_mode: 'proxy' };
  const f = fields(values, !!d);
  const m = formModal({
    title: d ? `Editar ${d.name}` : 'Novo dashboard', wide: true, fields: f.list, values, extra: f.guide,
    submit: async (v) => {
      const body = toBody(v, d && d.options);
      if (d) await patch(`/dashboards/${d.id}`, body); else await post('/dashboards', body);
      toast('Dashboard salvo', 'success');
      onDone();
    },
  });
  toggleAuth(values.auth_type || 'none', m.form.inputs);
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
          h('a', { class: 'btn sm', href: d.display_mode === 'proxy' ? proxiedHref(d) : d.url, target: '_blank', rel: 'noopener noreferrer',
            title: d.display_mode === 'proxy' ? 'Abre pelo proxy do servidor (como a TV vê)' : '' }, 'Abrir'), ' ',
          session.can('admin') ? btn('Editar', () => openForm(d, load), { cls: 'sm' }) : null, ' ',
          session.can('admin') ? btn('Excluir', async () => {
            if (!await confirmDialog('Excluir dashboard', `Excluir "${d.name}"?`, { danger: true, okLabel: 'Excluir' })) return;
            try { await del(`/dashboards/${d.id}`); toast('Dashboard excluído', 'success'); load(); } catch (e) { toastError(e); }
          }, { cls: 'sm danger' }) : null)))))));
  }
  await load();
}
