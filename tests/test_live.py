"""Controle ao vivo (WebSocket) e recorte de dashboards."""
import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import activate_device, as_user

ORIGIN = {"origin": "http://testserver"}


def test_live_relays_input_and_pokes(client, admin):
    token, screen = activate_device(admin, client, "TV-LIVE")
    sid = screen["id"]
    with client.websocket_connect("/api/player/live") as tv:
        tv.send_json({"auth": token})
        assert tv.receive_json() == {"t": "hello", "admins": 0}
        tv.send_json({"t": "status", "mode": "dashboard", "proxy_path": "/dash/1/x", "logical": [1920, 1080]})

        with client.websocket_connect(f"/api/screens/{sid}/live", headers=ORIGIN) as adm:
            assert adm.receive_json() == {"t": "tv", "online": True}
            assert adm.receive_json()["proxy_path"] == "/dash/1/x"        # último estado da TV
            assert tv.receive_json() == {"t": "admins", "count": 1}       # TV sabe que está sendo controlada

            adm.send_json({"t": "input", "e": {"k": "down", "x": 0.5, "y": 0.5}})
            assert tv.receive_json() == {"t": "input", "e": {"k": "down", "x": 0.5, "y": 0.5}}
            adm.send_json({"t": "apagar_tudo"})                           # tipo desconhecido não chega na TV
            adm.send_json({"t": "reload"})
            assert tv.receive_json() == {"t": "reload"}

            # comando enviado no painel: a TV é avisada na hora
            r = admin.post(f"/api/screens/{sid}/commands", json={"command": "identify"})
            assert r.status_code == 201
            assert tv.receive_json() == {"t": "poke"}
        assert tv.receive_json() == {"t": "admins", "count": 0}


def test_live_rejects_bad_tokens_and_foreign_sites(client, admin):
    with client.websocket_connect("/api/player/live") as tv:
        tv.send_json({"auth": "uds_token_falso"})
        with pytest.raises(WebSocketDisconnect) as e:
            tv.receive_json()
        assert e.value.code == 4401

    # outro site tentando usar o cookie do administrador
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/api/screens/1/live", headers={"origin": "https://evil.example.com"}) as ws:
            ws.receive_json()
    assert e.value.code == 4403

    # visualizador não controla TVs
    as_user(client, "visual")
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/api/screens/1/live", headers=ORIGIN) as ws:
            ws.receive_json()
    assert e.value.code == 4403


def test_crop_options_reach_the_page_script(client, admin):
    d = admin.post("/api/dashboards", json={"name": "NOC 3D", "kind": "updown_bi", "display_mode": "proxy",
                                            "url": "https://documentacao.noc.updown.com.br/#f1a-central"}).json()
    opts = {**d["options"], "crop": {"keep": ["#viewer3d", "#resumo-equip", ""], "arrange": "rows",
                                     "background": "red;}</script>", "css": ".x{color:red}"}}
    assert admin.patch(f"/api/dashboards/{d['id']}", json={"options": opts}).status_code == 200
    shim = admin.get(f"/dash/{d['id']}/__uds_shim.js").text
    assert '"keep": ["#viewer3d", "#resumo-equip"]' in shim and '"arrange": "rows"' in shim
    assert "</script>" not in shim and "red;}" not in shim                # cor inválida descartada

    # a âncora da URL (#f1a-central) chega à TV
    from app.api.dash_proxy import proxied_url
    from app.database import SessionLocal
    from app.models import Dashboard

    with SessionLocal() as db:
        assert proxied_url(db.get(Dashboard, d["id"])) == f"/dash/{d['id']}/#f1a-central"
