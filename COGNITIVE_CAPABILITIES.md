# LocalHub Assistant — Cognitive Capabilities

This lists what the assistant can actually do. Only implemented capabilities are
documented. Everything is **offline, deterministic, and private**.

## Core capabilities

- **Manage LocalHub** — files, media, server, network, logs, devices, automation,
  via the existing command/knowledge base (thousands of commands).
- **Answer questions** — across science, tech, finance, health, history,
  philosophy and more, from the local knowledge base (including deep,
  multi-sentence explanations).
- **Reason about free-form questions** — the Mind engine classifies a question
  (define, cause, compare, decide, verify, risk, scenario, predict, summarize,
  brainstorm, critique, plan, opinion, how, when, fact, explain) and builds a
  structured reasoned answer.
- **Self-awareness** — understands "what is your goal / limit / name / purpose",
  "who are you", "what can you do", "are you offline", "can you feel emotions",
  etc., and answers about itself rather than a keyword.
- **Critical thinking frameworks** — 5 Whys, root cause, SWOT, decision matrix,
  cost-benefit, Eisenhower, first principles, bias check, Pareto, etc.
- **Calculations** — finance (interest, EMI, tip, GST), statistics (mean, median,
  std dev), algebra (solve linear/quadratic), geometry (areas, volumes),
  unit conversions, math.
- **Coding knowledge** — Kotlin, Compose, Android, Python, JS, SQL, etc., plus
  snippets and debugging guidance.
- **Speak (TTS)** — reads replies aloud with the phone's offline system voice.
- **Proactive monitoring (Guardian)** — alerts on storage/battery/CPU/memory/log
  issues, runs health checks, self-heals safe issues, suggests improvements.

## Cognitive Core (new in this architecture)

- **Event bus** — modules communicate through normalized events.
- **Perception** — ingest and normalize external signals.
- **Persistent internal state** — goal, task, focus, confidence, risk, etc.
- **Memory layers** — working / episodic / semantic / procedural, with
  importance, relevance, decay, dedup, forget, and clear-all.
- **Tool registry** — 18 tools, each with risk, reversibility, permission,
  confirmation, and a run function.
- **Decision layer** — permission checks and risk-based confirmation.
- **Action executor** — act → observe → verify → recover (retry with backoff).
- **Reflection & learning** — records outcomes; learns safe procedures.
- **Personality** — configurable identity/tone/style, separate from intelligence.
- **Self-model** — reports what it can/cannot do.
- **Cognitive debug view** — admin-only structured observability.

## Tools exposed by the Cognitive Core

| Tool | Risk | Confirm | Permission |
|------|------|---------|------------|
| fs.list, fs.read, fs.search, fs.usage, system, clients | low | no | public |
| tts.speak | low | no | public |
| fs.mkdir, fs.copy, fs.zip | low–med | no | admin |
| fs.write, fs.rename, fs.move, fs.unzip | med | no | admin |
| fs.delete | high | **yes** | admin |
| server.action | high | **yes** | admin |
| logs | low | no | admin |
| guardian.health | low | no | admin |

## Self-Healing capabilities

- **Incident detection** with a significance gate (frequency × severity).
- **Diagnosis / RCA** — deterministic root-cause analysis with honest confidence.
- **Reproduction discipline** — won't modify production on an unreproducible issue.
- **Candidate patch** generation (files, reason, before/after, expected, risk,
  test plan).
- **Testing** — static checks offline; real build/QA honestly reported as requiring
  the Android SDK.
- **Backup / rollback** — restorable snapshots; automatic rollback on verify
  failure.
- **Self-healing memory** — resolved incidents become reusable procedural
  knowledge; fixes can create **regression tests**.
- **Repair levels 0-5** — observe → safe recovery → diagnostic → propose →
  (trusted, tested) automated → critical (admin only).
- **Safety**: never bypasses auth/permissions/security; never deletes user data;
  never fabricates repairs; never auto-applies critical changes.

## What it deliberately does NOT do

- Browse the live internet (it is offline-first; no live web access).
- Feel emotions or claim sentience.
- Execute arbitrary/destructive actions without confirmation.
- Bypass authentication, authorization, file permissions, or admin restrictions.
- Autonomously rewrite its own executable code or security permissions.
- Send memory or data to any cloud service.

---

© LocalHub — your phone, your private local mind.

---

## v2.17 — Cognitive Core additions

- **Memory correction** — `correctMemory(store, id, updates)` updates a stored
  memory in place and marks it `corrected`.
- **Explicit memory ranking** — `rank(store, query, limit)` returns scored
  `{entry, score}` for retrieval transparency.
- **Personal model** — non-sensitive preference learning (preferred
  communication style, capability usage frequency, repeated task patterns)
  persisted locally via `updatePreference / noteCapabilityUse / getPersonalModel`.
  Never stores sensitive attributes.
- **Dynamic planning** — `planGoal(label)` auto-generates a step plan (uses a
  real local model's planner when attached, else a built-in template planner),
  so goals no longer require a manually-supplied plan.
- **Conversational continuity** — `process()` keeps `previousFocus`,
  `lastInput`, `lastResponse` in working memory for cross-turn context.

### Verification
- **Cognitive Core headless tests: 27/27 pass**.
- **Cognitive self-healing bridge: verified** (routes to `SelfHeal`).
