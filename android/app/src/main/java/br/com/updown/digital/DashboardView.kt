package br.com.updown.digital

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Color
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.webkit.CookieManager
import android.webkit.HttpAuthHandler
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

/**
 * Dashboards (Grafana, Power BI, Zabbix, UpDown BI) em um navegador próprio, em tela cheia,
 * por cima do player — sem iframe. Assim:
 *  - páginas que bloqueiam incorporação (X-Frame-Options) abrem normalmente;
 *  - BI interno em http:// funciona;
 *  - o app preenche usuário e senha na tela de login e entra sozinho (login_form) ou responde à
 *    autenticação HTTP (http_basic). A sessão fica salva; se expirar, entra de novo.
 */
class DashboardView(private val activity: MainActivity, private val parent: FrameLayout) {

    private val handler = Handler(Looper.getMainLooper())
    private var root: FrameLayout? = null
    private var web: WebView? = null
    private var cfg: JSONObject? = null
    private var lastJson = ""
    private var rotation = 0
    private var marginPct = 0

    private var loginAttempts = 0
    private var loginTries = 0
    private var basicAttempts = 0
    private var loginSubmittedAt = 0L
    private var goToDashboardAfterLogin = false
    private var loaded = false
    private var retryDelay = 10_000L
    @Volatile private var state = ""

    fun show(json: String) {
        if (json == lastJson && root != null) return
        lastJson = json
        val c = JSONObject(json)
        cfg = c
        rotation = c.optInt("rotation", 0)
        marginPct = c.optInt("safe_margin_percent", 0).coerceIn(0, 10)
        ensureViews()
        loginAttempts = 0
        basicAttempts = 0
        retryDelay = 10_000L
        start()
    }

    fun hide() {
        handler.removeCallbacksAndMessages(null)
        web?.let { it.stopLoading(); it.destroy() }
        web = null
        root?.let { parent.removeView(it) }
        root = null
        lastJson = ""
        state = ""
    }

    fun status(): String = state

    private fun auth(): JSONObject? = cfg?.optJSONObject("auth")

    private fun ensureViews() {
        if (root != null) return
        val r = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        parent.addView(r, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root = r
        createWeb()
        r.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> layoutWeb() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWeb() {
        val r = root ?: return
        web?.let { r.removeView(it); it.destroy() }
        val wv = WebView(activity)
        wv.setBackgroundColor(Color.BLACK)
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // dashboards internos podem misturar http/https
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            userAgentString = "$userAgentString UpDownDigitalApp/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.webChromeClient = object : WebChromeClient() {
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }
        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                loaded = false
                handler.removeCallbacks(timeoutRunnable)
                handler.postDelayed(timeoutRunnable, (cfg?.optLong("load_timeout_seconds", 60) ?: 60) * 1000)
            }

            override fun onPageFinished(view: WebView, url: String) {
                loaded = true
                handler.removeCallbacks(timeoutRunnable)
                CookieManager.getInstance().flush()
                retryDelay = 10_000L
                if (state.startsWith("erro")) state = "carregado"
                if (state.isEmpty() || state == "carregando") state = "carregado"
                loginTries = 0
                handler.postDelayed({ tryLogin() }, 800)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) fail("erro: ${error.description}")
            }

            @Deprecated("Android 5.x")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (failingUrl == null || failingUrl == view.url) fail("erro: $description")
            }

            override fun onReceivedHttpAuthRequest(view: WebView, h: HttpAuthHandler, host: String, realm: String) {
                val a = auth()
                if (a != null && basicAttempts < 2) {
                    basicAttempts++
                    h.proceed(a.optString("username"), a.optString("password"))
                    state = "autenticando (HTTP)"
                } else {
                    state = "falha no login: usuário/senha recusados ($host)"
                    h.cancel()
                }
            }

            override fun onReceivedSslError(view: WebView, h: SslErrorHandler, error: SslError) {
                // certificado inválido: não abre (segurança); o painel mostra o motivo
                state = "erro: certificado HTTPS inválido em ${error.url}"
                h.cancel()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                handler.post { createWeb(); start() }
                return true
            }
        }
        r.addView(wv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        web = wv
        layoutWeb()
    }

    /** Gira e dimensiona conforme a orientação e a margem de segurança da TV. */
    private fun layoutWeb() {
        val r = root ?: return
        val wv = web ?: return
        val w = r.width
        val h = r.height
        if (w == 0 || h == 0) return
        val sideways = rotation == 90 || rotation == 270
        val m = 1 - 2 * marginPct / 100f
        val lw = ((if (sideways) h else w) * m).toInt()
        val lh = ((if (sideways) w else h) * m).toInt()
        val lp = wv.layoutParams as FrameLayout.LayoutParams
        if (lp.width != lw || lp.height != lh) {
            lp.width = lw
            lp.height = lh
            lp.gravity = Gravity.CENTER
            wv.layoutParams = lp
        }
        wv.rotation = rotation.toFloat()
    }

    private fun start() {
        val c = cfg ?: return
        val a = auth()
        val loginUrl = a?.optString("login_url").orEmpty()
        state = "carregando"
        if (a != null && a.optString("type") == "login_form" && loginUrl.isNotEmpty()) {
            goToDashboardAfterLogin = true
            web?.loadUrl(loginUrl)
        } else {
            goToDashboardAfterLogin = false
            web?.loadUrl(c.optString("url"))
        }
        scheduleRefresh()
    }

    private val timeoutRunnable = Runnable { if (!loaded) fail("erro: a página não carregou no tempo limite") }

    private fun fail(msg: String) {
        state = msg
        handler.removeCallbacks(timeoutRunnable)
        handler.postDelayed({ web?.reload() ?: start() }, retryDelay)
        retryDelay = (retryDelay * 2).coerceAtMost(300_000L)
    }

    private fun scheduleRefresh() {
        handler.removeCallbacks(refreshRunnable)
        val secs = cfg?.optLong("refresh_seconds", 0L) ?: 0L
        if (secs > 0) handler.postDelayed(refreshRunnable, secs * 1000)
    }

    private val refreshRunnable = Runnable {
        // recarrega mantendo a sessão (cookies); se a sessão expirou, o login automático entra de novo
        web?.reload()
        scheduleRefresh()
    }

    /** Preenche usuário/senha se houver um formulário de login visível na página. */
    private fun tryLogin() {
        val a = auth() ?: return
        if (a.optString("type") != "login_form") return
        val wv = web ?: return
        val script = LOGIN_JS + "(" + listOf(
            a.optString("username"), a.optString("password"),
            a.optString("user_selector"), a.optString("pass_selector"), a.optString("submit_selector")
        ).joinToString(",") { JSONObject.quote(it) } + ")"
        wv.evaluateJavascript(script) { result ->
            val r = result?.trim('"') ?: ""
            when {
                r == "submitted" -> {
                    loginAttempts++
                    loginSubmittedAt = System.currentTimeMillis()
                    state = if (loginAttempts > 3) "falha no login: a página continua pedindo usuário/senha" else "entrando…"
                    if (loginAttempts > 3) return@evaluateJavascript
                    // páginas que não recarregam após o login (SPA): verifica de novo
                    handler.postDelayed({ tryLogin() }, 4000)
                }
                r == "no-form" -> {
                    if (loginSubmittedAt > 0 || loginAttempts > 0) {
                        // login concluído
                        loginAttempts = 0
                        loginSubmittedAt = 0
                        state = "conectado"
                        if (goToDashboardAfterLogin) {
                            goToDashboardAfterLogin = false
                            wv.loadUrl(cfg?.optString("url") ?: return@evaluateJavascript)
                        }
                    } else if (loginTries++ < 8) {
                        // telas de login montadas depois do carregamento (React/Angular)
                        handler.postDelayed({ tryLogin() }, 1500)
                    } else if (goToDashboardAfterLogin) {
                        // já havia sessão: vai direto ao dashboard
                        goToDashboardAfterLogin = false
                        wv.loadUrl(cfg?.optString("url") ?: return@evaluateJavascript)
                    }
                }
            }
        }
    }

    companion object {
        /** Login genérico: acha o campo de senha visível, o de usuário antes dele e envia o formulário. */
        private const val LOGIN_JS = """(function(u,p,us,ps,ss){
  function vis(e){ if(!e) return false; var r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden'; }
  function q(s){ try { return s ? document.querySelector(s) : null; } catch(e){ return null; } }
  var all=[].slice.call(document.querySelectorAll('input'));
  var pass=q(ps) || all.filter(function(i){ return i.type==='password' && vis(i); })[0];
  if(!pass) return 'no-form';
  var user=q(us);
  if(!user){ var idx=all.indexOf(pass);
    for(var i=idx-1;i>=0;i--){ var t=(all[i].type||'text').toLowerCase();
      if(['text','email','tel','number',''].indexOf(t)>=0 && vis(all[i])){ user=all[i]; break; } } }
  function setv(el,v){ var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    el.focus(); if(d && d.set){ d.set.call(el,v); } else { el.value=v; }
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.blur(); }
  if(user) setv(user,u); setv(pass,p);
  var btn=q(ss);
  if(!btn && pass.form){ btn=pass.form.querySelector('button[type=submit],input[type=submit]') || pass.form.querySelector('button'); }
  if(!btn){ btn=[].slice.call(document.querySelectorAll('button,input[type=submit],a')).filter(function(b){
    return vis(b) && /entrar|login|log in|sign in|acessar|continuar|ok/i.test(b.textContent||b.value||''); })[0]; }
  setTimeout(function(){
    if(btn){ btn.click(); }
    else if(pass.form){ if(pass.form.requestSubmit){ pass.form.requestSubmit(); } else { pass.form.submit(); } }
    else { pass.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true})); }
  }, 400);
  return 'submitted';
})"""
    }
}
