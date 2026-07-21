package com.localhub.localhub.ui.viewmodel

import android.app.Application
import android.content.Intent
import androidx.lifecycle.viewModelScope
import com.localhub.localhub.core.Constants
import com.localhub.localhub.service.LocalHubService
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(app: Application) : LocalHubViewModel(app) {

    private val ctx = getApplication<Application>().applicationContext

    val running: StateFlow<Boolean> = container.isServerRunning
    val serverStatus: StateFlow<com.localhub.localhub.model.ServerStatus> = container.serverStatus

    val port: StateFlow<Int> = container.preferencesManager.portFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), Constants.DEFAULT_PORT)

    val theme: StateFlow<String> = container.preferencesManager.themeFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "dark")

    val autostart: StateFlow<Boolean> = container.preferencesManager.autostartFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val serverName: StateFlow<String> = container.preferencesManager.serverNameFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "LocalHub")

    fun startServer() {
        ctx.startForegroundService(
            Intent(ctx, LocalHubService::class.java).apply { action = Constants.ACTION_START }
        )
    }

    fun stopServer() {
        ctx.startService(
            Intent(ctx, LocalHubService::class.java).apply {
                action = Constants.ACTION_STOP
            }
        )
    }

    fun applyPort(newPort: Int) {
        viewModelScope.launch {
            runCatching {
                container.preferencesManager.setPort(newPort)
                ctx.startService(
                    Intent(ctx, LocalHubService::class.java).apply {
                        action = Constants.ACTION_APPLY_PORT
                        putExtra(Constants.EXTRA_PORT, newPort)
                    }
                )
            }.onFailure {
                container.logger.error("Settings", it.stackTraceToString())
            }
        }
    }

    fun setTheme(theme: String) {
        viewModelScope.launch { container.preferencesManager.setTheme(theme) }
    }

    fun setAutostart(enabled: Boolean) {
        viewModelScope.launch { container.preferencesManager.setAutostart(enabled) }
    }

    fun setServerName(name: String) {
        viewModelScope.launch {
            runCatching {
                ctx.startService(
                    Intent(ctx, LocalHubService::class.java).apply {
                        action = Constants.ACTION_SAVE_NAME
                        putExtra(Constants.EXTRA_NAME, name)
                    }
                )
            }.onFailure {
                container.logger.error("Settings", it.stackTraceToString())
            }
        }
    }

    fun clearLogs() {
        viewModelScope.launch {
            runCatching {
                ctx.startService(
                    Intent(ctx, LocalHubService::class.java).apply {
                        action = Constants.ACTION_CLEAR_LOGS
                    }
                )
            }.onFailure {
                container.logger.error("Settings", it.stackTraceToString())
            }
        }
    }
}