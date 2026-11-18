from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.enums import Role
from app.schemas.common import ORMModel

USERNAME_PATTERN = r"^[a-zA-Z0-9_.\-]{3,64}$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def _check_password(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    if len(v) < 10:
        raise ValueError("A senha deve ter pelo menos 10 caracteres")
    if v.isdigit() or v.isalpha():
        raise ValueError("A senha deve combinar letras e números/símbolos")
    return v


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)  # usuário ou e-mail
    password: str = Field(min_length=1, max_length=256)


class UserOut(ORMModel):
    id: int
    username: str
    email: Optional[str]
    full_name: str
    role: Role
    is_active: bool
    last_login_at: Optional[datetime]
    created_at: datetime


class UserCreate(BaseModel):
    username: str = Field(pattern=USERNAME_PATTERN)
    email: Optional[str] = Field(default=None, pattern=EMAIL_PATTERN, max_length=255)
    full_name: str = Field(default="", max_length=120)
    role: Role = Role.VIEWER
    password: str = Field(max_length=256)

    _pw = field_validator("password")(_check_password)


class UserUpdate(BaseModel):
    email: Optional[str] = Field(default=None, pattern=EMAIL_PATTERN, max_length=255)
    full_name: Optional[str] = Field(default=None, max_length=120)
    role: Optional[Role] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, max_length=256)

    _pw = field_validator("password")(_check_password)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(max_length=256)

    _pw = field_validator("new_password")(_check_password)
