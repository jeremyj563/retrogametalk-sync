---
title: Live Mid-Run Sync Rule Hot-Reloading
status: implemented
created_at: 2026-11-20T04:42:18Z
implemented_at: 2026-11-20T04:50:00Z
---

# Live Mid-Run Sync Rule Hot-Reloading

Make changes to **Target Consoles** and **Allowed Release Types** in Sync Rules take effect immediately on an active **Full Sync** or **Incremental Sync**—finishing the current file cleanly, skipping newly excluded items right away, and dynamically indexing and mirroring newly added consoles or release types before the run completes.

## Approach

Replace the startup-only configuration snapshot inside active sync runs with a revision-tracked **Live Sync Rule Tracker**. Whenever the user saves updated Sync Rules while a Full or Incremental Sync is running, the backend bumps a rule revision counter, logs the live reload directly into the active run's Activity Log, and signals the Sync Rules UI that the changes were applied live. Between every file transfer, release inspection, and console scan, the active run checks for a newer rule revision and converges cleanly: in-flight downloads finish intact, newly excluded consoles or release types are skipped immediately, and newly added consoles or release types are auto-refreshed and appended to the live queue before the run finishes—all without affecting manual Catalog download queues or deleting already-downloaded files on disk.

```
User edits Sync Rules & clicks Save while Sync #42 is running
  │
  ▼
Configuration Saved (SQLite) ──► Bumps Live Rule Revision + Logs reload to Run #42
  │                                  │
  │                                  ▼
  │                         Sync Rules UI shows:
  │                         "Saved — applied live to active Full Sync #42"
  │
  ▼
Active Sync #42 Loop (checked before every console, release & file)
  ├─ Current file in flight?  ──► Finishes download & disk verification cleanly
  ├─ Console/Type REMOVED?    ──► Skips remaining excluded consoles, releases & files immediately
  ├─ Console ADDED?           ──► Auto-refreshes index/delta for new console + expands live queue
  ├─ Release Type ADDED?      ──► Re-evaluates catalog/delta matches (incl. earlier type-skipped items)
  └─ Manual Catalog Queue?    ──► Completely untouched (only Full & Incremental Syncs reload)
```

## Key Decisions

- **Graceful transfer boundary**: Never abort an active HTTP file stream on a rule edit; let the currently downloading file finish cleanly so partial files aren't wasted, then immediately enforce the updated rules before the next file, next release, or next console.
- **Full dynamic expansion for additions**: When new consoles are added mid-run, automatically run index/delta refresh for those newly added consoles and append their pending rule-matched releases to the active queue. When allowed release types are widened mid-run, re-evaluate catalog matches (including releases skipped earlier in the same run under the stricter type filter) so newly enabled categories are mirrored before the run completes.
- **Strict scope isolation for manual queues and existing ROMs**: Apply live Sync Rule reloading exclusively to **Full Sync** and **Incremental Sync** runs (`manual` and `scheduled`). Explicitly queued manual **Catalog** downloads and **Retry** runs continue untouched, and files already downloaded to disk are never deleted when rules are narrowed.
- **Consistent convergence across both Full and Incremental Sync**: Use the same revision-checked live rule helper in both Index-First Full Sync (Phase 1 console refresh + Phase 2 catalog mirroring) and Incremental Sync (per-console delta scan + release/file filtering), including Dry Run simulations.
- **Clear two-place feedback**: Display an immediate phosphor confirmation in **Sync Rules** indicating the changes applied live to the active run (plus a subtle editing hint while a sync is running), alongside a timestamped Activity Log entry detailing added/removed consoles and release-type updates so operators see the handoff in **Monitor** too.
- **Accurate final run summary & counters**: Record the final active rule scope label in the run's structured summary and update live phase counters cleanly as the dynamic queue grows or shrinks.

## Flows & Capabilities

- **Removing a Console or Release Type Mid-Sync**:
  - User removes a console (e.g. unchecks `psx`) or disables a release type (e.g. unchecks `Translations`) and clicks Save while a Full or Incremental Sync is running.
  - The current file finishes downloading normally. Immediately afterward, any remaining files or releases belonging to the removed console or disabled release type are skipped without issuing further download requests.
  - An Activity Log entry notes the live rule update and any mid-run skipped releases; already-downloaded files remain safely on disk.
- **Adding a Console or Release Type Mid-Sync**:
  - User adds a new console (e.g. checks `snes`) or widens allowed release types (e.g. enables `Hacks`) and clicks Save during an active sync.
  - The active run detects the rule revision bump, refreshes the newly added console's index/delta automatically if needed, queries newly matching releases from SQLite (or delta posts for Incremental Sync), and appends them into the live mirror queue before finishing the run.
  - If a release had been skipped earlier in the same run due to the previous stricter type filter, widening the filter clears its temporary type-skip guard so it is mirrored within the same run.
- **Editing Sync Rules During Manual Catalog Downloads**:
  - If the user queued specific games directly from the Catalog, changing Sync Rules persists cleanly for future syncs without canceling or filtering the manual download queue, and shows the standard saved confirmation without claiming the manual queue was modified.
- **UI Feedback in Sync Rules & Monitor**:
  - While an active Full or Incremental Sync is running and the user has unsaved Sync Rule edits, the sticky Save bar shows a quiet live-reload hint (*"Active sync running — saved rule changes will apply live after the current file"*).
  - After saving, Sync Rules displays *"Sync Rules saved — applied live to active Full/Incremental Sync #N"*, Monitor's live Activity Log records the exact scope diff, and Monitor's Sync Rule Readiness counts refresh immediately.

## Verification Plan

- Add unit tests for the live rule diff and convergence helper covering console additions, console removals, release-type narrowing, release-type widening (re-enabling previously type-skipped items), alias normalization, and isolation from manual download queues.
- Verify Full Sync, Incremental Sync, and Dry Run execution paths cleanly reload rules mid-run without duplicate downloads, infinite loops, or race conditions.
- Verify TypeScript typechecking, linting, unit tests, and production bundle compilation pass with zero errors.
