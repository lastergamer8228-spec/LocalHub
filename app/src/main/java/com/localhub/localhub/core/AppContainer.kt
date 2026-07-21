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
import com.localhub.localhub.module.DashboardModule
import com.localhub.localhub.module.ModuleManager
import com.localhub.localhub.server.ClientTracker
import com.localhub.localhub.server.LocalHubServer
import com.localhub.localhub.system.SystemInfoProvider
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
    val moduleManager = ModuleManager().apply { register(DashboardModule()) }

    /** Shared so client state survives server restarts (e.g. port change). */
    val clientTracker = ClientTracker()

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
        moduleManager = moduleManager,
        logger = logger,
        preferencesManager = preferencesManager,
        statisticsRepository = statisticsRepository,
        logRepository = logRepository,
        gson = gson,
        clientTracker = clientTracker,
        reportStatus = { _serverStatus.value = it },
        port = port
    )

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
