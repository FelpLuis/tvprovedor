from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.enums import CommandType, Orientation, ScreenProfile, ScreenStatus
from app.schemas.common import IdName, ORMModel

IDENTIFIER_PATTERN = r"^[A-Za-z0-9_\-]{1,32}$"
# "auto" ou largura x altura em paisagem (ex.: 1920x1080); em retrato o player inverte
RESOLUTION_PATTERN = r"^(auto|[0-9]{3,4}x[0-9]{3,4})$"


def _check_resolution(v: Optional[str]) -> Optional[str]:
    if v is None or v == "auto":
        return v
    w, h = (int(x) for x in v.split("x"))
    if not (320 <= w <= 7680 and 240 <= h <= 4320):
        raise ValueError("Resolução fora do intervalo suportado (320x240 a 7680x4320)")
    if h > w:
        w, h = h, w  # sempre armazenada em paisagem; a orientação define a rotação
    return f"{w}x{h}"


class GroupBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    playlist_id: Optional[int] = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=2000)
    playlist_id: Optional[int] = None


class GroupOut(ORMModel):
    id: int
    name: str
    description: str
    playlist_id: Optional[int]
    playlist: Optional[IdName] = None
    screen_count: int = 0
    created_at: datetime


class ScreenBase(BaseModel):
    identifier: str = Field(pattern=IDENTIFIER_PATTERN)
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=120)
    department: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=2000)
    group_id: Optional[int] = None
    profile: ScreenProfile = ScreenProfile.MEDIA_PLAYER
    status: ScreenStatus = ScreenStatus.ACTIVE
    playlist_id: Optional[int] = None
    dashboard_id: Optional[int] = None
    refresh_seconds: Optional[int] = Field(default=None, ge=10, le=86400)
    orientation: Orientation = Orientation.LANDSCAPE
    resolution: str = Field(default="auto", pattern=RESOLUTION_PATTERN)
    screen_inches: Optional[int] = Field(default=None, ge=7, le=150)
    safe_margin_percent: int = Field(default=0, ge=0, le=10)

    _res = field_validator("resolution")(_check_resolution)


class ScreenCreate(ScreenBase):
    pass


class ScreenUpdate(BaseModel):
    identifier: Optional[str] = Field(default=None, pattern=IDENTIFIER_PATTERN)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    location: Optional[str] = Field(default=None, max_length=120)
    department: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    group_id: Optional[int] = None
    profile: Optional[ScreenProfile] = None
    status: Optional[ScreenStatus] = None
    playlist_id: Optional[int] = None
    dashboard_id: Optional[int] = None
    refresh_seconds: Optional[int] = Field(default=None, ge=10, le=86400)
    orientation: Optional[Orientation] = None
    resolution: Optional[str] = Field(default=None, pattern=RESOLUTION_PATTERN)
    screen_inches: Optional[int] = Field(default=None, ge=7, le=150)
    safe_margin_percent: Optional[int] = Field(default=None, ge=0, le=10)

    _res = field_validator("resolution")(_check_resolution)


class ScreenOut(ORMModel):
    id: int
    uid: str
    identifier: str
    name: str
    location: str
    department: str
    description: str
    group_id: Optional[int]
    group: Optional[IdName]
    profile: ScreenProfile
    status: ScreenStatus
    playlist_id: Optional[int]
    playlist: Optional[IdName]
    dashboard_id: Optional[int]
    dashboard: Optional[IdName]
    refresh_seconds: Optional[int]
    orientation: Orientation
    resolution: str
    screen_inches: Optional[int]
    safe_margin_percent: int
    display_info: Optional[Dict[str, Any]]
    config_hash: Optional[str] = None
    applied_config_hash: Optional[str]
    in_sync: bool = False
    activated: bool
    online: bool
    activated_at: Optional[datetime]
    token_expires_at: Optional[datetime]
    last_seen_at: Optional[datetime]
    last_ip: Optional[str]
    user_agent: Optional[str]
    player_version: Optional[str]
    playback_state: Optional[str]
    connection_state: Optional[str]
    current_content: Optional[str]
    last_error: Optional[str]
    last_error_at: Optional[datetime]
    storage_info: Optional[Dict[str, Any]]
    effective_content: Optional[str]
    created_at: datetime


class ActivateRequest(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    # ativa uma TV já cadastrada...
    screen_id: Optional[int] = None
    # ...ou cria uma nova com estes dados
    screen: Optional[ScreenCreate] = None


class PendingActivation(ORMModel):
    code: str
    created_at: datetime
    expires_at: datetime
    request_ip: Optional[str]
    user_agent: Optional[str]


class CommandCreate(BaseModel):
    command: CommandType


class CommandOut(ORMModel):
    id: int
    screen_id: int
    command: CommandType
    status: str
    created_at: datetime
    delivered_at: Optional[datetime]
    completed_at: Optional[datetime]
    result: Optional[str]


class HeartbeatOut(ORMModel):
    id: int
    created_at: datetime
    reason: str
    playback_state: Optional[str]
    connection_state: Optional[str]
    player_version: Optional[str]
    current_content: Optional[str]
    error: Optional[str]
    ip: Optional[str]


class BulkAssign(BaseModel):
    playlist_id: Optional[int] = None
    screen_ids: List[int] = Field(default_factory=list)
