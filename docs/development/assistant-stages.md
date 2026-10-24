# Assistant + brain development board

Checkpoint: **1.0.9-integration-healing-preview / code 10**. Both tracks share one
acceptance plan; they are not two competing brains or separate memory engines.
This is a pilot, NOT a completed assistant rewrite or a stable release.

## Current status

| Track | Workstream | State | Evidence / remaining gate |
|---|---|---|---|
| Assistant | A1: trace entry → routing → tools → response | Scoped baseline recorded; full catalog audit ongoing | See quality/assistant-baseline.md |
| Brain | B1: distinguish information, negation, explicit action and ambiguity | Rule-based pilot implemented | 74 mocked runtime scenarios, including quoted titles and selected Hinglish aliases |
| Assistant | A2: reviewed server/status/media actions | Implemented for main `/ai` chat | Chromium UI + mocked HTTP passes; real-device request/completion acceptance pending |
| Brain | B2: confirmation and context freshness | Partial implementation | One-shot 60s role/session-scoped server confirmations; stale media context clarifies; targeted-file commands |
| Both | Host-aware Self-Healing integration | Integration-first read-recovery pilot | Native descriptor + bounded read-only observations; 52 mocked scenarios/5 catalog tests; no frozen repair-engine invocation |
| Both | Runtime/bootstrap reliability | Browser defects fixed in shared adapters | Real Chromium page initialization and IndexedDB migration tests pass |
| Brain | B3: execution evidence / verifier | Restart observation pilot added | Later listener marker on same port required; stop/disconnect never treated as proof; legacy executor still a blocker |
| Brain | B4: memory quality/ownership/continuity | Not accepted | Store availability fixed; user ownership and singleton ID contracts are still unresolved |
| Assistant | A3: multi-step tasks / file mutations | One read-only plan reviewed; mutations quarantined | Strict stop-on-failure/cancel/deadline; newest-modified metadata workflow only. See quality/reviewed-plans.md |

No milestone is promoted to device-accepted simply because mocks or compilation
pass. Full Stage 1 inventory is not being marked complete prematurely.

## Pilot behaviour

- “How do I restart server?” → explanation; no restart request.
- “Stop it” / “delete it” → ask for a target; no guessing from old history.
- “Restart server” / “server band karo” → admin check and confirmation.
- “confirm” → at most one request, only for the current unexpired session/role.
- After HTTP acknowledgement → request accepted only. Restart can additionally report an observed new listener start after bounded status reads; stop is not verified from a disconnect.
- Lost response after sending → uncertain outcome; no automatic mutation retry.
- Server status → observed only from a valid current response.
- Pause/resume/stop video → fresh playback context + live module check; target
  selected file; report requested/unverified until an actual acknowledgement
  channel is implemented. A paused player now sends a periodic liveness update.
- Known risky workflows / file-changing commands → direct the user to File Manager
  instead of letting an unreviewed plan claim success.
- Other queries → existing Cognitive/Intent pipeline, explicitly tagged internally
  as legacy/unverified. This is not a claim that all free-form input is safely
  classified. Direct programmatic engine calls and old automations are outside
  the reviewed main-chat boundary.

## Self-Healing integration checkpoint

The integration-first scope is implemented as [host-aware diagnosis/read recovery](../quality/system-integration.md).
The user delegated recovery decisions; reviewed automatic actions remain bounded
read/recheck operations. Disruptive actions still need the admin-confirmed flow.
No disabled module is silently enabled and no Android grant/consent is bypassed.
Existing legacy Guardian/autonomy policies were not overridden; frozen engine
changes still require a separately agreed scope. This is not a completed Gate 5.

## Gate 2 pilot checkpoint

[Reviewed planner/evidence notes](../quality/reviewed-plans.md) record the strict
read-only execution slice, bounded restart observation and 50 new regression
scenarios. This is not acceptance of all workflows or mutation verification.

## Remaining gates — in order

### Gate 1: complete capability and execution inventory
List every actual tool, API endpoint, permission, enabled-module dependency,
side effect, confirmation requirement, observable outcome and unsupported limit.
Separate static reference answers from executable capabilities. Existing catalog
counts (10,120 reference registrations / 44 current default capability records) are not
counts of verified features.

### Gate 2: strict action contracts and planner
Before re-enabling file mutations / workflows:
- Resolve and display exact targets; do not infer from stale search indexes.
- Stop a plan on failed/unknown steps. Never silently skip unimplemented steps.
- Await action transport, separate accepted/requested from observed completion.
- Never retry a destructive/non-idempotent operation just because verification
  or a network response is missing.
- Use operation-specific checks: deletion verifies absence, creation verifies
  existence/content; restart needs evidence of a new listener start.
- Add a request-ID/target-player acknowledgement channel, not just shared
  localStorage status. Re-check current role/session before dispatch.

### Gate 3: real conversation and context
Use a replayable English/Hinglish dialogue suite: follow-ups, corrections,
multiple files/players, quoted titles, missing targets, explicit negation,
permission changes, module OFF and interruptions. Avoid fake confidence scores.
The pilot decision rules do not establish general language understanding.

### Gate 4: memory and Personal Brain acceptance
Existing v1 data must migrate without deletion. Audit record ownership, filtering,
export/correction/deletion, retention and stale-context rules. Repair singleton
ID/load contracts deliberately; do not silently rewrite goal/profile data in the
shared storage adapter. Private/shared memory policy needs an explicit design.
Do not claim user separation or reliable long-term continuity yet.

### Gate 5: automation / Guardian / Self-Healing integration
Agree a targeted scope before touching frozen internals. Keep consent and file
boundaries, inspect retry decisions, recovery and rollback, and prove device
results. Browser-page lifetime is not an Android background scheduler.

### Gate 6: device acceptance and release
Run the native controller checklist plus actual assistant workflows on Android
and PC Chrome, both roles, multiple sessions/tabs, disconnects and real files.
Keep fixtures, HTTP mocks, real browser storage and native device evidence separate.
Known security/lifecycle release blockers from the controller audit still apply.

## Test commands for this checkpoint

```sh
node tests/test_assistant_runtime.js
node tests/test_reviewed_plans.js
node tests/test_system_integration.js
python3 tests/check_system_integration_contracts.py
node tests/test_assistant_integration.js
python3 tests/test_assistant_browser.py
python3 tests/test_memory_browser.py
```

Browser tests require Playwright + Chromium. Their HTTP endpoints are fixtures;
IndexedDB is real browser storage, not an in-memory database mock. No model was
added or trained. No external LLM service is used by this work.

## Promotion rule

The current scenarios are a developer-authored regression corpus, not a held-out
language benchmark. Promotion needs real user/device cases, zero unexpected
mutations in the reviewed safety corpus, correct role/module denial, and truthful
outcome reporting. Do not assign a percentage of intelligence or claim general
understanding from these passes.

## Upgrade note

Close older LocalHub browser tabs before first opening this assistant build. The
local IndexedDB schema moves from v1 to v2 without deleting rows. If an old tab
blocks migration, the UI explains it and disables chat until close/reload. A
downgrade to old v1-only browser assets against the v2 database is not a tested
rollback. Preserve data and do not clear browser storage to work around errors.
