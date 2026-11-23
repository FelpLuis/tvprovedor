from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.core.crypto import encrypt
from app.core.permissions import require_admin, require_viewer
from app.database import get_db
from app.models import Dashboard, Screen, User
from app.schemas.dashboards import DashboardCreate, DashboardOut, DashboardUpdate
from app.services import audit

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


def _out(db: Session, d: Dashboard) -> DashboardOut:
    count = db.scalar(select(func.count()).select_from(Screen).where(Screen.dashboard_id == d.id)) or 0
    data = {c.name: getattr(d, c.name) for c in Dashboard.__table__.columns if c.name != "password_encrypted"}
    return DashboardOut.model_validate({**data, "options": d.options or {}, "screen_count": count,
                                        "username": d.username or "", "login_url": d.login_url or "",
                                        "has_password": bool(d.password_encrypted)})


def _apply_password(d: Dashboard, values: dict) -> None:
    if "password" in values:
        pwd = values.pop("password")
        d.password_encrypted = encrypt(pwd) if pwd else None


def _values(data) -> dict:
    out = {}
    for k, v in data.model_dump(exclude_unset=True).items():
        out[k] = v.value if hasattr(v, "value") else v
    return out


@router.get("", response_model=List[DashboardOut])
def list_dashboards(db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return [_out(db, d) for d in db.scalars(select(Dashboard).order_by(Dashboard.name)).all()]


@router.get("/{dashboard_id}", response_model=DashboardOut)
def get_dashboard(dashboard_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)):
    return _out(db, get_or_404(db, Dashboard, dashboard_id, "Dashboard"))


@router.post("", response_model=DashboardOut, status_code=201)
def create_dashboard(data: DashboardCreate, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_admin)):
    if db.scalar(select(Dashboard).where(func.lower(Dashboard.name) == data.name.lower())):
        raise conflict("Já existe um dashboard com esse nome")
    values = _values(data)
    pwd = values.pop("password", None)
    d = Dashboard(**values, password_encrypted=encrypt(pwd) if pwd else None)
    db.add(d)
    db.flush()
    audit.record(db, "dashboard.created", request=request, user=user, entity_type="dashboard", entity_id=d.id,
                 details={"name": d.name, "kind": d.kind})
    db.commit()
    return _out(db, d)


@router.patch("/{dashboard_id}", response_model=DashboardOut)
def update_dashboard(dashboard_id: int, data: DashboardUpdate, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_admin)):
    d = get_or_404(db, Dashboard, dashboard_id, "Dashboard")
    changes = _values(data)
    if "name" in changes:
        other = db.scalar(select(Dashboard).where(func.lower(Dashboard.name) == changes["name"].lower(),
                                                  Dashboard.id != d.id))
        if other:
            raise conflict("Já existe um dashboard com esse nome")
    pwd_changed = "password" in changes
    _apply_password(d, changes)
    for k, v in changes.items():
        setattr(d, k, v)
    d.version += 1
    audit.record(db, "dashboard.updated", request=request, user=user, entity_type="dashboard", entity_id=d.id,
                 details={k: v for k, v in changes.items() if k != "url"} | ({"url": "alterada"} if "url" in changes else {})
                 | ({"password": "alterada"} if pwd_changed else {}))
    db.commit()
    return _out(db, d)


@router.delete("/{dashboard_id}", status_code=204)
def delete_dashboard(dashboard_id: int, request: Request, force: bool = False, db: Session = Depends(get_db),
                     user: User = Depends(require_admin)):
    d = get_or_404(db, Dashboard, dashboard_id, "Dashboard")
    screens = db.scalars(select(Screen).where(Screen.dashboard_id == d.id)).unique().all()
    if screens and not force:
        raise conflict(f"Dashboard em uso por {len(screens)} TV(s)")
    for s in screens:  # force: as TVs ficam sem dashboard (exibem "nada programado")
        s.dashboard_id = None
    audit.record(db, "dashboard.deleted", request=request, user=user, entity_type="dashboard", entity_id=d.id,
                 details={"name": d.name})
    db.delete(d)
    db.commit()
