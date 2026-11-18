from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.api.media import media_out
from app.core.permissions import require_operator, require_viewer
from app.database import get_db
from app.models import Media, Playlist, PlaylistItem, Screen, ScreenGroup, User
from app.models.enums import MediaKind
from app.schemas.media import PlaylistCreate, PlaylistItemIn, PlaylistOut, PlaylistUpdate
from app.services import audit

router = APIRouter(prefix="/playlists", tags=["playlists"])


def _out(db: Session, pl: Playlist) -> PlaylistOut:
    total = 0.0
    for it in pl.items:
        if it.media.kind == MediaKind.IMAGE.value:
            total += it.duration_seconds or pl.default_image_seconds
        else:
            total += it.media.duration_seconds or 0
    screens = db.scalar(select(func.count()).select_from(Screen).where(Screen.playlist_id == pl.id)) or 0
    return PlaylistOut.model_validate({
        **{c.name: getattr(pl, c.name) for c in Playlist.__table__.columns},
        "items": [{"id": it.id, "position": it.position, "media_id": it.media_id,
                   "duration_seconds": it.duration_seconds, "media": media_out(it.media)} for it in pl.items],
        "total_seconds": round(total, 1),
        "screen_count": screens,
    })


def _set_items(db: Session, pl: Playlist, items: List[PlaylistItemIn]) -> None:
    ids = {i.media_id for i in items}
    found = {m.id for m in db.scalars(select(Media).where(Media.id.in_(ids))).all()} if ids else set()
    missing = ids - found
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Mídias inexistentes: {sorted(missing)}")
    pl.items.clear()
    db.flush()
    for pos, it in enumerate(items):
        pl.items.append(PlaylistItem(media_id=it.media_id, position=pos, duration_seconds=it.duration_seconds))


@router.get("", response_model=List[PlaylistOut])
def list_playlists(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return [_out(db, p) for p in db.scalars(select(Playlist).order_by(Playlist.name)).unique().all()]


@router.get("/{playlist_id}", response_model=PlaylistOut)
def get_playlist(playlist_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return _out(db, get_or_404(db, Playlist, playlist_id, "Playlist"))


@router.post("", response_model=PlaylistOut, status_code=201)
def create_playlist(data: PlaylistCreate, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_operator)):
    if db.scalar(select(Playlist).where(func.lower(Playlist.name) == data.name.lower())):
        raise conflict("Já existe uma playlist com esse nome")
    values = data.model_dump(exclude={"items"})
    values["fit_mode"] = data.fit_mode.value
    values["transition"] = data.transition.value
    pl = Playlist(**values)
    db.add(pl)
    db.flush()
    _set_items(db, pl, data.items)
    audit.record(db, "playlist.created", request=request, user=user, entity_type="playlist", entity_id=pl.id,
                 details={"name": pl.name, "items": len(data.items)})
    db.commit()
    db.refresh(pl)
    return _out(db, pl)


@router.patch("/{playlist_id}", response_model=PlaylistOut)
def update_playlist(playlist_id: int, data: PlaylistUpdate, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_operator)):
    pl = get_or_404(db, Playlist, playlist_id, "Playlist")
    changes = data.model_dump(exclude_unset=True, exclude={"items"})
    if "name" in changes:
        other = db.scalar(select(Playlist).where(func.lower(Playlist.name) == changes["name"].lower(),
                                                 Playlist.id != pl.id))
        if other:
            raise conflict("Já existe uma playlist com esse nome")
    for k, v in changes.items():
        setattr(pl, k, v.value if hasattr(v, "value") else v)
    if data.items is not None:
        _set_items(db, pl, data.items)
    pl.version += 1
    audit.record(db, "playlist.updated", request=request, user=user, entity_type="playlist", entity_id=pl.id,
                 details={**{k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()},
                          **({"items": len(data.items)} if data.items is not None else {})})
    db.commit()
    db.refresh(pl)
    return _out(db, pl)


@router.post("/{playlist_id}/duplicate", response_model=PlaylistOut, status_code=201)
def duplicate_playlist(playlist_id: int, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_operator)):
    src = get_or_404(db, Playlist, playlist_id, "Playlist")
    base, n = f"{src.name} (cópia)", 2
    name = base
    while db.scalar(select(Playlist).where(Playlist.name == name)):
        name, n = f"{base} {n}", n + 1
    pl = Playlist(name=name[:120], description=src.description, is_active=False,
                  default_image_seconds=src.default_image_seconds, fit_mode=src.fit_mode, transition=src.transition)
    db.add(pl)
    db.flush()
    for it in src.items:
        pl.items.append(PlaylistItem(media_id=it.media_id, position=it.position, duration_seconds=it.duration_seconds))
    audit.record(db, "playlist.duplicated", request=request, user=user, entity_type="playlist", entity_id=pl.id,
                 details={"from": src.id})
    db.commit()
    db.refresh(pl)
    return _out(db, pl)


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_operator)):
    pl = get_or_404(db, Playlist, playlist_id, "Playlist")
    screens = db.scalar(select(func.count()).select_from(Screen).where(Screen.playlist_id == pl.id)) or 0
    groups = db.scalar(select(func.count()).select_from(ScreenGroup).where(ScreenGroup.playlist_id == pl.id)) or 0
    if screens or groups:
        raise conflict(f"Playlist em uso por {screens} TV(s) e {groups} grupo(s). Desvincule antes de excluir.")
    audit.record(db, "playlist.deleted", request=request, user=user, entity_type="playlist", entity_id=pl.id,
                 details={"name": pl.name})
    db.delete(pl)
    db.commit()
