# LocalHub Assistant Intent Routing (v2.22.x)

> Status: ✅ IMPLEMENTED (headless-tested). Fixes the real bug where "Play the
> evil dead burn video" was answered as an educational "what is a video?" topic.

## The bug
Natural language like `"Play the evil dead burn video"` was not matching any
existing command, so it fell through to the knowledge/Mind engine and returned a
generic explanation of "video". Wrong — the user wanted a LocalHub media action.

## The fix
A thin, deterministic **intent-to-capability routing layer** (`action_routing.js`)
is inserted into `intent.js` BEFORE the Mind fallback. It is NOT a new Brain, NOT
a new memory engine, NOT a new capability system — it routes to capabilities that
already exist.

## Pipeline
```
INTENT CLASSIFY -> ACTION-FIRST -> CAPABILITY -> ENTITY EXTRACT ->
FUZZY MATCH -> PERMISSION/RISK -> EXECUTE -> VERIFY -> RESPOND
```

## Components
1. **Intent classification** — ACTION / QUERY / INFORMATION / CONVERSATION /
   MIXED. Explicit info phrases ("what is a video", "tell me about X") always win
   and are NOT routed as actions.
2. **Action-first rule** — if the user asks LocalHub to do something
   (play/open/find/show/start/pause/resume/etc.), evaluate against LocalHub
   capabilities BEFORE the generic knowledge answer.
3. **Capability registry** — authoritative list of capabilities that actually
   exist (MEDIA_PLAY, MEDIA_PAUSE, MEDIA_RESUME, MEDIA_STOP, MEDIA_SEARCH,
   MEDIA_LIST, FILE_SEARCH, FILE_OPEN, FILE_MOVE, FILE_DELETE, SERVER_STATUS,
   CLIENT_LIST...). No invented capabilities. Risk/permission/confirmation are
   declared (FILE_DELETE = high + admin).
4. **Entity extraction** — pulls the media title/query and type out of a command;
   does not send the whole sentence to the media engine.
5. **Fuzzy matching** — normalizes (case/punctuation/articles), token overlap,
   partial match. `"evil dead burn"` matches `"The Evil Dead - Burn.mp4"`. Uses a
   relative threshold so a clear best wins and near-ties become ambiguity.
6. **Ambiguity** — multiple close matches → asks which one, does not randomly
   choose.
7. **No match** — honest "I couldn't find a matching video" — never hallucinates
   playback.
8. **Conversational context** — "pause it"/"resume" → transport; "play the second
   one" → previous search context (ordinal); "play it again" → current media.
9. **Transport** — pause/resume/stop/toggle via the existing MediaBridge; play
   opens the existing player page.
10. **Verification** — does not claim success unless the underlying capability
    reports it (e.g. opens the player; transport sent).

## Safety
- Risk/permission checks are preserved (FILE_DELETE high+admin, FILE_MOVE
  medium+admin). Natural-language interpretation never bypasses permissions,
  risk, approval, or Self-Healing policy.
- Unknown/unmappable requests return `null` so the normal pipeline continues —
  never an invented action.

## Diagnostics
`ActionRouting.getLastRoute()` + `diagnostics()` expose structured intent
(INPUT/INTENT/CAPABILITY/QUERY/MATCH/RESULT) for admin — no hidden chain-of-thought.

## Integration point
`intent.js` `process()` calls `ActionRouting.route()` after self-awareness/planning
and before `detectIntent`. On a non-null action result it returns that; otherwise
it falls through to the original pipeline.
