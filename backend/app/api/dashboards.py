from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.core.permissions import require_admin, require_viewer
from app.database import get_db
from app.models import Dashboard, Screen, User
from app.schemas.dashboards import DashboardCreate, DashboardOut, DashboardUpdate
from app.services import audit

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


def _out(db: Session, d: Dashboard) -> DashboardOut:
    count = db.scalar(select(func.count()).select_from(Screen).where(Screen.dashboard_id == d.id)) or 0
    return DashboardOut.model_validate({**{c.name: getattr(d, c.name) for c in Dashboard.__table__.columns},
                                        "options": d.options or {}, "screen_count": count})


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
    d = Dashboard(**_values(data))
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
    for k, v in changes.items():
        setattr(d, k, v)
    d.version += 1
    audit.record(db, "dashboard.updated", request=request, user=user, entity_type="dashboard", entity_id=d.id,
                 details={k: v for k, v in changes.items() if k != "url"} | ({"url": "alterada"} if "url" in changes else {}))
    db.commit()
    return _out(db, d)


@router.delete("/{dashboard_id}", status_code=204)
def delete_dashboard(dashboard_id: int, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_admin)):
    d = get_or_404(db, Dashboard, dashboard_id, "Dashboard")
    count = db.scalar(select(func.count()).select_from(Screen).where(Screen.dashboard_id == d.id)) or 0
    if count:
        raise conflict(f"Dashboard em uso por {count} TV(s)")
    audit.record(db, "dashboard.deleted", request=request, user=user, entity_type="dashboard", entity_id=d.id,
                 details={"name": d.name})
    db.delete(d)
    db.commit()
