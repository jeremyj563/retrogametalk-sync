---
title: Simplify Game Details Actions & One-Click Play Flow
status: implemented
created_at: 2026-11-21T14:08:16Z
implemented_at: 2026-11-21T14:16:00Z
---

# Simplify Game Details Actions & One-Click Play Flow

Streamline the Game Details drawer so players move from discovering a game to playing it in a single click—replacing duplicated buttons and the multi-step "Prepared ROM Export" flow with instant unarchived ROM downloads, mount-aware one-click device installation, and a single consolidated `More` menu for power-user tools.

## User Review & Critical Decisions

> [!IMPORTANT]
> This plan reflects the three workflow decisions confirmed during planning:
> - **Mount-Aware Primary Action**: When a Storage Device is mounted, **Install to `<Device>`** is promoted to the primary action with **Download ROM** beside it. When no device is mounted, **Download ROM** is the primary action.
> - **Instant Single-ROM Download, Quick Picker for Multi-ROM**: Clicking **Download ROM** immediately begins downloading the unarchived, cleanly renamed ROM (or clean `.zip` for multi-track disc sets) whenever the archive contains 1 playable ROM. Only archives with 2+ playable ROM variants open a compact inline variant picker.
> - **Single `More` Menu for Secondary Tools**: Power-user and maintenance actions (`Inspect Archive`, `Download Raw Archive`, `Review Device Install…`, `Refresh Metadata`, `Mark/Clear Installed Flag`, `Dry Run Retry`, and `Delete Release`) move into one clean `More` (`···`) menu so they never compete with installing or downloading the game.

---

## 1. Overview & Core Concept

Today, inspecting a mirrored game in the Game Details drawer presents up to **8–10 competing buttons** spread across the metadata strip, the `Included Downloads` file rows, and the sticky footer—with `Prepared ROM`, `Inspect Archive`, and `Raw Archive` duplicated in two places. Worse, clicking `Prepared ROM` never starts a download; it opens an intermediate `Prepared ROM Export` box that forces a second click even when the archive contains only one obvious ROM.

The redesigned Game Details action system follows a single guiding rule: **every primary action does the work immediately, and every secondary action stays out of the way until asked.**

### Core Outcomes
1. **Zero-Friction Play & Install**:
   - Mounted handheld/SD card workflow: **1 click** (`Install to <Device>`) writes the extracted, cleanly named ROM straight to the mounted device using the existing Express Install pipeline and auto-configured console folder conventions.
   - Local desktop/emulator workflow: **1 click** (`Download ROM`) inspects and immediately triggers a browser download of the extracted, cleanly renamed ROM file (no intermediate export card).
2. **Eliminate Action Duplication**:
   - Single-file releases (the vast majority of the catalog) show clean file metadata in `Included Downloads` without repeating footer buttons.
   - Multi-file releases show only a single lightweight `Download ROM` trigger per downloaded file row (plus `Retry` if a specific file failed).
3. **Calm, High-Clarity Footer**:
   - At rest, the sticky footer shows **at most two play/install actions** on the left plus **one `More` (`···`) button** on the right.

---

## 2. User Experience & Visual Design

### Sticky Footer Action Hierarchy by Release State

| Release & Device State | Primary Action (Solid Accent CTA) | Secondary Action (Subtle Outlined CTA) | Overflow (`···` Menu) |
| :--- | :--- | :--- | :--- |
| **Downloaded + Storage Device Mounted** | **Install to `<Device>`** *(1-click Express Install; reads `Reinstall to <Device>` if already installed on this device, or `Installing…` while active)* | **Download ROM** *(instant download for 1 ROM, quick picker for 2+)* | Review Device Install…, Inspect Archive, Download Raw Archive, Refresh Metadata, Installed Flag Toggle, Delete |
| **Downloaded + No Device Mounted** | **Download ROM** *(instant download for 1 ROM, quick picker for 2+)* | **Install to Device** *(prompts mount & opens review/install)* | Inspect Archive, Download Raw Archive, Refresh Metadata, Installed Flag Toggle, Delete |
| **Catalog-Only (Not Yet Mirrored)** | **Download Release** *(queues mirroring to local library)* | *(none)* | Refresh / Fetch Metadata, Delete |
| **Queued or Downloading** | Disabled status pill-free indicator (`Queued` / `Downloading…`) | *(none)* | Refresh Metadata, Delete |
| **Failed (No Downloaded Files)** | **Retry Download** | *(none)* | Dry Run Retry, Refresh Metadata, Delete |
| **Partially Failed (Some Files Downloaded)** | Primary install or download action for available files | **Download ROM** / **Install to Device** | Retry Failed Files, Dry Run Retry, Archive Tools, Refresh Metadata, Delete |

### One-Click "Download ROM" Experience

```
User clicks "Download ROM"
          │
          ▼
   Inspect archive (cached per file in drawer session; button shows "Preparing…")
          │
          ├── 1 playable ROM (or 1 disc set)
          │        └─► Immediately triggers browser download of extracted/renamed ROM
          │            Button briefly confirms "Download Started" (auto-resets in ~2.2s)
          │
          ├── 2+ playable ROM variants
          │        └─► Opens compact inline "Choose ROM Variant" panel directly above footer
          │            Each row: clean ROM filename · detected version · size · [Download]
          │            Clicking any variant starts download immediately
          │
          └── 0 playable ROMs (patch-only / docs archive)
                   └─► Opens compact inline notice above footer:
                       "Patch files only — no standalone ROM found in this archive."
                       Offers 1-click [Download Raw Archive] and [Inspect Archive]
```

---

## 3. Key Product Decisions & Trade-Offs

1. **Direct Express Install When Mounted vs. Review Modal**:
   - *Decision*: When a Storage Device is already mounted and auto-configured, the primary **Install to `<Device>`** button triggers Express Install directly in 1 click—skipping the review modal entirely.
   - *Safety Valve*: Users who want to customize output filenames, pick non-primary variants, or preview target subfolders can still open the full review modal via `More → Review Device Install…`. When no device is mounted yet, clicking **Install to Device** opens the mount + review flow.
2. **Instant Download via Inspection-Then-Stream vs. Blind Stream**:
   - *Decision*: Clicking **Download ROM** checks the fast archive inspection response first (cached per file while the drawer is open) before triggering the native browser download URL, reliably distinguishing single-ROM archives, multi-ROM archives, and patch-only archives.
3. **Removing Legacy Editable Filename Box in Game Details**:
   - *Decision*: Drop the always-expanded "Prepared ROM Export" rename box from the Game Details download path while keeping auto-sanitized FAT32-safe ROM naming automatic and full customization available in `More → Review Device Install…` or `More → Inspect Archive`.
