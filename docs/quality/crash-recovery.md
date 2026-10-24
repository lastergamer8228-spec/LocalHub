# Crash protection & recovery — 1.0.14 (code 15)

## Honest scope

**No code can promise a crash-free app.** An uncaught throwable means the process
is already dying. This system bounds the damage and the recovery:

1. Record the crash (thread, summary, truncated stack, screen) **synchronously**,
   so it survives process death.
2. Restart **once** per crash, so the user returns to a usable app instead of a
   repeated “app keeps stopping” dialog.
3. Detect crash **loops** and enter **safe mode**: stop restarting and stop the
   server from auto-starting on boot.
4. Reduce memory pressure **before** the OS kills us (drop temporary caches only).
5. Surface everything in the app (Settings → Health & recovery) and, for admins,
   through the host integration endpoint. Failures are reported, not hidden.

## What was added

| Piece | Role |
|---|---|
| `CrashPolicy` | Pure rules: recent-crash count, safe-mode threshold (3 crashes / 2 min), auto-restart decision |
| `CrashReport` | Pure formatting: summary, truncated stack (2 000 chars), bounded thread/screen |
| `CrashReportStore` | Synchronous JSON store under `filesDir/health/crash_log.json`; last 10 crashes, safe-mode flag, low-memory count, recovery count |
| `CrashGuard` | `Thread.setDefaultUncaughtExceptionHandler`; records, decides, then schedules a bounded restart via `AlarmManager` + `PendingIntent` (400 ms) and kills the process |
| `MemoryGuard` | `ComponentCallbacks2`: on low memory / critical trim, deletes only temporary caches (`uploads`, `compatible-audio*`, `tts`) and counts the event |

Wiring:
- `LocalHubApplication.onCreate` installs both guards **before** building
  `AppContainer`, so early failures are captured; the health store is exposed to
  the UI.
- `BootReceiver` refuses to auto-start the server while safe mode is on.
- Settings → **Health & recovery** shows the summary, safe-mode state, and offers
  copy / exit safe mode / clear crash log (work runs off the main thread).
- `/api/integration` includes a `health` summary **for admin sessions only** and a
  `recovery` block describing the architecture; standard users receive an empty
  string, so crash internals are not exposed to guests.

## Safety properties

- **Bounded restart**: restarts stop once 3 crashes occur within 2 minutes, or
  whenever safe mode is on. No boot/crash loop.
- **Bounded storage**: at most 10 crash entries, each stack truncated; older
  entries pruned after 24 h.
- **No data loss**: only cache directories are cleared under memory pressure.
  User files, uploads in the destination folder, module settings and logs kept in
  Room are never deleted by this system.
- **Failure isolation**: store writes are wrapped, so a write failure cannot
  prevent recovery; a corrupted file falls back to an empty state (covered by a
  test).
- **OOM prevention is best-effort**: `onTrimMemory`/`onLowMemory` are hints from
  the OS; a sudden large allocation can still kill the process before any callback.

## Tests (72 passing JVM tests, +19 in this pass)

- `CrashPolicyTest` (5): recent-window counting, safe-mode trigger, old crashes
  ignored, restart stops on loop/safe mode, bounded pruning.
- `CrashReportTest` (5): summary with/without message, stack truncation, entry
  fields, bounded thread/screen names.
- `HealthGuardTest` (9, Robolectric): crash recorded and re-read by a fresh store,
  single crash → exactly one restart + recovery counted, repeated crashes → safe
  mode with restarts stopped early, safe mode clearable, low-memory counting,
  clearing crashes keeps counters, cache clearing touches only temp dirs,
  honest description text, corrupted file fallback.

Existing suites (upload streaming, Compose UI/navigation, module policy, sessions,
host catalog) all still pass.

## Not verified here

No physical device crash was induced and no logcat was captured. Robolectric
covers the logic and file I/O, but the real `AlarmManager` restart and Android’s
kill/restart behaviour need on-device confirmation.

## Phone acceptance

1. Update the preview and open Settings → Health & recovery: it should say “No
   crashes recorded.”
2. Trigger a safe, reversible failure if you can (e.g. a debug crash command), and
   confirm: the app restarts once, the crash appears in the log with a summary,
   and the app is usable.
3. Trigger repeated failures rapidly: safe mode should engage, the app should stop
   restarting, and boot auto-start should be skipped.
4. Exit safe mode from Settings and confirm normal behaviour returns.
5. Put the device under memory pressure (many apps / large uploads): temporary
   caches should be dropped and counted, with no user file deleted.
6. If a crash persists, copy the health summary (or capture `adb logcat`) and share
   it — the summary names the failing thread and exception.
