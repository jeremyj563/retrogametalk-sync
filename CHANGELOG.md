# Changelog

All notable changes to **RetroGameTalk Sync** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to bare `1.x.y` [Semantic Versioning](https://semver.org/).

## [1.42.1] - 2026-11-25

- Offloaded `README.md` visual preview screenshots out of git history onto a dedicated GitHub Release asset bucket (`readme-assets`) to eliminate repository bloat on UI updates:
  - **Zero-Bloat Screenshot Publishing (`.github/workflows/update-screenshots.yml`)**: Replaced the `chore/update-readme-screenshots` branch/PR binary commit flow with atomic `gh release upload readme-assets ... --clobber` publishing to a rolling `--prerelease --latest=false` GitHub Release (keeping SemVer releases and `docker-publish.yml` untouched) plus an inline Actions Step Summary.
  - **Externalized `README.md` Previews & Ignore Rules**: Updated all 5 `README.md` preview images to render from `releases/download/readme-assets/*.webp`, removed tracked `docs/assets/screenshots/*.webp` binaries, and added `docs/assets/screenshots/` and `public/assets/aistudio/` to `.gitignore` (and `public/assets/aistudio` to `.dockerignore`).
  - **Git History Scrub Helper (`scripts/scrub-screenshot-history.sh`)**: Added a safe, `--dry-run`-by-default `git-filter-repo` mirror scrub script with live `readme-assets` pre-flight verification, local rollback bundle creation, before/after size reporting, stale `chore/update-readme-screenshots` branch cleanup, and optional `--include-aistudio-assets` support.

## [1.42.0] - 2026-11-25

- Reworked **Device Export → 02. ROM Filename Formatting** around modern **No-Intro + T-En** naming standards with an embedded all-type live preview matrix and cursor-aware pattern builder:
  - **Type-Aware Hybrid Naming Engine (`{statusParen}` + `{modBracket}`)**: Separated origin/development status tags in parentheses (`(Proto)`, `(Demo)`, `(Homebrew)`, `(Port)`, `(Unl)`, `(Rev A)`) from post-release fan modifications in square brackets (`[T-En v1.3]`, `[T-Es v2.0]`, `[Hack v1.42]`, `[Undub v1.1]`), added language-aware machine-translation tags (`[T-En MTL v1.0]`), and defaulted fresh installs to **No-Intro + T-En Hybrid** while keeping existing saved templates untouched and upgrading `buildUpgradeMatchStem` to match seamlessly across legacy and hybrid conventions.
  - **Live All-Type Preview Matrix & Real Catalog Sampling (`GET /api/device-export/naming-samples`)**: Added an always-visible 10-type preview table inside Step 02 with syntax-tinted filename segments, tabular character counts, explicit FAT32 sanitization/truncation badges, a **`Built-in Examples` / `Real Catalog Games`** toggle, and a **`Shuffle`** button to test real indexed titles from your library.
  - **Cursor-Aware Pattern Builder & Optional Per-Type Overrides (SQLite v29)**: Upgraded template editing with caret-position token insertion, live hover token value inspection, inline syntax validation (unknown tokens & unbalanced delimiters), quick max-length presets (`Unlimited`, `64`, `128`, `255`), and optional per-ROM-type template overrides persisted across global config, per-device profiles, and configuration backups.

## [1.41.0] - 2026-11-24

- Added full **interrupted & stopped download queue recovery** so queues halted by `SIGTERM` (e.g., pod upgrades/restarts) or manual **Stop** can always be resumed, re-queued, or cleared without getting stuck in `queued` state:
  - **One-Click Resume & Clear Queue (`POST /api/queue/resume`, `POST /api/queue/clear`)**: Added a **Paused Download Queue** recovery strip on both the **Sync** page and the **Catalog** toolbar whenever releases are left waiting with no active worker—offering **`Resume Queue (N)`**, **`View Queued`**, and 2-step **`Clear Queue`** controls.
  - **Restored `Download Filtered (n)` & Single-Item Resume**: Updated catalog queries (`/api/items`, `/api/items/ids`, and `queueCatalogDownloads`) plus Catalog selection summaries, row/card buttons, and the **Game Detail Drawer** to treat paused `queued` releases as queueable/resumable whenever no download queue worker is actively running.
  - **Clean Restart Preservation**: Updated abort teardown and SQLite startup recovery (`initDb`) so in-flight files interrupted during a download queue run return cleanly to `queued` rather than turning into spurious `failed` entries or disappearing from the resumable queue.

## [1.40.0] - 2026-11-24

- Redesigned **Catalog → Local Disk Tree** into a modern, self-contained CRT file explorer and fixed the empty-viewport scroll bug when drilling into deeply scrolled subdirectories:
  - **Viewport-Bounded Explorer & Smart Scroll Memory**: Bounded the directory listing inside its own scrollable explorer pane with sticky column headers, automatically resetting scroll to the top (and clearing stale folder filters) whenever you enter a subdirectory or inspect an archive, bringing the explorer into view if the outer page was scrolled down, and restoring your exact parent scroll offset when navigating back up.
  - **Unified Path Bar, Sorting & Contextual Summary**: Consolidated Up navigation, interactive path breadcrumbs, one-click path copy, folder filtering, column/dropdown sorting (`Name A–Z`, `Name Z–A`, `Largest First`, `Recently Modified`), a quick `..` parent folder row, and an inline contextual selection bar into one clean explorer frame—while simplifying the outer Catalog toolbar.
  - **Direct Local File Downloads & Safe Row Deletion**: Added `GET /api/fs/download` for streaming validated files directly from local disk alongside domain-aware ROM/disc/archive/patch icons, unboxed file type metadata, and inline 2-step delete confirmation to prevent accidental folder deletions.

## [1.39.2] - 2026-11-24

- Fixed the **Game Detail Drawer** when opened from the **Sync** page (and its **Failed Queue** drawer) so mounted-device **`Install to <Device>`**, **`Upgrade on <Device>`**, **`Reinstall`**, and **`Uninstall`** actions appear automatically as soon as a release finishes downloading to local storage:
  - **Connected Storage Device Installer to Sync View**: Passed the app-wide storage device installer into `OverviewPanel` and `FailedQueueDrawer` so their `GameDetailDrawer` instances receive the mounted device profile, live install/queue state, and direct install/upgrade/export/uninstall callbacks—matching **Catalog**.
  - **Immediate Post-Transfer Refresh**: Re-fetched the open release record the moment its active download transfer finishes (in addition to SSE catalog revision updates) and subscribed to synchronous device install updates so the footer transitions straight into **`Install to <Device>`** / **`Reinstall`** without closing and reopening the drawer.

## [1.39.1] - 2026-11-24

- Updated the **Release & Publish Container Image** GitHub Actions workflow (`docker-publish.yml`) to skip running on non-code commits and PRs—including merges from **`chore/update-readme-screenshots`**, documentation/Markdown edits (`docs/**`, `**/*.md`), screenshot capture tooling (`scripts/capture-screenshots/**`, `update-screenshots.yml`), and repo metadata files (`LICENSE*`, `.gitignore`, `.env.example`, GitHub templates).

## [1.39.0] - 2026-11-24

- Redesigned the **Catalog** toolbar and filter controls for a cleaner, calmer, and more approachable browsing experience, and added a **`Sort: Recently Installed`** ordering option:
  - **Streamlined 3-Row Controls & Progressive Disclosure**: Kept **Search**, **Systems**, **Types**, a collapsible **More Filters** drawer (`Genres`, `Regions`, `Languages`, `Sources`, `Status`, `Pinned`/`Ignored`), and **Sort** on one balanced row—eliminating the orphaned Sort row and reducing toolbar clutter.
  - **Unified Quick-Filter Tracks & Grouped Active Filters**: Consolidated download toggles (**Downloaded / Not Downloaded**) and device scope + install toggles (**Device Selector · Installed / Not Installed / Updates**) into cohesive segmented tracks, collapsed multi-select active filter walls into 1-click grouped summary chips (e.g., `Systems: 15 selected` with click-to-edit and full tooltip), and quieted the bottom catalog index footer so **Download Filtered** stands out as the primary action.
  - **Recently Installed Sort (`installed_desc`)**: Added **`Sort: Recently Installed`** to the Catalog sort selector with device-aware SQL ordering—sorting by the selected storage device's install timestamp when scoped to a specific device, or latest install across devices when viewing **Any Device**.

## [1.38.9] - 2026-11-24

- Hardened **Catalog Indexing & Discovery** so interrupted, partial, or depleted console indexes can no longer get stuck as **"Fresh"** in delta-only mode and silently miss releases:
  - **WP REST Pagination Completeness & Retries**: Added HTTP `408` timeout retries, per-page non-JSON retry backoff, `X-WP-Total` tracking, and explicit `completed` / `pagesFetched` verification in `listConsoleReleasesViaWpRest` so mid-crawl pagination failures never silently masquerade as finished full scans.
  - **Poisoned Cursor Prevention & Automatic Self-Healing Backfill**: Stopped `startCatalogIndex`, Full Sync Phase 1, and Incremental Sync from marking incomplete or unsupported scans as `fullyIndexed: true`, invalidated affected console cursors whenever catalog rows are deleted, and updated index planning & freshness checks to automatically detect depleted, zero-post, or partial-page consoles and upgrade them from delta mode back to a full backfill.
  - **Non-Destructive Taxonomy Preservation & Catalog Full Re-index Action**: Preserved existing WordPress taxonomies (such as `English Patched` → `English Translation`) whenever subsequent HTML-only or disk-reconciliation metadata upserts supply empty taxonomy arrays, and added a direct **`Full Re-index`** action right next to **`Update Target Consoles`** in the Catalog banner.

## [1.38.8] - 2026-11-24

- Fixed **Device Export → Mounted Device** so manually overridden console folders are no longer reported under **`unrecognized folders ignored`**, and added built-in recognition for standard OnionOS / Miyoo Mini spelled-out ROM folders:
  - **Manual Override Filtering**: Excluded any folders mapped via global or per-device manual console overrides (matching case-insensitively and across direct vs. `Roms/`-prefixed mounts) from the `unrecognized folders ignored` count and list.
  - **OnionOS / Miyoo Mini Aliases**: Added automatic folder detection for `FIFTYTWOHUNDRED` (Atari 5200), `SEGASGONE` (Sega SG-1000), `SEVENTYEIGHTHUNDRED` (Atari 7800), `THIRTYTWOX` (Sega 32X), and `TWENTYSIXHUNDRED` (Atari 2600).

## [1.38.7] - 2026-11-24

- Surfaced clear **stale index (`>12h`)** indicators directly on and beside all catalog index update controls across **Sync**, **Catalog**, and **Sync Rules**:
  - **Unmasked Catalog Freshness Banner**: Fixed the Catalog indexer banner so stale/unindexed target consoles (e.g., `17/17 target consoles stale (>12h)`) are always shown alongside remaining non-target consoles instead of being hidden whenever unindexed consoles exist outside the active filter.
  - **Amber Stale Attention on Index Buttons & Direct Sync Tab Action**: Highlighted **`Update Target Consoles`** / **`Index Target Consoles`** in amber with inline counts (e.g., `Update Target Consoles (17 stale)`) in both **Catalog** and **Sync Rules**, added a direct **`Update Index (17 stale)`** / **`Pause`** control right next to the Sync tab's `Index X/Y fresh · Z stale (>12h)` readout, and added explanatory tooltips detailing the 12-hour Fresh vs. Stale threshold and oldest target check timestamp.

## [1.38.6] - 2026-11-24

- Added a custom SVG browser tab favicon based on the sculpted 16-bit ROM cartridge banner emblem:
  - **Crisp Tab-Optimized Cartridge Icon (`/favicon.svg`)**: Features the chamfered cartridge shell, side/top grip ribs, glowing inner CRT bezel with bold centered `>>>` sync chevrons tuned for 16×16 and 32×32 readability, lit 7-pin PCB edge bus, and dual-ring power LED.
  - **Live CRT Palette & Dry-Run Sync**: Dynamically tints the browser tab cartridge icon and browser `theme-color` to match the user's active CRT phosphor palette (Green, Amber, Cyan, Game Boy, Synthwave, Virtual Boy, Trinitron) as well as Dry Run mode.

## [1.38.5] - 2026-11-24

- Fixed **Uninstall from `<Device>`** reliability so ROM files on mounted storage devices are consistently located and physically deleted instead of silently skipped while clearing catalog badges:
  - **Multi-Subfolder, Mount-Depth & Case-Insensitive Resolution**: Added automatic fallback when recorded paths are missing (legacy installs or shifted mount roots such as card root vs. `Roms/`), discovering real console folders and sibling type subfolders (e.g., `/SFC`, `/SFC/trans`, `/SFC/hacks`) with case-insensitive directory/file lookup and per-batch folder scan caching (scanning each folder once instead of per game).
  - **FAT32 & Archive-to-ROM Matching**: Upgraded fallback ROM matching to handle FAT32-sanitized punctuation (e.g., `:` → ` - `), archive-vs-extracted extensions (`.zip` vs. `.sfc`), role-tag differences (`[T-En v1.x]`), and unambiguous title matches for legacy installs.
  - **Pre-Flight Write Permission Check & Bulk Silent-Wipe Guard**: Verifies/requests `readwrite` folder permission before deleting, refuses to silently wipe bulk catalog install records if zero files were found on disk (reporting the exact folders checked instead), and explicitly surfaces deleted-file vs. missing-on-disk counts in uninstall notices.

## [1.38.4] - 2026-11-24

- Fixed the **Cancel** button during bulk **Uninstall from `<Device>`** so long-running uninstalls can be stopped cleanly mid-run:
  - **Responsive Mid-Run Cancellation**: Replaced the disabled `Cancel` button during active uninstalls with a live **`Cancel Uninstall`** button wired to an `AbortController` (`cancelUninstall()`), periodically yielding to the browser event loop so clicks register immediately even during large 800+ game batches.
  - **Accurate Partial-Run Sync**: Stops immediately before deleting any further games, flushes catalog install removals strictly for the games already removed from the SD card prior to cancellation, preserves all remaining games untouched on disk and in the Catalog, and reports the exact canceled summary (e.g., `Uninstall canceled after removing 104 of 899 games...`).

## [1.38.3] - 2026-11-23

- Fixed bulk **Uninstall from `<Device>`** in the Catalog so cross-page selections count and remove **all** selected games installed on the mounted storage device instead of only the currently visible page:
  - **Cross-Page Mounted Install Tracking**: Extended `/api/items/ids` with an optional `mountedDeviceId` parameter (`installedOnMountedIds`) and added `POST /api/devices/:id/installs/lookup` so the Catalog bulk action bar accurately counts and resolves uninstall paths across all pages (and even across manually picked multi-filter selections).
  - **Scalable Large-Batch Uninstalls**: Chunked SQLite `IN (...)` batch queries and `DELETE /api/devices/:id/installs` updates (400 IDs per batch) so uninstalling 1,000+ games never exceeds SQLite variable limits, batched SD folder scan cache updates into a single state update, added live `Removing X / Y...` progress feedback, and cleared uninstalled games from the active selection on completion.

## [1.38.2] - 2026-11-23

- Eliminated the misleading **`Extracting ROM...`** status flash and unnecessary I/O when installing or reviewing games that are already present on the mounted storage device:
  - **Check Before Creating Folders or Extracting**: Reordered device write checks so `scanTargetFolder()` and exact-file duplicate detection run before creating destination subdirectories or entering the `extracting` stage; `Extracting ROM...` now appears only when an archive extraction and transfer is actually triggered (with truthful `Checking device...` shown only when an uncached folder is scanned).
  - **Fast Batched Skips**: Already-installed games skip immediately without per-row `Finalizing on device...` stalls or redundant post-run folder rescans when no files were written.

## [1.38.1] - 2026-11-23

- Improved default device name detection in the **Identify Storage Device** modal so newly mounted cards no longer pre-fill generic folder names like `Roms`, `SDCARD`, or `E:`:
  - **On-Card Label & Firmware Probing**: Added a fast root-level probe before opening the Identify modal that reads explicit labels when present (`autorun.inf` `label=`, muOS `MUOS/info/config/device.txt` hardware models, and custom Batocera/KNULLI/Recalbox `system.hostname`) and detects handheld/FPGA/flashcart signatures (OnionOS/Miyoo Mini, GarlicOS, Analogue Pocket, MiSTer FPGA, EverDrive/FXPAK, MinUI, ES-DE/EmuDeck) to pre-fill both the device name and matching form-factor icon.
  - **Clean Generic-Folder Handling**: Preserves real OS volume labels when the card root is selected (e.g., `/Volumes/MIYOO_MINI` → `MIYOO_MINI`), leaves the auto-focused **Device Name** input cleanly blank (with a 1-click `Use "<folder>"` shortcut and clear browser sandbox tip) when only a generic subfolder name is exposed, and stabilizes form state so background profile refreshes never reset typed input.

## [1.38.0] - 2026-11-23

- Added **Hardware-Pinned Storage Device Identity & 10+ Device Fleet Management** so multi-handheld and multi-SD-card libraries stay uniquely identified and effortless to organize:
  - **Auto-Stamped Card Identity (`.rgt-device.json` + `isSameEntry()`)**: Automatically stamps a compact hidden `.rgt-device.json` UUID marker (`dev_<uuid>`) at the root of mounted storage cards (with strict 4 KB validation, ROM scanner/uninstall protection, and non-blocking read-only fallback) paired with Chromium `FileSystemHandle.isSameEntry()` handle matching—uniquely identifying cards even when multiple devices share identical folder names (`Roms`, `SDCARD`) or move across machines.
  - **Identify / Link Storage Device Modal**: Mounting an unrecognized or unmarked storage root opens a 1-step prompt to either **Create New Device** (name, hardware form-factor icon, CRT color badge, optional pin) or **Link Existing Profile** (seamlessly migrating legacy `1.37.0` profiles or replacement SD cards while preserving install history and stamping the new card).
  - **Compact Sidebar Drive Bay & Searchable Devices Fleet Drawer**: Keeps the left sidebar Drive Bay compact at any fleet size (active device or smartest single reconnect shortcut + **Devices** drawer trigger) while introducing a slide-over **Devices Fleet Drawer** with live search, **Active / Pinned / Archived** tabs, inline editing (name, 7 hardware form-factor icons, 6 CRT-harmonized color badges), **Stamp Card ID** repair, one-click **Reconnect**, **Browse Installed** offline jump, **Pin / Unpin**, **Archive / Restore**, and inline **Delete** confirmation (SQLite migration v28).
  - **Offline Saved-Device Catalog Filtering**: Upgraded the Catalog device scope switcher into a searchable dropdown grouped by **Any Device**, **Mounted Now**, **Pinned**, **Saved Devices**, and collapsible **Archived**—enabling offline inspection of **Installed**, **Not Installed**, and **Updates** for any saved device even when its SD card is unplugged, plus color-coded device icons in **Release Details** and **Device Export**.

## [1.37.0] - 2026-11-23

- Added **Multi-Device Profiles, Persistent Reconnect Mounts & Device Uninstall** for managing multiple handhelds, SD cards, and FPGA devices independently:
  - **Per-Device Install History & Profiles (SQLite v27)**: Migrated install tracking into `storage_device_profiles` and `catalog_release_device_installs` (with automatic backfill of existing installed games and backward-compatible rollup columns) so installing a game on one device never overwrites install records on another. Added `/api/devices` CRUD endpoints, friendly device renaming, and optional per-device folder-mapping and ROM-naming overrides in **Device Export**.
  - **Persistent Handle Reconnect (IndexedDB)**: Mounted Chromium `FileSystemDirectoryHandle` references are saved locally in IndexedDB (`rgt_device_handles_v1`). On page load, previously authorized devices reconnect automatically when permission is still granted, or present a 1-click **Reconnect `<Device>`** button (plus quick-switch between remembered devices) in the Sidebar Drive Bay.
  - **Per-Device Catalog Filtering & Badges**: Added an inline **`<Device>` / Any Device** scope switcher next to the Catalog **Installed / Not Installed / Updates** filters, updated `/api/items`, `/api/items/ids`, and `/api/items/outdated` with `deviceId` scoping, and upgraded Catalog cards/rows and the **Release Details** drawer to display multi-device install badges (`Installed · Miyoo Mini +1`) and full per-device install lists.
  - **Safe Direct Uninstall from Mounted Device**: Added **Uninstall from `<Device>`** in the **Release Details** `More` menu and Catalog bulk selection bar with explicit inline confirmation, path-confined removal strictly inside the mounted external storage handle (removing only recorded ROM paths or legacy stem fallbacks without ever touching the local RGT Sync mirror), and immediate install-record cleanup.

## [1.36.0] - 2026-11-23

- Added **Live Install Queueing** for 1-click device installs so you no longer have to wait for the current game to finish before queueing more:
  - **Keep Clicking Install / Update / Reinstall While Transferring**: Clicking **Install**, **Update**, or **Reinstall** on additional games in the Catalog grid, Catalog list, Release Details drawer, Collections banner, Bulk Selection bar, or Updates bar while an install is actively running immediately appends them to the live install queue and shows their status as **Queued** until their turn starts.
  - **Automatic Deduplication & Per-Item Options**: Repeated clicks on an already-queued or actively installing game open the install queue details instead of creating duplicates, while newly queued upgrades preserve per-item overwrite/replacement rules and completed items persist immediately to **Reinstall** as the queue continues draining.

## [1.35.4] - 2026-11-23

- Made archive inspection directly accessible in the **Release Details** drawer without opening the `... More` menu:
  - **Clickable Archive Filenames & Inline Inspect Toggle**: Mirrored browsable archives (`.zip`, `.7z`, `.rar`, `.tar`) under **Included Downloads** now feature a clickable filename with folder icon + phosphor hover cue and a compact inline **Inspect** / **Hide Contents** toggle button on every row—allowing one-click inspection of both primary and secondary archives on multi-file releases, with active row highlighting while open.

## [1.35.3] - 2026-11-23

- Fixed Sega Genesis / Mega Drive `.md` ROMs failing with **"No playable ROM found"** during installs and **"Failed - Network error"** on direct archive entry downloads:
  - **Disambiguated `.md` ROMs vs. Markdown Docs**: Removed `.md` from the unconditional clutter list and added `isMarkdownDocEntry()` / `isClutterEntry()` so `.md` Sega Genesis / Mega Drive ROMs are detected as playable ROMs (and classified as `ROM` without bogus text preview in Archive Explorer) while actual Markdown documentation files (`README.md`, `CHANGELOG.md`, `Docs/*.md`, and small `.md` docs on non-Genesis systems) are still stripped as docs.
  - **Hardened Archive Entry Extraction & HTTP Streaming**: Wrapped extractor subprocesses (`7z`, `unzip`, `unrar`, `bsdtar`) in a `PassThrough` stream that waits for both stdout EOF and exit status before closing (preventing fast extractor failures from sending premature `200 OK` responses with `Content-Length` mismatches), passed `-sccUTF-8 -spd -i!<entry> --` to 7-Zip, escaped glob metacharacters (`[`, `]`, `*`, `?`) for `unzip`/`bsdtar`, fixed the `unzip -l` fallback parser, enforced `C.UTF-8` locale in extractor subprocesses and the Alpine `Dockerfile` runner stage, and deferred HTTP download headers until the first extracted byte arrives so failures return a clean HTTP 500 JSON error instead of Chrome's `"Failed - Network error"`.
  - **Expanded `ARCHIVE` & `HTTP` Debug Diagnostics**: Added detailed `DEBUG` log output whenever archive inspection finds zero playable targets (listing entry count, ignored count, and sample filenames/sizes) as well as across archive entry download routes and extraction stream lifecycle events.

## [1.35.2] - 2026-11-23

- Fixed a brief race window where a Catalog item's **Install** button flashed back to **Install** (and could be clicked again to start a duplicate transfer) after an install finished before switching to **Reinstall**:
  - **Atomic Finalizing → Reinstall Transition**: Kept the active device transfer in the **Finalizing** state while persisting `installed_at` to the server and synchronously patching visible Catalog rows, the open Game Details drawer, and cached snapshot state via `subscribeItemsInstalled` before marking the install job `completed`.
  - **Consistent Mid-Batch State**: Added `isItemInstalledOnMountedDevice()` so completed items in multi-game installs also stay labeled **Reinstall** while subsequent games in the same batch are still transferring, without sticking if an item is later unmarked as not installed.

## [1.35.1] - 2026-11-22

- Fixed false-positive **Update on RGT** alerts and infinite re-queue loops in **Installed ROM Updates**:
  - **Filter Out WordPress Metadata-Only Edits**: Cross-checked each release's WordPress `downloadHints` filenames against locally mirrored files in `catalog_release_files` (with normalized URI/sanitized-character matching) so metadata-only WordPress `modified_gmt` edits (tags, descriptions, screenshots) no longer trigger bogus `Update on RGT` counts when every ROM archive is already mirrored locally.
  - **SQLite Schema v26 (`remote_checked_at`)**: Added `remote_checked_at` on `catalog_releases` (`installed_remote_update_verification` migration) and persisted verified live release checks (plus authoritative discovered `downloadHints`) after Download Queue / Sync verification completes with 0 failures—clearing stale remote alerts immediately without bumping `downloaded_at` (so unchanged files never falsely flip to `Update ready`).
  - **Unified Update Classification Parity**: Routed Sidebar totals, Catalog `Updates (N)` facet counts, `installed=outdated` filtering, `GET /api/items/outdated`, and remote-update queue checks through the shared `classifyInstalledUpdateState()` / `hasActionableRemoteUpdate()` logic so all views stay 100% in sync.

## [1.35.0] - 2026-11-22

- Added **Favorites, Custom Collections & Per-Game Sync Rule Overrides** for personal library curation and handheld loadouts:
  - **SQLite Schema v25 & Curation API**: Added `user_collections` (case-insensitive unique names), `user_collection_items` (many-to-many with `ON DELETE CASCADE`), and `is_favorite` / `sync_override` columns on `catalog_releases`, backed by validated REST endpoints (`/api/collections`, `/api/collections/:id`, `/api/collections/:id/items`, `/api/items/favorite`, `/api/items/sync-override`) plus `favoriteOnly`, `collectionId`, and `syncOverride` filtering across `/api/items`, `/api/items/ids`, and `/api/items/download`.
  - **One-Click Favorites & Custom Collections / Handheld Loadouts**: Added instant Star toggles on Catalog grid cards, list rows, and the Game Details header; a **Favorites (`N`)** toolbar toggle and compact **Collection** dropdown (`All Collections`, `Favorites`, custom collections with live counts, `+ New Collection…`); a contextual **Collection Active Banner** with 1-click **Queue Missing (`N`)**, **Install to `<Device>` (`N`)**, inline **Rename**, and **Delete**; a unified `+ Collection` bulk curation popover; and removable collection chips + picker inside the Game Details drawer.
  - **Per-Game Sync Rule Overrides (`Pin` / `Ignore`)**: Added `pin` (always mirror regardless of global console or release-type filters) and `ignore` (skip during automatic Full/Incremental Sync without blocking manual downloads) overrides editable in the Game Details `More` menu and Catalog bulk popover, with consistent parity across `doesCatalogReleaseMatchSyncRules`, Full Sync, Incremental Sync, Sync Preflight, and Catalog `Matches Sync Rules`.

## [1.34.0] - 2026-11-22

- Added **Installed ROM Update Detection & One-Click Device Upgrades** so actively updated RetroGameTalk hacks and fan translations stay current on mounted handhelds and storage devices:
  - **Version Drift Detection & SQLite Schema v24**: Added `installed_file_id` and `installed_filename` tracking on `catalog_releases` (`installed_rom_version_tracking` migration) plus a shared update classifier with a 60-second grace window that distinguishes **Update ready** (newer mirrored file already on disk) from **Update on RGT** (newer upstream release needing re-download first).
  - **Outdated API & Filterable Catalog View**: Added `GET /api/items/outdated`, `installed=outdated` filtering across `/api/items` and `/api/items/ids`, live `outdated` facet counts, and global `outdatedInstalledItems` / `outdatedLocalReadyItems` status totals; allowed queueing remote-newer updates on already-downloaded releases.
  - **One-Click Upgrade UX Across Catalog, Sidebar Drive Bay & Game Details**: Added a contextual **Updates (`N`)** toggle and batch **Update on `<Device>` (`N`)** / **Download Updates (`M`)** strip in the Catalog, amber **Update ready** / **Update on RGT** cues and promoted **Update** / **Download Update** buttons on cards, rows, and the Game Details drawer, and an inline **Update All** shortcut in the Sidebar Storage Drive Bay. Upgrade runs automatically overwrite exact matches and remove superseded older-version ROMs on the mounted device after each new file finishes streaming cleanly.

## [1.33.0] - 2026-11-22

- Hardened credential handling, added optional environment-driven self-hosted UI/API authentication, and introduced secret-free JSON configuration **Backup & Restore**:
  - **Zero Plaintext Secrets in `/api/config`**: Masked the stored RetroGameTalk password out of `GET /api/config` and `PUT /api/config` responses (`password: ""` with `hasPassword: true`), preserved existing server-side passwords when `password` is omitted or blank, added an explicit `clearPassword: true` action, and updated **System Settings** with a blank replacement input and inline **Clear** toggle.
  - **Optional Self-Hosted App Lock (`APP_AUTH_PASSWORD`)**: Added zero-dependency `scrypt` + constant-time credential verification, HMAC-SHA256 signed `HttpOnly` session cookies, same-origin CSRF checks on state-changing requests, IP sliding-window brute-force rate limiting on `/api/app-auth/login`, a CRT-themed unlock screen (`AppAuthGate`), and a sidebar **Sign Out** button when enabled (with zero friction when `APP_AUTH_PASSWORD` is unset). Documented across `.env.example`, `docker-compose.yml`, and the Helm chart (`values.yaml` & `secret.yaml`).
  - **Configuration Backup & Restore (Secret-Free JSON)**: Added `GET /api/backup/export`, `POST /api/backup/import`, and a **Configuration Backup & Restore** card in **System Settings** to download and restore Mirror URLs, Sync Rules, schedule, pacing, ROM naming, and console folder mappings with strict schema validation, inline diff previews, automatic skipping of env-locked fields, and guaranteed exclusion of all credentials and host-specific disk paths.

## [1.32.2] - 2026-11-22

- Fixed `.rar` archive inspection and extraction failing in Alpine Docker containers with `Cannot open the file as archive` (Alpine's `7zip` package strips proprietary RAR codecs):
  - **Multi-Arch Native `unrar` + `libarchive-tools` in Container Image**: Bundled the multi-arch Alpine `unrar` binary (from `ghcr.io/linuxserver/unrar`) alongside `libarchive-tools` (`bsdtar`) in the `Dockerfile` so RAR4, RAR5, and solid `.rar` archives inspect and stream natively on both `linux/amd64` and `linux/arm64`.
  - **Multi-Backend RAR Inspection & Streaming**: Updated the archive service to prefer native `unrar` (`unrar lt` / `unrar p -inul`) for `.rar` files, probe whether `7z`/`7zz` actually has RAR codec support before invoking it, and fall back to `bsdtar` when `unrar` is unavailable.
  - **Magic-Byte Archive Diagnostics**: Added header sniffing (`RAR4`, `RAR5`, `ZIP`, `7z`, HTML/error pages, and empty 0-byte files) so corrupted or HTML error downloads report an actionable re-download message instead of a generic archive error.

## [1.32.1] - 2026-11-22

- Renamed **Index All Remaining Consoles** to **Index Remaining Consoles** across both the **Catalog** and **Sync Rules** pages for concise, consistent labeling.
- Added the **Update Target Consoles** (or **Index Target Consoles** when unindexed targets remain) fast-delta button alongside **Index Remaining Consoles** in the **Catalog** page's indexer strip so target console metadata can be refreshed directly from the Catalog.

## [1.32.0] - 2026-11-22

- Made **Index / Update Target Consoles** perform fast **delta updates** by default for consoles that have already been indexed instead of re-fetching every WordPress REST page from page 1 to N:
  - **Incremental `modified_after` Cursor Scanning**: For already-indexed consoles, the background indexer now queries RetroGameTalk using each console's `lastIndexedAt` cursor (with a 2-minute safety overlap window for clock skew) so only newly published or recently edited releases are fetched and upserted, while preserving existing catalog totals (`totalWpPosts`, `totalPages`, `pagesIndexed`) and advancing the cursor to the scan start timestamp.
  - **Smart Mixed Runs**: When a mix of unindexed and already-indexed target consoles is selected, unindexed consoles run a full initial index, stale consoles run a fast delta check, and already-fresh consoles are skipped; when all target consoles are already indexed, clicking **Update Target Consoles** runs a fast delta check across all of them (stale first, then fresh).
  - **Explicit Full Re-index Escape Hatch**: Added a subtle **Full Re-index** button on the **Sync Rules** page (and `forceFull: true` support on `POST /api/catalog/index`) for forcing a complete page-1-to-N metadata rebuild when needed.
  - **Delta-Aware Progress & Copy**: Updated the **Sync Rules** and **Catalog** indexer status displays to distinguish delta checks (**Update Target Consoles**, `Checking updates X/Y · console · N updated`) from initial/full indexing (**Index Target Consoles**, `Indexing X/Y · console · Page P/T · N cataloged`) with descriptive tooltips.

## [1.31.1] - 2026-11-22

- Unified all one-click storage device install actions across **Catalog** items (Grid cards and List rows), **Catalog** multi-select bulk bar, **Game Details** drawer, and the **Install to Device** window so they share identical behavior (auto-installing the latest primary playable ROM), consistent `HardDrive` iconography, unified naming (`Install` / `Reinstall`, `Install to <Device>` / `Install to Device`, `Install to <Device> (N)`), and matching tooltips:
  - Replaced the legacy **Express Install** caption and `FolderInput` icon in the multi-select bar with **Install to `<Device>` (N)** (`HardDrive`) and switched **Install Options (N)** to the `SlidersHorizontal` icon matching **Game Details > More > Install Options…**.
  - Unified the unmounted **Install to Device** button in **Game Details** to execute the exact same one-click mount-and-install flow as Catalog items while keeping **More > Install Options…** consistently accessible regardless of mount state.
  - Aligned the **Install to `<Device>`** window's primary CTA (`HardDrive` + **Install to `<Device>`** / **Mount Device & Install**), subtitle copy, and device action strip.
- Unified storage device **Mount Device**, **Switch Device**, and **Rescan** controls across the **Sidebar** dock, **Device Export** settings panel, and **Install to Device** window with consistent labels, icons (`FolderPlus`, `FolderSync`, `RefreshCw`), and descriptive tooltips.

## [1.31.0] - 2026-11-22

- Added direct one-click **Install** / **Reinstall** buttons to **Catalog** items (both Box-Art Grid cards and List rows) so downloaded games can be installed directly to a mounted storage device without opening the Game Details drawer.
- Added immediate, live byte-level storage device installation progress across the **Game Details** drawer, **Catalog** items, **Bulk Install Dock**, and **Install to Device** modal:
  - **Instant Progress Strip in Game Details**: Clicking **Install to `<Device>`** immediately reveals a live progress strip anchored above the sticky footer showing stage (`Inspecting archive…`, `Extracting ROM…`, `Installing to <Device>`, `Finalizing on <Device>…`), destination path, live bytes written / total, transfer speed (`MB/s`), percent bar, inline **Cancel**, and a dismissible completion/error summary.
  - **Live Byte Streaming Telemetry**: Instrumented File System Access API transfers with throttled byte progress and transfer rate reporting so large ROMs (hundreds of MB to multi-GB) smoothly advance from 0% to 100% across all install surfaces.

## [1.30.4] - 2026-11-22

- Added concise tooltips to **Catalog** view and indexer action buttons (**Refresh**, **Rescan**, **Pause Indexing**, and **Index All Remaining Consoles**) so it is clear at a glance whether an action queries local SQLite, rescans local disk, or fetches remote metadata from RetroGameTalk.

## [1.30.3] - 2026-11-22

- Fixed live mid-run Sync Rule reloads and made newly added consoles appear in the **Catalog** immediately:
  - **Immediate Mid-Run Queue Reload**: Fixed a bug where the worker pool's concurrency subscription could consume a mid-run `syncRulesRevision` change before Phase 2 workers checked for it, causing Full Sync to finish the old queue before indexing newly added consoles. Monotonic rule-version tracking now ensures Full Sync and Incremental Sync immediately break out after the in-flight transfer(s) and jump straight into indexing newly added consoles (and re-evaluating widened release types).
  - **Page-by-Page Catalog Streaming in Full Sync Phase 1**: Streamed WordPress REST pages directly into SQLite and emitted live Catalog updates on every 100-item page during Full Sync Phase 1 (with an abort guard so stopped runs never mark half-indexed consoles as fully indexed).
  - **Automatic Idle Indexing on Sync Rule Save**: Saving newly added unindexed consoles while idle (or queuing behind an active filtered index/download queue) now automatically kicks off background indexing for those consoles so the Catalog populates right away.

## [1.30.2] - 2026-11-21

- Aligned **Sync Rule Readiness** pending counts, **View in Catalog** (`Sync Rules` + `Not Downloaded`), and **Queue Pending (N)** with Full Sync's per-file mirror coverage check:
  - **Zero-Disk-I/O Sibling Coverage Evaluation**: Extended the cached SQLite rule index to evaluate recorded child files and `downloadHints` against active `allowedReleaseTypes` without synchronous filesystem `stat` calls, so releases marked `downloaded` that still have unmirrored policy-eligible sibling files (e.g., after widening Release Type rules) are counted as pending alongside `available`/`failed`/`partial` releases.
  - **Accurate Pending Byte Estimates & Rule-Scoped Queueing**: Estimated pending bytes for partially-mirrored releases from their unmirrored eligible sibling hints rather than double-counting already-mirrored archives, and updated **Queue Pending (N)** to queue and download only the missing policy-eligible sibling files while skipping excluded types.

## [1.30.1] - 2026-11-21

- Fixed the sync progress counter (e.g., `5/47`) intermittently disappearing from the main **Monitor** status bar during active runs:
  - **Structured Server-Side `runProgress`**: Added a dedicated `runProgress` field (`processed`, `total`, `scope`, `systemName`) to `ServiceStatusSnapshot` across Full Sync, Incremental Sync, Download Queue (including mid-run queue additions), and Batch Retry runs.
  - **Consistent Status Header Rendering**: Updated `parseSyncStatusHeader` and the Monitor panel to read `status.runProgress` directly during active file transfers, parallel downloads, inter-file handoffs, tab switches, and page refreshes instead of relying solely on transient `currentPhase` strings.

## [1.30.0] - 2026-11-21

- Redesigned the **Storage Device Installer** flow and naming end-to-end to make installing single games and batches effortless and clear:
  - **Consistent, Intuitive Naming**: Renamed **More → Review Device Install…** to **Install Options…**, renamed the bulk bar's secondary button to **Install Options (N)** alongside **Express Install (N)**, renamed **Open Queue** on the progress dock to **View Details**, and replaced the legacy *Install Prepared ROMs to Storage Device* dialog title with contextual headings (**Install to `<Device>`** / **Install `<N>` Games to `<Device>`**).
  - **Pre-Selected Latest Playable Version by Default**: Opening Install Options now automatically pre-selects the latest/recommended playable ROM for every game (instead of leaving multi-version releases unchecked with a disabled CTA), so every game is immediately ready to install in one click.
  - **Unified Per-Game Layout & Clear Destination Paths**: Grouped multi-archive releases into a single clean game row (instead of duplicate cards per archive) with an upfront **Device & Destination Folder** summary strip and exact full-path previews (`Device/Folder/Filename.ext`) plus on-demand inline **Rename**.
  - **Effortless Version Picking & Batch Controls**: Added 1-click single-pick version switching (with an optional **Pick multiple** toggle for multi-variant or multi-disc installs), plus batch filter tabs (**All**, **Multiple versions**, **Already on device**) and 1-click **Skip already installed** for multi-game installs.

## [1.29.2] - 2026-11-21

- Fixed **Game Details → Download ROM** always selecting the latest playable version when multiple versions are present:
  - **Version-Aware Primary File Selection**: Replaced first-row SQLite selection with version- and role-aware ranking (`v1.10 > v1.9`, bare dotted versions like `(2.1.1) > (1.2)`, maturity `Final > stable > Beta`, `Rev 2 > Rev 1`, `Rev B > Rev A`, and release dates) while prioritizing primary playable releases over bundled unmodified Original ROMs, standalone patches, demos, or legacy archives.
  - **Newest-First Multi-ROM Variant Picker**: Sorted multi-ROM archive variant picker targets latest-version-first (with Disc 1 before Disc 2 when equal) and surfaced the selected version filename in the **Download ROM** button tooltip.

## [1.29.1] - 2026-11-21

- Eliminated main-thread event-loop stalls that could trigger Kubernetes `livenessProbe` timeouts (`SIGTERM` restarts) on large libraries and Docker Desktop / k3d filesystems:
  - **Cached Per-File Role Lookup (`json_extract`)**: Replaced uncached full-table `metadata_json` scans on `/api/items`, `/api/sync/preflight`, and rule-sync queries with an in-memory cached role map populated via SQLite `json_extract(metadata_json, '$.downloadHints')` and incrementally updated per release on writes.
  - **Non-Blocking Cached Disk Stats & Lightweight `/readyz`**: Converted recursive repository disk-usage scans from synchronous `fs.readdirSync`/`fs.statSync` calls (previously running on every status emission and every 15s readiness probe) into an async, event-loop-yielding background refresh with TTL caching, and switched `/readyz` to a lightweight cached writability + SQLite check.
  - **Clean `SIGTERM` / Stop Abort Handling**: Downloads aborted by `SIGTERM` or manual Stop now reset cleanly to `available` instead of being recorded as `failed` (`AbortError`) in the Failed Queue.

## [1.29.0] - 2026-11-21

- Fixed false-positive release type misclassifications and repeating Full Sync type-filter skip loops across all 11 curated release types:
  - **Accurate Base-Dump vs. Hack / Mod Classification**: Tightened `Original ROM` detection so legitimate ROM hacks, QoL patches, and community mods containing region tags (`(USA)`, `(U)`, `(Europe)`, `(E)`, `(Japan)`) and mod/version cues (`v1.x`, `QoL`, `No-Touch`, `Touchless`, `FastText`, `Hard Mode`, `Coop`, `NTSC Patched`, `Singleplayer`, `Slot-2`, `Enhanced`, etc.) are classified by their true release type instead of being skipped as `Retail ROM`. Unmodified base dumps bundled alongside modified siblings (e.g., `Salamander (Japan).zip` next to `Salamander - Enhanced (Japan).zip`, or unpatched dumps on Translation/Undub pages) continue to classify as `Original ROM`.
  - **Bracket-Scoped Language Detection & Full 11-Type Audit**: Scoped language detection to bracket/parenthesis tags and explicit translation phrases while guarding false-positive title phrases (such as *Quest 64 French Vanilla*, *The Italian Job*, or *Graphics Polish*), added `(T+XX)` / `(T-XX)` support across all curated languages plus `Other Languages`, guarded `"Roster Update"` hacks from false `DLC` matches, and completed filename/context classification across `Undub`, `Machine Translation`, `PSX2PSP / Eboot`, `Homebrew / Indie / Doujin / Aftermarket`, `Port`, `BIOS`, `Prototype / Demo`, `Bootleg / Pirate`, and `DLC`.
  - **Zero Infinite Full Sync Skip Loops**: Aligned release-level Sync Rule evaluation across Full Sync, Incremental Sync, Monitor Sync Readiness preflight, and Catalog filters to inspect concrete per-file roles (combining recorded files and persisted `downloadHints`), automatically caching discovered filenames even when every file on a release page is excluded by policy. Updated Index-First Full Sync Phase 2 to use policy-aware multi-file fast-skip verification so already-mirrored multi-file releases skip cleanly while still reacting immediately if Sync Rules are widened.
  - **SQLite Schema Migration `v23`**: Automatically reclassifies existing catalog file roles and parent release tags on startup using the updated sibling-aware classifier.

## [1.28.0] - 2026-11-21

- Simplified and streamlined all actions in the **Game Details** drawer for a frictionless one-click path from discovery to playing:
  - **One-Click Instant Download ROM**: Clicking **Download ROM** now immediately downloads the extracted, cleanly renamed ROM file (or clean `.zip` for disc sets) for single-ROM archives—eliminating the legacy two-step **Prepared ROM Export** panel. Archives containing 2+ playable ROM variants open a compact docked **Choose ROM Variant** strip directly above the footer, while patch-only archives surface a clean fallback to **Download Raw Archive** or **Inspect Archive**.
  - **Mount-Aware Primary Install Action**: When a Storage Device is mounted, **Install to `<Device>`** (or **Reinstall to `<Device>`** if already installed on that volume) becomes the primary one-click Express Install CTA with **Download ROM** beside it; when no device is mounted, **Download ROM** takes primary focus with **Install to Device** alongside it.
  - **Zero Duplicate Row Buttons**: Removed redundant `Prepared ROM`, `Inspect Archive`, and `Raw` buttons from single-file releases and catalog hint rows; multi-file releases show only a single clean **Download ROM** trigger per mirrored file (plus **Retry** on failed files).
  - **Consolidated `More` Menu**: Moved secondary and maintenance tools (**Review Device Install…**, **Inspect Archive**, **Download Raw Archive**, **Refresh / Fetch Metadata**, **Mark / Clear Installed Flag**, **Dry Run Retry**, and **Delete Release** with two-step footer confirmation) into a single upward-opening **More (`···`)** menu with `Escape` and outside-click dismissal.

## [1.27.1] - 2026-11-21

- Redesigned the left sidebar **Storage Device** section to blend seamlessly with **Service Telemetry**, **Mirrored Systems**, and **CRT Display**:
  - Replaced the floating bordered drive-bay card, slot groove, nested LCD box, and stacked rectangular buttons with a flush hairline-divided section matching the sidebar's native rail typography and row rhythm.
  - Added clean `Volume` and clickable `Layout` rows (preserving the detected console count without truncation) plus a compact single-line `Preview` / `Switch · Eject` action strip, and a quiet `Mount Device...` row when unmounted.

## [1.27.0] - 2026-11-21

- Added **Universal Live Mid-Run Reload** for all sync-affecting settings across **Sync Rules** and **Request Pacing & Rate Protection**:
  - **Immediate Adaptive Rate Limiter Updates**: Changing pacing profiles or spacing bounds (`baseDelayMs`, `minDelayMs`, `maxDelayMs`, `backoffMultiplier`) now immediately shifts the active delay on the very next request—raising pacing right away when slowing down and speeding up immediately when healthy, while preserving protective backoff during active HTTP 429 cooldowns.
  - **Elastic Parallel Worker Scaling (`maxConcurrency`)**: Converted worker pools across Full Sync (Index-First & HTML crawl), Incremental Sync, Manual Catalog Download Queue, and Batch Retry to scale dynamically mid-batch—spawning additional workers immediately when scaling up and allowing excess workers to finish their current file cleanly when scaling down.
  - **Live Transfer, Retry, Timeout & Auto-Download Reload**: `downloadChunkConcurrency`, `downloadChunkMinSizeMb`, `maxRetries`, `requestTimeoutMs`, `userAgent`, and `autoDownloadNewReleases` now hot-read from live configuration on the next request, retry attempt, or file transfer without restarting an active run.
  - **Live Activity Logs & UI Save Receipts**: Saving Request Pacing & Rate Protection or Sync Rules during any active run (Full Sync, Incremental Sync, Dry Run, Download Queue, or Retry Failed) logs `[Live Sync]` / `[Live Rules]` entries in Activity Log and surfaces live-applied hints and confirmation receipts in the sticky save bar.

## [1.26.0] - 2026-11-21

- Added **Device-Wide ROM Root & Subfolder Convention Inference** to automatic per-mount **Export Device Auto-Configure**:
  - **Nested ROM Root Inheritance for New Consoles**: When a mounted device uses a nested ROM directory (such as `Roms/`, `games/`, or `Emulation/roms/`), installing games for a console not yet on the card automatically creates its folder inside that detected ROM root while matching the device's dominant console folder casing (e.g., `/Roms/N64`, `/games/N64`, `/Emulation/roms/n64`)—while keeping standalone `BIOS` / `OST` folders protected and leaving Analogue Pocket `Assets/*/common` paths untouched.
  - **Cross-Console Subfolder Naming & Casing Propagation**: Expanded shorthand ROM-type subfolder recognition (`trans`, `transl`, `eng`, `t-en`, `tl`, `hb`, `unlic`, `hacks`, `mods`, etc.) and propagated detected subfolder conventions across every console on the mounted device. Unseen ROM categories (such as Homebrew or Ports on a card with `SNES/hacks` and `NES/trans`) automatically adopt the device's dominant casing style (`homebrew`, `ports`).
  - **Inferred Convention Preview on Device Export**: Added an unboxed convention summary line (`New consoles → /Roms/<SYSTEM> · Subfolders: Hacks → /hacks · Translations → /trans · Unseen types → lowercase`) and an explicit **`New console`** (`· Inferred`) destination preview row inside the Live Export Destination Preview card. Saved manual overrides continue to take top priority and all inferred conventions clear automatically on eject or device swap.

## [1.25.0] - 2026-11-20

- Made **Export Device Auto-Configure** automatic by default on every storage device mount and eliminated the scrolling wall of consoles on **Device Export**:
  - **Automatic Per-Mount Discovery**: Mounting or switching any storage device (from the left sidebar drive bay or Device Export) now runs Auto-Configure immediately and activates the detected layout for that mounted device session using a 3-layer precedence model (`Universal Defaults` → `Mounted Device Auto-Config` → `Saved Manual Overrides`). Swapping handhelds, MiSTer SD cards, or flash carts switches paths automatically while keeping saved manual overrides untouched.
  - **Front-and-Center Device-Aware Live Export Destination Preview**: Placed the Active Storage Device card and Live Export Destination Preview directly at the top of **Device Export**, dynamically previewing real consoles detected on the mounted device with clear source indicators (`Auto-detected`, `Manual override`, `Default`) and a collapsed-by-default `Inspect N detected folders` disclosure.
  - **Zero-Wall Manual Console Overrides**: Replaced the 75+ console scrolling list with a compact **Active Manual Overrides** list (single-line empty state when none are needed) paired with an instant **Search-to-Add** console combobox covering all known, synced, and detected systems.
  - **Quiet Sidebar Drive Bay Feedback**: Mounting from Catalog or Monitor displays a live `Scanning` LED state, settles into a quiet layout summary inside the LCD (`OnionOS / GarlicOS · 12 consoles`), and offers a direct **Preview Paths** shortcut to Device Export—while Express Install and Export Queue immediately write to the auto-configured paths.

## [1.24.0] - 2026-11-20

- Simplified and unified the **Device Export** settings page into a clear, guided two-step flow:
  - Added a top **Live Export Destination Preview** strip combining your active console folder, ROM-type routing, and filename preset into real end-to-end sample paths (`Retail`, `ROM Hack`, `Translation`).
  - Reordered sections to put **01. Console Folders** first and **02. ROM Filename Formatting** second, placing the primary **Auto-Configure** action directly in the Console Folders header and removing nested card clutter.
  - Eliminated the duplicate stacked Auto-Configure console list by merging scan review directly into the **single console table** with a temporary `Scan Matches` tab, inline `/old → /detected` path diffs, multi-candidate pickers, and one-click **Apply & Save** (plus **Apply to Draft**).
  - Tucked advanced options—default ROM-type subfolder names, per-console subfolder overrides, custom filename token templates (with clickable token buttons), max filename length, and FAT32 sanitization—into clean progressive disclosures that keep everyday defaults effortless.

## [1.23.0] - 2026-11-20

- Moved **Mount Storage Device** out of the crowded Catalog toolbar row into a permanent **Storage Device** recessed hardware drive bay in the left sidebar (directly below the main navigation switcher):
  - Features a machined cartridge/SD slot groove, theme-adaptive CRT recessed bezel, and live hardware LED paired with explicit status text (`Standby`, `Mounted`, `Writing`, `HTTPS Req`, `Unsupported`).
  - Once mounted, displays the active volume/folder name in an illuminated monospace LCD readout with quick **Switch**, **Eject**, and **Auto-Configure** actions (clicking **Auto-Configure** jumps straight to **Device Export → Storage Device Folder Mappings** and opens the reviewable **Auto-Configure Preview** scan for the mounted device).
  - Updated File System Access capability detection (`evaluateFileSystemAccessSupport`) to distinguish plain LAN HTTP origins (`!window.isSecureContext`, e.g. `http://192.168.x.x:8080` on Chrome/ChromeOS) from non-Chromium browsers and surface exact HTTPS / Chrome flag guidance.

## [1.22.0] - 2026-11-20

- Added **Export Device Auto-Configure** inside **Device Export → Storage Device Folder Mappings**:
  - Pick an export base folder directly in the browser (or one-click scan your already-mounted storage device) via the File System Access API—automatically mounting the chosen base path for immediate exporting.
  - Discovers console base paths across 75+ retro platforms and common handheld/emulator layouts—including direct root folders, OnionOS/GarlicOS (`Roms/FC`, `Roms/SFC`, `Roms/MD`, etc.), ES-DE/Batocera/EmuDeck (`Emulation/roms/*`), MiSTer (`games/*`), Analogue Pocket OpenFPGA (`Assets/<core>/common`), and decorated human-readable folder names—using parent-root consensus and shallow ROM-extension corroboration.
  - Detects existing per-console **ROM-type subfolders** (`Hacks`, `Translations`, `Homebrew`, `Ports`, `Undubs`, `Prototypes`, `Unlicensed`, `BIOS`, `DLC`, `PSX2PSP`) while preserving exact on-disk casing.
  - Displays an inline **Auto-Configure Preview** with per-console checkboxes, path diffs (`New`, `Updates Custom`, `Already Matches`), alternate-path conflict switchers, ROM-type subfolder toggle, and non-destructive merge into the Device Export draft form before saving.

## [1.21.10] - 2026-11-20

- Made the **Catalog** bulk selection and filter action buttons status-aware:
  - **`Queue Downloads (N)`** now counts and dispatches only truly un-downloaded/retryable releases (`available`, `failed`, `partial`), hides automatically when zero selected releases need downloading (such as selecting already-downloaded games), and displays already-downloaded/already-queued skip counts in its hover tooltip on mixed selections.
  - **`Download Filtered (N)` / `Download All (N)`** now reflects the exact server-computed `queueableFiltered` count for the active filter set, hides automatically when zero filtered releases need downloading, and auto-collapses its preview strip if live sync finishes the remaining items.
  - **`Express Install (M)`** and **`Install to Storage Device (M)`** now count and dispatch only selected releases with ROM archives on disk (`downloaded`, `skipped`, `partial`), hide automatically when zero selected releases are downloaded, and note skipped un-downloaded selections in their hover tooltips.
  - Added `alreadyQueuedIds` to `/api/items/ids` and live status caching across paginated and cross-page `Select All Filtered` selections so counts stay accurate even when unchecking individual cards or while background downloads finish.

## [1.21.9] - 2026-11-20

- Eliminated the brief "reload" spinner flash over the **Monitor** Sync Hero Showcase box-art thumbnail when clicking the box art or game title to inspect release details: removed the translucent scrim overlay and placeholder spinner swap from `SyncTargetCoverThumbnail`, replaced button `disabled` toggling with a silent in-flight request guard, and gated the inline `Opening…` cue beside the title behind a **250ms** slow-request threshold so fast local SQLite lookups open the **Game Detail Drawer** cleanly with zero visual flicker.

## [1.21.8] - 2026-11-20

- Fixed `ReferenceError: __name is not defined` during Playwright visual preview capture (`npm run capture:screenshots`): removed the named inner arrow helper inside `switchPaletteInPlace`'s `page.evaluate(...)` callback that `tsx`/esbuild `keepNames` transpiled into a Node-only `__name(...)` wrapper, and added an isolated-scope serialization regression test covering both unlocked and `aria-disabled` locked swatches.

## [1.21.7] - 2026-11-20

- Redesigned the **CRT Display** sidebar **Phosphor Palette** selector into a **single uniform 7-column hardware swatch strip** so all starter and collector palettes share identical square keycap proportions, crisp active LED highlight halos, and flush alignment with the adjacent `Presets` and `Living UI Motion` rows.
- Added a **live right-aligned header name readout** beside `Phosphor Palette` that displays the active palette's full name and previews any hovered or keyboard-focused swatch in real time—including Trophy Point unlock thresholds for inline locked collector swatches (`aria-disabled` with subtle dimmed phosphor tint + centered lock icon).
- Added explicit `data-crt-palette` attributes and updated the Playwright visual preview palette switcher to target them cleanly while respecting locked states.

## [1.21.6] - 2026-11-20

- Added a **retained-outgoing dual-layer cover crossfade** to the **Monitor** Sync Hero Showcase: while the next game's box art decodes off-stage, the previous cover remains crisply displayed (eliminating blank/placeholder flashes between consecutive titles), then crossfades directly into the incoming cover with stale-request protection during rapid multi-release skips.
- Added **adaptive frame-width easing** (`cubic-bezier(0.16, 1, 0.3, 1)`) computed from each decoded cover's natural aspect ratio and clamped to responsive showcase bounds (`50px–124px` mobile, `50px–144px` desktop) so switching between portrait GBA/PS2, square DS, and landscape SNES box art glides smoothly without layout snapping.
- Choreographed the unboxed **Hero Showcase game title** to enter in sync with release transitions (keyed cleanly on release identity so routine progress ticks never re-trigger animations or disrupt hover/focus) and scaled transition intensity progressively across **Living UI Motion** tiers (`Off` / `prefers-reduced-motion` instant, `Low` calm opacity crossfade, `Medium` subtle micro-scale & glide, `High` phosphor rim pulse & text bloom, `Ultra` fleeting specular scan-glint sweep).

## [1.21.5] - 2026-11-20

- Redesigned the main **Monitor** Sync status bar into a cohesive **Hero Showcase** layout: the active game's box art now anchors the left column and spans vertically alongside both the game title and the live docked transfer progress bar (while keeping the expandable per-worker `Details` drawer full-width underneath).
- Switched the active box-art thumbnail from a cropped square to an **adaptive-aspect, fixed-height showcase frame** (`80px–90px` during active transfers, `62px–70px` on Dry Run previews) so portrait GBA/PS2/PSP covers, square-ish DS/PS1 jewel cases, and wide landscape SNES/N64 boxes display uncut, backed by a steady `3:4` recessed CRT placeholder silhouette until artwork loads.
- Removed the bordered box around the active game title and the bordered pill around the `<system> · <current/total>` counter, replacing them with clean unboxed display typography, `·`-separated tabular telemetry, and a coordinated hover/focus `Inspect ↗` cue across both cover art and title that opens the **Game Detail Drawer**.

## [1.21.4] - 2026-11-20

- Fixed a blank full-page reload flash during the **Device Export** scene of the **Playwright + FFmpeg** visual preview: updated the palette switcher to click the **Amber** swatch directly inside the always-open sidebar `.crt-tuner-card` in-place (instead of looking for a retired `CRT Display` popover toggle and falling back to `window.location.reload()`), giving viewers a completely uninterrupted view of **Device Export** with a seamless Green → Amber phosphor transition.

## [1.21.3] - 2026-11-20

- Pre-seeded the Catalog view preference (`rgt_sync_catalog_view_v1` → `catalogLayout: "grid"`) inside the **Playwright + FFmpeg** visual preview contexts so switching to **Catalog** mounts directly into **Box-Art Grid** view with zero split-second Table view flash.
- Updated Scene 3 of the animated walkthrough preview to stay inside the **Game Detail Drawer**—smoothly scrolling down to frame and dwell on the **Screenshots** thumbnail gallery—instead of clicking into full-res lightbox mode before closing the drawer and continuing to **Device Export**.

## [1.21.2] - 2026-11-20

- Slowed down the animated **Playwright + FFmpeg** README walkthrough video pacing—especially from the **Game Detail Drawer** onward (drawer view, full-res screenshot lightbox steps, modal dismissals, **CRT Display** palette switch to Amber, and final **Device Export** view)—so every showcased feature stays clearly readable while encoding at `15 fps` to keep the animated WebP lean.
- Marked the ephemeral demo capture status payload as configured and authenticated (`auth.configured`, `auth.authenticated`, `auth.hasCompletedLogin`) so the `"Repository credentials are not configured yet..."` banner is hidden during visual preview capture while still never storing credentials or making outbound login calls.

## [1.21.1] - 2026-11-20

- Updated the automated **Playwright + FFmpeg** visual preview pipeline (`scripts/capture-screenshots` and `.github/workflows/update-screenshots.yml`) to default to and enforce the subtle **`Low`** **Living UI Motion** setting so README previews stay clean and understated while leaving the higher intensity tiers as an in-app discovery.
- Included `activeSyncItem` and `hasCover` in the ephemeral demo capture status payload so the new inline sync status cover thumbnail appears cleanly in captured Monitor previews.

## [1.21.0] - 2026-11-20

- Added a **compact inline game cover thumbnail** beside the active game title in the main **Monitor** sync status bar whenever a Full Sync, Incremental Sync, Retry run, or Download Queue is operating on a release (including warm-up, active transfers, multi-file handoffs, and Dry Runs).
- Added a **recessed CRT placeholder frame** (`36px–40px` fixed square with zero layout shift) that holds the thumbnail slot while artwork lazily caches/loads or when a release has no upstream cover art, smoothly cross-fading to box art via compositor-only opacity transitions while respecting Living UI Motion and reduced-motion preferences.
- Added **one-click Game Detail Drawer inspection** directly from Monitor: clicking the active cover thumbnail (or highlighted game title) fetches the release and opens the full **Game Detail Drawer** over Monitor with live transfer progress, retry/queue/delete actions, and archive inspection without leaving the live telemetry view.
- Extended live status snapshots and transfer telemetry with `activeSyncItem` (`itemId`, `title`, `systemName`, `hasCover`) so the status bar tracks cover availability seamlessly from pre-download warm-up through completion and clears cleanly on Standby and non-game phases.

## [1.20.4] - 2026-11-20

- Fixed false-positive `.zip` download entries created from regular HTML navigation links whose anchor text contained the word `"Download"` (such as `TurboGrafx-16 Japanese Download` → `/repo/turbografx-16/download-japan/` on *Populous*): tightened `isDownloadCandidateUrl` and guarded dynamic AJAX link extraction so only genuine archive/endpoint links (`download.php`, `?file=`, `?wpdmdl=`, `?action=download`, `<a download>`, or archive extensions) are queued.
- Added SQLite startup migration **`v22` (`prune_false_positive_html_download_files`)** to remove existing non-downloaded phantom HTML webpage rows from `catalog_release_files` and automatically recalculate parent release statuses (healing `partial` releases whose real archive files are already downloaded back to `downloaded`).
- Clarified the diagnostic error message when RetroGameTalk's mirror returns HTTP 404 for an upstream HTML-encoded `&amp;` filename and HTTP 403 signature mismatch for the decoded filename, clearly identifying it as an upstream RGT server bug rather than a session expiry or client error.

## [1.20.3] - 2026-11-20

- Removed duplicate status prefixes on the main **Monitor** sync status bar: Tier 2 now omits the redundant `Standby` prefix when Tier 1 already displays `Standby` and omits the redundant `Syncing` prefix before the highlighted game title when Tier 1 already displays `Sync Active` / `Dry Run Active`, while retaining distinct sub-phase prefixes (`Initializing`, `Authenticating`, `Enumerating`, `Checking`, `Scanning`, `Stopping`).

## [1.20.2] - 2026-11-19

- Fixed HTTP 404 download failures on signed mirror URLs whose upstream WordPress/ACF `file=` query parameter contains HTML-encoded entities (for example `Traverse%20-%20Starlight%20%26amp%3B%20Prairie%20%28Japan%29.zip`): `downloadFileAtomic` now automatically retries HTTP 404 responses with an entity-decoded, PHP `rawurlencode`-compatible `file=` fallback while preserving all other query parameters byte-for-byte and keeping the authenticated session intact if the mirror rejects the fallback.
- Fixed HTML entities (such as `&amp;`, `&#038;`, `&#8217;`, and double-encoded `&amp;amp;`) appearing literally in catalog titles, original titles, metadata, and file hints by decoding WP REST ACF fields (`acf.game_name`, `acf.original_title`, `acf.download_links[].file_name`) and dynamic download extractor labels.
- Added SQLite startup migration **`v21` (`decode_html_entities_in_titles`)** to automatically clean existing stored catalog release titles, publishers/developers, metadata hints, and file display labels without modifying on-disk `local_path` entries.

## [1.20.1] - 2026-11-19

- Fixed a regression in **Index-First Full Sync** where the Monitor status header briefly flipped from `Status Full Sync (N/M): <console> · <Game Title>` during release warm-up to `Syncing <Game Title>` once downloading began; Index-First Full Sync now emits and parses the steady **`Syncing <Game Title>`** format consistently from warm-up through download completion (and cleanly formats Phase 1 console indexing/delta status messages).

## [1.20.0] - 2026-11-19

- Added **In-Place Archive Contents Navigation** across both the **Game Detail Drawer** and **Catalog → Local Disk Tree**, allowing you to browse nested folders and files inside downloaded `.zip`, `.7z`, `.rar`, and `.tar*` archives without unpacking anything to disk.
- **Game Detail Drawer**: Added an explicit **`Inspect Archive`** action on downloaded archive files (and in the sticky footer) opening a CRT archive explorer with breadcrumb folder navigation, deep entry search, file category badges (`ROM`, `DISC`, `PATCH`, `DOC`, `ARCHIVE`), uncompressed sizes, inline UTF-8 text preview for `.txt`/`.nfo`/`.md`/`.cue`/`.m3u` files (with copy button and 128 KB truncation guard), and single-entry streaming downloads.
- **Local Disk Tree**: Archive files now display format badges (`ZIP`, `7Z`, `RAR`, `TAR`) and open directly like folders on click (or via **`Inspect`**), extending the disk breadcrumb trail seamlessly into the archive's internal folder tree with live archive filtering, text previews, and single-entry downloads—and unlocking the **Inside the Archive** trophy from either view.

## [1.19.0] - 2026-11-19

- Added **Live Mid-Run Sync Rule Hot-Reloading**: saving changes to **Target Consoles** or **Allowed Release Types** in **Sync Rules** now applies immediately to any active **Full Sync** or **Incremental Sync** (including Dry Runs) without waiting for the next run.
- **Graceful transfer boundary & dynamic queue convergence**: currently downloading files finish cleanly before newly excluded consoles or release types are skipped immediately (never deleting files already on disk); newly added consoles automatically refresh their catalog index/delta and expand the live queue, and widening allowed release types re-evaluates earlier type-skipped items within the same run.
- **Manual queue isolation & two-place operator feedback**: manual **Catalog** download queues and **Retry** runs remain untouched; `PUT /api/config` returns a `liveSyncReload` receipt so **Sync Rules** shows a live-reload editing hint and post-save confirmation banner (*"Sync Rules saved — applied live to active Full/Incremental Sync #N"*), paired with a timestamped `[Live Rules]` entry in **Monitor**'s Activity Log.

## [1.18.1] - 2026-11-19

- Removed the sticky **Full Sync** pre-flight drop-down drawer (including the redundant `Dry Run Full` button, manual refresh toggle, breakdown accordion, and legacy crawl link) so clicking **Full Sync** in the header starts mirroring everything matching your **Sync Rules** in one simple click.
- Enabled automatic stale/unindexed console index refreshing behind the scenes whenever **Full Sync** runs, while keeping the header **Dry Run** checkbox as the single toggle for simulation mode and preserving the **Monitor** page's **Sync Rule Readiness** strip for at-a-glance counts and Catalog shortcuts.

## [1.18.0] - 2026-11-19

- Redesigned the **Header Sound Deck** into a prominent **center-stage recessed CRT stereo receiver** positioned between the Brand Mark and Trophy/Sync controls (`~3×` wider on desktop with responsive tablet/mobile compression).
- Added tactile inline **Previous / Play-Pause / Next** hardware transport controls, a dark recessed **CRT LCD Now Playing display** (track title + uppercase genre & tabular BPM readout with mute/pause cues), and a wider **12-bar live CRT spectrum visualizer** synced to the active phosphor palette (stepping down cleanly to 6 bars on narrower viewports and static bars when motion is off).
- Added persisted **new-track unlock detection** (`NEW` / `+N NEW` phosphor badge on the stereo deck and matching row highlights inside the track selector popover) whenever Trophy Points unlock new soundtracks, clearing automatically when the deck is opened or a new track is selected.

## [1.17.1] - 2026-11-19

- Overhauled the built-in **Web Audio VGM Synthesizer** (`retroMusicPlayer.ts`) for studio-grade clarity and punch: added procedural stereo hall/plate convolution reverb (`ConvolverNode`), custom `PeriodicWave` harmonic timbres (`pulse25`, `organ`, `brass`, `strings`, `epiano`, `slapbass`, `guitar`), click-free true ADSR envelopes, 3-voice ensemble chorus, pitch-glide expression, per-voice high-pass frequency carving, authentic 4×12 guitar speaker-cabinet EQ + power-chord stacking, and upgraded percussion (beater-click kick, gated reverb snare, triple-burst clap, rimshot, 6-oscillator metallic hi-hats/crashes, FM anvil clangs, and orchestral timpani).
- Re-composed all **7 original multi-section soundtrack tracks** after direct analysis of the 7 reference tracks—including accurate genre & tempo realignment for *Neon Corridor* (`128 BPM` chiptune breakbeat funk, Starter `0 pts`), *Velvet Machinery* (`118 BPM` 90s FM jazz-fusion slap-bass & Rhodes, `150 pts`), *Celestial Assembly* (`120 BPM` cosmic electro-synthwave, `400 pts`), *Ironworks Sector* (`130 BPM` D-minor industrial bass + sweeping SNES strings climax + bell breakdown, `650 pts`), *Ultra Combo* (`110 BPM` arcade industrial breakbeat + cab-shaped power chords, `950 pts`), *Phobos Gate* (`120 BPM` heavy double-time thrash metal + twin leads, `1,300 pts`), and *Lunar Core: Final Phase* (`152 BPM` gothic pipe-organ prelude + heroic SNES brass & bass/timpani break, `1,650 pts`).

## [1.17.0] - 2026-11-19

- Upgraded the built-in **Retro Synth Sequencer** (`retroMusicPlayer.ts`) to support multi-bar 8-to-12-bar looping arrangements (`128`–`192` steps), articulated sustained note tuples with expressive pitch vibrato, a 5th harmonic counter-melody channel, soft-clip `WaveShaperNode` overdrive, sub-octave oscillator layering, stereo panning, and expanded percussion (kick, snare, closed/open hats, metallic FM anvil clangs, pitched timpani/toms, and crash cymbals).
- Replaced all 7 unlockable background soundtrack compositions with **7 original multi-section VGM-inspired tracks** spanning classic horror ambient, puzzle chiptune, solstice synthwave, 16-bit industrial, arcade industrial, DOS thrash metal, and final boss battle themes: *Hollow Corridor* (88 BPM, Starter `0 pts`), *Clockwork Chamber* (118 BPM, `150 pts`), *Celestial Assembly* (124 BPM, `400 pts`), *Ironworks Sector* (134 BPM, `650 pts`), *Ultra Combo* (116 BPM, `950 pts`), *Phobos Gate* (122 BPM, `1,300 pts`), and *Lunar Core: Final Phase* (156 BPM, `1,650 pts`).
- Extended `tests/soundtrack.test.ts` to validate score-to-metadata BPM alignment, exact bar-aligned lane lengths, chord voicings, MIDI bounds, and percussion triggers across all 7 compositions.

## [1.16.0] - 2026-11-19

- Re-architected **Full Sync** and scheduled **Incremental Auto-Sync** around the pre-indexed SQLite catalog via a shared **Sync Rule Matcher** (`Target Consoles` + `Allowed Release Types`) and per-console index freshness tracking (`fresh` / `stale > 12h` / `unindexed`).
- Replaced blind full-site HTTP re-crawling on **Full Sync** with **Index-First Mirroring**: Phase 1 automatically refreshes unindexed or stale target consoles and performs fast WP REST delta checks on fresh consoles (with an explicit `Force Legacy Remote Crawl` fallback), while Phase 2 mirrors rule-matched pending releases straight from SQLite and skips verified local files cleanly.
- Added `GET /api/sync/preflight`, SQLite migration `v20` (`sync_runs.summary_json`), and structured **Dry Run** execution summaries (`SyncRunSummarySnapshot`) so **Dry Run** previews stay non-mutating and display clear counts (`wouldDownloadCount`, `alreadyOnDiskCount`, `excludedByRulesCount`, estimated size, and console/sample breakdowns).
- Upgraded the header **Full Sync** confirmation into a live **Pre-Flight Readiness Preview** with console freshness telemetry, a `Refresh Stale/Unindexed` toggle, and a collapsible per-console & sample release breakdown.
- Connected **Monitor**, **Catalog**, and **Sync Rules** into one cohesive workflow: added a **Sync Rule Readiness** strip (with direct `Queue Pending` and `View in Catalog` actions) and a **Latest Dry Run** action bar inside **Monitor**, a **`Matches Sync Rules`** quick-filter button + active token inside **Catalog**, and stale/unindexed console indicators + **`Preview Matches in Catalog`** inside **Sync Rules**.

## [1.15.0] - 2026-11-19

- Added an **Unlockable Retro Synth Soundtrack** powered by a zero-dependency Web Audio API lookahead sequencer with **7 seamlessly looping multi-channel compositions**: 1 free starter track (*Phosphor Idle* — CRT Ambient, `0 pts`) plus 6 milestone tracks unlocked via Trophy Points (*Bitplane Bounce* 8-Bit Chiptune at `150 pts`, *Outrun CRT* 80s Synthwave at `400 pts`, *FM Cartridge Drive* 16-Bit FM at `650 pts`, *Subcarrier Pulse* Acid Techno at `950 pts`, *Cyberdeck Horizon* Dark Synth at `1,300 pts`, and *Broadcast Finale* Euro-Synth at `1,650 pts`).
- Added a compact **Header Sound Deck** beside the Trophy Case button featuring 1-click Play/Pause, a live **Mini Spectrum Visualizer** synced to the active CRT phosphor palette (respecting Living UI Motion `Off` and `prefers-reduced-motion`), and an anchored deck popover with transport controls, **Loop / Cycle / Shuffle** playback modes, independent volume/mute controls, and the full 7-track unlock selector.
- Integrated unlockable soundtrack tracks into the **Trophy Case → Rewards** tab with a **Background Soundtrack** quick-control bar, live point progress bars for locked tracks, and one-click **Play / Pause** actions on unlocked tracks.
- Added smart background audio etiquette: playback stays strictly **off by default** until Play is clicked, **auto-pauses** when the browser tab is hidden (and resumes when visible again), and **automatically ducks volume** during Trophy unlock chimes, easter-egg fanfares, and while the hidden 4-in-1 CRT Arcade Cabinet is open.

## [1.14.4] - 2026-11-19

- Expanded `.dockerignore` to exclude `docs/` (including README visual preview screenshots & animated walkthroughs), `scripts/` (including demo box-art fixtures), `tests/`, `k8s/`, `deploy/`, `docker-compose.yml`, and non-runtime repository metadata from the Docker build context—keeping container builds fast and preserving Docker layer caching across docs/screenshot updates.

## [1.14.3] - 2026-11-19

- Upgraded the automated screenshot demo library with **10 bespoke, title-matched retro illustrated WebP box-art covers** (covering the entire top-10 Catalog Grid across SNES, N64, GBA, PS1, Genesis, Saturn, Dreamcast, PSP, NDS, and NES) plus **3 bespoke 16-bit SNES pixel-art gameplay screenshots** for the featured **Game Detail Drawer** & **Lightbox** walkthrough (`Chrono Vanguard DX`), keeping the production Docker runtime image untouched.
- Made demo release timestamps strictly monotonic so all 10 bespoke covers consistently lead the default Catalog Box-Art Grid sort.

## [1.14.2] - 2026-11-19

- Updated `.github/workflows/update-screenshots.yml` to pass `--legacy-peer-deps` on npm installs (matching `Dockerfile` to avoid the `vite@8` / `esbuild@0.25` optional peer conflict) and fixed the `gh pr list` `jq` query (`// empty`) so first-time PR creation handles an empty PR list cleanly.

## [1.14.1] - 2026-11-19

- Fixed the **Update README Visual Previews** GitHub Actions workflow (`.github/workflows/update-screenshots.yml`) to work cleanly without a committed `package-lock.json` by removing `cache: 'npm'` from `actions/setup-node` and falling back to `npm install --no-package-lock` (plus `--no-package-lock` for ephemeral Playwright installation).

## [1.14.0] - 2026-11-19

- Added an **Automated Playwright Visual Preview Pipeline** (`npm run capture:screenshots`) powered by headless Chromium and **FFmpeg** that generates a looping 1200px animated WebP hero walkthrough (`console-walkthrough.webp`) plus four crisp `1440×900` WebP screenshots (`sync-overview.webp`, `catalog-grid.webp`, `game-detail-drawer.webp`, and an **Amber**-highlighted `sd-card-exporter.webp`) under `docs/assets/screenshots/`.
- Built an isolated **ephemeral demo SQLite seeder** (running the real `v1`–`v19` schema migrations with locally rendered retro PNG box art & widescreen gameplay screenshots, telemetry history, and browser-intercepted active multi-chunk transfer streams—zero mock endpoints in production server code), plus optional `--url <base-url>` / `CAPTURE_BASE_URL`, `--preset`, `--motion`, and `--skip-video` overrides for capturing live local instances.
- Added a dedicated GitHub Actions workflow (`.github/workflows/update-screenshots.yml`) triggered manually (`workflow_dispatch`) and on UI source pushes to `main` that installs Playwright ephemerally (keeping the production Docker image completely lean), uploads preview artifacts, and opens or updates a single review PR (`chore/update-readme-screenshots`) with inline visual previews.
- Replaced the `README.md` Visual Preview placeholder with the centered Hero Walkthrough + 2×2 Screenshot Gallery showcase.

## [1.13.1] - 2026-11-19

- Added smooth GPU-composited open and close transitions to the Catalog Item Details full-resolution box-art & screenshot lightbox (fade + gentle scale-settle with exit snapshot retention so artwork and controls ease out cleanly on Escape, backdrop click, or Close).
- Added directional **Next / Previous** crossfade glide transitions with an outgoing ghost slide, caption crossfade, slide counter (`N / M`), adjacent full-res image preloading, smooth `Fit Screen` / `1:1 Pixel` scale settle, and tactile hover/press feedback on lightbox controls—tuned for Living UI Motion `Off` and `prefers-reduced-motion: reduce`.

## [1.13.0] - 2026-11-19

- Added a **Speed-Reactive Sync Status Wave** effect that renders a phase-continuous CRT oscilloscope sine trace across the Sync Status card and a synchronized traveling wave shimmer inside active combined and parallel transfer progress bars—smoothly accelerating in frequency and wave density via a logarithmic throughput curve as live download speed climbs.
- Integrated the wave effect with **Living UI Motion** (`Low` through `Ultra`, scaling from a subtle single carrier trace at `Low` to dual-harmonic phosphor glow at `Ultra`, automatically inheriting all 7 CRT Phosphor Palettes and Dry Run amber, and pausing automatically when idle, backgrounded, or under `prefers-reduced-motion: reduce`).
- Added an independent **Sync Speed Wave (`ON` / `OFF`)** toggle directly inside the Living UI Motion section of CRT Display Studio (persisted in browser storage) so operators can disable the wave effect without turning off other Living UI Motion animations.

## [1.12.0] - 2026-11-19

- Added a **10-Level Operator Rank Ladder** (`Lv. 1 Cartridge Cadet` at `0 pts` through `Lv. 10 Master Preservationist` at `2,100 pts`) driven by earned Trophy Points, displayed in the Trophy Case Drawer header, progress summary, top header Trophy button tooltip, and full Rank Ladder view.
- Added a **Rewards** tab inside the Trophy Case Drawer where earned Trophy Points unlock purely cosmetic and audio milestones (with zero sync, catalog, or export functionality gated), complete with live progress bars, one-click equip/apply controls, and audio previews.
- Added **4 unlockable Collector CRT Phosphor Palettes** in CRT Display Studio (`DMG Olive` at `100 pts`, `Synthwave` at `350 pts`, `Crimson Tube` at `700 pts`, and `Trinitron White` at `1,200 pts`) alongside the always-free Green, Amber, and Cyan phosphors, plus the flagship **Broadcast BVM** studio calibration preset (`1,500 pts`).
- Added **3 unlockable Trophy Chime Sound Packs** (`16-Bit FM Synth` at `200 pts`, `Coin-Op Arcade` at `550 pts`, and `Hi-Fi Studio` at `1,000 pts`) with live synthesized preview buttons in the Rewards tab, plus **Gold Collector's Bezel** (`900 pts`) and **Platinum Prism Crest** (`1,800 pts`) trims for the Trophy medallion (honoring `prefers-reduced-motion`)—plus a couple of extra collector trims waiting for operators who uncover the console's deeper secrets.

## [1.11.1] - 2026-11-18

- Hardened on-demand Catalog download queueing against duplicate and overlapping submissions by tracking `inFlightDownloadIds` alongside `pendingDownloadQueueSet`, eliminating the race window while a release is fetching HTML/metadata before its status flips to `downloading`, and avoiding empty `sync_runs` rows when all selected items are already downloaded.
- Updated `/api/items/download`, `/api/items/ids`, activity logs, and Catalog confirmation/notice banners to distinguish **already queued/downloading** releases from **already downloaded** releases, reporting exact newly-queued counts (`0` when an identical batch is re-submitted) without inflating logs or achievement counters.

## [1.11.0] - 2026-11-18

- Added the **Retro Visionary** Gold trophy (`90 pts`, bringing the Trophy Case to **65 trophies** and **2,235** total points), awarded after spending a cumulative **30 minutes** in the foreground with CRT Display Studio set to **Ultra** motion or **maxed (`100%`) scanlines**, with live minute-by-minute progress persisted in SQLite across sessions.
- Tucked another small vintage CRT signal quirk quietly inside the console for operators who like poking around analog display terminology (respects `prefers-reduced-motion` and has zero impact on routine sync, catalog, or export workflows).

## [1.10.0] - 2026-11-18

- Expanded the Trophy Case with **4 new hidden trophies** (bringing the catalog to **64 trophies** and **2,145** total points) waiting to be uncovered by curious operators, with the Platinum trophy progress automatically tracking the expanded list.
- Added a few extra vintage surprises and expanded synthesized 8-bit audio tucked quietly behind the CRT bezel—check the *Back of the Cartridge Manual* note in the Feature Guides if you need a nudge (zero impact on routine sync, catalog, or export workflows).

## [1.9.1] - 2026-11-18

- Added a **release-level fast-skip** before fetching release HTML pages during Full Sync and Incremental Sync: releases already marked `Downloaded` in SQLite whose files are verified on disk (`size > 0`), whose upstream WordPress `modified_gmt` has not advanced, and whose policy-eligible `downloadHints` are already mirrored are skipped immediately without hitting RetroGameTalk or spamming per-file verification logs (reporting one concise per-console summary count instead).
- Added a **file-level pre-check** inside release page processing so when an updated or partially downloaded release *is* inspected, individual files already marked `Downloaded` and verified on disk are skipped before calling `downloadReleaseFile()`—eliminating unnecessary `downloading` status flicker, dummy transfer workers, and repetitive `[info]` logs while still catching deleted files, upstream updates, and widened Release Type filters.

## [1.9.0] - 2026-11-18

- Added a console-inspired **Trophy & Achievements System** featuring **60 trophies** across Bronze (`15 pts`), Silver (`30 pts`), Gold (`90 pts`), and Platinum (`180 pts`) tiers spanning preservation milestones, console & era collecting, catalog curation, handheld SD card exporting, CRT Display Studio tuning, homelab resilience, and a handful of hidden secrets waiting to be discovered.
- Added persistent SQLite achievement tracking (automatic schema migration `v19`) with silent baseline catch-up for existing mirrored libraries and zero passive unlocks on first launch, ensuring no jarring popup storm on startup while staying synced across browsers and unattended cron syncs via real-time SSE (`achievement_unlocked`).
- Added console-style bottom-right trophy unlock notifications with tier-distinct synthesized Web Audio chimes, sequential display with burst coalescing (`4+` simultaneous unlocks summarize cleanly), and click-to-inspect navigation.
- Added a compact Trophy counter button in the top header opening a smooth slide-over **Trophy Case Drawer** with completion progress, tier counts, search and category/status filtering, per-milestone progress bars, optional hint reveals for hidden trophies, and inline SFX Mute and Quiet Mode toggles.

## [1.8.0] - 2026-11-18

- Tucked a few hidden retro-gaming surprises beneath the CRT control console for curious operators to discover (zero impact on routine sync, catalog, or export workflows).
- Added a subtle "Back of the Cartridge Manual" hint inside the Feature Guides documentation for anyone looking to uncover what's hiding inside the cabinet.

## [1.7.6] - 2026-11-18

- Updated default `image.tag` in `k8s/charts/retrogametalk-sync/values.yaml` to empty so Helm chart deployments automatically resolve to `Chart.AppVersion` instead of `main`.
- Expanded `.github/workflows/docker-publish.yml` GitHub Release notes with a `Published Artifacts` section listing the multi-arch GHCR container image, optional Docker Hub mirror, GHCR OCI Helm chart reference, and `.tgz` chart archive, and automatically attach `retrogametalk-sync-<version>.tgz` as a downloadable GitHub Release asset.
- Documented GitHub Release artifact manifest and Helm `values.yaml` version-bump rules in `AGENTS.md` for future packages and artifacts.

## [1.7.5] - 2026-11-18

- Added smooth, mellow slide-over open and close transitions to `GameDetailDrawer` (`cubic-bezier(0.22, 1, 0.36, 1)` compositor-only glide from the right paired with a soft backdrop fade), retaining the last rendered item snapshot during close and supporting interruptible mid-close re-opening.
- Added subtle directional `Prev`/`Next` item crossfades (`±14px` horizontal settle + opacity dissolve) inside the open drawer header and body while keeping outer drawer chrome and navigation controls anchored.
- Retained a shorter, gentler drawer transition when Living UI Motion is set to `Off`, while honoring OS `prefers-reduced-motion: reduce` with zero spatial slide and a brief `100ms` fade.

## [1.7.4] - 2026-11-18

- Preserved Worker 0's active initial 206 stream when sibling multi-chunk workers hit a mirror-only `HTTP 503` by isolating sibling connections on a dedicated `AbortController`, capping the host to `1x`, and letting the primary slice finish cleanly before continuing sequentially.
- Prevented post-burst mirror `HTTP 503` cooldown tails from poisoning global AIMD pacing by keeping recovery retries on bounded progressive local settles (up to 20s in `AdaptiveRateLimiter.recordThrottle`) without escalating `currentDelayMs` or `rateLimitHits` unless `HTTP 429` or `Retry-After` is received.
- Fixed the off-by-one `Wave throttle N+1/N` log on retry exhaustion, eliminated duplicate cooldown waits when handing off to stream resume, and corrected log copy to distinguish initial multi-chunk step-downs from subsequent `1x` retries.

## [1.7.3] - 2026-11-18

- Replaced the overstated `80+ CONSOLES` spec in `docs/assets/logo-banner.svg` with `OFFLINE CATALOG`, and corrected `80+` console count copy across `README.md` and feature documentation to an accurate `30+ classic consoles and handhelds`.

## [1.7.2] - 2026-11-18

- Trimmed trailing `• AMD64 + ARM64` text from the `docs/assets/logo-banner.svg` footer spec line so the banner typography fits comfortably within the hardware frame without overhanging the right edge.
- Added a prominent `[!WARNING]` banner at the top of `README.md` notifying readers that documentation is a work-in-progress and not all documented install paths are fully implemented or tested yet.

## [1.7.1] - 2026-11-18

- Replaced QEMU user-mode emulation in `.github/workflows/docker-publish.yml` (which hit `SIGILL` on `linux/arm64`) with a native GitHub Actions build matrix (`ubuntu-24.04` for `linux/amd64` + `ubuntu-24.04-arm` for `linux/arm64`) pushing by digest with per-architecture GHA caches, followed by a `merge` job using `docker buildx imagetools create` to assemble multi-arch GHCR and gated Docker Hub manifests.

## [1.7.0] - 2026-11-18

- Redesigned `README.md` into a mature open-source project front page featuring custom CRT cartridge banner/icon vector assets (`docs/assets/logo-banner.svg`, `docs/assets/icon.svg`), overview, target audience personas, key capabilities, 2-minute Quick Start, platform deployment matrix, configuration summary, architecture diagram, publishing roadmap, and explicit `TODO` placeholders for external screenshots/license/community links.
- Added comprehensive, self-contained deployment documentation under `/docs/deploy/` (`README.md`, `docker.md`, `docker-compose.md`, `portainer-and-dockge.md`, `proxmox-lxc.md`, `truenas-scale.md`, `unraid.md`, and `kubernetes-helm.md`) covering storage contracts, all runtime environment variables, and platform-specific install/upgrade/troubleshooting workflows.
- Staged ready-to-use deployment templates (`docker-compose.yml` defaulting to GHCR multi-arch image, `deploy/truenas/docker-compose.yaml`, and Unraid `deploy/unraid/retrogametalk-sync.xml` + `ca_profile.xml`) and enriched `Dockerfile` OCI labels.
- Upgraded `.github/workflows/docker-publish.yml` with a template/Helm `validate` job, QEMU + Buildx multi-architecture builds (`linux/amd64,linux/arm64`), SBOM and provenance attestations, OCI Helm chart publishing (`oci://ghcr.io/<owner>/charts/retrogametalk-sync`), and secret-gated Docker Hub mirroring (`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`).

## [1.6.0] - 2026-11-18

- Added automatic background detail hydration (`POST /api/items/:id/metadata?lazy=1`) and progressive per-screenshot lazy caching (`GET /api/items/:id/asset?kind=screenshot&index=N&lazy=1`) when opening any Catalog item in `GameDetailDrawer`, preserving fast WordPress REST catalog indexing while loading full screenshots, specs, stats, and release notes on demand without creating folders in the download directory for un-downloaded releases.
- Added mellow CRT skeleton placeholders (`.crt-skeleton` / `.crt-skeleton-bar`, synchronized with Living UI Motion and `prefers-reduced-motion`) across Cover Art, Screenshots, Game Information specs, Included Downloads (including `downloadHints` preview & direct queue action), and Release Notes while lazy details and images dissolve cleanly into view.
- Hardened metadata merging (`mergeCatalogReleaseDetailMetadata` and `upsertIndexedWpRelease`) with `detailHydrated` tracking so subsequent background WordPress re-indexing preserves HTML-discovered screenshots, specs, stats, and descriptions.

## [1.5.5] - 2026-11-18

- Separated the Catalog quick-filter toggle groups (**`Downloaded` / `Not Downloaded`** and **`Installed` / `Not Installed`**) and the **Sort** dropdown onto their own dedicated toolbar row below the Search box and metadata filter dropdowns so quick actions remain cleanly separated across all viewport widths and zoom levels.

## [1.5.4] - 2026-11-18

- Simplified the Catalog **`Status`** dropdown by removing the redundant `Available (Not Downloaded)` and `Downloaded` options now handled directly by the **`Downloaded (N)`** and **`Not Downloaded (N)`** toolbar toggle buttons, leaving `Status` focused cleanly on granular troubleshooting and in-flight states (`Needs Attention`, `Partial`, `Failed`, plus active `Queued`/`Downloading`).
- Promoted **`downloadedFilter`** (`'all' | 'only' | 'exclude'`) to a first-class query and persistence parameter alongside `installedFilter` across `/api/items`, `/api/items/ids`, `/api/items/download`, and SQLite facet queries, with seamless migration of legacy `localStorage` status presets.

## [1.5.3] - 2026-11-18

- Fixed Catalog box-art thumbnails and icons disappearing to empty placeholders after clicking the UI **Refresh** button in both Table and Box-Art Grid views (eliminated the mount-time `useEffect` race that reset `loaded` to `false` after browser-cached `<img>` `onLoad` fired, added synchronous `img.complete` detection via `useLayoutEffect`, and dropped conflicting `loading="lazy"` on `IntersectionObserver`-gated covers).
- Upgraded manual Catalog **Refresh** to refresh items, facets, and failed cover retries in place (`softRefresh`) with a smooth spinning button icon instead of blanking the visible catalog into skeleton rows.

## [1.5.2] - 2026-11-18

- Added symmetric **`Downloaded (N)`** and **`Not Downloaded (N)`** quick-filter toggle buttons to the Catalog toolbar alongside **`Installed (N)`** and **`Not Installed (N)`** (`Downloaded` in phosphor green, `Not Downloaded` in amber).
- Added context-aware server facet aggregation (`facets.counts.downloaded`) in `queryRepositoryItems` so both Download quick-filter counters live-update against active Search, Systems, metadata facets, and Install filters while ignoring `status`.
- Kept the **`Status`** multi-select dropdown and active filter strip bidirectionally synchronized with the Download quick-toggles (covering all un-downloaded states—`Available`, `Partial`, `Failed`, `Queued`, `Downloading`—and suppressing zero-count transient rows when stepping out to granular selections).

## [1.5.1] - 2026-11-18

- Quieted the Sync Status header into a steady `Syncing` readout that consistently keeps the human-readable **Catalog Game Title** framed in the Living UI CRT highlight from release warm-up through download completion and inter-file handoffs (eliminating `Inspecting` / `Downloading` verb flipping and raw `.zip` filename swaps).
- Propagated `itemTitle` on live `ActiveTransferState` snapshots and defaulted the active transfer bay to one jitter-free **Combined** progress bar (`%`, aggregate size/speed, and `Details` toggle).
- Moved raw archive filenames (`system / filename.zip`), worker/chunk/file-index telemetry, `Resumed` flags, and per-file parallel worker progress bars into a smooth `.crt-accordion-grid` **Transfer Details** drawer that starts collapsed on every visit.

## [1.5.0] - 2026-11-18

- Added an interactive D3-powered **Stats** panel inside **Catalog** (`Indexed Catalog` | `Stats` | `Local Disk Tree`) backed by `GET /api/catalog/stats`, visualizing cumulative **Repository Growth** (`14D` / `30D` / `90D` / `ALL`, Titles vs Storage), **Download Trends** (30-day velocity with 7-day moving average & run throughput), and **System-Specific Library Coverage** with one-click console filtering.
- Added complementary Catalog telemetry panels: a **Release Composition** interactive D3 donut breakdown (`ROM Types`, `Regions`, `Languages`, `Sources`) and an **Archive Size Profile & Storage Forecast** D3 histogram comparing mirrored vs un-downloaded sizes against host disk headroom.
- Expanded the Sync overview **Telemetry Deck** with two additional panels: **Index** (catalog coverage & active download queue proportions across consoles) and **Health** (rolling HTTP 200 success rate vs `429/503` throttle resilience).

## [1.4.0] - 2026-11-18

- Decoupled catalog discovery from ROM archive downloading via a pauseable WordPress REST background **Catalog Indexer** (targeted consoles first upon authentication, with one-click expansion to all remaining consoles).
- Introduced first-class `available` release status, estimated archive size hints (`~Est. Size`), and SQLite schema migration `v18` (`auto_download_new_releases`, `system_index_state_json`, `size_is_estimated`) while keeping un-downloaded entries separate from mirrored totals and failure counters.
- Added viewport-driven lazy cover artwork caching (`GET /api/items/:id/asset?kind=cover&lazy=1`) under bounded concurrency with smooth CSS opacity fades inside fixed `aspect-[3/4]` frames and zero-layout shift.
- Enabled single-click `Download`, multi-select `Queue Downloads (N)`, and bulk `Download Filtered` / `Download All` confirmation flows backed by `POST /api/items/download` and `POST /api/items/:id/download-queue`.
- Added the `Auto-Download` vs `Index Only` scheduled incremental behavior toggle in Sync Rules and Living UI Motion-synchronized Catalog Indexer progress strips.

## [1.3.1] - 2026-11-18

- Redesigned the Sync Status header on the Sync overview into a cohesive two-tier layout separating global run/sync-type and a compact high-contrast `system · progress` context block from the active target/file readout.
- Unified action prefix typography (`Standby`, `Enumerating`, `Checking`, `Inspecting`, `Scanning`, `Retrying`, `Downloading`) across all run phases and preserved active system progress counts smoothly across download transitions while keeping the CRT-framed downloading filename as the focal anchor.

## [1.3.0] - 2026-11-17

- Fixed exponential Adaptive Request Delay runaway by deduplicating overlapping throttle bursts within cooldown/2.5s windows, isolating mirror multi-connection `/503.html` rejections from global WordPress API pacing, and accelerating healthy AIMD delay recovery.
- Revised traffic-shaping defaults and pacing presets (`1x` single-stream download default, `32 MiB` chunk threshold, safer `Balanced` `750ms` and `Brisk` `650ms` floors) backed by SQLite migration `v17`, plus `60m` host cap memory, direct `1x` step-down, and per-mirror stream serialization for throttled mirrors.

## [1.2.1] - 2026-11-17

- Replaced the active downloading filename underline in the main Sync Status header with a full `1px` crisp CRT frame (`3px` corners) and an unclipped, GPU-composited breathing perimeter halo that scales cleanly across Living UI Motion levels (`off`, `low`, `medium`, `high`, and `ultra`) and `prefers-reduced-motion`.

## [1.2.0] - 2026-11-17

- Highlighted the active downloading game filename in the main Sync Status header with tiered CRT phosphor Living UI Motion effects (`low`, `medium`, `high`, and `ultra`) and clean `off` / `prefers-reduced-motion` fallbacks.
- Exposed all concurrent parallel download transfers (`activeTransfers[]`) from the orchestrator status and SSE `transfer` stream, keeping `currentPhase` synchronized as parallel workers complete.
- Added a `Per File (N)` / `Combined` segmented toggle in the Sync Overview transfer bay (persisted in `localStorage`) so users can switch between a combined primary view and individual progress bars for each parallel download.

## [1.1.1] - 2026-11-17

- Fixed multi-chunk downloads tripping over mirror connection-limit redirects (e.g., `/503.html` served as `HTTP 200` `text/html`) instead of treating them as upstream rate/concurrency limits.
- Preserved `.part` progress on HTML/throttle slice errors, automatically stepped down chunk concurrency (`4 -> 2 -> 1`) and learned per-mirror chunk caps (`15m` TTL), coalesced single-worker fallback to one sequential `Range` stream, and prevented `503` throttles from triggering false re-login cycles.

## [1.1.0] - 2026-11-17

- Added segmented multi-chunk HTTP `Range` downloads with single-probe optimization (`Range: bytes=0-<threshold-1>`) and pre-allocated random-access `.part` assembly for large archives.
- Added crash- and retry-safe `.part.meta.json` resume checkpointing with `If-Range` validator verification and automatic `HTTP 200` / `416` fallbacks.
- Coordinated shared `AdaptiveRateLimiter` `429`/`503` cooldowns across all chunk workers (aborting sibling chunks immediately on throttle and stepping down concurrency on retry).
- Wired `maxConcurrency` to bounded parallel worker pools across sync downloads, retry queues, release inspections, and artwork mirroring, with live chunk/worker telemetry.
- Added configurable chunk connections (`1–4`, default `3`) and size threshold (`4–64 MiB`, default `8 MiB`) in System Settings (`SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY` / `SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB`) backed by SQLite migration `v16`.

## [1.0.5] - 2026-11-17

- Added `CHANGELOG.md`-backed release note generation to the GitHub Release CI job so every `1.x.y` release publishes a concise summary of changes (with commit-log fallback and full changelog compare link).
- Updated repository conventions and release documentation to maintain a synchronized changelog entry on each release bump.

## [1.0.4] - 2026-11-17

- Added compiled `dist` bundle modification-time fallback for `status.build.builtAt` when `BUILT_AT` and `.git` history are absent.
- Refined footer build tooltip labeling to display `Released` strictly for SemVer tags and `Built` for branches, pull requests, and non-SemVer builds.

## [1.0.3] - 2026-11-17

- Synchronized Helm `Chart.yaml` packaging `version` alongside `appVersion` and `package.json` `"version"` for 1:1 Git-tag deployments.
- Enforced three-way SemVer parity validation in the GitHub Actions `release` workflow gate.

## [1.0.2] - 2026-11-17

- Added `GIT_REF` Docker build argument, runtime environment variable, and `status.build.gitRef` status field decoupled from `APP_VERSION`.
- Added host-aware Git ref URL routing so SemVer/tag refs link directly to GitHub Releases (`/releases/tag/...`), branches link to trees, and pull requests link to PR pages across GitHub, GitLab, Gitea/Codeberg, and Bitbucket.

## [1.0.1] - 2026-11-17

- Propagated `BUILT_AT` timestamps through CI, Docker OCI `org.opencontainers.image.created` labels, git commit fallback, and `/api/status`.
- Upgraded the footer version and revision links with a CRT `[role="tooltip"]` popover displaying localized build/release timestamps and relative age.

## [1.0.0] - 2026-11-17

- Established bare `1.x.y` SemVer git tags, GitHub Releases, and GHCR container publishing automation (`package.json`, `Chart.yaml`, and CI pipeline).
- Canonicalized console slugs to public URL slugs with startup SQLite migration (`v15`) and alias-aware filtering.
