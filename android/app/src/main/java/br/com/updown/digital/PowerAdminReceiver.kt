package br.com.updown.digital

import android.app.admin.DeviceAdminReceiver

/**
 * "Administrador do dispositivo" com uma única política: apagar a tela (espera).
 * Ativado pelo script de instalação: adb shell dpm set-active-admin br.com.updown.digital/.PowerAdminReceiver
 */
class PowerAdminReceiver : DeviceAdminReceiver()
