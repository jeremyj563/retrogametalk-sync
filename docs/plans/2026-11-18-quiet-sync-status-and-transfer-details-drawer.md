---
title: Quiet Sync Status & Collapsed-by-Default Transfer Details
status: implemented
created_at: 2026-11-18T18:49:21Z
implemented_at: 2026-11-18T19:02:00Z
---

# Quiet Sync Status & Collapsed-by-Default Transfer Details

This update quiets the Sync Status & Transfer Telemetry panel so users see one steady, calm readout—**`Syncing [Game Title]`**—from release warm-up through download completion with zero layout jitter, a single minimal Combined progress bar by default, and an optional collapsed-by-default drawer for raw filenames, worker/chunk telemetry, and individual parallel worker bars.

## User Review & Critical Decisions

> [!IMPORTANT]
> All core UX decisions were confirmed during clarification and govern this implementation:
> - **Status Label Across Warm-Up & Download**: **Steady `Syncing` label from start to finish** — eliminates jarring transitions (`Inspecting` → `Preparing` → `Downloading`) while keeping the active catalog game title visually highlighted in the CRT phosphor frame across every phase of a game's sync lifecycle.
> - **Compact Progress Bar Row**: **Combined bar with %, size/speed, and Details toggle** — defaults to one calm, fixed-height Combined progress bar showing overall completion percentage, aggregated bytes / total bytes, transfer rate, and an inline `Details` toggle button.
> - **Details Drawer Initial State**: **Start collapsed every visit, expand on click** — raw archive filenames (`system / archive.zip`), worker/chunk/part specs, and individual per-file progress bars remain tucked inside an expandable accordion drawer that starts closed on every page visit.

## Key Implementation Notes

- Extended `ActiveTransferState` with `itemTitle` populated cleanly from catalog/WP release metadata across sync, queue, and retry flows (`orchestrator.ts`) so Tier 2 always foregrounds the game title across warm-up, parallel transfers, and inter-file handoffs.
- Unified per-game status phase parsing (`syncStatusPhase.ts`) around a steady `Syncing` action prefix while retaining distinct global verbs (`Standby`, `Initializing`, `Authenticating`, `Enumerating`, `Checking`, `Scanning`, `Stopping`).
- Replaced sticky `localStorage` Per-File/Combined progress toggles in `OverviewPanel.tsx` with a single aggregated Combined progress row and an ephemeral collapsed-by-default `.crt-accordion-grid` Details drawer (`sync-transfer-details-drawer`) containing `system / filename.zip`, worker/chunk/part specs, and per-file parallel bars.
