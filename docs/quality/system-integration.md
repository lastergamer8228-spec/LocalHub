# Host-aware Self-Healing integration — 1.0.9 preview (code 10)

## Agreed scope and autonomy

Integration-first. Cognitive, Personal Brain, routines and Self-Healing engine
sources remain frozen. This update does not silently open that boundary.

The user delegated recovery decisions to the assistant. The reviewed chat policy
therefore permits bounded, non-destructive observation/rechecks, not arbitrary
system changes. It never silently enables a disabled module, grants Android
permissions/consent, deletes files/cache, changes configuration or patches an APK.
Disruptive changes must use a separately reviewed admin-confirmed action path.
Existing legacy Guardian settings/autonomy and admin-console controls were NOT
reconfigured; do not mistake this bridge for a global sandbox around old code.

## Native integration descriptor

`GET /api/integration` is available to authenticated admin and standard sessions;
it validates current session/IP/expiry and uses `Cache-Control: no-store`.
It is independent of optional feature gates so OFF configuration can be explained.
It does not expose tokens, logs, client lists or private file names.

It reports:
- Schema/source, native sample timestamp and actual listener protocol/port/start.
- Actual host app version/package and current role.
- Only server-enforced feature switches plus required server/security components.
  Information-only capability cards are not advertised as independent switches.
- File dependencies for Media/Shares and current enabled states.
- Read-only Android grant/state queries: storage, camera, app notifications,
  system-settings write, notification policy, accessibility and capture activity.
  These are observations, not requests to obtain grants or start capture.
- Architecture/lifecycle and a named `chatRecoveryPolicy`, not invented device
  build/root/patch adapters or a native background Guardian daemon.

The descriptor's `running:true` means it was served by this listener; it does not
prove durable background operation, overall system health or hardware readiness.
An enabled feature is configuration, not proof that its every action works.
Permission/channel/OEM subtleties still require physical-device acceptance.

## Reviewed chat behaviour

- **explain system integration / what is self healing**: read the current host
  descriptor; explain native foreground service vs browser orchestration,
  enabled dependencies, role/grants and actual limits. Static architecture is
  explicitly not a claim of current health when the host is unreachable.
- **check localhub health / diagnose**: bounded current observations. No retry
  in ordinary diagnostic mode and no repair dispatch.
- **repair localhub / system thik karo**: the same live checks plus at most one
  recheck of a transient failed API read. Configuration is refreshed before the
  recheck; a newly OFF module is respected, not “repaired”. Permission denial
  is not retried or bypassed. Invalid retry data is not counted as recovery.
- **fix it**: requires a recent same-session health topic; otherwise asks what
  problem is meant. It never selects an arbitrary old incident for repair.
- **health report / what did you find**: revalidates access through the native
  descriptor, then recalls a same-owner report under 60 seconds old. Clearly
  labelled as a prior snapshot, not a new diagnosis. No persistent incident write.
- Generic “why did it crash” without health context asks for a target; after a
  health topic it observes current state but does not invent a historical RCA.
- Recognized patch/apply/deploy/rollback/build/autonomy-policy/goal-resume commands
  do not fall through to unreviewed mutation helpers in this chat bridge.
  The legacy admin console remains separate and unverified at device tier.

## Safe recovery limits

Strict endpoint allowlist:
`/api/integration`, `/api/system`, `/api/fs/media-status`, `/api/mirror/status`,
`/api/tts/status` — always GET. Even a GET can be mutating in the legacy API (e.g.
server clear-cache), so arbitrary GET URLs are NOT accepted.

Maximum 12 host requests per run, 2s per request and 10s overall async budget.
Checks may run in parallel; these timers are not hard CPU preemption. Cancel
aborts pending reads and prevents subsequent rechecks. Overlapping chat system
changes are excluded while this reviewed diagnostic workflow is active. Normal
server request logging and chat history persistence still occur; “read-only”
means no operator-requested host configuration/user-file changes, not zero disk IO.

A recheck only claims **READ_RECOVERY_OBSERVED**, with exact recovered read count.
It does NOT say “system fixed”. The bridge does not call Guardian.runHealthCheck,
SelfHeal.handleDetection, FileEngine repair or device-deploy adapters.

## Interpretation rules

- OFF / disabled dependency: intentional configuration, not a service failure.
- Missing grant: user action on phone; no remote grant/consent bypass.
- CPU unavailable: UNKNOWN; never synthesized from RAM or reported as zero load.
- Stale/incomplete telemetry: UNKNOWN; cross-device time comparison uses the
  host sample time plus elapsed check time, not raw phone-vs-PC clock subtraction.
- Resource pressure: warning from a sample, not a proven cause. No app killing,
  file deletion, cache clearing or restart to make the numbers look healthy.
- Inactive screen capture: expected until user consent, not automatically broken.
  A saved capture error is disclosed without claiming a current root cause.
- TTS/media route response: API observation, not audible speech/codec validation.
- Network/unreachable host: cannot infer a crash or start a stopped Android host
  through its dead API. Native controller/connectivity checks are required.

Observations span several requests and are not an atomic whole-device snapshot.
No calibrated confidence percentage or historical crash cause is invented.
Reports are held in RAM with an owner/TTL check; existing browser-role memory
ownership/clear-chat limitations remain a separate unresolved release gate.

## Validation tiers

- 52 Node integration/runtime scenarios: actual JS bridge, mocked host HTTP;
  OFF states, dependencies, grants, unknown/stale metrics, budget, denial,
  transient/permanent errors, session switch, cancel, cache recall and no engine
  dispatch/POST. No real device repair was executed.
- 5 JVM HostIntegration catalog tests: feature filtering, actual input states,
  role policy, dependency/permission sanitization. Not Android permission tests.
- 19 static native/client wiring and scope checks (not runtime validation).
- Actual Chromium chat fixture: live-descriptor explanation, unavailable CPU,
  a simulated transient resource-read recovery and blocked patch approval;
  no extra mocked server mutation. HTTP and native state are fixtures.
- Prior assistant/planner/audio/library/controller suites retained. Frozen engine
  sources are compared against the previous APK at delivery.

Device permission queries, real RPC failure/recovery, app background survival and
physical phone repair outcomes are NOT verified here. This remains a preview.

## Phone acceptance

Update the existing preview, restart its server, sign in and reload browser tabs.
Ask “explain system integration” and confirm the host build and actual module
states. Disable a module deliberately: health/repair must not turn it back ON.
Check health with missing storage permission and inactive capture: it should
explain native grants/consent, not claim an automatic fix. A normal healthy
“repair localhub” should report observations/zero recovered reads, not invent a
repair. Test temporary connectivity failure only in a controlled environment.
File/build/device repair-engine changes need a separately agreed scope and tests.
