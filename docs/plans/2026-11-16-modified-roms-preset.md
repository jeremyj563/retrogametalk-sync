---
title: Modified & Community ROMs Preset ("Hacks, Translations, Homebrew & Ports")
status: implemented
created_at: 2026-11-16T14:06:27Z
implemented_at: 2026-11-16T14:12:00Z
---

# Modified & Community ROMs Preset ("Hacks, Translations, Homebrew & Ports")

Adds a one-click **Hacks, Translations, Homebrew & Ports** preset to the **Allowed Game & ROM Types** preset bar on Operations, allowing users to mirror all ROM hacks, fan and machine/AI translations, homebrew/indie releases, and ports while excluding retail dumps, undubs, BIOS, demos, bootlegs, DLC, and PSX2PSP packages.

## User Review & Critical Decisions

> [!IMPORTANT]
> This plan reflects all three scope and naming decisions you confirmed during clarification.

- **Confirmed — Full Translation Coverage**: Includes both all fan-translated languages and **Machine / AI Assisted** (`MTL`) patches so every translated release is captured under this preset.
- **Confirmed — Exact Category Scope**: Includes strictly **ROM Hacks**, **Translations** (all languages + Machine/AI), **Homebrew & Indie**, and **Ports** — excluding Retail ROMs, Undubs, BIOS, Demos & Prototypes, Bootlegs, DLC, and PSX2PSP.
- **Confirmed — Unified Label**: Uses **`Hacks, Translations, Homebrew & Ports`** as both the Operations quick-preset button label and the active **Type Filter** summary displayed on Overview.

---

## 1. Overview & Core Concept

- **What It Does**: Extends the shared release type preset catalog with a canonical preset entry that populates the allowlist in one click, updates all corresponding category and language toggles (including the Machine / AI toggle), and displays the exact preset name in Overview's active filter readout.
- **Target Audience & Workflow**: Users who already maintain retail sets elsewhere—or want a dedicated mirror strictly for community-created, fan-translated, modded, homebrew, and ported software—without manually checking multiple categories and translation sub-options.
- **Key Value**: Single-click configuration with automatic canonical preset recognition across Operations, persisted SQLite configuration, and Overview status summaries.

---

## 2. User Experience & Visual Design

### Operations Preset Row & Category Sync

Inside the **Allowed Game & ROM Types** section on Operations:

1. **Quick Preset Button**:
   - Appears alongside `Retail Only`, `Retail + English Translations`, `Retail + Hacks + English`, and `All Fan Translations` using matching single-elevation CRT flat button tokens (`crt-bg`, `crt-border`, `crt-phosphor` active highlight), `whitespace-nowrap shrink-0`, and tabular alignment—no pill capsules or multi-line wrapping inside the button label.
2. **Instant Visual State Sync**:
   - Clicking **Hacks, Translations, Homebrew & Ports** switches the mode bar to **Selected Types Only**, activates `Translations`, `ROM Hacks`, `Homebrew & Indie`, and `Ports` in the curated grid, checks **All Fan Translation Languages** (lighting up all 13 language toggles), and activates **Machine / AI Assisted (`MTL`)**.
   - **Undub** and **Retail ROM** (along with BIOS, Demos, Bootleg, DLC, and PSX2PSP) remain unchecked unless the user manually customizes them afterward.
3. **Overview Scope Readout**:
   - Once saved, Overview renders `Type Filter: Hacks, Translations, Homebrew & Ports` in the standby/active runner status strip with its existing **Edit Filters** shortcut back to Operations.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Canonical Key Ordering for Preset Detection**:
  - *Chosen Approach*: Store the preset's allowlist values in exact canonical taxonomy sort order (`translations`, `machine_translation`, `hack`, `homebrew`, `port`) matching the shared allowlist normalizer.
  - *Why*: Both the Operations active-preset highlighter and Overview's summary formatter compare normalized arrays directly by index. Aligning canonical order guarantees clicking the preset—or manually toggling those exact categories/languages—automatically highlights the preset button and renders the clean **`Hacks, Translations, Homebrew & Ports`** label without extra mapping tables.
  - *Alternatives Considered*: Adding special-case label overrides in UI components alone would cause Overview and Operations to diverge if toggled manually.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Shared Release Type Presets & Normalizer                             │
│ · Add preset id: "modified_community"                                │
│ · Label: "Hacks, Translations, Homebrew & Ports"                     │
│ · Canonical values: [translations, machine_translation,              │
│                      hack, homebrew, port]                           │
└───────────────────┬──────────────────────────────┬───────────────────┘
                    │                              │
                    ▼                              ▼
┌────────────────────────────────────┐ ┌───────────────────────────────┐
│ Operations Preset Bar & Grid       │ │ Overview Scope Summary        │
│ · Renders preset button in row     │ │ · Exact preset match outputs  │
│ · Toggles category & MTL states    │ │   "Hacks, Translations,       │
│ · Persists via existing PUT config │ │    Homebrew & Ports"          │
└────────────────────────────────────┘ └───────────────────────────────┘
```

### Data Model & Interactive State Mapping

- **Zero Schema Changes Needed**: Existing SQLite schema (`allowed_release_types_json`) and `/api/config` endpoints already validate and persist every key in this preset (`translations`, `machine_translation`, `hack`, `homebrew`, `port`).
- **Sync & Dry Run Parity**: Existing pre-download release-level and per-file gates automatically evaluate all five keys across Incremental Sync, Full Sync, Scheduled Cron, and Dry Run without altering orchestrator logic.
