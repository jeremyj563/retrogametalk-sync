import path from 'node:path';
import {
  CRT_PRESETS,
  type CrtDisplaySettings,
  type CrtPalette,
  type CrtPresetId,
  type CrtUiMotionLevel,
} from '../../src/shared/crtDisplay.ts';

export interface CaptureOptions {
  /** Optional external base URL (e.g. http://localhost:3000). Null triggers ephemeral demo mode. */
  baseUrl: string | null;
  /** Output directory where generated WebP previews are written. */
  outDir: string;
  /** CRT optical preset applied across captured frames. */
  crtPreset: CrtPresetId;
  /** Living UI Motion level applied across captured frames. */
  uiMotion: CrtUiMotionLevel;
  /** When true, only capture the 4 static screenshots and skip the animated walkthrough WebP. */
  skipVideo: boolean;
  /** Print CLI usage and exit without capturing. */
  help: boolean;
}

export const SCREENSHOT_FILENAMES = {
  walkthrough: 'console-walkthrough.webp',
  syncOverview: 'sync-overview.webp',
  catalogGrid: 'catalog-grid.webp',
  gameDetailDrawer: 'game-detail-drawer.webp',
  sdCardExporter: 'sd-card-exporter.webp',
} as const;

export const DEFAULT_CAPTURE_OUT_DIR = path.resolve(
  process.cwd(),
  'docs',
  'assets',
  'screenshots',
);

const VALID_PRESETS: ReadonlySet<CrtPresetId> = new Set(['subtle', 'pvm', 'arcade', 'bvm']);
const VALID_MOTIONS: ReadonlySet<CrtUiMotionLevel> = new Set([
  'off',
  'low',
  'medium',
  'high',
  'ultra',
]);

function parseBooleanFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function normalizeCaptureBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Base URL cannot be empty.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid --url value "${trimmed}". Expected an http:// or https:// URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol "${parsed.protocol}". Expected http:// or https://.`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function parseCrtPreset(raw: string | undefined, fallback: CrtPresetId = 'pvm'): CrtPresetId {
  if (!raw || !raw.trim()) return fallback;
  const candidate = raw.trim().toLowerCase() as CrtPresetId;
  if (!VALID_PRESETS.has(candidate)) {
    throw new Error(
      `Invalid --preset value "${raw}". Expected one of: ${Array.from(VALID_PRESETS).join(', ')}.`,
    );
  }
  return candidate;
}

export function parseUiMotionLevel(
  raw: string | undefined,
  fallback: CrtUiMotionLevel = 'high',
): CrtUiMotionLevel {
  if (!raw || !raw.trim()) return fallback;
  const candidate = raw.trim().toLowerCase() as CrtUiMotionLevel;
  if (!VALID_MOTIONS.has(candidate)) {
    throw new Error(
      `Invalid --motion value "${raw}". Expected one of: ${Array.from(VALID_MOTIONS).join(', ')}.`,
    );
  }
  return candidate;
}

export function parseCaptureCliArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): CaptureOptions {
  let baseUrl: string | null = env.CAPTURE_BASE_URL?.trim()
    ? normalizeCaptureBaseUrl(env.CAPTURE_BASE_URL)
    : null;
  let outDir = env.CAPTURE_OUT_DIR?.trim()
    ? path.resolve(cwd, env.CAPTURE_OUT_DIR.trim())
    : path.resolve(cwd, 'docs', 'assets', 'screenshots');
  let crtPreset = parseCrtPreset(env.CAPTURE_CRT_PRESET, 'pvm');
  let uiMotion = parseUiMotionLevel(env.CAPTURE_UI_MOTION, 'high');
  let skipVideo = parseBooleanFlag(env.CAPTURE_SKIP_VIDEO);
  let help = false;

  const readNext = (index: number, flag: string): string => {
    const val = argv[index + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error(`Missing value for ${flag}.`);
    }
    return val;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--skip-video') {
      skipVideo = true;
      continue;
    }
    if (arg === '--url') {
      baseUrl = normalizeCaptureBaseUrl(readNext(i, '--url'));
      i += 1;
      continue;
    }
    if (arg.startsWith('--url=')) {
      baseUrl = normalizeCaptureBaseUrl(arg.slice('--url='.length));
      continue;
    }
    if (arg === '--out-dir') {
      outDir = path.resolve(cwd, readNext(i, '--out-dir'));
      i += 1;
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      outDir = path.resolve(cwd, arg.slice('--out-dir='.length));
      continue;
    }
    if (arg === '--preset') {
      crtPreset = parseCrtPreset(readNext(i, '--preset'));
      i += 1;
      continue;
    }
    if (arg.startsWith('--preset=')) {
      crtPreset = parseCrtPreset(arg.slice('--preset='.length));
      continue;
    }
    if (arg === '--motion') {
      uiMotion = parseUiMotionLevel(readNext(i, '--motion'));
      i += 1;
      continue;
    }
    if (arg.startsWith('--motion=')) {
      uiMotion = parseUiMotionLevel(arg.slice('--motion='.length));
      continue;
    }
    throw new Error(`Unknown option "${arg}". Run with --help for supported flags.`);
  }

  return {
    baseUrl,
    outDir,
    crtPreset,
    uiMotion,
    skipVideo,
    help,
  };
}

export function buildCaptureCrtSettings(
  palette: CrtPalette,
  preset: CrtPresetId,
  uiMotion: CrtUiMotionLevel,
): CrtDisplaySettings {
  return {
    enabled: true,
    palette,
    uiMotion,
    syncSpeedWave: uiMotion !== 'off',
    ...CRT_PRESETS[preset].values,
  };
}

export function formatCaptureUsage(): string {
  return [
    'RetroGameTalk Sync — Automated Playwright Visual Preview Capture',
    '',
    'Usage:',
    '  npm run capture:screenshots -- [options]',
    '',
    'Options:',
    '  --url <base-url>                 Capture an already-running instance (env: CAPTURE_BASE_URL)',
    '  --out-dir <path>                 Output directory for WebP assets (default: docs/assets/screenshots)',
    '  --preset <subtle|pvm|arcade|bvm> CRT optical preset (default: pvm)',
    '  --motion <off|low|medium|high|ultra> Living UI Motion level (default: high)',
    '  --skip-video                     Only capture the 4 static screenshots (skip hero walkthrough WebP)',
    '  -h, --help                       Show this help message',
    '',
    'Examples:',
    '  # Ephemeral demo library (zero setup, safe for public READMEs & CI):',
    '  npm run capture:screenshots',
    '',
    '  # Capture your running local homelab instance:',
    '  npm run capture:screenshots -- --url http://localhost:3000 --preset pvm --motion high',
  ].join('\n');
}
