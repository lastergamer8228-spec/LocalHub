# LocalHub Personal Digital Mind — Architecture (v2.20)

> Status: ✅ IMPLEMENTED (headless-tested) · 🔒 DEVICE-BLOCKED for real on-device
> persistence (requires the app on a device).
> Self-Healing architecture is **FROZEN** — this deepens the existing Cognitive
> Core only.

`Cognitive.PersonalBrain` extends the existing Cognitive Core into a persistent
personal mind. It reuses the same Memory layer with dedicated stores. The Brain is
**local, private, offline-first, persistent, controlled, explainable, and
non-sentient by design.**

## Pipeline (the transformation)
```
User -> Request
  -> Brain understands context
  -> recalls relevant experience
  -> understands personal preference
  -> connects to current goal
  -> decides appropriate response/action
  -> updates memory
  -> continues context into the future
```

## Components (all on the SAME Cognitive object)
| Area | API | Status |
|------|-----|--------|
| Personal memory engine | `remember/recall/get` (id,type,content,source,importance,confidence,tags,expiry,relationships) | ✅ |
| Memory relationships | `link/getRelations/related` (RELATED_TO, CAUSED_BY, FOLLOWS, PREFERS, USED_WITH, ABOUT, CONTRADICTS, DERIVED_FROM) | ✅ |
| Importance scoring | explicit statement > repetition > relevance > frequency > recency | ✅ |
| Consolidation | `consolidate()` episodes → semantic/procedural on threshold | ✅ |
| Contradiction handling | same-type preferences supersede old ones (SUPERSEDED) | ✅ |
| Personal profile | `setProfile/getProfile` (communication, ui, media, workflow, device, automation, capabilities) | ✅ |
| Current-life context | `updateContext/getContext/expireContext` (expiring) | ✅ |
| Attention | `classifyAttention` (LOW/NORMAL/IMPORTANT/URGENT) + `attentionLoop` | ✅ |
| Focus | `setFocus/getFocus` | ✅ |
| Goal memory | `setGoal/getGoal/updateGoal/completeGoal/cancelGoal` (priority/status/progress/nextAction) | ✅ |
| Habit detection | `recordEvent/detectHabits` (≥3 repeats, confidence; one-off never a habit) | ✅ |
| Predictive assistance | `learnTransition/predictNext` (high-confidence only) | ✅ |
| Personalization | `personalize` (adapts to established communication style) | ✅ |
| Memory confidence | `confidenceLabel` (KNOWN/LIKELY/UNCERTAIN) | ✅ |
| Explicit memory commands | `features_personal.js` (remember/recall/forget/correct/prefs/disable/enable/why/export/clear) | ✅ |
| Privacy | `setMemoryEnabled/exportMemory/clearMemory` (local only, no cloud) | ✅ |
| Continuity | `saveContinuity/restoreContinuity` (goal/focus survive restart) | ✅ |
| Self-model | `selfModel` (from actual internal state) | ✅ |
| Contextual references | `resolveReference` (that/it/again/yesterday) | ✅ |
| Event memory + attention loop | `attentionLoop` (IGNORE/REMEMBER/ACT/NOTIFY) | ✅ |
| Proactive assistance | `proactiveSuggestion` (cooldown, non-spam) | ✅ |
| Local model role | `summarizeWithModel` (assist only; deterministic authoritative) | ⭕ MODEL-DEPENDENT |

## Hard rules
- No cloud sync, no telemetry, no silent transmission.
- No fake consciousness/emotions/sentience/human needs — state, attention,
  memory, goals, preferences, confidence are computational constructs.
- The local model only assists; it is never authoritative for permissions,
  memory deletion, security, actions, risk, SelfHeal, or deployment.
- Memory deletion/disable are controlled; no silent storage of sensitive
  attributes.
