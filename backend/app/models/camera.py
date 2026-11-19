from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UTCDateTime, utcnow


class Camera(Base):
    """Câmera ou canal de NVR/DVR (Intelbras/Dahua ou RTSP genérico)."""

    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(120), default="")
    brand: Mapped[str] = mapped_column(String(16), default="intelbras")  # intelbras | rtsp
    host: Mapped[str] = mapped_column(String(255))     # IP/host na rede local das TVs
    port: Mapped[int] = mapped_column(Integer, default=554)
    username: Mapped[str] = mapped_column(String(64), default="")
    password_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    channel: Mapped[int] = mapped_column(Integer, default=1)
    stream: Mapped[str] = mapped_column(String(8), default="sub")  # main | sub
    rtsp_path: Mapped[str] = mapped_column(String(255), default="")  # caminho próprio (marca genérica)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
