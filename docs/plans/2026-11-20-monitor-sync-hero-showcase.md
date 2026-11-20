---
title: Monitor Sync Status Hero Showcase Redesign
status: implemented
created_at: 2026-11-20T16:15:20Z
implemented_at: 2026-11-20T16:21:00Z
---

# Monitor Sync Status Hero Showcase Redesign

Redesign the main **Monitor** Sync status bar from three fragmented horizontal strips into a cohesive, broadcast-grade **Hero Showcase** where adaptive-aspect game box art anchors the left side and spans vertically across clean unboxed title typography and the live docked transfer progress bar.

---

## Confirmed Design Decisions

- **Overall Composition**: **Hero Showcase** layout where the active game's box art spans vertically alongside both the game title and the live transfer progress bar inside one unified stage.
- **Box-Art Proportions**: **Adaptive aspect ratio** at a fixed vertical height, preserving each console's authentic box silhouette (wide SNES/N64 boxes, square-ish DS/PS1 jewel cases, tall portrait GBA/PS2/PSP covers) without aggressive square cropping.
- **Title & Inspect Affordance**: **Unboxed display typography** (removing the glowing bordered rectangle around the title and the boxed pill around the system counter) paired with a subtle hover/focus `Inspect ↗` cue that opens the **Game Detail Drawer**.
- **Standby & Non-Game Phases**: Collapses the left artwork column cleanly so Standby and system-level phases stay slim without an empty placeholder slot.

---

## Summary of Implementation

- Upgraded `SyncTargetCoverThumbnail` in `OverviewPanel` to an adaptive-aspect, fixed-height Hero Showcase cover frame (`80px–90px` when docked beside active transfers, `62px–70px` during Dry Run previews) with immediate cached-image detection, natural aspect width clamping (`min 50px`, `max 124px–144px`), and a steady `3:4` recessed CRT placeholder silhouette while loading or missing artwork.
- Removed the bordered pill enclosure around `<system> · <current/total>` in Tier 1 in favor of clean unboxed tabular metadata separated by subtle `·` typographic dots.
- Replaced the boxed `.crt-active-filename` title enclosure with crisp unboxed display typography (`font-display`) coordinated with the box-art hover state so hovering either cover or title illuminates both and reveals a subtle inline `Inspect ↗` cue with zero layout shift.
- Docked the live combined transfer progress readout and phosphor Speed Wave bar directly inside the right Hero column beside the cover art while keeping the collapsible per-worker `Details` drawer full-width underneath.
