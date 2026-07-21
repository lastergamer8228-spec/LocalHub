package com.localhub.localhub.server

import com.localhub.localhub.core.Constants
import com.localhub.localhub.model.ConnectedClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap

/**
 * Maintains the live list of connected / recently-seen clients. WebSocket
 * clients persist until disconnect; HTTP clients are tracked by IP+UA and pruned
 * after [Constants.HTTP_CLIENT_TTL_MS].
 */
class ClientTracker {

    private val clientMap = ConcurrentHashMap<String, ConnectedClient>()
    private val _clients = MutableStateFlow<List<ConnectedClient>>(emptyList())
    val clients: StateFlow<List<ConnectedClient>> = _clients.asStateFlow()

    fun add(client: ConnectedClient) {
        clientMap[client.id] = client
        publish()
    }

    fun updateActivity(id: String) {
        val current = clientMap[id] ?: return
        clientMap[id] = current.copy(lastActivity = System.currentTimeMillis())
        publish()
    }

    fun remove(id: String) {
        if (clientMap.remove(id) != null) publish()
    }

    fun httpHit(ip: String, userAgent: String) {
        val key = "http:${ip}:${userAgent.hashCode()}"
        val now = System.currentTimeMillis()
        val existing = clientMap[key]
        if (existing != null) {
            clientMap[key] = existing.copy(lastActivity = now)
        } else {
            clientMap[key] = ConnectedClient(
                id = key,
                ip = ip,
                userAgent = userAgent,
                connectedAt = now,
                lastActivity = now,
                protocol = "HTTP"
            )
        }
        publish()
    }

    fun prune() {
        val now = System.currentTimeMillis()
        val iterator = clientMap.entries.iterator()
        while (iterator.hasNext()) {
            val (key, value) = iterator.next()
            if (value.protocol == "HTTP" && now - value.lastActivity > Constants.HTTP_CLIENT_TTL_MS) {
                iterator.remove()
            }
        }
        publish()
    }

    private fun publish() {
        _clients.value = clientMap.values.sortedByDescending { it.lastActivity }
    }
}
