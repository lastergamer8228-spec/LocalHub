package com.localhub.localhub.sentinel

/**
 * Sentinel data model.
 *
 * Sentinel is LocalHub's administrative fault system. It is deliberately split
 * in three so the part that decides is testable on the JVM:
 *
 *   1. **Probes**  - measurements. They never guess; they report a fact plus
 *                    the evidence that produced it.
 *   2. **Diagnoser** - pure rules over probe results. It names a *root cause*
 *                    and shows the evidence chain that led there.
 *   3. **Remediator** - actions. Each carries a risk class, so an automatic
 *                    fix can never do something only an administrator should
 *                    authorise.
 *
 * The old self-healing layer only watched metrics and restarted after a crash.
 * That is monitoring, not healing: it could tell you *that* something was wrong
 * but never *why*, and it could not fix anything it had not already crashed on.
 */
object SentinelModels {

    enum class Severity { OK, INFO, LOW, MEDIUM, HIGH, CRITICAL }

    /**
     * What the user asked for, as opposed to what the system measured.
     * Kept out of the probes so the diagnoser stays a pure function.
     */
    data class SentinelContext(
        val expectedRunning: Boolean = false,
        val port: Int = 8080,
        val protocol: String = "http"
    )

    /** How much authority an action needs before Sentinel may run it. */
    enum class Risk {
        /** Idempotent and reversible - Sentinel runs it on its own. */
        SAFE,

        /** Changes something the user would notice - needs an admin decision. */
        CONFIRM,

        /** Only the human or the OS can do it - Sentinel explains the steps. */
        MANUAL
    }

    /** One measurement. [evidence] is the raw material of the "why". */
    data class ProbeResult(
        val id: String,
        val ok: Boolean,
        val severity: Severity = Severity.OK,
        val summary: String = "",
        val evidence: Map<String, Any> = emptyMap(),
        val durationMs: Long = 0
    )

    /** A fix, described before it is run so an admin can refuse it. */
    data class Remediation(
        val id: String,
        val title: String,
        val detail: String,
        val risk: Risk,
        /** Machine action id executed by [SentinelRemediator]; "" when MANUAL. */
        val action: String = "",
        val args: Map<String, String> = emptyMap()
    )

    /** A root cause, with the chain of evidence that proves it. */
    data class Diagnosis(
        val id: String,
        val title: String,
        val severity: Severity,
        /** 0.0 - 1.0. Below [SentinelDiagnoser.CONFIDENCE_FLOOR] it is not reported. */
        val confidence: Double,
        /** Plain-language root cause, not the symptom. */
        val cause: String,
        /** Ordered evidence chain: probe id -> what it showed. */
        val why: List<String>,
        val remedies: List<Remediation>
    )

    /** What Sentinel did on its own, and whether re-probing proved it worked. */
    data class AppliedAction(
        val remedyId: String,
        val ok: Boolean,
        val message: String,
        val verified: Boolean = false,
        val at: Long = System.currentTimeMillis()
    )

    enum class ThreatKind {
        BRUTE_FORCE,
        DEFAULT_CREDENTIALS,
        WEAK_CREDENTIALS,
        LOCKOUT,
        UNKNOWN_SOURCE,
        SESSION_ANOMALY,
        EXPOSED_ENDPOINT
    }

    data class SecurityThreat(
        val id: String,
        val kind: ThreatKind,
        val severity: Severity,
        val detail: String,
        /** IP address, account name or endpoint - whatever the threat attaches to. */
        val source: String = "",
        val remedies: List<Remediation> = emptyList()
    )

    data class SecurityPosture(
        /** 100 = nothing found, 0 = critical exposure. */
        val score: Int,
        val grade: String,
        val findings: List<String>,
        val threats: List<SecurityThreat>
    )

    /** Full report handed to the dashboard and to the audit log. */
    data class SentinelReport(
        val generatedAt: Long = System.currentTimeMillis(),
        val healthy: Boolean,
        val expectedRunning: Boolean,
        val probes: List<ProbeResult>,
        val diagnoses: List<Diagnosis>,
        val autoApplied: List<AppliedAction>,
        val pending: List<Remediation>,
        val security: SecurityPosture,
        val durationMs: Long
    )
}
