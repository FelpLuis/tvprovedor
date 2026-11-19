from conftest import activate_device, dev


def test_default_display_is_landscape_auto(client, admin):
    token, screen = activate_device(admin, client)
    assert screen["orientation"] == "landscape" and screen["resolution"] == "auto"
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["display"] == {"orientation": "landscape", "rotation": 0, "width": None, "height": None,
                              "safe_margin_percent": 0, "inches": None}


def test_portrait_fixed_resolution_swaps_and_changes_hash(client, admin):
    token, screen = activate_device(admin, client)
    before = client.get("/api/player/config", headers=dev(token)).json()["config_hash"]
    r = admin.patch(f"/api/screens/{screen['id']}", json={
        "orientation": "portrait", "resolution": "1920x1080", "screen_inches": 50, "safe_margin_percent": 3})
    assert r.status_code == 200, r.text
    assert r.json()["orientation"] == "portrait"
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["display"] == {"orientation": "portrait", "rotation": 90, "width": 1080, "height": 1920,
                              "safe_margin_percent": 3, "inches": 50}
    assert cfg["config_hash"] != before  # a TV aplica a mudança sozinha no próximo heartbeat


def test_resolution_normalized_and_validated(client, admin):
    r = admin.post("/api/screens", json={"identifier": "TV-20", "name": "x", "resolution": "1080x1920"})
    assert r.status_code == 201 and r.json()["resolution"] == "1920x1080"  # sempre salva em paisagem
    for bad in ("1920*1080", "99999x1", "100x100", "auto2"):
        r = admin.post("/api/screens", json={"identifier": "TV-21", "name": "x", "resolution": bad})
        assert r.status_code == 422, bad
    assert admin.post("/api/screens", json={"identifier": "TV-22", "name": "x", "safe_margin_percent": 20}).status_code == 422
    assert admin.post("/api/screens", json={"identifier": "TV-23", "name": "x", "orientation": "diagonal"}).status_code == 422
    r = admin.post("/api/screens", json={"identifier": "TV-24", "name": "x", "orientation": "portrait_flipped"})
    assert r.status_code == 201


def test_heartbeat_reports_detected_display(client, admin):
    token, screen = activate_device(admin, client)
    detected = {"viewport": [960, 540], "screen": [960, 540], "dpr": 2, "device_orientation": "landscape-primary",
                "logical": [540, 960], "rotation": 90, "scale": 1, "extra": "x" * 500, "evil": {"a": 1}}
    r = client.post("/api/player/heartbeat", json={"playback_state": "playing", "display": detected}, headers=dev(token))
    assert r.status_code == 200
    info = admin.get(f"/api/screens/{screen['id']}").json()["display_info"]
    assert info == {"viewport": [960, 540], "screen": [960, 540], "dpr": 2.0, "device_orientation": "landscape-primary",
                    "logical": [540, 960], "rotation": 90.0, "scale": 1.0}


def test_identify_command(client, admin):
    token, screen = activate_device(admin, client)
    r = admin.post(f"/api/screens/{screen['id']}/commands", json={"command": "identify"})
    assert r.status_code == 201
    cmds = client.post("/api/player/heartbeat", json={}, headers=dev(token)).json()["commands"]
    assert cmds[0]["command"] == "identify"
