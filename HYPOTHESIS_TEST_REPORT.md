# LocalHub v2.19 — Hypothesis Engine Test Report

> Generated 2026-08-10. Real assertions against the actual `SelfHeal.Debug` engine.

## Hypothesis tests (all PASS)
| Test | Assertion | Result |
|------|-----------|--------|
| 3a | bounded hypothesis set (≤4) with full metadata | ✅ |
| 3b | scoring + ranking | ✅ |
| 3c | evidence score computation | ✅ |
| 4a/4b | hypothesis rejection on fail, boost on pass | ✅ |
| 12a | Scenario A: H1 confirmed → patch → pass | ✅ |
| 13a | Scenario B: H1 rejected → H2 selected → pass | ✅ |
| 14a | Scenario C: Patch A rejected → Patch B selected → pass | ✅ |
| 15a | Scenario D: all patches rejected → unresolved → admin | ✅ |
| 16a | Scenario E: KNOWN_PATTERN + previous solution (validated) | ✅ |
| 17a | bounded loop (no infinite reasoning) | ✅ |

## Pattern intelligence
- `incidentSignature` stable & deterministic (same input → same signature).
- `matchKnownPattern` returns `KNOWN_PATTERN` / `SIMILAR_PATTERN` /
  `NEW_PATTERN`; prior solutions are surfaced but **never auto-reused without
  validation**.

## Local model interaction
- No model → `MODEL_ASSISTANCE_UNAVAILABLE` (no fake reasoning).
- Invalid model output (non-array possibleCauses) → `MODEL_OUTPUT_REJECTED`.
- Deterministic engine remains the authority for permissions/risk/workspace/
  backup/deploy/rollback/verify.

## Totals
Deep-debugging suite: **54/54 PASS** · Full project suite: **246/246 PASS**.
