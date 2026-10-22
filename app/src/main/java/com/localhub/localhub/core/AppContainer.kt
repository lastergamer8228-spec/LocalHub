package com.localhub.localhub.core

import android.content.Context
import androidx.room.Room
import com.google.gson.Gson
import com.localhub.localhub.data.datastore.PreferencesManager
import com.localhub.localhub.data.local.AppDatabase
import com.localhub.localhub.data.repository.LogRepository
import com.localhub.localhub.data.repository.ModuleRepository
import com.localhub.localhub.data.repository.SettingRepository
import com.localhub.localhub.data.repository.StatisticsRepository
import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.model.ServerStatus
import com.localhub.localhub.module.AIAssistantModule
import com.localhub.localhub.module.AssistantCapabilities
import com.localhub.localhub.module.CoreCapabilities
import com.localhub.localhub.module.DashboardModule
import com.localhub.localhub.module.FileManagerModule
import com.localhub.localhub.module.ModuleManager
import com.localhub.localhub.server.ClientTracker
import com.localhub.localhub.server.LocalHubServer
import com.localhub.localhub.server.SessionManager
import com.localhub.localhub.server.ShareTokenManager
import com.localhub.localhub.system.SystemInfoProvider
import com.localhub.localhub.system.DeviceActions
import com.localhub.localhub.system.ScreenMirror
import com.localhub.localhub.system.TtsEngine
import com.localhub.localhub.util.AppLogger
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.runBlocking

/**
 * Manual dependency container (clean / no DI framework). Built once in
 * [com.localhub.localhub.LocalHubApplication] and reused across the app.
 */
class AppContainer(context: Context) {

    private val appContext = context.applicationContext

    val gson = Gson()

    val database: AppDatabase = Room.databaseBuilder(
        appContext,
        AppDatabase::class.java,
        AppDatabase.NAME
    ).fallbackToDestructiveMigration().build()

    val preferencesManager = PreferencesManager(appContext)

    val logRepository = LogRepository(database.logDao())
    val settingRepository = SettingRepository(database.settingDao())
    val moduleRepository = ModuleRepository(database.moduleDao())
    val statisticsRepository = StatisticsRepository(database.statisticsDao())

    val logger = AppLogger(logRepository)
    val systemInfoProvider = SystemInfoProvider(appContext)
    val deviceActions = DeviceActions(appContext)
    val screenMirror = ScreenMirror(appContext)
    val ttsEngine = TtsEngine(appContext)
    val moduleManager = ModuleManager().apply {
        register(DashboardModule())
        register(FileManagerModule())
        register(AIAssistantModule())
        // Register all assistant capability modules so the Modules screen shows
        // every subsystem (Mind, Knowledge, Critical Thinking, Guardian, Voice,
        // Communication, Self-Dev, Self-Awareness) with its settings.
        AssistantCapabilities.all().forEach { register(it) }
        // Register core LocalHub feature modules (server, security, media,
        // mirror, device control, shares, monitor, automation, tts, os, esp32).
        CoreCapabilities.all().forEach { register(it) }
    }

    init {
        // Seed the module registry into Room so the Modules screen can show them.
        runBlocking {
            moduleManager.toInfoList().forEach { moduleRepository.upsert(it) }
        }
    }

    /** Shared so client state survives server restarts (e.g. port change). */
    val clientTracker = ClientTracker()

    /** Shared session store so web login survives server restarts/rebuilds. */
    val sessionManager = SessionManager()

    /** Shared LAN share-token store so shares survive server restarts. */
    val shareTokenManager = ShareTokenManager()

    private val _serverStatus = MutableStateFlow(
        ServerStatus(false, Constants.DEFAULT_PORT, "", Constants.SERVER_VERSION, 0, 0)
    )
    val serverStatus: StateFlow<ServerStatus> = _serverStatus.asStateFlow()

    val connectedClients: StateFlow<List<ConnectedClient>> = clientTracker.clients
    val isServerRunning = MutableStateFlow(false)

    var server: LocalHubServer = buildServer(initialPort())
        private set

    private fun initialPort(): Int = runBlocking { preferencesManager.portFlow.first() }

    private fun buildServer(port: Int): LocalHubServer = LocalHubServer(
        context = appContext,
        systemInfoProvider = systemInfoProvider,
        deviceActions = deviceActions,
        screenMirror = screenMirror,
        ttsEngine = ttsEngine,
        moduleManager = moduleManager,
        logger = logger,
        preferencesManager = preferencesManager,
        statisticsRepository = statisticsRepository,
        logRepository = logRepository,
        gson = gson,
        clientTracker = clientTracker,
        sessionManager = sessionManager,
        shareTokenManager = shareTokenManager,
        controlServer = { command -> controlServer(command) },
        reportStatus = { _serverStatus.value = it },
        port = port
    )

    /**
     * Server control (start/stop/restart) invoked from the web quick-actions.
     * Runs on a background thread so the current HTTP response completes first,
     * and routes through this container so `isServerRunning` + sessions are
     * managed consistently and the server is rebuilt reliably on restart.
     */
    fun controlServer(command: String) {
        Thread {
            runCatching {
                when (command) {
                    "restart" -> {
                        val p = _serverStatus.value.port.takeIf { it in 1024..65535 } ?: initialPort()
                        if (isServerRunning.value) runCatching { server.stopServer() }
                        Thread.sleep(600) // allow the port to be released
                        server = buildServer(p)
                        isServerRunning.value = server.startServer()
                    }
                    "stop" -> {
                        server.stopServer()
                        isServerRunning.value = false
                    }
                    "start" -> {
                        if (!isServerRunning.value) {
                            isServerRunning.value = server.startServer()
                        }
                    }
                    else -> logger.warn("Control", "Unknown server command: $command")
                }
            }.onFailure {
                logger.error("Control", "controlServer '$command' failed: ${it.message}")
                isServerRunning.value = false
            }
        }.start()
    }

    /** Recreate the server on a new port (used after the user changes it). */
    fun restartServer(port: Int) {
        val wasRunning = isServerRunning.value
        if (wasRunning) server.stopServer()
        server = buildServer(port)
        if (wasRunning) {
            isServerRunning.value = server.startServer()
        } else {
            isServerRunning.value = false
        }
    }

    init {
        systemInfoProvider.collectSnapshot()

        try {
            isServerRunning.value = server.startServer()
        } catch (e: Exception) {
            logger.error("AppContainer", "Failed to start server: ${e.message}")
            isServerRunning.value = false
        }
    }
}
