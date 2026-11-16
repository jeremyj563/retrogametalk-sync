---
title: Operations Section Deep-Linking & Spotlight Glow
status: implemented
created_at: 2026-11-16T17:21:58Z
implemented_at: 2026-11-16T17:23:30Z
---

# Operations Section Deep-Linking & Spotlight Glow

Enhance the Sync page shortcuts (`Edit` on Type Filter and Target Consoles, plus `Configure Credentials` and `Open Operations` on login alert banners) so clicking any shortcut switches to the Operations tab, smoothly scrolls the target configuration card into view below the sticky header, and highlights it with a soft CRT phosphor border glow that fades out cleanly.

## User Review & Critical Decisions

- **Confirmed Decision 1 — Spotlight Effect**: Use a soft CRT phosphor border glow that smoothly fades out after arriving at the target section, adapting automatically to the active Phosphor palette (Green, Amber, or Cyan) and honoring reduced-motion preferences.
- **Confirmed Decision 2 — Scroll Behavior**: Smoothly scroll the target section into view framed cleanly below the sticky top header bar (respecting `prefers-reduced-motion` with instant positioning when reduced motion is enabled).
- **Confirmed Decision 3 — Shortcut Coverage**: Apply deep-link scrolling and spotlighting to **Type Filter → Edit**, **Target Consoles → Edit**, and both Sync page login alert buttons (**Configure Credentials** and **Open Operations** → Authentication & Credentials section).

## 1. Overview & Core Concept

- **What It Does**: Converts coarse tab-level navigation shortcuts on the Sync overview into precision section deep links that land the user directly on the exact Operations configuration panel they intend to edit, accented by a temporary visual arrival glow.
- **Target Audience / Persona**: Operators adjusting console scope, ROM/release type filters, or repository credentials from the Sync status view.
- **Key Value**: Eliminates manual scrolling and hunting across the multi-section Operations page, creating a clear cause-and-effect bridge between Sync summary readouts and their underlying controls.

## 2. User Experience & Visual Design

### Key User Flows

1. **Filtering Shortcuts (Type Filter & Target Consoles)**:
   - On the Sync tab, the user clicks **Edit** next to `Type Filter` or `Target Consoles` inside the operational summary strip.
   - The app switches to the **Operations** tab, measures and clears the sticky header height, and smoothly scrolls the **Allowed Game & ROM Types** or **Target Consoles & Systems** card into view.
   - Upon arrival, a soft phosphor border glow illuminates the outer perimeter of the targeted section and gently fades out over ~2.2 seconds.
2. **Credential & Auth Alert Shortcuts**:
   - When repository credentials are unconfigured or unverified, clicking **Configure Credentials** or **Open Operations** in the Sync alert banner switches to **Operations**, frames the **Repository Credentials & Local Mirror Path** card below the sticky header, and applies the same fading phosphor spotlight.
3. **Repeated Shortcut Triggers**:
   - Clicking a shortcut multiple times generates a fresh navigation request token so scrolling and the fade-out glow replay reliably every time, while standard sidebar or brand navigation clears any pending spotlight state.

### Visual Identity & Theme

- Reuses `--color-crt-phosphor` so the spotlight glow matches the active CRT Display Studio palette (Green, Amber, or Cyan).
- Uses a compositor-friendly `opacity` keyframe animation on a non-interactive border/glow layer (`pointer-events: none`), respecting `@media (prefers-reduced-motion: reduce)`.
