from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import UTCDateTime, utcnow
from app.models.dashboard import Dashboard
from app.models.playlist import Playlist


class ScreenGroup(Base):
    __tablename__ = "screen_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    # playlist padrão para as TVs de mídia do grupo (a TV pode sobrescrever)
    playlist_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("playlists.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    playlist: Mapped[Optional[Playlist]] = relationship()


class Screen(Base):
    __tablename__ = "screens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    uid: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    identifier: Mapped[str] = mapped_column(String(32), unique=True)  # ex.: TV-01
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(120), default="")
    department: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    group_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("screen_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    profile: Mapped[str] = mapped_column(String(32), default="MEDIA_PLAYER")
    status: Mapped[str] = mapped_column(String(16), default="active")
    playlist_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("playlists.id", ondelete="SET NULL"), nullable=True
    )
    dashboard_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("dashboards.id", ondelete="SET NULL"), nullable=True
    )
    refresh_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Autenticação do dispositivo (hash do token, nunca o token em si)
    token_hash: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    # renovação em duas fases: o novo token passa a valer no primeiro uso; o antigo segue válido até lá
    pending_token_hash: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True)
    activated_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    # Último estado reportado pelo player
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    last_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    player_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    playback_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    connection_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    current_content: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_error_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    storage_info: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    applied_config_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_history_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    group: Mapped[Optional[ScreenGroup]] = relationship(lazy="joined")
    playlist: Mapped[Optional[Playlist]] = relationship(lazy="joined")
    dashboard: Mapped[Optional[Dashboard]] = relationship(lazy="joined")


class ScreenActivationCode(Base):
    __tablename__ = "screen_activation_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    # segredo conhecido apenas pelo player que solicitou o código
    pairing_secret_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    activated_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    screen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("screens.id", ondelete="CASCADE"), nullable=True
    )
    activated_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    request_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


class ScreenHeartbeat(Base):
    """Histórico resumido: grava só mudanças de estado ou a cada N minutos."""

    __tablename__ = "screen_heartbeats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    screen_id: Mapped[int] = mapped_column(ForeignKey("screens.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    reason: Mapped[str] = mapped_column(String(32), default="periodic")
    playback_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    connection_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    player_version: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    current_content: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class ScreenCommand(Base):
    __tablename__ = "screen_commands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    screen_id: Mapped[int] = mapped_column(ForeignKey("screens.id", ondelete="CASCADE"), index=True)
    command: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime, nullable=True)
    result: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
