package com.localhub.localhub.ui.viewmodel

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.localhub.localhub.core.Constants
import com.localhub.localhub.model.SystemInfo
import com.localhub.localhub.service.LocalHubService
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
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

    val httpsEnabled: StateFlow<Boolean> = container.preferencesManager.httpsEnabledFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val auditEnabled: StateFlow<Boolean> = container.preferencesManager.auditEnabledFlow
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)

    /** Live device/system snapshot (refreshed by the foreground service every ~2s). */
    val systemInfo: StateFlow<SystemInfo?> = container.systemInfoProvider.lastSnapshot

    /** Live connected-client count. */
    val connectedClients: StateFlow<Int> = container.connectedClients
        .map { it.size }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    /** Sends a restart via the same-port apply action (recreates the server). */
    fun restartServer() {
        val p = container.serverStatus.value.port
        applyPort(if (p in 1024..65535) p else Constants.DEFAULT_PORT)
    }

    fun openBrowser(url: String) {
        runCatching {
            ctx.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    /** The advertised friendly hostname (localhub.local by default). */
    fun friendlyHostname(): String {
        val name = serverName.value
        val n = name.trim().lowercase().replace(Regex("[^a-z0-9-]"), "-").trim('-')
        return (if (n.isEmpty()) "localhub" else n) + ".local"
    }

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

    fun setHttpsEnabled(enabled: Boolean) {
        viewModelScope.launch {
            container.preferencesManager.setHttpsEnabled(enabled)
            // Restart the server so the TLS setting takes effect.
            restartServer()
        }
    }

    fun setAuditEnabled(enabled: Boolean) {
        viewModelScope.launch { container.preferencesManager.setAuditEnabled(enabled) }
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