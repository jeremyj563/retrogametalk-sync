import {
  type MusicTrackId,
  SOUNDTRACK_TRACK_BY_ID,
  STARTER_TRACK_ID,
} from '../shared/soundtrack';

export type NoteCell = number | readonly [midi: number, steps: number, vel?: number] | null;

export interface TomHit {
  readonly step: number;
  readonly midi: number;
  readonly vel?: number;
}

export interface SynthVoiceConfig {
  waveform: OscillatorType;
  detuneCents?: number;
  cutoffHz?: number;
  cutoffPeakHz?: number;
  q?: number;
  attackSec: number;
  releaseSec: number;
  gain: number;
  delaySend?: number;
  pan?: number;
  /** Optional 2-operator FM modulation ratio & index (for 16-bit FM bells, basses & OPL2 leads) */
  fmRatio?: number;
  fmIndexHz?: number;
  /** Soft-clipping overdrive amount (0..1) routed before the lowpass cab filter */
  driveAmount?: number;
  /** Optional -1 octave sub-oscillator blend (0..1) */
  subOctaveGain?: number;
  /** Optional expressiveness vibrato on sustained notes */
  vibratoHz?: number;
  vibratoCents?: number;
  vibratoDelaySec?: number;
}

export interface TrackScore {
  bpm: number;
  totalSteps: number;
  /** Multi-bar 16th-note melodic lanes */
  lead: readonly NoteCell[];
  counter?: readonly NoteCell[];
  arp: readonly NoteCell[];
  bass: readonly NoteCell[];
  /** Chord MIDI note arrays triggered at specific 16th steps (with optional sustain steps) */
  chords: Partial<Record<number, readonly number[] | { notes: readonly number[]; steps?: number; vel?: number }>>;
  /** Optional accented steps (e.g. filter / FM bite boost) */
  accentSteps?: readonly number[];
  /** Percussion step triggers (0..totalSteps-1) */
  kick: readonly number[];
  snare: readonly number[];
  hatClosed: readonly number[];
  hatOpen?: readonly number[];
  clang?: readonly number[];
  crash?: readonly number[];
  toms?: readonly TomHit[];
  leadVoice: SynthVoiceConfig;
  counterVoice?: SynthVoiceConfig;
  arpVoice: SynthVoiceConfig;
  bassVoice: SynthVoiceConfig;
  padVoice: SynthVoiceConfig;
  drumGain: number;
  delayFeedback: number;
  delayMix: number;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const SCHEDULE_AHEAD_SEC = 0.14;
const LOOKAHEAD_MS = 25;

/** Concise sustained/articulated note tuple helper: s(midi, steps, velocity) */
function s(midi: number, steps = 2, vel = 1): readonly [number, number, number] {
  return [midi, steps, vel];
}

function concatBars(...barsList: readonly (readonly NoteCell[])[]): NoteCell[] {
  const out: NoteCell[] = [];
  for (const bar of barsList) {
    out.push(...bar);
  }
  return out;
}

function repeatBars(stepsInBar: readonly number[], barIndices: readonly number[]): number[] {
  const out: number[] = [];
  for (const bar of barIndices) {
    for (const step of stepsInBar) {
      out.push(bar * 16 + step);
    }
  }
  return out;
}

const BARS_0_TO_7 = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export const TRACK_SCORES: Record<MusicTrackId, TrackScore> = {
  // =========================================================================
  // 1. Starter (0 pts) — "Hollow Corridor" (Corpse Party PSP Ch.1 Main Vibe)
  // 88 BPM · C# Minor / Harmonic Minor · 8 bars (128 steps)
  // Fragile FM music-box motif, cold ominous string drones, quiet pulse ticks
  // =========================================================================
  phosphor_idle: {
    bpm: 88,
    totalSteps: 128,
    chords: {
      // A Section: C#m9 -> A/C# -> F#m7 -> G#7sus4 -> G#7
      0: { notes: [49, 56, 60, 64], steps: 15 },
      16: { notes: [49, 57, 61, 64], steps: 15 },
      32: { notes: [42, 54, 57, 61], steps: 15 },
      48: { notes: [44, 56, 61, 63], steps: 8 },
      56: { notes: [44, 56, 60, 63], steps: 7 },
      // B Section: Amaj7 -> G#m7 -> F#m9 -> Ddim7/G# (chilling turnaround)
      64: { notes: [45, 57, 61, 64], steps: 15 },
      80: { notes: [44, 56, 59, 63], steps: 15 },
      96: { notes: [42, 54, 57, 61], steps: 15 },
      112: { notes: [44, 53, 56, 60], steps: 15 },
    },
    bass: concatBars(
      // Bar 0-3 (Section A)
      [s(37, 6, 0.9), null, null, null, null, null, null, null, s(44, 4, 0.75), null, null, null, null, null, null, null],
      [s(37, 6, 0.9), null, null, null, null, null, null, null, s(45, 4, 0.75), null, null, null, null, null, null, null],
      [s(30, 6, 0.9), null, null, null, null, null, null, null, s(37, 4, 0.75), null, null, null, null, null, null, null],
      [s(32, 6, 0.9), null, null, null, null, null, null, null, s(32, 4, 0.8), null, null, null, s(39, 3, 0.7), null, null, null],
      // Bar 4-7 (Section B)
      [s(33, 6, 0.95), null, null, null, null, null, null, null, s(40, 4, 0.75), null, null, null, null, null, null, null],
      [s(32, 6, 0.95), null, null, null, null, null, null, null, s(39, 4, 0.75), null, null, null, null, null, null, null],
      [s(30, 6, 0.95), null, null, null, null, null, null, null, s(37, 4, 0.75), null, null, null, null, null, null, null],
      [s(32, 8, 1.0), null, null, null, null, null, null, null, s(32, 4, 0.85), null, null, null, s(44, 2, 0.7), null, null, null],
    ),
    arp: concatBars(
      // Cold clockwork music-box pattern
      [61, null, 68, null, 73, null, 68, null, 64, null, 68, null, 73, null, 68, null],
      [61, null, 69, null, 73, null, 69, null, 64, null, 69, null, 73, null, 69, null],
      [61, null, 66, null, 69, null, 66, null, 64, null, 66, null, 69, null, 66, null],
      [63, null, 68, null, 73, null, 68, null, 60, null, 68, null, 72, null, 68, null],
      [64, null, 69, null, 73, null, 69, null, 68, null, 73, null, 76, null, 73, null],
      [63, null, 68, null, 71, null, 68, null, 66, null, 71, null, 75, null, 71, null],
      [61, null, 66, null, 69, null, 66, null, 64, null, 69, null, 73, null, 69, null],
      [60, null, 65, null, 68, null, 72, null, 68, null, 65, null, 60, null, null, null],
    ),
    lead: concatBars(
      // Bar 0-3: eerie hesitant melody with long held breaths
      [null, null, null, null, s(76, 4, 0.9), null, null, null, s(75, 2, 0.85), null, s(73, 4, 0.95), null, null, null, null, null],
      [null, null, null, null, s(76, 3, 0.9), null, null, s(78, 2, 0.9), s(76, 4, 0.9), null, null, null, s(73, 3, 0.75), null, null, null],
      [null, null, null, null, s(73, 3, 0.85), null, null, s(75, 2, 0.85), s(76, 4, 0.9), null, null, null, s(73, 3, 0.8), null, null, null],
      [s(75, 6, 0.9), null, null, null, null, null, s(73, 2, 0.8), null, s(72, 6, 0.95), null, null, null, null, null, null, null],
      // Bar 4-7: darker harmonic minor climb + descent
      [s(80, 4, 0.95), null, null, null, s(78, 2, 0.85), null, s(76, 4, 0.9), null, null, null, s(75, 2, 0.8), null, s(76, 3, 0.9), null, null, null],
      [s(75, 4, 0.9), null, null, null, s(73, 2, 0.85), null, s(71, 4, 0.85), null, null, null, null, null, s(75, 3, 0.8), null, null, null],
      [s(73, 4, 0.9), null, null, null, s(76, 2, 0.9), null, s(78, 4, 0.95), null, null, null, s(76, 2, 0.85), null, s(73, 3, 0.8), null, null, null],
      [s(72, 6, 0.95), null, null, null, null, null, s(75, 2, 0.85), null, s(73, 4, 0.8), null, null, null, null, null, null, null],
    ),
    counter: concatBars(
      [null, null, null, null, null, null, null, null, null, null, null, null, s(68, 4, 0.7), null, null, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(69, 4, 0.7), null, null, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(66, 4, 0.7), null, null, null],
      [null, null, null, null, null, null, null, null, s(68, 6, 0.75), null, null, null, null, null, null, null],
      [s(73, 6, 0.75), null, null, null, null, null, null, null, s(71, 6, 0.75), null, null, null, null, null, null, null],
      [s(71, 6, 0.75), null, null, null, null, null, null, null, s(68, 6, 0.7), null, null, null, null, null, null, null],
      [s(69, 6, 0.75), null, null, null, null, null, null, null, s(68, 6, 0.75), null, null, null, null, null, null, null],
      [s(68, 8, 0.8), null, null, null, null, null, null, null, s(67, 4, 0.7), null, null, null, null, null, null, null],
    ),
    kick: repeatBars([0, 8], [2, 3, 4, 5, 6, 7]),
    snare: repeatBars([12], [4, 5, 6, 7]),
    hatClosed: repeatBars([0, 4, 8, 12], BARS_0_TO_7),
    clang: [48, 112],
    leadVoice: {
      waveform: 'sine',
      fmRatio: 3.5,
      fmIndexHz: 115,
      cutoffHz: 3100,
      attackSec: 0.01,
      releaseSec: 0.58,
      gain: 0.135,
      delaySend: 0.48,
      pan: 0.12,
      vibratoHz: 4.8,
      vibratoCents: 9,
      vibratoDelaySec: 0.18,
    },
    counterVoice: {
      waveform: 'triangle',
      detuneCents: 10,
      cutoffHz: 1450,
      attackSec: 0.08,
      releaseSec: 0.9,
      gain: 0.068,
      delaySend: 0.35,
      pan: -0.22,
    },
    arpVoice: {
      waveform: 'sine',
      fmRatio: 2,
      fmIndexHz: 65,
      cutoffHz: 2600,
      attackSec: 0.005,
      releaseSec: 0.24,
      gain: 0.072,
      delaySend: 0.42,
      pan: -0.18,
    },
    bassVoice: {
      waveform: 'triangle',
      cutoffHz: 360,
      attackSec: 0.02,
      releaseSec: 0.45,
      gain: 0.24,
      subOctaveGain: 0.35,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 12,
      cutoffHz: 850,
      attackSec: 0.28,
      releaseSec: 1.9,
      gain: 0.048,
      delaySend: 0.3,
      pan: 0.08,
    },
    drumGain: 0.095,
    delayFeedback: 0.42,
    delayMix: 0.34,
  },

  // =========================================================================
  // 2. 150 pts — "Clockwork Chamber" (Escape Goat: Machinery Vibe)
  // 118 BPM · D Dorian / Minor · 8 bars (128 steps)
  // Quirky interlocking pulse-wave puzzle gears, Dorian hook, crisp mechanical ticks
  // =========================================================================
  bitplane_bounce: {
    bpm: 118,
    totalSteps: 128,
    chords: {
      0: { notes: [50, 57, 62, 65], steps: 14 }, // Dm
      16: { notes: [50, 55, 59, 62], steps: 14 }, // G/D (Dorian lift)
      32: { notes: [46, 53, 57, 62], steps: 14 }, // Bbmaj7
      48: { notes: [45, 52, 57, 61], steps: 14 }, // A7
      64: { notes: [53, 57, 60, 64], steps: 14 }, // Fmaj7
      80: { notes: [52, 55, 59, 64], steps: 14 }, // Em7
      96: { notes: [46, 53, 58, 62], steps: 14 }, // Bb
      112: { notes: [45, 52, 55, 61], steps: 14 }, // A7
    },
    bass: concatBars(
      [38, null, 50, null, 38, 50, 41, 45, 38, null, 50, null, 45, null, 41, null],
      [38, null, 50, null, 38, 50, 43, 47, 38, null, 50, null, 47, null, 43, null],
      [34, null, 46, null, 34, 46, 38, 41, 34, null, 46, null, 41, null, 38, null],
      [33, null, 45, null, 33, 45, 37, 40, 33, null, 45, null, 40, 43, 45, 37],
      [41, null, 53, null, 41, 53, 45, 48, 41, null, 53, null, 48, null, 45, null],
      [40, null, 52, null, 40, 52, 43, 47, 40, null, 52, null, 47, null, 43, null],
      [34, null, 46, null, 34, 46, 41, 38, 34, null, 46, null, 41, null, 43, null],
      [33, null, 45, null, 33, 45, 40, 37, 33, null, 40, 43, 45, null, 49, null],
    ),
    arp: concatBars(
      [62, 65, 69, 72, 69, 65, 62, 69, 62, 65, 69, 72, 74, 72, 69, 65],
      [62, 67, 71, 74, 71, 67, 62, 71, 62, 67, 71, 74, 76, 74, 71, 67],
      [58, 62, 65, 69, 65, 62, 58, 65, 58, 62, 65, 69, 72, 69, 65, 62],
      [57, 61, 64, 69, 64, 61, 57, 64, 57, 61, 64, 67, 69, 73, 76, 73],
      [65, 69, 72, 76, 72, 69, 65, 72, 65, 69, 72, 76, 77, 76, 72, 69],
      [64, 67, 71, 74, 71, 67, 64, 71, 64, 67, 71, 74, 76, 74, 71, 67],
      [58, 62, 65, 70, 65, 62, 58, 65, 58, 62, 65, 70, 74, 70, 65, 62],
      [57, 61, 64, 67, 69, 67, 64, 61, 57, 61, 64, 69, 73, null, 76, null],
    ),
    lead: concatBars(
      [s(74, 2), null, 77, null, s(76, 2), 74, 72, null, s(74, 2), null, 69, null, s(72, 3), null, null, null],
      [s(71, 2), null, 74, null, s(76, 2), 74, 71, null, s(74, 2), null, 79, null, s(76, 3), null, null, null],
      [s(74, 2), null, 77, null, s(81, 2), 79, 77, null, s(74, 2), null, 70, null, s(74, 3), null, null, null],
      [s(73, 2), null, 76, null, s(79, 2), 76, 73, null, s(69, 4), null, null, null, s(76, 2), null, 73, null],
      [s(77, 2), null, 81, null, s(79, 2), 77, 76, null, s(72, 2), null, 76, null, s(77, 3), null, null, null],
      [s(76, 2), null, 79, null, s(78, 2), 76, 74, null, s(71, 2), null, 74, null, s(76, 3), null, null, null],
      [s(74, 2), null, 70, null, s(74, 2), 77, 82, null, s(81, 2), null, 77, null, s(74, 3), null, null, null],
      [s(76, 2), null, 73, null, s(69, 2), 73, 76, null, s(81, 4), null, null, null, s(76, 2), null, null, null],
    ),
    counter: concatBars(
      [null, null, null, null, null, null, null, null, 69, null, 72, null, 69, null, null, null],
      [null, null, null, null, null, null, null, null, 67, null, 71, null, 67, null, null, null],
      [null, null, null, null, null, null, null, null, 65, null, 69, null, 65, null, null, null],
      [null, null, null, null, null, null, null, null, 64, null, 67, null, 69, null, null, null],
      [72, null, null, null, 76, null, null, null, 69, null, 72, null, 76, null, null, null],
      [71, null, null, null, 74, null, null, null, 67, null, 71, null, 74, null, null, null],
      [70, null, null, null, 74, null, null, null, 77, null, 74, null, 70, null, null, null],
      [69, null, 73, null, 76, null, 73, null, 76, null, null, null, null, null, null, null],
    ),
    kick: repeatBars([0, 6, 8, 12], BARS_0_TO_7),
    snare: [...repeatBars([4, 12], BARS_0_TO_7), 62, 126],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], BARS_0_TO_7),
    hatOpen: [14, 46, 78, 110],
    clang: repeatBars([2, 10], [0, 2, 4, 6]),
    crash: [0, 64],
    leadVoice: {
      waveform: 'square',
      cutoffHz: 3400,
      cutoffPeakHz: 4600,
      q: 1.6,
      attackSec: 0.005,
      releaseSec: 0.16,
      gain: 0.11,
      delaySend: 0.22,
      pan: 0.1,
      vibratoHz: 6.0,
      vibratoCents: 10,
      vibratoDelaySec: 0.14,
    },
    counterVoice: {
      waveform: 'square',
      detuneCents: 8,
      cutoffHz: 2200,
      attackSec: 0.006,
      releaseSec: 0.14,
      gain: 0.072,
      delaySend: 0.18,
      pan: -0.24,
    },
    arpVoice: {
      waveform: 'square',
      cutoffHz: 2050,
      attackSec: 0.004,
      releaseSec: 0.075,
      gain: 0.056,
      delaySend: 0.14,
      pan: 0.26,
    },
    bassVoice: {
      waveform: 'triangle',
      cutoffHz: 850,
      attackSec: 0.005,
      releaseSec: 0.13,
      gain: 0.25,
      subOctaveGain: 0.25,
    },
    padVoice: {
      waveform: 'triangle',
      detuneCents: 10,
      cutoffHz: 1450,
      attackSec: 0.03,
      releaseSec: 0.7,
      gain: 0.045,
      pan: -0.1,
    },
    drumGain: 0.175,
    delayFeedback: 0.24,
    delayMix: 0.19,
  },

  // =========================================================================
  // 3. 400 pts — "Celestial Assembly" (Sea of Stars: Stars Align on the Assembly Line Vibe)
  // 124 BPM · F# Minor · 8 bars (128 steps)
  // Futuristic SNES-meets-synthwave factory groove, solstice bells, driving bass arps
  // =========================================================================
  outrun_crt: {
    bpm: 124,
    totalSteps: 128,
    chords: {
      0: { notes: [54, 57, 61, 66], steps: 15 }, // F#m
      16: { notes: [50, 54, 57, 61], steps: 15 }, // Dmaj7
      32: { notes: [52, 56, 59, 64], steps: 15 }, // E
      48: { notes: [49, 52, 56, 61], steps: 15 }, // C#m7
      64: { notes: [47, 50, 54, 57], steps: 15 }, // Bm7
      80: { notes: [49, 52, 56, 61], steps: 15 }, // C#m7
      96: { notes: [50, 54, 57, 61], steps: 15 }, // Dmaj7
      112: { notes: [52, 56, 59, 64], steps: 8 }, // E
      120: { notes: [49, 53, 56, 61], steps: 7 }, // C#7 turnaround
    },
    bass: concatBars(
      [42, 42, 54, 42, 42, 42, 54, 42, 42, 42, 54, 42, 45, 42, 52, 42],
      [38, 38, 50, 38, 38, 38, 50, 38, 38, 38, 50, 38, 42, 38, 49, 38],
      [40, 40, 52, 40, 40, 40, 52, 40, 40, 40, 52, 40, 44, 40, 50, 40],
      [37, 37, 49, 37, 37, 37, 49, 37, 37, 37, 49, 37, 40, 42, 44, 47],
      [35, 35, 47, 35, 35, 35, 47, 35, 35, 35, 47, 35, 38, 35, 45, 35],
      [37, 37, 49, 37, 37, 37, 49, 37, 37, 37, 49, 37, 40, 37, 47, 37],
      [38, 38, 50, 38, 38, 38, 50, 38, 38, 38, 50, 38, 42, 38, 49, 38],
      [40, 40, 52, 40, 40, 40, 52, 40, 37, 37, 49, 37, 41, 44, 49, 44],
    ),
    arp: concatBars(
      [66, null, 69, null, 73, null, 69, null, 66, null, 69, null, 73, null, 78, null],
      [62, null, 66, null, 69, null, 66, null, 62, null, 66, null, 69, null, 73, null],
      [64, null, 68, null, 71, null, 68, null, 64, null, 68, null, 71, null, 76, null],
      [61, null, 64, null, 68, null, 64, null, 61, null, 64, null, 68, null, 71, null],
      [59, 62, 66, 69, 66, 62, 59, 66, 59, 62, 66, 69, 71, 69, 66, 62],
      [61, 64, 68, 71, 68, 64, 61, 68, 61, 64, 68, 71, 73, 71, 68, 64],
      [62, 66, 69, 73, 69, 66, 62, 69, 62, 66, 69, 73, 76, 73, 69, 66],
      [64, 68, 71, 76, 71, 68, 64, 71, 61, 65, 68, 73, 77, 73, 68, 65],
    ),
    lead: concatBars(
      [s(73, 3), null, null, 76, s(78, 4), null, null, 76, s(73, 2), null, 71, null, s(73, 3), null, null, null],
      [s(74, 3), null, null, 76, s(78, 4), null, null, 73, s(69, 4), null, null, null, null, null, s(71, 2), null],
      [s(76, 3), null, null, 78, s(80, 4), null, null, 76, s(74, 2), null, 73, null, s(71, 3), null, null, null],
      [s(73, 4), null, null, null, s(71, 2), null, 69, null, s(68, 4), null, null, null, s(71, 2), null, 73, null],
      [s(74, 3), null, null, 76, s(78, 4), null, null, 74, s(71, 2), null, 74, null, s(76, 3), null, null, null],
      [s(73, 3), null, null, 74, s(76, 4), null, null, 73, s(68, 2), null, 71, null, s(73, 3), null, null, null],
      [s(78, 3), null, null, 81, s(80, 4), null, null, 78, s(76, 2), null, 74, null, s(73, 3), null, null, null],
      [s(76, 4), null, null, null, s(78, 3), null, null, 76, s(77, 6), null, null, null, null, null, s(73, 2), null],
    ),
    counter: concatBars(
      [null, null, null, null, null, null, null, null, 78, null, 81, null, 78, null, null, null],
      [null, null, null, null, null, null, null, null, 76, null, 78, null, 73, null, null, null],
      [null, null, null, null, null, null, null, null, 76, null, 79, null, 76, null, null, null],
      [null, null, null, null, null, null, null, null, 73, null, 76, null, 73, null, null, null],
      [s(71, 4, 0.8), null, null, null, s(74, 4, 0.8), null, null, null, s(78, 4, 0.85), null, null, null, null, null, null, null],
      [s(73, 4, 0.8), null, null, null, s(76, 4, 0.8), null, null, null, s(80, 4, 0.85), null, null, null, null, null, null, null],
      [s(74, 4, 0.8), null, null, null, s(78, 4, 0.8), null, null, null, s(81, 4, 0.9), null, null, null, null, null, null, null],
      [s(76, 4, 0.85), null, null, null, s(80, 4, 0.85), null, null, null, s(81, 6, 0.9), null, null, null, null, null, null, null],
    ),
    kick: repeatBars([0, 4, 8, 12], BARS_0_TO_7),
    snare: [...repeatBars([4, 12], BARS_0_TO_7), 62, 126],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], BARS_0_TO_7),
    hatOpen: [14, 30, 46, 62, 78, 94, 110, 126],
    clang: repeatBars([2, 10], [0, 1, 2, 3, 4, 5, 6, 7]),
    crash: [0, 64],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 13,
      cutoffHz: 2300,
      cutoffPeakHz: 3600,
      q: 2.0,
      attackSec: 0.015,
      releaseSec: 0.34,
      gain: 0.115,
      delaySend: 0.36,
      pan: 0.08,
      vibratoHz: 5.5,
      vibratoCents: 12,
      vibratoDelaySec: 0.16,
    },
    counterVoice: {
      waveform: 'sine',
      fmRatio: 2,
      fmIndexHz: 185,
      cutoffHz: 3300,
      attackSec: 0.004,
      releaseSec: 0.25,
      gain: 0.085,
      delaySend: 0.34,
      pan: -0.28,
    },
    arpVoice: {
      waveform: 'triangle',
      cutoffHz: 2400,
      attackSec: 0.006,
      releaseSec: 0.15,
      gain: 0.075,
      delaySend: 0.28,
      pan: 0.26,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 360,
      cutoffPeakHz: 1300,
      q: 3.1,
      attackSec: 0.004,
      releaseSec: 0.14,
      gain: 0.21,
      subOctaveGain: 0.28,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 15,
      cutoffHz: 1150,
      attackSec: 0.16,
      releaseSec: 1.55,
      gain: 0.052,
      delaySend: 0.24,
      pan: -0.1,
    },
    drumGain: 0.21,
    delayFeedback: 0.34,
    delayMix: 0.26,
  },

  // =========================================================================
  // 4. 650 pts — "Ironworks Sector" (Donkey Kong Country: Fear Factory Vibe)
  // 134 BPM · E Minor · 8 bars (128 steps)
  // 16-bit SNES industrial atmosphere, heavy driving synth bass & anvil clangs
  // =========================================================================
  fm_cartridge_drive: {
    bpm: 134,
    totalSteps: 128,
    chords: {
      0: { notes: [52, 55, 59, 64], steps: 15 }, // Em
      16: { notes: [48, 52, 55, 60], steps: 15 }, // C
      32: { notes: [50, 54, 57, 62], steps: 15 }, // D
      48: { notes: [47, 50, 54, 59], steps: 8 }, // Bm
      56: { notes: [47, 51, 54, 59], steps: 7 }, // B7
      64: { notes: [48, 52, 55, 60], steps: 15 }, // C
      80: { notes: [50, 54, 57, 62], steps: 15 }, // D
      96: { notes: [52, 55, 59, 64], steps: 15 }, // Em
      112: { notes: [45, 48, 52, 57], steps: 8 }, // Am
      120: { notes: [47, 51, 54, 59], steps: 7 }, // B7 turnaround
    },
    bass: concatBars(
      [40, null, 40, 52, 40, null, 40, 47, 40, null, 40, 52, 47, null, 43, 40],
      [36, null, 36, 48, 36, null, 36, 43, 36, null, 36, 48, 43, null, 40, 36],
      [38, null, 38, 50, 38, null, 38, 45, 38, null, 38, 50, 45, null, 42, 38],
      [35, null, 35, 47, 35, null, 35, 42, 35, null, 35, 47, 42, 43, 45, 39],
      [36, 36, 48, null, 36, 36, 48, null, 36, 36, 48, 43, 40, 43, 48, null],
      [38, 38, 50, null, 38, 38, 50, null, 38, 38, 50, 45, 42, 45, 50, null],
      [40, 40, 52, null, 40, 40, 52, null, 40, 40, 52, 47, 43, 47, 52, null],
      [33, 33, 45, null, 33, 33, 45, null, 35, 35, 47, null, 39, 42, 47, null],
    ),
    arp: concatBars(
      [64, 67, 71, null, 64, 67, 71, 76, 64, 67, 71, null, 76, 71, 67, null],
      [60, 64, 67, null, 60, 64, 67, 72, 60, 64, 67, null, 72, 67, 64, null],
      [62, 66, 69, null, 62, 66, 69, 74, 62, 66, 69, null, 74, 69, 66, null],
      [59, 62, 66, null, 59, 63, 66, 71, 66, 71, 75, null, 71, 66, 63, null],
      [60, 64, 67, 72, 67, 64, 60, 67, 60, 64, 67, 72, 76, 72, 67, 64],
      [62, 66, 69, 74, 69, 66, 62, 69, 62, 66, 69, 74, 78, 74, 69, 66],
      [64, 67, 71, 76, 71, 67, 64, 71, 64, 67, 71, 76, 79, 76, 71, 67],
      [57, 60, 64, 69, 64, 60, 57, 64, 59, 63, 66, 71, 75, 71, 66, 63],
    ),
    lead: concatBars(
      [s(76, 2), null, 79, null, s(76, 2), 74, 71, null, s(72, 2), null, 71, null, s(67, 4), null, null, null],
      [s(72, 2), null, 76, null, s(79, 2), 76, 74, null, s(72, 2), null, 71, null, s(67, 4), null, null, null],
      [s(74, 2), null, 78, null, s(81, 2), 78, 76, null, s(74, 2), null, 72, null, s(71, 4), null, null, null],
      [s(71, 2), null, 74, null, s(78, 2), 75, 71, null, s(75, 4), null, null, null, s(78, 2), null, 75, null],
      // B section: soaring DKC industrial hook
      [s(79, 4), null, null, 76, s(72, 3), null, null, 74, s(76, 4), null, null, null, s(79, 2), null, 76, null],
      [s(81, 4), null, null, 78, s(74, 3), null, null, 76, s(78, 4), null, null, null, s(81, 2), null, 78, null],
      [s(83, 4), null, null, 79, s(76, 3), null, null, 79, s(83, 4), null, null, null, s(86, 2), null, 83, null],
      [s(81, 4), null, null, 79, s(76, 2), null, 74, null, s(75, 6), null, null, null, null, null, 71, null],
    ),
    counter: concatBars(
      [null, null, null, null, null, null, null, null, null, null, null, null, 64, null, 67, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, 60, null, 64, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, 62, null, 66, null],
      [null, null, null, null, null, null, null, null, 63, null, 66, null, 71, null, null, null],
      [s(72, 4, 0.8), null, null, null, null, null, null, null, s(72, 4, 0.8), null, null, null, null, null, null, null],
      [s(74, 4, 0.8), null, null, null, null, null, null, null, s(74, 4, 0.8), null, null, null, null, null, null, null],
      [s(76, 4, 0.85), null, null, null, null, null, null, null, s(76, 4, 0.85), null, null, null, null, null, null, null],
      [s(72, 4, 0.8), null, null, null, null, null, null, null, s(71, 6, 0.85), null, null, null, null, null, null, null],
    ),
    kick: repeatBars([0, 3, 8, 10], BARS_0_TO_7),
    snare: [...repeatBars([4, 12], BARS_0_TO_7), 62, 126],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], BARS_0_TO_7),
    hatOpen: [6, 22, 38, 54, 70, 86, 102, 118],
    clang: repeatBars([0, 6, 12], BARS_0_TO_7),
    crash: [0, 64],
    toms: [
      { step: 60, midi: 55, vel: 0.9 },
      { step: 62, midi: 50, vel: 0.95 },
      { step: 124, midi: 59, vel: 0.9 },
      { step: 125, midi: 55, vel: 0.9 },
      { step: 126, midi: 50, vel: 1.0 },
    ],
    leadVoice: {
      waveform: 'sawtooth',
      fmRatio: 2,
      fmIndexHz: 140,
      cutoffHz: 2900,
      cutoffPeakHz: 3900,
      q: 2.2,
      attackSec: 0.006,
      releaseSec: 0.24,
      gain: 0.12,
      delaySend: 0.3,
      pan: 0.12,
      vibratoHz: 5.8,
      vibratoCents: 11,
      vibratoDelaySec: 0.15,
    },
    counterVoice: {
      waveform: 'square',
      detuneCents: 10,
      cutoffHz: 1900,
      attackSec: 0.015,
      releaseSec: 0.3,
      gain: 0.065,
      delaySend: 0.25,
      pan: -0.24,
    },
    arpVoice: {
      waveform: 'sine',
      fmRatio: 3,
      fmIndexHz: 130,
      cutoffHz: 2600,
      attackSec: 0.004,
      releaseSec: 0.11,
      gain: 0.068,
      delaySend: 0.22,
      pan: 0.25,
    },
    bassVoice: {
      waveform: 'sawtooth',
      fmRatio: 1,
      fmIndexHz: 120,
      cutoffHz: 680,
      cutoffPeakHz: 1450,
      q: 2.6,
      attackSec: 0.004,
      releaseSec: 0.15,
      gain: 0.22,
      driveAmount: 0.25,
      subOctaveGain: 0.32,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 14,
      cutoffHz: 980,
      attackSec: 0.12,
      releaseSec: 1.25,
      gain: 0.048,
      delaySend: 0.22,
      pan: -0.1,
    },
    drumGain: 0.21,
    delayFeedback: 0.3,
    delayMix: 0.24,
  },

  // =========================================================================
  // 5. 950 pts — "Ultra Combo" (Killer Instinct: The Instinct Arcade Vibe)
  // 116 BPM · E Minor / Phrygian · 8 bars (128 steps)
  // Saturated industrial metal chugs, heavy arcade synth stabs, breakbeat punch
  // =========================================================================
  subcarrier_pulse: {
    bpm: 116,
    totalSteps: 128,
    chords: {
      // Bar 0-3: Aggressive arcade stabs on riff turnarounds
      0: { notes: [52, 59, 64], steps: 4, vel: 1.1 },
      6: { notes: [53, 60, 65], steps: 3, vel: 1.0 },
      12: { notes: [55, 62, 67], steps: 4, vel: 1.1 },
      16: { notes: [52, 59, 64], steps: 4, vel: 1.1 },
      22: { notes: [58, 65, 70], steps: 3, vel: 1.1 },
      28: { notes: [57, 64, 69], steps: 4, vel: 1.0 },
      32: { notes: [52, 59, 64], steps: 4, vel: 1.1 },
      38: { notes: [53, 60, 65], steps: 3, vel: 1.0 },
      44: { notes: [55, 62, 67], steps: 4, vel: 1.1 },
      48: { notes: [58, 65, 70], steps: 6, vel: 1.15 },
      56: { notes: [57, 64, 69], steps: 4, vel: 1.05 },
      60: { notes: [55, 62, 67], steps: 4, vel: 1.05 },
      // Bar 4-7: Brooding character-select cinematic progression (Em -> Cmaj7 -> Am9 -> B7sus4/B7)
      64: { notes: [52, 55, 59, 64], steps: 15 },
      80: { notes: [48, 52, 55, 59], steps: 15 },
      96: { notes: [45, 52, 55, 59], steps: 15 },
      112: { notes: [47, 52, 54, 59], steps: 8 },
      120: { notes: [47, 51, 54, 59], steps: 7 },
    },
    bass: concatBars(
      [40, 40, 40, null, 40, 40, 41, null, 40, 40, 40, null, 43, null, 40, null],
      [40, 40, 40, null, 40, 40, 46, null, 40, 40, 40, null, 45, null, 43, 41],
      [40, 40, 40, null, 40, 40, 41, null, 40, 40, 40, null, 43, null, 45, 43],
      [46, null, 46, null, 40, 40, 45, null, 43, null, 41, null, 40, 43, 45, 47],
      // B section: atmospheric sustained bass
      [s(40, 6), null, null, null, null, null, s(40, 2), null, s(47, 4), null, null, null, s(43, 3), null, null, null],
      [s(36, 6), null, null, null, null, null, s(36, 2), null, s(43, 4), null, null, null, s(40, 3), null, null, null],
      [s(33, 6), null, null, null, null, null, s(33, 2), null, s(40, 4), null, null, null, s(38, 3), null, null, null],
      [s(35, 6), null, null, null, null, null, s(35, 2), null, s(42, 4), null, null, null, s(47, 2), 45, 43, 41],
    ),
    accentSteps: [0, 6, 12, 16, 22, 28, 32, 38, 44, 48, 56, 60],
    arp: concatBars(
      [52, null, 59, null, 64, null, 53, null, 52, null, 59, null, 67, null, 64, null],
      [52, null, 59, null, 64, null, 58, null, 52, null, 59, null, 69, null, 67, null],
      [52, null, 59, null, 64, null, 53, null, 52, null, 59, null, 67, null, 69, null],
      [58, null, 65, null, 64, null, 57, null, 55, null, 53, null, 52, 55, 57, 59],
      [64, null, 67, null, 71, null, 74, null, 71, null, 67, null, 64, null, 71, null],
      [60, null, 64, null, 67, null, 71, null, 67, null, 64, null, 60, null, 67, null],
      [57, null, 60, null, 64, null, 67, null, 64, null, 60, null, 57, null, 64, null],
      [59, null, 64, null, 66, null, 71, null, 66, null, 63, null, 59, null, null, null],
    ),
    lead: concatBars(
      [s(64, 4, 1.05), null, null, null, s(65, 2, 1.0), null, null, null, s(67, 4, 1.05), null, null, null, null, null, 64, null],
      [s(64, 4, 1.05), null, null, null, s(70, 3, 1.1), null, null, null, s(69, 3, 1.0), null, null, 67, s(65, 2), null, 64, null],
      [s(76, 4, 1.05), null, null, null, s(77, 2, 1.0), null, null, null, s(79, 4, 1.1), null, null, null, s(76, 2), null, 74, null],
      [s(82, 4, 1.1), null, null, null, s(81, 3, 1.05), null, null, null, s(79, 3, 1.0), null, null, 77, s(76, 2), null, null, null],
      // B section: atmospheric fighting-game select lead
      [s(76, 6, 0.9), null, null, null, null, null, s(79, 2), null, s(78, 6, 0.9), null, null, null, null, null, null, null],
      [s(76, 6, 0.9), null, null, null, null, null, s(74, 2), null, s(72, 6, 0.9), null, null, null, null, null, null, null],
      [s(71, 6, 0.9), null, null, null, null, null, s(72, 2), null, s(74, 6, 0.95), null, null, null, null, null, null, null],
      [s(76, 4, 0.95), null, null, null, s(74, 2), null, 72, null, s(71, 6, 1.0), null, null, null, null, null, null, null],
    ),
    kick: [...repeatBars([0, 3, 6, 10, 12], [0, 1, 2, 3]), ...repeatBars([0, 6, 8, 14], [4, 5, 6, 7])],
    snare: [...repeatBars([4, 12], BARS_0_TO_7), 62, 125, 126],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], BARS_0_TO_7),
    hatOpen: [14, 30, 46, 62, 78, 94, 110, 126],
    clang: repeatBars([0, 6, 12], [0, 1, 2, 3]),
    crash: [0, 48, 64],
    toms: [
      { step: 61, midi: 57, vel: 0.95 },
      { step: 62, midi: 53, vel: 1.0 },
      { step: 63, midi: 48, vel: 1.0 },
      { step: 124, midi: 57, vel: 0.95 },
      { step: 125, midi: 54, vel: 0.95 },
      { step: 126, midi: 50, vel: 1.0 },
      { step: 127, midi: 47, vel: 1.0 },
    ],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 14,
      cutoffHz: 2200,
      cutoffPeakHz: 3600,
      q: 2.8,
      attackSec: 0.008,
      releaseSec: 0.28,
      gain: 0.115,
      driveAmount: 0.55,
      delaySend: 0.32,
      pan: 0.1,
      vibratoHz: 5.6,
      vibratoCents: 13,
      vibratoDelaySec: 0.14,
    },
    arpVoice: {
      waveform: 'square',
      cutoffHz: 1950,
      q: 2.0,
      attackSec: 0.004,
      releaseSec: 0.11,
      gain: 0.065,
      driveAmount: 0.35,
      delaySend: 0.22,
      pan: -0.22,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 480,
      cutoffPeakHz: 1650,
      q: 3.0,
      attackSec: 0.004,
      releaseSec: 0.14,
      gain: 0.22,
      driveAmount: 0.65,
      subOctaveGain: 0.4,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 16,
      cutoffHz: 1450,
      cutoffPeakHz: 2600,
      q: 2.2,
      attackSec: 0.015,
      releaseSec: 0.55,
      gain: 0.06,
      driveAmount: 0.3,
      delaySend: 0.28,
      pan: 0.16,
    },
    drumGain: 0.24,
    delayFeedback: 0.32,
    delayMix: 0.24,
  },

  // =========================================================================
  // 6. 1,300 pts — "Phobos Gate" (Doom E1M1 - At Doom's Gate Vibe)
  // 122 BPM · E Minor · 8 bars (128 steps)
  // Relentless 16th-note OPL2 overdrive pedal-E thrash riff, twin-lead harmonies
  // =========================================================================
  cyberdeck_horizon: {
    bpm: 122,
    totalSteps: 128,
    chords: {
      // Punchy power-chord hits underneath the B-section bridge
      64: { notes: [48, 55, 60], steps: 12, vel: 1.05 }, // C5
      80: { notes: [50, 57, 62], steps: 12, vel: 1.05 }, // D5
      96: { notes: [52, 59, 64], steps: 12, vel: 1.05 }, // E5
      112: { notes: [46, 53, 58], steps: 6, vel: 1.05 }, // Bb5
      118: { notes: [47, 54, 59], steps: 6, vel: 1.1 }, // B5
    },
    // Original pedal-E thrash phrasing in the spirit of 90s DOS OPL2 metal
    bass: concatBars(
      [40, 40, 52, 40, 40, 50, 40, 40, 48, 40, 40, 46, 40, 40, 47, 48],
      [40, 40, 52, 40, 40, 50, 40, 40, 48, 40, 40, 46, null, null, 43, 45],
      [40, 40, 52, 40, 40, 50, 40, 40, 48, 40, 40, 46, 40, 40, 47, 48],
      [45, 45, 57, 45, 45, 55, 45, 45, 53, 45, 45, 51, 45, 47, 48, 50],
      // B Section: heavy triplet-feel pedal shift C -> D -> E -> Bb/B chromatic climb
      [36, 36, 36, 48, 36, 36, 36, 48, 36, 36, 36, 48, 36, 43, 40, 36],
      [38, 38, 38, 50, 38, 38, 38, 50, 38, 38, 38, 50, 38, 45, 42, 38],
      [40, 40, 40, 52, 40, 40, 40, 52, 40, 40, 40, 52, 40, 47, 43, 40],
      [34, 34, 46, null, 34, 46, 35, 35, 47, null, 35, 47, 40, 43, 45, 47],
    ),
    accentSteps: [2, 5, 8, 11, 14, 18, 21, 24, 27, 34, 37, 40, 43, 50, 53, 56, 59],
    arp: concatBars(
      [52, 52, 64, 52, 52, 62, 52, 52, 60, 52, 52, 58, 52, 52, 59, 60],
      [52, 52, 64, 52, 52, 62, 52, 52, 60, 52, 52, 58, null, null, 55, 57],
      [52, 52, 64, 52, 52, 62, 52, 52, 60, 52, 52, 58, 52, 52, 59, 60],
      [57, 57, 69, 57, 57, 67, 57, 57, 65, 57, 57, 63, 57, 59, 60, 62],
      [60, 64, 67, 72, 67, 64, 60, 67, 60, 64, 67, 72, 76, 72, 67, 64],
      [62, 66, 69, 74, 69, 66, 62, 69, 62, 66, 69, 74, 78, 74, 69, 66],
      [64, 67, 71, 76, 71, 67, 64, 71, 64, 67, 71, 76, 79, 76, 71, 67],
      [58, 62, 65, null, 58, 62, 59, 63, 66, null, 66, 71, 75, 71, 66, 63],
    ),
    lead: concatBars(
      [null, null, 76, null, null, 74, null, null, 72, null, null, 70, null, null, 71, 72],
      [null, null, 76, null, null, 74, null, null, 72, null, null, s(70, 3), null, null, 67, 69],
      [s(76, 2), null, 79, null, null, 78, null, null, 76, null, null, 74, null, null, 75, 76],
      [s(81, 2), null, 84, null, null, 83, null, null, 81, null, null, 79, null, null, 78, 79],
      // B section: screaming harmonized solo over C -> D -> E -> Bb/B
      [s(72, 4, 1.05), null, null, 74, s(76, 4, 1.05), null, null, 79, s(76, 4, 1.05), null, null, null, null, null, 74, null],
      [s(74, 4, 1.05), null, null, 76, s(78, 4, 1.05), null, null, 81, s(78, 4, 1.05), null, null, null, null, null, 76, null],
      [s(79, 4, 1.1), null, null, 78, s(76, 4, 1.1), null, null, 79, s(83, 6, 1.1), null, null, null, null, null, null, null],
      [s(82, 3, 1.1), null, null, 81, 79, null, s(83, 3, 1.1), null, null, 81, 79, null, s(76, 4, 1.1), null, null, null],
    ),
    counter: concatBars(
      // Twin-guitar 3rds / 5ths harmony
      [null, null, 71, null, null, 69, null, null, 67, null, null, 65, null, null, 66, 67],
      [null, null, 71, null, null, 69, null, null, 67, null, null, s(65, 3), null, null, 62, 64],
      [s(71, 2), null, 74, null, null, 72, null, null, 71, null, null, 69, null, null, 70, 71],
      [s(76, 2), null, 79, null, null, 77, null, null, 76, null, null, 74, null, null, 72, 74],
      [s(67, 4), null, null, 69, s(71, 4), null, null, 74, s(72, 4), null, null, null, null, null, 69, null],
      [s(69, 4), null, null, 71, s(74, 4), null, null, 76, s(74, 4), null, null, null, null, null, 71, null],
      [s(74, 4), null, null, 72, s(71, 4), null, null, 74, s(76, 6), null, null, null, null, null, null, null],
      [s(77, 3), null, null, 76, 74, null, s(78, 3), null, null, 76, 75, null, s(71, 4), null, null, null],
    ),
    kick: [
      ...repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 3]),
      ...repeatBars([0, 1, 4, 8, 9, 12], [4, 5, 6, 7]),
    ],
    snare: [...repeatBars([4, 12], BARS_0_TO_7), 30, 62, 94, 126],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], BARS_0_TO_7),
    hatOpen: [14, 46, 78, 110],
    crash: [0, 32, 64, 96, 112],
    toms: [
      { step: 60, midi: 57, vel: 0.95 },
      { step: 61, midi: 54, vel: 0.95 },
      { step: 62, midi: 50, vel: 1.0 },
      { step: 63, midi: 47, vel: 1.0 },
      { step: 124, midi: 59, vel: 0.95 },
      { step: 125, midi: 55, vel: 0.95 },
      { step: 126, midi: 52, vel: 1.0 },
      { step: 127, midi: 47, vel: 1.0 },
    ],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 12,
      fmRatio: 2,
      fmIndexHz: 110,
      cutoffHz: 2500,
      cutoffPeakHz: 4000,
      q: 2.5,
      attackSec: 0.004,
      releaseSec: 0.22,
      gain: 0.11,
      driveAmount: 0.72,
      delaySend: 0.24,
      pan: 0.16,
      vibratoHz: 6.2,
      vibratoCents: 14,
      vibratoDelaySec: 0.12,
    },
    counterVoice: {
      waveform: 'sawtooth',
      detuneCents: 8,
      cutoffHz: 2200,
      cutoffPeakHz: 3400,
      q: 2.2,
      attackSec: 0.004,
      releaseSec: 0.2,
      gain: 0.08,
      driveAmount: 0.68,
      delaySend: 0.22,
      pan: -0.22,
    },
    arpVoice: {
      waveform: 'sawtooth',
      cutoffHz: 1750,
      q: 2.2,
      attackSec: 0.003,
      releaseSec: 0.09,
      gain: 0.062,
      driveAmount: 0.55,
      delaySend: 0.12,
      pan: -0.14,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 520,
      cutoffPeakHz: 1750,
      q: 3.1,
      attackSec: 0.003,
      releaseSec: 0.12,
      gain: 0.215,
      driveAmount: 0.78,
      subOctaveGain: 0.36,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 14,
      cutoffHz: 1500,
      attackSec: 0.012,
      releaseSec: 0.45,
      gain: 0.055,
      driveAmount: 0.5,
      delaySend: 0.18,
      pan: 0.08,
    },
    drumGain: 0.23,
    delayFeedback: 0.26,
    delayMix: 0.2,
  },

  // =========================================================================
  // 7. 1,650 pts — "Lunar Core: Final Phase" (FFIV: The Final Battle ~ Zeromus Vibe)
  // 156 BPM · G Minor · 12 bars (192 steps: Fanfare Intro + Frantic Battle A + Dramatic Bridge B)
  // Apocalyptic SNES final boss anthem: gothic organ stabs, harmonic minor sweeps & timpani
  // =========================================================================
  broadcast_finale: {
    bpm: 156,
    totalSteps: 192,
    chords: {
      // Bars 0-3: Apocalyptic gothic organ / brass fanfare stabs
      0: { notes: [55, 58, 62, 67], steps: 10, vel: 1.15 }, // Gm
      12: { notes: [51, 55, 58, 63], steps: 4, vel: 1.05 }, // Eb
      16: { notes: [54, 57, 60, 66], steps: 10, vel: 1.15 }, // D7/F#
      28: { notes: [55, 58, 62, 67], steps: 4, vel: 1.1 }, // Gm
      32: { notes: [48, 55, 58, 63], steps: 12, vel: 1.1 }, // Cm7
      48: { notes: [50, 54, 57, 62], steps: 14, vel: 1.15 }, // D7
      // Bars 4-7: Frantic Battle A (Gm -> Eb -> F -> Dm7/D7)
      64: { notes: [55, 58, 62], steps: 6 },
      72: { notes: [55, 58, 62], steps: 6 },
      80: { notes: [51, 55, 58], steps: 6 },
      88: { notes: [51, 55, 58], steps: 6 },
      96: { notes: [53, 57, 60], steps: 6 },
      104: { notes: [53, 57, 60], steps: 6 },
      112: { notes: [50, 54, 57, 60], steps: 14 },
      // Bars 8-11: Heroic Tragic Bridge B (Cm -> F -> Bbmaj7 -> Ebmaj7 -> D7)
      128: { notes: [48, 51, 55, 60], steps: 14 },
      144: { notes: [53, 57, 60, 65], steps: 14 },
      160: { notes: [46, 53, 57, 62], steps: 14 },
      176: { notes: [51, 55, 58, 62], steps: 7 },
      184: { notes: [50, 54, 57, 62], steps: 7 },
    },
    bass: concatBars(
      // Intro Fanfare Bars 0-3
      [s(43, 6), null, null, null, null, null, 43, null, 43, null, null, null, s(39, 4), null, null, null],
      [s(42, 6), null, null, null, null, null, 42, null, 42, null, null, null, s(43, 4), null, null, null],
      [36, null, 48, null, 36, null, 48, null, 36, null, 48, null, 39, null, 43, null],
      [38, null, 50, null, 38, null, 50, null, 38, 38, 50, null, 42, 45, 50, null],
      // Frantic Battle A Bars 4-7
      [43, 43, 55, null, 43, 43, 55, null, 43, 43, 55, null, 46, null, 50, null],
      [39, 39, 51, null, 39, 39, 51, null, 39, 39, 51, null, 43, null, 46, null],
      [41, 41, 53, null, 41, 41, 53, null, 41, 41, 53, null, 45, null, 48, null],
      [38, 38, 50, null, 38, 38, 50, null, 42, 42, 54, null, 45, null, 50, null],
      // Tragic Bridge B Bars 8-11
      [36, null, 48, null, 36, null, 48, null, 36, null, 48, null, 43, null, 48, null],
      [41, null, 53, null, 41, null, 53, null, 41, null, 53, null, 45, null, 48, null],
      [34, null, 46, null, 34, null, 46, null, 34, null, 46, null, 41, null, 46, null],
      [39, null, 51, null, 39, null, 51, null, 38, null, 50, null, 42, 45, 50, 54],
    ),
    arp: concatBars(
      // Bars 0-3: Sweeping baroque boss arpeggios
      [67, 70, 74, 79, 74, 70, 67, 74, 67, 70, 74, 79, 75, 70, 67, 63],
      [66, 69, 72, 78, 72, 69, 66, 72, 66, 69, 72, 78, 79, 74, 70, 67],
      [60, 63, 67, 72, 67, 63, 60, 67, 60, 63, 67, 72, 75, 72, 67, 63],
      [62, 66, 69, 74, 69, 66, 62, 69, 62, 66, 69, 74, 78, 74, 69, 66],
      // Bars 4-7: Relentless 16th-note battle arps
      [67, 70, 74, 79, 74, 70, 67, 74, 67, 70, 74, 79, 82, 79, 74, 70],
      [63, 67, 70, 75, 70, 67, 63, 70, 63, 67, 70, 75, 79, 75, 70, 67],
      [65, 69, 72, 77, 72, 69, 65, 72, 65, 69, 72, 77, 81, 77, 72, 69],
      [62, 66, 69, 74, 69, 66, 62, 69, 66, 69, 72, 78, 81, 78, 74, 69],
      // Bars 8-11
      [60, 63, 67, 72, 67, 63, 60, 67, 60, 63, 67, 72, 75, 72, 67, 63],
      [65, 69, 72, 77, 72, 69, 65, 72, 65, 69, 72, 77, 81, 77, 72, 69],
      [58, 62, 65, 70, 65, 62, 58, 65, 58, 62, 65, 70, 74, 70, 65, 62],
      [63, 67, 70, 75, 70, 67, 63, 70, 62, 66, 69, 74, 78, 74, 69, 66],
    ),
    lead: concatBars(
      // Bars 0-3: Fanfare proclamation
      [s(79, 6, 1.05), null, null, null, null, null, 74, null, 79, null, null, null, s(82, 4, 1.05), null, null, null],
      [s(81, 6, 1.05), null, null, null, null, null, 78, null, 81, null, null, null, s(79, 4, 1.05), null, null, null],
      [s(75, 2), null, 74, null, s(72, 2), null, 74, null, s(75, 4), null, null, null, s(79, 4), null, null, null],
      [s(78, 6, 1.05), null, null, null, null, null, 74, null, s(81, 6, 1.1), null, null, null, null, null, null, null],
      // Bars 4-7: Frantic SNES boss melody
      [s(79, 2), null, 82, null, s(86, 2), null, 82, null, s(79, 2), null, 81, null, s(82, 3), null, null, null],
      [s(87, 2), null, 86, null, s(82, 2), null, 79, null, s(82, 2), null, 79, null, s(75, 3), null, null, null],
      [s(77, 2), null, 81, null, s(84, 2), null, 81, null, s(77, 2), null, 79, null, s(81, 3), null, null, null],
      [s(86, 2), null, 84, null, s(81, 2), null, 78, null, s(81, 4), null, null, null, s(86, 2), null, 84, null],
      // Bars 8-11: Heroic tragic climax
      [s(84, 4, 1.05), null, null, 82, s(79, 4), null, null, 75, s(79, 4), null, null, null, s(84, 2), null, 82, null],
      [s(81, 4, 1.05), null, null, 79, s(77, 4), null, null, 74, s(77, 4), null, null, null, s(81, 2), null, 79, null],
      [s(82, 4, 1.05), null, null, 81, s(77, 4), null, null, 74, s(77, 4), null, null, null, s(82, 2), null, 84, null],
      [s(87, 4, 1.1), null, null, 86, s(82, 2), null, 79, null, s(81, 6, 1.15), null, null, null, null, null, 78, null],
    ),
    counter: concatBars(
      // Dual orchestral string/brass counterpoint
      [s(74, 6, 0.85), null, null, null, null, null, 70, null, 74, null, null, null, s(75, 4), null, null, null],
      [s(74, 6, 0.85), null, null, null, null, null, 72, null, 74, null, null, null, s(74, 4), null, null, null],
      [s(72, 4), null, null, null, s(67, 4), null, null, null, s(72, 4), null, null, null, s(75, 4), null, null, null],
      [s(74, 8), null, null, null, null, null, null, null, s(78, 6), null, null, null, null, null, null, null],
      [s(74, 4), null, null, null, s(79, 4), null, null, null, s(74, 4), null, null, null, s(79, 4), null, null, null],
      [s(75, 4), null, null, null, s(79, 4), null, null, null, s(75, 4), null, null, null, s(79, 4), null, null, null],
      [s(72, 4), null, null, null, s(77, 4), null, null, null, s(72, 4), null, null, null, s(77, 4), null, null, null],
      [s(74, 4), null, null, null, s(78, 4), null, null, null, s(78, 4), null, null, null, s(81, 4), null, null, null],
      [s(75, 4), null, null, null, s(72, 4), null, null, null, s(75, 4), null, null, null, s(79, 4), null, null, null],
      [s(77, 4), null, null, null, s(72, 4), null, null, null, s(77, 4), null, null, null, s(81, 4), null, null, null],
      [s(74, 4), null, null, null, s(70, 4), null, null, null, s(74, 4), null, null, null, s(79, 4), null, null, null],
      [s(79, 4), null, null, null, s(75, 4), null, null, null, s(74, 6), null, null, null, null, null, null, null],
    ),
    kick: [
      ...repeatBars([0, 6, 8, 12], [0, 1]),
      ...repeatBars([0, 4, 8, 12], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ],
    snare: [
      ...repeatBars([4, 12], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
      58, 60, 62, 124, 126, 188, 190,
    ],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatOpen: [46, 62, 78, 94, 110, 126, 142, 158, 174, 190],
    crash: [0, 16, 32, 64, 96, 128, 160, 176],
    toms: [
      // Timpani boss intro & transition fills
      { step: 0, midi: 43, vel: 1.05 },
      { step: 12, midi: 39, vel: 1.0 },
      { step: 16, midi: 42, vel: 1.05 },
      { step: 28, midi: 43, vel: 1.0 },
      { step: 60, midi: 50, vel: 0.95 },
      { step: 61, midi: 48, vel: 0.95 },
      { step: 62, midi: 45, vel: 1.0 },
      { step: 63, midi: 43, vel: 1.0 },
      { step: 124, midi: 50, vel: 0.95 },
      { step: 125, midi: 46, vel: 0.95 },
      { step: 126, midi: 43, vel: 1.0 },
      { step: 188, midi: 54, vel: 0.95 },
      { step: 189, midi: 50, vel: 0.95 },
      { step: 190, midi: 46, vel: 1.0 },
      { step: 191, midi: 43, vel: 1.05 },
    ],
    leadVoice: {
      waveform: 'square',
      detuneCents: 11,
      cutoffHz: 3400,
      cutoffPeakHz: 4600,
      q: 1.9,
      attackSec: 0.006,
      releaseSec: 0.24,
      gain: 0.11,
      delaySend: 0.34,
      pan: 0.14,
      vibratoHz: 6.2,
      vibratoCents: 13,
      vibratoDelaySec: 0.12,
    },
    counterVoice: {
      waveform: 'sawtooth',
      detuneCents: 14,
      cutoffHz: 2400,
      attackSec: 0.025,
      releaseSec: 0.38,
      gain: 0.072,
      delaySend: 0.3,
      pan: -0.22,
    },
    arpVoice: {
      waveform: 'triangle',
      fmRatio: 2,
      fmIndexHz: 85,
      cutoffHz: 3100,
      attackSec: 0.004,
      releaseSec: 0.1,
      gain: 0.068,
      delaySend: 0.22,
      pan: 0.24,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 480,
      cutoffPeakHz: 1550,
      q: 2.8,
      attackSec: 0.004,
      releaseSec: 0.14,
      gain: 0.22,
      driveAmount: 0.3,
      subOctaveGain: 0.35,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 18,
      cutoffHz: 1950,
      cutoffPeakHz: 3000,
      q: 1.8,
      attackSec: 0.015,
      releaseSec: 0.55,
      gain: 0.065,
      delaySend: 0.32,
      pan: -0.1,
    },
    drumGain: 0.225,
    delayFeedback: 0.34,
    delayMix: 0.27,
  },
};

class RetroMusicSequencer {
  private ctx: AudioContext | null = null;
  private mixBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayReturnGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private freqBins: Uint8Array<ArrayBuffer> | null = null;
  private driveCurves = new Map<number, Float32Array<ArrayBuffer>>();

  private playing = false;
  private currentTrackId: MusicTrackId = STARTER_TRACK_ID;
  private volumePct = 45;
  private muted = false;
  private sustainedDuck = false;
  private transientDuckUntilMs = 0;
  private duckReleaseTimer: number | null = null;

  private schedulerTimer: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private loopsCompleted = 0;
  private onLoopComplete: ((trackId: MusicTrackId, loopsCompleted: number) => void) | null = null;

  setLoopCompleteHandler(
    handler: ((trackId: MusicTrackId, loopsCompleted: number) => void) | null,
  ): void {
    this.onLoopComplete = handler;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getTrackId(): MusicTrackId {
    return this.currentTrackId;
  }

  private ensureAudioGraph(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        const ctx = new AudioCtx();
        const mixBus = ctx.createGain();
        mixBus.gain.value = 1;

        const masterFilter = ctx.createBiquadFilter();
        masterFilter.type = 'lowpass';
        masterFilter.frequency.value = 11500;
        masterFilter.Q.value = 0.6;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -15;
        compressor.knee.value = 18;
        compressor.ratio.value = 4.2;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.15;

        const duckGain = ctx.createGain();
        duckGain.gain.value = this.computeDuckTarget();

        const volumeGain = ctx.createGain();
        volumeGain.gain.value = this.computeVolumeTarget();

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;

        // Parallel dotted-8th tempo-synced stereo echo bus
        const delayNode = ctx.createDelay(1.5);
        delayNode.delayTime.value = 0.34;
        const delayFilter = ctx.createBiquadFilter();
        delayFilter.type = 'lowpass';
        delayFilter.frequency.value = 2400;
        const delayFeedbackGain = ctx.createGain();
        delayFeedbackGain.gain.value = 0.28;
        const delayReturnGain = ctx.createGain();
        delayReturnGain.gain.value = 0.24;

        delayNode.connect(delayFilter);
        delayFilter.connect(delayFeedbackGain);
        delayFeedbackGain.connect(delayNode);
        delayFilter.connect(delayReturnGain);
        delayReturnGain.connect(mixBus);

        mixBus.connect(masterFilter);
        masterFilter.connect(compressor);
        compressor.connect(duckGain);
        duckGain.connect(volumeGain);
        volumeGain.connect(analyser);
        analyser.connect(ctx.destination);

        this.ctx = ctx;
        this.mixBus = mixBus;
        this.duckGain = duckGain;
        this.volumeGain = volumeGain;
        this.analyser = analyser;
        this.delayNode = delayNode;
        this.delayFeedbackGain = delayFeedbackGain;
        this.delayReturnGain = delayReturnGain;
        this.freqBins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate * 0.75);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private getDriveCurve(amount: number): Float32Array<ArrayBuffer> {
    const key = Math.max(1, Math.min(100, Math.round(amount * 100)));
    const cached = this.driveCurves.get(key);
    if (cached) return cached;

    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const drive = 1 + (key / 100) * 14;
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(drive * x) / norm;
    }
    this.driveCurves.set(key, curve);
    return curve;
  }

  private connectWithPan(ctx: AudioContext, source: AudioNode, pan: number | undefined, dest: AudioNode): void {
    if (pan && Math.abs(pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      source.connect(panner);
      panner.connect(dest);
      return;
    }
    source.connect(dest);
  }

  private computeVolumeTarget(): number {
    if (this.muted || this.volumePct <= 0) return 0.0001;
    const norm = Math.max(0, Math.min(1, this.volumePct / 100));
    return Math.max(0.0001, Math.pow(norm, 1.45) * 0.56);
  }

  private computeDuckTarget(): number {
    const transientActive = Date.now() < this.transientDuckUntilMs;
    if (this.sustainedDuck && transientActive) return 0.14;
    if (this.sustainedDuck) return 0.22;
    if (transientActive) return 0.24;
    return 1.0;
  }

  private applyVolumeRamp(timeConstant = 0.05): void {
    if (!this.ctx || !this.volumeGain) return;
    const now = this.ctx.currentTime;
    const target = this.playing ? this.computeVolumeTarget() : 0.0001;
    this.volumeGain.gain.cancelScheduledValues(now);
    this.volumeGain.gain.setTargetAtTime(target, now, timeConstant);
  }

  private applyDuckRamp(timeConstant = 0.05): void {
    if (!this.ctx || !this.duckGain) return;
    const now = this.ctx.currentTime;
    const target = this.computeDuckTarget();
    this.duckGain.gain.cancelScheduledValues(now);
    this.duckGain.gain.setTargetAtTime(target, now, timeConstant);
  }

  private syncTrackDelay(): void {
    if (!this.ctx || !this.delayNode || !this.delayFeedbackGain || !this.delayReturnGain) return;
    const score = TRACK_SCORES[this.currentTrackId];
    const sixteenth = 60 / score.bpm / 4;
    const dottedEighth = Math.min(1.2, Math.max(0.14, sixteenth * 3));
    const now = this.ctx.currentTime;
    this.delayNode.delayTime.setTargetAtTime(dottedEighth, now, 0.08);
    this.delayFeedbackGain.gain.setTargetAtTime(score.delayFeedback, now, 0.08);
    this.delayReturnGain.gain.setTargetAtTime(score.delayMix, now, 0.08);
  }

  setVolume(volumePct: number): void {
    this.volumePct = Math.max(0, Math.min(100, Math.round(volumePct)));
    this.applyVolumeRamp(0.03);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumeRamp(0.035);
  }

  setSustainedDuck(active: boolean): void {
    if (this.sustainedDuck === active) return;
    this.sustainedDuck = active;
    this.applyDuckRamp(active ? 0.06 : 0.22);
  }

  duckFor(durationMs: number): void {
    if (!this.playing) return;
    const clampedMs = Math.max(300, Math.min(3500, Math.round(durationMs)));
    const targetEnd = Date.now() + clampedMs;
    if (targetEnd > this.transientDuckUntilMs) {
      this.transientDuckUntilMs = targetEnd;
    }
    this.applyDuckRamp(0.035);

    if (this.duckReleaseTimer !== null) {
      window.clearTimeout(this.duckReleaseTimer);
    }
    const waitMs = Math.max(50, this.transientDuckUntilMs - Date.now() + 20);
    this.duckReleaseTimer = window.setTimeout(() => {
      this.duckReleaseTimer = null;
      this.applyDuckRamp(0.24);
    }, waitMs);
  }

  play(trackId?: MusicTrackId): boolean {
    if (trackId && trackId in TRACK_SCORES) {
      if (trackId !== this.currentTrackId) {
        this.currentTrackId = trackId;
        this.currentStep = 0;
        this.loopsCompleted = 0;
      }
    }

    const ctx = this.ensureAudioGraph();
    if (!ctx) return false;

    this.playing = true;
    this.syncTrackDelay();
    this.applyDuckRamp(0.05);
    this.applyVolumeRamp(0.08);

    if (this.schedulerTimer === null) {
      this.nextStepTime = ctx.currentTime + 0.04;
      this.schedulerTimer = window.setInterval(() => this.scheduleAhead(), LOOKAHEAD_MS);
    }
    return true;
  }

  pause(): void {
    this.playing = false;
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.applyVolumeRamp(0.05);
  }

  switchTrack(trackId: MusicTrackId): void {
    if (!(trackId in TRACK_SCORES)) return;
    const wasPlaying = this.playing;
    this.currentTrackId = trackId;
    this.currentStep = 0;
    this.loopsCompleted = 0;

    if (wasPlaying) {
      const ctx = this.ensureAudioGraph();
      if (ctx) {
        this.syncTrackDelay();
        if (this.volumeGain) {
          const now = ctx.currentTime;
          this.volumeGain.gain.cancelScheduledValues(now);
          this.volumeGain.gain.setTargetAtTime(0.0001, now, 0.03);
          this.volumeGain.gain.setTargetAtTime(this.computeVolumeTarget(), now + 0.08, 0.08);
        }
        this.nextStepTime = ctx.currentTime + 0.09;
      }
    }
  }

  getSpectrumLevels(barCount: number): number[] {
    const count = Math.max(1, barCount);
    if (!this.playing || this.muted || this.volumePct <= 0 || !this.analyser || !this.freqBins) {
      return new Array<number>(count).fill(0);
    }
    this.analyser.getByteFrequencyData(this.freqBins);
    const startBin = 1;
    const endBin = Math.min(this.freqBins.length, 26);
    const usable = Math.max(1, endBin - startBin);
    const out = new Array<number>(count);
    for (let i = 0; i < count; i += 1) {
      const from = startBin + Math.floor((i * usable) / count);
      const to = Math.max(from + 1, startBin + Math.floor(((i + 1) * usable) / count));
      let sum = 0;
      for (let b = from; b < to && b < this.freqBins.length; b += 1) {
        sum += this.freqBins[b];
      }
      const avg = sum / Math.max(1, to - from);
      const norm = Math.min(1, Math.pow(avg / 215, 0.85));
      out[i] = norm;
    }
    return out;
  }

  private scheduleAhead(): void {
    if (!this.playing || !this.ctx || !this.mixBus) return;
    const score = TRACK_SCORES[this.currentTrackId];
    const sixteenthDur = 60 / score.bpm / 4;

    if (this.nextStepTime < this.ctx.currentTime - 0.35) {
      this.nextStepTime = this.ctx.currentTime + 0.04;
    }

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this.scheduleStep(this.currentStep, this.nextStepTime, sixteenthDur, score);
      this.nextStepTime += sixteenthDur;
      this.currentStep = (this.currentStep + 1) % score.totalSteps;

      if (this.currentStep === 0) {
        this.loopsCompleted += 1;
        const completedTrack = this.currentTrackId;
        const completedCount = this.loopsCompleted;
        const trackMeta = SOUNDTRACK_TRACK_BY_ID[completedTrack];
        if (trackMeta && this.onLoopComplete) {
          this.onLoopComplete(completedTrack, completedCount);
        }
      }
    }
  }

  private resolveNoteCell(
    cell: NoteCell | undefined,
    defaultSteps: number,
  ): { midi: number; steps: number; vel: number } | null {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === 'number') {
      return { midi: cell, steps: defaultSteps, vel: 1 };
    }
    return {
      midi: cell[0],
      steps: Math.max(0.5, cell[1] ?? defaultSteps),
      vel: cell[2] ?? 1,
    };
  }

  private scheduleStep(
    step: number,
    time: number,
    sixteenthDur: number,
    score: TrackScore,
  ): void {
    const isAccented = Boolean(score.accentSteps?.includes(step));

    // 1. Chord Pad / Stabs
    const chordSpec = score.chords[step];
    if (chordSpec) {
      const isRichChord = !Array.isArray(chordSpec) && 'notes' in chordSpec;
      const notes: readonly number[] = isRichChord ? chordSpec.notes : (chordSpec as readonly number[]);
      const chordSteps = isRichChord && chordSpec.steps ? chordSpec.steps : null;
      const chordVel = isRichChord && chordSpec.vel ? chordSpec.vel : 1;
      const dur = chordSteps
        ? Math.max(sixteenthDur * 1.5, sixteenthDur * chordSteps)
        : Math.max(sixteenthDur * 2, score.padVoice.releaseSec);
      for (const midi of notes) {
        this.triggerSynthVoice(midiToHz(midi), time, dur, score.padVoice, false, chordVel);
      }
    }

    // 2. Bassline
    const bassNote = this.resolveNoteCell(score.bass[step], 1.45);
    if (bassNote) {
      this.triggerSynthVoice(
        midiToHz(bassNote.midi),
        time,
        sixteenthDur * bassNote.steps,
        score.bassVoice,
        isAccented,
        bassNote.vel,
      );
    }

    // 3. Arpeggio
    const arpNote = this.resolveNoteCell(score.arp[step], 0.95);
    if (arpNote) {
      this.triggerSynthVoice(
        midiToHz(arpNote.midi),
        time,
        sixteenthDur * arpNote.steps,
        score.arpVoice,
        false,
        arpNote.vel,
      );
    }

    // 4. Counter-melody / Harmony Guitar / Strings
    if (score.counter && score.counterVoice) {
      const counterNote = this.resolveNoteCell(score.counter[step], 1.8);
      if (counterNote) {
        this.triggerSynthVoice(
          midiToHz(counterNote.midi),
          time,
          sixteenthDur * counterNote.steps,
          score.counterVoice,
          false,
          counterNote.vel,
        );
      }
    }

    // 5. Lead Melody
    const leadNote = this.resolveNoteCell(score.lead[step], 1.9);
    if (leadNote) {
      this.triggerSynthVoice(
        midiToHz(leadNote.midi),
        time,
        sixteenthDur * leadNote.steps,
        score.leadVoice,
        isAccented,
        leadNote.vel,
      );
    }

    // 6. Synthesized Percussion & Industrial Kit
    if (score.kick.includes(step)) {
      this.triggerKick(time, score.drumGain);
    }
    if (score.snare.includes(step)) {
      this.triggerSnare(time, score.drumGain * 0.72);
    }
    if (score.hatOpen?.includes(step)) {
      this.triggerHiHat(time, score.drumGain * 0.44, true);
    } else if (score.hatClosed.includes(step)) {
      this.triggerHiHat(time, score.drumGain * 0.34, false);
    }
    if (score.clang?.includes(step)) {
      this.triggerClang(time, score.drumGain * 0.48);
    }
    if (score.crash?.includes(step)) {
      this.triggerCrash(time, score.drumGain * 0.45);
    }
    if (score.toms) {
      for (const tom of score.toms) {
        if (tom.step === step) {
          this.triggerTom(time, midiToHz(tom.midi), score.drumGain * 0.85 * (tom.vel ?? 1));
        }
      }
    }
  }

  private triggerSynthVoice(
    freqHz: number,
    time: number,
    durationSec: number,
    voice: SynthVoiceConfig,
    accent: boolean,
    velocity = 1,
  ): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const envGain = ctx.createGain();
    const peakGain = Math.max(0.001, voice.gain * velocity * (accent ? 1.2 : 1));
    const totalDur = Math.max(0.05, durationSec);
    const releaseEnd = time + totalDur + voice.releaseSec;

    envGain.gain.setValueAtTime(0.0001, time);
    envGain.gain.linearRampToValueAtTime(peakGain, time + voice.attackSec);
    envGain.gain.setValueAtTime(peakGain * 0.92, time + Math.max(voice.attackSec + 0.005, totalDur * 0.72));
    envGain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    // Build filter/drive chain backwards from envGain
    let inputStage: AudioNode = envGain;

    if (voice.cutoffHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const baseCut = voice.cutoffHz;
      const peakCut = (voice.cutoffPeakHz ?? baseCut) * (accent ? 1.32 : 1);
      filter.Q.setValueAtTime(voice.q ?? 1.1, time);
      if (peakCut > baseCut) {
        filter.frequency.setValueAtTime(Math.min(12000, peakCut), time);
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(90, baseCut),
          time + Math.min(0.32, totalDur),
        );
      } else {
        filter.frequency.setValueAtTime(baseCut, time);
      }
      filter.connect(inputStage);
      inputStage = filter;
    }

    if (voice.driveAmount && voice.driveAmount > 0.02) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.getDriveCurve(voice.driveAmount);
      shaper.oversample = '2x';
      shaper.connect(inputStage);
      inputStage = shaper;
    }

    const osc1 = ctx.createOscillator();
    osc1.type = voice.waveform;
    osc1.frequency.setValueAtTime(freqHz, time);
    osc1.connect(inputStage);

    let osc2: OscillatorNode | null = null;
    if (voice.detuneCents && voice.detuneCents > 0) {
      osc2 = ctx.createOscillator();
      osc2.type = voice.waveform;
      osc2.frequency.setValueAtTime(freqHz, time);
      osc2.detune.setValueAtTime(voice.detuneCents, time);
      osc2.connect(inputStage);
    }

    let subOsc: OscillatorNode | null = null;
    if (voice.subOctaveGain && voice.subOctaveGain > 0.01) {
      subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(freqHz * 0.5, time);
      const subGain = ctx.createGain();
      subGain.gain.value = voice.subOctaveGain;
      subOsc.connect(subGain);
      subGain.connect(inputStage);
    }

    // Optional 2-operator FM modulator for authentic 16-bit FM timbre
    let modOsc: OscillatorNode | null = null;
    if (voice.fmRatio && voice.fmIndexHz) {
      modOsc = ctx.createOscillator();
      modOsc.type = 'sine';
      modOsc.frequency.setValueAtTime(freqHz * voice.fmRatio, time);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(voice.fmIndexHz * (accent ? 1.28 : 1), time);
      modGain.gain.exponentialRampToValueAtTime(8, time + Math.min(0.28, totalDur));
      modOsc.connect(modGain);
      modGain.connect(osc1.frequency);
    }

    // Expressive vibrato on sustained leads
    let vibOsc: OscillatorNode | null = null;
    if (voice.vibratoHz && voice.vibratoCents && totalDur >= 0.16) {
      vibOsc = ctx.createOscillator();
      vibOsc.type = 'sine';
      vibOsc.frequency.setValueAtTime(voice.vibratoHz, time);
      const vibGain = ctx.createGain();
      const delaySec = Math.min(totalDur * 0.45, voice.vibratoDelaySec ?? 0.12);
      vibGain.gain.setValueAtTime(0, time);
      vibGain.gain.setValueAtTime(0, time + delaySec);
      vibGain.gain.linearRampToValueAtTime(voice.vibratoCents, time + delaySec + 0.08);
      vibOsc.connect(vibGain);
      vibGain.connect(osc1.detune);
      if (osc2) vibGain.connect(osc2.detune);
    }

    this.connectWithPan(ctx, envGain, voice.pan, mixBus);
    if (voice.delaySend && voice.delaySend > 0 && this.delayNode) {
      const send = ctx.createGain();
      send.gain.value = voice.delaySend;
      envGain.connect(send);
      send.connect(this.delayNode);
    }

    const stopAt = releaseEnd + 0.03;
    osc1.start(time);
    osc1.stop(stopAt);
    if (osc2) {
      osc2.start(time);
      osc2.stop(stopAt);
    }
    if (subOsc) {
      subOsc.start(time);
      subOsc.stop(stopAt);
    }
    if (modOsc) {
      modOsc.start(time);
      modOsc.stop(stopAt);
    }
    if (vibOsc) {
      vibOsc.start(time);
      vibOsc.stop(stopAt);
    }
  }

  private triggerKick(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(156, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);

    gain.gain.setValueAtTime(Math.max(0.01, gainLevel * 1.18), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

    osc.connect(gain);
    gain.connect(mixBus);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  private triggerSnare(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1850, time);
    filter.Q.setValueAtTime(0.95, time);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(Math.max(0.005, gainLevel), time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(mixBus);
    noise.start(time);
    noise.stop(time + 0.19);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(218, time);
    body.frequency.exponentialRampToValueAtTime(108, time + 0.08);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(Math.max(0.005, gainLevel * 0.58), time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    body.connect(bodyGain);
    bodyGain.connect(mixBus);
    body.start(time);
    body.stop(time + 0.12);
  }

  private triggerHiHat(time: number, gainLevel: number, open: boolean): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(open ? 6100 : 7600, time);

    const gain = ctx.createGain();
    const dur = open ? 0.18 : 0.045;
    gain.gain.setValueAtTime(Math.max(0.003, gainLevel), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    noise.connect(hp);
    hp.connect(gain);
    this.connectWithPan(ctx, gain, 0.14, mixBus);
    noise.start(time);
    noise.stop(time + dur + 0.02);
  }

  private triggerClang(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    // Metallic FM anvil / factory gear strike
    const carrier = ctx.createOscillator();
    carrier.type = 'square';
    carrier.frequency.setValueAtTime(340, time);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(340 * 1.47, time);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(420, time);
    modGain.gain.exponentialRampToValueAtTime(35, time + 0.14);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2100, time);
    bp.Q.setValueAtTime(2.6, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.004, gainLevel * 0.8), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);

    carrier.connect(bp);
    bp.connect(gain);
    this.connectWithPan(ctx, gain, -0.18, mixBus);

    carrier.start(time);
    mod.start(time);
    carrier.stop(time + 0.21);
    mod.stop(time + 0.21);
  }

  private triggerTom(time: number, freqHz: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqHz * 1.38, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(45, freqHz * 0.88), time + 0.16);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.006, gainLevel), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

    osc.connect(gain);
    this.connectWithPan(ctx, gain, 0.1, mixBus);
    osc.start(time);
    osc.stop(time + 0.24);
  }

  private triggerCrash(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4200, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.004, gainLevel * 0.72), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.56);

    noise.connect(hp);
    hp.connect(gain);
    this.connectWithPan(ctx, gain, -0.16, mixBus);
    noise.start(time);
    noise.stop(time + 0.6);
  }
}

export const retroMusicPlayer = new RetroMusicSequencer();
