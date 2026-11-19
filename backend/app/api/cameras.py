from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_or_404
from app.core.crypto import encrypt
from app.core.permissions import require_admin, require_viewer
from app.database import get_db
from app.models import Camera, Screen, User
from app.schemas.cameras import CameraCreate, CameraOut, CameraUpdate
from app.services import audit
from app.services.cameras import rtsp_url

router = APIRouter(prefix="/cameras", tags=["cameras"])


def _screens_using(db: Session, cam_id: int) -> List[Screen]:
    return [s for s in db.scalars(select(Screen)).unique().all() if cam_id in (s.camera_ids or [])]


def _out(db: Session, c: Camera) -> CameraOut:
    return CameraOut.model_validate({
        **{k: getattr(c, k) for k in ("id", "name", "location", "brand", "host", "port", "username", "channel",
                                       "stream", "rtsp_path", "is_active", "notes", "created_at")},
        "has_password": bool(c.password_encrypted),
        "rtsp_preview": rtsp_url(c, with_credentials=False),
        "screen_count": len(_screens_using(db, c.id)),
    })


@router.get("", response_model=List[CameraOut])
def list_cameras(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return [_out(db, c) for c in db.scalars(select(Camera).order_by(Camera.name)).all()]


@router.post("", response_model=CameraOut, status_code=201)
def create_camera(data: CameraCreate, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    values = data.model_dump(exclude={"password"})
    cam = Camera(**values, password_encrypted=encrypt(data.password) if data.password else None)
    db.add(cam)
    db.flush()
    audit.record(db, "camera.created", request=request, user=user, entity_type="camera", entity_id=cam.id,
                 details={"name": cam.name, "host": cam.host, "channel": cam.channel})
    db.commit()
    return _out(db, cam)


@router.patch("/{camera_id}", response_model=CameraOut)
def update_camera(camera_id: int, data: CameraUpdate, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    cam = get_or_404(db, Camera, camera_id, "Câmera")
    changes = data.model_dump(exclude_unset=True)
    if "password" in changes:
        pwd = changes.pop("password")
        cam.password_encrypted = encrypt(pwd) if pwd else None
        changes["password"] = "alterada" if pwd else "removida"  # só para auditoria
    for k, v in changes.items():
        if k != "password":
            setattr(cam, k, v)
    audit.record(db, "camera.updated", request=request, user=user, entity_type="camera", entity_id=cam.id,
                 details=changes)
    db.commit()
    return _out(db, cam)


@router.delete("/{camera_id}", status_code=204)
def delete_camera(camera_id: int, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    cam = get_or_404(db, Camera, camera_id, "Câmera")
    for s in _screens_using(db, cam.id):  # retira a câmera dos mosaicos
        s.camera_ids = [i for i in s.camera_ids if i != cam.id]
    audit.record(db, "camera.deleted", request=request, user=user, entity_type="camera", entity_id=cam.id,
                 details={"name": cam.name})
    db.delete(cam)
    db.commit()
