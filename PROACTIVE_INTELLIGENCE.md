# LocalHub Proactive Intelligence (v2.21)

> Status: ✅ IMPLEMENTED (headless-tested)

## Not spam
Proactivity is gated by: cooldown, deduplication, importance threshold,
confidence threshold, quiet period, user preference, and suggestion history. A
suggestion rejected 3× is suppressed.

## Decision engine (`proactiveDecide`)
Input: current event + context + focus + goal + memory + habits + routines +
preferences + attention.
Output: `IGNORE / REMEMBER / SUGGEST / NOTIFY / PREPARE / ACT`.
- URGENT → NOTIFY
- IMPORTANT/NORMAL → REMEMBER
- high-confidence prediction → PREPARE
- trivial → IGNORE
`ACT` requires the appropriate permission/approval.

## Suggestion engine (`suggestNow`)
Produces evidence-backed suggestions (ROUTINE / REMINDER / CONTEXTUAL_HELP /
GOAL / MAINTENANCE / INFORMATION / PREPARATION). Each has an identifiable reason
and confidence. Suggestions are suppressed when the user rejected them (≥3×) or
already accepted.

## Suggestion memory (`recordSuggestionResponse`, `suggestionStatus`)
Tracks suggestionId/type/reason/context/timestamp/userResponse/accepted/rejected/
ignored, so the Brain does not repeat the same suggestion.

## Priority (`prioritize`)
Ranks by importance/confidence/urgency/focus/goal-relevance/preference/recency/risk.

## Preparation (`prepare`)
Safe intermediate: `PREPARE` marks context (e.g. "your project folder is ready")
without performing any action. High-risk actions are refused for preparation.

## Prediction explanation (`explainSuggestion`)
Explains with an **evidence summary** (e.g. "you performed X→Y→Z five times in
this context"), not hidden chain-of-thought.

## Event-driven, not a busy loop
`EVENT → CONTEXT → ATTENTION → MEMORY → HABIT → ROUTINE → GOAL → PREDICTION →
PROACTIVE DECISION → IGNORE/SUGGEST/PREPARE/ACT → VERIFY → LEARN`. Runs on
events; no continuous LLM loop. Deterministic when no local model is present.
