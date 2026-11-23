"""Regras de negócio das TVs: status online, conteúdo efetivo e configuração do player."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import sign_media_url
from app.models import Dashboard, Playlist, Screen
from app.models.enums import ORIENTATION_ROTATION, DashboardKind, MediaKind, Orientation, ScreenProfile, ScreenStatus

PLAYER_CONFIG_SCHEMA = 1


def is_online(screen: Screen, now: Optional[datetime] = None) -> bool:
    if not screen.last_seen_at:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - screen.last_seen_at) <= timedelta(seconds=get_settings().offline_after_seconds)


def effective_playlist(screen: Screen) -> Optional[Playlist]:
    if screen.profile != ScreenProfile.MEDIA_PLAYER.value:
        return None
    if screen.playlist is not None:
        return screen.playlist
    if screen.group is not None and screen.group.playlist is not None:
        return screen.group.playlist
    return None


def effective_content_label(screen: Screen) -> Optional[str]:
    if screen.profile == ScreenProfile.MEDIA_PLAYER.value:
        pl = effective_playlist(screen)
        if pl is None:
            return None
        origin = "" if screen.playlist is not None else " (grupo)"
        return f"Playlist: {pl.name}{origin}"
    if screen.profile == ScreenProfile.CAMERA_PLAYER.value:
        n = len(screen.camera_ids or [])
        return f"Câmeras: {n}" if n else None
    if screen.dashboard is not None:
        return f"Dashboard: {screen.dashboard.name}"
    return None


def build_dashboard_url(dashboard: Dashboard) -> str:
    """Aplica parâmetros de exibição conforme a plataforma (ex.: modo kiosk do Grafana)."""
    url = dashboard.url
    opts = dashboard.options or {}
    extra: Dict[str, str] = {}
    if dashboard.kind == DashboardKind.GRAFANA.value:
        kiosk = opts.get("kiosk", True)
        if kiosk is True or kiosk == "full":
            extra["kiosk"] = ""
        elif kiosk:
            extra["kiosk"] = str(kiosk)
        if opts.get("refresh"):
            extra["refresh"] = str(opts["refresh"])
        if opts.get("theme") in ("dark", "light"):
            extra["theme"] = opts["theme"]
    elif dashboard.kind == DashboardKind.POWERBI.value:
        # parâmetros oficiais de embed para ocultar painel de filtros/navegação
        if opts.get("hide_panes", True) and "reportView" not in url:
            extra.setdefault("filterPaneEnabled", "false")
            extra.setdefault("navContentPaneEnabled", "false")
    elif dashboard.kind == DashboardKind.ZABBIX.value:
        if opts.get("kiosk", True):
            extra["kiosk"] = "1"
    for k, v in (opts.get("query") or {}).items():
        extra[str(k)] = str(v)
    if not extra:
        return url
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    present = {k for k, _ in query}
    for k, v in extra.items():
        if k not in present:
            query.append((k, v))
    q = "&".join(quote(k, safe="") if v == "" else urlencode([(k, v)]) for k, v in query)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, q, parts.fragment))


def _playlist_payload(pl: Playlist) -> Dict[str, Any]:
    items = []
    for it in pl.items:
        m = it.media
        duration = None
        if m.kind == MediaKind.IMAGE.value:
            duration = it.duration_seconds or pl.default_image_seconds
        items.append(
            {
                "id": it.id,
                "media_id": m.id,
                "kind": m.kind,
                "name": m.original_name,
                "mime": m.mime_type,
                "sha256": m.sha256,
                "size": m.size_bytes,
                "duration": duration,  # None = vídeo até o fim
                "max_duration": it.duration_seconds if m.kind == MediaKind.VIDEO.value else None,
            }
        )
    return {
        "id": pl.id,
        "name": pl.name,
        "version": pl.version,
        "fit_mode": pl.fit_mode,
        "transition": pl.transition,
        "default_image_seconds": pl.default_image_seconds,
        "items": items,
    }


def dashboard_auth(d: Dashboard) -> Optional[Dict[str, Any]]:
    """Credenciais para o app entrar sozinho (somente para a TV autenticada)."""
    if d.auth_type not in ("login_form", "http_basic") or not d.username:
        return None
    from app.core.crypto import decrypt

    opts = d.options or {}
    return {
        "type": d.auth_type,
        "username": d.username,
        "password": decrypt(d.password_encrypted) or "",
        "login_url": d.login_url or "",
        "user_selector": str(opts.get("user_selector") or ""),
        "pass_selector": str(opts.get("pass_selector") or ""),
        "submit_selector": str(opts.get("submit_selector") or ""),
    }


def display_payload(screen: Screen) -> Dict[str, Any]:
    """Disposição da tela: o player gira e escala um "palco" lógico conforme estes valores."""
    orientation = Orientation(screen.orientation or Orientation.LANDSCAPE.value)
    rotation = ORIENTATION_ROTATION[orientation]
    width = height = None
    if screen.resolution and screen.resolution != "auto":
        width, height = (int(x) for x in screen.resolution.split("x"))
        if rotation in (90, 270):
            width, height = height, width  # em retrato o palco fica em pé
    return {
        "orientation": orientation.value,
        "rotation": rotation,
        "width": width,      # None = usar a resolução detectada no aparelho
        "height": height,
        "safe_margin_percent": screen.safe_margin_percent or 0,
        "inches": screen.screen_inches,
        "fullscreen": screen.fullscreen is not False,
    }


def audio_payload(screen: Screen) -> Dict[str, Any]:
    return {"volume": screen.volume}


def player_config(screen: Screen) -> Dict[str, Any]:
    """Configuração completa enviada ao player. O hash ignora as URLs assinadas (que mudam)."""
    s = get_settings()
    cfg: Dict[str, Any] = {
        "schema": PLAYER_CONFIG_SCHEMA,
        "screen": {
            "uid": screen.uid,
            "identifier": screen.identifier,
            "name": screen.name,
            "profile": screen.profile,
            "status": screen.status,
        },
        "heartbeat_interval": s.heartbeat_interval_seconds,
        "display": display_payload(screen),
        "audio": audio_payload(screen),
        "mode": "idle",
        "playlist": None,
        "dashboard": None,
        "cameras": None,
    }
    if screen.status == ScreenStatus.DISABLED.value:
        cfg["mode"] = "disabled"
    elif screen.profile == ScreenProfile.MEDIA_PLAYER.value:
        pl = effective_playlist(screen)
        if pl is not None and pl.is_active and pl.items:
            cfg["mode"] = "media"
            cfg["playlist"] = _playlist_payload(pl)
    elif screen.profile == ScreenProfile.CAMERA_PLAYER.value:
        from sqlalchemy.orm import object_session

        from app.services.cameras import cameras_payload

        session = object_session(screen)
        cams = cameras_payload(session, screen) if session is not None else None
        if cams:
            cfg["mode"] = "cameras"
            cfg["cameras"] = cams
    else:
        d = screen.dashboard
        if d is not None and d.is_active:
            cfg["mode"] = "dashboard"
            cfg["dashboard"] = {
                "id": d.id,
                "name": d.name,
                "kind": d.kind,
                "url": build_dashboard_url(d),
                "refresh_seconds": screen.refresh_seconds or d.refresh_seconds,
                "display_mode": d.display_mode,
                "auth_type": d.auth_type,
                "load_timeout_seconds": int((d.options or {}).get("load_timeout_seconds", 60)),
                "full_reload_hours": int((d.options or {}).get("full_reload_hours", 12)),
                "version": d.version,
                "auth": dashboard_auth(d),
            }
    cfg["config_hash"] = config_hash(cfg)
    return cfg


def config_hash(cfg: Dict[str, Any]) -> str:
    data = {k: v for k, v in cfg.items() if k != "config_hash"}
    raw = json.dumps(data, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()[:32]


def sign_playlist_urls(cfg: Dict[str, Any]) -> Dict[str, Any]:
    if cfg.get("playlist"):
        for item in cfg["playlist"]["items"]:
            item["url"] = sign_media_url(item["media_id"], item["sha256"])
    return cfg


def screen_to_out(screen: Screen) -> Dict[str, Any]:
    from app.schemas.screens import ScreenOut

    cfg_hash = player_config(screen)["config_hash"] if screen.token_hash else None
    from app.services.power import evaluate

    data = ScreenOut.model_validate(
        {
            "power": evaluate(screen).as_dict(),
            **{c.name: getattr(screen, c.name) for c in Screen.__table__.columns},
            "group": screen.group,
            "playlist": screen.playlist,
            "dashboard": screen.dashboard,
            "activated": screen.token_hash is not None,
            "online": is_online(screen),
            "effective_content": effective_content_label(screen),
            "config_hash": cfg_hash,
            "in_sync": bool(cfg_hash and cfg_hash == screen.applied_config_hash),
        }
    )
    return data.model_dump()


def count_screens_using_playlist(db: Session, playlist_id: int) -> int:
    return db.scalar(select(func.count()).select_from(Screen).where(Screen.playlist_id == playlist_id)) or 0
