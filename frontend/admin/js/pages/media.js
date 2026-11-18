import { get, patch, del, upload } from '../api.js';
import { h, clear, btn, icon, modal, formModal, confirmDialog, toast, toastError, fmtBytes, fmtDate, fmtDuration, emptyState, debounce } from '../ui.js';
import { session } from '../session.js';

export function thumbFor(m) {
  if (m.has_thumbnail) return h('img', { src: `/api/media/${m.id}/thumbnail`, alt: '', loading: 'lazy' });
  return icon(m.kind === 'video' ? 'video' : 'image');
}

export function mediaCard(m, { onclick, selected } = {}) {
  return h('div', { class: `media-item ${selected ? 'selected' : ''}`, onclick, title: m.original_name },
    h('div', { class: 'thumb' }, thumbFor(m)),
    h('span', { class: `badge ${m.kind === 'video' ? 'primary' : ''} kind` }, m.kind === 'video' ? 'Vídeo' : 'Imagem'),
    h('div', { class: 'info' }, h('div', { class: 'name' }, m.original_name),
      h('div', { class: 'muted small' }, [fmtBytes(m.size_bytes), m.width ? `${m.width}×${m.height}` : null,
        m.kind === 'video' ? fmtDuration(m.duration_seconds) : null].filter(Boolean).join(' · '))));
}

function preview(m, onChange) {
  const el = m.kind === 'video'
    ? h('video', { src: `/api/media/${m.id}/file`, controls: true, preload: 'metadata', style: 'object-fit:contain' })
    : h('img', { src: `/api/media/${m.id}/file`, alt: m.original_name, style: 'object-fit:contain' });
  const kv = (k, v) => [h('dt', null, k), h('dd', null, v || '—')];
  const mm = modal({
    title: m.original_name, wide: true,
    body: h('div', { class: 'stack' }, h('div', { class: 'preview' }, el),
      h('dl', { class: 'kv' }, kv('Tipo', m.mime_type), kv('Tamanho', fmtBytes(m.size_bytes)),
        kv('Resolução', m.width ? `${m.width}×${m.height}` : null),
        kv('Duração', m.kind === 'video' ? fmtDuration(m.duration_seconds) : null),
        kv('Pasta', m.folder), kv('Enviado em', fmtDate(m.created_at)), kv('SHA-256', h('span', { class: 'mono small' }, m.sha256)))),
    actions: session.can('operator') ? [
      (close) => btn('Excluir', async () => {
        if (!await confirmDialog('Excluir mídia', `Excluir "${m.original_name}"?`, { danger: true, okLabel: 'Excluir' })) return;
        try { await del(`/media/${m.id}`); toast('Mídia excluída', 'success'); close(); onChange(); } catch (e) { toastError(e); }
      }, { cls: 'danger', ico: 'trash' }),
      (close) => btn('Renomear / mover', () => {
        close();
        formModal({
          title: 'Editar mídia', values: m,
          fields: [{ name: 'original_name', label: 'Nome', full: true }, { name: 'folder', label: 'Pasta', full: true }],
          submit: async (v) => { await patch(`/media/${m.id}`, v); toast('Mídia atualizada', 'success'); onChange(); },
        });
      }),
    ] : [],
  });
  return mm;
}

export async function render(root) {
  const q = h('input', { type: 'search', placeholder: 'Buscar por nome ou pasta…' });
  const kind = h('select', null, h('option', { value: '' }, 'Imagens e vídeos'), h('option', { value: 'image' }, 'Imagens'), h('option', { value: 'video' }, 'Vídeos'));
  const folder = h('select');
  const grid = h('div', { class: 'media-grid' });
  const count = h('span', { class: 'muted small' });

  const fileInput = h('input', { type: 'file', multiple: true, accept: '.jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4', class: 'hidden' });
  const folderInput = h('input', { placeholder: 'Pasta (opcional)', style: 'width:200px', list: 'uds-folders' });
  const folderList = h('datalist', { id: 'uds-folders' });
  const bar = h('div');
  const progress = h('div', { class: 'progress hidden' }, bar);
  const status = h('div', { class: 'small' });
  const drop = h('div', { class: 'dropzone' },
    h('div', null, 'Arraste imagens (JPG, PNG, WEBP) e vídeos (MP4 H.264/AAC) aqui, ou '),
    h('div', { class: 'row', style: 'justify-content:center; margin-top:10px' },
      btn('Selecionar arquivos', () => fileInput.click(), { cls: 'primary', ico: 'plus' }), folderInput, folderList),
    progress, status, fileInput);

  async function send(files) {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('folder', folderInput.value.trim());
    progress.classList.remove('hidden');
    bar.style.width = '0%';
    status.textContent = `Enviando ${files.length} arquivo(s)…`;
    try {
      const res = await upload('/media', fd, (p) => { bar.style.width = `${Math.round(p * 100)}%`; status.textContent = p < 1 ? `Enviando… ${Math.round(p * 100)}%` : 'Processando no servidor…'; });
      const lines = [`${res.created.length} arquivo(s) enviado(s).`];
      res.errors.forEach((e) => lines.push(`✗ ${e.file}: ${e.error}`));
      res.warnings.forEach((w) => lines.push(`⚠ ${w.file}: ${w.warning}`));
      toast(lines.join('\n'), res.errors.length ? 'error' : 'success', 9000);
      status.textContent = '';
      load();
    } catch (e) {
      status.textContent = '';
      toastError(e);
    } finally {
      progress.classList.add('hidden');
      fileInput.value = '';
    }
  }
  fileInput.addEventListener('change', () => send([...fileInput.files]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); send([...e.dataTransfer.files]); });

  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Biblioteca de mídias'), h('div', { class: 'grow' }), count),
    session.can('operator') ? drop : null,
    h('div', { class: 'toolbar' }, q, kind, folder),
    grid);

  async function loadFolders() {
    const folders = await get('/media/folders');
    const cur = folder.value;
    clear(folder, h('option', { value: '__all' }, 'Todas as pastas'), h('option', { value: '' }, 'Sem pasta'),
      folders.map((f) => h('option', { value: f }, f)));
    folder.value = cur || '__all';
    clear(folderList, folders.map((f) => h('option', { value: f })));
  }

  async function load() {
    await loadFolders();
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    if (kind.value) p.set('kind', kind.value);
    if (folder.value !== '__all') p.set('folder', folder.value);
    const items = await get('/media?' + p.toString());
    count.textContent = `${items.length} arquivo(s)`;
    clear(grid, items.length ? items.map((m) => mediaCard(m, { onclick: () => preview(m, load) })) : emptyState('Nenhuma mídia encontrada.'));
  }
  const reload = debounce(() => load().catch(toastError));
  q.addEventListener('input', reload);
  kind.addEventListener('change', reload);
  folder.addEventListener('change', reload);
  await load();
}
