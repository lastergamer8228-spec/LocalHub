# LocalHub Context Prediction (v2.21)

> Status: ✅ IMPLEMENTED (headless-tested)

## Purpose
Predict the likely next action in a context, and only act (suggest/prepare) when
confidence is high enough. Never execute unexpected actions automatically.

## Inputs considered
recent action sequence, current Space, current device, time, active goal,
routine, habit, preference, previous outcome.

## Behavior
- `learnTransition(from, next, context)` records how often `next` follows `from`
  in a context.
- `predictNext(from, context)` returns `{suggest, action, confidence}`.
- A suggestion is only produced when confidence ≥ 0.7 AND the transition has been
  observed ≥ 2 times. (Verified: 2 confident transitions → suggest; unseen
  context → no suggestion.)

## Honesty
- No model → deterministic, honest (`MODEL_ASSISTANCE_UNAVAILABLE`).
- Explanations expose an evidence summary, not hidden chain-of-thought.
