package com.localhub.localhub.sentinel

import com.localhub.localhub.sentinel.SentinelModels.AppliedAction
import com.localhub.localhub.sentinel.SentinelModels.SentinelContext
import com.localhub.localhub.sentinel.SentinelModels.SentinelReport
import com.localhub.localhub.util.AppLogger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sentinel's loop: measure, explain, fix, prove.
 *
 *   measure  -> [SentinelProbes]  facts + evidence
 *   explain  -> [SentinelDiagnoser] root causes with the chain that proves them
 *   fix      -> [SentinelRemediator] only what is safe, never without a risk class
 *   prove    -> measure again; an action is "verified" only if the diagnosis
 *               that produced it is gone
 *
 * The prove step is what separates this from the monitoring layer it replaced.
 * A repair that did not work is reported as a repair that did not work, and the
 * severity escalates - it never quietly retries forever.
 */
class SentinelEngine(
    private val probes: SentinelProbes,
    private val remediator: SentinelRemediator,
    private val logger: AppLogger
) {

    private val _lastReport = MutableStateFlow<SentinelReport?>(null)
    val lastReport: StateFlow<SentinelReport?> = _lastReport.asStateFlow()

    /** Consecutive failed auto-repairs per diagnosis id, so escalation is bounded. */
    private val failedAttempts = HashMap<String, Int>()
    private val maxAutoAttempts = 3

    suspend fun run(ctx: SentinelContext, autoRemediate: Boolean = true): SentinelReport {
        val started = System.currentTimeMillis()

        val before = probes.runAll(ctx)
        val diagnoses = SentinelDiagnoser.diagnose(before, ctx)
        val posture = SentinelDiagnoser.securityPosture(before)

        val remedyOwner = HashMap<String, String>()
        diagnoses.forEach { dx -> dx.remedies.forEach { remedyOwner[it.id] = dx.id } }
        posture.threats.forEach { th -> th.remedies.forEach { remedyOwner[it.id] = th.id } }

        val applied = mutableListOf<AppliedAction>()
        if (autoRemediate) {
            for (remedy in SentinelDiagnoser.autoApplicable(diagnoses, posture)) {
                val owner = remedyOwner[remedy.id].orEmpty()
                if ((failedAttempts[owner] ?: 0) >= maxAutoAttempts) {
                    applied += AppliedAction(remedy.id, false, "Gave up after $maxAutoAttempts attempts - needs an administrator")
                    continue
                }
                val (ok, message) = remediator.execute(remedy.action, remedy.args, approved = true)
                applied += AppliedAction(remedy.id, ok, message)
                logger.info(TAG, "Auto-repair '${remedy.id}': $message")
                if (!ok) failedAttempts[owner] = (failedAttempts[owner] ?: 0) + 1
            }
        }

        // Prove it. Re-measuring is the only way to know a fix took effect.
        if (applied.isNotEmpty()) {
            val after = probes.runAll(ctx)
            val afterDiagnoses = SentinelDiagnoser.diagnose(after, ctx)
            val afterThreats = SentinelDiagnoser.securityPosture(after).threats.map { it.id }.toSet()
            val stillBroken = afterDiagnoses.map { it.id }.toSet()
            val verifiedApplied = applied.map { a ->
                val owner = remedyOwner[a.remedyId].orEmpty()
                val verified = a.ok && owner !in stillBroken && owner !in afterThreats
                a.copy(verified = verified)
            }
            applied.clear()
            applied.addAll(verifiedApplied)
            val finalDiagnoses = afterDiagnoses
            val finalPosture = SentinelDiagnoser.securityPosture(after)
            return finish(finalDiagnoses, finalPosture, applied, ctx, started, after)
        }

        return finish(diagnoses, posture, applied, ctx, started, before)
    }

    private fun finish(
        diagnoses: List<SentinelModels.Diagnosis>,
        posture: SentinelModels.SecurityPosture,
        applied: List<AppliedAction>,
        ctx: SentinelContext,
        started: Long,
        latest: List<SentinelModels.ProbeResult>
    ): SentinelReport {
        val healthy = SentinelDiagnoser.healthy(latest, diagnoses, posture)
        val report = SentinelReport(
            generatedAt = System.currentTimeMillis(),
            healthy = healthy,
            expectedRunning = ctx.expectedRunning,
            probes = latest,
            diagnoses = diagnoses,
            autoApplied = applied,
            pending = SentinelDiagnoser.pendingApproval(diagnoses, posture),
            security = posture,
            durationMs = System.currentTimeMillis() - started
        )
        _lastReport.value = report
        if (!healthy) {
            logger.warn(
                TAG,
                "Unhealthy: ${diagnoses.size} fault(s), security ${posture.grade} (${posture.score}). " +
                    diagnoses.firstOrNull()?.let { "First: ${it.id} - ${it.title}" }.orEmpty()
            )
        }
        return report
    }

    /** Clears the escalation counters after an administrator fixes things by hand. */
    fun resetEscalation() = failedAttempts.clear()

    private val TAG = "Sentinel"
}
