package com.localhub.localhub.system

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import com.localhub.localhub.model.BatteryInfo
import com.localhub.localhub.model.CpuInfo
import com.localhub.localhub.model.DeviceInfo
import com.localhub.localhub.model.MemoryInfo
import com.localhub.localhub.model.NetworkInfo
import com.localhub.localhub.model.StorageInfo
import com.localhub.localhub.model.SystemInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.BufferedReader
import java.io.File
import java.io.FileReader
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

/**
 * Collects real-time device/system telemetry. The most recent snapshot is exposed
 * through [lastSnapshot] so the REST API and Compose UI can read it without sampling.
 */
class SystemInfoProvider(private val context: Context) {

    private val _lastSnapshot = MutableStateFlow<SystemInfo?>(null)
    val lastSnapshot: StateFlow<SystemInfo?> = _lastSnapshot.asStateFlow()

    private var lastCpuTotal: Long = 0
    private var lastCpuIdle: Long = 0

    fun collectSnapshot(): SystemInfo {
        val cpu = getCpuInfo()
        val memory = getMemoryInfo()
        val storage = getStorageInfo()
        val battery = getBatteryInfo()
        val network = getNetworkInfo()
        val device = getDeviceInfo()
        val snapshot = SystemInfo(
            timestamp = System.currentTimeMillis(),
            cpu = cpu,
            memory = memory,
            storage = storage,
            battery = battery,
            network = network,
            device = device
        )
        _lastSnapshot.value = snapshot
        return snapshot
    }

    private fun getCpuInfo(): CpuInfo {
        val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val model = readCpuModel()
        val arch = Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"
        val (minF, maxF) = readCpuFreq()
        val usage = computeCpuUsage()
        return CpuInfo(cores, model, arch, minF, maxF, usage)
    }

    private fun readCpuModel(): String = runCatching {
        val text = BufferedReader(FileReader("/proc/cpuinfo")).use { it.readText() }
        text.lines()
            .firstOrNull { it.contains("Hardware") || it.contains("model name") }
            ?.substringAfter(":")
            ?.trim()
            ?: "CPU"
    }.getOrDefault("CPU")

    private fun readCpuFreq(): Pair<Long, Long> {
        val min = readFreq("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq")
        val max = readFreq("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq")
        return min to max
    }

    private fun readFreq(path: String): Long = runCatching {
        val f = File(path)
        if (f.exists()) f.readText().trim().toLongOrNull() ?: 0L else 0L
    }.getOrDefault(0L)

    private fun computeCpuUsage(): Float = runCatching {
        val line = BufferedReader(FileReader("/proc/stat")).use { it.readLine() } ?: return 0f
        val parts = line.split("\\s+".toRegex()).drop(1).map { it.toLongOrNull() ?: 0L }
        val idle = parts.getOrElse(3) { 0L } + parts.getOrElse(4) { 0L }
        val total = parts.sum()
        var usage = 0f
        if (lastCpuTotal > 0 && total > lastCpuTotal) {
            val totalDelta = total - lastCpuTotal
            val idleDelta = idle - lastCpuIdle
            usage = ((1f - (idleDelta.toFloat() / totalDelta)) * 100f).coerceIn(0f, 100f)
        }
        lastCpuTotal = total
        lastCpuIdle = idle
        usage
    }.getOrDefault(0f)

    private fun getMemoryInfo(): MemoryInfo {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        val total = mi.totalMem
        val avail = mi.availMem
        val used = (total - avail).coerceAtLeast(0)
        return MemoryInfo(total, avail, used, mi.lowMemory)
    }

    private fun getStorageInfo(): StorageInfo = runCatching {
        val path = Environment.getDataDirectory().path
        val stat = StatFs(path)
        val blockSize = stat.blockSizeLong
        val total = stat.blockCountLong * blockSize
        val avail = stat.availableBlocksLong * blockSize
        val used = (total - avail).coerceAtLeast(0)
        StorageInfo(total, avail, used, path)
    }.getOrDefault(StorageInfo(0, 0, 0, ""))

    private fun getBatteryInfo(): BatteryInfo {
        val intent = runCatching {
            context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        }.getOrNull()
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val temp = (intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10f
        val voltage = intent?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) ?: 0
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val plugged = intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val health = intent?.getIntExtra(BatteryManager.EXTRA_HEALTH, 0) ?: 0
        val tech = intent?.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY) ?: "Unknown"
        return BatteryInfo(
            level = level,
            scale = scale,
            temperatureCelsius = temp,
            voltage = voltage,
            isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL,
            plugged = when (plugged) {
                BatteryManager.BATTERY_PLUGGED_AC -> "AC"
                BatteryManager.BATTERY_PLUGGED_USB -> "USB"
                BatteryManager.BATTERY_PLUGGED_WIRELESS -> "Wireless"
                else -> "Unplugged"
            },
            health = when (health) {
                BatteryManager.BATTERY_HEALTH_GOOD -> "Good"
                BatteryManager.BATTERY_HEALTH_OVERHEAT -> "Overheat"
                BatteryManager.BATTERY_HEALTH_DEAD -> "Dead"
                BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "Over voltage"
                BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "Failure"
                BatteryManager.BATTERY_HEALTH_COLD -> "Cold"
                else -> "Unknown"
            },
            technology = tech
        )
    }

    private fun getNetworkInfo(): NetworkInfo {
        val ip = getLocalIpAddress()
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        var type = "NONE"
        var isConnected = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val net = cm.activeNetwork
            val caps = cm.getNetworkCapabilities(net)
            isConnected = net != null && caps != null
            type = when {
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "MOBILE"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ETHERNET"
                else -> "NONE"
            }
        } else {
            @Suppress("DEPRECATION")
            val info = cm.activeNetworkInfo
            isConnected = info?.isConnected == true
            type = info?.typeName?.uppercase() ?: "NONE"
        }

        var ssid = ""
        var bssid = ""
        var linkSpeed = 0
        if (type == "WIFI") {
            runCatching {
                val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                @Suppress("DEPRECATION")
                val info = wifi.connectionInfo
                ssid = info?.ssid?.trim('"') ?: ""
                bssid = info?.bssid ?: ""
                @Suppress("DEPRECATION")
                linkSpeed = info?.linkSpeed ?: 0
            }
        }
        return NetworkInfo(ip, ssid, bssid, linkSpeed, type, isConnected)
    }

    private fun getLocalIpAddress(): String = runCatching {
        val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
        for (intf in interfaces) {
            val addresses = Collections.list(intf.inetAddresses)
            for (addr in addresses) {
                if (!addr.isLoopbackAddress && addr is Inet4Address) {
                    val host = addr.hostAddress ?: continue
                    if (!host.contains(":")) return host
                }
            }
        }
        "127.0.0.1"
    }.getOrDefault("127.0.0.1")

    private fun getDeviceInfo(): DeviceInfo = DeviceInfo(
        model = Build.MODEL ?: "Unknown",
        manufacturer = Build.MANUFACTURER ?: "Unknown",
        brand = Build.BRAND ?: "Unknown",
        device = Build.DEVICE ?: "Unknown",
        board = Build.BOARD ?: "Unknown",
        hardware = Build.HARDWARE ?: "Unknown",
        androidVersion = Build.VERSION.RELEASE ?: "Unknown",
        sdkInt = Build.VERSION.SDK_INT,
        buildId = Build.ID ?: "Unknown"
    )
}
