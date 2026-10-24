package com.localhub.localhub.server

import java.util.concurrent.CopyOnWriteArrayList

/**
 * Holds the set of open [LocalHubWebSocket] connections and fans out JSON
 * messages to all of them.
 */
class WebSocketHub {
    private val sockets = CopyOnWriteArrayList<LocalHubWebSocket>()

    fun register(ws: LocalHubWebSocket) {
        if (!sockets.contains(ws)) sockets.add(ws)
    }

    fun unregister(ws: LocalHubWebSocket) {
        sockets.remove(ws)
    }

    fun broadcast(json: String, adminOnly: Boolean = false) {
        for (ws in sockets) if (!adminOnly || ws.isAdmin) ws.sendSafe(json)
    }

    fun count(): Int = sockets.size
}
