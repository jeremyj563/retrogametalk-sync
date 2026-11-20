import {
  type MusicTrackId,
  SOUNDTRACK_TRACK_BY_ID,
  STARTER_TRACK_ID,
} from '../shared/soundtrack';

export type NoteCell =
  | number
  | readonly [midi: number, steps: number, vel?: number, glideSemi?: number]
  | null;

export interface TomHit {
  readonly step: number;
  readonly midi: number;
  readonly vel?: number;
}

export type CustomWaveType =
  | OscillatorType
  | 'pulse25'
  | 'pulse12'
  | 'organ'
  | 'brass'
  | 'strings'
  | 'epiano'
  | 'slapbass'
  | 'guitar';

export interface SynthVoiceConfig {
  waveform: CustomWaveType;
  /** Subtle detune cents; if chorus3 is true, spawns -detune / 0 / +detune ensemble */
  detuneCents?: number;
  chorus3?: boolean;
  /** Highpass filter to carve low-end mud from pads, arps, and guitars */
  highpassHz?: number;
  /** Lowpass cutoff (rest frequency) and envelope peak frequency */
  cutoffHz?: number;
  cutoffPeakHz?: number;
  filterDecaySec?: number;
  q?: number;
  /** Click-free ADSR envelope parameters */
  attackSec: number;
  decaySec?: number;
  sustainLevel?: number;
  releaseSec: number;
  gain: number;
  /** Spatial sends */
  delaySend?: number;
  reverbSend?: number;
  pan?: number;
  /** Optional 2-operator FM modulation for DX7 Rhodes, slap bass, bells & metal */
  fmRatio?: number;
  fmIndexHz?: number;
  fmDecaySec?: number;
  /** Soft-clipping overdrive amount (0..1) */
  driveAmount?: number;
  /** Guitar power-chord mode: layers Root + Perfect 5th (+ optional octave) */
  powerChord?: boolean;
  /** Guitar speaker-cabinet tone shaping (eliminates harsh digital fizz) */
  cabinetEq?: boolean;
  /** Optional -1 octave triangle sub-oscillator blend (0..1) */
  subOctaveGain?: number;
  /** Optional expressive vibrato on sustained notes */
  vibratoHz?: number;
  vibratoCents?: number;
  vibratoDelaySec?: number;
}

export interface ChordEvent {
  readonly notes: readonly number[];
  readonly steps?: number;
  readonly vel?: number;
  /** Optional alternate pad/chord voice (e.g., gothic organ intro or brass stab) */
  readonly altVoice?: boolean;
}

export interface TrackScore {
  bpm: number;
  totalSteps: number;
  /** Multi-bar 16th-note melodic lanes */
  lead: readonly NoteCell[];
  counter?: readonly NoteCell[];
  arp: readonly NoteCell[];
  bass: readonly NoteCell[];
  /** Chord MIDI note arrays triggered at specific 16th steps */
  chords: Partial<Record<number, readonly number[] | ChordEvent>>;
  /** Optional accented steps (boosts filter / FM bite) */
  accentSteps?: readonly number[];
  /** Percussion step triggers (0..totalSteps-1) */
  kick: readonly number[];
  snare: readonly number[];
  gatedSnare?: boolean;
  clap?: readonly number[];
  rim?: readonly number[];
  hatClosed: readonly number[];
  hatAccent?: readonly number[];
  hatOpen?: readonly number[];
  clang?: readonly number[];
  crash?: readonly number[];
  toms?: readonly TomHit[];
  leadVoice: SynthVoiceConfig;
  counterVoice?: SynthVoiceConfig;
  arpVoice: SynthVoiceConfig;
  bassVoice: SynthVoiceConfig;
  padVoice: SynthVoiceConfig;
  /** Optional secondary chord voice (e.g., gothic organ or brass stabs) */
  altPadVoice?: SynthVoiceConfig;
  drumGain: number;
  delayFeedback: number;
  delayMix: number;
  reverbMix: number;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const SCHEDULE_AHEAD_SEC = 0.14;
const LOOKAHEAD_MS = 25;

/** Articulated note tuple helper: s(midi, steps, velocity, optionalGlideSemitones) */
function s(
  midi: number,
  steps = 2,
  vel = 1,
  glideSemi?: number,
): readonly [number, number, number] | readonly [number, number, number, number] {
  return glideSemi !== undefined ? [midi, steps, vel, glideSemi] : [midi, steps, vel];
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

const EMPTY_BAR: readonly NoteCell[] = [
  null, null, null, null, null, null, null, null,
  null, null, null, null, null, null, null, null,
];

// ============================================================================
// 7 ORIGINAL MULTI-SECTION COMPOSITIONS INSPIRED BY CLASSIC VGM SOUNDTRACKS
// ============================================================================

export const TRACK_SCORES: Record<MusicTrackId, TrackScore> = {
  // ==========================================================================
  // 1. Starter (0 pts) — "Neon Corridor"
  //    Inspired by: Corpse Party BCR (PSP) — Chapter 1 Main Theme
  //    128 BPM · F Minor / Ab Major · 12 bars (192 steps)
  //    Bars 0-1: Rapid sparkling 8-bit 25%-pulse arpeggio intro + riser
  //    Bars 2-5: Punchy syncopated electro-breakbeat funk & FM bass groove
  //    Bars 6-11: Euphoric arcade synth-funk chorus with warm DX7 E-piano & lead
  // ==========================================================================
  phosphor_idle: {
    bpm: 128,
    totalSteps: 192,
    chords: {
      // Bars 2-5: Sharp staccato funk-synth stabs (altPadVoice)
      32: { notes: [60, 63, 68, 72], steps: 3, vel: 0.9, altVoice: true }, // Fm7
      42: { notes: [60, 63, 68, 72], steps: 2, vel: 0.72, altVoice: true },
      48: { notes: [61, 65, 68, 72], steps: 3, vel: 0.9, altVoice: true }, // DbMaj7
      58: { notes: [61, 65, 68, 72], steps: 2, vel: 0.72, altVoice: true },
      64: { notes: [63, 67, 70, 72], steps: 3, vel: 0.9, altVoice: true }, // Eb6
      74: { notes: [63, 67, 70, 72], steps: 2, vel: 0.72, altVoice: true },
      80: { notes: [60, 63, 67, 70], steps: 4, vel: 0.88, altVoice: true }, // Cm7
      88: { notes: [60, 64, 67, 70], steps: 4, vel: 0.95, altVoice: true }, // C7 turnaround
      // Bars 6-11: Warm lush DX7 electric piano chorus chords (padVoice)
      96: { notes: [53, 60, 65, 68], steps: 10, vel: 0.92 }, // DbMaj7/F
      106: { notes: [53, 60, 65, 68], steps: 4, vel: 0.65 },
      112: { notes: [55, 63, 67, 70], steps: 10, vel: 0.92 }, // Eb7
      122: { notes: [55, 63, 67, 70], steps: 4, vel: 0.65 },
      128: { notes: [55, 60, 63, 70], steps: 10, vel: 0.9 }, // Cm7
      138: { notes: [55, 60, 63, 70], steps: 4, vel: 0.65 },
      144: { notes: [53, 60, 63, 68], steps: 10, vel: 0.95 }, // Fm7
      154: { notes: [56, 63, 68, 72], steps: 4, vel: 0.75 }, // Ab/Eb lift
      160: { notes: [58, 61, 65, 68], steps: 8, vel: 0.92 }, // Bbm7
      168: { notes: [60, 63, 67, 70], steps: 7, vel: 0.92 }, // Cm7
      176: { notes: [61, 65, 68, 72], steps: 7, vel: 0.95 }, // DbMaj7
      184: { notes: [60, 64, 67, 70], steps: 7, vel: 1.0 }, // C7
    },
    arp: concatBars(
      // Bar 0: Iconic crisp 8-bit chiptune square arp intro (Fm -> Db)
      [65, 68, 72, 77, 72, 68, 65, 72, 61, 65, 68, 73, 68, 65, 61, 68],
      // Bar 1: Climbing chiptune arp (Eb -> C7 climax into drop!)
      [63, 67, 70, 75, 70, 67, 63, 70, 60, 64, 67, 70, 72, 76, 79, 82],
      // Bars 2-5: Tight syncopated funky electro pings
      [null, null, 72, null, null, 68, null, 72, null, null, 75, null, null, 72, null, null],
      [null, null, 73, null, null, 68, null, 73, null, null, 77, null, null, 73, null, null],
      [null, null, 75, null, null, 70, null, 75, null, null, 79, null, null, 75, null, null],
      [null, null, 72, null, null, 67, null, 72, null, 70, null, 72, null, 76, null, null],
      // Bars 6-11: Shimmering arcade synth-funk arpeggio sparkle
      [65, null, 68, null, 72, null, 77, null, 72, null, 68, null, 72, null, 77, null],
      [67, null, 70, null, 75, null, 79, null, 75, null, 70, null, 75, null, 79, null],
      [67, null, 70, null, 72, null, 75, null, 72, null, 70, null, 72, null, 75, null],
      [65, null, 68, null, 72, null, 77, null, 75, null, 72, null, 68, null, 72, null],
      [65, null, 68, null, 73, null, 70, null, 67, null, 70, null, 75, null, 72, null],
      [65, null, 68, null, 72, null, 77, null, 67, null, 70, null, 76, null, 79, null],
    ),
    bass: concatBars(
      // Bars 0-1: Silent during pure 8-bit chiptune intro, sub pickup at end of Bar 1
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, null, null, null, null, s(36, 1, 0.7), null, s(48, 2, 0.9), null],
      // Bars 2-5: Punchy syncopated electro-breakbeat FM bassline
      [s(41, 2, 1), null, s(41, 1, 0.75), null, null, null, s(53, 1, 0.9), null, null, null, s(41, 2, 0.95), null, s(48, 1, 0.8), null, s(44, 2, 0.88), null],
      [s(37, 2, 1), null, s(37, 1, 0.75), null, null, null, s(49, 1, 0.9), null, null, null, s(37, 2, 0.95), null, s(44, 1, 0.8), null, s(41, 2, 0.88), null],
      [s(39, 2, 1), null, s(39, 1, 0.75), null, null, null, s(51, 1, 0.9), null, null, null, s(39, 2, 0.95), null, s(46, 1, 0.8), null, s(43, 2, 0.88), null],
      [s(36, 2, 1), null, s(36, 1, 0.75), null, null, null, s(48, 1, 0.9), null, s(36, 2, 0.95), null, s(40, 2, 0.9), null, s(43, 2, 0.95), null, s(46, 2, 0.95), null],
      // Bars 6-11: Bouncy melodic synth-funk chorus bass
      [s(37, 2, 1), null, s(49, 1, 0.85), null, null, null, s(37, 2, 0.95), null, null, null, s(44, 2, 0.9), null, s(49, 2, 0.9), null, s(41, 2, 0.85), null],
      [s(39, 2, 1), null, s(51, 1, 0.85), null, null, null, s(39, 2, 0.95), null, null, null, s(46, 2, 0.9), null, s(51, 2, 0.9), null, s(43, 2, 0.85), null],
      [s(36, 2, 1), null, s(48, 1, 0.85), null, null, null, s(36, 2, 0.95), null, null, null, s(43, 2, 0.9), null, s(48, 2, 0.9), null, s(39, 2, 0.85), null],
      [s(41, 2, 1), null, s(53, 1, 0.85), null, null, null, s(41, 2, 0.95), null, s(44, 2, 0.9), null, s(48, 2, 0.92), null, s(44, 2, 0.88), null, s(41, 2, 0.9), null],
      [s(34, 2, 1), null, s(46, 1, 0.85), null, s(34, 2, 0.9), null, s(41, 2, 0.85), null, s(36, 2, 1), null, s(48, 1, 0.85), null, s(36, 2, 0.9), null, s(43, 2, 0.88), null],
      [s(37, 2, 1), null, s(49, 1, 0.85), null, s(37, 2, 0.92), null, s(44, 2, 0.9), null, s(36, 2, 1), null, s(48, 1, 0.85), null, s(40, 2, 0.95), null, s(43, 2, 0.95), null],
    ),
    lead: concatBars(
      // Bars 0-1: Let the sparkling 8-bit chiptune arp shine solo!
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 2-5: Catchy, playful syncopated electro-breakbeat synth hook
      [s(77, 2, 0.95), null, s(75, 1, 0.85), null, s(72, 2, 0.9), null, s(75, 2, 0.95), null, null, null, s(77, 2, 1, -2), null, s(80, 2, 0.95), null, s(77, 2, 0.85), null],
      [s(73, 2, 0.95), null, s(72, 1, 0.85), null, s(68, 2, 0.9), null, s(72, 2, 0.92), null, null, null, s(73, 2, 0.95), null, s(75, 2, 0.95), null, s(72, 2, 0.85), null],
      [s(75, 2, 0.95), null, s(72, 1, 0.85), null, s(70, 2, 0.9), null, s(72, 2, 0.95), null, null, null, s(75, 2, 1), null, s(79, 2, 0.95), null, s(75, 2, 0.88), null],
      [s(72, 3, 0.95), null, null, s(70, 2, 0.88), null, s(67, 2, 0.85), null, s(70, 2, 0.9), null, s(72, 3, 0.95), null, null, s(76, 3, 1), null, null, null],
      // Bars 6-11: Euphoric, super-catchy arcade synth-funk chorus melody!
      [s(80, 3, 1, -2), null, null, s(77, 2, 0.9), null, s(75, 2, 0.88), null, s(77, 3, 0.95), null, null, s(80, 2, 0.95), null, s(84, 3, 1), null, null, null],
      [s(82, 3, 1), null, null, s(79, 2, 0.9), null, s(75, 2, 0.88), null, s(79, 3, 0.95), null, null, s(77, 2, 0.9), null, s(75, 3, 0.92), null, null, null],
      [s(79, 3, 0.98), null, null, s(75, 2, 0.9), null, s(72, 2, 0.88), null, s(75, 3, 0.95), null, null, s(79, 2, 0.95), null, s(82, 3, 1), null, null, null],
      [s(80, 4, 1, -1), null, null, null, s(77, 2, 0.92), null, s(75, 2, 0.9), null, s(72, 4, 0.95), null, null, null, s(75, 2, 0.88), null, s(77, 2, 0.92), null],
      [s(77, 3, 0.98), null, null, s(73, 2, 0.9), null, s(77, 2, 0.95), null, s(80, 2, 1), null, s(79, 3, 0.95), null, null, s(75, 2, 0.9), null, s(79, 2, 0.95), null],
      [s(80, 4, 1), null, null, null, s(84, 2, 1), null, s(80, 2, 0.92), null, s(79, 4, 1, -1), null, null, null, s(76, 3, 0.95), null, null, null],
    ),
    counter: concatBars(
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 6-11: Bright octave-bell harmony answers in the chorus
      [null, null, null, null, null, null, null, null, null, null, null, null, s(72, 2, 0.7), null, s(77, 2, 0.78), null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(70, 2, 0.7), null, s(75, 2, 0.78), null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(70, 2, 0.7), null, s(75, 2, 0.78), null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(72, 2, 0.72), null, s(77, 2, 0.8), null],
      [null, null, null, null, s(68, 2, 0.72), null, null, null, null, null, null, null, s(72, 2, 0.75), null, null, null],
      [null, null, null, null, s(72, 2, 0.76), null, null, null, null, null, null, null, s(76, 2, 0.8), null, s(79, 2, 0.85), null],
    ),
    accentSteps: [32, 48, 64, 80, 96, 112, 128, 144, 160, 176],
    kick: [
      ...repeatBars([0, 6, 10], [2, 3, 4, 5]),
      ...repeatBars([0, 3, 6, 10], [6, 7, 8, 9, 10, 11]),
    ],
    snare: [
      30, 31, // snappy fill out of 8-bit intro into drop!
      ...repeatBars([4, 12], [2, 3, 4, 5, 6, 7, 8, 9, 10]),
      180, 188, 190, 191, // energetic turnaround fill
    ],
    clap: repeatBars([4, 12], [6, 7, 8, 9, 10, 11]),
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatAccent: repeatBars([2, 6, 10, 14], [6, 7, 8, 9, 10, 11]),
    hatOpen: repeatBars([14], [3, 5, 7, 9]),
    crash: [32, 96, 160],
    leadVoice: {
      waveform: 'pulse25',
      detuneCents: 6,
      highpassHz: 280,
      cutoffHz: 3200,
      cutoffPeakHz: 5800,
      filterDecaySec: 0.14,
      q: 1.4,
      attackSec: 0.008,
      decaySec: 0.14,
      sustainLevel: 0.72,
      releaseSec: 0.14,
      gain: 0.165,
      delaySend: 0.24,
      reverbSend: 0.28,
      pan: 0.06,
      vibratoHz: 5.5,
      vibratoCents: 11,
      vibratoDelaySec: 0.12,
    },
    counterVoice: {
      waveform: 'epiano',
      highpassHz: 420,
      cutoffHz: 4200,
      attackSec: 0.005,
      decaySec: 0.18,
      sustainLevel: 0.28,
      releaseSec: 0.24,
      gain: 0.11,
      fmRatio: 3,
      fmIndexHz: 110,
      fmDecaySec: 0.08,
      delaySend: 0.26,
      reverbSend: 0.34,
      pan: 0.38,
    },
    arpVoice: {
      waveform: 'pulse25',
      highpassHz: 360,
      cutoffHz: 4600,
      attackSec: 0.003,
      decaySec: 0.075,
      sustainLevel: 0.22,
      releaseSec: 0.06,
      gain: 0.105,
      delaySend: 0.22,
      reverbSend: 0.16,
      pan: -0.26,
    },
    bassVoice: {
      waveform: 'slapbass',
      cutoffHz: 950,
      cutoffPeakHz: 2600,
      filterDecaySec: 0.09,
      q: 2.0,
      attackSec: 0.004,
      decaySec: 0.12,
      sustainLevel: 0.58,
      releaseSec: 0.08,
      gain: 0.24,
      subOctaveGain: 0.38,
      fmRatio: 2,
      fmIndexHz: 95,
      fmDecaySec: 0.055,
      reverbSend: 0.04,
    },
    padVoice: {
      waveform: 'epiano',
      detuneCents: 6,
      highpassHz: 220,
      cutoffHz: 3000,
      cutoffPeakHz: 4600,
      filterDecaySec: 0.25,
      attackSec: 0.012,
      decaySec: 0.32,
      sustainLevel: 0.52,
      releaseSec: 0.38,
      gain: 0.088,
      fmRatio: 7,
      fmIndexHz: 48,
      fmDecaySec: 0.06,
      reverbSend: 0.36,
      pan: -0.18,
    },
    altPadVoice: {
      waveform: 'brass',
      detuneCents: 9,
      highpassHz: 260,
      cutoffHz: 2200,
      cutoffPeakHz: 4800,
      filterDecaySec: 0.1,
      q: 1.4,
      attackSec: 0.008,
      decaySec: 0.12,
      sustainLevel: 0.45,
      releaseSec: 0.1,
      gain: 0.078,
      reverbSend: 0.24,
      pan: 0.24,
    },
    drumGain: 0.29,
    delayFeedback: 0.24,
    delayMix: 0.18,
    reverbMix: 0.24,
  },

  // ==========================================================================
  // 2. 150 pts — "Velvet Machinery"
  //    Inspired by: Escape Goat OST — Machinery
  //    118 BPM · G Dorian / G Minor · 12 bars (192 steps)
  //    Bars 0-1: Signature funky slap-bass & crisp fusion drum pocket intro
  //    Bars 2-5: Warm DX7 Rhodes minor-9th groove + glassy bells + soulful lead
  //    Bars 6-9: Soaring 90s Japanese fusion chorus with brass stabs & bends
  //    Bars 10-11: Breezy jazz-fusion turnaround walking cleanly back to Bar 0
  // ==========================================================================
  bitplane_bounce: {
    bpm: 118,
    totalSteps: 192,
    chords: {
      // Bars 2-5: Warm velvety DX7 Rhodes jazz-fusion voicings (Gm9 -> C13)
      32: { notes: [58, 62, 65, 69], steps: 10, vel: 0.88 }, // Gm9 (root G in bass)
      42: { notes: [58, 62, 65, 69], steps: 4, vel: 0.62 },
      48: { notes: [58, 62, 64, 69], steps: 10, vel: 0.88 }, // C13 (root C in bass)
      58: { notes: [58, 62, 64, 69], steps: 4, vel: 0.62 },
      64: { notes: [58, 62, 65, 69], steps: 10, vel: 0.9 }, // Gm9
      74: { notes: [60, 63, 67, 70], steps: 4, vel: 0.68 }, // Cm7 passing
      80: { notes: [58, 62, 64, 69], steps: 8, vel: 0.88 }, // C13
      88: { notes: [60, 62, 66, 69], steps: 6, vel: 0.92, altVoice: true }, // D9 brass lift
      // Bars 6-9: Lush soaring fusion chorus (EbMaj7 -> Dm7 -> Cm9 -> D7)
      96: { notes: [58, 62, 65, 67], steps: 11, vel: 0.94 }, // EbMaj7
      108: { notes: [58, 62, 65, 67], steps: 3, vel: 0.72, altVoice: true },
      112: { notes: [57, 60, 64, 67], steps: 11, vel: 0.92 }, // Dm7(11)
      124: { notes: [57, 60, 64, 67], steps: 3, vel: 0.72, altVoice: true },
      128: { notes: [58, 62, 63, 67], steps: 11, vel: 0.94 }, // Cm9
      144: { notes: [57, 60, 65, 67], steps: 7, vel: 0.9 }, // F6/9
      152: { notes: [58, 62, 64, 69], steps: 7, vel: 0.92, altVoice: true }, // C13 stab
      // Bars 10-11: Breezy fusion turnaround (Cm9 -> F13 -> BbMaj7 -> D7)
      160: { notes: [58, 62, 63, 67], steps: 7, vel: 0.9 }, // Cm9
      168: { notes: [57, 60, 62, 69], steps: 7, vel: 0.9 }, // F13
      176: { notes: [57, 62, 65, 69], steps: 7, vel: 0.92 }, // BbMaj7
      184: { notes: [57, 60, 66, 69], steps: 7, vel: 0.95, altVoice: true }, // D7 brass hit
    },
    bass: concatBars(
      // Bar 0-1: Iconic funky slap-bass pocket (thumb low G + bright octave pop!)
      [s(43, 2, 1), null, s(43, 1, 0.7), s(55, 1, 0.92), null, null, s(43, 2, 0.95), null, null, s(41, 1, 0.78), s(43, 2, 0.95), null, s(53, 1, 0.88), null, s(50, 2, 0.85), null],
      [s(43, 2, 1), null, s(43, 1, 0.7), s(55, 1, 0.92), null, null, s(48, 2, 0.95), null, null, s(46, 1, 0.8), s(48, 2, 0.92), null, s(50, 1, 0.88), null, s(46, 2, 0.88), null],
      // Bars 2-5: Gm9 -> C13 -> Gm9 -> C13/D7 funky slap pocket
      [s(43, 2, 1), null, s(43, 1, 0.7), s(55, 1, 0.9), null, null, s(43, 2, 0.92), null, null, s(41, 1, 0.75), s(43, 2, 0.92), null, s(53, 1, 0.88), null, s(50, 2, 0.84), null],
      [s(36, 2, 1), null, s(36, 1, 0.7), s(48, 1, 0.92), null, null, s(36, 2, 0.92), null, null, s(43, 1, 0.8), s(46, 2, 0.92), null, s(48, 1, 0.9), null, s(43, 2, 0.85), null],
      [s(43, 2, 1), null, s(43, 1, 0.7), s(55, 1, 0.92), null, null, s(43, 2, 0.92), null, null, s(46, 1, 0.82), s(48, 2, 0.92), null, s(50, 1, 0.88), null, s(46, 2, 0.86), null],
      [s(36, 2, 1), null, s(48, 1, 0.88), null, null, null, s(36, 2, 0.9), null, s(38, 2, 1), null, s(50, 1, 0.9), null, s(45, 2, 0.88), null, s(38, 2, 0.92), null],
      // Bars 6-9: EbMaj7 -> Dm7 -> Cm9 -> F6/C13 walking fusion slap bass
      [s(39, 2, 1), null, s(51, 1, 0.88), null, null, null, s(39, 2, 0.92), null, null, s(46, 1, 0.82), s(51, 2, 0.9), null, s(46, 2, 0.85), null, s(43, 2, 0.85), null],
      [s(38, 2, 1), null, s(50, 1, 0.88), null, null, null, s(38, 2, 0.92), null, null, s(45, 1, 0.82), s(50, 2, 0.9), null, s(45, 2, 0.85), null, s(41, 2, 0.85), null],
      [s(36, 2, 1), null, s(48, 1, 0.88), null, null, null, s(36, 2, 0.92), null, null, s(43, 1, 0.82), s(48, 2, 0.9), null, s(46, 2, 0.86), null, s(43, 2, 0.86), null],
      [s(41, 2, 1), null, s(53, 1, 0.88), null, s(41, 2, 0.9), null, s(45, 2, 0.86), null, s(36, 2, 1), null, s(48, 1, 0.9), null, s(43, 2, 0.9), null, s(46, 2, 0.9), null],
      // Bars 10-11: Cm9 -> F13 -> BbMaj7 -> D7 nimble turnaround
      [s(36, 2, 1), null, s(48, 1, 0.88), null, s(43, 2, 0.88), null, s(36, 2, 0.86), null, s(41, 2, 1), null, s(53, 1, 0.88), null, s(48, 2, 0.88), null, s(45, 2, 0.86), null],
      [s(34, 2, 1), null, s(46, 1, 0.88), null, s(41, 2, 0.88), null, s(34, 2, 0.86), null, s(38, 2, 1), null, s(50, 1, 0.92), null, s(45, 2, 0.9), null, s(41, 2, 0.92), null],
    ),
    arp: concatBars(
      // Bars 0-1: Subtle syncopated FM bell ticks over the slap bass intro
      [null, null, null, null, null, null, 74, null, null, null, null, null, null, null, 79, null],
      [null, null, null, null, null, null, 77, null, null, null, null, null, 74, null, 79, null],
      // Bars 2-5: Sparkly DX7 bell accents answering the Rhodes
      [null, null, 74, null, null, null, 77, null, null, null, 81, null, null, null, 79, null],
      [null, null, 76, null, null, null, 79, null, null, null, 81, null, null, null, 76, null],
      [null, null, 74, null, null, null, 77, null, null, null, 81, null, null, null, 79, null],
      [null, null, 76, null, null, null, 79, null, null, 78, null, 81, null, null, 78, null],
      // Bars 6-11: Silky bell arpeggio shimmer in chorus & bridge
      [74, null, 79, null, 82, null, 79, null, 74, null, 79, null, 82, null, 79, null],
      [72, null, 77, null, 81, null, 77, null, 72, null, 77, null, 81, null, 77, null],
      [74, null, 75, null, 79, null, 82, null, 79, null, 75, null, 74, null, 79, null],
      [72, null, 77, null, 81, null, 77, null, 76, null, 79, null, 81, null, 79, null],
      [74, null, 79, null, 75, null, 79, null, 77, null, 81, null, 74, null, 77, null],
      [74, null, 77, null, 81, null, 77, null, 78, null, 81, null, 84, null, 81, null],
    ),
    lead: concatBars(
      // Bars 0-1: Pure slap-bass & drum groove intro!
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 2-5: Soulful, expressive 90s fusion FM synth lead with smooth glides
      [null, null, s(74, 3, 0.92, -2), null, null, s(77, 2, 0.9), null, s(79, 4, 0.96, -1), null, null, null, s(77, 2, 0.86), null, s(74, 3, 0.88), null, null],
      [null, null, s(76, 3, 0.94, -2), null, null, s(79, 2, 0.92), null, s(81, 4, 0.98), null, null, null, s(79, 2, 0.88), null, s(76, 2, 0.86), null, s(74, 2, 0.84)],
      [s(74, 3, 0.94), null, null, s(77, 2, 0.9), null, s(79, 2, 0.94), null, s(82, 4, 1, -2), null, null, null, s(81, 2, 0.9), null, s(79, 3, 0.9), null, null],
      [s(76, 4, 0.94), null, null, null, s(74, 2, 0.86), null, s(72, 2, 0.85), null, s(74, 4, 0.95), null, null, null, s(78, 3, 0.95, -2), null, null, null],
      // Bars 6-9: Soaring jazz-fusion chorus melody!
      [s(79, 4, 1, -2), null, null, null, s(82, 2, 0.94), null, s(86, 4, 1, -2), null, null, null, s(82, 2, 0.9), null, s(79, 3, 0.92), null, null, null],
      [s(81, 4, 0.98), null, null, null, s(77, 2, 0.9), null, s(76, 4, 0.94), null, null, null, s(77, 2, 0.9), null, s(79, 3, 0.94), null, null, null],
      [s(79, 3, 0.96), null, null, s(75, 2, 0.9), null, s(74, 2, 0.88), null, s(75, 3, 0.94), null, null, s(79, 2, 0.95), null, s(82, 3, 1), null, null, null],
      [s(81, 4, 1, -2), null, null, null, s(79, 2, 0.92), null, s(77, 2, 0.9), null, s(76, 5, 0.96), null, null, null, null, s(74, 2, 0.88), null, null],
      // Bars 10-11: Breezy playful fusion bridge & turnaround
      [s(75, 3, 0.95), null, null, s(79, 2, 0.92), null, s(74, 2, 0.88), null, null, s(77, 3, 0.95), null, null, s(81, 2, 0.94), null, s(79, 2, 0.9), null, null],
      [s(77, 3, 0.96), null, null, s(74, 2, 0.9), null, s(77, 2, 0.94), null, null, s(78, 4, 1, -2), null, null, null, s(81, 3, 0.98), null, null, null],
    ),
    counter: concatBars(
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 6-9: Subtle warm synth-brass harmony pad answering chorus phrases
      [null, null, null, null, null, null, null, null, null, null, null, null, s(70, 3, 0.72), null, null, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(69, 3, 0.72), null, null, null],
      [null, null, null, null, null, null, null, null, null, null, null, null, s(70, 3, 0.72), null, null, null],
      [null, null, null, null, null, null, null, null, s(69, 3, 0.75), null, null, null, s(72, 3, 0.78), null, null, null],
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, s(72, 3, 0.75), null, null, null, s(74, 3, 0.78), null, null, null],
    ),
    accentSteps: [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176],
    kick: repeatBars([0, 6, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    snare: [
      ...repeatBars([4, 12], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      180, 188, 190,
    ],
    rim: repeatBars([7, 15], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    hatClosed: repeatBars([0, 2, 3, 4, 6, 8, 10, 11, 12, 14], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatAccent: repeatBars([2, 6, 10, 14], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatOpen: repeatBars([14], [1, 3, 5, 7, 9, 11]),
    crash: [32, 96],
    leadVoice: {
      waveform: 'brass',
      detuneCents: 7,
      highpassHz: 260,
      cutoffHz: 2400,
      cutoffPeakHz: 4800,
      filterDecaySec: 0.16,
      q: 1.5,
      attackSec: 0.018,
      decaySec: 0.16,
      sustainLevel: 0.78,
      releaseSec: 0.18,
      gain: 0.165,
      fmRatio: 1,
      fmIndexHz: 42,
      fmDecaySec: 0.12,
      delaySend: 0.24,
      reverbSend: 0.34,
      pan: 0.08,
      vibratoHz: 5.2,
      vibratoCents: 14,
      vibratoDelaySec: 0.14,
    },
    counterVoice: {
      waveform: 'brass',
      detuneCents: 8,
      highpassHz: 260,
      cutoffHz: 2000,
      cutoffPeakHz: 3600,
      filterDecaySec: 0.18,
      attackSec: 0.025,
      decaySec: 0.18,
      sustainLevel: 0.65,
      releaseSec: 0.22,
      gain: 0.11,
      reverbSend: 0.34,
      pan: -0.32,
    },
    arpVoice: {
      waveform: 'epiano',
      highpassHz: 480,
      cutoffHz: 5200,
      attackSec: 0.004,
      decaySec: 0.16,
      sustainLevel: 0.18,
      releaseSec: 0.24,
      gain: 0.095,
      fmRatio: 4,
      fmIndexHz: 145,
      fmDecaySec: 0.07,
      delaySend: 0.28,
      reverbSend: 0.34,
      pan: 0.36,
    },
    bassVoice: {
      waveform: 'slapbass',
      cutoffHz: 880,
      cutoffPeakHz: 3200,
      filterDecaySec: 0.075,
      q: 2.2,
      attackSec: 0.003,
      decaySec: 0.11,
      sustainLevel: 0.54,
      releaseSec: 0.075,
      gain: 0.255,
      subOctaveGain: 0.32,
      fmRatio: 2,
      fmIndexHz: 115,
      fmDecaySec: 0.05,
      reverbSend: 0.05,
    },
    padVoice: {
      waveform: 'epiano',
      detuneCents: 5,
      highpassHz: 220,
      cutoffHz: 2800,
      cutoffPeakHz: 4200,
      filterDecaySec: 0.28,
      attackSec: 0.01,
      decaySec: 0.36,
      sustainLevel: 0.48,
      releaseSec: 0.42,
      gain: 0.092,
      fmRatio: 14,
      fmIndexHz: 38,
      fmDecaySec: 0.055,
      reverbSend: 0.38,
      pan: -0.22,
    },
    altPadVoice: {
      waveform: 'brass',
      detuneCents: 10,
      highpassHz: 260,
      cutoffHz: 2400,
      cutoffPeakHz: 5200,
      filterDecaySec: 0.12,
      attackSec: 0.01,
      decaySec: 0.12,
      sustainLevel: 0.55,
      releaseSec: 0.14,
      gain: 0.082,
      reverbSend: 0.28,
      pan: 0.22,
    },
    drumGain: 0.27,
    delayFeedback: 0.25,
    delayMix: 0.18,
    reverbMix: 0.26,
  },

  // ==========================================================================
  // 3. 400 pts — "Celestial Assembly"
  //    Inspired by: Sea of Stars — Stars Align on the Assembly Line
  //    120 BPM · C Minor / Eb Major · 12 bars (192 steps)
  //    Bars 0-3: Rubbery cosmic electro-funk bass, 80s gated snare & synth stabs
  //    Bars 4-7: Soaring nostalgic synthwave lead over wide stereo pads
  //    Bars 8-9: Tight robotic drum-machine & bleep break
  //    Bars 10-11: Uplifting full-power cosmic chorus climax
  // ==========================================================================
  outrun_crt: {
    bpm: 120,
    totalSteps: 192,
    chords: {
      // Bars 0-3: Slick syncopated electro-funk brass stabs (altPadVoice)
      0: { notes: [60, 63, 67, 70], steps: 4, vel: 0.88, altVoice: true }, // Cm7
      10: { notes: [60, 63, 67, 70], steps: 3, vel: 0.72, altVoice: true },
      16: { notes: [56, 60, 63, 67], steps: 4, vel: 0.88, altVoice: true }, // AbMaj7
      26: { notes: [56, 60, 63, 67], steps: 3, vel: 0.72, altVoice: true },
      32: { notes: [56, 60, 65, 67], steps: 4, vel: 0.88, altVoice: true }, // Fm9
      42: { notes: [56, 60, 65, 67], steps: 3, vel: 0.72, altVoice: true },
      48: { notes: [58, 62, 65, 67], steps: 6, vel: 0.85, altVoice: true }, // G7sus4
      56: { notes: [59, 62, 65, 67], steps: 6, vel: 0.94, altVoice: true }, // G7
      // Bars 4-7: Wide lush stereo synthwave pads (padVoice)
      64: { notes: [56, 60, 63, 67], steps: 15, vel: 0.95 }, // AbMaj7
      80: { notes: [58, 62, 65, 69], steps: 15, vel: 0.95 }, // BbMaj7
      96: { notes: [60, 63, 67, 70], steps: 15, vel: 0.95 }, // Cm7
      112: { notes: [58, 62, 67, 70], steps: 8, vel: 0.9 }, // Gm7
      120: { notes: [59, 62, 65, 67], steps: 7, vel: 0.95 }, // G7
      // Bars 8-9: Robotic machine-break staccato stabs
      128: { notes: [60, 63, 67, 72], steps: 2, vel: 0.85, altVoice: true },
      134: { notes: [60, 63, 67, 72], steps: 2, vel: 0.78, altVoice: true },
      144: { notes: [56, 60, 65, 70], steps: 2, vel: 0.85, altVoice: true },
      152: { notes: [58, 62, 67, 70], steps: 4, vel: 0.9, altVoice: true },
      // Bars 10-11: Big uplifting synthwave finale pads
      160: { notes: [56, 60, 63, 67], steps: 8, vel: 1.0 }, // AbMaj7
      168: { notes: [58, 62, 65, 70], steps: 7, vel: 1.0 }, // Bb
      176: { notes: [60, 63, 67, 70], steps: 8, vel: 1.0 }, // Cm7
      184: { notes: [59, 62, 65, 67], steps: 7, vel: 1.0 }, // G7
    },
    bass: concatBars(
      // Bars 0-3: Signature rubbery bouncy electro-funk bassline
      [s(36, 2, 1), null, s(36, 1, 0.78), s(48, 1, 0.92), null, null, s(46, 2, 0.9), null, s(36, 2, 0.95), null, s(43, 2, 0.88), null, s(46, 1, 0.86), null, s(48, 2, 0.92), null],
      [s(32, 2, 1), null, s(32, 1, 0.78), s(44, 1, 0.92), null, null, s(43, 2, 0.9), null, s(32, 2, 0.95), null, s(39, 2, 0.88), null, s(43, 1, 0.86), null, s(44, 2, 0.9), null],
      [s(41, 2, 1), null, s(41, 1, 0.78), s(53, 1, 0.92), null, null, s(51, 2, 0.9), null, s(41, 2, 0.95), null, s(48, 2, 0.88), null, s(44, 1, 0.85), null, s(48, 2, 0.9), null],
      [s(43, 2, 1), null, s(43, 1, 0.8), s(55, 1, 0.92), null, null, s(43, 2, 0.9), null, s(43, 2, 0.95), null, s(41, 2, 0.9), null, s(39, 2, 0.9), null, s(38, 2, 0.92), null],
      // Bars 4-7: Driving 8th-note cosmic synthwave bass
      [s(32, 2, 1), null, s(44, 2, 0.85), null, s(32, 2, 0.95), null, s(44, 2, 0.85), null, s(32, 2, 0.95), null, s(44, 2, 0.85), null, s(39, 2, 0.88), null, s(44, 2, 0.88), null],
      [s(34, 2, 1), null, s(46, 2, 0.85), null, s(34, 2, 0.95), null, s(46, 2, 0.85), null, s(34, 2, 0.95), null, s(46, 2, 0.85), null, s(41, 2, 0.88), null, s(46, 2, 0.88), null],
      [s(36, 2, 1), null, s(48, 2, 0.85), null, s(36, 2, 0.95), null, s(48, 2, 0.85), null, s(36, 2, 0.95), null, s(48, 2, 0.85), null, s(43, 2, 0.88), null, s(46, 2, 0.88), null],
      [s(43, 2, 1), null, s(55, 2, 0.85), null, s(43, 2, 0.95), null, s(46, 2, 0.88), null, s(43, 2, 0.95), null, s(41, 2, 0.9), null, s(39, 2, 0.9), null, s(38, 2, 0.95), null],
      // Bars 8-9: Tight syncopated robotic machine-break bass
      [s(36, 2, 1), null, null, s(48, 1, 0.9), null, null, s(36, 2, 0.95), null, null, null, s(43, 2, 0.9), null, s(46, 2, 0.92), null, null, null],
      [s(41, 2, 1), null, null, s(53, 1, 0.9), null, null, s(41, 2, 0.95), null, s(43, 2, 1), null, s(43, 1, 0.8), null, s(46, 2, 0.95), null, s(43, 2, 0.95), null],
      // Bars 10-11: Epic lifting chorus bass
      [s(32, 2, 1), null, s(44, 2, 0.88), null, s(32, 2, 0.95), null, s(44, 2, 0.88), null, s(34, 2, 1), null, s(46, 2, 0.88), null, s(34, 2, 0.95), null, s(46, 2, 0.88), null],
      [s(36, 2, 1), null, s(48, 2, 0.88), null, s(36, 2, 0.95), null, s(46, 2, 0.88), null, s(43, 2, 1), null, s(41, 2, 0.92), null, s(39, 2, 0.92), null, s(38, 2, 0.95), null],
    ),
    arp: concatBars(
      // Bars 0-3: Cosmic clockwork 16th-note pulse arps
      [60, null, 67, null, 70, null, 72, null, 67, null, 70, null, 75, null, 72, null],
      [60, null, 63, null, 67, null, 72, null, 67, null, 63, null, 72, null, 67, null],
      [60, null, 65, null, 68, null, 72, null, 68, null, 65, null, 72, null, 68, null],
      [62, null, 67, null, 70, null, 74, null, 62, null, 67, null, 71, null, 74, null],
      // Bars 4-7: Flowing synthwave shimmer
      [63, 67, 72, 75, 72, 67, 63, 67, 63, 67, 72, 75, 72, 67, 63, 67],
      [65, 70, 74, 77, 74, 70, 65, 70, 65, 70, 74, 77, 74, 70, 65, 70],
      [67, 72, 75, 79, 75, 72, 67, 72, 67, 72, 75, 79, 75, 72, 67, 72],
      [67, 70, 74, 79, 74, 70, 67, 70, 67, 71, 74, 79, 74, 71, 67, 71],
      // Bars 8-9: Playful robotic assembly-line chiptune bleeps
      [72, null, 75, null, 79, null, null, 75, null, 72, null, 79, null, 84, null, null],
      [77, null, 75, null, 72, null, null, 74, null, 79, null, 77, null, 74, null, null],
      // Bars 10-11: Sparkling cosmic finale arps
      [63, 67, 72, 75, 79, 75, 72, 67, 65, 70, 74, 77, 82, 77, 74, 70],
      [67, 72, 75, 79, 84, 79, 75, 72, 67, 71, 74, 79, 83, 79, 74, 71],
    ),
    lead: concatBars(
      // Bars 0-3: Slick funky rhythmic synth motif
      [null, null, s(72, 2, 0.92), null, null, null, s(75, 2, 0.95), null, null, null, s(74, 2, 0.9), null, s(72, 2, 0.9), null, s(70, 2, 0.86), null],
      [s(72, 4, 0.95), null, null, null, s(68, 2, 0.88), null, s(72, 2, 0.92), null, s(75, 4, 0.98, -2), null, null, null, s(72, 3, 0.9), null, null, null],
      [s(77, 3, 0.98), null, null, s(75, 2, 0.9), null, s(72, 2, 0.88), null, s(75, 3, 0.94), null, null, s(72, 2, 0.9), null, s(70, 3, 0.88), null, null, null],
      [s(74, 6, 0.98, -2), null, null, null, null, null, s(72, 2, 0.88), null, s(74, 4, 0.98), null, null, null, s(79, 3, 1), null, null, null],
      // Bars 4-7: Soaring, emotional cosmic synthwave chorus lead!
      [s(79, 4, 1, -2), null, null, null, s(80, 2, 0.95), null, s(79, 2, 0.92), null, s(75, 4, 0.96), null, null, null, s(72, 3, 0.9), null, null, null],
      [s(77, 4, 1), null, null, null, s(79, 2, 0.95), null, s(77, 2, 0.92), null, s(74, 4, 0.95), null, null, null, s(77, 3, 0.94), null, null, null],
      [s(79, 4, 1, -2), null, null, null, s(84, 2, 1), null, s(82, 2, 0.95), null, s(79, 4, 0.98), null, null, null, s(75, 3, 0.92), null, null, null],
      [s(74, 6, 0.98), null, null, null, null, null, s(75, 2, 0.92), null, s(79, 6, 1, -2), null, null, null, null, null, null, null],
      // Bars 8-9: Let the robotic machine break groove!
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, s(74, 2, 0.9), null, s(75, 2, 0.94), null, s(79, 3, 1, -2), null, null, null],
      // Bars 10-11: Uplifting soaring finale hook!
      [s(80, 4, 1), null, null, null, s(79, 2, 0.94), null, s(75, 2, 0.92), null, s(82, 4, 1, -2), null, null, null, s(79, 3, 0.95), null, null, null],
      [s(84, 6, 1, -2), null, null, null, null, null, s(82, 2, 0.94), null, s(79, 6, 1), null, null, null, null, null, null, null],
    ),
    counter: concatBars(
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 4-7: Warm upper harmony strings/synth doubling key chorus notes
      [s(75, 4, 0.72), null, null, null, null, null, null, null, s(72, 4, 0.7), null, null, null, null, null, null, null],
      [s(74, 4, 0.72), null, null, null, null, null, null, null, s(70, 4, 0.7), null, null, null, null, null, null, null],
      [s(75, 4, 0.74), null, null, null, s(79, 4, 0.78), null, null, null, s(75, 4, 0.72), null, null, null, null, null, null, null],
      [s(70, 6, 0.72), null, null, null, null, null, null, null, s(74, 6, 0.78), null, null, null, null, null, null, null],
      EMPTY_BAR,
      EMPTY_BAR,
      [s(75, 4, 0.78), null, null, null, null, null, null, null, s(77, 4, 0.8), null, null, null, null, null, null, null],
      [s(79, 6, 0.84), null, null, null, null, null, null, null, s(74, 6, 0.8), null, null, null, null, null, null, null],
    ),
    accentSteps: [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176],
    kick: [
      ...repeatBars([0, 6, 8, 14], [0, 1, 2, 3]),
      ...repeatBars([0, 4, 8, 12], [4, 5, 6, 7, 10, 11]),
      128, 134, 138, 144, 150, 154, 156,
    ],
    snare: [
      ...repeatBars([4, 12], [0, 1, 2, 3, 4, 5, 6, 7, 8, 10]),
      148, 156, 158, 159, // robotic machine-break snare roll into chorus!
      180, 188, 190,
    ],
    gatedSnare: true,
    clap: repeatBars([4, 12], [0, 1, 2, 3, 4, 5, 6, 7, 10, 11]),
    rim: repeatBars([2, 10], [8, 9]),
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatAccent: repeatBars([2, 6, 10, 14], [4, 5, 6, 7, 10, 11]),
    hatOpen: repeatBars([14], [1, 3, 5, 7, 11]),
    crash: [64, 160],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 10,
      chorus3: true,
      highpassHz: 260,
      cutoffHz: 2800,
      cutoffPeakHz: 5600,
      filterDecaySec: 0.16,
      q: 1.5,
      attackSec: 0.012,
      decaySec: 0.18,
      sustainLevel: 0.78,
      releaseSec: 0.22,
      gain: 0.145,
      delaySend: 0.3,
      reverbSend: 0.36,
      pan: 0.05,
      vibratoHz: 5.4,
      vibratoCents: 13,
      vibratoDelaySec: 0.14,
    },
    counterVoice: {
      waveform: 'strings',
      detuneCents: 12,
      highpassHz: 320,
      cutoffHz: 3000,
      attackSec: 0.06,
      decaySec: 0.25,
      sustainLevel: 0.72,
      releaseSec: 0.35,
      gain: 0.095,
      reverbSend: 0.45,
      pan: -0.34,
    },
    arpVoice: {
      waveform: 'pulse25',
      highpassHz: 420,
      cutoffHz: 3400,
      cutoffPeakHz: 5200,
      filterDecaySec: 0.07,
      q: 1.8,
      attackSec: 0.004,
      decaySec: 0.08,
      sustainLevel: 0.22,
      releaseSec: 0.07,
      gain: 0.082,
      delaySend: 0.28,
      reverbSend: 0.22,
      pan: 0.34,
    },
    bassVoice: {
      waveform: 'sawtooth',
      detuneCents: 6,
      cutoffHz: 580,
      cutoffPeakHz: 2400,
      filterDecaySec: 0.1,
      q: 3.1,
      attackSec: 0.005,
      decaySec: 0.13,
      sustainLevel: 0.56,
      releaseSec: 0.09,
      gain: 0.235,
      subOctaveGain: 0.45,
      reverbSend: 0.04,
    },
    padVoice: {
      waveform: 'strings',
      detuneCents: 13,
      chorus3: true,
      highpassHz: 240,
      cutoffHz: 2200,
      cutoffPeakHz: 3400,
      filterDecaySec: 0.55,
      attackSec: 0.11,
      decaySec: 0.4,
      sustainLevel: 0.72,
      releaseSec: 0.55,
      gain: 0.068,
      reverbSend: 0.48,
      pan: -0.14,
    },
    altPadVoice: {
      waveform: 'brass',
      detuneCents: 9,
      highpassHz: 280,
      cutoffHz: 2000,
      cutoffPeakHz: 4800,
      filterDecaySec: 0.11,
      q: 1.6,
      attackSec: 0.008,
      decaySec: 0.12,
      sustainLevel: 0.45,
      releaseSec: 0.12,
      gain: 0.076,
      reverbSend: 0.28,
      pan: 0.22,
    },
    drumGain: 0.3,
    delayFeedback: 0.3,
    delayMix: 0.22,
    reverbMix: 0.3,
  },

  // ==========================================================================
  // 4. 650 pts — "Ironworks Sector"
  //    Inspired by: Donkey Kong Country — Fear Factory
  //    130 BPM · D Minor · 12 bars (192 steps)
  //    Bars 0-3: Hypnotic pulsing resonant industrial bass + metallic clanks & rims
  //    Bars 4-5: Dramatic orchestral brass hits over driving industrial rhythm
  //    Bars 6-9: Huge sweeping emotional SNES strings & soaring lead climax
  //    Bars 10-11: Haunting ethereal celestial pad & bell breakdown -> drum slam back
  // ==========================================================================
  fm_cartridge_drive: {
    bpm: 130,
    totalSteps: 192,
    chords: {
      // Bars 4-5: Dramatic industrial brass hits (altPadVoice)
      64: { notes: [57, 62, 65, 69], steps: 4, vel: 0.95, altVoice: true }, // Dm
      74: { notes: [57, 62, 65, 69], steps: 3, vel: 0.85, altVoice: true },
      80: { notes: [55, 60, 64, 67], steps: 4, vel: 0.92, altVoice: true }, // C
      88: { notes: [58, 62, 65, 69], steps: 4, vel: 0.95, altVoice: true }, // BbMaj7
      92: { notes: [57, 61, 64, 69], steps: 3, vel: 0.98, altVoice: true }, // A
      // Bars 6-9: Huge sweeping emotional SNES strings climax (padVoice)
      96: { notes: [57, 62, 65, 69], steps: 15, vel: 1.0 }, // Dm
      112: { notes: [58, 62, 65, 69], steps: 15, vel: 1.0 }, // BbMaj7
      128: { notes: [55, 58, 62, 67], steps: 15, vel: 1.0 }, // Gm
      144: { notes: [57, 62, 64, 69], steps: 8, vel: 0.95 }, // Asus4
      152: { notes: [57, 61, 64, 69], steps: 7, vel: 1.0 }, // A7
      // Bars 10-11: Ethereal celestial pad breakdown (padVoice)
      160: { notes: [58, 62, 65, 69], steps: 15, vel: 0.9 }, // BbMaj7
      176: { notes: [57, 60, 64, 69], steps: 8, vel: 0.88 }, // Am7
      184: { notes: [57, 62, 65, 69], steps: 7, vel: 0.92 }, // Dm
    },
    bass: concatBars(
      // Bars 0-3: Signature pulsing hypnotic D-minor resonant industrial bassline
      [s(38, 2, 1), null, s(38, 1, 0.78), null, s(38, 2, 0.95), null, s(45, 1, 0.85), null, s(38, 2, 0.95), null, s(48, 1, 0.85), null, s(45, 2, 0.9), null, s(41, 1, 0.8), null],
      [s(38, 2, 1), null, s(38, 1, 0.78), null, s(38, 2, 0.95), null, s(45, 1, 0.85), null, s(36, 2, 0.95), null, s(43, 1, 0.85), null, s(34, 2, 0.95), null, s(33, 2, 0.9), null],
      [s(38, 2, 1), null, s(38, 1, 0.78), null, s(38, 2, 0.95), null, s(45, 1, 0.85), null, s(38, 2, 0.95), null, s(50, 1, 0.88), null, s(48, 2, 0.9), null, s(45, 1, 0.82), null],
      [s(34, 2, 1), null, s(34, 1, 0.8), null, s(36, 2, 0.95), null, s(36, 1, 0.8), null, s(33, 2, 1), null, s(45, 1, 0.88), null, s(40, 2, 0.9), null, s(33, 2, 0.92), null],
      // Bars 4-5: Driving industrial bass under brass punches
      [s(38, 2, 1), null, s(38, 1, 0.8), null, s(38, 2, 0.95), null, s(45, 1, 0.88), null, s(38, 2, 0.95), null, s(41, 2, 0.9), null, s(45, 2, 0.92), null, s(48, 2, 0.9), null],
      [s(36, 2, 1), null, s(36, 1, 0.8), null, s(43, 2, 0.92), null, s(36, 1, 0.82), null, s(34, 2, 1), null, s(41, 2, 0.9), null, s(33, 2, 1), null, s(40, 2, 0.95), null],
      // Bars 6-9: Powerful driving bass anchoring the sweeping strings climax!
      [s(38, 2, 1), null, s(50, 1, 0.85), null, s(38, 2, 0.95), null, s(45, 2, 0.88), null, s(38, 2, 0.95), null, s(50, 1, 0.85), null, s(41, 2, 0.9), null, s(45, 2, 0.9), null],
      [s(34, 2, 1), null, s(46, 1, 0.85), null, s(34, 2, 0.95), null, s(41, 2, 0.88), null, s(34, 2, 0.95), null, s(46, 1, 0.85), null, s(38, 2, 0.9), null, s(41, 2, 0.9), null],
      [s(43, 2, 1), null, s(55, 1, 0.85), null, s(43, 2, 0.95), null, s(50, 2, 0.88), null, s(43, 2, 0.95), null, s(46, 2, 0.9), null, s(50, 2, 0.92), null, s(46, 2, 0.9), null],
      [s(33, 2, 1), null, s(45, 1, 0.88), null, s(33, 2, 0.95), null, s(40, 2, 0.88), null, s(33, 2, 1), null, s(45, 1, 0.88), null, s(37, 2, 0.92), null, s(40, 2, 0.95), null],
      // Bars 10-11: Deep spacious bass breathing in the ethereal breakdown
      [s(34, 8, 0.85), null, null, null, null, null, null, null, s(36, 8, 0.85), null, null, null, null, null, null, null],
      [s(38, 8, 0.88), null, null, null, null, null, null, null, s(33, 6, 0.92), null, null, null, null, null, s(36, 2, 0.9), null],
    ),
    arp: concatBars(
      // Bars 0-3: Hypnotic factory metallic synth pings (classic DKC atmosphere)
      [null, null, 74, null, null, 77, null, null, null, null, 74, null, null, 81, null, null],
      [null, null, 74, null, null, 72, null, null, null, null, 70, null, null, 69, null, null],
      [null, null, 74, null, null, 77, null, null, null, null, 81, null, null, 77, null, null],
      [null, null, 70, null, null, 72, null, null, null, null, 69, null, null, 73, null, null],
      // Bars 4-5: Mechanical interlocking ticks
      [62, null, 69, null, 74, null, 69, null, 65, null, 69, null, 74, null, 69, null],
      [60, null, 67, null, 72, null, 67, null, 58, null, 65, null, 61, null, 69, null],
      // Bars 6-9: Restrained shimmer so the sweeping strings & lead dominate
      [null, null, 74, null, null, null, 81, null, null, null, 77, null, null, null, 74, null],
      [null, null, 70, null, null, null, 77, null, null, null, 74, null, null, null, 70, null],
      [null, null, 70, null, null, null, 74, null, null, null, 79, null, null, null, 74, null],
      [null, null, 69, null, null, null, 74, null, null, null, 73, null, null, null, 76, null],
      // Bars 10-11: Delicate crystalline celestial flute/bell melody in the breakdown!
      [s(77, 4, 0.92), null, null, null, s(81, 4, 0.95), null, null, null, s(79, 4, 0.92), null, null, null, s(76, 4, 0.88), null, null, null],
      [s(74, 4, 0.95), null, null, null, s(77, 4, 0.92), null, null, null, s(76, 4, 0.9), null, null, null, s(73, 3, 0.92), null, null, null],
    ),
    lead: concatBars(
      // Bars 0-3: Let the hypnotic industrial bass & factory percussion build tension!
      EMPTY_BAR,
      EMPTY_BAR,
      [null, null, null, null, s(69, 3, 0.85), null, null, null, s(74, 4, 0.9), null, null, null, s(72, 3, 0.82), null, null, null],
      [s(70, 4, 0.88), null, null, null, s(72, 3, 0.86), null, null, null, s(69, 6, 0.92), null, null, null, null, null, null, null],
      // Bars 4-5: Rhythmic sharp industrial synth motif answering the brass hits
      [null, null, null, null, s(74, 2, 0.95), null, s(77, 2, 0.95), null, s(81, 3, 1), null, null, null, s(77, 2, 0.92), null, s(74, 2, 0.9), null],
      [null, null, null, null, s(72, 2, 0.92), null, s(76, 2, 0.95), null, s(77, 3, 0.98), null, null, null, s(76, 3, 1), null, null, null],
      // Bars 6-9: HUGE sweeping melancholic heroic lead over SNES strings!
      [s(81, 6, 1, -2), null, null, null, null, null, s(79, 2, 0.92), null, s(77, 4, 0.96), null, null, null, s(74, 4, 0.94), null, null, null],
      [s(77, 6, 1), null, null, null, null, null, s(79, 2, 0.94), null, s(81, 6, 1, -2), null, null, null, null, null, s(77, 2, 0.9), null],
      [s(79, 6, 1), null, null, null, null, null, s(82, 2, 0.96), null, s(86, 4, 1, -2), null, null, null, s(82, 2, 0.94), null, s(79, 2, 0.92), null],
      [s(81, 6, 1), null, null, null, null, null, s(77, 2, 0.92), null, s(76, 6, 1), null, null, null, null, null, null, null],
      // Bars 10-11: Silent in the ethereal bell breakdown so the bells/pad float!
      EMPTY_BAR,
      EMPTY_BAR,
    ),
    counter: concatBars(
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 6-9: Sweeping harmonized counter-strings (3rds/6ths below lead!)
      [s(77, 6, 0.8), null, null, null, null, null, s(76, 2, 0.74), null, s(74, 4, 0.78), null, null, null, s(69, 4, 0.75), null, null, null],
      [s(74, 6, 0.8), null, null, null, null, null, s(76, 2, 0.75), null, s(77, 6, 0.82), null, null, null, null, null, s(74, 2, 0.74), null],
      [s(74, 6, 0.82), null, null, null, null, null, s(79, 2, 0.78), null, s(82, 4, 0.84), null, null, null, s(79, 2, 0.78), null, s(74, 2, 0.75), null],
      [s(76, 6, 0.82), null, null, null, null, null, s(74, 2, 0.75), null, s(73, 6, 0.84), null, null, null, null, null, null, null],
      EMPTY_BAR,
      EMPTY_BAR,
    ),
    accentSteps: [0, 16, 32, 48, 64, 80, 96, 112, 128, 144],
    kick: [
      ...repeatBars([0, 6, 8, 10], [0, 1, 2, 3, 4, 5]),
      ...repeatBars([0, 4, 8, 12, 14], [6, 7, 8, 9]),
      188, 190, // pickup back into industrial drop
    ],
    snare: [
      ...repeatBars([4, 12], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      188, 190, 191,
    ],
    rim: repeatBars([2, 7, 14], [0, 1, 2, 3, 4, 5]),
    clang: [
      ...repeatBars([0, 8], [0, 1, 2, 3, 4, 5]),
      96, 112, 128, 144,
    ],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    hatAccent: repeatBars([2, 6, 10, 14], [4, 5, 6, 7, 8, 9]),
    hatOpen: repeatBars([14], [1, 3, 5, 7, 9]),
    crash: [64, 96, 160],
    toms: [
      { step: 156, midi: 53, vel: 0.9 },
      { step: 157, midi: 50, vel: 0.9 },
      { step: 158, midi: 45, vel: 0.95 },
      { step: 159, midi: 41, vel: 1.0 },
    ],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 10,
      highpassHz: 280,
      cutoffHz: 2600,
      cutoffPeakHz: 5200,
      filterDecaySec: 0.18,
      q: 1.4,
      attackSec: 0.02,
      decaySec: 0.18,
      sustainLevel: 0.82,
      releaseSec: 0.24,
      gain: 0.155,
      driveAmount: 0.18,
      delaySend: 0.28,
      reverbSend: 0.42,
      pan: 0.08,
      vibratoHz: 5.3,
      vibratoCents: 15,
      vibratoDelaySec: 0.14,
    },
    counterVoice: {
      waveform: 'strings',
      detuneCents: 12,
      chorus3: true,
      highpassHz: 280,
      cutoffHz: 3200,
      attackSec: 0.055,
      decaySec: 0.22,
      sustainLevel: 0.78,
      releaseSec: 0.34,
      gain: 0.11,
      reverbSend: 0.48,
      pan: -0.32,
    },
    arpVoice: {
      waveform: 'epiano',
      highpassHz: 480,
      cutoffHz: 5000,
      attackSec: 0.006,
      decaySec: 0.26,
      sustainLevel: 0.26,
      releaseSec: 0.34,
      gain: 0.105,
      fmRatio: 3,
      fmIndexHz: 110,
      fmDecaySec: 0.1,
      delaySend: 0.34,
      reverbSend: 0.44,
      pan: 0.3,
    },
    bassVoice: {
      waveform: 'sawtooth',
      detuneCents: 7,
      cutoffHz: 520,
      cutoffPeakHz: 2100,
      filterDecaySec: 0.11,
      q: 4.2,
      attackSec: 0.005,
      decaySec: 0.12,
      sustainLevel: 0.56,
      releaseSec: 0.085,
      gain: 0.24,
      subOctaveGain: 0.48,
      driveAmount: 0.15,
      reverbSend: 0.05,
    },
    padVoice: {
      waveform: 'strings',
      detuneCents: 14,
      chorus3: true,
      highpassHz: 240,
      cutoffHz: 2600,
      cutoffPeakHz: 3800,
      filterDecaySec: 0.65,
      attackSec: 0.12,
      decaySec: 0.4,
      sustainLevel: 0.76,
      releaseSec: 0.6,
      gain: 0.075,
      reverbSend: 0.54,
    },
    altPadVoice: {
      waveform: 'brass',
      detuneCents: 10,
      highpassHz: 240,
      cutoffHz: 2200,
      cutoffPeakHz: 4800,
      filterDecaySec: 0.14,
      attackSec: 0.01,
      decaySec: 0.16,
      sustainLevel: 0.58,
      releaseSec: 0.18,
      gain: 0.095,
      reverbSend: 0.36,
      pan: -0.18,
    },
    drumGain: 0.31,
    delayFeedback: 0.32,
    delayMix: 0.24,
    reverbMix: 0.32,
  },

  // ==========================================================================
  // 5. 950 pts — "Ultra Combo"
  //    Inspired by: Killer Instinct — The Instinct (Original Arcade Soundtrack)
  //    110 BPM · E Minor / Phrygian · 12 bars (192 steps)
  //    Bars 0-1: Dark ominous sci-fi pad intro + distant clangs + drum pickup
  //    Bars 2-5: Crushing 110 BPM industrial breakbeat + cab-shaped guitar riff
  //    Bars 6-9: Aggressive soaring arena synth lead + bold brass stabs
  //    Bars 10-11: Atmospheric dark bass & sci-fi pad breakdown -> slam back
  // ==========================================================================
  subcarrier_pulse: {
    bpm: 110,
    totalSteps: 192,
    chords: {
      // Bars 0-1: Dark brooding sci-fi intro drone pads (padVoice)
      0: { notes: [52, 59, 64, 67], steps: 16, vel: 0.95 }, // Em
      16: { notes: [52, 59, 65, 67], steps: 15, vel: 0.98 }, // Em(b9) tension
      // Bars 2-5: Bold arcade orchestral/brass punches (altPadVoice)
      32: { notes: [59, 64, 67, 71], steps: 3, vel: 0.98, altVoice: true }, // Em
      44: { notes: [60, 64, 67, 72], steps: 3, vel: 0.92, altVoice: true }, // C
      48: { notes: [59, 64, 67, 71], steps: 3, vel: 0.98, altVoice: true }, // Em
      58: { notes: [57, 60, 65, 69], steps: 3, vel: 0.95, altVoice: true }, // F Phrygian punch
      64: { notes: [59, 64, 67, 71], steps: 3, vel: 0.98, altVoice: true }, // Em
      76: { notes: [57, 62, 66, 69], steps: 3, vel: 0.92, altVoice: true }, // D
      80: { notes: [59, 64, 67, 71], steps: 3, vel: 0.98, altVoice: true }, // Em
      88: { notes: [58, 62, 65, 70], steps: 3, vel: 0.95, altVoice: true }, // Bb/F tension
      92: { notes: [59, 63, 66, 71], steps: 3, vel: 1.0, altVoice: true }, // B5 slam
      // Bars 6-9: Big arena chords + brass hooks
      96: { notes: [55, 59, 64, 67], steps: 12, vel: 0.92 }, // Em
      112: { notes: [55, 60, 64, 67], steps: 8, vel: 0.92 }, // C
      120: { notes: [57, 62, 66, 69], steps: 7, vel: 0.94, altVoice: true }, // D
      128: { notes: [55, 59, 64, 67], steps: 12, vel: 0.94 }, // Em
      144: { notes: [57, 60, 65, 69], steps: 8, vel: 0.95, altVoice: true }, // F Phrygian
      152: { notes: [59, 63, 66, 71], steps: 7, vel: 1.0, altVoice: true }, // B7
      // Bars 10-11: Atmospheric dark sci-fi breakdown pads
      160: { notes: [55, 59, 64, 66], steps: 15, vel: 0.95 }, // Em9
      176: { notes: [55, 60, 64, 67], steps: 8, vel: 0.92 }, // C
      184: { notes: [59, 63, 66, 71], steps: 7, vel: 0.98, altVoice: true }, // B slam
    },
    bass: concatBars(
      // Bars 0-1: Deep pulsing sci-fi sub drone building into the drop
      [s(40, 14, 0.85), null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      [s(40, 8, 0.9), null, null, null, null, null, null, null, s(41, 4, 0.92), null, null, null, s(40, 2, 0.95), null, s(38, 2, 0.95), null],
      // Bars 2-5: Heavy swaggering industrial breakbeat bass locked to guitar riff
      [s(40, 2, 1), null, s(40, 1, 0.85), s(40, 1, 0.85), null, null, s(43, 2, 0.95), null, null, null, s(40, 2, 0.95), null, s(48, 2, 0.92), null, s(43, 2, 0.9), null],
      [s(40, 2, 1), null, s(40, 1, 0.85), s(40, 1, 0.85), null, null, s(41, 2, 0.98), null, null, null, s(40, 2, 0.95), null, s(38, 2, 0.92), null, s(35, 2, 0.92), null],
      [s(40, 2, 1), null, s(40, 1, 0.85), s(40, 1, 0.85), null, null, s(43, 2, 0.95), null, null, null, s(45, 2, 0.95), null, s(43, 2, 0.92), null, s(38, 2, 0.9), null],
      [s(40, 2, 1), null, s(40, 1, 0.85), s(40, 1, 0.85), null, null, s(41, 2, 0.98), null, s(36, 2, 0.95), null, s(38, 2, 0.95), null, s(35, 3, 1), null, null, null],
      // Bars 6-9: Driving heavy breakbeat bass under soaring arena hook
      [s(40, 2, 1), null, s(40, 1, 0.8), s(52, 1, 0.9), null, null, s(40, 2, 0.95), null, null, null, s(47, 2, 0.92), null, s(43, 2, 0.9), null, s(40, 2, 0.9), null],
      [s(36, 2, 1), null, s(36, 1, 0.8), s(48, 1, 0.9), null, null, s(36, 2, 0.95), null, s(38, 2, 1), null, s(38, 1, 0.85), null, s(45, 2, 0.92), null, s(38, 2, 0.92), null],
      [s(40, 2, 1), null, s(40, 1, 0.8), s(52, 1, 0.9), null, null, s(40, 2, 0.95), null, null, null, s(43, 2, 0.92), null, s(47, 2, 0.92), null, s(43, 2, 0.9), null],
      [s(41, 2, 1), null, s(41, 1, 0.85), s(48, 1, 0.92), null, null, s(41, 2, 0.95), null, s(35, 2, 1), null, s(35, 1, 0.85), null, s(42, 2, 0.95), null, s(47, 2, 0.98), null],
      // Bars 10-11: Moody syncopated rolling breakdown bass
      [s(40, 2, 0.95), null, s(47, 2, 0.82), null, s(40, 2, 0.9), null, s(43, 2, 0.85), null, s(40, 2, 0.92), null, s(47, 2, 0.82), null, s(45, 2, 0.85), null, s(43, 2, 0.85), null],
      [s(36, 2, 0.95), null, s(43, 2, 0.84), null, s(36, 2, 0.92), null, s(40, 2, 0.86), null, s(35, 2, 1), null, s(35, 2, 0.95), null, s(42, 2, 0.98), null, s(47, 2, 1), null],
    ),
    // counter = Heavy Cab-Shaped Distorted Power-Chord Guitar Riff!
    counter: concatBars(
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, null, null, null, null, s(40, 2, 0.85), null, s(38, 2, 0.9), null],
      // Bars 2-5: Crushing Killer Instinct palm-muted industrial power-chord riff
      [s(40, 2, 1), null, s(40, 1, 0.82), s(40, 1, 0.88), null, null, s(43, 2, 0.96), null, null, null, s(40, 2, 0.95), null, s(48, 2, 0.94), null, s(43, 2, 0.9), null],
      [s(40, 2, 1), null, s(40, 1, 0.82), s(40, 1, 0.88), null, null, s(41, 2, 1), null, null, null, s(40, 2, 0.95), null, s(38, 2, 0.92), null, s(35, 2, 0.92), null],
      [s(40, 2, 1), null, s(40, 1, 0.82), s(40, 1, 0.88), null, null, s(43, 2, 0.96), null, null, null, s(45, 2, 0.96), null, s(43, 2, 0.94), null, s(38, 2, 0.9), null],
      [s(40, 2, 1), null, s(40, 1, 0.82), s(40, 1, 0.88), null, null, s(41, 2, 1), null, s(36, 2, 0.95), null, s(38, 2, 0.95), null, s(35, 4, 1), null, null, null],
      // Bars 6-9: Big heavy sustained power-chord chunks supporting the lead hook
      [s(40, 4, 0.92), null, null, null, null, null, s(40, 2, 0.88), null, null, null, s(40, 2, 0.9), null, s(43, 2, 0.88), null, null, null],
      [s(36, 4, 0.92), null, null, null, null, null, s(36, 2, 0.88), null, s(38, 4, 0.95), null, null, null, null, null, s(38, 2, 0.9), null],
      [s(40, 4, 0.92), null, null, null, null, null, s(40, 2, 0.88), null, null, null, s(43, 2, 0.9), null, s(47, 2, 0.9), null, null, null],
      [s(41, 4, 0.96), null, null, null, null, null, s(41, 2, 0.92), null, s(35, 4, 1), null, null, null, s(35, 2, 0.95), null, s(35, 2, 0.98), null],
      // Bars 10-11: Guitar drops out for atmospheric breakdown, slams back at end of Bar 11!
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, s(35, 2, 0.92), null, s(35, 2, 0.95), null, s(38, 2, 0.98), null, s(35, 2, 1), null],
    ),
    arp: concatBars(
      // Bars 0-1: Shimmering dark sci-fi metallic echoes in intro
      [76, null, null, null, 79, null, null, null, 71, null, null, null, 76, null, null, null],
      [77, null, null, null, 76, null, null, null, 71, null, null, null, 72, null, null, null],
      // Bars 2-5: Restrained rhythmic cyber-synth ticks
      [null, null, null, null, null, null, 76, null, null, null, null, null, null, null, 79, null],
      [null, null, null, null, null, null, 77, null, null, null, null, null, null, null, 74, null],
      [null, null, null, null, null, null, 76, null, null, null, null, null, null, null, 81, null],
      [null, null, null, null, null, null, 77, null, null, null, 74, null, null, null, 71, null],
      // Bars 6-9: Pulsing subtle industrial counter-arps
      [null, null, 76, null, null, null, 71, null, null, null, 79, null, null, null, 76, null],
      [null, null, 72, null, null, null, 76, null, null, null, 74, null, null, null, 78, null],
      [null, null, 76, null, null, null, 79, null, null, null, 83, null, null, null, 79, null],
      [null, null, 77, null, null, null, 72, null, null, null, 75, null, null, null, 78, null],
      // Bars 10-11: Atmospheric cyber-echo motif in breakdown
      [76, null, 71, null, 74, null, 76, null, 79, null, 76, null, 74, null, 71, null],
      [72, null, 76, null, 79, null, 76, null, 75, null, 78, null, 83, null, 78, null],
    ),
    lead: concatBars(
      // Bars 0-1: Atmospheric intro — let the dark pad & sub build suspense!
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 2-5: Let the crushing power-chord guitar riff & brass stabs own the groove!
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, null, null, s(76, 2, 0.9), null, s(77, 2, 0.94), null, s(74, 2, 0.9), null],
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, s(72, 2, 0.9), null, s(74, 2, 0.94), null, s(75, 4, 1, -2), null, null, null],
      // Bars 6-9: Soaring, aggressive Killer Instinct arena synth/vocal-style hook!
      [s(76, 4, 1, -2), null, null, null, s(79, 2, 0.95), null, s(83, 4, 1, -2), null, null, null, s(79, 2, 0.92), null, s(76, 3, 0.94), null, null, null],
      [s(79, 4, 0.98), null, null, null, s(76, 2, 0.92), null, s(74, 6, 0.98, -2), null, null, null, null, null, s(78, 3, 0.95), null, null, null],
      [s(76, 3, 1), null, null, s(79, 2, 0.94), null, s(83, 3, 1, -2), null, null, s(84, 3, 1), null, null, s(83, 2, 0.94), null, s(79, 3, 0.95), null, null],
      [s(77, 4, 1, -1), null, null, null, s(76, 2, 0.94), null, s(72, 2, 0.9), null, s(75, 6, 1, -2), null, null, null, null, null, null, null],
      // Bars 10-11: Breakdown breather + screaming pickup back into drop
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, s(75, 2, 0.92), null, s(78, 2, 0.95), null, s(83, 4, 1, -2), null, null, null],
    ),
    accentSteps: [32, 48, 64, 80, 96, 112, 128, 144, 184],
    kick: [
      0, 16, 28, 30, // intro pulse & drop pickup
      ...repeatBars([0, 3, 10], [2, 3, 4, 5, 6, 7, 8, 9]),
      160, 170, 176, 184, 188,
    ],
    snare: [
      28, 30, 31, // explosive drop roll!
      ...repeatBars([4, 12], [2, 3, 4, 5, 6, 7, 8, 9]),
      164, 172, 180, 186, 188, 190, 191,
    ],
    gatedSnare: true,
    clang: [
      0, 16,
      ...repeatBars([0, 6], [2, 3, 4, 5, 6, 7, 8, 9]),
      160, 176,
    ],
    hatClosed: repeatBars([0, 2, 3, 4, 6, 8, 10, 11, 12, 14], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatAccent: repeatBars([2, 6, 10, 14], [2, 3, 4, 5, 6, 7, 8, 9]),
    hatOpen: repeatBars([14], [3, 5, 7, 9]),
    crash: [32, 64, 96, 144],
    toms: [
      { step: 26, midi: 50, vel: 0.85 },
      { step: 27, midi: 47, vel: 0.88 },
      { step: 28, midi: 43, vel: 0.92 },
      { step: 29, midi: 40, vel: 0.98 },
    ],
    leadVoice: {
      waveform: 'sawtooth',
      detuneCents: 11,
      highpassHz: 300,
      cutoffHz: 2600,
      cutoffPeakHz: 5400,
      filterDecaySec: 0.16,
      q: 1.8,
      attackSec: 0.015,
      decaySec: 0.16,
      sustainLevel: 0.82,
      releaseSec: 0.22,
      gain: 0.16,
      driveAmount: 0.34,
      cabinetEq: true,
      delaySend: 0.3,
      reverbSend: 0.38,
      pan: 0.06,
      vibratoHz: 5.6,
      vibratoCents: 18,
      vibratoDelaySec: 0.12,
    },
    // Heavy cab-filtered industrial power-chord guitar!
    counterVoice: {
      waveform: 'guitar',
      detuneCents: 7,
      highpassHz: 115,
      cutoffHz: 2500,
      cutoffPeakHz: 3400,
      filterDecaySec: 0.12,
      q: 1.2,
      attackSec: 0.004,
      decaySec: 0.11,
      sustainLevel: 0.62,
      releaseSec: 0.075,
      gain: 0.155,
      driveAmount: 0.64,
      powerChord: true,
      cabinetEq: true,
      reverbSend: 0.16,
      pan: -0.16,
    },
    arpVoice: {
      waveform: 'epiano',
      highpassHz: 460,
      cutoffHz: 3600,
      attackSec: 0.005,
      decaySec: 0.18,
      sustainLevel: 0.22,
      releaseSec: 0.26,
      gain: 0.082,
      fmRatio: 2.5,
      fmIndexHz: 120,
      fmDecaySec: 0.08,
      delaySend: 0.34,
      reverbSend: 0.42,
      pan: 0.36,
    },
    bassVoice: {
      waveform: 'sawtooth',
      detuneCents: 5,
      cutoffHz: 620,
      cutoffPeakHz: 1550,
      filterDecaySec: 0.1,
      q: 2.2,
      attackSec: 0.005,
      decaySec: 0.13,
      sustainLevel: 0.64,
      releaseSec: 0.09,
      gain: 0.23,
      subOctaveGain: 0.5,
      driveAmount: 0.16,
      reverbSend: 0.04,
    },
    padVoice: {
      waveform: 'strings',
      detuneCents: 15,
      chorus3: true,
      highpassHz: 240,
      cutoffHz: 1900,
      cutoffPeakHz: 2900,
      filterDecaySec: 0.7,
      attackSec: 0.16,
      decaySec: 0.4,
      sustainLevel: 0.74,
      releaseSec: 0.65,
      gain: 0.076,
      reverbSend: 0.54,
    },
    altPadVoice: {
      waveform: 'brass',
      detuneCents: 11,
      highpassHz: 260,
      cutoffHz: 2400,
      cutoffPeakHz: 5200,
      filterDecaySec: 0.12,
      attackSec: 0.008,
      decaySec: 0.14,
      sustainLevel: 0.58,
      releaseSec: 0.16,
      gain: 0.092,
      reverbSend: 0.34,
      pan: 0.22,
    },
    drumGain: 0.34,
    delayFeedback: 0.28,
    delayMix: 0.2,
    reverbMix: 0.32,
  },

  // ==========================================================================
  // 6. 1,300 pts — "Phobos Gate"
  //    Inspired by: Doom OST — E1M1 — At Doom's Gate
  //    120 BPM (double-time 16th-note thrash gallop) · E Minor · 8 bars (128 steps)
  //    Bars 0-1: Razor-tight cab-shaped pedal-E 16th-note thrash chugs + chromatic accents
  //    Bar 2: Iconic shift UP a 4th to A minor pedal-A thrash riff!
  //    Bar 3: Return to E minor with fierce descending chromatic turnaround
  //    Bars 4-7: Screaming harmonized twin-lead metal guitar bridge & solo over power chords
  // ==========================================================================
  cyberdeck_horizon: {
    bpm: 120,
    totalSteps: 128,
    chords: {
      // Heavy sustained power-chord punctuation in the metal bridge (Bars 4-7)
      64: { notes: [48, 55, 60], steps: 7, vel: 0.92 }, // C5
      72: { notes: [50, 57, 62], steps: 7, vel: 0.94 }, // D5
      80: { notes: [52, 59, 64], steps: 14, vel: 0.96 }, // E5
      96: { notes: [48, 55, 60], steps: 7, vel: 0.92 }, // C5
      104: { notes: [50, 57, 62], steps: 7, vel: 0.94 }, // D5
      112: { notes: [47, 54, 59], steps: 10, vel: 1.0 }, // B5 climax
    },
    // Bass locks tight in unison with the thrash rhythm guitar (punchy pick bass!)
    bass: concatBars(
      // Bar 0 (E minor thrash pedal riff)
      [s(40, 1, 1), s(40, 1, 0.8), s(50, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(48, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(46, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(47, 1, 1), s(48, 2, 1), null, s(40, 1, 0.85), s(40, 1, 0.85)],
      // Bar 1 (E minor thrash repeat with snappy low-E turnaround)
      [s(40, 1, 1), s(40, 1, 0.8), s(50, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(48, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(46, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(45, 1, 1), s(43, 2, 1), null, s(42, 2, 0.95), null],
      // Bar 2 (Shift UP a 4th to A minor!)
      [s(45, 1, 1), s(45, 1, 0.8), s(55, 1, 1), s(45, 1, 0.85), s(45, 1, 0.8), s(53, 1, 1), s(45, 1, 0.85), s(45, 1, 0.8), s(51, 1, 1), s(45, 1, 0.85), s(45, 1, 0.8), s(52, 1, 1), s(53, 2, 1), null, s(45, 1, 0.85), s(45, 1, 0.85)],
      // Bar 3 (Return to E minor + fierce chromatic turnaround)
      [s(40, 1, 1), s(40, 1, 0.8), s(50, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(48, 1, 1), s(40, 1, 0.85), s(40, 1, 0.8), s(47, 2, 1), null, s(46, 2, 1), null, s(45, 2, 1), null, s(43, 1, 0.95), s(42, 1, 0.95)],
      // Bars 4-7: Driving galloping metal bass (C -> D -> E -> C -> D -> B)
      [s(36, 1, 1), s(36, 1, 0.8), s(36, 1, 0.85), s(36, 1, 0.8), s(36, 2, 0.95), null, s(36, 1, 0.85), s(36, 1, 0.8), s(38, 1, 1), s(38, 1, 0.8), s(38, 1, 0.85), s(38, 1, 0.8), s(38, 2, 0.95), null, s(38, 1, 0.85), s(38, 1, 0.8)],
      [s(40, 1, 1), s(40, 1, 0.8), s(40, 1, 0.85), s(40, 1, 0.8), s(40, 2, 0.95), null, s(43, 1, 0.9), s(42, 1, 0.88), s(40, 1, 1), s(40, 1, 0.8), s(40, 1, 0.85), s(40, 1, 0.8), s(47, 2, 0.96), null, s(43, 2, 0.92), null],
      [s(36, 1, 1), s(36, 1, 0.8), s(36, 1, 0.85), s(36, 1, 0.8), s(36, 2, 0.95), null, s(36, 1, 0.85), s(36, 1, 0.8), s(38, 1, 1), s(38, 1, 0.8), s(38, 1, 0.85), s(38, 1, 0.8), s(38, 2, 0.95), null, s(38, 1, 0.85), s(38, 1, 0.8)],
      [s(35, 1, 1), s(35, 1, 0.8), s(35, 1, 0.85), s(35, 1, 0.8), s(35, 2, 0.98), null, s(35, 1, 0.85), s(35, 1, 0.8), s(35, 2, 1), null, s(38, 2, 1), null, s(40, 2, 1), null, s(42, 2, 1), null],
    ),
    // arp = Heavy Cab-Shaped Palm-Muted Rhythm Power-Chord Guitar!
    arp: concatBars(
      // Bar 0: Tight razor-sharp palm-muted pedal-E chugs + power accents
      [s(40, 1, 0.88), s(40, 1, 0.72), s(50, 1, 1), s(40, 1, 0.82), s(40, 1, 0.72), s(48, 1, 1), s(40, 1, 0.82), s(40, 1, 0.72), s(46, 1, 1), s(40, 1, 0.82), s(40, 1, 0.72), s(47, 1, 1), s(48, 2, 1), null, s(40, 1, 0.82), s(40, 1, 0.78)],
      // Bar 1
      [s(40, 1, 0.88), s(40, 1, 0.72), s(50, 1, 1), s(40, 1, 0.82), s(40, 1, 0.72), s(48, 1, 1), s(40, 1, 0.82), s(40, 1, 0.72), s(46, 1, 1), s(40, 1, 0.82), s(40, 1, 0.72), s(45, 1, 1), s(43, 2, 1), null, s(42, 2, 0.96), null],
      // Bar 2: Shifts UP a 4th to A minor!
      [s(45, 1, 0.9), s(45, 1, 0.74), s(55, 1, 1), s(45, 1, 0.84), s(45, 1, 0.74), s(53, 1, 1), s(45, 1, 0.84), s(45, 1, 0.74), s(51, 1, 1), s(45, 1, 0.84), s(45, 1, 0.74), s(52, 1, 1), s(53, 2, 1), null, s(45, 1, 0.84), s(45, 1, 0.78)],
      // Bar 3: Return to E minor + descending chromatic slam
      [s(40, 1, 0.9), s(40, 1, 0.74), s(50, 1, 1), s(40, 1, 0.84), s(40, 1, 0.74), s(48, 1, 1), s(40, 1, 0.84), s(40, 1, 0.74), s(47, 2, 1), null, s(46, 2, 1), null, s(45, 2, 1), null, s(43, 1, 0.96), s(42, 1, 0.96)],
      // Bars 4-7: Galloping muted chugs underneath the harmonized twin leads
      [s(48, 1, 0.86), s(48, 1, 0.72), s(48, 1, 0.82), s(48, 1, 0.72), s(48, 2, 0.94), null, s(48, 1, 0.8), s(48, 1, 0.72), s(50, 1, 0.88), s(50, 1, 0.74), s(50, 1, 0.82), s(50, 1, 0.72), s(50, 2, 0.94), null, s(50, 1, 0.82), s(50, 1, 0.74)],
      [s(40, 1, 0.88), s(40, 1, 0.72), s(40, 1, 0.82), s(40, 1, 0.72), s(40, 2, 0.94), null, s(43, 1, 0.86), s(42, 1, 0.84), s(40, 1, 0.88), s(40, 1, 0.72), s(40, 1, 0.82), s(40, 1, 0.72), s(47, 2, 0.95), null, s(43, 2, 0.9), null],
      [s(48, 1, 0.86), s(48, 1, 0.72), s(48, 1, 0.82), s(48, 1, 0.72), s(48, 2, 0.94), null, s(48, 1, 0.8), s(48, 1, 0.72), s(50, 1, 0.88), s(50, 1, 0.74), s(50, 1, 0.82), s(50, 1, 0.72), s(50, 2, 0.94), null, s(50, 1, 0.82), s(50, 1, 0.74)],
      [s(47, 1, 0.9), s(47, 1, 0.76), s(47, 1, 0.86), s(47, 1, 0.76), s(47, 2, 0.98), null, s(47, 1, 0.86), s(47, 1, 0.78), s(47, 2, 1), null, s(50, 2, 1), null, s(52, 2, 1), null, s(54, 2, 1), null],
    ),
    lead: concatBars(
      // Bars 0-1: Let the razor-tight E-pedal thrash riff shine with clean bite!
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, null, null, null, null, s(67, 2, 0.94), null, s(66, 2, 0.96), null],
      // Bar 2-3: High-octave scream punctuation on the A-minor shift & turnaround
      [null, null, s(79, 1, 0.95), null, null, s(77, 1, 0.95), null, null, s(75, 1, 0.98), null, null, s(76, 1, 0.96), s(77, 2, 1), null, null, null],
      [null, null, null, null, null, null, null, null, s(71, 2, 1), null, s(70, 2, 1), null, s(69, 2, 1), null, s(67, 1, 0.96), s(66, 1, 0.96)],
      // Bars 4-7: Screaming melodic thrash metal lead guitar solo!
      [s(72, 3, 1, -2), null, null, s(76, 2, 0.96), null, s(79, 3, 1), null, null, s(74, 3, 1), null, null, s(78, 2, 0.96), null, s(81, 3, 1), null, null],
      [s(83, 4, 1, -2), null, null, null, s(79, 2, 0.95), null, s(76, 2, 0.92), null, s(79, 3, 1), null, null, s(78, 2, 0.94), null, s(76, 3, 0.98), null, null],
      [s(72, 2, 0.96), null, s(76, 2, 0.96), null, s(79, 2, 1), null, s(84, 2, 1), null, s(81, 2, 1), null, s(78, 2, 0.96), null, s(74, 2, 0.95), null, s(81, 2, 1), null],
      [s(83, 6, 1, -2), null, null, null, null, null, s(81, 2, 0.96), null, s(79, 2, 0.98), null, s(78, 2, 0.98), null, s(76, 2, 1), null, s(78, 2, 1), null],
    ),
    // counter = Harmonized Twin-Lead Metal Guitar (3rd below Lead, panned opposite!)
    counter: concatBars(
      EMPTY_BAR,
      EMPTY_BAR,
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, s(67, 2, 0.85), null, s(66, 2, 0.85), null, s(64, 2, 0.85), null, s(62, 1, 0.85), s(61, 1, 0.85)],
      [s(67, 3, 0.85), null, null, s(72, 2, 0.84), null, s(76, 3, 0.86), null, null, s(69, 3, 0.85), null, null, s(74, 2, 0.84), null, s(78, 3, 0.88), null, null],
      [s(79, 4, 0.88), null, null, null, s(76, 2, 0.84), null, s(71, 2, 0.82), null, s(76, 3, 0.86), null, null, s(74, 2, 0.84), null, s(71, 3, 0.86), null, null],
      [s(67, 2, 0.84), null, s(72, 2, 0.84), null, s(76, 2, 0.86), null, s(79, 2, 0.88), null, s(78, 2, 0.86), null, s(74, 2, 0.84), null, s(69, 2, 0.84), null, s(78, 2, 0.88), null],
      [s(78, 6, 0.9), null, null, null, null, null, s(76, 2, 0.86), null, s(74, 2, 0.88), null, s(73, 2, 0.88), null, s(71, 2, 0.9), null, s(73, 2, 0.9), null],
    ),
    accentSteps: [0, 2, 5, 8, 11, 16, 18, 21, 24, 27, 32, 34, 37, 40, 43, 48, 56, 64, 72, 80, 96, 104, 112],
    kick: [
      ...repeatBars([0, 2, 6, 8, 10, 14], [0, 1, 2, 3]),
      ...repeatBars([0, 1, 6, 8, 9, 14], [4, 5, 6, 7]),
    ],
    snare: [
      ...repeatBars([4, 12], [0, 1, 2, 3, 4, 5, 6]),
      116, 120, 122, 124, 125, 126, 127, // blazing thrash snare roll!
    ],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 3, 4, 5, 6, 7]),
    hatAccent: repeatBars([0, 4, 8, 12], [0, 1, 2, 3, 4, 5, 6, 7]),
    hatOpen: repeatBars([2, 10], [4, 5, 6, 7]),
    crash: [0, 32, 64, 80, 96, 112],
    toms: [
      { step: 60, midi: 52, vel: 0.9 },
      { step: 61, midi: 48, vel: 0.9 },
      { step: 62, midi: 45, vel: 0.95 },
      { step: 63, midi: 40, vel: 1.0 },
    ],
    leadVoice: {
      waveform: 'guitar',
      detuneCents: 9,
      highpassHz: 260,
      cutoffHz: 2700,
      cutoffPeakHz: 4200,
      filterDecaySec: 0.14,
      q: 1.4,
      attackSec: 0.008,
      decaySec: 0.16,
      sustainLevel: 0.82,
      releaseSec: 0.18,
      gain: 0.165,
      driveAmount: 0.62,
      cabinetEq: true,
      delaySend: 0.22,
      reverbSend: 0.28,
      pan: -0.26,
      vibratoHz: 6.0,
      vibratoCents: 18,
      vibratoDelaySec: 0.11,
    },
    counterVoice: {
      waveform: 'guitar',
      detuneCents: 8,
      highpassHz: 260,
      cutoffHz: 2600,
      cutoffPeakHz: 4000,
      filterDecaySec: 0.14,
      q: 1.4,
      attackSec: 0.008,
      decaySec: 0.16,
      sustainLevel: 0.8,
      releaseSec: 0.18,
      gain: 0.14,
      driveAmount: 0.58,
      cabinetEq: true,
      delaySend: 0.2,
      reverbSend: 0.26,
      pan: 0.28,
      vibratoHz: 5.8,
      vibratoCents: 16,
      vibratoDelaySec: 0.12,
    },
    // Palm-muted cab-filtered thrash rhythm power-chord guitar!
    arpVoice: {
      waveform: 'guitar',
      detuneCents: 6,
      highpassHz: 120,
      cutoffHz: 2450,
      cutoffPeakHz: 3300,
      filterDecaySec: 0.075,
      q: 1.15,
      attackSec: 0.003,
      decaySec: 0.075,
      sustainLevel: 0.45,
      releaseSec: 0.045,
      gain: 0.15,
      driveAmount: 0.65,
      powerChord: true,
      cabinetEq: true,
      reverbSend: 0.14,
      pan: 0.04,
    },
    bassVoice: {
      waveform: 'sawtooth',
      cutoffHz: 950,
      cutoffPeakHz: 1850,
      filterDecaySec: 0.07,
      q: 1.6,
      attackSec: 0.003,
      decaySec: 0.09,
      sustainLevel: 0.56,
      releaseSec: 0.05,
      gain: 0.23,
      subOctaveGain: 0.38,
      driveAmount: 0.26,
      reverbSend: 0.04,
    },
    padVoice: {
      waveform: 'guitar',
      detuneCents: 10,
      highpassHz: 140,
      cutoffHz: 2300,
      attackSec: 0.01,
      decaySec: 0.22,
      sustainLevel: 0.72,
      releaseSec: 0.18,
      gain: 0.075,
      driveAmount: 0.55,
      cabinetEq: true,
      reverbSend: 0.22,
    },
    drumGain: 0.34,
    delayFeedback: 0.2,
    delayMix: 0.15,
    reverbMix: 0.24,
  },

  // ==========================================================================
  // 7. 1,650 pts — "Lunar Core: Final Phase"
  //    Inspired by: Final Fantasy IV — The Final Battle ~ Zeromus Battle Theme
  //    152 BPM · G Minor · 12 bars (192 steps)
  //    Bars 0-1: Gothic drawbar pipe-organ prelude + blistering 16th-note fanfare!
  //    Bars 2-5: Urgent rapid-fire bass ostinato + heroic SNES French horn/brass theme
  //    Bars 6-9: Dramatic modulation & soaring orchestral strings/brass climax
  //    Bars 10-11: Iconic syncopated bass/snare/timpani breakdown -> finale launch!
  // ==========================================================================
  broadcast_finale: {
    bpm: 152,
    totalSteps: 192,
    chords: {
      // Bar 0-1: Dramatic Gothic Cathedral Pipe Organ Prelude (altPadVoice = 'organ')
      0: { notes: [55, 58, 62, 67], steps: 7, vel: 1.0, altVoice: true }, // Gm
      8: { notes: [55, 58, 63, 67], steps: 7, vel: 1.0, altVoice: true }, // Eb/G
      16: { notes: [54, 57, 62, 66], steps: 7, vel: 1.0, altVoice: true }, // D7/F#
      24: { notes: [55, 58, 62, 67], steps: 7, vel: 1.0, altVoice: true }, // Gm -> fanfare!
      // Bars 2-5: Heroic battle lush orchestral strings (padVoice)
      32: { notes: [58, 62, 67, 70], steps: 15, vel: 0.92 }, // Gm
      48: { notes: [57, 60, 65, 69], steps: 15, vel: 0.92 }, // F
      64: { notes: [55, 58, 63, 67], steps: 15, vel: 0.94 }, // Eb
      80: { notes: [57, 62, 66, 69], steps: 15, vel: 0.98, altVoice: true }, // D7 organ punch
      // Bars 6-9: Dramatic modulation (EbMaj7 -> F -> Dm7 -> Gm -> Cm7 -> D7)
      96: { notes: [58, 62, 63, 67], steps: 15, vel: 0.96 }, // EbMaj7
      112: { notes: [57, 60, 65, 69], steps: 15, vel: 0.96 }, // F
      128: { notes: [57, 60, 62, 69], steps: 8, vel: 0.94 }, // Dm7
      136: { notes: [58, 62, 67, 70], steps: 7, vel: 0.96 }, // Gm
      144: { notes: [55, 60, 63, 67], steps: 8, vel: 0.96 }, // Cm
      152: { notes: [57, 62, 66, 69], steps: 7, vel: 1.0, altVoice: true }, // D7 organ slam
      // Bars 10-11: Sharp brass/organ stabs in the syncopated bass breakdown
      160: { notes: [58, 62, 67, 70], steps: 2, vel: 0.98, altVoice: true },
      166: { notes: [58, 62, 67, 70], steps: 2, vel: 0.95, altVoice: true },
      172: { notes: [55, 58, 63, 67], steps: 2, vel: 0.98, altVoice: true },
      176: { notes: [57, 60, 65, 69], steps: 2, vel: 0.98, altVoice: true },
      182: { notes: [57, 62, 66, 69], steps: 4, vel: 1.0, altVoice: true },
    },
    bass: concatBars(
      // Bar 0-1: Deep solemn pipe-organ pedals under the Gothic prelude
      [s(43, 8, 1), null, null, null, null, null, null, null, s(39, 8, 1), null, null, null, null, null, null, null],
      [s(38, 8, 1), null, null, null, null, null, null, null, s(43, 6, 1), null, null, null, null, null, s(38, 2, 0.95), null],
      // Bars 2-5: Classic Nobuo Uematsu urgent rapid-fire 8th/16th bass ostinato!
      [s(43, 1, 1), null, s(43, 1, 0.85), s(55, 1, 0.9), s(43, 1, 0.95), null, s(43, 1, 0.85), s(50, 1, 0.88), s(43, 1, 0.98), null, s(43, 1, 0.85), s(53, 1, 0.9), s(43, 1, 0.95), null, s(50, 1, 0.88), s(46, 1, 0.88)],
      [s(41, 1, 1), null, s(41, 1, 0.85), s(53, 1, 0.9), s(41, 1, 0.95), null, s(41, 1, 0.85), s(48, 1, 0.88), s(41, 1, 0.98), null, s(41, 1, 0.85), s(51, 1, 0.9), s(41, 1, 0.95), null, s(48, 1, 0.88), s(45, 1, 0.88)],
      [s(39, 1, 1), null, s(39, 1, 0.85), s(51, 1, 0.9), s(39, 1, 0.95), null, s(39, 1, 0.85), s(46, 1, 0.88), s(39, 1, 0.98), null, s(39, 1, 0.85), s(50, 1, 0.9), s(39, 1, 0.95), null, s(46, 1, 0.88), s(43, 1, 0.88)],
      [s(38, 1, 1), null, s(38, 1, 0.85), s(50, 1, 0.9), s(38, 1, 0.95), null, s(45, 1, 0.88), s(42, 1, 0.88), s(38, 1, 1), null, s(42, 1, 0.9), s(45, 1, 0.92), s(48, 1, 0.95), null, s(45, 1, 0.92), s(42, 1, 0.92)],
      // Bars 6-9: Driving urgent bass through heroic modulation
      [s(39, 1, 1), null, s(39, 1, 0.85), s(51, 1, 0.9), s(39, 1, 0.95), null, s(46, 1, 0.88), null, s(39, 1, 0.98), null, s(39, 1, 0.85), s(51, 1, 0.9), s(46, 1, 0.92), null, s(43, 1, 0.9), null],
      [s(41, 1, 1), null, s(41, 1, 0.85), s(53, 1, 0.9), s(41, 1, 0.95), null, s(48, 1, 0.88), null, s(41, 1, 0.98), null, s(41, 1, 0.85), s(53, 1, 0.9), s(48, 1, 0.92), null, s(45, 1, 0.9), null],
      [s(38, 1, 1), null, s(38, 1, 0.85), s(50, 1, 0.9), s(45, 1, 0.92), null, s(41, 1, 0.88), null, s(43, 1, 1), null, s(43, 1, 0.85), s(55, 1, 0.9), s(50, 1, 0.92), null, s(46, 1, 0.9), null],
      [s(36, 1, 1), null, s(36, 1, 0.85), s(48, 1, 0.9), s(43, 1, 0.92), null, s(39, 1, 0.88), null, s(38, 1, 1), null, s(42, 1, 0.92), s(45, 1, 0.94), s(50, 2, 1), null, s(38, 2, 0.96), null],
      // Bars 10-11: Iconic syncopated Zeromus bass/drum breakdown!
      [s(43, 2, 1), null, s(43, 1, 0.9), null, s(50, 1, 0.92), null, s(43, 2, 1), null, s(46, 1, 0.9), null, s(43, 1, 0.9), null, s(39, 2, 1), null, s(39, 1, 0.9), null],
      [s(41, 2, 1), null, s(41, 1, 0.9), null, s(48, 1, 0.92), null, s(38, 2, 1), null, s(38, 1, 0.92), s(42, 1, 0.94), s(45, 1, 0.96), s(48, 1, 0.98), s(50, 2, 1), null, s(38, 2, 1), null],
    ),
    arp: concatBars(
      // Bar 0: Solemn Gothic organ chords solo
      EMPTY_BAR,
      // Bar 1: Blistering ascending Baroque 16th-note arpeggio fanfare into battle!
      [54, 57, 62, 66, 69, 74, 78, 81, 67, 70, 74, 79, 82, 86, 82, 79],
      // Bars 2-5: Urgent Baroque harpsichord/organ battle arpeggios
      [62, 67, 70, 74, 70, 67, 62, 67, 62, 67, 70, 74, 79, 74, 70, 67],
      [60, 65, 69, 72, 69, 65, 60, 65, 60, 65, 69, 72, 77, 72, 69, 65],
      [58, 63, 67, 70, 67, 63, 58, 63, 58, 63, 67, 70, 75, 70, 67, 63],
      [62, 66, 69, 74, 69, 66, 62, 66, 62, 66, 69, 74, 78, 74, 69, 66],
      // Bars 6-9: Rapid shimmering modulation arps
      [63, 67, 70, 75, 70, 67, 63, 67, 63, 67, 70, 75, 79, 75, 70, 67],
      [65, 69, 72, 77, 72, 69, 65, 69, 65, 69, 72, 77, 81, 77, 72, 69],
      [62, 65, 69, 74, 69, 65, 62, 65, 62, 67, 70, 74, 79, 74, 70, 67],
      [60, 63, 67, 72, 67, 63, 60, 63, 62, 66, 69, 74, 78, 81, 78, 74],
      // Bars 10-11: Silent during syncopated bass/drum breakdown -> ascending sweep at end!
      EMPTY_BAR,
      [null, null, null, null, null, null, null, null, 62, 66, 69, 74, 78, 81, 86, 81],
    ),
    lead: concatBars(
      // Bars 0-1: Let the Gothic Pipe Organ & ascending fanfare command the intro!
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 2-5: Bold, triumphant SNES French Horn / Brass hero battle melody!
      [s(79, 4, 1), null, null, null, s(74, 2, 0.94), null, s(75, 2, 0.95), null, s(77, 2, 0.98), null, s(79, 2, 1), null, s(82, 4, 1, -2), null, null, null],
      [s(81, 4, 1), null, null, null, s(77, 2, 0.94), null, s(72, 2, 0.92), null, s(77, 4, 0.98), null, null, null, s(79, 4, 1), null, null, null],
      [s(79, 3, 1), null, null, s(75, 2, 0.94), null, s(70, 2, 0.92), null, null, s(75, 3, 0.98), null, null, s(79, 2, 0.98), null, s(82, 3, 1), null, null],
      [s(81, 6, 1, -1), null, null, null, null, null, s(78, 2, 0.96), null, s(74, 4, 0.96), null, null, null, s(78, 4, 1), null, null, null],
      // Bars 6-9: Dramatic heroic modulation & soaring high climax!
      [s(82, 4, 1, -2), null, null, null, s(79, 2, 0.95), null, s(75, 2, 0.92), null, s(79, 4, 0.98), null, null, null, s(82, 4, 1), null, null, null],
      [s(84, 4, 1, -2), null, null, null, s(81, 2, 0.95), null, s(77, 2, 0.94), null, s(81, 4, 0.98), null, null, null, s(84, 4, 1), null, null, null],
      [s(86, 4, 1, -2), null, null, null, s(81, 2, 0.96), null, s(77, 2, 0.94), null, s(82, 4, 1), null, null, null, s(79, 4, 0.96), null, null, null],
      [s(84, 4, 1), null, null, null, s(79, 2, 0.95), null, s(75, 2, 0.94), null, s(81, 6, 1, -2), null, null, null, null, null, s(78, 2, 0.98), null],
      // Bars 10-11: Syncopated heroic brass fanfare hits over the bass/drum break!
      [s(79, 2, 1), null, null, null, null, null, s(79, 2, 1), null, null, null, null, null, s(75, 2, 1), null, null, null],
      [s(77, 2, 1), null, null, null, null, null, s(78, 4, 1), null, null, null, s(81, 2, 1), null, s(86, 4, 1, -2), null, null, null],
    ),
    counter: concatBars(
      EMPTY_BAR,
      EMPTY_BAR,
      // Bars 2-9: Harmonized SNES orchestral strings doubling the heroic brass lead!
      [s(74, 4, 0.8), null, null, null, s(70, 2, 0.74), null, s(72, 2, 0.75), null, s(74, 2, 0.78), null, s(75, 2, 0.8), null, s(79, 4, 0.84), null, null, null],
      [s(77, 4, 0.8), null, null, null, s(72, 2, 0.74), null, s(69, 2, 0.72), null, s(72, 4, 0.78), null, null, null, s(74, 4, 0.8), null, null, null],
      [s(75, 3, 0.8), null, null, s(70, 2, 0.74), null, s(67, 2, 0.72), null, null, s(70, 3, 0.78), null, null, s(75, 2, 0.78), null, s(79, 3, 0.82), null, null],
      [s(78, 6, 0.84), null, null, null, null, null, s(74, 2, 0.78), null, s(69, 4, 0.78), null, null, null, s(74, 4, 0.82), null, null, null],
      [s(79, 4, 0.84), null, null, null, s(75, 2, 0.78), null, s(70, 2, 0.75), null, s(75, 4, 0.8), null, null, null, s(79, 4, 0.84), null, null, null],
      [s(81, 4, 0.84), null, null, null, s(77, 2, 0.78), null, s(72, 2, 0.76), null, s(77, 4, 0.8), null, null, null, s(81, 4, 0.84), null, null, null],
      [s(81, 4, 0.86), null, null, null, s(77, 2, 0.8), null, s(74, 2, 0.78), null, s(79, 4, 0.84), null, null, null, s(74, 4, 0.8), null, null, null],
      [s(79, 4, 0.86), null, null, null, s(75, 2, 0.8), null, s(72, 2, 0.78), null, s(78, 6, 0.88), null, null, null, null, null, s(74, 2, 0.82), null],
      EMPTY_BAR,
      EMPTY_BAR,
    ),
    accentSteps: [0, 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176],
    kick: [
      0, 8, 16, 24, // solemn organ prelude downbeats
      ...repeatBars([0, 2, 6, 8, 10, 14], [2, 3, 4, 5, 6, 7, 8, 9]),
      160, 166, 172, 176, 182, 188, 190,
    ],
    snare: [
      ...repeatBars([4, 12], [2, 3, 4, 5, 6, 7, 8, 9]),
      164, 170, 174, 180, 186, 188, 190, 191,
    ],
    hatClosed: repeatBars([0, 2, 4, 6, 8, 10, 12, 14], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    hatAccent: repeatBars([0, 4, 8, 12], [2, 3, 4, 5, 6, 7, 8, 9]),
    hatOpen: repeatBars([14], [3, 5, 7, 9]),
    crash: [0, 32, 64, 96, 128, 160],
    toms: [
      // Orchestral timpani booms in Gothic intro & dramatic fills!
      { step: 0, midi: 43, vel: 1.0 },
      { step: 8, midi: 39, vel: 0.96 },
      { step: 16, midi: 38, vel: 0.98 },
      { step: 24, midi: 43, vel: 1.0 },
      { step: 92, midi: 50, vel: 0.9 },
      { step: 93, midi: 45, vel: 0.92 },
      { step: 94, midi: 43, vel: 0.95 },
      { step: 95, midi: 38, vel: 1.0 },
      { step: 184, midi: 50, vel: 0.95 },
      { step: 186, midi: 46, vel: 0.95 },
      { step: 188, midi: 43, vel: 1.0 },
      { step: 190, midi: 38, vel: 1.0 },
    ],
    leadVoice: {
      waveform: 'brass',
      detuneCents: 9,
      chorus3: true,
      highpassHz: 260,
      cutoffHz: 2800,
      cutoffPeakHz: 5600,
      filterDecaySec: 0.14,
      q: 1.4,
      attackSec: 0.015,
      decaySec: 0.16,
      sustainLevel: 0.84,
      releaseSec: 0.2,
      gain: 0.16,
      delaySend: 0.22,
      reverbSend: 0.42,
      pan: 0.08,
      vibratoHz: 5.8,
      vibratoCents: 14,
      vibratoDelaySec: 0.12,
    },
    counterVoice: {
      waveform: 'strings',
      detuneCents: 11,
      highpassHz: 280,
      cutoffHz: 3200,
      attackSec: 0.035,
      decaySec: 0.2,
      sustainLevel: 0.78,
      releaseSec: 0.26,
      gain: 0.105,
      reverbSend: 0.46,
      pan: -0.32,
    },
    arpVoice: {
      waveform: 'organ',
      highpassHz: 360,
      cutoffHz: 4600,
      attackSec: 0.004,
      decaySec: 0.085,
      sustainLevel: 0.28,
      releaseSec: 0.075,
      gain: 0.085,
      delaySend: 0.2,
      reverbSend: 0.3,
      pan: 0.34,
    },
    bassVoice: {
      waveform: 'slapbass',
      cutoffHz: 1100,
      cutoffPeakHz: 2500,
      filterDecaySec: 0.075,
      q: 1.8,
      attackSec: 0.004,
      decaySec: 0.09,
      sustainLevel: 0.56,
      releaseSec: 0.06,
      gain: 0.23,
      subOctaveGain: 0.4,
      reverbSend: 0.06,
    },
    padVoice: {
      waveform: 'strings',
      detuneCents: 12,
      chorus3: true,
      highpassHz: 240,
      cutoffHz: 2500,
      attackSec: 0.09,
      decaySec: 0.35,
      sustainLevel: 0.74,
      releaseSec: 0.48,
      gain: 0.07,
      reverbSend: 0.5,
      pan: -0.14,
    },
    // Gothic Cathedral Drawbar Pipe Organ!
    altPadVoice: {
      waveform: 'organ',
      detuneCents: 8,
      chorus3: true,
      highpassHz: 180,
      cutoffHz: 3800,
      attackSec: 0.015,
      decaySec: 0.22,
      sustainLevel: 0.85,
      releaseSec: 0.36,
      gain: 0.095,
      reverbSend: 0.55,
    },
    drumGain: 0.32,
    delayFeedback: 0.22,
    delayMix: 0.16,
    reverbMix: 0.34,
  },
};

export type LoopCompleteCallback = (trackId: MusicTrackId, loopsCompleted: number) => void;

// ============================================================================
// STUDIO-GRADE ZERO-DEPENDENCY WEB AUDIO VGM SYNTHESIZER & SEQUENCER
// ============================================================================

class RetroMusicSequencer {
  private ctx: AudioContext | null = null;
  private mixBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedbackGain: GainNode | null = null;
  private delayReturnGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbReturnGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private driveCurves = new Map<number, Float32Array<ArrayBuffer>>();
  private periodicWaves = new Map<string, PeriodicWave>();
  private freqBins: Uint8Array<ArrayBuffer> | null = null;

  private playing = false;
  private currentTrackId: MusicTrackId = STARTER_TRACK_ID;
  private volumePct = 45;
  private muted = false;
  private sustainedDuck = false;
  private transientDuckUntilMs = 0;
  private duckReleaseTimer: number | null = null;

  private schedulerTimer: number | null = null;
  private currentStep = 0;
  private nextStepTime = 0;
  private loopsCompleted = 0;
  private onLoopComplete: LoopCompleteCallback | null = null;

  setLoopCompleteHandler(cb: LoopCompleteCallback | null): void {
    this.onLoopComplete = cb;
  }

  getTrackId(): MusicTrackId {
    return this.currentTrackId;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private createImpulseResponse(ctx: AudioContext, durationSec = 1.45, decay = 2.8): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const preDelaySamples = Math.floor(sampleRate * 0.014);

    for (let ch = 0; ch < 2; ch += 1) {
      const channelData = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i += 1) {
        if (i < preDelaySamples) {
          channelData[i] = 0;
          continue;
        }
        const t = (i - preDelaySamples) / Math.max(1, length - preDelaySamples);
        const env = Math.pow(1 - t, decay);
        const white = Math.random() * 2 - 1;
        // Progressive warm high-frequency damping across the reverb tail
        const alpha = 0.28 * (1 - t * 0.65) + 0.08;
        lp += alpha * (white - lp);
        channelData[i] = lp * env * 0.65;
      }
    }
    return impulse;
  }

  private getPeriodicWave(ctx: AudioContext, wave: CustomWaveType): PeriodicWave | null {
    if (wave === 'sine' || wave === 'triangle' || wave === 'sawtooth' || wave === 'square') {
      return null;
    }
    const cached = this.periodicWaves.get(wave);
    if (cached) return cached;

    const harmonics = 24;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);

    if (wave === 'pulse25') {
      for (let n = 1; n <= harmonics; n += 1) {
        imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
      }
    } else if (wave === 'pulse12') {
      for (let n = 1; n <= harmonics; n += 1) {
        imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.125);
      }
    } else if (wave === 'organ') {
      // Baroque cathedral drawbar pipe organ (16', 8', 4', 2⅔', 2', 1⅓', 1')
      const weights: Record<number, number> = {
        1: 1.0,
        2: 0.78,
        3: 0.56,
        4: 0.62,
        6: 0.34,
        8: 0.42,
        10: 0.16,
        12: 0.2,
        16: 0.12,
      };
      for (const [h, w] of Object.entries(weights)) {
        imag[Number(h)] = w;
      }
    } else if (wave === 'brass') {
      // Warm SNES French horn / orchestral brass harmonic series
      const weights = [0, 1.0, 0.85, 0.66, 0.5, 0.36, 0.26, 0.19, 0.13, 0.09, 0.06, 0.04, 0.025];
      for (let n = 1; n < weights.length; n += 1) {
        imag[n] = weights[n];
      }
    } else if (wave === 'strings') {
      // Smooth ensemble bowed strings (warm rolled-off sawtooth)
      for (let n = 1; n <= 16; n += 1) {
        imag[n] = (1 / Math.pow(n, 1.18)) * (n % 2 === 0 ? 0.85 : 1.0);
      }
    } else if (wave === 'epiano') {
      // Warm Rhodes / DX7 electric piano timbre
      imag[1] = 1.0;
      imag[2] = 0.28;
      imag[3] = 0.18;
      imag[4] = 0.06;
      imag[5] = 0.08;
      imag[7] = 0.05;
      imag[9] = 0.025;
    } else if (wave === 'slapbass') {
      // Funky slap bass: strong fundamental + woody odd/even slap harmonics
      imag[1] = 1.0;
      imag[2] = 0.72;
      imag[3] = 0.55;
      imag[4] = 0.3;
      imag[5] = 0.38;
      imag[6] = 0.18;
      imag[7] = 0.22;
      imag[8] = 0.12;
      imag[9] = 0.1;
    } else if (wave === 'guitar') {
      // Picked electric guitar harmonic profile (fed into tube drive + speaker cab EQ)
      for (let n = 1; n <= 18; n += 1) {
        const pickNotch = Math.abs(Math.sin(n * 0.42)) * 0.45 + 0.55;
        imag[n] = (1 / Math.pow(n, 0.92)) * pickNotch;
      }
    }

    const built = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.periodicWaves.set(wave, built);
    return built;
  }

  private applyOscWaveform(ctx: AudioContext, osc: OscillatorNode, wave: CustomWaveType): void {
    const custom = this.getPeriodicWave(ctx, wave);
    if (custom) {
      osc.setPeriodicWave(custom);
    } else {
      osc.type = wave as OscillatorType;
    }
  }

  private ensureAudioGraph(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;

      try {
        const ctx = new AudioCtx();

        const mixBus = ctx.createGain();
        mixBus.gain.value = 0.88;

        // Clean studio mastering bus: remove subsonic rumble, add warm body, tame harsh highs
        const masterHp = ctx.createBiquadFilter();
        masterHp.type = 'highpass';
        masterHp.frequency.value = 30;

        const masterWarmth = ctx.createBiquadFilter();
        masterWarmth.type = 'lowshelf';
        masterWarmth.frequency.value = 95;
        masterWarmth.gain.value = 1.6;

        const masterSmooth = ctx.createBiquadFilter();
        masterSmooth.type = 'highshelf';
        masterSmooth.frequency.value = 8200;
        masterSmooth.gain.value = -1.8;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 18;
        compressor.ratio.value = 3.2;
        compressor.attack.value = 0.008;
        compressor.release.value = 0.14;

        const duckGain = ctx.createGain();
        duckGain.gain.value = this.computeDuckTarget();

        const volumeGain = ctx.createGain();
        volumeGain.gain.value = this.computeVolumeTarget();

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;

        // 1. Parallel tempo-synced band-shaped echo bus (highpass + lowpass keeps echoes clean!)
        const delayNode = ctx.createDelay(1.5);
        delayNode.delayTime.value = 0.34;
        const delayHp = ctx.createBiquadFilter();
        delayHp.type = 'highpass';
        delayHp.frequency.value = 280;
        const delayLp = ctx.createBiquadFilter();
        delayLp.type = 'lowpass';
        delayLp.frequency.value = 2600;
        const delayFeedbackGain = ctx.createGain();
        delayFeedbackGain.gain.value = 0.25;
        const delayReturnGain = ctx.createGain();
        delayReturnGain.gain.value = 0.2;

        delayNode.connect(delayHp);
        delayHp.connect(delayLp);
        delayLp.connect(delayFeedbackGain);
        delayFeedbackGain.connect(delayNode);
        delayLp.connect(delayReturnGain);
        delayReturnGain.connect(mixBus);

        // 2. Parallel Stereo Hall/Plate Convolution Reverb (huge upgrade for VGM realism!)
        const reverbNode = ctx.createConvolver();
        reverbNode.buffer = this.createImpulseResponse(ctx, 1.45, 2.75);
        const reverbHp = ctx.createBiquadFilter();
        reverbHp.type = 'highpass';
        reverbHp.frequency.value = 210;
        const reverbReturnGain = ctx.createGain();
        reverbReturnGain.gain.value = 0.28;

        reverbNode.connect(reverbHp);
        reverbHp.connect(reverbReturnGain);
        reverbReturnGain.connect(mixBus);

        mixBus.connect(masterHp);
        masterHp.connect(masterWarmth);
        masterWarmth.connect(masterSmooth);
        masterSmooth.connect(compressor);
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
        this.reverbNode = reverbNode;
        this.reverbReturnGain = reverbReturnGain;
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
    const len = Math.floor(ctx.sampleRate * 0.8);
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

    // Asymmetric warm tube saturation curve (richer even+odd harmonics, less brittle than hard clip)
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const drive = 1 + (key / 100) * 11;
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / (samples - 1) - 1;
      const asym = x >= 0 ? x * 1.08 : x * 0.92;
      curve[i] = Math.tanh(drive * asym) / norm;
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
    return Math.max(0.0001, Math.pow(norm, 1.4) * 0.62);
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

  private syncTrackSpatialBus(): void {
    if (!this.ctx || !this.delayNode || !this.delayFeedbackGain || !this.delayReturnGain) return;
    const score = TRACK_SCORES[this.currentTrackId];
    const sixteenth = 60 / score.bpm / 4;
    const dottedEighth = Math.min(1.2, Math.max(0.14, sixteenth * 3));
    const now = this.ctx.currentTime;
    this.delayNode.delayTime.setTargetAtTime(dottedEighth, now, 0.08);
    this.delayFeedbackGain.gain.setTargetAtTime(score.delayFeedback, now, 0.08);
    this.delayReturnGain.gain.setTargetAtTime(score.delayMix, now, 0.08);
    if (this.reverbReturnGain) {
      this.reverbReturnGain.gain.setTargetAtTime(score.reverbMix, now, 0.08);
    }
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
    this.syncTrackSpatialBus();
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
        this.syncTrackSpatialBus();
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
  ): { midi: number; steps: number; vel: number; glideSemi?: number } | null {
    if (cell === null || cell === undefined) return null;
    if (typeof cell === 'number') {
      return { midi: cell, steps: defaultSteps, vel: 1 };
    }
    return {
      midi: cell[0],
      steps: Math.max(0.5, cell[1] ?? defaultSteps),
      vel: cell[2] ?? 1,
      glideSemi: cell[3],
    };
  }

  private scheduleStep(
    step: number,
    time: number,
    sixteenthDur: number,
    score: TrackScore,
  ): void {
    const isAccented = Boolean(score.accentSteps?.includes(step));

    // 1. Chord Pad / Pipe Organ / Brass Stabs
    const chordSpec = score.chords[step];
    if (chordSpec) {
      const isRichChord = !Array.isArray(chordSpec) && 'notes' in chordSpec;
      const notes: readonly number[] = isRichChord ? chordSpec.notes : (chordSpec as readonly number[]);
      const chordSteps = isRichChord && chordSpec.steps ? chordSpec.steps : null;
      const chordVel = isRichChord && chordSpec.vel ? chordSpec.vel : 1;
      const voice =
        isRichChord && chordSpec.altVoice && score.altPadVoice ? score.altPadVoice : score.padVoice;
      const dur = chordSteps
        ? Math.max(sixteenthDur * 1.4, sixteenthDur * chordSteps)
        : Math.max(sixteenthDur * 2, voice.releaseSec);
      // Slight stereo spread across chord tones for lush studio width
      const spreadCount = Math.max(1, notes.length - 1);
      for (let i = 0; i < notes.length; i += 1) {
        const midi = notes[i];
        const notePan =
          (voice.pan ?? 0) + ((i / spreadCount) * 2 - 1) * 0.16;
        this.triggerSynthVoice(
          midiToHz(midi),
          time,
          dur,
          { ...voice, pan: Math.max(-0.85, Math.min(0.85, notePan)) },
          false,
          chordVel,
        );
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
        bassNote.glideSemi,
      );
    }

    // 3. Arpeggio / Rhythm Guitar
    const arpNote = this.resolveNoteCell(score.arp[step], 0.92);
    if (arpNote) {
      this.triggerSynthVoice(
        midiToHz(arpNote.midi),
        time,
        sixteenthDur * arpNote.steps,
        score.arpVoice,
        isAccented,
        arpNote.vel,
        arpNote.glideSemi,
      );
    }

    // 4. Counter-melody / Power-Chord Riff / Harmonized Strings
    if (score.counter && score.counterVoice) {
      const counterNote = this.resolveNoteCell(score.counter[step], 1.75);
      if (counterNote) {
        this.triggerSynthVoice(
          midiToHz(counterNote.midi),
          time,
          sixteenthDur * counterNote.steps,
          score.counterVoice,
          isAccented,
          counterNote.vel,
          counterNote.glideSemi,
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
        leadNote.glideSemi,
      );
    }

    // 6. Studio VGM Percussion Kit
    if (score.kick.includes(step)) {
      this.triggerKick(time, score.drumGain);
    }
    if (score.snare.includes(step)) {
      this.triggerSnare(time, score.drumGain * 0.78, Boolean(score.gatedSnare));
    }
    if (score.clap?.includes(step)) {
      this.triggerClap(time, score.drumGain * 0.52);
    }
    if (score.rim?.includes(step)) {
      this.triggerRim(time, score.drumGain * 0.44);
    }
    if (score.hatOpen?.includes(step)) {
      this.triggerHiHat(time, score.drumGain * 0.4, true);
    } else if (score.hatClosed.includes(step)) {
      const hatBoost = score.hatAccent?.includes(step) ? 0.34 : 0.2;
      this.triggerHiHat(time, score.drumGain * hatBoost, false);
    }
    if (score.clang?.includes(step)) {
      this.triggerClang(time, score.drumGain * 0.5);
    }
    if (score.crash?.includes(step)) {
      this.triggerCrash(time, score.drumGain * 0.46);
    }
    if (score.toms) {
      for (const tom of score.toms) {
        if (tom.step === step) {
          this.triggerTom(time, midiToHz(tom.midi), score.drumGain * 0.88 * (tom.vel ?? 1));
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
    glideSemi?: number,
  ): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    // 1. Click-Free True ADSR Envelope
    const envGain = ctx.createGain();
    const peakGain = Math.max(0.001, voice.gain * velocity * (accent ? 1.16 : 1));
    const totalDur = Math.max(0.045, durationSec);
    const attackSec = Math.min(voice.attackSec, totalDur * 0.65);
    const attackEnd = time + attackSec;
    const decaySec = voice.decaySec ?? 0.14;
    const sustainLvl = Math.max(0.05, Math.min(1, voice.sustainLevel ?? 0.72));
    const sustainGain = Math.max(0.0004, peakGain * sustainLvl);
    const noteOff = Math.max(attackEnd + 0.008, time + totalDur);
    const decayEnd = Math.min(noteOff, attackEnd + decaySec);
    const releaseEnd = noteOff + voice.releaseSec;

    envGain.gain.setValueAtTime(0.0001, time);
    envGain.gain.linearRampToValueAtTime(peakGain, attackEnd);
    if (decayEnd > attackEnd + 0.002 && sustainLvl < 0.99) {
      envGain.gain.exponentialRampToValueAtTime(sustainGain, decayEnd);
      if (noteOff > decayEnd + 0.002) {
        envGain.gain.setValueAtTime(sustainGain, noteOff);
      }
    } else if (noteOff > attackEnd + 0.002) {
      envGain.gain.setValueAtTime(peakGain, noteOff);
    }
    envGain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    // 2. Build Filter / Amp / Speaker Cabinet Chain backwards from envGain
    let inputStage: AudioNode = envGain;

    if (voice.cabinetEq) {
      // Authentic 4x12 guitar speaker cabinet curve: kills fizzy highs, adds palm-mute chunk & pick bite
      const cabLp = ctx.createBiquadFilter();
      cabLp.type = 'lowpass';
      cabLp.frequency.setValueAtTime(voice.cutoffHz ?? 2600, time);
      cabLp.Q.setValueAtTime(0.95, time);

      const cabBite = ctx.createBiquadFilter();
      cabBite.type = 'peaking';
      cabBite.frequency.setValueAtTime(2050, time);
      cabBite.Q.setValueAtTime(1.4, time);
      cabBite.gain.setValueAtTime(3.2, time);

      const cabChunk = ctx.createBiquadFilter();
      cabChunk.type = 'peaking';
      cabChunk.frequency.setValueAtTime(175, time);
      cabChunk.Q.setValueAtTime(1.2, time);
      cabChunk.gain.setValueAtTime(3.6, time);

      cabChunk.connect(cabBite);
      cabBite.connect(cabLp);
      cabLp.connect(inputStage);
      inputStage = cabChunk;
    } else if (voice.cutoffHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const baseCut = voice.cutoffHz;
      const peakCut = (voice.cutoffPeakHz ?? baseCut) * (accent ? 1.24 : 1);
      filter.Q.setValueAtTime(voice.q ?? 1.1, time);
      if (peakCut > baseCut) {
        filter.frequency.setValueAtTime(Math.min(11000, peakCut), time);
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(90, baseCut),
          time + Math.min(voice.filterDecaySec ?? 0.22, totalDur + 0.05),
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

    if (voice.highpassHz && voice.highpassHz > 20) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(voice.highpassHz, time);
      hp.connect(inputStage);
      inputStage = hp;
    }

    // 3. Oscillators (Single, Detuned Pair, 3-Voice Ensemble, or Power Chord Stack)
    const oscs: OscillatorNode[] = [];
    const startFreq =
      glideSemi && glideSemi !== 0 ? freqHz * Math.pow(2, glideSemi / 12) : freqHz;
    const glideTime = Math.min(0.055, totalDur * 0.32);

    const spawnOsc = (targetHz: number, detuneCents: number, gainMult = 1): OscillatorNode => {
      const osc = ctx.createOscillator();
      this.applyOscWaveform(ctx, osc, voice.waveform);
      const initHz =
        glideSemi && glideSemi !== 0 ? targetHz * Math.pow(2, glideSemi / 12) : targetHz;
      osc.frequency.setValueAtTime(initHz, time);
      if (glideSemi && glideSemi !== 0) {
        osc.frequency.exponentialRampToValueAtTime(targetHz, time + glideTime);
      }
      if (detuneCents !== 0) {
        osc.detune.setValueAtTime(detuneCents, time);
      }
      if (gainMult !== 1) {
        const g = ctx.createGain();
        g.gain.value = gainMult;
        osc.connect(g);
        g.connect(inputStage);
      } else {
        osc.connect(inputStage);
      }
      oscs.push(osc);
      return osc;
    };

    const primaryOsc = spawnOsc(freqHz, 0, voice.chorus3 ? 0.65 : 1);

    if (voice.chorus3 && voice.detuneCents && voice.detuneCents > 0) {
      spawnOsc(freqHz, -voice.detuneCents, 0.52);
      spawnOsc(freqHz, voice.detuneCents, 0.52);
    } else if (voice.detuneCents && voice.detuneCents > 0) {
      spawnOsc(freqHz, voice.detuneCents, 0.72);
    }

    if (voice.powerChord) {
      // Layer tight Perfect 5th (+7 semitones) + subtle octave (+12 semitones) for heavy rock/metal riffing
      spawnOsc(freqHz * 1.498307, -3, 0.78);
      spawnOsc(freqHz * 2.0, 4, 0.34);
    }

    if (voice.subOctaveGain && voice.subOctaveGain > 0.01) {
      const subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(startFreq * 0.5, time);
      if (glideSemi && glideSemi !== 0) {
        subOsc.frequency.exponentialRampToValueAtTime(freqHz * 0.5, time + glideTime);
      }
      const subGain = ctx.createGain();
      subGain.gain.value = voice.subOctaveGain;
      subOsc.connect(subGain);
      subGain.connect(inputStage);
      oscs.push(subOsc);
    }

    // 4. Optional 2-Operator FM Modulator (DX7 Rhodes tine, Slap Bass pop, FM Bell)
    if (voice.fmRatio && voice.fmIndexHz) {
      const modOsc = ctx.createOscillator();
      modOsc.type = 'sine';
      modOsc.frequency.setValueAtTime(freqHz * voice.fmRatio, time);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(voice.fmIndexHz * (accent ? 1.2 : 1), time);
      modGain.gain.exponentialRampToValueAtTime(
        3,
        time + Math.min(voice.fmDecaySec ?? 0.16, totalDur + 0.04),
      );
      modOsc.connect(modGain);
      modGain.connect(primaryOsc.frequency);
      oscs.push(modOsc);
    }

    // 5. Optional Expressive Vibrato on Sustained Notes
    if (voice.vibratoHz && voice.vibratoCents && totalDur >= 0.15) {
      const vibOsc = ctx.createOscillator();
      vibOsc.type = 'sine';
      vibOsc.frequency.setValueAtTime(voice.vibratoHz, time);
      const vibGain = ctx.createGain();
      const delaySec = Math.min(totalDur * 0.42, voice.vibratoDelaySec ?? 0.12);
      vibGain.gain.setValueAtTime(0, time);
      vibGain.gain.setValueAtTime(0, time + delaySec);
      vibGain.gain.linearRampToValueAtTime(voice.vibratoCents, time + delaySec + 0.085);
      vibOsc.connect(vibGain);
      for (const target of oscs) {
        if (target.detune) {
          vibGain.connect(target.detune);
        }
      }
      oscs.push(vibOsc);
    }

    // 6. Stereo Pan + Delay & Reverb Spatial Sends
    this.connectWithPan(ctx, envGain, voice.pan, mixBus);

    if (voice.delaySend && voice.delaySend > 0 && this.delayNode) {
      const send = ctx.createGain();
      send.gain.value = voice.delaySend;
      envGain.connect(send);
      send.connect(this.delayNode);
    }
    if (voice.reverbSend && voice.reverbSend > 0 && this.reverbNode) {
      const revSend = ctx.createGain();
      revSend.gain.value = voice.reverbSend;
      envGain.connect(revSend);
      revSend.connect(this.reverbNode);
    }

    const stopAt = releaseEnd + 0.03;
    for (const osc of oscs) {
      osc.start(time);
      osc.stop(stopAt);
    }
  }

  private triggerKick(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    // Punchy low sub body
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(152, time);
    osc.frequency.exponentialRampToValueAtTime(43, time + 0.09);

    gain.gain.setValueAtTime(Math.max(0.01, gainLevel * 1.24), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.21);

    osc.connect(gain);
    gain.connect(mixBus);
    osc.start(time);
    osc.stop(time + 0.23);

    // Crisp beater attack transient so the kick cuts cleanly through dense synth mixes
    const click = ctx.createBufferSource();
    click.buffer = this.getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, time);
    bp.Q.setValueAtTime(1.6, time);
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(Math.max(0.005, gainLevel * 0.42), time);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);

    click.connect(bp);
    bp.connect(clickGain);
    clickGain.connect(mixBus);
    click.start(time);
    click.stop(time + 0.024);
  }

  private triggerSnare(time: number, gainLevel: number, gated: boolean): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const snareBus = ctx.createGain();
    snareBus.gain.value = 1;
    snareBus.connect(mixBus);
    if (this.reverbNode) {
      const revSend = ctx.createGain();
      revSend.gain.value = gated ? 0.58 : 0.24;
      snareBus.connect(revSend);
      revSend.connect(this.reverbNode);
    }

    // Crisp snare wire noise
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(950, time);
    const crack = ctx.createBiquadFilter();
    crack.type = 'peaking';
    crack.frequency.setValueAtTime(2550, time);
    crack.gain.setValueAtTime(4.2, time);

    const noiseGain = ctx.createGain();
    const wireDur = gated ? 0.21 : 0.16;
    noiseGain.gain.setValueAtTime(Math.max(0.005, gainLevel * 0.92), time);
    if (gated) {
      noiseGain.gain.setValueAtTime(Math.max(0.005, gainLevel * 0.7), time + 0.08);
    }
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + wireDur);

    noise.connect(hp);
    hp.connect(crack);
    crack.connect(noiseGain);
    noiseGain.connect(snareBus);
    noise.start(time);
    noise.stop(time + wireDur + 0.02);

    // Warm pitched snare drum shell body
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(215, time);
    body.frequency.exponentialRampToValueAtTime(122, time + 0.075);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(Math.max(0.005, gainLevel * 0.68), time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    body.connect(bodyGain);
    bodyGain.connect(snareBus);
    body.start(time);
    body.stop(time + 0.13);
  }

  private triggerClap(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const clapBus = ctx.createGain();
    clapBus.gain.value = 1;
    this.connectWithPan(ctx, clapBus, 0.1, mixBus);
    if (this.reverbNode) {
      const revSend = ctx.createGain();
      revSend.gain.value = 0.36;
      clapBus.connect(revSend);
      revSend.connect(this.reverbNode);
    }

    const offsets = [0, 0.011, 0.022];
    for (let i = 0; i < offsets.length; i += 1) {
      const t0 = time + offsets[i];
      const isLast = i === offsets.length - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1420, t0);
      bp.Q.setValueAtTime(1.5, t0);

      const g = ctx.createGain();
      const dur = isLast ? 0.14 : 0.018;
      g.gain.setValueAtTime(Math.max(0.004, gainLevel * (isLast ? 0.95 : 0.72)), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      noise.connect(bp);
      bp.connect(g);
      g.connect(clapBus);
      noise.start(t0);
      noise.stop(t0 + dur + 0.02);
    }
  }

  private triggerRim(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180, time);
    osc.frequency.exponentialRampToValueAtTime(760, time + 0.028);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1550, time);
    bp.Q.setValueAtTime(2.4, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.004, gainLevel * 0.9), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(bp);
    bp.connect(gain);
    this.connectWithPan(ctx, gain, -0.22, mixBus);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  private triggerHiHat(time: number, gainLevel: number, open: boolean): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    // 6-oscillator inharmonic metallic shimmer (authentic TR-808/SNES hi-hat) + subtle air
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(open ? 6400 : 7800, time);

    const env = ctx.createGain();
    const dur = open ? 0.2 : 0.045;
    env.gain.setValueAtTime(Math.max(0.003, gainLevel), time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    hp.connect(env);
    this.connectWithPan(ctx, env, 0.16, mixBus);

    const metalFreqs = [312, 468, 594, 774, 966, 1218];
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.24;
    oscGain.connect(hp);
    for (const f of metalFreqs) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, time);
      osc.connect(oscGain);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const nGain = ctx.createGain();
    nGain.gain.value = 0.45;
    noise.connect(nGain);
    nGain.connect(hp);
    noise.start(time);
    noise.stop(time + dur + 0.02);
  }

  private triggerClang(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    // Metallic industrial anvil / factory strike with crisp resonance + stereo reverb
    const carrier = ctx.createOscillator();
    carrier.type = 'square';
    carrier.frequency.setValueAtTime(310, time);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(310 * 1.414, time);
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(480, time);
    modGain.gain.exponentialRampToValueAtTime(28, time + 0.16);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1950, time);
    bp.Q.setValueAtTime(2.8, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.004, gainLevel * 0.85), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

    carrier.connect(bp);
    bp.connect(gain);
    this.connectWithPan(ctx, gain, -0.24, mixBus);
    if (this.reverbNode) {
      const revSend = ctx.createGain();
      revSend.gain.value = 0.42;
      gain.connect(revSend);
      revSend.connect(this.reverbNode);
    }

    carrier.start(time);
    mod.start(time);
    carrier.stop(time + 0.26);
    mod.stop(time + 0.26);
  }

  private triggerTom(time: number, freqHz: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqHz * 1.36, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(42, freqHz * 0.88), time + 0.18);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.006, gainLevel), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);

    osc.connect(gain);
    this.connectWithPan(ctx, gain, 0.1, mixBus);
    if (this.reverbNode) {
      const revSend = ctx.createGain();
      revSend.gain.value = 0.34;
      gain.connect(revSend);
      revSend.connect(this.reverbNode);
    }
    osc.start(time);
    osc.stop(time + 0.3);
  }

  private triggerCrash(time: number, gainLevel: number): void {
    const ctx = this.ctx;
    const mixBus = this.mixBus;
    if (!ctx || !mixBus) return;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4400, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.004, gainLevel * 0.68), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.68);

    hp.connect(gain);
    this.connectWithPan(ctx, gain, -0.18, mixBus);
    if (this.reverbNode) {
      const revSend = ctx.createGain();
      revSend.gain.value = 0.45;
      gain.connect(revSend);
      revSend.connect(this.reverbNode);
    }

    const metalFreqs = [345, 512, 684, 892, 1135, 1480];
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.16;
    oscGain.connect(hp);
    for (const f of metalFreqs) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, time);
      osc.connect(oscGain);
      osc.start(time);
      osc.stop(time + 0.72);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const nGain = ctx.createGain();
    nGain.gain.value = 0.48;
    noise.connect(nGain);
    nGain.connect(hp);
    noise.start(time);
    noise.stop(time + 0.72);
  }
}

export const retroMusicPlayer = new RetroMusicSequencer();
