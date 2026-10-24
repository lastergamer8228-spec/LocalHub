# Step 1 — Stability (ANR) + Security (HTTPS key) — 1.0.15 (code 16)

Part of the agreed sequence: 1) stability+security → 2) UX features →
3) performance/assistant quality → 4) release readiness. Each step ships a
version-numbered APK.

## 1. ANR risk: main-thread blocking removed

`onStartCommand`, `onCreate` and `Application.onCreate` run on the **main
thread**. Blocking there shows “App isn’t responding” or contributes to the app
being killed — related to the reported “app keeps stopping” behaviour.

Found and fixed:

| Location | Was | Now |
|---|---|---|
| `AppContainer` init 1 | `runBlocking { moduleRepository.observe().first() … }` — opens Room on the main thread at app start | Background `containerScope.launch`, plus `awaitModulesRestored()` gate the server waits on (5 s timeout) before serving |
| `AppContainer` server field | `buildServer(initialPort())` with `runBlocking { portFlow.first() }` | Built with `Constants.DEFAULT_PORT`; `suspend fun currentPort()` reads DataStore on IO; `startManagedServer()` is now `suspend` and binds on `Dispatchers.IO` |
| `AppContainer` init 2 | `systemInfoProvider.collectSnapshot()` (/proc, /sys) + `runBlocking { getAuditEnabled() }` on main | Both inside a background coroutine |
| `LocalHubService` | Lifecycle calls (`stopForeground`, `stopSelfResult`, `stopSelf`) and `startForeground` invoked from the IO worker | New `suspend fun finishService()` and `advertise()` dispatch lifecycle/foreground work to `Dispatchers.Main` |

Ordering guarantee kept: module switches are still restored **before** the server
accepts requests (the start path awaits the restore job), so the earlier
“restart overwrote saved switches” fix is not regressed.

## 2. Security: the shipped HTTPS private key is gone

The app bundled `res/raw/localhub_keystore.p12` with a hardcoded password, so
**every installation shared one private key**. Anyone extracting the APK could
decrypt HTTPS traffic to any device running LocalHub.

- New `TlsCertificateManager` generates a **2048-bit RSA keypair per install**
  inside the Android Keystore (non-extractable) and self-signs it for 10 years.
- `LocalHubServer.applyTls()` now uses that keystore and **fails closed**: if no
  identity is available the server refuses to start rather than serving
  plaintext or reusing a shipped key. The error tells the user to turn HTTPS off
  or check the device keystore.
- The bundled `.p12` file was deleted, and tests assert no keystore resource and
  no hardcoded keystore password remain in `src/main`.

Honest note: the certificate is still **self-signed**, so browsers warn. HTTPS
here protects local traffic from passive sniffing; it is not public-trust TLS.

## Tests (79 passing JVM tests, +7 this step)

- `ThreadingPolicyTest` (4): DB/preference reads and socket bind must not run on
  the main thread, streaming stays bounded for a 512 KB payload, lifecycle calls
  are reserved for the main thread.
- `TlsFailureTest` (3): no bundled keystore resource, no hardcoded keystore
  password in sources, TLS manager returns null (fails closed) when the platform
  keystore is unavailable.

All previous suites still pass (upload streaming, crash recovery, Compose
UI/navigation, module policy, sessions, host catalog).

## Not verified here

No ANR was reproduced on a device and no logcat was captured; the threading
changes are verified by inspection plus policy tests. Android Keystore
generation is **not** exercised on the JVM (Robolectric/JVM have no Android
keystore), so enabling HTTPS needs on-device confirmation.

## Phone acceptance

1. Update the preview, then cold-start the app several times on a slow/loaded
   phone: no “isn’t responding” dialog, modules keep their saved on/off state.
2. Start/stop/restart the server and change the port from Settings: each action
   completes, notification updates, correct port is used after restart.
3. Toggle HTTPS on: the app should start a listener with a **new** certificate
   (browser warning appears); check Settings shows no error.
4. Confirm the browser certificate fingerprint differs from another phone’s
   (proving per-install keys).
5. If HTTPS cannot start, the app must report a clear error and **not** fall back
   to plaintext.

## Remaining sequence

- **Step 2 (planned):** Clients screen actions (block/unblock/restrict with
  confirmation) + settings/logs backup & export.
- **Step 3 (planned):** folder listing pagination/limits, prune low-value
  assistant answers, faster `/ai` load.
- **Step 4 (planned):** R8 rules, lint/CI, and an honest Play Store assessment —
  `MANAGE_EXTERNAL_STORAGE` (All Files Access) is restricted by Play policy, so
  Play publishing likely needs scoped storage (SAF); personal/sideload use is
  unaffected.
