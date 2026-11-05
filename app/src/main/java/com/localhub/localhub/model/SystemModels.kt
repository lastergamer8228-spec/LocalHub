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
/** One IPv4 address found on an up, non-loopback interface. */
data class NetAddress(
    val iface: String = "",
    val ip: String = "",
    val prefix: Int = 0,
    val preferred: Boolean = false
)

data class NetworkInfo(
    val ipAddress: String,
    val ssid: String,
    val bssid: String,
    val linkSpeedMbps: Int,
    val type: String,
    val isConnected: Boolean,
    /** Dotted subnet mask derived from the preferred address' prefix length. */
    val subnetMask: String = "",
    /** Default gateway as reported by DHCP (Wi-Fi only). */
    val gateway: String = "",
    /** Every IPv4 the device currently holds, so a wrong pick can be spotted. */
    val addresses: List<NetAddress> = emptyList()
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
