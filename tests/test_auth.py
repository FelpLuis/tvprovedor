from conftest import CSRF, PASSWORD, Api, login


def test_login_me_logout(client):
    login(client, "admin")
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["role"] == "admin"
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401


def test_login_by_email(client):
    r = client.post("/api/auth/login", json={"username": "ADMIN@example.com", "password": PASSWORD})
    assert r.status_code == 200


def test_wrong_password_and_lockout(client):
    for _ in range(5):
        r = client.post("/api/auth/login", json={"username": "admin", "password": "errada"})
        assert r.status_code == 401
    r = client.post("/api/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_login_failure_is_audited(client):
    client.post("/api/auth/login", json={"username": "ninguem", "password": "x"})
    api = Api(login(client, "admin"))
    logs = api.get("/api/audit-logs?action=auth.login_failed").json()
    assert logs and logs[0]["details"]["username"] == "ninguem"


def test_csrf_header_required_for_mutations(client):
    login(client, "admin")
    r = client.post("/api/groups", json={"name": "NOC"})
    assert r.status_code == 403
    r = client.post("/api/groups", json={"name": "NOC"}, headers=CSRF)
    assert r.status_code == 201


def test_change_password_invalidates_old_session(client):
    login(client, "admin")
    old_cookie = client.cookies.get("uds_session")
    r = client.post("/api/auth/change-password", headers=CSRF,
                    json={"current_password": PASSWORD, "new_password": "NovaSenha-456"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200  # novo cookie
    client.cookies.clear()
    client.cookies.set("uds_session", old_cookie)
    assert client.get("/api/auth/me").status_code == 401


def test_weak_password_rejected(client):
    api = Api(login(client, "admin"))
    r = api.post("/api/users", json={"username": "novo", "password": "1234567890"})
    assert r.status_code == 422


def test_device_token_cannot_access_admin(client, admin):
    from conftest import activate_device, dev

    token, _ = activate_device(admin, client)
    client.cookies.clear()
    assert client.get("/api/screens", headers=dev(token)).status_code == 401
    assert client.get("/api/overview", headers=dev(token)).status_code == 401
