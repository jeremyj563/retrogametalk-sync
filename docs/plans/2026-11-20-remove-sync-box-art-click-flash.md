---
title: Eliminate Monitor Sync Box-Art Click Flash
status: implemented
created_at: 2026-11-20T17:57:22Z
implemented_at: 2026-11-20T17:59:00Z
---

# Eliminate Monitor Sync Box-Art Click Flash

Remove the jarring dark overlay and spinner flash over the Monitor Sync Hero Showcase box-art thumbnail when opening the Game Detail Drawer, keeping the artwork completely untouched on click while gating the inline title `Opening…` cue behind a 250ms slow-request threshold.

## User Review & Critical Decisions

> [!IMPORTANT]
> Both interaction decisions below were confirmed during clarification and govern this fix.

- **Confirmed Decision 1 — Box-Art Thumbnail Behavior**: Never cover the box-art thumbnail with a dark scrim, spinner, or reload indicator on click; keep the artwork (and its empty-state CRT frame) completely untouched.
- **Confirmed Decision 2 — Inline Title Cue Threshold**: Only reveal the inline `Opening…` spinner next to the game title if the item detail request takes longer than **250ms**, so fast local lookups open the drawer cleanly with zero visual flicker.

---

## 1. Overview & Core Concept

- **What It Does**: Eliminates the split-second "reload screen" flash over the Monitor Sync box-art thumbnail when inspecting the currently syncing game, and suppresses transient loading-state flicker on the adjacent title cue during normal fast local database reads.
- **Target Audience / Persona**: RetroGameTalk Sync operators monitoring live sync runs who click the active game's box art or title to inspect release details, screenshots, and file progress.
- **Key Value**: Makes inspecting the active game feel instantaneous and polished—matching the native responsiveness of a local SQLite-backed console dashboard—while still preserving gentle feedback if a busy or remote backend ever stalls past 250ms.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Hover & Focus**: Hovering or focusing either the adaptive box-art frame or the unboxed game title highlights both in unison (subtle accent frame rim + title accent color + inline `Inspect ↗` cue).
  2. **Normal Click (< 250ms local SQLite lookup)**: Clicking the box art or title triggers the detail fetch silently in the background. Neither the box art nor the title flickers, dims, disables, or flashes a spinner—the Game Detail Drawer slides open directly.
  3. **Slow Click (≥ 250ms stalled or remote lookup)**: If the lookup is still pending after 250ms, the inline `Inspect ↗` cue beside the title transitions calmly to a small spinner + `Opening…` label (with `aria-busy="true"`). The box-art thumbnail itself remains 100% crisp and uncovered.
  4. **Completion or Cancellation**: As soon as the detail payload resolves or the user dismisses the drawer, the pending timer is cleared and the inline cue returns seamlessly to its resting state.
- **Visual Identity & Theme**:
  - Preserves the existing Monitor Sync Hero Showcase aesthetic—recessed CRT box-art bezel (`--color-crt-bg`, `--color-crt-border-strong`), unboxed display typography (`--color-crt-text`), and mode-aware phosphor/amber accents (`--color-crt-phosphor` for Live Sync, `--color-crt-amber` for Dry Run).
  - Removes the translucent dark scrim (`bg-crt-bg/65`) and spinning reload icon previously layered above the box art and placeholder emblem.
- **Interactive Feedback & Motion**:
  - Removes immediate `disabled` attribute toggling on click so buttons never lose focus, drop hover highlight, or flash a `cursor-wait` state during sub-30ms local requests.
  - Prevents duplicate concurrent requests for the same release via an in-flight guard, keeping interactions crisp without visual disruption.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Remove Loading Overlay Completely from Box-Art Thumbnail**
  - *Chosen Approach*: Strip all loading-state overlay markup and loading props from the Hero Showcase cover component so the artwork can never be occluded by a scrim or spinner.
  - *Why*: Box art is the visual anchor of the Hero Showcase. Flashing a dark overlay over it for 10–30ms feels like a broken image reload rather than drawer navigation.
  - *Alternatives Considered*: Delaying the thumbnail overlay by 250ms was skipped because the user explicitly prefers the artwork to remain untouched at all times, with any slow-request feedback confined to the inline title cue.
- **Decision 2: 250ms Debounced Inline Title Cue Instead of Immediate Spinner**
  - *Chosen Approach*: Keep an immediate in-flight ref guard for deduplication, but defer visible `Opening…` UI state behind a 250ms timer (cleaned up on completion, close, or unmount).
  - *Why*: Local SQLite item lookups normally finish in 5–30ms—far below the human perception threshold where a spinner helps, yet long enough to register as an ugly flicker. A 250ms grace window eliminates 99% of visual noise while still informing the user on genuine latency.
  - *Alternatives Considered*: Removing loading feedback entirely was passed over so users on slow remote reverse proxies or heavily loaded NAS storage still get clear feedback if a click genuinely takes noticeable time.
- **Decision 3: Non-Disabling Click Guard**
  - *Chosen Approach*: Deduplicate repeated clicks on the same in-flight item ID in the handler rather than toggling the HTML `disabled` attribute on the thumbnail and title buttons.
  - *Why*: Toggling `disabled` for ~15ms forcibly blurs the button, breaks coordinated hover/focus highlights (`heroInspectHover`), and briefly flips the cursor to `wait`.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Interaction & State Flow Diagram**:

```text
  User clicks Box Art OR Title (itemId)
                   │
                   ▼
  ┌───────────────────────────────────────────────┐
  │ Detail Inspect Controller (Overview Panel)    │
  │  • Guard: ignore if same itemId is in-flight  │
  │  • Bump request sequence counter              │
  │  • Start 250ms slow-request timer             │
  │  • Fetch item detail payload                  │
  └──────────┬─────────────────────────┬──────────┘
             │                         │
   Resolves < 250ms            Still pending ≥ 250ms
             │                         │
             ▼                         ▼
  ┌─────────────────────┐   ┌─────────────────────────────────┐
  │ Cancel 250ms timer  │   │ Set slowLoadingDetailId         │
  │ Open Detail Drawer  │   │  • Box Art: untouched (no veil) │
  │ (Zero UI flash!)    │   │  • Title Cue: "Opening…" + spin │
  └─────────────────────┘   └───────────────┬─────────────────┘
                                            │
                                   Resolves / Closes
                                            │
                                            ▼
                            ┌─────────────────────────────────┐
                            │ Clear timer & slowLoadingDetail │
                            │ Open / settle Detail Drawer     │
                            └─────────────────────────────────┘
```

- **Data Model & State**:
  - Replace immediate `loadingDetailId` visual state with:
    - An in-flight reference tracking the currently fetching `itemId` (for silent double-click deduplication without re-rendering).
    - A timer reference managing the 250ms delay threshold, cleared on completion, drawer dismissal, and component unmount.
    - A `slowLoadingDetailId` React state that is only populated if the request crosses the 250ms threshold.
  - Expose the 250ms threshold constant cleanly alongside sync status utilities so timing behavior can be verified in unit tests.
- **Interactive Component & State Mapping**:
  - **Box-Art Thumbnail Component**: Drops the `loadingDetail` prop, the dark overlay scrim, the placeholder spinner swap, and button `disabled` toggling. Remains clickable, hover-linked, and visually steady across every click.
  - **Hero Title Inspect Button**: Sets `aria-busy` and swaps `Inspect ↗` → `Opening…` only when `slowLoadingDetailId === activeSyncTargetCover.itemId`.
  - **Verification & Release Hygiene**: Add unit test assertions covering the slow-loading delay threshold and verify clean compilation, type-checking, and existing test suites alongside a lockstep patch version bump (`1.21.9`) and archived plan record upon execution.
