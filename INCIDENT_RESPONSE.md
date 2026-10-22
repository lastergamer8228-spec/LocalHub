# LocalHub Incident Response

> Status labels: ✅ IMPLEMENTED · 🟡 PARTIAL · ⭕ OPTIONAL · ❌ NOT IMPLEMENTED

## Incident Object

Each detected failure becomes an incident:

```
{ incidentId, timestamp, severity, component, error, stackTrace,
  environment, frequency, reproducible, rootCause, candidateFix,
  patchId, testStatus, deploymentStatus, rollbackStatus, state,
  logs[], evidence[], createdAt, updatedAt }
```

States: `detected → diagnosing → reproduced → proposing → testing → backing_up →
deploying → verified → rolled_back → rejected → resolved`.

## Response Flow

1. **Detect** — Guardian / events / user report.
2. **Significance gate** — ignore single harmless errors.
3. **Create incident** + capture evidence (logs, system state).
4. **Diagnose** — deterministic RCA; **honest confidence**.
5. **Reproduce** — if uncertain, gather more evidence or ask admin; don't blindly
   modify production.
6. **Propose fix** — candidate patch with reason, before/after, expected behavior,
   risk, test plan.
7. **Test** — static checks (offline); full build/QA needs SDK.
8. **Backup** — restorable snapshot.
9. **Deploy + verify** — gated; rollback if verify fails.
10. **Learn** — store procedural knowledge + regression test.

## Human Oversight

Ask the administrator when: confidence is low, impact is high, data loss is
possible, security changes are required, root cause is uncertain, tests are
incomplete, or rollback is unavailable.

---

© LocalHub — nothing hidden, nothing falsely claimed.

---

## v2.17 — Response flow additions

- **Detection feed** — `SelfHeal.ingestDetection(kind, error, meta)` unifies
  detection of crashes, exceptions, API/WebSocket/automation/DB/server failures,
  resource exhaustion, UI/background/QA/regression failures, with a
  severity×frequency gate. Guardian calls it and also emits Cognitive events.
- **Reproduction** — `reproduceIncident()` runs a safe, deterministic
  reproduction and only patches what it can reproduce (`REPRODUCED`); otherwise
  it collects evidence or asks admin (`NOT_REPRODUCIBLE` / `NOT_EXECUTED`).
- **Safe-recovery (L1)** — non-critical signatures may trigger reconnect/retry/
  clear-cache without touching files.
- **Regression runner** — resolved fixes' regression tests are actually executed
  by `runRegressions()` on later runs.
- **Known-incident reuse** — `findKnownIncident` + `validateReuse` (safe, admin
  on critical).

### Verification
- Incident lifecycle, rollback, hash-mismatch abort, approval gates, reuse
  safety and the controlled-failure self-test all pass headlessly (67/67).

---

## v2.19.1 — Hardened response flow

Repairs are now routed through `runRepairWithSafeguards`: policy check → scope
limits → cooldown/repair-storm gate → quality gates → journaled atomic
transaction → audit. A repaired incident that triggers immediate repeated
failures is caught by the Watchdog (stop → rollback → mark unsafe). Corruption
detection fail-safes on unexpected state. Every step is auditable and bounded.
