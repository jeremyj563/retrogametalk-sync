---
title: Unlockable Retro Synth Soundtrack & Header Sound Deck
status: implemented
created_at: 2026-11-19T18:41:31Z
implemented_at: 2026-11-19T18:48:00Z
---

# Unlockable Retro Synth Soundtrack & Header Sound Deck

## Overview
Add an unlockable, zero-dependency looping background music system to **RetroGameTalk Sync** that rewards achievement progression with curated retro electronic tracks—spanning Lo-Fi CRT Ambient, 8-Bit Chiptune, 80s Synthwave, 16-Bit FM Action, Acid Techno, Cyber-Synth, and Arcade Euro-Synth. Users get one starter track immediately at 0 Trophy Points and unlock six additional tracks as they hit achievement point milestones, controlled from a compact CRT Sound Deck in the top header and the Trophy Case Rewards tab.

> **Confirmed Decisions**:
> - **Audio Engine**: Built-in zero-dependency Web Audio API synth sequencer (offline-friendly, seamless loops, zero container bloat)
> - **Controls & Placement**: Compact Sound Deck trigger + popover in the top header bar, paired with full track showcase & playback actions inside the Trophy Case Rewards tab
> - **Unlock Pacing**: 1 free starter track at 0 pts + 6 unlockable tracks spread across Trophy Point milestones
> - **Playback & Polish**: Off by default until Play is clicked · Auto-pause when the browser tab is hidden · Automatic volume ducking during Arcade SFX & trophy chimes · Mini spectrum visualizer synced to the active CRT phosphor palette · Loop / Cycle / Shuffle playback modes across unlocked tracks

---

## Unlockable Soundtrack Roster & Milestone Pacing

| Unlock Threshold | Track Title | Style / Genre | Tempo | Sonic Character |
| :--- | :--- | :--- | :---: | :--- |
| **0 pts (Starter)** | **Phosphor Idle** | CRT Ambient / Lo-Fi Synth | 92 BPM | Warm electric-piano triads, soft analog sub-pulse, delicate pentatonic sparkle, brushed hats |
| **150 pts** | **Bitplane Bounce** | 8-Bit Chiptune | 132 BPM | Classic dual square-wave pulse lead & harmony, punchy triangle bass, crisp noise snare/hats |
| **400 pts** | **Outrun CRT** | 80s Synthwave | 116 BPM | Driving octave sawtooth bassline, resonant filter sweeps, lush detuned retro pads, gated snare |
| **650 pts** | **FM Cartridge Drive** | 16-Bit FM Action | 128 BPM | Metallic FM slap bass, shimmering bell chords, syncopated 16-bit breakbeat percussion |
| **950 pts** | **Subcarrier Pulse** | Retro Techno / Acid | 130 BPM | Four-on-the-floor sub kick, squelchy resonant 303-style acid bass, hypnotic warehouse stabs |
| **1,300 pts** | **Cyberdeck Horizon** | Dark Cyber-Synth | 108 BPM | Brooding arpeggiated sub-bass, atmospheric chorus pads, crisp half-time electronic drums |
| **1,650 pts** | **Broadcast Finale** | Arcade Euro-Synth | 138 BPM | Euphoric chord stabs, high-energy 16-bit/synthwave fusion lead, driving off-beat bass anthem |

---

## Implementation Summary
- Built a drift-free 25ms/140ms lookahead Web Audio synth sequencer (`retroMusicPlayer`) featuring dual-oscillator detuned voices, resonant filter envelopes, 2-operator FM modulation, dotted-8th tempo-synced echo send, dynamics compressor, `AnalyserNode` spectrum readout, and smooth gain ramping.
- Added transient chime ducking hooks to `retroSynth` and sustained arcade ducking when the 4-in-1 CRT Arcade Cabinet is open, plus `document.visibilitychange` auto-pause/auto-resume and strict user-gesture startup (off by default).
- Added the compact split **Header Sound Deck** (`HeaderSoundDeck`) with 1-click Play/Pause, a palette-synced compositor-only `scaleY` mini spectrum visualizer, anchored CRT deck popover (Now Playing LCD, 12-bar spectrum, transport & Loop/Cycle/Shuffle toggle, volume slider, 7-track unlock list, and direct Rewards link).
- Registered the 6 unlockable tracks as `music_track` entries in `ACHIEVEMENT_REWARDS` and integrated a **Background Soundtrack** quick-bar plus in-row **Play / Pause** actions inside the Trophy Case **Rewards** tab.
