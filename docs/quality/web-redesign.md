# Web redesign 2026-10-23 — "Pro Console" (1.0.19, code 20)

**User feedback:** *"jo webpage hai wo bahut hi basic plus generic sa hai aur feel
bhi kaafi cheap hai, button placements bhi not so good, aur unwanted cheezein
bhar bhar ke hain."*

**Agreed direction (asked, not assumed):** whole website · professional NAS-console
look (Synology/TrueNAS family: dense, sharp, hairline borders) · **top nav** ·
de-cluttering decided by me.

---

## What was wrong

The dashboard shipped **14 cards, 18 buttons, 7 status pills** and a decorative
aurora on one page, all with equal visual weight. No hierarchy → everything looked
generic; stacked equal-weight cards read as "cheap"; emoji-labelled chips read as
buttons of no consequence.

## What changed

### 1. One shared shell (`dashboard/nav.js`)

A single top navigation injected into `id="lh-nav"` on **every** page:
Dashboard · Files · Assistant · Player · Core (admin) · Health (admin), plus live
connection status, role badge and sign out. Active page is highlighted.

Contract kept: the bar supplies `#ws-status`, `#role-badge` and `#logout-btn`, the
exact IDs `app.js` already writes to. Admin-only links carry `class="admin-only"`,
so the existing `applyRole()` gating controls them with no extra code —
permissions did not change.

### 2. One design system (`dashboard/theme-pro.css`)

Loaded after `style.css` on every page (index, files, player, ai, login).

- **Palette:** opaque slate surfaces (`#0c1015` → `#1b242f`), hairline borders
  `#1f2b3a`, one restrained accent `#4c9aff`. No gradients, no glow.
- **Geometry:** single 6 px radius, 12 px gutter, 48 px nav, 1320 px max width.
- **Type:** 13 px base, uppercase 10–11 px labels, monospaced numeric values.
- **Buttons:** one system — `.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`,
  30 px tall, no emoji.
- **Removed:** the aurora background layer, the glow filters, the oversized
  hologram scan effects.

### 3. Dashboard restructured (`dashboard/index.html`)

| Before | After |
|---|---|
| 7 status pills (Name/IP/Port/Version/Uptime/Restarts/State) | **4 metrics**: Server · Uptime · Clients · Version; the rest collapse into one address line under Connect |
| System Core hologram occupying 60 vh above the fold | kept, but **collapsed** (`<details>`) under "System Core — live visualisation" |
| Live activity ticker | removed (decorative; `visuals.js` already guards for a missing host) |
| Server control as emoji chips | real buttons, Restart / Stop / Backup / Restore / Clear cache |
| Devices, Modules, Device, Logs, API explorer all expanded | Devices + Modules stay; **Access logs collapsed**; dev tools stay hidden |
| User sections scattered | grouped: Quick actions → Continue watching → Your folders |

Every `app.js` element ID was preserved (there is a test that fails if one is
removed), and `#sb-clients` is now fed by `renderDevices()` so the Clients metric
is real rather than decorative.

### 4. Two stale contract assertions fixed

`tests/check_controller_contracts.py` had been failing since the v1.0.15 refactor:
it looked for the literal strings `server = buildServer(initialPort())` and
`refusing plaintext fallback`, which no longer exist. **The behaviour was correct
in both cases** (the transport is rebuilt via `server = buildServer(port)`;
`applyTls()` throws instead of serving plaintext). The assertions were updated to
match the current, correct code — 29 contracts pass again.

## Evidence tiers

| Claim | Tier |
|---|---|
| nav.js builds the bar, marks the active page, keeps app.js's IDs, gates admin links | **Verified** — `tests/test_web_shell.js`, 8 scenarios, mocked DOM |
| Theme + nav are linked on every page; login has no nav | **Verified** — same suite |
| Dashboard still exposes every ID app.js touches | **Verified** — same suite (regression guard) |
| APK builds, 85 assets, unchanged signing cert | **Verified** — build + apksigner |
| **How it actually looks** | **NOT verified** — no browser in this environment. The user must open it. |
| Files / Player / AI pages restyled | **Partially** — they get the shared nav + theme; their own inner layouts were deliberately left alone to avoid breaking upload/playback wiring. |

## Known trade-offs

- Files, Player and AI pages keep their own inner markup; they now match the shell
  but have not been individually re-laid-out. Say the word and I will do each one.
- The old `style.css` is still loaded (before the new theme) because several pages
  rely on classes not yet migrated. The theme overrides it; it is not dead code yet.
