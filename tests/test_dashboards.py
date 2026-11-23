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


def test_dashboard_rejects_protocol_relative_url(admin):
    for url in ("//evil.example.com/x", "/\\evil.example.com", "/bi/ok\nX-Injected: 1"):
        assert admin.post("/api/dashboards", json={"name": "X", "kind": "other", "url": url}).status_code == 422
    assert admin.post("/api/dashboards", json={"name": "Interno", "kind": "updown_bi", "url": "/bi/comercial"}).status_code == 201


def test_dashboard_login_credentials(client, admin):
    from app import database
    from app.models import Dashboard

    r = admin.post("/api/dashboards", json={
        "name": "UpDown BI Comercial", "kind": "updown_bi", "url": "http://10.0.0.20:8080/painel/comercial",
        "auth_type": "login_form", "username": "tv.comercial", "password": "Bi#2026!", "login_url": "http://10.0.0.20:8080/login",
        "options": {"user_selector": "#email"}})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["has_password"] is True and d["username"] == "tv.comercial" and "Bi#2026" not in r.text
    with database.SessionLocal() as db:
        assert "Bi#2026" not in (db.get(Dashboard, d["id"]).password_encrypted or "")

    token, screen = activate_device(admin, client, profile="UPDOWN_BI_PLAYER", dashboard_id=d["id"])
    auth = client.get("/api/player/config", headers=dev(token)).json()["dashboard"]["auth"]
    assert auth == {"type": "login_form", "username": "tv.comercial", "password": "Bi#2026!",
                    "login_url": "http://10.0.0.20:8080/login", "user_selector": "#email",
                    "pass_selector": "", "submit_selector": ""}

    # editar sem senha mantém; "" remove; auditoria sem a senha
    assert admin.patch(f"/api/dashboards/{d['id']}", json={"refresh_seconds": 60}).json()["has_password"] is True
    assert admin.patch(f"/api/dashboards/{d['id']}", json={"password": "Nova#1"}).json()["has_password"] is True
    assert client.get("/api/player/config", headers=dev(token)).json()["dashboard"]["auth"]["password"] == "Nova#1"
    assert "Nova#1" not in str(admin.get("/api/audit-logs?entity_type=dashboard").json())
    assert admin.patch(f"/api/dashboards/{d['id']}", json={"password": ""}).json()["has_password"] is False

    # sem tipo de login, nada de credenciais na configuração
    admin.patch(f"/api/dashboards/{d['id']}", json={"auth_type": "none"})
    assert client.get("/api/player/config", headers=dev(token)).json()["dashboard"]["auth"] is None
    assert admin.post("/api/dashboards", json={"name": "X", "kind": "other", "url": "https://x",
                                               "login_url": "javascript:alert(1)"}).status_code == 422
