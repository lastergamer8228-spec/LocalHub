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
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
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
        CoreCapabilities.all().filter { it.id != "core.files" }.forEach { register(it) }
    }

    private val containerScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val modulesRestored = CompletableDeferred<Unit>()

    init {
        // Room must not be opened on the main thread during app start: the old
        // synchronous restore could block long enough to show
        // "App isn't responding". Restore now runs in the background and the
        // server waits for it before accepting requests.
        containerScope.launch {
            runCatching { restoreModuleStates() }
                .onFailure { logger.error("AppContainer", "Module restore failed: ${it.message}") }
            modulesRestored.complete(Unit)
        }
    }

    private suspend fun restoreModuleStates() {
        val saved = moduleRepository.observe().first().associateBy { it.id }
        moduleManager.restoreEnabled(saved.mapValues { it.value.enabled })
        moduleManager.toInfoList().forEach { moduleRepository.upsert(it) }
        moduleRepository.remove("core.files") // obsolete duplicate File Manager card
    }

    /** Server start waits briefly so restored switches are applied before serving. */
    suspend fun awaitModulesRestored(timeoutMs: Long = 5000L) {
        runCatching { withTimeout(timeoutMs) { modulesRestored.await() } }
    }

    private val moduleChangeMutex = kotlinx.coroutines.sync.Mutex()

    suspend fun toggleModule(id: String) {
        moduleChangeMutex.lock()
        try {
            val module = requireNotNull(moduleManager.getModule(id))
            val before = module.isEnabled
            val enabled = !before
            require(id in com.localhub.localhub.module.ModulePolicy.controllable)
            // Persist first: a DB failure must not leave a misleading UI state.
            moduleRepository.upsert(module.toInfo().copy(enabled = enabled))
            try { moduleManager.setEnabled(id, enabled) }
            catch (e: Exception) { moduleRepository.upsert(module.toInfo().copy(enabled = before)); throw e }
            if (id == "core.mirror" && !enabled) {
                screenMirror.stop()
                appContext.stopService(android.content.Intent(appContext, com.localhub.localhub.service.MirrorService::class.java))
            }
        } finally { moduleChangeMutex.unlock() }
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
    val serverError = MutableStateFlow<String?>(null)

    /** Crash/health records, owned by the application and shared with the UI. */
    private val healthStore: com.localhub.localhub.system.CrashReportStore by lazy {
        (appContext as com.localhub.localhub.LocalHubApplication).healthStore
    }

    var server: LocalHubServer = buildServer(Constants.DEFAULT_PORT)
        private set

    private suspend fun currentPort(): Int =
        preferencesManager.portFlow.first().takeIf { it in 1024..65535 } ?: Constants.DEFAULT_PORT

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
        port = port,
        healthSummary = {
            runCatching { healthStore.describe(healthStore.read(), System.currentTimeMillis()) }
                .getOrDefault("Health information is unavailable.")
        }
    )

    /**
     * Server control (start/stop/restart) invoked from the web quick-actions.
     * Runs on a background thread so the current HTTP response completes first,
     * and routes through this container so `isServerRunning` + sessions are
     * managed consistently and the server is rebuilt reliably on restart.
     */
    fun controlServer(command: String) {
        val action = when (command) {
            "start" -> Constants.ACTION_START
            "stop" -> Constants.ACTION_STOP
            "restart" -> Constants.ACTION_RESTART
            else -> { logger.warn("Control", "Unknown command: $command"); return }
        }
        // Let the current API response finish before stopping its listener.
        Thread {
            Thread.sleep(250)
            runCatching {
                val intent = android.content.Intent(appContext, com.localhub.localhub.service.LocalHubService::class.java).setAction(action)
                if (action == Constants.ACTION_STOP) appContext.startService(intent)
                else androidx.core.content.ContextCompat.startForegroundService(appContext, intent)
            }.onFailure { serverError.value = it.message; logger.error("Control", "Command failed: ${it.message}") }
        }.start()
    }

    suspend fun startManagedServer(): Boolean {
        if (isServerRunning.value) return true
        awaitModulesRestored()
        val port = currentPort()
        return withContext(Dispatchers.IO) {
            server = buildServer(port) // rebuild transport/port after stopped-setting edits
            val started = server.startServer()
            isServerRunning.value = started
            serverError.value = if (started) null else server.lastError
            started
        }
    }

    /** Recreate the server on a new port (used after the user changes it). */
    suspend fun restartServer(port: Int) {
        require(port in 1024..65535)
        withContext(Dispatchers.IO) {
            val wasRunning = isServerRunning.value
            if (wasRunning) server.stopServer()
            server = buildServer(port)
            isServerRunning.value = if (wasRunning) server.startServer() else false
            if (wasRunning) serverError.value = if (isServerRunning.value) null else server.lastError
        }
    }

    init {
        // /proc and /sys reads plus DataStore belong off the main thread.
        // Application construction must NOT silently open a network listener:
        // explicit Start or the boot receiver owns that lifecycle.
        containerScope.launch {
            runCatching { systemInfoProvider.collectSnapshot() }
            runCatching { logger.auditEnabled = preferencesManager.getAuditEnabled() }
        }
    }
}
