---
title: Unified & Simplified Device Export Experience
status: implemented
created_at: 2026-11-20T23:55:14Z
implemented_at: 2026-11-20T23:59:00Z
---

# Unified & Simplified Device Export Experience

Redesign the **Device Export** settings page into a calm, linear two-step workflow—**Console Folders** first, **ROM Filename Formatting** second—anchored by a live combined destination path preview. Eliminate the duplicated folder mapping lists by merging **Auto-Configure** scan results directly into the single console list with inline diffs, one-click **Apply & Save**, and progressive disclosure for advanced overrides.

---

## User Review & Critical Decisions

- **Confirmed Decision 1 — Page Flow**: Guided top-to-bottom layout with **01. Console Folders** first and **02. ROM Filename Formatting** second.
- **Confirmed Decision 2 — Unified Auto-Configure**: Scan results merge directly into the **single console list** (in-place review mode with inline path diffs and checkboxes)—completely removing the second stacked console list.
- **Confirmed Decision 3 — Progressive Disclosure**: Clean, everyday defaults sit upfront (folder mode toggle, console paths, and 4 naming presets), while custom filename token templates, FAT32 length limits, default ROM-type subfolder names, and per-console subfolder overrides tuck neatly into expandable **Advanced** disclosures.
- **One-Click Apply & Save**: Scan review provides **Apply & Save** as the primary CTA alongside **Apply to Draft**, removing the awkward two-step apply-then-save workflow.

---

## 1. Overview & Core Concept

Replaces the fragmented, five-box Device Export layout with a single cohesive destination configurator that answers two questions in order: *"Where do my ROMs go on my device?"* and *"What are the files named?"*

---

## 2. User Experience & Visual Design

- **Live Export Destination Preview**: Compact recessed bar at the top of Device Export combining active console folder, ROM-type organization, and filename preset for Retail, ROM Hack, and Translation samples in real time.
- **01. Console Folders**:
  - Direct primary **Auto-Configure** action in the section header (plus **Scan Other** when mounted and **Reset All** when customized), removing the separate stacked Auto-Configure box.
  - Hairline-separated **ROM Organization** row (`Single Folder` vs `Sort by ROM Type`) with a collapsible **Subfolder Names** disclosure.
  - **Single Unified Console List**: When Auto-Configure completes, a slim review strip docks directly above the console table and activates a temporary `Scan Matches (N)` tab; matched rows render inline checkboxes, status labels (`New`, `Updates Custom`, `Already Matches`), `/old -> /detected` transitions, alternate candidate pickers, and detected subfolder notes without duplicating the list.
- **02. ROM Filename Formatting**:
  - Four naming presets upfront in a responsive grid.
  - Collapsible **Advanced Naming & FAT32 Rules** disclosure (auto-expanded only when customized beyond preset/FAT32 defaults) with clickable token buttons, max filename length, and FAT32 character sanitization.

---

## 3. Verification

- Verified via unit tests (`tests/deviceExportUi.test.ts`, `tests/storageAutoConfig.test.ts`, `tests/storageDriveBay.test.ts`), `tsc --noEmit`, and production Vite build (`1.24.0`).
