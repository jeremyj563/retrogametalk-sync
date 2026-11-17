---
title: Configuration & Settings Reorganization
status: implemented
created_at: 2026-11-17T06:36:28Z
implemented_at: 2026-11-17T06:50:00Z
---

# Configuration & Settings Reorganization

Reorganizes the overcrowded **Operations** and clunky **Schedule** views into three clear, intent-driven configuration pages—**Sync Rules**, **Device Export**, and **System Settings**—while replacing raw cron syntax and intimidating "Adaptive AIMD Rate-Limit Guard" networking parameters with approachable visual controls and mellow, non-snapping transitions.

## User Review & Critical Decisions

> [!IMPORTANT]
> Your confirmed preferences from the clarification step shape the new navigation layout, scheduling workflow, and rate-limit controls below. Review the proposed preset definitions and navigation mapping before clicking **Proceed**.

- **Confirmed — Three Purpose-Built Configuration Pages**: The left sidebar moves from four items (`Sync`, `Catalog`, `Schedule`, `Operations`) to five focused items: **Sync**, **Catalog**, **Sync Rules**, **Device Export**, and **System Settings**.
- **Confirmed — Friendly Crawl Speed Presets + Collapsible Advanced Tuning**: Retires the "Adaptive AIMD Rate-Limit Guard" jargon in favor of **Request Pacing & Rate Protection** with three plain-English speed profiles (**Gentle**, **Balanced**, **Brisk**), a live plain-language behavior summary, and a smooth, collapsible **Advanced Network & Retry Tuning** drawer for power users and environment-locked overrides.
- **Confirmed — Visual Schedule Picker + Custom Cron**: Replaces the raw cron-first box with a visual **Automatic Sync Schedule** card (at the top of **Sync Rules**) supporting **Interval** (`Every 1–12 Hours`), **Daily** (time-of-day selector), **Weekly** (day-of-week + time-of-day selector), and **Custom Cron** (with live plain-English translation and syntax validation).
- **Seamless Deep-Link & Bookmark Continuity (Default)**: All existing in-app shortcut links (such as *Edit Consoles*, *Edit Release Types*, *Verify Credentials*, and *Edit Folder Mappings* inside the SD Card Installer) and legacy URL hashes (`#schedule`, `#operations/...`) automatically route to and spotlight their new home without breaking browser history.

---

## 1. Overview & Core Concept

- **What It Does**: Splits configuration cleanly by user intent instead of mixing server credentials, sync scope filters, cron strings, low-level HTTP backoff math, and handheld SD card preparation onto the same screens:
  1. **Sync Rules** (*When & what to mirror*): Automatic Sync Schedule, Target Consoles & Systems, and Allowed Game & ROM Types (including fan/machine translation rules).
  2. **Device Export** (*How mirrored ROMs are formatted for handhelds & storage media*): Prepared ROM Naming & FAT32 Formatting (templates, presets, and live filename previews) alongside Console & Category Folder Mappings (OnionOS, ArkOS, MuOS, ES-DE presets and per-system paths).
  3. **System Settings** (*Core daemon connection, local storage paths & site politeness*): Repository Credentials & Local Mirror Paths (with *Test Login & Discover Consoles*) and Request Pacing & Rate Protection.
- **Target Audience / Persona**: Self-hosted retro preservationists and handheld enthusiasts who want effortless, understandable sync automation and SD card export setup without needing to decipher TCP-style congestion-control terminology (`AIMD`, `Multiplicative penalty factor`) or memorize 5-field UTC cron syntax.
- **Key Value**: Eliminates multi-screen scrolling fatigue, makes rate-limiting safe and self-explanatory for everyday users while retaining full granular control for Docker/environment-variable power users, and keeps every reveal smooth and mellow in keeping with the CRT broadcast aesthetic.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Configuring When & What to Mirror (`Sync Rules`)**:
   - User selects **Sync Rules** in the sidebar.
   - At the top, **Automatic Sync Schedule** presents an **Enabled / Paused** toggle, next-run & cutoff timestamps, and a smooth gliding mode bar (**Every X Hours**, **Daily**, **Weekly**, **Custom Cron**). Picking *Daily at 03:00 UTC* or *Every 6 Hours* updates the underlying schedule immediately in draft state and displays a plain-English summary (e.g., *"Daily at 03:00 UTC"*).
   - Directly below, **Target Consoles & Systems** and **Allowed Game & ROM Types** govern which platforms and categories every manual or scheduled sync will mirror.
2. **Preparing Handheld & SD Card Layouts (`Device Export`)**:
   - User selects **Device Export** in the sidebar (or clicks **Edit in Device Export** inside the Storage Device Installer modal, which navigates directly here and spotlights the folder table).
   - User chooses a **ROM Naming Preset** (e.g., *Clean Handheld*, *Standard No-Intro Style*) with live Retail / Hack / Translation filename previews, then configures **Storage Folder Mappings** for OnionOS, ArkOS, MuOS, ES-DE, or custom per-console directories.
3. **Managing Connection & Server Politeness (`System Settings`)**:
   - User selects **System Settings** in the sidebar (or clicks any credential prompt on the **Sync** dashboard).
   - **Repository Account & Local Mirror Paths** handles RGT login credentials, connection verification + console discovery, and local mirror directory configuration.
   - **Request Pacing & Rate Protection** offers three clear cards:
     - **Gentle** — Conservative single-worker pacing (`~20–35 req/min`, `2,500 ms` base delay, `1,500 ms` floor, `90,000 ms` max cooldown) for background NAS boxes or shared connections.
     - **Balanced · Recommended** — Default site-friendly pacing (`~40–80 req/min`, `1,500 ms` base delay, `750 ms` floor, `60,000 ms` max cooldown, `1` worker) that smoothly accelerates on clean streaks and pauses automatically on `HTTP 429` / `Retry-After`.
     - **Brisk** — Snappier crawl cadence (`~75–130 req/min`, `900 ms` base delay, `450 ms` floor, `2` concurrent workers) while preserving automatic backoff protection.
   - If the user wants to tweak individual millisecond timings, retry counts, timeouts, or the `HTTP User-Agent` header (or inspect `ENV`-locked overrides), clicking **Advanced Network & Retry Tuning** smoothly expands the full parameter grid via a CSS grid-row accordion without any abrupt pop.
4. **Unified Unsaved-Changes Safety Net**:
   - Modifying any field on **Sync Rules**, **Device Export**, or **System Settings** reveals the floating phosphor/amber **Save / Discard** action dock and places an `Unsaved` indicator next to that page in the left sidebar. Attempting to navigate away opens the confirmation dialog (*Keep Editing*, *Discard & Leave*, or *Save & Leave*).

### Visual Identity & Theme

- **Aesthetic Direction**: Hardware CRT broadcast deck & precision archival instrument—calm, tactile, legible, and free of pseudo-technical clutter.
- **Color Palette & Mood**:
  - **60% Neutral Canvas**: Deep CRT obsidian canvas (`--color-crt-bg`) across all three pages with generous breathing room between sections (`space-y-6`, `max-w-5xl`).
  - **30% Structural Surfaces**: Single-elevation instrument panels (`--color-crt-surface`) framed by crisp `1px` `--color-crt-border` hairlines.
  - **10% Semantic Phosphor Accents**: Active palette phosphor (`--color-crt-phosphor` in P1 Green, P3 Amber, or P4 Cyan) reserved for active mode keycaps, selected presets, and primary **Save Changes** CTAs; `--color-crt-amber` for unsaved draft state and environment-variable locks; `--color-crt-crimson` strictly paired with icons/labels for validation errors.
- **Typography & Hierarchy**:
  - **Display (`Chakra Petch`)**: Clean title-case section headers (`18px` semi-bold) and single-line segmented controls (`whitespace-nowrap shrink-0`).
  - **Body (`DM Sans`)**: Plain-English descriptions explaining *why* a setting matters without networking jargon (`12px–14px`).
  - **Telemetry & Values (`IBM Plex Mono` + `tabular-nums`)**: Strict tabular alignment on all millisecond timings, UTC schedule readouts, cron previews, filename length counters, and path strings.
- **Interactive Feedback & Motion**:
  - **Smooth Gliding Keycaps**: Segmented mode bars (Schedule frequency mode and Release Type filter mode) use a compositor-animated sliding keycap (`transform: translateX(...)`, `cubic-bezier(0.22, 1, 0.36, 1)`).
  - **Zero-Snap Accordions**: Collapsible sections (*Advanced Network & Retry Tuning*, *Advanced Raw Console Slug List*, and *Translation Language Scope*) animate smoothly using CSS grid-row transitions (`grid-template-rows: 0fr -> 1fr` + soft opacity fade).
  - **Living Sidebar Icons**: Dedicated 16×16 kinetic CRT vector icons for all five sidebar items (**Sync**, **Catalog**, **Sync Rules**, **Device Export**, and **System Settings**) wired across `Off` through `Ultra` motion tiers.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Grouping Schedule with Target Consoles & Release Types (`Sync Rules`)**: Combines *when* and *what* to mirror onto a cohesive page rather than stranding a single cron input on its own sparse tab.
- **Decision 2 — Separating `Device Export` from Server Sync Settings**: Isolates ROM filename templates and OnionOS/ArkOS/MuOS/ES-DE folder mappings from server credentials and network pacing since export formatting only applies when preparing ROMs for handhelds/SD cards.
- **Decision 3 — Coordinated Speed Profiles Backed by Existing Rate-Limiter Schema**: Maps **Gentle**, **Balanced**, and **Brisk** onto existing `ScraperConfig` columns with automatic **Custom Tuning** detection and zero breaking SQLite migrations.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Application Shell & Router                           │
│  • URL Hash & History Sync (#monitor, #catalog, #sync-rules,                 │
│    #device-export, #settings + legacy #schedule / #operations/* redirects)   │
│  • Active Config Page Handle Ref & Unsaved-Changes Navigation Guard Modal    │
└───────┬──────────────────────────┬──────────────────────────┬────────────────┘
        │                          │                          │
        ▼                          ▼                          ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────────┐
│   Sync Rules View    │  │  Device Export View  │  │   System Settings View   │
├──────────────────────┤  ├──────────────────────┤  ├──────────────────────────┤
│ 1. Automatic Sync    │  │ 1. Prepared ROM      │  │ 1. Repository Account &  │
│    Schedule Builder  │  │    Naming & FAT32    │  │    Local Mirror Paths    │
│ 2. Target Consoles   │  │ 2. Storage Folder    │  │ 2. Request Pacing &      │
│    & Systems         │  │    Mappings          │  │    Rate Protection       │
│ 3. Allowed Game &    │  │                      │  │    • Gentle / Balanced / │
│    ROM Types         │  │                      │  │      Brisk (+ Custom)    │
│                      │  │                      │  │    • Smooth Advanced     │
│                      │  │                      │  │      Tuning Accordion    │
└──────────┬───────────┘  └──────────┬───────────┘  └────────────┬─────────────┘
           │                         │                           │
           └─────────────────────────┼───────────────────────────┘
                                     ▼
            ┌────────────────────────────────────────────────┐
            │    Shared Sticky Config Save / Discard Dock    │
            │       PUT /api/config  •  POST /api/auth/test  │
            └────────────────────────────────────────────────┘
```
