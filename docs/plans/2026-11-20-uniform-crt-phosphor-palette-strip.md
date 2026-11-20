---
title: Uniform CRT Phosphor Palette Swatch Strip
status: implemented
created_at: 2026-11-20T17:25:10Z
implemented_at: 2026-11-20T17:30:30Z
---

# Uniform CRT Phosphor Palette Swatch Strip

Replace the mismatched two-grid Phosphor Palette buttons in the CRT Display sidebar panel with a single, precision-aligned 7-swatch hardware keycap strip and a synchronized header name readout, restoring visual symmetry and reclaiming vertical sidebar space.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The plan incorporates both layout preferences confirmed during discovery:
> - **Confirmed Decision 1 — Layout & Form Factor**: **Single uniform swatch strip with active name in header**. All 7 palettes sit in one equal-width row of uniform square hardware keycaps, with the active (or hovered/focused) palette name displayed on the right side of the `Phosphor Palette` header—matching the exact visual rhythm of the `Living UI Motion` row directly beneath it.
> - **Confirmed Decision 2 — Locked Collector Palettes**: **Inline in the same uniform grid with subtle lock icon**. Starter and collector palettes share the exact same button size, shape, and alignment in one continuous strip, with locked collector swatches showing a dimmed phosphor tint and crisp miniature lock indicator until unlocked via Trophy Points.

---

## 1. Overview & Core Concept

- **What It Does**: Unifies the 3 starter phosphor palettes (`Green`, `Amber`, `Cyan`) and 4 trophy-unlocked collector palettes (`DMG Olive`, `Synthwave`, `Crimson Tube`, `Trinitron White`) into a single 7-column uniform swatch strip inside the always-open CRT Display tuner card.
- **Key Value**: Eliminates the jagged 3-column-over-2-column mismatch (different button widths, font sizes, and alignments), elevates the CRT Display card to cohesive broadcast-hardware polish, and tightens sidebar vertical density by collapsing three uneven rows into one clean row.

---

## 2. Key Design & Implementation Details

- **Header Readout**: Mirrors `Living UI Motion` with `Phosphor Palette` on the left and the active palette's full name on the right (`Green`, `Amber`, `Cyan`, `DMG Olive`, `Synthwave`, `Crimson Tube`, `Trinitron White`). Hovering or keyboard-focusing any swatch previews its label in real time (appending `· <pts> pts` with a subtle lock icon for locked collector palettes).
- **Uniform 7-Column Hardware Keycap Strip**: Single `grid-cols-7 gap-1` row of identical `h-7` square-proportioned buttons with `data-crt-palette`, `aria-pressed`, `aria-disabled`, `aria-label`, and screen-reader labels. Active swatches show a glowing phosphor jewel and elevated active border; locked collector swatches sit inline at the exact same dimensions with a dimmed phosphor backing and centered miniature lock icon.
- **Visual Preview Capture Compatibility**: Updated the Playwright capture helper to match `data-crt-palette` (respecting `aria-disabled`) with text fallback so in-place Green → Amber theme switching during README visual preview captures continues seamlessly.
