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
import com.localhub.localhub.model.NetAddress
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
import java.util.Locale

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
        return CpuInfo(cores, model, arch, minF, maxF, usage.coerceAtLeast(0f), available = usage >= 0f)
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
        val file = File("/proc/stat")
        if (file.exists() && file.canRead()) {
            val line = BufferedReader(FileReader(file)).use { it.readLine() } ?: return@runCatching 0f
            val parts = line.split("\\s+".toRegex()).drop(1).map { it.toLongOrNull() ?: 0L }
            val idle = parts.getOrElse(3) { 0L } + parts.getOrElse(4) { 0L }
            val total = parts.sum()
            var usage = -1f
            if (lastCpuTotal > 0 && total > lastCpuTotal) {
                val totalDelta = total - lastCpuTotal
                val idleDelta = idle - lastCpuIdle
                usage = ((1f - (idleDelta.toFloat() / totalDelta)) * 100f).coerceIn(0f, 100f)
            }
            lastCpuTotal = total
            lastCpuIdle = idle
            return@runCatching usage
        }
        // Modern Android may deny /proc/stat. Do NOT fabricate system CPU load
        // using RAM pressure or random/timestamp jitter.
        -1f
    }.getOrDefault(-1f)

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
        val addrs = interfaceAddresses()
        val ip = preferredIpv4(type, addrs)
        val gateway = if (type == "WIFI") wifiGateway() else ""
        val prefix = addrs.firstOrNull { it.ip == ip }?.prefix ?: 24
        return NetworkInfo(
            ipAddress = ip,
            ssid = ssid,
            bssid = bssid,
            linkSpeedMbps = linkSpeed,
            type = type,
            isConnected = isConnected,
            subnetMask = maskFromPrefix(prefix),
            gateway = gateway,
            addresses = addrs.map { it.copy(preferred = it.ip == ip) }
        )
    }

    // ---------------------------------------------------------------------
    // LAN reachability
    //
    // A server can report "running" and still be unreachable from the LAN: the
    // listener thread may have died, the device may be on mobile data, or the
    // access point may isolate clients. These helpers let the app prove which
    // of those it is instead of leaving the user guessing.
    // ---------------------------------------------------------------------

    /** Every IPv4 currently bound to an up, non-loopback interface. */
    private fun interfaceAddresses(): List<NetAddress> = runCatching {
        val out = mutableListOf<NetAddress>()
        for (intf in Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!intf.isUp || intf.isLoopback) continue
            for (ia in intf.interfaceAddresses) {
                val addr = ia.address
                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                    val host = addr.hostAddress ?: continue
                    out.add(NetAddress(intf.name, host, ia.networkPrefixLength.toInt(), false))
                }
            }
        }
        out
    }.getOrDefault(emptyList())

    /** Best guess by interface name, used when WifiManager has no answer. */
    private fun scoreInterface(name: String): Int {
        val n = name.lowercase()
        return when {
            n.startsWith("wlan") -> 100
            n.startsWith("eth") -> 90
            n.startsWith("ap") || n.startsWith("softap") -> 80
            n.startsWith("rndis") || n.startsWith("usb") -> 70
            n.startsWith("rmnet") -> 10
            n.startsWith("dummy") -> 0
            else -> 20
        }
    }

    private fun preferredIpv4(type: String, addrs: List<NetAddress>): String {
        // On Wi-Fi, WifiManager is authoritative: NetworkInterface can hand back
        // a stale or secondary address on some devices.
        if (type == "WIFI") wifiIpv4()?.let { return it }
        return addrs.sortedByDescending { scoreInterface(it.iface) }
            .firstOrNull()?.ip ?: "127.0.0.1"
    }

    private fun getLocalIpAddress(): String = runCatching {
        preferredIpv4(currentNetworkType(), interfaceAddresses())
    }.getOrDefault("127.0.0.1")

    private fun currentNetworkType(): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "NONE"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "NONE"
            return when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "MOBILE"
                else -> "NONE"
            }
        }
        @Suppress("DEPRECATION")
        return cm.activeNetworkInfo?.typeName?.uppercase() ?: "NONE"
    }

    /** IPv4 of the active Wi-Fi interface, straight from WifiManager. */
    private fun wifiIpv4(): String? = runCatching {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val raw = wifi.connectionInfo?.ipAddress ?: 0
        if (raw == 0) null else intToIpv4(raw)
    }.getOrNull()

    /** Default gateway reported by DHCP (Wi-Fi only). */
    private fun wifiGateway(): String = runCatching {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val raw = wifi.dhcpInfo?.gateway ?: 0
        if (raw == 0) "" else intToIpv4(raw)
    }.getOrDefault("")

    /** WifiManager hands back IPv4 as a little-endian int. */
    private fun intToIpv4(raw: Int): String = String.format(
        Locale.US, "%d.%d.%d.%d",
        raw and 0xff, (raw shr 8) and 0xff, (raw shr 16) and 0xff, (raw shr 24) and 0xff
    )

    private fun maskFromPrefix(prefix: Int): String {
        if (prefix !in 0..32) return ""
        val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
        return String.format(
            Locale.US, "%d.%d.%d.%d",
            (mask ushr 24) and 0xff, (mask ushr 16) and 0xff,
            (mask ushr 8) and 0xff, mask and 0xff
        )
    }

    /**
     * Opens a real TCP connection to [ip]:[port] from the device itself.
     * This is what distinguishes "server is listening on the LAN interface"
     * from "server only answers on loopback", which look identical to a user
     * who only ever opens the app's own browser button.
     */
    fun probeLanReachable(port: Int): Map<String, Any> {
        val addrs = interfaceAddresses()
        val type = currentNetworkType()
        val preferredIp = preferredIpv4(type, addrs)

        fun canConnect(ip: String): Boolean = runCatching {
            java.net.Socket().use { s ->
                s.connect(java.net.InetSocketAddress(java.net.InetAddress.getByName(ip), port), 700)
                true
            }
        }.getOrDefault(false)

        val loopbackOk = canConnect("127.0.0.1")
        val results = addrs.map { a ->
            mapOf(
                "iface" to a.iface,
                "ip" to a.ip,
                "prefix" to a.prefix,
                "preferred" to (a.ip == preferredIp),
                "url" to "http://${a.ip}:$port",
                "reachable" to canConnect(a.ip)
            )
        }
        val lanOk = results.any { it["reachable"] == true }

        val hint = when {
            !loopbackOk ->
                "The server is not accepting connections at all (port $port). Restart it from the Android app; if that fails, change the port."
            loopbackOk && !lanOk ->
                "The server answers on loopback (127.0.0.1) only — the LAN bind failed. Toggle Wi-Fi off and on, then restart the server."
            lanOk && type == "MOBILE" ->
                "The device is on mobile data. Carrier NAT makes the address unreachable from other devices — put the phone on Wi-Fi (or switch on its hotspot)."
            lanOk ->
                "The server answers on the LAN interface, so the app is working. If another device still cannot connect, the router is blocking device-to-device traffic (AP/client isolation), or the two devices are on different subnets."
            else ->
                "No usable network address was found. Connect the phone to Wi-Fi and restart the server."
        }

        return mapOf(
            "port" to port,
            "networkType" to type,
            "subnetMask" to maskFromPrefix(addrs.firstOrNull { it.ip == preferredIp }?.prefix ?: 24),
            "gateway" to if (type == "WIFI") wifiGateway() else "",
            "loopbackOk" to loopbackOk,
            "lanOk" to lanOk,
            "addresses" to results,
            "hint" to hint
        )
    }

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
