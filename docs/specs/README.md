# `rgt-sync` Technical Specifications & Stack Architecture

Welcome to the technical engineering documentation for **`rgt-sync`** (RetroGameTalk Sync). These specifications are written for full-stack web-application engineers who want to understand the architectural decisions, runtime mechanics, protocols, and libraries powering the application's preservation mirror, retro game content management system (CMS), and multi-handheld installer.

---

## Architectural Philosophy

`rgt-sync` is designed as a **self-contained, stateful single-binary/single-container full-stack appliance**. Rather than splitting the system into separate frontend static hosts, API microservices, Redis brokers, and external RDBMS instances, the entire application runs inside a single Node.js 22 process backed by an embedded Write-Ahead-Logged (WAL) SQLite database (`v1`–`v30` schema) and a local/mounted POSIX filesystem volume.

Key engineering tenets behind this architecture:

1. **Zero External Infrastructure Dependencies:** Home-lab operators, NAS users, and Kubernetes hobbyists spin up the entire CMS + archival mirror with a single container and one persistent volume (`/run/repo`). SQLite (`better-sqlite3`), cron scheduling (`croner`), TLS-impersonated HTTP (`impit`), optional self-hosted session auth (`node:crypto` `scrypt` + HMAC-SHA256), and multi-format archive streaming (`unrar` + `7zip` + `bsdtar` + `yazl`) all run in-process or via tightly controlled child streams.
2. **End-to-End Streaming Without Temp-Disk Bloat:** Retro disc images (PSX, Sega CD, Saturn, Dreamcast, GameCube, PS2) routinely span hundreds of megabytes to multiple gigabytes. Upstream downloads stream via segmented HTTP `Range` requests to atomic `.part` files on the target volume, server-side archive extraction pipes `unrar`/`7z`/`bsdtar` `stdout` directly into Express HTTP responses (or on-the-fly `yazl` ZIP streams), and the browser pipes `fetch()` `ReadableStream` chunks straight onto physical SD cards via Chromium's `FileSystemWritableFileStream` API.
3. **Isomorphic TypeScript Domain Logic:** Complex domain algorithms—No-Intro + T-En ROM naming & variant collision disambiguation, semantic/revision/build-date ROM version comparison, multi-ecosystem SD card auto-configuration, release-type classification, Sync Rule matching, installed update drift detection, queue auto-resume backoff, and CRT shader token generation—live in `/src/shared/` and execute identically on both the Node.js backend and the React 19 browser client.
4. **Polite, Self-Regulating Upstream Citizenship:** Every outbound request passes through a live-reloadable, serialized, abort-aware **AIMD (Additive Increase / Multiplicative Decrease)** rate-limiting gate with ±15% randomized jitter and `Retry-After` honoring, paired with **Index-First** `modified_after` delta syncing to avoid blind HTTP re-crawls.

---

## High-Level System Topology

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Browser Client (React 19 + Vite 8 + D3)                  │
│                                                                              │
│  ┌────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  EventSource (SSE) │  │  Isomorphic Shared   │  │ Chromium Hardware IO │  │
│  │  Telemetry, Logs & │  │  Naming, Smart Pick, │  │ File System Access + │  │
│  │  Web Audio VGM     │  │  Auto-Config & Rules │  │ IndexedDB + WakeLock │  │
│  └─────────▲──────────┘  └──────────┬───────────┘  └──────────▲───────────┘  │
└────────────┼────────────────────────┼─────────────────────────┼──────────────┘
             │ text/event-stream      │ REST JSON               │ Octet / ZIP
             │ (/api/events)          │ (/api/* + AppAuth)      │ Stream Pipe
┌────────────┼────────────────────────▼─────────────────────────┼──────────────┐
│            │        Node.js 22 Unified Server (Express 4)     │              │
│  ┌─────────┴──────────────────────────────────────────────────┴───────────┐  │
│  │                   ScraperOrchestrator (EventEmitter)                   │  │
│  │  • Index-First Sync, Live Hot-Reload & Persistent Auto-Resume Backoff  │  │
│  │  • Croner scheduler, Startup WP REST Platform Refresh & Disk Reconcile │  │
│  │  • Prometheus /metrics & Lightweight /healthz + /readyz probes         │  │
│  └─────────┬────────────────────────────┬─────────────────────┬───────────┘  │
│            │                            │                     │              │
│  ┌─────────▼──────────┐      ┌──────────▼──────────┐ ┌────────▼───────────┐  │
│  │  RetroGameTalk     │      │   better-sqlite3    │ │  ArchiveService    │  │
│  │  Client            │      │   (WAL + AES-GCM)   │ │ unrar/7z/bsdtar/   │  │
│  │  • impit (TLS/H2)  │      │  • v1–v30 Migrations│ │ yazl streaming     │  │
│  │  • tough-cookie    │      │  • Catalog, Devices,│ │ • Magic-byte sniff │  │
│  │  • cheerio + WP    │      │    Collections,     │ │ • Zero-temp-disk   │  │
│  │  • AIMD + Range    │      │    Runtime State    │ │   stdout piping    │  │
│  └─────────┬──────────┘      └──────────┬──────────┘ └────────▲───────────┘  │
└────────────┼────────────────────────────┼─────────────────────┼──────────────┘
             │ HTTPS (Browser TLS)        ▼                     │
   ┌─────────▼──────────┐      ┌────────────────────────────────┴───────────┐
   │ Upstream Community │      │     Persistent Volume (/run/repo)          │
   │ Repository         │      │  • /.rgt-data/scraper.db (+ WAL, .keyfile) │
   │ • XenForo Auth     │      │  • /.rgt-data/cookies.json & lazy caches   │
   │ • WP REST API      │      │  • /<system>/<release-dir>/*.zip|.7z|.rar  │
   │ • HTML / Sitemaps  │      │  • /<system>/<release-dir>/cover & shots   │
   └────────────────────┘      └────────────────────────────────────────────┘
```

---

## Complete Technology Matrix

| Layer | Technology | Version | Primary Role in `rgt-sync` |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | 22 LTS | Native ESM + native TypeScript execution (`node server.ts`) in production |
| **Dev Runner** | `tsx` | `^4.21` | Fast esbuild-backed TypeScript execution during development & `node:test` suites |
| **Language** | TypeScript | `^7.0` | End-to-end strict static typing across server, client, and `/src/shared` |
| **HTTP Server** | Express | `^4.21` | REST API, AppAuth middleware, SSE broadcaster, streaming downloads, Vite dev host |
| **Database** | `better-sqlite3` | `^13.1` | Synchronous C++ SQLite binding in WAL mode with checksummed `v1`–`v30` migrations |
| **Security & Crypto** | `node:crypto` | Built-in | AES-256-GCM at-rest credential encryption, `scrypt` AppAuth, HMAC-SHA256 cookies |
| **HTTP / TLS Client** | `impit` | `^0.14` | Rust/N-API browser-impersonating HTTP/2 + TLS fingerprint client |
| **Session Jar** | `tough-cookie` | `^6.1` | RFC 6265 cookie jar management serialized to persistent `cookies.json` |
| **HTML / XML Parser** | `cheerio` | `^1.2` | Fast server-side DOM/CSS-selector extraction for pages and sitemaps |
| **Scheduler** | `croner` | `^11.0` | In-process 5-field cron scheduling with exact next-run introspection |
| **Archive Engine** | `unrar` + `7zip` + `bsdtar` + `yazl` | Native / `^3.3` | Multi-format inspection & streaming extraction (RAR4/RAR5/7z/ZIP/TAR) + ZIP repacking |
| **Frontend UI** | React + React DOM | `^19.0` | Functional component UI, 5-workspace CMS console, custom hooks, state orchestration |
| **Charts & Motion** | `d3` + `motion` | `^7.9` / `^12.23` | Catalog analytics, telemetry sparklines, and choreographed CRT UI transitions |
| **Bundler** | Vite | `^8.3` | Frontend build pipeline and middleware-mode dev server |
| **Styling** | Tailwind CSS + `@tailwindcss/vite` | `^4.3` | CSS-first `@theme` design tokens paired with dynamic CRT CSS custom properties |
| **Iconography** | `lucide-react` | `^0.546` | Crisp vector iconography augmented with custom SVG CRT hardware marks & dynamic favicon |
| **Browser Hardware IO** | Web APIs | Native | File System Access API, IndexedDB handle storage, Web Streams, SSE, Wake Lock, Web Audio |
| **Packaging & Infra** | Docker + GH Actions + Helm | Alpine 3 / K8s | Multi-stage `node:22-alpine` image, native multi-arch Buildx pipeline, StatefulSet chart |

---

## Specification Index

1. **[Backend Runtime, Scraping Engine & SQLite Persistence](./backend-and-persistence.md)**
   Deep dive into Node 22 native TypeScript execution, Express + SSE + optional `AppAuth`, `impit` TLS fingerprinting, authoritative WordPress REST platform discovery & `modified_after` delta indexing, live mid-run hot-reloading, persistent crash-loop backoff auto-resume, `better-sqlite3` WAL & checksummed `v1`–`v30` migrations, secret-free config backup/restore, and zero-temp-disk `unrar`/`7z`/`bsdtar`/`yazl` archive streaming.
2. **[Frontend Architecture, Isomorphic Modules & Browser Hardware APIs](./frontend-and-browser-apis.md)**
   Deep dive into React 19 + Vite 8 + Tailwind CSS v4 + D3, the 7-palette CRT Display Studio + phosphor-dissolve notices + dynamic favicon + Web Audio VGM Synthesizer, isomorphic `/src/shared/*` modules (No-Intro + T-En naming, multi-variant collision disambiguation, 75-platform device auto-configure, update drift classification), hardware-pinned `.rgt-device.json` fleet identity + IndexedDB handle persistence, and direct browser-to-SD-card streaming/uninstall.
3. **[Containerization, CI/CD, Kubernetes Helm Chart & Observability](./deployment-and-devops.md)**
   Deep dive into the multi-stage `node:22-alpine` Dockerfile (with native Alpine `unrar`, `7zip`, `libarchive-tools`, and `C.UTF-8` locale), OCI provenance build args, native multi-arch GitHub Actions Buildx + `readme-assets` screenshot pipeline, Kubernetes `StatefulSet` + `AppAuth` Secret + `NOTES.txt` version output, horizontal sharding, lightweight `/healthz` + `/readyz` probes, and Prometheus `/metrics`.
