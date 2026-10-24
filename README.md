# LocalHub

Android-hosted LAN server with a native controller, browser dashboard, file
manager and media player. Requires Android 7+ (API 24); builds use JDK 17 and
Android SDK 34.

**Status: testing preview, not launch-ready.** Build and unit-test results are
not a substitute for device testing. See the [controller audit](docs/quality/controller-audit.md)
for current release blockers and the acceptance checklist.

## Build

```sh
./gradlew testDebugUnitTest assembleDebug -PaacPreview=true
```

The preview is ARM64-only and uses application ID
`com.localhub.localhub.aacpreview`. Without `-PaacPreview=true`, Gradle builds the
original `com.localhub.localhub` application for the dependency's supported ABIs.
APK output: `app/build/outputs/apk/debug/app-debug.apk`.

Preview updates require the same signing key. The original GitHub-built app and
local preview use different package/signing configurations; do not uninstall an
existing app without preserving its data. Generated APKs, build caches and local
SDK paths do not belong in the source repository.

## Use

1. Grant storage access on the host phone.
2. Open native **Settings → Start server**. Server construction alone does not
   open a listener; boot startup is a separate preference.
3. Connect a browser on the same network using the URL or QR shown in Settings.
4. Sign in. Roles and per-device file restrictions are enforced server-side.

Features with implemented switches can be controlled through **Modules**.
Required and information-only components do not offer decorative on/off switches.
Turning a module off blocks its owned server routes. Data already downloaded by
another device cannot be recalled.

Media playback uses the browser's video decoder. Known incompatible audio codecs
can be adapted automatically into bounded AAC stereo chunks. HEVC/HDR/Dolby
Vision support still depends on the client browser and hardware.

## File uploads

Uploads from the browser are streamed to disk with a bounded buffer (never
buffered whole in memory). The limit is 512 MB per upload; oversized uploads,
missing lengths and low storage return clean HTTP errors instead of crashing the
host app. See the upload crash guide for the root cause and fixes.

## Assistant system checks

Try `explain system integration`, `check localhub health`, or `repair localhub`.
The host-aware bridge reads actual feature/permission state and can recheck a
transient failed read once. It does not edit files, grant permissions, enable
OFF modules or patch/redeploy the installed APK. See the integration guide for
scope and outstanding device/repair-engine acceptance gates.

## Project layout

```text
app/src/main/java/   Android controller, server, persistence and device services
app/src/main/assets/ Browser UI and offline assistant resources
app/src/test/        JVM tests
tests/             Browser fixtures, source-contract and audio regression checks
docs/              Current guides, audit and refinement notes
gradle/            Gradle wrapper
esp32/             Optional hardware remote sketches
```

## Validation

- `./gradlew testDebugUnitTest`: JVM policy/session/catalog tests plus native Compose layout/navigation regressions under Robolectric (not a phone acceptance run).
- `python3tests/check_controller_contracts.py`: source wiring checks, not runtime tests.
- `python3tests/check_compatible_audio.py`: audio integration/source checks.
- `nodetests/test_audio_stream.js`: mocked automatic audio lifecycle.
- `nodetests/test_module_access.js`: mocked controller-to-player access changes.
- `python3tests/test_cinema_layout.py`: Chromium layout fixture; requires
  Playwright and its Chromium installation. It does not play the user's movie.
- `python3tests/test_audio_conversion.py`: synthetic host-FFmpeg codec checks;
  requires `imageio-ffmpeg`. Not an Android decoder test.

A successful build does not establish OEM background-service behaviour, real
permissions, screen capture consent, live audio sync or readiness for release.

## Documentation

- [Assistant + brain development stages](docs/development/assistant-stages.md)
- [Crash protection & recovery](docs/quality/crash-recovery.md)
- [Upload crash fix (streaming uploads)](docs/quality/upload-crash.md)
- [Host-aware Self-Healing integration](docs/quality/system-integration.md)
- [Reviewed planner/evidence pilot](docs/quality/reviewed-plans.md)
- [Assistant baseline audit](docs/quality/assistant-baseline.md)
- [Native layout correction and Compose regression evidence](docs/quality/native-layout.md)
- [Native controller audit](docs/quality/controller-audit.md)
- [Automatic audio](docs/guides/audio.md)
- [Player layout](docs/guides/player.md)
- [Code refinement](docs/quality/refinement.md)

## Third-party code

AndroidX, NanoHTTPD, Gson, ZXing and FFmpegKit dependencies are declared in Gradle.
The app uses Android system TTS; no Pocket TTS model files are required. Native
FFmpegKit sources/build references and applicable license texts are retained under
`app/src/main/assets/licenses/`. Preserve those notices when redistributing.
