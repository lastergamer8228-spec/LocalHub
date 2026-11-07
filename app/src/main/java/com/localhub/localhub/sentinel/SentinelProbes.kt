package com.localhub.localhub.sentinel

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.localhub.localhub.data.datastore.PreferencesManager
import com.localhub.localhub.data.local.AppDatabase
import com.localhub.localhub.server.ClientTracker
import com.localhub.localhub.server.LocalHubServer
import com.localhub.localhub.server.SessionManager
import com.localhub.localhub.system.CrashPolicy
import com.localhub.localhub.system.CrashReportStore
import com.localhub.localhub.system.SystemInfoProvider
import com.localhub.localhub.sentinel.SentinelModels.SentinelContext
import com.localhub.localhub.system.TlsCertificateManager
import com.localhub.localhub.util.AppLogger
import kotlinx.coroutines.runBlocking
import java.net.BindException
import java.net.InetSocketAddress
import java.net.ServerSocket
import kotlin.system.measureTimeMillis

/**
 * Sentinel's senses.
 *
 * Every method here answers exactly one question about the running system and
 * attaches the evidence it used. Probes never interpret - deciding what a fact
 * means is [SentinelDiagnoser]'s job. That split is what makes the difference
 * between "server unhealthy" and "the listener thread died after the network
 * changed, and here is the proof".
 *
 * A probe must not throw. Anything that goes wrong while measuring becomes a
 * probe result with [Severity.MEDIUM], because an unmeasurable subsystem is
 * itself something an administrator should know about.
 */
class SentinelProbes(
    private val context: Context,
    private val serverProvider: () -> LocalHubServer,
    private val preferencesManager: PreferencesManager,
    private val sessionManager: SessionManager,
    private val clientTracker: ClientTracker,
    private val systemInfoProvider: SystemInfoProvider,
    private val crashStoreProvider: () -> CrashReportStore?,
    private val databaseProvider: () -> AppDatabase,
    private val logger: AppLogger
) {

    private companion object {
        /** Dashboard files without which the web UI cannot render at all. */
        val REQUIRED_ASSETS = listOf(
            "dashboard/index.html",
            "dashboard/app.js",
            "dashboard/style.css",
            "dashboard/login.html",
            "ai/index.html"
        )
        /** Passwords shipped with the project. Anything still matching is a hole. */
        val DEFAULT_PASSWORDS = listOf("admin", "user", "localhub", "password", "1234", "123456", "admin123")
        const val MEMORY_WARN_PERCENT = 85
    }

    private val appContext get() = context.applicationContext

    fun runAll(ctx: SentinelContext): List<SentinelModels.ProbeResult> {
        val out = mutableListOf<SentinelModels.ProbeResult>()
        out += probePortBindable(ctx)
        out += probeListenerAlive(ctx)
        val serverAlive = out.last().ok && ctx.expectedRunning
        out += probeLanReachable(serverAlive, ctx)
        out += probeNetworkSubnet()
        out += probeClientIsolation()
        out += probeStorageAccess()
        out += probeMemoryPressure()
        out += probeCrashLoop()
        out += probeBatteryOptimisation()
        out += probeAssetsIntegrity()
        out += probeDatabase()
        out += probeHttpsCertificate()
        out += probeAuthThreats()
        out += probeCredentialHygiene()
        out += probeSessionHygiene()
        return out
    }

    // ------------------------------------------------------------- plumbing

    private fun measured(
        id: String,
        fallbackSummary: String,
        block: () -> Pair<Boolean, SentinelModels.ProbeResult>
    ): SentinelModels.ProbeResult = try {
        var result: SentinelModels.ProbeResult?
        val ms = measureTimeMillis { result = block().second }
        result!!.copy(durationMs = ms)
    } catch (t: Throwable) {
        logger.warn(TAG, "Probe $id failed: ${t.message}")
        SentinelModels.ProbeResult(
            id = id,
            ok = false,
            severity = SentinelModels.Severity.MEDIUM,
            summary = "$fallbackSummary (probe error: ${t.message ?: t.javaClass.simpleName})",
            evidence = mapOf("error" to (t.message ?: t.javaClass.simpleName))
        )
    }

    private fun make(
        id: String,
        ok: Boolean,
        severity: SentinelModels.Severity,
        summary: String,
        evidence: Map<String, Any> = emptyMap()
    ): Pair<Boolean, SentinelModels.ProbeResult> =
        ok to SentinelModels.ProbeResult(id, ok, severity, summary, evidence)

    // ---------------------------------------------------------------- probes

    /** Can the configured port actually be bound right now? */
    private fun probePortBindable(ctx: SentinelContext): SentinelModels.ProbeResult =
        measured("port.bindable", "Port ${ctx.port} could not be tested") {
            val heldBySelf = runCatching {
                val s = serverProvider()
                s.isAlive && s.listeningPort == ctx.port
            }.getOrDefault(false)

            if (heldBySelf) {
                return@measured make(
                    "port.bindable", true, SentinelModels.Severity.OK,
                    "Port ${ctx.port} is held by this server",
                    mapOf("port" to ctx.port, "heldBySelf" to true)
                )
            }

            try {
                ServerSocket().use { s ->
                    s.reuseAddress = true
                    s.bind(InetSocketAddress(ctx.port))
                }
                make(
                    "port.bindable", true, SentinelModels.Severity.OK,
                    "Port ${ctx.port} is free",
                    mapOf("port" to ctx.port, "heldBySelf" to false)
                )
            } catch (e: BindException) {
                val msg = e.message.orEmpty()
                val errno = when {
                    msg.contains("EACCES") || msg.contains("Permission denied") -> "EACCES"
                    else -> "EADDRINUSE"
                }
                make(
                    "port.bindable", false, SentinelModels.Severity.HIGH,
                    "Port ${ctx.port} cannot be bound ($errno)",
                    mapOf(
                        "port" to ctx.port,
                        "errno" to errno,
                        "suggestedPort" to findFreePort(ctx.port + 1),
                        "error" to msg
                    )
                )
            }
        }

    private fun findFreePort(from: Int): Int {
        var p = from.coerceIn(1024, 65535)
        repeat(60) {
            try {
                ServerSocket().use { s -> s.reuseAddress = true; s.bind(InetSocketAddress(p)) }
                return p
            } catch (_: Exception) {
                p++
                if (p > 65535) p = 1024
            }
        }
        return from
    }

    /** Is the accept loop still running? This is the fault nothing else caught. */
    private fun probeListenerAlive(ctx: SentinelContext): SentinelModels.ProbeResult =
        measured("listener.alive", "Listener state could not be read") {
            if (!ctx.expectedRunning) {
                return@measured make(
                    "listener.alive", true, SentinelModels.Severity.OK,
                    "No listener expected (server is stopped)",
                    mapOf("expectedRunning" to false)
                )
            }
            val alive = runCatching { serverProvider().isAlive }.getOrDefault(false)
            val port = runCatching { serverProvider().listeningPort }.getOrDefault(-1)
            if (alive) make(
                "listener.alive", true, SentinelModels.Severity.OK,
                "Listener is accepting connections on port $port",
                mapOf("expectedRunning" to true, "port" to port)
            )
            else make(
                "listener.alive", false, SentinelModels.Severity.CRITICAL,
                "Listener is not accepting connections",
                mapOf("expectedRunning" to true, "configuredPort" to ctx.port)
            )
        }

    /** Loopback only, or reachable on the LAN? (the "my PC can't connect" fault). */
    private fun probeLanReachable(serverAlive: Boolean, ctx: SentinelContext): SentinelModels.ProbeResult =
        measured("lan.reachable", "LAN reachability could not be tested") {
            if (!serverAlive) {
                return@measured make(
                    "lan.reachable", true, SentinelModels.Severity.OK,
                    "Not tested - the server is not running",
                    mapOf("skipped" to true)
                )
            }
            val diag = systemInfoProvider.probeLanReachable(ctx.port)
            val lanOk = diag["lanOk"] == true
            make(
                "lan.reachable", lanOk,
                if (lanOk) SentinelModels.Severity.OK else SentinelModels.Severity.HIGH,
                if (lanOk) "The server answers on its LAN address"
                else "The server does not answer on any LAN address",
                diag
            )
        }

    /** Which subnet is the phone on, and are the clients it sees on the same one? */
    private fun probeNetworkSubnet(): SentinelModels.ProbeResult =
        measured("network.subnet", "Network placement could not be determined") {
            val net = systemInfoProvider.lastSnapshot.value?.network
                ?: systemInfoProvider.collectSnapshot().network
            val mask = net.subnetMask.ifBlank { "255.255.255.0" }
            val deviceSubnet = subnetOf(net.ipAddress, mask)
            val clientIps = clientTracker.clients.value
                .map { it.ip }
                .filter { it.isNotBlank() && it != "?" }
                .distinct()
            val elsewhere = clientIps.filter { subnetOf(it, mask) != deviceSubnet }

            val severity = when {
                net.type == "MOBILE" -> SentinelModels.Severity.HIGH
                elsewhere.isNotEmpty() -> SentinelModels.Severity.MEDIUM
                else -> SentinelModels.Severity.OK
            }
            make(
                "network.subnet", severity != SentinelModels.Severity.HIGH, severity,
                when {
                    net.type == "MOBILE" -> "On mobile data - not reachable from a local network"
                    elsewhere.isNotEmpty() -> "${elsewhere.size} known client(s) sit outside this subnet"
                    else -> "On ${net.type} ${net.ssid.ifBlank { "" }}, subnet $deviceSubnet"
                },
                mapOf(
                    "type" to net.type,
                    "ip" to net.ipAddress,
                    "subnetMask" to mask,
                    "gateway" to net.gateway,
                    "ssid" to net.ssid,
                    "deviceSubnet" to deviceSubnet,
                    "clients" to clientIps,
                    "clientsOnOtherSubnet" to elsewhere
                )
            )
        }


    /**
     * Actively tests whether other devices on this Wi-Fi are reachable at all.
     *
     * This exists because of a specific, very common failure that every other
     * probe misses: the server is running, bound correctly, reachable from the
     * phone itself — and still invisible to a laptop on the same router. The
     * cause is usually AP/client isolation, a router setting that stops wireless
     * clients from talking to each other.
     *
     * The probe cannot ask "can that laptop reach me?", so it asks the next best
     * question: **is anyone else on this subnet reachable?** The gateway always
     * answers (it is the router). If the gateway answers and nothing else does,
     * either the room is empty or the clients are walled off from each other.
     * Combined with the client list being empty, that is a strong signal.
     */
    private fun probeClientIsolation(): SentinelModels.ProbeResult =
        measured("client.isolation", "Peer reachability could not be tested") {
            val net = systemInfoProvider.lastSnapshot.value?.network
                ?: systemInfoProvider.collectSnapshot().network
            if (net.type == "MOBILE") {
                // On a hotspot the phone IS the access point; isolation is not a thing.
                return@measured make(
                    "client.isolation", true, SentinelModels.Severity.OK,
                    "Hotspot/mobile: the phone is the access point, peers connect to it directly"
                )
            }

            val mask = net.subnetMask.ifBlank { "255.255.255.0" }
            val gateway = net.gateway
            val self = net.ipAddress
            val gatewayUp = gateway.isNotBlank() && tcpReachable(gateway)
            if (!gatewayUp) {
                return@measured make(
                    "client.isolation", false, SentinelModels.Severity.HIGH,
                    "The router itself is unreachable - the Wi-Fi link is down or filtered",
                    mapOf("gateway" to gateway, "gatewayReachable" to false)
                )
            }

            // Probe a small, polite sample of the subnet. This is a diagnostic,
            // not a port sweep: one port, short timeout, a handful of addresses.
            val peers = samplePeers(self, gateway, count = 12)
            val found = peers.filter { tcpReachable(it, timeoutMs = 250) }

            val knownClients = clientTracker.clients.value
                .map { it.ip }
                .filter { it.isNotBlank() && it != "?" && subnetOf(it, mask) == subnetOf(self, mask) }
                .distinct()

            val suspect = found.isEmpty() && knownClients.isEmpty()
            make(
                "client.isolation", !suspect,
                if (suspect) SentinelModels.Severity.MEDIUM else SentinelModels.Severity.OK,
                when {
                    suspect ->
                        "No other device on this Wi-Fi is reachable - the router is likely " +
                            "isolating clients from one another"
                    found.isEmpty() && knownClients.isNotEmpty() ->
                        "No peers answered, but ${knownClients.size} client(s) have connected before"
                    else ->
                        "${found.size} of ${peers.size} sampled peer address(es) answered - " +
                            "clients can reach each other"
                },
                mapOf(
                    "gateway" to gateway,
                    "gatewayReachable" to true,
                    "self" to self,
                    "peersProbed" to peers.size,
                    "peersReachable" to found,
                    "peersReachableCount" to found.size,
                    "knownClientsOnSubnet" to knownClients
                )
            )
        }

    /** A short TCP connect attempt. Used only to test reachability. */
    private fun tcpReachable(host: String, port: Int = 80, timeoutMs: Int = 300): Boolean = runCatching {
        java.net.Socket().use { s ->
            s.connect(java.net.InetSocketAddress(host, port), timeoutMs)
            true
        }
    }.getOrDefault(false)

    /** A few plausible peer addresses in the same /24, excluding self and gateway. */
    private fun samplePeers(self: String, gateway: String, count: Int): List<String> {
        val parts = self.split(".")
        if (parts.size != 4) return emptyList()
        val base = parts.take(3).joinToString(".")
        val selfLast = parts[3].toIntOrNull() ?: return emptyList()
        val gwLast = gateway.split(".").getOrNull(3)?.toIntOrNull()
        // Prefer addresses near this device - DHCP usually hands out a block.
        val candidates = mutableListOf<Int>()
        var step = 1
        while (candidates.size < count && step < 254) {
            for (delta in listOf(step, -step)) {
                val v = selfLast + delta
                if (v in 1..254 && v != selfLast && v != gwLast && v !in candidates) candidates.add(v)
                if (candidates.size >= count) break
            }
            step++
        }
        return candidates.map { "$base.$it" }
    }

    private fun probeStorageAccess(): SentinelModels.ProbeResult =
        measured("storage.access", "Storage permission could not be checked") {
            val missing = mutableListOf<String>()
            val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                if (Environment.isExternalStorageManager()) true
                else { missing += "MANAGE_EXTERNAL_STORAGE"; false }
            } else {
                if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
                ) true
                else { missing += "READ_EXTERNAL_STORAGE"; false }
            }
            if (granted) make(
                "storage.access", true, SentinelModels.Severity.OK,
                "Shared storage is readable",
                mapOf("missing" to emptyList<String>())
            )
            else make(
                "storage.access", false, SentinelModels.Severity.HIGH,
                "Shared storage is not readable",
                mapOf("missing" to missing)
            )
        }

    private fun probeMemoryPressure(): SentinelModels.ProbeResult =
        measured("memory.pressure", "Memory state could not be read") {
            val rt = Runtime.getRuntime()
            val used = rt.totalMemory() - rt.freeMemory()
            val max = rt.maxMemory()
            val percent = ((used * 100L) / max.coerceAtLeast(1)).toInt()
            val ok = percent < MEMORY_WARN_PERCENT
            make(
                "memory.pressure", ok,
                if (ok) SentinelModels.Severity.OK else if (percent >= 92) SentinelModels.Severity.HIGH else SentinelModels.Severity.MEDIUM,
                "Heap ${percent}% used",
                mapOf(
                    "usedPercent" to percent,
                    "usedMb" to (used / 1048576L).toInt(),
                    "maxMb" to (max / 1048576L).toInt(),
                    "detail" to "${used / 1048576L} MB of ${max / 1048576L} MB"
                )
            )
        }

    private fun probeCrashLoop(): SentinelModels.ProbeResult =
        measured("crash.loop", "Crash history could not be read") {
            val store = crashStoreProvider()
            val state = runCatching { store?.read() }.getOrNull()
            val now = System.currentTimeMillis()
            val recent = state?.crashesSince(now, CrashPolicy.CRASH_WINDOW_MS) ?: 0
            val ok = recent < CrashPolicy.SAFE_MODE_THRESHOLD
            make(
                "crash.loop", ok,
                if (ok) SentinelModels.Severity.OK else SentinelModels.Severity.CRITICAL,
                if (ok) "No crash cluster" else "$recent crashes in the last two minutes",
                mapOf(
                    "recentCrashes" to recent,
                    "safeMode" to (state?.safeMode ?: false),
                    "recoveries" to (state?.recoveries ?: 0),
                    "lowMemoryEvents" to (state?.lowMemoryEvents ?: 0)
                )
            )
        }

    private fun probeBatteryOptimisation(): SentinelModels.ProbeResult =
        measured("battery.optimization", "Battery optimisation state could not be read") {
            val pm = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            val ignoring = pm.isIgnoringBatteryOptimizations(appContext.packageName)
            if (ignoring) make(
                "battery.optimization", true, SentinelModels.Severity.OK,
                "Battery optimisation is not applied to LocalHub",
                mapOf("ignoring" to true)
            )
            else make(
                "battery.optimization", false, SentinelModels.Severity.MEDIUM,
                "The OS may stop the server while the app is in the background",
                mapOf("ignoring" to false)
            )
        }

    private fun probeAssetsIntegrity(): SentinelModels.ProbeResult =
        measured("assets.integrity", "Packaged assets could not be verified") {
            val missing = REQUIRED_ASSETS.filter { name ->
                runCatching { appContext.assets.open(name).close(); false }.getOrDefault(true)
            }
            if (missing.isEmpty()) make(
                "assets.integrity", true, SentinelModels.Severity.OK,
                "All ${REQUIRED_ASSETS.size} dashboard files are present",
                mapOf("missing" to emptyList<String>())
            )
            else make(
                "assets.integrity", false, SentinelModels.Severity.HIGH,
                "${missing.size} dashboard file(s) are missing from the app package",
                mapOf("missing" to missing)
            )
        }

    private fun probeDatabase(): SentinelModels.ProbeResult =
        measured("db.integrity", "The local database could not be opened") {
            val db = databaseProvider()
            val c = db.openHelper.readableDatabase.query("SELECT 1")
            try {
                check(c.moveToFirst()) { "the database returned no row" }
            } finally {
                c.close()
            }
            make(
                "db.integrity", true, SentinelModels.Severity.OK,
                "Local database opens and answers queries",
                mapOf("name" to AppDatabase.NAME)
            )
        }

    private fun probeHttpsCertificate(): SentinelModels.ProbeResult =
        measured("https.cert", "TLS state could not be determined") {
            val enabled = runBlocking { preferencesManager.getHttpsEnabled() }
            if (!enabled) {
                return@measured make(
                    "https.cert", true, SentinelModels.Severity.OK,
                    "HTTPS is off - the server serves plain HTTP",
                    mapOf("httpsEnabled" to false)
                )
            }
            val hasIdentity = runCatching { TlsCertificateManager.hasIdentity() }.getOrDefault(false)
            if (hasIdentity) make(
                "https.cert", true, SentinelModels.Severity.OK,
                "A per-install TLS identity exists",
                mapOf("httpsEnabled" to true)
            )
            else make(
                "https.cert", false, SentinelModels.Severity.CRITICAL,
                "HTTPS is on but there is no certificate, so the server refuses to start",
                mapOf("httpsEnabled" to true, "hasIdentity" to false)
            )
        }

    private fun probeAuthThreats(): SentinelModels.ProbeResult =
        measured("auth.threats", "Authentication pressure could not be measured") {
            val snap = sessionManager.snapshot()
            val brute = snap.failedAttempts >= SentinelDiagnoser.BRUTE_FORCE_THRESHOLD
            val ok = !brute && snap.lockedOutIps.isEmpty()
            make(
                "auth.threats", ok,
                when {
                    brute -> SentinelModels.Severity.HIGH
                    snap.lockedOutIps.isNotEmpty() -> SentinelModels.Severity.LOW
                    else -> SentinelModels.Severity.OK
                },
                when {
                    brute -> "${snap.failedAttempts} failed sign-in attempts in the window"
                    snap.lockedOutIps.isNotEmpty() -> "${snap.lockedOutIps.size} address(es) locked out"
                    else -> "No authentication pressure"
                },
                mapOf(
                    "recentFailures" to snap.failedAttempts,
                    "lockedOutIps" to snap.lockedOutIps,
                    "topFailureSource" to snap.topFailureSource,
                    "activeSessions" to snap.active
                )
            )
        }

    /**
     * Are the shipped credentials still the live ones?
     *
     * The passwords are tested against the stored value with the same verifier
     * the login path uses, so this reports what would actually let someone in -
     * not what the settings screen claims.
     */
    private fun probeCredentialHygiene(): SentinelModels.ProbeResult =
        measured("credentials.hygiene", "Credential state could not be verified") {
            val adminUser = runBlocking { preferencesManager.getAdminUser() }
            val adminPass = runBlocking { preferencesManager.getAdminPass() }
            val webUser = runBlocking { preferencesManager.getWebUser() }
            val webPass = runBlocking { preferencesManager.getWebPass() }

            val defaults = mutableListOf<String>()
            var adminIsDefault = false
            for (candidate in DEFAULT_PASSWORDS) {
                if (sessionManager.verifyPassword(candidate, adminPass)) {
                    adminIsDefault = true
                    defaults += "admin/$candidate"
                    break
                }
            }
            for (candidate in DEFAULT_PASSWORDS) {
                if (sessionManager.verifyPassword(candidate, webPass)) {
                    defaults += "user/$candidate"
                    break
                }
            }

            val weak = mutableListOf<String>()
            if (adminPass.isBlank()) weak += "admin (no password set)"
            if (webPass.isBlank()) weak += "user (no password set)"

            val ok = defaults.isEmpty() && weak.isEmpty()
            make(
                "credentials.hygiene", ok,
                if (adminIsDefault) SentinelModels.Severity.CRITICAL else if (!ok) SentinelModels.Severity.MEDIUM else SentinelModels.Severity.OK,
                when {
                    adminIsDefault -> "The administrator still uses a shipped default password"
                    defaults.isNotEmpty() -> "A shipped default password is still accepted"
                    weak.isNotEmpty() -> "An account has no password set"
                    else -> "Credentials are not the shipped defaults"
                },
                mapOf("defaults" to defaults, "weak" to weak, "adminUser" to adminUser, "webUser" to webUser)
            )
        }

    private fun probeSessionHygiene(): SentinelModels.ProbeResult =
        measured("session.hygiene", "Session state could not be read") {
            val snap = sessionManager.snapshot()
            make(
                "session.hygiene", true, SentinelModels.Severity.OK,
                "${snap.active} active session(s) from ${snap.distinctIps.size} address(es)",
                mapOf(
                    "activeSessions" to snap.active,
                    "expiredHeld" to snap.expired,
                    "distinctIps" to snap.distinctIps
                )
            )
        }

    private fun subnetOf(ip: String, mask: String): String {
        val a = ip.split(".").mapNotNull { it.toIntOrNull() }
        val m = mask.split(".").mapNotNull { it.toIntOrNull() }
        if (a.size != 4 || m.size != 4) return ip
        return List(4) { a[it] and m[it] }.joinToString(".")
    }

    private val TAG = "Sentinel"
}
