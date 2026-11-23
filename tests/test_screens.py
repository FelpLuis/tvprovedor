from conftest import as_user


def test_screen_and_group_crud(client, admin):
    g = admin.post("/api/groups", json={"name": "NOC", "description": "Centro de operações"}).json()
    assert admin.post("/api/groups", json={"name": "noc"}).status_code == 409
    r = admin.post("/api/screens", json={"identifier": "tv-03", "name": "TV NOC", "location": "Sala NOC",
                                         "department": "Operações", "group_id": g["id"]})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["identifier"] == "TV-03"
    assert s["activated"] is False and s["online"] is False
    assert s["group"]["name"] == "NOC"
    assert admin.post("/api/screens", json={"identifier": "TV-03", "name": "dup"}).status_code == 409

    assert admin.get(f"/api/screens?group_id={g['id']}").json()[0]["id"] == s["id"]
    assert admin.get("/api/screens?q=sala").json()[0]["id"] == s["id"]
    assert admin.get("/api/screens?activated=true").json() == []

    # grupo com TVs não pode ser excluído
    assert admin.delete(f"/api/groups/{g['id']}").status_code == 409
    assert admin.patch(f"/api/screens/{s['id']}", json={"group_id": None}).status_code == 200
    assert admin.delete(f"/api/groups/{g['id']}").status_code == 204

    ov = admin.get("/api/overview").json()
    assert ov["screens_total"] == 1 and ov["screens_not_activated"] == 1

    assert admin.delete(f"/api/screens/{s['id']}").status_code == 204
    logs = [l["action"] for l in admin.get("/api/audit-logs").json()]
    assert "screen.created" in logs and "screen.deleted" in logs and "group.deleted" in logs


def test_profile_dashboard_compatibility(client, admin):
    d = admin.post("/api/dashboards", json={"name": "PBI Comercial", "kind": "powerbi",
                                            "url": "https://app.powerbi.com/view?r=abc"}).json()
    r = admin.post("/api/screens", json={"identifier": "TV-04", "name": "NOC", "profile": "GRAFANA_PLAYER",
                                         "dashboard_id": d["id"]})
    assert r.status_code == 400
    r = admin.post("/api/screens", json={"identifier": "TV-02", "name": "Comercial", "profile": "POWERBI_PLAYER",
                                         "dashboard_id": d["id"]})
    assert r.status_code == 201
    assert r.json()["effective_content"] == "Dashboard: PBI Comercial"
    assert admin.delete(f"/api/dashboards/{d['id']}").status_code == 409
    screen_id = r.json()["id"]
    assert admin.delete(f"/api/dashboards/{d['id']}?force=true").status_code == 204
    assert admin.get(f"/api/screens/{screen_id}").json()["dashboard_id"] is None


def test_operator_can_set_playlist_but_not_edit_screen(client, admin):
    s = admin.post("/api/screens", json={"identifier": "TV-01", "name": "Recepção"}).json()
    op = as_user(client, "operador")
    pl = op.post("/api/playlists", json={"name": "Institucional"}).json()
    assert op.patch(f"/api/screens/{s['id']}", json={"name": "x"}).status_code == 403
    r = op.put(f"/api/screens/{s['id']}/playlist", json={"playlist_id": pl["id"]})
    assert r.status_code == 200 and r.json()["playlist"]["id"] == pl["id"]
    r = op.post("/api/screens/assign-playlist", json={"playlist_id": None, "screen_ids": [s["id"]]})
    assert r.status_code == 200 and r.json()[0]["playlist_id"] is None


def test_empty_camera_layout_from_form_means_auto(client, admin):
    # o formulário do painel pode enviar o campo vazio (regressão: impedia criar/ativar TVs)
    r = admin.post("/api/screens", json={"identifier": "TV-L1", "name": "x", "camera_layout": "", "camera_ids": []})
    assert r.status_code == 201, r.text
    assert r.json()["camera_layout"] == "auto"
    code = client.post("/api/player/activation-codes", json={}).json()
    r = admin.post("/api/screens/activate", json={"code": code["code"], "screen": {
        "identifier": "TV-L2", "name": "y", "camera_layout": "", "camera_cycle_seconds": 0}})
    assert r.status_code == 200, r.text
    assert admin.patch(f"/api/screens/{r.json()['id']}", json={"camera_layout": ""}).json()["camera_layout"] == "auto"
