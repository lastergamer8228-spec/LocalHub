# LocalHub Debug Session (v2.19)

> Status: ✅ IMPLEMENTED

## Purpose
Track a debugging investigation as a first-class object so the Brain can
understand and report its own debugging process — **without exposing hidden
chain-of-thought**.

## Object
```
{ sessionId, incidentId, startedAt, completedAt,
  observations[], hypotheses[], tests[], results[],
  selectedRootCause, candidatePatches[], rejectedPatches[],
  selectedPatch, verification, finalOutcome,
  confidences: { evidence, rca, patch, verification }, logs[] }
```

## Lifecycle
- `createSession(incident)` → started.
- Debug loop appends observations, hypotheses, tests, results.
- `finalOutcome`: `running` → `resolved` | `unresolved` | `all_patches_rejected`.

## Commands
`debug incident <id>`, `hypotheses`, `known pattern` (in `/ai` assistant).

## Honesty
- Session exposes what was observed, tested, selected, and rejected — not hidden
  reasoning.
- Confidence values are evidence-based, never fabricated.

## Verification
`run_debug_tests.js` section 10 — PASS.
