"""Dependências de autenticação/autorização. As permissões são sempre validadas no backend."""
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_session_token, sha256_hex
from app.database import get_db
from app.models import Screen, User
from app.models.enums import Role, ScreenStatus

ROLE_LEVEL = {Role.VIEWER.value: 1, Role.OPERATOR.value: 2, Role.ADMIN.value: 3}


def client_ip(request: Request) -> str:
    """IP real do cliente; confia em X-Forwarded-For apenas vindo do proxy local (Caddy)."""
    peer = request.client.host if request.client else ""
    if peer in get_settings().trusted_proxies:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return peer


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_HEADER = "x-requested-with"


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(get_settings().cookie_name)
    if token and request.method not in SAFE_METHODS and not request.headers.get(CSRF_HEADER):
        # cabeçalho customizado não pode ser enviado por sites de terceiros sem CORS (defesa CSRF)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cabeçalho X-Requested-With ausente")
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer ") and not auth[7:].startswith("uds_"):
            token = auth[7:]
    payload = decode_session_token(token) if token else None
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or user.session_version != payload.get("sv"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida")
    return user


def require_role(minimum: Role) -> Callable[..., User]:
    def dep(user: User = Depends(get_current_user)) -> User:
        if ROLE_LEVEL.get(user.role, 0) < ROLE_LEVEL[minimum.value]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permissão insuficiente")
        return user

    return dep


require_viewer = require_role(Role.VIEWER)
require_operator = require_role(Role.OPERATOR)
require_admin = require_role(Role.ADMIN)


def _device_token(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        if tok.startswith("uds_"):
            return tok
    return None


def get_current_screen(request: Request, db: Session = Depends(get_db)) -> Screen:
    tok = _device_token(request)
    if not tok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token do dispositivo ausente")
    h = sha256_hex(tok)
    screen = db.scalar(select(Screen).where(Screen.token_hash == h))
    if not screen:
        screen = db.scalar(select(Screen).where(Screen.pending_token_hash == h))
        if screen:
            # primeiro uso do token renovado: ele substitui o anterior
            s = get_settings()
            screen.token_hash = h
            screen.pending_token_hash = None
            screen.token_expires_at = datetime.now(timezone.utc) + timedelta(days=s.device_token_days)
            db.commit()
    if not screen:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token do dispositivo inválido")
    if screen.token_expires_at and screen.token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token do dispositivo expirado")
    if screen.status == ScreenStatus.DISABLED.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "TV desativada")
    return screen
