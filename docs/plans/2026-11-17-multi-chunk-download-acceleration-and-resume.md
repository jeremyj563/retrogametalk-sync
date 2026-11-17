---
title: Multi-Chunk Download Acceleration, Resume & Parallel Workers
status: implemented
created_at: 2026-11-17T20:59:03Z
implemented_at: 2026-11-17T21:06:00Z
---

# Multi-Chunk Download Acceleration, Resume & Parallel Workers

Accelerate large ROM and disc-image transfers using segmented HTTP `Range` requests, crash-safe resumable `.part` transfers, and bounded parallel file workers while keeping the upstream API rate limiter strictly enforced on link resolution and shared `429`/`503` backoff.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed during clarification and govern this plan:
> - **Confirmed Decision 1 — Acceleration Strategy**: Combine segmented multi-chunk HTTP `Range` transfers for large archives, resumable `.part` continuation across retries/interruptions, and a bounded parallel file worker pool honoring the existing concurrency limit.
> - **Confirmed Decision 2 — Rate-Limiter Safety Model**: Rate-gate the initial release/redirect/token-signing request through the adaptive rate limiter as before, allow sibling byte-range streams to run concurrently once the CDN file URL is resolved, and synchronize `HTTP 429` / `503` cooldown across all active chunks.
> - **Confirmed Decision 3 — Configuration & Safe Defaults**: Expose multi-chunk concurrency (`1–4` connections per file, default `3`) and minimum file-size threshold (`4–64 MiB`, default `8 MiB`) in System Settings under *Advanced Network & Retry Tuning* with optional environment-variable overrides.
> - **Release Versioning**: Because this adds substantive user-facing transfer capabilities, UI controls, and a forward SQLite schema migration, this batch bumps the synchronized SemVer release to `1.1.0`.

---

## 1. Overview & Core Concept

- **What It Does**: Speeds up archive downloads without flooding the upstream WordPress/XenForo API. Small ROMs finish in a single HTTP request with zero extra probe overhead; large disc images automatically fan out across concurrent HTTP byte-range connections into a pre-allocated `.part` file; interrupted transfers resume from verified byte boundaries; and multi-file releases or sync queues process concurrently up to the configured worker limit.
- **Target Audience / Persona**: Self-hosters mirroring large multi-disc collections (PS1, PS2, PSP, Saturn, Dreamcast, GameCube, Wii) alongside hundreds of small cartridge ROMs over NAS or Kubernetes volumes.
- **Key Value**: Saturates available CDN bandwidth on multi-hundred-megabyte archives and eliminates restarting near-complete transfers from byte zero on transient network drops, while preserving gentle site citizenship.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **System Settings Configuration**: In *System Settings → Request Pacing & Rate Limiting → Advanced Network & Retry Tuning*, users keep the existing pacing presets (`Gentle`, `Balanced`, `Brisk`) untouched at the top level and adjust two new controls inside the collapsible advanced panel: *Connections per Large File* (`1` disabled to `4`, default `3`) and *Multi-Chunk Threshold* (`4 MiB` to `64 MiB`, default `8 MiB`). Environment-locked indicators display automatically when overridden at deployment time.
  2. **Live Transfer & Worker Telemetry**: During a sync or retry run, the Overview transfer bay and Service Telemetry sidebar continue displaying crisp monospace tabular throughput (`bytesReceived / totalBytes`, `MB/s`, `%`). When segmented or multi-worker transfers are active, quiet typographic metadata inline with the existing file label (using `·` separators, zero pill badges) indicates active chunk streams (e.g., `3 chunks`) or concurrent file workers, plus an inline `Resumed` indicator when continuing from a preserved partial file.
  3. **Seamless Fallback**: If an upstream mirror does not support byte ranges or returns a fresh representation, downloads fall back transparently to single-stream mode with no user intervention required.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Preserves the existing utilitarian CRT telemetry instrument aesthetic—dark slate/phosphor surfaces, hairline `1px` borders, and single-elevation depth without nested card boxes.
  - *Color Palette & Mood*: Neutral CRT background (`crt-bg`), structural elevated panels (`crt-elevated`), phosphor green (`crt-phosphor`) for active transfer beams, and amber (`crt-amber`) strictly for live `429`/`503` cooldown warnings paired with explicit text labels.
  - *Typography & Hierarchy*: Monospace tabular numerals (`font-mono tabular-nums`) on all byte counters, chunk counts, throughput readouts, and numeric tuning inputs to prevent horizontal jitter during live SSE updates.
- **Interactive Feedback & Motion**:
  - Save bar tracks dirty state on the two new tuning fields identically to existing settings (`Save Changes` / `Discard`), validating bounds immediately.
  - Progress bars use compositor-smooth updates capped under 200ms transitions and obey `prefers-reduced-motion`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Single-Request Range Probe (`Range: bytes=0-(threshold - 1)`)**:
  - *Chosen Approach*: Send the gated initial file `GET` (after following auth/redirect hops) with `Range: bytes=0-(chunkThresholdBytes - 1)`.
  - *Why*: Avoids `HEAD` requests (which some PHP/WordPress nonce endpoints reject or invalidate) and avoids wasting an open full-file socket. Files at or below the threshold (`<= 8 MiB`, covering almost all cartridge ROMs) finish in **1 HTTP request**. If the server ignores `Range` and replies `200 OK`, the body streams single-connection with zero wasted requests. Only when the server replies `206 Partial Content` with a `Content-Range` total above the threshold do we fan out the remaining `(N - 1)` parallel chunk workers while chunk `0` is already downloading.
  - *Alternatives Considered*: Issuing a preflight `HEAD` probe (extra request per file + potential nonce consumption) or opening full `GET` and aborting to re-request chunks (wastes a connection and triggers early-close noise).

- **Decision 2 — Pre-Allocated Random-Access `.part` File + Sidecar Metadata**:
  - *Chosen Approach*: Write each byte range directly to its exact offset in the `.part` file using a shared file handle (`pwrite` / offset writes) alongside a lightweight `.part.meta.json` tracking `finalUrl`, `etag`, `lastModified`, `totalBytes`, and completed byte ranges.
  - *Why*: Eliminates assembling and concatenating multi-gigabyte temporary chunk files at completion (halving peak disk usage and avoiding slow NAS copy stalls) and makes crash/retry resume instantaneous via `If-Range`.
  - *Alternatives Considered*: Separate `.part.0`, `.part.1`, … files concatenated on finish (doubles disk space usage and risks timeout during multi-GB NAS merges).

- **Decision 3 — Shared `429` / `503` Cooldown Gate Across All Chunks**:
  - *Chosen Approach*: Initial release-page discovery, redirect hops, and link resolution remain serialized through `AdaptiveRateLimiter.acquire()`. Once resolved, sibling range chunks attach to a shared `AbortController` and listen for a global cooldown barrier; if any chunk hits `429` or `503`, it calls `rateLimiter.recordThrottle()`, aborts sibling chunks immediately so no further concurrent hits occur, waits for the global cooldown, and resumes remaining ranges (or steps down to single-stream on repeated throttles).
  - *Why*: Protects the origin from burst amplification while maximizing legitimate CDN socket throughput when healthy.
  - *Alternatives Considered*: Gating every byte-range slice behind the inter-page scraper delay (would still serialize chunks or force artificial seconds-long stalls between chunk starts).

- **Decision 4 — Wire `maxConcurrency` to Bounded File Worker Pools**:
  - *Chosen Approach*: Replace the strictly sequential download loops for release files, retry batches, and artwork mirroring with a bounded async worker pool sized by `maxConcurrency` (`1–3` configurable, clamped `1–4`), aggregating live progress across active workers into the telemetry snapshot.
  - *Why*: Previously `maxConcurrency` existed in configuration and UI but download execution still awaited one file at a time; wiring it unlocks genuine parallel small-ROM downloads alongside single-large-file chunking.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```text
┌───────────────────────────── Browser Telemetry & Settings UI ─────────────────────────────┐
│ SystemSettingsPanel (Chunk Connections 1–4, Threshold 4–64 MiB, Max Workers, Save/Discard)│
│ OverviewPanel & ServiceTelemetrySidebar (Tabular Speed, % Progress, Active Chunks/Workers) │
└───────────────────────────────▲──────────────────────────────────┬─────────────────────────┘
                                │ SSE Telemetry + Totals           │ REST Config Updates
┌───────────────────────────────┴──────────────────────────────────▼─────────────────────────┐
│                             Sync Orchestrator & Worker Pool                                │
│  • Bounded File Worker Pool (size = maxConcurrency; sync queue, retry queue, cover mirror) │
│  • Aggregated ActiveTransferState (primary bytes/total, aggregate bytes/sec, chunks/workers│
└───────────┬──────────────────────────────────────────────────────────▲─────────────────────┘
            │ Initial URL + Redirect Chain                             │
            ▼                                                          │ Live Progress
┌──────────────────────────────────┐   Cooldown / 429 Signal   ┌───────┴─────────────────────┐
│   AdaptiveRateLimiter (Shared)   │◄──────────────────────────┤   Multi-Chunk Range Engine  │
│ • Gated initial GET & link hops  │                           │ • Initial Range 0..thresh-1 │
│ • Global cooldownUntilMs barrier ├──────────────────────────►│ • 200 OK -> Single stream   │
└──────────────────────────────────┘   Pause / Step-Down       │ • 206 Partial -> Fan out    │
                                                               │   N-1 sibling Range workers │
                                                               │ • If-Range Resume from meta │
                                                               └──────────────┬──────────────┘
                                                                              │ pwrite(offset)
                                                                              ▼
                                                               ┌─────────────────────────────┐
                                                               │ Pre-allocated .part + Meta  │
                                                               │ • .part (random-access IO)  │
                                                               │ • .part.meta.json (ranges,  │
                                                               │   ETag/Last-Modified)       │
                                                               │ • Atomic rename on complete │
                                                               └─────────────────────────────┘
```

- **Data Model & State**:
  - *SQLite Configuration Schema (Forward Migration `v16`)*: Add `download_chunk_concurrency` (`INTEGER NOT NULL DEFAULT 3`, validated `1..4`) and `download_chunk_min_size_mb` (`INTEGER NOT NULL DEFAULT 8`, validated `4..64`) to `scraper_config`, with corresponding optional environment overrides (`SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY`, `SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB`) exposed in `envOverrides`.
  - *Resumable Transfer Sidecar (`.part.meta.json`)*: Ephemeral sidecar stored beside the `.part` file containing `finalUrl`, `etag`, `lastModified`, `totalBytes`, and sorted merged byte intervals (`completedRanges: [start, end][]`). Removed automatically upon successful atomic rename or permanent file deletion.
  - *Live Telemetry Snapshot (`ActiveTransferState`)*: Extend with optional `activeChunks?: number`, `activeWorkers?: number`, and `resumed?: boolean` fields so existing consumers render backward-compatibly while surfacing multi-chunk and parallel-worker activity.
- **Interactive Component & State Mapping**:
  - *Tuning Controls*: Adjusting *Connections per Large File* or *Multi-Chunk Threshold* updates React form state, computes dirty diff against persisted config, enables the sticky `ConfigSaveBar`, persists via `PUT /api/config`, and updates `ServiceStatusSnapshot` + future download calls immediately (unless env-locked, which disables the input and shows the env var badge).
  - *Worker & Chunk Progress Aggregation*: Multiple concurrent file workers report per-worker byte counters and rolling throughput into a thread-safe map inside the orchestrator; throttled emitters push combined throughput (`bytesPerSec`), active worker/chunk counts, and primary transfer progress over SSE to the Overview bay, Catalog rows, and Telemetry sidebar.
  - *Error & Rate-Limit Recovery*: On transient `429`/`503` or connection drop, partial completed byte ranges stay flushed to `.part` + `.part.meta.json`. The next retry sends `If-Range` with the remaining uncovered byte intervals; if upstream returns `200` (asset changed or range unsupported), the `.part` resets cleanly and streams sequentially.
- **Key Sequences & Integrations**:
  - *Verification Plan*: Automated Node integration tests against a local mock HTTP server verifying (1) small files finish in 1 request, (2) large files split across `N` concurrent `206` ranges and match SHA-256 byte-for-byte, (3) aborted transfers resume via `If-Range` without re-downloading completed ranges, (4) a simulated `429` on any chunk aborts sibling workers and triggers shared `AdaptiveRateLimiter` backoff, and (5) `200 OK` servers seamlessly fall back to single-stream downloads.
  - *Release Governance*: Synchronize version `1.1.0` across application package metadata, Helm chart `version` and `appVersion`, and changelog release notes, plus archive this approved plan under the repository plan index.
