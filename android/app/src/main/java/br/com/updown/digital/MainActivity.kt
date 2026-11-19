package br.com.updown.digital

import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * UpDown Digital para Android TV.
 *
 * Abre sempre a mesma URL do player (BuildConfig.PLAYER_URL) em tela cheia, mantém a tela
 * ligada e se recupera sozinho: recarrega quando a página falha, quando o processo do WebView
 * morre ou quando o player deixa de dar sinal de vida (watchdog).
 */
class MainActivity : Activity() {

    private lateinit var container: FrameLayout
    private var webView: WebView? = null
    private val handler = Handler(Looper.getMainLooper())

    /** Preferência do gerenciador (por TV); o player informa pela ponte JavaScript. */
    @Volatile var fullscreenEnabled = true

    /** Último sinal de vida do player (UpDownNative.ping()). */
    @Volatile var lastPing = SystemClock.elapsedRealtime()

    @Volatile var currentUrl: String = ""

    private val backPresses = ArrayDeque<Long>()

    lateinit var setup: SetupAssistant
    lateinit var cameraWall: CameraWall

    /** Verificação de atualização: 2 min após abrir e depois a cada 6 h. */
    private val updateCheck = object : Runnable {
        override fun run() {
            UpdateManager.check(this@MainActivity)
            handler.postDelayed(this, 6 * 3600_000L)
        }
    }

    private val setupRunnable = Runnable { if (!isFinishing) setup.run() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        allowWakeOverLock()
        container = FrameLayout(this).apply { setBackgroundColor(Color.rgb(20, 0, 88)) }
        setContentView(container)
        setup = SetupAssistant(this)
        cameraWall = CameraWall(this, container)
        createWebView()
        applyFullscreen()
        handler.postDelayed(watchdog, WATCHDOG_INTERVAL_MS)
        handler.postDelayed(updateCheck, 120_000L)
        KioskGuard.schedule(this, 60_000L)
        watchNetwork()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        webView?.let { old ->
            container.removeView(old)
            old.destroy()
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val wv = WebView(this)
        wv.setBackgroundColor(Color.BLACK)
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage: token e última configuração
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false  // vídeos com som sem precisar de clique
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString UpDownDigitalApp/${BuildConfig.VERSION_NAME}"
        }
        wv.addJavascriptInterface(NativeBridge(this), "UpDownNative")
        wv.webChromeClient = object : WebChromeClient() {
            // evita o ícone cinza de "play" que o WebView mostra antes do vídeo começar
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
        }
        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                currentUrl = url
                lastPing = SystemClock.elapsedRealtime()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // sem rede no primeiro acesso: tenta de novo (depois do 1º acesso o player abre do cache)
                if (request.isForMainFrame) { loadFailed = true; scheduleReload(RETRY_DELAY_MS) }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!loadFailed) retryDelay = RETRY_DELAY_MS
            }

            @Deprecated("Android 5.x/6.0")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (failingUrl == null || failingUrl == view.url) { loadFailed = true; scheduleReload(RETRY_DELAY_MS) }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // o processo do WebView travou ou foi encerrado pelo sistema: recria
                handler.post { createWebView(); loadPlayer() }
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // tudo abre dentro do app (inclusive dashboards em modo "abrir página diretamente")
                val scheme = request.url.scheme ?: return true
                return scheme != "https" && scheme != "http"
            }
        }
        container.addView(wv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        webView = wv
        loadPlayer()
        wv.requestFocus()
    }

    fun playerUrl(): String {
        // permite apontar para outro servidor (homologação) pelo script de instalação:
        // adb shell am start -n br.com.updown.digital/.MainActivity --es url https://...
        val saved = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_URL, null)
        return saved ?: BuildConfig.PLAYER_URL
    }

    fun isPlayerOrigin(url: String): Boolean {
        val a = Uri.parse(url)
        val b = Uri.parse(playerUrl())
        return a.scheme == b.scheme && a.host == b.host && a.port == b.port
    }

    @Volatile private var loadFailed = false
    private var retryDelay = RETRY_DELAY_MS

    /** Rede voltou (ex.: roteador religou após queda de energia): reconecta na hora. */
    private fun watchNetwork() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val onUp = {
            handler.post {
                if (loadFailed) loadPlayer()
                else webView?.evaluateJavascript("window.__udsNetworkUp && window.__udsNetworkUp()", null)
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) { onUp() }
                })
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(object : BroadcastReceiver() {
                    override fun onReceive(c: Context, i: Intent) {
                        if (cm.activeNetworkInfo?.isConnected == true) onUp()
                    }
                }, IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION))
            }
        } catch (e: Exception) { /* sem monitoramento: fica com as tentativas periódicas */ }
    }

    private fun loadPlayer() {
        loadFailed = false
        lastPing = SystemClock.elapsedRealtime()
        webView?.loadUrl(playerUrl())
    }

    @Suppress("UNUSED_PARAMETER")
    private fun scheduleReload(delayMs: Long) {
        handler.removeCallbacks(reloadRunnable)
        handler.postDelayed(reloadRunnable, retryDelay)
        retryDelay = (retryDelay * 2).coerceAtMost(30_000L)  // 5 s, 10 s, 20 s, 30 s…
    }

    private val reloadRunnable = Runnable { loadPlayer() }

    /** Recarrega o player se ele parar de responder por mais de 5 minutos. */
    private val watchdog = object : Runnable {
        override fun run() {
            val silent = SystemClock.elapsedRealtime() - lastPing
            if (isPlayerOrigin(currentUrl) && silent > WATCHDOG_TIMEOUT_MS) loadPlayer()
            handler.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }

    fun applyFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(!fullscreenEnabled)
            window.insetsController?.let { c ->
                if (fullscreenEnabled) {
                    c.hide(WindowInsets.Type.systemBars())
                    c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                } else {
                    c.show(WindowInsets.Type.systemBars())
                }
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (fullscreenEnabled) {
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            } else {
                View.SYSTEM_UI_FLAG_VISIBLE
            }
        }
    }

    fun reloadPlayer() = handler.post { loadPlayer() }

    /** Permite que o app acenda a tela ao sair da espera. */
    private fun allowWakeOverLock() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
    }

    /** Espera definida pelo gerenciador/horário (o player já mostra a tela preta). */
    fun setStandby(standby: Boolean, nextOnMs: Long) {
        if (standby) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            PowerController.standby(this, nextOnMs)
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (PowerController.isStandby(this)) PowerController.wake(this)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        handleIntent(intent)
        applyFullscreen()
        webView?.onResume()
        // assistente de configuração (perguntas pendentes, pelo controle remoto)
        handler.removeCallbacks(setupRunnable)
        handler.postDelayed(setupRunnable, 2500)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.getBooleanExtra("wake", false) == true) {
            intent.removeExtra("wake")
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            // pede ao player que consulte o servidor imediatamente
            webView?.evaluateJavascript("window.__udsWake && window.__udsWake()", null)
        }
        val url = intent?.getStringExtra("url") ?: return
        intent.removeExtra("url")
        if (url.startsWith("https://")) {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_URL, url).apply()
            loadPlayer()
        } else if (url == "default") {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_URL).apply()
            loadPlayer()
        }
    }

    override fun onStart() {
        super.onStart()
        KioskGuard.activityVisible = true
    }

    override fun onStop() {
        KioskGuard.activityVisible = false
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyFullscreen()
    }

    /**
     * VOLTAR não fecha o app (evita sair da programação por engano).
     * Para sair na manutenção: pressione VOLTAR 5 vezes em até 4 segundos.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            val now = SystemClock.elapsedRealtime()
            backPresses.addLast(now)
            while (backPresses.isNotEmpty() && now - backPresses.first() > 4000) backPresses.removeFirst()
            if (backPresses.size >= 5) {
                backPresses.clear()
                KioskGuard.pauseForMaintenance(this)  // 10 min sem voltar sozinho
                moveTaskToBack(true)
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        cameraWall.hide()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    companion object {
        const val PREFS = "updown_digital"
        const val KEY_URL = "player_url"
        const val RETRY_DELAY_MS = 5_000L
        const val WATCHDOG_INTERVAL_MS = 60_000L
        const val WATCHDOG_TIMEOUT_MS = 5 * 60_000L
    }
}
