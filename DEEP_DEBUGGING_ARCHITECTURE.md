# LocalHub Deep Autonomous Debugging — Architecture (v2.19)

> Status: ✅ IMPLEMENTED · 🟡 PARTIAL · ⭕ MODEL-DEPENDENT · 🔒 DEVICE-DEPENDENT

`SelfHeal.Debug` is a **bounded, evidence-driven software debugging engine** layered
on the SAME `SelfHeal` object. It does not replace the repair pipeline — it
decides **why** a patch is needed and **which** hypothesis/strategy to trust, then
hands the chosen fix to the existing safe pipeline.

## Debugging pipeline
```
OBSERVE -> SYSTEM UNDERSTAND -> HYPOTHESIZE -> TEST -> UPDATE CONFIDENCE ->
SELECT -> REPRODUCE -> ROOT CAUSE -> PATCH STRATEGY -> REGRESSION TEST ->
(BUILD -> VERIFY) -> LEARN
```

## Components

### 1. System Understanding (`buildDependencyMap`, `getModuleByFile`, `dependencies`, `dependents`) ✅
Lightweight module intelligence (no heavy static-analysis framework): a registry
of LocalHub modules (server, websocket, filesystem, auth, memory, context,
assistant, cognitive, selfheal, guardian, media, tts, automation, knowledge,
dashboard) with files, dependencies, and routes. New modules can be registered at
runtime. `buildDependencyMap` can scan `import/require` lines from source when a
live FS is present.

### 2. Error → Source Mapping (`mapError`) ✅
Given an exception/stack trace/compiler error/failed test, resolves affected
module, file, function hint, call chain, and dependent modules. Route strings are
mapped to modules. If no mapping is possible, returns `{ mapped:false,
uncertainty:true, confidence:0 }` instead of guessing.

### 3. Change Correlation (`correlateChanges`) ✅
Correlates an incident with recent patches/builds/deployments/regressions from
memory. Returns `LIKELY_CHANGE` or `NO_CHANGE_CORRELATION`. Never automatically
blames the latest change.

### 4. Multi-Hypothesis RCA (`buildHypotheses`, `scoreHypotheses`, `rankHypotheses`) ✅
Generates a **bounded set** of hypotheses (≤4) each with `{id, description,
evidenceFor, evidenceAgainst, confidence, affectedFiles, testMethod}`. Ranked by
an evidence score. Does not assume the first cause is correct.

### 5. Evidence-Driven Debugging ✅
Each hypothesis has supporting/contradicting evidence and a discriminating test.
`updateHypothesisConfidence` boosts on pass, rejects on fail.

### 6. Bounded Debugging Loop (`runDebugSession`) ✅
`OBSERVE → HYPOTHESIZE → TEST → UPDATE → SELECT → REPRODUCE → ROOT CAUSE →
PATCH`. Bounded by `maxInvestigationAttempts` (default 4). Never infinite.

### 7. Multi-File Root Cause ✅
The upstream/dependency hypothesis (H3) inspects the call chain rather than
patching only the first file in a stack trace (UI → API → Service → DB).

### 8. Dependency-Aware Patching ✅
`dependents()` identifies modules that could be affected before patching; the
selected strategy feeds regression tests; multi-file changes use the existing
atomic `Transaction` system (never partial).

### 9. Patch Strategy Generation + Ranking (`generatePatchStrategies`, `rankPatchStrategies`) ✅
Multiple candidate repairs (guard / init / lifecycle ordering) ranked by
coverage, safety, scope, testability, regression risk, confidence. Prefers the
**smallest safe root-cause fix** over the largest change.

### 10. Patch Failure → Alternative Repair ✅
If Patch A fails, the loop analyzes why, rejects it, and selects the next viable
strategy (bounded to `maxPatchAttempts`, default 3). If all fail →
`ALL_PATCHES_REJECTED`, incident left for admin.

### 11. Regression Test Generation (`generateRegressionTest`) ✅
Generates a test that reproduces the original failure: fails before the patch,
passes after.

### 12. Incident Signature + Regression Intelligence (`incidentSignature`, `matchKnownPattern`) ✅
Stable signature (error type + message pattern + component + function +
environment — no volatile timestamps). Returns `KNOWN_PATTERN` / `SIMILAR_PATTERN`
/ `NEW_PATTERN`; previous solutions are surfaced but **never reused without
validation**.

### 13/14. Local Model Assistance (`debugWithModel`) ✅ / ⭕ MODEL-DEPENDENT
Deterministic analysis remains authoritative (permissions/risk/workspace/backup/
deploy/rollback/verify). The local model only assists with hypotheses/patches/
explanations. With no model → `MODEL_ASSISTANCE_UNAVAILABLE` (no fake reasoning).
Invalid/unsafe model output → `MODEL_OUTPUT_REJECTED`.

### 15. Confidence Separation ✅
`confidences.evidence / rca / patch / verification` are tracked separately and
are evidence-based, never fabricated.

### 16. DebugSession Object ✅
`{sessionId, incidentId, startedAt, observations, hypotheses, tests, results,
selectedRootCause, candidatePatches, rejectedPatches, selectedPatch,
verification, finalOutcome, confidences}` — lets the Brain understand its
debugging process without exposing hidden reasoning.

### 17. Guardian Observations ✅
Guardian provides raw observations only (`ingestObservation`); RCA is owned by
the Debug engine. `classifyDeviceContext` separates device/environment causes
from code bugs.

## Safety
Never bypasses auth/authorization/security, deletes user data, modifies
credentials, modifies rollback/safety gates, executes arbitrary model-generated
shell, applies untested patches, or deploys when verification is unavailable for
the required risk level. Deterministic engine remains the authority.

---

## v2.19.1 — Hardening of the debugging loop

The deep-debugging loop now routes its chosen repair through the hardened
journaled transaction + safeguards: bounded hypothesis/attempt limits, quality
gates before commit, atomic multi-file application, and fail-safe rollback on any
failure. The debug session remains auditable and exposes only observed evidence,
never hidden reasoning.
