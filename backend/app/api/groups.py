from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.core.permissions import require_admin, require_operator, require_viewer
from app.database import get_db
from app.models import Playlist, Screen, ScreenGroup, User
from app.schemas.screens import BulkAssign, GroupCreate, GroupOut, GroupUpdate
from app.services import audit

router = APIRouter(prefix="/groups", tags=["groups"])


def _out(db: Session, g: ScreenGroup) -> GroupOut:
    count = db.scalar(select(func.count()).select_from(Screen).where(Screen.group_id == g.id)) or 0
    return GroupOut.model_validate(
        {"id": g.id, "name": g.name, "description": g.description, "playlist_id": g.playlist_id,
         "playlist": g.playlist, "screen_count": count, "created_at": g.created_at}
    )


def _check_playlist(db: Session, playlist_id):
    if playlist_id is not None:
        get_or_404(db, Playlist, playlist_id, "Playlist")


@router.get("", response_model=List[GroupOut])
def list_groups(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return [_out(db, g) for g in db.scalars(select(ScreenGroup).order_by(ScreenGroup.name)).all()]


@router.get("/{group_id}", response_model=GroupOut)
def get_group(group_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return _out(db, get_or_404(db, ScreenGroup, group_id, "Grupo"))


@router.post("", response_model=GroupOut, status_code=201)
def create_group(data: GroupCreate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_admin)):
    if db.scalar(select(ScreenGroup).where(func.lower(ScreenGroup.name) == data.name.lower())):
        raise conflict("Já existe um grupo com esse nome")
    _check_playlist(db, data.playlist_id)
    g = ScreenGroup(**data.model_dump())
    db.add(g)
    db.flush()
    audit.record(db, "group.created", request=request, user=user, entity_type="group", entity_id=g.id,
                 details={"name": g.name})
    db.commit()
    return _out(db, g)


@router.patch("/{group_id}", response_model=GroupOut)
def update_group(group_id: int, data: GroupUpdate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_admin)):
    g = get_or_404(db, ScreenGroup, group_id, "Grupo")
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        other = db.scalar(select(ScreenGroup).where(
            func.lower(ScreenGroup.name) == changes["name"].lower(), ScreenGroup.id != g.id))
        if other:
            raise conflict("Já existe um grupo com esse nome")
    if "playlist_id" in changes:
        _check_playlist(db, changes["playlist_id"])
    for k, v in changes.items():
        setattr(g, k, v)
    audit.record(db, "group.updated", request=request, user=user, entity_type="group", entity_id=g.id,
                 details=changes)
    db.commit()
    db.refresh(g)
    return _out(db, g)


@router.put("/{group_id}/playlist", response_model=GroupOut)
def set_group_playlist(group_id: int, data: BulkAssign, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_operator)):
    """Define a playlist padrão do grupo (operadores podem alterar programação)."""
    g = get_or_404(db, ScreenGroup, group_id, "Grupo")
    _check_playlist(db, data.playlist_id)
    g.playlist_id = data.playlist_id
    audit.record(db, "group.playlist_set", request=request, user=user, entity_type="group", entity_id=g.id,
                 details={"playlist_id": data.playlist_id})
    db.commit()
    db.refresh(g)
    return _out(db, g)


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: int, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_admin)):
    g = get_or_404(db, ScreenGroup, group_id, "Grupo")
    count = db.scalar(select(func.count()).select_from(Screen).where(Screen.group_id == g.id)) or 0
    if count:
        raise conflict(f"O grupo possui {count} TV(s). Remova-as do grupo antes de excluir.")
    audit.record(db, "group.deleted", request=request, user=user, entity_type="group", entity_id=g.id,
                 details={"name": g.name})
    db.delete(g)
    db.commit()
