from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.enums import CommandType, ScreenProfile, ScreenStatus
from app.schemas.common import IdName, ORMModel

IDENTIFIER_PATTERN = r"^[A-Za-z0-9_\-]{1,32}$"


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
