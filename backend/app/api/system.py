from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import require_admin, require_operator, require_viewer
from app.database import get_db
from app.models import AuditLog, Dashboard, Media, Playlist, Screen, ScreenGroup, User
from app.services.media import storage_usage
from app.services.screens import is_online, screen_to_out

router = APIRouter(tags=["system"])

APP_VERSION = "0.1.0"


@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require_viewer)) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    screens = db.scalars(select(Screen).order_by(Screen.identifier)).unique().all()
    activated = [s for s in screens if s.token_hash]
    online = [s for s in activated if is_online(s, now)]
    used, free, total = storage_usage()
    return {
        "screens_total": len(screens),
        "screens_online": len(online),
        "screens_offline": len(activated) - len(online),
        "screens_not_activated": len(screens) - len(activated),
        "screens_with_errors": len([s for s in activated if s.last_error]),
        "groups": db.scalar(select(func.count()).select_from(ScreenGroup)) or 0,
        "media": db.scalar(select(func.count()).select_from(Media)) or 0,
        "playlists": db.scalar(select(func.count()).select_from(Playlist)) or 0,
        "dashboards": db.scalar(select(func.count()).select_from(Dashboard)) or 0,
        "storage": {"media_bytes": used, "disk_free_bytes": free, "disk_total_bytes": total},
        "screens": [screen_to_out(s) for s in screens],
        "server_time": now.isoformat(),
    }


@router.get("/audit-logs")
def audit_logs(
    action: Optional[str] = Query(default=None, max_length=64),
    entity_type: Optional[str] = Query(default=None, max_length=32),
    entity_id: Optional[str] = Query(default=None, max_length=64),
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_operator),
) -> List[Dict[str, Any]]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    rows = db.scalars(stmt.limit(limit).offset(offset)).all()
    return [{"id": r.id, "created_at": r.created_at, "actor_type": r.actor_type, "actor_name": r.actor_name,
             "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
             "details": r.details, "ip": r.ip} for r in rows]


@router.get("/system/info")
def system_info(_: User = Depends(require_admin)) -> Dict[str, Any]:
    s = get_settings()
    used, free, total = storage_usage()
    return {
        "version": APP_VERSION,
        "environment": s.environment,
        "heartbeat_interval_seconds": s.heartbeat_interval_seconds,
        "offline_after_seconds": s.offline_after_seconds,
        "activation_code_ttl_seconds": s.activation_code_ttl_seconds,
        "device_token_days": s.device_token_days,
        "max_image_mb": s.max_image_mb,
        "max_video_mb": s.max_video_mb,
        "storage": {"media_bytes": used, "disk_free_bytes": free, "disk_total_bytes": total},
        "database": s.database_url.split("://", 1)[0],
    }


@router.get("/health", include_in_schema=False)
def health(db: Session = Depends(get_db)) -> Dict[str, str]:
    db.execute(select(1))
    return {"status": "ok", "version": APP_VERSION}
