package br.com.updown.digital

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager

/**
 * Energia da TV controlada pelo gerenciador.
 *
 * Desligar = colocar o aparelho em espera (tela apagada). Com o app como "administrador do
 * dispositivo" (liberado pelo script de instalação) isso usa o bloqueio de tela do sistema; em
 * TV boxes ligadas por HDMI com CEC ativo, a TV também entra em espera.
 *
 * Enquanto em espera, o app consulta o servidor a cada minuto (a TV é quem chama o servidor,
 * nunca o contrário) e também agenda um alarme para o próximo horário de ligar, que funciona
 * mesmo se a rede cair.
 */
object PowerController {
    const val ACTION_POLL = "br.com.updown.digital.POWER_POLL"
    const val ACTION_WAKE = "br.com.updown.digital.POWER_WAKE"
    private const val PREFS = "updown_power"
    private const val POLL_INTERVAL_MS = 60_000L

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isStandby(ctx: Context) = prefs(ctx).getBoolean("standby", false)

    fun saveCredentials(ctx: Context, token: String, origin: String) {
        prefs(ctx).edit().putString("token", token).putString("origin", origin).apply()
    }

    fun hasDeviceAdmin(ctx: Context): Boolean {
        val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isAdminActive(ComponentName(ctx, PowerAdminReceiver::class.java))
    }

    fun controlMode(ctx: Context) = if (hasDeviceAdmin(ctx)) "device_admin" else "tela_preta"

    /** Entra em espera e agenda as verificações para religar. */
    fun standby(ctx: Context, nextOnMs: Long) {
        val first = !isStandby(ctx)
        prefs(ctx).edit().putBoolean("standby", true).putLong("next_on", nextOnMs).apply()
        scheduleWake(ctx, nextOnMs)
        schedulePoll(ctx)
        if (first && hasDeviceAdmin(ctx)) {
            val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            try { dpm.lockNow() } catch (e: SecurityException) { /* sem permissão: fica com a tela preta */ }
        }
    }

    /** Sai da espera: acende a tela e traz o player para frente. */
    fun wake(ctx: Context) {
        prefs(ctx).edit().putBoolean("standby", false).apply()
        cancel(ctx, ACTION_POLL)
        cancel(ctx, ACTION_WAKE)
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isInteractive) {
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "updown:wake"
            )
            wl.acquire(10_000L)
        }
        val start = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra("wake", true)
        try { ctx.startActivity(start) } catch (e: Exception) { /* Android 10+ sem permissão de sobreposição */ }
    }

    private fun pending(ctx: Context, action: String): PendingIntent {
        val intent = Intent(ctx, PowerAlarmReceiver::class.java).setAction(action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getBroadcast(ctx, action.hashCode(), intent, flags)
    }

    private fun cancel(ctx: Context, action: String) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(ctx, action))
    }

    fun schedulePoll(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val at = System.currentTimeMillis() + POLL_INTERVAL_MS
        if (Build.VERSION.SDK_INT >= 23) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, ACTION_POLL))
        } else {
            am.set(AlarmManager.RTC_WAKEUP, at, pending(ctx, ACTION_POLL))
        }
    }

    private fun scheduleWake(ctx: Context, nextOnMs: Long) {
        cancel(ctx, ACTION_WAKE)
        if (nextOnMs <= System.currentTimeMillis()) return
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pending(ctx, ACTION_WAKE)
        val exactAllowed = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        when {
            exactAllowed && Build.VERSION.SDK_INT >= 23 -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextOnMs, pi)
            exactAllowed -> am.setExact(AlarmManager.RTC_WAKEUP, nextOnMs, pi)
            Build.VERSION.SDK_INT >= 23 -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextOnMs, pi)
            else -> am.set(AlarmManager.RTC_WAKEUP, nextOnMs, pi)
        }
    }
}
