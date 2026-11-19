import type { CSSProperties } from 'react';

export type CrtCorePalette = 'green' | 'amber' | 'cyan';
export type CrtBonusPalette = 'gameboy' | 'synthwave' | 'virtualboy' | 'trinitron';
export type CrtPalette = CrtCorePalette | CrtBonusPalette;
export type CrtPresetId = 'subtle' | 'pvm' | 'arcade' | 'bvm';
export type CrtUiMotionLevel = 'off' | 'low' | 'medium' | 'high' | 'ultra';

export interface CrtFxValues {
  scanlines: number;
  gaussGlow: number;
  vignette: number;
  apertureGrille: number;
  chromaticAberration: number;
}

export interface CrtDisplaySettings extends CrtFxValues {
  enabled: boolean;
  palette: CrtPalette;
  uiMotion: CrtUiMotionLevel;
  syncSpeedWave: boolean;
  customValues?: CrtFxValues;
}

export const CRT_DISPLAY_STORAGE_KEY = 'rgt_sync_crt_display_v1';
const LEGACY_SCANLINES_STORAGE_KEY = 'rgt_sync_crt_scanlines_v1';

export const CRT_PRESETS: Record<
  CrtPresetId,
  { label: string; description: string; values: CrtFxValues }
> = {
  subtle: {
    label: 'Subtle',
    description: 'Balanced studio look with light scanlines and gentle phosphor warmth',
    values: {
      scanlines: 35,
      gaussGlow: 25,
      vignette: 20,
      apertureGrille: 10,
      chromaticAberration: 0,
    },
  },
  pvm: {
    label: 'PVM',
    description: 'Classic Sony PVM broadcast monitor profile with crisp grille and bloom',
    values: {
      scanlines: 55,
      gaussGlow: 45,
      vignette: 40,
      apertureGrille: 45,
      chromaticAberration: 20,
    },
  },
  arcade: {
    label: 'Arcade',
    description: 'Bold 90s arcade cabinet CRT depth, vivid glow, and convergence fringe',
    values: {
      scanlines: 85,
      gaussGlow: 75,
      vignette: 65,
      apertureGrille: 70,
      chromaticAberration: 45,
    },
  },
  bvm: {
    label: 'BVM',
    description: 'Flagship broadcast reference monitor: ultra-crisp aperture grille, balanced bloom, razor scanlines',
    values: {
      scanlines: 65,
      gaussGlow: 58,
      vignette: 32,
      apertureGrille: 82,
      chromaticAberration: 14,
    },
  },
};

export const CRT_CORE_PALETTES: readonly CrtCorePalette[] = ['green', 'amber', 'cyan'];
export const CRT_BONUS_PALETTES: readonly CrtBonusPalette[] = [
  'gameboy',
  'synthwave',
  'virtualboy',
  'trinitron',
];

export const CRT_PALETTES: Record<
  CrtPalette,
  { label: string; shortLabel: string; swatch: string; swatchClass: string; rgb: string }
> = {
  green: {
    label: 'Green',
    shortLabel: 'Green',
    swatch: '#38e56b',
    swatchClass: 'bg-[#38e56b]',
    rgb: '56, 229, 107',
  },
  amber: {
    label: 'Amber',
    shortLabel: 'Amber',
    swatch: '#ffb000',
    swatchClass: 'bg-[#ffb000]',
    rgb: '255, 176, 0',
  },
  cyan: {
    label: 'Cyan',
    shortLabel: 'Cyan',
    swatch: '#38d9f5',
    swatchClass: 'bg-[#38d9f5]',
    rgb: '56, 217, 245',
  },
  gameboy: {
    label: 'DMG Olive',
    shortLabel: 'DMG',
    swatch: '#9bbc0f',
    swatchClass: 'bg-[#9bbc0f]',
    rgb: '155, 188, 15',
  },
  synthwave: {
    label: 'Synthwave',
    shortLabel: 'Synth',
    swatch: '#f45bff',
    swatchClass: 'bg-[#f45bff]',
    rgb: '244, 91, 255',
  },
  virtualboy: {
    label: 'Crimson Tube',
    shortLabel: 'Crimson',
    swatch: '#ff3b4e',
    swatchClass: 'bg-[#ff3b4e]',
    rgb: '255, 59, 78',
  },
  trinitron: {
    label: 'Trinitron White',
    shortLabel: 'White',
    swatch: '#e8f4ff',
    swatchClass: 'bg-[#e8f4ff]',
    rgb: '232, 244, 255',
  },
};

export const CRT_UI_MOTION_LEVELS: Record<
  CrtUiMotionLevel,
  { shortLabel: string; label: string; description: string }
> = {
  off: {
    shortLabel: 'Off',
    label: 'Off',
    description: 'Static icons and surfaces with zero continuous UI animations',
  },
  low: {
    shortLabel: 'Low',
    label: 'Low',
    description:
      'Tactile console heartbeat: active icon & banner motion, live readout breathe, hover holo covers, table laser edge & focus glow',
  },
  medium: {
    shortLabel: 'Med',
    label: 'Medium',
    description:
      'Living studio monitor: header laser sweep, staggered panel & popover beams, console & drawer traces, KPI breathe & glowing active tabs',
  },
  high: {
    shortLabel: 'High',
    label: 'High',
    description:
      'Broadcast PVM suite: subtle V-sync hum bar, dual counter-beams, dual chart sweeps, ambient holo box-art, periodic CTA sheen & full icon kinematics',
  },
  ultra: {
    shortLabel: 'Ultra',
    label: 'Ultra',
    description:
      'Overclocked arcade spectacle: CRT degauss surge, flyback retrace + hum bar, live RGB convergence pulse, sidebar data-bus lasers, top/bottom perimeter beams & boosted bloom',
  },
};

export const DEFAULT_CRT_DISPLAY_SETTINGS: CrtDisplaySettings = {
  enabled: true,
  palette: 'green',
  uiMotion: 'low',
  syncSpeedWave: true,
  ...CRT_PRESETS.subtle.values,
};

export function clampCrtPct(val: unknown, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function extractCrtFxValues(values: CrtFxValues): CrtFxValues {
  return {
    scanlines: values.scanlines,
    gaussGlow: values.gaussGlow,
    vignette: values.vignette,
    apertureGrille: values.apertureGrille,
    chromaticAberration: values.chromaticAberration,
  };
}

export function isValidPalette(val: unknown): val is CrtPalette {
  return (
    val === 'green' ||
    val === 'amber' ||
    val === 'cyan' ||
    val === 'gameboy' ||
    val === 'synthwave' ||
    val === 'virtualboy' ||
    val === 'trinitron'
  );
}

function isValidUiMotionLevel(val: unknown): val is CrtUiMotionLevel {
  return (
    val === 'off' ||
    val === 'low' ||
    val === 'medium' ||
    val === 'high' ||
    val === 'ultra'
  );
}

function parseSavedCustomFxValues(raw: unknown): CrtFxValues | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Partial<CrtFxValues>;
  const sanitized: CrtFxValues = {
    scanlines: clampCrtPct(candidate.scanlines, DEFAULT_CRT_DISPLAY_SETTINGS.scanlines),
    gaussGlow: clampCrtPct(candidate.gaussGlow, DEFAULT_CRT_DISPLAY_SETTINGS.gaussGlow),
    vignette: clampCrtPct(candidate.vignette, DEFAULT_CRT_DISPLAY_SETTINGS.vignette),
    apertureGrille: clampCrtPct(
      candidate.apertureGrille,
      DEFAULT_CRT_DISPLAY_SETTINGS.apertureGrille,
    ),
    chromaticAberration: clampCrtPct(
      candidate.chromaticAberration,
      DEFAULT_CRT_DISPLAY_SETTINGS.chromaticAberration,
    ),
  };
  return detectActiveCrtPreset(sanitized) === 'custom' ? sanitized : undefined;
}

export function loadInitialCrtDisplaySettings(): CrtDisplaySettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CRT_DISPLAY_SETTINGS };
    }
    const raw = window.localStorage.getItem(CRT_DISPLAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CrtDisplaySettings>;
      const activeFx: CrtFxValues = {
        scanlines: clampCrtPct(parsed.scanlines, DEFAULT_CRT_DISPLAY_SETTINGS.scanlines),
        gaussGlow: clampCrtPct(parsed.gaussGlow, DEFAULT_CRT_DISPLAY_SETTINGS.gaussGlow),
        vignette: clampCrtPct(parsed.vignette, DEFAULT_CRT_DISPLAY_SETTINGS.vignette),
        apertureGrille: clampCrtPct(
          parsed.apertureGrille,
          DEFAULT_CRT_DISPLAY_SETTINGS.apertureGrille,
        ),
        chromaticAberration: clampCrtPct(
          parsed.chromaticAberration,
          DEFAULT_CRT_DISPLAY_SETTINGS.chromaticAberration,
        ),
      };
      const customValues =
        detectActiveCrtPreset(activeFx) === 'custom'
          ? activeFx
          : parseSavedCustomFxValues(parsed.customValues);

      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
        palette: isValidPalette(parsed.palette) ? parsed.palette : 'green',
        uiMotion: isValidUiMotionLevel(parsed.uiMotion)
          ? parsed.uiMotion
          : DEFAULT_CRT_DISPLAY_SETTINGS.uiMotion,
        syncSpeedWave:
          typeof parsed.syncSpeedWave === 'boolean'
            ? parsed.syncSpeedWave
            : DEFAULT_CRT_DISPLAY_SETTINGS.syncSpeedWave,
        ...activeFx,
        ...(customValues ? { customValues } : {}),
      };
    }

    // Migrate previous single-slider scanlines preference if present
    const legacyRaw = window.localStorage.getItem(LEGACY_SCANLINES_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { enabled?: boolean; intensity?: number };
      const scanlines = clampCrtPct(legacy.intensity, DEFAULT_CRT_DISPLAY_SETTINGS.scanlines);
      const enabled = typeof legacy.enabled === 'boolean' ? legacy.enabled : scanlines > 0;
      const migrated: CrtDisplaySettings = {
        ...DEFAULT_CRT_DISPLAY_SETTINGS,
        enabled,
        scanlines,
      };
      const migratedFx = extractCrtFxValues(migrated);
      if (detectActiveCrtPreset(migratedFx) === 'custom') {
        migrated.customValues = migratedFx;
      }
      return migrated;
    }

    return { ...DEFAULT_CRT_DISPLAY_SETTINGS };
  } catch {
    return { ...DEFAULT_CRT_DISPLAY_SETTINGS };
  }
}

export function saveCrtDisplaySettings(settings: CrtDisplaySettings): void {
  try {
    window.localStorage?.setItem(CRT_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or sandbox restrictions
  }
}

export function detectActiveCrtPreset(settings: CrtFxValues): CrtPresetId | 'custom' {
  for (const id of ['subtle', 'pvm', 'arcade', 'bvm'] as const) {
    const v = CRT_PRESETS[id].values;
    if (
      settings.scanlines === v.scanlines &&
      settings.gaussGlow === v.gaussGlow &&
      settings.vignette === v.vignette &&
      settings.apertureGrille === v.apertureGrille &&
      settings.chromaticAberration === v.chromaticAberration
    ) {
      return id;
    }
  }
  return 'custom';
}

export function isRetroVisionaryCrtConfig(
  settings: Pick<CrtDisplaySettings, 'enabled' | 'uiMotion' | 'scanlines'>,
): boolean {
  return settings.uiMotion === 'ultra' || (settings.enabled && settings.scanlines >= 100);
}

export function isSyncSpeedWaveActive(
  settings: Pick<CrtDisplaySettings, 'uiMotion' | 'syncSpeedWave'>,
): boolean {
  return settings.uiMotion !== 'off' && settings.syncSpeedWave;
}

export interface SyncSpeedWaveParams {
  active: boolean;
  /** Normalized throughput intensity in [0, 1] via logarithmic MB/s mapping */
  speedRatio: number;
  /** Wave horizontal travel frequency in cycles per second (Hz) */
  frequencyHz: number;
  /** Number of visible wave cycles spanning the Sync Status container width */
  spatialCycles: number;
  /** Vertical amplitude as a ratio of half-canvas height (0..0.9) */
  amplitudeRatio: number;
  /** Primary oscilloscope stroke opacity */
  primaryOpacity: number;
  /** Secondary phase-offset harmonic opacity (0 on Low) */
  harmonicOpacity: number;
  /** Subtle fill gradient alpha beneath the primary trace */
  fillOpacity: number;
  /** Phosphor bloom blur radius in CSS px */
  glowPx: number;
  /** Primary stroke thickness in CSS px */
  lineWidth: number;
  /** Progress bar traveling wave sweep duration in seconds */
  progressWaveDurationSec: number;
}

const SYNC_WAVE_MAX_REFERENCE_MBPS = 45;
const SYNC_WAVE_LOG_SCALE = 1.4;
const SYNC_WAVE_LOG_DENOM = Math.log10(1 + SYNC_WAVE_MAX_REFERENCE_MBPS * SYNC_WAVE_LOG_SCALE);

/**
 * Logarithmically maps live download throughput (bytes/sec) into a smooth [0, 1]
 * range so low-speed scrapes (200 KB/s - 2 MB/s) and high-speed bursts (25+ MB/s)
 * both produce clear, granular visual differentiation.
 */
export function normalizeDownloadSpeedRatio(bytesPerSec: number): number {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return 0;
  const mbps = bytesPerSec / (1024 * 1024);
  const raw = Math.log10(1 + mbps * SYNC_WAVE_LOG_SCALE) / SYNC_WAVE_LOG_DENOM;
  return Math.max(0, Math.min(1, raw));
}

export function computeSyncSpeedWaveParams(
  bytesPerSec: number,
  uiMotion: CrtUiMotionLevel,
  syncSpeedWave: boolean,
): SyncSpeedWaveParams {
  if (uiMotion === 'off' || !syncSpeedWave) {
    return {
      active: false,
      speedRatio: 0,
      frequencyHz: 0,
      spatialCycles: 2,
      amplitudeRatio: 0,
      primaryOpacity: 0,
      harmonicOpacity: 0,
      fillOpacity: 0,
      glowPx: 0,
      lineWidth: 1,
      progressWaveDurationSec: 2.2,
    };
  }

  const speedRatio = normalizeDownloadSpeedRatio(bytesPerSec);
  const tierConfig: Record<
    Exclude<CrtUiMotionLevel, 'off'>,
    {
      freqMul: number;
      ampBase: number;
      ampSpan: number;
      primaryOpacity: number;
      harmonicOpacity: number;
      fillOpacity: number;
      glowPx: number;
      lineWidth: number;
      barSpeedMul: number;
    }
  > = {
    low: {
      freqMul: 0.85,
      ampBase: 0.2,
      ampSpan: 0.34,
      primaryOpacity: 0.24,
      harmonicOpacity: 0,
      fillOpacity: 0.05,
      glowPx: 3,
      lineWidth: 1.25,
      barSpeedMul: 1.15,
    },
    medium: {
      freqMul: 1.0,
      ampBase: 0.26,
      ampSpan: 0.44,
      primaryOpacity: 0.36,
      harmonicOpacity: 0.13,
      fillOpacity: 0.085,
      glowPx: 6,
      lineWidth: 1.5,
      barSpeedMul: 1.0,
    },
    high: {
      freqMul: 1.14,
      ampBase: 0.32,
      ampSpan: 0.48,
      primaryOpacity: 0.48,
      harmonicOpacity: 0.24,
      fillOpacity: 0.12,
      glowPx: 10,
      lineWidth: 1.75,
      barSpeedMul: 0.88,
    },
    ultra: {
      freqMul: 1.28,
      ampBase: 0.38,
      ampSpan: 0.5,
      primaryOpacity: 0.62,
      harmonicOpacity: 0.34,
      fillOpacity: 0.16,
      glowPx: 14,
      lineWidth: 2,
      barSpeedMul: 0.76,
    },
  };

  const tier = tierConfig[uiMotion];
  const frequencyHz = Number(((0.65 + speedRatio * 4.85) * tier.freqMul).toFixed(3));
  const spatialCycles = Number((2.2 + speedRatio * 6.3).toFixed(3));
  const amplitudeRatio = Number((tier.ampBase + speedRatio * tier.ampSpan).toFixed(3));
  const progressWaveDurationSec = Number(
    Math.max(0.32, (2.1 - speedRatio * 1.58) * tier.barSpeedMul).toFixed(2),
  );

  return {
    active: true,
    speedRatio,
    frequencyHz,
    spatialCycles,
    amplitudeRatio,
    primaryOpacity: Number((tier.primaryOpacity + speedRatio * 0.14).toFixed(3)),
    harmonicOpacity: tier.harmonicOpacity > 0
      ? Number((tier.harmonicOpacity + speedRatio * 0.1).toFixed(3))
      : 0,
    fillOpacity: Number((tier.fillOpacity + speedRatio * 0.05).toFixed(3)),
    glowPx: Math.round(tier.glowPx + speedRatio * 4),
    lineWidth: tier.lineWidth,
    progressWaveDurationSec,
  };
}

export function computeCrtCssVariables(settings: CrtDisplaySettings): CSSProperties {
  const paletteInfo = CRT_PALETTES[settings.palette];
  const on = settings.enabled;
  const isUltra = settings.uiMotion === 'ultra';

  // Non-destructive optical overdrive in Ultra: boosts effective glow/raster floor without mutating saved slider values
  const scanT = on ? Math.max(settings.scanlines / 100, isUltra ? 0.58 : 0) : 0;
  const glowT = on ? Math.max(settings.gaussGlow / 100, isUltra ? 0.82 : 0) : 0;
  const vigT = on ? Math.max(settings.vignette / 100, isUltra ? 0.48 : 0) : 0;
  const grilleT = on ? Math.max(settings.apertureGrille / 100, isUltra ? 0.36 : 0) : 0;
  const rgbT = on ? Math.max(settings.chromaticAberration / 100, isUltra ? 0.28 : 0) : 0;

  const scanlineAlpha = scanT > 0 ? (0.08 + 0.67 * Math.pow(scanT, 1.45)).toFixed(3) : '0';
  const scanlineOpacity = scanT > 0 ? (0.15 + 0.85 * scanT).toFixed(3) : '0';

  const ambientAlpha = glowT > 0 ? (0.04 + 0.16 * Math.pow(glowT, 1.1)).toFixed(3) : '0.035';
  const glowRadiusSm = glowT > 0 ? `${(1 + glowT * 5).toFixed(1)}px` : '0px';
  const glowRadiusLg = glowT > 0 ? `${(4 + glowT * 18).toFixed(1)}px` : '0px';
  const glowAlphaSm = glowT > 0 ? (0.12 + glowT * 0.52).toFixed(3) : '0';
  const glowAlphaLg = glowT > 0 ? (0.06 + glowT * 0.32).toFixed(3) : '0';
  const glowBoxAlpha = glowT > 0 ? (0.03 + glowT * 0.17).toFixed(3) : '0';

  const vignetteMid = vigT > 0 ? (vigT * 0.22).toFixed(3) : '0';
  const vignetteEdge = vigT > 0 ? (0.14 + vigT * 0.72).toFixed(3) : '0';
  const vignetteInset = vigT > 0 ? (0.15 + vigT * 0.65).toFixed(3) : '0';

  const grilleAlpha = grilleT > 0 ? (0.03 + grilleT * 0.19).toFixed(3) : '0';
  const grilleOpacity = grilleT > 0 ? (0.25 + grilleT * 0.75).toFixed(3) : '0';

  const aberrationOffset = rgbT > 0 ? `${(0.3 + rgbT * 1.35).toFixed(2)}px` : '0px';
  const aberrationAlpha = rgbT > 0 ? (0.16 + rgbT * 0.56).toFixed(3) : '0';

  // Living UI Motion variables — coupled directly to Gauss Glow & Phosphor Palette
  const motionWeight = isUltra
    ? 1.88
    : settings.uiMotion === 'high'
      ? 1.28
      : settings.uiMotion === 'medium'
        ? 0.88
        : settings.uiMotion === 'low'
          ? 0.55
          : 0;
  const opticalGlowFactor = on ? 0.38 + 0.62 * glowT : isUltra ? 0.82 : 0.3;
  const bloom = motionWeight * opticalGlowFactor;

  const motionSpeedScale = isUltra
    ? '0.52'
    : settings.uiMotion === 'high'
      ? '0.74'
      : settings.uiMotion === 'medium'
        ? '1'
        : '1.28';
  const motionGlowSm = bloom > 0 ? `${(1.2 + bloom * 5.2).toFixed(2)}px` : '0px';
  const motionGlowLg = bloom > 0 ? `${(3.2 + bloom * 13.5).toFixed(2)}px` : '0px';
  const motionGlowAlpha = bloom > 0 ? Math.min(0.98, 0.2 + bloom * 0.62).toFixed(3) : '0';
  const motionTailAlpha = bloom > 0 ? Math.min(0.9, 0.14 + bloom * 0.46).toFixed(3) : '0';
  const motionTraceAlpha = bloom > 0 ? Math.min(0.96, 0.24 + bloom * 0.56).toFixed(3) : '0';
  const motionSweepAlpha = isUltra
    ? Math.min(0.72, 0.22 + bloom * 0.32).toFixed(3)
    : settings.uiMotion === 'high' || settings.uiMotion === 'medium'
      ? Math.min(0.5, 0.1 + bloom * 0.26).toFixed(3)
      : settings.uiMotion === 'low'
        ? Math.min(0.28, 0.06 + bloom * 0.16).toFixed(3)
        : '0';

  const isHigh = settings.uiMotion === 'high';
  const ultraHumAlpha = on
    ? isUltra
      ? (0.1 + glowT * 0.105).toFixed(3)
      : isHigh
        ? (0.042 + glowT * 0.048).toFixed(3)
        : '0'
    : '0';
  const ultraBorderAlpha = isUltra
    ? on
      ? (0.32 + glowT * 0.28).toFixed(3)
      : '0.30'
    : isHigh
      ? on
        ? (0.16 + glowT * 0.16).toFixed(3)
        : '0.16'
      : '0';

  return {
    '--crt-phosphor-rgb': paletteInfo.rgb,
    '--crt-ambient-alpha': ambientAlpha,
    '--crt-scanline-alpha': scanlineAlpha,
    '--crt-scanline-opacity': scanlineOpacity,
    '--crt-glow-radius-sm': glowRadiusSm,
    '--crt-glow-radius-lg': glowRadiusLg,
    '--crt-glow-alpha-sm': glowAlphaSm,
    '--crt-glow-alpha-lg': glowAlphaLg,
    '--crt-glow-box-alpha': glowBoxAlpha,
    '--crt-vignette-mid': vignetteMid,
    '--crt-vignette-edge': vignetteEdge,
    '--crt-vignette-inset': vignetteInset,
    '--crt-grille-alpha': grilleAlpha,
    '--crt-grille-opacity': grilleOpacity,
    '--crt-aberration-offset': aberrationOffset,
    '--crt-aberration-alpha': aberrationAlpha,
    '--crt-motion-speed': motionSpeedScale,
    '--crt-motion-glow-sm': motionGlowSm,
    '--crt-motion-glow-lg': motionGlowLg,
    '--crt-motion-glow-alpha': motionGlowAlpha,
    '--crt-motion-tail-alpha': motionTailAlpha,
    '--crt-motion-trace-alpha': motionTraceAlpha,
    '--crt-motion-sweep-alpha': motionSweepAlpha,
    '--crt-ultra-hum-alpha': ultraHumAlpha,
    '--crt-ultra-border-alpha': ultraBorderAlpha,
  } as CSSProperties;
}
