# LocalHub Personal Memory Model (v2.20)

> Status: ✅ IMPLEMENTED (headless-tested)

## Memory entry
Every memory carries full metadata:
```
{ id, type, content, source, createdAt, lastAccessed, importance,
  confidence, relevance, tags[], status, expiresAt, relationships[],
  category, key, value }
```
Types: `episodic` · `semantic` · `procedural` · `preference`.

## Four layers (preserved from Cognitive Core)
- **Working** — current task/conversation (in-memory, ephemeral).
- **Episodic** — important past events.
- **Semantic** — stable facts.
- **Procedural** — learned workflows.
PersonalBrain stores these in dedicated stores on top of the same Memory layer.

## Importance scoring
`computeImportance`: explicit phrases ("always", "prefer", "remember",
"important") +3; preference language +2; procedural/semantic +1; `explicit:true`
+2. Trivial observations score low. (Verified: "Always keep subtitles enabled."
> "User opened a random video.")

## Relationships
`link(a, b, relation)` creates `{relation, targetId, evidence}` (evidence only
from actual observations or explicit user info). Relations: RELATED_TO,
CAUSED_BY, FOLLOWS, PREFERS, USED_WITH, ABOUT, CONTRADICTS, DERIVED_FROM.
`related(id)` returns both forward and inverse relations.

## Consolidation
`consolidate()` buckets repeated episodic events by normalized content pattern;
at `threshold` (default 3) it creates a procedural/semantic memory with
confidence `0.5 + n*0.1` (bounded 0.9) and marks the episodes consolidated. Weak
patterns never become hard rules (confidence-gated).

## Contradiction handling
When a preference of the SAME type+category+key is stored with a different value,
the old entry is marked `SUPERSEDED` (with `supersededBy`), and the new one is
active. `supersededPreferences()` lets the user inspect/correct.

## Confidence
`confidenceLabel`: ≥0.75 KNOWN, ≥0.5 LIKELY, else UNCERTAIN. Contradicting
memories are both returned (not silently merged) so the Brain can report
uncertainty.

## Privacy
- `exportMemory()` — local export (no cloud).
- `clearMemory()` / `forgetAll()` — delete.
- `setMemoryEnabled(false)` — stop storing (new writes refused).
- No telemetry, no silent transmission.
