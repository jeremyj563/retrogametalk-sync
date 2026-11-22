---
title: Multi-Device Profiles, Persistent Reconnect Mounts & Device Uninstall
status: planned
created_at: 2026-11-22T20:35:00Z
implemented_at: null
---

# Multi-Device Profiles, Persistent Reconnect Mounts & Device Uninstall

Upgrade RGT Sync's storage device workflow from single-device, session-only mounting to full **multi-handheld management**: per-device install tracking, saved device profiles with independent folder/naming rules, IndexedDB handle persistence for 1-click **Reconnect `<Device>`** across browser refreshes, and direct **Uninstall from `<Device>`** to free SD card space.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Per-Device Install History**: Migrate from a single `last_installed_device` / `last_installed_at` column on `catalog_releases` to a dedicated `catalog_release_device_installs` table keyed by `(release_id, device_id)` so installing a game on a Steam Deck never erases the fact that it's also installed on a Miyoo Mini.
> - **IndexedDB Handle Persistence**: Save recently mounted Chromium `FileSystemDirectoryHandle` references in browser IndexedDB (`rgt_device_handles_v1`). On page reload, the Sidebar Drive Bay remembers your last device and offers a single-click **Reconnect `<Device>`** button (`handle.requestPermission({ mode: 'readwrite' })`) instead of forcing you to re-navigate the OS folder picker.
> - **Explicit Confirmation for Device Uninstall**: Removing a ROM from a mounted storage device deletes the file(s) (and disc subfolder / matching box art if present) from the SD card after an inline confirmation step and clears that device's install record—never touching your local RGT Sync mirror.

---

## 1. Overview & Core Concept

Retro gaming enthusiasts rarely own just one device. A typical setup includes a pocket handheld (Miyoo Mini / Anbernic), a widescreen handheld (Retroid / Odin / Steam Deck), and maybe an FPGA console (Analogue Pocket / MiSTer)—each with completely different ROM folder structures, naming rules, and game lists.

Today, RGT Sync has three multi-device limitations:
1. Reloading the browser tab drops the mounted `FileSystemDirectoryHandle`, forcing a full folder-picker re-mount every session.
2. `catalog_releases` tracks only one `lastInstalledDevice`, overwriting history whenever you install the same game onto a second handheld.
3. There is no way to uninstall/remove a ROM from a mounted device inside the UI.

### Core Outcomes
1. **One-Click Reconnect After Refresh**: Remembering recent device handles in IndexedDB turns a 5-click OS picker flow into a single **Reconnect `MiyooMini`** click in the sidebar drive bay.
2. **Saved Multi-Device Profiles**: Each mounted storage device gets a stable profile (nickname, custom console folder overrides, ROM naming preference, and artwork preset) that activates automatically whenever that device is mounted or switched.
3. **Accurate Per-Device `Installed` Filtering**: When a device is mounted, the Catalog's `Installed` / `Not Installed` toggles can scope to **This Device (`<Device>`)** or **Any Device**, and Game Details lists all devices a game is currently installed on.
4. **Clean Uninstall from Device**: Delete an installed ROM (or bulk-selected ROMs) from the currently mounted device directly from Game Details or the Catalog bulk bar.

---

## 2. User Experience & Visual Design

### Storage Device Sidebar Drive Bay (`StorageDeviceSidebarDock.tsx`)
- **Disconnected with Known Last Device**:
  - Shows a quiet standby state with the remembered device name (`Last: MiyooMini`) and a primary 1-click **Reconnect `MiyooMini`** button alongside **Mount Another…**.
- **Connected**:
  - Quick device profile switcher popover showing saved profiles (with inline nickname rename) + live count of games installed on this device.

### Catalog & Game Details
- **Catalog `Installed` Filter**:
  - When a device is mounted, `Installed` defaults to scoping to the active mounted device (with a subtle toggle for `Any Device`), so building a loadout for Device B doesn't falsely show Device A's games as already installed.
- **Game Details**:
  - Shows compact per-device badges (`Installed on MiyooMini · SteamDeck`).
  - When mounted and installed on the active device, adds **Uninstall from `<Device>`** inside the `More` menu (with inline confirmation showing exact relative path(s) to be removed).
- **Catalog Bulk Bar**:
  - When mounted and selected games are installed on the active device, shows **Uninstall from `<Device>` (`N`)** with inline confirmation.

---

## 3. Architecture & Technical Approach

### Database Schema (Next SQLite Migration)
- `storage_device_profiles`:
  - `id TEXT PRIMARY KEY` (UUID or stable slug), `name TEXT NOT NULL`, `volume_label TEXT NOT NULL`, `folder_config_json TEXT`, `rom_naming_json TEXT`, `art_export_json TEXT`, `last_mounted_at TEXT`, `created_at TEXT`, `updated_at TEXT`.
- `catalog_release_device_installs`:
  - `release_id INTEGER NOT NULL`, `device_id TEXT NOT NULL`, `installed_at TEXT NOT NULL`, `installed_file_id INTEGER`, `installed_paths_json TEXT NOT NULL DEFAULT '[]'`, `PRIMARY KEY (release_id, device_id)` with `ON DELETE CASCADE`.
- Backfill existing `catalog_releases.last_installed_device` values into `storage_device_profiles` + `catalog_release_device_installs` during migration so zero existing install history is lost.

### Browser Handle Persistence (`src/utils/deviceHandleStore.ts`)
- Thin IndexedDB wrapper storing `{ deviceId, volumeName, handle, lastMountedAt }` (gracefully no-ops in non-Chromium/private modes).
- On app boot, loads stored handle metadata and checks `queryPermission({ mode: 'readwrite' })`; if `'granted'`, auto-reconnects silently, else renders 1-click **Reconnect** which calls `requestPermission({ mode: 'readwrite' })` inside the click gesture.

### Uninstall Engine (`src/utils/sdCardFs.ts`, `src/hooks/useBulkStorageInstaller.ts`)
- Record exact written relative paths (`installed_paths_json`) on every install (single ROM file or disc-set folder).
- `uninstallItemsFromMountedDevice(itemIds)` removes recorded relative path(s) via `dirHandle.removeEntry(name, { recursive: isDiscFolder })` (with fallback stem lookup via `scanTargetFolder` for legacy installs) and calls `DELETE /api/devices/:deviceId/installs`.

---

## 4. Verification Plan
- Unit tests for SQLite migration backfill, per-device install CRUD, and `Catalog` per-device vs. any-device `installedFilter` queries.
- Unit tests for `deviceHandleStore` permission states (`granted`, `prompt`, `denied`, unsupported browser fallback).
- Live Chromium test: mount folder → install game → refresh browser → click **Reconnect** → verify zero folder-picker friction → click **Uninstall from `<Device>`** → verify file removed from disk and badge cleared while local RGT mirror stays untouched.
