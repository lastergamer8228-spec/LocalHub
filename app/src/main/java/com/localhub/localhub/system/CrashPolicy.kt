package com.localhub.localhub.system

/**
 * Pure recovery rules. No Android APIs, so crash-loop/safe-mode decisions are
 * unit-testable. This does not promise a crash-free app: an uncaught throwable
 * means the process is already dying. These rules bound the recovery so a
 * repeated failure degrades to safe mode instead of an endless restart loop.
 */
object CrashPolicy {
    /** Crashes within this window that trigger safe mode. */
    const val SAFE_MODE_THRESHOLD = 3
    const val CRASH_WINDOW_MS = 2 * 60_000L
    const val SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000L

    fun recentCount(timestamps: List<Long>, now: Long, windowMs: Long = SUMMARY_WINDOW_MS): Int =
        timestamps.count { it in (now - windowMs + 1)..now }

    /** True when crashes cluster tightly enough to suspect a startup loop. */
    fun shouldEnterSafeMode(timestamps: List<Long>, now: Long): Boolean =
        recentCount(timestamps, now, CRASH_WINDOW_MS) >= SAFE_MODE_THRESHOLD

    /**
     * Restart only while recovery looks plausible. Once safe mode is warranted we
     * stop restarting so the device is not trapped in a boot/crash cycle.
     */
    fun shouldAutoRestart(timestamps: List<Long>, now: Long, safeMode: Boolean): Boolean {
        if (safeMode) return false
        return recentCount(timestamps, now, CRASH_WINDOW_MS) < SAFE_MODE_THRESHOLD
    }

    fun pruned(timestamps: List<Long>, now: Long, keepMs: Long = SUMMARY_WINDOW_MS, max: Int = 20): List<Long> =
        timestamps.filter { it in (now - keepMs)..now }.takeLast(max)
}
