package com.localhub.localhub.sentinel

import com.localhub.localhub.sentinel.SentinelModels.AppliedAction
import com.localhub.localhub.sentinel.SentinelModels.Diagnosis
import com.localhub.localhub.sentinel.SentinelModels.ProbeResult
import com.localhub.localhub.sentinel.SentinelModels.Remediation
import com.localhub.localhub.sentinel.SentinelModels.Risk
import com.localhub.localhub.sentinel.SentinelModels.SentinelContext
import com.localhub.localhub.sentinel.SentinelModels.SecurityPosture
import com.localhub.localhub.sentinel.SentinelModels.SecurityThreat
import com.localhub.localhub.sentinel.SentinelModels.Severity
import com.localhub.localhub.sentinel.SentinelModels.ThreatKind

/**
 * Turns probe results into root causes.
 *
 * Pure: no Android APIs, no I/O, no clock. Everything it knows arrives in
 * [probes] or [ctx], so every rule below is covered by a JVM unit test.
 *
 * The output contract is the important part: a [Diagnosis] must carry [why],
 * the ordered evidence chain. A system that says "server unhealthy" without
 * evidence is the monitoring tool this replaced.
 */
object SentinelDiagnoser {

    /** Below this, a rule's conclusion is a guess and is not reported. */
    const val CONFIDENCE_FLOOR = 0.5

    /** Failed logins from one address inside the window that count as an attack. */
    const val BRUTE_FORCE_THRESHOLD = 5

    private val order = listOf(
        Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO, Severity.OK
    )

    private fun rank(s: Severity): Int = order.indexOf(s)

    private fun List<ProbeResult>.byId(id: String): ProbeResult? = firstOrNull { it.id == id }

    private fun ProbeResult.ev(key: String): Any? = evidence[key]

    private fun ProbeResult.str(key: String, default: String = ""): String =
        evidence[key] as? String ?: default

    private fun ProbeResult.bool(key: String, default: Boolean = false): Boolean =
        evidence[key] as? Boolean ?: default

    private fun ProbeResult.int(key: String, default: Int = 0): Int = when (val v = evidence[key]) {
        is Int -> v
        is Long -> v.toInt()
        is Double -> v.toInt()
        is String -> v.toIntOrNull() ?: default
        else -> default
    }

    @Suppress("UNCHECKED_CAST")
    private fun ProbeResult.strList(key: String): List<String> =
        (evidence[key] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()

    /**
     * Every rule is a function of the measurements. Adding a fault means adding
     * a probe and one rule here - nothing else in the app needs to change.
     */
    fun diagnose(probes: List<ProbeResult>, ctx: SentinelContext): List<Diagnosis> {
        val out = mutableListOf<Diagnosis>()

        ruleListenerDied(probes, ctx)?.let(out::add)
        rulePortOccupied(probes, ctx)?.let(out::add)
        ruleLanBindFailed(probes, ctx)?.let(out::add)
        ruleClientSubnetMismatch(probes)?.let(out::add)
        ruleClientIsolated(probes, ctx)?.let(out::add)
        ruleCarrierNat(probes)?.let(out::add)
        ruleStoragePermission(probes)?.let(out::add)
        ruleMemoryPressure(probes)?.let(out::add)
        ruleCrashLoop(probes)?.let(out::add)
        ruleBatteryOptimised(probes)?.let(out::add)
        ruleAssetsMissing(probes)?.let(out::add)
        ruleDatabaseBroken(probes)?.let(out::add)
        ruleTlsUnavailable(probes)?.let(out::add)

        // rank() returns 0 for CRITICAL, so ascending puts the worst first.
        // Sorting this descending (the natural first instinct) silently inverts
        // the whole list and the console ends up leading with the least
        // important fault - which is exactly what the ordering test caught.
        return out
            .filter { it.confidence >= CONFIDENCE_FLOOR }
            .sortedWith(compareBy<Diagnosis> { rank(it.severity) }.thenByDescending { it.confidence })
    }

    // ---------------------------------------------------------------- rules

    private fun ruleListenerDied(p: List<ProbeResult>, ctx: SentinelContext): Diagnosis? {
        if (!ctx.expectedRunning) return null
        val alive = p.byId("listener.alive") ?: return null
        val bindable = p.byId("port.bindable")
        if (alive.ok) return null
        if (bindable != null && !bindable.ok) return null // that is the port rule's job
        return Diagnosis(
            id = "listener.died",
            title = "The HTTP listener stopped while the server was still marked running",
            severity = Severity.CRITICAL,
            confidence = 0.95,
            cause = "The accept loop exited, most often after a network change invalidated the " +
                "listening socket. Nothing crashed, so no restart was ever triggered - the app " +
                "kept showing \"Running\" while the port answered nobody.",
            why = listOf(
                "listener.alive: the listener thread is not accepting connections",
                "port.bindable: port ${ctx.port} is free, so the socket was lost, not blocked",
                "server state: expected running = true"
            ),
            remedies = listOf(
                Remediation(
                    id = "restart-listener",
                    title = "Restart the listener",
                    detail = "Rebinds port ${ctx.port} and resumes serving. Sessions are kept.",
                    risk = Risk.SAFE,
                    action = "restart-listener"
                ),
                Remediation(
                    id = "restart-service",
                    title = "Restart the whole server service",
                    detail = "Full restart, including telemetry and discovery. Use if rebinding alone fails.",
                    risk = Risk.CONFIRM,
                    action = "restart-service"
                )
            )
        )
    }

    private fun rulePortOccupied(p: List<ProbeResult>, ctx: SentinelContext): Diagnosis? {
        val bind = p.byId("port.bindable") ?: return null
        if (bind.ok) return null
        val errno = bind.str("errno")
        if (errno != "EADDRINUSE" && errno != "EACCES") return null
        val suggested = bind.int("suggestedPort", ctx.port + 1)
        val restricted = errno == "EACCES"
        return Diagnosis(
            id = "port.occupied",
            title = if (restricted) "Port ${ctx.port} is refused by the system" else "Port ${ctx.port} is already taken",
            severity = Severity.HIGH,
            confidence = 0.9,
            cause = if (restricted)
                "Android refuses to bind this port. Ports below 1024 are privileged; a VPN or a " +
                    "carrier proxy can also hold low ports on some devices."
            else
                "Another process on this phone already owns port ${ctx.port}, so LocalHub can " +
                    "never bind it until that process releases it or LocalHub moves.",
            why = listOf(
                "port.bindable: bind() failed with $errno on port ${ctx.port}",
                "port.bindable: next free port found = $suggested"
            ),
            remedies = listOf(
                Remediation(
                    id = "change-port",
                    title = "Move the server to port $suggested",
                    detail = "Rebinds the server. Clients must use the new address afterwards.",
                    risk = Risk.CONFIRM,
                    action = "change-port",
                    args = mapOf("port" to suggested.toString())
                ),
                Remediation(
                    id = "identify-port-owner",
                    title = "Find what is holding the port",
                    detail = "Close the other app (another local-server or proxy app), then start LocalHub again.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleLanBindFailed(p: List<ProbeResult>, ctx: SentinelContext): Diagnosis? {
        val lan = p.byId("lan.reachable") ?: return null
        if (lan.ok) return null
        val loopbackOk = lan.bool("loopbackOk")
        if (!loopbackOk) return null // nothing is serving at all - the listener rule covers that
        return Diagnosis(
            id = "lan.bind",
            title = "The server answers on the phone but not on the Wi-Fi address",
            severity = Severity.HIGH,
            confidence = 0.85,
            cause = "The listener is bound to loopback only, so it is invisible to every other " +
                "device. The app's own \"open in browser\" still works, which is exactly why this " +
                "fault is easy to miss.",
            why = listOf(
                "lan.reachable: loopback 127.0.0.1 answered",
                "lan.reachable: no LAN address answered on port ${ctx.port}"
            ),
            remedies = listOf(
                Remediation(
                    id = "restart-server-lan",
                    title = "Restart the server",
                    detail = "Rebinding usually restores the wildcard bind to all interfaces.",
                    risk = Risk.CONFIRM,
                    action = "restart-service"
                ),
                Remediation(
                    id = "toggle-wifi",
                    title = "Toggle Wi-Fi off and on",
                    detail = "If the socket was created while Wi-Fi was down, only a fresh network attach fixes it.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleClientSubnetMismatch(p: List<ProbeResult>): Diagnosis? {
        val lan = p.byId("lan.reachable") ?: return null
        if (!lan.ok) return null
        val net = p.byId("network.subnet") ?: return null
        val others = net.strList("clientsOnOtherSubnet")
        if (others.isEmpty()) return null
        return Diagnosis(
            id = "network.client-isolated",
            title = "${others.size} device(s) cannot reach the phone even though the server is fine",
            severity = Severity.MEDIUM,
            confidence = 0.8,
            cause = "The server answers on the LAN interface, so the app is healthy. The devices " +
                "that fail sit on a different subnet, or the access point isolates clients from " +
                "one another. No app change can fix either - the network has to.",
            why = listOf(
                "lan.reachable: the phone answered itself on its LAN address",
                "network.subnet: device subnet ${net.str("deviceSubnet", "?")}",
                "network.subnet: unreachable clients ${others.joinToString(", ")}"
            ),
            remedies = listOf(
                Remediation(
                    id = "isolate-network-guide",
                    title = "Fix the network path",
                    detail = "Put every device on the same router and SSID, turn off the router's " +
                        "\"AP/client isolation\", or use the phone's hotspot - a hotspot never isolates.",
                    risk = Risk.MANUAL
                )
            )
        )
    }


    /**
     * The "server works on my hotspot but not on my home router" case.
     *
     * AP/client isolation is a router setting that stops wireless devices from
     * reaching each other while still letting them all reach the internet. From
     * the phone's point of view everything looks perfect: the server is running,
     * it answers on its own LAN address, the router answers. Nothing in the app
     * is broken. A laptop two metres away simply cannot open the page.
     *
     * The user cannot be expected to know this, so the diagnosis has to name it
     * and say where the switch lives — it is in the router, not in LocalHub.
     */
    private fun ruleClientIsolated(p: List<ProbeResult>, ctx: SentinelContext): Diagnosis? {
        val iso = p.byId("client.isolation") ?: return null
        if (iso.ok) return null

        val gateway = iso.str("gateway")
        val peersProbed = iso.int("peersProbed")
        val gatewayUp = iso.bool("gatewayReachable")

        if (!gatewayUp) {
            return Diagnosis(
                id = "network.router-unreachable",
                title = "The phone cannot reach the router",
                severity = Severity.CRITICAL,
                confidence = 0.9,
                cause = "The gateway ${gateway.ifBlank { "(unknown)" }} does not answer. Until the " +
                    "phone can reach the router, nothing else on this network can reach the phone.",
                why = listOf(
                    "client.isolation: gateway $gateway did not answer",
                    "network.subnet: the phone is connected to ${p.byId("network.subnet")?.str("ssid").orEmpty()}"
                ),
                remedies = listOf(
                    Remediation(
                        id = "reconnect-wifi",
                        title = "Reconnect to Wi-Fi",
                        detail = "Turn Wi-Fi off and on, then confirm you are on the main network " +
                            "and not a guest network. Guest networks are isolated by design.",
                        risk = Risk.MANUAL
                    )
                )
            )
        }

        return Diagnosis(
            id = "network.client-isolated",
            title = "This Wi-Fi blocks devices from talking to each other",
            severity = Severity.HIGH,
            confidence = 0.8,
            cause = "The server is fine and the router answers, but none of the $peersProbed other " +
                "addresses sampled on this subnet are reachable. That is the signature of AP or " +
                "client isolation: a router setting that lets every device reach the internet but " +
                "stops them reaching each other. It is the usual reason a server works on a phone " +
                "hotspot and not on a home router — a hotspot does not isolate its clients.",
            why = listOf(
                "client.isolation: gateway $gateway answers — the Wi-Fi link is up",
                "client.isolation: 0 of $peersProbed peer addresses answered",
                "client.isolation: no device on this subnet has ever connected"
            ),
            remedies = listOf(
                Remediation(
                    id = "disable-ap-isolation",
                    title = "Turn off AP isolation on the router",
                    // No nested double quotes in this string: an unescaped quote inside a
                    // Kotlin literal terminates it, which is the compile error this shipped
                    // with once already.
                    detail = "Open the router admin page (usually 192.168.1.1 or 192.168.0.1) and " +
                        "look under Wireless / Wi-Fi settings for AP Isolation, Client Isolation " +
                        "or Station Isolation. Set it to Disabled and reconnect the devices. " +
                        "The wording differs by brand: TP-Link calls it AP Isolation; D-Link and " +
                        "Netgear often list it as Enable Wireless Isolation or as Allow clients " +
                        "to communicate.",
                    risk = Risk.MANUAL
                ),
                Remediation(
                    id = "check-guest-network",
                    title = "Check nobody is on a guest network",
                    detail = "Guest SSIDs are isolated permanently and cannot be changed. Put every " +
                        "device on the main Wi-Fi.",
                    risk = Risk.MANUAL
                ),
                Remediation(
                    id = "use-hotspot",
                    title = "Or use the phone's hotspot",
                    detail = "You have already confirmed this works. A hotspot does not isolate its " +
                        "clients, so the server is reachable immediately.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleCarrierNat(p: List<ProbeResult>): Diagnosis? {
        val net = p.byId("network.subnet") ?: return null
        if (net.str("type") != "MOBILE") return null
        return Diagnosis(
            id = "network.carrier-nat",
            title = "The phone is on mobile data, so no other device can reach it",
            severity = Severity.HIGH,
            confidence = 0.9,
            cause = "Carrier NAT gives the phone an address that exists only inside the mobile " +
                "network. It is not routable from a PC on any Wi-Fi.",
            why = listOf(
                "network.subnet: active transport is MOBILE",
                "network.subnet: address ${net.str("ip", "?")} is carrier-assigned"
            ),
            remedies = listOf(
                Remediation(
                    id = "use-wifi",
                    title = "Join a Wi-Fi network",
                    detail = "Same subnet as the client devices. Required for LAN access.",
                    risk = Risk.MANUAL
                ),
                Remediation(
                    id = "use-hotspot",
                    title = "Or switch on the phone's hotspot",
                    detail = "Clients join the phone's own subnet - works even with no router.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleStoragePermission(p: List<ProbeResult>): Diagnosis? {
        val s = p.byId("storage.access") ?: return null
        if (s.ok) return null
        return Diagnosis(
            id = "storage.denied",
            title = "File access is not granted",
            severity = Severity.HIGH,
            confidence = 0.95,
            cause = "File Manager and Media Lounge read shared storage. Without the grant every " +
                "listing comes back empty, which looks like a server fault but is a permission.",
            why = listOf(
                "storage.access: ${s.summary}",
                "storage.access: missing ${s.strList("missing").joinToString(", ").ifBlank { "unknown grant" }}"
            ),
            remedies = listOf(
                Remediation(
                    id = "grant-storage",
                    title = "Grant storage access",
                    detail = "Settings → Apps → LocalHub → Permissions → Files and media → Allow all.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleMemoryPressure(p: List<ProbeResult>): Diagnosis? {
        val m = p.byId("memory.pressure") ?: return null
        if (m.ok) return null
        val used = m.int("usedPercent")
        return Diagnosis(
            id = "memory.pressure",
            title = "The app is under memory pressure ($used% of the heap budget used)",
            severity = if (used >= 90) Severity.HIGH else Severity.MEDIUM,
            confidence = 0.8,
            cause = "Large uploads, media transcoding or a long uptime have filled the heap. " +
                "Before the OS kills the process, the caches can be released.",
            why = listOf(
                "memory.pressure: $used% used",
                "memory.pressure: ${m.str("detail", "")}"
            ),
            remedies = listOf(
                Remediation(
                    id = "trim-memory",
                    title = "Release caches",
                    detail = "Drops the in-memory hub store caches and asks the runtime to collect. Served files are unaffected.",
                    risk = Risk.SAFE,
                    action = "trim-memory"
                )
            )
        )
    }

    private fun ruleCrashLoop(p: List<ProbeResult>): Diagnosis? {
        val c = p.byId("crash.loop") ?: return null
        if (c.ok) return null
        val crashes = c.int("recentCrashes")
        return Diagnosis(
            id = "crash.loop",
            title = "The app has crashed $crashes times recently",
            severity = Severity.CRITICAL,
            confidence = 0.9,
            cause = "Repeated crashes in a short window point at one reproducible fault - a bad " +
                "restore, a corrupt record, or a screen that throws on open. Restarting alone " +
                "will walk straight back into it.",
            why = listOf(
                "crash.loop: $crashes crashes inside the window",
                "crash.loop: safe mode ${if (c.bool("safeMode")) "engaged" else "not engaged"}"
            ),
            remedies = listOf(
                Remediation(
                    id = "clear-crash-history",
                    title = "Clear the crash history",
                    detail = "Leaves safe mode so the app can start normally again. Do this after noting the last crash.",
                    risk = Risk.CONFIRM,
                    action = "clear-crash-history"
                )
            )
        )
    }

    private fun ruleBatteryOptimised(p: List<ProbeResult>): Diagnosis? {
        val b = p.byId("battery.optimization") ?: return null
        if (b.ok) return null
        return Diagnosis(
            id = "battery.optimised",
            title = "Battery optimisation may stop the server in the background",
            severity = Severity.MEDIUM,
            confidence = 0.75,
            cause = "While optimised, the OS is free to freeze or kill the foreground service, " +
                "which stops the server with no crash and no error anywhere.",
            why = listOf("battery.optimization: ${b.summary}"),
            remedies = listOf(
                Remediation(
                    id = "disable-battery-optimisation",
                    title = "Exempt LocalHub from battery optimisation",
                    detail = "Settings → Apps → LocalHub → Battery → Unrestricted. Also lock the app in the recent-apps list.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleAssetsMissing(p: List<ProbeResult>): Diagnosis? {
        val a = p.byId("assets.integrity") ?: return null
        if (a.ok) return null
        return Diagnosis(
            id = "assets.missing",
            title = "Dashboard files are missing from the app package",
            severity = Severity.HIGH,
            confidence = 0.95,
            cause = "The web dashboard is read from the APK's assets. Missing entries mean the " +
                "build shipped without them, so pages 404 no matter how healthy the server is.",
            why = listOf(
                "assets.integrity: missing ${a.strList("missing").joinToString(", ")}"
            ),
            remedies = listOf(
                Remediation(
                    id = "reinstall",
                    title = "Reinstall the app",
                    detail = "Reinstall from a build that packages the assets, then start the server again.",
                    risk = Risk.MANUAL
                )
            )
        )
    }

    private fun ruleDatabaseBroken(p: List<ProbeResult>): Diagnosis? {
        val d = p.byId("db.integrity") ?: return null
        if (d.ok) return null
        return Diagnosis(
            id = "db.broken",
            title = "The local database cannot be read",
            severity = Severity.HIGH,
            confidence = 0.9,
            cause = "Logs, settings and statistics live in Room. If it will not open, those " +
                "screens fail while the server keeps serving files.",
            why = listOf("db.integrity: ${d.summary}"),
            remedies = listOf(
                Remediation(
                    id = "reset-database",
                    title = "Reset the local database",
                    detail = "Clears logs, statistics and saved settings. Files on storage are untouched.",
                    risk = Risk.CONFIRM,
                    action = "reset-database"
                )
            )
        )
    }

    private fun ruleTlsUnavailable(p: List<ProbeResult>): Diagnosis? {
        val t = p.byId("https.cert") ?: return null
        if (t.ok) return null
        return Diagnosis(
            id = "tls.unavailable",
            title = "HTTPS is switched on but no certificate exists",
            severity = Severity.CRITICAL,
            confidence = 0.95,
            cause = "The server refuses to start rather than serve plaintext over a transport " +
                "the user asked to encrypt. That is fail-closed by design, and it looks exactly " +
                "like \"the server will not start\".",
            why = listOf("https.cert: ${t.summary}"),
            remedies = listOf(
                Remediation(
                    id = "disable-https",
                    title = "Turn HTTPS off",
                    detail = "Serves plain HTTP on the LAN again. Use only on a trusted network.",
                    risk = Risk.CONFIRM,
                    action = "disable-https"
                )
            )
        )
    }

    // ------------------------------------------------------------- security

    /**
     * Security is handled by the same engine rather than bolted beside it: the
     * threats below are derived from the same measurements as the faults, so a
     * locked-out address and a dead listener cannot contradict each other.
     */
    fun securityPosture(probes: List<ProbeResult>): SecurityPosture {
        val threats = mutableListOf<SecurityThreat>()
        val findings = mutableListOf<String>()
        var score = 100

        val auth = probes.byId("auth.threats")
        if (auth != null) {
            val locked = auth.strList("lockedOutIps")
            val failures = auth.int("recentFailures")
            val topSource = auth.str("topFailureSource")

            if (failures >= BRUTE_FORCE_THRESHOLD && topSource.isNotBlank()) {
                threats += SecurityThreat(
                    id = "brute-force",
                    kind = ThreatKind.BRUTE_FORCE,
                    severity = Severity.HIGH,
                    detail = "$failures failed sign-in attempts came from $topSource. " +
                        "That is someone guessing passwords, not a typo.",
                    source = topSource,
                    remedies = listOf(
                        Remediation(
                            id = "block-ip",
                            title = "Block $topSource",
                            detail = "Blocks the address at the server. It can still reach the login page, nothing else.",
                            risk = Risk.CONFIRM,
                            action = "block-ip",
                            args = mapOf("ip" to topSource)
                        ),
                        Remediation(
                            id = "invalidate-sessions",
                            title = "Sign out every session",
                            detail = "If a guess succeeded, this ends it. Everyone signs in again.",
                            risk = Risk.CONFIRM,
                            action = "invalidate-sessions"
                        )
                    )
                )
                findings += "Repeated failed sign-ins from $topSource"
                score -= 25
            }

            if (locked.isNotEmpty()) {
                threats += SecurityThreat(
                    id = "lockouts",
                    kind = ThreatKind.LOCKOUT,
                    severity = Severity.LOW,
                    detail = "Held for ${locked.joinToString(", ")} after too many failed attempts.",
                    source = locked.first(),
                    remedies = listOf(
                        Remediation(
                            id = "clear-lockouts",
                            title = "Clear the lockouts",
                            detail = "Lets those addresses try again. Only do this once you know who they are.",
                            risk = Risk.SAFE,
                            action = "clear-lockouts"
                        )
                    )
                )
                score -= 5
            }
        }

        val creds = probes.byId("credentials.hygiene")
        if (creds != null && !creds.ok) {
            val defaults = creds.strList("defaults")
            val weak = creds.strList("weak")
            if (defaults.isNotEmpty()) {
                threats += SecurityThreat(
                    id = "default-credentials",
                    kind = ThreatKind.DEFAULT_CREDENTIALS,
                    severity = Severity.CRITICAL,
                    detail = "The shipped default credentials are still in place (${defaults.joinToString(", ")}). " +
                        "Anyone who has read the project's documentation can sign in as an administrator.",
                    source = defaults.joinToString(", "),
                    remedies = listOf(
                        Remediation(
                            id = "force-credential-change",
                            title = "Change the credentials now",
                            detail = "Settings → Security. Set an administrator password that is not the documented default.",
                            risk = Risk.MANUAL
                        )
                    )
                )
                findings += "Default credentials still active"
                score -= 40
            }
            if (weak.isNotEmpty()) {
                threats += SecurityThreat(
                    id = "weak-credentials",
                    kind = ThreatKind.WEAK_CREDENTIALS,
                    severity = Severity.MEDIUM,
                    detail = "Password(s) for ${weak.joinToString(", ")} are shorter than 8 characters.",
                    source = weak.joinToString(", "),
                    remedies = listOf(
                        Remediation(
                            id = "strengthen-credentials",
                            title = "Use a longer password",
                            detail = "At least 8 characters, ideally a passphrase. This server is reachable by anyone on the Wi-Fi.",
                            risk = Risk.MANUAL
                        )
                    )
                )
                findings += "Weak password(s)"
                score -= 15
            }
        }

        val sessions = probes.byId("session.hygiene")
        if (sessions != null) {
            val active = sessions.int("activeSessions")
            val distinctIps = sessions.strList("distinctIps")
            val expired = sessions.int("expiredHeld")
            if (distinctIps.size >= 4 && active >= 4) {
                threats += SecurityThreat(
                    id = "session-spread",
                    kind = ThreatKind.SESSION_ANOMALY,
                    severity = Severity.MEDIUM,
                    detail = "$active live sessions from ${distinctIps.size} different addresses. " +
                        "Worth confirming they are all yours.",
                    source = distinctIps.joinToString(", "),
                    remedies = listOf(
                        Remediation(
                            id = "prune-sessions",
                            title = "Drop expired sessions",
                            detail = "Removes sessions that timed out but were never released.",
                            risk = Risk.SAFE,
                            action = "prune-sessions"
                        ),
                        Remediation(
                            id = "invalidate-sessions",
                            title = "Sign out every session",
                            detail = "Ends all of them. Anyone still connected must sign in again.",
                            risk = Risk.CONFIRM,
                            action = "invalidate-sessions"
                        )
                    )
                )
                findings += "Sessions from ${distinctIps.size} addresses"
                score -= 10
            } else if (expired > 0) {
                findings += "$expired expired session(s) still held"
                score -= 3
            }
        }

        score = score.coerceIn(0, 100)
        val grade = when {
            score >= 90 -> "A"
            score >= 75 -> "B"
            score >= 60 -> "C"
            score >= 40 -> "D"
            else -> "E"
        }
        return SecurityPosture(
            score = score,
            grade = grade,
            findings = findings,
            // Same ordering rule as diagnoses: rank 0 (CRITICAL) leads.
            threats = threats.sortedBy { rank(it.severity) }
        )
    }

    /** True when nothing needs an administrator to look at it. */
    fun healthy(probes: List<ProbeResult>, diagnoses: List<Diagnosis>, posture: SecurityPosture): Boolean =
        diagnoses.none { it.severity.let { s -> s == Severity.CRITICAL || s == Severity.HIGH } } &&
            posture.threats.none { it.severity == Severity.CRITICAL || it.severity == Severity.HIGH } &&
            probes.none { !it.ok && (it.severity == Severity.CRITICAL || it.severity == Severity.HIGH) }

    /** Actions Sentinel may take without asking. Everything else is proposed only. */
    fun autoApplicable(diagnoses: List<Diagnosis>, posture: SecurityPosture): List<Remediation> =
        (diagnoses.flatMap { it.remedies } + posture.threats.flatMap { it.remedies })
            .filter { it.risk == Risk.SAFE && it.action.isNotBlank() }
            .distinctBy { it.action + it.args }

    /** Actions that need an administrator to approve them in the console. */
    fun pendingApproval(diagnoses: List<Diagnosis>, posture: SecurityPosture): List<Remediation> =
        (diagnoses.flatMap { it.remedies } + posture.threats.flatMap { it.remedies })
            .filter { it.risk == Risk.CONFIRM }
            .distinctBy { it.action + it.args }

    /** Steps only a human can carry out, shown as guidance. */
    fun manualSteps(diagnoses: List<Diagnosis>, posture: SecurityPosture): List<Remediation> =
        (diagnoses.flatMap { it.remedies } + posture.threats.flatMap { it.remedies })
            .filter { it.risk == Risk.MANUAL }
            .distinctBy { it.id }

    fun applied(id: String, ok: Boolean, message: String, verified: Boolean = false): AppliedAction =
        AppliedAction(remedyId = id, ok = ok, message = message, verified = verified)
}
