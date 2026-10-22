# LocalHub Attention System (v2.20)

> Status: ✅ IMPLEMENTED (headless-tested)

## Purpose
Not every event deserves equal processing. The Brain assigns attention and
processes important events before trivial ones — without a constantly running
expensive loop.

## Levels
- **LOW** — file opened, file listed, media listed.
- **NORMAL** — backup completed, media started/finished.
- **IMPORTANT** — backup failed (repeated), server/auth/database error, goal
  completed, device connected/disconnected, security/warning.
- **URGENT** — storage/battery critically low, out of space, critical.

## Attention loop
```
EVENT -> IMPORTANCE -> CURRENT FOCUS -> RELEVANCE -> DECISION
        -> IGNORE / REMEMBER / ACT / NOTIFY
```
- URGENT → NOTIFY
- IMPORTANT/NORMAL → REMEMBER
- LOW → IGNORE (unless it matches the current focus, which elevates it to REMEMBER)

## Focus
`setFocus/getFocus` maintain a current focus (e.g. "media library"). Events that
match the focus are promoted so relevant context is kept and irrelevant noise
doesn't dominate.

## Performance
Event-driven and bounded — no continuous scan of the memory database.
