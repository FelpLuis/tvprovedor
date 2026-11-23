import httpx
import pytest
from conftest import activate_device, dev

from app.api import dash_proxy

SEEN = {}


def upstream(request: httpx.Request) -> httpx.Response:
    SEEN["last"] = request
    path = request.url.path
    if path == "/login" and request.method == "POST":
        return httpx.Response(302, headers=[("Location", "http://bi.local:8080/painel"),
                                            ("Set-Cookie", "sid=abc; Domain=bi.local; Path=/; HttpOnly")])
    if path == "/painel":
        html = ('<html><head><title>BI</title><link href="/static/app.css" rel="stylesheet"></head>'
                '<body><img src="/img/logo.png"><a href="//cdn.x/y.js">cdn</a><form action="/login"></form></body></html>')
        return httpx.Response(200, html=html, headers={"X-Frame-Options": "DENY",
                                                       "Content-Security-Policy": "frame-ancestors 'none'"})
    if path == "/static/app.css":
        return httpx.Response(200, text="body{background:url(/img/bg.png)}", headers={"Content-Type": "text/css"})
    return httpx.Response(404)


@pytest.fixture()
def mock_upstream():
    dash_proxy.set_client(httpx.AsyncClient(transport=httpx.MockTransport(upstream), follow_redirects=False))
    yield
    dash_proxy.set_client(None)


def _dash(admin, **kw):
    r = admin.post("/api/dashboards", json={"name": "BI UpDown", "kind": "updown_bi", "url": "http://bi.local:8080/painel?x=1",
                                           "display_mode": "proxy", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_proxy_requires_session(client, admin, mock_upstream):
    d = _dash(admin)
    token, _ = activate_device(admin, client, identifier="TV-OUTRA")
    client.cookies.clear()
    assert client.get(f"/dash/{d['id']}/painel").status_code == 401
    # TV de outro dashboard não ganha acesso
    assert client.post(f"/api/player/dashboards/{d['id']}/session", headers=dev(token)).status_code == 404


def test_proxy_flow_for_tv(client, admin, mock_upstream):
    d = _dash(admin)
    token, screen = activate_device(admin, client, profile="UPDOWN_BI_PLAYER", dashboard_id=d["id"])
    cfg = client.get("/api/player/config", headers=dev(token)).json()["dashboard"]
    assert cfg["url"] == f"/dash/{d['id']}/painel?x=1"
    client.cookies.clear()
    r = client.post(f"/api/player/dashboards/{d['id']}/session", headers=dev(token))
    assert r.status_code == 200 and r.json()["url"] == cfg["url"]
    assert f"uds_dash_{d['id']}" in client.cookies

    r = client.get(f"/dash/{d['id']}/painel?x=1")
    assert r.status_code == 200
    assert "x-frame-options" in r.headers and r.headers["x-frame-options"] == "SAMEORIGIN"
    assert "content-security-policy" not in r.headers
    body = r.text
    p = f"/dash/{d['id']}"
    assert f'href="{p}/static/app.css"' in body and f'src="{p}/img/logo.png"' in body and f'action="{p}/login"' in body
    assert 'href="//cdn.x/y.js"' in body  # URL de outro domínio não é alterada
    assert f'<script src="{p}/__uds_shim.js"></script>' in body
    assert str(SEEN["last"].url) == "http://bi.local:8080/painel?x=1"
    assert "uds_dash" not in SEEN["last"].headers.get("cookie", "")  # cookie do proxy não vaza para o BI

    css = client.get(f"/dash/{d['id']}/static/app.css").text
    assert f"url({p}/img/bg.png)" in css

    r = client.post(f"/dash/{d['id']}/login", data={"u": "a"}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == f"{p}/painel"
    sc = r.headers["set-cookie"]
    assert "sid=abc" in sc and "Domain" not in sc and f"Path={p}/" in sc

    sw = client.get(f"/dash/{d['id']}/__uds_sw.js")
    assert sw.status_code == 200 and sw.headers["service-worker-allowed"] == f"{p}/"


def test_admin_can_preview_and_fallback_redirect(client, admin, mock_upstream):
    d = _dash(admin)
    assert admin.get(f"/dash/{d['id']}/painel").status_code == 200  # sessão do painel
    # link absoluto vindo de uma página do proxy volta para /dash/{id}/
    r = admin.get("/inexistente/rota?a=1", headers={"Referer": f"http://testserver/dash/{d['id']}/painel"},
                  follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == f"/dash/{d['id']}/inexistente/rota?a=1"
