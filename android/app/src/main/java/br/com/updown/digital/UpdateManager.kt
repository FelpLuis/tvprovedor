package br.com.updown.digital

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Atualização do app sem ADB: consulta {servidor}/app/version.json e, se houver versão nova,
 * baixa o APK, confere o SHA-256 e o entrega ao instalador do Android. Atualizações assinadas com
 * a mesma chave instalam por cima; o Android pode pedir uma confirmação (OK no controle remoto).
 */
object UpdateManager {
    @Volatile var lastResult: String = "nunca verificado"
    @Volatile private var running = false

    fun serverOrigin(ctx: Context): String {
        PowerController.prefs(ctx).getString("origin", null)?.let { return it }
        val u = Uri.parse(BuildConfig.PLAYER_URL)
        return "${u.scheme}://${u.authority}"
    }

    /** Verifica e instala em segundo plano. `onDone` recebe um texto de resultado. */
    fun check(ctx: Context, onDone: ((String) -> Unit)? = null) {
        if (running) { onDone?.invoke("verificação já em andamento"); return }
        running = true
        val app = ctx.applicationContext
        Thread {
            val result = try { checkNow(app) } catch (e: Exception) { "falha: ${e.message ?: e.javaClass.simpleName}" }
            lastResult = result
            running = false
            onDone?.invoke(result)
        }.start()
    }

    private fun checkNow(ctx: Context): String {
        val origin = serverOrigin(ctx)
        if (!origin.startsWith("https://")) return "servidor sem HTTPS"
        val info = JSONObject(get("$origin/app/version.json").toString(Charsets.UTF_8))
        val remote = info.getInt("versionCode")
        if (remote <= BuildConfig.VERSION_CODE) return "app atualizado (${BuildConfig.VERSION_NAME})"
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            return "versão ${info.optString("versionName")} disponível, mas falta permitir instalar atualizações (Configurar app na TV)"
        }
        val path = info.optString("url", "/app/updown-digital.apk")
        val url = if (path.startsWith("https://")) path else origin + path
        if (!url.startsWith(origin)) return "URL de atualização fora do servidor"
        val apk = get(url)
        val sha = MessageDigest.getInstance("SHA-256").digest(apk).joinToString("") { "%02x".format(it) }
        if (sha != info.getString("sha256")) return "arquivo baixado não confere (SHA-256)"
        install(ctx, apk)
        return "instalando versão ${info.optString("versionName")}"
    }

    private fun get(url: String): ByteArray {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 20_000
        conn.readTimeout = 120_000
        try {
            if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
            return conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    }

    private fun install(ctx: Context, apk: ByteArray) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("updown-digital.apk", 0, apk.size.toLong()).use { out ->
                out.write(apk)
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallResultReceiver::class.java), flags)
            session.commit(pi.intentSender)
        }
    }
}

/** Resultado da instalação; se o Android pedir confirmação, abre a tela de confirmação. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                KioskGuard.pause(context, 3 * 60_000L)  // deixa a tela de confirmação na frente
                try { context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
                UpdateManager.lastResult = "aguardando confirmação na TV"
            }
            PackageInstaller.STATUS_SUCCESS -> UpdateManager.lastResult = "atualizado"
            else -> UpdateManager.lastResult = "falha na instalação: " +
                (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "desconhecida")
        }
    }
}
