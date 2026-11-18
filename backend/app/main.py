from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import auth, dashboards, groups, media, player, playlists, screens, system, users
from app.api.system import APP_VERSION
from app.core.config import get_settings
from app.services.media import ensure_storage_dirs

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
        response = await call_next(request)
        path = request.url.path
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        elif path.startswith("/player"):
            response.headers.setdefault("Content-Security-Policy", PLAYER_CSP)
        elif not path.startswith(("/docs", "/redoc", "/openapi.json")):
            response.headers.setdefault("Content-Security-Policy", ADMIN_CSP)
            response.headers.setdefault("X-Frame-Options", "DENY")
        if path.endswith(("sw.js", "index.html")) or path in ("/", "/player/"):
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

    for r in (auth, users, groups, screens, media, playlists, dashboards, player, system):
        app.include_router(r.router, prefix="/api")

    frontend: Path = s.frontend_dir

    @app.get("/player", include_in_schema=False)
    def player_redirect():
        return RedirectResponse("/player/")

    app.mount("/player", StaticFiles(directory=frontend / "player", html=True), name="player")
    app.mount("/", StaticFiles(directory=frontend / "admin", html=True), name="admin")
    return app


app = create_app()
