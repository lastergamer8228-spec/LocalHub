# LocalHub Media Playback RCA (v2.22.x)

> Generated 2026-08-10. Root-cause analysis of "the assistant says 'Starting…' but
> the video does not play." No new player, no new Brain — fixes to the EXISTING
> media pipeline.

## Trace of the pipeline (each stage)
| Stage | Implementation | Status |
|-------|----------------|--------|
| USER intent | "play evil dead burn" | ✅ ACTION classified, MEDIA_PLAY |
| media/file search | `FS.search` + fuzzy token match | ✅ found "Evil Dead Burn 2026 … .mkv" |
| player invocation | `openFM: "/player?file=..."` → `window.location.href` | ✅ navigates to /player |
| media URL | player sets `media.src = "/api/fs/content?path=..."` | ✅ server streams it |
| server | `serveContent` → MIME (`video/x-matroska` for mkv) + Range 206 + Accept-Ranges | ✅ correct |
| media element | `<video id="media" playsinline>` | ✅ |
| load/play | `media.play()` on loadedmetadata | ⚠️ **blocked by autoplay policy** |
| PLAYING state | `playing` event | ❌ not reached |
| UI verification | player reports state | ❌ was NOT reported back |

## Root cause
Two real, independent causes — **neither is the assistant's wording**:

### Cause 1 — Autoplay policy (primary, affects ALL formats)
`action_routing` navigates to `/player?file=...`. After navigation there is **no
user gesture**, so the browser rejects `media.play()` with `NotAllowedError`. The
previous code swallowed that rejection silently, so the video stayed paused with
no indication, while the assistant message said "Starting…" (an honest *request*,
but the user experienced "not playing").

### Cause 2 — MKV / codec support (specific to this file)
The matched file is `…WEBRip… .mkv`. The player sets `video/src` and relies on the
browser to decode the container/codecs. The existing `error` handler only showed a
toast ("Could not play this file (codec not supported)") and reported nothing
back. If the browser can't decode the MKV's video/audio codecs, playback cannot
start regardless of autoplay.

## The failing layer
The **player page** (`dashboard/player.html`): it neither handled the autoplay
rejection honestly nor reported its real media state back to the assistant. There
was **no verification channel** — the assistant could not know whether playback
actually started.

## Fix
1. **Player reports real state** through a new localStorage channel
   (`lhmedia_status`): LOADING / LOADED / PLAYING / PAUSED / AUTOPLAY_BLOCKED /
   UNSUPPORTED_FORMAT / PLAYBACK_ERROR, with currentTime, readyState, networkState,
   error code, src.
2. **Honest autoplay:** on `loadedmetadata`, attempt `play()`; on `NotAllowedError`
   report AUTOPLAY_BLOCKED and reveal the big ▶ Play button (a real tap = a user
   gesture, so playback can then start within policy).
3. **Codec/container probe:** before autoplay, `video.canPlayType(mime)` for the
   file's extension; if unsupported, report UNSUPPORTED_FORMAT and show the big
   Play button instead of pretending.
4. **Assistant verification** (`ActionRouting.verifyPlayback`): maps the real
   player state to a single source of truth — PLAYBACK_VERIFIED only when state is
   PLAYING; otherwise UNSUPPORTED_FORMAT / AUTOPLAY_BLOCKED / PLAYBACK_ERROR /
   PAUSED / LOADING / NOT_EXECUTED.
5. **"not playing" diagnostic** (`ActionRouting.diagnoseNotPlaying` + wired into
   `intent.js`): when the user says "not playing" (right after a media action), the
   assistant reads the real state and responds honestly ("the browser can't decode
   this MKV" / "autoplay blocked — tap Play" / "playback error"), NEVER a generic
   educational explanation.

## Regression tests
21 new media-verification tests pass; full suite **496/496** (475 baseline preserved).

## Real-device result
**NOT yet verified.** This requires a real Android device at
`http://192.168.0.108:8080`: open `/ai`, run "play evil dead burn", and visually
confirm (a) the player opens, (b) the file loads, (c) playback starts (currentTime
advances) OR the player shows the "tap Play" prompt / an honest unsupported-format
message. Not faked here.
