import { get, post, patch, del } from '../api.js';
import {
  h, clear, btn, icon, modal, formModal, confirmDialog, toast, toastError, buildForm,
  fmtDuration, emptyState, debounce,
} from '../ui.js';
import { session } from '../session.js';
import { mediaCard, thumbFor } from './media.js';

const FIT = [['contain', 'Ajustar (mantém proporção, com bordas)'], ['cover', 'Preencher (corta o excesso)'], ['fill', 'Esticar (tela inteira)']];
const TRANSITION = [['fade', 'Esmaecer'], ['none', 'Sem transição']];

function playlistFields() {
  return [
    { name: 'name', label: 'Nome', required: true, full: true },
    { name: 'description', label: 'Descrição', type: 'textarea', full: true },
    { name: 'default_image_seconds', label: 'Duração padrão das imagens (s)', type: 'number', min: 1, default: 10 },
    { name: 'fit_mode', label: 'Ajuste à tela', type: 'select', options: FIT },
    { name: 'transition', label: 'Transição', type: 'select', options: TRANSITION },
    { name: 'is_active', label: 'Ativa', type: 'checkbox', default: true },
  ];
}

async function list(root) {
  const wrap = h('div');
  clear(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Playlists'), h('div', { class: 'grow' }),
      session.can('operator') ? btn('Nova playlist', () => formModal({
        title: 'Nova playlist', fields: playlistFields(), values: { fit_mode: 'contain', transition: 'fade', is_active: true },
        submit: async (v) => { const p = await post('/playlists', v); location.hash = `#/playlists/${p.id}`; },
      }), { cls: 'primary', ico: 'plus' }) : null),
    wrap);
  const pls = await get('/playlists');
  if (!pls.length) { clear(wrap, h('div', { class: 'table-wrap' }, emptyState('Nenhuma playlist criada.'))); return; }
  clear(wrap, h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, ['Playlist', 'Itens', 'Duração do ciclo', 'TVs', 'Status', 'Versão'].map((t) => h('th', null, t)))),
    h('tbody', null, pls.map((p) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/playlists/${p.id}`; } },
      h('td', null, h('b', null, p.name), p.description ? h('div', { class: 'muted small' }, p.description) : null),
      h('td', null, String(p.items.length)),
      h('td', null, fmtDuration(p.total_seconds)),
      h('td', null, String(p.screen_count)),
      h('td', null, h('span', { class: `badge ${p.is_active ? 'success' : ''}` }, p.is_active ? 'Ativa' : 'Inativa')),
      h('td', { class: 'muted' }, `v${p.version}`)))))));
}

function pickMedia(onPick) {
  const q = h('input', { type: 'search', placeholder: 'Buscar…' });
  const kind = h('select', null, h('option', { value: '' }, 'Todos'), h('option', { value: 'image' }, 'Imagens'), h('option', { value: 'video' }, 'Vídeos'));
  const grid = h('div', { class: 'media-grid' });
  const selected = new Map();
  const counter = h('span', { class: 'muted' });
  async function load() {
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    if (kind.value) p.set('kind', kind.value);
    const items = await get('/media?' + p.toString());
    const draw = () => {
      clear(grid, items.length ? items.map((m) => mediaCard(m, {
        selected: selected.has(m.id),
        onclick: () => { if (selected.has(m.id)) selected.delete(m.id); else selected.set(m.id, m); draw(); },
      })) : emptyState('Nenhuma mídia. Envie arquivos na Biblioteca de mídias.'));
      counter.textContent = `${selected.size} selecionado(s)`;
    };
    draw();
  }
  q.addEventListener('input', debounce(() => load().catch(toastError)));
  kind.addEventListener('change', () => load().catch(toastError));
  modal({
    title: 'Adicionar mídias', wide: true,
    body: h('div', null, h('div', { class: 'toolbar' }, q, kind, counter), grid),
    actions: [
      (close) => btn('Cancelar', () => close()),
      (close) => btn('Adicionar à playlist', () => { onPick([...selected.values()]); close(); }, { cls: 'primary' }),
    ],
  });
  load().catch(toastError);
}

function previewPlaylist(pl, items) {
  const stage = h('div', { class: 'preview' });
  const caption = h('div', { class: 'muted small' });
  let idx = -1, timer = null, alive = true;
  const fit = pl.fit_mode;
  function nextItem() {
    if (!alive || !items.length) return;
    clearTimeout(timer);
    idx = (idx + 1) % items.length;
    const it = items[idx];
    const m = it.media;
    caption.textContent = `${idx + 1}/${items.length} · ${m.original_name}`;
    if (m.kind === 'image') {
      clear(stage, h('img', { src: `/api/media/${m.id}/file`, style: `object-fit:${fit}` }));
      timer = setTimeout(nextItem, (it.duration_seconds || pl.default_image_seconds) * 1000);
    } else {
      const v = h('video', { src: `/api/media/${m.id}/file`, autoplay: true, muted: true, playsinline: true, style: `object-fit:${fit}` });
      v.muted = true;
      v.addEventListener('ended', nextItem);
      v.addEventListener('error', nextItem);
      if (it.duration_seconds) timer = setTimeout(nextItem, it.duration_seconds * 1000);
      clear(stage, v);
    }
  }
  modal({ title: `Prévia — ${pl.name}`, wide: true, body: h('div', { class: 'stack' }, stage, caption,
    h('div', null, btn('Próximo', nextItem, { cls: 'sm' }))), onClose: () => { alive = false; clearTimeout(timer); clear(stage); } });
  nextItem();
}

async function assignScreens(pl, onDone) {
  const screens = (await get('/screens?profile=MEDIA_PLAYER'));
  const checks = screens.map((s) => ({ s, el: h('input', { type: 'checkbox', checked: s.playlist_id === pl.id }) }));
  modal({
    title: `Vincular "${pl.name}" às TVs`,
    body: screens.length ? h('div', { class: 'stack' },
      h('div', { class: 'muted small' }, 'Marque as TVs que devem exibir esta playlist. Desmarcar remove a playlist própria da TV (ela passa a usar a do grupo).'),
      checks.map(({ s, el }) => h('label', { class: 'check' }, el, `${s.identifier} — ${s.name}`,
        s.playlist && s.playlist.id !== pl.id ? h('span', { class: 'muted small' }, ` (atual: ${s.playlist.name})`) : null)))
      : emptyState('Nenhuma TV com perfil de mídia cadastrada.'),
    actions: [
      (close) => btn('Cancelar', () => close()),
      (close) => btn('Salvar', async () => {
        const add = checks.filter((c) => c.el.checked && c.s.playlist_id !== pl.id).map((c) => c.s.id);
        const remove = checks.filter((c) => !c.el.checked && c.s.playlist_id === pl.id).map((c) => c.s.id);
        try {
          if (add.length) await post('/screens/assign-playlist', { playlist_id: pl.id, screen_ids: add });
          if (remove.length) await post('/screens/assign-playlist', { playlist_id: null, screen_ids: remove });
          toast('Vínculos atualizados', 'success');
          close();
          onDone();
        } catch (e) { toastError(e); }
      }, { cls: 'primary' }),
    ],
  });
}

async function editor(root, id) {
  let pl = await get(`/playlists/${id}`);
  const canEdit = session.can('operator');
  // estado local dos itens (salvo de uma vez)
  let items = pl.items.map((it) => ({ media: it.media, duration_seconds: it.duration_seconds }));
  let dirty = false;
  const listEl = h('div', { class: 'pl-items' });
  const totals = h('div', { class: 'muted small' });
  const saveBtn = btn('Salvar alterações', () => save(), { cls: 'primary', disabled: true });
  const form = buildForm(playlistFields(), pl);
  Object.values(form.inputs).forEach(({ el }) => el.addEventListener('input', markDirty));
  Object.values(form.inputs).forEach(({ el }) => el.addEventListener('change', markDirty));
  if (!canEdit) Object.values(form.inputs).forEach(({ el }) => { el.disabled = true; });

  function markDirty() { dirty = true; saveBtn.disabled = false; }

  function computeTotal() {
    const def = Number(form.inputs.default_image_seconds.el.value) || pl.default_image_seconds;
    let total = 0, unknown = false;
    for (const it of items) {
      if (it.media.kind === 'image') total += it.duration_seconds || def;
      else if (it.duration_seconds) total += Math.min(it.duration_seconds, it.media.duration_seconds || Infinity);
      else if (it.media.duration_seconds) total += it.media.duration_seconds;
      else unknown = true;
    }
    totals.textContent = `${items.length} item(ns) · ciclo de ${fmtDuration(total)}${unknown ? ' + vídeos sem duração conhecida' : ''}`;
  }

  let dragFrom = null;
  function drawItems() {
    computeTotal();
    if (!items.length) { clear(listEl, emptyState('Playlist vazia. Adicione imagens e vídeos da biblioteca.')); return; }
    clear(listEl, items.map((it, i) => {
      const dur = h('input', { type: 'number', min: 1, value: it.duration_seconds || '', disabled: !canEdit,
        placeholder: it.media.kind === 'image' ? `${form.inputs.default_image_seconds.el.value || pl.default_image_seconds}s` : 'até o fim',
        title: it.media.kind === 'image' ? 'Duração desta imagem (s). Vazio = padrão da playlist' : 'Limite de tempo do vídeo (s). Vazio = reproduzir até o final' });
      dur.addEventListener('input', () => { it.duration_seconds = dur.value ? Number(dur.value) : null; markDirty(); computeTotal(); });
      const row = h('div', { class: 'pl-item', draggable: canEdit ? 'true' : 'false' },
        canEdit ? h('span', { class: 'handle', title: 'Arraste para reordenar' }, icon('drag')) : null,
        h('span', { class: 'pos' }, String(i + 1)),
        h('div', { class: 'thumb' }, thumbFor(it.media)),
        h('div', { class: 'grow' }, h('div', null, it.media.original_name),
          h('div', { class: 'muted small' }, it.media.kind === 'video' ? `Vídeo · ${fmtDuration(it.media.duration_seconds)}` : 'Imagem')),
        h('div', { class: 'field' }, h('label', null, it.media.kind === 'image' ? 'Exibir (s)' : 'Limite (s)'), dur),
        canEdit ? h('div', { class: 'row', style: 'gap:2px' },
          btn('', () => move(i, -1), { cls: 'ghost icon-only sm', ico: 'up', title: 'Subir', disabled: i === 0 }),
          btn('', () => move(i, 1), { cls: 'ghost icon-only sm', ico: 'down', title: 'Descer', disabled: i === items.length - 1 }),
          btn('', () => { items.splice(i, 1); markDirty(); drawItems(); }, { cls: 'ghost icon-only sm danger', ico: 'trash', title: 'Remover' })) : null);
      row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        if (dragFrom === null || dragFrom === i) return;
        const [moved] = items.splice(dragFrom, 1);
        items.splice(i, 0, moved);
        dragFrom = null;
        markDirty();
        drawItems();
      });
      return row;
    }));
  }
  function move(i, d) {
    const j = i + d;
    [items[i], items[j]] = [items[j], items[i]];
    markDirty();
    drawItems();
  }

  async function save() {
    try {
      const body = { ...form.values(), items: items.map((it) => ({ media_id: it.media.id, duration_seconds: it.duration_seconds || null })) };
      pl = await patch(`/playlists/${pl.id}`, body);
      dirty = false;
      saveBtn.disabled = true;
      toast(`Playlist salva (v${pl.version}). As TVs vinculadas serão atualizadas automaticamente.`, 'success');
      renderSide();
    } catch (e) { toastError(e); }
  }

  const side = h('div', { class: 'stack' });
  async function renderSide() {
    const screens = (await get('/screens?profile=MEDIA_PLAYER')).filter((s) => s.playlist_id === pl.id);
    const groups = (await get('/groups')).filter((g) => g.playlist_id === pl.id);
    clear(side,
      h('div', { class: 'card' }, h('h2', null, 'Configurações'), form.el),
      h('div', { class: 'card' }, h('h2', null, 'Em exibição'),
        h('div', { class: 'muted small', style: 'margin-bottom:8px' }, `Versão atual: v${pl.version}`),
        screens.length ? h('ul', { style: 'margin:0; padding-left:18px' }, screens.map((s) => h('li', null, `${s.identifier} — ${s.name}`))) : h('div', { class: 'muted' }, 'Nenhuma TV vinculada diretamente.'),
        groups.length ? h('div', { class: 'small', style: 'margin-top:8px' }, 'Playlist padrão dos grupos: ' + groups.map((g) => g.name).join(', ')) : null,
        canEdit ? h('div', { style: 'margin-top:12px' }, btn('Vincular TVs', () => assignScreens(pl, renderSide).catch(toastError), { cls: 'sm', ico: 'tv' })) : null));
  }

  clear(root,
    h('div', { class: 'page-head' },
      h('a', { href: '#/playlists', class: 'btn ghost sm' }, '← Playlists'),
      h('h1', null, pl.name), h('div', { class: 'grow' }),
      btn('Prévia', () => previewPlaylist({ ...pl, ...form.values() }, items), { ico: 'play' }),
      canEdit ? btn('Duplicar', async () => {
        try { const d = await post(`/playlists/${pl.id}/duplicate`); toast('Playlist duplicada (inativa)', 'success'); location.hash = `#/playlists/${d.id}`; } catch (e) { toastError(e); }
      }, { ico: 'copy' }) : null,
      canEdit ? btn('Excluir', async () => {
        if (!await confirmDialog('Excluir playlist', `Excluir "${pl.name}"?`, { danger: true, okLabel: 'Excluir' })) return;
        try { await del(`/playlists/${pl.id}`); toast('Playlist excluída', 'success'); location.hash = '#/playlists'; } catch (e) { toastError(e); }
      }, { cls: 'danger', ico: 'trash' }) : null,
      canEdit ? saveBtn : null),
    h('div', { class: 'editor-grid' },
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'margin-bottom:12px' }, h('h2', { style: 'margin:0' }, 'Sequência de reprodução'), totals, h('div', { class: 'grow' }),
          canEdit ? btn('Adicionar mídias', () => pickMedia((ms) => {
            ms.forEach((m) => items.push({ media: m, duration_seconds: null }));
            if (ms.length) { markDirty(); drawItems(); }
          }), { cls: 'sm primary', ico: 'plus' }) : null),
        h('div', { class: 'muted small', style: 'margin-bottom:10px' }, 'A reprodução é contínua: ao terminar o último item, volta ao primeiro. Vídeos são exibidos até o final, salvo limite definido.'),
        listEl),
      side));
  form.inputs.default_image_seconds.el.addEventListener('input', drawItems);
  drawItems();
  await renderSide();

  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}

export async function render(root, params) {
  if (params && params[0]) return editor(root, Number(params[0]));
  return list(root);
}
