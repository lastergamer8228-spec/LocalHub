package com.localhub.localhub.model

/** Live status of the embedded HTTP server. */
data class ServerStatus(
    val running: Boolean,
    val port: Int,
    val host: String,
    val version: String,
    val startedAt: Long,
    val uptimeMs: Long,
    val protocol: String = "http"
)

/** A compact, time-series-friendly system snapshot for Room persistence. */
data class StatisticsSnapshot(
    val timestamp: Long,
    val cpuUsage: Float,
    val memoryUsed: Long,
    val memoryTotal: Long,
    val batteryLevel: Int,
    val batteryTempC: Float,
    val storageUsed: Long,
    val storageTotal: Long,
    val networkType: String,
    val connectedClients: Int
)
