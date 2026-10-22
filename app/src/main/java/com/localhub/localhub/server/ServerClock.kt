package com.localhub.localhub.server

/**
 * Tracks when the embedded HTTP server was last started so the dashboard can
 * report real uptime and session info. Populated by [LocalHubServer] on start
 * and read by the REST API ([ApiRouter]).
 */
object ServerClock {
    @Volatile
    var startedAt: Long = 0L
        private set

    @Volatile
    var restartCount: Int = 0
        private set

    /** Call when the server starts successfully. */
    fun markStart() {
        startedAt = System.currentTimeMillis()
        restartCount++
    }

    /** Call when the server stops. */
    fun reset() {
        startedAt = 0L
    }

    fun currentUptimeMs(): Long =
        if (startedAt > 0) System.currentTimeMillis() - startedAt else 0L
}
