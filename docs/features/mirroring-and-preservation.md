# Automated Preservation Mirroring, Live Reload & Auto-Recovery

Beneath its library CMS and handheld deployment tools, `rgt-sync` runs a resilient, "set-and-forget" archival engine that keeps your NAS, home server, or Kubernetes volume synchronized with RetroGameTalk—without beating up community servers or losing progress across restarts.

---

## 1. Encrypted Auth, Self-Hosted App Lock & Config Backups

- **Encrypted Local Credentials (`System Settings`):** Enter your RetroGameTalk username and password once in **System Settings** (or lock them via `RGT_USERNAME` / `RGT_PASSWORD` environment variables). Passwords are encrypted at rest with AES-256-GCM, never returned in plaintext by `/api/config`, and paired with persistent `cookies.json` session storage.
- **Optional Self-Hosted UI/API Lock (`APP_AUTH_PASSWORD`):** Exposing your console on a home network or reverse proxy? Set `APP_AUTH_PASSWORD` (and optionally `APP_AUTH_USERNAME`) to enable a zero-dependency CRT unlock screen backed by `scrypt` password verification, HMAC-SHA256 `HttpOnly` session cookies, same-origin CSRF checks, and login rate limiting. Leave it unset for zero-friction local access.
- **Secret-Free JSON Configuration Backup & Restore:** Export and restore Mirror URLs, Sync Rules, Cron Schedule, Pacing, ROM Naming (including per-type overrides), and Console Folder Mappings from **System Settings** with inline diff previews, automatic env-lock respect, and guaranteed exclusion of all passwords and host-specific disk paths.

---

## 2. Authoritative Platform Discovery & Index-First Sync

- **38+ Live Platforms via WordPress REST Registry:** `rgt-sync` merges RetroGameTalk's live `/wp-json/wp/v2/types` game platform registry with homepage discovery—automatically detecting and canonicalizing all live console, handheld, and computer CPTs (including platforms omitted from the site's top HTML navigation such as `amiga` and `sega-pico`) on startup, login, sync, and full catalog indexing.
- **Fast Incremental Delta Indexing (`modified_after`):** Already-indexed consoles update quickly using per-console `lastIndexedAt` cursors rather than re-crawling every page from 1 to N. Clear **`Fresh` / `Stale (>12h)`** indicators appear across **Sync**, **Catalog**, and **Sync Rules**, incomplete or depleted scans automatically self-heal back to full backfill, and an explicit **Full Re-index** button is always available when you want a complete metadata rebuild.
- **Index-First Full Sync, Incremental Sync & Dry Run:**
  - **Incremental Sync (Recommended Default):** Checks only newly published or updated releases since your high-watermark cutoff.
  - **Full Sync:** Refreshes stale/unindexed target consoles in Phase 1, then mirrors rule-matched pending releases straight from SQLite in Phase 2—evaluating per-file roles (Retail, Translations incl. MTL, Hacks, Homebrew, Ports, Undubs, Prototypes, Bootlegs, BIOS, DLC, PSX2PSP) plus per-game **Pin / Ignore** overrides so already-mirrored archives skip cleanly.
  - **Dry Run Toggle:** Simulates discovery, rule matching, and estimated sizes without downloading archives, surfacing a structured **Latest Dry Run** summary on the **Sync** page.

---

## 3. Universal Live Mid-Run Hot-Reloading

You never have to abort a 4-hour sync or wait for a catalog index to finish just because you tweaked a setting:

- **Live Sync Rules Reload:** Adding or removing **Target Consoles** or **Allowed Release Types** in **Sync Rules** applies immediately to any active **Full Sync**, **Incremental Sync**, or **Dry Run**—finishing the current in-flight transfer cleanly before skipping excluded items, indexing newly added consoles, or re-evaluating widened types.
- **Live Catalog Indexer Reload:** Saving console changes while the **Catalog Indexer** is running immediately cancels or drops unchecked consoles and splices newly checked consoles straight into the active queue (or reprioritizes them to the front during a Full Site index).
- **Live Pacing & Concurrency Reload:** Changing **Request Pacing & Rate Protection** (`baseDelayMs`, `minDelayMs`, `maxDelayMs`, `backoffMultiplier`), **Parallel Workers (`maxConcurrency`)**, **Chunk Concurrency**, **Retries**, or **Timeouts** in **System Settings** takes effect on the very next request or file—elastically spawning or draining download workers mid-batch with `[Live Sync]` / `[Live Rules]` / `[Live Indexer]` Activity Log receipts.

---

## 4. Resilient Multi-Chunk Transfers & Automatic Queue Recovery

- **Atomic `.part` + Segmented HTTP `Range` Resume:** Large archives download via concurrent HTTP `Range` segments with `.part.meta.json` `If-Range` verification and only rename into `<system>/<release>/<file>` once byte counts verify cleanly.
- **Automatic Download Queue Recovery with Crash-Loop Backoff:** If the server restarts unexpectedly during a download queue run (`SIGTERM`, `SIGINT`, `SIGKILL`, OOM kill, or container upgrade), in-flight files return cleanly to `queued` and `rgt-sync` **resumes the queue automatically on startup** using a persistent exponential backoff schedule (`5s → 15s → 45s → 2m → 5m`).
  - Backoff resets automatically once a resumed run stabilizes for 3 minutes or completes cleanly.
  - A safety circuit breaker pauses auto-resume after 5 consecutive rapid interruptions to prevent infinite reboot loops.
  - Explicit user **Stop** / **Pause** actions are always respected across restarts, and a live recovery strip on **Sync** and **Catalog** offers **Resume Now**, **Pause**, **View Queued**, and **Clear Queue**.

---

## 5. Polite Adaptive AIMD Pacing, Telemetry & Scheduling

- **Adaptive AIMD Rate Limiter:** Spaces outbound requests with ±15% randomized jitter, gradually tightens spacing during healthy streaks, and backs off multiplicatively on `429`/`503` responses while honoring upstream `Retry-After` headers.
- **Hero Showcase & Telemetry Deck (`Sync`):** Watch active transfers with adaptive box-art crossfades (click cover or title to open **Game Details** directly over Sync), a **Speed-Reactive Sync Wave**, layout-stable transfer progress bars, D3 throughput/latency/catalog-growth charts, filterable live SSE Activity Logs, and a **Failed Queue Drawer** supporting single-file, per-console, or batch retries.
- **Unattended Cron Scheduling:** Configure automatic background syncs in **Sync Rules** using presets (every 6 hours, 12 hours, daily, weekly) or any custom 5-field cron expression, with a live next-run countdown in the left sidebar.
