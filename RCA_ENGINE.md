# LocalHub Root-Cause Analysis Engine (v2.19)

> Status: ✅ IMPLEMENTED

## Purpose
Determine the **most probable root cause** from evidence — not the first file in a
stack trace. Bounded, multi-hypothesis, evidence-scored.

## Flow
1. **Map error → source** (`Debug.mapError`): module, file, function, call chain,
   dependents. Uncertain → returns uncertainty, not a guess.
2. **Generate hypotheses** (`Debug.buildHypotheses`): bounded set (≤4), each with
   evidenceFor/Against, confidence, affectedFiles, testMethod.
3. **Score + rank** (`scoreHypotheses`/`rankHypotheses`): confidence + supporting
   evidence − contradicting evidence.
4. **Test** (`runDebugSession` loop): update confidence on pass, reject on fail.
5. **Select** root cause when confirmed (or a hypothesis reaches ≥0.75 confidence).
6. **Multi-file**: the upstream/call-chain hypothesis (H3) inspects dependent
   layers (UI → API → Service → DB) rather than patching the first file.

## Output
`selectedRootCause = { id, description, evidence, confidence, module, file,
affectedFiles }` plus `confidences.rca`.

## Honesty
- If no hypothesis is confirmed within the bound → `UNRESOLVED`, incident left for
  admin. No fabricated root cause.
- RCA confidence is evidence-based; never invented.
- The deterministic engine is authoritative; the local model only assists.

## Verification
`run_debug_tests.js` sections 2, 3, 4, 11, 13 — all PASS (54/54 debug suite).
