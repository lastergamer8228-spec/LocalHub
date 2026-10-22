# LocalHub v2.18 — Device Self-Healing Report

> Generated 2026-08-10. This is the **honest** record of the real-device path.

## Status
**LOCAL_TEST_READY** — all engine logic is implemented and unit/integration-tested
headlessly (192/192). The real Android build, APK, install, and on-device
verification were **NOT executed in this sandbox** (no Android SDK, no Gradle, no
connected device, no access to Google Maven). They are wired and ready to run on
a development PC + device, and are reported here as `BLOCKED` / `NOT_AVAILABLE` —
**not** marked green.

| Step | Status (sandbox) | Status (on dev machine, pending) | Evidence |
|------|------------------|-----------------------------------|----------|
| A. Build succeeds | `BUILD_REQUIRED` (no SDK) | to run: `./gradlew assembleDebug` | device-tests 4 |
| B. APK generated | `NOT_AVAILABLE` | to run | device-tests 5 |
| C. APK verified | `NOT_AVAILABLE` | to run | device-tests 5 |
| D. APK installed w/ auth | `AUTHORIZATION_REQUIRED` / `DEVICE_AUTHORIZATION_REQUIRED` | to run | device-tests 6 |
| E–P. Runtime checks (18) | `DEVICE_VERIFICATION_REQUIRED` | to run | device-tests 7 |
| Q. Controlled repair succeeds | ✅ logic tested (E2E 1) | to confirm on device | E2E |
| R. Controlled failed repair rolls back | ✅ logic tested (E2E 4, 10b) | to confirm on device | E2E |
| S. Regression suite | ✅ 192/192 headless | run on device | run_all |
| T. Playwright vs real LocalHub | `BLOCKED` (no LAN device) | to run | — |

## What is genuinely implemented + tested (engine logic)
- **`Device.preflightBuild`** — verifies project root, gradle wrapper, project
  structure, SDK availability, build tools, workspace allowlist; creates a build
  context record. Returns `READY` / `BUILD_REQUIRED` / `OUTSIDE_ALLOWED_PROJECT`.
- **`Device.buildWithSelfHeal`** — allowlisted build; on failure extracts compiler
  errors → incident → RCA → candidate repair → static validation → rebuild,
  **bounded to maxRepairIterations (default 3)**. Never infinite.
- **`Device.discoverApk`** — locates/verifies the APK (exists, extension, size,
  checksum, package, version), stores a build/APK record.
- **`Device.detectDevice`** — `DEVICE_NOT_CONNECTED` / `DEVICE_UNAUTHORIZED` /
  `DEVICE_READY`. Unauthorized is never bypassed.
- **`Device.installApk`** — requires explicit authorization; `DEVICE_READY`
  required; records device/package/hash/result/timestamp; failure → incident.
- **`Device.verifyRuntime`** — 18 real checks with explicit statuses
  (`PASS`/`FAIL`/`NOT_AVAILABLE`/`AUTHORIZATION_REQUIRED`/
  `DEVICE_VERIFICATION_REQUIRED`); aggregates `DEVICE_VERIFIED` only when all
  required checks genuinely pass.
- **`Device.classifyFailure`** — 8 categories (PRODUCT_BUG / SELFHEAL_BUG /
  QA_BUG / ENVIRONMENT_FAILURE / DEVICE_CONFIGURATION / BUILD_FAILURE /
  NETWORK_FAILURE / PERMISSION_FAILURE).
- **`Transaction.runMultiFilePipeline`** — atomic multi-file repair (A,B,C: any
  failure → all written files rolled back). Tested: C fails → A,B,C restored.
- **`Transaction.recoverIncompleteTransaction`** — crash recovery: detects
  pending transactions, restores known-good, never leaves an ambiguous half-patch.
- **`Device.captureDeviceEvidence`** — assembles incident/device/version/APK/build/
  install/files/hashes/tests/verification/rollback/final-state.
- **`DeviceRegressions.storeDeviceRegression` / `findDeviceIncident`** — device
  regression memory.
- **`Device.runDeviceDeployPipeline`** — orchestrates preflight → build → APK →
  device → install → runtime verify → keep/rollback, honest gates.

## Headless test evidence (real assertions, mock adb/gradle/FS)
`Real-Device Integration` suite: **53/53 PASS** (device states, preflight,
compiler-error extraction, bounded build repair, APK discovery, authorized
install, runtime verification aggregation, failure classification, evidence,
atomic transaction + rollback, crash recovery, device regression memory, deploy
pipeline gates). Full suite **192/192 PASS** — no regression of the 139 baseline.

## Exact statuses (not green)
- Android build: `BUILD_REQUIRED` (sandbox).
- APK: `NOT_AVAILABLE` / `APK_NOT_FOUND` (not produced here).
- Install: `AUTHORIZATION_REQUIRED` until admin + `DEVICE_READY`.
- Runtime verification: `DEVICE_VERIFICATION_REQUIRED` (18 checks pending).
- **DEVICE_VERIFIED: NOT achieved.** Requires building + installing + verifying
  on a real device. Steps in `REAL_DEVICE_VERIFICATION_REPORT.md`.
