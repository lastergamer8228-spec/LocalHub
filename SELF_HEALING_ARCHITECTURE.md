# LocalHub Self-Healing Architecture

> Status labels: ✅ IMPLEMENTED · 🟡 PARTIAL · ⭕ OPTIONAL · ❌ NOT IMPLEMENTED

The Self-Healing Engine (`selfheal.js`, `global.LH_AI.SelfHeal`) is a **controlled,
local, safe** software diagnostic + repair system for LocalHub. It is **not**
uncontrolled self-modification.

## Core Lifecycle

```
EVIDENCE → ROOT CAUSE → PATCH → TEST → BACKUP → DEPLOY → VERIFY
        → ROLLBACK IF NECESSARY → LEARN
```

## Repair Levels

| Level | Name | Behavior | Status |
|-------|------|----------|--------|
| 0 | OBSERVE | Detect + report | ✅ |
| 1 | SAFE RECOVERY | Restart service / reconnect / clear cache / retry | 🟡 (guarded by policy) |
| 2 | DIAGNOSTIC | Collect evidence + root cause | ✅ |
| 3 | PATCH PROPOSAL | Generate fix, await approval | ✅ |
| 4 | AUTOMATED PATCH | Trusted low-risk + all tests pass | 🟡 (needs build toolchain) |
| 5 | CRITICAL | Auth/security/migration/storage — admin approval only | ✅ (gate enforced) |

## How it works

1. **Detect** — via Guardian + `Cognitive` events + assistant reports.
2. **Significance gate** — a single harmless error is ignored; uses frequency ×
   severity (≥3 triggers).
3. **Incident** — created with `{incidentId, timestamp, severity, component,
   error, stackTrace, environment, frequency, state...}`.
4. **Evidence** — logs + recent actions + system state captured.
5. **RCA** — deterministic signature → likely causes; **honest about confidence**.
6. **Oversight** — uncertain or critical → await administrator. No blind patching.
7. **Test** — static checks offline; full build/unit/integration/QA needs the
   Android toolchain (honestly reported).
8. **Backup** — restorable snapshot before deploy.
9. **Deploy/Verify/Rollback** — gated; rollback restores last known good.

## Integration

- `Cognitive.selfHeal(detection)` routes into the engine.
- Guardian detections can feed incidents.
- Assistant commands: `diagnose`, `report an incident`, `list incidents`,
  `approve fix`, `rollback`, `self-healing status`, goals.
- Resolved incidents become **procedural self-healing memory** (reuse known-safe
  recovery for similar signatures).
- Every fix can create a **regression test** (stored in `regressions`).

---

© LocalHub — autonomous when safe, supervised when risky.

---

## File-Level Patch Engine (v2.16.1) — ✅ IMPLEMENTED (deterministic; FS-gated)

A real, safe, auditable file-level repair subsystem under `SelfHeal.FileEngine`:

- **Hashing** — SHA-256 when `crypto.subtle` is available, deterministic FNV-1a
  fallback otherwise.
- **Patch object** — `{patchId, incidentId, level, reason, files, beforeHash,
  afterHash, diff, expectedBehavior, risk, createdAt, approvedBy, status}`.
- **Patch safety** — validates target: rejects path traversal (`..`), enforces an
  **allowed workspace** (LocalHub app dirs), rejects outside/unknown paths, never
  runs arbitrary shell commands, never executes model-generated code.
- **Critical file detection** — matches against the **filename** (auth, security,
  keystore, credentials, secrets, etc.) so normal folders aren't falsely flagged.
- **Real diff** — human-readable `---/+++` per-line diff.
- **Real backup** — snapshot with original content + before-hash.
- **Real rollback** — restores exact content, **verifies hash** after restore;
  on mismatch returns `ROLLBACK_FAILED` (does not claim recovery).
- **Honest testing** — `testFilePatch` returns level `STATIC` with explicit
  `limitations` (no fake "passed"); unavailable build/device layers are reported
  as `BUILD_REQUIRED` / `DEVICE_VERIFICATION_REQUIRED`.
- **Full lifecycle** `runFileFix`: read → hash → diff → approval gate (level ≥4
  and critical files require admin) → static test → backup → apply → verify →
  auto-rollback on failure.
- **Engine self-diagnosis** — `engineSelfDiagnose()` reports engine health and
  what it can/cannot do in the current context.

### File-level status codes (honest)
`NOT_EXECUTED`, `NOT_SUPPORTED`, `STATIC_ONLY`, `BUILD_REQUIRED`,
`DEVICE_VERIFICATION_REQUIRED`, `HASH_MISMATCH`, `ROLLED_BACK`, `ROLLBACK_FAILED`,
`AWAITING_APPROVAL`, `VERIFIED`, `CRITICAL_FILE`, `PATH_TRAVERSAL`,
`OUTSIDE_WORKSPACE`.

### Android build / device status
- **Android build executed:** ❌ (no SDK in this environment).
- **APK generated:** ❌
- **APK installed:** ❌
- **Device tested:** ❌
- **Self-Healing readiness:** `LOCAL_TEST_READY` — the engine logic is
  deterministic and test-verified (26/26 headless file-level tests), but has not
  been built/deployed/verified on a real Android device.

---

## v2.17 — Full Autonomy + Reproduction + Build/Device Mechanisms (2026-08-10)

Implemented on the same `SelfHeal` object (no duplicate brain):

- **Autonomy levels L0–L5 actually wired** into `handleDetection`:
  L1 safe-recovery (reconnect/retry/clear-cache) for non-critical signatures,
  L2 diagnostic RCA, L3 proposal, L4 automated gate (tests pass, not critical),
  L5 critical = admin approval only.
- **Reproduction (Phase 7)** — `reproduceIncident()` with honest statuses
  (`REPRODUCED`, `NOT_REPRODUCIBLE`, `NOT_EXECUTED`). Never patches an
  unreproducible issue without evidence/admin.
- **Local Model Provider (Phase 3)** — vendor-neutral adapter exposing
  `analyzeIncident / proposePatch / explainRCA / generateTests / plan` +
  `setLocalModelProvider()`. No hard-coded vendor, no cloud dependency.
  Deterministic fallback remains and is honest about not being an LLM.
- **Regression runner (Phase 12/13)** — `createRegressionTest()` + `runRegressions()`
  that actually execute stored regression tests.
- **Incident-memory safe reuse (Phase 13)** — `findKnownIncident()` +
  `validateReuse()` (signature must match; critical reuse requires admin).
- **Safe Android build pipeline (Phase 10)** — `BuildRunner` runs ONLY the
  allowlist (`./gradlew test/assembleDebug/lint/compileDebugKotlin`), captures
  command/exit/stdout/stderr/duration/timestamp, feeds build failures into
  incidents. Honest `BUILD_REQUIRED` when no toolchain.
- **Device verification workflow (Phase 11)** — `verifyDevice()` enumerates the
  12 on-device checks; reports `DEVICE_VERIFICATION_REQUIRED` (never green)
  without an attached device.
- **Unified detection feed (Phase 5)** — `ingestDetection()` covers crashes,
  exceptions, API/WebSocket/automation/DB/server failures, resource exhaustion,
  UI/background/QA/regression failures, with a severity×frequency threshold.
- **Self-healing self-test (Phase 16)** — a controlled failure is deliberately
  introduced, then the engine detects → RCA → reproduce → propose → test →
  backup → apply → verify → parse-check, proving it repairs a known bug.

### Verification
- **Headless engine tests: 67/67 pass** (self-healing). Real assertions against
  the actual engine with a mock FS/Memory.
- **Android build executed:** ❌ (no SDK). **APK/install/device:** ❌.
  Reported honestly as `BUILD_REQUIRED` / `DEVICE_VERIFICATION_REQUIRED`.
- **Readiness:** `LOCAL_TEST_READY` + safe Android-build/device mechanisms in place.
  Becomes `DEVICE_VERIFIED` only after a real device run.

---

## v2.19.1 — Production Hardening (final pass, architecture frozen)

Added hardening to the SAME `SelfHeal` object (`SelfHeal.Harden`). No new engine.

- **Journaled atomic transactions** (`Harden.runJournaledRepair`): a multi-file
  repair is ONE transaction with durable states PREPARED → BACKED_UP → APPLYING →
  APPLIED → VERIFYING → COMMITTED, and failure branches → ROLLING_BACK →
  ROLLED_BACK / ROLLBACK_FAILED / ABORTED. All files are backed up BEFORE any
  modification. Every stage is written to a durable journal.
- **Crash-safe recovery** (`Harden.recoverFromJournal`): on startup, scans the
  journal for incomplete transactions, verifies hashes, restores last-known-good,
  closes the transaction. Never assumes a prior operation completed.
- **Path/canonical security** (`resolveCanonical`, `isPathEscape`,
  `assertSafePath`): rejects `../`, absolute-outside, canonical/symlink/junction
  escapes.
- **Protected files** (`isProtectedPath`): rollback engine, journal, SelfHeal
  gates, update/deploy, credentials, core storage, migration, security → L5/admin.
- **Scope limits** (`checkScopeLimits`): max files/lines/bytes/attempts; exceeded
  → STOP + admin.
- **Quality gates** (`runQualityGates`): path/syntax/static/expected/regression/
  integration/build/post-build/runtime. A patch cannot commit just because build
  succeeds.
- **Cooldown + repair-storm prevention** (`isCoolingDown`): repeated failed
  repairs escalate to admin; auto-repair stops.
- **Watchdog** (`watchdogCheckForRegression`): detects post-deploy regressions,
  stops repairs, rolls back, marks patch unsafe.
- **Corruption detection** (`detectCorruption`): fail-safe on unexpected hash /
  missing backup / incomplete transaction / partial patch / invalid APK / etc.
- **Backup + rollback validation** (`validateBackup`, `validateRollback`):
  success only after verification.
- **Repair policy** (`loadPolicy`/`setPolicy`): admin-only, conservative defaults.
- **Audit trail** (`auditRecord`/`listAudit`): every repair action recorded;
  never silently modified.
- **Safeguarded repair entry** (`runRepairWithSafeguards`): policy + scope +
  cooldown + gates + journal + audit in one hardened path.

### Verification
- **292/292 headless tests pass** (246 preserved + 46 hardening). No regression.
- **Android build / APK / device:** 🔒 BLOCKED (no SDK/device) — honest.
- **Status:** `LOCAL_TEST_READY`. Architecture frozen after this release.
