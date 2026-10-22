# LocalHub Assistant Behavior Report (v2.22.x)

> Generated 2026-08-10. Fixes the two CRITICAL real-world behaviors. No new Brain,
> no new engine — fixes to the EXISTING Assistant integration.

## Issue #1 — Generic explanation template on normal conversation
**Problem:** `comm.js` `polish()` → `deepen()` automatically wrapped ANY short
single-line reply in the "Great question — let me explain properly / Here's what
this really means / The core idea / Why it matters / A practical example / Want me
to go deeper" template. So "hello", "how are you", "thanks" all became educational
essays.

**Fix:**
- `deepen()` is now opt-in: it only runs when `polish(msg, { explain: true })`.
- `brain.js` sets `explain: true` ONLY when the user text is an explicit
  explanation request (explain/define/what is/what does X mean/how does X work/
  tell me about/difference between/how to/in detail/teach me/describe/elaborate).
- Added a conversational guard so even if deepen were reached, greetings/thanks/
  status replies are never essay-wrapped.

**Result:**
- "hello" → natural greeting (e.g. "Hello! I'm your LocalHub OS assistant…").
- "how are you" → "I'm running great — all systems online. How can I help?"
- "thanks" → "Anytime."
- "What is a video?" / "Explain X" → still the structured explanation.

## Issue #2 — Fake action success
**Problem:** "play evil dead burn video" replied "Playing Evil Dead Burn 2026…"
but nothing actually played.

**Fix:**
- `openPlayer()` no longer claims verified playback. It returns
  `status: "PLAYBACK_REQUESTED"` and message "▶️ Starting <name> in the player…".
- The player page now **auto-plays** when opened directly for a file
  (`?file=...`), via `loadedmetadata` → `play()`.
- If no file matches → honest "I couldn't find a matching video…" (`played:false`).
- The assistant never says "Playing X" as a verified fact it cannot observe;
  it reports the honest intermediate state (playback requested / player opening).

## Verification (headless)
13/13 new behavior tests pass; full suite **475/475** (462 baseline preserved).

## Honest status
- **HEADLESS_VERIFIED:** ✅ 475/475.
- **DEVICE_VERIFIED / LIVE_QA_VERIFIED:** ❌ NOT claimed — the exact commands
  ("hello", "how are you", "play evil dead burn video", "pause", etc.) must be
  run on the real device (`http://192.168.0.108:8080` /ai). Not faked here.
- **MODEL_DEPENDENT:** none — fully deterministic.
