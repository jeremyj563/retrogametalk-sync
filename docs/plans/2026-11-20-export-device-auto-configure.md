---
title: Export Device Auto-Configure
status: implemented
created_at: 2026-11-20T22:05:10Z
implemented_at: 2026-11-20T22:11:30Z
---

# Export Device Auto-Configure

Add a client-side **Auto-Configure from Storage Device** workflow to **Device Export** so users can pick their SD card, USB drive, or emulator base folder (or scan an already-mounted storage device) and have RetroGameTalk Sync automatically discover each console's relative base path and existing ROM-type subfolders, then preview and selectively merge those mappings into their configuration.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core product decisions below were confirmed during discovery and govern the design.

- **Confirmed — Export Base Path Source**: Uses the browser's **File System Access API** folder picker and reuses the currently mounted storage device when one is already connected. Selecting a new base folder to scan also mounts it as the active storage device root so subsequent exports target the exact same directory.
- **Confirmed — Discovery Scope**: Discovers both **console base paths** (including nested ROM roots such as `Roms/SFC`, `Emulation/roms/snes`, `games/SNES`, and Analogue Pocket `Assets/<core>/common`) and **ROM-type subfolders** (such as `Hacks`, `Translations`, `Homebrew`, `Ports`, `Undubs`, `Prototypes`, `Unlicensed`, `BIOS`, `DLC`, `PSX2PSP`) using exact on-disk casing.
- **Confirmed — Review & Merge Flow**: Displays an **inline review preview** with per-console checkboxes so the user can inspect path diffs, pick between alternate candidates if ambiguous, toggle ROM-type subfolder adoption, and **merge** selected matches into the draft Device Export form without overwriting untouched custom mappings. Final persistence uses the existing **Save / Discard** bar.
- **Default — Existing Custom Overrides**: When a discovered path differs from a user's existing custom override for that console, the row is highlighted as `Updates Custom` and left unchecked by default so accidental overwrites never happen, while matches for uncustomized/default consoles are pre-checked automatically.
- **Default — ROM-Type Subfolder Adoption**: Detected ROM-type subfolders are applied per matched console (enabling type subfolders for that console with its exact on-disk directory names) rather than forcing global subfolder mode onto consoles that keep flat folders.

---

## 1. Overview & Core Concept

- **What It Does**: Inspects the directory tree of a user-selected export base path directly in the browser, recognizes retro handheld/firmware/emulator folder layouts across 75+ console platforms, checks for existing ROM-type subdirectories inside each matched console folder, and presents a structured diff-and-merge checklist to auto-populate **Storage Device Folder Mappings**.
- **Target Audience / Persona**: Self-hosted retro gamers syncing ROM libraries to handheld SD cards (OnionOS, GarlicOS, MuOS, ArkOS, Batocera, ROCKNIX, Analogue Pocket), desktop/handheld frontends (ES-DE, EmuDeck, RetroDECK, Daijishō), flash carts (EverDrive, FXPAK Pro), and FPGA devices (MiSTer) who want zero manual folder-by-folder typing.
- **Key Value**: Turns 10–30 minutes of error-prone manual folder mapping into a single folder pick and review click—even when RetroGameTalk Sync runs on a remote NAS/Docker server and the SD card is plugged into the user's local computer.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Triggering Auto-Configure (Zero-State & Mounted State)**: Compact **Auto-Configure from Storage Device** control strip inside **Device Export → Storage Device Folder Mappings** showing `Auto-Configure from Folder` when unmounted or `Scan "<DeviceName>"` + `Choose Different Folder` when mounted.
2. **Fast, Interruptible Scanning State**: Inline progress readout with `Cancel Scan`, bounded depth traversal (`maxDepth: 4`), OS/media/save directory pruning, and shallow ROM-extension sampling.
3. **Inline Review & Selective Merge Workspace**: Shows layout signature summary, `Select New` / `Select All Changed` / `Clear`, `Include detected ROM-type subfolders`, per-console checkboxes with monospace path diffs, inline candidate switcher for duplicate-path conflicts, and collapsible unrecognized folders disclosure.
4. **Apply to Draft → Existing Save / Discard Lifecycle**: Merges checked mappings into the live form draft and hands persistence to the existing `ConfigSaveBar` (`PUT /api/config` → SQLite).

---

## 3. Key Product Decisions & Trade-Offs

- **Client-Side Directory Scanning**: Runs against the browser `FileSystemDirectoryHandle` so self-hosted NAS/Docker setups work seamlessly with local SD cards and discovered paths match installer write paths 1-to-1.
- **Consensus-Scored Multi-Signal Discovery**: Combines a 75+ platform alias dictionary (universal defaults, OnionOS/GarlicOS shortcodes, ES-DE/Batocera/EmuDeck, Analogue Pocket `Assets/*/common`, MiSTer `games/`, human-readable names) with parent-root consensus and ROM file extension corroboration.
- **Non-Destructive Merge**: Merges only selected consoles into `StorageFolderMappingConfig`, preserving untouched custom mappings and avoiding any schema migration.
