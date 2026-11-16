---
title: Sync Release Type Filtering on Operations
status: implemented
created_at: 2026-11-16T13:46:55Z
implemented_at: 2026-11-16T13:52:00Z
---

# Sync Release Type Filtering on Operations

Allows users to choose exactly which game and ROM categories (Retail ROMs, Translations by language, ROM Hacks, Ports, Homebrew, BIOS, Demos & Prototypes, and other non-retail types) are mirrored during sync runs via global allowlist toggles on the Operations page. Releases outside the selected types are evaluated early during discovery and skipped before resolving download links, incrementing skipped totals and logging clear reasons.

## User Review & Critical Decisions

> [!IMPORTANT]
> The plan below incorporates your three confirmed design choices from clarification and highlights two safeguard defaults designed to prevent accidental empty syncs.

- **Confirmed — Global Allowlist Model**: Release type rules are configured globally on Operations and apply across all synced systems (both manual Incremental/Full runs, Dry Runs, and Scheduled Cron runs).
- **Confirmed — Curated Categories + Grouped Translations**: Types are organized into clean curated categories with a grouped **Translations** section offering an **All Translation Languages** toggle alongside individual language selections (`English`, `Spanish`, `French`, `Portuguese`, `German`, `Italian`, `Russian`, `Chinese`, `Korean`, `Polish`, `Arabic`, `Catalan`, plus `Machine / AI Assisted`).
- **Confirmed — Pre-Download Skip & Logging**: Disallowed releases and files are filtered out before resolving dynamic download links and counted in each run's `skippedCount` with transparent activity log messages.
- **Upgrade & Validation Default**: Existing installations migrate cleanly with **All Release Types** active (`unfiltered` by default) so existing sync schedules continue working uninterrupted until customized; selecting **Custom Allowlist** requires at least one enabled type before saving.

---

## 1. Overview & Core Concept

- **What It Does**: Introduces a persistent global Release Type Allowlist policy shared between configuration storage, the Operations control surface, Overview run scope indicators, and the server sync orchestrator.
- **Target Audience & Workflow**: Preservationists and handheld users who want to mirror curated sets—for example, only `Retail ROM` + `English Translations` without `ROM Hacks`, `Machine Translations`, `Demos`, or foreign-language patches—while preserving RetroGameTalk's fast delta-sync performance.
- **Key Value**: Avoids wasting bandwidth, storage, and RetroGameTalk rate-limiter budget on unwanted release categories or non-target translation patches inside multi-file releases.

---

## 2. User Experience & Visual Design

### Operations Page Workflow

On Operations, a new **Allowed Game & ROM Types** section sits immediately below **Target Consoles & Systems** (using matching single-elevation CRT surface framing, hairline borders, `crt-phosphor` active toggles, and tabular counts):

1. **Scope Header & Quick Presets**:
   - Displays current policy summary (e.g., `Scope: All Types (Unfiltered)` or `Scope: 3 categories enabled`).
   - Top segmented mode bar switches between **All Release Types** (default unfiltered) and **Selected Types Only** (custom allowlist), alongside one-click preset buttons (`Retail Only`, `Retail + English`, `Retail + Hacks + English`, `All Translations`).
2. **Curated Category Toggle Grid**:
   - Clean, responsive grid of interactive toggle buttons covering curated release types (`Retail ROM`, `ROM Hacks`, `Translations`, `Undub`, `Homebrew`, `Ports`, `BIOS / System`, `Demos & Prototypes`, `Bootleg & Unlicensed`, `DLC & Updates`, `PSX2PSP / Eboot`).
   - Each card uses high-contrast text, an interactive checkbox/check affordance, and a short 1-line description explaining what matches (e.g., *"Official commercial cartridge/disc dumps"* or *"Fan-modified gameplay, Redux, MSU-1, or randomizers"*). Zero pill badge clutter.
3. **Grouped Translations Language Panel**:
   - Nested cleanly via hairline spacing when **Translations** is toggled (or previewed disabled when off):
     - Master toggle for **All Translation Languages** (allows every translated release regardless of target language).
     - Or granular language buttons (`English`, `Spanish`, `French`, `Portuguese`, `German`, `Italian`, `Russian`, `Chinese`, `Korean`, `Polish`, `Arabic`, `Catalan`, plus an explicit opt-in toggle for `Machine / AI Assisted` translations so low-quality MTL releases can be excluded cleanly).
4. **Validation & Unified Save Footer**:
   - Switching to **Selected Types Only** with zero categories checked highlights an amber inline warning and disables Save until at least one type is enabled.
   - Saving persists the allowlist to SQLite and immediately surfaces a brief active scope summary on Overview (`Types: ...`) when filtered so users never wonder why a sync run skipped certain titles.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Canonical Curated Buckets Mapping Raw Tags & File Roles**:
  - *Chosen Approach*: Define a shared canonical classifier mapping both release-level WordPress tags (`genres`, `languages`, `sources`, `formats`) and per-file roles (`classifyFileRole`) into curated type keys (`retail`, `translation`, `translation:<lang>`, `machine_translation`, `hack`, `undub`, `homebrew`, `port`, `bios`, `demo_proto`, `bootleg`, `dlc`, `psx2psp`).
  - *Why*: Users think in practical groups (*"Demos & Prototypes"* or *"Spanish Translation"*), whereas raw upstream pages mix taxonomies across WordPress genres, languages, sources, and archive filenames. A single shared mapping keeps Operations UI, Overview badges, and orchestrator filtering 100% consistent.
  - *Trade-Off*: New exotic upstream tags discovered in the future safely map to a fallback or remain searchable in Catalog without breaking saved allowlists.

- **Decision 2 — Two-Stage Pre-Download Evaluation (Release Gate + Multi-File Gate)**:
  - *Chosen Approach*: Evaluate the allowlist in two places during sync:
    1. **Release Metadata Gate** (using WordPress REST taxonomies + HTML ROM Info table *before* clicking/resolving dynamic download links). If all identified release-level types are excluded (e.g., an explicitly tagged `Hack`, `Bootleg`, or `French Patched` single-type release), skip the entire release immediately and increment `skippedCount`.
    2. **Per-File Role Gate** (for multi-file releases such as pages bundling an `Original ROM` alongside an `English Translation` archive). Even when the overall page passes, only download individual files whose classified role matches the allowlist, skipping disallowed files cleanly before requesting archives.
  - *Why*: Eliminates wasted nonce resolution POST requests and redundant HTML fetches while still allowing surgical extraction (e.g., grabbing only the English-patched archive from a release page that also hosts Japanese original or Spanish patches).
  - *Alternatives Considered*: Filtering only after full download wastes bandwidth; filtering solely on top-level WP post type misses multi-file pages and filename-tagged hacks.

- **Decision 3 — Retries & Dry Run Parity**:
  - *Chosen Approach*: Incremental Sync, Full Sync, Scheduled Sync, and Dry Run all honor the configured allowlist—so Dry Run accurately previews `"Would skip (type filter)"` vs `"Would download"` counts. Explicit user-initiated item retries for existing failed items remain allowed on demand unless part of a bulk sync rule.
  - *Why*: Ensures users can safely test a new allowlist rule via **Dry Run** on Overview before committing disk space or network traffic.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Shared Taxonomy & Type Policy Module                                    │
│ · Curated type definitions, Translation languages, Quick Presets        │
│ · Normalizers & matchesAllowedReleaseTypes(tags/roles, allowedList)     │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    ▼                                 ▼
┌───────────────────────────────────────┐ ┌───────────────────────────────┐
│ Operations UI & Overview Scope Readout│ │ SQLite Persistence (Schema v9)│
│ · All vs Custom mode + Quick Presets  │ │ · scraper_config column:      │
│ · Curated type toggles & descriptions │ │   allowed_release_types_json  │
│ · Grouped Translations + Languages    │ │ · Optional env override parity│
│ · Validation + Save to /api/config    │ │   + audit config defaults     │
└───────────────────────────────────────┘ └──────────────┬────────────────┘
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Sync Orchestrator Pre-Download Filter Pipeline                          │
│                                                                         │
│ 1. WP REST Post List ──► Fast Taxonomies Check (skip before HTML fetch) │
│           │ (if potentially matching or unclassified)                   │
│           ▼                                                             │
│ 2. Release HTML + ROM Info ──► Pre-Nonce Release Type Gate              │
│           │ (if disallowed -> log skipped + skippedCount++, abort)      │
│           ▼                                                             │
│ 3. Dynamic Link Extraction ──► Per-File Role Allowlist Filter           │
│           │ (download allowed files; skip & log disallowed sibling ROMs)│
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model & API Surface

- **Database Schema Upgrade**: Append the next sequential migration to add `allowed_release_types_json TEXT NOT NULL DEFAULT '[]'` to `scraper_config` with automatic pre-migration WAL backup. Empty array `[]` encodes **All Release Types (Unfiltered)**.
- **Shared Configuration DTO**: Extend `ScraperConfigPublic` / `ConfigUpdateInput` with `allowedReleaseTypes: string[]` across server config validation, `GET /api/config`, and `PUT /api/config` (validating against known curated keys and language codes).
- **Interactive Component & State Mapping**:
  - **Mode Switch (`All` / `Custom`)**: `All` sets draft `allowedReleaseTypes = []`; `Custom` initializes from current selection or `['retail']` and renders the interactive category matrix and grouped Translation language controls.
  - **Quick Preset Buttons**: Populate curated allowlist arrays cleanly in one click while keeping custom adjustments open before hitting **Save Configuration**.
  - **Dry Run & Sync Counters**: Skipped releases/files emit structured `'info'` activity logs (`[Type Filter] Skipped <Title> (<detected types>)`) and increment `skippedCount` accurately on both real runs and Dry Runs.
