package com.localhub.localhub.ui.viewmodel

import android.app.Application
import com.localhub.localhub.model.ConnectedClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Client management. The native controller shares the process with the server,
 * so policies are applied through the same tracker the API uses — no HTTP call,
 * no duplicated rules.
 */
class ClientsViewModel(app: Application) : LocalHubViewModel(app) {

    val clients: StateFlow<List<ConnectedClient>> = container.connectedClients
    val blocked: StateFlow<Set<String>> = container.clientTracker.blockedFlow
    val restrictions: StateFlow<Map<String, String>> = container.clientTracker.restrictionsFlow

    private val _feedback = MutableStateFlow<String?>(null)
    val feedback: StateFlow<String?> = _feedback

    fun block(ip: String) {
        if (ip.isBlank()) return
        container.clientTracker.block(ip)
        _feedback.value = "$ip is blocked from LocalHub."
    }

    fun unblock(ip: String) {
        if (ip.isBlank()) return
        container.clientTracker.unblock(ip)
        _feedback.value = "$ip can reach LocalHub again."
    }

    fun restrict(ip: String, mode: String) {
        if (ip.isBlank()) return
        val allowed = setOf("none", "RO", "deny")
        require(mode in allowed) { "Unknown file-access mode" }
        container.clientTracker.setRestriction(ip, mode)
        _feedback.value = when (mode) {
            "RO" -> "$ip is limited to read-only file access."
            "deny" -> "$ip cannot access files."
            else -> "File-access restriction removed for $ip."
        }
    }

    fun clearFeedback() { _feedback.value = null }
}
