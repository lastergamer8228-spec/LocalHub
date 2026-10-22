# LocalHub Personalization (v2.20)

> Status: ✅ IMPLEMENTED (headless-tested)

## Principle
The Assistant's communication adapts to **established** user preferences.
Personality remains separate from intelligence.

## What adapts
- **Communication style**: short / detailed / default — from the
  communication preference category.
- **UI / media / workflow / device / automation / capabilities** preferences are
  stored in the non-sensitive personal profile.

## How
- `setProfile(category, key, value)` records a preference (same-key changes
  supersede the old one).
- `getProfile()` returns the active profile.
- `personalize(text)` shortens a long reply when the user's style is "short".
- Explicit commands: `remember this`, `remember preference`, `show my
  preferences`, `correct that memory`, `forget that`, `disable/enable memory`.

## Honesty
- No personality assumptions from weak evidence.
- No sensitive attributes inferred or stored.
- No fake human behaviour — preferences and style are computational constructs.
