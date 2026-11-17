# Changelog

All notable changes to **RetroGameTalk Sync** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to bare `1.x.y` [Semantic Versioning](https://semver.org/).

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
