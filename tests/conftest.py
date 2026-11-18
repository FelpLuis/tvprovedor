import io
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="uds-tests-")
os.environ["UDS_STORAGE_DIR"] = os.path.join(_tmp, "storage")
os.environ["UDS_DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "bootstrap.sqlite3")
os.environ["UDS_SECRET_KEY"] = "test-secret-key-0123456789-abcdefghijklmnop"
os.environ["UDS_ENVIRONMENT"] = "test"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import database  # noqa: E402
from app.api.auth import login_limiter  # noqa: E402
from app.api.player import activation_limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402

PASSWORD = "Senha-Forte-123"
CSRF = {"X-Requested-With": "uds"}


@pytest.fixture()
def db_url(tmp_path):
    # UDS_TEST_DATABASE_URL permite rodar a suíte contra PostgreSQL (banco descartável!)
    return os.environ.get("UDS_TEST_DATABASE_URL") or "sqlite:///" + str(tmp_path / "test.sqlite3")


@pytest.fixture()
def client(db_url):
    engine = database.configure_engine(db_url)
    database.Base.metadata.drop_all(engine)
    database.Base.metadata.create_all(engine)
    login_limiter.clear()
    activation_limiter.clear()
    with database.SessionLocal() as db:
        for name, role in (("admin", "admin"), ("operador", "operator"), ("visual", "viewer")):
            db.add(User(username=name, email=f"{name}@example.com", full_name=name.title(), role=role,
                        password_hash=hash_password(PASSWORD)))
        db.commit()
    with TestClient(app) as c:
        yield c
    engine.dispose()


def login(client, username="admin", password=PASSWORD):
    client.cookies.clear()
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return client


class Api:
    """Cliente autenticado que envia o cabeçalho anti-CSRF."""

    def __init__(self, client):
        self.c = client

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, **kw):
        return self.c.post(url, headers={**CSRF, **kw.pop("headers", {})}, **kw)

    def patch(self, url, **kw):
        return self.c.patch(url, headers={**CSRF, **kw.pop("headers", {})}, **kw)

    def put(self, url, **kw):
        return self.c.put(url, headers={**CSRF, **kw.pop("headers", {})}, **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers={**CSRF, **kw.pop("headers", {})}, **kw)


@pytest.fixture()
def admin(client):
    return Api(login(client, "admin"))


def as_user(client, username):
    return Api(login(client, username))


def png_bytes(color=(255, 0, 0), size=(64, 36)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def jpg_bytes(color=(0, 0, 255), size=(64, 36)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def upload(api, name, content, mime="application/octet-stream", folder=""):
    return api.post("/api/media", files=[("files", (name, content, mime))], data={"folder": folder})


def activate_device(api, client, identifier="TV-01", **screen):
    """Executa o fluxo completo de ativação e retorna (token, screen_json)."""
    r = client.post("/api/player/activation-codes", json={})
    assert r.status_code == 201, r.text
    code = r.json()
    body = {"code": code["code"], "screen": {"identifier": identifier, "name": f"TV {identifier}", **screen}}
    r = api.post("/api/screens/activate", json=body)
    assert r.status_code == 200, r.text
    r = client.post("/api/player/activation-codes/poll",
                    json={"code": code["code"], "pairing_secret": code["pairing_secret"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "activated"
    return data["token"], api.get(f"/api/screens/{api.get('/api/screens').json()[-1]['id']}").json()


def dev(token):
    return {"Authorization": f"Bearer {token}"}
