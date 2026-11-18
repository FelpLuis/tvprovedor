from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.enums import DashboardAuthType, DashboardDisplayMode, DashboardKind
from app.schemas.common import ORMModel

# parâmetros que normalmente carregam credenciais e não devem ficar na URL
FORBIDDEN_URL_PARAMS = ("password", "passwd", "senha", "api_key", "apikey", "access_token", "auth_token")


def _validate_url(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    v = v.strip()
    if not (v.startswith("https://") or v.startswith("http://") or v.startswith("/")):
        raise ValueError("A URL deve começar com https://, http:// ou / (rota interna)")
    lower = v.lower()
    for p in FORBIDDEN_URL_PARAMS:
        if f"{p}=" in lower:
            raise ValueError(
                f"A URL contém o parâmetro '{p}'. Não armazene credenciais em URLs; "
                "use links de incorporação oficiais, usuário de privilégio mínimo ou sessão no navegador."
            )
    if "://" in v and "@" in v.split("/")[2]:
        raise ValueError("Não inclua usuário/senha na URL")
    return v


class DashboardBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: DashboardKind
    url: str = Field(min_length=1, max_length=4000)
    refresh_seconds: int = Field(default=300, ge=0, le=86400)  # 0 = não recarregar
    auth_type: DashboardAuthType = DashboardAuthType.NONE
    display_mode: DashboardDisplayMode = DashboardDisplayMode.IFRAME
    options: Dict[str, Any] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=4000)
    is_active: bool = True

    _url = field_validator("url")(_validate_url)


class DashboardCreate(DashboardBase):
    pass


class DashboardUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    kind: Optional[DashboardKind] = None
    url: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    refresh_seconds: Optional[int] = Field(default=None, ge=0, le=86400)
    auth_type: Optional[DashboardAuthType] = None
    display_mode: Optional[DashboardDisplayMode] = None
    options: Optional[Dict[str, Any]] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    is_active: Optional[bool] = None

    _url = field_validator("url")(_validate_url)


class DashboardOut(ORMModel):
    id: int
    name: str
    kind: DashboardKind
    url: str
    refresh_seconds: int
    auth_type: DashboardAuthType
    display_mode: DashboardDisplayMode
    options: Dict[str, Any]
    notes: str
    is_active: bool
    version: int
    screen_count: int = 0
    created_at: datetime
    updated_at: datetime
