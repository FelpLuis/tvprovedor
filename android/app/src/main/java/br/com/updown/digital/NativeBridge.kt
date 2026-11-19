package br.com.updown.digital

import android.content.Context
import android.media.AudioManager
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
        KioskGuard.setEnabled(activity, enabled)  // "Tela cheia (modo quiosque)" do gerenciador
        activity.runOnUiThread { activity.applyFullscreen() }
    }

    /** Sinal de vida do player (a cada heartbeat); sem sinal por 5 min o app recarrega a página. */
    @JavascriptInterface
    fun ping() {
        if (trusted()) activity.lastPing = SystemClock.elapsedRealtime()
    }

    /** Token do dispositivo: usado pelo app para consultar o servidor com a tela apagada. */
    @JavascriptInterface
    fun setCredentials(token: String, origin: String) {
        if (!trusted() || !activity.isPlayerOrigin("$origin/") || !token.startsWith("uds_")) return
        PowerController.saveCredentials(activity, token, origin)
    }

    /** Ligar (true) ou colocar em espera (false). nextOnMs = próximo horário de ligar (0 = nenhum). */
    @JavascriptInterface
    fun setPower(on: Boolean, nextOnMs: Double) {
        if (!trusted()) return
        activity.runOnUiThread { activity.setStandby(!on, nextOnMs.toLong()) }
    }

    /** Volume do aparelho (0-100) definido no gerenciador. */
    @JavascriptInterface
    fun setVolume(percent: Int) {
        if (!trusted()) return
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val index = Math.round(percent.coerceIn(0, 100) / 100f * max)
        if (am.getStreamVolume(AudioManager.STREAM_MUSIC) != index) {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0)
        }
    }

    @JavascriptInterface
    fun getVolume(): Int {
        val am = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        return Math.round(am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max)
    }

    /** "device_admin" (espera real) ou "tela_preta" (sem permissão de administrador). */
    @JavascriptInterface
    fun getPowerControl(): String = PowerController.controlMode(activity)

    /** Comando do gerenciador "Atualizar app": verifica e instala a versão do servidor. */
    @JavascriptInterface
    fun checkUpdate(): String {
        if (!trusted()) return "não permitido"
        UpdateManager.check(activity)
        return "verificação iniciada"
    }

    @JavascriptInterface
    fun getUpdateStatus(): String = UpdateManager.lastResult

    /** Comando do gerenciador "Configurar app na TV": refaz as perguntas de permissão. */
    @JavascriptInterface
    fun runSetup() {
        if (trusted()) activity.runOnUiThread { activity.setup.run(force = true) }
    }

    /** Permissões ainda pendentes ("ok" quando tudo liberado). */
    @JavascriptInterface
    fun getSetupStatus(): String = activity.setup.status()

    /** CFTV: mostra o mosaico de câmeras (RTSP direto da rede local) por cima do player. */
    @JavascriptInterface
    fun showCameras(json: String) {
        if (!trusted()) return
        activity.runOnUiThread { activity.cameraWall.show(json) }
    }

    @JavascriptInterface
    fun hideCameras() {
        activity.runOnUiThread { activity.cameraWall.hide() }
    }

    @Volatile private var cameraStatus = ""

    /** Resumo do mosaico para o painel (lido pelo heartbeat). */
    @JavascriptInterface
    fun getCameraStatus(): String {
        activity.runOnUiThread { cameraStatus = activity.cameraWall.status() }
        return cameraStatus
    }

    /** Como as atualizações são instaladas: silenciosa ou com confirmação. */
    @JavascriptInterface
    fun getSilentUpdate(): String = DeviceOwner.silentUpdateMode(activity)

    /** Comando "Reiniciar TV" (modo proprietário do dispositivo). */
    @JavascriptInterface
    fun rebootDevice(): String = if (trusted()) DeviceOwner.reboot(activity) else "não permitido"

    /** Comando "Liberar controle do aparelho": desfaz o modo proprietário. */
    @JavascriptInterface
    fun releaseOwner(): String = if (trusted()) DeviceOwner.release(activity) else "não permitido"

    @JavascriptInterface
    fun reload() {
        if (trusted()) activity.reloadPlayer()
    }
}
