# LocalHub — handoff notes

LocalHub is an **Android app that turns the phone into a local HTTP/WebSocket
server** (NanoHTTPD + NanoWSD). The UI you will be working on is **not the
Android app** — it is the **bundled web dashboard** that the phone serves to any
browser on the same Wi-Fi (PC or mobile).

Current build: **1.0.20 (versionCode 21)**, package `com.localhub.localhub`.

---

## Where the web UI lives

```
app/src/main/assets/
├── dashboard/
│   ├── index.html        ← home dashboard   (served at /)
│   ├── files.html        ← file manager     (served at /files)
│   ├── player.html       ← media player     (served at /player)
│   ├── login.html        ← login            (served at /login.html)
│   ├── core.html         ← system hologram  (served at /core)
│   ├── selfheal.html     ← health/repair    (served at /selfheal)
│   ├── style.css         ← LEGACY theme (still loaded first)
│   ├── theme-pro.css     ← CURRENT design system ("Pro Console")
│   ├── nav.js            ← shared top navigation (injected on every page)
│   ├── app.js            ← dashboard logic (API calls, WebSocket, roles)
│   └── visuals.js        ← System Core canvas visualisation
├── ai/index.html         ← assistant page   (served at /ai)
└── os/                   ← separate "LocalHub OS" web app (older)
```

`theme-pro.css` is loaded **after** `style.css` on every page and overrides it.
It is the single place to change colours, spacing, radii, buttons and cards.

## ⚠️ Two things that will bite you

1. **New asset files must be routable.** `AssetServer.kt` maps URLs to bundled
   files. It has an explicit map (`/style.css`, `/app.js`, …) **plus** a generic
   fallback for root-level files with a static extension (`*.css`, `*.js`,
   `*.png`, …) served from `dashboard/`. If you add a file with an unusual
   extension, add a route. On 2026-10-24 a redesign shipped CSS + JS that were
   never routed, so every page rendered unstyled — this is why
   `tests/check_asset_routes.py` exists. **Run it after adding any asset.**

2. **Do not rename or delete these IDs/classes** — `app.js` and the role system
   depend on them, and a test fails if you do:
   - IDs: `ws-status`, `role-badge`, `logout-btn`, `connect-body`,
     `status-banner`, `devices`, `device-policy`, `modules`, `device`, `logs`,
     `user-media`, `user-files`, `user-quick`, `core-embed`, `server-control-card`,
     `ctrl-row`, `sb-*`, `tm-*`, `activity-body`, `endpoints`
   - Classes that control who sees what: **`.admin-only`**, **`.user-only`**,
     **`.dev-only`** (toggled by `applyRole()` — permission logic, not styling)

Everything else in the markup is yours to restructure.

## How to see your changes

- **Fastest:** run any static server over `app/src/main/assets/dashboard` and open
  `index.html`. The API calls will fail and it will bounce you to
  `login.html`, which is fine for pure CSS/layout work — or stub
  `sessionStorage.lhtoken` and the `/api/...` responses.
- **Real:** `./gradlew assembleDebug` and install the APK, then open
  `http://<phone-ip>:8080` from a PC on the same Wi-Fi. This is the only way to
  verify upload, streaming and role gating.

## Tests

```bash
node tests/test_web_shell.js        # nav + theme wiring (mocked DOM)
node tests/test_library_loader.js   # deferred AI libraries
node tests/test_deferred_slots.js   # command ordering
python3 tests/check_asset_routes.py # every referenced asset is servable
python3 tests/check_controller_contracts.py   # Android-side source contracts
./gradlew testDebugUnitTest         # 107 JVM/Robolectric tests
```

**None of these tests check how anything looks.** Visual review is manual.

## Known product constraints

- Still `targetSdk 34`; Play Store now requires **API 36** for new apps/updates.
- Declares `MANAGE_EXTERNAL_STORAGE` (All Files Access) — fine for a personal
  sideload build, the main Play-review risk.
- The app is a **server**: the dashboard must keep working while the phone screen
  is off and must not depend on anything that needs a foreground tab.

See `docs/quality/` for the history: crash fixes (`list-key-crash.md`), the
redesign attempt (`web-redesign.md`), and the Play assessment
(`play-readiness.md`).

---

## Recent Modernizations & Upgrades

1. **Dual-Segmented Web Dashboard**:
   - `⚡ Hub Portal`: High-level quick access for connected users (Quick Drop wireless upload, Launchpad shortcuts, live phone storage/battery vitals, remote phone hardware controls).
   - `⚙ System & Diagnostics`: Dedicated home for internal telemetry (Transfer monitor, holographic canvas, server logs, raw module statuses).
2. **Mobile Web Navigation Dock**:
   - Fixed bottom navigation bar for screens `≤ 768px` using existing 6 navigation links to preserve all contract tests while giving users a native-app mobile experience.
   - Hidden during fullscreen video playback (`body.cinema`, `body.lh-fullscreen`).
3. **Wireless Quick Drop**:
   - 1-tap/drag-and-drop file upload streaming straight to the phone's `Download/` folder with live upload progress.
4. **Remote Phone Hardware Actions**:
   - Integrated toggles on dashboard for Flashlight (torch), Phone Vibration ("Find my phone"), Volume Adjustments, and Screen Mirroring via existing `/api/device/action` endpoints.
5. **Android Native App Polish**:
   - `ServerStatusCard.kt`: Tap-to-copy URL with Toast feedback, plus native Android Share Sheet button (`Intent.ACTION_SEND`) to share the Wi-Fi link directly via WhatsApp/Telegram.
   - `DashboardScreen.kt`: Capped infinite log list to latest 5 items on the main home screen.
   - `FileManager.kt`: Cross-platform path sanitization supporting Windows drive letters in JVM unit tests.

