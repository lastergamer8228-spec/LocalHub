package com.localhub.localhub.model

/** A client currently (or recently) connected to the server. */
data class ConnectedClient(
    val id: String,
    val ip: String,
    val userAgent: String,
    val connectedAt: Long,
    val lastActivity: Long,
    val protocol: String // "WebSocket" or "HTTP"
)
