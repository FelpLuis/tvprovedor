from datetime import datetime, timezone

from conftest import activate_device, as_user, dev

from app.models import Screen
from app.services.power import evaluate, schedule_state, set_override, tz

WEEKDAYS = [0, 1, 2, 3, 4]
BUSINESS = {"enabled": True, "slots": [{"days": WEEKDAYS, "on": "07:00", "off": "19:00"}]}


def local(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=tz()).astimezone(timezone.utc)


def screen_with(schedule=None):
    s = Screen(uid="x", identifier="T", name="T")
    s.power_schedule = schedule
    return s


# 2026-11-16 é segunda-feira
def test_schedule_business_hours():
    slots = BUSINESS["slots"]
    assert schedule_state(slots, local(2026, 11, 16, 6, 59)) == "off"
    assert schedule_state(slots, local(2026, 11, 16, 7, 0)) == "on"
    assert schedule_state(slots, local(2026, 11, 16, 18, 59)) == "on"
    assert schedule_state(slots, local(2026, 11, 16, 19, 0)) == "off"
    assert schedule_state(slots, local(2026, 11, 21, 10, 0)) == "off"  # sábado


def test_schedule_overnight_slot():
    slots = [{"days": [4], "on": "18:00", "off": "02:00"}]  # sexta 18h → sábado 2h
    assert schedule_state(slots, local(2026, 11, 20, 23, 0)) == "on"
    assert schedule_state(slots, local(2026, 11, 21, 1, 59)) == "on"
    assert schedule_state(slots, local(2026, 11, 21, 2, 0)) == "off"
    assert schedule_state(slots, local(2026, 11, 20, 17, 0)) == "off"


def test_evaluate_reasons_and_next_on():
    s = screen_with(BUSINESS)
    st = evaluate(s, local(2026, 11, 16, 10))
    assert st.state == "on" and st.source == "schedule" and "desliga seg 19:00" in st.reason
    st = evaluate(s, local(2026, 11, 20, 20))  # sexta 20h
    assert st.state == "off" and st.next_on == local(2026, 11, 23, 7)  # segunda 7h
    assert evaluate(screen_with(None)).state == "on"


def test_manual_off_lasts_until_next_schedule_change():
    s = screen_with(BUSINESS)
    set_override(s, "off", local(2026, 11, 16, 15))  # desliga às 15h (horário: ligada)
    assert evaluate(s, local(2026, 11, 16, 16)).state == "off"
    assert evaluate(s, local(2026, 11, 16, 16)).source == "manual"
    assert evaluate(s, local(2026, 11, 16, 20)).state == "off"   # 19h desligou pelo horário
    assert evaluate(s, local(2026, 11, 17, 7, 1)).state == "on"  # volta a ligar no dia seguinte
    assert evaluate(s, local(2026, 11, 17, 7, 1)).source == "schedule"


def test_manual_on_outside_hours_and_no_schedule():
    s = screen_with(BUSINESS)
    set_override(s, "on", local(2026, 11, 16, 21))
    assert evaluate(s, local(2026, 11, 16, 23)).state == "on"
    assert evaluate(s, local(2026, 11, 17, 7, 30)).state == "on"   # horário ligou: segue ligada
    assert evaluate(s, local(2026, 11, 17, 19, 1)).state == "off"  # e desliga às 19h normalmente
    s2 = screen_with(None)
    set_override(s2, "off")
    assert evaluate(s2).state == "off" and "automático" in evaluate(s2).reason
    set_override(s2, "auto")
    assert evaluate(s2).state == "on"


def test_power_api_heartbeat_and_volume(client, admin):
    token, screen = activate_device(admin, client)
    op = as_user(client, "operador")
    r = op.post(f"/api/screens/{screen['id']}/power", json={"action": "off"})
    assert r.status_code == 200 and r.json()["power"]["state"] == "off"
    hb = client.post("/api/player/heartbeat", json={}, headers=dev(token)).json()
    assert hb["power"]["state"] == "off"
    assert client.get("/api/player/power", headers=dev(token)).json()["state"] == "off"
    assert op.post(f"/api/screens/{screen['id']}/power", json={"action": "on"}).json()["power"]["state"] == "on"
    assert op.post(f"/api/screens/{screen['id']}/power", json={"action": "x"}).status_code == 422

    r = op.put(f"/api/screens/{screen['id']}/power-schedule", json=BUSINESS)
    assert r.status_code == 200 and r.json()["power_schedule"]["enabled"] is True
    bad = {"enabled": True, "slots": [{"days": [9], "on": "07:00", "off": "19:00"}]}
    assert op.put(f"/api/screens/{screen['id']}/power-schedule", json=bad).status_code == 422
    bad = {"enabled": True, "slots": [{"days": [1], "on": "25:00", "off": "19:00"}]}
    assert op.put(f"/api/screens/{screen['id']}/power-schedule", json=bad).status_code == 422

    before = client.get("/api/player/config", headers=dev(token)).json()
    assert op.put(f"/api/screens/{screen['id']}/volume", json={"volume": 35}).status_code == 200
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["audio"] == {"volume": 35} and cfg["config_hash"] != before["config_hash"]
    assert op.put(f"/api/screens/{screen['id']}/volume", json={"volume": 101}).status_code == 422

    viewer = as_user(client, "visual")
    assert viewer.post(f"/api/screens/{screen['id']}/power", json={"action": "off"}).status_code == 403
    actions = [l["action"] for l in as_user(client, "admin").get("/api/audit-logs").json()]
    assert "screen.power_off" in actions and "screen.volume_set" in actions


def test_group_power(client, admin):
    g = admin.post("/api/groups", json={"name": "Recepção"}).json()
    t1, s1 = activate_device(admin, client, identifier="TV-G1", group_id=g["id"])
    t2, s2 = activate_device(admin, client, identifier="TV-G2", group_id=g["id"])
    r = admin.post(f"/api/groups/{g['id']}/power", json={"action": "off"})
    assert r.status_code == 200 and r.json()["screens"] == 2
    for t in (t1, t2):
        assert client.get("/api/player/power", headers=dev(t)).json()["state"] == "off"
    admin.post(f"/api/groups/{g['id']}/power", json={"action": "auto"})
    assert client.get("/api/player/power", headers=dev(t1)).json()["state"] == "on"
