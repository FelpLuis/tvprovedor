from conftest import activate_device, as_user, dev

from app import database
from app.models import Camera

CAM = {"name": "Portaria", "host": "192.168.1.108", "username": "visualizador", "password": "S3nh@:/#?",
       "channel": 1, "stream": "sub", "location": "Entrada"}


def test_camera_crud_password_never_returned(client, admin):
    r = admin.post("/api/cameras", json=CAM)
    assert r.status_code == 201, r.text
    cam = r.json()
    assert cam["has_password"] is True and "password" not in cam and "S3nh" not in r.text
    assert cam["rtsp_preview"] == "rtsp://visualizador:***@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1"
    with database.SessionLocal() as db:
        stored = db.get(Camera, cam["id"]).password_encrypted
        assert stored and "S3nh" not in stored  # criptografada no banco
    # atualizar sem senha mantém a senha; "" remove
    assert admin.patch(f"/api/cameras/{cam['id']}", json={"stream": "main"}).json()["has_password"] is True
    assert admin.patch(f"/api/cameras/{cam['id']}", json={"password": ""}).json()["has_password"] is False
    logs = str(admin.get("/api/audit-logs?entity_type=camera").json())
    assert "S3nh" not in logs
    # validação de host (sem esquema, credenciais ou espaços)
    for bad in ("rtsp://x", "user:pw@host", "a b"):
        assert admin.post("/api/cameras", json={**CAM, "host": bad}).status_code == 422
    assert as_user(client, "operador").post("/api/cameras", json=CAM).status_code == 403
    assert as_user(client, "visual").get("/api/cameras").status_code == 200


def test_camera_screen_config_and_layout(client, admin):
    c1 = admin.post("/api/cameras", json=CAM).json()
    c2 = admin.post("/api/cameras", json={**CAM, "name": "Estacionamento", "channel": 2, "stream": "main"}).json()
    c3 = admin.post("/api/cameras", json={**CAM, "name": "Generica", "brand": "rtsp", "host": "cam.local",
                                          "rtsp_path": "/stream1", "username": "", "password": None}).json()
    token, screen = activate_device(admin, client, identifier="TV-CFTV", profile="CAMERA_PLAYER",
                                    camera_ids=[c2["id"], c1["id"], c3["id"]], camera_cycle_seconds=20)
    assert screen["effective_content"] == "Câmeras: 3"
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["mode"] == "cameras"
    cams = cfg["cameras"]
    assert cams["layout"] == "4" and cams["slots"] == 4 and cams["cycle_seconds"] == 20
    assert [i["name"] for i in cams["items"]] == ["Estacionamento", "Portaria", "Generica"]
    # senha codificada na URL (caracteres especiais), canal e substream
    assert cams["items"][1]["url"] == ("rtsp://visualizador:S3nh%40%3A%2F%23%3F@192.168.1.108:554"
                                       "/cam/realmonitor?channel=1&subtype=1")
    assert cams["items"][0]["url"].endswith("channel=2&subtype=0")
    assert cams["items"][2]["url"] == "rtsp://cam.local:554/stream1"

    # câmera desativada sai do mosaico; layout fixo
    admin.patch(f"/api/cameras/{c3['id']}", json={"is_active": False})
    admin.patch(f"/api/screens/{screen['id']}", json={"camera_layout": "1"})
    cams = client.get("/api/player/config", headers=dev(token)).json()["cameras"]
    assert len(cams["items"]) == 2 and cams["slots"] == 1

    # excluir câmera remove do mosaico
    assert admin.delete(f"/api/cameras/{c2['id']}").status_code == 204
    assert admin.get(f"/api/screens/{screen['id']}").json()["camera_ids"] == [c1["id"], c3["id"]]
    assert admin.patch(f"/api/screens/{screen['id']}", json={"camera_ids": [999]}).status_code == 400


def test_camera_profile_without_cameras_is_idle(client, admin):
    token, _ = activate_device(admin, client, identifier="TV-C0", profile="CAMERA_PLAYER")
    assert client.get("/api/player/config", headers=dev(token)).json()["mode"] == "idle"
