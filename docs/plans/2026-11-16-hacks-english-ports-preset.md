---
title: Hacks + English + Ports Release Type Preset
status: implemented
created_at: 2026-11-16T14:21:16Z
implemented_at: 2026-11-16T14:22:00Z
---

# "Hacks + English + Ports" Release Type Preset

Replaces the previous `Hacks, Translations, Homebrew & Ports` quick preset on Operations with **Hacks + English + Ports**, narrowing translation matching strictly to English (plus Machine / AI Assisted patches) while keeping ROM Hacks, Homebrew & Indie, and Ports enabled.

## User Review & Critical Decisions

> [!IMPORTANT]
> This plan captures all three confirmed refinements for the updated preset.

- **Confirmed — Replace Previous Preset**: Replaces `Hacks, Translations, Homebrew & Ports` directly in the Operations preset bar and Overview summary resolver rather than keeping two overlapping presets.
- **Confirmed — English + Machine/AI Translation Scope**: Selects strictly **English** under fan translation languages alongside **Machine / AI Assisted** (`MTL`), leaving non-English human translations unchecked.
- **Confirmed — Retain Homebrew & Indie**: Keeps **ROM Hacks**, **Homebrew & Indie**, and **Ports** active alongside the English translation scope (excluding Retail ROMs, Undubs, BIOS, Demos & Prototypes, Bootlegs, DLC, and PSX2PSP).

---

## 1. Overview & Core Concept

- **What It Does**: Updates the shared community/modified preset definition so a single click selects English translations, Machine / AI Assisted translations, ROM Hacks, Homebrew & Indie, and Ports.
- **Target Audience & Workflow**: English-speaking users mirroring fan mods, translations, homebrew, and ports without pulling down non-English language packs or duplicating Retail/Undub/BIOS libraries.
- **Key Value**: Cleaner preset naming in the Operations toolbar and Overview readout with precise single-language translation filtering.

---

## 2. User Experience & Visual Design

### Operations Preset Button & Toggle Sync

Inside **Allowed Game & ROM Types** on Operations:

1. **Updated Preset Button**:
   - Displays **`Hacks + English + Ports`** in the quick-preset row using the existing single-elevation CRT flat button styling (`crt-bg`, `crt-border`, `crt-phosphor` active highlight) and single-line `whitespace-nowrap shrink-0` sizing.
2. **Exact Selection State**:
   - Clicking **`Hacks + English + Ports`** switches mode to **Selected Types Only**, highlights `Translations (2 selected)`, `ROM Hacks`, `Homebrew & Indie`, and `Ports` in the curated grid, checks only **`EN English`** in the language matrix, and activates **`MTL Machine / AI Assisted`**.
   - **All Fan Translation Languages** and all non-English language toggles remain unchecked.
3. **Overview Scope Summary**:
   - When saved, Overview displays `Type Filter: Hacks + English + Ports` in the runner status header alongside the **Edit Filters** shortcut.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Canonical Ordering of English + MTL Keys**:
  - *Chosen Approach*: Store the preset's allowlist values in canonical taxonomy order (`translation:english`, `machine_translation`, `hack`, `homebrew`, `port`).
  - *Why*: Guarantees exact array equality in both Operations' active-preset matcher and Overview's summary formatter, even if a user arrives at the exact same combination by clicking category and language buttons manually.
  - *Alternatives Considered*: Keeping `translations` (all languages) or duplicating preset buttons would clutter the preset bar and pull unwanted foreign-language patches.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│ Shared Release Type Presets & Normalizer                             │
│ · Update preset id: "modified_community"                             │
│ · Label: "Hacks + English + Ports"                                   │
│ · Canonical values: [translation:english, machine_translation,       │
│                      hack, homebrew, port]                           │
└───────────────────┬──────────────────────────────┬───────────────────┘
                    │                              │
                    ▼                              ▼
┌────────────────────────────────────┐ ┌───────────────────────────────┐
│ Operations Preset Bar & Grid       │ │ Overview Scope Summary        │
│ · Renders "Hacks + English + Ports"│ │ · Exact preset match outputs  │
│ · Checks EN + MTL + Hack/HB/Port   │ │   "Hacks + English + Ports"   │
│ · Persists via existing PUT config │ │                               │
└────────────────────────────────────┘ └───────────────────────────────┘
```

### Data & Sync Compatibility

- **Zero Schema Migration Required**: Existing SQLite storage (`allowed_release_types_json`) and `/api/config` endpoints store the updated key list natively.
- **Pre-Download Sync & Dry-Run Parity**: Releases tagged with non-English translations (e.g., Spanish, French, Japanese, Chinese) are skipped cleanly before resolving download links unless they also match `translation:english`, `machine_translation`, `hack`, `homebrew`, or `port`.
