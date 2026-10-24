# Android controller audit — first corrective pass

**Version:** 1.0.5-controller-audit-preview / code 6  
**Release decision:** NOT LAUNCH-READY / device acceptance pending.

Earlier claims of “100% bug-free”, “battle-tested”, or “perfectly runs” were not
supported by the build/mock evidence and should not be relied on.

## Reproduced in source and changed

| Issue | Root cause | Change | Evidence / limit |
|---|---|---|---|
| Module OFF did not block the actual feature | ModuleManager only filtered custom handlers; registered modules returned null, static AssetServer and ApiRouter still served pages/APIs | Shared ModulePolicy before dispatch/fallback and inside API router. Player aliases, file APIs, audio conversion, mirror, device actions, shares, monitor, TTS and OS routes have ownership checks | 7 JVM policy suites pass, source integration contracts pass. Real Android HTTP acceptance still required |
| Disabled states lost after process restart | AppContainer seeded all metadata using enabled=true on every startup | Restore Room values before listener creation; persist toggles and surface failures; migrate duplicate core.files into files | Restore logic unit-tested. Room process-death/relaunch not device-tested |
| Duplicate File Manager cards | files and core.files represented the same feature | Keep files; migrate either legacy OFF to the surviving module and remove duplicate row | Migration logic unit-tested |
| Fake switches on assistant subcomponents / security / server | Metadata-only components have no independent runtime lifecycle | No on/off switch for info-only subcomponents. Required server/security cannot be “disabled” as a feature. Server is controlled through Settings | UI compiled, not tapped on device |
| Existing open player keeps buffered playback after switch OFF | Browser already holds bytes; no controller-status check | Guard future file reads plus authenticated lightweight media-status polling; loaded player pauses and shows host-disabled notice. Re-enable never auto-resumes | Stream guard JVM test + mocked browser poll test pass. Buffered bytes cannot be retroactively revoked from a client |
| Duplicate/mislabelled Settings buttons | Clear Cache, Restart Assets and Restart Media all called restartServer | One server-control section. Remove restart aliases; actual temporary cache deletion only with server stopped; actual log deletion with confirmation | Source contracts pass; Android taps/Room/cache operation require device acceptance |
| Generate QR only opened browser | Button callback was openBrowser(baseUrl) | Native QR dialog uses QrGenerator + Bitmap decoding | Compiled; actual scan not tested |
| App version/build fields were wrong | Showed protocol version and Android OS incremental build as app build | Show BuildConfig.VERSION_NAME / VERSION_CODE; separate server protocol version | Compiled/source checked |
| Service showed running after bind failure | startServer result ignored; literal running=true assigned | Actual Boolean controls state; last bind/TLS error reaches native UI | Source contracts + compile pass; occupied-port device test pending |
| Listener started merely from Application construction | AppContainer init started server before foreground-service ownership or boot preference | Explicit Start / boot receiver owns lifecycle; serialize commands and enter foreground before work; fresh listener object for stopped-setting edits | Compiled/source checked. Boot/OEM restrictions and process lifecycle need hardware tests |
| HTTP links after HTTPS enabled | Native/dashboard/API links hardcoded http, or reflected saved preferences rather than listener configuration | Native status tracks actual protocol; actual bind port/protocol used in links; TLS setup errors fail closed | Compiled/source checks; real TLS handshake and certificate UX pending |
| Audit logging switch was decorative | Preference never consulted by logger | AUDIT emissions check the persisted native setting; security itself always enforced | Source checked, not device-verified |
| CPU metric fabricated when procfs unavailable | RAM ratio plus clock jitter was labelled system CPU usage | Explicit available=false and Unavailable UI; no synthetic CPU estimate; unavailable history uses sentinel -1 | Source checked. Other clients consuming raw metrics must respect available flag |
| Admin logs broadcast to normal WebSocket users | Hub broadcast every log to all sockets | Admin-only log broadcasts; revalidate session/IP block before sends | Compiled/source checks; live multi-role acceptance pending |
| DND action claimed success without setting it | Returned ok=true after permission check only | Call NotificationManager.setInterruptionFilter and check reported filter | Compiled; requires permission/device test |
| Screen mirror startup/revocation issues on Android 14 | Missing MediaProjection callback before createVirtualDisplay; sticky reuse of consent | Register/unregister callback, release on revocation/failure, prevent sticky consent replay; module OFF stops capture service | Compiled; actual consent/projection test not performed |
| Accessibility actions ran on HTTP thread | Immediate drainQueue on request worker | Post to main looper, discard stale queue on unbind | Compiled; real accessibility actions not device-tested |
| /api/system serialized a StateFlow object | Used lastSnapshot instead of lastSnapshot.value | Serialize the actual snapshot | Compiled/source checked |

## Exact feature-switch contract
- Switches control **server access** to their owned feature routes, including
  direct URLs/aliases and APIs. They are not package uninstallers.
- Media playback depends on File Manager. Either OFF blocks player source access.
  File downloads remain a File Manager operation; turning Media Player OFF does
  not prevent someone from downloading a file and playing it elsewhere.
- Cached pages/client-side assistant JS can already exist in browser memory.
  Server-side calls are still enforced, but downloaded code/data cannot be
  recalled. Existing local/offline JS activity is NOT claimed to be unloaded.
- Independent toggles exist for Dashboard, File Manager, AI page, Media, Mirror,
  Device Actions, Shares, Monitor, TTS server and OS routes. Other registered
  capabilities are honestly labelled info-only/required rather than fake switches.
- System hologram remains; monitor OFF denies its server route/telemetry.
- Personal Brain and Self-Healing engine code was not redesigned.

## Tests actually executed
- Android Kotlin compilation: passed.
- JVM ModulePolicyTest: 7 tests, zero failures/errors; direct routes/aliases,
  independent groups, mandatory modules, restore/migration and stream guards.
- 28 controller source wiring assertions: passed (NOT runtime tests).
- Existing 20 audio source contracts / JS syntax checks: passed.
- Mocked loaded-player OFF/re-enable/401/network behaviour: passed.
- Existing automatic-audio mocks and 542 engine headless assertions: passed.
- Android assembleDebug: result is recorded in the external validation archive (controller-build.log).
- No connected Android device/emulator was used. No claim of device verification.

## Device acceptance gate — required before promoting this preview
1. Stop the old preview, update this APK (same preview package/signing key), open
   native Settings and explicitly Start. Confirm actual URL/port and browser login.
2. Play a movie, turn Media Player OFF in native Modules. Within the status-poll
   interval (~4 seconds), the official player should pause. A fresh /player and
   /api/fs/content for AV must return 503, including /dashboard/player.html aliases.
   Turn ON, then deliberately resume/reload; normal audio should remain working.
3. File Manager OFF: file/list/read/upload and playback sources denied. Login and
   controller remain available. Re-enable and verify access restored.
4. Disable a feature, force-stop the preview and relaunch. It must remain OFF.
   A disabled info-only/security control must not be offered as an on/off switch.
5. Apply a valid port while running and while stopped; then Start/Restart. Use a
   port occupied by another app and confirm Offline + useful error, not false Online.
6. HTTPS ON/OFF: fresh browser links must use actual scheme; verify real TLS,
   warning, reconnect and no plaintext fallback on setup failure.
7. Save name; change theme; toggle audit logging and generate audit events. Clear
   logs and stopped-server temporary cache with confirmation. Scan native QR.
8. Test Stop/Start/repeated Restart, screen-off, process kill, boot preference OFF
   and ON, and Android background/notification permission constraints.
9. Standard account must not receive admin WebSocket logs; revoke/block active
   clients and check disconnect. Test read-only vs deny-files restrictions.
10. Android 14+ mirror consent/cancel/revoke and module OFF; accessibility commands;
    DND with and without notification-policy access. Never bypass consent.

## Remaining release blockers / backlog (not fixed by this pass)
- No complete native UI instrumentation/end-to-end test suite or multi-device/OEM
  lifecycle/permissions testing. Rapid command/permission-transition races need
  dedicated stress tests. Native backup/restore/export flows are not implemented.
- Bundled/shared self-signed TLS keystore needs per-install key/certificate design
  and independent security review before release. HTTPS here is still a local
  preview feature, not a production trust solution.
- File path canonical containment/symlink boundaries need a full security audit;
  request-body/upload memory bounds and large-file operations need hardening.
- Some web/assistant action replies still indicate requests rather than verified
  device execution. Audit every action end-to-end; do not infer success from UI.
- Browser-side assistant subfeatures still lack independent authoritative runtime
  switches. They remain info-only, not claimed to be disabled/enabled by a card.
- Client counts/history, log retention, backup/restore semantics and websocket
  reconnect/backpressure need broader tests. Core metrics must not invent data.
- Bounded AAC audio still requires live seek/sync/background testing across browsers.

**Do not launch this as stable solely because it compiles or these tests pass.**
