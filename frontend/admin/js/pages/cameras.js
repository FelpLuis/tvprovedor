import { get, post, patch, del } from '../api.js';
import { h, clear, btn, formModal, confirmDialog, toast, toastError, emptyState } from '../ui.js';
import { session } from '../session.js';

const STREAMS = [['sub', 'Extra (substream) — recomendado para mosaico'], ['main', 'Principal (maior qualidade)']];
const BRANDS = [['intelbras', 'Intelbras / Dahua (câmera, NVR ou DVR)'], ['rtsp', 'Outra marca (RTSP genérico)']];

function fields(isEdit) {
  return [
    { name: 'name', label: 'Nome', required: true, placeholder: 'Portaria' },
    { name: 'location', label: 'Local', placeholder: 'Entrada principal' },
    { name: 'brand', label: 'Equipamento', type: 'select', options: BRANDS, full: true },
    { name: 'host', label: 'IP ou nome na rede local', required: true, placeholder: '192.168.1.108',
      help: 'Endereço que a TV usa para alcançar a câmera/NVR (mesma rede das TVs).' },
    { name: 'port', label: 'Porta RTSP', type: 'number', min: 1, max: 65535, default: 554 },
    { name: 'username', label: 'Usuário', placeholder: 'visualizador', help: 'Use um usuário só de visualização no NVR.' },
    { name: 'password', label: isEdit ? 'Senha (vazio = manter)' : 'Senha', type: 'password', autocomplete: 'new-password', omitEmpty: isEdit },
    { name: 'channel', label: 'Canal', type: 'number', min: 1, max: 256, default: 1, help: 'Câmera avulsa: 1. NVR/DVR: número do canal.' },
    { name: 'stream', label: 'Fluxo', type: 'select', options: STREAMS },
    { name: 'rtsp_path', label: 'Caminho RTSP (só outra marca)', placeholder: '/stream1', full: true,
      help: 'Deixe vazio para Intelbras/Dahua (/cam/realmonitor?channel=N&subtype=…).' },
    { name: 'is_active', label: 'Ativa', type: 'checkbox', default: true },
    { name: 'notes', label: 'Observações', type: 'textarea', full: true },
  ];
}

function openForm(cam, onDone) {
  formModal({
    title: cam ? `Editar ${cam.name}` : 'Nova câmera', wide: true, fields: fields(!!cam),
    values: cam || { brand: 'intelbras', port: 554, channel: 1, stream: 'sub', is_active: true },
    submit: async (v) => {
      if (cam) await patch(`/cameras/${cam.id}`, v); else await post('/cameras', v);
      toast('Câmera salva', 'success');
      onDone();
    },
  });
}

/** Cadastra de uma vez todos os canais de um NVR/DVR Intelbras. */
function openNvr(onDone) {
  formModal({
    title: 'Cadastrar canais de um NVR/DVR', wide: true,
    values: { port: 554, first: 1, count: 8, stream: 'sub' },
    fields: [
      { name: 'prefix', label: 'Nome do NVR', required: true, placeholder: 'NVR Sede', help: 'As câmeras ficam como "NVR Sede — Canal 1", …' },
      { name: 'location', label: 'Local', placeholder: 'Sede' },
      { name: 'host', label: 'IP do NVR na rede local', required: true, placeholder: '192.168.1.100' },
      { name: 'port', label: 'Porta RTSP', type: 'number', min: 1, max: 65535 },
      { name: 'username', label: 'Usuário', placeholder: 'visualizador' },
      { name: 'password', label: 'Senha', type: 'password', autocomplete: 'new-password' },
      { name: 'first', label: 'Primeiro canal', type: 'number', min: 1, max: 256 },
      { name: 'count', label: 'Quantidade de canais', type: 'number', min: 1, max: 64 },
      { name: 'stream', label: 'Fluxo', type: 'select', options: STREAMS, full: true },
    ],
    submit: async (v) => {
      for (let i = 0; i < v.count; i++) {
        const ch = v.first + i;
        await post('/cameras', { name: `${v.prefix} — Canal ${ch}`, location: v.location, brand: 'intelbras', host: v.host,
          port: v.port, username: v.username, password: v.password || null, channel: ch, stream: v.stream });
      }
      toast(`${v.count} canais cadastrados. Renomeie cada um para facilitar (ex.: "Portaria").`, 'success', 7000);
      onDone();
    },
  });
}

export async function render(root) {
  const wrap = h('div');
  const admin = session.can('admin');
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Câmeras (CFTV)'), h('div', { class: 'grow' }),
      admin ? btn('Cadastrar NVR/DVR', () => openNvr(load), { ico: 'plus' }) : null,
      admin ? btn('Nova câmera', () => openForm(null, load), { cls: 'primary', ico: 'plus' }) : null),
    h('div', { class: 'alert info', style: 'margin-bottom:16px' },
      'As câmeras são exibidas pelo app UpDown Digital direto da rede local (RTSP): o vídeo não passa pelo servidor. ',
      'Cadastre o endereço que a TV alcança. Para exibir, crie uma TV com o perfil ', h('b', null, 'Câmeras (CFTV)'), ' e escolha as câmeras.'),
    wrap);
  async function load() {
    const cams = await get('/cameras');
    if (!cams.length) { clear(wrap, h('div', { class: 'table-wrap' }, emptyState('Nenhuma câmera cadastrada.'))); return; }
    clear(wrap, h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Câmera', 'Endereço RTSP', 'Fluxo', 'TVs', 'Status', ''].map((t) => h('th', null, t)))),
      h('tbody', null, cams.map((c) => h('tr', null,
        h('td', null, h('b', null, c.name), c.location ? h('div', { class: 'muted small' }, c.location) : null),
        h('td', { class: 'mono small', style: 'max-width:420px; word-break:break-all' }, c.rtsp_preview),
        h('td', null, c.stream === 'main' ? 'Principal' : 'Extra'),
        h('td', null, String(c.screen_count)),
        h('td', null, h('span', { class: `badge ${c.is_active ? 'success' : ''}` }, c.is_active ? 'Ativa' : 'Inativa')),
        h('td', { class: 'nowrap', style: 'text-align:right' },
          admin ? btn('Editar', () => openForm(c, load), { cls: 'sm' }) : null, ' ',
          admin ? btn('Excluir', async () => {
            if (!await confirmDialog('Excluir câmera', `Excluir "${c.name}"? Ela sai dos mosaicos das TVs.`, { danger: true, okLabel: 'Excluir' })) return;
            try { await del(`/cameras/${c.id}`); toast('Câmera excluída', 'success'); load(); } catch (e) { toastError(e); }
          }, { cls: 'sm danger' }) : null)))))));
  }
  await load();
}
