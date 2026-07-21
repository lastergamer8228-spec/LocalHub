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

/**
 * Central logger that writes to Logcat, persists to Room, and exposes a hot
 * [SharedFlow] so the UI and the WebSocket hub can react to new entries in realtime.
 */
class AppLogger(private val logRepository: LogRepository) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _logs = MutableSharedFlow<LogEntry>(
        replay = 64,
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val logs: SharedFlow<LogEntry> = _logs.asSharedFlow()

    suspend fun log(level: LogLevel, tag: String, message: String) {
        val entry = LogEntry(
            timestamp = System.currentTimeMillis(),
            level = level,
            tag = tag,
            message = message
        )
        runCatching { logRepository.insert(entry) }
        _logs.tryEmit(entry)
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
