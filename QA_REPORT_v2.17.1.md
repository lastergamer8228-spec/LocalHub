# LocalHub v2.17.1 — Complete QA Report

> Generated 2026-08-10. Only claims what was actually run.

## Headless engine tests (real assertions, mock FS/Memory)
| Suite | Pass | Fail |
|-------|------|------|
| Self-Healing Engine | 67 | 0 |
| Cognitive Core | 27 | 0 |
| Self-Healing E2E Integration | 45 | 0 |
| **Total** | **139** | **0** |

## Static checks
- AI JS: **37/37** pass `node --check`.
- Dashboard `selfheal.js`: ✅ pass `node --check`.
- Android/Kotlin build: ❌ NOT RUN (no Android SDK/Gradle in sandbox).

## New in v2.17.1 (verified)
- Incident → FileEngine pipeline (success / reject / rollback / approval-deploy).
- Guardian DETECTS / SelfHeal DECIDES boundary; Guardian never modifies source.
- Bounded build repair loop (≤3) — honest `BUILD_REQUIRED` without SDK.
- Structured incident memory stored after each repair.
- Cognitive brain explains incidents + admin-gated "fix it".
- Admin Self-Healing console page shipped (`/selfheal`), not browser-tested here.
- Path security (traversal/outside rejected before read).

## Android / device (honest)
| Item | Status |
|------|--------|
| Android build | ❌ NOT RUN (no SDK) → `BUILD_REQUIRED` |
| APK generation | ❌ NOT RUN |
| APK install / device test | ❌ NOT RUN → `DEVICE_VERIFICATION_REQUIRED` (12 checks) |
| Playwright / live-device QA | ⭕ only when `192.168.0.108:8080` reachable |

## Readiness
`LOCAL_TEST_READY` + safe Android build/device mechanisms in place. Becomes
`DEVICE_VERIFIED` only after a real-device run.

## Files changed in v2.17.1
- `app/src/main/assets/ai/selfheal.js` (pipeline, build loop, approval, test
  scenarios, memory, path/static fixes)
- `app/src/main/assets/ai/cognitive.js` (selfHealChat + wiring)
- `app/src/main/assets/ai/features_guardian.js` (decide boundary)
- `app/src/main/java/com/localhub/localhub/server/AssetServer.kt` (`/selfheal`)
- `app/src/main/assets/dashboard/selfheal.html`, `dashboard/selfheal.js` (UI)
- Reports: `SELF_HEALING_E2E_REPORT.md`, `INCIDENT_MEMORY_REPORT.md`,
  `FINAL_CAPABILITY_MATRIX.md`, `CHANGELOG.md`
