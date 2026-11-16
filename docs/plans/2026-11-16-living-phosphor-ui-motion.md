---
title: Living Phosphor UI Motion System
status: implemented
created_at: 2026-11-16T20:10:59Z
implemented_at: 2026-11-16T20:25:00Z
---

# Living Phosphor UI Motion System

Bring cohesive, hardware-authentic CRT phosphor life across the entire application through custom CSS/SVG kinetic micro-animations—featuring a traveling oscilloscope pulse on Sync, a vertically scrolling directory tree on Catalog, precision clock/servo motion on Schedule and Operations, and tasteful ambient-plus-interactive phosphor effects across status panels, progress beams, telemetry charts, and terminal logs—governed by **Off / Low / Medium / High** presets inside the **CRT Display** studio.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core behavior and defaults were confirmed during discovery and govern this plan:
> - **Default Motion Level**: Enabled at **Low** by default on first load (refined ambient life on active indicators paired with crisp hover and active-run animations).
> - **Preset Control Placement**: Integrated directly inside the left-sidebar **CRT Display** studio as a 4-way **Living UI** selector (`Off` · `Low` · `Med` · `High`), persisted automatically alongside display settings.
> - **Motion Balance**: Subtle, non-distracting ambient motion at rest that comes alive on hover, focus, and active sync/transfer operations—scaling progressively across `Low`, `Medium`, and `High`, and shutting off completely on `Off` or when OS `prefers-reduced-motion` is enabled.

---

### 1. Overview & Core Concept

- **What It Does**: Introduces a unified CSS and inline-SVG kinetic layer across navigation, primary sync controls, live transfer strips, KPI counters, telemetry graphs, and console headers—all tinted and bloom-scaled in real time by the active CRT Phosphor Palette (`Green`, `Amber`, `Cyan`) and `Gauss Glow` intensity.
- **Target Audience**: Retro-hardware enthusiasts and self-hosted operators who want their sync console to feel like a living cathode-ray broadcast instrument without sacrificing readability or CPU efficiency.
- **Key Value**: Elevates the interface from static vector icons to tactile, breathing CRT instrumentation while keeping full user control (`Off / Low / Medium / High`) one click away.

---

### 2. User Experience & Visual Design

#### Custom Kinetic Navigation Icons (Sidebar & Mobile Switcher)
Each primary navigation item receives a bespoke inline SVG micro-scene clipped cleanly within its `16×16` icon frame, illuminated by dynamic CRT phosphor `drop-shadow` bloom:
1. **Sync (Traveling Oscilloscope Pulse)**: A dim baseline ECG track sits behind a bright phosphor electron trace (`stroke-dashoffset`) that sweeps smoothly from left to right across the waveform, leaving a soft phosphor afterglow tail.
2. **Catalog (Scrolling Directory Tree)**: A miniature 2-level file tree scrolls seamlessly vertically inside a masked `16×16` window, evoking a live terminal directory listing scanning through ROM folders.
3. **Schedule (Precision Sweeping Chronometer)**: A crisp dial whose minute hand sweeps continuously while the hour hand holds steady, accelerating smoothly on hover or when viewing Schedule.
4. **Operations (Servo Cog Assembly)**: Precision hardware cog teeth that rotate with steady mechanical cadence when active or hovered, paired with a subtle core phosphor pulse.

#### Application-Wide Living Touchpoints
Beyond navigation, the motion language extends tastefully across all four views without visual clutter:
- **Top Header Sync Controls**: Hovering the primary `Incremental Sync` / `Full Sync` button triggers a crisp horizontal phosphor beam sweep across the button face; when a sync run is actively executing, the `Stop` / active run state emits a rhythmic status glow, and enabling `Dry Run` gives the laboratory flask icon a gentle amber shimmer.
- **Active Runner Phase & Transfer Beams**: When a sync or download is running (or at higher motion tiers), a thin phosphor electron trace glides across the top border of the active phase panel, and determinate download progress bars (in Sync, Catalog cards/rows, and the Game Detail drawer) gain a luminous leading phosphor tip with a subtle traveling scan sheen.
- **KPI Counters & Telemetry Deck**: Key numeric readouts (`Mirrored Files`, `Archive Footprint`, `Adaptive Delay`) breathe softly in sync with the CRT `Gauss Glow` setting, while the Grafana-style Telemetry Deck features a delicate horizontal CRT sweep line across the chart plot area and a gently pulsing live data endpoint dot.
- **Event Stream Terminal & Section Headers**: The `Live Scraper Event Stream` terminal icon gains a classic blinking phosphor prompt cursor, Mirrored Systems' drive icon flickers subtly during live activity, and section header icons across Catalog, Schedule, and Operations respond with crisp micro-kinematics on panel hover.

#### Preset Progression (`Off` / `Low` / `Medium` / `High`)

| Preset | Ambient Rest Behavior | Hover / Focus & Active Sync Behavior | Phosphor Halo Coupling |
| :--- | :--- | :--- | :--- |
| **Off** | Zero ambient animations; 100% static icons and surfaces | Standard instant color transitions only | Standard static CRT text/box glow |
| **Low** *(Default)* | Active nav icon & live terminal cursor animate gently; inactive icons rest quietly | Hovering any nav item, card, or CTA wakes up full icon kinematics & beam sweeps; active sync runs animate transfer/phase beams | Soft phosphor halo (`0.5×` Gauss Glow multiplier) |
| **Medium** | Active nav icon, KPI phosphor breathing, Telemetry chart sweep, and subtle panel border trace run continuously | Livelier cadence on hover/focus; richer afterglow tail on traveling Sync pulse and progress bars | Balanced phosphor bloom (`0.85×` Gauss Glow multiplier) |
| **High** | All four nav icons, panel electron traces, chart raster sweep, KPI glow breathing, and terminal indicators animate continuously in staggered harmony | Energetic speed boost on hover and active transfers with vivid CRT phosphor bloom | Full arcade-grade bloom (`1.25×` Gauss Glow multiplier) |

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Custom Inline SVG Kinematics + CSS Variables vs. External Animation Loops**
  - *Chosen Approach*: Build bespoke, lightweight inline SVG components driven by pure CSS `@keyframes` (`transform`, `opacity`, `stroke-dashoffset`, `filter`) parameterized via root CSS custom properties (`--crt-motion-speed`, `--crt-motion-glow`, `data-crt-motion`).
  - *Why*: Runs entirely on the browser compositor/paint pipeline with zero JavaScript timers or React re-renders, guaranteeing 60fps smoothness even while SSE download telemetry streams rapidly.
  - *Alternatives Considered*: `requestAnimationFrame` JS loops or heavy animation libraries, which add unnecessary CPU overhead on a dashboard meant to stay open in background tabs.

- **Decision 2: Unified Coupling with CRT Palette & Gauss Glow**
  - *Chosen Approach*: Derive motion halo radius and alpha directly inside the CRT CSS variable engine from `gaussGlow`, `enabled`, `palette`, and `uiMotion`.
  - *Why*: Switching the palette from `Green` to `Amber` or `Cyan`—or sliding `Gauss Glow` from `25%` (`Subtle`) to `75%` (`Arcade`)—automatically scales the phosphor bloom on every animated icon, progress tip, and panel trace so the whole UI feels physically wired to one cathode tube.
  - *Alternatives Considered*: Hardcoding fixed green shadows on animations, which would clash whenever users switch palettes or tune their CRT sliders.

- **Decision 3: Independent Preset Inside CRT Display Studio + Reduced-Motion Respect**
  - *Chosen Approach*: Add `uiMotion` (`'off' | 'low' | 'medium' | 'high'`) to the persisted CRT Display settings with `'low'` as default (including clean migration for existing saved `localStorage` configs so returning users automatically receive the `'low'` default without losing their custom sliders), while forcing zero continuous motion under `@media (prefers-reduced-motion: reduce)`.
  - *Why*: Keeps all visual/retro customization consolidated in one intuitive studio panel and honors accessibility preferences automatically.

---

### 4. Technical Architecture & Data Strategy

#### System & Style Propagation Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│ CRT Display Studio (Left Sidebar)                                          │
│  • Presets (Subtle / PVM / Arcade)  • Palette (Green / Amber / Cyan)       │
│  • Living UI Motion: [ Off ] [ Low* ] [ Med ] [ High ]                     │
│  • 5 Optical Sliders (Scanlines, Gauss Glow, Vignette, Grille, RGB Fringe) │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ persists to localStorage & computes vars
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Root App Canvas (data-crt-palette, data-crt-motion="off|low|medium|high")  │
│  CSS Variables: --crt-motion-glow-sm/lg, --crt-motion-speed-scale,         │
│                 --crt-motion-ambient-opacity (coupled to Gauss Glow & RGB) │
└───────┬──────────────────────┬──────────────────────┬──────────────────────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────────┐  ┌────────────────────┐  ┌─────────────────────────────┐
│ Kinetic Nav Icons │  │ Header & Transfer  │  │ Telemetry, KPI & Console    │
│ • Sync ECG Sweep  │  │ Electron Beams     │  │ • KPI Phosphor Breathing    │
│ • Catalog Scroll  │  │ • CTA Hover Sheen  │  │ • Chart Oscilloscope Sweep  │
│ • Schedule Clock  │  │ • Phase Top Trace  │  │ • Blinking Stream Cursor    │
│ • Operations Cog  │  │ • Progress Tip Glow│  │ • Drive & Section Wake-Up   │
└───────────────────┘  └────────────────────┘  └─────────────────────────────┘
```

#### State, Migration & Interaction Mapping

- **Settings Schema & Storage Migration**:
  - Extend `CrtDisplaySettings` with `uiMotion: 'off' | 'low' | 'medium' | 'high'` (defaulting to `'low'`).
  - Existing `localStorage` payloads missing `uiMotion` cleanly hydrate with `'low'` while preserving all previously saved palette and slider values; clicking `Reset Default` restores `'low'` alongside the `Subtle` preset.
  - Note: Selecting `Subtle`, `PVM`, or `Arcade` optical presets preserves the user's chosen `Living UI` level (unless they explicitly switch it), while optical bloom intensity naturally scales with each preset's `Gauss Glow`.
- **Attribute-Driven CSS Tier Rules**:
  - Apply `data-crt-motion={crtSettings.uiMotion}` and `data-sync-running={Boolean(status?.activeRun)}` on the root shell.
  - CSS selectors scope ambient vs. hover/active animations cleanly by tier:
    - `[data-crt-motion="off"]`: All kinetic keyframes disabled (`animation: none`).
    - `[data-crt-motion="low"]`: Active nav icon, live run transfer beams, and terminal prompt cursor animate subtly; inactive nav icons, CTA sweeps, and section icons wake smoothly on `:hover` / `:focus-visible`.
    - `[data-crt-motion="medium"]`: Adds gentle KPI glow breathing, Telemetry Deck chart raster sweep, and active-panel hairline electron trace, with faster hover response.
    - `[data-crt-motion="high"]`: Enables staggered ambient motion across all nav icons, richer phosphor trail bloom, continuous subtle panel traces, and heightened interactive energy.
