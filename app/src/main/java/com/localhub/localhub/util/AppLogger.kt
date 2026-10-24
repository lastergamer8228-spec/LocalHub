package com.localhub.localhub.util

import android.util.Log
import com.localhub.localhub.data.repository.LogRepository
import com.localhub.localhub.model.LogEntry
import com.localhub.localhub.model.LogLevel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicLong

/**
 * Central logger that writes to Logcat, persists to Room, and exposes a hot
 * [SharedFlow] so the UI and the WebSocket hub can react to new entries in realtime.
 */
class AppLogger(private val logRepository: LogRepository) {

    private companion object {
        // Far above any plausible Room row id, so fallback ids can never collide
        // with ids that came from the database in the same process.
        const val FALLBACK_ID_BASE = 1_000_000_000_000L
    }

    @Volatile var auditEnabled = true

    /**
     * Every entry that goes to the UI must carry a UNIQUE id.
     *
     * Entries are created in memory before Room assigns a row id, so they all
     * start at the default 0 - and a list keyed on `it.id` then produces two
     * rows with the key "0", which crashes LazyColumn with
     * "Key \"0\" was already used". We take Room's row id when it is available
     * and fall back to a process-wide counter when the database is unavailable.
     */
    private val fallbackIds = AtomicLong(FALLBACK_ID_BASE)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _logs = MutableSharedFlow<LogEntry>(
        replay = 64,
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val logs: SharedFlow<LogEntry> = _logs.asSharedFlow()

    suspend fun log(level: LogLevel, tag: String, message: String) {
        if (tag == "AUDIT" && !auditEnabled) return
        val entry = LogEntry(
            timestamp = System.currentTimeMillis(),
            level = level,
            tag = tag,
            message = message
        )
        val rowId = runCatching { logRepository.insert(entry) }.getOrDefault(0L)
        val uniqueId = if (rowId > 0L) rowId else fallbackIds.incrementAndGet()
        _logs.tryEmit(entry.copy(id = uniqueId))
        when (level) {
            LogLevel.DEBUG -> Log.d(tag, message)
            LogLevel.INFO -> Log.i(tag, message)
            LogLevel.WARNING -> Log.w(tag, message)
            LogLevel.ERROR -> Log.e(tag, message)
        }
    }

    /** Fire-and-forget variant for use from non-suspend contexts (threads, callbacks). */
    fun logAsync(level: LogLevel, tag: String, message: String) {
        scope.launch { log(level, tag, message) }
    }

    fun debug(tag: String, message: String) = logAsync(LogLevel.DEBUG, tag, message)
    fun info(tag: String, message: String) = logAsync(LogLevel.INFO, tag, message)
    fun warn(tag: String, message: String) = logAsync(LogLevel.WARNING, tag, message)
    fun error(tag: String, message: String) = logAsync(LogLevel.ERROR, tag, message)
}
