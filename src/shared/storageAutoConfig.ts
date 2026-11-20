import {
  canonicalizeSystemSlug,
  resolveSystemDisplayInfo,
  type SystemBrandId,
} from './systemCatalog.ts';
import {
  CANONICAL_KNOWN_SYSTEM_SLUGS,
  isTypeSubfoldersActiveForSystem,
  normalizeStorageFolderConfig,
  resolveBaseSystemFolder,
  resolveDefaultSystemFolder,
  resolveRomCategorySubfolder,
  sanitizeRelativeStoragePath,
  STORAGE_ROM_CATEGORY_KEYS,
  UNIVERSAL_SYSTEM_FOLDER_DEFAULTS,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
  type SystemTypeFolderOverride,
} from './storageFolderMappings.ts';

export interface ScannedDirNode {
  /** Relative path from the chosen export base folder ("" for root, e.g. "Roms/SFC"). */
  relativePath: string;
  /** Exact leaf folder name on disk (or root folder label when depth === 0). */
  name: string;
  /** Nesting depth from the chosen export base folder (0 = root). */
  depth: number;
  /** Immediate child directory names on disk (exact casing). */
  childDirs: string[];
  /** Sampled lowercase file extensions without leading dot (e.g. ["sfc", "zip"]). */
  sampleExtensions: string[];
  /** Count of files sampled in this directory. */
  fileCount: number;
}

export interface DiscoveredConsoleCandidate {
  relativePath: string;
  parentPath: string;
  score: number;
  matchReason: string;
  fileCount: number;
  matchingRomCount: number;
  detectedTypeSubfolders: Partial<Record<StorageRomCategoryKey, string>>;
}

export interface DiscoveredConsoleMapping {
  canonicalSlug: string;
  displayName: string;
  brandId: SystemBrandId;
  brandLabel: string;
  recommendedPath: string;
  confidence: 'high' | 'medium';
  candidates: DiscoveredConsoleCandidate[];
  detectedTypeSubfolders: Partial<Record<StorageRomCategoryKey, string>>;
}

export interface DeviceAutoConfigResult {
  rootLabel: string;
  detectedLayoutLabel: string;
  detectedRomRoot: string;
  matches: DiscoveredConsoleMapping[];
  unmatchedFolders: string[];
  stats: {
    directoriesScanned: number;
    matchedConsoles: number;
    matchedSubfolders: number;
    durationMs: number;
  };
}

export type AutoConfigConsoleDiffKind = 'new' | 'updates_custom' | 'unchanged';

export interface AutoConfigConsoleDiff {
  kind: AutoConfigConsoleDiffKind;
  currentBasePath: string;
  defaultBasePath: string;
  hasCustomBase: boolean;
  baseChanged: boolean;
  subfoldersChanged: boolean;
}

export interface AutoConfigMergeSelection {
  selectedSlugs: Iterable<string>;
  chosenPathBySlug?: Record<string, string>;
  includeTypeSubfolders: boolean;
}

export interface DiscoverStorageOptions {
  rootLabel?: string;
  preferredSlugs?: Iterable<string>;
  durationMs?: number;
}

/**
 * Directory names that should never be descended into or matched as ROM consoles
 * during browser-side export device scanning.
 */
export const IGNORED_SCAN_DIRECTORY_NAMES = new Set<string>([
  '.git',
  '.svn',
  '.hg',
  '.trashes',
  '.spotlight-v100',
  '.fseventsd',
  '.temporaryitems',
  '.ds_store',
  '__macosx',
  '$recycle.bin',
  'system volume information',
  'lost+found',
  'node_modules',
  'imgs',
  'img',
  'images',
  'media',
  'boxart',
  'covers',
  'screenshots',
  'snaps',
  'videos',
  'manuals',
  'marquees',
  'wheels',
  'miximages',
  'saves',
  'save',
  'states',
  'savestates',
  'cheats',
  'overlays',
  'shaders',
  'borders',
  'bezels',
  'themes',
  'theme',
  'logs',
  'log',
  'cache',
  'tmp',
  'temp',
  'thumbnails',
  'database',
  'playlists',
  'autoconfig',
  'remappings',
  'records',
  'recordings',
  'cfw',
  'miyoo',
  'muos',
  'rapp',
  'currentprofile',
  'app',
  'apps',
  'cores',
  'platform',
  'platforms',
  'downloaded_media',
  'scraped',
  'gamelists',
]);

/**
 * Wrapper container directory names commonly used above console ROM directories.
 */
const ROM_CONTAINER_DIR_TOKENS = new Set<string>([
  'roms',
  'rom',
  'games',
  'game',
  'emulation',
  'retroarch',
  'retro',
  'consoles',
  'systems',
  'library',
  'collection',
  'assets',
  'sdcard',
  'content',
  'isos',
  'iso',
]);

const GENERIC_ARCHIVE_EXTENSIONS = new Set<string>([
  'zip',
  '7z',
  'rar',
  'chd',
  'iso',
  'cue',
  'bin',
  'pbp',
  'rvz',
  'cso',
]);

/**
 * Normalizes a folder name to a compact lowercase alphanumeric token for alias matching.
 * Strips decorative leading numbering (e.g. "01 - SNES" -> "snes") and bracket prefixes.
 */
export function normalizeFolderToken(rawName: string): string {
  const cleaned = rawName
    .trim()
    // Strip leading index prefixes like "01 - ", "02_", "1. ", "[01] "
    .replace(/^(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3})\s*[-_.:\s]+\s*/i, '')
    .trim()
    .toLowerCase();
  return cleaned.replace(/[^a-z0-9]+/g, '');
}

/**
 * Extracts candidate lookup tokens from a folder name, including stripping parenthetical
 * annotations like "SNES (Super Nintendo)" -> ["snessupernintendo", "snes", "supernintendo"].
 */
function extractFolderCandidateTokens(rawName: string): string[] {
  const tokens = new Set<string>();
  const primary = normalizeFolderToken(rawName);
  if (primary) tokens.add(primary);

  const withoutParens = rawName.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim();
  const stripped = normalizeFolderToken(withoutParens);
  if (stripped && stripped.length >= 2) tokens.add(stripped);

  const parenMatches = rawName.matchAll(/\(([^)]+)\)|\[([^\]]+)\]/g);
  for (const m of parenMatches) {
    const inner = normalizeFolderToken(m[1] || m[2] || '');
    if (inner && inner.length >= 2 && !/^\d+$/.test(inner)) {
      tokens.add(inner);
    }
  }

  return Array.from(tokens);
}

interface AliasRule {
  slug: string;
  weight: number;
  sourceLabel: string;
}

/**
 * Rich ecosystem alias definitions mapping normalized folder tokens across:
 * - Universal defaults (NES, SNES, GBA, PSX, GG, SMS, GENESIS, ...)
 * - OnionOS / GarlicOS / Miyoo Mini (FC, SFC, MD, MS, PS, PCE, POKE, FIFTYTWO, ...)
 * - ES-DE / Batocera / ArkOS / EmuDeck / RetroPie / MuOS / Daijisho
 * - MiSTer FPGA (MegaDrive, MegaCD, S32X, TGFX16, Gameboy, AO486, ...)
 * - Analogue Pocket OpenFPGA core folder names
 * - Human-readable names (Super Nintendo, Sega Game Gear, PlayStation, ...)
 */
const ECOSYSTEM_PLATFORM_ALIASES: Readonly<
  Record<string, { exact: string[]; secondary?: string[]; extensions?: string[] }>
> = {
  // Nintendo
  'nes-roms': {
    exact: ['nes', 'fc', 'famicom', 'nintendoentertainmentsystem', 'nesroms'],
    secondary: ['nintendo8bit'],
    extensions: ['nes', 'unf', 'unif'],
  },
  'fds-roms': {
    exact: ['fds', 'famicomdisksystem', 'fdsroms'],
    extensions: ['fds'],
  },
  'snes-rom': {
    exact: [
      'snes',
      'sfc',
      'superfamicom',
      'supernintendo',
      'supernintendoentertainmentsystem',
      'snesroms',
      'snesrom',
      'snesmsu1',
      'msu1',
    ],
    secondary: ['sufami'],
    extensions: ['sfc', 'smc', 'swc', 'fig'],
  },
  satellaview: {
    exact: ['satellaview', 'bsx', 'snesbsx'],
    extensions: ['bs', 'sfc'],
  },
  'n64-roms': {
    exact: ['n64', 'nintendo64', 'n64roms'],
    extensions: ['z64', 'n64', 'v64'],
  },
  '64dd': {
    exact: ['64dd', 'n64dd', 'nintendo64dd'],
    extensions: ['ndd'],
  },
  gamecube: {
    exact: ['gamecube', 'gc', 'gcn', 'ngc', 'nintendogamecube', 'gamecubeiso', 'gcniso'],
    extensions: ['rvz', 'gcz', 'gcm', 'ciso', 'iso'],
  },
  'wii-iso': {
    exact: ['wii', 'nintendowii', 'wiiiso', 'wiiroms'],
    extensions: ['rvz', 'wbfs', 'iso', 'wia'],
  },
  wiiware: {
    exact: ['wiiware'],
    extensions: ['wad'],
  },
  'wii-u': {
    exact: ['wiiu', 'nintendowiiu'],
    extensions: ['wua', 'wux', 'wud', 'rpx'],
  },
  'switch-roms': {
    exact: ['switch', 'nswitch', 'nintendoswitch', 'switchroms'],
    extensions: ['nsp', 'xci', 'nsz', 'xcz'],
  },
  'gameboy-roms': {
    exact: ['gb', 'gameboy', 'nintendogameboy', 'dmg', 'gbroms', 'gameboyroms'],
    secondary: ['sgb', 'supergameboy', 'gameboy2p'],
    extensions: ['gb'],
  },
  'gameboy-color-roms': {
    exact: ['gbc', 'gameboycolor', 'nintendogameboycolor', 'gbcroms', 'gameboycolorroms'],
    extensions: ['gbc'],
  },
  'gba-roms': {
    exact: ['gba', 'gameboyadvance', 'nintendogameboyadvance', 'gbaroms'],
    extensions: ['gba'],
  },
  'virtual-boy': {
    exact: ['vb', 'virtualboy', 'vboy', 'vbroms'],
    extensions: ['vb', 'vboy'],
  },
  'nds-roms': {
    exact: ['nds', 'ds', 'nintendods', 'ndsroms'],
    extensions: ['nds'],
  },
  'dsi-roms': {
    exact: ['dsi', 'dsiware', 'nintendodsi', 'dsiroms'],
    extensions: ['dsi', 'nds'],
  },
  '3ds-roms': {
    exact: ['3ds', 'n3ds', 'nintendo3ds', '3dsroms'],
    extensions: ['3ds', 'cci', 'cia', 'cxi'],
  },
  'pokemon-mini': {
    exact: ['pokemini', 'pokemonmini', 'poke'],
    extensions: ['min'],
  },

  // Sony
  'psx-iso': {
    exact: ['psx', 'ps1', 'ps', 'psone', 'playstation', 'playstation1', 'sonyplaystation', 'psxiso', 'ps1iso'],
    extensions: ['chd', 'pbp', 'cue', 'bin', 'm3u', 'iso'],
  },
  'psx2psp-eboots': {
    exact: ['psx2psp', 'psx2pspeboots', 'psneboot', 'eboots'],
    extensions: ['pbp'],
  },
  'ps2-iso': {
    exact: ['ps2', 'playstation2', 'sonyplaystation2', 'ps2iso'],
    extensions: ['chd', 'iso', 'gz', 'bin', 'cue'],
  },
  'ps3-iso': {
    exact: ['ps3', 'playstation3', 'sonyplaystation3', 'ps3iso'],
    extensions: ['iso', 'pkg'],
  },
  'psp-iso': {
    exact: ['psp', 'playstationportable', 'sonypsp', 'pspiso', 'psproms'],
    extensions: ['iso', 'cso', 'chd', 'pbp'],
  },
  'ps-vita': {
    exact: ['psvita', 'vita', 'playstationvita'],
    extensions: ['vpk', 'zip'],
  },

  // Sega
  'sg-1000': {
    exact: ['sg1000', 'segasg1000'],
    extensions: ['sg'],
  },
  'sms-roms': {
    exact: ['sms', 'ms', 'mastersystem', 'segamastersystem', 'smsroms'],
    extensions: ['sms'],
  },
  'gg-roms': {
    exact: ['gg', 'gamegear', 'segagamegear', 'ggroms'],
    extensions: ['gg'],
  },
  'genesis-roms': {
    exact: ['genesis', 'md', 'megadrive', 'segagenesis', 'segamegadrive', 'genesisroms', 'megadriveroms', 'gen'],
    extensions: ['md', 'gen', 'smd', '68k'],
  },
  'sega-cd-iso': {
    exact: ['segacd', 'megacd', 'mcd', 'scd', 'segacdiso'],
    extensions: ['chd', 'cue', 'bin', 'iso'],
  },
  '32x-roms': {
    exact: ['32x', 'sega32x', 's32x', '32xroms'],
    extensions: ['32x'],
  },
  'saturn-iso': {
    exact: ['saturn', 'segasaturn', 'saturniso'],
    extensions: ['chd', 'cue', 'bin', 'iso'],
  },
  'dreamcast-iso': {
    exact: ['dreamcast', 'dc', 'segadreamcast', 'dreamcastiso', 'dciso'],
    extensions: ['chd', 'cdi', 'gdi', 'cue'],
  },
  'sega-pico': {
    exact: ['pico', 'segapico'],
    extensions: ['md', 'bin'],
  },

  // NEC & SNK
  'pc-engine-roms': {
    exact: ['pce', 'pcengine', 'tg16', 'tgfx16', 'turbografx', 'turbografx16', 'pcengineroms', 'pceroms'],
    extensions: ['pce'],
  },
  'pce-cd-iso': {
    exact: ['pcecd', 'pcenginecd', 'tgcd', 'tgfx16cd', 'turbografxcd', 'turbocd', 'pcecdiso'],
    extensions: ['chd', 'cue', 'bin', 'iso'],
  },
  supergrafx: {
    exact: ['supergrafx', 'sgfx', 'pcenginesupergrafx'],
    extensions: ['sgx', 'pce'],
  },
  'pc-fx': {
    exact: ['pcfx', 'necpcfx'],
    extensions: ['chd', 'cue', 'iso'],
  },
  'neogeo-roms': {
    exact: ['neogeo', 'ng', 'snkneogeo', 'neogeoroms'],
    extensions: ['neo', 'zip', '7z'],
  },
  'neo-geo-cd': {
    exact: ['neocd', 'neogeocd'],
    extensions: ['chd', 'cue', 'iso'],
  },
  'ngp-roms': {
    exact: ['ngp', 'neogeopocket', 'ngproms'],
    extensions: ['ngp'],
  },
  'ngpc-roms': {
    exact: ['ngpc', 'neogeopocketcolor', 'ngpcroms'],
    extensions: ['ngc'],
  },

  // Other Consoles & Handhelds
  'atari-2600-roms': {
    exact: ['atari2600', '2600', 'a2600', 'atari', 'atari2600roms'],
    extensions: ['a26'],
  },
  'atari-5200-roms': {
    exact: ['atari5200', '5200', 'a5200', 'fiftytwo', 'atari5200roms'],
    extensions: ['a52'],
  },
  'atari-7800-roms': {
    exact: ['atari7800', '7800', 'a7800', 'seventyeight', 'atari7800roms'],
    extensions: ['a78'],
  },
  'atari-lynx': {
    exact: ['lynx', 'atarilynx', 'lynxroms'],
    extensions: ['lnx', 'o'],
  },
  'atari-jaguar': {
    exact: ['jaguar', 'atarijaguar', 'jaguarroms'],
    extensions: ['j64', 'jag'],
  },
  'jaguar-cd': {
    exact: ['jaguarcd', 'atarijaguarcd'],
    extensions: ['chd', 'cdi', 'cue'],
  },
  'xbox-iso': {
    exact: ['xbox', 'ogxbox', 'xboxiso'],
    extensions: ['xiso', 'iso'],
  },
  'xbox-360': {
    exact: ['xbox360', 'x360'],
    extensions: ['iso', 'xex'],
  },
  '3do-iso': {
    exact: ['3do', 'panasonic3do', '3doiso'],
    extensions: ['chd', 'iso', 'cue'],
  },
  colecovision: {
    exact: ['coleco', 'colecovision'],
    extensions: ['col'],
  },
  intellivision: {
    exact: ['intellivision', 'intv'],
    extensions: ['int'],
  },
  vectrex: {
    exact: ['vectrex', 'vec'],
    extensions: ['vec', 'gam'],
  },
  'odyssey-2': {
    exact: ['odyssey2', 'videopac', 'magnavoxodyssey2'],
    extensions: ['bin'],
  },
  'cd-i': {
    exact: ['cdi', 'cdimono1', 'philipscdi'],
    extensions: ['chd', 'cue', 'iso'],
  },
  'ws-roms': {
    exact: ['ws', 'wonderswan', 'wsroms'],
    extensions: ['ws'],
  },
  'wonderswan-color': {
    exact: ['wsc', 'wonderswancolor', 'wscroms'],
    extensions: ['wsc'],
  },
  'fairchild-channel-f': {
    exact: ['channelf', 'fairchildchannelf'],
    extensions: ['bin', 'chf'],
  },
  'watara-supervision': {
    exact: ['supervision', 'watarasupervision'],
    extensions: ['sv'],
  },
  'n-gage': {
    exact: ['ngage', 'nokiangage'],
  },

  // Arcade & Home Computers
  'arcade-roms': {
    exact: ['arcade', 'arcaderoms'],
    extensions: ['zip', '7z'],
  },
  mame: {
    exact: ['mame', 'mame2003', 'mame2003plus', 'mame2010'],
    extensions: ['zip', '7z'],
  },
  fbneo: {
    exact: ['fbneo', 'fba', 'finalburnneo', 'finalburn'],
    extensions: ['zip', '7z'],
  },
  cps1: {
    exact: ['cps1', 'cps'],
    extensions: ['zip', '7z'],
  },
  cps2: {
    exact: ['cps2'],
    extensions: ['zip', '7z'],
  },
  cps3: {
    exact: ['cps3'],
    extensions: ['zip', '7z'],
  },
  naomi: {
    exact: ['naomi', 'seganaomi'],
    extensions: ['zip', 'chd', 'lst', 'dat'],
  },
  atomiswave: {
    exact: ['atomiswave'],
    extensions: ['zip', 'chd', 'lst'],
  },
  'amiga-roms': {
    exact: ['amiga', 'amiga500', 'amiga1200', 'commodoreamiga', 'amigaroms'],
    extensions: ['adf', 'lha', 'hdf', 'ipf', 'dms'],
  },
  'amiga-cd32': {
    exact: ['cd32', 'amigacd32'],
    extensions: ['chd', 'cue', 'iso'],
  },
  'c64-roms': {
    exact: ['c64', 'commodore64', 'c64roms'],
    extensions: ['d64', 't64', 'prg', 'crt', 'tap'],
  },
  'msx-roms': {
    exact: ['msx', 'msx1', 'msxroms'],
    extensions: ['rom', 'mx1', 'dsk'],
  },
  msx2: {
    exact: ['msx2', 'msx2plus'],
    extensions: ['rom', 'mx2', 'dsk'],
  },
  'zx-spectrum': {
    exact: ['zxspectrum', 'zxs', 'spectrum', 'sinclairzxspectrum'],
    extensions: ['tzx', 'tap', 'z80', 'sna'],
  },
  'amstrad-cpc': {
    exact: ['cpc', 'amstradcpc', 'amstrad'],
    extensions: ['dsk', 'cdt', 'sna'],
  },
  'atari-st': {
    exact: ['atarist', 'st'],
    extensions: ['st', 'stx', 'msa'],
  },
  dos: {
    exact: ['dos', 'msdos', 'dosbox', 'ao486'],
    secondary: ['pc'],
    extensions: ['dosz', 'exe', 'com', 'bat'],
  },
  scummvm: {
    exact: ['scummvm', 'scumm'],
    extensions: ['scummvm'],
  },
  x68000: {
    exact: ['x68000', 'sharpx68000'],
    extensions: ['dim', 'hdf', 'm3u'],
  },
  'fm-towns': {
    exact: ['fmtowns', 'towns'],
    extensions: ['chd', 'cue', 'iso'],
  },
  'pc-88': {
    exact: ['pc88', 'pc8801', 'necpc88'],
    extensions: ['d88'],
  },
  'pc-98': {
    exact: ['pc98', 'pc9801', 'necpc98'],
    extensions: ['fdi', 'hdi', 'nhd', 'd88'],
  },
  'apple-ii': {
    exact: ['apple2', 'appleii', 'apple2e'],
    extensions: ['dsk', 'do', 'po', 'woz'],
  },

  // System & Other
  'bios-files': {
    exact: ['bios', 'biosfiles'],
  },
  soundtracks: {
    exact: ['ost', 'soundtracks', 'music'],
  },
};

const ROM_TYPE_SUBFOLDER_ALIASES: Readonly<Record<StorageRomCategoryKey, readonly string[]>> = {
  retail: ['retail', 'retailroms', 'official', 'commercial', 'standard', 'original', 'clean', 'vanilla'],
  translations: [
    'translations',
    'translation',
    'translated',
    'ten',
    'english',
    'englishtranslations',
    'englishtranslation',
    'localized',
    'patches',
    'fan',
    'fantranslations',
  ],
  hack: ['hacks', 'hack', 'romhacks', 'romhack', 'mods', 'mod', 'redux', 'msu1', 'randomizers', 'colorizations'],
  homebrew: ['homebrew', 'homebrews', 'indie', 'doujin', 'aftermarket', 'pd'],
  port: ['ports', 'port', 'decomp', 'decomps', 'decompilation', 'decompilations'],
  undub: ['undubs', 'undub'],
  demo_proto: ['prototypes', 'prototype', 'protos', 'proto', 'demos', 'demo', 'betas', 'beta', 'unreleased', 'samples'],
  bootleg: ['unlicensed', 'bootleg', 'bootlegs', 'pirate', 'pirates', 'multicarts', 'hacksunlicensed'],
  bios: ['bios', 'firmware', 'system'],
  dlc: ['dlc', 'updates', 'update', 'addons', 'addon'],
  psx2psp: ['psx2psp', 'eboot', 'eboots', 'psn'],
};

const ALIAS_LOOKUP = new Map<string, AliasRule>();
const EXTENSIONS_BY_CANONICAL = new Map<string, Set<string>>();

function registerAlias(token: string, rule: AliasRule): void {
  const clean = normalizeFolderToken(token);
  if (!clean) return;
  const existing = ALIAS_LOOKUP.get(clean);
  if (!existing || rule.weight > existing.weight) {
    ALIAS_LOOKUP.set(clean, rule);
  }
}

// Seed lookup table from ecosystem aliases
for (const [slug, def] of Object.entries(ECOSYSTEM_PLATFORM_ALIASES)) {
  const canonical = canonicalizeSystemSlug(slug).toLowerCase();
  for (const token of def.exact) {
    registerAlias(token, {
      slug: canonical,
      weight: 90,
      sourceLabel: 'Exact console folder match',
    });
  }
  for (const token of def.secondary ?? []) {
    registerAlias(token, {
      slug: canonical,
      weight: 68,
      sourceLabel: 'Console folder alias match',
    });
  }
  if (def.extensions && def.extensions.length > 0) {
    EXTENSIONS_BY_CANONICAL.set(canonical, new Set(def.extensions.map((e) => e.toLowerCase())));
  }
}

// Also seed universal defaults & known slugs so nothing in storageFolderMappings is ever missed
for (const [slugKey, defaultFolder] of Object.entries(UNIVERSAL_SYSTEM_FOLDER_DEFAULTS)) {
  const canonical = canonicalizeSystemSlug(slugKey).toLowerCase();
  registerAlias(slugKey, { slug: canonical, weight: 88, sourceLabel: 'Canonical slug match' });
  registerAlias(defaultFolder, { slug: canonical, weight: 88, sourceLabel: 'Standard folder match' });
}

for (const slug of CANONICAL_KNOWN_SYSTEM_SLUGS) {
  const info = resolveSystemDisplayInfo(slug);
  const canonical = canonicalizeSystemSlug(slug).toLowerCase();
  registerAlias(info.displayName, { slug: canonical, weight: 84, sourceLabel: 'Console display name match' });
}

const SUBFOLDER_TOKEN_TO_CATEGORY = new Map<string, StorageRomCategoryKey>();
for (const category of STORAGE_ROM_CATEGORY_KEYS) {
  for (const alias of ROM_TYPE_SUBFOLDER_ALIASES[category]) {
    SUBFOLDER_TOKEN_TO_CATEGORY.set(normalizeFolderToken(alias), category);
  }
}

/**
 * Classifies an immediate child directory name inside a console folder as a known
 * StorageRomCategoryKey (e.g., "ROM Hacks" -> "hack", "Translations" -> "translations").
 */
export function classifyRomTypeSubfolderName(folderName: string): StorageRomCategoryKey | null {
  const tokens = extractFolderCandidateTokens(folderName);
  for (const token of tokens) {
    const direct = SUBFOLDER_TOKEN_TO_CATEGORY.get(token);
    if (direct) return direct;
  }
  return null;
}

function getParentRelativePath(relativePath: string): string {
  const clean = sanitizeRelativeStoragePath(relativePath);
  const idx = clean.lastIndexOf('/');
  return idx < 0 ? '' : clean.slice(0, idx);
}

function isAnaloguePocketCommonPath(relativePath: string): { isPocket: boolean; coreSegment: string } {
  const parts = sanitizeRelativeStoragePath(relativePath).split('/').filter(Boolean);
  if (parts.length === 3 && parts[0]!.toLowerCase() === 'assets' && parts[2]!.toLowerCase() === 'common') {
    return { isPocket: true, coreSegment: parts[1]! };
  }
  return { isPocket: false, coreSegment: '' };
}

function isParentWrapperContainer(parentPath: string): boolean {
  if (!parentPath) return false;
  const segments = parentPath.split('/').filter(Boolean);
  return segments.every((seg) => ROM_CONTAINER_DIR_TOKENS.has(normalizeFolderToken(seg)));
}

function isPathInsideIgnoredSegment(relativePath: string): boolean {
  const segments = sanitizeRelativeStoragePath(relativePath).split('/').filter(Boolean);
  return segments.some((seg) => IGNORED_SCAN_DIRECTORY_NAMES.has(seg.trim().toLowerCase()));
}

function resolvePreferredSlugForDisplay(
  canonicalSlug: string,
  preferredByDisplayName: Map<string, string>,
): string {
  const displayName = resolveSystemDisplayInfo(canonicalSlug).displayName;
  return preferredByDisplayName.get(displayName) ?? canonicalSlug;
}

function detectTypeSubfoldersForNode(node: ScannedDirNode): Partial<Record<StorageRomCategoryKey, string>> {
  const detected: Partial<Record<StorageRomCategoryKey, string>> = {};
  for (const childName of node.childDirs) {
    const cleanChild = sanitizeRelativeStoragePath(childName);
    if (!cleanChild) continue;
    const category = classifyRomTypeSubfolderName(childName);
    if (category && !detected[category]) {
      detected[category] = cleanChild;
    }
  }
  return detected;
}

function inferLayoutLabel(
  detectedRomRoot: string,
  matches: DiscoveredConsoleMapping[],
): string {
  if (matches.length === 0) {
    return 'No recognizable console folders found';
  }

  if (detectedRomRoot === 'Assets/*/common') {
    return 'Analogue Pocket OpenFPGA (Assets/*/common)';
  }

  const leavesLower = new Set(
    matches.map((m) => (m.recommendedPath.split('/').pop() || '').toLowerCase()),
  );
  const onionSignatureCount = ['fc', 'sfc', 'md', 'ms', 'ps', 'pce'].filter((k) =>
    leavesLower.has(k),
  ).length;
  const esSignatureCount = ['megadrive', 'mastersystem', 'gamegear', 'pcengine', 'n3ds'].filter((k) =>
    leavesLower.has(k),
  ).length;
  const misterSignatureCount = ['tgfx16', 's32x', 'megacd', 'ao486', 'gameboy'].filter((k) =>
    leavesLower.has(k),
  ).length;

  const rootLower = detectedRomRoot.toLowerCase();
  if (rootLower === 'games' && (misterSignatureCount >= 1 || matches.length >= 2)) {
    return 'MiSTer / Games Root (games/)';
  }
  if (rootLower === 'emulation/roms') {
    return 'EmuDeck / Emulation Root (Emulation/roms/)';
  }
  if ((rootLower === 'roms' || rootLower === 'rom') && onionSignatureCount >= 2) {
    return `OnionOS / GarlicOS (${detectedRomRoot}/)`;
  }
  if (esSignatureCount >= 2) {
    return detectedRomRoot
      ? `EmulationStation / Batocera (${detectedRomRoot}/)`
      : 'EmulationStation / Batocera Layout';
  }
  if (detectedRomRoot) {
    return `Nested ROM Root (${detectedRomRoot}/)`;
  }
  return 'Direct Console Folders (Root)';
}

/**
 * Pure discovery engine: analyzes a scanned directory tree from an export base path,
 * identifies console base paths + ROM-type subfolders using alias matching, parent-root
 * consensus, and ROM extension corroboration, and returns ranked reviewable results.
 */
export function discoverStorageFolderMappings(
  nodes: readonly ScannedDirNode[],
  options: DiscoverStorageOptions = {},
): DeviceAutoConfigResult {
  const rootLabel = (options.rootLabel || 'Storage Device').trim() || 'Storage Device';
  const durationMs = Math.max(0, Math.round(options.durationMs ?? 0));

  // Build preferred slug lookup so matched consoles align with slugs already used in the user's catalog/config
  const preferredByDisplayName = new Map<string, string>();
  if (options.preferredSlugs) {
    for (const raw of options.preferredSlugs) {
      const clean = canonicalizeSystemSlug(String(raw || '').trim()).toLowerCase();
      if (!clean) continue;
      const displayName = resolveSystemDisplayInfo(clean).displayName;
      if (!preferredByDisplayName.has(displayName)) {
        preferredByDisplayName.set(displayName, clean);
      }
    }
  }
  for (const knownSlug of CANONICAL_KNOWN_SYSTEM_SLUGS) {
    const clean = canonicalizeSystemSlug(knownSlug).toLowerCase();
    const displayName = resolveSystemDisplayInfo(clean).displayName;
    if (!preferredByDisplayName.has(displayName)) {
      preferredByDisplayName.set(displayName, clean);
    }
  }

  // Index normalized paths so we can detect Analogue Pocket `Assets/<core>/common` siblings
  const nodeByLowerPath = new Map<string, ScannedDirNode>();
  for (const node of nodes) {
    const cleanPath = sanitizeRelativeStoragePath(node.relativePath);
    nodeByLowerPath.set(cleanPath.toLowerCase(), {
      ...node,
      relativePath: cleanPath,
    });
  }

  interface RawCandidate {
    targetSlug: string;
    baseCanonical: string;
    node: ScannedDirNode;
    parentPath: string;
    clusterKey: string;
    baseScore: number;
    matchReason: string;
    matchingRomCount: number;
    detectedTypeSubfolders: Partial<Record<StorageRomCategoryKey, string>>;
  }

  const rawCandidates: RawCandidate[] = [];
  const matchedPathLowerSet = new Set<string>();

  // Pass 1: Identify console folder candidates (ordered shallowest-first so console roots precede subfolders)
  const orderedNodes = Array.from(nodeByLowerPath.values()).sort((a, b) => a.depth - b.depth);

  for (const node of orderedNodes) {
    if (node.depth <= 0 || !node.relativePath) continue;
    if (isPathInsideIgnoredSegment(node.relativePath)) continue;

    const parentPath = getParentRelativePath(node.relativePath);
    const parentLower = parentPath.toLowerCase();

    // Skip children inside an already-matched console folder (those are ROM-type subfolders or disc dirs, not consoles)
    if (parentLower && matchedPathLowerSet.has(parentLower)) {
      continue;
    }

    // Analogue Pocket: Assets/<core>/common
    const pocketCheck = isAnaloguePocketCommonPath(node.relativePath);
    if (pocketCheck.isPocket) {
      const tokens = extractFolderCandidateTokens(pocketCheck.coreSegment);
      let matchedRule: AliasRule | null = null;
      for (const tok of tokens) {
        const rule = ALIAS_LOOKUP.get(tok);
        if (rule) {
          matchedRule = rule;
          break;
        }
      }
      if (matchedRule && matchedRule.slug !== 'bios-files' && matchedRule.slug !== 'soundtracks') {
        const targetSlug = resolvePreferredSlugForDisplay(matchedRule.slug, preferredByDisplayName);
        const expectedExts = EXTENSIONS_BY_CANONICAL.get(matchedRule.slug);
        let matchingRomCount = 0;
        let archiveCount = 0;
        for (const ext of node.sampleExtensions) {
          const extLower = ext.toLowerCase();
          if (expectedExts?.has(extLower)) matchingRomCount += 1;
          else if (GENERIC_ARCHIVE_EXTENSIONS.has(extLower)) archiveCount += 1;
        }
        const detectedTypeSubfolders = detectTypeSubfoldersForNode(node);
        rawCandidates.push({
          targetSlug,
          baseCanonical: matchedRule.slug,
          node,
          parentPath,
          clusterKey: 'Assets/*/common',
          baseScore: matchedRule.weight + 28 + Math.min(24, matchingRomCount * 6) + Math.min(8, archiveCount * 2),
          matchReason: `Analogue Pocket OpenFPGA core "${pocketCheck.coreSegment}"`,
          matchingRomCount,
          detectedTypeSubfolders,
        });
        matchedPathLowerSet.add(node.relativePath.toLowerCase());
      }
      continue;
    }

    // If this is Assets/<core> and Assets/<core>/common exists, defer to the /common child
    const parts = node.relativePath.split('/');
    if (
      parts.length === 2 &&
      parts[0]!.toLowerCase() === 'assets' &&
      node.childDirs.some((c) => c.trim().toLowerCase() === 'common')
    ) {
      continue;
    }

    // Skip Assets/<core>/<author.core> non-common folders
    if (parts.length >= 3 && parts[0]!.toLowerCase() === 'assets') {
      continue;
    }

    // Skip generic ROM wrapper directories themselves (e.g. "Roms", "Games", "Emulation")
    const leafToken = normalizeFolderToken(node.name);
    if (ROM_CONTAINER_DIR_TOKENS.has(leafToken)) {
      continue;
    }

    // Avoid matching ROM-type subfolder names at root unless they are explicit standalone platforms like BIOS
    const tokens = extractFolderCandidateTokens(node.name);
    let bestRule: AliasRule | null = null;
    let matchedToken = '';
    for (const tok of tokens) {
      const rule = ALIAS_LOOKUP.get(tok);
      if (rule && (!bestRule || rule.weight > bestRule.weight)) {
        bestRule = rule;
        matchedToken = tok;
      }
    }

    if (!bestRule) continue;

    // Guard short/ambiguous 2-letter tokens (like "pc", "st") unless inside a ROM wrapper or corroborated by files
    const isShortAmbiguous = matchedToken.length <= 2 && ['pc', 'st', 'ds'].includes(matchedToken);
    const parentIsWrapper = isParentWrapperContainer(parentPath);
    const expectedExts = EXTENSIONS_BY_CANONICAL.get(bestRule.slug);
    let matchingRomCount = 0;
    let archiveCount = 0;
    for (const ext of node.sampleExtensions) {
      const extLower = ext.toLowerCase();
      if (expectedExts?.has(extLower)) matchingRomCount += 1;
      else if (GENERIC_ARCHIVE_EXTENSIONS.has(extLower)) archiveCount += 1;
    }
    if (isShortAmbiguous && !parentIsWrapper && matchingRomCount === 0 && node.fileCount === 0) {
      continue;
    }

    // Guard deep non-container paths (depth >= 3 outside known ROM wrapper paths)
    if (node.depth >= 3 && !parentIsWrapper) {
      continue;
    }

    const detectedTypeSubfolders = detectTypeSubfoldersForNode(node);
    const subfolderCount = Object.keys(detectedTypeSubfolders).length;

    let score = bestRule.weight;
    if (parentIsWrapper) score += 22;
    else if (node.depth === 1) score += 10;
    else score -= (node.depth - 1) * 6;

    if (matchingRomCount > 0) {
      score += 18 + Math.min(20, matchingRomCount * 4);
    } else if (archiveCount > 0) {
      score += 8 + Math.min(10, archiveCount * 2);
    } else if (node.fileCount > 0) {
      score += 5;
    }

    if (subfolderCount > 0) {
      score += Math.min(12, subfolderCount * 4);
    }

    const matchReason =
      matchingRomCount > 0
        ? `${bestRule.sourceLabel} "${node.name}" (${matchingRomCount} matching ROM extension${matchingRomCount === 1 ? '' : 's'})`
        : `${bestRule.sourceLabel} "${node.name}"`;

    const targetSlug = resolvePreferredSlugForDisplay(bestRule.slug, preferredByDisplayName);
    rawCandidates.push({
      targetSlug,
      baseCanonical: bestRule.slug,
      node,
      parentPath,
      clusterKey: parentPath,
      baseScore: score,
      matchReason,
      matchingRomCount,
      detectedTypeSubfolders,
    });
    matchedPathLowerSet.add(node.relativePath.toLowerCase());
  }

  // Pass 2: Parent-root consensus scoring — boost candidates belonging to the dominant ROM container cluster
  const consolesPerCluster = new Map<string, Set<string>>();
  for (const cand of rawCandidates) {
    if (cand.baseCanonical === 'bios-files' || cand.baseCanonical === 'soundtracks') continue;
    let set = consolesPerCluster.get(cand.clusterKey);
    if (!set) {
      set = new Set<string>();
      consolesPerCluster.set(cand.clusterKey, set);
    }
    set.add(cand.targetSlug);
  }

  let dominantCluster = '';
  let dominantClusterCount = 0;
  for (const [clusterKey, slugSet] of consolesPerCluster.entries()) {
    if (
      slugSet.size > dominantClusterCount ||
      (slugSet.size === dominantClusterCount &&
        clusterKey !== '' &&
        dominantCluster === '')
    ) {
      dominantCluster = clusterKey;
      dominantClusterCount = slugSet.size;
    }
  }

  // Group by targetSlug and rank candidates with consensus boost
  const candidatesBySlug = new Map<string, DiscoveredConsoleCandidate[]>();
  for (const cand of rawCandidates) {
    const clusterSize = consolesPerCluster.get(cand.clusterKey)?.size ?? 1;
    const consensusBoost = clusterSize >= 2 ? Math.min(36, (clusterSize - 1) * 7) : 0;
    const finalScore = cand.baseScore + consensusBoost;

    const entry: DiscoveredConsoleCandidate = {
      relativePath: cand.node.relativePath,
      parentPath: cand.parentPath,
      score: finalScore,
      matchReason: cand.matchReason,
      fileCount: cand.node.fileCount,
      matchingRomCount: cand.matchingRomCount,
      detectedTypeSubfolders: cand.detectedTypeSubfolders,
    };

    const list = candidatesBySlug.get(cand.targetSlug) ?? [];
    list.push(entry);
    candidatesBySlug.set(cand.targetSlug, list);
  }

  const matches: DiscoveredConsoleMapping[] = [];
  let matchedSubfolders = 0;

  for (const [slug, list] of candidatesBySlug.entries()) {
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.matchingRomCount !== a.matchingRomCount) return b.matchingRomCount - a.matchingRomCount;
      if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
      return a.relativePath.localeCompare(b.relativePath);
    });

    const winner = list[0]!;
    const info = resolveSystemDisplayInfo(slug);
    const subCount = Object.keys(winner.detectedTypeSubfolders).length;
    matchedSubfolders += subCount;

    const confidence: 'high' | 'medium' =
      winner.score >= 95 || winner.matchingRomCount > 0 || dominantClusterCount >= 2
        ? 'high'
        : 'medium';

    matches.push({
      canonicalSlug: slug,
      displayName: info.displayName,
      brandId: info.brandId,
      brandLabel: info.brandLabel,
      recommendedPath: winner.relativePath,
      confidence,
      candidates: list,
      detectedTypeSubfolders: winner.detectedTypeSubfolders,
    });
  }

  matches.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Collect unmatched immediate child folders under the detected ROM root (for transparency)
  const matchedRecommendedLower = new Set(matches.map((m) => m.recommendedPath.toLowerCase()));
  const unmatchedFolders: string[] = [];
  const romRootNode =
    dominantCluster && dominantCluster !== 'Assets/*/common'
      ? nodeByLowerPath.get(dominantCluster.toLowerCase())
      : nodeByLowerPath.get('');

  if (romRootNode) {
    for (const childName of romRootNode.childDirs) {
      const lowerChild = childName.trim().toLowerCase();
      if (!lowerChild || IGNORED_SCAN_DIRECTORY_NAMES.has(lowerChild)) continue;
      if (ROM_CONTAINER_DIR_TOKENS.has(normalizeFolderToken(childName))) continue;
      const fullChildPath = romRootNode.relativePath
        ? sanitizeRelativeStoragePath(`${romRootNode.relativePath}/${childName}`)
        : sanitizeRelativeStoragePath(childName);
      if (!fullChildPath) continue;
      if (!matchedRecommendedLower.has(fullChildPath.toLowerCase())) {
        unmatchedFolders.push(fullChildPath);
      }
    }
    unmatchedFolders.sort((a, b) => a.localeCompare(b));
  }

  const detectedRomRoot = matches.length > 0 ? dominantCluster : '';
  const detectedLayoutLabel = inferLayoutLabel(detectedRomRoot, matches);

  return {
    rootLabel,
    detectedLayoutLabel,
    detectedRomRoot,
    matches,
    unmatchedFolders,
    stats: {
      directoriesScanned: nodes.length,
      matchedConsoles: matches.length,
      matchedSubfolders,
      durationMs,
    },
  };
}

/**
 * Classifies how applying a discovered console mapping compares against the current
 * StorageFolderMappingConfig (New, Updates Custom, or Already Matches).
 */
export function classifyDiscoveredConsoleDiff(
  canonicalSlug: string,
  targetPath: string,
  detectedTypeSubfolders: Partial<Record<StorageRomCategoryKey, string>>,
  includeTypeSubfolders: boolean,
  currentConfig: StorageFolderMappingConfig,
): AutoConfigConsoleDiff {
  const cleanTarget = sanitizeRelativeStoragePath(targetPath);
  const currentBasePath = resolveBaseSystemFolder(canonicalSlug, currentConfig);
  const defaultBasePath = resolveDefaultSystemFolder(canonicalSlug);
  const hasCustomBase = currentBasePath !== defaultBasePath;
  const baseChanged = cleanTarget !== '' && cleanTarget !== currentBasePath;

  let subfoldersChanged = false;
  if (includeTypeSubfolders) {
    const detectedEntries = Object.entries(detectedTypeSubfolders) as [StorageRomCategoryKey, string][];
    if (detectedEntries.length > 0) {
      const currentlyActive = isTypeSubfoldersActiveForSystem(canonicalSlug, currentConfig);
      if (!currentlyActive) {
        subfoldersChanged = true;
      } else {
        for (const [category, folder] of detectedEntries) {
          const cleanSub = sanitizeRelativeStoragePath(folder);
          const existingSub = resolveRomCategorySubfolder(canonicalSlug, category, currentConfig);
          if (cleanSub !== existingSub) {
            subfoldersChanged = true;
            break;
          }
        }
      }
    }
  }

  let kind: AutoConfigConsoleDiffKind = 'unchanged';
  if (baseChanged || subfoldersChanged) {
    kind = hasCustomBase && baseChanged ? 'updates_custom' : 'new';
  }

  return {
    kind,
    currentBasePath,
    defaultBasePath,
    hasCustomBase,
    baseChanged,
    subfoldersChanged,
  };
}

function findMatchingKeyInRecord<T>(slug: string, record: Record<string, T>): string {
  const lower = canonicalizeSystemSlug(slug).toLowerCase();
  if (record[lower] !== undefined) return lower;
  const targetDisplay = resolveSystemDisplayInfo(lower).displayName;
  for (const existingKey of Object.keys(record)) {
    if (resolveSystemDisplayInfo(existingKey).displayName === targetDisplay) {
      return existingKey;
    }
  }
  return lower;
}

/**
 * Non-destructively merges user-selected discovered console mappings (and optional per-console
 * ROM-type subfolders) into an existing StorageFolderMappingConfig, preserving all untouched
 * consoles and global settings.
 */
export function mergeDiscoveredStorageMappings(
  currentConfig: StorageFolderMappingConfig,
  result: DeviceAutoConfigResult,
  selection: AutoConfigMergeSelection,
): StorageFolderMappingConfig {
  const selectedSet = new Set(Array.from(selection.selectedSlugs, (s) => s.toLowerCase()));
  if (selectedSet.size === 0) {
    return normalizeStorageFolderConfig(currentConfig);
  }

  const nextSystemFolders: Record<string, string> = { ...currentConfig.systemFolders };
  const nextSystemTypeOverrides: Record<string, SystemTypeFolderOverride> = {
    ...currentConfig.systemTypeOverrides,
  };

  for (const match of result.matches) {
    if (!selectedSet.has(match.canonicalSlug.toLowerCase())) continue;

    const chosenPath = selection.chosenPathBySlug?.[match.canonicalSlug] || match.recommendedPath;
    const chosenCandidate =
      match.candidates.find((c) => c.relativePath === chosenPath) ?? match.candidates[0];
    const cleanTargetPath = sanitizeRelativeStoragePath(chosenCandidate?.relativePath || chosenPath);
    if (!cleanTargetPath) continue;

    const folderKey = findMatchingKeyInRecord(match.canonicalSlug, nextSystemFolders);
    const defaultFolder = resolveDefaultSystemFolder(folderKey);
    if (cleanTargetPath === defaultFolder) {
      delete nextSystemFolders[folderKey];
    } else {
      nextSystemFolders[folderKey] = cleanTargetPath;
    }

    if (selection.includeTypeSubfolders && chosenCandidate) {
      const detectedEntries = Object.entries(chosenCandidate.detectedTypeSubfolders) as [
        StorageRomCategoryKey,
        string,
      ][];
      if (detectedEntries.length > 0) {
        const overrideKey = findMatchingKeyInRecord(match.canonicalSlug, nextSystemTypeOverrides);
        const existingOverride = nextSystemTypeOverrides[overrideKey] || {};
        const mergedSubfolders: Partial<Record<StorageRomCategoryKey, string>> = {
          ...(existingOverride.subfolders || {}),
        };
        for (const [category, folderName] of detectedEntries) {
          const cleanSub = sanitizeRelativeStoragePath(folderName);
          if (cleanSub) {
            mergedSubfolders[category] = cleanSub;
          }
        }
        nextSystemTypeOverrides[overrideKey] = {
          mode: currentConfig.typeSubfoldersEnabled ? 'inherit' : 'enabled',
          subfolders: mergedSubfolders,
        };
      }
    }
  }

  return normalizeStorageFolderConfig({
    ...currentConfig,
    systemFolders: nextSystemFolders,
    systemTypeOverrides: nextSystemTypeOverrides,
  });
}
