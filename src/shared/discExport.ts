export type M3uLayoutMode = 'subfolder' | 'inline';
export type ChdConversionMode = 'cd' | 'dvd';

export interface DiscExportConfig {
  chdConvertEnabled: boolean;
  chdEligibleSystems: string[];
  chdCacheMaxGb: number;
  m3uPlaylistEnabled: boolean;
  m3uLayout: M3uLayoutMode;
}

export interface ChdCacheStats {
  fileCount: number;
  totalBytes: number;
  maxBytes: number;
}

export interface RuntimeCapabilities {
  chdman: boolean;
  chdmanVersion: string | null;
  unrar: boolean;
  sevenZip: boolean;
  chdCache: ChdCacheStats;
}

export type ChdJobStatus = 'queued' | 'extracting' | 'converting' | 'done' | 'error' | 'canceled';

export interface ChdJobSnapshot {
  jobId: string;
  itemId: number;
  fileId: number;
  targetId: string;
  mode: ChdConversionMode;
  status: ChdJobStatus;
  percent: number | null;
  cached: boolean;
  outputBytes: number | null;
  filename: string;
  detail: string | null;
  error: string | null;
  updatedAt: string;
}

export interface DiscCapableSystemOption {
  slug: string;
  label: string;
  defaultEnabled: boolean;
  dvdCapable?: boolean;
}

export const DISC_CAPABLE_SYSTEM_OPTIONS: readonly DiscCapableSystemOption[] = [
  { slug: 'psx-iso', label: 'PlayStation (PS1)', defaultEnabled: true },
  { slug: 'sega-cd-iso', label: 'Sega CD / Mega-CD', defaultEnabled: true },
  { slug: 'saturn-iso', label: 'Sega Saturn', defaultEnabled: true },
  { slug: 'pce-cd-iso', label: 'PC Engine CD / TurboGrafx-CD', defaultEnabled: true },
  { slug: 'dreamcast-iso', label: 'Sega Dreamcast', defaultEnabled: true },
  { slug: 'ps2-iso', label: 'PlayStation 2 (PS2)', defaultEnabled: true, dvdCapable: true },
  { slug: 'neo-geo-cd', label: 'Neo Geo CD', defaultEnabled: false },
  { slug: '3do-iso', label: '3DO Interactive Multiplayer', defaultEnabled: false },
  { slug: 'amiga-cd32', label: 'Amiga CD32', defaultEnabled: false },
  { slug: 'pc-fx', label: 'NEC PC-FX', defaultEnabled: false },
  { slug: 'cd-i', label: 'Philips CD-i', defaultEnabled: false },
  { slug: 'jaguar-cd', label: 'Atari Jaguar CD', defaultEnabled: false },
  { slug: 'psp-iso', label: 'PlayStation Portable (PSP)', defaultEnabled: false, dvdCapable: true },
];

export const DEFAULT_CHD_ELIGIBLE_SYSTEMS: readonly string[] = DISC_CAPABLE_SYSTEM_OPTIONS
  .filter((opt) => opt.defaultEnabled)
  .map((opt) => opt.slug);

export const CHD_CACHE_PRESET_GB: readonly number[] = [0, 5, 10, 20, 50];

/**
 * Threshold above which a raw `.iso` is assumed to be a DVD image (`chdman createdvd`)
 * rather than a 700–800 MiB CD-ROM image (`chdman createcd`).
 */
export const DVD_ISO_SIZE_THRESHOLD_BYTES = 850 * 1024 * 1024;

const CHD_CONVERTIBLE_EXTENSIONS = new Set(['.cue', '.gdi', '.toc', '.iso']);

const DVD_FIRST_SYSTEMS = new Set(['ps2-iso', 'ps2', 'playstation-2', 'psp-iso', 'psp']);

const SYSTEM_ALIAS_MAP: Record<string, string> = {
  psx: 'psx-iso',
  ps1: 'psx-iso',
  'psx-iso': 'psx-iso',
  playstation: 'psx-iso',
  'sega-cd': 'sega-cd-iso',
  'sega-cd-iso': 'sega-cd-iso',
  segacd: 'sega-cd-iso',
  'mega-cd': 'sega-cd-iso',
  saturn: 'saturn-iso',
  'saturn-iso': 'saturn-iso',
  'sega-saturn': 'saturn-iso',
  'pce-cd': 'pce-cd-iso',
  'pce-cd-iso': 'pce-cd-iso',
  pcecd: 'pce-cd-iso',
  'turbografx-cd': 'pce-cd-iso',
  dreamcast: 'dreamcast-iso',
  'dreamcast-iso': 'dreamcast-iso',
  dc: 'dreamcast-iso',
  ps2: 'ps2-iso',
  'ps2-iso': 'ps2-iso',
  'playstation-2': 'ps2-iso',
  'neo-geo-cd': 'neo-geo-cd',
  neogeocd: 'neo-geo-cd',
  '3do': '3do-iso',
  '3do-iso': '3do-iso',
  'amiga-cd32': 'amiga-cd32',
  cd32: 'amiga-cd32',
  'pc-fx': 'pc-fx',
  pcfx: 'pc-fx',
  'cd-i': 'cd-i',
  cdi: 'cd-i',
  'jaguar-cd': 'jaguar-cd',
  psp: 'psp-iso',
  'psp-iso': 'psp-iso',
};

export function canonicalizeDiscSystemSlug(systemName: string): string {
  const normalized = String(systemName || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (!normalized) return '';
  return SYSTEM_ALIAS_MAP[normalized] || normalized;
}

export function createDefaultDiscExportConfig(): DiscExportConfig {
  return {
    chdConvertEnabled: false,
    chdEligibleSystems: [...DEFAULT_CHD_ELIGIBLE_SYSTEMS],
    chdCacheMaxGb: 0,
    m3uPlaylistEnabled: false,
    m3uLayout: 'subfolder',
  };
}

export function normalizeDiscExportConfig(raw: unknown): DiscExportConfig {
  const defaults = createDefaultDiscExportConfig();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const obj = raw as Partial<DiscExportConfig>;

  const chdConvertEnabled = Boolean(obj.chdConvertEnabled);
  const m3uPlaylistEnabled = Boolean(obj.m3uPlaylistEnabled);
  const m3uLayout: M3uLayoutMode = obj.m3uLayout === 'inline' ? 'inline' : 'subfolder';

  let chdCacheMaxGb = defaults.chdCacheMaxGb;
  if (typeof obj.chdCacheMaxGb === 'number' && Number.isFinite(obj.chdCacheMaxGb)) {
    chdCacheMaxGb = Math.max(0, Math.min(500, Math.round(obj.chdCacheMaxGb)));
  }

  let chdEligibleSystems = [...DEFAULT_CHD_ELIGIBLE_SYSTEMS];
  if (Array.isArray(obj.chdEligibleSystems)) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const item of obj.chdEligibleSystems) {
      const slug = canonicalizeDiscSystemSlug(String(item || ''));
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      cleaned.push(slug);
    }
    chdEligibleSystems = cleaned;
  }

  return {
    chdConvertEnabled,
    chdEligibleSystems,
    chdCacheMaxGb,
    m3uPlaylistEnabled,
    m3uLayout,
  };
}

export function canonicalDiscExportConfigJson(raw: unknown): string {
  const normalized = normalizeDiscExportConfig(raw);
  return JSON.stringify({
    chdConvertEnabled: normalized.chdConvertEnabled,
    chdEligibleSystems: [...normalized.chdEligibleSystems].sort(),
    chdCacheMaxGb: normalized.chdCacheMaxGb,
    m3uPlaylistEnabled: normalized.m3uPlaylistEnabled,
    m3uLayout: normalized.m3uLayout,
  });
}

export function isSystemEligibleForChd(
  systemName: string,
  config: DiscExportConfig | null | undefined,
): boolean {
  if (!config || !config.chdConvertEnabled) return false;
  const canonical = canonicalizeDiscSystemSlug(systemName);
  if (!canonical) return false;
  const allowed = new Set(config.chdEligibleSystems.map((s) => canonicalizeDiscSystemSlug(s)));
  return allowed.has(canonical);
}

export interface ChdTargetLike {
  kind: 'rom' | 'disc_set' | 'patch_only';
  extension: string;
  sizeBytes?: number;
  primaryEntry?: string;
}

export function isTargetConvertibleToChd(target: ChdTargetLike | null | undefined): boolean {
  if (!target || target.kind === 'patch_only') return false;
  const ext = String(target.extension || '').trim().toLowerCase();
  if (ext === '.chd') return false;
  if (target.kind === 'disc_set') {
    return ext === '.cue' || ext === '.gdi' || ext === '.toc' || !ext;
  }
  return CHD_CONVERTIBLE_EXTENSIONS.has(ext);
}

export function isDiscTargetEligibleForChd(
  systemName: string,
  target: ChdTargetLike | null | undefined,
  config: DiscExportConfig | null | undefined,
  chdmanAvailable = true,
): boolean {
  if (!chdmanAvailable) return false;
  if (!isSystemEligibleForChd(systemName, config)) return false;
  return isTargetConvertibleToChd(target);
}

export function resolveChdConversionMode(
  systemName: string,
  target: ChdTargetLike | null | undefined,
): ChdConversionMode {
  const ext = String(target?.extension || '').trim().toLowerCase();
  if (ext !== '.iso') {
    return 'cd';
  }
  const canonical = canonicalizeDiscSystemSlug(systemName);
  const sizeBytes = Number(target?.sizeBytes || 0);
  if (sizeBytes >= DVD_ISO_SIZE_THRESHOLD_BYTES) {
    return 'dvd';
  }
  if (DVD_FIRST_SYSTEMS.has(canonical)) {
    // PS2/PSP `.iso` files are predominantly DVD/UMD images; CD-sized PS2 games (< 750 MiB) use createcd
    return sizeBytes > 0 && sizeBytes < 740 * 1024 * 1024 ? 'cd' : 'dvd';
  }
  return 'cd';
}

export function replaceExtensionWithChd(filename: string): string {
  const trimmed = String(filename || '').trim();
  if (!trimmed) return 'disc.chd';
  if (/\.chd$/i.test(trimmed)) return trimmed;
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx > 0 && trimmed.length - dotIdx <= 6) {
    return `${trimmed.slice(0, dotIdx)}.chd`;
  }
  return `${trimmed}.chd`;
}
