import type { CSSProperties } from 'react';

export type CrtPalette = 'green' | 'amber' | 'cyan';
export type CrtPresetId = 'subtle' | 'pvm' | 'arcade';
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
};

export const CRT_PALETTES: Record<
  CrtPalette,
  { label: string; swatch: string; swatchClass: string; rgb: string }
> = {
  green: { label: 'Green', swatch: '#38e56b', swatchClass: 'bg-[#38e56b]', rgb: '56, 229, 107' },
  amber: { label: 'Amber', swatch: '#ffb000', swatchClass: 'bg-[#ffb000]', rgb: '255, 176, 0' },
  cyan: { label: 'Cyan', swatch: '#38d9f5', swatchClass: 'bg-[#38d9f5]', rgb: '56, 217, 245' },
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
    description: 'Subtle ambient motion on active indicators plus responsive hover & sync animations',
  },
  medium: {
    shortLabel: 'Med',
    label: 'Medium',
    description: 'Balanced living CRT console with KPI breathing, chart sweep, and active panel traces',
  },
  high: {
    shortLabel: 'High',
    label: 'High',
    description: 'Full hardware instrumentation with continuous staggered icon kinematics and vivid phosphor bloom',
  },
  ultra: {
    shortLabel: 'Ultra',
    label: 'Ultra',
    description:
      'Overclocked cathode-ray spectacle: rolling V-sync hum bar, auto-boosted phosphor bloom, dual panel beams & full-app halos',
  },
};

export const DEFAULT_CRT_DISPLAY_SETTINGS: CrtDisplaySettings = {
  enabled: true,
  palette: 'green',
  uiMotion: 'low',
  ...CRT_PRESETS.subtle.values,
};

export function clampCrtPct(val: unknown, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function isValidPalette(val: unknown): val is CrtPalette {
  return val === 'green' || val === 'amber' || val === 'cyan';
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

export function loadInitialCrtDisplaySettings(): CrtDisplaySettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CRT_DISPLAY_SETTINGS };
    }
    const raw = window.localStorage.getItem(CRT_DISPLAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CrtDisplaySettings>;
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
        palette: isValidPalette(parsed.palette) ? parsed.palette : 'green',
        uiMotion: isValidUiMotionLevel(parsed.uiMotion)
          ? parsed.uiMotion
          : DEFAULT_CRT_DISPLAY_SETTINGS.uiMotion,
        scanlines: clampCrtPct(parsed.scanlines, DEFAULT_CRT_DISPLAY_SETTINGS.scanlines),
        gaussGlow: clampCrtPct(parsed.gaussGlow, DEFAULT_CRT_DISPLAY_SETTINGS.gaussGlow),
        vignette: clampCrtPct(parsed.vignette, DEFAULT_CRT_DISPLAY_SETTINGS.vignette),
        apertureGrille: clampCrtPct(parsed.apertureGrille, DEFAULT_CRT_DISPLAY_SETTINGS.apertureGrille),
        chromaticAberration: clampCrtPct(
          parsed.chromaticAberration,
          DEFAULT_CRT_DISPLAY_SETTINGS.chromaticAberration,
        ),
      };
    }

    // Migrate previous single-slider scanlines preference if present
    const legacyRaw = window.localStorage.getItem(LEGACY_SCANLINES_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { enabled?: boolean; intensity?: number };
      const scanlines = clampCrtPct(legacy.intensity, DEFAULT_CRT_DISPLAY_SETTINGS.scanlines);
      const enabled = typeof legacy.enabled === 'boolean' ? legacy.enabled : scanlines > 0;
      return {
        ...DEFAULT_CRT_DISPLAY_SETTINGS,
        enabled,
        scanlines,
      };
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
  for (const id of ['subtle', 'pvm', 'arcade'] as const) {
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

  const ultraHumAlpha = isUltra && on ? (0.085 + glowT * 0.095).toFixed(3) : '0';
  const ultraBorderAlpha = isUltra ? (on ? (0.28 + glowT * 0.26).toFixed(3) : '0.28') : '0';

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
