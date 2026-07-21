package com.localhub.localhub.ui.viewmodel

import android.app.Application
import androidx.lifecycle.viewModelScope
import com.localhub.localhub.model.LogEntry
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class LogsViewModel(app: Application) : LocalHubViewModel(app) {
    val logs: StateFlow<List<LogEntry>> = container.logRepository.all()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun clear() {
        viewModelScope.launch { container.logRepository.clear() }
    }
}
