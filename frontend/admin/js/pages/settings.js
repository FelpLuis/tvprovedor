import { get, post } from '../api.js';
import { h, clear, buildForm, btn, toast, toastError, fmtBytes, ROLES } from '../ui.js';
import { session } from '../session.js';

export async function render(root) {
  const pwForm = buildForm([
    { name: 'current_password', label: 'Senha atual', type: 'password', autocomplete: 'current-password', full: true },
    { name: 'new_password', label: 'Nova senha', type: 'password', autocomplete: 'new-password', full: true,
      help: 'Mínimo de 10 caracteres, combinando letras e números/símbolos. As outras sessões serão encerradas.' },
  ]);
  const info = h('div');
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Configurações')),
    h('div', { class: 'card' }, h('h2', null, 'Minha conta'),
      h('dl', { class: 'kv' }, h('dt', null, 'Usuário'), h('dd', null, session.user.username),
        h('dt', null, 'Perfil'), h('dd', null, ROLES[session.user.role]),
        h('dt', null, 'E-mail'), h('dd', null, session.user.email || '—'))),
    h('div', { class: 'card' }, h('h2', null, 'Alterar senha'), pwForm.el,
      h('div', { style: 'margin-top:12px' }, btn('Alterar senha', async () => {
        try {
          session.user = await post('/auth/change-password', pwForm.values());
          Object.values(pwForm.inputs).forEach(({ el }) => { el.value = ''; });
          toast('Senha alterada', 'success');
        } catch (e) { toastError(e); }
      }, { cls: 'primary' }))),
    info);

  if (session.can('admin')) {
    const s = await get('/system/info');
    const kv = (k, v) => [h('dt', null, k), h('dd', null, v)];
    clear(info, h('div', { class: 'card' }, h('h2', null, 'Sistema'),
      h('dl', { class: 'kv' },
        kv('Versão', s.version), kv('Ambiente', s.environment), kv('Banco de dados', s.database),
        kv('Heartbeat das TVs', `${s.heartbeat_interval_seconds}s`),
        kv('TV offline após', `${s.offline_after_seconds}s sem comunicação`),
        kv('Validade do código de ativação', `${Math.round(s.activation_code_ttl_seconds / 60)} min`),
        kv('Validade do token das TVs', `${s.device_token_days} dias (renovação automática)`),
        kv('Limite de upload', `imagens ${s.max_image_mb} MB · vídeos ${s.max_video_mb} MB`),
        kv('Armazenamento de mídias', `${fmtBytes(s.storage.media_bytes)} usados · ${fmtBytes(s.storage.disk_free_bytes)} livres de ${fmtBytes(s.storage.disk_total_bytes)}`)),
      h('p', { class: 'muted small', style: 'margin:12px 0 0' }, 'Estes parâmetros são definidos no arquivo .env do servidor (prefixo UDS_).')));
  }
}
