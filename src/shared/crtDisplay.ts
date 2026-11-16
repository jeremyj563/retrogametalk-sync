import type { CSSProperties } from 'react';

export type CrtPalette = 'green' | 'amber' | 'cyan';
export type CrtPresetId = 'subtle' | 'pvm' | 'arcade';

export interface CrtFxValues {
  scanlines: number;
  gaussGlow: number;
  vignette: number;
  apertureGrille: number;
  chromaticAberration: number;
}

export interface CrtDisplaySettings extends CrtFxValues {
  enabled: boolean;
  panelOpen: boolean;
  palette: CrtPalette;
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
  { label: string; swatch: string; rgb: string }
> = {
  green: { label: 'Green', swatch: '#38e56b', rgb: '56, 229, 107' },
  amber: { label: 'Amber', swatch: '#ffb000', rgb: '255, 176, 0' },
  cyan: { label: 'Cyan', swatch: '#38d9f5', rgb: '56, 217, 245' },
};

export const DEFAULT_CRT_DISPLAY_SETTINGS: CrtDisplaySettings = {
  enabled: true,
  panelOpen: false,
  palette: 'green',
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
        panelOpen: typeof parsed.panelOpen === 'boolean' ? parsed.panelOpen : false,
        palette: isValidPalette(parsed.palette) ? parsed.palette : 'green',
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

  const scanT = on ? settings.scanlines / 100 : 0;
  const glowT = on ? settings.gaussGlow / 100 : 0;
  const vigT = on ? settings.vignette / 100 : 0;
  const grilleT = on ? settings.apertureGrille / 100 : 0;
  const rgbT = on ? settings.chromaticAberration / 100 : 0;

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
  } as CSSProperties;
}
