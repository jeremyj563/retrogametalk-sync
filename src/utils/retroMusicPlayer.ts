import {
  type MusicTrackId,
  SOUNDTRACK_TRACK_BY_ID,
  STARTER_TRACK_ID,
} from '../shared/soundtrack';

type NoteCell = number | null;

interface SynthVoiceConfig {
  waveform: OscillatorType;
  detuneCents?: number;
  cutoffHz?: number;
  cutoffPeakHz?: number;
  q?: number;
  attackSec: number;
  releaseSec: number;
  gain: number;
  delaySend?: number;
  /** Optional 2-operator FM modulation ratio & index (for 16-bit FM tracks) */
  fmRatio?: number;
  fmIndexHz?: number;
}

interface TrackScore {
  bpm: number;
  /** 64-step (4-bar, 16th-note) patterns */
  lead: readonly NoteCell[];
  arp: readonly NoteCell[];
  bass: readonly NoteCell[];
  /** Chord MIDI note arrays triggered at specific 16th steps */
  chords: Partial<Record<number, readonly number[]>>;
  /** Optional accented steps (e.g. acid 303 resonant filter boost) */
  accentSteps?: readonly number[];
  /** Percussion step triggers (0..63) */
  kick: readonly number[];
  snare: readonly number[];
  hatClosed: readonly number[];
  hatOpen?: readonly number[];
  leadVoice: SynthVoiceConfig;
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

const STEPS_PER_LOOP = 64;
const SCHEDULE_AHEAD_SEC = 0.14;
const LOOKAHEAD_MS = 25;

// Helper to build a 64-step array concisely from 4 x 16-step bars
function bars(
  b1: readonly NoteCell[],
  b2: readonly NoteCell[],
  b3: readonly NoteCell[],
  b4: readonly NoteCell[],
): NoteCell[] {
  return [...b1, ...b2, ...b3, ...b4];
}

function repeatPattern(stepsInBar: readonly number[], numBars = 4): number[] {
  const out: number[] = [];
  for (let bar = 0; bar < numBars; bar += 1) {
    for (const s of stepsInBar) {
      out.push(bar * 16 + s);
    }
  }
  return out;
}

const TRACK_SCORES: Record<MusicTrackId, TrackScore> = {
  // 1. Starter (0 pts) — Warm, relaxed CRT Ambient / Lo-Fi Synth (Fmaj7 -> Em7 -> Dm7 -> Cmaj7, 92 BPM)
  phosphor_idle: {
    bpm: 92,
    chords: {
      0: [53, 57, 60, 64], // Fmaj7
      16: [52, 55, 59, 62], // Em7
      32: [50, 53, 57, 60], // Dm7
      48: [48, 52, 55, 59], // Cmaj7
    },
    bass: bars(
      [41, null, null, null, null, null, 41, null, null, null, 45, null, null, null, null, null],
      [40, null, null, null, null, null, 40, null, null, null, 43, null, null, null, null, null],
      [38, null, null, null, null, null, 38, null, null, null, 41, null, null, null, null, null],
      [36, null, null, null, null, null, 36, null, null, null, 43, null, null, null, 40, null],
    ),
    arp: bars(
      [null, null, 69, null, null, null, 72, null, null, null, 76, null, null, null, 72, null],
      [null, null, 67, null, null, null, 71, null, null, null, 74, null, null, null, 71, null],
      [null, null, 65, null, null, null, 69, null, null, null, 72, null, null, null, 69, null],
      [null, null, 64, null, null, null, 67, null, null, null, 71, null, null, null, 67, null],
    ),
    lead: bars(
      [null, null, null, null, 76, null, null, 74, 72, null, null, null, null, null, null, null],
      [null, null, null, null, 74, null, null, 72, 71, null, null, null, 67, null, null, null],
      [null, null, null, null, 72, null, null, 69, 67, null, null, null, null, null, 69, null],
      [72, null, null, null, null, null, 71, null, 67, null, null, null, null, null, null, null],
    ),
    kick: [0, 10, 16, 26, 32, 42, 48, 58],
    snare: [4, 12, 20, 28, 36, 44, 52, 60],
    hatClosed: repeatPattern([0, 2, 4, 6, 8, 10, 12, 14]),
    leadVoice: {
      waveform: 'triangle',
      cutoffHz: 1850,
      attackSec: 0.025,
      releaseSec: 0.42,
      gain: 0.14,
      delaySend: 0.42,
    },
    arpVoice: {
      waveform: 'sine',
      cutoffHz: 2400,
      attackSec: 0.012,
      releaseSec: 0.28,
      gain: 0.095,
      delaySend: 0.35,
    },
    bassVoice: {
      waveform: 'triangle',
      cutoffHz: 420,
      attackSec: 0.015,
      releaseSec: 0.34,
      gain: 0.24,
    },
    padVoice: {
      waveform: 'sine',
      detuneCents: 6,
      cutoffHz: 1200,
      attackSec: 0.14,
      releaseSec: 1.65,
      gain: 0.085,
      delaySend: 0.25,
    },
    drumGain: 0.13,
    delayFeedback: 0.34,
    delayMix: 0.3,
  },

  // 2. 150 pts — Upbeat 8-Bit Chiptune (C major / A minor arcade spirit, 132 BPM)
  bitplane_bounce: {
    bpm: 132,
    chords: {
      0: [60, 64, 67], // C
      16: [55, 59, 62], // G
      32: [57, 60, 64], // Am
      48: [53, 57, 60], // F
      56: [55, 59, 62], // G turnaround
    },
    bass: bars(
      [48, null, 60, null, 48, null, 55, null, 48, null, 60, null, 55, null, 52, null],
      [43, null, 55, null, 43, null, 50, null, 43, null, 55, null, 50, null, 47, null],
      [45, null, 57, null, 45, null, 52, null, 45, null, 57, null, 52, null, 48, null],
      [41, null, 53, null, 41, null, 48, null, 43, null, 55, null, 50, null, 55, null],
    ),
    arp: bars(
      [60, 64, 67, 72, 60, 64, 67, 72, 60, 64, 67, 72, 67, 64, 67, 72],
      [55, 59, 62, 67, 55, 59, 62, 67, 55, 59, 62, 67, 62, 59, 62, 67],
      [57, 60, 64, 69, 57, 60, 64, 69, 57, 60, 64, 69, 64, 60, 64, 69],
      [53, 57, 60, 65, 53, 57, 60, 65, 55, 59, 62, 67, 62, 67, 71, 74],
    ),
    lead: bars(
      [72, null, 76, null, 79, null, 76, 74, 72, null, 74, null, 76, null, null, null],
      [74, null, 71, null, 67, null, 71, 74, 79, null, 76, null, 74, null, null, null],
      [72, null, 76, null, 81, null, 79, 76, 72, null, 74, 76, 72, null, null, null],
      [77, null, 76, null, 72, null, 74, null, 79, null, 76, 74, 71, null, 74, null],
    ),
    kick: repeatPattern([0, 6, 8, 14]),
    snare: repeatPattern([4, 12]),
    hatClosed: repeatPattern([0, 2, 4, 6, 8, 10, 12, 14]),
    leadVoice: {
      waveform: 'square',
      cutoffHz: 3200,
      attackSec: 0.005,
      releaseSec: 0.14,
      gain: 0.125,
      delaySend: 0.18,
    },
    arpVoice: {
      waveform: 'square',
      cutoffHz: 2400,
      attackSec: 0.004,
      releaseSec: 0.075,
      gain: 0.06,
      delaySend: 0.1,
    },
    bassVoice: {
      waveform: 'triangle',
      cutoffHz: 700,
      attackSec: 0.006,
      releaseSec: 0.13,
      gain: 0.25,
    },
    padVoice: {
      waveform: 'triangle',
      cutoffHz: 1500,
      attackSec: 0.02,
      releaseSec: 0.55,
      gain: 0.045,
    },
    drumGain: 0.18,
    delayFeedback: 0.22,
    delayMix: 0.18,
  },

  // 3. 400 pts — 80s Synthwave (A minor: Am -> F -> C -> G, 116 BPM)
  outrun_crt: {
    bpm: 116,
    chords: {
      0: [57, 60, 64, 69], // Am
      16: [53, 57, 60, 65], // F
      32: [48, 52, 55, 60], // C
      48: [55, 59, 62, 67], // G
    },
    bass: bars(
      [45, 45, 57, 45, 45, 45, 57, 45, 45, 45, 57, 45, 45, 45, 55, 45],
      [41, 41, 53, 41, 41, 41, 53, 41, 41, 41, 53, 41, 41, 41, 52, 41],
      [36, 36, 48, 36, 36, 36, 48, 36, 36, 36, 48, 36, 36, 36, 47, 36],
      [43, 43, 55, 43, 43, 43, 55, 43, 43, 43, 55, 43, 43, 45, 47, 50],
    ),
    arp: bars(
      [69, null, 72, null, 76, null, 72, null, 69, null, 72, null, 76, null, 79, null],
      [65, null, 69, null, 72, null, 69, null, 65, null, 69, null, 72, null, 76, null],
      [60, null, 64, null, 67, null, 64, null, 60, null, 64, null, 67, null, 72, null],
      [67, null, 71, null, 74, null, 71, null, 67, null, 71, null, 74, null, 76, null],
    ),
    lead: bars(
      [76, null, null, 79, 81, null, null, 79, 76, null, 72, null, 74, null, null, null],
      [72, null, null, 74, 76, null, null, 72, 69, null, null, null, null, null, 72, null],
      [76, null, null, 79, 84, null, null, 81, 79, null, 76, null, 74, null, null, null],
      [74, null, 76, null, 79, null, 76, null, 74, null, 71, null, null, null, null, null],
    ),
    kick: repeatPattern([0, 4, 8, 12]),
    snare: repeatPattern([4, 12]),
    hatClosed: repeatPattern([2, 6, 10, 14]),
    hatOpen: [14, 30, 46, 62],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 11,
      cutoffHz: 2400,
      cutoffPeakHz: 3400,
      q: 2.2,
      attackSec: 0.018,
      releaseSec: 0.34,
      gain: 0.12,
      delaySend: 0.38,
    },
    arpVoice: {
      waveform: 'triangle',
      cutoffHz: 2200,
      attackSec: 0.008,
      releaseSec: 0.16,
      gain: 0.085,
      delaySend: 0.3,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 320,
      cutoffPeakHz: 1150,
      q: 3.2,
      attackSec: 0.005,
      releaseSec: 0.14,
      gain: 0.21,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 14,
      cutoffHz: 1050,
      attackSec: 0.16,
      releaseSec: 1.5,
      gain: 0.055,
      delaySend: 0.22,
    },
    drumGain: 0.22,
    delayFeedback: 0.36,
    delayMix: 0.28,
  },

  // 4. 650 pts — 16-Bit FM Action (E minor: Em -> C -> D -> Bm/B7, 128 BPM)
  fm_cartridge_drive: {
    bpm: 128,
    chords: {
      0: [52, 55, 59, 64], // Em
      16: [48, 52, 55, 60], // C
      32: [50, 54, 57, 62], // D
      48: [47, 50, 54, 59], // Bm
      56: [47, 51, 54, 59], // B
    },
    bass: bars(
      [40, null, 40, 52, null, 40, 47, null, 40, null, 52, null, 47, 45, 43, null],
      [36, null, 36, 48, null, 36, 43, null, 36, null, 48, null, 43, 40, 38, null],
      [38, null, 38, 50, null, 38, 45, null, 38, null, 50, null, 45, 43, 42, null],
      [35, null, 35, 47, null, 35, 42, null, 35, null, 47, null, 45, 43, 42, 38],
    ),
    arp: bars(
      [64, 67, 71, null, 64, 67, 71, 76, 64, 67, 71, null, 76, 71, 67, null],
      [60, 64, 67, null, 60, 64, 67, 72, 60, 64, 67, null, 72, 67, 64, null],
      [62, 66, 69, null, 62, 66, 69, 74, 62, 66, 69, null, 74, 69, 66, null],
      [59, 62, 66, null, 59, 63, 66, 71, 66, 71, 74, null, 71, 66, 63, null],
    ),
    lead: bars(
      [76, null, 79, null, 83, null, 79, 76, 74, null, 76, null, 71, null, null, null],
      [72, null, 76, null, 79, null, 76, 72, 71, null, 72, null, 67, null, null, null],
      [74, null, 78, null, 81, null, 78, 74, 76, null, 78, null, 74, null, null, null],
      [71, null, 74, null, 78, null, 74, null, 79, null, 78, 74, 71, null, 74, null],
    ),
    kick: [0, 3, 8, 10, 16, 19, 24, 26, 32, 35, 40, 42, 48, 51, 56, 60],
    snare: [4, 12, 20, 28, 36, 44, 52, 58, 60],
    hatClosed: repeatPattern([0, 2, 4, 6, 8, 10, 12, 14]),
    hatOpen: [6, 22, 38, 54],
    leadVoice: {
      waveform: 'sine',
      fmRatio: 2,
      fmIndexHz: 210,
      cutoffHz: 3400,
      attackSec: 0.006,
      releaseSec: 0.22,
      gain: 0.145,
      delaySend: 0.26,
    },
    arpVoice: {
      waveform: 'sine',
      fmRatio: 3,
      fmIndexHz: 140,
      cutoffHz: 2900,
      attackSec: 0.004,
      releaseSec: 0.11,
      gain: 0.075,
      delaySend: 0.2,
    },
    bassVoice: {
      waveform: 'triangle',
      fmRatio: 1,
      fmIndexHz: 160,
      cutoffHz: 1400,
      attackSec: 0.004,
      releaseSec: 0.15,
      gain: 0.24,
    },
    padVoice: {
      waveform: 'sine',
      fmRatio: 2,
      fmIndexHz: 60,
      cutoffHz: 1600,
      attackSec: 0.03,
      releaseSec: 0.85,
      gain: 0.055,
      delaySend: 0.15,
    },
    drumGain: 0.21,
    delayFeedback: 0.28,
    delayMix: 0.22,
  },

  // 5. 950 pts — Retro Techno / Acid (D minor hypnotic 303 groove, 130 BPM)
  subcarrier_pulse: {
    bpm: 130,
    chords: {
      0: [62, 65, 69], // Dm stab
      14: [62, 65, 69],
      32: [60, 64, 67], // C stab
      46: [58, 62, 65], // Bb stab
      56: [60, 64, 69], // Am/C tension stab
    },
    bass: bars(
      [38, null, 38, 50, 38, null, 41, null, 38, 50, null, 38, 45, null, 43, 41],
      [38, null, 38, 50, 38, null, 45, null, 38, 50, null, 41, 43, null, 38, null],
      [36, null, 36, 48, 36, null, 41, null, 36, 48, null, 36, 43, null, 41, 38],
      [34, null, 34, 46, 34, null, 38, null, 36, 48, null, 38, 41, null, 45, 38],
    ),
    accentSteps: [3, 6, 9, 12, 19, 22, 25, 30, 35, 41, 44, 51, 57, 62],
    arp: bars(
      [null, null, 69, null, null, null, 69, null, null, null, 74, null, null, null, 72, null],
      [null, null, 69, null, null, null, 72, null, null, null, 74, null, null, null, 76, null],
      [null, null, 67, null, null, null, 72, null, null, null, 74, null, null, null, 72, null],
      [null, null, 65, null, null, null, 69, null, null, null, 72, null, null, null, 69, null],
    ),
    lead: bars(
      [null, null, null, null, null, null, null, null, 74, null, null, 72, 69, null, null, null],
      [null, null, null, null, 77, null, null, null, 76, null, 74, null, 72, null, null, null],
      [null, null, null, null, null, null, null, null, 72, null, null, 74, 76, null, null, null],
      [74, null, null, null, 72, null, 69, null, 67, null, 69, null, null, null, null, null],
    ),
    kick: repeatPattern([0, 4, 8, 12]),
    snare: repeatPattern([4, 12]),
    hatClosed: repeatPattern([0, 2, 3, 6, 8, 10, 11, 14]),
    hatOpen: repeatPattern([2, 10]),
    leadVoice: {
      waveform: 'sawtooth',
      cutoffHz: 1700,
      cutoffPeakHz: 2900,
      q: 4.0,
      attackSec: 0.008,
      releaseSec: 0.24,
      gain: 0.1,
      delaySend: 0.44,
    },
    arpVoice: {
      waveform: 'square',
      cutoffHz: 1850,
      q: 3.0,
      attackSec: 0.005,
      releaseSec: 0.1,
      gain: 0.07,
      delaySend: 0.36,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 280,
      cutoffPeakHz: 2150,
      q: 7.2,
      attackSec: 0.004,
      releaseSec: 0.14,
      gain: 0.22,
      delaySend: 0.14,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 9,
      cutoffHz: 1500,
      cutoffPeakHz: 2400,
      q: 2.0,
      attackSec: 0.006,
      releaseSec: 0.26,
      gain: 0.075,
      delaySend: 0.42,
    },
    drumGain: 0.24,
    delayFeedback: 0.4,
    delayMix: 0.3,
  },

  // 6. 1,300 pts — Dark Cyber-Synth / Darksynth (C minor: Cm -> Ab -> Fm -> G, 108 BPM)
  cyberdeck_horizon: {
    bpm: 108,
    chords: {
      0: [48, 55, 60, 63], // Cm
      16: [44, 51, 56, 60], // Ab
      32: [41, 48, 53, 56], // Fm
      48: [43, 50, 55, 59], // G
    },
    bass: bars(
      [36, 36, 48, 36, 39, 36, 43, 36, 36, 36, 48, 36, 39, 36, 46, 43],
      [32, 32, 44, 32, 36, 32, 39, 32, 32, 32, 44, 32, 36, 32, 43, 39],
      [29, 29, 41, 29, 32, 29, 36, 29, 29, 29, 41, 29, 32, 29, 39, 36],
      [31, 31, 43, 31, 35, 31, 38, 31, 31, 31, 43, 31, 38, 35, 38, 43],
    ),
    arp: bars(
      [60, 63, 67, 72, 67, 63, 60, 67, 60, 63, 67, 72, 70, 67, 63, 67],
      [56, 60, 63, 68, 63, 60, 56, 63, 56, 60, 63, 68, 67, 63, 60, 63],
      [53, 56, 60, 65, 60, 56, 53, 60, 53, 56, 60, 65, 63, 60, 56, 60],
      [55, 59, 62, 67, 62, 59, 55, 62, 55, 59, 62, 67, 71, 67, 62, 59],
    ),
    lead: bars(
      [72, null, null, null, 75, null, null, 74, 72, null, 67, null, null, null, null, null],
      [68, null, null, null, 72, null, null, 70, 68, null, 67, null, null, null, null, null],
      [65, null, null, null, 68, null, null, 67, 65, null, 63, null, 60, null, null, null],
      [67, null, null, 71, 74, null, null, 72, 71, null, 67, null, null, null, null, null],
    ),
    kick: [0, 6, 10, 16, 22, 26, 32, 38, 42, 48, 54, 58, 62],
    snare: [8, 24, 40, 56],
    hatClosed: repeatPattern([0, 2, 4, 6, 8, 10, 12, 14]),
    hatOpen: [12, 28, 44, 60],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 16,
      cutoffHz: 1550,
      cutoffPeakHz: 2650,
      q: 2.8,
      attackSec: 0.03,
      releaseSec: 0.45,
      gain: 0.12,
      delaySend: 0.44,
    },
    arpVoice: {
      waveform: 'sawtooth',
      cutoffHz: 1350,
      cutoffPeakHz: 1900,
      q: 2.4,
      attackSec: 0.005,
      releaseSec: 0.12,
      gain: 0.068,
      delaySend: 0.3,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 240,
      cutoffPeakHz: 880,
      q: 3.4,
      attackSec: 0.005,
      releaseSec: 0.16,
      gain: 0.23,
    },
    padVoice: {
      waveform: 'triangle',
      detuneCents: 18,
      cutoffHz: 950,
      attackSec: 0.22,
      releaseSec: 1.8,
      gain: 0.085,
      delaySend: 0.32,
    },
    drumGain: 0.22,
    delayFeedback: 0.38,
    delayMix: 0.3,
  },

  // 7. 1,650 pts — Flagship Arcade Euro-Synth Anthem (E minor -> C -> G -> D, 138 BPM)
  broadcast_finale: {
    bpm: 138,
    chords: {
      0: [64, 67, 71], // Em
      6: [64, 67, 71],
      12: [64, 67, 71],
      16: [60, 64, 67], // C
      22: [60, 64, 67],
      28: [60, 64, 67],
      32: [67, 71, 74], // G
      38: [67, 71, 74],
      44: [67, 71, 74],
      48: [62, 66, 69], // D
      54: [62, 66, 69],
      60: [62, 66, 71], // D6 lift
    },
    bass: bars(
      [null, null, 40, 52, null, null, 40, 52, null, null, 40, 52, null, null, 40, 47],
      [null, null, 36, 48, null, null, 36, 48, null, null, 36, 48, null, null, 36, 43],
      [null, null, 43, 55, null, null, 43, 55, null, null, 43, 55, null, null, 43, 50],
      [null, null, 38, 50, null, null, 38, 50, null, null, 38, 50, null, null, 42, 45],
    ),
    arp: bars(
      [64, 67, 71, 76, 71, 67, 64, 71, 64, 67, 71, 76, 79, 76, 71, 67],
      [60, 64, 67, 72, 67, 64, 60, 67, 60, 64, 67, 72, 76, 72, 67, 64],
      [67, 71, 74, 79, 74, 71, 67, 74, 67, 71, 74, 79, 83, 79, 74, 71],
      [62, 66, 69, 74, 69, 66, 62, 69, 62, 66, 69, 74, 78, 74, 69, 66],
    ),
    lead: bars(
      [76, null, 79, null, 83, null, 79, null, 83, null, 86, null, 83, null, 79, null],
      [76, null, 79, null, 84, null, 79, null, 84, null, 83, null, 79, null, 76, null],
      [79, null, 83, null, 86, null, 83, null, 88, null, 86, null, 83, null, 79, null],
      [78, null, 81, null, 86, null, 81, null, 83, null, 81, 78, 74, null, 78, null],
    ),
    kick: repeatPattern([0, 4, 8, 12]),
    snare: repeatPattern([4, 12]),
    hatClosed: repeatPattern([0, 2, 4, 6, 8, 10, 12, 14]),
    hatOpen: repeatPattern([2, 6, 10, 14]),
    leadVoice: {
      waveform: 'square',
      detuneCents: 10,
      cutoffHz: 3300,
      cutoffPeakHz: 4200,
      q: 1.8,
      attackSec: 0.008,
      releaseSec: 0.2,
      gain: 0.115,
      delaySend: 0.34,
    },
    arpVoice: {
      waveform: 'triangle',
      cutoffHz: 3000,
      attackSec: 0.004,
      releaseSec: 0.09,
      gain: 0.072,
      delaySend: 0.24,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 340,
      cutoffPeakHz: 1350,
      q: 3.0,
      attackSec: 0.004,
      releaseSec: 0.12,
      gain: 0.22,
    },
    padVoice: {
      waveform: 'sawtooth',
      detuneCents: 15,
      cutoffHz: 1900,
      cutoffPeakHz: 2900,
      q: 1.6,
      attackSec: 0.012,
      releaseSec: 0.32,
      gain: 0.068,
      delaySend: 0.32,
    },
    drumGain: 0.22,
    delayFeedback: 0.32,
    delayMix: 0.26,
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
        compressor.threshold.value = -16;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.008;
        compressor.release.value = 0.16;

        const duckGain = ctx.createGain();
        duckGain.gain.value = this.computeDuckTarget();

        const volumeGain = ctx.createGain();
        volumeGain.gain.value = this.computeVolumeTarget();

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;

        // Parallel dotted-8th tempo-synced echo bus
        const delayNode = ctx.createDelay(1.5);
        delayNode.delayTime.value = 0.34;
        const delayFilter = ctx.createBiquadFilter();
        delayFilter.type = 'lowpass';
        delayFilter.frequency.value = 2300;
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
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private computeVolumeTarget(): number {
    if (this.muted || this.volumePct <= 0) return 0.0001;
    // Gentle perceptual volume curve so 45% feels comfortable for background listening
    const norm = Math.max(0, Math.min(1, this.volumePct / 100));
    return Math.max(0.0001, Math.pow(norm, 1.45) * 0.55);
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
    // Dotted-8th echo feel (3 sixteenths)
    const dottedEighth = Math.min(1.2, Math.max(0.15, sixteenth * 3));
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
        // Brief smooth dip for clean transition without pops
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
    // Use the most musically active lower-to-upper-mid bins (1..24 of 32)
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
      // Slight gentle boost so low-volume listening still drives crisp bar motion
      const norm = Math.min(1, Math.pow(avg / 215, 0.85));
      out[i] = norm;
    }
    return out;
  }

  private scheduleAhead(): void {
    if (!this.playing || !this.ctx || !this.mixBus) return;
    const score = TRACK_SCORES[this.currentTrackId];
    const sixteenthDur = 60 / score.bpm / 4;

    // If the browser tab paused briefly and nextStepTime fell far behind, snap cleanly forward
    if (this.nextStepTime < this.ctx.currentTime - 0.35) {
      this.nextStepTime = this.ctx.currentTime + 0.04;
    }

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this.scheduleStep(this.currentStep, this.nextStepTime, sixteenthDur, score);
      this.nextStepTime += sixteenthDur;
      this.currentStep = (this.currentStep + 1) % STEPS_PER_LOOP;

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

  private scheduleStep(
    step: number,
    time: number,
    sixteenthDur: number,
    score: TrackScore,
  ): void {
    const isAccented = Boolean(score.accentSteps?.includes(step));

    // 1. Chord Pad / Stabs
    const chordNotes = score.chords[step];
    if (chordNotes && chordNotes.length > 0) {
      const dur = Math.max(sixteenthDur * 2, score.padVoice.releaseSec);
      for (const midi of chordNotes) {
        this.triggerSynthVoice(midiToHz(midi), time, dur, score.padVoice, false);
      }
    }

    // 2. Bassline
    const bassMidi = score.bass[step];
    if (bassMidi !== null && bassMidi !== undefined) {
      this.triggerSynthVoice(
        midiToHz(bassMidi),
        time,
        sixteenthDur * 1.45,
        score.bassVoice,
        isAccented,
      );
    }

    // 3. Arpeggio
    const arpMidi = score.arp[step];
    if (arpMidi !== null && arpMidi !== undefined) {
      this.triggerSynthVoice(
        midiToHz(arpMidi),
        time,
        sixteenthDur * 0.95,
        score.arpVoice,
        false,
      );
    }

    // 4. Lead Melody
    const leadMidi = score.lead[step];
    if (leadMidi !== null && leadMidi !== undefined) {
      this.triggerSynthVoice(
        midiToHz(leadMidi),
        time,
        sixteenthDur * 2.1,
        score.leadVoice,
        false,
      );
    }

    // 5. Synthesized Percussion
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
  }

  private triggerSynthVoice(
    freqHz: number,
    time: number,
    durationSec: number,
    voice: SynthVoiceConfig,
    accent: boolean,
  ): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const envGain = ctx.createGain();
    const peakGain = voice.gain * (accent ? 1.25 : 1);
    const totalDur = Math.max(0.05, durationSec);
    const releaseEnd = time + totalDur + voice.releaseSec;

    envGain.gain.setValueAtTime(0.0001, time);
    envGain.gain.linearRampToValueAtTime(peakGain, time + voice.attackSec);
    envGain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    let outputNode: AudioNode = envGain;
    if (voice.cutoffHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const baseCut = voice.cutoffHz;
      const peakCut = (voice.cutoffPeakHz ?? baseCut) * (accent ? 1.35 : 1);
      filter.Q.setValueAtTime(voice.q ?? 1.1, time);
      if (peakCut > baseCut) {
        filter.frequency.setValueAtTime(Math.min(12000, peakCut), time);
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(90, baseCut),
          time + Math.min(0.28, totalDur),
        );
      } else {
        filter.frequency.setValueAtTime(baseCut, time);
      }
      filter.connect(envGain);
      outputNode = filter;
    }

    const osc1 = ctx.createOscillator();
    osc1.type = voice.waveform;
    osc1.frequency.setValueAtTime(freqHz, time);
    osc1.connect(outputNode);

    let osc2: OscillatorNode | null = null;
    if (voice.detuneCents && voice.detuneCents > 0) {
      osc2 = ctx.createOscillator();
      osc2.type = voice.waveform;
      osc2.frequency.setValueAtTime(freqHz, time);
      osc2.detune.setValueAtTime(voice.detuneCents, time);
      osc2.connect(outputNode);
    }

    // Optional 2-operator FM modulator for authentic 16-bit FM timbre
    let modOsc: OscillatorNode | null = null;
    if (voice.fmRatio && voice.fmIndexHz) {
      modOsc = ctx.createOscillator();
      modOsc.type = 'sine';
      modOsc.frequency.setValueAtTime(freqHz * voice.fmRatio, time);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(voice.fmIndexHz * (accent ? 1.3 : 1), time);
      modGain.gain.exponentialRampToValueAtTime(8, time + Math.min(0.25, totalDur));
      modOsc.connect(modGain);
      modGain.connect(osc1.frequency);
    }

    envGain.connect(mixBus);
    if (voice.delaySend && voice.delaySend > 0 && this.delayNode) {
      const send = ctx.createGain();
      send.gain.value = voice.delaySend;
      envGain.connect(send);
      send.connect(this.delayNode);
    }

    osc1.start(time);
    osc1.stop(releaseEnd + 0.03);
    if (osc2) {
      osc2.start(time);
      osc2.stop(releaseEnd + 0.03);
    }
    if (modOsc) {
      modOsc.start(time);
      modOsc.stop(releaseEnd + 0.03);
    }
  }

  private triggerKick(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(148, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);

    gain.gain.setValueAtTime(Math.max(0.01, gainLevel * 1.15), time);
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

    // Noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1750, time);
    filter.Q.setValueAtTime(0.9, time);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(Math.max(0.005, gainLevel), time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(mixBus);
    noise.start(time);
    noise.stop(time + 0.18);

    // Subtle snare body tone
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(110, time + 0.08);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(Math.max(0.005, gainLevel * 0.55), time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
    body.connect(bodyGain);
    bodyGain.connect(mixBus);
    body.start(time);
    body.stop(time + 0.11);
  }

  private triggerHiHat(time: number, gainLevel: number, open: boolean): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(open ? 6200 : 7600, time);

    const gain = ctx.createGain();
    const dur = open ? 0.17 : 0.045;
    gain.gain.setValueAtTime(Math.max(0.003, gainLevel), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    noise.connect(hp);
    hp.connect(gain);
    gain.connect(mixBus);
    noise.start(time);
    noise.stop(time + dur + 0.02);
  }
}

export const retroMusicPlayer = new RetroMusicSequencer();
