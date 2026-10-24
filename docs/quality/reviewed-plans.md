# Reviewed planner and evidence pilot — 1.0.8 (code 9)

This extends the assistant/brain checkpoint, not a promotion to launch-ready.
Frozen Cognitive/Personal Brain/Self-Healing sources remain unchanged.

## What changed

### Strict sequential planner

`TaskPlanner.execute` accepts only explicitly reviewed registered plans with the
same serialized steps as their canonical template. It copies/freezes steps so
external edits cannot insert later operations during execution.

- Only read, prepare and navigation effects are supported in this pilot.
- Unreviewed, altered, missing, oversized or mutating plans stop before dispatch.
- Every step must return ok:true and an effect-compatible typed result.
- Missing result, ok:false, rejection, thrown error, unknown evidence or a false
  COMPLETED claim stops the sequence; completed cannot be true when ok is false.
- No automatic step retries. Default async step deadline is 20s, capped at 30s.
  A timer is not hard CPU preemption for synchronous JavaScript.
- Navigation stops the sequence with REQUESTED_UNVERIFIED; opening a page does
  not establish playback. No dependent page work runs on that assumption.
- Cancel stops subsequent steps and aborts pending reads in the reviewed adapter.
  It cannot undo a request already sent. Overlapping chat actions are blocked
  while a reviewed workflow is active.

The old Intent plan implementation was removed: it picked the first search hit,
continued failed file operations, returned success for unknown steps and used log
export as a substitute for a requested download. Direct Intent calls now use the
same reviewed adapter rather than bypassing main-chat quarantine.

### One reviewed read-only workflow

Say **play newest modified video in downloads**, or use the quick chip.

1. Check live media/file-module availability.
2. Read Downloads listing.
3. Sort validated video entries by modification timestamp.
4. Reject ties, missing/future timestamps, empty files, path/name mismatch or
   paths outside the direct Downloads children. Do not choose arbitrarily.
5. Re-read selected file metadata and require the same name/path/size/mtime.
6. Recheck access/session before returning the player URL.

Only the final successful navigation-request result carries openFM. Failed or
cancelled steps cannot leak an earlier navigation instruction. This checks file
metadata, not a content hash or a locked filesystem snapshot. The file can still
change after inspection; playback remains explicitly unverified.

**Modification time is not download chronology.** “Play my last downloaded movie”
continues to ask for clarification/propose the explicit modification-time command.
It is not silently reinterpreted as a verified latest download.

Organize Downloads, archive/download-and-open, restart-then-logs and chat file
mutations remain under review. The approved workflow performs GETs, not POSTs.

### Observable restart outcome

After current-session admin confirmation:
- Optionally obtain baseline current status (1s read budget).
- Send exactly one restart POST; require explicit backend acknowledgement.
- When baseline is valid, perform at most three bounded status GETs (1s each,
  200ms between checks). These are safe observation reads, not mutation retries.
- Only a running listener on the same port with a strictly later valid startedAt
  marker produces VERIFIED. Wording is “Observed a new listener start after the
  request”, not proof of a request ID or every client reconnecting.
- Same/earlier marker, wrong port, malformed/unreachable status or session change
  leaves ACKNOWLEDGED with completion unverified.
- Lost POST response is UNVERIFIED, never automatically resent.
- Stop/start acknowledgement is not inferred as completed from a disconnect.

No new model, confidence percentage, deletion verifier or universal reasoning
capability is claimed. Legacy direct Cognitive tool paths still need review;
their old retry/verification behaviour is NOT globally fixed by this pilot.

## Evidence

- 50 new Node planner/evidence/runtime scenarios, real JS modules with mocked HTTP.
- 74 prior runtime cases retained; assertions now distinguish safe GET verification
  reads from the single mutation POST.
- Actual Chromium chat with mocked endpoints checks explanation, confirmation,
  acknowledged vs observed restart, correct newest-modified player URL and cancel
  of a held listing read without navigation/mutation.
- Existing player bridge, memory migration and layout fixtures retained.
- Existing 542 engine assertions, command-library fingerprints, source contracts
  and 11 JVM tests retained. All are evidence only at their stated test tier.
- No real Android restart, file listing or movie playback was exercised here.

## Device acceptance for this gate

1. Update preview; restart server, sign in and reload the assistant.
2. Have two videos in Downloads with different real modification times. Run the
   explicit newest-modified command and check the selected file manually.
3. Use a tie/permission denial/module OFF; no unintended player should open.
4. Cancel while listing/verification is in progress; no later navigation should
   occur. Do not interpret cancellation as rollback of already-sent work.
5. Confirm restart: compare controller listener state with assistant's report.
   Force a bind failure/disconnect; it must not claim verification from silence.
6. Confirm that stop remains acknowledged/unverified rather than falsely complete.

Next promotion needs authoritative per-operation mutation receipts, exact-target
confirmation/idempotence and filesystem containment/permission hardening before
file-changing workflows can be re-enabled. Memory ownership/continuity is still
an independent unresolved gate.
