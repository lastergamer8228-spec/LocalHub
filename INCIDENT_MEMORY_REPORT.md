# LocalHub v2.17.1 — Incident Memory Report

> Generated 2026-08-10. Verifies that after a successful (or rolled-back) repair,
> a complete structured incident record is persisted and safely reused later.

## Stored record (per repaired incident)
Each resolved/rolled-back incident stores all of:
- incidentId, component, severity, error, state
- **rootCause** (causes + confidence)
- **evidence** (logs)
- **affectedFiles**
- **patch** (patchId, reason, diff, status)
- **result** / **pipelineStatus** (VERIFIED | ROLLED_BACK | ROLLBACK_FAILED | TEST_FAILED)
- **rollback** (whether rolled back)
- **regressionTest**
- timestamp

## Safe reuse (Phase 13)
- `findKnownIncident()` — finds a previously-resolved incident with the same
  signature (component + error).
- `validateReuse()` — refuses reuse unless the signature matches; refuses
  auto-reuse on **critical** components (requires admin). This prevents blind
  replay of an old patch against changed files.

## Verified by automated tests
- 2a: incident memory recorded with structured fields (result, affectedFiles,
  rootCause/evidence/patch present). ✅
- 17 (selfheal suite): known incident found; non-critical reuse validated;
  critical reuse requires admin. ✅
- 2/4 (E2E): success scenario stores memory; rollback scenario stores memory. ✅

## Behavior
- A single harmless one-off failure is observed but NOT recorded as an incident
  (significance gate).
- Repeated / high-severity failures become incidents and are remembered.
- Memory is stored in the same `incidents` layer used by the rest of the engine
  (no duplicate store) and survives reload via the persistent memory layer.
