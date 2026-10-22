# LocalHub Assistant Action Integration Report (v2.22.x)

> Generated 2026-08-10. The REAL routing bug is fixed. 43 new action tests pass;
> full suite **462/462** (419 baseline preserved).

## Status
- **HEADLESS_VERIFIED:** ✅ 462/462.
- **DEVICE_VERIFIED / LIVE_QA_VERIFIED:** ❌ NOT claimed — the exact command
  `"Play the evil dead burn video"` must be tested on the real device
  (`http://192.168.0.108:8080`) as required. Not faked here.
- **MODEL_DEPENDENT:** this fix is fully deterministic; no model dependency.

## The fix (integration, not a new system)
Added `action_routing.js` (intent→capability router) and wired it into `intent.js`
BEFORE the knowledge/Mind fallback. Uses existing Commands/Capabilities/Context/
MediaBridge/FS. No new Brain, no new memory, no new routine engine, no new
SelfHeal engine.

## Verification — real command behavior (headless, mock FS with media files)
| Real user command | Expected | Verified |
|-------------------|----------|----------|
| "Play the evil dead burn video" | MEDIA_PLAY + find file + open player | ✅ (finds "The Evil Dead - Burn.mp4", not educational answer) |
| "Pause it" | MEDIA_PAUSE (transport) | ✅ |
| "Resume" | MEDIA_RESUME | ✅ |
| "Show my videos" | MEDIA_LIST | ✅ |
| "Find evil dead" | MEDIA_SEARCH | ✅ |
| "Play the second one" | ordinal from previous search context | ✅ |
| "What is a video?" | INFORMATION (normal response) | ✅ (NOT routed as action) |
| "Tell me about The Evil Dead" | INFORMATION, NOT playback | ✅ |
| "Play The Evil Dead and tell me the filename" | action + metadata | ✅ |
| Unknown action ("send an email") | honest unsupported (falls through) | ✅ |

## Fuzzy matching proven
`"evil dead burn"` → `"The Evil Dead - Burn.mp4"` (score 1.0, clear best) and
`"Evil Dead Rise.mkv"` (0.67) — relative threshold picks the clear best.

## Bugs found & fixed during testing
1. `MEDIA_SEARCH` detection regex was broken (used a media-extension check on the
   whole sentence).
2. `searchMedia` relied on contiguous substring → token-based fallback added so
   "the evil dead burn" finds "The Evil Dead - Burn.mp4".
3. Ambiguity fired too eagerly → relative threshold (best − second ≥ 0.2).
4. `capabilityFor` compared against `action` but was passed the capability `name`
   → now matches either.
5. `MB.send` used the accessor function, not the MediaBridge object → `MB().send`.

## Honest device status
The exact acceptance command must be run on the real device Assistant UI. This is
the only remaining step to move from HEADLESS_VERIFIED to DEVICE_VERIFIED for this
fix. Not claimed here.
