---
title: Smooth Monitor Sync Box-Art & Title Transitions
status: implemented
created_at: 2026-11-20T17:00:08Z
implemented_at: 2026-11-20T17:17:00Z
---

# Smooth Monitor Sync Box-Art & Title Transitions

Eliminate abrupt thumbnail snapping and placeholder flashes in the Monitor Sync Hero Showcase by introducing a retained-outgoing crossfade engine with adaptive frame-width easing, synchronized game-title choreography, and Living UI Motion scaling from Off to Ultra.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The plan incorporates all three design preferences confirmed during discovery:
> - **Confirmed Decision 1 — Transition Style**: **Smooth crossfade with frame ease (no blank flash)**. Previously loaded artwork stays on screen while the next cover decodes, then crossfades directly into the incoming cover while the frame smoothly eases between aspect ratios.
> - **Confirmed Decision 2 — Transition Scope**: **Choreographed pair (box art and game title together)**. The display game title performs a subtle, synchronized entrance alongside each release change while preserving immediate telemetry accuracy.
> - **Confirmed Decision 3 — Living UI Motion Scaling**: **Scale subtlety with Living UI Motion (`Off` to `Ultra`)**. Transitions stay instant on `Off` and `prefers-reduced-motion`, calm and understated on `Low`, tactile on `Medium`, and progressively infused with CRT phosphor accents on `High` and `Ultra`.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades the Monitor Sync Hero Showcase so transitioning from one syncing release to the next feels fluid and intentional rather than abrupt. Instead of dropping to an empty placeholder silhouette and snapping frame dimensions whenever a new game starts downloading, the cover viewport holds the outgoing box art until the incoming cover is decoded, crossfades between them cleanly, smoothly eases its width to fit the new box shape (e.g., portrait GBA/PS2, square DS, landscape SNES), and pairs the swap with a restrained title entrance.
- **Target Audience / Persona**: Retro collectors and self-hosters watching an active Full Sync, Incremental Sync, or Dry Run in the live Monitor dashboard—as well as prospective users viewing the app's captured preview reel on `Low` motion.
- **Key Value**: Transforms the centerpiece live-sync indicator from a jarring image swap into a polished, arcade-grade telemetry showcase with zero blank flashes, zero layout jitter, and full respect for user motion preferences.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Cold Start (Standby → First Syncing Release)**:
   - When a run enters its first game release, the cover frame opens cleanly with the recessed 3:4 CRT placeholder silhouette.
   - As soon as the release's box art finishes decoding, the frame eases smoothly to the box's natural aspect width while the artwork crossfades over the placeholder.
2. **Release-to-Release Handoff (Game A → Game B, Both With Cover Art)**:
   - While Game B's artwork is fetched and decoded, Game A's cover remains crisply displayed—no blank cutout and no placeholder flash.
   - Once Game B is ready (typically within a single animation frame for local cached covers), Game A and Game B overlap inside the clipped showcase frame: Game A fades out as Game B fades in, and the frame smoothly glides from Game A's width to Game B's width.
   - Simultaneously, the unboxed display game title enters with a matching settle cue so the left cover and right title column update as one cohesive pair.
3. **Rapid Multi-Release Burst (Fast Skips / Small ROMs)**:
   - If the runner advances through multiple titles faster than an image decodes or finishes fading, stale decode requests are ignored via a monotonic sequence guard and only the latest active release commits—never flashing an outdated cover.
4. **Covered → Uncovered Fallback (Game A With Art → Game B Without Art / Load Error)**:
   - If the next release lacks artwork or its image fails to load, Game A crossfades smoothly back to the recessed 3:4 CRT placeholder silhouette while the frame eases gently to the default placeholder width.
5. **Same-Release Telemetry Updates (Progress, Speed, ETA, File Parts)**:
   - Ongoing byte-progress ticks, speed fluctuations, and hover states never re-trigger the crossfade or title entrance; transitions fire strictly when the active release identity changes.
6. **Dry Run & Compact Showcase Mode**:
   - Compact cover heights during Dry Run or pre-transfer preparation share the exact same retained-outgoing crossfade and aspect-width easing math.

### Interactive Feedback & Motion (Living UI Motion Scaling)

| Living UI Motion Tier | Cover Crossfade & Frame Ease | Title Choreography | CRT Accent Flair |
| :--- | :--- | :--- | :--- |
| **`Off` / Reduced Motion** | Instant swap (`0ms`), immediate width update | Instant text update, zero offset | None |
| **`Low`** *(Preview Default)* | Calm `200ms` opacity crossfade + gentle width ease | Subtle `200ms` opacity settle (no vertical shift) | None — clean, quiet clarity |
| **`Medium`** | Smooth `240ms` crossfade + subtle `0.985 → 1` micro-scale settle + width ease | `240ms` fade + restrained `3px` vertical glide | Faint accent border pulse on commit |
| **`High`** | Crisp `260ms` crossfade + gentle phosphor brightness settle + width ease | `260ms` fade + `4px` glide + brief phosphor text bloom | Accent rim halo pulse around the cover frame |
| **`Ultra`** | Rich `300ms` crossfade + phosphor settle + width ease | `300ms` fade + `5px` glide + vivid phosphor text bloom | Brief specular scan-glint sweep across the newly settled cover + rim pulse |

---

## 3. Key Product Decisions & Trade-Offs

- **Retained-Outgoing Preload Buffer**: Keeps the previously decoded cover rendered while asynchronously preloading/decoding the incoming cover off-stage so consecutive games never flash blank and the target aspect ratio is known before frame width eases.
- **Immediate Truthful Title Update Synchronized With Cover Commit**: Updates the displayed game title immediately on release transitions with a synchronized choreographed entrance, keeping live telemetry accurate while moving in lockstep with fast local cover decodes.
- **Computed Bounded Aspect Width Easing**: Computes target pixel width from `(naturalWidth / naturalHeight) * frameHeight` clamped to responsive bounds (`50px–124px` mobile, `50px–144px` desktop) via `--crt-hero-frame-width`, enabling smooth `cubic-bezier(0.16, 1, 0.3, 1)` width transitions across portrait, square, and landscape covers.
