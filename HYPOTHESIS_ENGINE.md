# LocalHub Hypothesis Engine (v2.19)

> Status: ✅ IMPLEMENTED

## Purpose
Generate, score, rank, test, and reject multiple root-cause hypotheses in a
bounded, evidence-driven way.

## Hypothesis object
```
{ id, description, evidenceFor[], evidenceAgainst[], confidence,
  affectedFiles[], testMethod, rejected, score, lastTest }
```

## Behavior
- **Bounded set** (default ≤4) — never an unbounded search.
- **Ranking** by evidence score (confidence + supporting − contradicting).
- **Testing**: each hypothesis has a discriminating test. Pass boosts confidence;
  fail marks it rejected.
- **Alternative selection**: the debug loop moves to the next viable hypothesis
  when the current one is rejected (Scenario B).
- **No fake intelligence**: hypotheses are generated deterministically from the
  error signature + system understanding; the local model may add evidence but
  never replaces the deterministic set.

## Controlled scenarios (verified)
- A: one obvious bug → H1 confirmed → patch → pass.
- B: wrong first hypothesis → H1 rejected → H2 selected → patch → pass.
- C: first patch fails → Patch A rejected → Patch B → pass.
- D: no valid patch → bounded attempts exhausted → incident unresolved → admin.
- E: recurring known incident → KNOWN_PATTERN → previous solution surfaced
  (validation required before reuse).

## Verification
`run_debug_tests.js` sections 3, 4, 12–17 — all PASS.
