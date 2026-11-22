---
title: Security Hardening, Optional App Auth & Configuration Backup/Restore
status: planned
created_at: 2026-11-22T20:35:00Z
implemented_at: null
---

# Security Hardening, Optional App Auth & Configuration Backup/Restore

Harden self-hosted deployments of RetroGameTalk Sync by eliminating plaintext credential exposure in `GET /api/config`, adding optional environment-driven UI/API authentication (`APP_AUTH_PASSWORD`), and introducing single-file JSON **Backup & Restore** for Sync Rules, Device Export profiles, and curated settings.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Zero Plaintext Secrets Over HTTP**: `GET /api/config` will **never** return the stored RetroGameTalk password (returning `password: ""` + `hasPassword: true` instead, and masking any future webhook secret tokens). `PUT /api/config` only overwrites the stored password when a non-empty replacement value is explicitly submitted (or when `clearPassword: true` is sent).
> - **Opt-In App Lock (Zero Friction by Default)**: When `APP_AUTH_PASSWORD` is unset (the default), the app behaves identically to today with no login screen. When `APP_AUTH_PASSWORD` (and optional `APP_AUTH_USERNAME`, default `admin`) is configured in Docker/Helm/Unraid/TrueNAS env vars, all `/api/*` endpoints (except `/healthz`, `/readyz`, and `/api/app-auth/*`) require a signed `HttpOnly; SameSite=Lax` session cookie, and the UI displays a sleek CRT terminal unlock screen.
> - **Backup Scope & Secret Hygiene**: Configuration JSON exports include Sync Rules, schedule, pacing, ROM naming, storage folder mappings, device profiles, and collections—and **explicitly exclude** RGT passwords, session cookies, and webhook secrets so backups are safe to store in git or cloud drives.

---

## 1. Overview & Core Concept

During live inspection of the running service, `GET /api/config` was found to return the stored RetroGameTalk account password in plaintext JSON (even though `hasPassword: true` already exists in the response schema). Combined with self-hosted homelab setups where users often run RGT Sync on shared LANs, Unraid, TrueNAS, or behind Tailscale/Cloudflare Tunnels, two operational improvements stand out:
1. Protect stored credentials so secrets stay strictly server-side and optional app-level authentication protects destructive endpoints (`DELETE /api/items`, `PUT /api/config`, sync triggers).
2. Make migrating or backing up carefully tuned Sync Rules, console folder mappings, and device profiles effortless via portable JSON export/import.

### Core Outcomes
1. **Masked Secret APIs**: `getPublicConfig()` strips `password` (`password: ''`, `hasPassword: Boolean(internal.password)`). **System Settings** displays a clean `•••••••• (saved)` placeholder when `hasPassword` is true, and only sends `password` in `PUT /api/config` if the user actually typed a new password.
2. **Optional Self-Hosted App Auth**: Env-controlled (`APP_AUTH_PASSWORD`, optional `APP_AUTH_USERNAME`, `APP_AUTH_SESSION_SECRET`) HMAC-signed `HttpOnly` cookie sessions with brute-force rate limiting, clean CRT login gate, and a sidebar `Lock / Sign Out` control when enabled.
3. **One-Click Settings Backup & Restore**: Download a timestamped `rgt-sync-backup-YYYY-MM-DD.json` from **System Settings**, and restore/merge it with an inline diff preview before applying.

---

## 2. User Experience & Visual Design

### System Settings — Credentials Field Fix
- When `config.hasPassword` is `true` and the field is untouched:
  - Show placeholder `Saved on server — enter a new password to replace` (not pre-filled with the raw secret).
  - Never mark the form dirty until the user types into the password input.
  - Show an inline `Clear` action if they explicitly want to remove a saved password (when not locked by `RGT_PASSWORD` env var).

### Optional CRT App Unlock Screen
- Only rendered when server reports `authRequired: true` and the browser lacks a valid session cookie.
- Minimal centered CRT terminal card matching the active phosphor theme: BrandMark + Password input (plus Username if `APP_AUTH_USERNAME` is set) + **Unlock Console** button + clear rate-limit feedback on bad attempts.
- When unlocked and app auth is active, show a compact `Sign Out` button in the sidebar footer.

### System Settings — Configuration Backup & Restore Card
- **`Export Settings Backup (.json)`**: Immediately downloads a clean, versioned, secret-free JSON snapshot.
- **`Import Settings Backup`**: File picker reads and validates the JSON, displays a concise summary of what will change (e.g., `12 target consoles · 4 release types · 6 folder overrides · 3 collections`), and requires clicking **Apply Backup** to persist.

---

## 3. Architecture & Technical Approach

### Secret Redaction (`src/server/db.ts`, `src/components/SystemSettingsPanel.tsx`)
- Update `getPublicConfig()` to return `{ ...internal, password: '' }` while preserving `hasPassword: Boolean(internal.password)`.
- Update `updateConfig()` so an omitted or empty `password` string keeps the existing DB password unless `clearPassword: true` is explicitly passed.
- Update `SystemSettingsPanel.tsx` dirty tracking and payload construction so leaving the password input blank does not overwrite or mark the form dirty.

### Optional App Auth Middleware (`src/server/appAuth.ts`, `server.ts`)
- Zero-dependency Node `crypto` implementation (`crypto.scryptSync` + `crypto.timingSafeEqual` for password check; HMAC-SHA256 signed session cookie with expiration).
- In-memory sliding-window rate limiter on `POST /api/app-auth/login` (e.g., 10 attempts per 15 min per IP).
- Routes:
  - `GET /api/app-auth/status` → `{ enabled: boolean, authenticated: boolean, usernameRequired: boolean }`
  - `POST /api/app-auth/login` / `POST /api/app-auth/logout`
- Express middleware mounted before `/api/*` (and `/api/events` SSE) passing through `/healthz`, `/readyz`, and `/api/app-auth/*`.
- Document optional `APP_AUTH_PASSWORD` / `APP_AUTH_USERNAME` in `.env.example`, `docker-compose.yml`, and Helm `values.yaml`.

### Backup / Restore Endpoints (`server.ts`, `src/shared/configBackup.ts`)
- `GET /api/backup/export` → returns `{ schemaVersion, appVersion, exportedAt, syncRules, pacing, deviceExport, collections? }` (strictly zero secrets).
- `POST /api/backup/import` → validates schema with strict allowlisted fields, ignores env-locked keys cleanly, and returns a summary receipt of applied changes.

---

## 4. Verification Plan
- Unit tests verifying `getPublicConfig()` NEVER leaks `password` (even when populated in SQLite or `RGT_PASSWORD` env var), and `updateConfig()` preserves existing password when `password` is omitted/blank.
- Unit tests for `appAuth` HMAC cookie signing/verification, expiration, `timingSafeEqual` checks, and login rate limiting.
- Unit tests for `configBackup` export/import validation (ensuring secrets are never exported and unknown/env-locked keys are safely handled).
- Live HTTP test confirming `curl /api/config` contains `"password": ""` and `"hasPassword": true`, and confirming `/api/status` returns `401` when `APP_AUTH_PASSWORD` is enabled without a session cookie.
