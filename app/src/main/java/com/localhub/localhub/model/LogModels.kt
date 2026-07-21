package com.localhub.localhub.model

/** Severity levels supported by the logging subsystem. */
enum class LogLevel {
    DEBUG,
    INFO,
    WARNING,
    ERROR
}

/** A single log record. */
data class LogEntry(
    val id: Long = 0,
    val timestamp: Long,
    val level: LogLevel,
    val tag: String,
    val message: String
)
