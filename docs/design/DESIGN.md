---
name: Obsidian Telemetry
colors:
  surface: '#0e1321'
  surface-dim: '#0e1321'
  surface-bright: '#343948'
  surface-container-lowest: '#090e1c'
  surface-container-low: '#161b2a'
  surface-container: '#1a1f2e'
  surface-container-high: '#252a39'
  surface-container-highest: '#303444'
  on-surface: '#dee2f6'
  on-surface-variant: '#bac9cc'
  inverse-surface: '#dee2f6'
  inverse-on-surface: '#2b303f'
  outline: '#849396'
  outline-variant: '#3b494c'
  surface-tint: '#00daf3'
  primary: '#c3f5ff'
  on-primary: '#00363d'
  primary-container: '#00e5ff'
  on-primary-container: '#00626e'
  inverse-primary: '#006875'
  secondary: '#93ccff'
  on-secondary: '#003351'
  secondary-container: '#3198dc'
  on-secondary-container: '#002c47'
  tertiary: '#a8ffd2'
  on-tertiary: '#003824'
  tertiary-container: '#5be9ad'
  on-tertiary-container: '#006645'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#9cf0ff'
  primary-fixed-dim: '#00daf3'
  on-primary-fixed: '#001f24'
  on-primary-fixed-variant: '#004f58'
  secondary-fixed: '#cce5ff'
  secondary-fixed-dim: '#93ccff'
  on-secondary-fixed: '#001d31'
  on-secondary-fixed-variant: '#004b73'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0e1321'
  on-background: '#dee2f6'
  surface-variant: '#303444'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sm: 0.75rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-sm: 0.75rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

The design system is engineered for homelab operators, systems engineers, and self-hosters who demand the density of an enterprise telemetry dashboard inside the ergonomics of an Android application. The aesthetic fuses high-precision observability tools like Grafana and Docker with tactile, futuristic cyber-minimalism. 

Visual characteristics:
- **Atmospheric Depth:** Deep obsidian and cold abyssal slates ground the canvas, eliminating visual fatigue during low-light operation.
- **Luminous Precision:** Vibrant electric cyan acts as an active vector and signal beacon, contrasted against an organic emerald green for operational health and uptime.
- **Glassmorphic Instrumentation:** Cards function as semi-translucent HUD panels with refined backdrop blurs, calibrated specular micro-borders, and optical glow falloffs rather than generic drop shadows.
- **Tactile Technicality:** Monospace telemetry counters, micro-metric units, and sharp mechanical switches communicate immediacy and operational command.

## Colors

The palette establishes an ultra-dark visual hierarchy engineered for OLED battery conservation and high contrast readability:

- **Primary (`#00E5FF` - Electric Cyan):** Reserved for interactive states, focused states, primary action triggers, network input vectors, and critical activity highlights.
- **Secondary (`#0284C7` - Deep Cobalt Cyan):** Applied to secondary indicators, inactive telemetry tracks, structural outlines, and subdued data visualizations.
- **Tertiary (`#10B981` - Emerald Signal):** Strictly dedicated to operational health, online server daemons, verified ports, and nominal telemetry benchmarks.
- **Neutral Canvas (`#0A0F1D` - Void Slate):** The foundational backdrop. Surfaces step up sequentially through `#111827` (Card Surface Base) and `#1E293B` (Floating Dialogues / Action Drawers).
- **Functional Semantics:** Error states use `#EF4444` (Laser Red) with glow propagation; warnings utilize `#F59E0B` (Amber Protocol). All text layers fall into Primary Cold White (`#F8FAFC`), Muted Matrix (`#94A3B8`), and Dim Monospace (`#475569`).

## Typography

Typography establishes an uncompromising split between UI navigation and dynamic data readout:
- **Inter** commands titles, body copy, and UI controls with balanced geometric clarity, neutralizing density fatigue.
- **JetBrains Mono** governs server addresses (IP/CIDR), MAC identifiers, ports, ping latencies, container hashes, and micro-badges. 

All labels use uppercase transformations for `label-sm` with tabular lining figures enabled by default to prevent jitter during streaming telemetry updates.

## Layout & Spacing

The layout model optimizes high-density system status reporting on handheld vertical viewports while scaling gracefully to foldables and tablet landscape consoles:

- **Grid Architecture:** 4-column fluid layout on mobile viewports (< 600dp), expanding to an 8-column layout on medium surfaces (600dp–840dp) and a 12-column fixed dashboard layout on expanded screens (> 840dp).
- **Vertical Rhythm:** Strict 4px base increment system. Compact widgets (RAM, CPU, Swap) rely on `space-sm` internal padding, while macro cards (Docker container orchestrators, terminal emulators) scale to `space-md` or `space-lg`.
- **Safe Area Adaptations:** Full support for edge-to-edge Android gestures with `margin-sm` lateral padding on compact screens, scaling outward on tablets to preserve thumbs-down ergonomic reaches.

## Elevation & Depth

Visual depth is achieved through layered chromatic glassmorphism, surface translucency, and electromagnetic border radiance:

- **Base Layer (0dp):** Solid `#0A0F1D`.
- **Surface Layer 1 (Cards, Monitoring Cells):** `#111827` at 70% opacity with `backdrop-filter: blur(16px)` and a 1px border of `rgba(255, 255, 255, 0.08)`.
- **Active / Elevated Layer 2 (Focus Panels, Floating Drawers):** `#1E293B` at 85% opacity with `backdrop-filter: blur(24px)` and a 1px border of `rgba(0, 229, 255, 0.35)`.
- **Specular Glow System:** Crucial components avoid muddy black drop-shadows. Instead, glowing ambient halos are projected:
  - Cyan Active: `0 0 16px -2px rgba(0, 229, 255, 0.25)`
  - Healthy Node: `0 0 12px -2px rgba(16, 185, 129, 0.30)`
  - System Critical: `0 0 20px 0px rgba(239, 68, 68, 0.35)`

## Shapes

The geometric framework balances utilitarian hardware precision with modern industrial software design:

- Default components adopt `0.5rem` (8px) corner curvature, asserting architectural structure without feeling severe.
- Small indicators, metric capsules, and status pips use full pill curvature (`rounded-full`) to contrast against rectangular instrumentation cards.
- Inner nested elements strictly inherit smaller proportional radii (4px) to preserve concentric visual balance.

## Components

### Buttons & Interactive Controls
- **Primary Cyber-Trigger:** Background filled with `#00E5FF`, font set to Inter 600 with `#0A0F1D` black ink for peak optical contrast. Border is sharp 1px `#00E5FF` with a subtle cyan bloom on press.
- **Ghost Utility Button:** Transparent background, `rgba(255, 255, 255, 0.08)` border, muted text `#94A3B8`. Hover/press pulls border to `#00E5FF` with text shifting to pure `#F8FAFC`.

### Telemetry Badges & Chips
- Monospaced JetBrains Mono `label-sm` contained in low-opacity pill shells (`rgba(0, 229, 255, 0.1)`).
- Ping latency, port numbers, and socket protocols prepend a 6px circular LED indicator featuring an emerald pulse animation when packet throughput is live.

### Telemetry Cards & Widgets
- Built on translucent slate backing with 16px backdrop blur.
- Includes a dedicated header row with micro-label categorization, a live sparkline or progress gauge track (`rgba(255, 255, 255, 0.06)` background with `#00E5FF` fill), and real-time numeric readouts aligned right.

### Toggle Switches & Server Relays
- Custom mechanical pill switch (44px x 24px track). 
- Inactive: `#1E293B` track with `#475569` recessed thumb.
- Active (Daemon running): `#00E5FF` track fill with white thumb and outward radial bloom.

### Form Inputs & Terminal Fields
- Integrated single-line command prompts and port fields.
- Monospace input text with dark obsidian background (`#070B14`), styled with an inset shadow and zero-spread border that blooms electric cyan upon keyboard focus.