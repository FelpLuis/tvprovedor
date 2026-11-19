package br.com.updown.digital

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Abre o player automaticamente quando a TV liga ou quando o app é atualizado. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val start = Intent(context, MainActivity::class.java).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
        try {
            context.startActivity(start)
        } catch (e: Exception) {
            // Android 10+ sem a permissão "sobrepor outros apps": use o modo quiosque
            // (app como tela inicial) ou libere a permissão pelo script de instalação.
        }
    }
}
