# Changelog

All notable changes to **RetroGameTalk Sync** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to bare `1.x.y` [Semantic Versioning](https://semver.org/).

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
