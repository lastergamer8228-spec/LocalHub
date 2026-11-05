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
import kotlinx.coroutines.withContext

/**
 * Keeps the embedded LocalHub server alive while the device is on, shows a
 * persistent notification, and streams system snapshots + log events to every
 * connected WebSocket client.
 */
class LocalHubService : Service() {

    private companion object {
        /** Stats tick is 2s, so this runs a Sentinel pass every ~30s. */
        const val SENTINEL_EVERY_TICKS = 15
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val commandMutex = kotlinx.coroutines.sync.Mutex()
    private var collectJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var nsdHelper: NsdHelper? = null
    private var sentinelTick = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }


    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as LocalHubApplication).appContainer
        val action = intent?.action ?: Constants.ACTION_START
        if (action == Constants.ACTION_START || action == Constants.ACTION_RESTART) {
            promoteForeground(Constants.DEFAULT_PORT)
        }
        scope.launch {
            commandMutex.lock()
            try {
                when (action) {
                    Constants.ACTION_STOP -> {
                        collectJob?.cancel(); collectJob = null
                        nsdHelper?.unregister()
                        container.server.stopServer()
                        container.isServerRunning.value = false
                        wakeLock?.let { if (it.isHeld) it.release() }
                        finishService(startId)
                    }
                    Constants.ACTION_APPLY_PORT -> {
                        val port = intent?.getIntExtra(Constants.EXTRA_PORT, Constants.DEFAULT_PORT) ?: Constants.DEFAULT_PORT
                        require(port in 1024..65535) { "Port must be 1024–65535" }
                        container.preferencesManager.setPort(port)
                        val wasRunning = container.isServerRunning.value
                        container.restartServer(port)
                        if (wasRunning && container.isServerRunning.value) advertise(port)
                        else if (wasRunning) failServer(container.server.lastError ?: "Could not bind port $port")
                        else finishService(startId)
                    }
                    Constants.ACTION_SAVE_NAME -> {
                        val name = intent?.getStringExtra(Constants.EXTRA_NAME)?.trim() ?: "LocalHub"
                        require(name.isNotBlank() && name.length <= 64)
                        container.preferencesManager.setServerName(name)
                        if (container.isServerRunning.value) advertise(container.preferencesManager.portFlow.first())
                        else finishService(startId)
                    }
                    Constants.ACTION_CLEAR_LOGS -> { container.logRepository.clear(); if (!container.isServerRunning.value) finishService(startId) }
                    Constants.ACTION_RESTART -> {
                        if (container.isServerRunning.value) {
                            container.restartServer(container.preferencesManager.portFlow.first())
                            if (container.isServerRunning.value) startServer()
                            else failServer(container.server.lastError ?: "Restart failed")
                        } else finishService(startId)
                    }
                    Constants.ACTION_START -> startServer()
                    else -> throw IllegalArgumentException("Unknown service action")
                }
            } catch (e: Exception) {
                container.serverError.value = e.message ?: "Server command failed"
                container.logger.error("Service", "Command failed: ${e.message}")
                if (!container.isServerRunning.value) finishService(startId)
            } finally { commandMutex.unlock() }
        }
        return if (action == Constants.ACTION_STOP) START_NOT_STICKY else START_STICKY
    }

    /** Called from background coroutines; stops the service on the main thread. */
    private suspend fun finishService(stopId: Int? = null) {
        withContext(Dispatchers.Main) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            if (stopId != null) stopSelfResult(stopId) else stopSelf()
        }
    }

    private suspend fun failServer(message: String) {
        val c = (application as LocalHubApplication).appContainer
        c.serverError.value = message
        c.isServerRunning.value = false
        collectJob?.cancel(); collectJob = null
        nsdHelper?.unregister()
        wakeLock?.let { if (it.isHeld) it.release() }
        withContext(Dispatchers.Main) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun promoteForeground(port: Int) {
        val notification = buildNotification(port)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(Constants.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else startForeground(Constants.NOTIFICATION_ID, notification)
    }

    private suspend fun advertise(port: Int) {
        val c = (application as LocalHubApplication).appContainer
        c.serverError.value = null
        if (nsdHelper == null) nsdHelper = NsdHelper(this, c.logger)
        nsdHelper?.register(c.preferencesManager.serverNameFlow.first(), port)
        withContext(Dispatchers.Main) { promoteForeground(port) }
    }

    private suspend fun startServer() {
        val container = (application as LocalHubApplication).appContainer
        val port = container.preferencesManager.portFlow.first()

        val started = if (container.isServerRunning.value) true else container.startManagedServer()
        container.isServerRunning.value = started
        if (!started) { failServer(container.server.lastError ?: "Server could not start"); return }
        container.serverError.value = null
        advertise(port)

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

                    // Watchdog: NanoHTTPD's accept loop can exit (network change,
                    // socket closed by the system) while the UI still says
                    // "Running". Detect that and bring the listener back instead
                    // of leaving the user with a server that answers nothing.
                    if (container.isServerRunning.value && !container.server.isAlive) {
                        container.logger.error("Service", "Listener thread died while marked running - restarting")
                        runCatching { container.server.stopServer() }
                        val back = container.startManagedServer()
                        container.isServerRunning.value = back
                        if (!back) {
                            failServer(container.server.lastError ?: "Server stopped responding and could not restart")
                            return@launch
                        }
                        container.serverError.value = null
                        advertise(port)
                    }

                    // Sentinel pass. The watchdog above only notices a listener
                    // that vanished; Sentinel is what explains *why* and repairs
                    // the faults that are safe to repair without asking.
                    sentinelTick++
                    if (sentinelTick % SENTINEL_EVERY_TICKS == 0) {
                        runSentinelPass(container)
                    }

                    val snap: SystemInfo = container.systemInfoProvider.collectSnapshot()
                    container.server.broadcastStats(snap)
                    container.server.pruneClients()
                    val stats = StatisticsSnapshot(
                        timestamp = snap.timestamp,
                        cpuUsage = if (snap.cpu.available) snap.cpu.usagePercent else -1f,
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

    /**
     * One Sentinel pass: measure, explain, repair what is safe, then re-measure
     * to prove the repair worked. Everything it does is logged, and anything
     * that needs a decision is only reported - the service never approves a
     * CONFIRM-class action on the user's behalf.
     */
    private suspend fun runSentinelPass(container: com.localhub.localhub.core.AppContainer) {
        val ctx = com.localhub.localhub.sentinel.SentinelModels.SentinelContext(
            expectedRunning = container.isServerRunning.value,
            port = container.preferencesManager.portFlow.first(),
            protocol = container.serverStatus.value.protocol
        )
        val report = runCatching { container.sentinel.run(ctx, autoRemediate = true) }
            .onFailure { container.logger.error("Sentinel", "Pass failed: ${it.message}") }
            .getOrNull() ?: return

        for (action in report.autoApplied) {
            if (action.ok && action.verified) {
                container.logger.info("Sentinel", "Repaired '${action.remedyId}': ${action.message}")
            } else if (action.ok) {
                container.logger.warn("Sentinel", "Ran '${action.remedyId}' but the fault is still there: ${action.message}")
            }
        }
        if (!report.healthy) {
            val first = report.diagnoses.firstOrNull()
            container.logger.warn(
                "Sentinel",
                "Unhealthy - " + (first?.let { "${it.title} (${it.severity})" }
                    ?: "security ${report.security.grade}/${report.security.score}") +
                    ", ${report.pending.size} action(s) waiting for approval"
            )
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
