import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
import logging

from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.exc import DBAPIError, OperationalError
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import auth, cameras, dash_proxy, dashboards, groups, media, player, playlists, screens, system, users
from app.api.dash_proxy import fallback_redirect, iframe_redirect
from app.api.system import APP_VERSION
from app.core.config import get_settings
from app.services.media import ensure_storage_dirs

log = logging.getLogger("updown_digital")

ADMIN_CSP = (
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
    "base-uri 'self'; form-action 'self'; object-src 'none'"
)
# o player precisa embutir dashboards externos (frame-src) e tocar mídias do cache (blob:)
PLAYER_CSP = (
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src *; "
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
)


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        redirect = iframe_redirect(request)
        if redirect is not None:
            return redirect
        response = await call_next(request)
        path = request.url.path
        if response.status_code == 404:
            # link absoluto de uma página do proxy de dashboards (ex.: "/login"): volta para /dash/{id}/
            redirect = fallback_redirect(request)
            if redirect is not None:
                return redirect
        if path.startswith("/dash/"):
            # conteúdo do dashboard: cabeçalhos definidos pelo proxy (pode ser exibido no player)
            return response
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        elif path.startswith("/player"):
            response.headers.setdefault("Content-Security-Policy", PLAYER_CSP)
        elif not path.startswith(("/docs", "/redoc", "/openapi.json")):
            response.headers.setdefault("Content-Security-Policy", ADMIN_CSP)
            response.headers.setdefault("X-Frame-Options", "DENY")
        if not path.startswith("/api/") and "cache-control" not in response.headers:
            # painel e player: o navegador sempre confere se há versão nova (ETag), para que
            # uma atualização do servidor apareça sem precisar limpar o cache
            response.headers["Cache-Control"] = "no-cache"
        return response


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_storage_dirs()
    yield


def create_app() -> FastAPI:
    s = get_settings()
    s.validate_for_production()
    docs = s.docs_enabled
    app = FastAPI(
        title=s.app_name,
        version=APP_VERSION,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.add_middleware(SecurityHeaders)

    for r in (auth, users, groups, screens, media, playlists, dashboards, cameras, player, system):
        app.include_router(r.router, prefix="/api")
    app.include_router(dash_proxy.router)

    @app.exception_handler(OperationalError)
    async def database_unavailable(request: Request, exc: DBAPIError):
        # falha de conexão/autenticação com o PostgreSQL: mensagem clara em vez de 500 genérico
        reason = str(getattr(exc, "orig", exc)).strip().splitlines()[-1][:300]
        log.error("Banco de dados indisponível em %s %s: %s", request.method, request.url.path, reason)
        return JSONResponse(
            {"detail": "Banco de dados indisponível. Verifique o PostgreSQL e o UDS_DATABASE_URL do .env "
                       "(detalhes: journalctl -u updown-digital)."},
            status_code=503,
        )

    frontend: Path = s.frontend_dir

    @app.get("/player", include_in_schema=False)
    def player_redirect():
        return RedirectResponse("/player/")

    app.mount("/player", StaticFiles(directory=frontend / "player", html=True), name="player")
    # APK do app Android TV, baixado pelo instalador/TV (não contém segredos)
    mimetypes.add_type("application/vnd.android.package-archive", ".apk")
    @app.get("/apk", include_in_schema=False)
    def apk_short_url():
        # endereço curto para instalar pela TV (app Downloader): tv.updown.com.br/apk
        return RedirectResponse("/app/updown-digital.apk")

    if (frontend / "app").is_dir():
        app.mount("/app", StaticFiles(directory=frontend / "app"), name="android-app")
    app.mount("/", StaticFiles(directory=frontend / "admin", html=True), name="admin")
    return app


app = create_app()
