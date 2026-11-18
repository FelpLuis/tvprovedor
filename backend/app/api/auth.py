from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import client_ip, get_current_user
from app.core.ratelimit import LoginRateLimiter
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_session_token,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.models import User
from app.schemas.users import LoginRequest, PasswordChange, UserOut
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])

_settings = get_settings()
login_limiter = LoginRateLimiter(_settings.login_max_attempts, _settings.login_lockout_seconds)


def _set_session_cookie(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        s.cookie_name,
        create_session_token(user.id, user.session_version),
        max_age=s.access_token_minutes * 60,
        httponly=True,
        secure=s.secure_cookies,
        samesite="strict",
        path="/",
    )


@router.post("/login", response_model=UserOut)
def login(data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    ident = data.username.strip().lower()
    keys = (f"ip:{ip}", f"user:{ident}")
    blocked, wait = login_limiter.check(*keys)
    if blocked:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Muitas tentativas. Tente novamente em {wait} segundos.",
            headers={"Retry-After": str(wait)},
        )
    user = db.scalar(
        select(User).where(or_(func.lower(User.username) == ident, func.lower(User.email) == ident))
    )
    ok = verify_password(data.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if not user or not ok or not user.is_active:
        login_limiter.fail(*keys)
        audit.record(db, "auth.login_failed", request=request, entity_type="user",
                     details={"username": ident[:64]})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário ou senha inválidos")
    login_limiter.reset(*keys)
    user.last_login_at = datetime.now(timezone.utc)
    audit.record(db, "auth.login", request=request, user=user, entity_type="user", entity_id=user.id)
    db.commit()
    _set_session_cookie(response, user)
    return user


@router.post("/logout", status_code=204)
def logout(response: Response):
    s = get_settings()
    response.delete_cookie(s.cookie_name, path="/", samesite="strict", secure=s.secure_cookies, httponly=True)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", response_model=UserOut)
def change_password(
    data: PasswordChange,
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Senha atual incorreta")
    user.password_hash = hash_password(data.new_password)
    user.session_version += 1
    audit.record(db, "auth.password_changed", request=request, user=user, entity_type="user", entity_id=user.id)
    db.commit()
    _set_session_cookie(response, user)
    return user
