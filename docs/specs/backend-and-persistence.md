# Backend Runtime, Scraping Engine & SQLite Persistence

This document details the server-side architecture of `rgt-sync` (`server.ts` and `/src/server/*`), explaining the libraries chosen, why they were selected over mainstream alternatives, and how they fit together.

---

## 1. Runtime & Unified Single-Port Server

### Node.js 22 Native TypeScript (`node server.ts`) + `tsx`
- **Development**: Runs via `tsx server.ts`, providing rapid startup over TypeScript source files while mounting Vite in middleware mode.
- **Production**: Runs directly via `node server.ts` on **Node.js 22 LTS**. Because `tsconfig.json` enforces `isolatedModules: true`, `allowImportingTsExtensions: true`, and standard type-strippable syntax, Node 22 executes `server.ts`, `/src/server/*.ts`, and `/src/shared/*.ts` natively without needing a separate `tsc` or `esbuild` backend bundle step.
- **Why this choice?** Eliminating server-side transpilation artifacts (`dist-server/`) means production stack traces map 1:1 to exact `.ts` source line numbers, Docker image layers stay transparent, and subtle CJS/ESM interop bugs between native addons (`better-sqlite3`, `impit`) and bundlers disappear completely.

### Express 4 (`express`)
Express hosts all HTTP traffic on a single configurable port (default `3000`):
- **Operational & Observability Routes**: `/healthz` (liveness), `/readyz` (verifies SQLite responsiveness + physical write check to `DOWNLOAD_DIR`), and `/metrics` (Prometheus text exposition `0.0.4`).
- **JSON & Streaming API Routes (`/api/*`)**: Catalog queries with multi-dimensional facet computation, run lifecycle control, archive inspection, streaming single-ROM extraction, streaming multi-track ZIP repacking, local filesystem browsing, and configuration updates.
- **Server-Sent Events (`/api/events`)**: Subscribes directly to `ScraperOrchestrator` (`EventEmitter`) events (`status`, `log`, `transfer`, `catalog_updated`, `logs_cleared`, `runs_cleared`) with a 20-second `: keepalive` comment frame so reverse proxies (NGINX, Traefik, Cloudflare, Cloud Run) never drop idle connections.
- **SPA Hosting**: Mounts `vite.middlewares` in development and serves prebuilt static assets from `dist/` with an SPA `index.html` fallback in production.

---

## 2. Upstream HTTP, TLS Impersonation & Discovery Engine

Scraping and mirroring a modern community repository involves navigating XenForo authentication, CDN bot heuristics, WordPress custom post types, and multi-format download links. `src/server/rgtClient.ts` pairs three specialized libraries to handle this reliably.

### Browser-Grade TLS & HTTP/2 Impersonation (`impit`)
- **What it does**: `impit` is a Rust-powered Node N-API HTTP client built around browser-accurate TLS (JA3/JA4) and HTTP/2 frame fingerprinting.
- **Why `impit` instead of `undici` / `node-fetch` / `axios` / Playwright?**
  - Standard Node.js `fetch` (`undici`) advertises a distinct OpenSSL/Node TLS handshake and HTTP/2 SETTINGS frame order that edge WAFs/CDNs routinely flag or challenge, even when a browser `User-Agent` header is set.
  - Conversely, launching headless Chromium (Playwright/Puppeteer) consumes 400–800 MB of RAM, requires heavy system shared libraries in Docker, and complicates streaming multi-gigabyte binary downloads.
  - `impit` hits the sweet spot: ~10 MB memory footprint, native streaming body support, and authentic Chrome/Firefox TLS + HTTP/2 impersonation dynamically matched to the configured `User-Agent`.

### Persistent Session Cookie Jar (`tough-cookie`)
- **What it does**: Manages RFC 6265 cookie parsing, domain/path scoping, `Secure`/`HttpOnly` attributes, and expiration semantics across XenForo login redirects and repository requests.
- **Persistence**: Serialized atomically to `<DATA_DIR>/cookies.json` with `0600` file permissions. On container restart, `ScraperOrchestrator` hydrates non-expired session cookies immediately so scheduled background runs resume without re-submitting login forms on every boot.

### DOM & XML Extraction (`cheerio`)
- **What it does**: Parses login CSRF tokens (`_xfToken`), HTML release pages, download anchor tables, `srcset` responsive image attributes, and XML sitemaps using fast jQuery-like selectors without constructing a heavyweight browser layout tree.
- **Hybrid Discovery Pipeline**:
  1. **XML Sitemaps & Incremental High-Watermarks**: Crawls repository sitemaps and compares `<lastmod>` timestamps against `last_watermark_at` during `incremental` runs so unchanged pages are skipped without fetching individual game pages.
  2. **WordPress REST API Enrichment**: Queries WP REST endpoints (mapping permalink alias groups such as `gameboy-roms` ↔ `gb_roms` and `gamecube` ↔ `gcn-iso`) to extract structured taxonomies (publisher, developer, release year, genres, regions, languages, sources) in bulk.
  3. **Full-Resolution Artwork Unwrapping**: Automatically strips WordPress thumbnail suffixes (`-300x225.jpg`), removes resize query parameters (`?w=`, `?fit=`, `?resize=`), parses `srcset` descriptors by highest pixel width, and unwraps Jetpack Photon CDN URLs (`i0.wp.com/...`) to mirror crisp original-resolution box art and screenshots locally.

---

## 3. Adaptive AIMD Rate Limiter (`src/server/rateLimiter.ts`)

Community preservation servers have finite bandwidth. Rather than blasting fixed-concurrency requests or failing hard on transient bursts, `AdaptiveRateLimiter` implements classic network congestion control (**Additive Increase / Multiplicative Decrease**):

- **Promise-Chained Serialization Gate**: Concurrent worker fibers queue behind `this.gatePromise` inside `acquire(signal)`, ensuring inter-request spacing is strictly enforced even when `maxConcurrency > 1` and immediately canceling queued sleeps via `AbortSignal` when a user clicks **Stop**.
- **Polite Randomized Jitter**: Applies a `0.85x–1.15x` (±15%) uniform jitter multiplier to each inter-request gap to prevent synchronized request spikes across pods.
- **Additive Tightening (Increase in Speed)**: After 5 consecutive healthy responses, `currentDelayMs` steps down by 15% of the remaining distance toward `minDelayMs` (minimum 50 ms step).
- **Multiplicative Backoff & `Retry-After`**: On HTTP `429` or `503`, `recordThrottle()` multiplies `currentDelayMs` by `backoffMultiplier` (default `2.0x`), honors any upstream `Retry-After` header if larger, clamps to `maxDelayMs`, and sets a global `cooldownUntilMs` gate. Transient network errors apply a gentler `1.4x` step-up.
- **Live Ring-Buffer Telemetry**: Retains the latest 120 request latency/delay samples in memory so the UI's Telemetry Deck and Prometheus `/metrics` endpoint can render real-time pacing curves without touching SQLite.

---

## 4. Embedded SQLite Persistence, Encryption & Schema Migrations

### Why `better-sqlite3`?
`better-sqlite3` binds directly to C SQLite3 via synchronous Node N-API calls.
- **Why synchronous SQLite in an async Node server?** Unlike networked databases where each query incurs a 0.5–5 ms TCP round-trip, local NVMe/SSD SQLite prepared statements complete in **microseconds**—faster than scheduling a `Promise` microtask queue in asynchronous `sqlite3` or Prisma. Synchronous `.transaction(() => { ... })` blocks are also naturally atomic without interleaving async callbacks mid-transaction.
- **Pragmas**: Configured at startup with:
  - `PRAGMA journal_mode = WAL` (concurrent readers never block writers during active syncs)
  - `PRAGMA busy_timeout = 5000` (graceful lock wait across multi-statement bursts)
  - `PRAGMA foreign_keys = ON` (cascading cleanup between `catalog_releases` and `catalog_release_files`)

### At-Rest Credential Encryption (`node:crypto` AES-256-GCM)
Upstream account passwords are never stored in plaintext inside `scraper_config`:
- `encryptSecret()` derives a 256-bit key either from `SHA-256(process.env.ENCRYPTION_KEY)` or an auto-generated 32-byte `<DATA_DIR>/.keyfile` (`chmod 0600`).
- Each write generates a fresh 96-bit random IV and stores `iv:authTag:ciphertext` in hex. Authenticated decryption (`getAuthTag` / `setAuthTag`) guarantees tamper detection, and public API projections (`ScraperConfigPublic`) strip the encrypted payload entirely, exposing only `hasSavedPassword: boolean`.

### Append-Only Checksummed Migration Engine (`src/server/migrations.ts`)
Rather than pulling in a heavyweight ORM migration CLI, `rgt-sync` includes a deterministic, self-healing migration runner (`v1` through `v14`):
- **Pre-Migration Automatic Snapshots**: Before applying any pending migration on a non-empty database, the runner flushes the WAL (`PRAGMA wal_checkpoint(TRUNCATE)`) and creates a timestamped backup (`scraper.db.v<N>-<timestamp>.bak`), retaining the 5 most recent snapshots automatically.
- **SHA-256 Checksum Tracking**: Records each applied version, name, execution duration (`ms`), timestamp, and function checksum in `schema_migrations`, surfacing full audit history at `GET /api/schema` and in the Operations UI.
- **Startup Crash & Orphan Recovery**: On every boot, `initDb()` transitions any stale `running` sync runs to `stopped` and marks interrupted `downloading` rows as `failed` (`Interrupted by process restart`), while `ScraperOrchestrator.reconcileDiskCatalog()` scans `DOWNLOAD_DIR` to clean up leftover `.part` files and reconcile database statuses with physical files on disk.
- **Distributed Lease Locks (`distributed_locks` table)**: Provides TTL-based (`acquireDistributedLock` / `releaseDistributedLock` with periodic lease renewal) mutual exclusion so multiple pods sharing a `ReadWriteMany` volume cannot run conflicting global tasks simultaneously.

---

## 5. Cron Scheduling (`croner`)

`ScraperOrchestrator` uses **`croner`** (`^11.0`) for unattended incremental sync scheduling.
- **Why `croner` over `node-cron`?** `croner` has zero transitive dependencies, handles standard 5-field cron expressions accurately across DST boundaries, supports clean `.stop()` teardown on `SIGTERM` or dynamic config updates (`PUT /api/config`), and provides exact `.nextRun()` `Date` introspection—powering the live `Next Schedule` countdown in the sidebar and Schedule workspace.

---

## 6. Zero-Temp-Disk Archive Inspection & Streaming (`7zip-bin` / `7z` + `yazl`)

Community ROM releases arrive in heterogeneous archive formats (`.zip`, `.7z`, `.rar`, `.tar.*`) and frequently bundle non-game clutter (`.nfo`, `.txt`, `.url`, `.jpg`, standalone `.ips`/`.bps` patches) or multi-track optical disc images (`.cue` + multiple `.bin` audio/data tracks).

`src/server/archiveService.ts` processes these archives with **zero temporary disk extraction**:

1. **Binary Resolution**: Probes system `PATH` for native `7zz` / `7z` / `7za` first (installed via `apk add 7zip` in the production Alpine image for full RAR5/7z/ZIP speed) and falls back automatically to the bundled `7zip-bin` npm binary (or `unzip -Z` for `.zip` files) in local dev environments.
2. **Structured Technical Listing (`7z l -slt -sccUTF-8`)**: Parses 7-Zip's machine-readable `-slt` blocks to inspect inner paths and uncompressed byte sizes in milliseconds while rejecting Zip-Slip path traversal (`..`, leading `/`, null bytes) and OS metadata (`__MACOSX/`, `.DS_Store`, `Thumbs.db`).
3. **Target Grouping & Classification**:
   - Pairs `.cue` / `.gdi` / `.ccd` / `.m3u` descriptors with their sibling `.bin` / `.img` / `.sub` / `.wav` track files in the same archive folder into a unified `disc_set` playable target.
   - Identifies standalone cartridge ROMs and single-file compressed discs (`.chd`, `.rvz`, `.iso`, `.pbp`, `.cso`, `.wbfs`) as `rom` targets.
   - Flags patch-only archives (`patchOnly: true`) when an archive contains only `.ips`/`.bps`/`.xdelta` patches so users aren't misled into copying an unpatched `.ips` file onto a console SD card.
4. **Streaming Extraction & On-the-Fly Clean ZIP Repacking**:
   - **Single ROM (`streamExtractedEntryToResponse`)**: Spawns `7z e -so <archive> <entry>` and pipes `child.stdout` straight to the Express `Response` with `Content-Length` and RFC 5987 UTF-8 `Content-Disposition` headers.
   - **Multi-Track Disc Set (`streamCleanDiscZipToResponse` via `yazl`)**: Spawns sequential `7z e -so` read streams for only the `.cue` + track files (stripping all `.txt`/`.nfo`/subfolder clutter) and feeds them directly into `yazl.ZipFile.addReadStream()`, piping `zipFile.outputStream` live to the HTTP client without ever writing an extracted `.bin` or intermediate `.zip` to server disk.
