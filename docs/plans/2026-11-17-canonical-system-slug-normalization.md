---
title: Canonical System Slug Normalization & Deduplication
status: implemented
created_at: 2026-11-17T18:15:50Z
implemented_at: 2026-11-17T18:28:00Z
---

# Canonical System Slug Normalization & Deduplication

End-to-end normalization of RetroGameTalk system identifiers so consoles whose WordPress Custom Post Type slug differs from their public URL directory (`gb_roms` vs `gameboy-roms`, `gbc_roms` vs `gameboy-color-roms`, `gcn-iso` vs `gamecube`, `psx2psp` vs `psx2psp-eboots`) resolve to a single canonical slug across discovery, crawling, SQLite storage, and the UI. This eliminates duplicate console cards in Sync Rules, double-scanning during sync runs, and split per-system catalog statistics.

---

### User Review & Critical Decisions

- **Canonical Slug Format (Confirmed)**: Prefer RetroGameTalk's **public URL directory slugs** (`gameboy-roms`, `gameboy-color-roms`, `gamecube`, `psx2psp-eboots`) over internal WordPress CPT identifiers (`gb_roms`, `gbc_roms`, `gcn-iso`, `psx2psp`), keeping downloaded archives aligned with existing on-disk directories.
- **Existing Data & Config Cleanup (Confirmed)**: **Auto-migrate on startup** via a transactional schema migration (v15) that remaps stored catalog releases, discovered console lists, saved system filters, and device export folder overrides to canonical slugs without moving files on disk.
- **Sync Rules Console Card Presentation (Confirmed)**: Render **one consolidated tile per console** showing only the canonical slug, while transparently matching underlying WordPress API aliases when the user types into the console search bar.

---

### 1. Overview & Core Concept

- **What It Does**: Establishes a shared single source of truth (`CANONICAL_SYSTEM_ALIAS_GROUPS`, `canonicalizeSystemSlug`, `getSystemAliases`, `expandSystemAliases`) and applies canonicalization across link extraction, download metadata resolution, sync execution deduplication, database persistence, and Sync Rules filtering/search.
- **Key Value**:
  - Removes duplicate console cards (e.g., two `Game Boy` tiles and two `Game Boy Color` tiles).
  - Prevents unfiltered or multi-select syncs from querying the exact same WordPress REST endpoint twice in a single run.
  - Consolidates catalog release counts and storage folder overrides under one consistent console key while preserving backward compatibility for environment variable filters (`SCRAPER_SYSTEM_FILTER=gb_roms`).

---

### 2. Technical Architecture & Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                 RetroGameTalk Origin (WordPress + CPTs)                  │
│   Public URLs: /repo/gameboy-roms/...   WP REST / ?platform=: gb_roms    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                  Crawler & Link Extractor Normalization                  │
│  • HTML/Dynamic links (?platform=gb_roms) ──► canonicalizeSystemSlug()   │
│  • WP REST lookup: canonical slug ──► resolveWpRestBase() ("gb_roms")    │
│  • Run queue: deduplicate targetSystems by canonical slug + restBase     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                 Shared System Catalog & Alias Registry                   │
│  • CANONICAL_SYSTEM_ALIAS_GROUPS (URL slug ◄── aliases ──► WP CPT slug)  │
│  • canonicalizeSystemSlug() / getSystemAliases() / filterValidSlugs()    │
│  • Storage Folder Mapping merge (remaps alias overrides on load/save)    │
└──────────────┬───────────────────────────────────────────┬───────────────┘
               │                                           │
               ▼                                           ▼
┌──────────────────────────────┐            ┌──────────────────────────────┐
│   SQLite Store & Startup     │            │    Frontend Rules & Search   │
│   Migration (Schema v15)     │            │  • Single canonical tile     │
│  • Merge catalog_releases    │            │  • Search matches friendly   │
│  • Clean discoveredSystems   │            │    name, slug, & API aliases │
│  • Remap system_filter &     │            │  • Unified Export Mappings & │
│    storage folder overrides  │            │    Sidebar release totals    │
└──────────────────────────────┘            └──────────────────────────────┘
```
