---
title: Hardware-Pinned Device Identity & Large-Fleet Device Management
status: implemented
created_at: 2026-11-23T15:34:40Z
implemented_at: 2026-11-23T16:00:00Z
---

# Hardware-Pinned Device Identity & Large-Fleet Device Management

A hardware-pinned identification layer (`.rgt-device.json` root marker + browser handle verification + Identify/Link prompt) paired with a scalable 10+ device management workflow featuring a compact sidebar dock, searchable Devices fleet drawer, visual form-factor/color badges, pinning/archiving, and offline saved-device Catalog filtering.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The design below incorporates your confirmed decisions alongside a few sensible defaults — please review before we proceed to implementation:
>
> - **Auto-Stamped Card Marker (`.rgt-device.json`)**: When a storage root is mounted and identified, RGT Sync automatically writes a tiny hidden `.rgt-device.json` marker file containing a stable UUID (`dev_<uuid>`), profile name, and schema version so cards are uniquely recognized even when multiple cards share the same folder name (`Roms`, `SDCARD`, etc.) or move between computers/browsers.
> - **Identify / Link Prompt for Unmarked Mounts**: Mounting an unrecognized folder without a `.rgt-device.json` marker (and not matched to an existing browser handle via `isSameEntry()`) opens a focused **Identify Storage Device** modal letting you either register a new device profile (name, form-factor icon, color badge, optional pin) or link the card to an existing saved profile—seamlessly migrating legacy `1.37.0` profiles or replaced SD cards without losing install history.
> - **Compact Sidebar Dock + Searchable Devices Fleet Drawer**: The left sidebar Drive Bay stays compact regardless of fleet size (1 or 30+ devices), showing the active device (or top reconnect shortcut) plus a quick **Devices** trigger that opens a slide-over **Devices Fleet Drawer** with live search, `Active / Pinned / Archived` tabs, reconnect, inline edit, pin/archive toggles, and delete confirmation.
> - **10+ Device Organization Helpers**: Every device profile supports a selectable **form-factor icon** and **CRT-harmonized color badge**, **Pin** (keeps favorites at the top of switchers) and **Archive** (tucks retired devices out of daily views while preserving their install history), plus **offline Catalog filtering** by any saved device even when its SD card is unplugged.
> - **Default Fallback for Read-Only Media**: If a mounted SD card is write-protected or denies marker creation, RGT Sync continues smoothly without blocking the mount, flags the device subtly as read-only/unmarked, and relies on browser handle matching (`isSameEntry()`) or manual selection.
> - **Release Version**: Ships as minor release **`1.38.0`** (lockstep SemVer bump + archived plan entry upon implementation).

---

## 1. Overview & Core Concept

Today, browser storage mounts rely on `handle.name` (the root directory or volume label) as the primary fallback identifier whenever a user picks a folder freshly. For collectors rotating across 10+ retro handhelds, flashcarts, FPGA boxes, and SD cards—many of which use identical OS folder names like `Roms`, `Games`, or `SDCARD`—folder-name matching risks colliding two different physical devices into a single profile, while a flat list of saved devices quickly crowds the sidebar.

This upgrade solves both problems at the root:

1. **Deterministic Physical Card Identity**: Every mounted storage root gets a durable UUID stored inside a hidden `.rgt-device.json` marker file at the mounted root, backed up by Chromium's `FileSystemHandle.isSameEntry()` comparison against saved IndexedDB handles. Re-mounting any stamped card recognizes the exact device instantly—even across machines, USB readers, or identical volume labels.
2. **Effortless 10+ Device Fleet UX**: A compact sidebar Drive Bay keeps daily controls tight, while a searchable **Devices Fleet Drawer** and a searchable **Catalog Device Filter** let users inspect, organize, pin, archive, reconnect, or audit ROM coverage across dozens of devices—online or offline.

---

## 2. User Experience & Visual Design

### Visual System & CRT Continuity
- **Existing CRT Phosphor Tokens**: Strictly adheres to RGT Sync's established dark CRT terminal palette (`--color-crt-bg`, `--color-crt-surface`, `--color-crt-elevated`, `--color-crt-border`, `--color-crt-border-strong`, `--color-crt-text`, `--color-crt-muted`, `--color-crt-phosphor`, `--color-crt-amber`, `--color-crt-crimson`) so all new surfaces adapt automatically across all unlockable CRT palettes (`green`, `amber`, `cyan`, `gameboy`, `synthwave`, `virtualboy`, `trinitron`).
- **Typography & Tabular Discipline**: Preserves `Chakra Petch` (`--font-display`) for drawer/modal titles and device display headers, `DM Sans` (`--font-sans`) for crisp dense controls (`12px–14px`), and `IBM Plex Mono` (`--font-mono`) with `tabular-nums` for installed ROM counts, volume paths, timestamps, and update counters so numbers never jitter when switching devices.
- **Anti-Clutter & Zero-Pill Discipline**:
  - Uses crisp 1px hairline dividers (`border-crt-border`) and single-elevation surfaces rather than nested card sandwiches or thick colored left accent strips.
  - Static metadata (volume label, last mounted time, ROM count, marker verification state) renders as clean typographic inline rows separated by subtle middots—never wrapped in stacks of rounded pills.
  - Interactive buttons enforce `whitespace-nowrap shrink-0` so labels never wrap awkwardly across lines; no decorative pulsing status dots.
- **Motion & Accessibility**:
  - Slide-over **Devices Fleet Drawer** and **Identify Storage Device** modal use smooth compositor-only transforms/opacity (`transform`, `opacity`) matching existing drawers, honoring `prefers-reduced-motion: reduce`.
  - All badge accent hues maintain WCAG AA contrast on `--color-crt-surface` and `--color-crt-elevated` surfaces, with keyboard-accessible focus rings and full Escape-to-close / arrow navigation in search popovers.

### Curated Device Identity Badges (Form-Factor Icon + Color)
Every device gets a crisp, scannable hardware silhouette paired with a subtle CRT-harmonized color accent (used on the icon emblem and an understated 2px/ring highlight—never garish full-row fills):
- **Form-Factor Icons (7 choices)**:
  - Horizontal Handheld (e.g., Steam Deck, Retroid, Odin, GBA-style)
  - Vertical Handheld (e.g., Miyoo Mini, Analogue Pocket, Game Boy)
  - Clamshell / Dual-Screen (e.g., 3DS, RG35XX SP, Flip)
  - MicroSD / Flashcart (e.g., EverDrive, standalone card)
  - FPGA / TV Console (e.g., MiSTer, Raspberry Pi, Mini PC)
  - Desktop / Local Folder (e.g., PC emulator folder, NAS share)
  - Custom / Generic Drive
- **Color Badges (6 CRT-harmonized accents)**: Phosphor Green, Amber Gold, Cyan Pulse, Crimson Signal, Violet Arcade, Cool Slate.

### Core User Flows & Viewport Layouts

1. **Compact Sidebar Drive Bay (Always Bounded Height)**
   - **Mounted State**: Shows the active device's icon + color emblem, friendly name, subtle inline status (`Mounted · 142 installed · 3 updates`), and single-line actions (`Switch / Reconnect`, `Unmount`). Below a subtle hairline divider, a compact **`Devices (12)`** button (with pinned quick-jump indicator if pinned devices have remembered handles) opens the full searchable **Devices Fleet Drawer**.
   - **Disconnected State**: Shows the primary **`Mount Storage`** CTA alongside at most **one** smart one-click **`Reconnect <Last/Top Pinned Device>`** shortcut when a browser handle exists, plus the compact **`Devices (N)`** fleet button. Never expands into a 10+ row vertical list inside the sidebar.
2. **Identify / Link Storage Device Modal (Unmarked Mount Flow)**
   - Opens automatically only when a newly picked folder has no `.rgt-device.json` marker and does not match an existing saved handle via `isSameEntry()`.
   - Displays the detected root folder name and auto-detected firmware/layout hint (e.g., `OnionOS / Miyoo layout detected`).
   - Two clean segmented modes:
     - **New Device** *(default when no matching legacy profile exists)*: Pre-filled Name input, horizontal icon picker, color swatch row, optional `Pin to Favorites` checkbox, and **`Create & Stamp Card`** primary CTA.
     - **Link Existing Profile** *(default when an unmarked legacy profile shares the same volume label, or selectable anytime)*: Searchable list of saved profiles (highlighting same-volume matches at top) with **`Link & Stamp Card`** CTA—preserves all recorded installs, custom folder overrides, and naming templates while writing `.rgt-device.json` to the physical card.
   - Read-only notice: If writing `.rgt-device.json` fails due to permissions or write-lock, shows a concise non-blocking inline notice (`Card is read-only — linked locally in this browser`) and completes the mount cleanly.
3. **Searchable Devices Fleet Drawer (Built for 10–50+ Devices)**
   - Right-hand slide-over drawer (`max-w-xl`) accessible from the sidebar dock, Catalog device selector, and Device Export panel.
   - **Top Controls**: Live search input (`Search by name, folder, or layout…`) + segmented filter tabs (`Active`, `Pinned`, `Archived`) with tabular counts + primary **`+ Mount New`** action.
   - **Fleet Rows**: Compact, high-density hairline rows sorted by `Mounted first → Pinned → Most recently mounted`. Each row displays:
     - Hardware icon tinted with its color badge + device name + subtle pin glyph (if pinned) + inline status (`Mounted`, `Ready to reconnect`, or `Offline`).
     - Secondary mono metadata line: volume label (`SDCARD`) · installed ROM count · updates badge (if any) · marker status (`Card ID` vs `Unstamped`) · relative last-mounted timestamp.
     - Crisp action bar: **`Reconnect`** (if remembered handle & not mounted), **`Browse in Catalog`** (scopes Catalog to this device immediately—works offline!), **`Pin/Unpin`**, **`Edit`** (expands compact inline editor for Name, Icon, Color, and "Stamp/Repair Card ID" if currently mounted without marker), **`Archive/Restore`**, and **`Delete`** (inline confirmation).
   - **Complete States**: Populated list, filtered empty state (`No devices match "miyoo"` + Clear filter), zero-device empty state with **`Mount Your First Device`** CTA, and loading skeleton rows.
4. **Offline Saved-Device Filter in Catalog**
   - Replaces the current mounted-only `[This Device | Any Device]` toggle with a compact searchable **Device Scope Selector** dropdown whenever at least one device profile exists (even when no SD card is mounted).
   - Dropdown groups:
     - **`Any Device`** (aggregate across all non-archived or all saved devices)
     - **Currently Mounted** (highlighted at top when connected)
     - **Pinned Devices** (quick jump for daily drivers)
     - **Other Devices** (live-searchable inside the dropdown when ≥ 6 devices exist)
     - **Archived Devices** (collapsible/quiet bottom section so retired cards stay inspectable without cluttering active choices)
     - Footer shortcut: **`Manage Devices…`** (opens the Devices Fleet Drawer).
   - Selecting any saved device scopes the Catalog's **`Installed (N)`**, **`Not Installed (N)`**, and **`Updates (N)`** tabs and game badges strictly to that device's recorded installs—so you can plan installs, check missing games, or inspect what's on your Miyoo Mini or Steam Deck while the card is sitting on your desk.

---

## 3. Key Product Decisions & Trade-Offs

- **Card-Resident `.rgt-device.json` + `isSameEntry()` Hybrid (over Pure Volume Labels)**
  - *Why*: Browsers intentionally withhold OS hardware serial numbers/GUIDs for privacy. Writing a tiny hidden `.rgt-device.json` file directly at the mounted storage root gives true portable, hardware-pinned identity across identical volume labels (`Roms`), USB adapters, browsers, and machines. Pairing it with `handle.isSameEntry()` covers read-only cards or locked folders seamlessly inside the same browser.
  - *Trade-off*: Adds a single ~180-byte hidden dotfile at the storage root. To prevent side effects, `.rgt-device.json` is explicitly ignored by ROM scanners, auto-layout detectors, and uninstall stem matchers.
- **Explicit Identify / Link Prompt on Unmarked Mounts (over Silent Auto-Creation)**
  - *Why*: Silently auto-creating a profile on every unmarked card would orphan existing `1.37.0` profiles when users first upgrade or replace a failing SD card. A quick 1-step Identify/Link modal turns the first mount into a clean 3-second migration while letting users immediately set an icon and color badge for new cards.
- **Sidebar Dock + Fleet Drawer (over Expanding Sidebar List or Dedicated Full Page)**
  - *Why*: Keeps the persistent left sidebar compact and clean at 10–30+ devices while keeping device switching, pinning, and offline Catalog inspection one click away from any view without losing your place in the Catalog or Queue.
- **Soft Archiving (over Forced Deletion)**
  - *Why*: Collectors frequently retire an older handheld or swap SD cards without wanting to erase historical knowledge of what was installed on it. Archiving hides retired devices from default switchers and counts while keeping their install ledger inspectable under the `Archived` filter and restorable anytime.

---

## 4. Technical Architecture & Data Strategy

### End-to-End Mount Identification & Fleet Management Architecture

```
  User picks storage folder (File System Access API)
                       │
                       ▼
       ┌──────────────────────────────────┐
       │ 1. Read root `.rgt-device.json`  │ (≤ 4 KB, strict schema & ID validation)
       └───────────────┬──────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │ Marker Found              │ No Marker / Invalid
         ▼                           ▼
 ┌───────────────────────┐   ┌──────────────────────────────────────┐
 │ Lookup profile by UUID│   │ 2. Compare picked handle via         │
 │ (or recreate with ID) │   │    `isSameEntry()` vs IndexedDB pool │
 └───────────┬───────────┘   └──────────────────┬───────────────────┘
             │                    ┌─────────────┴────────────┐
             │                    │ Handle Matched           │ Unrecognized
             │                    ▼                          ▼
             │            ┌────────────────────┐  ┌──────────────────────────┐
             │            │ Mount matched ID & │  │ 3. Open Identify / Link  │
             │            │ auto-stamp marker  │  │    Storage Device Modal  │
             │            └─────────┬──────────┘  │  • New Device (UUID+UI)  │
             │                      │             │  • Link Existing Profile │
             │                      │             └────────────┬─────────────┘
             │                      │                          │
             └──────────────────────┴──────────────────────────┘
                                    │
                                    ▼
       ┌──────────────────────────────────────────────────────────┐
       │ Persist handle in IndexedDB (`deviceId` -> Handle)       │
       │ Stamp `.rgt-device.json` (graceful read-only fallback)   │
       │ Sync profile & metadata via `/api/devices/*` (SQLite v28)│
       └────────────────────────────┬─────────────────────────────┘
                                    │
          ┌─────────────────────────┼──────────────────────────┐
          ▼                         ▼                          ▼
 ┌─────────────────┐     ┌─────────────────────┐    ┌─────────────────────┐
 │ Compact Sidebar │     │ Searchable Devices  │    │ Catalog Offline     │
 │ Drive Bay       │◄───►│ Fleet Drawer        │◄──►│ Device Scope Filter │
 │ (Active + 1 CTA)│     │ (Search/Pin/Archive)│    │ (`?deviceId=<any>`) │
 └─────────────────┘     └─────────────────────┘    └─────────────────────┘
```

### Data Model & SQLite Schema (Migration v28)
- **Table Extension (`storage_device_profiles`)**: Add backward-compatible columns via SQLite migration v28 (preserving all existing `1.37.0` rows and install records):
  - `icon_key TEXT NOT NULL DEFAULT 'handheld'` — validated form-factor icon identifier.
  - `color_key TEXT NOT NULL DEFAULT 'phosphor'` — validated CRT accent color identifier.
  - `is_pinned INTEGER NOT NULL DEFAULT 0` — boolean flag floating favorite devices to the top of switchers.
  - `is_archived INTEGER NOT NULL DEFAULT 0` — soft-archive flag hiding retired devices from default lists without deleting their `device_installed_roms` rows.
  - `marker_verified_at TEXT` — ISO-8601 UTC timestamp recording the last verified `.rgt-device.json` read/write (null indicates a legacy or read-only unstamped device).
- **Card Marker File Contract (`.rgt-device.json` at mounted root)**:
  - Compact UTF-8 JSON object containing `schemaVersion: 1`, `deviceId` (`dev_<uuid>` or existing validated profile ID), `name`, `createdAt`, and `updatedAt`.
  - Automatically refreshed when a mounted device is renamed so the physical card stays self-describing even if inspected in a file manager.
  - Explicitly excluded from directory scans, firmware auto-detection, and ROM uninstall matching.
- **API & State Layer Extensions**:
  - Extend `GET /api/devices` to return the new visual, pin, archive, and marker metadata fields, sorted consistently (`isPinned DESC, isArchived ASC, lastMountedAt DESC`).
  - Extend `POST /api/devices` to accept explicit `id` (when linking or reading from `.rgt-device.json`), `createNew` (forces a fresh UUID without auto-merging onto a same-name volume), `iconKey`, `colorKey`, `isPinned`, and `markerVerifiedAt`.
  - Extend `PATCH /api/devices/:id` to update `name`, `iconKey`, `colorKey`, `isPinned`, `isArchived`, and `markerVerifiedAt` (plus optional re-stamp when currently mounted).
  - Update Catalog state so `deviceScopeSelection` supports `'auto'`, `'any'`, or any saved `deviceId` (defaulting to the mounted device when connected, and remaining freely switchable to any saved device whether mounted or offline), passing `deviceId` to `/api/items`, `/api/items/ids`, and `/api/items/outdated`.
- **Browser Handle Store (IndexedDB)**:
  - Add a helper to scan stored handles and test `await record.handle.isSameEntry(pickedHandle)` during fresh mounts, plus cleanup when deleting a profile.
  - Support switching directly from one mounted device to another remembered device inside the Devices Fleet Drawer via a single click (prompting Chromium permission if needed).

### Security & Data Integrity Safeguards
- **Untrusted Media Marker Validation**: Reading `.rgt-device.json` from removable storage enforces a strict 4 KB file size cap, safe JSON parsing with plain-object checks, and strict regex/length sanitization of `deviceId` and display fields—any malformed, oversized, or corrupted marker is ignored safely without crashing or injecting invalid IDs.
- **Validated Allowlists & Parameterized Queries**: All new profile attributes (`iconKey`, `colorKey`, `isPinned`, `isArchived`, `markerVerifiedAt`, `deviceId`) are validated against strict server-side allowlists and written exclusively via parameterized SQLite statements behind the existing CSRF-protected mutation endpoints.
- **Marker Isolation & Path Safety**: `.rgt-device.json` is strictly filtered out of ROM discovery and protected against accidental deletion during ROM uninstalls, while all file writes and deletes remain confined to the user-granted `FileSystemDirectoryHandle` root with path-traversal guards.

### Verification Plan (On Execution)
- Automated unit tests covering SQLite migration v28, `.rgt-device.json` parser/validator edge cases (valid, oversized, corrupted, invalid ID), `createNew` vs link-existing mount semantics (preventing same-volume collisions), pin/archive sorting and filtering, and offline saved-device Catalog queries.
- Full TypeScript lint (`lint_applet`), production bundle compilation (`compile_applet`), and live verification of mount/identify/stamp, fleet drawer search/pin/archive, and offline Catalog device filtering.
