"""Configuração da aplicação, carregada de variáveis de ambiente / arquivo .env."""
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[3]
DEFAULT_SECRET = "change-me-dev-only-secret-key-please-override"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"), env_prefix="UDS_", extra="ignore"
    )

    app_name: str = "UpDown Digital"
    environment: str = "development"  # development | production
    secret_key: str = DEFAULT_SECRET
    database_url: str = f"sqlite:///{BASE_DIR / 'storage' / 'dev.sqlite3'}"

    storage_dir: Path = BASE_DIR / "storage"
    frontend_dir: Path = BASE_DIR / "frontend"

    # Sessão administrativa
    access_token_minutes: int = 12 * 60
    cookie_secure: Optional[bool] = None  # padrão: True em produção
    cookie_name: str = "uds_session"

    # Proteção contra força bruta no login
    login_max_attempts: int = 5
    login_lockout_seconds: int = 300

    # Dispositivos
    activation_code_ttl_seconds: int = 15 * 60
    device_token_days: int = 90
    device_token_renew_days: int = 30  # renova quando faltar menos que isso
    heartbeat_interval_seconds: int = 30
    offline_after_seconds: int = 90
    heartbeat_history_every_seconds: int = 600
    heartbeat_history_keep_days: int = 30
    # fuso dos horários de funcionamento das TVs
    timezone: str = "America/Sao_Paulo"
    media_url_ttl_seconds: int = 24 * 3600

    # Uploads
    max_image_mb: int = 25
    max_video_mb: int = 1024

    enable_docs: Optional[bool] = None  # padrão: desabilitado em produção
    trusted_proxies: List[str] = Field(default_factory=lambda: ["127.0.0.1", "::1"])

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def secure_cookies(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    @property
    def docs_enabled(self) -> bool:
        return (not self.is_production) if self.enable_docs is None else self.enable_docs

    def validate_for_production(self) -> None:
        if not self.is_production:
            return
        if self.secret_key == DEFAULT_SECRET or len(self.secret_key) < 32:
            raise RuntimeError(
                "UDS_SECRET_KEY ausente ou fraca. Gere uma com: "
                "python3 -c 'import secrets; print(secrets.token_urlsafe(48))'"
            )
        if self.database_url.startswith("sqlite"):
            raise RuntimeError("Em produção configure UDS_DATABASE_URL para o PostgreSQL")

    @property
    def media_dir(self) -> Path:
        return self.storage_dir / "media"

    @property
    def thumbnails_dir(self) -> Path:
        return self.storage_dir / "thumbnails"

    @property
    def temporary_dir(self) -> Path:
        return self.storage_dir / "temporary"


def database_warning() -> str:
    """Mensagem para ferramentas de linha de comando quando o banco não foi configurado."""
    import os

    s = get_settings()
    if "UDS_DATABASE_URL" in os.environ or not s.database_url.startswith("sqlite"):
        return ""
    if (BASE_DIR / ".env").exists() and "UDS_DATABASE_URL" in (BASE_DIR / ".env").read_text():
        return ""
    return (
        "AVISO: UDS_DATABASE_URL não definida (o .env não foi carregado?). "
        f"Usando o SQLite de desenvolvimento: {s.database_url}\n"
        "Em produção, carregue o .env antes: set -ae; . /opt/updown-digital/.env; set +a"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
