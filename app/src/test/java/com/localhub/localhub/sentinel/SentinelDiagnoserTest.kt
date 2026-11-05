package com.localhub.localhub.sentinel

import com.localhub.localhub.sentinel.SentinelModels.ProbeResult
import com.localhub.localhub.sentinel.SentinelModels.Risk
import com.localhub.localhub.sentinel.SentinelModels.SentinelContext
import com.localhub.localhub.sentinel.SentinelModels.Severity
import com.localhub.localhub.sentinel.SentinelModels.ThreatKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sentinel's rules are pure, so they are tested on the JVM with no device.
 *
 * These tests are the contract: Sentinel may only report a fault it can point
 * at, and it may only auto-run a repair that is safe to run twice.
 */
class SentinelDiagnoserTest {

    private val ctx = SentinelContext(expectedRunning = true, port = 8080)

    private fun probe(
        id: String,
        ok: Boolean,
        sev: Severity = if (ok) Severity.OK else Severity.MEDIUM,
        evidence: Map<String, Any> = emptyMap()
    ) = ProbeResult(id, ok, sev, "", evidence)

    private fun baseline() = listOf(
        probe("port.bindable", true, evidence = mapOf("port" to 8080, "heldBySelf" to true)),
        probe("listener.alive", true),
        probe("lan.reachable", true, evidence = mapOf("lanOk" to true, "loopbackOk" to true)),
        probe("network.subnet", true, evidence = mapOf("type" to "WIFI", "ip" to "192.168.1.5",
            "subnetMask" to "255.255.255.0", "deviceSubnet" to "192.168.1.0",
            "clients" to emptyList<String>(), "clientsOnOtherSubnet" to emptyList<String>())),
        probe("storage.access", true),
        probe("memory.pressure", true, evidence = mapOf("usedPercent" to 40)),
        probe("crash.loop", true, evidence = mapOf("recentCrashes" to 0, "safeMode" to false)),
        probe("battery.optimization", true),
        probe("assets.integrity", true),
        probe("db.integrity", true),
        probe("https.cert", true, evidence = mapOf("httpsEnabled" to false)),
        probe("auth.threats", true, evidence = mapOf("recentFailures" to 0,
            "lockedOutIps" to emptyList<String>(), "topFailureSource" to "")),
        probe("credentials.hygiene", true, evidence = mapOf("defaults" to emptyList<String>(),
            "weak" to emptyList<String>())),
        probe("session.hygiene", true, evidence = mapOf("activeSessions" to 1, "expiredHeld" to 0,
            "distinctIps" to listOf("192.168.1.9")))
    )

    private fun replacing(vararg overrides: ProbeResult): List<ProbeResult> {
        val base = baseline().associateBy { it.id }.toMutableMap()
        overrides.forEach { base[it.id] = it }
        return base.values.toList()
    }

    // ---------------------------------------------------------------- faults

    @Test
    fun `a healthy system produces no diagnosis`() {
        val dx = SentinelDiagnoser.diagnose(baseline(), ctx)
        assertTrue("expected no faults, got ${dx.map { it.id }}", dx.isEmpty())
        val posture = SentinelDiagnoser.securityPosture(baseline())
        assertEquals(100, posture.score)
        assertEquals("A", posture.grade)
        assertTrue(SentinelDiagnoser.healthy(baseline(), dx, posture))
    }

    @Test
    fun `a dead listener is a critical fault with a safe restart`() {
        val probes = replacing(probe("listener.alive", false, Severity.CRITICAL))
        val dx = SentinelDiagnoser.diagnose(probes, ctx)
        val fault = dx.first { it.id == "listener.died" }
        assertEquals(Severity.CRITICAL, fault.severity)
        assertTrue(fault.confidence >= 0.9)
        assertTrue("must explain itself", fault.why.isNotEmpty())
        assertTrue(fault.cause.contains("accept loop", ignoreCase = true))
        val restart = fault.remedies.first { it.action == "restart-listener" }
        assertEquals(Risk.SAFE, restart.risk)
    }

    @Test
    fun `a dead listener is not reported when the port itself is blocked`() {
        // Otherwise two rules would fight over one symptom.
        val probes = replacing(
            probe("listener.alive", false, Severity.CRITICAL),
            probe("port.bindable", false, Severity.HIGH,
                mapOf("errno" to "EADDRINUSE", "port" to 8080, "suggestedPort" to 8081))
        )
        val dx = SentinelDiagnoser.diagnose(probes, ctx)
        assertTrue("port rule should own this", dx.none { it.id == "listener.died" })
        assertTrue(dx.any { it.id == "port.occupied" })
    }

    @Test
    fun `an occupied port suggests a free one and asks first`() {
        val probes = replacing(
            probe("port.bindable", false, Severity.HIGH,
                mapOf("errno" to "EADDRINUSE", "port" to 8080, "suggestedPort" to 8090)),
            probe("listener.alive", false, Severity.CRITICAL)
        )
        val fault = SentinelDiagnoser.diagnose(probes, ctx).first { it.id == "port.occupied" }
        val move = fault.remedies.first { it.action == "change-port" }
        assertEquals("8090", move.args["port"])
        assertEquals(Risk.CONFIRM, move.risk)
    }

    @Test
    fun `loopback only is reported as a LAN bind fault`() {
        val probes = replacing(
            probe("lan.reachable", false, Severity.HIGH, mapOf("lanOk" to false, "loopbackOk" to true))
        )
        val fault = SentinelDiagnoser.diagnose(probes, ctx).first { it.id == "lan.bind" }
        assertTrue(fault.why.any { it.contains("loopback") })
    }

    @Test
    fun `a reachable server with clients on another subnet blames the network`() {
        val probes = replacing(
            probe("network.subnet", true, Severity.MEDIUM, mapOf(
                "type" to "WIFI", "ip" to "192.168.1.5", "subnetMask" to "255.255.255.0",
                "deviceSubnet" to "192.168.1.0",
                "clients" to listOf("192.168.0.22"),
                "clientsOnOtherSubnet" to listOf("192.168.0.22")))
        )
        val fault = SentinelDiagnoser.diagnose(probes, ctx).first { it.id == "network.client-isolated" }
        assertEquals(Severity.MEDIUM, fault.severity)
        assertTrue("only a human can fix a router", fault.remedies.all { it.risk == Risk.MANUAL })
        assertTrue(fault.cause.contains("subnet", ignoreCase = true))
    }

    @Test
    fun `mobile data is reported as unreachable rather than broken`() {
        val probes = replacing(
            probe("network.subnet", false, Severity.HIGH, mapOf(
                "type" to "MOBILE", "ip" to "10.40.12.7", "subnetMask" to "255.255.255.0",
                "deviceSubnet" to "10.40.12.0",
                "clients" to emptyList<String>(), "clientsOnOtherSubnet" to emptyList<String>()))
        )
        val fault = SentinelDiagnoser.diagnose(probes, ctx).first { it.id == "network.carrier-nat" }
        assertEquals(Severity.HIGH, fault.severity)
        assertTrue(fault.cause.contains("NAT", ignoreCase = true))
    }

    @Test
    fun `default credentials are a critical threat and cost the most score`() {
        val probes = replacing(
            probe("credentials.hygiene", false, Severity.CRITICAL, mapOf(
                "defaults" to listOf("admin/admin"), "weak" to emptyList<String>()))
        )
        val posture = SentinelDiagnoser.securityPosture(probes)
        val threat = posture.threats.first { it.kind == ThreatKind.DEFAULT_CREDENTIALS }
        assertEquals(Severity.CRITICAL, threat.severity)
        assertTrue(posture.score <= 60)
        assertFalse(SentinelDiagnoser.healthy(probes, emptyList(), posture))
    }

    @Test
    fun `repeated failed logins from one address are a brute force threat`() {
        val probes = replacing(
            probe("auth.threats", false, Severity.HIGH, mapOf(
                "recentFailures" to 7,
                "lockedOutIps" to listOf("192.168.1.66"),
                "topFailureSource" to "192.168.1.66",
                "activeSessions" to 0))
        )
        val posture = SentinelDiagnoser.securityPosture(probes)
        val threat = posture.threats.first { it.kind == ThreatKind.BRUTE_FORCE }
        assertEquals("192.168.1.66", threat.source)
        val block = threat.remedies.first { it.action == "block-ip" }
        assertEquals("192.168.1.66", block.args["ip"])
        assertEquals(Risk.CONFIRM, block.risk)
    }

    @Test
    fun `a locked out address is still visible after its attempts are cleared`() {
        // On lockout the attempt counters are emptied, so the address would
        // vanish from the report unless the lockout map is read too.
        val probes = replacing(
            probe("auth.threats", false, Severity.LOW, mapOf(
                "recentFailures" to 0,
                "lockedOutIps" to listOf("192.168.1.66"),
                "topFailureSource" to "192.168.1.66",
                "activeSessions" to 0))
        )
        val posture = SentinelDiagnoser.securityPosture(probes)
        assertTrue(posture.threats.any { it.kind == ThreatKind.LOCKOUT })
        assertTrue(posture.threats.first { it.kind == ThreatKind.LOCKOUT }
            .remedies.any { it.action == "clear-lockouts" && it.risk == Risk.SAFE })
    }

    // ----------------------------------------------------------- gating

    @Test
    fun `only safe actions are auto applied`() {
        val probes = replacing(
            probe("listener.alive", false, Severity.CRITICAL),
            probe("port.bindable", false, Severity.HIGH,
                mapOf("errno" to "EADDRINUSE", "port" to 8080, "suggestedPort" to 8081))
        )
        val dx = SentinelDiagnoser.diagnose(probes, ctx)
        val posture = SentinelDiagnoser.securityPosture(probes)
        val auto = SentinelDiagnoser.autoApplicable(dx, posture)
        assertTrue("auto list must be SAFE only: ${auto.map { it.action }}", auto.all { it.risk == Risk.SAFE })
        val pending = SentinelDiagnoser.pendingApproval(dx, posture)
        assertTrue("pending list must be CONFIRM only", pending.all { it.risk == Risk.CONFIRM })
        assertTrue(pending.any { it.action == "change-port" })
    }

    @Test
    fun `a safe lockout clear is auto applied but blocking an address is not`() {
        val probes = replacing(
            probe("auth.threats", false, Severity.HIGH, mapOf(
                "recentFailures" to 9,
                "lockedOutIps" to listOf("192.168.1.66"),
                "topFailureSource" to "192.168.1.66",
                "activeSessions" to 0))
        )
        val posture = SentinelDiagnoser.securityPosture(probes)
        val dx = SentinelDiagnoser.diagnose(probes, ctx)
        val auto = SentinelDiagnoser.autoApplicable(dx, posture)
        assertTrue(auto.any { it.action == "clear-lockouts" })
        assertFalse("blocking must never be automatic", auto.any { it.action == "block-ip" })
        assertTrue(SentinelDiagnoser.pendingApproval(dx, posture).any { it.action == "block-ip" })
    }

    @Test
    fun `manual steps are surfaced as guidance not actions`() {
        val probes = replacing(
            probe("network.subnet", true, Severity.MEDIUM, mapOf(
                "type" to "WIFI", "ip" to "192.168.1.5", "subnetMask" to "255.255.255.0",
                "deviceSubnet" to "192.168.1.0",
                "clients" to listOf("192.168.0.22"),
                "clientsOnOtherSubnet" to listOf("192.168.0.22")))
        )
        val dx = SentinelDiagnoser.diagnose(probes, ctx)
        val manual = SentinelDiagnoser.manualSteps(dx, SentinelDiagnoser.securityPosture(probes))
        assertTrue(manual.isNotEmpty())
        assertTrue("manual steps must not be executable", manual.all { it.action.isBlank() })
    }

    @Test
    fun `diagnoses are ordered by severity then confidence`() {
        val probes = replacing(
            probe("listener.alive", false, Severity.CRITICAL),
            probe("battery.optimization", false, Severity.MEDIUM),
            probe("memory.pressure", false, Severity.MEDIUM, mapOf("usedPercent" to 95))
        )
        val dx = SentinelDiagnoser.diagnose(probes, ctx)
        assertTrue(dx.size >= 3)
        assertEquals("listener.died", dx.first().id)
        val severities = dx.map { it.severity }
        assertTrue("critical must come first", severities.first() == Severity.CRITICAL)
    }

    @Test
    fun `an unknown probe result never invents a fault`() {
        val dx = SentinelDiagnoser.diagnose(emptyList(), ctx)
        assertTrue(dx.isEmpty())
    }
}
