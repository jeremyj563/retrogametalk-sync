---
title: Handheld Box Art & Frontend Metadata Export (OnionOS, MuOS, ES-DE)
status: planned
created_at: 2026-11-22T20:35:00Z
implemented_at: null
---

# Handheld Box Art & Frontend Metadata Export (OnionOS, MuOS, ES-DE)

Turn RetroGameTalk Sync into a complete plug-and-play handheld library manager by optionally exporting cached cover art and structured game metadata alongside every ROM installed to a storage device—eliminating the need to run external scrapers (which routinely fail to match ROM hacks and fan translations).

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Auto-Detected Frontend Art Profiles**: Leverage the existing Device Auto-Configure scanner to detect handheld OS layouts automatically (**OnionOS / GarlicOS**, **MuOS**, **EmulationStation / ES-DE / Batocera / RetroPie**, or **Custom Path**), while letting users toggle or override the artwork profile in **Device Export**.
> - **Server-Side PNG/Resize Normalization**: Serve resized, handheld-friendly cover art via a lightweight server endpoint (e.g., max width `300px–512px` PNG matching OnionOS/MuOS limits) so handheld menus load instantaneously without choking on multi-megabyte source images.
> - **Safe `gamelist.xml` Merging**: For EmulationStation / ES-DE targets, read any existing `gamelist.xml` on the mounted device and upsert `<game>` entries by `<path>` without clobbering user play counts, favorites, or manually scraped games.

---

## 1. Overview & Core Concept

RetroGameTalk Sync already downloads crisp box art, release years, developers, publishers, genres, and descriptions for every indexed game. Today, when installing ROMs to a handheld SD card, only the ROM file is written—leaving users with blank text lists on their Miyoo Mini, Anbernic, Retroid, or Steam Deck until they run Skraper or built-in scrapers. Worse, ScreenScraper and TheGamesDB rarely recognize fan translations or brand-new ROM hacks by CRC/filename, leaving the exact games RGT users care most about without artwork.

### Core Outcomes
1. **Zero-Scraper Handheld Polish**: Every ROM installed via 1-click **Install** or bulk install optionally writes its matching box art PNG to the exact folder and filename expected by the handheld frontend.
2. **Supported Frontend Presets**:
   - **OnionOS / GarlicOS**: `<SystemFolder>/Imgs/<RomStem>.png` (250–300px wide PNG).
   - **MuOS**: `MUOS/info/catalogue/<CatalogueSystem>/box/<RomStem>.png` (plus optional `text/<RomStem>.txt` synopsis).
   - **EmulationStation / ES-DE / Batocera / RetroPie**: `<SystemFolder>/images/<RomStem>-image.png` (or ES-DE `downloaded_media/<system>/covers/<RomStem>.png`) + non-destructive `<SystemFolder>/gamelist.xml` upsert (`name`, `desc`, `image`, `releasedate`, `developer`, `publisher`, `genre`).
   - **Generic / Custom**: User-configurable relative artwork folder pattern (e.g. `Imgs/{stem}.png`).
3. **Standalone "Export Box Art Only" Pass**: Let users sync cover art + metadata for games *already* on their mounted SD card without re-copying gigabytes of ROMs.

---

## 2. User Experience & Visual Design

### Device Export Panel (`DeviceExportPanel.tsx`)
- Add a clean **`03. Box Art & Metadata Export`** collapsible card below `ROM Filename Formatting`:
  - Master toggle: **Export Box Art with ROM Installs** (opt-in or auto-suggested when OnionOS/MuOS/ES-DE structure is detected on mount).
  - Frontend preset selector: `Auto-Detect from Device`, `OnionOS / GarlicOS`, `MuOS`, `EmulationStation / Batocera`, `ES-DE`, `Custom`.
  - Secondary options:
    - `Max Cover Width` (`250px` OnionOS / `320px` MuOS / `512px` HD / `Original`).
    - `Write gamelist.xml metadata` (for ES / Batocera / ES-DE).
    - `Overwrite existing artwork on device` (off by default to preserve custom art).
  - Live Destination Preview updated to show both the ROM path and the artwork path side-by-side:
    - ROM: `Roms/SNES/Chrono Trigger (USA) [T-En].sfc`
    - Art: `Roms/SNES/Imgs/Chrono Trigger (USA) [T-En].png`

### Storage Device Sidebar & Install Flow
- During `BulkInstallDock` / `GameDetailDrawer` installs, artwork writes immediately after the ROM finishes (fast, ~20–80 KB per cover) with stage copy `Writing cover art…`.
- Add a **"Sync Missing Box Art"** utility button in **Device Export** when a device is mounted to backfill artwork for already-installed games in one click.

---

## 3. Architecture & Technical Approach

### Shared Path & XML Helpers (`src/shared/deviceArtExport.ts`)
- Pure resolvers for each frontend preset mapping `(systemSlug, targetFolderRel, romFilename, presetConfig)` → `{ coverRelPath, textSynopsisRelPath?, gamelistXmlRelPath? }`.
- Pure `upsertGamelistXml(existingXml: string | null, entries: GamelistEntry[]): string` XML builder/merger with proper XML entity escaping and preservation of unknown tags (`<playcount>`, `<lastplayed>`, `<favorite>`).
- Extend `src/shared/storageAutoConfig.ts` to detect frontend OS signatures (`Miyoo` / `.tmp_update` / `Imgs` → OnionOS; `MUOS/info/catalogue` → MuOS; `ES-DE` / `gamelist.xml` → ES-DE / EmulationStation).

### Backend (`server.ts`, `src/server/db.ts`)
- Persist `deviceArtExportConfig` JSON column on `scraper_config` (new SQLite migration).
- Add `GET /api/items/:id/cover-export?maxWidth=300&format=png` (reusing cached local cover art, fetching lazily if missing, and converting/resizing cleanly to PNG when needed—or streaming original PNG/WebP/JPEG if canvas/sharp resize is done client-side via `OffscreenCanvas` / `createImageBitmap` so the server needs **zero native image dependencies**!).
  - *Smart Trade-Off*: Doing PNG transcoding + aspect-preserving downscaling in the browser via `createImageBitmap` + `HTMLCanvasElement`/`OffscreenCanvas` keeps the Alpine Docker image tiny and avoids native `sharp`/`canvas` build complexity while guaranteeing valid PNG bytes for OnionOS/MuOS!

### Frontend (`src/hooks/useBulkStorageInstaller.ts`, `src/components/DeviceExportPanel.tsx`)
- Integrate post-ROM artwork write + batched end-of-job `gamelist.xml` flush per system folder (so installing 50 SNES games only writes `gamelist.xml` once at the end instead of 50 times).

---

## 4. Verification Plan
- Unit tests for all 4 frontend path resolvers (OnionOS, MuOS, EmulationStation, ES-DE), FAT32 stem matching, and `upsertGamelistXml` preserving existing `<playcount>` / `<favorite>` nodes.
- Unit tests for frontend OS auto-detection in `storageAutoConfig.ts`.
- Live browser test installing a multi-game batch to a mounted folder and verifying ROMs + resized PNG covers + valid `gamelist.xml` are written cleanly.
