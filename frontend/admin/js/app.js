import { get, post, setUnauthorizedHandler, ApiError } from './api.js';
import { h, clear, icon, btn, toastError, ROLES } from './ui.js';
import { session } from './session.js';
import * as overview from './pages/overview.js';
import * as screens from './pages/screens.js';
import * as groups from './pages/groups.js';
import * as mediaPage from './pages/media.js';
import * as playlists from './pages/playlists.js';
import * as dashboards from './pages/dashboards.js';
import * as cameras from './pages/cameras.js';
import * as users from './pages/users.js';
import * as logs from './pages/logs.js';
import * as settings from './pages/settings.js';

const ROUTES = [
  { path: 'dashboard', label: 'Dashboard', icon: 'dashboard', page: overview },
  { path: 'tvs', label: 'TVs', icon: 'tv', page: screens },
  { path: 'grupos', label: 'Grupos', icon: 'group', page: groups },
  { path: 'midias', label: 'Mídias', icon: 'media', page: mediaPage },
  { path: 'playlists', label: 'Playlists', icon: 'playlist', page: playlists },
  { path: 'dashboards', label: 'Dashboards BI', icon: 'chart', page: dashboards },
  { path: 'cameras', label: 'Câmeras', icon: 'video', page: cameras },
  { path: 'usuarios', label: 'Usuários', icon: 'users', page: users, role: 'admin' },
  { path: 'logs', label: 'Logs', icon: 'log', page: logs, role: 'operator' },
  { path: 'configuracoes', label: 'Configurações', icon: 'settings', page: settings },
];

const app = document.getElementById('app');

// logotipo oficial UpDown Internet: versão clara no tema escuro e escura no tema claro
function brandMark() {
  return h('div', { class: 'brand' },
    h('img', { class: 'brand-logo on-dark', src: '/player/brand/logo-updown.png', alt: 'UpDown Internet', width: 353, height: 96 }),
    h('img', { class: 'brand-logo on-light', src: '/player/brand/logo-updown-dark.png', alt: 'UpDown Internet', width: 353, height: 96 }),
    h('span', { class: 'tag' }, 'Digital'));
}
let cleanup = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, ...rest] = raw.split('/');
  return { path: path || 'dashboard', params: rest };
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', cur);
  try { localStorage.setItem('uds.theme', cur); } catch { /* ignora */ }
}

function renderLogin(message) {
  if (cleanup) { cleanup(); cleanup = null; }
  const err = h('div', { class: 'error-text' }, message || '');
  const user = h('input', { name: 'username', autocomplete: 'username', required: true });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn primary', type: 'submit', style: 'justify-content:center; height:40px' }, 'Entrar');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      session.user = await post('/auth/login', { username: user.value.trim(), password: pass.value });
      if (!location.hash) location.hash = '#/dashboard';
      renderLayout();
    } catch (ex) {
      err.textContent = ex.message;
      pass.value = '';
      pass.focus();
    } finally {
      submit.disabled = false;
    }
  } },
  h('div', { class: 'field' }, h('label', null, 'Usuário ou e-mail'), user),
  h('div', { class: 'field' }, h('label', null, 'Senha'), pass),
  err, submit,
  h('p', { class: 'muted small', style: 'margin:0; text-align:center' },
    'Esqueceu a senha? Solicite a redefinição a um administrador.'));

  clear(app, h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' },
    brandMark(),
    form)));
  setTimeout(() => user.focus(), 30);
}

let layout = null;

function renderLayout() {
  const nav = h('nav', { class: 'nav' });
  const sidebar = h('aside', { class: 'sidebar' },
    brandMark(),
    nav,
    h('div', { class: 'foot' }, 'UpDown Digital · v0.1.0'));
  const content = h('main', { class: 'content' });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn ghost icon-only menu-btn', onclick: () => sidebar.classList.toggle('open'), 'aria-label': 'Menu' }, icon('menu')),
    h('div', { class: 'grow' }),
    h('div', { class: 'user' }, icon('users'), session.user.full_name || session.user.username,
      h('span', { class: 'badge' }, ROLES[session.user.role])),
    btn('', toggleTheme, { cls: 'ghost icon-only', ico: 'sun', title: 'Alternar tema' }),
    btn('Sair', logout, { cls: 'ghost', ico: 'logout' }));
  for (const r of ROUTES) {
    if (r.role && !session.can(r.role)) continue;
    nav.appendChild(h('a', { href: `#/${r.path}`, dataset: { path: r.path } }, icon(r.icon), r.label));
  }
  layout = { nav, content, sidebar };
  clear(app, h('div', { class: 'layout' }, sidebar, h('div', { class: 'main' }, topbar, content)));
  route();
}

async function logout() {
  try { await post('/auth/logout'); } catch { /* ignora */ }
  session.user = null;
  location.hash = '';
  renderLogin();
}

async function route() {
  if (!session.user || !layout) return;
  const { path, params } = parseHash();
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  for (const a of layout.nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.path === r.path);
  layout.sidebar.classList.remove('open');
  if (cleanup) { cleanup(); cleanup = null; }
  if (r.role && !session.can(r.role)) {
    clear(layout.content, h('div', { class: 'empty' }, 'Você não tem permissão para acessar esta página.'));
    return;
  }
  layout.content.classList.remove('page-enter');
  clear(layout.content, h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: 'height:56px; width:40%' }),
    h('div', { class: 'skeleton' }), h('div', { class: 'skeleton', style: 'height:220px' })));
  document.title = `${r.label} · UpDown Digital`;
  try {
    const ret = await r.page.render(layout.content, params);
    // entrada suave da página (cascata)
    void layout.content.offsetWidth;
    layout.content.classList.add('page-enter');
    if (typeof ret === 'function') cleanup = ret;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    clear(layout.content, h('div', { class: 'empty error-text' }, e.message || String(e)));
    toastError(e);
  }
}

setUnauthorizedHandler(() => {
  if (session.user) {
    session.user = null;
    renderLogin('Sua sessão expirou. Entre novamente.');
  }
});

window.addEventListener('hashchange', route);

(async function start() {
  try {
    session.user = await get('/auth/me');
    renderLayout();
  } catch {
    renderLogin();
  }
})();
