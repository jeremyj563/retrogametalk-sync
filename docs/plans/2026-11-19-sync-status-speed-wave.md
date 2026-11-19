---
title: Speed-Reactive Sync Status Wave Effect
status: implemented
created_at: 2026-11-19T14:21:26Z
implemented_at: 2026-11-19T14:28:00Z
---

# Speed-Reactive Sync Status Wave Effect

Add a smooth, oscilloscope-inspired wave visualization to the Sync Status bar whose travel frequency and wave density accelerate seamlessly as live download throughput climbs. The effect is driven by the **Living UI Motion** tiers (`Low` through `Ultra`), dynamically adopts the active CRT Phosphor Palette, and includes its own independent **Sync Speed Wave** toggle inside CRT Display Studio so operators can turn it off without disabling other Living UI Motion effects.

## Confirmed Decisions

- **Independent Toggle**: Dedicated **Sync Speed Wave** (`ON` / `OFF`) control directly inside the **Living UI Motion** section of CRT Display Studio (persisted in `localStorage`, enabled by default). Disabling it turns off only the Sync Status wave while keeping all other Living UI Motion effects running.
- **Visual Style**: Phase-continuous phosphor oscilloscope sine wave trace across the Sync Status card backdrop plus synchronized speed-scaled traveling wave modulation inside the combined and parallel worker transfer progress bars.
- **Motion-Tier Activation**: Activates on `Low`, `Medium`, `High`, and `Ultra` Living UI Motion tiers (scaling from a subtle single trace at `Low` to dual-harmonic glow bloom at `Ultra`); completely disabled when Living UI Motion is `Off`, when `Sync Speed Wave` is `OFF`, or when `prefers-reduced-motion: reduce` is active.
- **Logarithmic Throughput Mapping**: Normalizes live `bytesPerSec` logarithmically (`log10(1 + MB/s * 1.4)`) with exponential frame smoothing so both throttled `200 KB/s` downloads and `40+ MB/s` multi-chunk bursts feel distinct and fluid without phase snapping.
