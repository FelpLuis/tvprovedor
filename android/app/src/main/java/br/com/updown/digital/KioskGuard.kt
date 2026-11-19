package br.com.updown.digital

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * Modo quiosque: mantém o UpDown Digital sempre na frente.
 *
 * - Ao ligar a TV (inclusive após queda de energia) tenta abrir o app algumas vezes, porque o
 *   launcher da TV e a rede às vezes demoram a subir.
 * - A cada minuto verifica se o app está na frente; se não estiver (ex.: a TV abriu a própria
 *   tela inicial), traz o app de volta.
 * - Respeita: a opção "Tela cheia (modo quiosque)" do gerenciador, a espera (TV desligada pelo
 *   gerenciador) e a saída de manutenção (VOLTAR 5 vezes = 10 minutos sem voltar sozinho).
 *
 * Em Android 10 ou superior, abrir sozinho exige a permissão "Sobrepor a outros apps"
 * (pedida pelo assistente de configuração) ou o app definido como tela inicial.
 */
object KioskGuard {
    const val ACTION_CHECK = "br.com.updown.digital.KIOSK_CHECK"
    private const val INTERVAL_MS = 60_000L
    private const val MAINTENANCE_MS = 10 * 60_000L

    /** Atualizado pelo MainActivity (onStart/onStop). */
    @Volatile var activityVisible = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("updown_kiosk", Context.MODE_PRIVATE)

    fun isEnabled(ctx: Context) = prefs(ctx).getBoolean("enabled", true)

    fun setEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean("enabled", enabled).apply()
        if (enabled) schedule(ctx, INTERVAL_MS) else cancel(ctx)
    }

    /** Saída de manutenção: não volta sozinho por 10 minutos. */
    fun pauseForMaintenance(ctx: Context) = pause(ctx, MAINTENANCE_MS)

    /** Pausa curta (configuração de permissões, confirmação de atualização). */
    fun pause(ctx: Context, ms: Long) {
        val until = maxOf(prefs(ctx).getLong("paused_until", 0L), System.currentTimeMillis() + ms)
        prefs(ctx).edit().putLong("paused_until", until).apply()
    }

    private fun paused(ctx: Context) = System.currentTimeMillis() < prefs(ctx).getLong("paused_until", 0L)

    /** Chamado no boot: tenta abrir agora e de novo em 15 s, 45 s e 90 s. */
    fun onBoot(ctx: Context) {
        prefs(ctx).edit().remove("paused_until").apply()
        bringToFront(ctx)
        for (delay in longArrayOf(15_000L, 45_000L, 90_000L)) scheduleOnce(ctx, delay, delay.toInt())
        schedule(ctx, INTERVAL_MS)
    }

    fun check(ctx: Context) {
        if (isEnabled(ctx)) {
            if (!activityVisible && !paused(ctx) && !PowerController.isStandby(ctx)) bringToFront(ctx)
            schedule(ctx, INTERVAL_MS)
        }
    }

    fun bringToFront(ctx: Context) {
        val intent = Intent(ctx, MainActivity::class.java).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        )
        try { ctx.startActivity(intent) } catch (e: Exception) { /* sem permissão de sobreposição */ }
    }

    private fun pending(ctx: Context, code: Int): PendingIntent {
        val i = Intent(ctx, KioskReceiver::class.java).setAction(ACTION_CHECK)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getBroadcast(ctx, 7000 + code, i, flags)
    }

    fun schedule(ctx: Context, delayMs: Long) = scheduleOnce(ctx, delayMs, 0)

    private fun scheduleOnce(ctx: Context, delayMs: Long, code: Int) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val at = SystemClock.elapsedRealtime() + delayMs
        // ELAPSED_REALTIME (sem _WAKEUP): não acorda a TV em espera só para verificar
        if (Build.VERSION.SDK_INT >= 23) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME, at, pending(ctx, code))
        } else {
            am.set(AlarmManager.ELAPSED_REALTIME, at, pending(ctx, code))
        }
    }

    private fun cancel(ctx: Context) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(ctx, 0))
    }
}

class KioskReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == KioskGuard.ACTION_CHECK) KioskGuard.check(context.applicationContext)
    }
}
