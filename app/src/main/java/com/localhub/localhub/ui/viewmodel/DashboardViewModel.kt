package com.localhub.localhub.ui.viewmodel

import android.app.Application
import androidx.lifecycle.viewModelScope
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.SystemInfo
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn

class DashboardViewModel(app: Application) : LocalHubViewModel(app) {
    val systemInfo: StateFlow<SystemInfo?> = container.systemInfoProvider.lastSnapshot
    val serverStatus: StateFlow<com.localhub.localhub.model.ServerStatus> = container.serverStatus
    val clients: StateFlow<List<com.localhub.localhub.model.ConnectedClient>> = container.connectedClients
    val logs: StateFlow<List<LogEntry>> = container.logger.logs
        .scan(emptyList<LogEntry>()) { acc, e -> (acc + e).takeLast(40) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
}
