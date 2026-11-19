---
title: Console-Style Trophy & Achievements System (60 Trophies)
status: implemented
created_at: 2026-11-19T06:14:25Z
implemented_at: 2026-11-19T06:30:00Z
---

# Console-Style Trophy & Achievements System (60 Trophies)

Introduce a console-inspired **Trophy & Achievements System** into RetroGameTalk Sync—complete with **60 handcrafted trophies** across Bronze, Silver, Gold, and Platinum tiers, SQLite-backed persistence synced across browsers and headless cron runs, retro synthesized Web Audio trophy chimes, quiet first-launch baseline catch-up, and a compact top-header Trophy Case drawer.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed design decisions from clarification are locked into this plan:
>
> - **Console Style & Rarity**: PlayStation-inspired Trophy Tiers — **Bronze** (`15 pts`), **Silver** (`30 pts`), **Gold** (`90 pts`), and **Platinum** (`180 pts`) with explicit tier icons and labels.
> - **UI Placement**: Compact single-line Trophy button in the top header opening a smooth slide-over **Trophy Case Drawer**.
> - **Persistence**: Server-side **SQLite** database tables (automatic transactional migration `v19`) pushed live to all open tabs via SSE—works seamlessly across browsers and unattended cron syncs.
> - **First-Launch Pacing**: **Silent baseline catch-up** for already-met library milestones on existing installs, plus an anti-jarring startup guard so no toast ever fires passively on first page load.

---

## 1. Overview & Core Concept

- **What It Does**: Celebrates real preservation milestones, collection diversity, catalog curation, handheld SD card exporting, CRT hardware tinkering, homelab resilience, and hidden secrets—turning long-term retro archiving into a genuinely rewarding console-style progression experience without interrupting operational workflows.
- **Target Audience / Persona**: Retro gaming enthusiasts, ROM hack & fan-translation collectors, handheld players, and homelab archivists who appreciate modern console trophy hunting paired with authentic 8-bit/16-bit audio feedback.
- **Key Value**: Gives users a tangible, persistent record of their archival journey across months of syncing and curation, with live progress bars toward upcoming milestones and zero noisy startup popups.

### Implemented 60-Trophy Roster *(30 Bronze · 21 Silver · 8 Gold · 1 Platinum · 1,980 Max Points)*

- **Preservation & Archiving (13)**: First Contact, First Signal, Scout Ahead, First Cartridge, Starter Shelf, Local Arcade, Cartridge Vault, Digital Museum, Preservation Titan, First Gigabyte, Tape Library, Homelab Hoarder, Terabyte Archivist.
- **Console & Era Collector (10)**: Multi-System Owner, Console Historian, Living Museum, Complete Spectrum, Pocket Brigade, 16-Bit Golden Age, Polygon Pioneers, Lost in Translation, ROM Hacker, Indie & Unreleased.
- **Catalog Curation & Inspection (10)**: Catalog Indexer, Deep Index, Deep Inspection, Pixel Peeker, Inside the Archive, Filter Wizard, Dual Perspective, Data Cartographer, Precision Sniper, Clean Slate.
- **Handheld & SD Card Installer (8)**: Clean Cut, Ready for Takeoff, Pocket Loadout, Flashcart Overload, Express Courier, Folder Architect, Version Upgrader, Multi-Platform Handheld.
- **CRT Display Studio & Homelab Ops (7)**: Amber Nostalgia, Cyan Phosphor, Maximum CRT, Tube Calibration, Autopilot, Curator's Rules, Polite Citizen.
- **Resilience & Quirks (5)**: Weathering the Storm, Never Give Up, Night Owl Archivist, Uncapped Expedition, Cron Veteran.
- **Secret / Hidden Trophies (7)**: 6 masked `Hidden Trophy` secrets (with per-trophy `"Reveal Hint"` toggles) + the **Master Preservationist** Platinum trophy (auto-unlocked when all 59 other trophies are earned).

---

## 2. User Experience & Visual Design

1. **Zero-Noise First Startup & Silent Baseline Catch-Up**: On first boot after migration `v19`, the server evaluates pre-existing SQLite library/run history and records already-earned milestones silently (`silent = 1, seen = 1`), preventing any startup toast storm. Brand-new installs unlock zero trophies passively on page load.
2. **Console-Style Trophy Unlock Toast**: Serialized bottom-right notification with smooth `cubic-bezier(0.22, 1, 0.36, 1)` motion, tier medallion + explicit tier label, point reward, and tier-distinct procedural Web Audio chimes (Bronze, Silver, Gold, Platinum). Bursts of `4+` unlocks coalesce into 2 lead toasts plus 1 summary toast.
3. **Top-Header Trophy Button & Slide-Over Trophy Case Drawer**: Single-line header button (`Trophy` icon + tabular count, subtle phosphor highlight when unseen unlocks exist) opening a smooth slide-over Trophy Case Drawer featuring overall completion bar, unboxed tier counts, inline SFX mute and Quiet Mode toggles, live search, status/category filters, progress bars, and optional secret hint reveals.

---

## 3. Technical Architecture & Data Strategy

- **SQLite Schema Migration `v19` (`achievements_system`)**: Adds `achievements_state`, `achievement_counters`, and `achievements_meta` tables inside `scraper.db`.
- **Hybrid Server + Client Engine**: Server hooks evaluate sync runs, mirrored files/bytes/consoles/eras, throttle recovery, chunk resumes, retries, catalog indexing, archive inspection, prepared downloads, and config updates, pushing `achievement_unlocked` events over `/api/events` SSE. Client interactions (detail drawer, lightbox, filter combos, view switches, SD installs, CRT Studio, and hidden cabinet milestones) report to `POST /api/achievements/event`.
- **API Endpoints**: `GET /api/achievements`, `POST /api/achievements/event`, `POST /api/achievements/seen`.
- **Automated Verification**: Unit tests in `tests/achievements.test.ts` covering catalog integrity (60 trophies, 1,920 max points), toast burst coalescing, silent baseline catch-up, live client unlocks & idempotency, seen clearing, and Platinum auto-unlock.
