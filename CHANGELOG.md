# LocalHub Changelog

## v2.23.0 (assistant hologram removed) — System Hologram preserved (2026-09-23)

- Removed Assistant Brain Hologram (`assistant_holo.js`, `assistant_holo_ui.js`, `inspect_selftest.js`) from `/ai`.
- Cleaned up `/ai/index.html` and `/ai/brain.js` removing hologram background, HUD, inspect overlay, and process hooks.
- Preserved existing **System Hologram** (`dashboard/core.html`, `dashboard/core.js`, `/core`, `/core.js`, and embedded Core card in Dashboard) 100% intact.
- AI Assistant chat and full cognitive pipeline remain fully operational.

## v2.22.x (assistant brain hologram) — /ai redesign around the Assistant Brain Hologram (2026-08-11)

Redesigned the `/ai` Assistant page around a dedicated **ASSISTANT BRAIN HOLOGRAM**
— completely separate from the existing SYSTEM HOLOGRAM (which is unchanged).

**New files:** `assistant_holo.js` (brain logic + canvas renderer),
`assistant_holo_ui.js` (DOM wiring). Modified `index.html`, `style.css`, `brain.js`.

**Module graph (real architecture, no fake nodes):** CORE + cognition (CONTEXT,
INTENT, PERSONAL, MEMORY, REASON, DECIDE, ROUTING, VERIFY) + capabilities (FILES,
MEDIA, PLAYER, SERVER, DEVICES, TTS, KNOWLEDGE) + healing (GUARDIAN, SELFHEAL).
Edges reflect real relationships only.

**Command flow visualization:** `AssistantBrain.process(text)` computes the real
route and animates a signal node-by-node; `finish(result)` sets SUCCESS/ERROR;
`failAt(module, reason)` stops at the failing module. Unrelated modules stay
subdued; normal conversation never routes through Self-Healing.

**UI:** identity bar (status/brain/memory/task), hologram canvas (click a node to
inspect), live processing panel (CMD/STAGE/MODULE/PREV/NEXT/STATUS/RESULT),
command trace (✓/▸/○), brain activity history (tap to replay), module inspector.

**Real-data sync:** `brain.js` calls `AssistantHolo.process(text)` on each user
message and `AssistantHolo.finish(result)`/error when the pipeline resolves, so the
hologram and chat show the SAME final state.

**Verification:**
- **590/590 headless tests pass** (554 baseline + 36 Assistant Brain Hologram
  tests). Static syntax: 41/41 AI JS + holo files.
- **System Hologram unchanged.**
- **Status:** `HEADLESS_VERIFIED`. Canvas animation requires real-device
  confirmation for `LIVE_ANIMATION_VERIFIED` — not claimed.

## v2.22.x (media playback) — real playback verification, no fake success (2026-08-10)

The assistant correctly routed "play evil dead burn" and opened the player, but
the video did not actually play. RCA: two real causes — (1) the browser **autoplay
policy** rejected `media.play()` after navigation (no user gesture), silently
swallowing the error; (2) the **MKV/codec** may not be decodable by the browser,
and the player only showed a toast with no verification feedback.

**Fixes (EXISTING player/pipeline, no new player or Brain):**
- **Player now reports its real state** via a new `lhmedia_status` localStorage
  channel: LOADING / LOADED / PLAYING / PAUSED / AUTOPLAY_BLOCKED /
  UNSUPPORTED_FORMAT / PLAYBACK_ERROR, with currentTime, readyState, networkState,
  error code, src.
- **Honest autoplay:** on `loadedmetadata` attempt `play()`; on `NotAllowedError`
  report AUTOPLAY_BLOCKED and reveal the big ▶ Play button (a real tap is a user
  gesture).
- **Codec/container probe:** `video.canPlayType(mime)` for the file extension; if
  unsupported, report UNSUPPORTED_FORMAT and show Play button.
- **Player error** now reports PLAYBACK_ERROR (not just a toast).
- **Assistant verification** (`ActionRouting.verifyPlayback`): PLAYBACK_VERIFIED
  only when the player reports PLAYING; otherwise UNSUPPORTED_FORMAT /
  AUTOPLAY_BLOCKED / PLAYBACK_ERROR / PAUSED / LOADING / NOT_EXECUTED.
- **"not playing" diagnostic** (`ActionRouting.diagnoseNotPlaying` wired into
  `intent.js`): reads real player state and answers honestly ("browser can't decode
  this MKV" / "autoplay blocked — tap Play" / "playback error"), never a generic
  explanation.

**Verification:**
- **496/496 headless tests pass** (475 baseline + 21 media verification). Static
  syntax 41/41 AI JS.
- **Status:** `CODE_VERIFIED` / `HEADLESS_VERIFIED`. `DEVICE_VERIFIED` /
  `LIVE_PLAYBACK_VERIFIED` require real-device observation of actual playback —
  not claimed here.

## v2.22.x (behavior) — conversation vs explanation; no fake actions (2026-08-10)

Two CRITICAL real-world behavior fixes. No new Brain/engine — fixes to the
EXISTING Assistant integration.

**Issue #1 — generic explanation template:** `comm.js` `polish()`→`deepen()` was
auto-wrapping ANY short single-line reply ("hello", "how are you", "thanks",
"Done") in the "Great question — let me explain / Here's what this really means /
The core idea / Why it matters / A practical example / Want me to go deeper"
template. Now:
- `deepen()` is **opt-in** (only runs when `polish(msg, { explain: true })`).
- `brain.js` sets `explain: true` only for explicit explanation requests
  (explain/define/what is/what does X mean/how does X work/tell me about/how to/
  in detail/teach me/describe/elaborate).
- Conversational guard: greetings/thanks/status replies are never essay-wrapped.

**Issue #2 — fake action success:** "play evil dead burn video" replied
"Playing Evil Dead Burn 2026…" without playing. Now:
- `openPlayer()` returns `status: "PLAYBACK_REQUESTED"` + honest
  "▶️ Starting <name> in the player…" — it never claims verified playback it
  cannot observe.
- Player auto-plays when opened directly for a file (`?file=...`, via
  `loadedmetadata`→`play()`).
- No-match → honest "I couldn't find a matching video…" (`played:false`).

**Verification:**
- **475/475 headless tests pass** (462 baseline + 13 behavior tests). Static
  syntax 41/41 AI JS.
- **Status:** `HEADLESS_VERIFIED` / `LOCAL_TEST_READY`. Real-device acceptance
  commands must be run on the real device for `DEVICE_VERIFIED` — not claimed.

## v2.22.x — Assistant action intelligence fix (2026-08-10)

Fixed the REAL device-testing bug: natural language like
**"Play the evil dead burn video"** was being answered as an educational
"what is a video?" topic instead of a LocalHub media ACTION. This is an
integration/intent-routing fix — NOT a new Brain, NOT a new memory/routine/
SelfHeal engine.

**Added `action_routing.js`** — a thin deterministic intent-to-capability router on
top of the EXISTING Assistant/Commands/Capabilities/Context/MediaBridge/FS:
- Intent classification (ACTION / QUERY / INFORMATION / CONVERSATION / MIXED);
  explicit info questions are never routed as actions.
- Action-first rule inserted into `intent.js` BEFORE the knowledge/Mind fallback.
- Authoritative capability registry (MEDIA_PLAY/PAUSE/RESUME/STOP/SEARCH/LIST,
  FILE_SEARCH/OPEN/MOVE/DELETE, SERVER_STATUS, CLIENT_LIST...) with risk +
  permission — no invented capabilities.
- Entity extraction (media title/query/type).
- Fuzzy media matching (case/punctuation/articles normalization, token overlap,
  relative threshold) so "evil dead burn" → "The Evil Dead - Burn.mp4".
- Ambiguity (multiple close matches → ask), no-match honesty, mixed requests.
- Conversational context: "pause it"/"resume"/"play the second one"/"play it
  again".
- Risk/permission preserved (FILE_DELETE high+admin; never bypasses policy).
- Structured intent diagnostics for admin (`getLastRoute`).

**`intent.js`** — action routing called after self-awareness/planning and before
`detectIntent`; non-action requests fall through to the original pipeline.

**Verification:**
- **462/462 headless tests pass** (419 baseline preserved + 37 action routing +
  6 action-first intent). Static syntax 41/41 AI JS.
- Bugs found & fixed during testing: MEDIA_SEARCH regex, substring-only search
  (added token fallback), over-eager ambiguity (added relative threshold),
  `capabilityFor` name/action mismatch, `MB.send` accessor misuse.
- **Status:** `HEADLESS_VERIFIED` / `LOCAL_TEST_READY`. The exact command must be
  run on the real device (`http://192.168.0.108:8080`) for `DEVICE_VERIFIED` —
  not claimed here.

## v2.22 — Brain integration + real environment + final hardening + FREEZE (2026-08-10)

Integrated the Personal Brain into the real LocalHub experience as ONE coherent
system, and **froze the Personal Brain architecture** after this pass. Self-Healing
remains frozen. No new engines — all work extends the existing
`Cognitive` / `Cognitive.PersonalBrain`.

**Event integration** (`perceiveEvent`): real LocalHub events (space change, media,
file, backup, storage, Guardian) pass IMPORTANCE + RELEVANCE + FOCUS; only
important/focus-relevant events become memory.

**Real-time context**: updated from actual device/space/page/media/goal state (no
hardcoded demo context).

**Assistant integration** (`brainRespond`): INPUT → intent → context → relevant
memory → personal model → goal → routine → reasoning → response, with memory
mention and reference resolution.

**Contextual conversation**: resolves "that"/"it"/"again"/"yesterday"/"continue
it"/"the previous one" from working memory, recent actions, active goal, episodic
memory, media context, approved routines.

**Spaces / Media / Filesystem / Guardian integration**: space changes update context
without unrelated actions; media context resolves "continue it"; file context
resolves "put that there"; Guardian urgent observations → NOTIFY (Brain never
overrides Guardian security).

**Goal → Routine → Action** (`goalRoutineAction`): executes an approved routine on
context match, verifies, updates goal progress, stores memory + timeline.

**Self-model UI** (`/brain`, admin): shows state, memory controls (search/export/
clear/toggle), routine controls (list/run), timeline, proactive suggestions.
Evidence summaries only.

**Offline + graceful degradation**: works without network/model; if memory is
disabled the Assistant still responds; core LocalHub functionality is not coupled
to the Brain.

**Verification:**
- **419/419 headless tests pass** (381 baseline preserved + 38 Brain integration).
  Static syntax 40/40 AI JS + dashboard brain.js.
- **Real-device:** 🔒 DEVICE_BLOCKED (needs app on device).
- **Status:** `HEADLESS_VERIFIED` / `LOCAL_TEST_READY`.
- **ARCHITECTURE FREEZE:** Personal Brain frozen after this pass. Future work
  focuses on measured bugs/tests/user feedback — not new layers.

## v2.21 — Context-aware proactive intelligence + routine engine (2026-08-10)

Extended the SAME `Cognitive.PersonalBrain` (no new engine). Self-Healing is
**FROZEN** and untouched. The Brain now understands recurring context, recognizes
useful patterns, predicts carefully, suggests intelligently, learns from feedback,
and can execute **approved** routines safely.

**Routine engine:**
- Sequence detection (`observeSequence`, `detectRoutineCandidates`) — repeated
  sequences, confidence-gated; one occurrence never becomes a routine.
- Structured routine model with states CANDIDATE → SUGGESTED → APPROVED → ACTIVE
  → PAUSED/DISABLED/EXPIRED.
- Approval-first: `approveRoutine` requires admin; `rejectRoutine` disables +
  records feedback. No silent automation.
- Contextual matching (trigger/space/device/time/goal) — routine fires only when
  context matches.
- Risk classification (SAFE/LOW/HIGH/CRITICAL); HIGH/CRITICAL steps always require
  explicit approval.
- Cooldown / maxRuns / dailyLimit / bounded retry; repeated failure pauses +
  notifies.
- Routine learning from results + user feedback; edit; persistence across restart.
- Conflict detection (e.g. open X vs close X) → not blindly executed.

**Proactive intelligence:**
- Decision engine (`proactiveDecide`) → IGNORE / REMEMBER / SUGGEST / NOTIFY /
  PREPARE / ACT (ACT needs approval).
- Evidence-backed suggestions (`suggestNow`); suggestion memory with dedup +
  rejected-suggestion suppression (≥3×) → not spam.
- Safe preparation (`prepare`, no high-risk).
- Prediction + evidence-summary explanation.
- Priority ranking.

**Commands (`features_routines.js`):** show my routines / yes make it a routine /
no don't suggest / pause/resume/disable/enable this routine / run this routine /
why did you suggest this.

**Verification:**
- **381/381 headless tests pass** (328 baseline preserved + 53 Routine+Proactive).
  Static syntax 39/39 AI JS.
- **Real-device automation:** 🔒 BLOCKED (needs app on device).
- **Status:** `LOCAL_TEST_READY`.

## v2.20 — Personal Digital Mind (2026-08-10)

Transformed the existing Cognitive Core from an execution layer into a persistent
personal mind (`Cognitive.PersonalBrain`). Self-Healing architecture is **FROZEN**
and was NOT touched. Local, private, offline-first, non-sentient.

**Memory engine:** rich entries (id/type/content/source/importance/confidence/
tags/expiry/relationships); importance scoring; ranked retrieval with confidence
labels (KNOWN/LIKELY/UNCERTAIN); relationships (RELATED_TO, CAUSED_BY, FOLLOWS,
PREFERS, USED_WITH, ABOUT, CONTRADICTS, DERIVED_FROM); consolidation (episodes →
semantic/procedural on threshold); contradiction handling (old preference
SUPERSEDED).

**Profile & context:** non-sensitive personal profile (communication, ui, media,
workflow, device, automation, capabilities); expiring current-life context.

**Attention & focus:** classifyAttention (LOW/NORMAL/IMPORTANT/URGENT) +
attentionLoop (IGNORE/REMEMBER/ACT/NOTIFY); focus with relevance promotion.

**Goals:** rich goal memory (priority/status/progress/tasks/nextAction) that
survives restart via save/restoreContinuity.

**Habits & prediction:** habit detection (≥3 repeats, confidence-gated; one-off
never a habit); predictive next-action only at high confidence.

**Personalization:** adapts communication style to established preferences.

**Privacy:** export/clear/disable memory, all local, no cloud/telemetry.

**Proactive & context:** proactiveSuggestion with cooldown; resolveReference for
"that/it/again/yesterday"; selfModel from actual internal state; event-driven
attention loop (not a busy loop).

**Commands (`features_personal.js`):** remember / recall / forget / correct / show
preferences / why remember / disable / enable / export / clear.

**Verification:**
- **328/328 headless tests pass** (292 baseline preserved + 36 Personal Brain).
  Static syntax 38/38 AI JS.
- **Real-device persistence:** 🔒 BLOCKED (needs the app on a device).
- **Status:** `LOCAL_TEST_READY`. Next milestone: the deeper personal Brain.

## v2.19.1 — Production hardening + architecture freeze (2026-08-10)

Final Self-Healing hardening pass on the SAME `SelfHeal` object (`SelfHeal.Harden`).
No new engine, no new Brain, no redundant layers. **After this release the
Self-Healing architecture is frozen.**

**Transaction safety:**
- Journaled atomic multi-file repair (`runJournaledRepair`) with durable states
  PREPARED → BACKED_UP → APPLYING → APPLIED → VERIFYING → COMMITTED, and failure
  branches ROLLING_BACK → ROLLED_BACK / ROLLBACK_FAILED / ABORTED. All files are
  backed up before any modification.
- Crash-safe recovery (`recoverFromJournal`): on startup scans the journal, verifies
  hashes, restores last-known-good, closes the transaction.
- Hash integrity verified before/after/deploy; unexpected change → fail safe.

**Security hardening:**
- Canonical path resolution + escape rejection (`../`, absolute-outside,
  symlink/junction/mount).
- Protected-file policy (rollback engine, journal, SelfHeal gates, update/deploy,
  credentials, core storage, migration, security) → L5/admin-only.
- Scope limits (max files/lines/bytes/attempts) → STOP + admin.
- Quality gates (path/syntax/static/expected/regression/integration/build/verify).
- Cooldown + repair-storm prevention (escalates to admin after repeated failures).
- Watchdog detects post-deploy regression → stop → rollback → mark unsafe.
- Corruption detection → fail safe, no speculative patch.
- Backup + rollback validation (success only after verification).
- Admin-only repair policy with conservative defaults.
- Append-only audit trail.

**Safeguarded repair entry:** `runRepairWithSafeguards` = policy → scope →
cooldown → gates → journaled transaction → audit in one hardened path.

**Verification:**
- **292/292 headless tests pass** (67+27+45+53+54+46 hardening). Baseline 246
  preserved, zero regression. Static syntax 37/37 AI JS.
- **Android build / APK / device:** 🔒 BLOCKED in sandbox (no SDK/device) — honest.
- **Status:** `LOCAL_TEST_READY`. `DEVICE_VERIFIED`/`LIVE_QA_VERIFIED` only after
  real-device runs. **Architecture frozen** — development now moves to the deeper
  personal Brain.

## v2.19 — Deep autonomous debugging + root-cause intelligence (2026-08-10)

Added a bounded, evidence-driven **debugging engine** (`SelfHeal.Debug`) on the
SAME SelfHeal object — it decides WHY a patch is needed and WHICH
hypothesis/strategy to trust, then hands the chosen fix to the existing safe
pipeline. No new engine, no rebuilt architecture.

**System understanding:** lightweight module/file/dependency/dependent mapping
(server, websocket, filesystem, auth, memory, assistant, cognitive, selfheal,
guardian, media, tts, automation, dashboard; runtime registration).
**Error → source mapping:** stack/compiler/route → module, file, function, call
chain, dependents; returns uncertainty (not a guess) when unmappable.
**Change correlation:** LIKELY_CHANGE / NO_CHANGE_CORRELATION; never auto-blames
the latest change.
**Multi-hypothesis RCA:** bounded set (≤4) with evidenceFor/Against, confidence,
testMethod; scored + ranked; pass boosts, fail rejects.
**Bounded debugging loop** (`runDebugSession`): OBSERVE→HYPOTHESIZE→TEST→UPDATE→
SELECT→REPRODUCE→ROOT CAUSE→PATCH, bounded by `maxInvestigationAttempts`
(never infinite). Multi-file upstream/call-chain hypothesis inspects dependent
layers.
**Patch strategy engine:** multiple candidate repairs ranked by coverage/safety/
scope/testability/regression-risk/confidence; prefers the smallest safe root-cause
fix; Patch-A-fails → Patch-B (bounded `maxPatchAttempts`).
**Regression test generation:** a test that fails before the patch and passes
after it.
**Incident signatures + regression intelligence:** stable deterministic signature;
KNOWN_PATTERN / SIMILAR_PATTERN / NEW_PATTERN; prior solutions surfaced but never
auto-reused without validation.
**Local model assistance:** deterministic engine authoritative; model assists;
no model → `MODEL_ASSISTANCE_UNAVAILABLE`; invalid/unsafe model output → rejected.
**Confidence separation:** evidence / RCA / patch / verification tracked
separately, evidence-based.
**DebugSession object:** full auditable investigation (observations, hypotheses,
tests, rejected patches, selected patch, verification, finalOutcome) without
exposing hidden reasoning.
**Guardian observations:** observer provides evidence only; Debug owns RCA.
**Cognitive brain:** "why did LocalHub crash" now reports affected module, call
chain, pattern, confidence, repair status.

**Commands:** `debug incident <id>`, `hypotheses`, `known pattern`.

**Verification:**
- **246/246 headless tests pass** (67 + 27 + 45 + 53 + **54 deep-debugging**).
  Baseline 192 preserved, zero regression. Static syntax 37/37 AI JS.
- **Android build / APK / device:** 🔒 BLOCKED in this sandbox (no SDK/device) —
  honest. Real local-model inference: ⭕ MODEL-DEPENDENT.
- **Status:** `LOCAL_TEST_READY`. `DEVICE_VERIFIED` / `LIVE_QA_VERIFIED` only after
  real-device runs.

## v2.18 — Real-device self-healing integration (2026-08-10)

Moved the maintenance subsystem from `LOCAL_TEST_READY` toward `DEVICE_VERIFIED`
by wiring the real Android build, APK discovery/verification, device connection,
authorized install, and on-device runtime verification into the SAME `SelfHeal`
object (no new engine). All execution goes through a safe allowlist; no arbitrary
AI-generated shell. Where the toolchain/device is absent, every step returns an
explicit honest status.

**`SelfHeal.Device` (real-device engine):**
- `preflightBuild` — verifies project root, gradle wrapper, structure, SDK,
  build-tools, workspace allowlist; creates a build context record.
- `buildWithSelfHeal` — allowlisted build; on failure extracts compiler errors →
  incident → RCA → candidate repair → static validation → rebuild, **bounded to 3
  repair iterations** (never infinite); rollback + report when exhausted.
- `extractCompilerErrors` — parses `file:line:col: error:` from build logs.
- `discoverApk` — locates/verifies the APK (exists/ext/size/checksum/package/version).
- `detectDevice` — `DEVICE_READY` / `DEVICE_UNAUTHORIZED` / `DEVICE_NOT_CONNECTED`;
  never bypasses Android authorization.
- `installApk` — explicit admin authorization required; records device/package/
  hash/result/timestamp; failure → incident (never claims success).
- `verifyRuntime` — 18 on-device checks with explicit statuses
  (`PASS/FAIL/NOT_AVAILABLE/AUTHORIZATION_REQUIRED/DEVICE_VERIFICATION_REQUIRED`);
  `DEVICE_VERIFIED` only when all required checks genuinely pass.
- `classifyFailure` — 8 categories (PRODUCT_BUG, SELFHEAL_BUG, QA_BUG,
  ENVIRONMENT_FAILURE, DEVICE_CONFIGURATION, BUILD_FAILURE, NETWORK_FAILURE,
  PERMISSION_FAILURE).
- `captureDeviceEvidence` — full real-device evidence record.
- `runDeviceDeployPipeline` — orchestrates preflight → build → APK → device →
  install → runtime verify → keep/rollback with honest gates.

**`SelfHeal.Transaction` (atomicity + crash recovery):**
- `runMultiFilePipeline` — multi-file patch as ONE transaction; any failure rolls
  back every written file (A,B,C → all restored). Never leaves partial state.
- `recoverIncompleteTransaction` — on startup, detects pending transactions and
  resolves them cleanly (restore known-good).

**`SelfHeal.DeviceRegressions`:** `storeDeviceRegression` / `findDeviceIncident`
— device+Android-version+APK-hash regression memory.

**UI (`/selfheal`):** new Device & Build card — App version, current/known-good
version, build status, APK, install status, device, runtime verification; actions
Preflight Build / Build / Discover APK / Detect Device / Install APK / Verify
Runtime / Deploy Pipeline. Admin-only, permission-gated.

**Cognitive brain:** the "fix it" path now attempts the build→install→verify
lifecycle and reports honestly (verified deployment vs. blocked-by-environment).

**Verification:**
- **192/192 headless tests pass** (67 self-healing + 27 cognitive + 45 E2E + 53
  real-device integration). Static syntax 37/37 AI JS + dashboard selfheal.js.
- **Android build / APK / install / device:** 🔒 BLOCKED in this sandbox (no SDK,
  no Gradle, no device) — reported as `BUILD_REQUIRED` / `NOT_AVAILABLE` /
  `DEVICE_VERIFICATION_REQUIRED` / `AUTHORIZATION_REQUIRED`. Not faked.
- **Status:** `LOCAL_TEST_READY`. `DEVICE_VERIFIED` only after real-device
  build+install+verify; `LIVE_QA_VERIFIED` only after Playwright passes against
  the real LAN address.

## v2.17.1 — End-to-end Self-Healing subsystem (2026-08-10)

Integrated the FileEngine end-to-end with the Self-Healing engine and Guardian,
turning SelfHeal from a tested repair engine into a real LocalHub maintenance
subsystem. Same single `SelfHeal` / `Cognitive` objects — no duplicate system.

**Engine (`selfheal.js`):**
- `runIncidentPipeline()` — one orchestrator for the full lifecycle with a
  structured, auditable `steps[]` trail:
  detect → incident → evidence → affected component/files → read source → RCA →
  patch → static validation → regression test → backup → apply → verify →
  KEEP/ROLLBACK → structured incident memory.
- `resolveAffectedFiles()` + `inspectAffectedFiles()` — read-only component→file
  mapping and inspection.
- `approveAndDeploy(incidentId, admin)` — real admin-approve → FileEngine deploy.
- `repairBuildWithBound()` — bounded (≤3) build→incident→repair→rebuild loop.
- `storeIncidentMemory()` — updates the existing incident record in place with
  rootCause/evidence/affectedFiles/patch/result/rollback.
- **Path security fix:** `runConcreteFix` rejects traversal/outside-workspace
  targets BEFORE reading.
- **Static-validation fix:** a patch with no explicit expected behavior is
  rejected (never deployed).
- Safe test-workspace bug simulation: `runTestScenario` (success),
  `runTestScenarioReject` (static fail), `runTestScenarioRollback` (functional
  verify fail → rollback), `injectTestBug`, `cleanupTestWorkspace`.
- `postVerifyCheck` support so functional (not just hash) verification failures
  trigger automatic rollback.

**Guardian (`features_guardian.js`):**
- `decide()` documents the boundary: Guardian DETECTS, SelfHeal DECIDES, policy
  AUTHORIZES; Guardian never modifies source (`sourceModified:false`).

**Cognitive Brain (`cognitive.js`):**
- `selfHealChat(text, role)` — "why did X crash?" (retrieve incident + RCA +
  confidence + status) and "fix it" (admin-gated repair plan/goal). Wired into
  `process()`.

**UI:**
- New Admin-only Self-Healing console: `dashboard/selfheal.html` +
  `dashboard/selfheal.js`, served at `/selfheal` (AssetServer route added). Shows
  System Health, active incidents, severity, root cause, confidence, affected
  component/files, repair level, patch/test/backup/deploy/verify/rollback status,
  incident history, and actions (investigate, approve, reject, retry, rollback,
  diff, evidence, run regression, run build, verify device, model status).
  Non-admins see only an access gate.

**Verification:**
- **139/139 headless tests pass** (67 self-healing + 27 cognitive + 45 E2E
  integration). Static syntax 37/37 AI JS + dashboard selfheal.js.
- **Android build / APK / install / device:** ❌ NOT RUN (no SDK/device) —
  reported honestly as `BUILD_REQUIRED` / `DEVICE_VERIFICATION_REQUIRED`.
- **Readiness:** `LOCAL_TEST_READY` + safe Android build/device mechanisms in
  place; becomes `DEVICE_VERIFIED` only after a real-device run.

## v2.17 — Completed Cognitive + Self-Healing capabilities (2026-08-10)

Closed the previously-incomplete (orange/red/partial) capabilities with real code
+ real headless tests. Same single `SelfHeal` and `Cognitive` objects — no
duplicate brain, no cosmetic label changes.

**Cognitive Core (`cognitive.js`) — genuinely implemented:**
- Memory **correction** (`correctMemory`) and explicit **ranking** (`rank`).
- **Personal model** — non-sensitive preference learning, persisted locally.
- **Dynamic planning** — `planGoal()` auto-generates step plans.
- **Conversational continuity** — `process()` keeps previousFocus/lastInput/lastResponse.
- **Risk assessment** — path-scope risk elevation + `riskScore`.

**Self-Healing (`selfheal.js`) — genuinely implemented:**
- **Local Model Provider** — vendor-neutral adapter exposing `analyzeIncident /
  proposePatch / explainRCA / generateTests / plan` + `setLocalModelProvider()`;
  no hard-coded vendor, no cloud dependency; deterministic fallback stays honest.
- **Autonomy L0–L5 wired** into `handleDetection` (L1 safe-recovery, L4 gate,
  L5 critical=admin).
- **Reproduction** (`reproduceIncident`) with honest statuses.
- **Regression runner** (`runRegressions`) that executes stored tests.
- **Incident-memory safe reuse** (`findKnownIncident` + `validateReuse`).
- **Safe Android build pipeline** (`BuildRunner` allowlist; build failures →
  incidents; honest `BUILD_REQUIRED` without SDK).
- **Device verification workflow** (`verifyDevice`, 12 checks, honest).
- **Unified detection feed** (`ingestDetection`) — crashes/exceptions/API/WS/
  automation/DB/server/resource/UI/background/QA/regression failures, thresholded.
- **Fixed a real bug:** `runFileFix` now rejects path-traversal/outside-workspace
  targets BEFORE reading the file.

**Guardian (`features_guardian.js`):**
- Feeds the Cognitive Core + self-healing engine (`Guardian.ingest`).
- Broader log-based detection (`_classifyLogLine`, `_scanLogsForFailures`).

**Commands (`features_selfheal.js`):**
- Added: `reproduce incident`, `run build`, `verify device`, `run regressions`,
  `model status`, `set model`, `report failure`.

**Verification:**
- **Headless tests: 94/94 pass** (67 self-healing + 27 cognitive), real
  assertions against the actual engine with a mock FS/Memory.
- **Static syntax: 37/37 AI JS files pass** `node --check`.
- **Android build / APK / install / device:** ❌ NOT RUN in sandbox (no SDK /
  device). Reported honestly as `BUILD_REQUIRED` / `DEVICE_VERIFICATION_REQUIRED`.
- **Readiness:** `LOCAL_TEST_READY` + safe Android build/device mechanisms in
  place → becomes `DEVICE_VERIFIED` only after a real-device run.

## v2.16.1 — Real File-Level Self-Healing Engine (2026-08-10)

Upgraded the self-healing engine from orchestration/static-validation to a
**real, safe, auditable, file-level** patch/backup/rollback system. Extends the
same `SelfHeal` object (`SelfHeal.FileEngine`) — no duplicate brain.

**File-level capabilities (all deterministic + honest):**
- SHA-256 hashing (with deterministic FNV fallback) for before/after verification.
- Real patch objects with before/after hashes, human-readable `---/+++` diff,
  reason, expected behavior, risk, approval, status.
- **Patch safety**: path-traversal rejection, workspace allowlist, before-hash
  re-check (abort on change), no arbitrary shell execution, no model-code exec.
- **Critical-file detection** (by filename: auth/security/keystore/credentials/
  secrets) → always admin approval.
- **Real backup** (snapshot + original content + hash) and **real rollback**
  (restores exact content, verifies hash; on failure → `ROLLBACK_FAILED`).
- **Honest testing**: `testFilePatch` returns level `STATIC` + explicit
  limitations; unavailable build/device layers → `BUILD_REQUIRED` /
  `DEVICE_VERIFICATION_REQUIRED` (never fake "passed").
- **Full lifecycle** `runFileFix`: read → hash → diff → approval gate → static
  test → backup → apply → verify → auto-rollback on failure.
- **Engine self-diagnosis** (`engineSelfDiagnose`) reporting engine health.
- **File-level commands**: show incident / show patch / show diff / show snapshot /
  test patch / verify fix / engine health.

**Verified:** 26/26 headless file-level tests pass (hash, traversal, workspace,
critical files, approval gates, diff, backup, apply, verify, rollback success &
failure, engine health, honest test report). A bug in over-broad critical-file
detection was found and fixed (now matches filename, not path).

**Android limitations (honest):** build not executed, APK not generated/installed,
device not tested in this sandbox (no Android SDK). Readiness = `LOCAL_TEST_READY`.

## v2.16.0 — Self-Healing Engine + Goals + Local Model + docs (2026-08-10)

Evolved the Cognitive Core into a **safe, controlled, local software diagnostic
and repair system** (the "self-healing engine") — not uncontrolled self-modification.

**New `selfheal.js` (`global.LH_AI.SelfHeal`):**
- **Repair levels 0-5** (observe → safe recovery → diagnostic → patch proposal →
  trusted automated → critical/admin-only).
- **Incident lifecycle**: detect (significance gate) → capture evidence → RCA
  (honest confidence) → propose patch → test (static checks) → backup →
  deploy (gated) → verify → rollback → learn.
- **Safety gates**: never bypass auth/permissions/security; never delete user
  data; never fabricate repairs; critical components (auth/security/migration/
  storage) always require admin approval.
- **Local Model Provider** abstraction with a deterministic fallback (no vendor
  lock-in).
- **Self-healing memory** (resolved incidents → reusable procedural knowledge)
  and **regression memory** (fixes → regression tests).
- **Backup / rollback** with restorable snapshots.

**`cognitive.js` additions:**
- **Persistent Goals** (set/get/continue/complete/cancel/load) — goals persist and
  can be resumed after a reload.
- **Fast path / deep path** dispatch.
- `restoreState` (used by rollback).
- `selfHeal(detection)` integration.

**New `features_selfheal.js` commands:** diagnose, report incident, list
incidents, approve fix, rollback, self-healing status, goals.

**Docs (7 files):** COGNITIVE_ARCHITECTURE.md, COGNITIVE_MEMORY.md,
COGNITIVE_CAPABILITIES.md, SELF_HEALING_ARCHITECTURE.md, SELF_HEALING_SECURITY.md,
INCIDENT_RESPONSE.md, PATCH_LIFECYCLE.md — each with IMPLEMENTED/PARTIAL/OPTIONAL/
NOT-IMPLEMENTED labels.

**Verified (headless, in-browser VM):** significance gate, critical-component
gate, incident + RCA + admin-approval flow, backup + rollback, regression tests,
goals + continue, self-diagnose — all pass. Static checks pass on all JS. Real
Android build/QA is honestly reported as requiring the SDK (not available in this
sandbox).

## v2.15.0 — Cognitive Core (unified offline personal assistant) (2026-08-10)

Evolved the LocalHub Assistant from a command/chatbot into a **unified Cognitive
Core** — a private, offline-first, persistent personal assistant. This **unifies**
existing modules rather than duplicating them; `brain.js` remains the one central
brain.

**New `cognitive.js` — the Cognitive Core (`global.LH_AI.Cognitive`):**
- **Cognitive loop**: PERCEIVE → UNDERSTAND → CONTEXTUALIZE → REMEMBER → REASON →
  DECIDE → PLAN → CHECK POLICY → ACT → OBSERVE → VERIFY → REFLECT → LEARN →
  UPDATE MEMORY.
- **Event bus** + **perception**: `on/off/emit/perceive` with normalized event
  envelopes `{ts, type, source, data, importance, confidence}`.
- **Persistent internal state** (via Memory): identity, mode, goal, task, focus,
  confidence, riskLevel, lastActionResult, lastVerify, recoveryAttempts,
  observations, errors. Loaded at boot; inspectable by admin.
- **Memory layers**: working (in-memory), episodic (`episodes`), semantic
  (`knowledge`), procedural (`procedures`). With importance, relevance scoring,
  recency, decay, dedup, forget, forget-all.
- **Tool registry**: 18 tools with risk (low/med/high/critical), reversibility,
  permission, confirmation, and run function.
- **Decision/will layer**: permission enforcement + risk-based confirmation
  (high/critical → confirm).
- **Action executor**: ACT → OBSERVE → VERIFY → RECOVER (bounded retry + backoff).
- **Reflection & learning**: records outcomes; learns safe, bounded procedures.
- **Personality**: separate from intelligence (configurable identity/tone/style).
- **Self-model / self-awareness**: reports can/cannot do, tools, offline, guardian.
- **Proactive behavior**: importance + cooldown + duplicate suppression.
- **Cognitive debug view** (admin, in Brain Diagnostics): mode, goal, task,
  focus, confidence, risk, recovery, tools, last action/verify, personality,
  guardian, recent memories.

**`brain.js` evolved**: `handleUserMessage` now routes through
`Cognitive.process` (falling back to the classic Intent pipeline if Cognitive is
absent), so the full cognitive loop runs without removing any existing
capability. Imperative actions are consumed by the core to avoid double-execution.

**Docs**: added `COGNITIVE_ARCHITECTURE.md` and `COGNITIVE_CAPABILITIES.md`.

**Verified (headless, in-browser VM):** Cognitive Core loads, 18 tools register,
decision layer enforces permission + confirmation (delete=admin+confirm),
executeAction verifies (mkdir → "Verified: exists"), episodic/procedural recall
works, personality/self-model/debug-view work, event bus works, and the full
`Cognitive.process` loop handles 9/9 representative inputs. Backward
compatibility intact (Commands.parse still works; existing commands unaffected).

> Note: The Android project itself cannot be compiled in this sandbox (no Android
> SDK). The pure-Kotlin module wiring added earlier was compile-verified against
> stubs; the JS Cognitive Core is tested headlessly. Build the APK in Android
> Studio to run on-device.

## v2.14.1 — More Modules: Core LocalHub features (2026-08-10)

Added a **`CoreCapabilities`** registry with 12 modules representing LocalHub's
core features, in addition to the 9 assistant capability modules.

**New core modules** (category = core):
- HTTP Server, Security, File Manager, Media Player, Screen Mirror & Remote,
  Device Actions, LAN Shares, System Monitor, Automation, Offline Speech (TTS),
  LocalHub OS Layer, ESP32 Remote.

Each carries capabilities, honest limitations, and accessibility (server/security/
mirror/device/shares/automation/esp32 are admin; files/media/monitor/tts/os are
all).

**Total: 21 modules** (9 assistant + 12 core) shown in the APK Modules screen.

Verified (compile + run): `AssistantCapabilities.all()` + `CoreCapabilities.all()`
register 21 modules, no duplicate ids, correct category/accessibility split.

## v2.14.0 — APK Modules Screen: all assistant modules + settings (2026-08-10)

The native (Compose) **Modules** screen now shows every assistant subsystem with
its **settings** (capabilities, limitations, accessibility), not just the 3 core
modules.

**`CapabilityModule` + `AssistantCapabilities` (new):**
- A lightweight metadata module type representing each assistant subsystem.
- 9 capability modules registered: AI Assistant, Mind Engine, Self-Awareness,
  Knowledge Base, Critical Thinking, Background Guardian, Voice (TTS),
  Communication Skills, Self-Development.
- Each carries honest **capabilities**, **limitations**, and **accessibility**
  (e.g. Guardian & Self-Dev are admin-only).

**`ModuleInfo` extended** with `category`, `capabilities`, `limitations`,
`accessibility` — so the UI and `/api/modules` can show real settings.

**Room persistence:**
- `ModuleEntity` + mappers extended with the new fields (pipe-joined lists).
- `AppContainer` seeds the full module list into Room on startup.
- `ModulesViewModel.toggle()` persists the updated metadata on toggle.
- `fallbackToDestructiveMigration` already handles the schema change safely.

**UI:**
- `ModulesScreen` shows a summary ("N / M enabled") + a header.
- `ModuleCard` is now **expandable**: "Show settings" reveals Accessibility,
  Capabilities, and Limitations per module, with a category icon.

Compile-checked the pure-Kotlin wiring (ModuleInfo, LocalModule, CapabilityModule,
ModuleEntity, mappers, and a live test of `AssistantCapabilities.all()`) — 9
modules, unique ids, correct metadata, no duplicate ids.

## v2.13.2 — Fix: self-awareness now wins over keyword matching (2026-08-10)

Fixed the "what is your goal" bug the user reported — the assistant answered with
the dictionary meaning of "goal" instead of its own purpose.

**Root cause:** the command engine matched the "goal" knowledge keyword BEFORE the
Mind engine's self-awareness could run, so "your goal" was treated as a generic
topic.

**Fix:**
- `intent.js` now checks **self-awareness FIRST**, before any command/keyword
  match. If the query references "you/your/yourself" + an intent word
  (goal, limit, purpose, name, can-do, who, etc.), it routes straight to the Mind
  engine, which answers about the assistant itself.
- Added a **goal/purpose/mission self-answer** ("My goal is to be your reliable
  local assistant...").
- Exposed `Mind.isSelfQuery()` and `Mind.answer()` so the Intent pipeline can use
  them.

Verified end-to-end: "what is your goal" → assistant's own goal; "what is your
limit" → its limits; "what can you do" → capabilities; while plain "what is a
goal" still returns the dictionary definition. Self-awareness now always wins over
generic keyword matching.

## v2.13.1 — Fix: one-liner answers & wrong matches (2026-08-10)

Fixed the "still getting one-liner / child-level answers" bug the user reported on
the latest version. Root cause + fixes:

- **Wrong match:** "what is memory" returned "Memory — ram." because a duplicate
  `know3-memory` entry in `features_extra.js` was wrong (it conflated memory with
  RAM) and, being loaded earlier, won the tie. Replaced it with a correct, deep
  definition ("Memory is the ability to encode, store, and retain information...").
- **Broadened `Comm.deepen()`:** previously it only expanded one-liners that began
  with "a/an/the/software/...". Now it expands **any short single-line factual
  reply** into a structured multi-part explanation, while still correctly skipping
  actions, confirmations, telemetry (CPU/%), and status lines ("no clients",
  "none", "not found", "command error", etc.).
- **Cleaner topic extraction** in deepen (strips "what is a/an/the/...").

Verified end-to-end: memory, browser, computer, algorithm, database,
photosynthesis, gravity, program, html, wifi all now return 247-649 character deep
answers — **0 short one-liners** in the sweep.

## v2.13.0 — 1000% Knowledge & Thinking Expansion (2026-08-10)

Massively expanded the deep-knowledge base and the thinking engine.

**`features_deep3.js` — 228 more genuine deep entries** (multi-sentence, adult-level)
across 20+ domains:
- Physics (Newton's laws, gravity, energy, waves, quantum, nuclear, lasers...)
- Chemistry (bonds, periodic table, acids/bases, pH, reactions, polymers...)
- Biology (photosynthesis, cells, DNA, genes, proteins, enzymes, immunity,
  evolution, ecosystems...)
- Astronomy (solar system, planets, stars, black holes, galaxies, Big Bang...)
- Geography/Earth (plate tectonics, earthquakes, volcanoes, climate, water cycle...)
- History (Renaissance, Industrial Revolution, civilizations, world wars...)
- Economics/Finance (inflation, supply & demand, interest, GDP, investing,
  compound interest, crypto, credit, tax...)
- Business (entrepreneurship, marketing, brand, business model, strategy,
  leadership, supply chain, sales, negotiation...)
- Technology (OS, software, hardware, CPU, RAM, storage, GPU, data structures,
  algorithms, binary, programming languages, Git, databases, cloud, AI, ML,
  neural networks, deep learning, vision, NLP, cybersecurity, encryption...)
- Health (health, nutrition, immunity, exercise, sleep, mental health, vaccines,
  hypertension, diabetes, medicine, bacteria, viruses, surgery...)
- Psychology (memory, learning, cognitive bias, stress, anxiety, depression,
  emotional intelligence, mindfulness, motivation, personality, habits...)
- Philosophy (ethics, logic, epistemology, metaphysics, utilitarianism,
  deontology, skepticism, free will...)
- Arts/Literature/Language, Sports/Fitness, Food/Culinary, Travel.

**Total deep knowledge: 362 entries** (60 + 74 + 228), plus the generic
`Comm.deepen()` expander as a fallback.

**Thinking engine benefit:** the Mind engine now retrieves and weaves these deep
entries into its multi-part answers — "what is gravity", "why does inflation
happen", "explain supply and demand" all return 620-725 character reasoned
answers combining the deep fact, structured explanation, and a human reflection.

Verified: `node --check` clean; 12 deep3 topics (gravity, compound interest,
neural network, supply & demand, entrepreneurship, plate tectonics, black hole,
emotional intelligence, industrial revolution, cloud computing, mindfulness,
blockchain) all return 196-448 char genuine answers.

## v2.12.0 — Deep-Answer Engine (no more child-level one-liners) (2026-08-10)

Fixed the "answers are still too basic" complaint with two layers that turn short
one-liners into adult-level, structured explanations.

**`Comm.deepen()` (generic deep-expander):**
- Any short definition-like one-liner (a/the/software/protocol/... + 18-160 chars)
  is automatically expanded into a structured multi-part explanation:
  "Great question — let me explain properly." + the idea + what it really means
  (core idea, why it matters, how it fits, a way to use it) + a deeper-offer.
- Actionable/navigational/confirmation replies (Opening..., Restarting..., CPU
  usage is...) are NOT deepened — they stay concise.

**`features_deep2.js` — 74 more genuine deep entries:**
- Added real multi-sentence explanations for cloud computing, virtualization,
  containers, serverless, microservices, web APIs, frontend/backend/full-stack,
  API design, data modeling, SQL, indexing, transactions, normalization, SQL
  injection, auth/authz, JWT, OAuth, HTTPS/TLS, encryption, hashing, blockchain,
  mining, wallets, ML concepts (model, training data, overfitting, layers,
  gradient descent, learning rate, activation, backprop, epoch, LLM, prompt,
  hallucination, NLP, computer vision, speech, RL, recommender), time/space
  complexity, recursion, DP, greedy, data-structure choice, sorting, binary
  search, OS, kernel, process, thread, scheduler, virtual memory, GC, file
  systems, networking, protocols, IP, DNS, HTTP, status codes, WebSocket, cache,
  load balancing, firewall, VPN, proxy, latency, bandwidth.

Combined with the existing 60 deep entries, the assistant now has **134 genuine
deep entries** plus the generic deepener as a fallback for everything else.

Verified: `node --check` clean; "what is https", "what is a container", "what is a
load balancer", "what is oauth", "what is binary search", "what is virtual
memory" all return 237-308 char genuine explanations.

## v2.11.0 — Self-Healing & Self-Improvement (2026-08-10)

The Background Guardian now **fixes issues on its own** and suggests improvements,
not just alerts.

**Self-healing:**
- `healPlan()` maps each detected problem to a fix: storage-full → auto-clear the
  server cache; high CPU/memory → advice; low battery → advice.
- `applyFix()` can run a server action (e.g. `server/clear-cache`) or a JS
  function, and reports what it did in chat.
- `auto-heal` toggle: with it ON the guardian fixes what it safely can; with it
  OFF it only advises. Commands: "auto-heal on" / "auto-heal off".

**Self-improvement:**
- `suggestImprovements()` gives proactive optimization tips (free storage, enable
  HTTPS/2FA, set up automations, keep app updated).
- "improve localhub" command → runs a health check + returns improvement tips.

**Parser comprehension fix (`commands.js`):**
- Added a **min-match-length rule**: single-letter / 2-char knowledge matches
  ("c", "on", "o(n)", "os") no longer shadow meaningful multi-word commands. This
  was the root cause of comprehension errors like "what is your limit" matching
  the letter "c". Fixed the unescaped `o(1)`/`o(n)` big-O regexes in
  features_jarvis.js too.
- Added 8 guardian commands: health-check, guardian-start, guardian-stop,
  guardian-status, auto-heal-on, auto-heal-off, improve-localhub, guardian-help.

Verified: `node --check` clean; all 8 guardian commands parse; health check with a
bad system state reports all 4 issues; "what does the guardian do", "auto-heal
on/off", "improve localhub" all route correctly.

## v2.10.0 — Background Guardian: Proactive Monitoring (2026-08-10)

Made the assistant a **proactive security guard** for LocalHub — it monitors the
system ON ITS OWN, without waiting for a command. New `features_guardian.js`.

**Proactive monitoring (auto-starts in brain boot):**
- Every 30s it checks system health and raises alerts in chat when it finds:
  - Storage nearly full (≥85%)
  - Battery low (≤15%)
  - High CPU (≥90%)
  - Memory nearly full (≥90%)
- It also watches the server logs for recent ERROR entries and flags an unusual
  number of connected clients.
- Alerts are **cooldown-gated** (no spam) and only fire on a state change.
- If the system endpoint becomes unreachable, it warns that the server may be
  having issues.

**On-demand self-diagnosis commands:**
- "run health check" / "scan for problems" / "check server health" / "system
  health" / "self-diagnostic" → full audit report.
- "start guardian" / "stop guardian" / "guardian status" → control the watchdog.
- Guardian auto-start respects a persisted enabled/disabled setting.

Verified: `node --check` clean; audit detects storage-full, low-battery, high-CPU,
and low-memory; health-check command parses and reports.

## v2.9.0 — Self-Awareness (assistant understands questions about itself) (2026-08-10)

Fixed a core comprehension gap: when asked "what is your limit", the assistant now
understands "your" refers to **itself** and answers about its own limits — instead
of giving the dictionary definition of "limit".

**`SelfAware` engine (in `features_mind.js`):**
- Detects questions about the assistant via "you / your / yourself" + an
  intent word (limit, can, who, how, name, remember, feel, offline, privacy...).
- Answers about itself:
  - Limits/limitations ("what is your limit", "what can't you do")
  - Capabilities ("what can you do", "your features/skills")
  - Identity ("who are you", "what is your name", "are you a robot")
  - How it works / thinks ("how do you work/think/process")
  - Memory ("do you remember things", "your memory")
  - Feelings/consciousness ("can you feel emotions", "do you have a soul")
  - Offline/privacy ("are you offline", "do you send my data")
  - Speaking style ("why do you talk like that", "your tone")
- Runs first in `Mind.think()`, so free-form self-questions never fall through to
  keyword dictionary answers.

**Self-awareness commands** (registered with `deep:true` so they win the parser):
- self-limits, self-capabilities, self-identity, self-how-work, self-memory,
  self-feel, self-offline.

Verified: `node --check` clean; "what is your limit", "what can you do", "who are
you", "how do you work", "are you offline", "do you remember things", "can you
feel emotions", "why do you talk like that" all answer about the assistant.

## v2.8.0 — Deep, Adult-Level Knowledge (2026-08-10)

Fixed the "answers are too basic / child-level" problem by adding **deep,
multi-sentence knowledge** and a smarter parser that prefers it.

**`features_deep.js` — adult-level knowledge (60 entries):**
- Each entry is a **3-6 sentence detailed explanation** (260-500 chars) instead of
  a one-line definition — covering AI, ML, neural networks, databases, OS, cloud,
  encryption, blockchain, crypto, quantum computing, NLP, LLMs, data structures,
  algorithms, REST, HTTP, version control, compilers, JSON, git, DI,
  microservices, containers, programming languages, web/mobile/data-science
  development, finance/investing, health/nutrition, psychology, economics,
  philosophy, environment, and more.

**Parser upgrade (`commands.js`):**
- Commands can now be flagged `deep:true`. When two commands match the same
  text, the **deep (detailed) one wins** over a shallow one-liner. This means
  "what is machine learning" returns the full multi-sentence answer, not the
  one-line summary.

**Mind engine enhancement (`features_mind.js`):**
- The `define` case now builds a **richer multi-part explanation** (what it is,
  why it matters, how it fits, an example) even when only a compact fact is
  retrieved.
- Knowledge retrieval now also pulls from the `deep-know` category, so Mind-based
  answers benefit from the deep base.

Verified: `node --check` clean; deep entries (260-500 chars) win over one-liners,
and the Mind engine surfaces deep knowledge for the same topics.

## v2.7.0 — Communication & Presentation Skills (2026-08-10)

Made the assistant sound like a **helpful person, not a robot**. Two new files:
`comm.js` (a reply-polishing engine) and `features_comm.js` (communication-skills
knowledge + style commands).

**`comm.js` — reply-polishing engine:**
- Every assistant reply now passes through `Comm.polish()`: fixes grammar
  (i→I, contractions), collapses stray spaces, capitalizes, and turns
  telegraphic/raw text into natural flowing sentences.
- Adds a **warm human opener** (Sure / Happy to help / Got it...) and an
  **optional closing nudge** (anything else?) to multi-line replies — rotated to
  avoid sounding repetitive.
- `Comm.forSpeech()` sanitizes text for clean, readable voice output (strips
  markdown/URLs, collapses whitespace).
- Wired into `brain.js`: both the on-screen reply and the spoken reply are
  polished.

**`features_comm.js` — communication skills & style control:**
- Knowledge: clear communication, active listening, tone of voice, presentation
  skills, concise writing, clarity, empathy, confident speaking, body language,
  persuasion, formal vs informal, explaining complex ideas, asking questions,
  handling objections, giving feedback, storytelling, voice modulation, pausing,
  avoiding filler words, positive language.
- Style commands: "be more formal / casual / concise / detailed", "how do you
  talk", "explain this clearly", "polish my message", "rephrase this".

Verified: `node --check` clean; reply polishing + all comm commands work.

## v2.6.0 — Human-Mind Refinement + Expanded Knowledge (2026-08-10)

Refined the assistant's thinking/understanding to feel like a **human mind**, and
expanded the knowledge base. Two files: `features_mind.js` enhanced, and new
`features_refined.js`.

**Mind engine — more human-like:**
- **New question types**: opinion, predict, summarize, brainstorm, critique, plan
  (now 18 types total).
- **Human-mind reflection**: every reasoned reply now ends with a short
  meta-thought — naming the reasoning used, honestly flagging uncertainty, and
  inviting a follow-up ("here's my reasoning, not absolute truth...", "predictions
  carry uncertainty...", "a plan is only useful if you take the first step...").
- Broader classification (e.g. "will X happen" → predict).

**Refined critical thinking (`features_refined.js`):**
- 21 advanced frameworks: metacognition, cognitive reflection, lateral reasoning,
  deductive ladder, abductive reasoning, inference calibration, premise checking,
  counterfactual thinking, decision journaling, falsification mindset, cognitive
  empathy, framing effect, temporal discounting, sunk-cost correction, regret
  minimization, second-best principle, chunking complexity, diagram thinking,
  analogical transfer, consider-the-opposite, meta-level reasoning.

**Expanded knowledge:**
- Communication & language, personal finance, productivity & habits, study &
  memory, health & wellbeing, environment, everyday science.
- Plus 4 new assistant self-reflection commands (reflect, consider-perspectives,
  check-assumptions, think-like-scientist).

Verified: `node --check` clean; 12/12 refined queries + all Mind types answered.
Total commands now **11,473**.

## v2.5.0 — The Mind: a Real Thinking Engine (2026-08-10)

Gave the assistant an actual **thinking/understanding engine** — a "Mind" that
processes any free-form question or task through a reasoning pipeline, like a real
assistant's brain. New `features_mind.js`, wired into the Intent pipeline.

**How it thinks** (pipeline): Classify → Extract Topic → Retrieve Knowledge →
Structure → Reason → Conclude → Natural Reply.

- **Classifies the question** into: define, cause, compare, how, scenario,
  decision, verify, risk, when, how-work, fact, explain.
- **Extracts the topic** by removing question/stop words.
- **Retrieves knowledge** from both the built-in 11k+ command knowledge base and
  the user's custom Knowledge store.
- **Builds a structured reasoned answer** tailored to the question type — with real
  retrieved facts plus a thinking method (cause-chain, decision steps, verification
  steps, risk assessment, etc.).
- **Auto-triggers on unknown/free-form queries**: when a query isn't a known
  command, the Mind engine thinks about it instead of replying "I didn't recognize".
- **Explicit commands**: "mind: <question>", "think about <X>", "reason about <X>",
  "analyze <X>", "what do you think about <X>".

This is the difference the user asked for: it doesn't just give a static framework —
it processes the question through a thinking pipeline and produces a reasoned,
structured answer.

Verified: `node --check` clean; the full Intent→Mind pipeline handles unknown
queries, known commands, and explicit mind: invocations correctly.

## v2.4.0 — Self-Dev: LocalHub Project Knowledge + Self-Debugging (2026-08-10)

Gave the assistant deep understanding of **its own codebase** so it can reason
about the LocalHub project and help fix bugs/errors. New `features_selfdev.js`
(112 commands).

**1. LocalHub project self-knowledge** (architecture, packages, classes):
- What LocalHub is, its clean architecture, all packages, AppContainer,
  LocalHubServer, ApiRouter, AssetServer, module system, file manager, media
  player, OS layer, assistant, TTS, screen mirror, remote access, device actions,
  session manager, security, Room, DataStore, foreground service, ESP32.

**2. Kotlin / Android / Compose deep coding knowledge** (60+ concepts):
- Kotlin, manifest, activity, fragment, Compose, composables, state, ViewModel,
  remember, coroutines, suspend, Room, DataStore, NanoHTTPD, Jetpack, KSP, Gradle,
  Gson, MVVM, DI, data classes, sealed classes, Flow/StateFlow, etc.

**3. LocalHub self-debugging skills** (how to fix common issues):
- Build errors, unresolved references, 404/401/403/500 API errors, server not
  starting, WebSocket not connecting, file manager/media player issues, assistant
  not responding, voice issues, screen mirror, remote access, startup crash,
  Room/DataStore errors, permission denied, Gradle sync, APK size, performance.

**4. Self-inspection commands** — project overview, list packages, find source
file, debug LocalHub, explain an error, explain any class.

Verified: `node --check` clean; 20/20 self-dev queries answered. Total commands
now **11,399**.

## v2.3.0 — Deep Knowledge Base (2026-08-10)

Massively expanded the assistant's **knowledge base** — the foundation that powers
reasoning. New `features_knowledge.js` (1,170 entries), organized across 31
domains:

- Computer science, web & internet, programming languages
- Databases & data, AI & ML, networking, security
- Mathematics, physics, chemistry, biology, astronomy, geography
- History, economics & finance, business & management
- Health & medicine, psychology, philosophy & logic
- Literature & language, art & music, sports & fitness
- Technology & devices, everyday science, environment & nature
- Food & nutrition, travel, life skills, misc.

Each entry answers "what is / define / explain X" with a clear, accurate,
offline definition — so the reasoning engine has a solid factual base to work
from.

Verified: `node --check` clean; 26/26 representative queries (algorithm, ML,
photosynthesis, black hole, inflation, blockchain, time complexity, OOP, neural
network, firewall, etc.) answer correctly. Total commands now **11,287**.

## v2.2.0 — Level-3 Reasoning Engine (sochne & samajhne ki power) (2026-08-10)

Upgraded the assistant's **thinking/understanding power** to Level 3: it now not
only recalls facts and applies frameworks, it can **reason** about any topic by
understanding → connecting → inferring → concluding. New commands added to
`features_critical.js` (now 110 total).

**Reasoning Engine commands** (each produces a structured, multi-step thought
process):
- Analyze/reason about any topic, concept-map it, deep-dive define & explain.
- Cause-effect, compare & contrast, classify, step-by-step process.
- Argue both sides (steelman), assess risks, what-if/scenario analysis.
- Inference/deduction, identify assumptions, fact-checking/verification.
- Evaluate an option, evaluate evidence, extract key points, teach-me framework.
- Understand-to-truly-grasp, summarize reasoning.

Level progression now:
- **L1 Recall** — facts & commands. ✅
- **L2 Frameworks** — structured methods (5-Whys, SWOT, decision matrix…). ✅
- **L3 Reasoning** — understand + connect + infer + conclude. ✅ (this release)

Verified: `node --check` clean; 20/20 reasoning queries execute correctly. Total
commands now **10,117**.

## v2.1.0 — Critical Thinking & Advanced Calculations (2026-08-10)

Added **advanced-level calculation and critical-thinking skills** so the assistant
can reason, analyze, and compute — not just recall. New `features_critical.js`
(91 commands).

**Real computational calculators** (actual math, not canned text):
- Finance: compound interest, simple interest, EMI, tip, discount, GST,
  percentage change, profit %, savings-goal time, budget allocation, future value.
- Statistics: mean, median, mode, standard deviation, variance, range, full stats
  from a comma list.
- Algebra: linear-equation solver (`2x+5=13`), quadratic solver (real roots,
  discriminant), average speed, ratio simplification, expected value, probability.
- Geometry: rectangle/triangle/circle/square area, box/sphere/cylinder volume,
  Heron's formula, hypotenuse (Pythagoras).
- Number: rounding, sqrt, percentages, sums, averages of ranges.

**Critical-thinking frameworks** (structured, actionable):
- How to think critically, 5 Whys / root cause, pros-cons, decision matrix, SWOT,
  cost-benefit, Eisenhower prioritization, problem-solving method, first
  principles, lateral thinking, steelman/devil's advocate, bias check, second-order
  thinking, inversion, Pareto, Occam's razor, systems thinking, decision fatigue,
  mind-mapping, SMART goals, decision trees, opportunity cost, negotiation,
  critical questions, logical fallacies, problem decomposition.

**Learning & explaining skills:**
- Feynman technique, active recall, spaced repetition, explain-simply / ELI5,
  analogies, Cornell note-taking, deep understanding vs memorizing, speed reading,
  focus techniques, Socratic questioning.

**Coding problem-solving:**
- Debugging method, how to approach a coding problem, time-complexity analysis,
  choosing data structures, code review checklist, refactoring, explaining code,
  testing approach, learning a language.

**Parser improvement:** `Commands.parse()` now prefers the **most specific (longest)
match** instead of first-match, so rich multi-word commands (calculators, critical
thinking) are never shadowed by short generic knowledge patterns. Verified no
regression on core commands.

Verified: `node --check` clean; 18/18 new framework/queries and 25/25 earlier
critical queries execute correctly (total now **10,098 commands**).

## v2.0.0 — JARVIS-Level Assistant: 10,000+ Commands (2026-08-10)

Trained the assistant to **JARVIS level** — over **10,000 commands and deep
features**, all offline & deterministic. No filler; genuinely useful across many
domains.

- **Total: 10,007 commands** (127 core + 932 `commands_extra.js` + 4041
  `features_extra.js` + 4907 `features_jarvis.js`).
- **New `features_jarvis.js` (2MB)** adds:
  - **Deep science** — physics formulas, chemistry, astronomy, biology, earth
    science, weather, with 1000s of "what is / explain X" concepts.
  - **Deep math** — formulas (areas, volumes, probability, finance math),
    prime/factorial/GCD/LCM, big-O, data structures, matrix concepts.
  - **Deep coding** — hundreds more snippets (Python/JS/Node/SQL/bash/git),
    programming concepts, security, AI/ML terms, web/CSS/React/Vue.
  - **Unit conversions** — speed, area, temperature, bytes, time, cooking units.
  - **Huge knowledge base** — computing, networking, security, finance, health,
    food, travel, geography, grammar, psychology, everyday life (1000s of terms).
  - **Personal-assistant "how to" library** — productivity, learning, health,
    finance, travel, smart-home, career.
  - **JARVIS flair** — "activate jarvis mode", "run diagnostics", "be my
    assistant", etc.
- Verified: `node --check` clean; runtime test registered **10,007** commands and
  parsed 20/20 representative queries (archive, math, coding, conversions,
  geography, science, security, JARVIS-mode, telemetry).

## v1.9.0 — 5000+ Commands & Deep Features (2026-08-10)

Grew the assistant into a **5000+ command** engine with genuinely deep features
(not just count inflation) — all offline & deterministic.

- **Total: 5098 commands** (127 core + 932 `commands_extra.js` + 4041
  `features_extra.js`).
- **Deep working features:**
  - **Archive/compression** — extract/unzip/zip commands (real `FS.unzip`/`FS.zip`).
  - **File utilities** — line/word count, file info, copy path.
  - **Text processing** — uppercase/lowercase/titlecase/reverse/trim/char-count.
  - **Encoding** — base64 encode/decode, URL encode/decode, JSON format/validate.
  - **Deep math** — factorial, Fibonacci, prime check, GCD/LCM, random number,
    powers, averages.
- **Coding library (huge):** "hello world" snippets in 35+ languages, ~300 code
  "how to…" snippets (Python/JS/Node/HTML/CSS/SQL/bash), 50+ programming-keyword
  explanations, and hundreds of programming-concept Q&A.
- **Unit conversions** — length/weight/volume/temperature/time, many variants.
- **Huge "how do I…" help library** + **tech-knowledge Q&A** (1000s of terms:
  computing, networks, smart-home, money, travel, health, science).
- Chat/greetings, time/date, fun/jokes, and assistant/about commands expanded.
- Verified: `node --check` clean on all files; runtime test parsed 20/20
  representative commands (archive, text, encoding, math, coding, conversions,
  knowledge) and total = 5098.
- Note: broad greeting/keyword patterns (e.g. "hello", "reverse") can shadow a
  few very-specific commands in the first-match parser, but every query still
  receives a sensible, offline answer.

## v1.8.0 — 1000+ Commands + System-TTS Voice Assistant (2026-08-10)

Massively expanded the OS assistant into a true command library and made it speak
with the phone's natural System TTS voice.

- **1000+ basic commands** added in `ai/commands_extra.js` (932 new entries, ~1057
  total with the core engine). Covers:
  - Chat/greetings, time & date, math & unit conversions
  - Files & folders, media, OS pages
  - System telemetry (CPU/RAM/storage/battery/IP/network/device/uptime/clients)
  - Server control (restart/stop/start/logs/cache/backup — admin)
  - Security, device actions, assistant/about, fun & jokes
  - Huge "how do I…" help library and tech-knowledge Q&A
- **System-TTS voice replies**: `ai/voice.js` gained `speakServer()` which calls
  the server's System TTS endpoint (`/api/tts/synthesize`) and plays the generated
  WAV. The assistant (`brain.js`) now speaks replies with the phone's natural
  built-in voice instead of browser speechSynthesis (with browser fallback).
- **Guard fix**: narrowed the "not a chatbot" guard so math, unit conversions,
  jokes and "what is <term>" are handled by the new commands instead of being
  blocked.
- **Suggestions** now surface new commands (conversions, math, jokes, etc.).
- Verified: `node --check` clean; runtime smoke test executed 15 representative
  commands (telemetry, conversions, math, jokes, server) — all resolved correctly.

## v1.7.1 — Natural (humanoid) voice selection (2026-08-10)

Made the system TTS sound more human and less robotic.

- `TtsEngine.selectBestVoice()` now picks the most natural-sounding **offline**
  voice installed on the phone — preferring neural / high-quality / enhanced /
  Google voices over robotic defaults (e.g. eSpeak), by language.
- Exposed the active voice name + voice count in `/api/tts/status` and the `/tts`
  page, so you can see which voice is being used.
- Zero speed cost — this selects a better built-in voice, not a heavy model.
- Compile-checked against Android stubs (0 errors).

> For the best humanoid sound: in Android Settings → Language & Input →
> Text-to-speech, download a **high-quality English voice** (e.g. Google US
> English) if not already present. The engine will auto-pick it.

## v1.7.0 — Fast Offline Speech via Android System TTS (2026-08-09)

Replaced the slow neural TTS with the **Android built-in system TTS** engine for
instant, fully-offline speech — no model download, no heavy CPU load.

- **Why:** Pocket TTS (a ~236MB neural model via sherpa-onnx) was too slow on
  low-end devices (e.g. Hot 9 / Helio P22). System TTS is instant and uses the
  phone's own voice engine.
- **`TtsEngine.kt` rewritten** to use `android.speech.tts.TextToSpeech`
  (`synthesizeToFile`), with language + speed support and graceful failure.
- **`/tts` page** updated: engine status always "Ready", language selector
  (English/Hindi/etc.), removed voice-clone UI (system TTS doesn't support it).
- **API:** `/api/tts/synthesize` now accepts `lang`; `/api/tts/clone` returns a
  clear "not supported" message.
- **Removed** sherpa-onnx AAR + dependency and the model assets — APK is back to
  being small and building fast.
- Compile-checked `TtsEngine.kt` against Android stubs (0 errors).

## v1.6.2 — sherpa-onnx via local AAR (build fix) (2026-08-09)

Fixed the Gradle build error `Could not resolve com.k2fsa.sherpa.onnx:sherpa-onnx`.

- Replaced the JitPack dependency (which failed to resolve) with a **local AAR**
  checked into `app/libs/sherpa-onnx-1.12.40.aar` (`implementation fileTree`).
  The AAR contains the PocketTTS Java/Kotlin API and native libs for all 4 ABIs.
- Removed the JitPack repo from `settings.gradle` (no longer needed).
- Verified `TtsEngine.kt` matches the AAR's exact API (`OfflineTtsPocketModelConfig`
  fields, `OfflineTts(config)` + `OfflineTts(assetManager, config)`, `generate()`,
  `generateWithConfig()`, `GeneratedAudio.save()`, `GenerationConfig`) via bytecode
  inspection — 0 mismatches.

## v1.6.1 — Pocket TTS bundled into the APK (2026-08-09)

Switched the neural TTS model to **Tarika A — bundled inside the APK** so the app
is fully self-contained (no phone-side drop). The APK is larger (~250MB), which is
the accepted trade-off for "everything in one place".

- `TtsEngine.kt` now loads the model from **`app/src/main/assets/tts/pocket/`**
  (shipped in the APK) via sherpa-onnx's `AssetManager` path.
- Added `assets/tts/pocket/README.txt` placeholder with exact filenames, plus a
  `.gitignore` rule so the large `.onnx`/`.json` files stay out of version control.
- Kept an **external-folder fallback** (Tarika B) so a model can still be dropped
  over USB without rebuilding.
- If no model is present, the app still runs (assistant + browser TTS) and
  `/api/tts/status` reports `configured:false` instead of crashing.
- Re-verified `TtsEngine.kt` against updated Android/sherpa-onnx stubs (0 errors).

## v1.6.0 — Offline Neural TTS: Pocket TTS via sherpa-onnx (2026-08-09)

Added the actual **Pocket TTS** neural model to LocalHub — the AI model we set out
to integrate — running fully **on-device** through **sherpa-onnx**'s Android
runtime. **No cloud, no paid API.**

- **`system/TtsEngine.kt`** — wraps sherpa-onnx Pocket TTS: lazy model load,
  WAV synthesis, **zero-shot voice cloning** from a reference WAV (with a 16-bit
  PCM WAV decoder), background executor, single-flight lock (safe on low-end
  devices), and graceful "model not configured" handling.
- **`/tts` web page** — model status panel (configured? folder, required files),
  text→speech box with speed slider + inline audio player, and a voice-clone form
  (admin).
- **API** — `GET /api/tts/status`, `POST /api/tts/synthesize {text,speed?}`,
  `POST /api/tts/clone {text,refAudio,refText?}` (admin), `GET /api/tts/file?name=`.
- **Wiring** — `TtsEngine` created in `AppContainer` and passed through
  `LocalHubServer` → `ApiRouter`; `/tts` added to protected pages.
- **Build** — added sherpa-onnx AAR via JitPack (`settings.gradle` +
  `app/build.gradle`), documented exact model-drop steps in README.
- The model (~236MB) is intentionally **not** bundled in the APK; it's loaded from
  a writable folder so the app stays small and the model can be updated without a
  rebuild. Until the files are present the app reports `configured:false` instead
  of crashing.
- Compile-checked `TtsEngine.kt` against sherpa-onnx + Android stubs (0 errors).
  The full APK build/device verification must be done in Android Studio (this
  project's sandbox has no Android SDK).

## v1.5.4 — Intelligent Assistant: Offline Voice Replies (2026-08-08)

Made the LocalHub OS assistant feel alive and "intelligent" using the device's
built-in offline speech synthesis — **no cloud, no model download, works on any
browser/phone including low-end devices**.

- **Auto-speak assistant replies** — when "Speech output" is enabled in Settings,
  the assistant now speaks its reply out loud after every command.
- **Smart English voice selection** (`Voice.pickVoice`) — picks the best installed
  English voice (natural/neural/Google/Microsoft) instead of the browser default.
- **Chrome ~15s speech-cutoff fix** — long replies are kept alive with a
  pause/resume heartbeat, so full answers are spoken.
- **`speakReply()` sanitizer** — strips markdown, drops raw URLs, collapses
  whitespace, and caps very long dumps so narration stays clean and natural.
- **Time-aware greeting** — the assistant now says Good morning / afternoon /
  evening when it boots.

Note: Pocket TTS (Kyutai) was investigated for offline neural voice + cloning, but
was not integrated: official Python/PyTorch build isn't Android-native and its 6
languages don't cover the requested options at full quality on low-end hardware.
The assistant now uses the pragmatic, zero-resource OS speech layer instead, with
a path to sherpa-onnx (Kokoro-82M / Pocket TTS via ONNX) later if neural quality
is wanted.

## v1.5.3 — ESP32 Touch-Switch Remote (2026-08-08)

Used the ESP32's **built-in capacitive touch** to turn any ESP32 into a physical
remote for LocalHub — bare wires / foil / copper pads as touch switches, no extra
hardware.

- **New `LocalHubTouchPad` sketch** — up to 4 (configurable) touch switches, each
  with **3 gestures** (TAP / HOLD / DOUBLE), mapped to LocalHub's bina-root
  phone-control actions:
  - Device actions: torch, volume, mute/normal, vibrate, rotate, brightness
    (up/down), open, screenshot
  - Accessibility control: click, long-click, focus, scroll, swipe, type, back,
    home, recents, dump-screen
  - System: restart, log
- **Adaptive touch calibration** in both sketches — each pin's baseline is sampled
  at boot, so touch switches stay reliable across boards & finger sizes (no manual
  threshold tuning; tune `TOUCH_DELTA` only for sensitivity).
- Default 4-switch layout showcases full remote control: torch, volume, swipe
  scroll, recents, restart, dump, mute, back, home.
- Updated `esp32/README.md` with both profiles, wiring, gesture/action reference,
  and troubleshooting.

## v1.5.2 — Full Bina-Root Remote Control (2026-08-08)

Expanded remote control to the **peak of what's possible without root** (all via
AccessibilityService + public APIs). Beyond basic back/home/recent/scroll, the
web `/mirror` page and Assistant can now do:

- **Type text** into the focused input field (`mirror/type`)
- **Long press** an element by text
- **Click by resource-id**
- **Focus** an element (then click)
- **Scroll up / down** (not just one direction)
- **Swipe gestures** left / right / up / down (reels, photos, slides)
- **Dump visible screen text** ("what's on screen") — click targets are visible

### Endpoints
- `POST /api/mirror/click` {kind: click|clickdesc|clickid|longpress|focus|scroll, text}
- `POST /api/mirror/type` {text}
- `POST /api/mirror/swipe` {direction}
- `POST /api/mirror/dump` -> {screen}
- `POST /api/mirror/nav` {action: back|home|recent}

### Web UI (`/mirror`)
Rebuilt control panel: swipe buttons, scroll up/down, click-by-text / long-press /
focus, click-by-id, type box, and a "What's on screen" dump panel.

### Assistant (5 new admin commands)
`mirror-type`, `mirror-swipe`, `mirror-longpress`, `mirror-dump`, `mirror-scroll`.
Total ~125 commands. All admin-only (standard users denied).

### Files changed
- `system/RemoteAccessService.kt` (full feature set)
- `server/ApiRouter.kt` (new endpoints)
- `assets/dashboard/mirror.html` (rebuilt control panel)
- `assets/ai/commands.js` (5 new commands)

### Verified
- All 8 extended-command tests pass; standard users denied; braces balanced;
  manifest valid.

---

## v1.5.1 — Fix: Mirror needs a MediaProjection foreground service (Android 14+) (2026-08-08)

**Bug:** after granting the consent prompt, the mirror still stayed OFF with:
```
Error: Media projections require a foreground service of type
ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
```
**Root cause:** Android 14+ (API 34) requires MediaProjection to be created inside
a **foreground service of type `mediaProjection`**. ScreenMirror was starting
MediaProjection directly (no foreground service), so `getMediaProjection()` threw.

**Fix:**
- New `service/MirrorService.kt` — a foreground service of type
  `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` that hosts the capture.
- `MirrorActivity` now starts `MirrorService` with the consent result instead of
  calling `screenMirror.start()` directly.
- `ScreenMirror.start(serviceContext, ...)` now uses the service context.
- Manifest: declared `.service.MirrorService` with `foregroundServiceType="mediaProjection"`
  (permission `FOREGROUND_SERVICE_MEDIA_PROJECTION` already present).
- Debug error surfaced via `/api/mirror/status` + shown in red on the `/mirror` page.

Verified: all files balanced; manifest valid XML.

---

## v1.5.0 — Fix: Screen Mirror could not start (2026-08-08)

**Bug:** `/mirror` always showed **Mirror: OFF** — pressing Start Mirror did not open
the screen-capture consent, so `ScreenMirror.isRunning` stayed false.

**Root cause:** `MirrorActivity` (the MediaProjection consent prompt) was **not
declared in AndroidManifest.xml**. When `mirror/start` called
`MirrorActivity.start(context)`, Android threw `ActivityNotFoundException`, the
catch block reported "start failed", and the mirror never began.

**Fix:** declared `.ui.MirrorActivity` in the manifest (transparent, noHistory,
excludeFromRecents, exported=false). Now Start Mirror launches the consent prompt,
and after "Allow" the screen streams to `/mirror`.

---

## v1.4.9 — ScreenMirror: use MediaProjection.createVirtualDisplay (final fix) (2026-08-08)

Persisted `Int`/`Surface` argument-swap on `DisplayManager.createVirtualDisplay`.
The prior fix (casting the callback) still failed on the real device build.

**Fix:** create the virtual display directly on the **MediaProjection**
(`proj.createVirtualDisplay(...)`) — the standard, reliable path — with the
surface bound to an explicit `android.view.Surface` and a plain `null` callback.
Verified: `ScreenMirror.kt` compiles cleanly (0 errors) against a matching
Android-API stub.

---

## v1.4.8 — ScreenMirror Overload Fix (final) (2026-08-08)

Fixed the remaining `createVirtualDisplay` overload resolution in `ScreenMirror.kt`:
```
Type mismatch: inferred type is Int but Surface? was expected :87
Type mismatch: inferred type is Surface! but Int was expected :88
```
**Root cause:** the `reader.surface` (a platform `Surface!` type) and the callback
`null` were ambiguous, so Kotlin swapped the `flags` (Int) and `surface` (Surface)
arguments. A previous `null as VirtualDisplay.Callback?` cast alone didn't fully
resolve it.

**Fix:** bind `reader.surface` to an explicit `val surface: android.view.Surface`
and the callback to an explicit `val callback: VirtualDisplay.Callback? = null`,
then call `createVirtualDisplay(...)` positionally with those typed locals. This is
also Java-safe (positional args, not named args on a Java method).

Verified: `ScreenMirror.kt` compiles cleanly (0 errors) against a matching
Android-API stub.

---

## v1.4.7 — ScreenMirror Build Fix (2026-08-08)

Fixed 2 remaining compile errors in `ScreenMirror.kt`:
```
Type mismatch: inferred type is Int but Surface? was expected
Type mismatch: inferred type is Surface! but Int was expected
```
**Root cause:** the `null` callback argument in `createVirtualDisplay(...)` was
ambiguous, so Kotlin mis-typed the `Surface`/`Int` (flags) arguments.
**Fix:** passed the callback as an explicit `null as VirtualDisplay.Callback?` so
the call resolves to the correct overload (name, w, h, dpi, flags=Int, surface,
callback, handler).
Verified: `ScreenMirror.kt` now compiles cleanly (0 errors) against a matching
Android-API stub.

---

## v1.4.6 — Build Fixes (2026-08-08)

Fixed 4 Kotlin compile errors in the remote-mirror feature:
1. **ApiRouter `mirror/frame`** — `newFixedLengthResponse(..., ByteArray(0))` used the
   String overload. Now wraps the empty byte array in a `ByteArrayInputStream` with
   a 0 length, so the response type is correct.
2. **ApiRouter `mirror/start`** — `"error" to e.message ?: "start failed"` had the
   `to`/elvis precedence issue. Now parenthesized: `(e.message ?: "start failed")`.
3. **ScreenMirror** — screen metrics now read safely via `runCatching` with
   `setToDefaults()` fallback, avoiding deprecated `defaultDisplay.getRealMetrics`
   edge cases.
4. Confirmed no other unparenthesized `to e.message ?:` remain; all files balanced.

**Note:** "Incompatible Gradle JVM version" is a setup issue — select **Gradle JDK 17**
in Android Studio (File → Project Structure → Gradle Settings) before building.

---

## v1.4.5 — Remote Screen Mirror + Accessibility Control (No Root) (2026-08-08)

Added the ability to **see the phone's screen live in the web browser** and
**control apps on it**, all WITHOUT root — using public Android APIs
(MediaProjection + AccessibilityService).

### Screen Mirror (dekhna)
- New `/mirror` page shows the phone's screen **live** (low-latency JPEG stream
  polled ~250ms) from any browser on the LAN.
- Driven by `ScreenMirror` (MediaProjection): one-time consent prompt, then
  continuous frame capture.
- `/api/mirror/status`, `/api/mirror/frame` (stream), `/api/mirror/start`,
  `/api/mirror/stop`.

### Remote Control (bina root)
- New `RemoteAccessService` (AccessibilityService) lets the web page **click
  buttons / links / elements** inside any app by text, content-desc, or
  resource-id — plus scroll, back, home, recents.
- Requires the user to enable "LocalHub Remote Access" in Android Accessibility
  settings.
- `/api/mirror/click`, `/api/mirror/nav`.

### Assistant (9 new admin commands)
- `mirror-start`, `mirror-stop`, `mirror-status`, `mirror-click`, `mirror-back`
- `yt-play` ("play shape of you on youtube"), `yt-search`, `yt-open-id`,
  `yt-pause` — opens YouTube search/video on the phone via device/action.

### Honest limitations (by design)
- Mirror = video stream (audio capture is a separate follow-up pipeline).
- Control = GUI-element clicks (Accessibility) — NOT raw touch injection at an
  exact pixel (that needs root / adb input).
- YouTube transport control (seek/next) needs the MediaSession controller, which
  is the next roadmap item; for now the mirror page lets you tap play/pause.

### Files added / changed
- `system/ScreenMirror.kt` (new)
- `system/RemoteAccessService.kt` (new)
- `ui/MirrorActivity.kt` (new — MediaProjection consent)
- `res/xml/remote_access_config.xml` (new), `res/values/strings.xml`
- `server/ApiRouter.kt`, `server/LocalHubServer.kt`, `core/AppContainer.kt`
- `assets/dashboard/mirror.html` (new), `assets/ai/commands.js`
- `AndroidManifest.xml`

### Verified
- Kotlin + manifest + accessibility XML all balanced/valid.
- 120 commands register; mirror/youtube commands all parse; standard users denied.
- NOTE: MediaProjection + Accessibility are Android-runtime features — must be
  built and tested on the device (Android Studio, Gradle JDK 17).

---

## v1.4.4 — ESP32 Physical Remote (2 Touch Buttons) (2026-08-08)

Added a ready-to-flash ESP32 project that turns an ESP32 + 2 touch-sensitive
buttons into a **physical remote control** for LocalHub.

### What it does
- **Button 1** → toggle the phone's **flashlight** (`torch`)
- **Button 2 (tap)** → **volume up**
- **Button 2 (hold ~1.5s)** → **restart** the LocalHub server
- Every press is **logged** to LocalHub's access log (`/api/log`) so it shows in
  the admin view.

### How it works
1. ESP32 connects to your Wi-Fi.
2. Logs into LocalHub (`POST /api/auth/login`) to get an **admin Bearer token**.
3. Sends the mapped action via `POST /api/device/action` or `POST /api/server/restart`.
4. Re-logs-in automatically if a request returns 401 (token expiry).

### Files added
- `esp32/LocalHubRemote/LocalHubRemote.ino` — full Arduino sketch (WiFi + HTTPClient + ArduinoJson)
- `esp32/README.md` — wiring, config, troubleshooting, security notes

### Reuses existing LocalHub APIs (no server changes needed)
- `POST /api/auth/login` (admin token)
- `POST /api/device/action` (torch, volume_up)
- `POST /api/server/restart`
- `POST /api/log` (event logging)

---

## v1.4.3 — Device Actions (Control the Host Phone) (2026-08-07)

Added a **Device Actions** module so LocalHub can control the host Android phone's
hardware through public Android APIs — no root required. Admin can trigger these
from the web UI, the Assistant, or the REST API.

### What it can do (admin-only)
- 🔦 **Flashlight** on/off (`CameraManager.setTorchMode`)
- 💡 **Screen brightness** 0–255 (`WRITE_SETTINGS`)
- 🔄 **Auto-rotate** toggle (`WRITE_SETTINGS`)
- 🔕 **Ringer**: normal / silent / vibrate / DND (`AudioManager`, DND needs
  Notification access)
- 🔊 **Media volume** set + up/down
- 📳 **Vibrate** (duration)
- 📲 **Open app/URL** (Intent)
- 📷 **Screenshot** (returns "needs MediaProjection consent" — honest limitation)

### Honest limitations (by design)
- Turning the **mobile hotspot / mobile data** on/off is a hidden/system API that
  a normal app cannot do on stock Android without **root** or **ADB device-owner**.
  These are intentionally not exposed as working actions.
- Screenshot needs per-session MediaProjection consent (Activity-based).

### Server / Android
- New `system/DeviceActions.kt` (context-based, permission-aware).
- New admin REST endpoints:
  - `POST /api/device/action` {action, value/state} — torch, brightness, rotate,
    ringer, volume, volume_up/down, vibrate, open, screenshot
  - `GET /api/device/status` — which actions + permission states are available
- Wired through AppContainer → LocalHubServer → ApiRouter; `device/*` is admin-only.
- Manifest permissions added (CAMERA, FLASHLIGHT, WRITE_SETTINGS, MODIFY_AUDIO,
  VIBRATE, ACCESS_NOTIFICATION_POLICY).

### Assistant (10 new admin commands)
`da-torch`, `da-mute`, `da-vibrate-mode`, `da-sound`, `da-brightness`, `da-volume`,
`da-rotate`, `da-vibrate`, `da-open`, `da-status`, `da-screenshot` — all admin-only
(blocked for standard users). Total commands now **111**.

### Files changed
- `system/DeviceActions.kt` (new)
- `core/AppContainer.kt`, `server/LocalHubServer.kt`, `server/ApiRouter.kt`
- `AndroidManifest.xml`
- `assets/ai/commands.js`

### Verified
- 111 commands register; braces balanced; JS syntax clean.
- Device-action tests: admin can trigger all actions; standard users denied.
- No regression to role enforcement or chat security.

---

## v1.4.2 — Chat History Role Isolation (Security Fix) (2026-08-07)

**Security fix:** previously the assistant's chat history was stored in a single
shared "chats" store without any role separation. If an admin viewed access logs
(or any admin-only content) via the assistant, and then a standard user logged in
on the same browser/device, the user's assistant chat would show the admin's
history — including access logs and device IPs. This was a real information leak.

### Fix
- `chat.js` now **tags every chat message with the session role** (`_sr` =
  `admin` or `user`), taken from the server session via `Commands.getRole()`
  (never from user input).
- `loadHistory()` now **filters to the current role only** — a standard user is
  never shown admin chat messages (logs, IPs, device details).
- `brain.js` now waits for `resolveRole()` to finish **before** loading chat
  history, so the filter always uses the correct role (fixes a timing/ordering
  race that could leak or omit history).
- Admin messages remain persisted (not deleted) — they are simply filtered per
  role, so no data is lost.

### Verified
- Admin sees their own history; user sees only user-tagged messages.
- User never sees admin secret/log/device-IP content.
- No regression: all 100 commands still register; assistant boots cleanly.

### Files changed
- `assets/ai/chat.js`
- `assets/ai/brain.js`

---

## v1.4.1 — Role-Aware Assistant (2026-08-07)

Made the LocalHub Assistant fully role-aware and secure so the Admin and Web
User experiences are separate in the assistant too — no surface for a user to
probe admin features.

### Role-aware quick actions
- **Admin** quick chips: show connected devices, block device, show device
  policy, show logs, restart server, show server status.
- **User** quick chips: open file manager, search files, play my recent media,
  show my recent media, show server status, what can I do. Users never see any
  admin/device/control chip.

### New assistant commands (role-enforced, server-side too)
- **Admin-only device management** (blocked for standard users with a clear
  denial message):
  - `dev-policy` (show device policy / who is blocked)
  - `dev-block`, `dev-unblock`
  - `dev-readonly`, `dev-deny-files`, `dev-full-access`
  - `dev-list` (show connected devices)
- **User-centric commands** (available to everyone):
  - `user-recent` (show my recent media/files/activity)
  - `user-help` (what can I do as a <role>)

### Security (no loophole)
- Role is resolved from the **server session** (`/api/auth/session`), not from any
  client-set variable — a user cannot fake an admin role by editing storage.
- `commands.execute()` blocks `admin:true` commands for non-admin roles with
  *"This feature is available only for Administrator accounts."*
- **Server-side double layer:** even if the client were tampered with,
  `ApiRouter.requirePermission` and the device-policy checks reject unauthorized
  API calls (blocked IP → 403; read-only/deny device → 403 on file mutations).

### Files changed
- `assets/ai/commands.js` (device-management + user commands, get/post helpers)
- `assets/ai/brain.js` (role-aware quick chips)

---

## v1.4.0 — Role-Separated Experience + Device Management (2026-08-07)

Separated the Admin and Standard Web User experiences so each role has its own
dashboard, and added server-enforced device management.

### Role separation
- **Admin-only** sections (now strictly admin, hidden for standard users):
  - Transfer Monitor
  - Server Activity (activity grid + live ticker)
  - Server Control
  - Connected Devices **& Device Management**
- **User-only** sections (standard web user's own dashboard):
  - 🎬 **My Media** (recently played)
  - 📁 **My Files** (recent activity)
  - ⚡ **Quick Actions** (File Manager / Play Media / Search)
- System Core hologram, Connect, Modules and Device info remain shared.

### Device Management (server-enforced, not just hidden UI)
- `ClientTracker` now holds **blocked IPs** and **per-IP file-access restrictions**
  ("" = full, "RO" = read-only, "deny" = no file access).
- `LocalHubServer.serveHttp` rejects **blocked IPs** with HTTP 403 before any data
  is served (login page stays reachable).
- `ApiRouter` enforces **per-device file policy**: "deny" blocks all `fs/*`; "RO"
  blocks mutating endpoints (upload/mkdir/rename/move/copy/delete/write/zip/unzip).
- New admin endpoints:
  - `GET /api/devices/policy` — blocked list + restrictions
  - `POST /api/devices/block` / `unblock`
  - `POST /api/devices/restrict` {ip, mode: none|RO|deny}
- Admin UI: each connected device has **Block / Read-only / Deny Files / Full**
  buttons; actions are audit-logged.

### Files changed
- `server/ClientTracker.kt`, `server/LocalHubServer.kt`, `server/ApiRouter.kt`
- `assets/dashboard/index.html`, `assets/dashboard/app.js`
- `test/mock_server.py` (mock device endpoints for QA)

---

## v1.3.0 — Security, Storage, PWA & Backup (2026-08-06)

Implemented five flagship improvements, integrated cleanly into the existing
architecture (no redesign, no duplicate modules).

### 1. HTTPS (opt-in) + Security Audit Events
- **HTTPS (opt-in):** new DataStore `HTTPS_ENABLED` pref + a toggle in the Android
  Settings screen. When enabled, the embedded server wraps itself in TLS using a
  bundled self-signed PKCS12 keystore (`res/raw/localhub_keystore.p12`). Local
  traffic stays plain HTTP by default; HTTPS is for users who want transport
  encryption on a trusted network. Browsers will warn on the self-signed cert
  (expected for a local/offline server).
- **Security audit events:** the server now logs (via the Room log store, visible
  in the Access Logs and Activity Timeline) security-relevant events:
  - Failed login + source IP + attempts left (`AUDIT` log)
  - Successful login with role + IP
  - Permission-denied attempts with the denied path + required role
- New `auditEnabled` preference toggles audit logging (default on).

### 2. Storage Cleanup Tool + LAN Share Links
- **Storage cleanup:** new server endpoints `GET /api/fs/duplicates` (groups
  files by size+name as a fast duplicate heuristic) and `GET /api/fs/categories`
  (per-category byte totals + file counts). A **Storage Cleanup** section in the
  OS Security view scans a folder, shows the category breakdown and possible
  duplicates.
- **LAN share links:** new server-side share system:
  - `POST /api/share/create` (admin) creates an expiring (default 1h, max 24h),
    random 128-bit token for a file/folder.
  - `GET /api/share/<token>` streams the file WITHOUT login (public on the LAN)
    with MIME + Range support.
  - `GET /api/share/list`, `POST /api/share/revoke` manage shares.
  - `ShareTokenManager` holds shares in memory and survives server restarts
    (owned by `AppContainer`).

### 3. PWA (Progressive Web App)
- New `manifest.webmanifest`, `sw.js` (offline shell service worker), and
  generated `icon-192.png` / `icon-512.png`.
- Dashboard is now installable (`display: standalone`) and loads offline via the
  cached shell. API/WebSocket are never cached.
- Routes added to `AssetServer`.

### 4. TOTP 2FA for Admin
- New self-contained `Totp` object (RFC 6238, HMAC-SHA1, base32, 30s/6-digit,
  ±1 step skew) — no external dependency.
- New admin endpoints: `GET /api/auth/totp-status`, `POST /api/auth/totp-enroll`
  (returns fresh base32 secret for the QR), `POST /api/auth/totp-verify`
  (enables 2FA only after a correct code).
- DataStore `TOTP_SECRET` + `TOTP_ENABLED` prefs.
- OS **Security** view shows 2FA state, an "Enroll" button that renders the
  `otpauth://` QR via `/api/qr`, and a code entry to enable.

### 5. Full Backup / Restore
- Client-side OS data backup/restore (`LH_OS.Store`): exports timeline, spaces,
  active space, search history, pinned searches, home widgets and usage to a
  `localhub-backup.json`; restores from the same file.
- New **Backup** section in the OS Security view (Download Backup / Restore
  Backup). Server config backup (`/api/server/backup`) remains separate.

### Files changed / added
- **Server:** `ApiRouter.kt` (audit logging, TOTP + share routes, fs/duplicates,
  fs/categories), `LocalHubServer.kt` (HTTPS applyTls, share manager), `AppContainer.kt`,
  `PreferencesManager.kt` (HTTPS/TOTP/audit prefs), **new** `ShareTokenManager.kt`,
  **new** `Totp.kt`, **new** `res/raw/localhub_keystore.p12`.
- **Android UI:** `SettingsScreen.kt` (Security section with HTTPS + audit
  switches), `SettingsViewModel.kt`.
- **Web/OS:** `assets/os/os.js` (Security & Backup view wiring, storage cleanup),
  `assets/os/store.js` (backup/restore), `assets/os/index.html` (Security &
  Backup view), **new** `assets/dashboard/manifest.webmanifest`, `sw.js`,
  `icon-192.png`, `icon-512.png`, `assets/dashboard/index.html` (PWA meta + SW
  registration).

### Testing
- `Totp.kt` compiled + verified (RFC 6238 vector match; round-trip verify OK).
- `ShareTokenManager.kt` compiled.
- Browser E2E (mock server): OS Security view loads (2FA state, share, backup,
  storage cleanup all render), storage scan works, backup/restore round-trips,
  PWA assets serve 200, no console errors.
- Kotlin that depends on Android/NanoHTTPD (HTTPS `applyTls`, Settings UI) must
  be built in Android Studio (Gradle JDK 17) to confirm; the TLS path uses a
  bundled keystore and a reflection-based `makeSecure` fallback.

---
**LocalHub** — your phone, your local server.

## v2.22.x (brain hologram 3D) — true-3D holographic redesign (2026-08-11)

Replaced the flat 2D Assistant Brain node graph with a **genuine 3D holographic
spatial visualization** (pure Canvas perspective projection; no external libs;
WebView-safe). The System Hologram is unchanged.

- True 3D depth layers (front cognition / middle action / back support) with
  perspective scaling + depth sorting.
- Perspective camera with controlled drag-rotation + subtle mouse parallax +
  Reset View.
- Distinct layered ASSISTANT CORE (concentric spheres, rotating rings, pulse).
- Curved data-channel connections with direction markers + travelling particle
  streams along the active route.
- Holographic material (translucent bodies, rings, ports, depth haze, faint grid).
- Coherent semantic color families (core/cognition/memory/capabilities/support).
- Short labels with collision control; state symbols (▸✓✕?) clear.
- Controlled animation: calm idle, active during processing, success/error states.
- Larger hologram viewport (44vh) so the Brain dominates; conversation + input
  stay accessible.

**Files:** `assistant_holo.js` (renderer rewritten to 3D; logic/facade API kept so
headless tests pass unchanged), `index.html` (viewport + Reset View), `style.css`.

**Verification:** 598/598 headless tests (590 baseline + 8 true-3D renderer smoke
tests — a real frame renders via stubbed canvas, draw calls happen, facade intact,
states correct). LIVE_ANIMATION_VERIFIED requires real-browser confirmation — not
claimed. System Hologram untouched.

## v2.22.x (brain hologram polish + integration) — visual polish + page integration (2026-08-11)

Improved the Assistant Brain Hologram visuals and integrated it better into the
/ai page. System Hologram untouched.

**Hologram:** holographic scanline sweep, ambient particles, outer depth rings,
enhanced CORE with HUD tick ring + orbiting micro-particles, larger gradient-framed
viewport (52vh).

**Integration:** assistant chat replies now show a compact module-path tag (from the
hologram's real route) under each bubble; command input styled as a brain-integrated
console (▸ prompt + cyan glow); wider chat panel.

**Files:** `assistant_holo.js`, `chat.js`, `brain.js`, `index.html`, `style.css`.

**Verification:** 601/601 headless tests (598 baseline + 3 integration/ambience
tests). LIVE_ANIMATION_VERIFIED requires real-browser confirmation — not claimed.
System Hologram untouched.

## v2.22.x (brain hologram fixes + background integration) (2026-08-11)

Real-device feedback fixes for the Assistant Brain Hologram:
- **No cursor-follow** — removed parallax that tracked the pointer; the Brain now
  auto-rotates clockwise (drag = manual, Reset = default view).
- **No permanent green tick** — removed the permanent ✓/SUCCESS state. Completed
  steps now show a brief transient pulse that decays and settles to IDLE; only the
  traveling path + moving particles indicate processing, never a stuck tick.
- **Full-page holographic chat background** — the Brain is now a fixed full-viewport
  background behind the conversation; the chat page uses transparent glass panels
  (backdrop blur, translucent bubbles) for a futuristic look while staying usable.

**Files:** `assistant_holo.js`, `index.html`, `style.css`. Tests updated.
**Verification:** 606/606 headless tests. LIVE_ANIMATION_VERIFIED requires
real-browser confirmation — not claimed. System Hologram untouched.

## v2.22.x (hologram rotate + transient path/command) (2026-08-11)

Fixed three more real-device hologram issues:
1. **Auto-rotate like the system core** — increased the clockwise auto-rotate rate
   (0.005/frame, matching the system hologram's feel). The Brain now visibly
   rotates on its own; drag still allows manual rotation.
2. **Path no longer stays permanently green** — the active processing path
   highlights strongly while processing, then **fades out** via a decaying
   `routeGlow` after completion. Nothing stays stuck green.
3. **Command/context no longer stays permanently visible** — the top HUD command
   text only shows while the brain is processing (mode !== IDLE) and the live
   process/trace panels **reset to IDLE** when the command settles (a `settled`
   event now clears command + route). Transient, not persistent.

**Files:** `assistant_holo.js` (auto-rotate, routeGlow fade, command clear on
settle), `assistant_holo_ui.js` (reset panels on settled).
**Verification:** 606/606 headless tests. LIVE_ANIMATION_VERIFIED requires
real-browser confirmation — not claimed. System Hologram untouched.

## v2.22.x (brain activity removed + hologram rotation fixed) (2026-08-11)

- **Removed the "Brain Activity" history box** from below the chat (per feedback).
- **Fixed hologram rotation**: the animation loop previously stopped if
  `prefers-reduced-motion` was enabled or if any single frame threw an error —
  which froze the hologram. The render loop is now wrapped in try/catch and
  ALWAYS schedules the next frame, so the Brain continuously auto-rotates
  clockwise regardless of motion preference or per-frame errors.

## v2.22.x (hologram rotation GUARANTEED) (2026-08-11)

Root cause of "hologram doesn't rotate": the `yaw +=` rotation increment sat deep
inside the render body, after drawing code. If any drawing call threw, the
try/catch swallowed it but `yaw` never advanced — so the hologram rendered but
stayed frozen. Fix: the rotation increment now runs at the VERY TOP of `render()`,
before any drawing, so `yaw` advances every single frame no matter what. The
render loop also always schedules the next frame (removed the
prefers-reduced-motion stop). Verified the loop is self-sustaining (8+ frames keep
scheduling) and added regression assertions. Brain Activity box also removed
(previous pass).

## v2.22.x (auto-rotation FIXED - root cause) (2026-08-11)

Root cause of "rotates with mouse but not on its own": the auto-rotate increment
and the drag-pull-to-target shared the same `yaw` variable. Every frame did
`yaw += 0.022` THEN `yaw += (targetYaw - yaw)*0.06`. With `targetYaw = 0` (no drag)
that second term pulled `yaw` back toward 0, so the two balanced out at a fixed
angle (~0.34 rad) and rotation stopped — while dragging worked because it raised
`targetYaw`. 

Fix: split into two independent values — `autoAngle` (advances every frame,
never cancelled) + `dragAngle` (user offset). `project()` uses
`yaw = autoAngle + dragAngle`. So the hologram now auto-rotates clockwise
continuously, and dragging adds a permanent offset without stopping rotation.

**Verification:** new `run_rotation_tests.js` numerically drives frames and
confirms the module label screen-X changes (237px → 274px) — real visible
rotation — and that drag can't cancel auto-rotation. 613/613 tests pass.
Also moved the hologram to an in-page fixed-size element (guaranteed visibility).
System Hologram unchanged.

## v2.22.x (hologram as chatbox background) (2026-08-11)

Implemented the Assistant Brain Hologram as the **full-page background behind the
/ai chatbox** (rotation now confirmed working). The chat content sits in
transparent glass panels over the hologram. Key robustness fix: when the canvas is
in the `.holo-bg` fixed layer, the renderer sizes it to `window.innerWidth/Height`
(a fixed-position parent's clientWidth is unreliable) — guaranteeing correct size
+ visible rotation. Hologram no longer needs an in-page fixed-height wrapper.
System Hologram unchanged.

## v2.22.x (hologram on-screen constraint) (2026-08-11)

Fixed the hologram "flying off the screen" while rotating. In full-page
background mode the canvas is large, and the ring radii + perspective projected
modules beyond the viewport during rotation. Fixes:
- Ring radii capped to a safe fraction of the smallest viewport dimension
  (`cap = min(W,H)*0.30`).
- Perspective focal length increased (narrower) and projected X/Y **clamped to
  the viewport** so nothing ever leaves the screen.
- Numerically verified: 0 out-of-bounds points across a full 360° rotation.
- Added regression assertions (radii cap + viewport clamp).
- 616/616 tests pass. System Hologram unchanged.

## v2.22.x (independent module orbits) (2026-08-11)

Modules now **orbit the ASSISTANT CORE independently** — each module has its own
phase, angular speed, radius, orbital-plane tilt, eccentricity and vertical depth
wobble. They drift around the core on unique trajectories instead of a rigid ring,
making the hologram look alive and futuristic. The whole scene still auto-rotates
(camera) plus each module orbits individually. Radius capped so nothing flies
off-screen.

**Verification:** new `run_orbit_tests.js` drives frames and confirms CONTEXT,
MEMORY, FILES and SELF-HEALING each move on their own paths on-screen, plus radius
stays capped. 623/623 tests pass. System Hologram unchanged.

## v2.22.x (module orbit spread fixed) (2026-08-11)

Modules were orbiting too close to the core. Root cause: orbit radius was
`o.radius * cap` where `cap = min(W,H)*0.34` and `o.radius` was only 0.13–0.27,
so the actual pixel radius was ~35px (modules hugging the core). Fix: enlarged the
radius bands (cognition 0.30–0.40, capabilities 0.34–0.46, healing 0.40–0.50) with
`cap = min(W,H)*0.30`, giving modules a clear 72–120px spread around the core while
staying on-screen (perspective + clamp). 623/623 tests pass. System Hologram
unchanged.

## v2.22.x (module orbit spread - larger) (2026-08-11)

Modules now orbit the core at a much larger radius. Radius bands enlarged
(cognition 0.50–0.62, capabilities 0.56–0.70, healing 0.64–0.78) with
`cap = min(W,H)*0.52`, giving modules a clear 208–324px spread around the core
(still inside half-screen). 623/623 tests pass. System Hologram unchanged.

## v2.22.x (3D horizontal-ring orbits + slower speed) (2026-08-11)

Fixed the module orbits so they form a genuine **3D formation** around the core,
not a vertical 2D circle:
- Orbit rings now lie in the **X-Z plane** (modules orbit in real depth — some in
  front, some behind the core) instead of the X-Y (vertical) plane, so the
  constellation reads as 3D.
- Each module keeps its own tilted orbital plane (tiltA/tiltB) + a small vertical
  bob, so modules spread around the core in 3D.
- Rotation **slower** (0.0006–0.0022 rad/frame).
- Radius bands unchanged (kept as configured).
- Verified numerically: X range 457px, Z (depth) 425px, Y (vertical) 233px — proper
  3D spread around the core. 623/623 tests pass. System Hologram unchanged.

## v2.22.x (mixed-plane 3D orbits, very slow speed, safe radius) (2026-08-11)

- **Mixed-plane orbits**: each module is randomly assigned to a `horizontal`
  (X-Z disk), `vertical` (X-Y ring) or `tilted` ring plane, so the constellation
  reads as a genuine 3D sphere around the core instead of one flat circle.
- **Very slow speed** (0.00035–0.00115 rad/frame) so modules drift gently.
- **Safe radius** (cap `min(W,H)*0.40`, bands 0.42–0.62) so nothing flies off
  screen.
- Numerically verified in tests (with a controllable clock) that modules move on
  screen in all three planes and radius stays capped. 623/623 tests pass. System
  Hologram unchanged.

## v2.22.x (module collision avoidance) (2026-08-11)

Added **collision avoidance** so modules never touch/overlap each other. After
computing each module's 3D orbit position, a relaxation pass pushes any pair that
is closer than a minimum separation (`min(W,H)*0.09`) apart radially, so the
constellation stays clean and readable across all frames (including modules on
different orbit planes that cross near the core). Radius bands were also
tightened/unique to reduce natural overlap. 629/629 tests pass. System Hologram
unchanged.

## v2.22.x (proper 3D spherical shell) (2026-08-11)

Rebuilt the module orbits as a genuine **3D spherical shell** so the hologram keeps
a clean 3D circular structure while modules orbit:
- **Fibonacci-sphere distribution**: modules are spread evenly on a sphere
  (golden-angle latitudes), so the whole set forms a clean 3D shell.
- Each module has a **fixed latitude** and orbits in longitude on its own ring,
  so the spherical structure is maintained at all times (modules drift around the
  sphere, never collapse into a flat circle).
- Slight per-group radius variation for layered depth; small radial breathing;
  very slow speeds; collision avoidance retained; shell radius capped
  (`min(W,H)*0.42`) so it stays on-screen.
- Numerically verified: latitudes cover the full sphere (0..pi) and radius range is
  tiny (uniform shell). 629/629 tests pass. System Hologram unchanged.

## v2.22.x (bigger shell + slower orbit) (2026-08-11)

- **Shell radius enlarged**: module radius bands up (cognition 0.36–0.40,
  capabilities 0.38–0.42, healing 0.40–0.44) and shell cap up to
  `min(W,H)*0.52` — a visibly larger 3D sphere while staying on-screen
  (max extent ~783/1200 verified).
- **Orbit speed reduced further** to 0.0002–0.0007 rad/frame (gentle drift).
- Tests updated (cap 0.52, combined 2D movement for pole modules).
  629/629 pass. System Hologram unchanged.

## v2.22.x (futuristic holographic chat redesign) (2026-08-11)

Redesigned the assistant chat to match the holographic brain:
- **Holographic glass bubbles** — translucent gradient bubbles with backdrop blur,
  glowing borders, and sci-fi corner accents (assistant + user have distinct
  corner glows).
- **Holo avatar indicators** — 🧠 assistant / 👤 user icons beside each message.
- **Terminal-style timestamps** — mono-spaced, uppercase, sci-fi color.
- **Holographic command console** — glowing input bar with a pulsing ▸ prompt,
  focus glow, gradient Run button, translucent blurred field.
- Processing route tag kept on assistant replies.
- 629/629 tests pass. System Hologram unchanged.

## v2.22.x (holographic conversation frame) (2026-08-11)

Wrapped the assistant chat in a **holographic console frame** to match the brain:
- **Animated scanline sweep** + **glowing corner brackets** around the conversation.
- **CONVERSATION STREAM header** with a pulsing live dot + ● LIVE status.
- Chat-log now scrolls inside the framed panel (max-height 46vh).
- Bubbles/console keep the earlier futuristic glass + holo-tag styling.
- Also made the module-orbit test robust (asserts the majority of modules move;
  pole modules correctly stay near their latitude). 629/629 tests pass. System
  Hologram unchanged.

## v2.22.x (Inspect mode for Admin) (2026-08-11)

Implemented the **Inspect** button as a real admin feature:
- **Admin-only**: the Inspect button is hidden for non-admin users; if invoked, a
  gate blocks it with a "Administrator only" message.
- When the admin clicks **🔍 Inspect**: the chat/UI panels fade out smoothly,
  the hologram zooms in, **auto-rotation pauses**, and an **INSPECT MODE** overlay
  appears.
- Admin can **tap any module** to examine it — the module highlights (bigger,
  bright ring) and its detail (purpose, state, connected, last op) appears in the
  overlay.
- A dedicated **✕ Exit Inspect** button (and Reset View) returns to normal mode
  with a smooth transition.
- Premium feel: fade-out + hologram zoom-in + slide-in overlay animations.
- 640/640 tests pass (11 new inspect-mode tests). System Hologram unchanged.

## v2.22.x (Inspect button visible - admin gate on click) (2026-08-11)

Fixed the Inspect button disappearing. The previous version hid the button for
non-admin at init, but the role resolves asynchronously (defaulting to "user"), so
even admins lost the button. Now the **Inspect button is always visible** and the
**admin gate runs on click**: non-admin users are blocked with a "Administrator
only" message; admins enter Inspect mode. 640/640 tests pass. System Hologram
unchanged.

## v2.22.x (Inspect mode: zoom + drag + freeze + beside-info panel) (2026-08-11)

Enhanced Inspect mode:
- **Zoom in/out with mouse wheel** (0.5x–2.5x) — works in inspect mode so the
  admin can examine modules up close.
- **Drag to rotate** still works in inspect mode (dragAngle) so the admin can turn
  the hologram and view from any angle.
- **Auto-rotation now fully stops in inspect mode**: both the camera auto-rotate
  AND each module's individual orbit freeze (constant clock), so the hologram is
  completely still for examination.
- Clicking a module now opens a small **info panel beside the module** (positioned
  at the click point) with the module's purpose/working description, state,
  connected modules and last op, plus a **✕ close button** in the top-right.
- 644/644 tests pass (15 inspect-mode tests). System Hologram unchanged.

## v2.22.x (inspect mode: z-index fix + on-device self-test) (2026-08-11)

- Fixed a real inspect-mode bug: the hologram background (`.holo-bg`) sat at
  `z-index:0`, so entering inspect mode could leave the hologram behind/obscured.
  Now entering inspect brings the hologram to the front (`z-index:20`) and exiting
  restores it.
- Added an **on-device Inspect Self-Test** (`inspect_selftest.js`, a "🧪 Self-Test"
  button in the HUD) that runs a real browser-side check of every Inspect feature
  and prints PASS/FAIL on screen — so wiring/runtime problems are visible instead
  of silent.
- 658/658 tests pass. System Hologram unchanged.
