---
title: Prepared ROM Downloads & Direct-to-SD-Card Exporter
status: implemented
created_at: 2026-11-15T21:31:00Z
implemented_at: 2026-11-15T21:50:00Z
---

# Prepared ROM Downloads & Direct-to-SD-Card Exporter

One-click extraction, smart naming, and direct-to-SD-card export let players pull ready-to-play ROMs and multi-track ODE disc sets straight from `rgt-sync` to flash carts, ODEs, and handhelds—stripping archive clutter and stamping accurate hack, translation, and port version tags automatically.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core workflow, naming, disc-set, and multi-ROM handling decisions were confirmed during interactive clarification and are locked into this plan:

- **Confirmed Decision 1 — Dual Export Workflows**: Deliver both **Prepared ROM Download** (universal browser download of the extracted, renamed ROM) and **Direct-to-SD-Card Export** (Chromium File System Access API folder mount with console-to-folder mapping and batch export).
- **Confirmed Decision 2 — Naming Convention (`Title (Region) [Hack v1.2].ext`)**: Format retail ROMs cleanly as `Title (Region).ext`, while hacks, translations, undubs, and active ports carry bracketed role + version tags such as `[Hack v1.42]`, `[T-En v1.3]`, or `[Port v1.2]`—with customizable templates in Operations and per-export inline editing.
- **Confirmed Decision 3 — Multi-File Disc Sets (BIN/CUE, GDI, M3U)**: Keep multi-track disc images together as atomic playable bundles: extract directly into a clean game subfolder when writing to an SD card for ODEs, or stream a stripped playable-only `.zip` (no readmes/URLs/loose patches) for single-click browser downloads.
- **Confirmed Decision 4 — Multiple ROM Variants Inside One Archive**: When an archive contains 2+ playable ROMs (e.g., *Headered vs. Unheadered*, *Rev A vs. Rev B*, or *Original + Patched*), prompt the user with an inline picker to choose one variant or export all rather than guessing silently.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. Inspects mirrored archives on disk (`.zip`, `.7z`, `.rar`, `.tar`, or already-unpacked files) to separate playable ROMs and disc sets from non-game clutter (`.txt`, `.md`, `.nfo`, `.url`, `.pdf`, `.ips`/`.bps` patches, images).
  2. Derives normalized, hardware-safe filenames by combining catalog metadata (`title`, `regions`, `languages`, `releaseTags`, `fileRole`) with smart version extraction (`v1.4`, `v2.0b`, `r12`, `Build YYYY-MM-DD`) parsed from archive names, labels, inner filenames, and release descriptions.
  3. Provides **Download Prepared ROM** (single-click stream with editable filename preview and multi-variant picker) and **Send to SD Card** (mount a flash cart, ODE, or handheld SD card root once, apply system folder presets, detect older versions already on the card, and batch-export selected games directly into their console folders).
- **Target Audience / Persona**: Retro console collectors and archivists loading EverDrive / FXPAK / R4 flash carts, MiSTer FPGAs, ODEs (GDEMU, Fenrir, MODE, XStation), and handheld SD cards directly from their local `rgt-sync` mirror.
- **Key Value**: Eliminates manual 7-Zip extraction, readme cleanup, multi-track BIN/CUE mishaps, and tedious per-file renaming while keeping the underlying NAS archive untouched for deduplication and future delta syncs.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Configure Naming & Device Defaults (Operations Tab)**:
     - A new **Prepared ROM Naming & Export** panel in Operations lets users inspect and customize the naming template (`Title (Region) [Role Version].ext` default), toggle FAT32/exFAT filename sanitization and optional character limits for legacy flash carts, and preview live sample outputs across Retail ROMs, Hacks, Translations, Ports, and Disc Sets.
  2. **One-Click Prepared ROM Download (Game Detail Drawer & Catalog)**:
     - Inside the Game Detail Drawer (both in the sticky footer and beside each mirrored archive row), users choose **Prepared ROM** (primary phosphor CTA) or **Raw Archive** (secondary outline action).
     - Clicking **Prepared ROM** inspects the archive:
       - **1 playable ROM (or 1 single-file disc like `.chd`/`.iso`/`.pbp`)**: Opens a compact export confirmation strip/popover with the pre-computed filename (editable inline) and triggers an immediate extracted download stream.
       - **Multi-track disc set (`.cue`+`.bin` / `.gdi`+tracks)**: Clearly labels the bundle (`Disc Set · 4 tracks`) and offers **Download Clean Zip** (browser) or **Extract Folder to SD Card** (if a device target is mounted).
       - **Multiple ROM variants**: Displays an inline variant radio/checkbox list showing inner filename, extension, and size so the user picks one file or clicks **Export All Variants**.
       - **Patch-only archive**: Clearly flags *"Patch file only (no ROM payload found)"* and still allows downloading the raw archive or patch file.
  3. **Direct-to-SD-Card Workflow (Catalog Export Bar & Device Target Modal)**:
     - A compact **SD Card Target** control in the Catalog toolbar lets Chromium/Edge/Chrome users pick a local/removable directory via `showDirectoryPicker` (with clear notice and graceful fallback to Prepared ROM download on unsupported browsers like Firefox/Safari).
     - Users select a **Device Folder Preset** (*EverDrive*, *MiSTer*, *OnionOS / Miyoo*, *Analogue Pocket*, or *Custom Map*) that maps RGT system slugs (e.g., `nes-roms` → `NES`, `snes-rom` → `SNES`, `sega_saturn_isos` → `SATURN`) and saves the mapping cleanly.
     - From any single game drawer or a multi-row Catalog selection, clicking **Send to SD Card** opens a clean pre-flight manifest drawer/modal:
       - Shows every queued item, target SD subfolder, resolved output filename (inline-editable), and existing-file check (highlighting **New**, **Identical**, or **Upgrade Available** when an older `[Hack v1.x]` exists on the card).
       - Streams extracted payloads sequentially to the SD card with per-item progress, completion summary, and non-blocking error reporting.
- **Visual Identity & Theme**:
  - Preserves the established retro CRT phosphor terminal design system: deep obsidian canvas (`--color-crt-bg`), dark structural surfaces (`--color-crt-surface`, `--color-crt-elevated`), hairline `1px` borders (`--color-crt-border`), phosphor green (`--color-crt-phosphor`) for ready-to-play actions, amber (`--color-crt-amber`) for version upgrades, multi-variant prompts, and FAT length warnings, and crimson (`--color-crt-crimson`) paired with explicit icons/text for extraction or write errors.
  - Uses `Chakra Petch` for modal/section headings, `DM Sans` for action labels and prose, and `IBM Plex Mono` (`tabular-nums`) for all filenames, byte sizes, disc track counts, and export paths.
- **Component Styling & Layout**:
  - Strictly adheres to single-elevation flat containers with `1px` hairline dividers—no nested card-within-card boxes, no thick left accent borders, and no static metadata pill capsules (role, version, format, and size appear as clean inline monospace metadata separated by `·`).
  - Keeps the Top Bar Contract completely untouched; SD Card mount status and Prepared Export controls live inside the Catalog toolbar, contextual bulk bar, Game Detail Drawer, and Operations settings panel.
  - Full state coverage across inspection and export: loading indicator while scanning archive headers, clear empty/unsupported states (patch-only archive or unsupported browser File System API), editable filename validation, and per-item progress/retry feedback during batch SD writes.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Cross-Environment 7-Zip Archive Engine + Streaming Extraction**:
  - *Chosen Approach*: Bundle a cross-platform `7z` archive backend (system `7zz`/`7z` in Alpine containers plus a portable binary fallback in Node dev) paired with `unzip` / zip streaming for `.zip` and clean multi-track bundling.
  - *Why*: RetroGameTalk relies heavily on `.7z` and `.zip` (and occasional `.rar`). Pure-JS zip libraries fail completely on `.7z` and `.rar`, whereas 7-Zip inspects headers without unpacking (`l -slt`) and streams extracted bytes (`e -so`) with minimal RAM and zero duplicate permanent NAS storage.
  - *Alternatives Considered*: Pure-JS `yauzl` only (breaks `.7z`/`.rar`) or permanently pre-extracting every synced release onto the NAS (doubles storage footprint and breaks archive-based deduplication).
- **Decision 2 — Deterministic Smart Version & Role Parser + Template Engine**:
  - *Chosen Approach*: Parse release metadata and filenames in a ranked pipeline: (1) inner ROM / archive / RGT file label for version tokens (`v1.2.3`, `rev B`, `r45`, `build 2025-02`), (2) `fileRole` + `releaseTags` for normalized short role tags (`Hack`, `T-En`, `T-Fr`, `Port`, `Undub`, `Homebrew`, `Proto`, `Demo`, `Beta`), and (3) `title` + `regions` + FAT-safe sanitizer.
  - *Why*: Many RGT hacks/translations carry version numbers only in the archive name or post description while the inner `.sfc`/`.nes` file is unversioned (e.g., `game_patched.sfc`), or vice versa. Combining all signals before applying the template produces consistent, readable names with an editable escape hatch.
  - *Alternatives Considered*: Relying solely on the inner filename (loses version numbers and puts messy uploader names onto SD cards) or forcing manual naming on every download.
- **Decision 3 — Client-Side Directory Writing via File System Access API (`showDirectoryPicker`)**:
  - *Chosen Approach*: Keep archive extraction and filename resolution on the `rgt-sync` server, then stream clean binary payloads (or individual disc tracks) over HTTP directly into the user-selected SD card folder from the browser.
  - *Why*: `rgt-sync` commonly runs inside a Docker container or Kubernetes pod on a NAS/homelab server, so the SD card plugged into the user's laptop/desktop is physically attached to the browser machine—not the container host. File System Access API lets the web console write straight to the user's local SD card with zero desktop companion app to install.
  - *Alternatives Considered*: Mounting USB devices directly inside the Docker container (doesn't work for remote NAS/K8s deployments or multi-OS desktops).

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Flow Diagram**:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                                 Frontend UI                                │
│  ┌──────────────────────┐   ┌───────────────────────┐   ┌───────────────┐  │
│  │ Operations Settings  │   │ Catalog & Bulk Bar    │   │ Game Detail   │  │
│  │ • Naming Template    │   │ • Mount SD Card       │   │ Drawer        │  │
│  │ • FAT32 Sanitization │   │ • Console Map Presets │   │ • Prepared ROM│  │
│  │ • Live Name Preview  │   │ • Send Selected to SD │   │ • Raw Archive │  │
│  └──────────┬───────────┘   └───────────┬───────────┘   └───────┬───────┘  │
│             │                           │                       │          │
│             │               ┌───────────▼───────────────────────▼───────┐  │
│             │               │ Prepared Export Modal / Variant Picker    │  │
│             │               │ • Multi-ROM selection & editable names    │  │
│             │               │ • SD conflict / older-version replacement │  │
│             │               │ • File System Access writer (SD folders)  │  │
│             │               └───────────────────┬───────────────────────┘  │
└─────────────┼───────────────────────────────────┼──────────────────────────┘
              │ PUT /api/config                   │ Inspect / Stream Payload
              ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           API & Archive Pipeline                           │
│  • GET  /api/items/:id/inspect     (list archive entries, classify ROMs,   │
│                                     detect BIN+CUE/GDI disc bundles,       │
│                                     compute smart formatted filenames)     │
│  • GET  /api/items/:id/download-rom                                        │
│         ?fileId=...&entry=...&name=...                                     │
│         (streams extracted single ROM, or clean stripped .zip for disc     │
│          sets / multi-selection browser downloads)                         │
│  • GET  /api/items/:id/extract-entry                                       │
│         (streams individual track/entry for direct SD subfolder writing)   │
└─────────────────────────────────────────────────┬──────────────────────────┘
                                                  │
                                                  ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   Naming Engine & Archive Inspector (7z)                   │
│  • Extracts version + role tag from filename, displayLabel, release meta   │
│  • Applies template + FAT32-safe sanitization                              │
│  • Reads local archive on NAS volume without altering mirrored archive     │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - Extend server configuration (`scraper_config` via an automatic sequential SQLite migration `v5`) with user naming & export preferences:
    - `romNamingTemplate` (default `{title}{regionParen}{tagBracket}`)
    - `romSanitizeFat32` (boolean, default `true`)
    - `romMaxFilenameLen` (number, optional flash-cart clamp, default `0` = unlimited)
    - `devicePreset` + `deviceFolderMapJson` (JSON map of RGT system slug → relative SD card folder path, persisted so user console mappings survive sessions).
  - Archive inspection computes structured metadata on demand (no permanent duplicate extracted files on NAS disk), returning:
    - `archiveFormat` (`zip`, `7z`, `rar`, `tar`, `raw`)
    - `playableTargets[]` (each representing either a standalone ROM/CHD entry or an atomic multi-file disc bundle `.cue`/`.gdi` + referenced track paths, with `suggestedFilename`, `roleLabel`, `detectedVersion`, `sizeBytes`, and `entryPaths[]`)
    - `ignoredEntriesCount` (count of stripped readme/url/doc/patch clutter files)
    - `patchOnly` boolean flag when only `.ips`/`.bps`/`.ups`/`.xdelta` files exist.
- **Interactive Component & State Mapping**:
  - **Operations Naming Section**: Live-renders preview filenames as the user edits template tokens or presets (`Title (Region) [Hack v1.2]`, `Title [Hack v1.2] (Region)`, etc.) and persists via `PUT /api/config`.
  - **Game Detail Drawer**: Adds **Download Prepared ROM** alongside raw **Download Archive**; invokes `/api/items/:id/inspect`, auto-streams when 1 unambiguous ROM is present (with quick editable name confirmation), or renders the inline variant selector / disc-bundle action when 2+ targets or multi-track sets are detected.
  - **Catalog SD Card Mount & Batch Export**:
    - Mount button invokes `window.showDirectoryPicker({ mode: 'readwrite' })` and holds the active `FileSystemDirectoryHandle` in client session state alongside a console-mapping editor seeded with hardware presets (*EverDrive*, *MiSTer*, *OnionOS / Miyoo*, *Analogue Pocket*, *ODE*, *Custom*).
    - **Send to SD Card** works for 1 release or N selected releases in Catalog: inspects each archive, prompts for any multi-ROM ambiguities upfront in a unified review queue, scans existing files in the target SD console folder to detect identical or older-version matches (offering one-click replace of older `[Hack v1.x]` files), and streams extracted files or `.cue/.bin` subfolders straight onto the card with live per-file status (`pending` → `writing` → `written` / `replaced` / `error`).
