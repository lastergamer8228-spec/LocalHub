package com.localhub.localhub.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.localhub.localhub.core.Constants
import com.localhub.localhub.data.datastore.PreferencesManager
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * Starts the LocalHub server on boot when the "Autostart" preference is enabled.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) return

        val receivedAction = intent?.action ?: return

        if (
            receivedAction == Intent.ACTION_BOOT_COMPLETED ||
            receivedAction == "android.intent.action.QUICKBOOT_POWERON" ||
            receivedAction == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {

            val autostart = runBlocking {
                PreferencesManager(context.applicationContext)
                    .autostartFlow
                    .first()
            }

            if (autostart) {
                val startIntent = Intent(context, LocalHubService::class.java).apply {
                    action = Constants.ACTION_START
                }

                context.startForegroundService(startIntent)
            }
        }
    }
}