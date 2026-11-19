from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

HOST_PATTERN = r"^[A-Za-z0-9.\-]{1,255}$"  # IP ou nome, sem esquema/porta/credenciais


class CameraBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=120)
    brand: str = Field(default="intelbras", pattern=r"^(intelbras|rtsp)$")
    host: str = Field(pattern=HOST_PATTERN)
    port: int = Field(default=554, ge=1, le=65535)
    username: str = Field(default="", max_length=64)
    channel: int = Field(default=1, ge=1, le=256)
    stream: str = Field(default="sub", pattern=r"^(main|sub)$")
    rtsp_path: str = Field(default="", max_length=255, pattern=r"^[^\s@]*$")
    is_active: bool = True
    notes: str = Field(default="", max_length=2000)


class CameraCreate(CameraBase):
    password: Optional[str] = Field(default=None, max_length=128)


class CameraUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    location: Optional[str] = Field(default=None, max_length=120)
    brand: Optional[str] = Field(default=None, pattern=r"^(intelbras|rtsp)$")
    host: Optional[str] = Field(default=None, pattern=HOST_PATTERN)
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    username: Optional[str] = Field(default=None, max_length=64)
    # omitido = mantém a senha atual; "" = remove
    password: Optional[str] = Field(default=None, max_length=128)
    channel: Optional[int] = Field(default=None, ge=1, le=256)
    stream: Optional[str] = Field(default=None, pattern=r"^(main|sub)$")
    rtsp_path: Optional[str] = Field(default=None, max_length=255, pattern=r"^[^\s@]*$")
    is_active: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class CameraOut(ORMModel):
    id: int
    name: str
    location: str
    brand: str
    host: str
    port: int
    username: str
    has_password: bool
    channel: int
    stream: str
    rtsp_path: str
    rtsp_preview: str  # URL sem a senha
    is_active: bool
    notes: str
    screen_count: int = 0
    created_at: datetime
