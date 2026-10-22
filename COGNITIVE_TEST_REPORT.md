# Cognitive Core — Test Results (v2.17)

> Status: **27 / 27 PASS** · Generated 2026-08-10 · headless, deterministic,
> against the actual `cognitive.js` engine with a mock Memory.

## Coverage (all real assertions)

| Area | Tests | Result |
|------|-------|--------|
| 1. Event bus (on/emit/off, envelope) | 2 | ✅ |
| 2. State persistence | 1 | ✅ |
| 3. Memory store / recall / rank | 2 | ✅ |
| 4. Memory correction + forgetting/decay | 3 | ✅ |
| 5. Working memory + continuity | 2 | ✅ |
| 6. Personal model (non-sensitive) | 3 | ✅ |
| 7. Dynamic planning (planGoal) | 3 | ✅ |
| 8. Decision + risk + permission | 3 | ✅ |
| 9. Action executor | 1 | ✅ |
| 10. Reflection + learning | 1 | ✅ |
| 11. Self-model | 2 | ✅ |
| 12. Fast vs deep path | 2 | ✅ |
| 13. Proactive notify (cooldown) | 1 | ✅ |
| 14. Self-heal bridge | 1 | ✅ |

## Confirmed
- Memory correction edits in place and marks `corrected`.
- Explicit `rank()` returns scored `{entry, score}`.
- Personal model stores preferences + capability frequency; non-admin sees a
  safe summary (no sensitive attrs exposed).
- `planGoal` auto-generates a real step plan (uses templates unless a real local
  model is attached).
- Admin permission gate + high-risk confirmation enforced.
- Goals persist to the memory store for reload.
