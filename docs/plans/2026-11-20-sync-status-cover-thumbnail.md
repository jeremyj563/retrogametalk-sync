---
title: Sync Status Bar Cover Thumbnail & Quick-Inspect
status: implemented
created_at: 2026-11-20T13:52:28Z
implemented_at: 2026-11-20T14:15:00Z
---

# Sync Status Bar Cover Thumbnail & Quick-Inspect

Add a compact square game cover thumbnail inline beside the active game title in the main **Monitor** sync status bar while a release is warming up, syncing, or downloading—complete with a sleek CRT placeholder frame while artwork loads and one-click access to open the full **Game Detail Drawer**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core UX and visual decisions were confirmed during clarification and are locked into this plan:

- **Confirmed Decision 1 — Size & Placement**: **Compact square icon inline with the title** (`36px–40px` square frame aligned vertically with the highlighted Tier 2 game title frame) so the status bar keeps its tight, single-bar vertical rhythm without expanding the Monitor hero height.
- **Confirmed Decision 2 — Click Interaction**: **Open the Game Detail Drawer for that release** directly from the Monitor view (supporting clicking the thumbnail—and optionally the adjacent title frame—whenever a catalog item ID is known), reusing the existing detail drawer with live transfer progress and release actions.
- **Confirmed Decision 3 — Missing / Loading Cover Behavior**: **Show a sleek CRT placeholder frame until artwork loads**, preserving fixed square dimensions (zero layout shift) and gracefully falling back to the CRT cartridge/phosphor monogram frame if a release has no cover artwork upstream.

---

## 1. Overview & Core Concept

- **What It Does**: Whenever a Full Sync, Incremental Sync, Retry run, or manual Download Queue is actively operating on a specific game release, the Monitor's primary status bar displays a crisp, recessed square cover thumbnail immediately to the left of the highlighted game title. Clicking the cover (or title) fetches the latest release record and opens the **Game Detail Drawer** right over Monitor without navigating away from live telemetry.
- **Target Audience / Persona**: RetroGameTalk Sync operators watching live sync runs, queue progress, or retry waves who want instant visual recognition of the game currently being processed and one-click access to inspect its metadata, file list, screenshots, or local archive contents.
- **Key Value**: Gives the Monitor hero immediate visual identity during active transfers—turning plain text titles into recognizable box art at a glance while keeping the status bar compact, steady, and actionable.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Idle / Standby & Non-Game Phases**:
   - When the runner is in **Standby**, **Authenticating**, **Enumerating**, **Checking**, or **Stopping** (not operating on a specific game), no thumbnail slot is rendered—the status bar remains cleanly focused on global phase status.
2. **Release Warm-Up → Active Download → Inter-File Handoff**:
   - The moment the orchestrator begins operating on a catalog release (even during pre-download link resolution and metadata warm-up, before binary transfer bytes arrive), the inline square thumbnail slot appears immediately beside the highlighted title frame.
   - While the cover image is loading or being lazily fetched from the server, a sleek dark recessed **CRT placeholder frame** (matching the exact square geometry, subtle hairline border, scanline sheen, and crisp monochrome game-cartridge glyph) holds the slot with zero layout jitter.
   - As soon as the cover image resolves, it cross-fades cleanly into the square frame (`opacity` transition <= 200ms, respecting reduced-motion settings).
   - Across multi-file releases and inter-file handoffs for the same game, the thumbnail stays pinned and steady without flickering back to a placeholder.
   - Switching to the next game smoothly swaps to the new release's cover (resetting load/error state cleanly per release ID).
   - If a release has no upstream cover art or the cover fetch fails (HTTP 404), the slot gracefully remains on the sleek CRT placeholder frame—never displaying a broken image icon.
3. **Click-to-Inspect Flow**:
   - Hovering the thumbnail highlights its hairline border in the active CRT phosphor accent (or amber during Dry Runs) with a subtle cursor affordance and tooltip (`Inspect "<Game Title>" details`).
   - Clicking the thumbnail opens the **Game Detail Drawer** populated with that release's live metadata, files, screenshots, and active transfer bar. If a brief fetch is needed, the button shows a subtle non-jarring busy state until the drawer slides open.
   - Closing the drawer returns seamlessly to Monitor with uninterrupted live SSE telemetry.

### Visual Identity & Theme

- **Aesthetic Direction**: Hardware-inspired CRT phosphor monitoring console—restrained, single-elevation dark surfaces with crisp 1px borders and zero decorative pill clutter.
- **Color Palette & Tokens**:
  - Uses existing CRT theme tokens (`bg-crt-bg`, `bg-crt-surface`, `border-crt-border`, `text-crt-phosphor` for live syncs, `text-crt-amber` for Dry Runs, `text-crt-muted` for idle/placeholder iconography).
  - Active accent highlights apply strictly on focus/hover states and the live target highlight—never garish glowing orbs or static status dots.
- **Typography & Spatial Math**:
  - Preserves existing display (`font-display`) and tabular monospace (`font-mono tabular-nums`) pairings.
  - Compact square thumbnail (`h-10 w-10` on desktop, `h-9 w-9` on narrow screens, matching the Tier 2 title frame height and `rounded` nested corner radius) aligned via `items-center gap-2.5` with `shrink-0` so long titles truncate cleanly without squishing the square artwork.
  - Accessible hit area (>= 40px interactive button target on desktop, keyboard `focus-visible` phosphor ring, descriptive `aria-label`, `referrerPolicy="no-referrer"`, and meaningful `alt` text).
- **Interactive Feedback & Motion**:
  - Image reveal uses compositor-only `opacity` fade (`150ms cubic-bezier(0.16, 1, 0.3, 1)`), disabled when reduced motion is enabled.
  - Zero layout shifts: fixed outer square dimensions prevent any vertical or horizontal bounce when images arrive or fail.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Expose Lightweight Active Target Context on Status Snapshots**
  - *Chosen Approach*: Attach a lightweight `activeSyncItem` summary (`itemId`, `title`, `systemName`, `hasCover`) to live status snapshots and transfer state so the Monitor knows the exact catalog release ID and cover availability during **both** release warm-up and active transfer (not only while bytes are actively streaming).
  - *Why*: Previously, `activeTransfer` only existed while a binary file stream was open and dropped to `null` during warm-up and inter-file handoffs. Tracking `activeSyncItem` across the release lifecycle guarantees the cover thumbnail appears immediately, stays rock-steady between multi-file downloads, and works even during Dry Runs.
  - *Alternatives Considered*: Only reading `activeTransfer.itemId` — rejected because the thumbnail would pop in late and disappear during warm-up, Dry Runs, and between files of a multi-file release.

- **Decision 2 — Reuse On-Demand Local Cover Caching (`lazy=1`)**
  - *Chosen Approach*: Load the thumbnail directly from the existing server cover asset endpoint with lazy caching enabled (`kind=cover&lazy=1`), appending a lightweight cache-bust token if local cover metadata updates mid-run.
  - *Why*: Covers already cached locally serve instantaneously from disk with zero external requests; uncached covers from Index-First catalog records are fetched and cached locally on demand without blocking or slowing down the ROM download pipeline.
  - *Alternatives Considered*: Blocking downloads until artwork downloads finish — rejected because it would throttle sync throughput.

- **Decision 3 — Mount the Shared Game Detail Drawer Directly in Monitor**
  - *Chosen Approach*: Mount the existing reusable **Game Detail Drawer** inside the Monitor workspace (matching the pattern already used by Catalog and the Failed Queue drawer) rather than navigating the user away to the Catalog tab.
  - *Why*: Keeps operators on Monitor so they can inspect the currently syncing game's files, description, or screenshots and immediately close the drawer back to the live speed wave and activity log without losing context.
  - *Alternatives Considered*: Navigating to Catalog and filtering to the game — rejected because it interrupts live Monitor observation.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Flow

```text
┌──────────────────────────────────────────────────────────────────────┐
│                      Sync Orchestrator (Backend)                     │
│  • Sets activeSyncItem { itemId, title, systemName, hasCover }       │
│    during warm-up, active transfer, retry, queue & handoff           │
│  • Includes itemId + hasCover on ActiveTransferState snapshots       │
│  • Clears activeSyncItem when run returns to Idle / non-game phase   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ SSE Status & Transfer Events
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Monitor Status Bar (Frontend)                       │
│  • Resolves active target itemId (activeTransfer -> activeSyncItem   │
│    -> held post-run target during brief settle window)               │
│  • Renders Tier 2 row:                                               │
│      [ Compact 40×40 Square Cover Button ]  [ Highlighted Title ]    │
│           │                                                          │
│           ├─ Cover Ready: <img src="/api/items/:id/asset?            │
│           │              kind=cover&lazy=1" /> (opacity fade-in)     │
│           └─ Loading / Missing / 404: Sleek CRT Placeholder Frame    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ onClick (itemId)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Express API  +  Shared Game Detail Drawer               │
│  • GET /api/items/:id  ──► Hydrates full RepositoryItemRecord        │
│  • Opens GameDetailDrawer over Monitor with live activeTransfer,     │
│    retry, queue, archive inspection, and delete handlers wired       │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Backend Status Extension**:
  - `ActiveSyncItemSummary`: `{ itemId: number; title: string; systemName: string; hasCover: boolean }` exposed as `activeSyncItem?: ActiveSyncItemSummary | null` on `ServiceStatusSnapshot` (mirroring both server and client shared type definitions).
  - `ActiveTransferState` gains an optional `hasCover?: boolean` hint alongside its existing `itemId`.
- **Frontend Thumbnail & Drawer State**:
  - Per-URL image status (`loaded` / `error`) derived cleanly against `target.coverUrl`, resetting automatically whenever the syncing release changes so stale covers never bleed onto the next game.
  - Local Monitor drawer state (`activeDetailItem: RepositoryItemRecord | null`, `loadingDetailId: number | null`) synchronized with live `catalogRevision` refreshes so file progress and status badges update while the drawer is open.

### Verification Plan

- Add/extend unit tests covering `resolveActiveSyncTargetCover` across warm-up, active transfer, multi-file handoff, Dry Run, non-game phases, and Standby.
- Verify production build compilation (`compile_applet`) and TypeScript checks (`lint_applet`), plus lockstep minor version bump (`1.20.4` → `1.21.0`) and archival of the approved plan per repository conventions.
