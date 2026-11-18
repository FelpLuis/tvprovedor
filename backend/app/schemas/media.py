from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.enums import FitMode, MediaKind, Transition
from app.schemas.common import ORMModel


class MediaOut(ORMModel):
    id: int
    original_name: str
    kind: MediaKind
    mime_type: str
    extension: str
    size_bytes: int
    sha256: str
    width: Optional[int]
    height: Optional[int]
    duration_seconds: Optional[float]
    folder: str
    has_thumbnail: bool
    created_at: datetime


class MediaUpdate(BaseModel):
    original_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    folder: Optional[str] = Field(default=None, max_length=120)


class PlaylistItemIn(BaseModel):
    media_id: int
    duration_seconds: Optional[int] = Field(default=None, ge=1, le=3600)


class PlaylistItemOut(ORMModel):
    id: int
    position: int
    media_id: int
    duration_seconds: Optional[int]
    media: MediaOut


class PlaylistBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    is_active: bool = True
    default_image_seconds: int = Field(default=10, ge=1, le=3600)
    fit_mode: FitMode = FitMode.CONTAIN
    transition: Transition = Transition.FADE


class PlaylistCreate(PlaylistBase):
    items: List[PlaylistItemIn] = Field(default_factory=list)


class PlaylistUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = None
    default_image_seconds: Optional[int] = Field(default=None, ge=1, le=3600)
    fit_mode: Optional[FitMode] = None
    transition: Optional[Transition] = None
    items: Optional[List[PlaylistItemIn]] = None  # substitui a lista completa (ordem = posição)


class PlaylistOut(ORMModel):
    id: int
    name: str
    description: str
    is_active: bool
    default_image_seconds: int
    fit_mode: FitMode
    transition: Transition
    version: int
    items: List[PlaylistItemOut]
    total_seconds: Optional[float] = None
    screen_count: int = 0
    created_at: datetime
    updated_at: datetime
