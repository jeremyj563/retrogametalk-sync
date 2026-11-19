# Frontend Architecture, Isomorphic Modules & Browser Hardware APIs

This document covers the browser client (`src/App.tsx`, `src/components/*`, `src/hooks/*`, `src/utils/*`) and the isomorphic domain layer (`src/shared/*`) shared between the React 19 frontend and Node.js 22 backend.

---

## 1. Frontend Build & Styling Stack

### React 19 + TypeScript 7 + Vite 8
- **React 19**: Built with strictly typed functional components, custom operational hooks (`useBulkStorageInstaller`), imperative dirty-state guards (`OperationsPanelHandle`) that intercept browser Back/Forward navigation when unsaved settings exist, and `window.history.pushState` / `popstate` synchronization across sections.
- **Vite 8 (`@vitejs/plugin-react`)**: Provides near-instant dev startup via Express middleware mode (`server: { middlewareMode: true }`) and optimized ES2022 production asset bundling.

### Tailwind CSS v4 (`@tailwindcss/vite`) & Dynamic CRT Design System
- **Why Tailwind v4 with `@tailwindcss/vite`?** Tailwind v4 replaces legacy `tailwind.config.js` + PostCSS plugin chains with a single native Vite plugin and CSS-first `@import "tailwindcss";` + `@theme` token definitions in `src/index.css`.
- **Phosphor CRT Shader & Token Engine (`src/shared/crtDisplay.ts`)**:
  - Rather than hardcoding static green colors, `computeCrtCssVariables()` translates user-selected phosphor palettes (**Green** `#38e56b`, **Amber** `#ffb000`, **Cyan** `#38d9f5`), monitor presets (**Subtle**, **Sony PVM**, **Arcade**), 0–100% FX sliders (scanlines, Gaussian bloom, vignette, aperture grille, RGB chromatic aberration), and 5 UI motion tiers (`off`, `low`, `medium`, `high`, `ultra`) into root CSS custom properties (`--crt-phosphor-rgb`, `--crt-scanline-opacity`, `--crt-ca-shift`, etc.).
  - Hardware-accelerated CSS overlays (`pointer-events: none`) render scanlines, aperture grilles, and rolling V-sync hum bars without interfering with click/focus hit-testing or scrolling performance.
  - Respects accessibility and focus: users can set UI Motion to `Off` for zero continuous animations while preserving instant interactive hover/focus states.

---

## 2. Real-Time Operational Telemetry via SSE (`EventSource`)

### Why Server-Sent Events Instead of WebSockets?
`rgt-sync` streams high-frequency operational state—live byte-level download progress, throughput samples, activity logs, rate-limiter backoff events, and catalog counters—from the server to open browser tabs.
- All user commands (`start`, `stop`, `retry`, `PUT /api/config`, `DELETE /api/items`) are discrete, request/response mutations ideally suited to standard REST calls with HTTP status codes.
- All live telemetry is strictly **server-to-client**. Native browser `EventSource('/api/events')` provides automatic reconnection out of the box, works seamlessly over standard HTTP/1.1 and HTTP/2 reverse proxies without WebSocket `Upgrade` header misconfigurations, and carries zero client library bundle weight.

### Layout-Stable High-Frequency Transfer UI (`OverviewPanel.tsx`)
When mirroring 8-bit and 16-bit consoles (Atari 2600, Game Boy, NES, Game Gear), archives are often 16 KB–256 KB—meaning dozens of files start and finish per second.
- Naive conditional rendering (`{activeTransfer && <ProgressBar />}`) causes jarring vertical layout thrashing as the entire dashboard shifts down on file start and snaps back up on file completion.
- `OverviewPanel` solves this with a **run-docked transfer progress bay**: the transfer strip stays persistently mounted at a fixed height for the entire duration of an active sync run (`status.isRunning`), transitioning smoothly into a brief inter-file `"Preparing next file…"` hold state (1.2s grace debounce) between rapid small-file completions so page geometry never bounces.

---

## 3. Shared Isomorphic Domain Layer (`/src/shared/*`)

Because `tsconfig.json` and Node 22 share ES module semantics across client and server, complex domain rules are written once in `/src/shared/` with zero DOM or Node-only dependencies:

| Module | Shared Responsibility |
| :--- | :--- |
| **`smartRomPicker.ts`** | Parses unstructured ROM/hack/translation naming conventions into a comparable tuple (`schemeRank`, `numericParts[]`, `letterSuffix`, `stageRank` from `alpha` < `beta` < `rc` < `stable` < `hotfix/final`, and `stageNumber`) and scores multi-archive/multi-variant releases against active user filter context (language, region, release type, search terms). |
| **`romNaming.ts`** | Generates clean, human-readable prepared filenames (`Title (Region) [Role] (vX.Y).ext`), extracts version tokens from filenames/descriptions, strips scene dump tags, enforces FAT32 illegal-character replacement and configurable byte/char length budgets (`romMaxFilenameLen`), and computes stem-normalized keys (`buildUpgradeMatchStem`) for SD card upgrade matching. |
| **`storageFolderMappings.ts`** | Maintains sensible default console directory names for 30+ platforms (compatible with RetroArch, ES-DE, Batocera, OnionOS, MuOS, ArkOS, Knulli), normalizes user overrides, classifies releases into 7 storage categories (`retail`, `hack`, `translation`, `homebrew`, `port`, `prototype`, `other`), and resolves final target paths (`/<console>/` vs. `/<console>/<TypeSubfolder>/`). |
| **`systemCatalog.ts`** | Canonical registry mapping raw repository slugs and aliases (`snes-rom`, `gcn-iso`, `psx2psp-eboots`, etc.) to human-friendly console names, platform manufacturers (Nintendo, Sega, Sony, NEC, Atari, SNK, Commodore, Arcade, etc.), and non-system page exclusions. |
| **`releaseTypeFilter.ts`** | Maps release tags and per-file roles (`ROM`, `English Translation`, `Hack`, `Patch`, `Manual`, `Music`, etc.) into canonical filter keys so sync-time filtering and Catalog UI filtering agree 100%. |
| **`catalogSort.ts` & `gitUrl.ts`** | Validates catalog sort modes and builds provider-aware commit/branch/tag URLs across GitHub, GitLab (`/-/tree/`, `/-/commit/`), Gitea/Forgejo/Codeberg, and Bitbucket from `GIT_URL`. |

---

## 4. Direct Hardware Installation via Chromium Web APIs

One of `rgt-sync`'s flagship engineering capabilities is installing extracted, renamed, ready-to-play ROMs directly from a remote/Dockerized `rgt-sync` server onto a local SD card or USB handheld drive plugged into the user's workstation—**without mounting the SD card into the server container and without buffering multi-gigabyte ISOs/CHDs in browser RAM**.

### File System Access API (`src/utils/sdCardFs.ts`)
- Calls `window.showDirectoryPicker({ mode: 'readwrite', id: 'rgt-sync-sd-card' })` to obtain a sandboxed `FileSystemDirectoryHandle` to the user's mounted SD card or handheld root.
- Traverses and lazily creates target console subdirectories (`resolveOrCreateSubdirectory`), scanning existing directory entries (`scanTargetFolder`) prior to writing so duplicate files and older versions are detected immediately.
- **Cross-Browser Graceful Fallback**: Feature-detects `showDirectoryPicker` (`isFileSystemAccessSupported()`). On Firefox or Safari—where the File System Access API is unavailable—individual Prepared ROM extraction downloads (`/api/items/:id/download-rom`) continue to work via streamed HTTP attachments.

### Web Streams Direct Sector Piping (`streamHttpPayloadToSdFile`)
When installing a 650 MB PlayStation `.chd` or repacked multi-bin `.zip` disc set:
1. The browser opens a `fetch('/api/items/:id/download-rom?...', { signal })` request while the server streams `7z e -so` (or `yazl`) output on the fly.
2. The browser opens a `FileSystemWritableFileStream` on the destination SD card file (`fileHandle.createWritable({ keepExistingData: false })`).
3. A `ReadableStreamDefaultReader` loop reads each `Uint8Array` network chunk and awaits `writable.write(value)` with natural backpressure—keeping browser heap usage flat (a few megabytes) even across multi-gigabyte batch installs.
4. **Transactional Abort Cleanup**: If the user cancels mid-transfer (`AbortController.abort()`) or the stream errors, `streamHttpPayloadToSdFile` aborts the writable stream and removes any newly created 0-byte placeholder file (`dirHandle.removeEntry(filename)`) so the SD card never ends up with unplayable half-written ROMs.

### Stem-Aware In-Place Version Upgrades (`findUpgradeCandidateOnCard`)
ROM hacks, homebrew titles, and fan translations update frequently (e.g., `Super Metroid Redux [Hack] (v1.1).sfc` → `Super Metroid Redux [Hack] (v1.2).sfc`).
- During target folder scanning, `buildUpgradeMatchStem()` normalizes filenames into `(canonicalTitleStem, roleCategory)`.
- When a newer version is queued for installation, `findUpgradeCandidateOnCard()` matches the existing older file on the SD card, writes the new version, deletes the superseded file once the new write succeeds, and records the release as **Installed** (`POST /api/items/installed`) in SQLite.

### Non-Blocking Background Dock & Screen Wake Lock (`useBulkStorageInstaller.ts`)
- Bulk installations run inside a top-level React hook (`useBulkStorageInstaller`) anchored at `App.tsx`, allowing the user to close the modal into a compact `BulkInstallDock` and continue browsing the Catalog or viewing Sync logs while gigabytes stream to their SD card in the background.
- Acquires `navigator.wakeLock.request('screen')` (when supported by the browser) for the duration of active SD card writes so the OS does not suspend network or USB mass-storage I/O mid-batch, releasing the lock automatically upon completion or cancellation.
