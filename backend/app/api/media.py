from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.core.config import get_settings
from app.core.permissions import require_operator, require_viewer
from app.database import get_db
from app.models import Media, Playlist, PlaylistItem, User
from app.models.enums import MediaKind
from app.schemas.media import MediaOut, MediaUpdate
from app.services import audit
from app.services.media import delete_files, media_path, save_upload

router = APIRouter(prefix="/media", tags=["media"])


def media_out(m: Media) -> MediaOut:
    return MediaOut.model_validate({**{c.name: getattr(m, c.name) for c in Media.__table__.columns},
                                    "has_thumbnail": bool(m.thumbnail_name)})


@router.get("", response_model=List[MediaOut])
def list_media(
    kind: Optional[MediaKind] = None,
    folder: Optional[str] = Query(default=None, max_length=120),
    q: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=500, le=2000),
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    stmt = select(Media).order_by(Media.created_at.desc())
    if kind:
        stmt = stmt.where(Media.kind == kind.value)
    if folder is not None:
        stmt = stmt.where(Media.folder == folder)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Media.original_name).like(like), func.lower(Media.folder).like(like)))
    return [media_out(m) for m in db.scalars(stmt.limit(limit).offset(offset)).all()]


@router.get("/folders", response_model=List[str])
def list_folders(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return [f for f in db.scalars(select(distinct(Media.folder)).order_by(Media.folder)).all() if f]


@router.post("", status_code=201)
async def upload_media(
    request: Request,
    files: List[UploadFile] = File(...),
    folder: str = Form(default="", max_length=120),
    db: Session = Depends(get_db),
    user: User = Depends(require_operator),
):
    created, errors, warnings = [], [], []
    for up in files:
        try:
            stored = await save_upload(up)
        except HTTPException as e:
            errors.append({"file": up.filename, "error": e.detail})
            continue
        dup = db.scalar(select(Media).where(Media.sha256 == stored.sha256))
        if dup is not None:
            delete_files(stored.stored_name, stored.thumbnail_name)
            errors.append({"file": up.filename, "error": f"Arquivo idêntico já existe na biblioteca: {dup.original_name}"})
            continue
        m = Media(
            original_name=(up.filename or "arquivo")[:255], stored_name=stored.stored_name, kind=stored.kind.value,
            mime_type=stored.mime, extension=stored.extension, size_bytes=stored.size, sha256=stored.sha256,
            width=stored.width, height=stored.height, duration_seconds=stored.duration,
            thumbnail_name=stored.thumbnail_name, folder=folder.strip(), uploaded_by_id=user.id,
        )
        db.add(m)
        db.flush()
        if stored.warning:
            warnings.append({"file": up.filename, "warning": stored.warning})
        audit.record(db, "media.uploaded", request=request, user=user, entity_type="media", entity_id=m.id,
                     details={"name": m.original_name, "size": m.size_bytes, "kind": m.kind})
        created.append(m)
    db.commit()
    if not created and errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"message": "Nenhum arquivo foi aceito", "errors": errors})
    return {"created": [media_out(m).model_dump(mode="json") for m in created], "errors": errors,
            "warnings": warnings}


@router.get("/{media_id}", response_model=MediaOut)
def get_media(media_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return media_out(get_or_404(db, Media, media_id, "Mídia"))


@router.patch("/{media_id}", response_model=MediaOut)
def update_media(media_id: int, data: MediaUpdate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_operator)):
    m = get_or_404(db, Media, media_id, "Mídia")
    changes = data.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(m, k, v.strip() if isinstance(v, str) else v)
    audit.record(db, "media.updated", request=request, user=user, entity_type="media", entity_id=m.id,
                 details=changes)
    db.commit()
    return media_out(m)


@router.delete("/{media_id}", status_code=204)
def delete_media(media_id: int, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_operator)):
    m = get_or_404(db, Media, media_id, "Mídia")
    used = db.scalars(
        select(Playlist.name).join(PlaylistItem, PlaylistItem.playlist_id == Playlist.id)
        .where(PlaylistItem.media_id == m.id).distinct()
    ).all()
    if used:
        raise conflict("Mídia em uso nas playlists: " + ", ".join(used))
    audit.record(db, "media.deleted", request=request, user=user, entity_type="media", entity_id=m.id,
                 details={"name": m.original_name})
    stored, thumb = m.stored_name, m.thumbnail_name
    db.delete(m)
    db.commit()
    delete_files(stored, thumb)


def _file(path, mime):
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado")
    return FileResponse(path, media_type=mime, headers={
        "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})


@router.get("/{media_id}/file")
def media_file(media_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    m = get_or_404(db, Media, media_id, "Mídia")
    return _file(media_path(m.stored_name), m.mime_type)


@router.get("/{media_id}/thumbnail")
def media_thumbnail(media_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    m = get_or_404(db, Media, media_id, "Mídia")
    if not m.thumbnail_name:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sem miniatura")
    return _file(get_settings().thumbnails_dir / m.thumbnail_name, "image/webp")
