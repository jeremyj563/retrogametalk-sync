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

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(next: boolean): void {
    this.muted = next;
    saveEasterEggMuted(next);
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
}

export const retroSynth = new RetroChiptuneSynth();
