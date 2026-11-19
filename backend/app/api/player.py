"""Endpoints usados pelas TVs. Nenhum deles dá acesso administrativo."""
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.core.config import get_settings
from app.core.permissions import client_ip, get_current_screen
from app.core.ratelimit import LoginRateLimiter
from app.core.security import (
    new_activation_code,
    new_device_token,
    new_pairing_secret,
    normalize_activation_code,
    sha256_hex,
    verify_media_signature,
)
from app.database import get_db
from app.models import Media, Screen, ScreenActivationCode, ScreenCommand, ScreenHeartbeat
from app.models.enums import CommandStatus
from app.schemas.player import ActivationCodeOut, ActivationCodeRequest, ActivationPoll, CommandAck, HeartbeatIn
from app.services import audit
from app.services.media import media_path
from app.services.screens import player_config, sign_playlist_urls

router = APIRouter(prefix="/player", tags=["player"])

# no máximo 10 códigos por IP a cada 10 minutos
activation_limiter = LoginRateLimiter(10, 600)
_last_maintenance = 0.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _maintenance(db: Session) -> None:
    """Limpeza leve executada no máximo a cada 10 minutos (sem agendador externo)."""
    global _last_maintenance
    if time.monotonic() - _last_maintenance < 600:
        return
    _last_maintenance = time.monotonic()
    s = get_settings()
    now = _now()
    db.execute(delete(ScreenHeartbeat).where(
        ScreenHeartbeat.created_at < now - timedelta(days=s.heartbeat_history_keep_days)))
    db.execute(delete(ScreenActivationCode).where(
        ScreenActivationCode.activated_at.is_(None),
        ScreenActivationCode.expires_at < now - timedelta(days=1)))
    db.execute(update(ScreenCommand).where(
        ScreenCommand.status.in_([CommandStatus.PENDING.value, CommandStatus.DELIVERED.value]),
        ScreenCommand.expires_at < now).values(status=CommandStatus.EXPIRED.value))
    db.commit()


DISPLAY_KEYS = ("viewport", "screen", "dpr", "device_orientation", "logical", "rotation", "scale",
                "client", "app", "device", "android", "fullscreen")


def _clean_display(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Aceita só os campos conhecidos, com valores simples e curtos."""
    out: Dict[str, Any] = {}
    for k in DISPLAY_KEYS:
        v = raw.get(k)
        if isinstance(v, bool):
            out[k] = v
        elif isinstance(v, (int, float)):
            out[k] = round(float(v), 3)
        elif isinstance(v, str):
            out[k] = v[:40]
        elif isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
            out[k] = [int(v[0]), int(v[1])]
    return out


@router.post("/activation-codes", response_model=ActivationCodeOut, status_code=201)
def request_activation_code(request: Request, data: ActivationCodeRequest = None, db: Session = Depends(get_db)):
    ip = client_ip(request)
    blocked, wait = activation_limiter.check(f"act:{ip}")
    if blocked:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Aguarde {wait}s para gerar outro código",
                            headers={"Retry-After": str(wait)})
    activation_limiter.fail(f"act:{ip}")
    s = get_settings()
    secret = new_pairing_secret()
    for _ in range(10):
        act = ScreenActivationCode(
            code=new_activation_code(),
            pairing_secret_hash=sha256_hex(secret),
            expires_at=_now() + timedelta(seconds=s.activation_code_ttl_seconds),
            request_ip=ip,
            user_agent=(request.headers.get("user-agent") or "")[:255],
        )
        db.add(act)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
    else:  # pragma: no cover - colisão improvável
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Tente novamente")
    return ActivationCodeOut(code=act.code, pairing_secret=secret, expires_in=s.activation_code_ttl_seconds)


@router.post("/activation-codes/poll")
def poll_activation(data: ActivationPoll, request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    code = normalize_activation_code(data.code)
    act = db.scalar(select(ScreenActivationCode).where(ScreenActivationCode.code == code))
    if act is None or act.pairing_secret_hash != sha256_hex(data.pairing_secret):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Código inválido")
    if act.claimed_at is not None:
        raise HTTPException(status.HTTP_410_GONE, "Código já utilizado")
    if act.activated_at is None:
        if act.expires_at < _now():
            raise HTTPException(status.HTTP_410_GONE, "Código expirado")
        return {"status": "pending", "expires_at": act.expires_at.isoformat()}
    screen = db.get(Screen, act.screen_id)
    if screen is None:
        raise HTTPException(status.HTTP_410_GONE, "TV removida")
    s = get_settings()
    token = new_device_token()
    screen.token_hash = sha256_hex(token)
    screen.pending_token_hash = None
    screen.token_expires_at = _now() + timedelta(days=s.device_token_days)
    screen.activated_at = _now()
    screen.last_seen_at = _now()
    screen.last_ip = client_ip(request)
    screen.user_agent = (request.headers.get("user-agent") or "")[:255]
    act.claimed_at = _now()
    audit.record(db, "screen.paired", request=request, screen=screen, entity_type="screen", entity_id=screen.id,
                 details={"code": code})
    db.commit()
    return {"status": "activated", "token": token, "screen": {"uid": screen.uid, "name": screen.name,
                                                               "identifier": screen.identifier}}


@router.get("/config")
def get_config(screen: Screen = Depends(get_current_screen)) -> Dict[str, Any]:
    return sign_playlist_urls(player_config(screen))


@router.post("/heartbeat")
def heartbeat(data: HeartbeatIn, request: Request, screen: Screen = Depends(get_current_screen),
              db: Session = Depends(get_db)) -> Dict[str, Any]:
    s = get_settings()
    now = _now()
    ip = client_ip(request)
    was_offline = screen.last_seen_at is None or (now - screen.last_seen_at).total_seconds() > s.offline_after_seconds
    changed = data.playback_state != screen.playback_state or data.player_version != screen.player_version
    new_error = bool(data.error) and data.error != screen.last_error
    screen.last_seen_at = now
    screen.last_ip = ip
    screen.user_agent = (request.headers.get("user-agent") or "")[:255]
    screen.player_version = data.player_version
    screen.playback_state = data.playback_state
    screen.connection_state = data.connection_state
    screen.current_content = data.current_content
    screen.applied_config_hash = data.config_hash
    if data.storage is not None:
        screen.storage_info = {k: data.storage[k] for k in list(data.storage)[:10]}
    if data.display is not None:
        screen.display_info = _clean_display(data.display)
    if data.error:
        screen.last_error = data.error
        screen.last_error_at = now
    elif data.playback_state == "playing":
        screen.last_error = None

    # histórico enxuto: mudança de estado, volta de offline, erro, ou a cada N segundos
    reason = None
    if was_offline:
        reason = "online"
    elif new_error:
        reason = "error"
    elif changed:
        reason = "state_change"
    elif not screen.last_history_at or (now - screen.last_history_at).total_seconds() >= s.heartbeat_history_every_seconds:
        reason = "periodic"
    if reason:
        db.add(ScreenHeartbeat(
            screen_id=screen.id, created_at=now, reason=reason, playback_state=data.playback_state,
            connection_state=data.connection_state, player_version=data.player_version,
            current_content=data.current_content, error=data.error, ip=ip,
        ))
        screen.last_history_at = now

    # comandos pendentes
    cmds = db.scalars(
        select(ScreenCommand).where(
            ScreenCommand.screen_id == screen.id,
            ScreenCommand.status == CommandStatus.PENDING.value,
        ).order_by(ScreenCommand.created_at)
    ).all()
    out_cmds = []
    for c in cmds:
        if c.expires_at and c.expires_at < now:
            c.status = CommandStatus.EXPIRED.value
            continue
        c.status = CommandStatus.DELIVERED.value
        c.delivered_at = now
        out_cmds.append({"id": c.id, "command": c.command})

    response: Dict[str, Any] = {
        "server_time": now.isoformat(),
        "config_hash": player_config(screen)["config_hash"],
        "heartbeat_interval": s.heartbeat_interval_seconds,
        "commands": out_cmds,
    }
    # renovação do token antes de expirar
    if screen.token_expires_at and screen.token_expires_at - now < timedelta(days=s.device_token_renew_days):
        token = new_device_token()
        screen.pending_token_hash = sha256_hex(token)
        response["new_token"] = token
    db.commit()
    _maintenance(db)
    return response


@router.post("/commands/{command_id}/ack")
def ack_command(command_id: int, data: CommandAck, request: Request, screen: Screen = Depends(get_current_screen),
                db: Session = Depends(get_db)) -> Dict[str, str]:
    cmd = db.get(ScreenCommand, command_id)
    if cmd is None or cmd.screen_id != screen.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comando não encontrado")
    cmd.status = CommandStatus.DONE.value if data.success else CommandStatus.FAILED.value
    cmd.completed_at = _now()
    cmd.result = data.result
    audit.record(db, "screen.command_ack", request=request, screen=screen, entity_type="screen",
                 entity_id=screen.id, details={"command_id": cmd.id, "command": cmd.command, "status": cmd.status})
    db.commit()
    return {"status": cmd.status}


@router.get("/media/{media_id}")
def download_media(media_id: int, exp: int = Query(...), sig: str = Query(..., max_length=64),
                   db: Session = Depends(get_db)):
    """Download por URL assinada (permite <video src> e cache do service worker sem expor o token)."""
    m = get_or_404(db, Media, media_id, "Mídia")
    if not verify_media_signature(m.id, m.sha256, exp, sig):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Assinatura inválida ou expirada")
    path = media_path(m.stored_name)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado no armazenamento")
    return FileResponse(
        path, media_type=m.mime_type,
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
                 "X-Media-SHA256": m.sha256},
    )
