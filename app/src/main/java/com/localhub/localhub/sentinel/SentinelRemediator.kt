package com.localhub.localhub.sentinel

import com.localhub.localhub.data.datastore.PreferencesManager
import com.localhub.localhub.data.local.AppDatabase
import com.localhub.localhub.sentinel.SentinelModels.Risk
import com.localhub.localhub.server.ClientTracker
import com.localhub.localhub.server.SessionManager
import com.localhub.localhub.system.CrashReportStore
import com.localhub.localhub.util.AppLogger
import kotlinx.coroutines.runBlocking

/**
 * Sentinel's hands.
 *
 * The risk class lives in the registry, not in the request. A caller cannot
 * downgrade an action by asking nicely: `block-ip` needs approval whether it
 * arrives from the dashboard, from the service watchdog, or from the assistant.
 * That is the whole security model of automatic repair - the engine may only
 * ever do the things on the SAFE list, everything else is a proposal.
 *
 * Every action is idempotent. Running one twice must leave the same state,
 * because the watchdog and the console can both fire for the same fault.
 */
class SentinelRemediator(
    private val sessionManager: SessionManager,
    private val clientTracker: ClientTracker,
    private val preferencesManager: PreferencesManager,
    private val crashStoreProvider: () -> CrashReportStore?,
    private val databaseProvider: () -> AppDatabase,
    private val control: Control,
    private val logger: AppLogger
) {

    /** Only the container may rebuild or restart the server; it owns the lifecycle. */
    interface Control {
        suspend fun restartListener(): Boolean
        suspend fun restartService(): Boolean
        suspend fun changePort(port: Int): Boolean
    }

    private class Spec(val risk: Risk, val run: suspend (Map<String, String>) -> Pair<Boolean, String>)

    private val registry: Map<String, Spec> = mapOf(
        "restart-listener" to Spec(Risk.SAFE) run@{
            val ok = control.restartListener()
            ok to if (ok) "Listener rebound and is accepting connections again"
            else "The listener could not be restarted"
        },

        "prune-sessions" to Spec(Risk.SAFE) run@{
            val n = sessionManager.pruneExpired()
            true to "$n expired session(s) released"
        },

        "clear-lockouts" to Spec(Risk.SAFE) run@{
            val before = sessionManager.lockedOutIps().size
            sessionManager.clearAllLockouts()
            logger.warn("AUDIT", "Sentinel cleared $before login lockout(s)")
            true to "$before lockout(s) cleared"
        },

        "trim-memory" to Spec(Risk.SAFE) run@{
            // Ask only; the runtime decides. Killing the server would not be a fix.
            System.gc()
            true to "Caches released and a collection requested"
        },

        "block-ip" to Spec(Risk.CONFIRM) run@{ args ->
            val ip = args["ip"].orEmpty()
            if (ip.isBlank()) return@run false to "No address given"
            if (ip == "127.0.0.1" || ip == "::1") return@run false to "Refusing to block loopback"
            clientTracker.block(ip)
            logger.warn("AUDIT", "Sentinel blocked $ip at administrator direction")
            true to "$ip is now blocked"
        },

        "change-port" to Spec(Risk.CONFIRM) run@{ args ->
            val port = args["port"]?.toIntOrNull()
                ?: return@run false to "No valid port given"
            if (port !in 1024..65535) return@run false to "Port must be 1024-65535"
            val ok = control.changePort(port)
            ok to if (ok) "Server moved to port $port" else "The server could not be moved to port $port"
        },

        "restart-service" to Spec(Risk.CONFIRM) run@{
            val ok = control.restartService()
            ok to if (ok) "Server service restarted" else "The service could not be restarted"
        },

        "invalidate-sessions" to Spec(Risk.CONFIRM) run@{
            val n = sessionManager.count()
            sessionManager.revokeAll()
            logger.warn("AUDIT", "Sentinel invalidated all $n session(s)")
            true to "$n session(s) signed out"
        },

        "clear-crash-history" to Spec(Risk.CONFIRM) run@{
            val store = crashStoreProvider()
                ?: return@run false to "No crash store available"
            store.clearCrashes()
            store.setSafeMode(false)
            true to "Crash history cleared and safe mode released"
        },

        "reset-database" to Spec(Risk.CONFIRM) run@{
            runCatching {
                val db = databaseProvider().openHelper.writableDatabase
                val tables = mutableListOf<String>()
                val c = db.query(
                    "SELECT name FROM sqlite_master WHERE type='table' " +
                        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%'"
                )
                try {
                    while (c.moveToNext()) tables += c.getString(0)
                } finally {
                    c.close()
                }
                db.execSQL("PRAGMA foreign_keys=OFF")
                tables.forEach { db.execSQL("DELETE FROM $it") }
                db.execSQL("PRAGMA foreign_keys=ON")
                logger.warn("AUDIT", "Sentinel reset ${tables.size} local table(s)")
                true to "Local database reset: ${tables.size} table(s) cleared (logs, statistics, saved settings)"
            }.getOrDefault(false to "The database could not be reset")
        },

        "disable-https" to Spec(Risk.CONFIRM) run@{
            preferencesManager.setHttpsEnabled(false)
            val ok = control.restartService()
            ok to if (ok) "HTTPS turned off and the server restarted on plain HTTP"
            else "HTTPS turned off, but the server did not restart"
        }
    )

    /**
     * Runs [action]. Returns success plus a human-readable result.
     *
     * @param approved true only when an administrator explicitly authorised a
     *                 CONFIRM-class action; ignored for SAFE actions.
     */
    suspend fun execute(action: String, args: Map<String, String>, approved: Boolean): Pair<Boolean, String> {
        val spec = registry[action]
            ?: return false to "Unknown action '$action'"
        return when (spec.risk) {
            Risk.MANUAL -> false to "This step has to be carried out by a person"
            Risk.CONFIRM -> if (!approved) {
                false to "Needs administrator approval"
            } else {
                runSafely(action, spec, args)
            }
            Risk.SAFE -> runSafely(action, spec, args)
        }
    }

    private suspend fun runSafely(action: String, spec: Spec, args: Map<String, String>): Pair<Boolean, String> =
        try {
            spec.run(args)
        } catch (t: Throwable) {
            logger.error(TAG, "Remediation '$action' failed: ${t.message}")
            false to "Action failed: ${t.message ?: t.javaClass.simpleName}"
        }

    /** Risk class of an action, so the engine can refuse before calling. */
    fun riskOf(action: String): Risk? = registry[action]?.risk

    fun knownActions(): Set<String> = registry.keys

    private val TAG = "Sentinel"

    companion object {
        /** Convenience for call sites outside a coroutine (the HTTP handler). */
        fun executeBlocking(
            remediator: SentinelRemediator,
            action: String,
            args: Map<String, String>,
            approved: Boolean
        ): Pair<Boolean, String> = runBlocking { remediator.execute(action, args, approved) }
    }
}
