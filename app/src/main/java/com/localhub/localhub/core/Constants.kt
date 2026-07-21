package com.localhub.localhub.core

/**
 * Global constants for the LocalHub application.
 */
object Constants {
    const val SERVER_VERSION = "1.0.0"
    const val DEFAULT_PORT = 8080
    const val WS_PATH = "/ws"

    const val NOTIFICATION_ID = 1001

    const val ACTION_START = "com.localhub.localhub.action.START"
    const val ACTION_STOP = "com.localhub.localhub.action.STOP"

    const val ACTION_APPLY_PORT = "com.localhub.localhub.action.APPLY_PORT"
    const val ACTION_SAVE_NAME = "com.localhub.localhub.action.SAVE_NAME"
    const val ACTION_CLEAR_LOGS = "com.localhub.localhub.action.CLEAR_LOGS"

    const val EXTRA_PORT = "extra_port"
    const val EXTRA_NAME = "extra_name"

    /** How often (ms) the foreground service pushes a fresh system snapshot. */
    const val STATS_INTERVAL_MS = 2000L

    /** After this many ms an HTTP client entry is pruned from the clients list. */
    const val HTTP_CLIENT_TTL_MS = 60_000L

    const val LOG_RETENTION_DAYS = 7L
}
