from typing import Any, Dict, List, Optional
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt
from app.models import Camera, Screen

LAYOUT_SLOTS = {"1": 1, "4": 4, "9": 9, "16": 16}


def rtsp_url(cam: Camera, with_credentials: bool = True) -> str:
    """URL RTSP. Intelbras/Dahua: /cam/realmonitor?channel=N&subtype=0 (principal) ou 1 (extra)."""
    if cam.rtsp_path:
        path = cam.rtsp_path if cam.rtsp_path.startswith("/") else "/" + cam.rtsp_path
    else:
        path = f"/cam/realmonitor?channel={cam.channel}&subtype={0 if cam.stream == 'main' else 1}"
    auth = ""
    if with_credentials and cam.username:
        pwd = decrypt(cam.password_encrypted) or ""
        auth = quote(cam.username, safe="") + (":" + quote(pwd, safe="") if pwd else "") + "@"
    elif cam.username:
        auth = quote(cam.username, safe="") + ":***@"
    return f"rtsp://{auth}{cam.host}:{cam.port}{path}"


def auto_layout(count: int) -> str:
    for key, slots in LAYOUT_SLOTS.items():
        if count <= slots:
            return key
    return "16"


def cameras_payload(db: Session, screen: Screen) -> Optional[Dict[str, Any]]:
    ids: List[int] = [int(i) for i in (screen.camera_ids or [])]
    if not ids:
        return None
    found = {c.id: c for c in db.scalars(select(Camera).where(Camera.id.in_(ids), Camera.is_active.is_(True))).all()}
    items = [{"id": c.id, "name": c.name, "url": rtsp_url(c)} for c in (found.get(i) for i in ids) if c]
    if not items:
        return None
    layout = screen.camera_layout if screen.camera_layout in LAYOUT_SLOTS else auto_layout(len(items))
    return {"layout": layout, "slots": LAYOUT_SLOTS[layout], "cycle_seconds": screen.camera_cycle_seconds or 0,
            "items": items}
