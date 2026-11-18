from conftest import activate_device, dev


def test_grafana_dashboard_player_config(client, admin):
    r = admin.post("/api/dashboards", json={
        "name": "Infra NOC", "kind": "grafana", "url": "https://grafana.updown.com.br/d/abc/infra?orgId=1",
        "refresh_seconds": 120, "options": {"theme": "dark"}})
    assert r.status_code == 201, r.text
    d = r.json()
    token, screen = activate_device(admin, client, profile="GRAFANA_PLAYER", dashboard_id=d["id"])
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["mode"] == "dashboard" and cfg["playlist"] is None
    url = cfg["dashboard"]["url"]
    assert url.startswith("https://grafana.updown.com.br/d/abc/infra?orgId=1")
    assert "&kiosk" in url and "theme=dark" in url
    assert cfg["dashboard"]["refresh_seconds"] == 120

    # refresh por TV sobrescreve o do dashboard
    admin.patch(f"/api/screens/{screen['id']}", json={"refresh_seconds": 60})
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["dashboard"]["refresh_seconds"] == 60


def test_dashboard_url_validation(admin):
    base = {"name": "Z", "kind": "zabbix"}
    assert admin.post("/api/dashboards", json={**base, "url": "javascript:alert(1)"}).status_code == 422
    assert admin.post("/api/dashboards", json={**base, "url": "https://z/?password=123"}).status_code == 422
    assert admin.post("/api/dashboards", json={**base, "url": "https://user:pw@z.local/"}).status_code == 422
    r = admin.post("/api/dashboards", json={**base, "url": "https://zabbix.local/zabbix.php?action=dashboard.view"})
    assert r.status_code == 201
    from app import database
    from app.models import Dashboard
    from app.services.screens import build_dashboard_url
    with database.SessionLocal() as db:
        url = build_dashboard_url(db.get(Dashboard, r.json()["id"]))
    assert url.endswith("action=dashboard.view&kiosk=1")


def test_media_screen_ignores_dashboard(client, admin):
    d = admin.post("/api/dashboards", json={"name": "G", "kind": "grafana", "url": "https://g/d/1"}).json()
    r = admin.post("/api/screens", json={"identifier": "TV-10", "name": "x", "dashboard_id": d["id"]})
    # MEDIA_PLAYER não aceita dashboard
    assert r.status_code == 400
