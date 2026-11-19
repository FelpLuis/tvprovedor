package br.com.updown.digital

import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.app.AlarmManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Assistente de configuração na própria TV (sem ADB): pede, pelo controle remoto, as permissões
 * que tornam o app autônomo. Cada item é perguntado uma vez; os recusados podem ser refeitos pelo
 * comando remoto "Configurar app na TV".
 */
class SetupAssistant(private val activity: MainActivity) {

    private val prefs = activity.getSharedPreferences("updown_setup", Context.MODE_PRIVATE)

    private data class Step(val key: String, val title: String, val text: String,
                            val needed: () -> Boolean, val open: () -> Unit)

    private val steps: List<Step> by lazy {
        listOf(
            Step("overlay", "Modo quiosque: abrir sozinho ao ligar a TV",
                "Essencial para o app abrir sozinho depois de uma queda de energia e voltar para a frente se outra tela abrir. " +
                    "Na próxima tela, ative \"Permitir sobreposição\" (exibir sobre outros apps) para o UpDown Digital.",
                { Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(activity) },
                { open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${activity.packageName}"))) }),
            Step("admin", "Ligar e desligar pelo gerenciador",
                "Na próxima tela, ative o administrador do dispositivo. Ele só é usado para apagar a tela (modo espera).",
                { !PowerController.hasDeviceAdmin(activity) },
                {
                    open(Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, ComponentName(activity, PowerAdminReceiver::class.java))
                        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Permite que o gerenciador UpDown Digital coloque a TV em espera e a religue no horário."))
                }),
            Step("alarm", "Religar no horário exato",
                "Na próxima tela, permita \"Alarmes e lembretes\" para o UpDown Digital.",
                {
                    Build.VERSION.SDK_INT >= 31 &&
                        !(activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
                },
                { if (Build.VERSION.SDK_INT >= 31) open(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${activity.packageName}"))) }),
            Step("install", "Atualizar o app sozinho",
                "Na próxima tela, ative \"Permitir desta fonte\" para que o UpDown Digital instale as próprias atualizações.",
                { Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls() },
                { if (Build.VERSION.SDK_INT >= 26) open(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))) }),
            Step("home", "Usar como tela inicial (modo quiosque)",
                "Recomendado para TVs dedicadas: a TV sempre volta para a programação. Na próxima tela, escolha \"UpDown Digital\" e \"Sempre\".",
                { !isDefaultHome() },
                { enableKioskHome() }),
        )
    }

    /** Executa os passos pendentes que ainda não foram perguntados (ou todos, se forçado). */
    fun run(force: Boolean = false) {
        val step = steps.firstOrNull { it.needed() && (force || !prefs.getBoolean(it.key, false)) } ?: return
        prefs.edit().putBoolean(step.key, true).apply()
        AlertDialog.Builder(activity)
            .setTitle("Configuração da TV — ${step.title}")
            .setMessage(step.text)
            .setPositiveButton("Configurar") { _, _ -> step.open() }
            .setNegativeButton("Agora não") { _, _ -> run(force) }
            .setCancelable(false)
            .show()
            .getButton(AlertDialog.BUTTON_POSITIVE)?.requestFocus()
    }

    /** Estado das permissões, enviado ao painel. */
    fun status(): String = steps.filter { it.needed() }.joinToString(",") { it.key }.ifEmpty { "ok" }

    private fun open(intent: Intent) {
        KioskGuard.pause(activity, 3 * 60_000L)  // não puxar o app enquanto a pessoa configura
        try {
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            // algumas TVs não têm esta tela de configuração; segue para o próximo passo
            activity.runOnUiThread { run() }
        }
    }

    private fun isDefaultHome(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val info = activity.packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)
        return info?.activityInfo?.packageName == activity.packageName
    }

    private fun enableKioskHome() {
        activity.packageManager.setComponentEnabledSetting(
            ComponentName(activity, "${activity.packageName}.KioskHome"),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP
        )
        // tela "App de início" das configurações; se a TV não tiver, o seletor do sistema
        // (pressionar HOME) mostra as opções "Sempre / Só uma vez"
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            try { activity.startActivity(home) } catch (ignored: Exception) { }
        }
    }
}
