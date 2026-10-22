# LocalHub v2.18 — Real Device Verification Report

> Generated 2026-08-10. **Verification method matters.** This report distinguishes
> evidence tiers and does NOT upgrade to `DEVICE_VERIFIED` from source inspection
> or mocks.

## Evidence tiers (Phase 16)
| Tier | Meaning | Where used here |
|------|---------|-----------------|
| `MOCK_TESTED` | logic tested against mock adb/gradle/FS | engine unit tests (device-tests) |
| `LOCAL_TESTED` | full headless engine suite | run_all (192/192) |
| `DEVICE_TESTED` | actual checks on a connected device | ❌ not done (no device) |
| `LIVE_LAN_TESTED` | Playwright against real LocalHub address | ❌ not done (no device/LAN) |

## The 18 on-device runtime checks
Implemented in `SelfHeal.Device.verifyRuntime`. Without a connected device each is
`DEVICE_VERIFICATION_REQUIRED` (never auto-PASS). With a real device + runtime
handlers, each returns `PASS`/`FAIL`/`NOT_AVAILABLE`.

| # | Check | Sandbox status |
|---|-------|----------------|
| 1 | application-starts | DEVICE_VERIFICATION_REQUIRED |
| 2 | main-activity-loads | DEVICE_VERIFICATION_REQUIRED |
| 3 | server-starts | DEVICE_VERIFICATION_REQUIRED |
| 4 | server-healthy | DEVICE_VERIFICATION_REQUIRED |
| 5 | port-available | DEVICE_VERIFICATION_REQUIRED |
| 6 | authentication-works | DEVICE_VERIFICATION_REQUIRED |
| 7 | admin-login-works | DEVICE_VERIFICATION_REQUIRED |
| 8 | web-user-login-works | DEVICE_VERIFICATION_REQUIRED |
| 9 | dashboard-loads | DEVICE_VERIFICATION_REQUIRED |
| 10 | files-module-works | DEVICE_VERIFICATION_REQUIRED |
| 11 | media-player-loads | DEVICE_VERIFICATION_REQUIRED |
| 12 | websocket-connects | DEVICE_VERIFICATION_REQUIRED |
| 13 | assistant-loads | DEVICE_VERIFICATION_REQUIRED |
| 14 | cognitive-initializes | DEVICE_VERIFICATION_REQUIRED |
| 15 | guardian-initializes | DEVICE_VERIFICATION_REQUIRED |
| 16 | selfheal-initializes | DEVICE_VERIFICATION_REQUIRED |
| 17 | selfheal-ui-admin-reachable | DEVICE_VERIFICATION_REQUIRED |
| 18 | non-admin-selfheal-gated | DEVICE_VERIFICATION_REQUIRED |

Aggregation: `DEVICE_VERIFIED` ONLY when all required checks genuinely `PASS`.
Tested: all-PASS → `DEVICE_VERIFIED`; any FAIL → `DEVICE_VERIFY_FAILED` (device-tests 7b/7c).

## Device connection (Phase 4)
`detectDevice()` returns `DEVICE_READY` / `DEVICE_UNAUTHORIZED` /
`DEVICE_NOT_CONNECTED`. Unauthorized devices are never bypassed —
`DEVICE_AUTHORIZATION_REQUIRED` is returned until the user accepts the RSA prompt.

## How to reach DEVICE_VERIFIED (requires your hardware)
1. **On a dev PC** with the Android SDK: open the LocalHub project.
2. `./gradlew assembleDebug` → produces `app/build/outputs/apk/debug/app-debug.apk`.
3. Connect your phone with USB debugging enabled; accept the RSA prompt
   (`adb devices` → `device`, not `unauthorized`).
4. Open `/selfheal` console (admin) and use:
   `Preflight Build` → `Build` → `Discover APK` → `Detect Device` → `Install APK` →
   `Verify Runtime`. Or run `Deploy Pipeline`.
5. Run the Playwright QA suite against `http://192.168.0.108:8080` (same LAN).
6. Only after **all 18 checks PASS on the real device** + Playwright passes does
   the status become `DEVICE_VERIFIED` / `LIVE_QA_VERIFIED`.

## Current status (honest)
`LOCAL_TEST_READY` (+ `DEVICE_READY`-mechanisms implemented and unit-tested).
`DEVICE_VERIFIED` / `LIVE_QA_VERIFIED` are **NOT** claimed — they require the
steps above on a real device and LAN.
