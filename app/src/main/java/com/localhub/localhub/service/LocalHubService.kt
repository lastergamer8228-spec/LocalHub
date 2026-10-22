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
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.localhub.localhub.LocalHubApplication
import com.localhub.localhub.R
import com.localhub.localhub.core.Constants
import com.localhub.localhub.model.StatisticsSnapshot
import com.localhub.localhub.model.SystemInfo
import com.localhub.localhub.net.NsdHelper
import com.localhub.localhub.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * Keeps the embedded LocalHub server alive while the device is on, shows a
 * persistent notification, and streams system snapshots + log events to every
 * connected WebSocket client.
 */
class LocalHubService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var collectJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var nsdHelper: NsdHelper? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }


    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {

        val container = (application as LocalHubApplication).appContainer
        container.logger.info("Service", "Action = ${intent?.action}")

        if (intent?.action == Constants.ACTION_STOP) {
            nsdHelper?.unregister()
            container.server.stopServer()
            container.isServerRunning.value = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        if (intent?.action == Constants.ACTION_APPLY_PORT) {
            val port = intent.getIntExtra(Constants.EXTRA_PORT, 8080)

            runBlocking {
                container.preferencesManager.setPort(port)
            }

            container.restartServer(port)
            // Re-advertise mDNS on the new port.
            val name = runBlocking { container.preferencesManager.serverNameFlow.first() }
            nsdHelper?.register(name, port)
            return START_STICKY
        }

        if (intent?.action == Constants.ACTION_SAVE_NAME) {

            val name = intent.getStringExtra(Constants.EXTRA_NAME) ?: "LocalHub"

            container.logger.info("Service", "Saving name = $name")

            runBlocking {
                container.preferencesManager.setServerName(name)
            }

            // Re-advertise mDNS under the new friendly hostname.
            val port = runBlocking { container.preferencesManager.portFlow.first() }
            if (container.isServerRunning.value) {
                nsdHelper?.register(name, port)
            }

            container.logger.info("Service", "Name saved")

            return START_STICKY
        }

        if (intent?.action == Constants.ACTION_CLEAR_LOGS) {

            container.logger.info("Service", "Before clear")

            runBlocking {
                container.logRepository.clear()
            }

            container.logger.info("Service", "After clear")

            return START_STICKY
        }



        startServer()
        return START_STICKY

    }

    private fun startServer() {
        val container = (application as LocalHubApplication).appContainer
        val port = runBlocking { container.preferencesManager.portFlow.first() }

        container.server.startServer()
        container.isServerRunning.value = true

        // Advertise a friendly hostname over mDNS (best-effort).
        if (nsdHelper == null) {
            nsdHelper = NsdHelper(this, container.logger)
        }
        val name = runBlocking { container.preferencesManager.serverNameFlow.first() }
        nsdHelper?.register(name, port)

        val notification = buildNotification(port)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                Constants.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(Constants.NOTIFICATION_ID, notification)
        }

        acquireWakeLock()

        if (collectJob == null || collectJob?.isActive == false) {
            collectJob = scope.launch {
                launch {
                    container.logger.logs.collect { entry ->
                        container.server.broadcastLog(entry)
                    }
                }
                while (true) {
                    delay(Constants.STATS_INTERVAL_MS)
                    val snap: SystemInfo = container.systemInfoProvider.collectSnapshot()
                    container.server.broadcastStats(snap)
                    container.server.pruneClients()
                    val stats = StatisticsSnapshot(
                        timestamp = snap.timestamp,
                        cpuUsage = snap.cpu.usagePercent,
                        memoryUsed = snap.memory.usedBytes,
                        memoryTotal = snap.memory.totalBytes,
                        batteryLevel = snap.battery.level,
                        batteryTempC = snap.battery.temperatureCelsius,
                        storageUsed = snap.storage.usedBytes,
                        storageTotal = snap.storage.totalBytes,
                        networkType = snap.network.type,
                        connectedClients = container.connectedClients.value.size
                    )
                    runCatching { container.statisticsRepository.insert(stats) }
                }
            }
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LocalHub::server").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun buildNotification(port: Int): Notification {
        val ip = (application as LocalHubApplication).appContainer
            .systemInfoProvider.lastSnapshot.value?.network?.ipAddress ?: "localhost"
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, getString(R.string.notification_channel_id))
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_content, ip, port))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pi)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                getString(R.string.notification_channel_id),
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = getString(R.string.notification_channel_description) }
            mgr.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        collectJob?.cancel()
        nsdHelper?.unregister()
        val container = (application as? LocalHubApplication)?.appContainer
        container?.let { c ->
            c.server.stopServer()
            c.isServerRunning.value = false
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        scope.cancel()
        super.onDestroy()
    }
}
