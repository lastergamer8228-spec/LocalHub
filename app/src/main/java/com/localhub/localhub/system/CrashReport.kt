package com.localhub.localhub.system

/** Pure crash formatting/serialization helpers (no Android APIs). */
data class CrashEntry(
    val timestamp: Long,
    val thread: String,
    val summary: String,
    val stack: String,
    val screen: String? = null
)

object CrashReport {
    private const val MAX_STACK = 2000
    private const val MAX_SUMMARY = 200

    fun summaryOf(throwable: Throwable): String {
        val name = throwable.javaClass.simpleName
        val message = throwable.message?.take(MAX_SUMMARY)?.replace('\n', ' ') ?: ""
        return if (message.isBlank()) name else "$name: $message"
    }

    /** Truncated so a pathological stack cannot bloat storage or the UI. */
    fun stackOf(throwable: Throwable, maxLength: Int = MAX_STACK): String {
        val text = runCatching {
            val writer = java.io.StringWriter()
            throwable.printStackTrace(java.io.PrintWriter(writer))
            writer.toString()
        }.getOrDefault(throwable.toString())
        return if (text.length <= maxLength) text else text.take(maxLength) + "\n…truncated"
    }

    fun create(thread: String, throwable: Throwable, now: Long, screen: String? = null): CrashEntry =
        CrashEntry(
            timestamp = now,
            thread = thread.take(64),
            summary = summaryOf(throwable),
            stack = stackOf(throwable),
            screen = screen?.take(64)
        )
}
