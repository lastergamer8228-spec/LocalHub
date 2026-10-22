# LocalHub Personal Automation (v2.21)

> Status: ✅ IMPLEMENTED (headless-tested) · ⭕ MODEL-DEPENDENT for natural-language
> routine naming · 🔒 DEVICE-BLOCKED for real on-device execution

## Principle
The Brain can automate **approved** routines — never silently. Flow:

```
OBSERVE -> REMEMBER -> RECOGNIZE PATTERN -> UNDERSTAND CONTEXT -> PREDICT ->
SUGGEST -> GET APPROVAL -> AUTOMATE -> VERIFY -> LEARN
```

## Safety
- Routine steps are risk-classified (SAFE/LOW_RISK/HIGH_RISK/CRITICAL).
- High-risk/critical steps always require explicit approval, even for ACTIVE
  routines. Dangerous actions never become autonomous merely because they occur
  frequently.
- Cooldown, maxRuns, dailyLimit, bounded retry, failure pause.
- Routine failures do NOT auto-invoke SelfHeal (frozen) unless SelfHeal policy
  itself deems it appropriate.

## Approval
`approveRoutine` requires admin. Rejection disables + records feedback. Editing
(name/steps/trigger/context/schedule/permissions/approval) is supported.

## Local model role (optional)
The local model may assist with sequence interpretation, routine naming, context
understanding, and goal/routine relationship discovery — but the deterministic
code is authoritative for permissions, risk, execution, approval, cooldown, and
security. No cloud dependency.
