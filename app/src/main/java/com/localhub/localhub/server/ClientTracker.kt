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
 *
 * Also manages **device policy**: a set of blocked IPs and a map of per-IP file
 * access restrictions. These are enforced server-side by [LocalHubServer] /
 * [ApiRouter], NOT just hidden in the UI.
 */
class ClientTracker {

    private val clientMap = ConcurrentHashMap<String, ConnectedClient>()
    private val _clients = MutableStateFlow<List<ConnectedClient>>(emptyList())
    val clients: StateFlow<List<ConnectedClient>> = _clients.asStateFlow()

    /** IPs that are blocked entirely from the server. */
    private val blockedIps = ConcurrentHashMap.newKeySet<String>()
    private val _blocked = MutableStateFlow<Set<String>>(emptySet())
    val blockedFlow: StateFlow<Set<String>> = _blocked.asStateFlow()
    private val _restrictions = MutableStateFlow<Map<String, String>>(emptyMap())
    val restrictionsFlow: StateFlow<Map<String, String>> = _restrictions.asStateFlow()

    /**
     * Per-IP file access restrictions. Values:
     *   ""      -> no restriction (read allowed)
     *   "RO"    -> read-only (no mutations), for a specific device
     *   "deny"  -> full file access denied (but dashboard/status allowed)
     */
    private val ipRestrictions = ConcurrentHashMap<String, String>()

    fun isBlocked(ip: String): Boolean = blockedIps.contains(ip)

    fun block(ip: String) { blockedIps.add(ip); _blocked.value = blockedIps.toSet() }

    fun unblock(ip: String) { blockedIps.remove(ip); _blocked.value = blockedIps.toSet() }

    fun blockedList(): List<String> = blockedIps.sorted()

    fun setRestriction(ip: String, restriction: String) {
        if (restriction.isBlank() || restriction == "none") ipRestrictions.remove(ip)
        else ipRestrictions[ip] = restriction
        _restrictions.value = ipRestrictions.toMap()
    }

    /** "" = none, "RO" = read-only, "deny" = no file access. */
    fun restriction(ip: String): String = ipRestrictions[ip] ?: ""

    fun restrictions(): Map<String, String> = ipRestrictions.toMap()

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
