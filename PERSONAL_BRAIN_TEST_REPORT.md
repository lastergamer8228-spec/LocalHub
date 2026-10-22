# LocalHub Personal Brain — Test Report (v2.20)

> Generated 2026-08-10. **36/36 Personal Brain tests pass** · full suite **328/328**
> (292 baseline preserved, no regression).

## Coverage (all real assertions)
| Area | Result |
|------|--------|
| Memory importance (explicit > trivial) | ✅ |
| Memory ranking / retrieval | ✅ |
| Memory relationships (link/related) | ✅ |
| Memory consolidation (episodes → procedural) | ✅ |
| Contradiction / supersede | ✅ |
| Preference updates | ✅ |
| Goal persistence + restoration | ✅ |
| Attention classification + loop | ✅ |
| Habit detection (repeated vs one-off) | ✅ |
| Predictive assistance (high-confidence only) | ✅ |
| Personalization (short style) | ✅ |
| Memory correction | ✅ |
| Memory deletion | ✅ |
| Privacy (export/clear/disable) | ✅ |
| Contextual references (that/again/yesterday) | ✅ |
| Self-model (actual state) | ✅ |
| Proactive assistance (cooldown) | ✅ |
| Confidence handling (KNOWN/LIKELY/UNCERTAIN) | ✅ |

## Realistic scenarios (all PASS)
- **A** explicit preference stored → later recalled correctly.
- **B** preference changed → old superseded.
- **C** repeated workflow → pattern detected.
- **D** one-off event → NOT a permanent habit.
- **E** "do the same thing as yesterday" → prior memory retrieved.
- **F** conflicting memories → reported with uncertainty, not blindly chosen.
- **G** application restart → important goal/context survives.

## Honest status
- **HEADLESS VERIFIED:** ✅ 36/36 Personal Brain, 328/328 total.
- **REAL DEVICE persistence:** 🔒 BLOCKED (requires the app on a device for
  IndexedDB-backed persistence across a real restart).
- Local model assist: ⭕ MODEL-DEPENDENT.
