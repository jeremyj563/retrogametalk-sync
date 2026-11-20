---
title: Simplified One-Click Full Sync Experience
status: implemented
created_at: 2026-11-20T03:55:06Z
implemented_at: 2026-11-20T03:57:00Z
---

# Simplified One-Click Full Sync Experience

Remove the complex header pre-flight drop-down drawer from Full Sync so running a Full Sync is a simple, foolproof one-click action that mirrors everything matching your Sync Rules while automatically keeping console indexes fresh behind the scenes.

## Approach

Streamline the top header sync workflow so `Incremental Sync`, `Full Sync`, and the independent `Dry Run` toggle all share the exact same direct, single-click interaction model. Clicking `Full Sync` immediately launches an Index-First Full Sync that automatically refreshes any stale or unindexed target consoles before mirroring all pending rule-matched releases—eliminating the secondary confirmation drawer, duplicate `Dry Run Full` button, manual refresh toggle, and legacy crawl link from the header. At the same time, retain the Monitor page's **Sync Rule Readiness** strip unchanged so users who want to glance at pending counts, estimated sizes, or jump straight into the Catalog still have clear visibility without cluttering the header action itself.

```
Before (2-step + noisy header drop-down)
[Full] + [Dry Run ☐] + [Full Sync] ──▶ Drops full-width drawer with Refresh toggle,
                                       Breakdown accordion, redundant "Dry Run Full",
                                       "Force Legacy Remote Crawl", Cancel, Start Full Mirror

After (Direct, foolproof 1-click header flow)
[Full] + [Dry Run ☐] + [Full Sync]    ──▶ Starts Index-First Full Sync immediately
                                          (auto-refreshes stale/unindexed consoles, then mirrors
                                           all releases matching your Sync Rules)

[Full] + [Dry Run ☑] + [Dry Run Full] ──▶ Runs Full Sync simulation immediately (0 bytes written)

Monitor Dashboard (unchanged)
┌────────────────────────────────────────────────────────────────────────────┐
│ Sync Rule Readiness · Pending count · Estimated size · [Queue] [Catalog →] │
└────────────────────────────────────────────────────────────────────────────┘
```

## Key Decisions

- **Remove the Full Sync header drop-down entirely**: Delete the sticky pre-flight confirmation banner, its collapsible breakdown accordion, the redundant `Dry Run Full` action, the `Refresh Stale/Unindexed` switch, the `Force Legacy Remote Crawl` link, and the Escape-key/armed-button state tied solely to that drawer.
- **Direct one-click start**: Clicking `Full Sync` immediately triggers the sync run—identical in simplicity to clicking `Incremental Sync` or `Dry Run`. The header `Dry Run` checkbox becomes the single, unambiguous way to toggle between live mirroring and simulation for both scopes.
- **Automatic index freshness behind the scenes**: Always pass automatic stale/unindexed console refreshing (`refreshStaleIndexes = true`) when launching a Full Sync so users never have to think about index age or manual toggles before syncing everything in their Sync Rules.
- **Preserve Monitor visibility**: Keep the Monitor page's **Sync Rule Readiness** strip and live preflight polling intact so users retain at-a-glance pending counts, estimated download size, index status, and quick links to the Catalog without turning the header button into a multi-step wizard.
- **Clear, updated tooltips**: Update the header `Full` scope and `Full Sync` button tooltips so they accurately explain that Full Sync refreshes any stale/unindexed consoles and mirrors every release matching your configured Sync Rules.
