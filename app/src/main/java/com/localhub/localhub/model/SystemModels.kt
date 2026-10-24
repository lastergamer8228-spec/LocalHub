package com.localhub.localhub.model

/** CPU telemetry. */
data class CpuInfo(
    val cores: Int,
    val model: String,
    val architecture: String,
    val minFreqKhz: Long,
    val maxFreqKhz: Long,
    val usagePercent: Float,
    val available: Boolean = true
)

/** RAM telemetry. */
data class MemoryInfo(
    val totalBytes: Long,
    val availableBytes: Long,
    val usedBytes: Long,
    val lowMemory: Boolean
) {
    val usagePercent: Float
        get() = if (totalBytes > 0) (usedBytes.toFloat() / totalBytes) * 100f else 0f
}

/** Internal storage telemetry. */
data class StorageInfo(
    val totalBytes: Long,
    val availableBytes: Long,
    val usedBytes: Long,
    val path: String
) {
    val usagePercent: Float
        get() = if (totalBytes > 0) (usedBytes.toFloat() / totalBytes) * 100f else 0f
}

/** Battery telemetry. */
data class BatteryInfo(
    val level: Int,
    val scale: Int,
    val temperatureCelsius: Float,
    val voltage: Int,
    val isCharging: Boolean,
    val plugged: String,
    val health: String,
    val technology: String
)

/** Network telemetry. */
data class NetworkInfo(
    val ipAddress: String,
    val ssid: String,
    val bssid: String,
    val linkSpeedMbps: Int,
    val type: String,
    val isConnected: Boolean
)

/** Static device information. */
data class DeviceInfo(
    val model: String,
    val manufacturer: String,
    val brand: String,
    val device: String,
    val board: String,
    val hardware: String,
    val androidVersion: String,
    val sdkInt: Int,
    val buildId: String
)

/** A complete point-in-time snapshot of the device. */
data class SystemInfo(
    val timestamp: Long,
    val cpu: CpuInfo,
    val memory: MemoryInfo,
    val storage: StorageInfo,
    val battery: BatteryInfo,
    val network: NetworkInfo,
    val device: DeviceInfo
)
