# Prompt: LocalHub web UI redesign

> Neeche ka pura block copy kar ke kisi bhi AI (ChatGPT / Claude / v0 / Gemini) ko de do.
> Isme project context, design direction, technical constraints aur "definition of done"
> sab likha hai — bina ye context diye woh aisi UI dega jo yahan chalegi nahi.

---

## ⬇️ COPY FROM HERE

You are redesigning the **web UI of LocalHub**, an open-source Android app that turns a
phone into a **local HTTP/WebSocket file server**. The UI you are designing is **not** the
Android app — it is the **bundled web dashboard** that the phone serves over Wi-Fi to any
browser (mostly a **PC browser**, sometimes a **mobile browser**).

Work from the repo: `https://github.com/lastergamer8228-spec/LocalHub`
Read `HANDOFF.md` in the repo root first — it maps every file and lists the things that
must not be renamed.

### 1. What the product is

- One Android device runs NanoHTTPD + NanoWSD (Kotlin). It serves files, streams media,
  hosts an offline rule-based AI assistant, and exposes system telemetry.
- Users connect from the same Wi-Fi: `http://192.168.x.x:8080`.
- Two roles: **admin** (owner, full control) and **user** (family/friends, restricted).
- Everything is **offline**. No CDNs, no web fonts, no external images, no internet.

### 2. Pages (all of them — this is a whole-site redesign, not one page)

| Route | File | What it does | Priority |
|---|---|---|---|
| `/` | `dashboard/index.html` | Server status, connect/QR, telemetry, modules, devices, logs | **1 — highest** |
| `/files` | `dashboard/files.html` | File manager: browse, upload, download, delete, play | **2** |
| `/player` | `dashboard/player.html` | Video/audio player with a "cinema" layout | 3 |
| `/ai` | `ai/index.html` | Offline assistant chat (tabs: chat/memory/tasks/knowledge…) | 4 |
| `/login.html` | `dashboard/login.html` | Login | 5 |
| `/core` | `dashboard/core.html` | Live canvas "System Core" visualisation (keep, restyle) | low |
| `/selfheal` | `dashboard/selfheal.html` | Health & repair | low |

File sizes so you can plan: `index.html` 180 lines · `files.html` 1076 · `player.html` 1412 ·
`ai/index.html` 249 · `theme-pro.css` 507 · `style.css` 265 · `nav.js` 117.

### 3. Design direction (already agreed — do not re-litigate)

**Professional NAS console.** Think Synology DSM / TrueNAS / Unraid / Proxmox — dense but
sharp and calm. Not a "crypto dashboard", not neon, not glassmorphism.

- Opaque slate surfaces (`#0c1015` → `#1b242f`), **hairline 1px borders** (`#1f2b3a`),
  **no gradients, no glow, no drop shadows, no blur**.
- One restrained accent (blue `#4c9aff` family). Semantic colours only for state:
  success `#34d399`, warning `#f0b429`, danger `#f87171`.
- One radius (6px), one spacing scale (12px gutter), max content width ~1320px.
- Type: 13px base, **uppercase 10–11px labels with letter-spacing**, values in a
  **monospace** font. This "console" typography is a big part of the premium feel.
- **Top navigation bar** (48px, sticky) shared by every page:
  Dashboard · Files · Assistant · Player · Core(admin) · Health(admin) + live connection
  status + role badge + sign out. Active page highlighted.
- **Real visual hierarchy**: page head → primary card → supporting card → collapsed
  (`<details>`) card. Not 14 equal-weight cards stacked.
- **No emoji in UI chrome.** Icons as inline SVG or simple glyphs, or no icons at all.
- One button system: primary / secondary / danger / ghost, 30px tall, consistent.

### 4. What is wrong with the current UI (do not repeat these)

1. **No hierarchy** — 14 cards with identical weight and padding.
2. **Clutter** — 7 status pills, a live ticker, quick-action chips, dev tools, all visible.
3. **Decorative-first** — an aurora background and a 60vh holographic canvas above the fold.
4. **Cheap feel** — emoji-labelled chips (`↻ Restart`, `🧹 Clear Cache`) as primary controls.
5. **Inconsistent** — every page has its own header, spacing and button style.

### 5. Hard technical constraints (violating these breaks the app)

- **Plain HTML/CSS/JS only.** No React/Vue/Tailwind, no build step, no npm, no CDN, no
  Google Fonts. It runs from the phone, offline.
- **`theme-pro.css` is loaded after `style.css`** and is the single source of truth for
  look. Put your tokens in `:root` at the top of `theme-pro.css`.
- **Do NOT rename or remove these** — the dashboard JS (`app.js`) and the role system
  depend on them:
  - IDs: `ws-status`, `role-badge`, `logout-btn`, `connect-body`, `status-banner`,
    `devices`, `device-policy`, `modules`, `device`, `logs`, `user-media`, `user-files`,
    `user-quick`, `core-embed`, `server-control-card`, `ctrl-row`, `sb-*` (metrics),
    `tm-*` (transfer monitor), `activity-body`, `endpoints`
  - Classes that control permissions: **`.admin-only`**, **`.user-only`**, **`.dev-only`**
    (toggled by `applyRole()`) — never repurpose them for styling.
  - `data-cmd` attributes on server-control buttons, `data-dev-block` / `data-dev-ro` /
    `data-dev-deny` on device rows, `data-filter` on log filters.
- **New CSS/JS files must be routable.** `AssetServer.kt` maps URLs → bundled assets. A
  root-level file with a normal extension (`.css`, `.js`, `.png`, `.svg`, …) is served
  from `dashboard/` automatically; anything else needs an explicit route. Safest: put new
  files in `dashboard/` and reference them as `/dashboard/<file>`.
- Must work at **360px, 768px and 1440px** wide.
- Must stay usable while the phone screen is off (server runs in a background service).

### 6. Deliverable format

For each file you change, output:

1. The **full path** (e.g. `app/src/main/assets/dashboard/index.html`)
2. The **complete new file contents** — not fragments, not "…rest unchanged"
3. A one-line note on what changed and why

If a file is huge (`player.html`, `files.html`), you may give **precise unified diffs**
instead of the whole file, but every hunk must apply cleanly.

Also give:
- A short **design-token table** (colour / spacing / radius / type) you used
- A **before → after** bullet list per page
- Anything you deliberately did **not** change, and why

### 7. Definition of done

- [ ] Dashboard reads as a console: clear page head, ≤4 KPI metrics, obvious primary action
- [ ] Nothing decorative above the fold; the hologram lives in a collapsed section
- [ ] Every page uses the shared top nav; no page has its own ad-hoc header bar
- [ ] All buttons come from one system; no emoji in controls
- [ ] Correct at 360 / 768 / 1440px
- [ ] Visible focus states, sufficient contrast, usable with keyboard
- [ ] No external network requests (verify: zero `http://`/`https://` in CSS/HTML except
      the app's own URLs)
- [ ] All IDs/classes from §5 still present
- [ ] `python3 tests/check_asset_routes.py` passes (every referenced asset resolves)
- [ ] You state honestly which parts you could not verify (e.g. "not rendered in a browser")

### 8. Be honest

If you cannot verify something (you have no browser, or the change is too large to be
confident), **say so explicitly** rather than claiming it works. I would rather get a
partial redesign I can trust than a full redesign that breaks the app.

## ⬆️ COPY TILL HERE

---

## Extra (optional) — agar ek hi page karwana ho

```
Pehle SIRF `app/src/main/assets/dashboard/index.html` + `dashboard/theme-pro.css` redo karo.
Baaki pages ko chhodo. Poora file content do, koi fragment nahi.
```

## Extra (optional) — agar sirf CSS chahiye, markup nahi

```
Sirf `dashboard/theme-pro.css` rewrite karo. Existing HTML markup ko NAHI chhuna.
CSS variables, cards, buttons, tables, list rows, nav bar sab restyle karo,
par koi bhi class name mat hatana.
```
