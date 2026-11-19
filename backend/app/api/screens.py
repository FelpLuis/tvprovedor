import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.core.permissions import require_admin, require_operator, require_viewer
from app.core.security import normalize_activation_code
from app.database import get_db
from app.models import (
    Camera,
    Dashboard,
    Playlist,
    Screen,
    ScreenActivationCode,
    ScreenCommand,
    ScreenGroup,
    ScreenHeartbeat,
    User,
)
from app.models.enums import PROFILE_DASHBOARD_KIND, CommandStatus, ScreenProfile
from app.schemas.screens import (
    ActivateRequest,
    BulkAssign,
    CommandCreate,
    CommandOut,
    HeartbeatOut,
    PendingActivation,
    PowerAction,
    PowerSchedule,
    VolumeIn,
    ScreenCreate,
    ScreenOut,
    ScreenUpdate,
)
from app.services import audit
from app.services.power import set_override
from app.services.screens import is_online, screen_to_out

router = APIRouter(prefix="/screens", tags=["screens"])

COMMAND_TTL = timedelta(minutes=10)


def _validate_cameras(db: Session, ids) -> None:
    if ids:
        found = set(db.scalars(select(Camera.id).where(Camera.id.in_(ids))).all())
        missing = sorted(set(ids) - found)
        if missing:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Câmeras inexistentes: {missing}")


def _validate_refs(db: Session, profile: ScreenProfile, group_id, playlist_id, dashboard_id) -> None:
    if group_id is not None:
        get_or_404(db, ScreenGroup, group_id, "Grupo")
    if playlist_id is not None:
        get_or_404(db, Playlist, playlist_id, "Playlist")
    if dashboard_id is not None:
        d = get_or_404(db, Dashboard, dashboard_id, "Dashboard")
        allowed = PROFILE_DASHBOARD_KIND.get(profile)
        if not allowed or d.kind not in {k.value for k in allowed}:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"O dashboard '{d.name}' ({d.kind}) não é compatível com o perfil {profile.value}",
            )


def _unique_identifier(db: Session, identifier: str, exclude_id: Optional[int] = None) -> None:
    q = select(Screen).where(func.lower(Screen.identifier) == identifier.lower())
    if exclude_id:
        q = q.where(Screen.id != exclude_id)
    if db.scalar(q):
        raise conflict(f"Identificação '{identifier}' já está em uso")


def _new_screen(db: Session, data: ScreenCreate) -> Screen:
    _unique_identifier(db, data.identifier)
    _validate_refs(db, data.profile, data.group_id, data.playlist_id, data.dashboard_id)
    _validate_cameras(db, data.camera_ids)
    values = data.model_dump()
    values["profile"] = data.profile.value
    values["status"] = data.status.value
    values["orientation"] = data.orientation.value
    values["identifier"] = data.identifier.upper()
    if data.profile == ScreenProfile.MEDIA_PLAYER:
        values["dashboard_id"] = None
    else:
        values["playlist_id"] = None
    if data.profile == ScreenProfile.CAMERA_PLAYER:
        values["dashboard_id"] = None
    screen = Screen(uid=str(uuid.uuid4()), **values)
    db.add(screen)
    db.flush()
    return screen


@router.get("", response_model=List[ScreenOut])
def list_screens(
    group_id: Optional[int] = None,
    profile: Optional[ScreenProfile] = None,
    online: Optional[bool] = None,
    activated: Optional[bool] = None,
    q: Optional[str] = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    stmt = select(Screen).order_by(Screen.identifier)
    if group_id is not None:
        stmt = stmt.where(Screen.group_id == group_id)
    if profile is not None:
        stmt = stmt.where(Screen.profile == profile.value)
    if activated is not None:
        stmt = stmt.where(Screen.token_hash.isnot(None) if activated else Screen.token_hash.is_(None))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(Screen.name).like(like), func.lower(Screen.identifier).like(like),
            func.lower(Screen.location).like(like), func.lower(Screen.department).like(like),
        ))
    screens = db.scalars(stmt).unique().all()
    if online is not None:
        screens = [s for s in screens if is_online(s) == online]
    return [screen_to_out(s) for s in screens]


@router.post("", response_model=ScreenOut, status_code=201)
def create_screen(data: ScreenCreate, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    screen = _new_screen(db, data)
    audit.record(db, "screen.created", request=request, user=user, entity_type="screen", entity_id=screen.id,
                 details={"identifier": screen.identifier, "name": screen.name, "profile": screen.profile})
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


@router.get("/activations/pending", response_model=List[PendingActivation])
def pending_activations(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    now = datetime.now(timezone.utc)
    return db.scalars(
        select(ScreenActivationCode)
        .where(ScreenActivationCode.activated_at.is_(None), ScreenActivationCode.expires_at > now)
        .order_by(ScreenActivationCode.created_at.desc())
    ).all()


@router.post("/activate", response_model=ScreenOut)
def activate(data: ActivateRequest, request: Request, db: Session = Depends(get_db),
             user: User = Depends(require_admin)):
    code = normalize_activation_code(data.code)
    act = db.scalar(select(ScreenActivationCode).where(ScreenActivationCode.code == code))
    now = datetime.now(timezone.utc)
    if act is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Código de ativação não encontrado")
    if act.activated_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Código de ativação já utilizado")
    if act.expires_at < now:
        raise HTTPException(status.HTTP_410_GONE, "Código de ativação expirado")
    if (data.screen_id is None) == (data.screen is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe screen_id (TV existente) ou screen (nova TV)")
    if data.screen_id is not None:
        screen = get_or_404(db, Screen, data.screen_id, "TV")
    else:
        screen = _new_screen(db, data.screen)
    # o token só é gerado quando o player confirmar o código (poll), invalidando o anterior
    act.activated_at = now
    act.screen_id = screen.id
    act.activated_by_id = user.id
    audit.record(db, "screen.activated", request=request, user=user, entity_type="screen", entity_id=screen.id,
                 details={"code": code, "identifier": screen.identifier})
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


@router.get("/{screen_id}", response_model=ScreenOut)
def get_screen(screen_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return screen_to_out(get_or_404(db, Screen, screen_id, "TV"))


@router.patch("/{screen_id}", response_model=ScreenOut)
def update_screen(screen_id: int, data: ScreenUpdate, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    screen = get_or_404(db, Screen, screen_id, "TV")
    changes = data.model_dump(exclude_unset=True)
    if "identifier" in changes:
        _unique_identifier(db, changes["identifier"], screen.id)
        changes["identifier"] = changes["identifier"].upper()
    profile = changes.get("profile") or ScreenProfile(screen.profile)
    _validate_refs(
        db, profile,
        changes.get("group_id", screen.group_id),
        changes.get("playlist_id", screen.playlist_id),
        changes.get("dashboard_id", screen.dashboard_id if profile.is_dashboard else None),
    )
    if "camera_ids" in changes:
        _validate_cameras(db, changes["camera_ids"])
    for k, v in changes.items():
        setattr(screen, k, v.value if hasattr(v, "value") else v)
    if profile == ScreenProfile.MEDIA_PLAYER:
        screen.dashboard_id = None
    else:
        screen.playlist_id = None
    if not profile.is_dashboard:
        screen.dashboard_id = None
    audit.record(db, "screen.updated", request=request, user=user, entity_type="screen", entity_id=screen.id,
                 details={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()})
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


@router.put("/{screen_id}/playlist", response_model=ScreenOut)
def set_screen_playlist(screen_id: int, data: BulkAssign, request: Request, db: Session = Depends(get_db),
                        user: User = Depends(require_operator)):
    screen = get_or_404(db, Screen, screen_id, "TV")
    if screen.profile != ScreenProfile.MEDIA_PLAYER.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Somente TVs com perfil MEDIA_PLAYER usam playlist")
    if data.playlist_id is not None:
        get_or_404(db, Playlist, data.playlist_id, "Playlist")
    screen.playlist_id = data.playlist_id
    audit.record(db, "screen.playlist_set", request=request, user=user, entity_type="screen",
                 entity_id=screen.id, details={"playlist_id": data.playlist_id})
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


@router.post("/assign-playlist", response_model=List[ScreenOut])
def bulk_assign_playlist(data: BulkAssign, request: Request, db: Session = Depends(get_db),
                         user: User = Depends(require_operator)):
    if data.playlist_id is not None:
        get_or_404(db, Playlist, data.playlist_id, "Playlist")
    screens = db.scalars(select(Screen).where(Screen.id.in_(data.screen_ids))).unique().all()
    media_screens = [s for s in screens if s.profile == ScreenProfile.MEDIA_PLAYER.value]
    for s in media_screens:
        s.playlist_id = data.playlist_id
    audit.record(db, "screen.playlist_bulk_set", request=request, user=user, entity_type="screen",
                 details={"playlist_id": data.playlist_id, "screen_ids": [s.id for s in media_screens]})
    db.commit()
    return [screen_to_out(s) for s in media_screens]


@router.post("/{screen_id}/revoke", response_model=ScreenOut)
def revoke_screen(screen_id: int, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    """Revoga o token do dispositivo. A TV voltará a exibir um código de ativação."""
    screen = get_or_404(db, Screen, screen_id, "TV")
    screen.token_hash = None
    screen.pending_token_hash = None
    screen.token_expires_at = None
    screen.activated_at = None
    audit.record(db, "screen.revoked", request=request, user=user, entity_type="screen", entity_id=screen.id)
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


@router.delete("/{screen_id}", status_code=204)
def delete_screen(screen_id: int, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_admin)):
    screen = get_or_404(db, Screen, screen_id, "TV")
    audit.record(db, "screen.deleted", request=request, user=user, entity_type="screen", entity_id=screen.id,
                 details={"identifier": screen.identifier, "name": screen.name})
    db.delete(screen)
    db.commit()


@router.put("/{screen_id}/power-schedule", response_model=ScreenOut)
def set_power_schedule(screen_id: int, data: PowerSchedule, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_operator)):
    """Horário de funcionamento (liga/desliga automático)."""
    screen = get_or_404(db, Screen, screen_id, "TV")
    screen.power_schedule = data.model_dump()
    audit.record(db, "screen.power_schedule_set", request=request, user=user, entity_type="screen",
                 entity_id=screen.id, details=screen.power_schedule)
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


def _apply_power(db: Session, request: Request, user: User, screens: List[Screen], action: str) -> None:
    for screen in screens:
        set_override(screen, action)
        audit.record(db, f"screen.power_{action}", request=request, user=user, entity_type="screen",
                     entity_id=screen.id, details={"identifier": screen.identifier})
    db.commit()


@router.post("/{screen_id}/power", response_model=ScreenOut)
def power(screen_id: int, data: PowerAction, request: Request, db: Session = Depends(get_db),
          user: User = Depends(require_operator)):
    """Ligar agora / desligar agora / voltar ao automático. A TV aplica no próximo contato."""
    screen = get_or_404(db, Screen, screen_id, "TV")
    _apply_power(db, request, user, [screen], data.action)
    db.refresh(screen)
    return screen_to_out(screen)


@router.put("/{screen_id}/volume", response_model=ScreenOut)
def set_volume(screen_id: int, data: VolumeIn, request: Request, db: Session = Depends(get_db),
               user: User = Depends(require_operator)):
    screen = get_or_404(db, Screen, screen_id, "TV")
    screen.volume = data.volume
    audit.record(db, "screen.volume_set", request=request, user=user, entity_type="screen",
                 entity_id=screen.id, details={"volume": data.volume})
    db.commit()
    db.refresh(screen)
    return screen_to_out(screen)


@router.get("/{screen_id}/heartbeats", response_model=List[HeartbeatOut])
def screen_heartbeats(screen_id: int, limit: int = Query(default=100, le=1000), db: Session = Depends(get_db),
                      _: User = Depends(require_viewer)):
    get_or_404(db, Screen, screen_id, "TV")
    return db.scalars(
        select(ScreenHeartbeat).where(ScreenHeartbeat.screen_id == screen_id)
        .order_by(ScreenHeartbeat.created_at.desc()).limit(limit)
    ).all()


@router.get("/{screen_id}/commands", response_model=List[CommandOut])
def list_commands(screen_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    get_or_404(db, Screen, screen_id, "TV")
    return db.scalars(
        select(ScreenCommand).where(ScreenCommand.screen_id == screen_id)
        .order_by(ScreenCommand.created_at.desc()).limit(50)
    ).all()


@router.post("/{screen_id}/commands", response_model=CommandOut, status_code=201)
def send_command(screen_id: int, data: CommandCreate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_operator)):
    screen = get_or_404(db, Screen, screen_id, "TV")
    if screen.token_hash is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A TV ainda não foi ativada")
    now = datetime.now(timezone.utc)
    cmd = ScreenCommand(screen_id=screen.id, command=data.command.value, created_by_id=user.id,
                        status=CommandStatus.PENDING.value, created_at=now, expires_at=now + COMMAND_TTL)
    db.add(cmd)
    db.flush()
    audit.record(db, "screen.command_sent", request=request, user=user, entity_type="screen",
                 entity_id=screen.id, details={"command": cmd.command, "command_id": cmd.id})
    db.commit()
    return cmd
