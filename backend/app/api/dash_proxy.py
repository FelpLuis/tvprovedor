"""Proxy de dashboards: exibe páginas de BI dentro do player (iframe) pelo próprio servidor.

    /dash/{id}/<caminho>  ->  <origem do dashboard>/<caminho>

- remove os bloqueios de incorporação (X-Frame-Options / CSP frame-ancestors);
- reescreve redirecionamentos, cookies e links absolutos para continuarem sob /dash/{id}/;
- um service worker (escopo /dash/{id}/) redireciona as requisições que a página monta em
  JavaScript (ex.: fetch('/api/…')) para o proxy;
- como a página fica na mesma origem do player, o player consegue preencher o login sozinho.

Acesso: TVs ativadas (cookie de sessão assinado, emitido pela API do player) ou usuários logados
no painel. O destino é sempre a origem cadastrada no dashboard (nunca uma URL arbitrária).
"""
import hashlib
import json
import hmac
import re
import time
from typing import Optional
from urllib.parse import quote, unquote, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import get_current_screen
from app.core.security import decode_session_token
from app.database import get_db
from app.models import Dashboard, Screen, User

router = APIRouter(tags=["dashboards-proxy"])

COOKIE_PREFIX = "uds_dash_"
SESSION_TTL = 24 * 3600
MAX_BODY = 50 * 1024 * 1024
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers",
               "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"}
DROP_RESPONSE = {"x-frame-options", "content-security-policy", "content-security-policy-report-only",
                 "content-length", "transfer-encoding", "content-encoding", "connection", "keep-alive",
                 "strict-transport-security", "set-cookie", "location"}

_client: Optional[httpx.AsyncClient] = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(30.0, connect=10.0), verify=True)
    return _client


def set_client(client: Optional[httpx.AsyncClient]) -> None:
    """Testes: injeta um cliente com transporte simulado."""
    global _client
    _client = client


# ---------------------------------------------------------------- sessão (cookie assinado)

def _sig(dash_id: int, exp: int) -> str:
    msg = f"dash:{dash_id}:{exp}".encode()
    return hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:40]


def make_session(dash_id: int) -> str:
    exp = int(time.time()) + SESSION_TTL
    return f"{exp}.{_sig(dash_id, exp)}"


def _valid_session(dash_id: int, value: Optional[str]) -> bool:
    try:
        exp_s, sig = (value or "").split(".", 1)
        exp = int(exp_s)
    except ValueError:
        return False
    return exp > time.time() and hmac.compare_digest(_sig(dash_id, exp), sig)


def _authorized(request: Request, db: Session, dash_id: int) -> bool:
    if _valid_session(dash_id, request.cookies.get(f"{COOKIE_PREFIX}{dash_id}")):
        return True
    token = request.cookies.get(get_settings().cookie_name)  # painel (pré-visualização)
    payload = decode_session_token(token) if token else None
    if payload:
        user = db.get(User, int(payload["sub"]))
        return bool(user and user.is_active and user.session_version == payload.get("sv"))
    return False


def proxied_url(d: Dashboard, url: Optional[str] = None) -> str:
    """URL do dashboard através do proxy (caminho + consulta da URL cadastrada)."""
    parts = urlsplit(url or d.url)
    path = parts.path or "/"
    return f"/dash/{d.id}{path}" + (f"?{parts.query}" if parts.query else "")


@router.post("/api/player/dashboards/{dash_id}/session")
def player_session(dash_id: int, response: Response, screen: Screen = Depends(get_current_screen),
                   db: Session = Depends(get_db)):
    """A TV pede acesso ao proxy do seu dashboard; recebe um cookie válido por 24 h."""
    d = db.get(Dashboard, dash_id)
    if d is None or screen.dashboard_id != d.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard não vinculado a esta TV")
    response.set_cookie(f"{COOKIE_PREFIX}{d.id}", make_session(d.id), max_age=SESSION_TTL, httponly=True,
                        secure=get_settings().secure_cookies, samesite="lax", path=f"/dash/{d.id}/")
    from app.services.screens import build_dashboard_url

    return {"url": proxied_url(d, build_dashboard_url(d))}


# ---------------------------------------------------------------- sites permitidos (SSO)

_TWO_LEVEL = {"com", "net", "org", "gov", "edu", "art", "eng", "ind", "inf", "app", "dev", "tec"}


def _base_domain(host: str) -> str:
    """Domínio da empresa: updown.com.br para monitoramento.updown.com.br."""
    labels = host.lower().split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _TWO_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:]) if len(labels) >= 2 else host.lower()


def _is_ip(host: str) -> bool:
    return bool(re.fullmatch(r"[\d.]+|\[[0-9a-f:]+\]", host))


class Site:
    """Mapeia URLs dos sites do dashboard (o principal e os de login/SSO) para o proxy."""

    def __init__(self, d: Dashboard):
        self.d = d
        base = urlsplit(d.url)
        self.scheme = base.scheme
        self.netloc = base.netloc.lower()
        self.origin = f"{self.scheme}://{self.netloc}"
        self.prefix = f"/dash/{d.id}"
        host = base.hostname or ""
        self.domain = None if _is_ip(host) else _base_domain(host)
        self.extra = {h.strip().lower() for h in ((d.options or {}).get("extra_hosts") or []) if isinstance(h, str)}

    def allowed(self, netloc: str) -> bool:
        netloc = netloc.lower()
        host = netloc.rsplit(":", 1)[0] if not netloc.startswith("[") else netloc
        if netloc == self.netloc or netloc in self.extra or host in self.extra:
            return True
        return bool(self.domain) and (host == self.domain or host.endswith("." + self.domain))

    def base_for(self, scheme: str, netloc: str) -> str:
        """Prefixo no proxy para uma origem: /dash/{id} (principal) ou /dash/{id}/~/{scheme}/{host}."""
        if scheme == self.scheme and netloc.lower() == self.netloc:
            return self.prefix
        return f"{self.prefix}/~/{scheme}/{netloc.lower()}"

    def to_proxy(self, url: str) -> Optional[str]:
        """URL absoluta de um site permitido -> caminho no proxy (ou None)."""
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.netloc or not self.allowed(parts.netloc):
            return None
        out = self.base_for(parts.scheme, parts.netloc) + (parts.path or "/")
        return out + (f"?{parts.query}" if parts.query else "")

    def upstream(self, path: str) -> Optional[str]:
        """Caminho após /dash/{id}/ -> URL de destino (None se o site não for permitido)."""
        if path.startswith("~/"):
            pieces = path.split("/", 3)
            if len(pieces) < 3 or pieces[1] not in ("http", "https") or not self.allowed(pieces[2]):
                return None
            rest = pieces[3] if len(pieces) > 3 else ""
            return f"{pieces[1]}://{pieces[2]}/{rest}"
        return f"{self.origin}/{path}"

    def page_base(self, path: str) -> str:
        """Prefixo da página atual (para links que começam com /)."""
        if path.startswith("~/"):
            pieces = path.split("/", 3)
            if len(pieces) >= 3:
                return f"{self.prefix}/~/{pieces[1]}/{pieces[2]}"
        return self.prefix


# ---------------------------------------------------------------- reescritas

def _rewrite_location(loc: str, site: Site, base: str) -> str:
    if loc.startswith("/") and not loc.startswith("//"):
        return base + loc
    return site.to_proxy(loc) or loc


def _rewrite_cookie(raw: str, prefix: str) -> str:
    """Cookies de todos os sites do dashboard ficam sob /dash/{id}/ (como um domínio compartilhado)."""
    parts = [p.strip() for p in raw.split(";")]
    keep = [parts[0]]
    for p in parts[1:]:
        k = p.split("=", 1)[0].strip().lower()
        if k in ("domain", "path"):
            continue
        keep.append(p)
    keep.append(f"Path={prefix}/")
    return "; ".join(keep)


_ATTR = re.compile(r"""(\s(?:href|src|action|poster|data-src)\s*=\s*)(["'])/(?!/)""", re.I)
_ATTR_ABS = re.compile(r"""(\s(?:href|src|action|poster|data-src)\s*=\s*)(["'])(https?://[^"'\s>]+)""", re.I)
_META_REFRESH = re.compile(r"""(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*?url=)([^"'>]+)""", re.I)
_CSS_URL = re.compile(r"""url\(\s*(["']?)/(?!/)""", re.I)


# caminhos do próprio UpDown Digital: a página do dashboard não pode assumir esses endereços
RESERVED_PATHS = ("/api", "/player", "/dash", "/js/", "/css/", "/app/", "/apk", "/docs", "/redoc", "/openapi.json")
CTX_COOKIE = "uds_dash_ctx"


def _original_path(path_query: str) -> Optional[str]:
    """Endereço original da página (ex.: /tv-isp) para aplicações que escolhem a tela pela URL."""
    path = path_query.split("?", 1)[0]
    if any(path == r or path.startswith(r if r.endswith("/") else r + "/") or path == r.rstrip("/")
           for r in RESERVED_PATHS):
        return None
    return path_query


def _rewrite_html(html: str, site: Site, base: str, original: Optional[str] = None) -> str:
    html = _ATTR.sub(lambda m: f"{m.group(1)}{m.group(2)}{base}/", html)
    html = _ATTR_ABS.sub(lambda m: f"{m.group(1)}{m.group(2)}{site.to_proxy(m.group(3)) or m.group(3)}", html)
    html = _META_REFRESH.sub(lambda m: m.group(1) + _rewrite_location(m.group(2).strip(), site, base), html)
    html = _CSS_URL.sub(lambda m: f"url({m.group(1)}{base}/", html)
    ctx = json.dumps({"base": base, "orig": original}).replace("</", "<\\/")
    shim = f'<script>window.__udsProxy={ctx};</script><script src="{site.prefix}/__uds_shim.js"></script>'
    m = re.search(r"<head[^>]*>", html, re.I)
    return html[:m.end()] + shim + html[m.end():] if m else shim + html


def _rewrite_css(css: str, base: str) -> str:
    return _CSS_URL.sub(lambda m: f"url({m.group(1)}{base}/", css)


SHIM_JS = """(function(){
  var ctx = window.__udsProxy || {};
  // aplicações que escolhem a tela pelo endereço (React/Vue/Angular) precisam ver o caminho
  // original (ex.: /tv-isp) e não /dash/{id}/tv-isp; recarregar/links voltam ao proxy pelo servidor
  if (ctx.orig) {
    try { history.replaceState(history.state, '', ctx.orig + location.hash); } catch (e) {}
  }
  // navegações por script para os sites permitidos (ex.: sessão expirou e a página manda para o
  // portal de login com o endereço completo) voltam para o proxy; fora dele o portal recusa o iframe
  var PREFIX = %(prefix_json)s, MAIN = %(main)s, DOMAIN = %(domain)s, EXTRA = %(extra)s;
  function allowed(u) {
    var host = u.hostname.toLowerCase();
    return u.origin === MAIN || EXTRA.indexOf(u.host.toLowerCase()) >= 0 || EXTRA.indexOf(host) >= 0 ||
      (DOMAIN && (host === DOMAIN || host.slice(-DOMAIN.length - 1) === '.' + DOMAIN));
  }
  function proxied(u) {
    if (u.origin === MAIN) return PREFIX + u.pathname + u.search + u.hash;
    return PREFIX + '/~/' + u.protocol.replace(':', '') + '/' + u.host.toLowerCase() + u.pathname + u.search + u.hash;
  }
  function external(href) {
    try { var u = new URL(href, location.href); } catch (e) { return null; }
    if (u.origin === location.origin || !/^https?:$/.test(u.protocol) || !allowed(u)) return null;
    return proxied(u);
  }
  if (window.navigation && navigation.addEventListener) {
    navigation.addEventListener('navigate', function (e) {
      var to = e.destination && external(e.destination.url);
      if (!to || !e.cancelable || e.downloadRequest) return;
      e.preventDefault();
      location.assign(to);
    });
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    var to = a && (!a.target || a.target === '_self') && external(a.href);
    if (to) { e.preventDefault(); location.assign(to); }
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target, to = f && f.action && external(f.action);
    if (to) f.action = to;
  }, true);
  var openOrig = window.open;
  window.open = function (href, name, feat) {
    var to = href && external(String(href));
    if (to && (!name || name === '_self' || name === '_top' || name === '_parent')) { location.assign(to); return window; }
    return openOrig.apply(window, arguments);
  };
  if (!('serviceWorker' in navigator)) return;
  var p = '%(prefix)s/';
  function announce() {
    if (navigator.serviceWorker.controller && ctx.base) navigator.serviceWorker.controller.postMessage({ udsBase: ctx.base });
  }
  announce();
  navigator.serviceWorker.register(p + '__uds_sw.js', { scope: p }).then(function () {
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!sessionStorage.getItem('uds_sw_reload')) { sessionStorage.setItem('uds_sw_reload', '1'); location.reload(); }
      });
    }
  }).catch(function () {});
})();"""

SW_JS = """'use strict';
// leva para o proxy as requisições que a página do dashboard faz para caminhos absolutos ("/api/...")
// e para os outros sites permitidos (ex.: portal de login)
var PREFIX = %(prefix)s;
var MAIN = %(main)s;
var DOMAIN = %(domain)s;
var EXTRA = %(extra)s;
function allowed(u) {
  var host = u.hostname.toLowerCase();
  return u.origin === MAIN || EXTRA.indexOf(u.host.toLowerCase()) >= 0 || EXTRA.indexOf(host) >= 0 ||
    (DOMAIN && (host === DOMAIN || host.slice(-DOMAIN.length - 1) === '.' + DOMAIN));
}
function proxied(u) {
  if (u.origin === MAIN) return PREFIX + u.pathname + u.search;
  return PREFIX + '/~/' + u.protocol.replace(':', '') + '/' + u.host.toLowerCase() + u.pathname + u.search;
}
function basePath(clientUrl) {
  var m = /^(\\/dash\\/\\d+(?:\\/~\\/https?\\/[^\\/]+)?)/.exec(clientUrl ? new URL(clientUrl).pathname : '');
  return m ? m[1] : PREFIX;
}
// página -> prefixo dela no proxy (a URL visível pode ter sido trocada para o caminho original)
var BASES = {};
self.addEventListener('message', function (e) {
  if (e.data && e.data.udsBase && e.source && e.source.id) BASES[e.source.id] = e.data.udsBase;
});
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.indexOf(PREFIX + '/') === 0) {
    if (req.mode === 'navigate' && event.resultingClientId) {
      BASES[event.resultingClientId] = basePath(req.url);
    }
    return;
  }
  if (!sameOrigin && !allowed(url)) return;
  event.respondWith((async function () {
    var target;
    if (sameOrigin) {
      var client = event.clientId ? await self.clients.get(event.clientId) : null;
      var b = (event.clientId && BASES[event.clientId]) || basePath(client && client.url);
      target = b + url.pathname + url.search;
    } else {
      target = proxied(url);
    }
    if (req.mode === 'navigate') return Response.redirect(target, 302);
    var body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.clone().arrayBuffer();
    return fetch(target, { method: req.method, headers: req.headers, body: body, credentials: 'include', redirect: 'manual' });
  })());
});
"""


# ---------------------------------------------------------------- rota do proxy

@router.api_route("/dash/{dash_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
                  include_in_schema=False)
async def proxy(dash_id: int, path: str, request: Request, db: Session = Depends(get_db)):
    d = db.get(Dashboard, dash_id)
    if d is None or not d.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard não encontrado")
    if not _authorized(request, db, dash_id):
        return HTMLResponse("<h3>Acesso não autorizado ao dashboard.</h3>", status_code=401)
    site = Site(d)
    if path == "__uds_shim.js":
        js = SHIM_JS % {"prefix": site.prefix, "prefix_json": json.dumps(site.prefix), "main": json.dumps(site.origin),
                        "domain": json.dumps(site.domain), "extra": json.dumps(sorted(site.extra))}
        return Response(js, media_type="application/javascript",
                        headers={"Cache-Control": "no-cache"})
    if path == "__uds_sw.js":
        js = SW_JS % {"prefix": json.dumps(site.prefix), "main": json.dumps(site.origin),
                      "domain": json.dumps(site.domain), "extra": json.dumps(sorted(site.extra))}
        return Response(js, media_type="application/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": site.prefix + "/"})

    target = site.upstream(path)
    if target is None:
        return HTMLResponse("<h3>Endereço fora dos sites permitidos para este dashboard.</h3>", status_code=403)
    if request.url.query:
        target += f"?{request.url.query}"
    tparts = urlsplit(target)
    t_origin = f"{tparts.scheme}://{tparts.netloc}"
    base = site.page_base(path)

    headers = {}
    for k, v in request.headers.items():
        lk = k.lower()
        if lk in HOP_HEADERS or lk.startswith("x-forwarded") or lk in ("cookie", "origin", "referer"):
            continue
        headers[k] = v
    # cookies dos sites do dashboard (os do UpDown Digital ficam no servidor)
    upstream_cookies = "; ".join(f"{k}={v}" for k, v in request.cookies.items()
                                 if not k.startswith(COOKIE_PREFIX) and k != get_settings().cookie_name)
    if upstream_cookies:
        headers["Cookie"] = upstream_cookies
    if request.headers.get("origin"):
        headers["Origin"] = t_origin
    m = re.search(r"/dash/\d+/(.*)$", request.headers.get("referer", ""))
    if m:
        ref_target = site.upstream(m.group(1))
        if ref_target:
            headers["Referer"] = ref_target
    headers["Accept-Encoding"] = "identity"

    body = await request.body()
    try:
        up = await get_client().request(request.method, target, headers=headers, content=body or None)
    except httpx.HTTPError as e:
        return HTMLResponse(f"<h3>Não foi possível acessar o dashboard ({type(e).__name__}).</h3>", status_code=502)

    content = up.content[:MAX_BODY]
    ctype = up.headers.get("content-type", "")
    if "text/html" in ctype:
        enc = up.encoding or "utf-8"
        original = _original_path(tparts.path + (f"?{tparts.query}" if tparts.query else ""))
        content = _rewrite_html(content.decode(enc, errors="replace"), site, base, original).encode(enc, errors="replace")
    elif "text/css" in ctype:
        enc = up.encoding or "utf-8"
        content = _rewrite_css(content.decode(enc, errors="replace"), base).encode(enc, errors="replace")

    resp = Response(content=content, status_code=up.status_code)
    for k, v in up.headers.multi_items():
        if k.lower() not in DROP_RESPONSE:
            resp.headers.append(k, v)
    if "location" in up.headers:
        resp.headers["Location"] = _rewrite_location(up.headers["location"], site, base)
    for raw in up.headers.get_list("set-cookie"):
        resp.headers.append("Set-Cookie", _rewrite_cookie(raw, site.prefix))
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    if "text/html" in ctype:
        # lembra de qual dashboard é a página exibida (para recarregar no endereço original)
        resp.set_cookie(CTX_COOKIE, quote(base, safe="/~"), httponly=True, samesite="lax", path="/",
                        secure=get_settings().secure_cookies)
    return resp


def referer_dash_prefix(request: Request) -> Optional[str]:
    """Se a requisição veio de uma página do proxy, devolve o prefixo dela (para corrigir links absolutos)."""
    m = re.search(r"(/dash/\d+(?:/~/https?/[^/?#]+)?)/", request.headers.get("referer", ""))
    return m.group(1) if m else None


def iframe_redirect(request: Request) -> Optional[RedirectResponse]:
    """Página de dashboard (no iframe) recarregada pelo endereço original: volta para o proxy.

    O painel e o player nunca são abertos em iframe (X-Frame-Options), então uma navegação de
    iframe fora de /dash/ com o cookie de contexto só pode ser de um dashboard.
    """
    if request.headers.get("sec-fetch-dest") != "iframe" or request.url.path.startswith("/dash/"):
        return None
    ctx = unquote(request.cookies.get(CTX_COOKIE, ""))
    if not re.fullmatch(r"/dash/\d+(?:/~/https?/[^/?#]+)?", ctx):
        return None
    target = ctx + request.url.path + (f"?{request.url.query}" if request.url.query else "")
    return RedirectResponse(target, status_code=307)


def fallback_redirect(request: Request) -> Optional[RedirectResponse]:
    prefix = referer_dash_prefix(request)
    if prefix and not request.url.path.startswith("/dash/"):
        target = prefix + request.url.path + (f"?{request.url.query}" if request.url.query else "")
        return RedirectResponse(target, status_code=307)
    return None
