---
title: Target Consoles & Systems Cleanup & Redesign
status: implemented
created_at: 2026-11-16T14:30:21Z
implemented_at: 2026-11-16T14:33:00Z
---

# Target Consoles & Systems Cleanup & Redesign

Removes non-system WordPress utility pages (such as `screenshots-wanted`, `sitemap`, and `user-agreement`) from console discovery and existing cached settings, and redesigns **Target Consoles & Systems** on Operations to match the visual polish of the newer **Allowed Game & ROM Types** section.

## User Review & Critical Decisions

> [!IMPORTANT]
> This plan incorporates all three organization, cleanup, and control preferences you confirmed during clarification.

- **Confirmed — Hardware Brand Grouping & Friendly Names**: Organizes discovered systems under hardware brand groups (`Nintendo`, `Sony`, `Sega`, `NEC & SNK`, `Atari, Microsoft & Classic Consoles`, `Arcade & Home Computers`, `System BIOS & Other`) showing friendly console names alongside their quiet monospace slug.
- **Confirmed — Collapsible Advanced Raw Filter**: Moves the raw comma-separated slug text box behind an expandable **Advanced: Raw Filter String** toggle so power users retain direct text editing without visual clutter.
- **Confirmed — Brand Quick-Toggles & Auto-Pruning**: Adds one-click **Select All / Clear** actions per brand group (plus quick brand toggles) and automatically prunes previously cached non-system pages from SQLite on upgrade.

---

## 1. Overview & Core Concept

- **What It Does**: Establishes a two-layer filter against non-system site pages (static denylist + live WordPress Pages/Types validation) paired with a shared console catalog that turns raw repository slugs into grouped, human-readable hardware families.
- **Target Audience & Workflow**: Users configuring which consoles to mirror on Operations can browse by recognizable console names (`Super Nintendo (SNES)`, `Nintendo GameCube`, `PlayStation Portable (PSP)`), select an entire hardware family in one click, or search across both friendly names and slugs.
- **Key Value**: Eliminates confusing non-ROM site routes from ever appearing as selectable consoles while unifying the visual craft across Operations.

---

## 2. User Experience & Visual Design

### Operations Page — Target Consoles & Systems

Rebuilt inside the existing single-elevation CRT surface container using the same checkbox affordances, hairline dividers, and tabular counters as **Allowed Game & ROM Types**:

1. **Header & Scope Summary**:
   - Displays `Target Consoles & Systems`, clear helper copy explaining that leaving none selected mirrors all valid discovered consoles, and a right-aligned tabular counter (`Scope: All Consoles (Unfiltered)` or `Scope: X of Y selected`).
2. **Search, Brand Quick-Toggle Strip & Global Actions**:
   - Search box filters consoles in real time by friendly name, abbreviation, brand, or raw slug (e.g., typing `SNES`, `Nintendo`, or `snes-roms`).
   - Clean global actions (`Select All`, `All Consoles (Unfiltered)`) plus single-line brand quick-toggle buttons (`Nintendo`, `Sony`, `Sega`, etc.) showing active counts (`3/12`) for rapid multi-system selection.
3. **Grouped Console Grid (No Nested Card Boxes)**:
   - Hardware brand sections are separated cleanly by whitespace and hairline top borders (`border-t`) rather than nested cards-within-cards.
   - Each brand header shows the brand name, tabular selection count (`e.g. 2 of 8 selected`), and right-aligned `Select Brand` / `Clear` actions.
   - Each console button displays the **friendly console title** cleanly on top, its **quiet monospace slug** beneath (`tabular-nums` / crisp contrast), and a square checkbox indicator matching **Allowed Game & ROM Types**.
4. **Collapsible Advanced Raw Filter**:
   - A quiet hairline disclosure row (`Advanced: Raw Filter String`) stays collapsed by default and expands smoothly to reveal the raw comma-separated slug input if someone wants to copy/paste a filter list manually.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Dual-Layer Non-System Filtering (Static Denylist + WordPress Pages/Types Check)**:
  - *Chosen Approach*: Combine a shared `NON_SYSTEM_SLUGS` classifier (covering `screenshots-wanted`, `sitemap`, `user-agreement`, `terms`, `privacy-policy`, `dmca`, `guides`, `database`, `platforms`, `faq`, `contact`, `about`, `requests`, etc.) with live WordPress REST verification during **Test Login & Discover Consoles** (excluding any slug returned by `/wp-json/wp/v2/pages` while preserving registered Custom Post Type ROM archives).
  - *Why*: Static rules immediately strip known utility slugs offline and in SQLite without extra network calls, while WordPress `pages` exclusion prevents any future informational page added to RetroGameTalk from polluting the console list.
  - *Alternatives Considered*: Relying solely on a small hardcoded HTML ignore list repeatedly leaks new informational WordPress pages into `discoveredSystems`.

- **Decision 2 — Automatic Sequential Migration to Prune Cached Non-System Slugs**:
  - *Chosen Approach*: Add the next sequential SQLite migration (`v10`, with automatic pre-migration WAL backup) to sanitize existing `discovered_systems_json` and `system_filter` rows in place, and enforce the filter when reading/saving discovered systems.
  - *Why*: Users upgrading an existing database shouldn't have to wipe their config or re-run discovery just to purge `screenshots-wanted`, `sitemap`, or `user-agreement`.

- **Decision 3 — Friendly Display Names with Graceful Slug Fallback**:
  - *Chosen Approach*: Map all known RetroGameTalk console slugs and alias variants (`gb-roms`/`gameboy-roms`, `gamecube`/`gcn-iso`, `psx2psp-eboots`, `pc-engine-roms`/`turbografx-16`, etc.) to canonical brand groups and friendly titles, while formatting any unknown future system slug cleanly into title case under `System BIOS & Other`.
  - *Why*: Guarantees zero missing systems if RetroGameTalk introduces a brand-new console archive while giving every existing console crisp, recognizable naming.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Shared System Catalog & Non-System Classifier                           │
│ · NON_SYSTEM_SLUGS filter (screenshots-wanted, sitemap, user-agreement) │
│ · Hardware brand groups & friendly console display metadata             │
│ · Search matcher (name + abbreviations + brand + slug)                  │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    ▼                                 ▼
┌───────────────────────────────────────┐ ┌───────────────────────────────┐
│ Discovery & SQLite Cleanup (Schema v10)│ │ Operations Consoles UI        │
│ · HTML link scan skips non-systems    │ │ · Brand quick-toggle strip    │
│ · Live WP /pages exclusion in probe   │ │ · Hairline-grouped grids with │
│ · Migration v10 prunes cached slugs   │ │   friendly names & checkboxes │
│ · Read/write sanitization guards      │ │ · Collapsible Advanced input  │
└───────────────────────────────────────┘ └───────────────────────────────┘
```

### Data Model & Interactive State Mapping

- **Database Schema Upgrade**: Migration `v10` prunes invalid non-system slugs from `discovered_systems_json` and `system_filter` while preserving all valid selected consoles and custom slugs.
- **Interactive Controls**: Brand quick-toggles compute the union/difference against `selectedSystems` in memory and reflect immediately in the tabular header counter and collapsible **Advanced** input string before saving via `PUT /api/config`.
