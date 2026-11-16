---
title: Native CSS Animated CRT Header Banner
status: implemented
created_at: 2026-11-16T20:38:22Z
implemented_at: 2026-11-16T20:42:00Z
---

# Native CSS Animated CRT Header Banner

Replace the static `"RetroGameTalk Sync"` top-left header text—and retire the external custom logo URL setting—in favor of a built-in, razor-sharp CSS and inline-SVG implementation of the animated retro cartridge + telemetry sweep banner, dynamically wired into the **CRT Display** studio and live sync states.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core product and design choices were confirmed and govern this plan:
> - **CRT Display & Motion Coupling**: Dynamically syncs with the active CRT Palette (`Green`, `Amber`, `Cyan`), `Gauss Glow` slider, and `Living UI Motion` presets (`Off` · `Low` · `Med` · `High`).
> - **Live Sync & Dry Run Reactivity**: Accelerates its data-stream chevrons, pin scanner, and sweep beam during active sync runs, and shifts its `SYNC` accent and sweep beam to warm CRT Amber whenever Dry Run is armed or executing.
> - **Streamlined Branding Scope**: Removes the custom Logo/Banner URL override card from **Operations** so the new native CSS banner serves as the single, permanent built-in header identity.

---

### 1. Overview & Core Concept

- **What It Does**: Renders a crisp, hardware-authentic animated lockup in the top-left header combining the **Retro Cartridge CRT Badge** (scrolling sync chevrons, vertical CRT scanline sweep, 5-pin discrete bus scanner, and status LED) with a native typography **`RETROGAMETALK SYNC`** wordmark underscored by a luminous **Telemetry Sweep Track**.
- **Target Audience**: Self-hosted retro gaming operators who want a cohesive, zero-dependency, vector-sharp header emblem that feels physically wired to the rest of the CRT console.
- **Key Value**: Eliminates external image hosting, fixed-palette raster/GIF artifacts, and configuration clutter while delivering subpixel-crisp typography, 60fps compositor-driven CSS motion, and real-time visual feedback for palettes, motion tiers, and sync states.

---

### 2. User Experience & Visual Design

#### Visual Anatomy of the Native CSS Banner (`34px` Header Lockup)
Designed to sit cleanly inside the single-row sticky top bar without increasing header height or crowding sync controls:
1. **Left Cartridge Hardware Emblem (Inline SVG + CSS Keyframes)**:
   - **Machined Cartridge Shell**: Dark neutral casing (`--color-crt-surface` / `--color-crt-bg`) with subtle top grip grooves and a 1px `--color-crt-border-strong` silhouette.
   - **Recessed Miniature CRT Screen**: Framed by an active phosphor/amber inner bezel; displays looping `>>>` sync chevrons gliding left-to-right alongside a subtle horizontal scanline sweeping vertically across the glass.
   - **5-Pin Edge Connector & Activity LED**: Five miniature cartridge contact pins along the bottom edge with a discrete CSS `steps(5, end)` active-pin pulse stepping sequentially across the bus, paired with a corner status LED.
2. **Right Wordmark & Telemetry Sweep Track (Native HTML/CSS)**:
   - **Crisp Dual-Tone Wordmark**: `RETROGAMETALK` set in high-contrast `--color-crt-text` beside `SYNC` in luminous `--color-crt-phosphor` (or `--color-crt-amber` in Dry Run state), rendered in bold `JetBrains Mono` with native CRT text-shadow bloom.
   - **Full-Width Underline Sweep Beam**: A recessed `3px` track spanning the exact width of the wordmark below the baseline, carrying a clipped gradient electron beam with a bright leading phosphor tip.
   - **Responsive Mobile Compactness**: Preserves the full cartridge + wordmark lockup on tablet/desktop viewports and scales typography/spacing cleanly on narrow mobile viewports so header sync controls never clip.

#### Dynamic State & Preset Matrix

| Mode / Tier | Cartridge Screen & Pin Bus | Wordmark & Telemetry Sweep Track | Color & Glow Posture |
| :--- | :--- | :--- | :--- |
| **Motion: `Off`** *(or OS Reduced Motion)* | Static centered `>>>` chevrons, resting pin 1 highlight, steady LED | Crisp static `RETROGAMETALK SYNC` + subtle static accent bar | Uses active CRT palette & static Gauss Glow; zero continuous keyframes |
| **Motion: `Low`** *(Default)* | Gentle ambient chevron glide & slow scanline; wakes to brisk speed on header hover | Soft periodic underline beam sweep (`~3.4s` cadence); livelier on hover | `0.5×` Gauss Glow bloom in active palette (`Green`, `Amber`, or `Cyan`) |
| **Motion: `Med` / `High`** | Continuous crisp chevron flow, vertical scanline, sequential 5-pin bus step & LED pulse | Continuous luminous sweep track (`~2.4s` / `~1.85s`) + gentle `SYNC` phosphor breathe | `0.85×` / `1.25×` Gauss Glow bloom coupled to CRT sliders |
| **Dry Run Armed / Running** | Inner bezel, chevrons (when Dry Run active), and LED tint warm Amber | `SYNC` label and sweep beam shift to `--color-crt-amber` | Signals simulation mode at a glance; accelerates when Dry Run is actively executing |
| **Live Sync Executing** | High-throughput `1.15s` chevron + pin bus transfer cadence | Fast `1.25s` underline telemetry sweep with heightened tip bloom | Boosted active-transfer glow synced with `[data-sync-running="true"]` |

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Hybrid Inline SVG Cartridge + Native HTML/CSS Wordmark vs. Pure SVG `<text>`**
  - *Chosen Approach*: Render the geometric cartridge emblem in crisp inline SVG while rendering `RETROGAMETALK SYNC` and its underline sweep track in native HTML/CSS flex layout.
  - *Why*: Browser-laid HTML text guarantees exact loaded webfont metrics (`JetBrains Mono`), zero text-clipping or overlap across OS font engines, automatic underline track width matching (`w-full`), and native participation in the app's CRT text-shadow glow.
  - *Alternatives Considered*: Hardcoded SVG `<text x="...">` coordinates, which can drift or clip if a user's browser substitutes font metrics or zooms text.

- **Decision 2: Compositor-Only CSS Animations Driven by Root Attributes**
  - *Chosen Approach*: Drive all banner motion (`transform: translateX/Y`, `opacity`) via CSS `@keyframes` scoped to `[data-crt-motion]`, `[data-sync-running]`, and banner state attributes (`data-banner-tone="phosphor|amber"`).
  - *Why*: Zero JavaScript timers or React re-renders; changing CRT palettes, Gauss Glow, or Living UI Motion presets updates the banner instantaneously at 60fps.

- **Decision 3: Clean Removal of Custom Logo URL Setting & Safe Schema Retirement**
  - *Chosen Approach*: Remove the `Interface Branding` section, state, and dirty-check logic from **Operations**, delete external URL/video media helpers, and retire `customBrandLogoUrl` from the public config contract (with a clean forward-only SQLite migration clearing any legacy value while keeping existing database history intact).
  - *Why*: Eliminates dead UI controls and unused API surface while ensuring existing SQLite databases upgrade seamlessly without migration version conflicts.

---

### 4. Technical Architecture & Data Strategy

#### Component & Styling Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Root App Shell                                                             │
│  • CRT Variables (--color-crt-phosphor, --crt-phosphor-rgb, Gauss Glow)    │
│  • Attributes: data-crt-palette, data-crt-motion="off|low|medium|high",    │
│                data-sync-running="true|false"                              │
└───────────────────┬────────────────────────────────────┬───────────────────┘
                    │                                    │
                    ▼                                    ▼
┌───────────────────────────────────────┐  ┌─────────────────────────────────┐
│ Sticky Header Brand Anchor (#monitor) │  │ Operations View                 │
│  Passes: activeRun, dryRunEnabled     │  │  • Credentials & Mirror Path    │
└───────────────────┬───────────────────┘  │  • Target Consoles & Systems    │
                    │                      │  • Allowed Game & ROM Types     │
                    ▼                      │  • Prepared ROM Naming & SD     │
┌───────────────────────────────────────┐  │  (Interface Branding removed)   │
│ Native CSS BrandMark Lockup           │  └─────────────────────────────────┘
│  ├─ Inline SVG Cartridge Emblem       │
│  │   • Clipped CRT chevron stream     │
│  │   • Vertical scanline beam         │
│  │   • 5-pin stepped bus + LED        │
│  └─ HTML/CSS Wordmark Stack           │
│      • RETROGAMETALK + SYNC span      │
│      • Clipped gradient sweep track   │
└───────────────────────────────────────┘
```

#### State & Interaction Mapping

- **Header Brand Anchor Interaction**:
  - Clicking the animated banner continues to navigate smoothly to `#monitor` (`Sync` view) via history-aware routing (respecting the Operations unsaved-changes guard if dirty).
  - Hovering or keyboard-focusing (`:focus-visible`) the brand anchor gently boosts chevron and sweep cadence when `Living UI Motion` is enabled.
- **Sync & Dry Run Signal Propagation**:
  - `BrandMark` receives `isSyncRunning={Boolean(status?.activeRun)}` and `isDryRun={Boolean(status?.activeRun ? (status.activeRun.dryRun || status.activeRun.mode === 'dry_run') : dryRunEnabled)}`.
  - Setting `data-banner-dry-run="true"` switches the `SYNC` text, cartridge screen accent, active pin, LED, and sweep beam gradient from `--color-crt-phosphor` to `--color-crt-amber` without affecting the rest of the workspace palette.
- **Database & API Cleanup**:
  - Remove `customBrandLogoUrl` from client/server TypeScript interfaces and `PUT /api/config` handling, and add forward-only migration `v12` (`retire_custom_brand_logo_url`) to clear any previously stored URL in existing SQLite databases safely.
