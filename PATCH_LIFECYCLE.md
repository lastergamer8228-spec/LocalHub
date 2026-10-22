# LocalHub Patch Lifecycle

> Status labels: ✅ IMPLEMENTED · 🟡 PARTIAL · ⭕ OPTIONAL · ❌ NOT IMPLEMENTED

## Patch Object

```
{ patchId, incidentId, files[], reason, beforeAfter, expectedBehavior,
  risk, testPlan[], status, created }
```

Status: `proposed → testing → passed/failed → deployed → rolled_back`.

## Lifecycle (every fix)

1. **Generate** — candidate patch with affected files, reason, before/after,
   expected behavior, risk, test plan.
2. **Test** — static checks offline (files list, documented, expected behavior).
   Full build/unit/integration/regression/QA requires the Android toolchain — the
   engine reports this honestly and does **not** claim a real build it did not run.
3. **Reject** if any critical test fails.
4. **Backup** — create a restorable snapshot (`backups` store).
5. **Deploy** (gated) — only trusted, low-risk, tested changes; critical →
   admin approval.
6. **Verify** — server/core/assistant/API/WebSocket/auth checks.
7. **Rollback** — automatic if post-deploy verification fails; restore last known
   good; verify rollback; report.
8. **Document** — store incident + outcome.
9. **Regression test** — created when practical (`regressions` store) for future
   protection.

## Status in this sandbox

- **Static checks**: ✅
- **Backup / rollback / incident / RCA / approval gating**: ✅
- **Real Android build + on-device QA**: ❌ (requires Android SDK / device — not
  available here; the engine correctly reports this rather than faking it).

---

© LocalHub — a safe, testable, reversible patch pipeline.

---

## File-Level Patch Lifecycle (v2.16.1) — ✅ IMPLEMENTED (deterministic)

```
read file → before-hash → diff → approval gate (L4+/critical=admin)
→ static test → backup(snapshot+hash) → apply → after-hash → verify
→ VERIFIED | (verify fail → rollback → ROLLED_BACK | ROLLBACK_FAILED)
```

Patch always carries: affected files, before/after hashes, human-readable diff,
reason, expected behavior, risk, tests, and rollback snapshot id. Nothing is
applied without the before-hash matching and (where required) admin approval.

## Status in this sandbox
- **Static/deterministic file-level tests:** ✅ (26/26 pass).
- **Real Android build / deploy / device QA:** ❌ (no SDK/device) — reported as
  `BUILD_REQUIRED` / `DEVICE_VERIFICATION_REQUIRED`.

---

## v2.17 — Patch testing + build/device status

- **Static tests:** ✅ 67/67 headless file-level + lifecycle tests pass.
- **Build allowlist runner:** implemented (`runBuildCommand`, `buildLocalHub`).
  Without the Android SDK it honestly returns `BUILD_REQUIRED`; build failures
  feed back into incidents for safe repair.
- **Regression tests:** `runRegressions()` actually executes stored regressions.
- **Real Android build / deploy / device QA:** ❌ (no SDK/device in sandbox) —
  reported as `BUILD_REQUIRED` / `DEVICE_VERIFICATION_REQUIRED`. Not faked.

---

## v2.19.1 — Hardened patch lifecycle

Multi-file patches are now **atomic, journaled transactions**:
`PREPARED → BACKED_UP → APPLYING → APPLIED → VERIFYING → COMMITTED`, with
rollback branches `ROLLING_BACK → ROLLED_BACK / ROLLBACK_FAILED / ABORTED`. All
files are backed up first, every stage is journaled, and on any failure every
modified file is restored (never partial). Crash-safe recovery restores
last-known-good from the journal on next startup. Patch quality gates
(path/syntax/static/expected/regression/build/verify) must pass — a successful
build alone is not proof of a fix.
