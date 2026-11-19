---
title: CRT Multi-Cart Arcade Expansion (4-in-1 Hidden Arcade)
status: implemented
created_at: 2026-11-19T06:48:33Z
implemented_at: 2026-11-19T07:04:00Z
---

# CRT Multi-Cart Arcade Expansion — Implementation Plan

## User Review & Critical Decisions

- **4-in-1 Arcade Lineup**: Upgrade the hidden CRT arcade modal into a **4-in-1 Multi-Cart Arcade Cabinet** housing **Cartridge Breakout** alongside three new playable CRT classics: **Retro Invaders**, **Phosphor Snake**, and **Tetromino Drop**.
- **Multi-Cart Launcher + Direct Secret Search Keywords**:
  - Opening the cabinet via the **Konami Code**, **5× header cartridge logo clicks**, or general secret keywords opens the **4-in-1 Multi-Cart Launcher** cartridge selector.
  - Typing game-specific secret phrases in the Catalog search bar launches straight into that cartridge, while single-word keywords that overlap real ROM titles only trigger on explicit **Enter** submission.
- **Per-Game High Scores & 4 New Hidden Trophies**:
  - Every cartridge persists its own local **Best Score** (preserving existing Cartridge Breakout high scores seamlessly) displayed on the Multi-Cart Launcher shelf and inside each game's HUD.
  - Adds **4 new Secret / Hidden Trophies** to the SQLite Trophy Case (bringing the total catalog from **60 → 64** trophies, `2,145` max pts, with Platinum auto-adjusting to `63`):
    1. **Wave Defender** *(Bronze · Hidden)* — Clear Wave 1 or shoot down a Mystery UFO in Retro Invaders.
    2. **Data Bus Serpent** *(Silver · Hidden)* — Reach length 25 or score 1,500+ points in Phosphor Snake.
    3. **Quad Stacker** *(Silver · Hidden)* — Clear 4 lines at once with a single drop in Tetromino Drop.
    4. **Multi-Cart Champion** *(Gold · Hidden)* — Play and post a score in all 4 CRT Arcade cartridges (`0 / 4 carts`).
- **Spoiler-Free Release Notes & Documentation**: `CHANGELOG.md` and GitHub Release notes remain spoiler-free, while the *Back of the Cartridge Manual* tip in `/docs/features/README.md` adds only a subtle nod to additional hidden banks.

---

## Summary of Implemented Capabilities

1. **4-in-1 Multi-Cart Launcher**: 2×2 cartridge selector grid with custom pixel/SVG artwork, `CART 01`–`CART 04` badges, per-cartridge Best Score in `tabular-nums`, keyboard `1–4` / Arrow + Enter selection, Konami Mode perk indicators, and instant hot-swapping via `Switch Cart`.
2. **Retro Invaders**: 5-row animated pixel alien formation with accelerating march cadence, 4 destructible CRT phosphor bunkers, Mystery UFO with chiptune warble, progressive waves, Konami 5-life + rapid twin pulse bonus, and touch controls.
3. **Phosphor Snake**: CRT data-bus grid, glowing ROM packets, timed Golden Cartridge bonus every 5 pickups with countdown bar, 2-step turn queue preventing 180° self-collision, Konami 1-hit Data Shield + 1.5× start bonus, and touch D-pad.
4. **Tetromino Drop**: 10×20 playfield well, fair 7-bag randomizer, SRS-inspired wall kicks, ghost drop shadow, Next Piece preview, distinct monochrome-legible internal block pips, Konami Hold slot (`C`), line-clear flash + 4-line `QUAD!` fanfare, and touch controls.
5. **Synthesized 8-Bit Audio & Telemetry Hygiene**: Zero external audio/image assets, extended Web Audio chiptune synthesizer, page-scroll prevention on arrow/space keys while open, and automatic pause on tab blur/visibility loss.
