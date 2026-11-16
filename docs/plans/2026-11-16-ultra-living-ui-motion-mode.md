---
title: Ultra Mode for Living Phosphor UI Motion
status: implemented
created_at: 2026-11-16T21:06:34Z
implemented_at: 2026-11-16T21:17:30Z
---

# Ultra Mode for Living Phosphor UI Motion

Introduce a fifth, unapologetically maximalist **Ultra** tier (`Off` · `Low` · `Med` · `High` · `Ultra`) to the CRT Display Studio's Living UI Motion selector, turning the entire RetroGameTalk Sync console into an electrified, breathing CRT broadcast workstation. Ultra mode pairs full-screen cathode-ray tube atmosphere with overclocked electron beams, halos, and scan sheens across every workspace view while keeping all prose, form inputs, and tabular metrics steady and crisp.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core design choices for **Ultra** mode were confirmed during our interactive clarification step and govern this plan:

- **Confirmed Decision 1 — Full-Screen Tube Atmosphere + All-Component Overdrive**: Ultra mode animates both the viewport-wide CRT glass atmosphere (a rolling V-sync broadcast hum bar gliding down the tube, continuous scanline raster drift, breathing radial phosphor bloom, and subtle RGB convergence shimmer) and maximalist per-component motion across every panel, control, card, drawer, and chart.
- **Confirmed Decision 2 — Non-Destructive Optical Glow Auto-Boost**: Selecting **Ultra** automatically boosts effective phosphor bloom, scanline presence, and halo radiance under the hood—even if your CRT sliders are currently set to `Subtle`—while leaving your saved slider percentages completely untouched when switching back to `Off`, `Low`, `Med`, or `High`.
- **Confirmed Decision 3 — Readability Boundary ("Steady Text, Maximalist Beams & Halos")**: Body copy, form fields, log lines, and tabular numbers never shake, jitter, or blur; all Ultra intensity is channeled into glowing borders, dual counter-sweeping electron beams, periodic CTA phosphor sheens, holographic box-art scanlines, live terminal scan sweeps, and overclocked vector kinematics.

---

### 1. Overview & Core Concept

- **What It Does**: Expands the **Living UI Motion** control inside the sidebar's CRT Display Studio from four presets to five (`Off`, `Low`, `Med`, `High`, `Ultra`). Activating **Ultra** engages an overdrive visual profile that bathes every surface—from the animated CRT cartridge header banner and sidebar telemetry rail to the Sync dashboard, Catalog box-art grid, Schedule matrix, and Operations console—in synchronized phosphor light and kinetic vector motion.
- **Target Audience / Persona**: Retro hardware enthusiasts and homelab operators who want an optional "crank it to 11" showcase mode that celebrates vintage PVM/arcade monitor physics without sacrificing operational clarity.
- **Key Value**: Delivers a thrilling, cohesive maximalist retro-console experience on demand while keeping `Low` as the calm everyday default and preserving instant one-click switching between tasteful subtlety and full cathode-ray spectacle.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Selecting Ultra in CRT Display Studio**: Opening or viewing the left-rail **CRT Display** panel reveals a 5-segment single-line motion bar (`Off` · `Low` · `Med` · `High` · `Ultra`). Clicking `Ultra` lights the button with an energized phosphor border and halo, updates the studio description readout, persists the choice locally across reloads, and immediately engages full-tube + component overdrive.
  2. **Non-Destructive Optical Overdrive**: If a user currently has CRT preset `Subtle` (`25%` Gauss Glow) selected and clicks `Ultra`, the display immediately blooms to high-intensity cathode radiance without altering the `25%` slider value. Clicking back to `Low`, `Med`, or `High` smoothly returns to their exact saved `25%` optical baseline.
  3. **Live Sync & Dry Run Escalation**: Starting an active sync or toggling **Dry Run** layers seamlessly onto Ultra—accelerating sweep cadence during active transfers and shifting reactive beams, cartridge telemetry, and primary action sheens to warm amber (`#f59e0b`) during Dry Run simulations.

- **Interactive Feedback & Motion Across Every UI Surface**:
  1. **Full-Screen CRT Tube Atmosphere**:
     - **Rolling V-Sync Broadcast Hum Bar**: A soft, translucent horizontal phosphor/shadow band glides continuously down the viewport glass every ~7.2 seconds like a real 60Hz/59.94Hz AC beat frequency on a studio CRT.
     - **Scanline Raster Drift & Breathing Tube Bloom**: Subtle vertical scanline phase drift paired with a slow, living radial phosphor vignette pulse and heightened RGB subpixel convergence shimmer.
  2. **Top Header & Animated CRT Cartridge Banner**:
     - Dual counter-sweeping phosphor laser traces gliding along the bottom border of the sticky top bar.
     - Overclocked cartridge screen telemetry: rapid dual-chevron sync arrows, high-speed 5-pin ROM bus scanner, heightened screen glow, and harmonic neon bloom on the `SYNC` wordmark.
  3. **Sidebar Navigation, Daemon Readout & CRT Studio Controls**:
     - All four `LivingNavIcon` vectors run continuously at turbo cadence with vivid phosphor drop-shadows, even on inactive tabs, and accelerate further when active or hovered.
     - The active sidebar navigation button features a glowing phosphor frame and a gentle periodic surface scan-sheen; range slider thumbs emit phosphor halos.
  4. **Universal Panel & Drawer Dual-Beam Architecture**:
     - Every living card and drawer across **Sync**, **Catalog**, **Schedule**, **Operations**, **Failed Queue**, and **Game Detail Drawer** upgrades from a single top electron beam to **dual counter-sweeping electron beams** paired with a breathing neon perimeter aura on the card border.
  5. **Primary CTAs, Segmented Tabs & Form Controls**:
     - Primary action buttons emit an automatic, periodic diagonal phosphor light sheen every ~2.8 seconds at rest, accelerating on hover; active segmented filter/view tabs and focused inputs glow with phosphor halos.
  6. **Data Views — Telemetry Deck, Live Console Stream & Catalog**:
     - **Telemetry Deck**: Dual-harmonic vertical raster sweeps across the chart glass, amplified curve neon glow, and lively pulsing latest-sample beacons.
     - **Live Scraper Event Stream & Failed Queue Accordion**: A vertical CRT terminal scan beam sweeps softly down the log console viewport; table rows across Sync Runs, Failed Queue, Catalog Table, and Disk Tree illuminate with an inset phosphor laser highlight on hover.
     - **Catalog Box-Art Grid & Game Detail Drawer**: Cover-art cards gain a holographic CRT scan-sheen drifting vertically across the artwork, rising into a vivid phosphor halo on hover; the slide-over Game Detail Drawer gains a living phosphor edge trace along its vertical bezel.

---

### 3. Key Product Decisions & Trade-Offs

- **Derived Optical Overdrive vs. Mutating User Sliders**: Computes an auto-boosted optical floor inside the CSS variable generator whenever `uiMotion === 'ultra'` and CRT FX is enabled, without modifying stored slider numbers.
- **GPU-Composited Pseudo-Elements & Dedicated Clip Strips**: Drives all Ultra sweeps, hum bars, box-art sheens, and terminal scan beams exclusively via `transform` and `opacity` inside dedicated pointer-safe overlay elements without applying `overflow: hidden` directly onto `<section>` cards that host floating dropdowns.
- **Preserving OS Reduced-Motion Safety**: Maintains full `@media (prefers-reduced-motion: reduce)` neutralization so OS-level accessibility overrides cleanly halt continuous motion even if `Ultra` is selected.
