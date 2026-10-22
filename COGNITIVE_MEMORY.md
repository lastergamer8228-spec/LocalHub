# LocalHub Cognitive Memory

> Status labels: ✅ IMPLEMENTED · 🟡 PARTIAL · ⭕ OPTIONAL · ❌ NOT IMPLEMENTED

LocalHub uses a **distinct memory architecture**, not just chat history. All memory
is **local** (IndexedDB via `memory.js`) — no cloud, no telemetry.

## Memory Layers

| Layer | Store | Purpose | Status |
|-------|-------|---------|--------|
| Working | in-memory | Current task/conversation (ephemeral) | ✅ |
| Episodic | `episodes` | Important past events & outcomes | ✅ |
| Semantic | `knowledge` | Stable facts (existing knowledge base) | ✅ |
| Procedural | `procedures` | Learned workflows & successful procedures | ✅ |
| Incidents | `incidents` | Detected failures + lifecycle | ✅ |
| Regressions | `regressions` | Tests created after fixes | ✅ |
| Backups | `backups` | Restorable state snapshots | ✅ |

## Memory Operations (`Cognitive.remember / recall / decay / forget`)

- **store** — `remember(store, entry, importance)` writes with metadata
  (`timestamp`, `importance`, `confidence`, `source`, `lastAccessed`).
- **retrieve / rank** — `recall(store, query, limit)` scores by query words +
  importance + recency.
- **update / merge / dedup** — `remember` dedups on `kind+text` (updates instead
  of duplicating).
- **expire / decay** — `decay(store, maxAgeDays)` drops old, low-importance items.
- **forget / correct** — `forget(store, id)` and `forgetAllMemory()`.
- User controls: view / edit / delete / disable / clear (Memory tab).

## Personal Model

The assistant may learn **non-sensitive** preferences (preferred workflows,
communication style, frequently used capabilities/Spaces, repeated task patterns)
stored locally. It does **not** silently store sensitive personal attributes.

---

© LocalHub — private, local, editable memory.

---

## v2.17 — Memory operations added/verified

- **Ranking** — `rank()` exposes scored retrieval (`{entry, score}`).
- **Correction** — `correctMemory()` edits an existing memory in place.
- **Personal model** — a persisted, non-sensitive preference store
  (`updatePreference`, `noteCapabilityUse`, `getPersonalModel`).
- **Goal persistence** already survives reload (`loadGoal` on `_init`).
- All memory layers verified headlessly (27/27 cognitive tests).
