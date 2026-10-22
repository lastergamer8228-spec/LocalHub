# LocalHub Personal Brain v2 — Test Report (v2.21)

> Generated 2026-08-10. **53/53 Routine + Proactive tests pass** · full suite
> **381/381** (328 baseline preserved, no regression).

## Coverage (all real assertions)
| Area | Result |
|------|--------|
| Risk classification (SAFE/LOW/HIGH/CRITICAL) | ✅ |
| Sequence detection (never from one occurrence) | ✅ |
| Routine model + states (CANDIDATE→ACTIVE) | ✅ |
| Approval (admin required) / rejection (suppress) | ✅ |
| Contextual matching (match/mismatch) | ✅ |
| Cooldown | ✅ |
| Safe execution + verification | ✅ |
| High-risk step requires approval | ✅ |
| Context mismatch → no execute | ✅ |
| Failure handling (bounded retry, pause) | ✅ |
| Habit vs routine distinction | ✅ |
| Proactive decision (IGNORE/NOTIFY/PREPARE) | ✅ |
| Suggestion + rejection suppression (3×) | ✅ |
| Preparation (safe only) | ✅ |
| Prediction + explanation | ✅ |
| Conflict detection | ✅ |
| Priority | ✅ |
| Routine editing | ✅ |
| Persistence / restart (Scenario J) | ✅ |
| Model fallback (deterministic, honest) | ✅ |

## Realistic scenarios (all PASS)
- **A** repeated sequence → candidate detected, no automatic execution.
- **B** "yes, make that a routine" → APPROVED/ACTIVE.
- **C** correct context → routine triggers.
- **D** context mismatch → routine does NOT execute.
- **E** rejection → suggestion suppressed.
- **F** failure → bounded recovery → failure record → pause.
- **G** proactive help only when confidence+relevance high.
- **H** cooldown/dedup prevents spam.
- **I** conflict detected, no blind execution.
- **J** approved routines survive restart.

## End-to-end acceptance flow (test 19)
`observe (3×) → habit → candidate → suggest → user approves → ACTIVE → context
appears → executes → verifies → history stored → confidence updated` — all PASS.

## Honest status
- **HEADLESS VERIFIED:** ✅ 53/53 Routine+Proactive, 381/381 total.
- **REAL DEVICE automation:** 🔒 BLOCKED (needs app on device).
- Local model assist: ⭕ MODEL-DEPENDENT.
- Self-Healing: FROZEN, untouched, still fully passing.
