# LocalHub

**LocalHub** turns an Android phone into a lightweight, self-hosted local server.
It exposes a RESTful HTTP API, a realtime WebSocket channel, and a modern
responsive dashboard — all working offline over the local network, with no
external dependencies or cloud calls.

> Built with Kotlin, Jetpack Compose (Material 3), NanoHTTPD / NanoWSD 2.3.1,
> Room, DataStore, Coroutines and Gson. Min SDK 24 • Target/Compile SDK 34 •
> Java/Kotlin JVM 17. Clean Architecture + MVVM + Repository pattern.

---

## Features

| Area | Description |
|------|-------------|
| **HTTP Server** | Embedded server on port `8080` (configurable). GET/POST, JSON responses, static dashboard hosting. |
| **REST API** | `/api/status`, `/api/system`, `/api/device`, `/api/network`, `/api/storage`, `/api/battery`, `/api/cpu`, `/api/memory`, `/api/modules`, `/api/logs`, `/api/clients`, `/api/statistics`. |
| **WebSocket** | Realtime broadcast of system stats, log events and client connect/disconnect over `/ws`. |
| **Dashboard** | Dark, responsive HTML/CSS/JS dashboard served from app assets and updated live via WebSocket. |
| **System Monitoring** | CPU, RAM, storage, battery, network, device model/manufacturer/Android version. |
| **Module System** | Pluggable modules implementing `start() / stop() / handleRequest() / toInfo()`. The Dashboard module ships enabled by default. |
| **Connected Clients** | Tracks IP, user-agent, connect time, last activity and protocol (WebSocket / HTTP). |
| **Logging** | Levels DEBUG/INFO/WARNING/ERROR, persisted in Room, streamed over WebSocket. |
| **Foreground Service** | Keeps the server alive with a persistent notification. |
| **Media Player** | Professional in-browser player: Range streaming, multiple audio/subtitle tracks (SRT/ASS/SSA/VTT), subtitle & audio settings, video filters (brightness/contrast/saturation/hue/sharpness/zoom/rotate/mirror), playlist (shuffle/repeat/reorder), frame step, Picture-in-Picture, mini player, screenshot, auto-resume, media info panel, and full assistant control via a Media Bridge. |
| **Animation System** | Centralized, premium micro-interaction language shared across web + Android: ripple, page transitions, card hover/lift, count-up metrics, skeleton/shimmer, typing/thinking indicators, smooth scrolling — all using one set of timing/easing tokens and respecting `prefers-reduced-motion`. |
| **LocalHub OS** | A personal local-OS layer at `/os`: Universal Search (Spotlight-like), Activity Timeline, Dynamic Home dashboard, a no-code Visual Automation Builder (IF/THEN blocks), personalized Spaces with per-space context, and a **Security & Backup** view (2FA, LAN shares, storage cleanup, full backup/restore). Fully assistant-integrated. |
| **Security & Tools** | Optional HTTPS (self-signed, opt-in), security audit events (failed logins / permission denials / admin actions), TOTP 2FA for admin, expiring LAN share links, storage cleanup (duplicate + category scanner), PWA offline shell, and full OS backup/restore. |
| **Persistence** | Room (logs, settings, modules, statistics) + DataStore (port, theme, autostart, server name) + client-side localStorage for OS state (timeline, spaces, search history). |

---

## Architecture

```
LocalHubApplication
        │
        ▼
    AppContainer  (manual DI)
    ├─ PreferencesManager (DataStore)
    ├─ AppDatabase (Room) → repositories
    ├─ AppLogger (Room + SharedFlow)
    ├─ SystemInfoProvider (telemetry + StateFlow)
    ├─ ModuleManager (+ DashboardModule)
    ├─ ClientTracker (live clients StateFlow)
    └─ LocalHubServer (NanoWSD)
            ├─ ApiRouter        (/api/*)
            ├─ AssetServer      (dashboard assets)
            └─ WebSocketHub → LocalHubWebSocket (realtime)
                        │
                LocalHubService (foreground) streams stats & logs
```

Every Kotlin file has a single responsibility and lives under a clearly named
package: `core`, `data.*`, `model`, `system`, `module`, `server`, `service`,
`ui.*`, `util`.

---

## Build & Run

1. Open **Android Studio** (Giraffe / Hedgehog or newer).
2. `File ▸ Open` and select the `LocalHub` folder (this project).
3. Let Gradle sync (the wrapper is pinned to **Gradle 8.2**).
4. Connect a device or start an emulator (API 24+).
5. Run `app` (Shift+F10).

From the terminal:

```bash
./gradlew assembleDebug      # build the debug APK
./gradlew installDebug       # install on a connected device
```

> Requires the Android SDK (Compile SDK 34) and a JDK 17 toolchain, which
> Android Studio configures automatically.

---

## Using LocalHub

1. Open the app and go to **Settings ▸ Server ▸ Start** (or enable *Autostart
   on boot*). A persistent notification confirms the server is running.
2. The dashboard is available at `http://<device-ip>:8080` from any browser on
   the same network. Tap **Open** on the Dashboard screen to launch it.
3. The Compose UI (Dashboard / Logs / Modules / Clients / Settings) mirrors the
   same data in realtime.

### Example API calls

```bash
curl http://<device-ip>:8080/api/status
curl http://<device-ip>:8080/api/system
curl http://<device-ip>:8080/api/battery
curl http://<device-ip>:8080/api/modules
```

A WebSocket client can connect to `ws://<device-ip>:8080/ws` and will receive
JSON frames of the form `{"type":"stats","data":{...}}` and
`{"type":"log","data":{...}}`.

---

## Permissions

`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`,
`CHANGE_WIFI_MULTICAST_STATE`, `WAKE_LOCK`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`,
`RECEIVE_BOOT_COMPLETED`.

The foreground service is declared with type `specialUse` (Android 14+) and
persists the server while the device is on.

---

## Extending with modules

Implement `LocalHub.module.LocalModule`:

```kotlin
class MyModule : LocalModule {
    override val id = "my-module"
    override val name = "My Module"
    override val description = "Does something useful."
    override val version = "1.0.0"
    override var isEnabled = true

    override fun start() { /* spin up */ }
    override fun stop() { /* tear down */ }
    override fun handleRequest(session: IHTTPSession, path: String): Response? {
        return NanoHTTPD.newFixedLengthResponse(Status.OK, "application/json", "{\"ok\":true}")
    }
    override fun toInfo() = ModuleInfo(id, name, description, version, isEnabled)
}
```

Register it once in `AppContainer`:

```kotlin
val moduleManager = ModuleManager().apply {
    register(DashboardModule())
    register(MyModule())
}
```

---

## Offline Speech (System TTS)

LocalHub's speech engine uses the **Android built-in system TTS** (Google TTS).
It is **instant, fully offline, and needs no model download** — ideal for
low-end devices (e.g. Hot 9). Web UI at `/tts`, API at `/api/tts/*`.

- **No heavy neural model** — the phone's own voice engine does the work.
- **Any language** supported by the phone's TTS engine works (add a Hindi voice
  pack in Android Settings → Language & Input → Text-to-speech for Hindi).
- This replaced the earlier **Pocket TTS (sherpa-onnx)** engine, which ran a
  ~236MB neural model but was too slow on low-end hardware.

### API

```
GET  /api/tts/status                        → engine status (always ready)
POST /api/tts/synthesize  {text, speed?, lang?}   → {ok, url: /api/tts/file?name=...}
GET  /api/tts/file?name=...                 → serves the generated WAV
```

> Note: this integration is **code-reviewed** in this repo's build pipeline — the
> actual APK must be built in Android Studio (Android SDK + JDK 17) to compile and
> verify on your device.

---

## Project layout

```
LocalHub/
├─ build.gradle / settings.gradle / gradle.properties
├─ gradle/wrapper/            # Gradle 8.2 wrapper (jar + properties)
├─ gradlew · gradlew.bat
├─ app/
│  ├─ build.gradle · proguard-rules.pro
│  └─ src/main/
│     ├─ AndroidManifest.xml
│     ├─ java/com/localhub/localhub/   # all Kotlin source
│     ├─ res/                          # strings, theme, icons
│     └─ assets/dashboard/             # index.html · style.css · app.js
└─ README.md
```

---

© LocalHub — your phone, your local server.
