package br.com.updown.digital

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.IntentFilter
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Modo "proprietário do dispositivo" (device owner), ativado uma única vez por ADB:
 *   adb shell dpm set-device-owner br.com.updown.digital/.PowerAdminReceiver
 *
 * Com ele o Android permite:
 *  - instalar atualizações do app sem pedir confirmação (em qualquer versão do Android);
 *  - fixar o app como tela inicial (quiosque que sobrevive a queda de energia);
 *  - abrir o app em segundo plano sem a permissão de sobreposição;
 *  - reiniciar o aparelho pelo gerenciador (Android 7+).
 *
 * "Liberar controle do aparelho" (comando remoto) desfaz o modo, para permitir desinstalar o app.
 */
object DeviceOwner {
    private fun dpm(ctx: Context) = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private fun admin(ctx: Context) = ComponentName(ctx, PowerAdminReceiver::class.java)

    fun isOwner(ctx: Context): Boolean = dpm(ctx).isDeviceOwnerApp(ctx.packageName)

    /** Como as atualizações do app são instaladas nesta TV. */
    fun silentUpdateMode(ctx: Context): String = when {
        isOwner(ctx) -> "silenciosa (proprietário do dispositivo)"
        Build.VERSION.SDK_INT >= 31 -> "silenciosa após a 1ª confirmação (Android 12+)"
        else -> "pede confirmação (ative o modo proprietário)"
    }

    /** Chamado ao abrir o app: aplica as vantagens do modo proprietário, se ativo. */
    fun applyPolicies(ctx: Context) {
        if (!isOwner(ctx)) return
        try {
            val home = ComponentName(ctx, "${ctx.packageName}.KioskHome")
            ctx.packageManager.setComponentEnabledSetting(home, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
            val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            // tela inicial fixa: depois de qualquer reinício a TV abre direto no app
            dpm(ctx).addPersistentPreferredActivity(admin(ctx), filter, home)
        } catch (e: Exception) { /* aparelho sem suporte: segue com o vigia do quiosque */ }
    }

    fun reboot(ctx: Context): String {
        if (!isOwner(ctx)) return "requer o modo proprietário do dispositivo"
        if (Build.VERSION.SDK_INT < 24) return "requer Android 7 ou superior"
        return try { dpm(ctx).reboot(admin(ctx)); "reiniciando" } catch (e: Exception) { "falha: ${e.message}" }
    }

    /** Desfaz o modo proprietário (necessário antes de desinstalar o app). */
    fun release(ctx: Context): String {
        if (!isOwner(ctx)) return "o app não é proprietário deste aparelho"
        return try {
            dpm(ctx).clearPackagePersistentPreferredActivities(admin(ctx), ctx.packageName)
            @Suppress("DEPRECATION")
            dpm(ctx).clearDeviceOwnerApp(ctx.packageName)
            "modo proprietário removido; o app já pode ser desinstalado"
        } catch (e: Exception) { "falha: ${e.message}" }
    }
}
