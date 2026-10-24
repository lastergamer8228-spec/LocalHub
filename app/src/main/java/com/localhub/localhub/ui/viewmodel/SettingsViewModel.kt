package com.localhub.localhub.ui.viewmodel

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.localhub.localhub.core.Constants
import com.localhub.localhub.model.SystemInfo
import com.localhub.localhub.service.LocalHubService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsViewModel(app: Application) : LocalHubViewModel(app) {
    private val ctx = getApplication<Application>().applicationContext
    val running = container.isServerRunning
    val serverStatus = container.serverStatus
    val serverError = container.serverError
    val feedback = MutableStateFlow<String?>(null)
    private val busy = MutableStateFlow(false)
    val working: StateFlow<Boolean> = busy
    val port = container.preferencesManager.portFlow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), Constants.DEFAULT_PORT)
    val theme = container.preferencesManager.themeFlow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "dark")
    val autostart = container.preferencesManager.autostartFlow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)
    val serverName = container.preferencesManager.serverNameFlow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "LocalHub")
    val httpsEnabled = container.preferencesManager.httpsEnabledFlow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)
    val auditEnabled = container.preferencesManager.auditEnabledFlow.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), true)
    val systemInfo: StateFlow<SystemInfo?> = container.systemInfoProvider.lastSnapshot
    val connectedClients = container.connectedClients.map { it.size }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    private fun task(block: suspend () -> String) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try { feedback.value = block() }
            catch (e: Exception) { feedback.value = e.message ?: "Action failed" }
            finally { busy.value = false }
        }
    }
    private fun command(action: String) {
        runCatching {
            val intent = Intent(ctx, LocalHubService::class.java).setAction(action)
            if (action == Constants.ACTION_START || action == Constants.ACTION_RESTART) androidx.core.content.ContextCompat.startForegroundService(ctx, intent)
            else ctx.startService(intent)
            feedback.value = "Request sent. Watch the live server status for the result."
        }.onFailure { feedback.value = it.message ?: "Could not send server command" }
    }
    fun startServer() = command(Constants.ACTION_START)
    fun stopServer() = command(Constants.ACTION_STOP)
    fun restartServer() { if (running.value) command(Constants.ACTION_RESTART) else { feedback.value = "Server is stopped. Use Start." } }
    fun openBrowser(url: String) {
        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { feedback.value = "Could not open browser: ${it.message}" }
    }
    fun friendlyHostname() = "localhub.local"
    fun applyPort(newPort: Int) = task {
        require(newPort in 1024..65535) { "Port must be between 1024 and 65535." }
        container.preferencesManager.setPort(newPort)
        ctx.startService(Intent(ctx, LocalHubService::class.java).setAction(Constants.ACTION_APPLY_PORT).putExtra(Constants.EXTRA_PORT, newPort))
        "Port saved. If running, server will rebind; check live status."
    }
    fun setTheme(value: String) = task { container.preferencesManager.setTheme(value); "Theme saved." }
    fun setAutostart(value: Boolean) = task { container.preferencesManager.setAutostart(value); "Boot preference saved; Android battery/background restrictions still apply." }
    fun setHttpsEnabled(value: Boolean) = task {
        container.preferencesManager.setHttpsEnabled(value)
        if (running.value) command(Constants.ACTION_RESTART)
        "HTTPS preference saved. Browser links now use ${if(value) "https" else "http"}. Verify live status after restart."
    }
    fun setAuditEnabled(value: Boolean) = task {
        container.preferencesManager.setAuditEnabled(value)
        container.logger.auditEnabled = value
        "Security audit logging ${if(value) "enabled" else "disabled"}."
    }
    fun setServerName(value: String) = task {
        require(value.isNotBlank() && value.length <= 64) { "Use a server name between 1 and 64 characters." }
        container.preferencesManager.setServerName(value.trim())
        if (running.value) ctx.startService(Intent(ctx, LocalHubService::class.java).setAction(Constants.ACTION_SAVE_NAME).putExtra(Constants.EXTRA_NAME,value.trim()))
        "Display name saved. mDNS discovery is best-effort; the IP URL is the reliable fallback."
    }
    fun clearLogs() = task { container.logRepository.clear(); "Stored logs cleared. New activity may create new entries." }
    /** Settings backup contains non-secret preferences only (never passwords/TOTP). */
    suspend fun buildSettingsBackup(): String {
        val preferences = container.preferencesManager
        val values = mapOf(
            "port" to preferences.portFlow.first().toString(),
            "theme" to preferences.themeFlow.first(),
            "autostart" to preferences.autostartFlow.first().toString(),
            "serverName" to preferences.serverNameFlow.first()
        )
        return com.localhub.localhub.data.backup.BackupSerializer.exportSettings(values, System.currentTimeMillis())
    }

    suspend fun buildLogsBackup(): String {
        val logs = container.logRepository.all().first()
        return com.localhub.localhub.data.backup.BackupSerializer.exportLogs(logs, System.currentTimeMillis())
    }

    /** Restores only validated, non-secret settings; reports what was skipped. */
    suspend fun applySettingsBackup(json: String): String {
        val result = com.localhub.localhub.data.backup.BackupSerializer.parseSettings(json)
        if (result.error != null) return result.error
        if (result.values.isEmpty()) return "No usable settings found in that backup."
        val preferences = container.preferencesManager
        result.values["port"]?.toIntOrNull()?.let { preferences.setPort(it) }
        result.values["theme"]?.let { preferences.setTheme(it) }
        result.values["autostart"]?.let { preferences.setAutostart(it == "true") }
        result.values["serverName"]?.let { preferences.setServerName(it) }
        val restored = result.values.keys.sorted().joinToString(", ")
        val skipped = if (result.ignoredKeys.isEmpty()) "" else
            " Skipped ${result.ignoredKeys.distinct().size} unsupported key(s): ${result.ignoredKeys.distinct().joinToString(", ")}. Passwords and 2FA secrets are never restored."
        return "Restored: $restored.$skipped"
    }

    fun clearTemporaryCache() = task {
        check(!running.value) { "Stop the server before clearing temporary media cache." }
        withContext(Dispatchers.IO) {
            check(container.server.cancelMediaWork()) { "Audio conversion is still stopping. Try again shortly." }
            listOf("compatible-audio", "compatible-audio-v2", "tts").forEach { name ->
                val folder = java.io.File(ctx.cacheDir, name)
                check(!folder.exists() || folder.deleteRecursively()) { "Could not clear $name cache." }
            }
        }
        "Temporary media cache cleared. Your source files were not modified."
    }
}
