# Assistant/brain baseline audit — first parallel increment

Checkpoint: 1.0.7-assistant-stages-preview (code 8). Scoped audit plus reviewed
execution-boundary pilot. NOT a completed general-purpose reasoning system.

## Pipeline traced

`/ai/index.html` → `Brain.handleUserMessage` → new `AssistantRuntime` boundary →
reviewed status/server/media handlers OR existing `Cognitive.process` →
`Intent.process` / `TaskPlanner` / `ActionRouting` / command catalog → backend,
MediaBridge or navigation → chat rendering.

The Cognitive file also contains Personal Brain and routine extensions. Those
frozen engine sources were NOT rewritten. Shared bootstrap, storage and browser
orchestration are separate integration layers and were corrected here.

## Findings and disposition

| Priority | Finding | This checkpoint |
|---|---|---|
| P0 | Browser extension IIFEs referenced free `global`; Chromium raised 5 ReferenceErrors in Mind/communication/Guardian/Self-Healing extensions. Node tests supplied `global` and missed the issue. | Shared config bootstrap provides browser compatibility binding; console pages load it first. Frozen engine files unchanged. Browser initialization tests pass. |
| P0 | IndexedDB v1 created 7 stores, but context, brain and incident layers requested many others. Real console navigation raised `NotFoundError`. | Additive v2 schema creates 32 known stores, keeps existing rows, closes version-change/error connections and reports blocked upgrades. No database deletion/reset. |
| P1 | Memory bootstrap failures stranded the main page or surfaced as uncaught asynchronous errors. | Preflight local history before main chat initialization; display actionable error and disable chat until older tabs are closed/reload. Real blocked-upgrade browser test passes. |
| P1 | Main Brain and Cognitive both wrote assistant chat responses. | UI delegates with the existing remember:false option; Brain remains the main-chat writer. Chromium checks one assistant record per tested reply. |
| P1 | Brain action transport ignored HTTP status / ok:false, omitted bearer header and used a “done” fallback. | Return status-aware authenticated promises; distinguish rejected, acknowledged and uncertain responses; remove false completion wording. Frozen Cognitive tool adapter still does not await all such promises—see blockers. |
| P1 | Capabilities metadata assumed owner and labelled logs/server mutations public. | Remove owner assumption; 9 of 40 default records now explicitly admin-only; current Commands role is consulted. Backend remains authoritative. |
| P1 | Broad legacy routing can treat action keywords inside informational text as executable requests. | Reviewed rule boundary catches operation questions/negation, requests clarification for ambiguous targets and preserves quoted titles in classification. Heuristic, not universal NLU. |
| P1 | `/api/auth/session` read role without validating expiry/IP. | Current-role response now calls SessionManager.validate; four JVM session primitive tests and a source wiring check cover the boundary. This is not a live multi-client HTTP test. |
| P1 | Confirmation could be confused with unrelated turns or repeated requests. | Reviewed server controls use one-shot pending action in RAM, 60s expiry, current role/token identity and invalidation on unrelated input. No automatic POST retry. |
| P1 | Plans can continue after ok:false, select “latest” from the first unsorted hit and claim task complete; download-and-open maps to log export. | Recognized unsafe chat workflows are held for review rather than run. Underlying planner is NOT fixed/promoted yet. |
| P1 | Frozen executor treats some tool responses as verification; deletion can use existence as its check; server tool ignores transport completion. | Documented release blocker. Reviewed UI server actions bypass that executor and report only acknowledgement. No claim that all old paths are fixed. |
| P1 | Playback bridge broadcasts widely and can replay an old command on player boot. | Reviewed controls carry targetFile; actual player listener ignores different files and commands older than 15s/future-dated. This is not per-tab/session acknowledgement. |
| P1 | Paused players stopped refreshing context, and playback status included token-bearing src URL. | 3s liveness status; redact token query values in telemetry. No success inferred from sending a bridge message. |
| P1 | Memory IDs and ownership are inconsistent: some singleton stores generate random IDs but loaders request fixed keys; context/personal stores lack a complete user-ownership migration. | NOT silently changed. Schema availability is fixed, not memory correctness/continuity/privacy. Dedicated memory acceptance gate remains mandatory. |
| P1 | Chat history display filters by role, but legacy clear-chat clears the whole local chats store; context uses a shared fixed record. | Unchanged, pending the memory ownership/migration gate. This concerns roles sharing one browser profile, not a claim that IndexedDB is shared across remote client devices. Do not promote multi-role privacy yet. |
| P2 | Numeric confidence in the admin brain console is a heuristic, not a calibrated probability. | Label changed to “Heuristic score (not calibrated)”; no fake new confidence percentage introduced. |

## Runtime result contract (reviewed intents)

- INFORMATION / NO_ACTION / CLARIFICATION_REQUIRED: no tool dispatched.
- CONFIRMATION_REQUIRED: no mutation sent yet.
- DENIED / MODULE_DISABLED / UNAVAILABLE / FAILED: do not claim completion.
- ACKNOWLEDGED: backend accepted a request; actual completion unverified.
- REQUESTED_UNVERIFIED: player bridge request sent; effect not confirmed.
- NAVIGATION_REQUESTED: opening a page, not proof that playback started.
- OBSERVED: valid current server-status data, not inferred action completion.
- UNVERIFIED: lost response / uncertain action outcome; no automatic retry.
- LEGACY_UNVERIFIED: outside the reviewed pilot. Existing handler wording can
  still be imperfect; this tag is not a retroactive guarantee of safety.

No raw access token is persisted in a confirmation record (pending data exists
only in JS RAM); playback telemetry redacts URL tokens. The identity comparison
uses the current token internally, not a new authorization scheme. Server-side
sessions and module permissions still decide access.

## Evidence actually produced

- 74 isolated runtime scenarios with mocked HTTP/Cognitive/MediaBridge dependencies.
- Actual Brain entry and transport tests with mocks; capability metadata and stale
  bridge read tests use the real respective scripts.
- Actual Chromium `/ai` page: operation explanation, ambiguous stop, confirmation,
  exactly one mocked restart request, duplicate confirmation rejection and single
  chat persistence for the tested ordinary reply.
- Actual Chromium player listener: target-file guard, stale command rejection and
  token redaction in stored playback metadata.
- `/brain` and `/selfheal` page initialization without the missing-global errors,
  against mocked endpoints. This does NOT verify their repair/device actions.
- Real Chromium IndexedDB v1→v2 migration retains a legacy row; concurrent CRUD,
  known new stores, error handling, blocked upgrade and recovery were tested.
- Existing command-library fingerprints / controller/audio contract checks and
  542 headless engine assertions passed. Those legacy tests are still mock-backed.
- Kotlin build, 7 JVM module-policy tests and 4 session-validation tests passed; APK build recorded separately.

## Outstanding limitations

The brain remains deterministic, with a large static reference catalog and
heuristic legacy routing. No local LLM or model training was added. The pilot
covers main-chat entry only; plugins, direct Cognitive calls and old automations
are not all wrapped by these guardrails. Natural-language matching is not a
security boundary. File-mutation chat and known plans are intentionally restricted
until their reviewed contracts exist; File Manager remains the alternative.

There is no verified multi-user memory isolation, general reasoning benchmark,
calibrated uncertainty, action completion verifier, unique-player acknowledgement,
or real Android conversation/device acceptance yet. Use this as a development
preview in a trusted browser, not a production multi-user assistant.
