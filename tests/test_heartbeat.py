from datetime import datetime, timedelta, timezone

from conftest import activate_device, dev

from app import database
from app.models import Screen, ScreenHeartbeat


def _hb(client, token, **kw):
    body = {"player_version": "1.0.0", "playback_state": "playing", "connection_state": "online", **kw}
    r = client.post("/api/player/heartbeat", json=body, headers=dev(token))
    assert r.status_code == 200, r.text
    return r.json()


def test_heartbeat_updates_status_and_offline_detection(client, admin):
    token, screen = activate_device(admin, client)
    resp = _hb(client, token, current_content="banner.png", storage={"usage": 10, "quota": 100})
    assert resp["heartbeat_interval"] == 30 and resp["commands"] == []
    s = admin.get(f"/api/screens/{screen['id']}").json()
    assert s["online"] and s["player_version"] == "1.0.0" and s["current_content"] == "banner.png"
    assert s["storage_info"] == {"usage": 10, "quota": 100}

    with database.SessionLocal() as db:
        obj = db.get(Screen, screen["id"])
        obj.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=91)
        db.commit()
    s = admin.get(f"/api/screens/{screen['id']}").json()
    assert s["online"] is False
    ov = admin.get("/api/overview").json()
    assert ov["screens_offline"] == 1 and ov["screens_online"] == 0


def test_heartbeat_history_is_throttled(client, admin):
    token, screen = activate_device(admin, client)
    for _ in range(5):
        _hb(client, token)
    hist = admin.get(f"/api/screens/{screen['id']}/heartbeats").json()
    assert len(hist) == 1  # só a mudança de estado inicial
    _hb(client, token, playback_state="error", error="Falha ao reproduzir video.mp4")
    _hb(client, token, playback_state="error", error="Falha ao reproduzir video.mp4")
    hist = admin.get(f"/api/screens/{screen['id']}/heartbeats").json()
    assert len(hist) == 2 and hist[0]["error"].startswith("Falha")
    s = admin.get(f"/api/screens/{screen['id']}").json()
    assert s["last_error"].startswith("Falha")
    assert admin.get("/api/overview").json()["screens_with_errors"] == 1


def test_remote_commands_delivery_and_ack(client, admin):
    token, screen = activate_device(admin, client)
    r = admin.post(f"/api/screens/{screen['id']}/commands", json={"command": "restart_playback"})
    assert r.status_code == 201
    cmd = r.json()
    resp = _hb(client, token)
    assert resp["commands"] == [{"id": cmd["id"], "command": "restart_playback"}]
    assert _hb(client, token)["commands"] == []  # entregue uma única vez
    r = client.post(f"/api/player/commands/{cmd['id']}/ack", json={"success": True, "result": "ok"},
                    headers=dev(token))
    assert r.json()["status"] == "done"
    cmds = admin.get(f"/api/screens/{screen['id']}/commands").json()
    assert cmds[0]["status"] == "done" and cmds[0]["completed_at"]
    actions = [l["action"] for l in admin.get("/api/audit-logs").json()]
    assert "screen.command_sent" in actions and "screen.command_ack" in actions


def test_command_requires_activation_and_operator(client, admin):
    s = admin.post("/api/screens", json={"identifier": "TV-08", "name": "x"}).json()
    assert admin.post(f"/api/screens/{s['id']}/commands", json={"command": "reload_page"}).status_code == 400


def test_token_renewal_two_phase(client, admin):
    token, screen = activate_device(admin, client)
    with database.SessionLocal() as db:
        obj = db.get(Screen, screen["id"])
        obj.token_expires_at = datetime.now(timezone.utc) + timedelta(days=5)
        db.commit()
    resp = _hb(client, token)
    new = resp["new_token"]
    # o token antigo continua valendo até o novo ser usado
    assert client.get("/api/player/config", headers=dev(token)).status_code == 200
    assert client.get("/api/player/config", headers=dev(new)).status_code == 200
    assert client.get("/api/player/config", headers=dev(token)).status_code == 401
    assert "new_token" not in _hb(client, new)
