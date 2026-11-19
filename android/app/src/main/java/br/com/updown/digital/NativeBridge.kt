package br.com.updown.digital

import android.os.Build
import android.os.SystemClock
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Ponte exposta ao player como `window.UpDownNative`.
 * Métodos que alteram o app só funcionam quando a página aberta é o próprio player
 * (um dashboard externo aberto no app não consegue usá-los).
 */
class NativeBridge(private val activity: MainActivity) {

    private fun trusted(): Boolean = activity.isPlayerOrigin(activity.currentUrl)

    /** Informações do aparelho para o painel (modelo, Android, versão do app). */
    @JavascriptInterface
    fun getInfo(): String = JSONObject().apply {
        put("app", BuildConfig.VERSION_NAME)
        put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(60))
        put("android", Build.VERSION.RELEASE ?: "")
        put("sdk", Build.VERSION.SDK_INT)
    }.toString()

    /** Tela cheia definida no gerenciador para esta TV. */
    @JavascriptInterface
    fun setFullscreen(enabled: Boolean) {
        if (!trusted()) return
        activity.fullscreenEnabled = enabled
        activity.runOnUiThread { activity.applyFullscreen() }
    }

    /** Sinal de vida do player (a cada heartbeat); sem sinal por 5 min o app recarrega a página. */
    @JavascriptInterface
    fun ping() {
        if (trusted()) activity.lastPing = SystemClock.elapsedRealtime()
    }

    @JavascriptInterface
    fun reload() {
        if (trusted()) activity.reloadPlayer()
    }
}
