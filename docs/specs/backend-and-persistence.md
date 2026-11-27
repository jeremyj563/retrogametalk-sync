# Backend Runtime, Scraping Engine & SQLite Persistence

This document details the server-side architecture of `rgt-sync` (`server.ts` and `/src/server/*`), explaining the libraries chosen, persistence design, streaming subsystems, and operational resilience patterns.

---

## 1. Runtime, Unified Single-Port Server & Optional AppAuth

### Node.js 22 Native TypeScript (`node server.ts`) + `tsx`
- **Development:** Runs via `tsx server.ts`, mounting Vite in middleware mode for rapid frontend iteration.
- **Production:** Runs directly via `node server.ts` on **Node.js 22 LTS** using native type-stripping (`isolatedModules: true`, `allowImportingTsExtensions: true`), eliminating a separate backend bundle step so stack traces map 1:1 to exact `.ts` source lines.

### Express 4 (`express`) & API Surface
Express hosts all traffic on a single configurable port (default `3000`):
- **Operational & Observability Routes:** `/healthz` (liveness), `/readyz` (lightweight cached SQLite + `DOWNLOAD_DIR` writability probe without blocking recursive directory scans), and `/metrics` (Prometheus exposition `0.0.4`).
- **CMS, Device & Archival REST APIs (`/api/*`):**
  - Catalog search, multi-facet `ANY`/`ALL` filtering, device-scoped `installed=outdated` & `GET /api/items/outdated`, and `POST /api/items/ids` cross-page selection
  - Collections & curation (`/api/collections`, `/api/items/favorite`, `/api/items/sync-override`)
  - Multi-device fleet profiles & per-device installs (`/api/devices`, `/api/devices/:id/installs`, `/api/devices/:id/installs/lookup`)
  - Sync lifecycle, pre-flight (`GET /api/sync/preflight`), queue recovery (`POST /api/queue/resume`, `POST /api/queue/pause-auto-resume`, `POST /api/queue/clear`), and live-reloading config (`PUT /api/config`)
  - Secret-free configuration backup & restore (`GET /api/backup/export`, `POST /api/backup/import`)
  - Archive inspection, text entry preview, single-ROM streaming (`GET /api/items/:id/download-rom`), multi-track disc ZIP streaming, and Local Disk Tree browsing + direct file downloads (`GET /api/fs/download`)
- **Server-Sent Events (`/api/events`):** Broadcasts `ScraperOrchestrator` events (`status`, `log`, `transfer`, `catalog_updated`, `logs_cleared`, `runs_cleared`, `achievement_unlocked`) with 20-second `: keepalive` frames for reverse proxy stability.
- **Optional Self-Hosted App Lock (`APP_AUTH_PASSWORD`):** Implemented with zero external dependencies (`src/server/appAuth.ts`) using `node:crypto` `scrypt` + constant-time comparison, HMAC-SHA256 signed `HttpOnly` cookies, same-origin CSRF enforcement on state-changing requests, and IP sliding-window brute-force rate limiting on `/api/app-auth/login`. Completely bypassed when `APP_AUTH_PASSWORD` is unset.

---

## 2. Upstream HTTP, Authoritative WP REST Discovery & Live Reload

### Browser-Grade TLS & HTTP/2 Impersonation (`impit` + `tough-cookie` + `cheerio`)
- **`impit`:** Rust/N-API client reproducing authentic browser TLS (JA3/JA4) and HTTP/2 frame fingerprints (~10 MB RAM vs. 400+ MB for headless browsers) with streaming response bodies.
- **`tough-cookie`:** RFC 6265 cookie jar serialized atomically to `<DATA_DIR>/cookies.json` (`0600`) so restarts resume authenticated sessions without re-submitting XenForo login forms.
- **`cheerio`:** Lightweight server-side HTML/XML extraction for CSRF tokens (`_xfToken`), dynamic download endpoints, `srcset` unwrapping, and HTML fallback crawls.

### Authoritative Platform Discovery & Fast Delta Indexing
1. **WordPress REST Platform Registry (`/wp-json/wp/v2/types`):** `extractGamePlatformSlugsFromWpTypes()` filters registered Custom Post Types (`has_archive === true` with game release taxonomies such as `genre`, `region`, `developer`, `release-year`), excludes built-in WordPress types and utility CPTs (`emulator`), and canonicalizes permalink alias groups (`gb_roms` → `gameboy-roms`, `gbc_roms` → `gameboy-color-roms`, `gcn-iso` → `gamecube`, `psx2psp` → `psx2psp-eboots`). `filterLiveSystems()` merges these with homepage links, and `orchestrator.init()` refreshes live registrations non-blockingly on startup so unlisted systems like `amiga` and `sega-pico` are always discovered.
2. **Incremental `modified_after` Cursors & Self-Healing Backfill:** Already-indexed consoles scan only modified/new posts since `lastIndexedAt` (minus a 2-minute clock-skew overlap). Pagination completeness checks (`X-WP-Total`, HTTP `408` & non-JSON retry backoff) prevent incomplete crawls from poisoning cursors, and `planCatalogIndexTargets()` automatically upgrades depleted, zero-post, or partial-page consoles back to full backfill.
3. **Universal Live Mid-Run Hot-Reloading:** Saving config changes via `PUT /api/config` bumps monotonic rule/indexer revisions and hot-updates `AdaptiveRateLimiter` bounds, elastic download worker pools (`maxConcurrency`), chunk settings, retry/timeout parameters, active Full/Incremental Sync queues, and live Catalog Indexer queues (with per-console `AbortSignal.any` cancellation) without aborting in-flight file transfers.

---

## 3. Adaptive AIMD Rate Limiter & Segmented Transfers

- **`AdaptiveRateLimiter` (`src/server/rateLimiter.ts`):** Promise-chained `acquire(signal)` serialization gate with ±15% uniform jitter, additive step-downs after healthy streaks, multiplicative backoff + `Retry-After` honoring on `429`/`503`, and an in-memory 120-sample latency/delay ring buffer.
- **Segmented HTTP `Range` Downloader & Entity Fallback:** Downloads large archives across configurable concurrent `Range` chunks with `.part.meta.json` `If-Range` verification and atomic rename into `<system>/<release>/<file>`. Automatically retries signed mirror `404` responses whose upstream ACF `file=` parameter contains HTML-encoded entities (`&amp;`) using PHP `rawurlencode`-compatible decoding.

---

## 4. Embedded SQLite Persistence (`v1`–`v30`), Encryption & Auto-Resume

### `better-sqlite3` WAL Configuration & Performance
- Configured with `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, and `PRAGMA foreign_keys = ON`.
- Uses an in-memory cached per-file role index (populated via `json_extract(metadata_json, '$.downloadHints')` and incrementally maintained on writes) plus async, event-loop-yielding cached disk usage scans to eliminate main-thread stalls on large libraries and container filesystems.

### At-Rest Secret Encryption & Secret-Free Config Projection
- `encryptSecret()` derives a 256-bit AES-256-GCM key from `SHA-256(process.env.ENCRYPTION_KEY)` or an auto-generated `<DATA_DIR>/.keyfile` (`0600`) with fresh 96-bit random IVs (`iv:authTag:ciphertext`).
- Public config projections (`GET /api/config`, `PUT /api/config`) mask the repository password (`password: ""`, `hasPassword: true`) and never leak secrets to the client or into `GET /api/backup/export`.

### Checksummed Migration Engine (`v1`–`v30`, `src/server/migrations.ts`)
- Automatically flushes WAL and saves timestamped pre-migration snapshots (`scraper.db.v<N>-<timestamp>.bak`, retaining the 5 newest) before applying pending migrations.
- Key schema milestones include: core catalog & multi-file tables, per-console index cursors, `sync_runs.summary_json` (`v20`), HTML entity title cleanup (`v21`), phantom HTML link pruning (`v22`), 11-type release reclassification (`v23`), installed ROM version tracking (`v24`), Favorites, Collections & `sync_override` (`v25`), `remote_checked_at` false-positive update guard (`v26`), multi-device `storage_device_profiles` & `catalog_release_device_installs` (`v27`), fleet metadata & card IDs (`v28`), per-type ROM naming overrides (`v29`), and persistent `runtime_state` for queue auto-resume (`v30`).

### Startup Crash Recovery & Persistent Crash-Loop Backoff (`queueAutoResume.ts`)
- On boot, `initDb()` restores in-flight `downloading` queue items cleanly back to `queued` (instead of spurious `failed` rows) and marks stale `running` sync runs `stopped`.
- If an active download queue was interrupted unexpectedly (`SIGTERM`, `SIGINT`, `SIGKILL`, OOM kill), `ScraperOrchestrator` schedules automatic startup resumption via a persisted exponential backoff ladder (`5s → 15s → 45s → 2m → 5m`), resets attempts after 3 minutes of healthy progress or clean completion, and engages a circuit breaker after 5 consecutive rapid failures while always honoring explicit user **Stop** / **Pause** actions.
- Distributed TTL lease locks (`distributed_locks`) coordinate safe multi-pod sharding on shared `ReadWriteMany` volumes.

---

## 5. Zero-Temp-Disk Archive Engine (`unrar` / `7zip` / `bsdtar` / `yazl`)

`src/server/archiveService.ts` inspects and streams `.zip`, `.7z`, `.rar` (RAR4, RAR5, solid), and `.tar*` archives without unpacking temp files to disk:

1. **Multi-Backend Resolution & Magic-Byte Sniffing:** Sniffs leading magic bytes (`RAR4`, `RAR5`, `ZIP`, `7z`, HTML error pages, 0-byte files) for actionable diagnostics; prefers native Alpine `unrar` (`unrar lt` / `unrar p -inul`) for `.rar`, native `7zz`/`7z`/`7za` (with `7zip-bin` fallback) for `.7z`/`.zip`, and `bsdtar`/`unzip` fallbacks—enforcing `C.UTF-8` locale and proper glob-metacharacter escaping (`[`, `]`, `*`, `?`).
2. **Playable Target & Clutter Classification:** Rejects Zip-Slip paths (`..`, leading `/`, null bytes) and OS metadata (`__MACOSX/`, `.DS_Store`); disambiguates Sega Genesis `.md` ROMs from Markdown docs (`isMarkdownDocEntry()`); groups `.cue`/`.gdi`/`.ccd`/`.m3u` descriptors with sibling `.bin`/`.img`/audio tracks into `disc_set` targets; and flags patch-only archives.
3. **PassThrough-Guarded Streaming & On-the-Fly ZIP Repacking:** Wraps extractor stdout in a `PassThrough` stream that waits for both stdout EOF and child exit status—deferring HTTP download headers until the first extracted byte arrives so extractor errors return clean JSON HTTP `500` responses rather than truncated transfers. Multi-track disc sets pipe sequentially into `yazl.ZipFile.addReadStream()` straight to the HTTP response with ASCII + RFC 5987 UTF-8 `Content-Disposition` headers.
