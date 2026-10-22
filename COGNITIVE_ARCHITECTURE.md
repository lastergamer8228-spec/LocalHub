# LocalHub Cognitive Architecture

The LocalHub Assistant is an **offline-first, persistent personal digital
assistant** — a private "cognitive core" living inside the LocalHub phone server.
It is not a chatbot bolted onto a file server. It perceives its environment,
remembers experiences, reasons about situations, plans and executes multi-step
tasks, verifies results, recovers from failures, and learns safely — all locally,
with no cloud and no telemetry.

This document explains the architecture and how the pieces fit together. It
documents only what is actually implemented.

---

## 1. The Cognitive Loop

The central operating loop of the Assistant is:

```
PERCEIVE → UNDERSTAND → CONTEXTUALIZE → REMEMBER → REASON → DECIDE → PLAN
→ CHECK POLICY → ACT → OBSERVE → VERIFY → REFLECT → LEARN → UPDATE MEMORY
```

This loop is orchestrated by `cognitive.js` (`global.LH_AI.Cognitive`). `brain.js`
(the existing central brain) routes every user message through this loop instead of
treating the assistant as a linear command→response function.

The Cognitive Core **reuses** the existing modules rather than duplicating them:
intent.js (understanding), reasoning.js (planning/explaining), mind.js (question
classification + reasoning), context.js (state), memory.js (persistence),
capabilities.js (registry), guardian.js (proactive monitoring), Comm (presentation).

---

## 2. Modules

| File | Role |
|------|------|
| `brain.js` | Central orchestrator / UI wiring. Routes input through the Cognitive Core. |
| `cognitive.js` | **NEW** — the Cognitive Core: event bus, perception, internal state, memory layers, tool registry, decision layer, action executor, reflection, learning, personality, self-model, debug view. |
| `intent.js` | Intent pipeline (detect → capability → permission → execute). |
| `reasoning.js` | Plan/execute/explain for multi-step goals. |
| `planner.js` / `taskplanner.js` | Multi-step task planning. |
| `mind.js` | Free-form question reasoning + self-awareness. |
| `context.js` | Dynamic state manager (folder, media, client, etc.). |
| `memory.js` | IndexedDB persistence (all data stays on device). |
| `knowledge.js` | Knowledge base store. |
| `capabilities.js` | Capability registry + permission model. |
| `features_guardian.js` | Proactive monitoring / self-healing. |
| `features_*` | Command & knowledge libraries (commands, critical, jarvis, knowledge, selfdev, etc.). |
| `comm.js` | Reply polish / natural language / tone. |
| `voice.js` | Speech input/output. |
| `filesystem.js`, `media.js`, `automation.js` | LocalHub tool access. |
| `pluginBridge.js` | Plugin support. |

There is **one** cognitive core. No duplicate brains.

---

## 3. Event Bus & Perception

`cognitive.js` provides a central event bus:

- `Cognitive.on(type, fn)` / `off(type, fn)` — subscribe.
- `Cognitive.emit(type, data, opts)` — publish a normalized event.
- `Cognitive.perceive(type, data, opts)` — ingest an external signal.

Every event is normalized to an envelope:

```
{ ts, type, source, data, importance, confidence }
```

Events emitted: `COGNITIVE_READY`, `ASSISTANT_TASK_STARTED`,
`ASSISTANT_TASK_COMPLETED`, `ACTION_FAILED`, `COGNITIVE_ERROR`, plus any
perceived signals (file/media/server/device events).

---

## 4. Internal State

A persistent internal state model is stored via `Memory` (IndexedDB) and loaded at
boot. It tracks:

```
identity, mode, goal, task, plan, stepIndex, focus,
confidence, riskLevel, lastActionResult, lastVerify,
recoveryAttempts, observations[], errors[], startedAt
```

Admin-only debug access shows these fields. Normal users see a sanitized snapshot
(no internal plan/observations/errors).

---

## 5. Memory Layers

Distinct, non-chat memory layers built on `memory.js`:

- **Working memory** — in-memory, current-task only (`setWorking/getWorking/clearWorking`).
- **Episodic memory** — persisted `"episodes"` store; important outcomes ("Backup
  failed last night."), with `importance`, `confidence`, `ts`.
- **Semantic memory** — the existing `"knowledge"` store (stable facts).
- **Procedural memory** — persisted `"procedures"` store; learned workflows
  ("compress before share").

Memory management functions: `remember`, `recall` (relevance scoring by query
words + importance + recency), `decay` (age/importance based), `forget`,
`forgetAllMemory`. Dedup happens in `remember` (same kind+text updates instead of
duplicating).

---

## 6. Context Engine

The existing `context.js` is the dynamic state manager. It already knows the
current folder, media, client, playlist, server/network/system snapshots, recent
commands, and resolves referents ("open it", "play that"). The Cognitive Core reads
this context rather than re-asking the user.

---

## 7. Tool Registry & Decision Layer

`cognitive.js` registers LocalHub tools with metadata:

```
{ id, name, risk (low/medium/high/critical),
  reversible (bool), needsConfirm (bool), permission, run(args) }
```

The **decision layer** (`Cognitive.decide`) classifies each action and enforces:

- Permission (admin tools require admin role).
- Risk → confirmation for high/critical risk.
- Reversibility note.

`Cognitive.executeAction(action, args, role, confirmGranted)` runs the tool,
observes, **verifies** (where possible checks the result exists), and **recovers**
(retries with backoff up to a limit; never endless).

---

## 8. Reflection & Learning

`Cognitive.reflect(result, label)` records an episodic memory of success/failure.
`Cognitive.learnProcedure(name, steps)` stores a bounded, editable procedure.
Learning is **local, explainable, reversible, editable, and bounded** — it never
rewrites executable code or security permissions.

---

## 9. Personality

Personality is separate from intelligence, stored in `cognitive.js`:

```
{ identity, tone, style, values[], openers[] }
```

`setPersonality/getPersonality` allow configuration without changing the Brain.

---

## 10. Guardian

`features_guardian.js` monitors server health, storage, memory, CPU, battery,
network, errors, clients, and repeated failures, and can alert, self-heal safe
issues, and suggest improvements. Auto-healing stays **disabled for dangerous
operations by default**.

---

## 11. Security Model

The Cognitive Core inherits LocalHub's role/permission system. It is a **user** of
LocalHub's capabilities, not a bypass. Admin tools require admin; high/critical
risk actions require confirmation. It never bypasses authentication, authorization,
file permissions, admin restrictions, or security policies.

---

## 12. Offline Operation

Everything runs locally in the browser/phone. No cloud, no telemetry, no hidden
external API calls. All memory and assistant data stays on device. Internet-
dependent features (if any) are optional and clearly marked.

---

## 13. Proactive Behaviour

`Cognitive.notify(importance, message, key)` raises proactive alerts with:
- importance gating
- per-key cooldown (duplicate suppression)
- driven by the Guardian's detections (storage/battery/CPU/logs/clients)

It does not constantly interrupt.

---

## 14. Self-Awareness / Self-Model

`Cognitive.selfModel()` reports what it can/cannot do, tools available, server
online, guardian active, offline, and memory-enabled. It never claims an action
happened unless it was verified.

---

## 15. Debug / Observability

The Brain's Diagnostics view (admin) shows a **Cognitive Core** section: mode,
goal, task, focus, confidence, risk level, recovery attempts, tools, last action,
last verify, personality tone, guardian state, recent memories. It shows concise
structured metadata, not hidden chain-of-thought.

---

## 16. Performance

The Cognitive Core is event-driven and cheap: state is only persisted on change,
memory recall runs on demand, and there is no continuous expensive reasoning. The
Guardian polls lightly every 30s. No heavy background loops.

---

© LocalHub — a private digital mind living inside LocalHub.

---

## 17. Goals (persistent)

Goals are separated into user-request → intent → goal → task → subtask → plan.
`Cognitive.setGoal / getGoal / continueGoal / completeGoal / cancelGoal` track an
active goal with a plan; goals persist (IndexedDB) and can be **continued later**
after a reload. `Cognitive.loadGoal` resumes the active goal at boot.

## 18. Fast Path / Deep Path

- **Fast path**: simple commands use the deterministic intent/capability
  execution (`Cognitive.isDeepRequest` is false).
- **Deep path**: complex goals (diagnose, self-heal, root-cause, fix, analyze)
  route through context + memory + diagnostics + reasoning + self-healing.

## 19. Local Model Provider

`SelfHeal.modelProvider` is a clean abstraction the core may use for NLU,
reasoning, summarization, RCA, and patch proposal. The default is a
**deterministic fallback**; LocalHub never depends on a specific external model.
`SelfHeal.setModelProvider(provider)` swaps in a local model while keeping the
fallback reachable.

## 20. Self-Healing Engine

`SelfHeal` (see SELF_HEALING_ARCHITECTURE.md, INCIDENT_RESPONSE.md,
PATCH_LIFECYCLE.md) handles the full incident → RCA → patch → test → backup →
deploy → verify → rollback → learn lifecycle, gated by repair levels and safety
rules. It is wired into the Cognitive Core via `Cognitive.selfHeal`.

