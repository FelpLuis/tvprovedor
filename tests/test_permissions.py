from conftest import Api, as_user, login, png_bytes, upload


def test_viewer_is_read_only(client):
    api = as_user(client, "visual")
    assert api.get("/api/screens").status_code == 200
    assert api.get("/api/overview").status_code == 200
    assert api.post("/api/groups", json={"name": "X"}).status_code == 403
    assert api.post("/api/playlists", json={"name": "X"}).status_code == 403
    assert upload(api, "a.png", png_bytes()).status_code == 403
    assert api.get("/api/users").status_code == 403
    assert api.get("/api/audit-logs").status_code == 403


def test_operator_manages_media_and_playlists_only(client):
    api = as_user(client, "operador")
    assert upload(api, "a.png", png_bytes()).status_code == 201
    assert api.post("/api/playlists", json={"name": "Institucional"}).status_code == 201
    assert api.post("/api/screens", json={"identifier": "TV-01", "name": "TV"}).status_code == 403
    assert api.post("/api/groups", json={"name": "NOC"}).status_code == 403
    assert api.post("/api/dashboards", json={"name": "G", "kind": "grafana", "url": "https://g"}).status_code == 403
    assert api.get("/api/users").status_code == 403
    assert api.get("/api/audit-logs").status_code == 200


def test_admin_cannot_remove_last_admin(client, admin):
    me = admin.get("/api/auth/me").json()
    assert admin.patch(f"/api/users/{me['id']}", json={"role": "viewer"}).status_code == 400
    assert admin.delete(f"/api/users/{me['id']}").status_code == 400


def test_user_crud_and_role_change_invalidates_session(client, admin):
    r = admin.post("/api/users", json={"username": "joao", "password": "Senha-Forte-999", "role": "operator",
                                       "email": "joao@example.com"})
    assert r.status_code == 201
    uid = r.json()["id"]
    assert admin.post("/api/users", json={"username": "JOAO", "password": "Senha-Forte-999"}).status_code == 409
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"username": "joao", "password": "Senha-Forte-999"}).status_code == 200
    joao_cookie = client.cookies.get("uds_session")
    adm = Api(login(client, "admin"))
    assert adm.patch(f"/api/users/{uid}", json={"role": "viewer"}).status_code == 200
    client.cookies.clear()
    client.cookies.set("uds_session", joao_cookie)
    assert client.get("/api/auth/me").status_code == 401
    adm = Api(login(client, "admin"))
    assert adm.delete(f"/api/users/{uid}").status_code == 204
