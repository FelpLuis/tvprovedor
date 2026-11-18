from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import conflict, get_or_404
from app.core.permissions import require_admin
from app.core.security import hash_password
from app.database import get_db
from app.models import User
from app.models.enums import Role
from app.schemas.users import UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(prefix="/users", tags=["users"])


def _active_admins(db: Session) -> int:
    return db.scalar(
        select(func.count()).select_from(User).where(User.role == Role.ADMIN.value, User.is_active.is_(True))
    ) or 0


@router.get("", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(data: UserCreate, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)):
    if db.scalar(select(User).where(func.lower(User.username) == data.username.lower())):
        raise conflict("Nome de usuário já existe")
    if data.email and db.scalar(select(User).where(func.lower(User.email) == data.email.lower())):
        raise conflict("E-mail já cadastrado")
    user = User(
        username=data.username,
        email=data.email.lower() if data.email else None,
        full_name=data.full_name,
        role=data.role.value,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.flush()
    audit.record(db, "user.created", request=request, user=admin, entity_type="user", entity_id=user.id,
                 details={"username": user.username, "role": user.role})
    db.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)):
    user = get_or_404(db, User, user_id, "Usuário")
    changes = data.model_dump(exclude_unset=True)
    demoting = ("role" in changes and changes["role"] != Role.ADMIN) or changes.get("is_active") is False
    if demoting and user.role == Role.ADMIN.value and user.is_active and _active_admins(db) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não é possível remover o último administrador ativo")
    if "email" in changes and changes["email"]:
        other = db.scalar(select(User).where(func.lower(User.email) == changes["email"].lower(), User.id != user.id))
        if other:
            raise conflict("E-mail já cadastrado")
        changes["email"] = changes["email"].lower()
    invalidate = False
    for field, value in changes.items():
        if field == "password":
            if value:
                user.password_hash = hash_password(value)
                invalidate = True
            continue
        if field == "role" and value is not None:
            value = value.value if hasattr(value, "value") else value
            invalidate = invalidate or value != user.role
        if field == "is_active" and value is False:
            invalidate = True
        setattr(user, field, value)
    if invalidate:
        user.session_version += 1
    audit.record(db, "user.updated", request=request, user=admin, entity_type="user", entity_id=user.id,
                 details={k: ("***" if k == "password" else (v.value if hasattr(v, "value") else v))
                          for k, v in changes.items()})
    db.commit()
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require_admin)):
    user = get_or_404(db, User, user_id, "Usuário")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Você não pode excluir o próprio usuário")
    if user.role == Role.ADMIN.value and user.is_active and _active_admins(db) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não é possível remover o último administrador ativo")
    audit.record(db, "user.deleted", request=request, user=admin, entity_type="user", entity_id=user.id,
                 details={"username": user.username})
    db.delete(user)
    db.commit()
