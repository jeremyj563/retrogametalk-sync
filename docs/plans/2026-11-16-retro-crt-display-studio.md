---
title: Retro CRT Display Studio & Visual FX Controls
status: implemented
created_at: 2026-11-16T02:51:25Z
implemented_at: 2026-11-16T02:52:57Z
---

# Retro CRT Display Studio & Visual FX Controls

Expands the left sidebar's CRT Scanlines footer into a **collapsible CRT Display panel** featuring quick retro presets, a **Phosphor Palette selector** (`Green`, `Amber`, `Cyan`), and five real-time `0%–100%` visual sliders (**Scanlines**, **Gauss Glow**, **Vignette**, **Aperture Grille**, **RGB Fringe**), complete with a master **ON/OFF** toggle, **Reset Default** action, and automatic browser persistence.

---

## User Review & Critical Decisions

> [!IMPORTANT] All visual effects, sidebar layout, and preset preferences were confirmed during clarification:
> - **Visual FX Suite**: Includes **CRT Scanlines**, **Gauss / Phosphor Glow**, **CRT Vignette**, **Aperture Grille / RGB Mask**, **Chromatic Aberration (RGB Fringe)**, and a live **Phosphor Palette** switcher (`Green`, `Amber`, `Cyan`).
> - **Sidebar Organization**: Houses all display controls inside a clean, **collapsible CRT Display panel** in the left sidebar footer so the navigation rail stays uncluttered at rest while offering full real-time adjustment when expanded.
> - **Quick Presets & Reset**: Provides one-click presets (**Subtle**, **PVM**, **Arcade**) alongside a **Reset Default** action to return to defaults immediately.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the static CRT monitor styling into a real-time, customizable display tuner where dragging any slider—or switching phosphor hues—immediately updates the entire application viewport frame-by-frame without flicker, layout shift, or page reloads.
- **Target User Context**: Retro enthusiasts customizing the look and atmosphere of their ROM archival console—whether dialing in a warm P3 amber terminal, crisp Sony PVM aperture-grille scanlines, or lush phosphor bloom.
- **Key Value**: Full retro CRT atmosphere at any intensity with zero legibility compromise on data tables, preserved custom slider values across a single master **ON/OFF** switch, and seamless persistence across sessions.

---

## 2. User Experience & Visual Design

### Collapsible Sidebar Footer Control

Positioned in the left sidebar footer right above the inconspicuous build readout, adhering strictly to the single-elevation CRT surface language (`border-crt-border`, `bg-crt-bg`, `font-mono tabular-nums`):

- **Collapsed Header Row (Always Accessible)**:
  - Left: Monitor icon + **CRT Display** label (clickable header row with chevron to expand/collapse the controls).
  - Right: Active mode indicator (`Subtle`, `PVM`, `Arcade`, `Custom`, or `Bypassed`) paired with a crisp **ON / OFF** master bypass button (`whitespace-nowrap shrink-0`).
- **Expanded Controls Drawer**:
  1. **Presets + Reset Strip**: Compact segmented buttons for **Subtle**, **PVM**, and **Arcade** (highlighting the matching preset automatically, or unhighlighted when custom-tuned), paired with a **Reset Default** button.
  2. **Phosphor Palette Switcher**: 3-way selector for **Green** (`P31 #38E56B`), **Amber** (`P3 #FFB000`), and **Cyan** (`P4 #38D9F5`), dynamically updating primary accents, borders, subtle canvas tinting, slider tracks, and telemetry curves across the whole app while keeping semantic error alerts (`crimson`) intact.
  3. **Five Live `0%–100%` Sliders**:
     - **Scanlines**: Horizontal CRT beam lines from invisible (`0%`) to bold high-contrast stripes (`100%`).
     - **Gauss Glow**: Soft Gaussian phosphor halo around headlines, KPI counters, phosphor accents, and screen tube radial bloom—keeping body copy and table rows razor sharp.
     - **Vignette**: Curved glass monitor corner and perimeter edge darkening (`radial-gradient` + soft inner edge falloff).
     - **Aperture Grille**: Fine vertical RGB phosphor triad subpixel mesh layered smoothly across the screen.
     - **RGB Fringe**: Subtle horizontal red/cyan beam convergence offset (chromatic aberration) on display titles and phosphor readouts.

### Presets & Default Tuning

- **Subtle** *(Initial Default)*: `Scanlines 35%` · `Gauss Glow 25%` · `Vignette 20%` · `Aperture Grille 10%` · `RGB Fringe 0%`
- **PVM**: `Scanlines 55%` · `Gauss Glow 45%` · `Vignette 40%` · `Aperture Grille 45%` · `RGB Fringe 20%`
- **Arcade**: `Scanlines 85%` · `Gauss Glow 75%` · `Vignette 65%` · `Aperture Grille 70%` · `RGB Fringe 45%`

---

## 3. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser localStorage (rgt_sync_crt_display_v1)                           │
│  ├─ Persists { enabled, panelOpen, palette, scanlines, gaussGlow,        │
│  │             vignette, apertureGrille, chromaticAberration }           │
│  └─ Migrates legacy scanline preference on initial load                  │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ Hydrates & syncs live state
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Application Root Shell                                                   │
│  ├─ Sets data-crt-palette="green|amber|cyan" (overrides @theme tokens)   │
│  ├─ Computes continuous CSS custom properties from active FX sliders     │
│  ├─ Viewport Fixed Overlays (pointer-events: none, static non-flicker)   │
│  │    ├─ Radial Tube Bloom & Vignette Layer                              │
│  │    ├─ Horizontal Scanlines Layer                                      │
│  │    └─ Vertical RGB Aperture Grille Layer                              │
│  └─ Collapsible Sidebar Footer ("CRT Display")                           │
│       ├─ Header: Expand/Collapse · Active Preset Label · ON/OFF Toggle   │
│       ├─ Presets Bar: [Subtle] [PVM] [Arcade] · [Reset Default]          │
│       ├─ Palette Switcher: [Green] [Amber] [Cyan]                        │
│       └─ 5 Real-Time Sliders (Scanlines, Gauss Glow, Vignette, Grille,   │
│          RGB Fringe) with live tabular % readouts                        │
└──────────────────────────────────────────────────────────────────────────┘
```
