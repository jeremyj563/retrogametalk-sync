---
title: Clean Sync Activity Panel Redesign
status: implemented
created_at: 2026-11-16T17:10:43Z
implemented_at: 2026-11-16T17:12:00Z
---

# Clean Sync Activity Panel Redesign

Replace the cramped, dot-delimited text rows in the top Sync activity panel with a calm, structured three-tier hierarchy: a full-width phase headline, a dedicated full-width active transfer strip, and a balanced 4-column summary strip below—with internal container Pod IDs removed from the overview.

## User Review & Critical Decisions

> [!IMPORTANT] All layout, visibility, and organizational choices below were confirmed during clarification and govern this redesign.

- **Confirmed — Hide Pod ID**: Remove the internal container identifier (`Pod rgt-sync-...`) from the top Sync activity panel so homelab operators see only actionable sync status.
- **Confirmed — 4-Column Summary Strip**: Organize **Next Schedule**, **Incremental Cutoff**, **Type Filter**, and **Consoles** into a clean 4-column summary strip beneath the phase header, eliminating wrapping middle-dot chains.
- **Confirmed — Dedicated Full-Width Transfer Bar**: Move the live download progress bar out of the cramped side column into a dedicated full-width transfer strip situated directly above the 4-column summary strip whenever a file is transferring.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the primary status banner at the top of the Sync dashboard from two dense wrapping lines plus a squeezed side column into a clean, scannable instrument panel where every piece of telemetry occupies its own predictable slot.
- **Target Audience / Persona**: Homelab operators and archive maintainers checking active sync progress, scheduled cadence, and active filter scope at a glance.
- **Key Value**: Long console names and game release titles read naturally without premature truncation, active file transfers have full horizontal space for filenames and counters, and configuration summaries align cleanly with the 4-column KPI strip immediately below.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Standby State**:
   - The top zone displays a quiet status label (`Standby`) and phase headline (`Waiting for next scheduled run or manual trigger`).
   - Because no file is transferring, the active transfer strip remains collapsed so the panel stays compact and distraction-free.
   - Directly beneath a single hairline divider, the **4-Column Summary Strip** presents `Next Schedule`, `Incremental Cutoff` (with inline `Edit` control), `Type Filter` (with inline `Edit` link to Operations), and `Target Consoles` (with inline `Edit` link to Operations).
2. **Active Sync / Dry-Run State**:
   - The status label switches cleanly to `Sync Active · Run #3` (in phosphor) or `Dry Run Active · Run #3` (in amber), paired with active elapsed time and download counters.
   - The full-width headline renders the current crawl or download phase (e.g., `Full Sync · gameboy-color-roms (217/549): Title…`) across the full panel width instead of half a row.
   - When an archive stream opens, a full-width **Active Transfer Strip** unfolds between the headline and the 4-column summary strip, showing system/filename, file sequence if multi-file, bytes transferred/total, speed, percentage, and a crisp phosphor progress track (or smooth indeterminate sweep if `Content-Length` is absent).
3. **Inline Cutoff Editing**:
   - Clicking `Edit` inside the **Incremental Cutoff** column reveals the existing datetime picker and quick presets (`24h Ago`, `7d Ago`, `30d Ago`, `Now`, `Reset Default`) directly below the summary strip, keeping all controls accessible in place.

### Visual Identity & Spatial Rules

- **Typography & Anti-Shouting Discipline**:
  - Replaces uppercase `SYNC ACTIVE` / `DAEMON STANDBY` micro-text with natural title case (`Sync Active · Run #3`, `Dry Run Active · Run #3`, `Standby`) for calmer reading.
  - Preserves `Chakra Petch` (`--font-display`) for the primary phase headline, `DM Sans` (`--font-sans`) for column labels, and `IBM Plex Mono` with `tabular-nums` for run numbers, timestamps, byte counters, speeds, and console counts.
- **Single-Elevation & Alignment Rhythm**:
  - Eliminates the asymmetric vertical divider (`border-l`) and cramped `44px` right-hand box; uses horizontal hairline dividers (`border-t border-crt-border`) and a 4-column grid (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`) whose cadence mirrors the 4-column KPI strip directly below.
  - Zero pill enclosures, zero decorative dots, and no hue-only state signaling.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Remove Internal Pod ID from Top Activity Banner**
  - *Chosen Approach*: Omit `status.podId` from the Sync overview header altogether.
  - *Why*: Multi-replica pod names add long, visually noisy strings (`rgt-sync-retrogametalk-sync-0`) that force line wrapping without helping users operate a single-user mirror.
  - *Alternatives Considered*: Moving Pod ID to a subtle corner footer—still adds unnecessary cluster plumbing to the primary dashboard.

- **Decision 2: Unconditional Full-Width Summary Strip Over Inline Middle-Dot Chains**
  - *Chosen Approach*: Always render all four operational context cells (`Next Schedule`, `Incremental Cutoff`, `Type Filter`, `Target Consoles`) in a 4-column summary strip—explicitly showing `All release types` or `All consoles` when unfiltered.
  - *Why*: Keeps horizontal rhythm predictable across all filter states and pairs each value with its own label and inline action (`Edit`) rather than burying `Edit Cutoff` and `Edit Filters` inside wrapping text lines.
  - *Alternatives Considered*: Hiding `Type Filter` and `Consoles` unless filtered—causes inconsistent layout jumps and hides the quick navigation shortcut to Operations filters.

- **Decision 3: Conditional Full-Width Transfer Strip Above the Summary Strip**
  - *Chosen Approach*: Render the live transfer progress bar spanning 100% of the panel width between the phase headline and the 4-column summary strip whenever `activeTransfer` is present, supporting both determinate percentage fills and indeterminate sweeps when `totalBytes` is unknown.
  - *Why*: Gives long ROM filenames and byte/speed counters ample breathing room while keeping the standby panel trim when idle.
  - *Alternatives Considered*: Reserving a static empty box beside the headline—wastes nearly 40% of header width during crawls and standby, causing long game titles to clip prematurely.

---

## 4. Technical Architecture & Data Strategy

### Component Layout Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Sync Activity Panel (Single-Elevation Surface)                            │
│                                                                           │
│  Zone 1: Phase Header (Full Width)                                        │
│   • Status Line: Sync Active · Run #3  (or Dry Run Active / Standby)      │
│   • Headline:    Full Sync · gameboy-color-roms (217/549): Game Title…    │
│                                                                           │
│  Zone 2: Active File Transfer Strip (Full Width, shown while streaming)   │
│   • File:  <Download> systemName / filename                  bytes · B/s% │
│   • Track: [███████████████████░░░░░░░░░░░░░░░░░]  (determinate or sweep) │
│                                                                           │
│  Zone 3: 4-Column Operational Summary Strip                               │
│   ┌──────────────┬───────────────────┬─────────────────┬────────────────┐ │
│   │Next Schedule │Incremental Cutoff │Type Filter      │Target Consoles │ │
│   │Paused / Time │Timestamp · Edit   │Summary · Edit   │N selected ·Edit│ │
│   └──────────────┴───────────────────┴─────────────────┴────────────────┘ │
│                                                                           │
│  Zone 4: Inline Incremental Cutoff Editor (Collapsible on Edit)           │
└───────────────────────────────────────────────────────────────────────────┘
```

### State & Interaction Mapping

- **Status & Phase Display**: Reads `status.activeRun`, `status.currentPhase`, and `status.nextScheduledRunAt` from existing live SSE status updates with zero backend schema changes.
- **Active Transfer Strip**: Consumes `status.activeTransfer`, switching cleanly between determinate bar width (`bytesReceived / totalBytes`) and `.crt-progress-indeterminate` sweep when `totalBytes` is omitted.
- **Summary Strip Actions**:
  - *Incremental Cutoff `Edit`*: Toggles the inline datetime editor below Zone 3 (disabled while `status.activeRun` is running, preserving existing validation and `Reset Default` behavior).
  - *Type Filter & Target Consoles `Edit`*: Routes directly to the Operations tab (`onNavigateToOperations`) so users can adjust filter rules in one click.
