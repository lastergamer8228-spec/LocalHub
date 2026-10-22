# LocalHub Assistant Action Verification Report (v2.22.x)

> Generated 2026-08-10. Documents how the assistant verifies (and honestly
> reports) every actionable command — no hallucinated success.

## Mandatory action pipeline
```
USER REQUEST -> INTENT -> CAPABILITY -> PARAMETERS -> EXECUTE REAL ACTION ->
VERIFY RESULT -> RESPOND
```

## Structured result statuses
Every action result now carries an honest internal status:
- `SUCCESS` — the real capability executed successfully.
- `FAILED` — the operation ran but failed.
- `NOT_FOUND` — no matching target (e.g. no matching video/file).
- `NOT_EXECUTED` — the operation was not attempted.
- `DENIED` — permission/approval blocked it.
- `AMBIGUOUS` — multiple matches; asked the user.

FAILED / NOT_FOUND / NOT_EXECUTED / DENIED are never phrased as SUCCESS.

## Media-specific verification (Issue #2)
| Step | Behavior |
|------|----------|
| Detect MEDIA_PLAY | `action_routing` classifies the command as a media action |
| Extract query | "evil dead burn" extracted from the sentence |
| Search media | existing FS.search + fuzzy token matching |
| Find file | best match (or ambiguity → ask) |
| Invoke player | open existing `/player?file=...` page |
| Start playback | player auto-plays on `loadedmetadata`; MediaBridge "play" sent |
| Verify | the assistant reports `PLAYBACK_REQUESTED` (honest intermediate) |
| Respond | "▶️ Starting <name> in the player…" — NOT a verified "Playing X" |

Because actual audio/video state is owned by the player tab, the assistant does
**not** claim verified playback it cannot observe. It reports that playback was
started/requested. On a real device this can be visually confirmed.

## No-match / failure (honest)
- No file → "I couldn't find a matching video in your LocalHub media."
- Search unavailable → "Media search is unavailable right now."
- Playback not started → never says "Playing"; stays at "Starting…"/"Opening…".

## Transport commands
`pause` / `resume` / `stop` / `toggle` send the existing MediaBridge command and
report the transport was issued — not fabricated playback state.

## Verification (headless)
- MEDIA_PLAY → `PLAYBACK_REQUESTED`, honest "Starting…" (behavior test 4).
- No-match → `ok:false`, honest message, `played:false` (behavior test 5).
- Info question "What is a video?" → not treated as action (behavior test 6).
- Full suite **475/475**.

## Honest status
- **HEADLESS_VERIFIED:** ✅.
- **DEVICE_VERIFIED / LIVE_QA_VERIFIED:** ❌ NOT claimed — actual playback must be
  visually confirmed on the real device. Not faked here.
