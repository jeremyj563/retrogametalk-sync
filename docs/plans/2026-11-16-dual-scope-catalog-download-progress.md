---
title: Dual-Scope Realtime Catalog Download Progress
status: implemented
created_at: 2026-11-16T16:45:10Z
implemented_at: 2026-11-16T16:47:45Z
---

# Dual-Scope Realtime Catalog Download Progress

Separate current-file download progress from overall Catalog item progress so multi-file releases display two genuinely distinct progress bars—**Current File** and **Overall Catalog Item**—while single-file releases render a single, non-redundant progress bar.

## User Review & Critical Decisions

> [!IMPORTANT] All placement, visibility, and calculation rules below were confirmed during clarification and govern this update.

- **Confirmed — Grid Card Bar Assignment**:
  - **Cover Artwork Overlay** tracks the **Current File** being downloaded (active filename, `File X/Y` position, file progress bar, bytes transferred / total bytes, speed, and file `%`).
  - **Card Footer** tracks the **Overall Catalog Item** progress (completed files count, overall `%`, and overall progress bar).
- **Confirmed — Single-File vs. Multi-File Behavior**: Only render the **Overall Catalog Item** progress bar when a release contains **multiple files** (`totalFiles > 1`). Single-file releases display only the Current File progress bar (with a clean, bar-free status summary in the Grid card footer) so two bars never mirror identical percentages.
- **Confirmed — Overall Progress Formula**: Compute overall item completion as `(completedFiles + currentFileFraction) / totalFiles` so overall progress advances smoothly in real time during each file stream without requiring unknown upcoming file sizes ahead of time.

---

## 1. Overview & Core Concept

- **What It Does**: Eliminates redundant twin progress bars by giving each progress indicator a clear, distinct meaning. When downloading a multi-disc ISO set or multi-archive release, users see both immediate per-file transfer telemetry and steady release-wide completion across the Box-Art Grid, Catalog Table, and Game Detail Drawer.
- **Target Audience / Persona**: Homelab operators and archive collectors monitoring multi-part releases (e.g., multi-disc PlayStation/Saturn/Dreamcast sets or ROM + patch bundles) directly inside the Catalog view.
- **Key Value**: Users immediately know both how fast the current archive is streaming and how far along the entire game release is (`e.g., 1 of 3 files done · 50% overall`).

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Single-File Release (`1 file`)**:
   - **Box-Art Grid Card**: Cover bottom scrim displays the single **Current File** progress bar (`filename`, `bytes / total`, `speed`, `%`). The card footer displays clean unboxed text telemetry (`Downloading · 65%` and `18.4 MB/s`) with **no duplicate second bar**.
   - **Catalog Table Row**: `Status` cell shows a single **Current File** progress bar with percentage, speed, and byte counters.
   - **Game Detail Drawer**: Header strip and the single file row show **Current File** progress without an extra overall bar.
2. **Multi-File Release (`2+ files`, e.g. 3 discs)**:
   - **Box-Art Grid Card**:
     - **Cover Overlay (Current File)**: Anchored in the dark contrast scrim (`>= 4.5:1`), clearly labeled `File 2/3` alongside the active filename, with its own phosphor progress bar (`50%`), `bytes / total`, and speed (`18.4 MB/s`).
     - **Card Footer (Overall Item)**: Hairline-separated footer clearly labeled `Overall · 1/3 files` + `50%`, with a distinct overall progress bar tracking release-wide completion (`((1 + 0.50) / 3) = 50%`).
   - **Catalog Table Row**:
     - `Status` cell cleanly pairs both scopes in a compact fixed-width stack:
       - Top block: **Current File** (`File 2/3 · 50% · 18.4 MB/s`, file bar, `bytes / total`).
       - Bottom block: **Overall Item** (`Overall · 1/3 files · 50%`, slim secondary track).
   - **Game Detail Drawer**:
     - Top live transfer banner below the drawer header displays **Overall Release Progress** (`Overall Catalog Item · 1 of 3 files complete · 50%`) above **Active File Transfer** (`Current File: filename · bytes · speed · 50%`), while the matching row inside **Included Downloads** displays its live per-file progress bar.
3. **Unknown File Size or Connecting Phase**:
   - When the active file lacks `Content-Length` (`totalBytes === null`) or is still connecting (`Preparing`), the **Current File** bar displays an animated sweep (`crt-progress-indeterminate`) while `currentFileFraction` remains `0`, so **Overall Item** progress cleanly holds at `completedFiles / totalFiles` until determinate byte progress or file completion advances it.

### Visual Identity & Differentiation Rules

- **Clear Label Hierarchy**: Both bars use explicit plain-language labels (`File X/Y` / `Current File` vs. `Overall` / `Overall Catalog Item`) so users never have to guess which bar represents which scope.
- **Visual Weight & Color Tokens**:
  - **Current File** bar uses bright `--color-crt-phosphor` (or `--color-crt-amber` while preparing) to emphasize live active streaming.
  - **Overall Item** bar uses subtle phosphor-dim differentiation (`bg-crt-phosphor/80`) and explicit `X/Y files` + `%` tabular counters (`font-mono tabular-nums`) so the two bars are visually distinct at a glance across Green, Amber, and Cyan themes.
- **Zero-Pill & Single-Elevation Discipline**: Preserves flat hairline dividers (`border-crt-border`), zero nested cards, no decorative status dots, and `prefers-reduced-motion` safety.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: File-Count-Plus-Fraction Formula (`(completedFiles + currentFileFraction) / totalFiles`)**
  - *Chosen Approach*: Weight each file equally and add the active file's live determinate ratio (`bytesReceived / totalBytes`, clamped `0..1`) onto `completedFiles`.
  - *Why*: RetroGameTalk does not expose total archive sizes for upcoming queued files until each individual HTTP download begins; weighting by file count + active file fraction ensures continuous, smooth forward motion from `0%` to `100%` without sudden backwards jumps when later files reveal larger or smaller sizes.
  - *Alternatives Considered*: Byte-weighted progress across all files—impossible accurately on first discovery because queued file sizes are `0` until fetched.

- **Decision 2: Authoritative Item Totals Carried in Live Transfer State (No Speculative Pre-Queued DB Rows)**
  - *Chosen Approach*: Keep database file row insertion tied to actual transfer attempts, while having the orchestrator include authoritative release-wide `completedFiles` and `totalFiles` counters inside `ActiveTransferState` for both initial syncs and partial-item retries.
  - *Why*: Avoids leaving orphaned `queued` file rows behind if a run is stopped mid-release, and handles partial retries accurately (e.g., retrying 1 failed file on a 3-file item reports `2/3` complete rather than `0/1`).
  - *Alternatives Considered*: Pre-inserting `queued` rows for all files at discovery time—would require extra cleanup paths on user abort or process crash.

- **Decision 3: Hide Overall Bar on Single-File Releases**
  - *Chosen Approach*: Show the Overall Catalog Item progress bar strictly when `totalFiles > 1`.
  - *Why*: Eliminates visual duplication where two bars on the same card would always display the exact same percentage and animate in lockstep.
  - *Alternatives Considered*: Always showing two bars—adds vertical clutter without communicating any new information for 1-file ROMs.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Calculation Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Backend Sync / Retry Orchestrator                                          │
│  • Computes release-wide counts:                                           │
│    - totalFiles (all files in multi-file release, or full item on retry)   │
│    - completedFiles (already downloaded/skipped + prior loop completions)  │
│  • Emits activeTransfer { itemId, fileId, fileIndex, totalFiles,           │
│                           completedFiles, bytesReceived, totalBytes, B/s } │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │
                  SSE Event Stream (/api/events → 'transfer')
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Shared Transfer Progress Resolver                                          │
│  • fileProgress    = active file mode, %, bytesLabel, speedLabel           │
│  • overallProgress = (totalFiles > 1)                                      │
│      ? { show: true, completedFiles, totalFiles,                           │
│          percent: round(((completedFiles + fileFraction) / totalFiles)*100)}│
│      : { show: false }                                                     │
└──────────────┬──────────────────────────┬──────────────────────────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────┐ ┌────────────────────────────────────────────┐
│ Catalog Views               │ │ Game Detail Drawer                         │
│  • Grid Card:               │ │  • Top Banner:                             │
│    - Cover: Current File    │ │    - Multi-file: Overall Item + Active File│
│    - Footer: Overall Item   │ │    - Single-file: Active File only         │
│      (only if multi-file)   │ │  • Included Downloads List:                │
│  • Table Row:               │ │    - File-level progress bar on active row │
│    - File bar + Overall bar │ └────────────────────────────────────────────┘
│      (Overall if multi-file)│
└─────────────────────────────┘
```

### Data Model & State Strategy

- **Live Transfer Contract Extension**: Add optional `completedFiles?: number | null` alongside `fileIndex` and `totalFiles` on `ActiveTransferState` (shared across server and client types) so both fresh multi-file syncs and partial multi-file retries report true item-level completion.
- **Fallback When Transitioning Between Files**: When `item.status === 'downloading'` and `activeTransfer` is briefly `null` between sequential files in a release, fall back to the release's indexed file counts (`completedInDb` / `item.filesCount`) while showing `Preparing transfer…`.

### Interactive Component & State Mapping

- **Catalog Box-Art Grid Card**: Renders the Current File overlay on the cover frame for all downloading items; renders the Overall Item bar in the footer when `overall.show` is true (`totalFiles > 1`), and renders clean unboxed live status text (`size · X%`) in the footer when `totalFiles <= 1`.
- **Catalog Table Row**: Renders the Current File progress block in `Status`, plus a slim `Overall · X/Y files · Z%` bar directly below it when `overall.show` is true.
- **Game Detail Drawer**: Renders an Overall Item progress row alongside the Active File row in the drawer header transfer strip whenever `overall.show` is true, and retains per-file live progress on the active row inside **Included Downloads**.
