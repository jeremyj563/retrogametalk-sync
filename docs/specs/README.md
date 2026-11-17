# `rgt-sync` Technical Specifications & Stack Architecture

Welcome to the technical engineering documentation for **`rgt-sync`** (RetroGameTalk Sync). These specifications are written for full-stack web-application engineers who want to understand the architectural decisions, runtime mechanics, protocols, and libraries powering the application under the hood.

---

## Architectural Philosophy

`rgt-sync` is designed as a **self-contained, stateful single-binary/single-container full-stack appliance**. Rather than splitting the system into separate frontend static hosts, API microservices, Redis brokers, and external RDBMS instances, the entire application runs inside a single Node.js 22 process backed by an embedded Write-Ahead-Logged (WAL) SQLite database and a local/mounted POSIX filesystem volume.

Key engineering tenets behind this architecture:

1. **Zero External Infrastructure Dependencies**: Home-lab operators, NAS users, and Kubernetes hobbyists can spin up the entire stack with a single container and one persistent volume (`/run/repo`). SQLite (`better-sqlite3`), cron scheduling (`croner`), TLS-impersonated HTTP (`impit`), and archive streaming (`7z` + `yazl`) all run in-process or via tightly controlled child streams.
2. **End-to-End Streaming Without Temp-Disk Bloat**: Retro disc images (PSX, Sega CD, Saturn, Dreamcast, GameCube, PS2) routinely span hundreds of megabytes to multiple gigabytes. Upstream downloads stream to atomic `.part` files on the target volume, server-side archive extraction pipes `7z` `stdout` directly into Express HTTP responses (or on-the-fly `yazl` ZIP streams), and the browser pipes `fetch()` `ReadableStream` chunks straight onto physical SD cards via the Chromium `FileSystemWritableFileStream` API.
3. **Isomorphic TypeScript Domain Logic**: Non-trivial domain algorithms—such as semantic/revision/build-date ROM version comparison, FAT32 filename sanitization, console slug normalization, release-type classification, and target SD folder resolution—live in `/src/shared/` and execute identically on both the Node.js backend and the React 19 browser client.
4. **Polite, Self-Regulating Upstream Citizenship**: Scraping and mirroring community preservation repositories requires strict rate discipline. Every outbound request passes through a serialized, abort-aware **AIMD (Additive Increase / Multiplicative Decrease)** rate-limiting gate with ±15% randomized jitter and `Retry-After` honoring.

---

## High-Level System Topology

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Browser Client (React 19 + Vite 8)                    │
│                                                                              │
│  ┌────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  EventSource (SSE) │  │  Isomorphic Shared   │  │ Chromium Hardware IO │  │
│  │  Live Telemetry &  │  │  Modules: Smart ROM  │  │ File System Access + │  │
│  │  Transfer Stream   │  │  Picker & Folder Map │  │ Streams + Wake Lock  │  │
│  └─────────▲──────────┘  └──────────┬───────────┘  └──────────▲───────────┘  │
└────────────┼────────────────────────┼─────────────────────────┼──────────────┘
             │ text/event-stream      │ REST JSON               │ Octet / ZIP
             │ (/api/events)          │ (/api/*)                │ Stream Pipe
┌────────────┼────────────────────────▼─────────────────────────┼──────────────┐
│            │        Node.js 22 Unified Server (Express 4)     │              │
│  ┌─────────┴──────────────────────────────────────────────────┴───────────┐  │
│  │                   ScraperOrchestrator (EventEmitter)                   │  │
│  │  • Sync lifecycle & AbortController cancellation                       │  │
│  │  • Croner scheduler & startup disk-to-SQLite reconciliation            │  │
│  │  • Prometheus /metrics & Kubernetes /healthz + /readyz probes          │  │
│  └─────────┬────────────────────────────┬─────────────────────┬───────────┘  │
│            │                            │                     │              │
│  ┌─────────▼──────────┐      ┌──────────▼──────────┐ ┌────────▼───────────┐  │
│  │  RetroGameTalk     │      │   better-sqlite3    │ │  ArchiveService    │  │
│  │  Client            │      │   (WAL + AES-GCM)   │ │  (7-Zip + yazl)    │  │
│  │  • impit (TLS/H2)  │      │  • v1–v14 Migrations│ │  • -slt inspection │  │
│  │  • tough-cookie    │      │  • Catalog & Facets │ │  • Zero-temp-disk  │  │
│  │  • cheerio DOM     │      │  • Distributed Lock │ │    stdout piping   │  │
│  │  • AIMD Limiter    │      └──────────┬──────────┘ └────────▲───────────┘  │
│  └─────────┬──────────┘                 │                     │              │
└────────────┼────────────────────────────┼─────────────────────┼──────────────┘
             │ HTTPS (Browser TLS)        ▼                     │
   ┌─────────▼──────────┐      ┌────────────────────────────────┴───────────┐
   │ Upstream Community │      │     Persistent Volume (/run/repo)          │
   │ Repository         │      │  • /.rgt-data/scraper.db (+ WAL, .keyfile) │
   │ • XenForo Auth     │      │  • /.rgt-data/cookies.json                 │
   │ • XML Sitemaps     │      │  • /<system>/<release-dir>/*.zip|.7z|.rar  │
   │ • WP REST API/HTML │      │  • /<system>/<release-dir>/cover & shots   │
   └────────────────────┘      └────────────────────────────────────────────┘
```

---

## Complete Technology Matrix

| Layer | Technology | Version | Primary Role in `rgt-sync` |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | 22 LTS | Native ESM + native TypeScript execution (`node server.ts`) in production |
| **Dev Runner** | `tsx` | `^4.21` | Fast esbuild-backed TypeScript execution during development |
| **Language** | TypeScript | `^7.0` | End-to-end strict static typing across server, client, and `/src/shared` |
| **HTTP Server** | Express | `^4.21` | REST API, SSE broadcaster, streaming binary downloads, Vite dev host |
| **Database** | `better-sqlite3` | `^13.1` | Synchronous C++ SQLite binding in WAL mode with custom v1–v14 migrations |
| **Encryption** | `node:crypto` | Built-in | AES-256-GCM at-rest credential encryption & SHA-256 migration checksums |
| **HTTP / TLS Client** | `impit` | `^0.14` | Rust/N-API browser-impersonating HTTP/2 + TLS fingerprint client |
| **Session Jar** | `tough-cookie` | `^6.1` | RFC 6265 cookie jar management serialized to persistent `cookies.json` |
| **HTML / XML Parser** | `cheerio` | `^1.2` | Fast server-side DOM/CSS-selector extraction for pages and sitemaps |
| **Scheduler** | `croner` | `^11.0` | In-process 5-field cron scheduling with exact next-run introspection |
| **Archive Engine** | `7zip-bin` / `7z` + `yazl` | `^5.2` / `^3.3` | Multi-format inspection (`.zip`/`.7z`/`.rar`) and streaming ZIP repacking |
| **Frontend UI** | React + React DOM | `^19.0` | Functional component UI, custom hooks, and state orchestration |
| **Bundler** | Vite | `^8.3` | Frontend build pipeline and middleware-mode dev server |
| **Styling** | Tailwind CSS + `@tailwindcss/vite` | `^4.3` | CSS-first `@theme` design tokens paired with dynamic CRT CSS custom properties |
| **Iconography** | `lucide-react` | `^0.546` | Crisp vector iconography augmented with custom SVG CRT hardware marks |
| **Browser Hardware IO** | Web APIs | Native | File System Access API, Web Streams API, EventSource (SSE), Screen Wake Lock |
| **Packaging & Infra** | Docker + GH Actions + Helm | Alpine 3 / K8s | Multi-stage `node:22-alpine` image, GHCR Buildx pipeline, StatefulSet chart |

---

## Specification Index

1. **[Backend Runtime, Scraping Engine & SQLite Persistence](./backend-and-persistence.md)**
   Deep dive into Node 22 native TypeScript execution, Express + SSE event architecture, `impit` TLS fingerprinting, XenForo cookie hydration, hybrid Sitemap + WordPress REST discovery, the AIMD rate limiter, `better-sqlite3` WAL & AES-256-GCM encryption, the checksummed migration engine (`v1`–`v14`), and zero-temp-disk `7z`/`yazl` archive streaming.
2. **[Frontend Architecture, Isomorphic Modules & Browser Hardware APIs](./frontend-and-browser-apis.md)**
   Deep dive into React 19 + Vite 8 + Tailwind CSS v4, the CSS-variable CRT Display Studio engine, layout-stable SSE transfer telemetry, shared isomorphic algorithms (`smartRomPicker`, `romNaming`, `storageFolderMappings`), and direct browser-to-SD-card streaming via `FileSystemWritableFileStream` + `WakeLock`.
3. **[Containerization, CI/CD, Kubernetes Helm Chart & Observability](./deployment-and-devops.md)**
   Deep dive into the multi-stage `node:22-alpine` Dockerfile, native N-API addon compilation, OCI/Git build-arg provenance (`GIT_SHA`, `APP_VERSION`, `GIT_URL`), GitHub Actions Buildx caching, Kubernetes StatefulSet + PVC persistence, multi-pod sharding with SQLite distributed locks, health probes, and Prometheus metrics.
