---
title: ROM Filename Formatting Rework (Device Export Step 02)
status: implemented
created_at: 2026-11-25T16:35:20Z
implemented_at: 2026-11-25T16:45:00Z
---

# ROM Filename Formatting Rework (Device Export Step 02)

Rework **Device Export → 02. ROM Filename Formatting** around modern **No-Intro + T-En** patched ROM naming standards, introducing type-aware status vs. patch tokens, optional per-type template overrides, and a live all-type preview matrix powered by both curated examples and real indexed catalog releases.

---

## Confirmed Design Decisions

- **Default Tagging Convention**: **No-Intro + T-En Hybrid** (`( )` parentheses for origin, region, and commercial/development status; `[ ]` square brackets for post-release fan patches and modifications).
- **Multi-Type Configuration**: **Smart Single Global Template** using type-aware tokens, paired with **optional per-type template overrides** for any ROM category customized individually.
- **Live Preview Inside Step 02**: **All-Type Live Preview Matrix** embedded directly inside Step 02 covering all 10 ROM types, with a toggle between **Built-in Examples** and **Real Catalog Games** (plus a shuffle control).
- **Metadata Token Scope**: Focused token set supporting **separate status vs. patch tokens**, **language-aware translation & machine-translation tags** (`T-En`, `T-Es`, `T-En MTL`), and **patch/revision versions** (`v1.42`, `Rev A`).
- **Non-Destructive Rollout**: New installations default automatically to `{title}{regionParen}{statusParen}{modBracket}`; existing installations preserve their saved template until the user switches presets, while `buildUpgradeMatchStem` recognizes both legacy `[Proto]` and hybrid `(Proto)` tags so SD card upgrades never leave duplicates.

---

## Target Naming Output Across All ROM Types

Using the **No-Intro + T-En Hybrid** default (`{title}{regionParen}{statusParen}{modBracket}`):

| ROM Type | Status (`{statusParen}`) | Patch / Mod (`{modBracket}`) | Formatted Output Example |
| --- | --- | --- | --- |
| **Retail ROM** | `(Rev A)` *(if revision exists)* | *(none)* | `Chrono Trigger (USA).sfc` |
| **Fan Translation** | *(none)* | `[T-En v1.3]` / `[T-Es v2.0]` | `Mother 3 (Japan) [T-En v1.3].gba` |
| **Machine Translation** | *(none)* | `[T-En MTL v1.0]` | `Bahamut Lagoon (Japan) [T-En MTL v1.0].sfc` |
| **ROM Hack** | *(none)* | `[Hack v1.42]` | `Super Mario World (USA) [Hack v1.42].sfc` |
| **Undub** | *(none)* | `[Undub v1.1]` | `Final Fantasy X (USA) [Undub v1.1].chd` |
| **Homebrew & Indie** | `(Homebrew)` *(or `(Homebrew v1.2)`)* | *(none)* | `Micro Mages (World) (Homebrew).nes` |
| **Port / Demake** | `(Port)` *(or `(Port v1.0)`)* | *(none)* | `Celeste Classic (World) (Port).gba` |
| **Prototype / Beta** | `(Proto)` *(or `(Proto Beta 1)`)* | *(none)* | `Star Fox 2 (USA) (Proto).sfc` |
| **Demo / Sample** | `(Demo)` | *(none)* | `Metroid Prime (USA) (Demo).rvz` |
| **Bootleg & Unlicensed** | `(Unl)` | *(none)* | `Somari (Asia) (Unl).nes` |
| **Compound Release** *(e.g. Translated Prototype)* | `(Proto)` | `[T-En v1.1]` | `EarthBound Beginnings (Japan) (Proto) [T-En v1.1].nes` |

---

## Architecture & Implementation Summary

- **Shared Naming Engine**: Added dual-channel status `()` / mod `[]` resolution, language-aware MTL tagging (`T-En MTL`, `T-Es MTL`, fallback `MTL`), smart version attachment, `romNamingTypeOverrides` lookup & normalization, `formatPreparedRomNameDetailed` (with FAT32 sanitization/truncation flags, segment tokenization, and resolved token maps), `validateRomNamingTemplate`, and cross-convention `buildUpgradeMatchStem`.
- **SQLite Migration v29 & API**: Added `rom_naming_type_overrides_json` to `scraper_config`, extended device profile `romNaming` overrides and secret-free config backup export/import, wired overrides into server-side archive inspection, and added read-only `GET /api/device-export/naming-samples` for real-catalog preview sampling with rotation seeds.
- **Step 02 UI Rework**: Built a dedicated `RomFilenameFormattingSection` featuring 4 presets (No-Intro + T-En Hybrid, Uniform Brackets Legacy, Clean Handheld Display, Original Inner Name), an always-visible 10-row live preview matrix with `Built-in Examples` / `Real Catalog Games` toggle + `Shuffle`, syntax-tinted filenames, tabular character counts & FAT32/truncation indicators, cursor-aware token insertion with live hover inspection, inline syntax validation, and optional per-type template overrides.
