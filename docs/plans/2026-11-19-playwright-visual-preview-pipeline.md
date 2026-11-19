---
title: Automated Playwright Visual Preview Pipeline for README.md
status: implemented
created_at: 2026-11-19T16:36:45Z
implemented_at: 2026-11-19T16:50:00Z
---

# Automated Playwright Visual Preview Pipeline for `README.md`

Build a repeatable, headless Chromium capture pipeline powered by **Playwright** and **FFmpeg** that generates a crisp animated WebP hero walkthrough plus four high-efficiency WebP screenshots of the CRT control console—runnable both via a dedicated **GitHub Actions** workflow (opening a reviewable PR automatically on UI changes or on manual dispatch) and locally against either an ephemeral seeded demo library or a live homelab instance.

## Locked Configuration Decisions

- **Workflow Trigger & Publishing**: Dedicated GitHub Actions workflow (`.github/workflows/update-screenshots.yml`) triggered manually (`workflow_dispatch`, with CRT preset, motion level, and PR creation inputs) and automatically on pushes to `main` touching UI source code—opening or updating a single pull request (`chore/update-readme-screenshots`) with an inline visual preview table whenever assets change.
- **Data Source & Privacy**: Defaults to an isolated ephemeral demo SQLite database seeded via the live migration engine (`v1`–`v19`) with locally rendered copyright-safe retro PNG box art & widescreen screenshots and Playwright-intercepted live transfer telemetry (zero mock routes in production server code), with an optional `--url <base-url>` / `CAPTURE_BASE_URL` override for local homelab instances.
- **Generated Visual Assets**: Produces 5 WebP assets under `docs/assets/screenshots/`:
  - `console-walkthrough.webp` (`1200px` wide, `18 fps`, looping animated WebP across all 4 console scenes)
  - `sync-overview.webp` (`1440×900` — Classic Green · `PVM` · `High` Living UI Motion · active transfer + Speed Wave)
  - `catalog-grid.webp` (`1440×900` — Classic Green · `PVM` · Box-Art Grid with Downloaded/Installed states)
  - `game-detail-drawer.webp` (`1440×900` — Classic Green · `PVM` · slide-over Game Detail Drawer)
  - `sd-card-exporter.webp` (`1440×900` — Warm **Amber** phosphor highlight · `PVM` · Device Export & Storage Folder Mappings)
- **Lean Production Container**: Playwright is intentionally excluded from `package.json` (`dependencies` and `devDependencies`) so `Dockerfile`'s `node_modules` copy stays completely free of Chromium bloat; CI installs Playwright ephemerally via `npm install --no-save playwright`.

## Implementation Summary

- Added modular capture scripts under `scripts/capture-screenshots/` (`options.ts`, `demoArtwork.ts`, `seedDemoDb.ts`, `capture.ts`) and wired `"capture:screenshots"` into `package.json`.
- Added `.github/workflows/update-screenshots.yml` with UI-scoped path triggers, workflow artifact uploads, and automated PR creation/updates with inline Markdown preview tables.
- Updated `README.md` replacing the `TODO (Visual Preview)` placeholder with the Visual Preview showcase layout (Hero Animated Walkthrough + 2×2 Screenshot Gallery) and capture workflow notes.
- Added comprehensive unit tests in `tests/captureScreenshots.test.ts` covering CLI parsing, CRT settings builder, PNG artwork encoding, and end-to-end ephemeral SQLite seeding.
