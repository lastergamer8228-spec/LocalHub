package com.localhub.localhub.server

import com.localhub.localhub.model.ConnectedClient
import com.localhub.localhub.util.AppLogger
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.UUID

/**
 * A single WebSocket connection. Reports connect/disconnect to the
 * [ClientTracker] and relays incoming text frames back to the client.
 */
class LocalHubWebSocket(
    handshake: NanoHTTPD.IHTTPSession,
    private val hub: WebSocketHub,
    private val clientTracker: ClientTracker,
    private val logger: AppLogger,
    val isAdmin: Boolean = false,
    private val allowed: () -> Boolean = { true }
) : NanoWSD.WebSocket(handshake) {

    private val clientId = UUID.randomUUID().toString()
    private val ip: String = runCatching { handshake.remoteIpAddress }.getOrDefault("unknown")
    private val userAgent: String = handshake.headers["user-agent"] ?: "Unknown"
    private var registered = false

    override fun onOpen() {
        hub.register(this)
        clientTracker.add(
            ConnectedClient(
                id = clientId,
                ip = ip,
                userAgent = userAgent,
                connectedAt = System.currentTimeMillis(),
                lastActivity = System.currentTimeMillis(),
                protocol = "WebSocket"
            )
        )
        registered = true
        logger.info(TAG, "WebSocket client connected: $ip ($userAgent)")
        sendSafe("""{"type":"welcome","clientId":"$clientId"}""")
    }

    override fun onClose(
        code: NanoWSD.WebSocketFrame.CloseCode?,
        reason: String?,
        initiatedByRemote: Boolean
    ) {
        detach()
        logger.info(TAG, "WebSocket client disconnected: $ip (${reason ?: "n/a"})")
    }

    override fun onMessage(message: NanoWSD.WebSocketFrame?) {
        clientTracker.updateActivity(clientId)
        val text = message?.textPayload ?: return
        runCatching {
            when {
                text.equals("ping", ignoreCase = true) ->
                    sendSafe("""{"type":"pong","ts":${System.currentTimeMillis()}}""")
                text.trim().startsWith("{") ->
                    sendSafe("""{"type":"ack","echo":${escape(text)}}""")
                else ->
                    sendSafe("""{"type":"ack","message":${escape(text)}}""")
            }
        }
    }

    override fun onPong(pong: NanoWSD.WebSocketFrame?) {}

    override fun onException(exception: IOException?) {
        logger.error(TAG, "WebSocket exception for $ip: ${exception?.message}")
        detach()
    }

    private fun detach() {
        if (registered) {
            hub.unregister(this)
            clientTracker.remove(clientId)
            registered = false
        }
    }

    fun sendSafe(json: String) {
        if (!allowed()) {
            runCatching { close(NanoWSD.WebSocketFrame.CloseCode.PolicyViolation, "Session expired or device blocked", false) }
            detach()
            return
        }
        try {
            send(json)
        } catch (e: IOException) {
            logger.error(TAG, "send failed to $ip: ${e.message}")
        }
    }

    private fun escape(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\""

    companion object {
        private const val TAG = "LocalHubWebSocket"
    }
}
