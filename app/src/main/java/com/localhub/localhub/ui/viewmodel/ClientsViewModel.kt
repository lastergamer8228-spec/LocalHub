package com.localhub.localhub.ui.viewmodel

import android.app.Application
import com.localhub.localhub.model.ConnectedClient
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ClientsViewModel(app: Application) : LocalHubViewModel(app) {
    val clients: StateFlow<List<ConnectedClient>> = container.connectedClients
}
