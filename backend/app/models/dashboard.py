from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UTCDateTime, utcnow


class Dashboard(Base):
    __tablename__ = "dashboards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    url: Mapped[str] = mapped_column(Text)
    refresh_seconds: Mapped[int] = mapped_column(Integer, default=300)
    auth_type: Mapped[str] = mapped_column(String(32), default="none")
    display_mode: Mapped[str] = mapped_column(String(16), default="iframe")
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    # Login automático (login_form / http_basic): senha criptografada, nunca devolvida pela API
    username: Mapped[str] = mapped_column(String(120), default="", server_default="")
    password_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    login_url: Mapped[str] = mapped_column(Text, default="", server_default="")  # página de login, se diferente
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
