import {
  classifyFileRoleToTypeKeys,
  classifyReleaseTagsToTypeKeys,
  isTranslationTypeKey,
} from './releaseTypeFilter.ts';
import {
  canonicalizeSystemSlug,
  isNonSystemSlug,
  resolveSystemDisplayInfo,
} from './systemCatalog.ts';

export type StorageRomCategoryKey =
  | 'retail'
  | 'translations'
  | 'hack'
  | 'homebrew'
  | 'port'
  | 'undub'
  | 'demo_proto'
  | 'bootleg'
  | 'bios'
  | 'dlc'
  | 'psx2psp';

export type SystemTypeSubfolderMode = 'inherit' | 'enabled' | 'disabled';

export interface SystemTypeFolderOverride {
  mode?: SystemTypeSubfolderMode;
  subfolders?: Partial<Record<StorageRomCategoryKey, string>>;
}

export type FolderCasingStyle = 'lower' | 'upper' | 'title';

export type ConsoleLeafCasingStyle = 'lower' | 'upper' | 'default';

export interface StorageFolderMappingConfig {
  typeSubfoldersEnabled: boolean;
  globalTypeSubfolders: Record<StorageRomCategoryKey, string>;
  systemFolders: Record<string, string>;
  systemTypeOverrides: Record<string, SystemTypeFolderOverride>;
  /** Session-only base ROM root inferred from the mounted device (never persisted). */
  runtimeBaseRomRoot?: string;
  /** Session-only console leaf casing inferred from the mounted device (never persisted). */
  runtimeConsoleCasing?: ConsoleLeafCasingStyle;
}

export interface StorageRomCategoryMeta {
  id: StorageRomCategoryKey;
  label: string;
  shortLabel: string;
  defaultSubfolder: string;
  description: string;
}

export const STORAGE_ROM_CATEGORIES: readonly StorageRomCategoryMeta[] = [
  {
    id: 'retail',
    label: 'Retail ROM',
    shortLabel: 'Retail',
    defaultSubfolder: '',
    description: 'Official commercial releases (stays in base console folder when blank)',
  },
  {
    id: 'translations',
    label: 'Translations',
    shortLabel: 'Translations',
    defaultSubfolder: 'Translations',
    description: 'All fan-translated and localized patch releases grouped together',
  },
  {
    id: 'hack',
    label: 'ROM Hacks',
    shortLabel: 'Hacks',
    defaultSubfolder: 'Hacks',
    description: 'Gameplay mods, Redux, MSU-1, randomizers, and colorizations',
  },
  {
    id: 'homebrew',
    label: 'Homebrew & Indie',
    shortLabel: 'Homebrew',
    defaultSubfolder: 'Homebrew',
    description: 'Community-developed games, Indie, and Doujin releases',
  },
  {
    id: 'port',
    label: 'Ports',
    shortLabel: 'Ports',
    defaultSubfolder: 'Ports',
    description: 'Cross-platform ports and decompilation conversions',
  },
  {
    id: 'undub',
    label: 'Undubs',
    shortLabel: 'Undubs',
    defaultSubfolder: 'Undubs',
    description: 'Original voice audio restored in localized releases',
  },
  {
    id: 'demo_proto',
    label: 'Demos & Prototypes',
    shortLabel: 'Prototypes',
    defaultSubfolder: 'Prototypes',
    description: 'Unreleased prototypes, betas, samples, and kiosk demos',
  },
  {
    id: 'bootleg',
    label: 'Bootleg & Unlicensed',
    shortLabel: 'Unlicensed',
    defaultSubfolder: 'Unlicensed',
    description: 'Unlicensed originals, pirate conversions, and multicarts',
  },
  {
    id: 'bios',
    label: 'BIOS & System',
    shortLabel: 'BIOS',
    defaultSubfolder: 'BIOS',
    description: 'Console firmware, boot ROMs, and system add-on files',
  },
  {
    id: 'dlc',
    label: 'DLC & Updates',
    shortLabel: 'DLC',
    defaultSubfolder: 'DLC',
    description: 'Downloadable add-on content and title updates',
  },
  {
    id: 'psx2psp',
    label: 'PSX2PSP & Eboot',
    shortLabel: 'PSX2PSP',
    defaultSubfolder: 'PSX2PSP',
    description: 'PSP-converted PS1 EBOOT and PSN packages',
  },
];

export const STORAGE_ROM_CATEGORY_KEYS: readonly StorageRomCategoryKey[] =
  STORAGE_ROM_CATEGORIES.map((c) => c.id);

const VALID_CATEGORY_SET = new Set<string>(STORAGE_ROM_CATEGORY_KEYS);

export const DEFAULT_ROM_TYPE_SUBFOLDERS: Record<StorageRomCategoryKey, string> = {
  retail: '',
  translations: 'Translations',
  hack: 'Hacks',
  homebrew: 'Homebrew',
  port: 'Ports',
  undub: 'Undubs',
  demo_proto: 'Prototypes',
  bootleg: 'Unlicensed',
  bios: 'BIOS',
  dlc: 'DLC',
  psx2psp: 'PSX2PSP',
};

const CATEGORY_LABEL_BY_ID = new Map<StorageRomCategoryKey, string>(
  STORAGE_ROM_CATEGORIES.map((c) => [c.id, c.shortLabel] as const),
);

export function getStorageRomCategoryShortLabel(category: StorageRomCategoryKey): string {
  return CATEGORY_LABEL_BY_ID.get(category) || category;
}

/**
 * Sensible universal console folder defaults relative to the storage device root.
 * Works out of the box across flash carts, handhelds, desktop emulators, and external drives.
 */
export const UNIVERSAL_SYSTEM_FOLDER_DEFAULTS: Readonly<Record<string, string>> = {
  // Nintendo
  'nes-roms': 'NES',
  nes: 'NES',
  'fds-roms': 'FDS',
  famicom_disk_system: 'FDS',
  'famicom-disk-system': 'FDS',
  'snes-roms': 'SNES',
  'snes-rom': 'SNES',
  snes: 'SNES',
  satellaview: 'BSX',
  'bs-x': 'BSX',
  'n64-roms': 'N64',
  n64: 'N64',
  '64dd': '64DD',
  gamecube: 'GAMECUBE',
  'gamecube-iso': 'GAMECUBE',
  'gcn-iso': 'GAMECUBE',
  gcn_iso: 'GAMECUBE',
  'wii-iso': 'WII',
  'wii-roms': 'WII',
  wii: 'WII',
  wiiware: 'WIIWARE',
  'wii-u': 'WIIU',
  wiiu: 'WIIU',
  switch: 'SWITCH',
  'switch-roms': 'SWITCH',
  'nintendo-switch': 'SWITCH',
  'gb-roms': 'GB',
  'gameboy-roms': 'GB',
  gb_roms: 'GB',
  'gbc-roms': 'GBC',
  'gameboy-color-roms': 'GBC',
  gbc_roms: 'GBC',
  'gba-roms': 'GBA',
  gba: 'GBA',
  'virtual-boy': 'VB',
  'vb-roms': 'VB',
  'nds-roms': 'NDS',
  nds: 'NDS',
  'nintendo-ds': 'NDS',
  'dsi-roms': 'DSI',
  dsiware: 'DSI',
  '3ds-roms': '3DS',
  '3ds': '3DS',
  'nintendo-3ds': '3DS',
  'pokemon-mini': 'POKEMINI',

  // Sony
  'psx-iso': 'PSX',
  'ps1-iso': 'PSX',
  psx: 'PSX',
  ps1: 'PSX',
  playstation: 'PSX',
  'psx2psp-eboots': 'PSX2PSP',
  psx2psp: 'PSX2PSP',
  'psn-eboot': 'PSX2PSP',
  'ps2-iso': 'PS2',
  ps2: 'PS2',
  'playstation-2': 'PS2',
  'ps3-iso': 'PS3',
  ps3: 'PS3',
  'playstation-3': 'PS3',
  'psp-iso': 'PSP',
  'psp-roms': 'PSP',
  psp: 'PSP',
  'ps-vita': 'PSVITA',
  psvita: 'PSVITA',
  vita: 'PSVITA',

  // Sega
  'sg-1000': 'SG1000',
  sg1000: 'SG1000',
  'sms-roms': 'SMS',
  sms_roms: 'SMS',
  'master-system': 'SMS',
  'sega-master-system': 'SMS',
  'gg-roms': 'GG',
  'game-gear': 'GG',
  gamegear: 'GG',
  'genesis-roms': 'GENESIS',
  'megadrive-roms': 'GENESIS',
  sega_genesis_roms: 'GENESIS',
  'sega-genesis': 'GENESIS',
  megadrive: 'GENESIS',
  'sega-cd-iso': 'SEGACD',
  sega_cd_isos: 'SEGACD',
  'sega-cd': 'SEGACD',
  'mega-cd': 'SEGACD',
  '32x-roms': '32X',
  sega_32x_roms: '32X',
  'sega-32x': '32X',
  '32x': '32X',
  'saturn-iso': 'SATURN',
  sega_saturn_isos: 'SATURN',
  saturn: 'SATURN',
  'sega-saturn': 'SATURN',
  'dreamcast-iso': 'DREAMCAST',
  'dc-iso': 'DREAMCAST',
  dreamcast: 'DREAMCAST',
  'sega-dreamcast': 'DREAMCAST',
  'sega-pico': 'PICO',
  pico: 'PICO',

  // NEC & SNK
  'pc-engine-roms': 'PCE',
  'turbografx-16': 'PCE',
  'turbografx-16-roms': 'PCE',
  'pce-roms': 'PCE',
  'pc-engine': 'PCE',
  'pce-cd-iso': 'PCECD',
  'turbografx-cd': 'PCECD',
  'pc-engine-cd': 'PCECD',
  supergrafx: 'SUPERGRAFX',
  'pc-engine-supergrafx': 'SUPERGRAFX',
  'pc-fx': 'PCFX',
  pcfx: 'PCFX',
  'neogeo-roms': 'NEOGEO',
  'neo-geo': 'NEOGEO',
  neogeo: 'NEOGEO',
  'neo-geo-cd': 'NEOCD',
  neogeocd: 'NEOCD',
  'ngp-roms': 'NGP',
  'neo-geo-pocket': 'NGP',
  'ngpc-roms': 'NGPC',
  'neo-geo-pocket-color': 'NGPC',

  // Other Consoles & Handhelds
  'atari-2600-roms': 'ATARI2600',
  'atari-2600': 'ATARI2600',
  'atari-5200-roms': 'ATARI5200',
  'atari-5200': 'ATARI5200',
  'atari-7800-roms': 'ATARI7800',
  'atari-7800': 'ATARI7800',
  'atari-lynx': 'LYNX',
  'lynx-roms': 'LYNX',
  lynx: 'LYNX',
  'atari-jaguar': 'JAGUAR',
  'jaguar-roms': 'JAGUAR',
  jaguar: 'JAGUAR',
  'jaguar-cd': 'JAGUARCD',
  xbox: 'XBOX',
  'xbox-iso': 'XBOX',
  'og-xbox': 'XBOX',
  'xbox-360': 'XBOX360',
  xbox360: 'XBOX360',
  '3do-iso': '3DO',
  '3do': '3DO',
  colecovision: 'COLECO',
  intellivision: 'INTELLIVISION',
  vectrex: 'VECTREX',
  'odyssey-2': 'ODYSSEY2',
  odyssey2: 'ODYSSEY2',
  'cd-i': 'CDI',
  cdi: 'CDI',
  'philips-cdi': 'CDI',
  'ws-roms': 'WS',
  wonderswan: 'WS',
  'wonderswan-color': 'WSC',
  'fairchild-channel-f': 'CHANNELF',
  'channel-f': 'CHANNELF',
  'watara-supervision': 'SUPERVISION',
  supervision: 'SUPERVISION',
  'n-gage': 'NGAGE',
  ngage: 'NGAGE',

  // Arcade & Home Computers
  'arcade-roms': 'ARCADE',
  arcade: 'ARCADE',
  mame: 'MAME',
  fbneo: 'FBNEO',
  cps1: 'CPS1',
  cps2: 'CPS2',
  cps3: 'CPS3',
  naomi: 'NAOMI',
  atomiswave: 'ATOMISWAVE',
  'amiga-roms': 'AMIGA',
  amiga: 'AMIGA',
  'amiga-cd32': 'CD32',
  cd32: 'CD32',
  'c64-roms': 'C64',
  c64: 'C64',
  'commodore-64': 'C64',
  'msx-roms': 'MSX',
  msx: 'MSX',
  msx2: 'MSX2',
  'zx-spectrum': 'ZXSPECTRUM',
  'amstrad-cpc': 'CPC',
  'atari-st': 'ATARIST',
  dos: 'DOS',
  'ms-dos': 'DOS',
  msdos: 'DOS',
  windows: 'WINDOWS',
  scummvm: 'SCUMMVM',
  x68000: 'X68000',
  'sharp-x68000': 'X68000',
  'fm-towns': 'FMTOWNS',
  'pc-88': 'PC88',
  'pc-98': 'PC98',
  'apple-ii': 'APPLE2',

  // System & Other
  'bios-files': 'BIOS',
  bios: 'BIOS',
  soundtracks: 'OST',
};

/**
 * Representative canonical slugs for every known console platform (1 slug per console).
 * Used when browsing "All Consoles" in Operations even before full repository discovery.
 */
export const CANONICAL_KNOWN_SYSTEM_SLUGS: readonly string[] = [
  // Nintendo
  'nes-roms',
  'fds-roms',
  'snes-rom',
  'satellaview',
  'n64-roms',
  '64dd',
  'gamecube',
  'wii-iso',
  'wiiware',
  'wii-u',
  'switch-roms',
  'gameboy-roms',
  'gameboy-color-roms',
  'gba-roms',
  'virtual-boy',
  'nds-roms',
  'dsi-roms',
  '3ds-roms',
  'pokemon-mini',
  // Sony
  'psx-iso',
  'psx2psp-eboots',
  'ps2-iso',
  'ps3-iso',
  'psp-iso',
  'ps-vita',
  // Sega
  'sg-1000',
  'sms-roms',
  'gg-roms',
  'genesis-roms',
  'sega-cd-iso',
  '32x-roms',
  'saturn-iso',
  'dreamcast-iso',
  'sega-pico',
  // NEC & SNK
  'pc-engine-roms',
  'pce-cd-iso',
  'supergrafx',
  'pc-fx',
  'neogeo-roms',
  'neo-geo-cd',
  'ngp-roms',
  'ngpc-roms',
  // Other Consoles & Handhelds
  'atari-2600-roms',
  'atari-5200-roms',
  'atari-7800-roms',
  'atari-lynx',
  'atari-jaguar',
  'jaguar-cd',
  'xbox-iso',
  'xbox-360',
  '3do-iso',
  'colecovision',
  'intellivision',
  'vectrex',
  'odyssey-2',
  'cd-i',
  'ws-roms',
  'wonderswan-color',
  'fairchild-channel-f',
  'watara-supervision',
  'n-gage',
  // Arcade & Home Computers
  'arcade-roms',
  'mame',
  'fbneo',
  'cps1',
  'cps2',
  'cps3',
  'naomi',
  'atomiswave',
  'amiga',
  'amiga-cd32',
  'c64-roms',
  'msx-roms',
  'msx2',
  'zx-spectrum',
  'amstrad-cpc',
  'atari-st',
  'dos',
  'scummvm',
  'x68000',
  'fm-towns',
  'pc-88',
  'pc-98',
  'apple-ii',
  // System & Other
  'bios-files',
  'soundtracks',
];

/**
 * Normalizes a relative folder path for safe storage device directory creation.
 * Strips backslashes, leading/trailing slashes, empty segments, and `..` traversal segments.
 */
export function sanitizeRelativeStoragePath(raw: string): string {
  if (typeof raw !== 'string') return '';
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((part) =>
      part
        .trim()
        .replace(/[:*?"<>|]/g, '_')
        .replace(/\.+$/g, '')
        .trim(),
    )
    .filter((part) => part.length > 0 && part !== '.' && part !== '..');
  return segments.join('/');
}

export function createDefaultStorageFolderConfig(): StorageFolderMappingConfig {
  return {
    typeSubfoldersEnabled: false,
    globalTypeSubfolders: { ...DEFAULT_ROM_TYPE_SUBFOLDERS },
    systemFolders: {},
    systemTypeOverrides: {},
  };
}

export function applyFolderCasingStyle(name: string, style: FolderCasingStyle): string {
  const clean = sanitizeRelativeStoragePath(name);
  if (!clean) return '';
  if (style === 'lower') return clean.toLowerCase();
  if (style === 'upper') return clean.toUpperCase();
  return clean;
}

function isStandaloneNonRomSystem(systemName: string): boolean {
  const clean = systemName.trim().toLowerCase();
  return clean === 'bios-files' || clean === 'bios' || clean === 'soundtracks';
}

export function resolveDefaultSystemFolder(systemName: string): string {
  const clean = systemName.trim().toLowerCase();
  if (!clean) return 'ROMS';

  const hyphen = clean.replace(/_/g, '-');
  const underscore = clean.replace(/-/g, '_');

  const known =
    UNIVERSAL_SYSTEM_FOLDER_DEFAULTS[clean] ||
    UNIVERSAL_SYSTEM_FOLDER_DEFAULTS[hyphen] ||
    UNIVERSAL_SYSTEM_FOLDER_DEFAULTS[underscore];
  if (known) return known;

  const fallback = clean
    .replace(/[-_]+(?:roms?|isos?|games|files|eboots?)$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toUpperCase();
  return fallback || 'ROMS';
}

/**
 * Normalizes untrusted or partial JSON into a clean, canonical StorageFolderMappingConfig.
 */
export function normalizeStorageFolderConfig(raw: unknown): StorageFolderMappingConfig {
  const base = createDefaultStorageFolderConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }

  const obj = raw as Record<string, unknown>;
  base.typeSubfoldersEnabled = Boolean(obj.typeSubfoldersEnabled);

  if (obj.globalTypeSubfolders && typeof obj.globalTypeSubfolders === 'object' && !Array.isArray(obj.globalTypeSubfolders)) {
    const rawGlobal = obj.globalTypeSubfolders as Record<string, unknown>;
    for (const key of STORAGE_ROM_CATEGORY_KEYS) {
      if (typeof rawGlobal[key] === 'string') {
        base.globalTypeSubfolders[key] = sanitizeRelativeStoragePath(rawGlobal[key]);
      }
    }
  }

  if (obj.systemFolders && typeof obj.systemFolders === 'object' && !Array.isArray(obj.systemFolders)) {
    const rawSystems = obj.systemFolders as Record<string, unknown>;
    // Process canonical keys before alias keys so an explicit canonical entry is never overwritten by a stale alias
    const sortedKeys = Object.keys(rawSystems).sort((a, b) => {
      const aNorm = a.trim().toLowerCase();
      const bNorm = b.trim().toLowerCase();
      const aIsCanonical = canonicalizeSystemSlug(aNorm).toLowerCase() === aNorm ? 0 : 1;
      const bIsCanonical = canonicalizeSystemSlug(bNorm).toLowerCase() === bNorm ? 0 : 1;
      if (aIsCanonical !== bIsCanonical) return aIsCanonical - bIsCanonical;
      return a.localeCompare(b);
    });
    for (const rawSlug of sortedKeys) {
      const canonical = canonicalizeSystemSlug(rawSlug).toLowerCase();
      if (!canonical || isNonSystemSlug(canonical)) continue;
      if (base.systemFolders[canonical] !== undefined) continue;
      const val = typeof rawSystems[rawSlug] === 'string' ? sanitizeRelativeStoragePath(rawSystems[rawSlug]) : '';
      if (!val) continue;
      // Only persist non-default overrides so config stays minimal and clean
      if (val !== resolveDefaultSystemFolder(canonical)) {
        base.systemFolders[canonical] = val;
      }
    }
  }

  if (
    obj.systemTypeOverrides &&
    typeof obj.systemTypeOverrides === 'object' &&
    !Array.isArray(obj.systemTypeOverrides)
  ) {
    const rawOverrides = obj.systemTypeOverrides as Record<string, unknown>;
    const sortedSlugs = Object.keys(rawOverrides).sort((a, b) => {
      const aNorm = a.trim().toLowerCase();
      const bNorm = b.trim().toLowerCase();
      const aIsCanonical = canonicalizeSystemSlug(aNorm).toLowerCase() === aNorm ? 0 : 1;
      const bIsCanonical = canonicalizeSystemSlug(bNorm).toLowerCase() === bNorm ? 0 : 1;
      if (aIsCanonical !== bIsCanonical) return aIsCanonical - bIsCanonical;
      return a.localeCompare(b);
    });
    for (const rawSlug of sortedSlugs) {
      const canonical = canonicalizeSystemSlug(rawSlug).toLowerCase();
      if (!canonical || isNonSystemSlug(canonical)) continue;
      const entry = rawOverrides[rawSlug];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

      const rec = entry as Record<string, unknown>;
      const rawMode = rec.mode;
      const mode: SystemTypeSubfolderMode =
        rawMode === 'enabled' || rawMode === 'disabled' ? rawMode : 'inherit';

      const existing = base.systemTypeOverrides[canonical];
      const mergedMode: SystemTypeSubfolderMode =
        existing?.mode && existing.mode !== 'inherit' ? existing.mode : mode;

      const cleanSubfolders: Partial<Record<StorageRomCategoryKey, string>> = {
        ...(existing?.subfolders ?? {}),
      };
      if (rec.subfolders && typeof rec.subfolders === 'object' && !Array.isArray(rec.subfolders)) {
        const subObj = rec.subfolders as Record<string, unknown>;
        for (const key of STORAGE_ROM_CATEGORY_KEYS) {
          if (cleanSubfolders[key] !== undefined) continue;
          if (typeof subObj[key] === 'string') {
            const cleaned = sanitizeRelativeStoragePath(subObj[key]);
            // Keep explicit per-system override whenever it differs from global setting for that category
            if (cleaned !== base.globalTypeSubfolders[key]) {
              cleanSubfolders[key] = cleaned;
            }
          }
        }
      }

      const hasSubfolders = Object.keys(cleanSubfolders).length > 0;
      if (mergedMode !== 'inherit' || hasSubfolders) {
        base.systemTypeOverrides[canonical] = {
          ...(mergedMode !== 'inherit' ? { mode: mergedMode } : {}),
          ...(hasSubfolders ? { subfolders: cleanSubfolders } : {}),
        };
      }
    }
  }

  return base;
}

export function canonicalStorageFolderConfigJson(raw: unknown): string {
  return JSON.stringify(normalizeStorageFolderConfig(raw));
}

/**
 * Finds a matching slug entry in a sparse slug-keyed map, supporting exact slug,
 * hyphen/underscore variants, and sibling aliases sharing the same console display name.
 */
function lookupBySystemSlugOrAlias<T>(
  systemName: string,
  map: Record<string, T> | undefined,
): T | undefined {
  if (!map) return undefined;
  const keys = Object.keys(map);
  if (keys.length === 0) return undefined;

  const lower = systemName.trim().toLowerCase();
  if (!lower) return undefined;
  if (map[lower] !== undefined) return map[lower];

  const hyphen = lower.replace(/_/g, '-');
  if (map[hyphen] !== undefined) return map[hyphen];

  const underscore = lower.replace(/-/g, '_');
  if (map[underscore] !== undefined) return map[underscore];

  const targetDisplayName = resolveSystemDisplayInfo(lower).displayName;
  for (const k of keys) {
    if (resolveSystemDisplayInfo(k).displayName === targetDisplayName) {
      return map[k];
    }
  }
  return undefined;
}

export function resolveBaseSystemFolder(
  systemName: string,
  config?: StorageFolderMappingConfig | null,
): string {
  const custom = lookupBySystemSlugOrAlias(systemName, config?.systemFolders);
  if (custom) {
    const cleaned = sanitizeRelativeStoragePath(custom);
    if (cleaned) return cleaned;
  }

  const defaultLeaf = resolveDefaultSystemFolder(systemName);
  const runtimeRoot = config?.runtimeBaseRomRoot
    ? sanitizeRelativeStoragePath(config.runtimeBaseRomRoot)
    : '';
  if (runtimeRoot && !isStandaloneNonRomSystem(systemName)) {
    const casedLeaf =
      config?.runtimeConsoleCasing === 'lower'
        ? defaultLeaf.toLowerCase()
        : config?.runtimeConsoleCasing === 'upper'
          ? defaultLeaf.toUpperCase()
          : defaultLeaf;
    const combined = sanitizeRelativeStoragePath(`${runtimeRoot}/${casedLeaf}`);
    if (combined) return combined;
  }

  return defaultLeaf;
}

export function isTypeSubfoldersActiveForSystem(
  systemName: string,
  config?: StorageFolderMappingConfig | null,
): boolean {
  if (!config) return false;
  const override = lookupBySystemSlugOrAlias(systemName, config.systemTypeOverrides);
  if (override?.mode === 'enabled') return true;
  if (override?.mode === 'disabled') return false;
  return Boolean(config.typeSubfoldersEnabled);
}

export function resolveRomCategorySubfolder(
  systemName: string,
  category: StorageRomCategoryKey,
  config?: StorageFolderMappingConfig | null,
): string {
  if (!config || !isTypeSubfoldersActiveForSystem(systemName, config)) {
    return '';
  }
  const override = lookupBySystemSlugOrAlias(systemName, config.systemTypeOverrides);
  if (override?.subfolders && override.subfolders[category] !== undefined) {
    return sanitizeRelativeStoragePath(override.subfolders[category] || '');
  }
  const globalVal = config.globalTypeSubfolders?.[category];
  if (typeof globalVal === 'string') {
    return sanitizeRelativeStoragePath(globalVal);
  }
  return DEFAULT_ROM_TYPE_SUBFOLDERS[category] || '';
}

const CATEGORY_SPECIFICITY_ORDER: readonly StorageRomCategoryKey[] = [
  'psx2psp',
  'bios',
  'dlc',
  'hack',
  'translations',
  'undub',
  'port',
  'homebrew',
  'demo_proto',
  'bootleg',
  'retail',
];

function mapTypeKeyToStorageCategory(typeKey: string): StorageRomCategoryKey {
  if (isTranslationTypeKey(typeKey)) return 'translations';
  if (VALID_CATEGORY_SET.has(typeKey)) {
    return typeKey as StorageRomCategoryKey;
  }
  return 'retail';
}

export interface RomCategoryClassificationInput {
  systemName?: string | null;
  releaseTags?: string[];
  fileRole?: string | null;
  fileDisplayLabel?: string | null;
  targetRoleBadge?: string | null;
  targetDisplayName?: string | null;
  preferredFilterTypeKeys?: string[];
}

/**
 * Classifies a specific playable target or release file into its canonical StorageRomCategoryKey.
 */
export function classifyStorageRomCategory(
  input: RomCategoryClassificationInput,
): StorageRomCategoryKey {
  const systemLower = (input.systemName || '').trim().toLowerCase();
  if (systemLower === 'bios-files' || systemLower === 'bios') {
    return 'bios';
  }
  if (systemLower === 'psx2psp-eboots' || systemLower === 'psx2psp') {
    return 'psx2psp';
  }

  const roleLower = (input.fileRole || '').trim().toLowerCase();
  const badgeLower = (input.targetRoleBadge || '').trim().toLowerCase();
  const targetName = (input.targetDisplayName || '').trim();

  // Explicit unmodified / original ROM variant bundled inside a release
  if (
    roleLower === 'original rom' ||
    badgeLower === 'original' ||
    badgeLower === 'retail' ||
    /\b(?:original\s+rom|unmodified|vanilla|clean\s+rom)\b/i.test(targetName)
  ) {
    return 'retail';
  }

  const candidateCategories = new Set<StorageRomCategoryKey>();

  // 1. Target-level roleBadge / filename hints take top priority for multi-ROM archives
  if (badgeLower) {
    if (badgeLower.includes('hack')) candidateCategories.add('hack');
    else if (badgeLower.includes('undub')) candidateCategories.add('undub');
    else if (badgeLower.includes('port')) candidateCategories.add('port');
    else if (badgeLower.includes('homebrew') || badgeLower.includes('indie'))
      candidateCategories.add('homebrew');
    else if (badgeLower.includes('proto') || badgeLower.includes('demo') || badgeLower.includes('beta'))
      candidateCategories.add('demo_proto');
    else if (badgeLower.includes('bootleg') || badgeLower.includes('unlicensed'))
      candidateCategories.add('bootleg');
    else if (badgeLower.includes('dlc')) candidateCategories.add('dlc');
    else if (badgeLower.includes('psx2psp') || badgeLower.includes('eboot'))
      candidateCategories.add('psx2psp');
    else if (
      badgeLower.includes('translat') ||
      /^(?:english|spanish|french|portuguese|german|italian|russian|chinese|korean|polish|arabic|catalan|en|es|fr|pt|de|it|ru|zh|ko)$/i.test(
        badgeLower,
      )
    ) {
      candidateCategories.add('translations');
    }
  }

  // 2. File-level role + release-level tags
  if (candidateCategories.size === 0) {
    const fileKeys = input.fileRole
      ? classifyFileRoleToTypeKeys(input.fileRole, input.releaseTags || [], input.systemName)
      : classifyReleaseTagsToTypeKeys(input.releaseTags || [], input.systemName);
    for (const key of fileKeys) {
      candidateCategories.add(mapTypeKeyToStorageCategory(key));
    }
  }

  if (candidateCategories.size === 0) {
    return 'retail';
  }

  if (candidateCategories.size === 1) {
    return Array.from(candidateCategories)[0];
  }

  // When an item has multiple non-retail categories (e.g. Hack + Translation), honor active filter context if matched
  if (input.preferredFilterTypeKeys && input.preferredFilterTypeKeys.length > 0) {
    const preferredCategories = new Set(
      input.preferredFilterTypeKeys.map(mapTypeKeyToStorageCategory),
    );
    for (const cat of CATEGORY_SPECIFICITY_ORDER) {
      if (cat !== 'retail' && candidateCategories.has(cat) && preferredCategories.has(cat)) {
        return cat;
      }
    }
  }

  for (const cat of CATEGORY_SPECIFICITY_ORDER) {
    if (candidateCategories.has(cat)) {
      return cat;
    }
  }

  return 'retail';
}

/**
 * Resolves the final relative destination folder on the storage device for a given system and ROM category.
 * Example:
 *  - Type subfolders OFF: "snes-roms" + "hack" -> "SNES"
 *  - Type subfolders ON:  "snes-roms" + "retail" -> "SNES"
 *  - Type subfolders ON:  "snes-roms" + "hack" -> "SNES/Hacks"
 *  - Type subfolders ON:  "snes-roms" + "translations" -> "SNES/Translations"
 */
export function resolveTargetStorageFolder(
  systemName: string,
  category: StorageRomCategoryKey,
  config?: StorageFolderMappingConfig | null,
): string {
  const baseFolder = resolveBaseSystemFolder(systemName, config);
  const subFolder = resolveRomCategorySubfolder(systemName, category, config);
  if (!subFolder) {
    return baseFolder;
  }

  // Avoid redundant duplication such as "BIOS/BIOS" or "PSX2PSP/PSX2PSP"
  const baseLeaf = baseFolder.split('/').pop() || baseFolder;
  if (baseLeaf.toLowerCase() === subFolder.toLowerCase()) {
    return baseFolder;
  }

  return `${baseFolder}/${subFolder}`;
}

/**
 * Deduplicates alias slugs so each logical console appears once in the Operations folder mapping editor,
 * preferring slugs actively discovered or customized in the user's repository.
 */
export function buildUniqueConsoleMappingSlugs(
  prioritySlugs: Iterable<string>,
  includeAllKnownConsoles: boolean,
): string[] {
  const chosenByDisplayName = new Map<string, string>();
  const extraExactCustomSlugs: string[] = [];

  const registerSlug = (rawSlug: string, allowAliasMerge: boolean) => {
    const clean = String(rawSlug || '').trim();
    if (!clean || isNonSystemSlug(clean)) return;
    const info = resolveSystemDisplayInfo(clean);
    if (!chosenByDisplayName.has(info.displayName)) {
      chosenByDisplayName.set(info.displayName, clean);
    } else if (!allowAliasMerge) {
      const existing = chosenByDisplayName.get(info.displayName)!;
      if (existing.toLowerCase() !== clean.toLowerCase()) {
        extraExactCustomSlugs.push(clean);
      }
    }
  };

  for (const slug of prioritySlugs) {
    registerSlug(slug, true);
  }

  if (includeAllKnownConsoles) {
    for (const slug of CANONICAL_KNOWN_SYSTEM_SLUGS) {
      registerSlug(slug, true);
    }
  }

  return Array.from(new Set([...chosenByDisplayName.values(), ...extraExactCustomSlugs]));
}
