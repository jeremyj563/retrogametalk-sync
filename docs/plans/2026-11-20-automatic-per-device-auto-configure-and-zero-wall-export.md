---
title: Automatic Per-Device Auto-Configure & Zero-Wall Device Export
status: implemented
created_at: 2026-11-21T00:18:09Z
implemented_at: 2026-11-21T00:24:00Z
---

# Automatic Per-Device Auto-Configure & Zero-Wall Device Export

Make **Auto-Configure** run automatically every time a storage device is mounted so swapping between handhelds, flash carts, MiSTer FPGA, and ODEs works effortlessly without manual reconfiguration. Put a device-aware **Live Export Destination Preview** front-and-center the moment a device is scanned, and eliminate the overwhelming 75+ console scrolling wall in favor of a compact **Active Manual Overrides** list with a **Search-to-Add** console picker.

---

## Key Decisions Implemented

- **Session-Scoped Automatic Auto-Configure**: Mounting or switching any storage device runs Auto-Configure immediately inside the app-wide storage installer controller, activating discovered paths via a 3-layer precedence model (`Universal Defaults` -> `Mounted Device Auto-Config` -> `Saved Manual Overrides`). Ejecting or swapping devices clears the previous device layout cleanly without touching saved overrides.
- **Immediate Device-Aware Live Export Destination Preview**: Positioned as the top hero of **Device Export**, dynamically featuring real consoles detected on the mounted device with clear unboxed path-source indicators (`Auto-detected`, `Manual override`, `Default`) and a collapsed-by-default `Inspect N detected folders` disclosure.
- **Zero-Wall Manual Console Overrides**: Replaced the 75+ console scrolling list with an **Active Overrides Only** list (serene 1-line empty state when none are saved) plus a fast **Search-to-Add** combobox covering all known, synced, and detected consoles.
- **Quiet Sidebar Drive Bay Feedback**: Mounting from Catalog or Monitor scans silently in the background, displaying a `Scanning` LED state followed by a quiet single-line summary (`OnionOS / GarlicOS · 12 consoles`) and a `Preview Paths` shortcut to Device Export.

---

## Verification

- Verified via unit tests (`tests/deviceExportUi.test.ts`, `tests/storageDriveBay.test.ts`, `tests/storageAutoConfig.test.ts`, `tests/catalogSelection.test.ts`), `tsc --noEmit`, and production Vite build (`1.25.0`).
