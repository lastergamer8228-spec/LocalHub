# LocalHub Routine Engine (v2.21)

> Status: ✅ IMPLEMENTED (headless-tested) · 🔒 DEVICE-BLOCKED for real on-device
> persistence. Self-Healing is **FROZEN** — this extends `Cognitive.PersonalBrain`.

## Habit vs Routine (never merged)
- **Habit** = an observed behavioral pattern (`detectHabits`, ≥3 repeats).
- **Routine** = an **approved, executable** workflow (states below).
- **Prediction** = likely next action (high confidence only).
- **Suggestion** = proposed assistance (evidence-backed, non-spam).

## Routine model
```
{ id, name, description, steps[], triggerConditions[], contextConditions{},
  confidence, frequency, lastObserved, timesObserved, status, approvalState,
  lastRun, cooldownMs, maxRuns, dailyLimit, failureCount, successCount,
  createdAt, updatedAt }
```
States: `CANDIDATE → SUGGESTED → APPROVED → ACTIVE → PAUSED/DISABLED/EXPIRED`.

## Sequence detection (`observeSequence`, `detectRoutineCandidates`)
- Repeated action sequences are counted per context (30-day window).
- A candidate is only created at a confidence threshold (default ≥3 observations,
  confidence `0.5 + n*0.1`). One occurrence never becomes a routine; random
  actions do not.

## Contextual routines (`evaluateRoutine`)
- Trigger (OR) + context conditions (time window, space, device, goal) + current
  event. A routine does not fire merely because one step happened.

## Approval-first (no silent automation)
`PATTERN → CANDIDATE → SUGGESTION → USER APPROVAL → ACTIVE`. `approveRoutine`
requires admin. `rejectRoutine` disables + records feedback.

## Safe execution (`executeRoutine`)
`TRIGGER → CONTEXT → PERMISSIONS → RISK → COOLDOWN → EXECUTE → VERIFY → RESULT`.
- Risk classification: SAFE / LOW_RISK / HIGH_RISK / CRITICAL. HIGH_RISK/CRITICAL
  steps require explicit approval even for ACTIVE routines.
- Cooldown / maxRuns prevent duplicate execution.
- Bounded retry; repeated failures pause the routine + notify + suggest
  investigation. SelfHeal is not auto-invoked for routine failures.

## Learning (`routineHistory`, `routineFeedback`)
Results + user feedback adjust confidence (success +0.02, failure −0.05; feedback
±0.03/±0.06). One success does not override a long failure history.

## Conflict detection (`detectConflict`)
Opposing routines (e.g. open X vs close X, same trigger) → `ROUTINE_CONFLICT`,
not blindly executed.

## Commands
`show my routines`, `yes make it a routine`, `no don't suggest`, `pause/resume/
disable/enable this routine`, `run this routine`, `why did you suggest this`.

## Privacy
All routine history is local; user can view/edit/disable/delete/export.
