# Code refinement — 1.0.6-refinement-preview (code 7)

This is a maintainability pass, not a claim of release readiness or a rewrite of
working subsystems. Security, lifecycle and device acceptance blockers from the
[controller audit](controller-audit.md) remain applicable.

## Changes

### Offline reference libraries

Three libraries now express repetitive static replies as data records, with
file-local registration helpers. Regex strings become RegExp instances at
registration time. Executable commands stay executable; command order, names,
permissions, categories, match sources/flags and response contents are preserved.

| Library | Before | After | Registered commands |
|---|---:|---:|---:|
| features_jarvis.js | 2,087,886 bytes | 1,518,643 bytes | 4,909 |
| features_extra.js | 1,654,920 bytes | 1,180,272 bytes | 4,041 |
| features_knowledge.js | 448,327 bytes | 287,326 bytes | 1,170 |
| Total | 4,191,133 bytes | 2,986,241 bytes | 10,120 |

Removed 1,204,892 bytes of uncompressed source repetition (~28.7% of these three
files). 9,799 repeated reply functions share registration logic; 49,730 inline
regex constructors became data entries. This is not a claim that the compressed
APK shrank by the same amount or that all stored reference answers are good.

Before/after registrations and handlers were compared, including fresh reply
objects. Fingerprints of the baseline are retained in tests/library-baseline.json;
`node tests/test_command_libraries.js` checks future changes without requiring Git
or a JavaScript parser dependency. Existing pattern redundancy is deliberately
preserved rather than risking changed routing behaviour during cleanup.

### Web player and assistant UI

- Removed 9 player onclick assignments that were immediately overwritten later
  in the same setup function. Final actions (including menu close behaviour)
  remain the same.
- Removed unused autoplay bookkeeping; shared SVG shell instead of duplicating
  four dynamic icon templates and rebuilding their table on each call.
- Removed 48 unused Assistant Hologram/Inspect CSS rules/keyframes. Current chat
  styles remain; System Core files were not removed.
- Removed the obsolete reference-only Pocket TTS asset folder. Runtime system TTS
  and third-party license texts remain.

### Android

- Removed obsolete FileManager root-folder filter constants/locals.
- Changed service helpers already called inside IO coroutines to suspend helpers,
  removing nested runBlocking calls. Foreground timing, command serialization,
  bind-result handling and error paths are retained.
- Corrected metadata-only module comments and stale neural-TTS wording.
- Did not flatten state machines or remove guards merely to reduce line counts.

### Project structure and delivery

- 53 historical reports/build logs/layout screenshots archived outside the source
  project in `archives/LocalHub_history.zip`. Those historical archives were subsequently removed during workspace cleanup; they are not included in the current source/app. Current guides/audit notes are under docs/.
- Root README replaced by concise build/use/layout/validation instructions.
- GitHub workflow no longer publishes a hardcoded v2.23 “latest stable” release
  or asserts tests it did not run. It builds/tests an ARM64 prerelease preview.
- Only the current execution-evidence archive is retained under workspace `deliverables/`; obsolete validation archives were removed.
- Build caches, generated APKs, local SDKs and optional test screenshots are not
  part of the source archive. Gradle wrapper, tests and licenses are retained.
- Personal Brain, Self-Healing, automatic-audio and module-access browser scripts
  were compared byte-for-byte against the prior APK and remain unchanged.

## Validation performed

- Behavioural fingerprints: all 10,120 reference-library registrations match the
  pre-refactor baseline. Non-static handler source and static reply results match.
- 542 existing headless engine assertions passed (mock-backed, not device tests).
- Native Kotlin compilation and 7 JVM module-policy tests passed.
- 28 controller source contracts and 20 audio source contracts passed.
- Automatic-audio mocks: AC-3/E-AC-3 selection, native AAC bypass, autoplay retry,
  denied access and existing pause/seek/mute/sync scenarios passed.
- Loaded-player module OFF/re-enable/session/network mocks passed.
- Chromium player layout/fullscreen fixtures passed at 1600x900, 390x844,
  320x640 and 844x390. No actual film was played in these fixtures.
- Before/after chat computed styles matched for 14 selectors × 15 properties
  at desktop and mobile widths after dead CSS removal.
- assembleDebug succeeded. APK version/signature/assets are verified separately
  in the delivery step. No connected Android device was used in this pass.

## Deliberately not done

No indiscriminate minification, loss of error/permission handling, deletion of
license notices, deletion of working features, or removal of tests to make the
project appear smaller. Existing reference-content quality and deeper runtime
architecture still need separate review. This pass does not establish that the
app is “AI-free”, bug-free, or ready to launch.
