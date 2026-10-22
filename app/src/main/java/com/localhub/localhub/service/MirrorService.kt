package com.localhub.localhub.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.localhub.localhub.LocalHubApplication
import com.localhub.localhub.R
import com.localhub.localhub.ui.MainActivity

/**
 * Foreground service that hosts the screen-capture (MediaProjection).
 *
 * Android 14+ (API 34) requires any MediaProjection to be tied to a foreground
 * service of type FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION. ScreenMirror must run
 * from this service's context so getMediaProjection() + createVirtualDisplay()
 * work on API 34.
 *
 * Start it after the user grants the screen-capture consent:
 *   MirrorService.startConsent(context, resultCode, resultData)
 */
class MirrorService : Service() {

    companion object {
        private const val CHANNEL = "localhub_mirror"
        private const val NOTIF_ID = 4002

        /**
         * Start this service with the MediaProjection consent result so it can
         * begin capturing. (The consent prompt itself is launched by MirrorActivity.)
         */
        fun startWithResult(context: Context, resultCode: Int, resultData: Intent?) {
            val i = Intent(context, MirrorService::class.java)
            i.putExtra("resultCode", resultCode)
            i.putExtra("resultData", resultData)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val resultCode = intent?.getIntExtra("resultCode", android.app.Activity.RESULT_CANCELED) ?: android.app.Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val resultData = intent?.getParcelableExtra<Intent>("resultData")

        val notif = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIF_ID, notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIF_ID, notif)
        }

        if (resultCode != android.app.Activity.RESULT_CANCELED && resultData != null) {
            val container = (application as LocalHubApplication).appContainer
            container.screenMirror.start(this, resultCode, resultData)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        val container = (application as? LocalHubApplication)?.appContainer
        container?.screenMirror?.stop()
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(
                CHANNEL, "LocalHub Screen Mirror",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Screen mirroring is active" }
            mgr.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("LocalHub Screen Mirror")
            .setContentText("Sharing your screen to the dashboard")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pi)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }
}
