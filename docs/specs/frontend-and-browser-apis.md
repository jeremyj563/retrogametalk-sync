# Frontend Architecture, Isomorphic Modules & Browser Hardware APIs

This document covers the browser client (`src/App.tsx`, `src/components/*`, `src/hooks/*`, `src/utils/*`) and the isomorphic domain layer (`src/shared/*`) shared between the React 19 frontend and Node.js 22 backend.

---

## 1. Frontend Build, Workspaces & CRT Design System

### React 19 + TypeScript 7 + Vite 8 + D3 + Motion
- **Five-Workspace CMS Shell (`App.tsx`):** Organizes the console into **Sync** (`OverviewPanel`), **Catalog** (`CatalogPanel` — Grid, List, and viewport-bounded Local Disk Tree), **Sync Rules** (`SyncRulesPanel`), **Device Export** (`DeviceExportPanel`), and **System Settings** (`SystemSettingsPanel`), paired with persistent sidebar chrome (**Storage Device Drive Bay**, **Service Telemetry**, **Mirrored Systems**, **CRT Display Studio**), slide-over drawers (**Game Detail**, **Devices Fleet**, **Failed Queue**, **Trophy Case**), browser history synchronization, and unsaved-changes dirty guards.
- **Data Visualization & Motion:** Uses **D3 (`d3`)** for catalog growth, throughput, and rate-limit telemetry charts and **Motion (`motion`)** + GPU-composited CSS transitions for smooth drawer, lightbox, and cover-art choreography.

### Tailwind CSS v4 & CRT Display Studio (`src/shared/crtDisplay.ts`)
- **CSS-First Dynamic Phosphor Engine:** `computeCrtCssVariables()` maps **7 Phosphor Palettes** (3 starter: `Green`, `Amber`, `Cyan`; 4 trophy-unlockable: `DMG Olive`, `Synthwave`, `Virtual Boy`, `Trinitron`), **4 Monitor Presets** (`Subtle`, `PVM`, `Arcade`, `BVM`), 0–100% FX sliders (scanlines, Gaussian bloom, vignette, aperture grille, RGB chromatic aberration), and **5 Living UI Motion** tiers (`off`, `low`, `medium`, `high`, `ultra`) onto root CSS custom properties.
- **CRT Phosphor Dissolve Notices (`src/shared/ephemeralNotice.ts`, `EphemeralNotice.tsx`, `useEphemeralPresence.ts`):** Unified timed-confirmation lifecycle featuring hover/focus-pausable bottom phosphor decay hairlines, horizontal CRT beam-pinch dissolve exits, and zero-jump height/margin collapse—respecting both **Living UI Motion = Off** and OS `prefers-reduced-motion: reduce`.
- **Dynamic Palette-Synced Favicon (`src/utils/favicon.ts`):** Live-tints the sculpted 16-bit cartridge SVG favicon (`/favicon.svg`) and browser `theme-color` whenever the active CRT palette or Dry Run mode changes.
- **Built-In Web Audio VGM Synthesizer (`src/utils/retroMusicPlayer.ts`, `HeaderSoundDeck.tsx`):** Zero-dependency lookahead Web Audio sequencer with procedural convolution reverb, custom `PeriodicWave` timbres, 3-voice ensemble chorus, cabinet EQ, percussion synthesis, and 7 original multi-section looping VGM compositions unlocked via Trophy Points—off by default, auto-pausing on hidden tabs, and ducking automatically for chimes.

---

## 2. Real-Time Operational Telemetry via SSE (`EventSource`)

- **Why SSE Instead of WebSockets?** User actions are discrete REST mutations with clear HTTP status semantics, while live telemetry (active transfers, speed samples, logs, catalog updates, queue recovery countdowns, achievement unlocks) is strictly server-to-client. Native `EventSource('/api/events')` reconnects automatically and traverses HTTP/1.1 & HTTP/2 reverse proxies cleanly.
- **Hero Showcase & Layout-Stable Transfers (`OverviewPanel.tsx`):** Pairs an adaptive-aspect, fixed-height box-art frame (retained-outgoing dual-layer crossfade + smooth natural-aspect width easing + click-to-open Game Detail Drawer) with a **Speed-Reactive Sync Wave** oscilloscope trace and a run-docked transfer progress bay that prevents vertical layout thrashing during rapid small-ROM bursts.

---

## 3. Shared Isomorphic Domain Layer (`/src/shared/*`)

Domain rules live in `/src/shared/` with zero DOM or Node-only dependencies so client and server stay 100% consistent:

| Module | Shared Responsibility |
| :--- | :--- |
| **`romNaming.ts`** | **No-Intro + T-En Hybrid** formatter (`{statusParen}` + `{modBracket}`), custom cursor-aware token parser/validator, per-type template overrides, FAT32 character/length enforcement, `buildUpgradeMatchStem()`, and multi-pass **variant filename collision disambiguation**. |
| **`smartRomPicker.ts`** | Semantic/revision/build-date/maturity ROM version comparator (`v1.10 > v1.9`, `Final > Beta`, `Rev B > Rev A`) and Catalog filter-context scoring across multi-archive and multi-ROM releases. |
| **`storageAutoConfig.ts`** | Multi-ecosystem folder discovery across **75+ retro platforms** (OnionOS/GarlicOS, ES-DE/Batocera/EmuDeck, MiSTer, Analogue Pocket OpenFPGA, flashcarts), parent-root consensus, nested ROM-root & shorthand subfolder casing inference, and non-destructive diff merging. |
| **`storageFolderMappings.ts`** | 3-layer destination path resolution (`Universal Defaults` → `Mounted Device Auto-Config` → `Saved Manual Overrides`), 11-category ROM-type subfolder routing, and canonical console slug deduplication. |
| **`systemCatalog.ts`** | Canonical platform registry, `extractGamePlatformSlugsFromWpTypes()` WP REST CPT parser, manufacturer grouping, and alias normalization (`gb_roms` ↔ `gameboy-roms`, `gcn-iso` ↔ `gamecube`, etc.). |
| **`releaseTypeFilter.ts` & `syncRuleMatcher.ts`** | Unified 11-type release/file classifier (with bracket-scoped language parsing and base-dump vs. hack disambiguation) and parity rule matcher honoring per-game `pin`/`ignore` overrides. |
| **`installedUpdate.ts`** | Shared **Update ready** (local newer mirror) vs. **Update on RGT** (remote archive drift, filtering metadata-only WP edits) classifier. |
| **`catalogIndexerPlan.ts` & `queueAutoResume.ts`** | Delta vs. full index planning, live mid-run indexer queue reconciliation, and persistent crash-loop backoff scheduling. |
| **`deviceIdentity.ts` & `deviceInstallView.ts`** | `.rgt-device.json` schema validation, firmware/label probe heuristics, and batch-wide duplicate destination filename detection. |

---

## 4. Multi-Device Hardware IO via Chromium Web APIs

`rgt-sync` deploys and manages ROMs directly on physical SD cards and USB handheld drives plugged into the operator's workstation—without mounting the SD card into the server container or buffering multi-GB disc images in browser RAM:

- **Hardware-Pinned Card Identity & IndexedDB Persistence (`src/utils/sdCardFs.ts`, `src/utils/deviceHandleStore.ts`):**
  - Stamps a validated `<=4 KB` `.rgt-device.json` marker (`dev_<uuid>`) at the mounted root (protected from ROM scans and uninstalls) and matches handles via `FileSystemHandle.isSameEntry()`.
  - Persists Chromium `FileSystemDirectoryHandle` references in IndexedDB (`rgt_device_handles_v1`) for automatic reload reconnection or 1-click **Reconnect `<Device>`** in the Sidebar Drive Bay and **Devices Fleet Drawer**.
  - Explicitly detects insecure plain-LAN HTTP origins (`!window.isSecureContext`) vs. non-Chromium browsers (`evaluateFileSystemAccessSupport`) to display exact HTTPS / fallback guidance.
- **Direct Web Streams Piping & Live Install Queue (`useBulkStorageInstaller.ts`):**
  - Streams `/api/items/:id/download-rom` responses chunk-by-chunk directly into `FileSystemWritableFileStream` with backpressure, live byte/speed telemetry, Screen Wake Lock (`navigator.wakeLock`), transactional abort cleanup (removing partial 0-byte placeholders), and **live queue appending** so clicking additional games while transferring enqueues them seamlessly.
  - Checks `scanTargetFolder()` and exact-file matches before creating folders or invoking server extraction, avoiding unnecessary I/O on already-installed games.
- **In-Place Upgrades & Path-Confined Safe Uninstall:**
  - Upgrade installs match superseded older files via `buildUpgradeMatchStem()`, write the new version first, and remove the old file only after verified completion.
  - **Uninstall from `<Device>`** (`deleteInstalledRomFromDevice`) verifies `readwrite` permission upfront, resolves recorded paths plus shifted-mount/subfolder/FAT32 fallbacks with per-batch folder scan caching, supports responsive mid-run cancellation (`AbortController`) across 1,000+ game batches, refuses to silently wipe catalog flags if zero files exist on disk, and operates strictly inside the mounted external storage handle.
