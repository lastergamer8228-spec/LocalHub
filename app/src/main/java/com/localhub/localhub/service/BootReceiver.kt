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

            val app = context.applicationContext
            val autostart = runBlocking {
                PreferencesManager(app)
                    .autostartFlow
                    .first()
            }
            // Safe mode means the app recently kept crashing: do not start the
            // server automatically, otherwise boot can enter a crash loop.
            val safeMode = (app as? com.localhub.localhub.LocalHubApplication)?.healthStore?.read()?.safeMode ?: false

            if (autostart && !safeMode) {
                val startIntent = Intent(context, LocalHubService::class.java).apply {
                    action = Constants.ACTION_START
                }

                runCatching { androidx.core.content.ContextCompat.startForegroundService(context, startIntent) }
            }
        }
    }
}