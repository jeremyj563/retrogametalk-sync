import {
  loadRewardCosmeticPrefs,
  type TrophyChimePackId,
} from '../shared/achievementRewards';
import { loadEasterEggMuted, saveEasterEggMuted } from './easterEggs';

// C major pentatonic scale spanning two octaves for musical brick-combo chimes
const COMBO_SCALE_HZ = [
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.0,  // A5
  1046.5, // C6
  1174.66, // D6
  1318.51, // E6
  1567.98, // G6
  1760.0, // A6
];

class RetroChiptuneSynth {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted: boolean = loadEasterEggMuted();
  private chimePack: TrophyChimePackId = loadRewardCosmeticPrefs().chimePack;
  private duckListeners = new Set<(durationMs: number) => void>();

  subscribeDuckRequests(listener: (durationMs: number) => void): () => void {
    this.duckListeners.add(listener);
    return () => {
      this.duckListeners.delete(listener);
    };
  }

  private notifyDuck(durationMs: number): void {
    if (this.muted) return;
    for (const listener of this.duckListeners) {
      try {
        listener(durationMs);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(next: boolean): void {
    this.muted = next;
    saveEasterEggMuted(next);
  }

  getChimePack(): TrophyChimePackId {
    return this.chimePack;
  }

  setChimePack(pack: TrophyChimePackId): void {
    this.chimePack = pack;
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freqStart: number,
    durationSec: number,
    options?: {
      type?: OscillatorType;
      freqEnd?: number;
      volume?: number;
      delaySec?: number;
    },
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + (options?.delaySec ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const vol = Math.min(0.22, Math.max(0.01, options?.volume ?? 0.1));

    osc.type = options?.type ?? 'square';
    osc.frequency.setValueAtTime(freqStart, now);
    if (options?.freqEnd && options.freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(40, options.freqEnd),
        now + durationSec,
      );
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.floor(ctx.sampleRate * 0.75);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  paddleHit(): void {
    this.playTone(440, 0.065, { type: 'square', freqEnd: 587.33, volume: 0.095 });
  }

  wallHit(): void {
    this.playTone(250, 0.04, { type: 'triangle', freqEnd: 195, volume: 0.08 });
  }

  brickBreak(combo = 1): void {
    const idx = Math.min(COMBO_SCALE_HZ.length - 1, Math.max(0, combo - 1));
    const baseHz = COMBO_SCALE_HZ[idx];
    this.playTone(baseHz, 0.085, { type: 'square', freqEnd: baseHz * 1.12, volume: 0.1 });
    if (combo >= 4) {
      this.playTone(baseHz * 1.5, 0.075, {
        type: 'triangle',
        delaySec: 0.035,
        volume: 0.07,
      });
    }
  }

  armorHit(): void {
    this.playTone(880, 0.045, { type: 'square', volume: 0.085 });
    this.playTone(1174.66, 0.055, { type: 'triangle', delaySec: 0.035, volume: 0.075 });
  }

  powerupCatch(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((hz, index) => {
      this.playTone(hz, 0.08, {
        type: 'square',
        delaySec: index * 0.055,
        volume: 0.095,
      });
    });
  }

  lifeLost(): void {
    const notes = [392.0, 329.63, 261.63, 174.61];
    notes.forEach((hz, index) => {
      this.playTone(hz, 0.11, {
        type: 'sawtooth',
        freqEnd: hz * 0.88,
        delaySec: index * 0.09,
        volume: 0.085,
      });
    });
  }

  stageClear(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((hz, index) => {
      this.playTone(hz, index === notes.length - 1 ? 0.24 : 0.09, {
        type: 'square',
        delaySec: index * 0.075,
        volume: 0.1,
      });
    });
  }

  gameOver(): void {
    const notes = [392.0, 369.99, 349.23, 329.63, 246.94];
    notes.forEach((hz, index) => {
      this.playTone(hz, index === notes.length - 1 ? 0.32 : 0.11, {
        type: 'triangle',
        delaySec: index * 0.11,
        volume: 0.11,
      });
    });
  }

  konamiUnlock(): void {
    this.notifyDuck(1050);
    const notes = [523.25, 659.25, 783.99, 1046.5, 987.77, 1318.51];
    notes.forEach((hz, index) => {
      this.playTone(hz, index === notes.length - 1 ? 0.22 : 0.075, {
        type: 'square',
        delaySec: index * 0.06,
        volume: 0.1,
      });
    });
  }

  barrelRoll(): void {
    this.notifyDuck(1100);
    this.playTone(261.63, 0.42, { type: 'triangle', freqEnd: 659.25, volume: 0.09 });
    this.playTone(659.25, 0.48, {
      type: 'triangle',
      freqEnd: 329.63,
      delaySec: 0.42,
      volume: 0.085,
    });
  }

  cartridgeBlow(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    this.notifyDuck(1150);

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.25);
    filter.frequency.exponentialRampToValueAtTime(900, now + 0.58);
    filter.Q.setValueAtTime(1.4, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.62);

    // Follow the puff of air with a crisp NES lock-on chime
    this.playTone(659.25, 0.08, { type: 'square', delaySec: 0.64, volume: 0.095 });
    this.playTone(1318.51, 0.16, { type: 'square', delaySec: 0.72, volume: 0.1 });
  }

  trophyUnlock(
    tier: 'bronze' | 'silver' | 'gold' | 'platinum',
    packOverride?: TrophyChimePackId,
  ): void {
    const duckMs =
      tier === 'platinum' ? 1650 : tier === 'gold' ? 1400 : tier === 'silver' ? 1200 : 1000;
    this.notifyDuck(duckMs);
    const pack = packOverride ?? this.chimePack;

    if (pack === 'fm_16bit') {
      // Warm 16-bit FM synth bells (dual slightly-detuned sine + triangle harmonics)
      const seq =
        tier === 'bronze'
          ? [523.25, 783.99]
          : tier === 'silver'
            ? [523.25, 659.25, 1046.5]
            : tier === 'gold'
              ? [440, 554.37, 659.25, 880, 1108.73]
              : [440, 554.37, 659.25, 880, 1108.73, 1318.51, 1760];
      seq.forEach((hz, idx) => {
        const delay = idx * 0.068;
        const dur = idx === seq.length - 1 ? 0.42 : 0.14;
        this.playTone(hz, dur, { type: 'sine', delaySec: delay, volume: 0.11 });
        this.playTone(hz * 1.006, dur * 0.9, { type: 'triangle', delaySec: delay, volume: 0.08 });
        this.playTone(hz * 2, dur * 0.6, { type: 'sine', delaySec: delay + 0.012, volume: 0.045 });
      });
      return;
    }

    if (pack === 'coinop_arcade') {
      // Snappy 1990s coin-op arcade credit + fanfare arpeggios
      const seq =
        tier === 'bronze'
          ? [987.77, 1318.51]
          : tier === 'silver'
            ? [783.99, 987.77, 1174.66, 1567.98]
            : tier === 'gold'
              ? [659.25, 783.99, 1046.5, 1318.51, 1567.98]
              : [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];
      seq.forEach((hz, idx) => {
        const delay = idx * 0.046;
        const dur = idx === seq.length - 1 ? 0.34 : 0.075;
        this.playTone(hz, dur, { type: 'square', delaySec: delay, volume: 0.085 });
        this.playTone(hz * 0.5, dur * 0.8, { type: 'sawtooth', delaySec: delay, volume: 0.045 });
      });
      return;
    }

    if (pack === 'symphonic_crt') {
      // Lush multi-voice crystalline console chord bloom
      const rootNotes =
        tier === 'bronze'
          ? [587.33, 880]
          : tier === 'silver'
            ? [523.25, 659.25, 987.77]
            : tier === 'gold'
              ? [440, 659.25, 880, 1108.73, 1318.51]
              : [392.0, 523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
      rootNotes.forEach((hz, idx) => {
        const delay = idx * 0.075;
        const dur = idx >= rootNotes.length - 2 ? 0.52 : 0.24;
        this.playTone(hz, dur, { type: 'sine', delaySec: delay, volume: 0.1 });
        this.playTone(hz * 1.5, dur * 0.85, { type: 'triangle', delaySec: delay + 0.015, volume: 0.05 });
      });
      return;
    }

    // Default: 'classic_8bit'
    if (tier === 'bronze') {
      // Crisp, warm 2-note retro console ping (E5 -> B5)
      this.playTone(659.25, 0.09, { type: 'triangle', volume: 0.11 });
      this.playTone(987.77, 0.22, { type: 'square', delaySec: 0.075, volume: 0.085 });
      this.playTone(987.77, 0.28, { type: 'triangle', delaySec: 0.075, volume: 0.1 });
      return;
    }

    if (tier === 'silver') {
      // Bright 3-note ascending console triad (C5 -> G5 -> C6)
      const notes = [523.25, 783.99, 1046.5];
      notes.forEach((hz, idx) => {
        const delay = idx * 0.075;
        const dur = idx === notes.length - 1 ? 0.32 : 0.11;
        this.playTone(hz, dur, { type: 'triangle', delaySec: delay, volume: 0.11 });
        this.playTone(hz, dur * 0.85, { type: 'square', delaySec: delay, volume: 0.06 });
      });
      return;
    }

    if (tier === 'gold') {
      // Triumphant 4-note fanfare with sparkling fifth (D5 -> F#5 -> A5 -> D6)
      const notes = [587.33, 739.99, 880.0, 1174.66];
      notes.forEach((hz, idx) => {
        const delay = idx * 0.07;
        const dur = idx === notes.length - 1 ? 0.38 : 0.11;
        this.playTone(hz, dur, { type: 'square', delaySec: delay, volume: 0.08 });
        this.playTone(hz * 0.5, dur, { type: 'triangle', delaySec: delay, volume: 0.09 });
      });
      this.playTone(1760.0, 0.34, { type: 'triangle', delaySec: 0.24, volume: 0.075 });
      return;
    }

    // Platinum: Majestic 6-note harmonic arpeggio with glowing sustain
    const notes = [523.25, 659.25, 783.99, 987.77, 1046.5, 1567.98];
    notes.forEach((hz, idx) => {
      const delay = idx * 0.068;
      const dur = idx >= notes.length - 2 ? 0.45 : 0.14;
      this.playTone(hz, dur, { type: 'triangle', delaySec: delay, volume: 0.11 });
      this.playTone(hz, dur * 0.8, { type: 'square', delaySec: delay, volume: 0.065 });
    });
  }

  menuSelect(): void {
    this.playTone(620, 0.035, { type: 'square', freqEnd: 740, volume: 0.06 });
  }

  cartBoot(): void {
    const notes = [440, 659.25, 880];
    notes.forEach((hz, idx) => {
      this.playTone(hz, idx === 2 ? 0.15 : 0.06, {
        type: 'square',
        delaySec: idx * 0.048,
        volume: 0.085,
      });
    });
  }

  laserShot(): void {
    this.playTone(960, 0.085, { type: 'square', freqEnd: 230, volume: 0.075 });
  }

  invaderHit(): void {
    this.playTone(320, 0.06, { type: 'sawtooth', freqEnd: 110, volume: 0.085 });
    this.playTone(170, 0.075, { type: 'square', freqEnd: 72, delaySec: 0.025, volume: 0.07 });
  }

  invaderMarch(stepIndex: number): void {
    const bassNotes = [98.0, 92.5, 87.31, 82.41]; // G2 -> F#2 -> F2 -> E2
    const hz = bassNotes[((stepIndex % 4) + 4) % 4];
    this.playTone(hz, 0.055, { type: 'triangle', freqEnd: hz * 0.86, volume: 0.075 });
  }

  ufoWarble(): void {
    this.playTone(760, 0.08, { type: 'triangle', freqEnd: 1080, volume: 0.065 });
    this.playTone(1080, 0.08, { type: 'triangle', freqEnd: 760, delaySec: 0.08, volume: 0.065 });
  }

  ufoDestroy(): void {
    const notes = [880, 1046.5, 1318.51, 1567.98];
    notes.forEach((hz, idx) => {
      this.playTone(hz, 0.085, {
        type: 'square',
        delaySec: idx * 0.045,
        volume: 0.095,
      });
    });
  }

  snakeEat(combo = 1): void {
    const idx = Math.min(COMBO_SCALE_HZ.length - 1, Math.max(0, combo - 1));
    const hz = COMBO_SCALE_HZ[idx];
    this.playTone(hz, 0.065, { type: 'square', freqEnd: hz * 1.18, volume: 0.085 });
  }

  snakeBonus(): void {
    const notes = [659.25, 880, 1174.66, 1567.98];
    notes.forEach((hz, idx) => {
      this.playTone(hz, idx === 3 ? 0.18 : 0.065, {
        type: 'square',
        delaySec: idx * 0.05,
        volume: 0.095,
      });
    });
  }

  shieldBounce(): void {
    this.playTone(523.25, 0.1, { type: 'triangle', freqEnd: 987.77, volume: 0.1 });
    this.playTone(783.99, 0.14, { type: 'square', delaySec: 0.06, volume: 0.08 });
  }

  tetroMove(): void {
    this.playTone(260, 0.025, { type: 'triangle', volume: 0.05 });
  }

  tetroRotate(): void {
    this.playTone(540, 0.04, { type: 'square', freqEnd: 680, volume: 0.065 });
  }

  tetroLock(): void {
    this.playTone(150, 0.055, { type: 'triangle', freqEnd: 88, volume: 0.09 });
  }

  tetroLineClear(lines: number): void {
    if (lines >= 4) {
      // Celebratory 4-line QUAD fanfare!
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
      notes.forEach((hz, idx) => {
        this.playTone(hz, idx === notes.length - 1 ? 0.28 : 0.08, {
          type: 'square',
          delaySec: idx * 0.052,
          volume: 0.1,
        });
        this.playTone(hz * 0.5, 0.09, {
          type: 'triangle',
          delaySec: idx * 0.052,
          volume: 0.075,
        });
      });
      return;
    }

    const baseNotes =
      lines === 3
        ? [523.25, 659.25, 783.99, 1046.5]
        : lines === 2
          ? [523.25, 659.25, 880]
          : [523.25, 783.99];
    baseNotes.forEach((hz, idx) => {
      this.playTone(hz, idx === baseNotes.length - 1 ? 0.16 : 0.07, {
        type: 'square',
        delaySec: idx * 0.05,
        volume: 0.09,
      });
    });
  }

  vsyncGlitch(): void {
    this.notifyDuck(1250);
    // Rapid 60Hz-inspired vertical-hold flutter bursts followed by a clean sync lock-on ping
    const pulses = [
      { f1: 118, f2: 58, delay: 0, dur: 0.14 },
      { f1: 185, f2: 64, delay: 0.12, dur: 0.12 },
      { f1: 96, f2: 144, delay: 0.24, dur: 0.14 },
      { f1: 132, f2: 60, delay: 0.4, dur: 0.15 },
      { f1: 164, f2: 72, delay: 0.58, dur: 0.13 },
    ];
    for (const p of pulses) {
      this.playTone(p.f1, p.dur, {
        type: 'sawtooth',
        freqEnd: p.f2,
        delaySec: p.delay,
        volume: 0.065,
      });
    }
    this.playTone(880, 0.06, { type: 'square', delaySec: 0.82, volume: 0.075 });
    this.playTone(1174.66, 0.12, { type: 'triangle', delaySec: 0.89, volume: 0.08 });
  }
}

export const retroSynth = new RetroChiptuneSynth();
