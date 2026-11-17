---
title: Bulk Express Install & Asynchronous Storage Device Installer
status: implemented
created_at: 2026-11-17T00:47:15Z
implemented_at: 2026-11-17T01:56:00Z
---

# Bulk Express Install & Asynchronous Storage Device Installer

Deliver a 2-click bulk installation workflow that lets users select any number of filtered Catalog games (across pages or via checkboxes) and stream their smartest, latest playable ROMs directly to a mounted storage device asynchronously in the background—with full close, reopen, and cancel controls.

## User Review & Critical Decisions

- **Confirmed Selection Scope**: Add **Select All Matching Filters** across all Catalog pages (alongside per-page checkboxes) plus an **Express Install** CTA alongside the existing **Review Queue** modal.
- **Confirmed Launch Behavior**: Clicking **Express Install** prompts the storage device folder picker immediately if no device is mounted, then begins inspecting and dumping right away with no extra confirmation gates.
- **Confirmed Multi-ROM & Existing-File Rule**: Express Install automatically selects the smartest **Primary ROM** per release and skips exact matching files already present on the storage device while upgrading older versions cleanly.
- **Context-Aware Latest Primary Selection**: Primary ROM ranking always resolves the **latest version** (semver/revision/build/date) and adapts to active Catalog filters and Sync context (for example, preferring English Translations or Hacks when filtered accordingly).
- **Enhanced Review Modal**: Preserve the detailed Review Queue modal and make `"N multi-ROM items awaiting variant selection"` an interactive jump-to-next control that smooth-scrolls to the next unresolved item and triggers the CRT phosphor spotlight glow.
- **Asynchronous Background Workflow**: Lift the install engine above the modal so users can close the installer while files stream in the background, monitor live progress from a compact non-blocking strip, reopen the installer anytime, and cleanly cancel mid-batch.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms storage device deployment from a single-page manual checklist into a fast, resilient dual-path pipeline:
  1. **Express Install (2 Clicks)**: Filter or select *N* games (from a single page or all matching filter results across the entire Catalog), click **Express Install**, pick the target drive if not already mounted, and watch ROMs stream immediately in the background.
  2. **Review Queue (Granular Control)**: Open the full queue inspector to rename individual outputs, pick alternate variants, jump directly between multi-ROM decisions with CRT spotlight focus, or trigger Smart Auto-Pick for remaining items.
- **Target Audience / Persona**: Retro handheld, EverDrive/flash-cart, MiSTer, and ODE collectors bulk-loading curated sets (e.g., 50–500+ translated SNES RPGs or updated ROM hacks not yet installed on a card/SSD).
- **Key Value**: Cuts bulk device loading from dozens of repetitive clicks and forced modal lock-in down to two clicks, eliminates stale/wrong-variant picks on multi-version releases, and keeps the entire workspace usable while large transfers run.

---

## 2. User Experience & Visual Design

### Key User Flows

#### Flow A — Multi-Page Selection & 2-Click Express Install
1. User filters the Catalog (for example: *System: SNES*, *Type: Translation*, *Storage: Not Installed*) or checks individual items.
2. When items on the current page are selected—or whenever active filters match more items than one page—the Catalog toolbar and bulk toolbar offer **Select All Filtered (*N*)** to capture every matching release ID across pages without leaving the view.
3. User clicks **Express Install (*N*)**:
   - If no storage device handle is mounted yet, the browser's directory picker opens immediately as part of the click activation.
   - As soon as a folder is selected (or immediately if already mounted), the background install runner starts chunked inspection + smart primary resolution + streaming writes right away.
   - A compact live progress strip appears below the sticky workspace bar showing active transfer progress, **Open Queue**, and **Cancel**.

#### Flow B — Review Modal with Next Multi-ROM Jump & Spotlight Glow
1. User opens **Install to Storage Device (*N*)** (or clicks **Open Queue** from the live background strip while Express Install runs).
2. In Review mode, the footer shows `N multi-ROM items awaiting variant selection · Next ↓` as an interactive action button alongside **Auto-Pick Smart Primaries**.
3. Clicking **Next ↓**:
   - Smooth-scrolls the queue viewport to the next unresolved multi-ROM card (wrapping back to the first if already past the last).
   - Mounts the CRT phosphor spotlight overlay (`crt-section-spotlight`) with a fresh trigger nonce so the target card illuminates cleanly.

#### Flow C — Background Execution, Reopen & Mid-Batch Cancel
1. User clicks **Close** / **Run in Background** (or Escape / backdrop) at any point—even while ROMs are actively extracting and streaming to disk.
2. The modal dismisses immediately without aborting the transfer.
3. A sleek workspace banner keeps progress visible across **Sync**, **Catalog**, **Schedule**, and **Operations** tabs.
4. Clicking **Open Queue** restores the full modal synced to live row states (`Queued`, `Inspecting`, `Writing`, `Saved`, `Updated`, `Already on device`, `Canceled`, `Error`).
5. Clicking **Cancel** in either the progress strip or the modal aborts the active HTTP extraction stream cleanly via `AbortController`, cleans up any partial swap placeholder, halts remaining queued writes, and preserves `installed_at` flags for every ROM already completed.
