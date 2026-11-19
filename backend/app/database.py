import os
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, event, make_url
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal = None


def _prepare_sqlite(url: str) -> None:
    path = make_url(url).database
    if not path or path == ":memory:":
        return
    folder = Path(path).expanduser().resolve().parent
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    if not os.access(folder, os.W_OK):
        raise RuntimeError(
            f"Não é possível criar o banco SQLite em {folder} (sem permissão). "
            "Em produção defina UDS_DATABASE_URL (PostgreSQL) no .env e carregue-o antes do comando."
        )


def _make_engine(url: str) -> Engine:
    kwargs = {"pool_pre_ping": True, "future": True}
    if url.startswith("sqlite"):
        _prepare_sqlite(url)
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return engine


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        _engine = _make_engine(get_settings().database_url)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def configure_engine(url: str) -> Engine:
    """Usado por testes para apontar para outro banco."""
    global _engine, _SessionLocal
    _engine = _make_engine(url)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def SessionLocal() -> Session:
    get_engine()
    return _SessionLocal()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
