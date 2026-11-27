---
title: Optional `.chd` Disc Compression & Automatic Multi-Disc `.m3u` Playlists
status: implemented
created_at: 2026-11-22T20:35:00Z
implemented_at: 2026-11-27T15:50:00Z
---

# Optional `.chd` Disc Compression & Automatic Multi-Disc `.m3u` Playlists

Optimize CD- and DVD-based consoles (PlayStation 1, Sega CD, Saturn, Dreamcast, PC Engine CD, PlayStation 2, PSP) by supporting opt-in **`.chd` (Compressed Hunks of Data)** conversion via `chdman` and automatic **`.m3u` multi-disc playlist generation** during handheld device installation.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Where `.chd` Conversion Runs**: Run `chdman createcd` (and `createdvd` for PS2/DVD images) **server-side** inside the container (writing to a temporary cache under `DATA_DIR/chd-cache` or optional in-place cache so repeat installs to multiple devices are instant) and stream the finished `.chd` to the browser/SD card—because `chdman` cannot run natively inside browser JavaScript.
> - **Opt-In Per Console / Global Toggle**: Keep `.chd` conversion **opt-in** in **Device Export** (with sensible eligible console defaults: PS1, Sega CD, Saturn, PC Engine CD, Dreamcast, PS2) so devices or cores that prefer raw `.cue`/`.bin` remain untouched unless enabled.
> - **Multi-Disc `.m3u` Layout**: For multi-disc games (`Disc 1`, `Disc 2`, ...), place the individual disc images (`.chd` or `.cue`/`.bin`) inside a hidden/sub-folder (e.g., `.multidisc/<Game Name>/` or `<Game Name>.m3u/` per OnionOS / ES-DE / MuOS convention) and write a single top-level `<Game Name>.m3u` playlist so handheld menus show **one clean game entry** with seamless disc-swapping in RetroArch/DuckStation.

---

## 1. Overview & Core Concept

CD-based releases on RetroGameTalk typically arrive as `.rar`, `.7z`, or `.zip` archives containing `.cue` + multiple `.bin` audio tracks (often 400–700 MB uncompressed per disc). While RGT Sync already unpacks `.cue`/`.bin` disc sets into clean subfolders on mounted devices, raw `.cue`/`.bin` files have two major drawbacks on handhelds:
1. **Huge SD Card Footprint**: Raw `.bin`/`.cue` wastes 40–60% of SD card space compared to lossless `.chd` compression.
2. **Multi-Disc Menu Clutter**: A 3- or 4-disc RPG (e.g., Final Fantasy VII, Xenogears, Panzer Dragoon Saga) clutters handheld game lists with 3–4 separate entries unless wrapped in an `.m3u` playlist.

### Core Outcomes
1. **Multi-Arch `chdman` in Container Image**: Bundle `mame-tools` / `chdman` in the Alpine Docker image (with graceful feature-availability probe `/api/capabilities` so non-Docker environments without `chdman` cleanly disable the toggle with an explanatory hint).
2. **One-Click Transparent `.chd` Export**: When `.chd` conversion is enabled for a disc console, clicking **Install to `<Device>`** automatically extracts the `.cue`/`.bin` or `.gdi` to a temp workspace on the server, compresses it losslessly with `chdman`, caches the result (optional LRU cap), and streams the single `.chd` file directly to the mounted device with live conversion + write progress.
3. **Automatic `.m3u` Playlist Generation**: Detect multi-disc sets within a release (e.g., `(Disc 1)`, `(Disc 2)`, `(CD 1)`, `(CD 2)`), write the discs into the device's clean subfolder layout, and generate a valid UTF-8 `.m3u` playlist pointing to each disc in order.

---

## 2. User Experience & Visual Design

### Device Export Panel (`DeviceExportPanel.tsx`)
- Add a collapsible **`Disc Images (.chd & .m3u)`** card:
  - Toggle: **Convert `.cue`/`.bin` & `.gdi` Disc Sets to `.chd` on Export** (shows `chdman` availability status badge; disabled cleanly if `chdman` is not installed).
  - Toggle: **Generate `.m3u` Playlists for Multi-Disc Games** (with layout choice: `Subfolder (.multidisc/<Game>/)` for OnionOS/ES-DE or `Inline (<Game>.m3u beside discs)`).
  - Optional `CHD Cache Size Limit` (e.g., `0 = temp only`, `5 GB`, `20 GB`) so converted `.chd` files don't need re-encoding when installing to a second handheld.

### Live Progress Feedback
- Extend `DeviceInstallStage` with `'converting_chd'` so Game Details and `BulkInstallDock` clearly display `Converting to .chd (42%)…` before switching to `Installing to <Device>…` (avoiding any "stuck" feeling during 15–45 second `chdman` runs!).

---

## 3. Architecture & Technical Approach

### Container & Backend (`Dockerfile`, `src/server/chdService.ts`, `server.ts`)
1. **Container Support (`Dockerfile`)**:
   - Install `chdman` (`mame-tools` / Alpine package or multi-arch static binary) and verify `chdman` executable during build.
2. **CHD Conversion Service (`src/server/chdService.ts`)**:
   - `resolveChdmanBinary()` (cached `which chdman`).
   - `convertArchiveDiscToChd(archivePath, entryPaths, outputChdPath, { signal, onProgress })`:
     - Extracts `.cue` + referenced tracks into an isolated temp directory, runs `chdman createcd -i <file.cue> -o <out.chd>` (parsing stderr `Compressing, XX.X% complete…` for live progress), cleans up temp directory on completion or abort (`AbortController` kills child `chdman` cleanly).
   - Optional bounded disk cache under `DATA_DIR/chd-cache/<sha256>.chd` with LRU eviction.
3. **API Routes (`server.ts`)**:
   - Expose `capabilities: { chdman: boolean, unrar: boolean, sevenZip: boolean }` on `GET /api/status`.
   - Add `POST /api/items/:id/prepare-chd` (returns a job ID / SSE progress or streams converted `.chd` via `GET /api/items/:id/export-chd`).

### Multi-Disc Grouping (`src/shared/multiDiscPlaylist.ts`)
- Pure helper `groupMultiDiscTargets(targets)` detecting `(Disc N)` / `(CD N)` / `Disc N` patterns, ordering discs numerically, and generating clean `.m3u` file contents with POSIX relative paths (`./.multidisc/<Game>/<Disc 1>.chd`).

---

## 4. Verification Plan
- Unit tests for `groupMultiDiscTargets` and `.m3u` playlist generation (single-disc untouched, 2–4 disc RPGs ordered properly, special characters sanitized for FAT32).
- Unit tests for `chdman` progress parser and `chd-cache` LRU eviction.
- End-to-end test converting a sample `.cue`/`.bin` fixture into `.chd`, verifying lossless integrity (`chdman verify`) and streaming cleanly to a mounted storage folder.
