# Field crash 2026-10-23 — `IllegalArgumentException: Key "0" was already used`

**Reported:** "app keeps stopping" — 4 crashes in 24 h, safe mode ON, 1 low-memory
event. The user believed it was the upload crash again; the Health & recovery card
in Settings showed the real exception:

```
java.lang.IllegalArgumentException: Key "0" was already used.
If you are using LazyColumn/Row please make sure you provide a unique key
for each item.   (thread: main)
```

## Root cause

`LogEntry` declares `val id: Long = 0`. `AppLogger.log()` builds entries in memory
and emits them on a `SharedFlow`; the row id Room would assign is never applied to
the emitted object, so **every live log entry reaching the UI carried `id = 0`**.

`DashboardScreen` (Home tab) rendered them with:

```kotlin
items(logs, key = { it.id }) { LogItem(it) }
```

Two entries → two rows with the key `"0"` → Compose throws during composition →
the app dies → `CrashGuard` restarts it → the restart logs "server started" → the
Home screen shows two log rows again → crash. That loop is exactly what "keeps
stopping" looked like, and why it seemed to happen around uploads (uploading
generates log entries).

Why the test suite missed it: `ControllerScreensTest` feeds logs with ids `1` and
`2`. Unique test data, crashing production data.

## Fix (1.0.18, code 19)

1. **Root cause** — `LogDao.insert` now returns the generated row id and
   `AppLogger` emits `entry.copy(id = rowId)`. If Room is unavailable it falls back
   to a process-wide counter starting at `1_000_000_000_000L`, so a live entry can
   never keep the default `0`.
2. **Defence in depth** — new `ui/components/ListKeys.kt`. Every lazy list now keys
   with a namespaced, index-suffixed string, so a list is uncrashable even when the
   data carries duplicate or default ids:
   - `ListKeys.log(index, entry)` → `"log:{id}:{timestamp}:{index}"`
   - `ListKeys.client(index, client)` → `"client:{id}:{index}"`
   - `ListKeys.module("feature"|"component", module)` → `"{prefix}:{id}"`
   Applied in `DashboardScreen`, `LogsScreen`, `ClientsScreen`, `ModulesScreen`.

## Regression tests

`app/src/test/.../ui/DuplicateListKeysTest.kt` — 8 Robolectric + real Compose tests:

- `theOldKeyReallyDidCrash` — reproduces the field crash with `key = { it.id }`, so
  the suite fails loudly if anyone reintroduces that pattern.
- `logListRendersWhenEveryEntrySharesTheSameId` — five entries, all with `id = 0`,
  render through the real `LogsContent`.
- `clientsListSurvivesDuplicateClientIds` — three clients sharing one id
  (found a second latent instance of the same bug during this work; fixed by adding
  the index to the client key).
- `twoModuleBlocksWithTheSameIdDoNotClash` — the features and components blocks can
  both contain the same module id.
- two `AppLogger` tests: unique ids when Room works and when it does not.

**Evidence tier:** Robolectric + real Compose execution — this proves the lists
compose without throwing. It does not prove how they look on a phone, and the fix
has not been run on the user's device yet.

## After installing

Safe mode was ON when the crash was reported. Open **Settings → Health &
recovery → Exit safe mode**, otherwise the server will not auto-start on boot.

## Device verification

**2026-10-23, user report (WhatsApp):** *"haa ab app crash nahi ho raha hai"* after
installing 1.0.18 (code 19) over the crashing build.

| Claim | Evidence tier |
|---|---|
| The `Key "0" was already used` crash is gone | **Verified on the user's device** (user report, no reproduction of the old crash loop) |
| The crash loop was caused by duplicate list keys | Verified by the exception text in the Health & recovery card + a Robolectric Compose test that reproduces it with `key = { it.id }` |
| No new crash was introduced by the fix | User report, one session, **not** a soak test |
| Everything else in the app works | **NOT verified** — only "it does not crash" was confirmed |

Open items after this confirmation:
- Confirm safe mode was exited (it was ON when the crash was reported, so the
  server will not auto-start on boot until it is turned off).
- The rest of the device test list (upload from a PC browser, /ai page load,
  large folder listing, media playback) is still pending.
