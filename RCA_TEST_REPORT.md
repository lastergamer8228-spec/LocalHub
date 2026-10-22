# LocalHub v2.19 — RCA Test Report

> Generated 2026-08-10. All assertions are real, against the actual `SelfHeal.Debug` engine.

## RCA tests (all PASS)
| Test | Assertion | Result |
|------|-----------|--------|
| 2a | stack trace maps to module + file + call chain | ✅ |
| 2b | route string maps to module (filesystem) | ✅ |
| 2c | unknown error → uncertainty (mapped=false, confidence 0) | ✅ |
| 3a | bounded hypotheses with evidenceFor/Against/confidence/files/testMethod | ✅ |
| 3b | hypotheses ranked by score descending | ✅ |
| 3c | evidence scoring reflects confidence + evidence | ✅ |
| 4a | failed hypothesis rejected + confidence lowered | ✅ |
| 4b | passed hypothesis confidence raised | ✅ |
| 11a | upstream/call-chain hypothesis present for multi-file trace | ✅ |
| 13a | H1 rejected → H2 selected as root cause (Scenario B) | ✅ |
| 17a | never exceeds maxInvestigationAttempts | ✅ |

## Multi-file / dependency-aware RCA
Confirmed: a stack trace spanning UI → API → Service generates an upstream-layer
hypothesis that inspects dependent modules, rather than patching only the first
file.

## Honesty
- Unmapped errors return uncertainty — no fabricated root cause.
- RCA confidence is evidence-based; separated from patch/verification confidence.
