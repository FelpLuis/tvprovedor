package br.com.updown.digital

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Abre o player automaticamente quando a TV liga ou quando o app é atualizado. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // ao ligar, o player consulta o servidor e volta para a espera se estiver fora do horário
        PowerController.prefs(context).edit().putBoolean("standby", false).apply()
        // modo quiosque: abre agora e tenta de novo nos próximos minutos (launcher/rede lentos)
        KioskGuard.onBoot(context.applicationContext)
    }
}
