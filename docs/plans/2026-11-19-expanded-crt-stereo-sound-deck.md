---
title: Expanded Center-Stage CRT Stereo Sound Deck
status: implemented
created_at: 2026-11-20T03:23:02Z
implemented_at: 2026-11-20T03:28:00Z
---

# Expanded Center-Stage CRT Stereo Sound Deck

Upgrade the compact header soundtrack button into a wider, center-stage recessed CRT stereo receiver deck so music controls, the active track readout, live spectrum bars, and newly unlocked soundtracks stand out naturally in the top bar.

## Approach

Re-architect the top header into a balanced three-zone desktop layout—Brand Mark on the left, the expanded CRT Sound Deck occupying center stage, and Trophy Case plus Sync controls on the right. Style the Sound Deck as a dark recessed hardware stereo bezel with a subtle steady phosphor outline, housing tactile transport controls on the left, a two-line CRT LCD track readout in the middle, a wider live spectrum analyzer on the right, and a subtle new-unlock indicator whenever new Trophy Point tracks become available. Clicking the LCD readout or drawer chevron opens the existing full soundtrack selector popover (track list, volume slider, loop/cycle/shuffle controls, and Trophy Rewards shortcut), cleanly anchored to the center-stage deck.

```
Desktop Header (lg / xl+)
┌──────────────────┐   ┌──────────────────────────────────────────────────────┐   ┌───────────────────────────┐
│  Brand Mark      │   │ [|<] [▶] [>|] │ NEON CORRIDOR      │ ▁▃▆█▄▆▂▅▃▇▄▂ [v]│   │ [🏆 12/65] [Inc|Full] [▶] │
│  RetroGameTalk   │   │               │ CHIPTUNE BREAK·128 │    [+2 NEW]     │   │                           │
└──────────────────┘   └──────────────────────────────────────────────────────┘   └───────────────────────────┘
                           Transport      Recessed CRT LCD     Live 12-Bar EQ
                                          (Click opens full track/volume deck)

Narrower / Tablet Header (md / sm)
- Progressively trims genre/BPM metadata and reduces spectrum bars from 12 to 6 while preserving transport + title.
- On compact mobile widths, wraps cleanly onto a full-width recessed receiver row below the brand and sync controls without clipping or two-line button text.
```

## Key Decisions

- **Center-stage header placement**: Move the Sound Deck out of the right-hand sync action cluster into its own flexible center slot between the Brand Mark and right-side controls on desktop, keeping every header action single-line and evenly balanced.
- **2.5× to 3× expanded hardware footprint**: Grow the desktop deck from its ~85px split button to roughly 280px–436px wide (adapting smoothly to available header width without ever crowding the Sync controls).
- **Recessed CRT stereo receiver LCD aesthetic**: Frame the deck with a darker inset faceplate, inner top-edge shadow, crisp vertical hardware dividers, and a subtle steady phosphor border at rest that brightens cleanly with phosphor glow when audio is actively playing.
- **Inline transport + readout + wider visualizer**: Place inline Previous, Play/Pause, and Next controls beside the recessed LCD strip (showing track title on line 1 and genre + BPM on line 2 with tabular numerals) and a wider 12-bar GPU-composited live spectrum analyzer on desktop.
- **New-unlock attention badge**: Persist seen unlocked track IDs in browser storage so whenever Trophy Points unlock one or more new tracks, the deck displays a concise phosphor new-unlock indicator (`NEW` / `+N NEW`) and marks those unseen tracks inside the selector popover until the user opens the deck or selects a new track.
- **Motion & accessibility compliance**: Keep the idle deck calm (no decorative pulsing dots or restless animations), respect `prefers-reduced-motion` and the CRT Display Studio's Living UI Motion `Off` mode (falling back to crisp static equalizer bars), and preserve full keyboard focus states and accessible labels on every inline button.
