---
title: Live CRT Scanlines Intensity Control
status: implemented
created_at: 2026-11-16T02:36:32Z
implemented_at: 2026-11-16T02:43:17Z
---

# Live CRT Scanlines Intensity Control

Replaces the binary CRT Scanlines button in the left navigation sidebar with a combined **ON/OFF toggle** and **0%–100% intensity slider** that updates the full-viewport scanline overlay in real time as you drag, with bold high-contrast scanline depth at upper levels and automatic browser persistence.

---

## User Review & Critical Decisions

> [!IMPORTANT] All layout, contrast range, and persistence choices were confirmed during clarification:
> - **Sidebar Layout**: Replaces the existing binary footer button with a compact **CRT Scanlines** control combining an **ON/OFF toggle** and an inline **0%–100% range slider** inside the left sidebar.
> - **Real-Time Contrast Curve**: Dragging from `0%` to `100%` smoothly scales the full-screen scanline overlay from invisible (`0%`) through the current subtle preset (`35%`) up to bold, crisp retro CRT scanline contrast (`100%`) in real time while dragging.
> - **Browser Persistence**: Both your ON/OFF state and chosen intensity percentage persist across browser reloads in `localStorage`.

---

## 1. Overview & Core Concept

- **What It Does**: Lets operators fine-tune the retro CRT monitor aesthetic live in place—from zero scanlines (`0%`) to subtle texture (`25%–40%`) to rich, pronounced scanline banding (`75%–100%`)—while keeping the sidebar toggle available to mute/unmute scanlines without losing your dialed-in percentage.
- **Target User Context**: Desktop operators customizing visual comfort and retro CRT nostalgia across the Sync monitor, Catalog browser, and Schedule views.
- **Key Value**: Immediate frame-by-frame visual feedback while dragging, zero layout disruption, and remembered preferences across sessions.

---

## 2. User Experience & Visual Design

### Compact Sidebar Control Module

Located directly in the left sidebar footer above the build metadata line, matching the single-elevation CRT surface aesthetic (`border-crt-border`, `bg-crt-bg`, `font-mono tabular-nums`):

- **Top Control Row**:
  - Left: Monitor icon paired with **CRT Scanlines** label.
  - Right: Tabular percentage readout (`35%` when active, dimmed when muted) paired with a crisp single-line **ON / OFF** toggle button (`whitespace-nowrap shrink-0`).
- **Live Range Slider Row**:
  - Full-width custom-styled range track (`0` to `100`, step `1`) using CRT phosphor accent fill up to the current thumb position on the dark `#070A08` track so active intensity reads clearly at a glance.
  - Smoothly updates the viewport scanlines on every drag tick with zero animation delay or page reflow.

### Real-Time Visual Curve & Smart Toggle Behavior

- **0% to 100% Contrast Progression**:
  - `0%`: Completely clear screen (no scanline darkening).
  - `35%` (Initial Default): Matches the familiar subtle background scanline feel until adjusted.
  - `60%–100%`: Progressively deepens scanline band darkness and opacity so upper slider positions deliver unmistakable bold retro CRT contrast while preserving readable foreground text contrast across dark surfaces.
- **Smart Toggle & Drag Coupling**:
  - **Toggling OFF**: Pauses the scanline overlay immediately while remembering your last non-zero percentage (dimming the slider track and showing `OFF`).
  - **Toggling ON**: Restores your remembered intensity (or defaults back to `35%` if previously set to `0%`).
  - **Dragging While OFF**: Moving the slider above `0%` automatically turns scanlines **ON** at that live intensity so dragging always produces instant feedback; dragging down to `0%` sets intensity to `0%` (`OFF`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: CSS Custom Properties on Root Container vs. Multiple Class Tiers**
  - *Chosen Approach*: Drive scanline band alpha/opacity via inline CSS custom properties (`--crt-scanline-alpha`, `--crt-scanline-opacity`) bound directly to the root viewport wrapper, consumed by the `.crt-scanlines::after` fixed overlay.
  - *Why*: Updating CSS variables on input gives smooth, continuous 1% granularity in real time without generating dozens of static utility classes or causing DOM reflows.
  - *Alternatives Considered*: Discrete Low/Medium/High preset classes (cannot provide continuous real-time drag feedback).

- **Decision 2: Separate `enabled` + `intensity` Persistence vs. Single Number Only**
  - *Chosen Approach*: Persist `{ enabled, intensity }` together in `localStorage`.
  - *Why*: Users can quickly toggle scanlines **OFF** to inspect box art cleanly and toggle back **ON** straight to their favorite percentage (e.g., `75%`) without re-dragging the slider each time.
  - *Alternatives Considered*: Storing only a single `0..100` integer (toggling OFF would erase the user's preferred intensity).

- **Decision 3: Static Non-Flickering Scanlines**
  - *Chosen Approach*: Keep scanline bands static (zero flicker, pulse, or scroll animation) while respecting pointer pass-through (`pointer-events: none`).
  - *Why*: Ensures smooth, accessible real-time slider adjustment even when OS reduced-motion preferences are enabled, without introducing motion discomfort or blocking clicks.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Browser localStorage (rgt_sync_crt_scanlines_v1)                        │
│  └─ Persists { enabled: boolean, intensity: 0..100 } across reloads     │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ Hydrates initial state & syncs updates
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Application Shell                                                       │
│  ├─ Computes continuous scanline CSS custom properties from             │
│  │  (enabled ? intensity : 0):                                          │
│  │    • --crt-scanline-alpha (line contrast scaling to bold 100%)       │
│  │    • --crt-scanline-opacity (overall overlay opacity)                │
│  ├─ Root Viewport Overlay (.crt-scanlines::after)                       │
│  │    └─ Fixed repeating-linear-gradient reading CSS variables live     │
│  └─ Left Sidebar Footer Control                                         │
│       ├─ [Monitor] CRT Scanlines · [NN%] · [ON / OFF Toggle Button]     │
│       └─ Interactive Range Slider (0–100, step 1, phosphor fill track)  │
└─────────────────────────────────────────────────────────────────────────┘
```
