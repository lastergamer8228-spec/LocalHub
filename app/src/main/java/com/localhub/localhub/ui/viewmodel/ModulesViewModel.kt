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

    fun toggle(module: ModuleInfo) {
        viewModelScope.launch {
            container.moduleManager.setEnabled(module.id, !module.enabled)
            // Persist the new enabled state (and keep all metadata) back to Room.
            val updated = module.copy(enabled = !module.enabled)
            container.moduleRepository.upsert(updated)
        }
    }
}
