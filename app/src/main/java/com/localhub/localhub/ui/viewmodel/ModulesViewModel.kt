package com.localhub.localhub.ui.viewmodel

import android.app.Application
import androidx.lifecycle.viewModelScope
import com.localhub.localhub.model.ModuleInfo
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ModulesViewModel(app: Application) : LocalHubViewModel(app) {
    val modules: StateFlow<List<ModuleInfo>> = container.moduleRepository.observe()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val error = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)

    fun clearError() { error.value = null }

    fun toggle(module: ModuleInfo) {
        viewModelScope.launch {
            runCatching { container.toggleModule(module.id) }
                .onSuccess { error.value = null }
                .onFailure { error.value = it.message ?: "Could not change module state" }
        }
    }
}
