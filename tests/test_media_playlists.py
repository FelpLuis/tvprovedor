import shutil
import subprocess
import time

import pytest
from conftest import activate_device, as_user, dev, jpg_bytes, png_bytes, upload


def _mp4(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg indisponível")
    out = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10",
                    "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)], check=True)
    return out.read_bytes()


def test_upload_validation(client, admin):
    r = upload(admin, "logo.png", png_bytes(), folder="Institucional")
    assert r.status_code == 201, r.text
    m = r.json()["created"][0]
    assert m["kind"] == "image" and m["width"] == 64 and m["has_thumbnail"] and m["folder"] == "Institucional"
    assert admin.get(f"/api/media/{m['id']}/thumbnail").status_code == 200
    assert admin.get(f"/api/media/{m['id']}/file").content == png_bytes()

    # extensão proibida
    assert upload(admin, "script.sh", b"#!/bin/sh\nrm -rf /").status_code == 400
    assert upload(admin, "a.svg", b"<svg/>").status_code == 400
    # conteúdo não corresponde à extensão
    assert upload(admin, "falso.png", jpg_bytes()).status_code == 400
    assert upload(admin, "falso.mp4", png_bytes()).status_code == 400
    # duplicado
    r = upload(admin, "copia.png", png_bytes())
    assert r.status_code == 400 and "idêntico" in r.text
    # vazio
    assert upload(admin, "vazio.jpg", b"").status_code == 400

    assert admin.get("/api/media/folders").json() == ["Institucional"]
    assert len(admin.get("/api/media?kind=image").json()) == 1
    assert admin.get("/api/media?kind=video").json() == []
    assert len(admin.get("/api/media?q=logo").json()) == 1


def test_size_limit(client, admin, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "max_image_mb", 0)
    assert upload(admin, "big.png", png_bytes()).status_code == 400  # todos rejeitados -> 400 com detalhes


def test_video_upload_and_signed_download(client, admin, tmp_path):
    data = _mp4(tmp_path)
    r = upload(admin, "institucional.mp4", data, "video/mp4")
    assert r.status_code == 201, r.text
    v = r.json()["created"][0]
    assert v["kind"] == "video" and v["width"] == 320 and 1.5 < v["duration_seconds"] < 2.5
    assert r.json()["warnings"] == []

    img = upload(admin, "banner.jpg", jpg_bytes()).json()["created"][0]
    pl = admin.post("/api/playlists", json={
        "name": "Recepção", "default_image_seconds": 8, "fit_mode": "cover",
        "items": [{"media_id": img["id"], "duration_seconds": 15}, {"media_id": v["id"]}]}).json()
    assert [i["media_id"] for i in pl["items"]] == [img["id"], v["id"]]
    assert pl["total_seconds"] == pytest.approx(15 + v["duration_seconds"], 0.1)

    token, screen = activate_device(admin, client, playlist_id=pl["id"])
    cfg = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg["mode"] == "media"
    items = cfg["playlist"]["items"]
    assert items[0]["duration"] == 15 and items[1]["duration"] is None and items[1]["kind"] == "video"
    assert cfg["playlist"]["fit_mode"] == "cover"

    url = items[1]["url"]
    client.cookies.clear()
    r = client.get(url)
    assert r.status_code == 200 and r.content == data and r.headers["x-media-sha256"] == v["sha256"]
    r = client.get(url, headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100
    # assinatura adulterada / expirada
    assert client.get(url.replace("sig=", "sig=0")).status_code in (403, 422)
    expired = url.split("?")[0] + f"?exp={int(time.time()) - 1}&sig=abc"
    assert client.get(expired).status_code == 403


def test_playlist_lifecycle_and_config_hash(client, admin):
    a = upload(admin, "a.png", png_bytes((1, 1, 1))).json()["created"][0]
    b = upload(admin, "b.png", png_bytes((2, 2, 2))).json()["created"][0]
    pl = admin.post("/api/playlists", json={"name": "P1", "items": [{"media_id": a["id"]}]}).json()
    g = admin.post("/api/groups", json={"name": "Recepção", "playlist_id": pl["id"]}).json()
    token, screen = activate_device(admin, client, group_id=g["id"])

    cfg1 = client.get("/api/player/config", headers=dev(token)).json()
    assert cfg1["mode"] == "media" and cfg1["playlist"]["id"] == pl["id"]  # herdada do grupo
    assert admin.get(f"/api/screens/{screen['id']}").json()["effective_content"] == "Playlist: P1 (grupo)"

    # reordenar / adicionar altera o hash -> player sincroniza
    r = admin.patch(f"/api/playlists/{pl['id']}", json={"items": [{"media_id": b["id"]}, {"media_id": a["id"]}]})
    assert r.status_code == 200 and r.json()["version"] == 2
    hb = client.post("/api/player/heartbeat", json={"config_hash": cfg1["config_hash"]}, headers=dev(token)).json()
    assert hb["config_hash"] != cfg1["config_hash"]
    cfg2 = client.get("/api/player/config", headers=dev(token)).json()
    assert [i["media_id"] for i in cfg2["playlist"]["items"]] == [b["id"], a["id"]]
    client.post("/api/player/heartbeat", json={"config_hash": cfg2["config_hash"]}, headers=dev(token))
    assert admin.get(f"/api/screens/{screen['id']}").json()["in_sync"] is True

    # mídia em uso não pode ser excluída; playlist em uso também não
    assert admin.delete(f"/api/media/{a['id']}").status_code == 409
    assert admin.delete(f"/api/playlists/{pl['id']}").status_code == 409

    # playlist inativa -> player fica ocioso
    admin.patch(f"/api/playlists/{pl['id']}", json={"is_active": False})
    assert client.get("/api/player/config", headers=dev(token)).json()["mode"] == "idle"

    dup = admin.post(f"/api/playlists/{pl['id']}/duplicate").json()
    assert dup["name"] == "P1 (cópia)" and len(dup["items"]) == 2 and dup["is_active"] is False

    admin.put(f"/api/groups/{g['id']}/playlist", json={"playlist_id": None})
    assert admin.delete(f"/api/playlists/{pl['id']}").status_code == 204
    assert admin.delete(f"/api/playlists/{dup['id']}").status_code == 204
    assert admin.delete(f"/api/media/{a['id']}").status_code == 204
    assert admin.get(f"/api/media/{a['id']}").status_code == 404


def test_playlist_invalid_media(admin):
    r = admin.post("/api/playlists", json={"name": "X", "items": [{"media_id": 999}]})
    assert r.status_code == 400
