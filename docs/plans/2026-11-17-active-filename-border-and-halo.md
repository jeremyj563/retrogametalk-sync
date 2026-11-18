---
title: Active Filename Border Frame & Perimeter Halo
status: implemented
created_at: 2026-11-17T16:08:45Z
implemented_at: 2026-11-17T16:10:00Z
---

# Active Filename Border Frame & Perimeter Halo

Replace the underline beneath the currently downloading game filename in the main Sync Status header with a crisp, CRT-styled bordered readout surrounded by a full-perimeter phosphor halo that scales across Living UI Motion levels (`off`, `low`, `medium`, `high`, and `ultra`).

---

## User Review & Critical Decisions

- **Border Shape (Confirmed)**: Crisp CRT frame with subtle rounded corners (`3px` radius), matching the hardware bay and progress bar aesthetics rather than a soft pill or hyperlink underline.
- **Halo & Motion Treatment (Confirmed)**: Breathing full-perimeter phosphor halo around all four edges paired with a tiered interior sheen sweep across active Living UI Motion modes.
- **Placement Scope (Confirmed)**: Applied exclusively to the active downloading filename in the main Sync Status hero header, leaving individual transfer rows sleek and unadorned.
- **Release Versioning**: Synchronized `1.2.1` patch bump across `package.json`, Helm `Chart.yaml`, and `CHANGELOG.md`.

---

## Architecture & Visual Design

- **Dual-Layer Unclipped Halo + Clipped Sheen**:
  - `.crt-active-filename` renders the `1px` phosphor frame (`border-radius: 3px`) with recessed phosphor gradient fill and `::before` full-perimeter halo layer animated purely via GPU `opacity` (`crt-filename-halo-breathe`).
  - `.crt-active-filename-sheen` (`overflow: hidden`) clips the diagonal sheen sweep (`::after` via `crt-filename-glint`) tightly to the frame interior without cropping the outer `::before` perimeter halo.
  - `.crt-active-filename-label` renders crisp single-line truncated display typography (`truncate min-w-0 font-bold`), adding RGB chromatic convergence in `high` / `ultra` when `.crt-fx-active` is enabled.
- **Accessibility**: `data-crt-motion="off"` and `@media (prefers-reduced-motion: reduce)` disable all halo breathing, sheen sweeps, and chromatic animations while keeping the crisp static border and resting perimeter glow.
