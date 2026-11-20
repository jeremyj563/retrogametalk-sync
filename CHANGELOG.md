# Changelog

All notable changes to **RetroGameTalk Sync** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to bare `1.x.y` [Semantic Versioning](https://semver.org/).

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
