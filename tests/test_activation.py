from datetime import datetime, timedelta, timezone

from conftest import activate_device, dev

from app import database
from app.models import ScreenActivationCode


def test_full_activation_flow(client, admin):
    r = client.post("/api/player/activation-codes", json={"player_version": "1.0.0"})
    assert r.status_code == 201
    code = r.json()
    assert len(code["code"]) == 6 and code["pairing_secret"]

    poll = {"code": code["code"], "pairing_secret": code["pairing_secret"]}
    assert client.post("/api/player/activation-codes/poll", json=poll).json()["status"] == "pending"
    # segredo errado não revela nada
    r = client.post("/api/player/activation-codes/poll", json={**poll, "pairing_secret": "x"})
    assert r.status_code == 404

    pending = admin.get("/api/screens/activations/pending").json()
    assert [p["code"] for p in pending] == [code["code"]]

    r = admin.post("/api/screens/activate", json={
        "code": code["code"].lower(),  # aceita minúsculas
        "screen": {"identifier": "TV-01", "name": "TV RECEPÇÃO", "profile": "MEDIA_PLAYER"}})
    assert r.status_code == 200, r.text
    screen = r.json()

    r = client.post("/api/player/activation-codes/poll", json=poll)
    data = r.json()
    assert data["status"] == "activated" and data["token"].startswith("uds_")
    assert data["screen"]["identifier"] == "TV-01"

    # uso único
    assert client.post("/api/player/activation-codes/poll", json=poll).status_code == 410
    assert admin.post("/api/screens/activate", json={"code": code["code"], "screen_id": screen["id"]}).status_code == 409

    cfg = client.get("/api/player/config", headers=dev(data["token"])).json()
    assert cfg["screen"]["identifier"] == "TV-01" and cfg["mode"] == "idle"
    s = admin.get(f"/api/screens/{screen['id']}").json()
    assert s["activated"] is True and s["online"] is True


def test_activate_existing_screen(client, admin):
    s = admin.post("/api/screens", json={"identifier": "TV-05", "name": "Administrativo"}).json()
    code = client.post("/api/player/activation-codes", json={}).json()
    r = admin.post("/api/screens/activate", json={"code": code["code"], "screen_id": s["id"]})
    assert r.status_code == 200
    r = client.post("/api/player/activation-codes/poll",
                    json={"code": code["code"], "pairing_secret": code["pairing_secret"]})
    assert r.json()["screen"]["identifier"] == "TV-05"


def test_expired_code(client, admin):
    code = client.post("/api/player/activation-codes", json={}).json()
    with database.SessionLocal() as db:
        act = db.query(ScreenActivationCode).filter_by(code=code["code"]).one()
        act.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    r = admin.post("/api/screens/activate", json={"code": code["code"],
                                                 "screen": {"identifier": "TV-09", "name": "x"}})
    assert r.status_code == 410
    r = client.post("/api/player/activation-codes/poll",
                    json={"code": code["code"], "pairing_secret": code["pairing_secret"]})
    assert r.status_code == 410


def test_unknown_code(admin):
    r = admin.post("/api/screens/activate", json={"code": "ZZZZZZ", "screen": {"identifier": "T", "name": "x"}})
    assert r.status_code == 404


def test_invalid_token(client):
    assert client.get("/api/player/config").status_code == 401
    assert client.get("/api/player/config", headers=dev("uds_invalido")).status_code == 401
    assert client.post("/api/player/heartbeat", json={}, headers=dev("uds_invalido")).status_code == 401


def test_revoke_and_disable(client, admin):
    token, screen = activate_device(admin, client)
    assert admin.patch(f"/api/screens/{screen['id']}", json={"status": "disabled"}).status_code == 200
    assert client.get("/api/player/config", headers=dev(token)).status_code == 403
    admin.patch(f"/api/screens/{screen['id']}", json={"status": "active"})
    assert client.get("/api/player/config", headers=dev(token)).status_code == 200
    assert admin.post(f"/api/screens/{screen['id']}/revoke").status_code == 200
    assert client.get("/api/player/config", headers=dev(token)).status_code == 401


def test_activation_code_rate_limit(client):
    for _ in range(10):
        assert client.post("/api/player/activation-codes", json={}).status_code == 201
    assert client.post("/api/player/activation-codes", json={}).status_code == 429
