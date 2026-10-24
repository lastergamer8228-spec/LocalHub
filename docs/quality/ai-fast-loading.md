# Step 3 — /ai fast loading + bounded directory listing — 1.0.17 (code 18)

Sequence agreed by the user: integrate everything first, run device testing at the
very end. This document records what changed, what proves it, and what is still
unverified.

---

## 3.1 Bounded directory listing

**Problem.** `FileManager.list()` returned every entry in a folder. A folder with
tens of thousands of items produced one enormous JSON response and a browser tab
that stopped responding.

**Change.**
- `FileManager.list(rawPath, maxEntries)` is bounded:
  `DEFAULT_LIST_LIMIT = 500`, `MIN_LIST_LIMIT = 20`, `MAX_LIST_LIMIT = 2000`.
  A client-supplied `limit` is clamped server-side, never trusted.
- The response now reports `truncated`, `shown`, `total` and `limit`, so the UI
  can say "showing 500 of 12 480" instead of silently hiding files.
- Folders are kept before files, so navigation stays usable when a listing is cut.
- `ApiRouter` applies the same limit to `/api/files` and `/api/fs/list`.
- `dashboard/files.html` renders a truncation banner in both list and grid views.

**Evidence.** `FileManagerTest` — 10 JVM tests on a real temporary filesystem
(capping, clamping, folder-first, hidden folders, sorting, missing paths,
traversal, entry shape). **Not verified on a device.**

## 3.2 Removing 102 tautologies from the command libraries

`features_jarvis.js`, `features_extra.js` and `features_knowledge.js` contained
entries whose answer repeated the question (`"what is speed"` → `"speed"`). 102
of them were removed: jarvis 4909 → 4829, extra 4041 → 4019, knowledge unchanged
at 1170. Total 10 120 → 10 018 registrations.

**Evidence.** `tests/library-baseline.json` regenerated, `test_command_libraries.js`
passes (behavioural fingerprints: metadata, regex sources/flags, static replies,
handler source). All other Node suites still pass. **Not verified on a device.**

## 3.3 Deferred loading of the large libraries (the /ai fast path)

**Problem.** ~3 MB of JavaScript registering ~10 000 commands loaded as blocking
`<script>` tags before `Brain.boot()`, so the /ai page could not paint until all
of it had downloaded, parsed and executed.

**Change.** The three libraries are now fetched after the page paints by
`ai/library_loader.js`.

The hard part is that deferring must not change *which* command answers a phrase.
`Commands.parse()` prefers the longest match but falls back to registration order
on a tie, and `features_critical.js` sits **between** `features_jarvis.js` and
`features_knowledge.js` — so simply appending the libraries at the end would
silently re-order the registry.

**Order-preserving slot mechanism** (additive, in `ai/commands.js`):
- `index.html` replaces each removed `<script src>` with a marker:
  `<script>LH_AI.Commands.openLibrary("features_jarvis");</script>`, which records
  the registry position that library would have had.
- The loader brackets each file with `beginLibrary(id)` … `endLibrary()`. Commands
  registered in between go to a staging list and are spliced back at
  `recordedPosition + alreadyInserted`.
- A chunk that fails calls `cancelLibrary()`: nothing is inserted and the later
  slots are not shifted.
- If the browser has a stale `commands.js` without the slot API, the loader
  detects it, reports `slots: false` and loads the files plainly.

**Ground-truth check.** The command-registering script order of the packaged
`index.html` (markers expanded back into their files) was compared against the
order shipped in the **v1.0.16 APK**: identical, 44 files, no drift.

**Evidence.**
- `test_deferred_slots.js` — 7 scenarios against the real `commands.js`: the
  deferred registry is byte-identical to the synchronous one, staged commands are
  invisible until `endLibrary()`, cancellation leaves no hole, and `parse()`
  returns the same winner for tie inputs.
- `test_library_loader.js` — 10 scenarios: sequential loading, slot bracketing,
  failure handling, idempotency, degraded mode, badge restore, no-DOM safety.
- **Real browser timing is not covered.** That needs a device run.

## 3.4 Build/CI/Play scaffolding (step 4, done in the same pass)

- `app/proguard-rules.pro` rewritten: NanoHTTPD/NanoWSD, Gson models, Room,
  ffmpeg-kit, ZXing, coroutines, manifest entry points.
- `minifyEnabled true` on the release build type; resource shrinking left off
  (the payload lives in `assets/`, which it does not touch).
- `app/lint.xml` + `lint { }` block. `abortOnError` and `checkReleaseBuilds` are
  **`false` on purpose**: lint has never been triaged end-to-end here.
- `.github/workflows/ci.yml`: web-asset syntax check, Node suites,
  `testDebugUnitTest`, `assembleDebug`, and a separate `assembleRelease` job.
- `docs/quality/play-readiness.md`: the honest Play assessment.

**Evidence tier for 3.4.** `assembleRelease` (R8 on) **compiled successfully** in
this environment — that proves the rules are syntactically valid and R8 completes;
it does **not** prove the shrunk app behaves identically at runtime. Lint has
**never been run**. CI has **never been executed**.
