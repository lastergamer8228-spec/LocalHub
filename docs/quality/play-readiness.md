# Play Store readiness — honest assessment

**Status: NOT Play-ready.** This document lists exactly what blocks a Play
release, what is already done, and what has not been verified. Nothing here is
a claim that Google will approve the app.

Last reviewed: 2026-10-23 · LocalHub 1.0.17 (versionCode 18)

---

## 1. What blocks submission today (hard blockers)

| # | Blocker | Where | What it takes |
|---|---------|-------|---------------|
| 1 | **Target API level too low.** Since 31 Aug 2026 new apps *and updates* must target **Android 16 (API 36)**; existing apps must target API 35+ to stay available to new users on newer devices. LocalHub targets **API 34**. | `app/build.gradle` (`compileSdk 34`, `targetSdk 34`) | Bump to 36, install `platforms;android-36`, fix API-35/36 behaviour changes (edge-to-edge, foreground-service restrictions, 16 KB page-size native alignment for the bundled ffmpeg-kit). [1](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-GB) |
| 2 | **All Files Access (`MANAGE_EXTERNAL_STORAGE`)** is a restricted permission. Permitted uses are explicitly *file managers, backup & restore, anti-virus, document management apps*. The developer must justify why the Storage Access Framework / MediaStore is not sufficient, the use must be the app's **core functionality**, and the core functionality must be prominently documented in the store listing. A **Permissions Declaration Form** plus manual review is required. | `AndroidManifest.xml` | Either (a) submit the declaration and argue LocalHub is a network file manager, or (b) ship a scoped-storage build (see §3). [2](https://support.google.com/googleplay/android-developer/answer/10467955?hl=en) [3](https://support.google.com/googleplay/android-developer/answer/16558241?hl=en) |
| 3 | **Foreground service type `specialUse`** — Android 14+ requires a type per foreground service; `specialUse` needs `FOREGROUND_SERVICE_SPECIAL_USE` + a `<property>` subtype (LocalHub already has both) **and** a Play Console declaration with a written justification and a **demo video**. All FGS types are reviewed. | `LocalHubService` | Record a demo video; write the justification. [4](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en) [5](https://developer.android.com/about/versions/14/changes/fgs-types-required) [6](https://support.google.com/googleplay/android-developer/answer/16559646) |
| 4 | **Accessibility service (`BIND_ACCESSIBILITY_SERVICE`)** used by `RemoteAccessService` for remote control. Accessibility is a restricted, heavily reviewed permission on Play. | `RemoteAccessService`, `res/xml/remote_access_config.xml` | Justify, or make remote control a Play-excluded feature. |
| 5 | **Data Safety + privacy policy.** The app serves files off the device over LAN and keeps logs. A privacy policy URL and an accurate Data Safety declaration are mandatory. | — | Write both; state that data never leaves the LAN. |
| 6 | **Release signing + 16 KB page size.** No signing config ships with the repo (the old bundled keystore was removed on purpose in 1.0.15). From 1 Nov 2025 Play requires 16 KB-aligned native libs for Android 15+. | `app/build.gradle` | Configure a real keystore locally; verify ffmpeg-kit's `.so` alignment with `zipalign -c -P 16`. |

## 2. What is genuinely done (verified in this repo)

- **No bundled keystore / credentials in `res/raw`** — removed in v1.0.15; TLS
  keys are now generated per install into the Android Keystore
  (`system/TlsCertificateManager.kt`). Evidence: source inspection +
  `TlsFailureTest` (3 JVM tests).
- **R8 rules written and the R8 build compiles** — `app/proguard-rules.pro` pins
  NanoHTTPD/NanoWSD, Gson models, Room, ffmpeg-kit, ZXing, coroutines and manifest
  entry points, and `./gradlew assembleRelease` (minify on) completes with no
  missing-class errors for LocalHub 1.0.17.
  Evidence: build output + `app/build/outputs/mapping/release/mapping.txt`.
  **This proves R8 finishes, not that the shrunk app behaves identically at
  runtime** — the release APK has never been installed.
- **Lint configuration exists** — `app/lint.xml` + `lint { }` block. Evidence:
  source inspection. **Lint has never been run end-to-end**; `abortOnError` is
  `false` and `checkReleaseBuilds` is `false` on purpose so an untriaged warning
  cannot silently break a release. Flip both to `true` after a lint baseline is
  reviewed.
- **CI pipeline defined** — `.github/workflows/ci.yml`: syntax-check of every
  shipped web asset, all Node test suites, `testDebugUnitTest`, `assembleDebug`,
  and a separate `assembleRelease` job so an R8 regression is loud. Evidence:
  file written; **never executed** (no CI runner available in this sandbox).
- **Crash safety net** — uncaught-exception guard, safe mode, bounded crash log,
  memory-pressure cleanup (v1.0.14). Evidence: 19 JVM tests +
  source inspection.

## 3. The scoped-storage path (recommended if the declaration is rejected)

Play's preferred answer to blocker #2 is "don't ask for All Files Access":

1. Keep `MediaStore` for images/video/audio (already declared via
   `READ_MEDIA_*`) and serve those through the existing `FileOperations`.
2. For "serve any folder", let the user pick a folder with
   `Intent.ACTION_OPEN_DOCUMENT_TREE`, persist the URI with
   `takePersistableUriPermission`, and back a second `FileOperations` mode with
   `DocumentFile` / `ContentResolver.openInputStream`.
3. Ship both: full access on sideloaded/personal builds, scoped access on the
   Play flavour. Two product flavours (`personal` / `play`) is the cleanest cut.

This is real work (roughly a day) and is **not** part of 1.0.17.

## 4. What has NOT been verified

| Claim | Evidence tier | Reality |
|-------|---------------|---------|
| App compiles | **Verified** (debug build) | see `validation_1.0.17.zip` |
| JVM unit tests pass | **Verified** | `./gradlew testDebugUnitTest` |
| Node/web test suites pass | **Verified** | `tests/test_*.js` |
| R8 release build compiles | **Verified** | `assembleRelease` succeeded for 1.0.17 |
| R8-shrunk app behaves like debug | **NOT verified** | release APK never installed or run |
| Lint is clean | **NOT verified** | never run |
| UI behaves on a device | **NOT verified** | no device run in this environment |
| Play will approve | **NOT verified** | 4 restricted-permission reviews stand between here and approval |

## 5. Recommendation

Ship **1.0.17 as the personal/sideload build** (that is what the APK in
`deliverables/` is). Treat Play as a separate, later project with this order:

1. Bump to API 36 and fix the behaviour changes (hard requirement, blocks everything).
2. Configure signing + verify 16 KB alignment.
3. Run lint, triage the baseline, then turn `abortOnError` on.
4. Run `assembleRelease` and smoke-test the R8 build on a device.
5. Decide: submit the All Files Access declaration, or build the scoped-storage
   flavour. **Have the scoped-storage route ready before submitting**, because a
   rejection here is the most likely outcome for a LAN file server.
6. Record the foreground-service demo video and write the Data Safety form.
