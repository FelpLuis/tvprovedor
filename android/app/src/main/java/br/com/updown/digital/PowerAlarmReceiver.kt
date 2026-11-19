package br.com.updown.digital

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Alarmes de energia:
 *  - POWER_WAKE: chegou o horário de ligar (agendado localmente, funciona sem rede);
 *  - POWER_POLL: a cada minuto em espera, pergunta ao servidor se a TV deve ligar
 *    (atende "Ligar agora" no gerenciador). A conexão é sempre da TV para o servidor (HTTPS).
 */
class PowerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        when (intent.action) {
            PowerController.ACTION_WAKE -> PowerController.wake(ctx)
            PowerController.ACTION_POLL -> {
                if (!PowerController.isStandby(ctx)) return
                val result = goAsync()
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
                val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "updown:poll")
                wl.acquire(30_000L)
                Thread {
                    try {
                        when (fetchState(ctx)) {
                            "on" -> PowerController.wake(ctx)
                            else -> PowerController.schedulePoll(ctx)  // "off" ou sem rede: tenta de novo
                        }
                    } finally {
                        if (wl.isHeld) wl.release()
                        result.finish()
                    }
                }.start()
            }
        }
    }

    private fun fetchState(ctx: Context): String? {
        val prefs = PowerController.prefs(ctx)
        val token = prefs.getString("token", null) ?: return null
        val origin = prefs.getString("origin", null) ?: return null
        if (!origin.startsWith("https://")) return null
        return try {
            val conn = URL("$origin/api/player/power").openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Accept", "application/json")
            try {
                if (conn.responseCode != 200) return null
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                val nextOn = json.optLong("next_on_ms", 0L)
                if (json.optString("state") == "off" && nextOn > 0) {
                    prefs.edit().putLong("next_on", nextOn).apply()
                }
                json.optString("state")
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            null
        }
    }
}
