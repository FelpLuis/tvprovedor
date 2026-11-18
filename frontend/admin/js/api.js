// Cliente da API administrativa. A sessão fica em cookie HttpOnly; o cabeçalho
// X-Requested-With é exigido pelo backend em requisições que alteram dados (anti-CSRF).

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : formatDetail(detail));
    this.status = status;
    this.detail = detail;
  }
}

function formatDetail(detail) {
  if (!detail) return 'Erro inesperado';
  if (Array.isArray(detail)) {
    // erros de validação do FastAPI
    return detail.map((d) => {
      const field = (d.loc || []).filter((p) => p !== 'body').join('.');
      return (field ? field + ': ' : '') + (d.msg || '').replace(/^Value error, /, '');
    }).join('\n');
  }
  if (typeof detail === 'object') {
    let msg = detail.message || JSON.stringify(detail);
    if (detail.errors) msg += '\n' + detail.errors.map((e) => `${e.file}: ${e.error}`).join('\n');
    return msg;
  }
  return String(detail);
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(method, path, body, { raw = false } = {}) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') opts.headers['X-Requested-With'] = 'uds-admin';
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch('/api' + path, opts);
  if (raw) return resp;
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!resp.ok) {
    if (resp.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(resp.status, data && data.detail !== undefined ? data.detail : data);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b === undefined ? {} : b);
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

/** Upload com progresso (fetch não informa progresso de envio). */
export function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    xhr.setRequestHeader('X-Requested-With', 'uds-admin');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = xhr.responseText; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) onUnauthorized();
        reject(new ApiError(xhr.status, data && data.detail !== undefined ? data.detail : data));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Falha de rede durante o envio'));
    xhr.send(formData);
  });
}
