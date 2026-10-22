# LocalHub v2.18 — Self-Healing End-to-End Integration Report

> Generated 2026-08-10 · **45/45 E2E integration tests pass** · **192/192 total**
> across all four headless suites (67 self-healing + 27 cognitive + 45 E2E +
> 53 real-device integration). Real assertions against the actual engine with a
> mock FS/Memory and a mock adb/Gradle/ShellRuntime.

## What was integrated (end-to-end)
The FileEngine is now wired into a full **maintenance subsystem** through one
orchestrator, `SelfHeal.runIncidentPipeline`, and the Guardian feeds it. The flow:

```
Guardian detects (never writes source)
   -> ingestDetection() / ingest()
   -> incident created
   -> evidence collected
   -> affected component + affected files (read-only resolve)
   -> read relevant source
   -> root-cause analysis (deterministic + optional local model)
   -> candidate patch (FileEngine)
   -> static validation
   -> regression test created
   -> backup (snapshot + hash)
   -> apply (before-hash checked)
   -> verify (hash + optional functional check)
   -> KEEP (VERIFIED)  OR  ROLLBACK (ROLLED_BACK / ROLLBACK_FAILED)
   -> structured incident memory stored
```

## Acceptance scenarios (automated)

### Scenario A — SUCCESS: controlled bug fully repaired
1. BUG injected (safe test workspace)
2. DETECTED → 3. INCIDENT → 4. EVIDENCE → 5. RCA → 6. PATCH → 7. REGRESSION →
8. BACKUP → 9. PATCH DEPLOYED → 10. VERIFICATION → 11. SUCCESS → 12. INCIDENT MEMORY
- Verified: pipeline status `VERIFIED`, auditable steps present (detect, incident,
  evidence, affected-files, root-cause, patch, regression, backup, apply, verify),
  test file contains the GOOD content.

### Scenario B — FAILURE: patch applies but functional verification fails
- Verified: pipeline status `ROLLED_BACK`, file restored to last-known-good,
  rollback step recorded, incident memory stored.

### Scenario C — REJECT: patch fails static validation
- Verified: pipeline status `TEST_FAILED`, file left untouched, never deployed.

### Approval + deploy (L4)
- Verified: an L4 patch enters `AWAITING_APPROVAL` (no admin) → after
  `approveAndDeploy(id, "admin")` it becomes `VERIFIED` and the file is deployed.

## Security verified
- Path traversal (`..`) rejected **before** any read → `PATH_TRAVERSAL`.
- Absolute path outside workspace rejected → `OUTSIDE_WORKSPACE`.
- `isPathTraversal` / `inAllowedRoot` unit checks pass.
- Symlink-escape protection is enforced by the same workspace-allowlist + no-`..`
  rules (symlink *resolution* itself is out of scope for the JS engine; a real
  device filesystem canonicalizes paths before use — documented limitation).

## Autonomy + Guardian verified
- `Guardian.decide()`: critical → L5, low → L1, and **never modifies source**
  (`sourceModified:false`). Guardian DETECTS, SelfHeal DECIDES.
- `Guardian.ingest()` forwards detections; repeated critical failures open an
  incident; single low-weight failures are observed-only (threshold).
- `guessAutonomyLevel`: auth/security → L5; critical → L2; medium/low → L1.
- `canAutoRepair` is never true for critical components.

## Build feedback loop verified
- `repairBuildWithBound` is **bounded** (≤3 attempts) and honest: without an SDK
  the build reports `BUILD_REQUIRED`; non-allowlisted commands → `NOT_ALLOWED`.
- `runBuildCommand` only ever runs the allowlist.

## Cognitive brain integration verified
- "why did LocalHub crash?" → retrieves incident + RCA + confidence + status.
- "fix it" → non-admin blocked; admin receives a repair plan (goal) + initiates
  the appropriate SelfHeal level.

## Android limitation (honest)
- Real Android build / APK / device verification were **not run** in this sandbox
  (no SDK / device) and are reported as `BUILD_REQUIRED` /
  `DEVICE_VERIFICATION_REQUIRED`. Nothing here claims on-device verification.
