package com.localhub.localhub.system

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File
import java.io.IOException
import java.util.Locale

data class HealthState(
    val crashes: List<CrashEntry> = emptyList(),
    val safeMode: Boolean = false,
    val lowMemoryEvents: Int = 0,
    val recoveries: Int = 0
) {
    val lastCrash: CrashEntry? get() = crashes.lastOrNull()
    fun crashesSince(now: Long, windowMs: Long = CrashPolicy.SUMMARY_WINDOW_MS): Int =
        CrashPolicy.recentCount(crashes.map { it.timestamp }, now, windowMs)
}

/**
 * Synchronous JSON store. Crash handling runs while the process is dying, so
 * writes must be blocking and must never depend on Room/coroutines.
 */
class CrashReportStore(
    private val file: File,
    private val gson: Gson = Gson(),
    private val maxEntries: Int = 10
) {
    @Synchronized
    fun read(): HealthState = runCatching {
        if (!file.exists()) return HealthState()
        val text = file.readText()
        if (text.isBlank()) return HealthState()
        val type = object : TypeToken<Map<String, Any>>() {}.type
        @Suppress("UNCHECKED_CAST")
        val map = gson.fromJson(text, type) as? Map<String, Any> ?: return HealthState()
        val crashes = gson.fromJson<List<CrashEntry>>(
            gson.toJson(map["crashes"] ?: emptyList<CrashEntry>()),
            object : TypeToken<List<CrashEntry>>() {}.type
        ).orEmpty()
        HealthState(
            crashes = crashes.takeLast(maxEntries),
            safeMode = (map["safeMode"] as? Boolean) ?: false,
            lowMemoryEvents = ((map["lowMemoryEvents"] as? Number)?.toInt() ?: 0).coerceAtLeast(0),
            recoveries = ((map["recoveries"] as? Number)?.toInt() ?: 0).coerceAtLeast(0)
        )
    }.getOrDefault(HealthState())

    @Synchronized
    fun record(entry: CrashEntry, now: Long = entry.timestamp): HealthState {
        val current = read()
        val updated = current.copy(
            crashes = CrashPolicy.pruned(current.crashes.map { it.timestamp } + entry.timestamp, now)
                .map { timestamp -> current.crashes.firstOrNull { it.timestamp == timestamp } ?: entry }
        )
        return write(updated)
    }

    @Synchronized
    fun setSafeMode(enabled: Boolean): HealthState = write(read().copy(safeMode = enabled))

    @Synchronized
    fun noteLowMemory(): HealthState = write(read().copy(lowMemoryEvents = read().lowMemoryEvents + 1))

    @Synchronized
    fun noteRecovery(): HealthState = write(read().copy(recoveries = read().recoveries + 1))

    @Synchronized
    fun clear(): HealthState = write(HealthState())

    @Synchronized
    fun clearCrashes(): HealthState = write(read().copy(crashes = emptyList()))

    /** Human-readable summary used by the UI and the admin health endpoint. */
    fun describe(state: HealthState, now: Long): String {
        val last = state.lastCrash
        val lastText = if (last == null) "No crashes recorded."
        else "Last: ${last.summary} (${formatWhen(now - last.timestamp)} ago, thread ${last.thread})."
        val count = state.crashesSince(now)
        return "$lastText Crashes in last 24h: $count. Safe mode: ${if (state.safeMode) "on" else "off"}. Low-memory events: ${state.lowMemoryEvents}."
    }

    private fun formatWhen(deltaMs: Long): String {
        val minutes = (deltaMs / 60_000L).coerceAtLeast(0)
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min"
            else -> String.format(Locale.US, "%.1f h", minutes / 60.0)
        }
    }

    private fun write(state: HealthState): HealthState {
        val parent = file.parentFile
        if (parent != null && !parent.exists() && !parent.mkdirs()) return state
        return try {
            val tmp = File(parent, file.name + ".tmp")
            tmp.writeText(gson.toJson(state))
            if (tmp.exists() && tmp.length() > 0) {
                if (file.exists()) file.delete()
                if (!tmp.renameTo(file)) tmp.copyTo(file, overwrite = true)
                tmp.delete()
            }
            state
        } catch (e: IOException) {
            state
        } catch (e: SecurityException) {
            state
        }
    }
}
