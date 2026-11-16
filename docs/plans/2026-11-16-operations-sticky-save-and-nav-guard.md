---
title: Dirty-Aware Sticky Save Bar & Unsaved Changes Guard
status: implemented
created_at: 2026-11-16T17:37:09Z
implemented_at: 2026-11-16T17:40:15Z
---

# Dirty-Aware Sticky Save Bar & Unsaved Changes Guard

Eliminate silent lost edits on the Operations page by introducing live dirty-state tracking across all configuration sections, a sticky bottom **Save / Discard** action bar that appears automatically from anywhere on the page whenever changes are pending, and a tab-switch confirmation prompt to **Save & Leave** or **Discard** before navigating away.

## User Review & Critical Decisions

- **Confirmed Decision 1 — Global Sticky Action Bar**: Replaced the buried bottom-only Save button with a unified sticky bottom action bar anchored to the bottom of the Operations viewport.
- **Confirmed Decision 2 — Dirty-Only Visibility**: Keeps Operations clutter-free when unmodified and reveals the sticky bar automatically when any editable field differs from saved configuration, listing changed sections alongside **Discard** and **Save Changes** actions (plus transient save confirmation and inline error display).
- **Confirmed Decision 3 — Tab-Switch Guard**: Prompts the user with an **Unsaved Operations Changes** modal offering **Save & Leave**, **Discard & Leave**, or **Keep Editing** whenever navigating away from Operations with pending edits.

## 1. Overview & Core Concept

- **What It Does**: Continuously compares working form values on Operations against normalized saved server configuration (respecting environment-variable locks) to detect unsaved edits in real time, keeps Save/Discard controls pinned in view regardless of scroll position, and protects against accidental tab-switch loss.
- **Key Value**: Ensures operators jumping to any Operations section (via Sync shortcuts or normal browsing) immediately see unsaved changes, can save without hunting at the bottom of the page, and cannot leave with unpersisted edits by mistake.
