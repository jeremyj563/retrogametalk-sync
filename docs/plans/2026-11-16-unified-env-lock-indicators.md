---
title: Unified Environment-Lock Indicators Across Operations & Schedule
status: implemented
created_at: 2026-11-16T17:58:22Z
implemented_at: 2026-11-16T18:00:30Z
---

# Unified Environment-Lock Indicators Across Operations & Schedule

Replace repetitive amber `"Loaded from <VAR> environment variable (read-only)."` paragraphs beneath form inputs with a quiet, right-aligned lock indicator (`Lock` icon + environment variable name) on field label rows and section scope headers across both Operations and Schedule.

## User Review & Critical Decisions

- **Confirmed Decision 1 — Placement**: Show environment-variable source indicators as compact, right-aligned markers on each field's label row (and alongside the Scope summary on section-level filters), keeping grid rows aligned and preserving useful helper captions beneath inputs.
- **Confirmed Decision 2 — Visual Tone**: Use quiet muted neutral typography with a subtle lock icon rather than bright amber warning text.
- **Confirmed Decision 3 — Cross-Page Consistency**: Applied across **Credentials & Local Mirror Path**, **Target Consoles & Systems**, **Allowed Game & ROM Types**, and **Schedule & Rate Limits** (covering all `envOverrides` fields reported by the backend).

## 1. Overview & Core Concept

- **What It Does**: Introduces a shared `EnvLockIndicator` inline label component rendering a 12px `Lock` icon + monospace environment variable name (`text-crt-muted`) with a read-only tooltip, unified across Operations and Schedule.
- **Key Value**: Eliminates noisy amber alert blocks under disabled fields, keeps multi-column input rows visually aligned, preserves mirror storage diagnostics under `Local Filesystem Mirror Root`, and honors all schedule and rate-limiter environment locks in the UI.
