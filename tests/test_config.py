import pytest

from app.core.config import DEFAULT_SECRET, Settings


def test_production_requires_strong_secret_and_postgres():
    with pytest.raises(RuntimeError, match="UDS_SECRET_KEY"):
        Settings(environment="production", secret_key=DEFAULT_SECRET,
                 database_url="postgresql+psycopg://u:p@localhost/db").validate_for_production()
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        Settings(environment="production", secret_key="x" * 48,
                 database_url="sqlite:///x.db").validate_for_production()
    s = Settings(environment="production", secret_key="x" * 48, database_url="postgresql+psycopg://u:p@localhost/db")
    s.validate_for_production()
    assert s.secure_cookies is True and s.docs_enabled is False


def test_development_defaults():
    s = Settings(environment="development")
    assert s.secure_cookies is False and s.docs_enabled is True
    s = Settings(environment="production", enable_docs=True, cookie_secure=False)
    assert s.docs_enabled is True and s.secure_cookies is False


def test_security_headers(client):
    r = client.get("/")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    r = client.get("/player/")
    assert "frame-src *" in r.headers["content-security-policy"]
    assert client.get("/api/health").headers["cache-control"] == "no-store"
    assert client.get("/player").status_code in (200, 307)
