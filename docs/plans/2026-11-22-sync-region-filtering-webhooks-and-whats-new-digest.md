---
title: Sync Rule Region Filtering, Outbound Webhooks & "What's New" Digest
status: planned
created_at: 2026-11-22T20:35:00Z
implemented_at: null
---

# Sync Rule Region Filtering, Outbound Webhooks & "What's New" Digest

Make unattended scheduled syncing smarter and more informative by adding **Region allowlist filtering** to Sync Rules, **outbound notification webhooks** (Discord, ntfy, Gotify, Pushover, Generic JSON) when new releases or updates land, and a **"What's New"** recent-activity digest across Monitor and Catalog.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Region Filter Semantics**: Adding an optional `Allowed Regions` selector to Sync Rules (`All Regions` by default; or pick any subset like `USA`, `World`, `Europe`, `Japan`, `Other`).
>   - **Smart Fan Translation Exception**: Provide a toggle *"Always allow matching Fan Translations regardless of source ROM region"* (enabled by default!)—because English fan translations on RGT are almost always patched onto `Japan` region ROMs!
> - **Outbound Notification Channels**: Support zero-dependency HTTP `fetch` delivery for **Discord Webhooks** (rich embeds with game title, console, release type, cover thumbnail, and direct link), **ntfy** (with optional Bearer token/topic), **Gotify**, **Pushover**, and **Generic JSON Webhook**, plus a **Send Test Notification** button.
> - **Digest Grouping**: Batch newly discovered/downloaded releases per sync run into a single clean summary notification (listing up to 10 highlights + "+N more") rather than spamming one notification per game.

---

## 1. Overview & Core Concept

Right now, RGT Sync runs cleanly on a cron schedule in the background, but two real-world gaps remain for set-and-forget users:
1. **Regional Noise in Sync Rules**: Sync Rules filter by Target Consoles and Release Types, but have no Region filter—so enabling Retail/Hack releases on SNES, GBA, or PS1 downloads `Japan` and `Europe` duplicates alongside `USA` / `World` releases.
2. **Silent Background Runs**: When a scheduled sync runs overnight and discovers a highly anticipated English fan translation or a major ROM hack update, the user has no idea unless they proactively open the web UI and sort the Catalog by newest submissions.

### Core Outcomes
1. **Region-Aware Sync Rules**: Optional Region allowlist (`USA`, `World`, `Europe`, `Japan`, `Asia`, `Korea`, `Brazil`, `Other`) integrated into `syncRuleMatcher`, Sync Preflight, Full Sync, Incremental Sync, and Catalog `Matches Sync Rules`—with a smart default exception so English translations of Japanese originals are never accidentally filtered out.
2. **Webhook Notifications**: Configurable notification triggers (`New Releases Downloaded`, `New Releases Discovered`, `Sync Run Failed`, `Auth Session Expired`) with per-channel configuration and 1-click **Test Notification**.
3. **"What's New" Quick View**: A concise **Recently Added / Updated (Last 7 Days)** quick filter in the Catalog and summary strip on the Monitor page so users can scan fresh RGT drops at a glance.

---

## 2. User Experience & Visual Design

### Sync Rules Panel (`SyncRulesPanel.tsx`)
- Add a compact **Region Filter** card directly under Release Types:
  - Toggle chips: `All Regions` (default) vs. multi-select `USA`, `World`, `Europe`, `Japan`, `Other`.
  - Checkbox: `Include matching Fan Translations from any source region` (default ON), with clear helper copy explaining why (`e.g., English translations of Japan-exclusive RPGs`).
- Live mid-run Sync Rule hot-reload automatically detects Region filter changes just like Console and Release Type changes.

### System Settings Panel (`SystemSettingsPanel.tsx`)
- Add a **`Notifications & Webhooks`** section:
  - Enable toggle + Provider selector (`Discord`, `ntfy`, `Gotify`, `Pushover`, `Generic JSON`).
  - Provider-specific fields (Webhook URL / Topic / Token — secret tokens masked on `GET /api/config`).
  - Event checkboxes: `Sync Completed with New Releases`, `Sync Failures / Errors`, `Auth Session Expired`.
  - **`Send Test Notification`** button with instant inline pass/fail feedback.

### Monitor & Catalog ("What's New")
- **Catalog Quick Filter**: Add a compact `New (7d)` toggle (or `Added Within` dropdown: `24h`, `7d`, `30d`) alongside `Matches Sync Rules`.
- **Monitor Recent Drops Card**: When idle and new releases were discovered/downloaded in the last 7 days, show a compact horizontal strip of the latest 5–6 box-art thumbnails with a **View All in Catalog →** deep link.

---

## 3. Architecture & Technical Approach

### Shared Rule Engine (`src/shared/syncRuleMatcher.ts`)
- Extend `SyncRuleConfigLike` with `allowedRegions?: string[]` and `regionFilterExemptTranslations?: boolean`.
- Normalize region strings (`USA`, `US`, `U` → `usa`; `Europe`, `EUR`, `E` → `europe`; `Japan`, `JPN`, `J` → `japan`; `World`, `W` → `world`, etc.) in a pure helper `doesReleaseRegionMatchSyncRules(...)`.
- Ensure 100% parity across `computeSyncPreflightSummary`, `queryRepositoryItems` (`syncRulesOnly`), `orchestrator` Full/Incremental Sync, and `diffSyncRules` live hot-reload.

### Notification Service (`src/server/notificationService.ts`)
- Pure payload formatters (`formatDiscordWebhookPayload`, `formatNtfyPayload`, `formatGenericWebhookPayload`) + timeout-guarded `sendNotification` using native Node `fetch` (no extra npm dependencies).
- Hook into `orchestrator.ts` run completion (only firing when `downloadedCount > 0 || discoveredCount > 0` for new-release notifications, or on run failure / auth expiry).
- New `POST /api/notifications/test` route in `server.ts`.

### Database Schema (Next SQLite Migration)
- Add `allowed_regions_json TEXT NOT NULL DEFAULT '[]'`, `region_filter_exempt_translations INTEGER NOT NULL DEFAULT 1`, and `notifications_config_json TEXT NOT NULL DEFAULT '{}'` to `scraper_config`.
- Add optional `sinceDays` query parameter to `GET /api/items` and `GET /api/items/ids` filtering on `COALESCE(published_at, first_seen_at) >= ?`.

---

## 4. Verification Plan
- Unit tests for `doesReleaseRegionMatchSyncRules` covering `All Regions`, `USA + World`, Japanese-source English translation exemption ON vs. OFF, multi-region dumps (`USA, Europe`), and `diffSyncRules` hot-reload detection.
- Unit tests for Discord / ntfy / Gotify / Generic webhook payload builders (truncation for large runs, markdown escaping, error handling).
- SQLite migration + Catalog `sinceDays` filter tests.
