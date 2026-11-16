---
title: Smooth Inline Accordion Transition for the Failed Queue Drawer
status: implemented
created_at: 2026-11-16T18:27:04Z
implemented_at: 2026-11-16T18:28:50Z
---

# Smooth Inline Accordion Transition for the Failed Queue Drawer

Upgrade the Sync page's inline Failed Queue drawer from an instant mount/unmount toggle into a smooth, balanced ~240ms accordion slide-open and slide-close animation that expands in place without shifting page scroll or introducing layout gap jumps.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All interaction and motion preferences were confirmed during discovery and govern this plan:
> - **Motion Style**: Smooth inline accordion expand and collapse directly beneath the Sync KPI strip.
> - **Animation Pacing**: Balanced and responsive (~240ms) with a smooth decelerating curve.
> - **Scroll Behavior**: Expand in place without forcing automatic page scroll changes.

---

### 1. Overview & Core Concept

- **What It Does**: Replaces the abrupt appearance and disappearance of the inline Failed Queue drawer on the Sync overview with a continuous vertical reveal and collapse animation.
- **Target User**: Operators reviewing or retrying failed archive transfers directly from the Sync dashboard.
- **Key Value**: Preserves spatial orientation below the KPI strip—telemetry charts and recent sync runs below the drawer glide downward and back upward smoothly instead of snapping, and content stays visible throughout the collapse rather than vanishing mid-motion.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Opening (`Review` click on the KPI failed counter)**: The Failed Queue container mounts in a collapsed (`0px`) track directly attached to the KPI group, then expands smoothly over `240ms` using a responsive settling curve (`cubic-bezier(0.16, 1, 0.3, 1)`), pushing the Telemetry Deck and Recent Runs section downward seamlessly while keeping the page scroll position untouched.
  2. **Closing (`Hide` toggle or drawer `Close` button)**: The drawer retains its rendered rows during the `240ms` collapse, smoothly drawing its bottom edge upward to `0px` (along with the `24px` inter-section breathing space) before unmounting cleanly once collapsed.
  3. **Detail Lightbox & Rapid Toggling**: Opening a game detail modal from inside the Failed Queue continues to float cleanly above the drawer (never clipped by the accordion's `overflow: hidden` during steady open state or portal-style fixed positioning). Toggling open/closed mid-animation cleanly reverses direction without stuck timers or stale states.

- **Visual Identity & Theme**:
  - Preserves the existing CRT hardware-console visual tokens (`--color-crt-surface`, `--color-crt-border`, phosphor/crimson semantic colors, tabular monospace counters, and single-elevation borders).
  - Eliminates the `space-y-6` double-margin artifact: the KPI strip and inline accordion share a unified section container so the `24px` top spacing above the drawer grows and shrinks strictly in lockstep with the accordion height.
  - Strictly honors `@media (prefers-reduced-motion: reduce)` by snapping open/closed immediately with zero delay when reduced motion is enabled.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: CSS Grid Row Track (`0fr` -> `1fr`) vs. Fixed `max-height` Hack**
  - *Chosen Approach*: Animate `grid-template-rows` from `0fr` to `1fr` around an `overflow: hidden; min-height: 0` inner wrapper.
  - *Why*: Unlike `max-height` approximations (which mis-time easing curves whenever actual queue height varies between empty states and 150-row lists), CSS Grid `0fr -> 1fr` interpolates against the true rendered height of the drawer regardless of item count or responsive viewport wrapping.
  - *Alternatives Considered*: Fixed `max-height` transitions (inaccurate timing and awkward tail pauses) or JavaScript `scrollHeight` measurement loops (brittle during async data loads when rows arrive).

- **Decision 2: Combined Spacing Wrapper Inside the Collapsing Track**
  - *Chosen Approach*: Group the 4-column KPI strip and the Failed Queue accordion inside one parent block in the Sync layout, placing the `24px` (`pt-6`) gap *inside* the collapsing accordion track.
  - *Why*: When closed, the accordion occupies `0px` height total, leaving an exact `24px` gap to the Telemetry Deck below; when opening, the gap and drawer border reveal together with zero layout snap.
  - *Alternatives Considered*: Leaving the accordion as a direct sibling inside `space-y-6`, which would either leave a permanent `48px` double-margin gap when closed or cause a jarring `24px` margin snap at the start/end of every toggle.

- **Decision 3: Two-Phase Unmount After Collapse Transition**
  - *Chosen Approach*: Maintain an internal `rendered` / `expanded` lifecycle state inside the drawer so closing sets `expanded = false`, disables pointer/keyboard interaction (`inert` + `aria-hidden`), runs the `240ms` collapse transition, and unmounts the drawer body once collapsed (with a fallback timer alongside `transitionend` in case reduced motion or interrupted transitions suppress events).
  - *Why*: Keeps the DOM and keyboard tab order completely clean when closed, prevents background item polling/focus leaks, and ensures the full queue content visibly slides shut rather than disappearing instantaneously.

---

### 4. Technical Architecture & Data Strategy

#### Component & Motion Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Sync Overview Layout (space-y-6)                                         │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Grouped KPI + Drawer Block (single space-y-6 child)                │  │
│  │                                                                    │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │ 4-Column KPI Strip  [ X failed · Review / Hide ]             │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                                    │  │
│  │  ┌─ Failed Queue Accordion Shell (grid-template-rows: 0fr ↔ 1fr) ┐ │  │
│  │  │  • 240ms cubic-bezier(0.16, 1, 0.3, 1) (0ms if reduced-motion)│ │  │
│  │  │  • Inner clip track: min-h-0, overflow-hidden, inert={!open}  │ │  │
│  │  │  ┌─ pt-6 Spacing + FailedQueueDrawer Card ──────────────────┐ │ │  │
│  │  │  │ Header · Filters · Retry Controls · Failed Rows Table    │ │ │  │
│  │  │  └──────────────────────────────────────────────────────────┘ │ │  │
│  │  └───────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │ Telemetry Deck                   │  │ Recent Synchronization Runs    │  │
│  │ (glides smoothly downward/upward)│  │ (no snap or double-gap jump) │  │
│  └──────────────────────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Lifecycle & State Mapping

- **Closed Steady State (`open = false`, `rendered = false`)**: Nothing inside the accordion is mounted; outer footprint is `0px`, keeping zero idle overhead and clean tab navigation.
- **Opening Transition (`open` flips `false -> true`)**:
  1. `rendered` becomes `true` and `expanded` starts `false` (`0fr`).
  2. Double `requestAnimationFrame` commits the initial `0fr` layout frame before flipping `expanded = true` (`1fr`), guaranteeing the browser reliably animates the open slide on mount.
  3. Data fetch (`/api/items?status=needs_retry...`) begins immediately on open while the `240ms` reveal runs in parallel.
- **Closing Transition (`open` flips `true -> false`)**:
  1. `expanded` immediately becomes `false` (`0fr`), `inert` prevents accidental clicks/tabbing inside the collapsing panel, and `confirmBulkDelete` resets.
  2. When the `240ms` transition finishes (via `transitionend` filtered to `grid-template-rows` on the shell element, guarded by a `280ms` safety timeout), `rendered` resets to `false` to unmount the drawer body cleanly.
  3. If `open` flips back to `true` mid-collapse, the pending unmount timeout is cleared and `expanded` flips immediately back to `true` (`1fr`) from its current mid-slide position.
- **Detail Modal Safety**: Because the fixed-position game detail modal renders as a sibling outside the clipped `overflow: hidden` inner track, inspecting an item never clips against the accordion wrapper.
