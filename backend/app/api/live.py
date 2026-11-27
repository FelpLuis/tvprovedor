"""Controle ao vivo: canal WebSocket TV <-> servidor <-> gerenciador.

A TV mantém uma conexão de saída (funciona atrás de NAT/CGNAT, como o heartbeat). O gerenciador
abre outra conexão para a TV escolhida; o servidor repassa os eventos de mouse/teclado do
gerenciador para a TV e o estado da TV para o gerenciador. O mesmo canal avisa a TV quando há
comando novo, para ela buscar na hora em vez de esperar o próximo heartbeat.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Set
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import or_, select

from app.core.config import get_settings
from app.core.permissions import ROLE_LEVEL
from app.core.security import decode_session_token, sha256_hex
from app.database import SessionLocal
from app.models import Screen, User
from app.models.enums import Role, ScreenStatus

log = logging.getLogger("updown.live")
router = APIRouter()

MAX_MSG = 8192
# mensagens do gerenciador que a TV aceita
ADMIN_TYPES = {"input", "navigate", "reload", "cursor"}
TV_TYPES = {"status", "pong"}


class Hub:
    def __init__(self) -> None:
        self.tvs: Dict[int, WebSocket] = {}
        self.admins: Dict[int, Set[WebSocket]] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.last_status: Dict[int, dict] = {}

    async def send(self, ws: WebSocket, msg: dict) -> None:
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:  # conexão caindo: o loop de leitura dela faz a limpeza
            pass

    async def to_admins(self, screen_id: int, msg: dict) -> None:
        for ws in list(self.admins.get(screen_id, ())):
            await self.send(ws, msg)

    async def to_tv(self, screen_id: int, msg: dict) -> bool:
        ws = self.tvs.get(screen_id)
        if ws is None:
            return False
        await self.send(ws, msg)
        return True

    def poke(self, screen_id: int) -> None:
        """Avisa a TV (de qualquer thread) que há comando novo: ela faz o heartbeat na hora."""
        if self.loop is None or screen_id not in self.tvs:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.to_tv(screen_id, {"t": "poke"}), self.loop)
        except RuntimeError:
            pass

    def admin_count(self, screen_id: int) -> int:
        return len(self.admins.get(screen_id, ()))


hub = Hub()


def _screen_for_token(token: str) -> Optional[Screen]:
    if not isinstance(token, str) or not token.startswith("uds_") or len(token) > 200:
        return None
    h = sha256_hex(token)
    db = SessionLocal()
    try:
        s = db.scalar(select(Screen).where(or_(Screen.token_hash == h, Screen.pending_token_hash == h)))
        if s is None or s.status == ScreenStatus.DISABLED.value:
            return None
        if s.token_expires_at and s.token_expires_at < datetime.now(timezone.utc):
            return None
        db.expunge(s)
        return s
    finally:
        db.close()


def _user_from_cookie(ws: WebSocket) -> Optional[User]:
    token = ws.cookies.get(get_settings().cookie_name)
    payload = decode_session_token(token) if token else None
    if not payload:
        return None
    db = SessionLocal()
    try:
        user = db.get(User, int(payload["sub"]))
        if not user or not user.is_active or user.session_version != payload.get("sv"):
            return None
        db.expunge(user)
        return user
    finally:
        db.close()


def _same_origin(ws: WebSocket) -> bool:
    """Defesa contra sites de terceiros abrindo o canal com o cookie do administrador."""
    origin = ws.headers.get("origin")
    if not origin:
        return False
    return urlsplit(origin).netloc.lower() == (ws.headers.get("host") or "").lower()


def _audit(user: User, screen_id: int, action: str) -> None:
    try:
        from app.services.audit import record

        db = SessionLocal()
        try:
            record(db, user=user, action=action, entity_type="screen", entity_id=screen_id, details={})
            db.commit()
        finally:
            db.close()
    except Exception:  # auditoria nunca derruba o controle
        log.exception("auditoria do controle ao vivo")


@router.websocket("/api/player/live")
async def tv_socket(ws: WebSocket):
    await ws.accept()
    hub.loop = asyncio.get_running_loop()
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=15))
    except Exception:
        await ws.close(code=4401)
        return
    screen = await asyncio.to_thread(_screen_for_token, first.get("auth") if isinstance(first, dict) else None)
    if screen is None:
        await ws.close(code=4401)
        return
    sid = screen.id
    old = hub.tvs.get(sid)
    hub.tvs[sid] = ws
    if old is not None and old is not ws:
        try:
            await old.close(code=4000)
        except Exception:
            pass
    await hub.send(ws, {"t": "hello", "admins": hub.admin_count(sid)})
    await hub.to_admins(sid, {"t": "tv", "online": True})
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MSG:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("t") == "ping":
                await hub.send(ws, {"t": "pong"})
            elif msg.get("t") in TV_TYPES:
                if msg.get("t") == "status":
                    hub.last_status[sid] = msg
                await hub.to_admins(sid, msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("canal da TV %s encerrado", sid, exc_info=True)
    finally:
        if hub.tvs.get(sid) is ws:
            del hub.tvs[sid]
            await hub.to_admins(sid, {"t": "tv", "online": False})


@router.websocket("/api/screens/{screen_id}/live")
async def admin_socket(ws: WebSocket, screen_id: int):
    if not _same_origin(ws):
        await ws.close(code=4403)
        return
    user = await asyncio.to_thread(_user_from_cookie, ws)
    if user is None or ROLE_LEVEL.get(user.role, 0) < ROLE_LEVEL[Role.OPERATOR.value]:
        await ws.close(code=4403)
        return
    await ws.accept()
    hub.loop = asyncio.get_running_loop()
    hub.admins.setdefault(screen_id, set()).add(ws)
    await asyncio.to_thread(_audit, user, screen_id, "screen.live_control")
    await hub.send(ws, {"t": "tv", "online": screen_id in hub.tvs})
    if screen_id in hub.last_status:
        await hub.send(ws, hub.last_status[screen_id])
    await hub.to_tv(screen_id, {"t": "admins", "count": hub.admin_count(screen_id)})
    window_start, count = time.monotonic(), 0
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_MSG:
                continue
            now = time.monotonic()
            if now - window_start > 1:
                window_start, count = now, 0
            count += 1
            if count > 200:  # limite de eventos por segundo
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("t") == "ping":
                await hub.send(ws, {"t": "pong"})
            elif msg.get("t") in ADMIN_TYPES:
                if not await hub.to_tv(screen_id, msg):
                    await hub.send(ws, {"t": "tv", "online": False})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("canal do gerenciador encerrado", exc_info=True)
    finally:
        hub.admins.get(screen_id, set()).discard(ws)
        if not hub.admins.get(screen_id):
            hub.admins.pop(screen_id, None)
        await hub.to_tv(screen_id, {"t": "admins", "count": hub.admin_count(screen_id)})
