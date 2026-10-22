# LocalHub Patch Strategy Engine (v2.19)

> Status: ✅ IMPLEMENTED

## Purpose
Generate and rank multiple candidate repairs so the engine chooses the
**smallest safe root-cause fix**, and falls back to the next strategy when one
fails — all bounded.

## Strategy object
```
{ id, description, files[], changes, coverage, risk, scope,
  testability, regressionRisk, confidence, rankScore }
```

## Ranking (higher is better)
1. Root-cause coverage (×30)
2. Safety / low risk (×20)
3. Small scope preferred (×12)
4. Testability (×14)
5. Reversibility / low regression risk (×14)
6. Confidence (×10)

Preference: **SMALLEST SAFE ROOT-CAUSE FIX** over the largest code change
(verified: a small low-risk strategy ranks above a huge high-risk one).

## Patch failure → alternative
If Patch A's test fails, the loop analyzes why, rejects it, and selects the next
viable strategy — bounded by `maxPatchAttempts` (default 3). If all fail →
`ALL_PATCHES_REJECTED`, incident left for admin.

## Multi-file / dependency-aware
Before patching, `dependents()` identifies affected modules; important changes
add regression tests. Multi-file repairs use the atomic `Transaction` system —
never partial.

## Regression test
`generateRegressionTest` produces a test that fails before the patch and passes
after it.

## Verification
`run_debug_tests.js` sections 6, 7, 14, 15 — all PASS.
