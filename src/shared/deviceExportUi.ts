import {
  DEFAULT_ROM_NAMING_TEMPLATE,
  formatPreparedRomName,
  ROM_NAMING_PRESETS,
  type NamingPresetOption,
  type RomNamingConfig,
} from './romNaming.ts';
import {
  classifyDiscoveredConsoleDiff,
  inferDeviceConventions,
  type AutoConfigConsoleDiff,
  type DeviceAutoConfigResult,
  type DeviceInferredConventions,
  type DiscoveredConsoleCandidate,
  type DiscoveredConsoleMapping,
} from './storageAutoConfig.ts';
import {
  applyFolderCasingStyle,
  createDefaultStorageFolderConfig,
  DEFAULT_ROM_TYPE_SUBFOLDERS,
  getStorageRomCategoryShortLabel,
  normalizeStorageFolderConfig,
  resolveBaseSystemFolder,
  resolveDefaultSystemFolder,
  resolveTargetStorageFolder,
  sanitizeRelativeStoragePath,
  STORAGE_ROM_CATEGORY_KEYS,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
  type SystemTypeFolderOverride,
} from './storageFolderMappings.ts';
import { canonicalizeSystemSlug, resolveSystemDisplayInfo } from './systemCatalog.ts';

export type NamingTokenGroup = 'core' | 'hybrid' | 'legacy';

export interface NamingTokenHelper {
  token: string;
  label: string;
  group: NamingTokenGroup;
  description: string;
}

export const ROM_NAMING_TOKEN_HELPERS: readonly NamingTokenHelper[] = [
  // Core identity tokens
  { token: '{title}', label: 'Game title', group: 'core', description: 'Clean game title' },
  { token: '{regionParen}', label: '(Region)', group: 'core', description: 'Region in parentheses when available' },
  { token: '{region}', label: 'Region only', group: 'core', description: 'Raw region name without parentheses' },
  { token: '{system}', label: 'System slug', group: 'core', description: 'Canonical console slug (e.g. snes-roms)' },
  { token: '{origName}', label: 'Original inner filename', group: 'core', description: 'Clean inner ROM filename without extension' },
  // Type-aware hybrid tokens (No-Intro + T-En)
  { token: '{statusParen}', label: '(Status / Rev)', group: 'hybrid', description: 'Origin/dev status or revision in ( ) — e.g. (Proto), (Homebrew), (Unl)' },
  { token: '{modBracket}', label: '[Patch Version]', group: 'hybrid', description: 'Fan patch & version in [ ] — e.g. [T-En v1.3], [T-En MTL v1.0], [Hack v1.42]' },
  { token: '{status}', label: 'Status only', group: 'hybrid', description: 'Raw status tag without parentheses' },
  { token: '{mod}', label: 'Patch tag only', group: 'hybrid', description: 'Raw patch tag without brackets or version' },
  { token: '{version}', label: 'Version only', group: 'hybrid', description: 'Normalized patch or revision version (v1.42, Rev A)' },
  // Legacy / alternate tokens
  { token: '{tagBracket}', label: '[Role Version]', group: 'legacy', description: 'Legacy combined role + version in brackets' },
  { token: '{roleDash}', label: '- Role Version', group: 'legacy', description: 'Dash-separated role + version' },
  { token: '{role}', label: 'Role only', group: 'legacy', description: 'Combined legacy role label' },
];

export type ConsolePathSource = 'manual' | 'auto' | 'inferred' | 'default';

export interface LiveExportDestinationSample {
  id: 'retail' | 'hack' | 'translation' | 'new_console';
  label: string;
  systemSlug: string;
  systemLabel: string;
  folderPath: string;
  filename: string;
  fullPath: string;
  source: ConsolePathSource;
}

export interface ComposeEffectiveFolderOptions {
  chosenPathBySlug?: Readonly<Record<string, string>>;
  includeTypeSubfolders?: boolean;
}

export interface InferredConventionSummary {
  newConsolePattern: string | null;
  observedSubfolders: Array<{
    category: StorageRomCategoryKey;
    label: string;
    folder: string;
  }>;
  unseenCasingLabel: string | null;
  hasAnyInferredConvention: boolean;
}

function findStoredKeyByDisplayName<T>(
  slug: string,
  record: Readonly<Record<string, T>>,
): string | null {
  const lower = slug.toLowerCase();
  if (record[lower] !== undefined) return lower;
  const canonical = canonicalizeSystemSlug(lower).toLowerCase();
  if (record[canonical] !== undefined) return canonical;
  const targetName = resolveSystemDisplayInfo(lower).displayName;
  for (const key of Object.keys(record)) {
    if (resolveSystemDisplayInfo(key).displayName === targetName) {
      return key;
    }
  }
  return null;
}

function findAutoMatchForSlug(
  autoConfigResult: DeviceAutoConfigResult | null | undefined,
  slug: string,
): DiscoveredConsoleMapping | null {
  if (!autoConfigResult) return null;
  const lower = slug.toLowerCase();
  const canonical = canonicalizeSystemSlug(lower).toLowerCase();
  const targetName = resolveSystemDisplayInfo(lower).displayName;
  for (const match of autoConfigResult.matches) {
    const matchLower = match.canonicalSlug.toLowerCase();
    if (
      matchLower === lower ||
      matchLower === canonical ||
      canonicalizeSystemSlug(matchLower).toLowerCase() === canonical ||
      match.displayName === targetName
    ) {
      return match;
    }
  }
  return null;
}

function isStandaloneNonRomSlug(slug: string): boolean {
  const clean = slug.trim().toLowerCase();
  return clean === 'bios-files' || clean === 'bios' || clean === 'soundtracks';
}

function getEffectiveDeviceConventions(
  autoConfigResult: DeviceAutoConfigResult | null | undefined,
  chosenPathBySlug?: Readonly<Record<string, string>>,
): DeviceInferredConventions | null {
  if (!autoConfigResult || autoConfigResult.matches.length === 0) return null;
  if (chosenPathBySlug && Object.keys(chosenPathBySlug).length > 0) {
    return inferDeviceConventions(
      autoConfigResult.detectedRomRoot,
      autoConfigResult.matches,
      chosenPathBySlug,
    );
  }
  return (
    autoConfigResult.conventions ??
    inferDeviceConventions(autoConfigResult.detectedRomRoot, autoConfigResult.matches)
  );
}

/**
 * 4-tier effective folder composer:
 *   Tier 1: Saved manual overrides (always take top priority)
 *   Tier 2: Exact detected console folders & each console's own detected subfolders
 *   Tier 3: Mounted device inferred conventions (nested ROM root + cross-console subfolder naming/casing)
 *   Tier 4: Universal defaults + saved global folder organization
 */
export function composeEffectiveStorageFolderConfig(
  savedManualConfig: StorageFolderMappingConfig | null | undefined,
  autoConfigResult: DeviceAutoConfigResult | null | undefined,
  options: ComposeEffectiveFolderOptions = {},
): StorageFolderMappingConfig {
  const manual = normalizeStorageFolderConfig(
    savedManualConfig ?? createDefaultStorageFolderConfig(),
  );
  if (!autoConfigResult || autoConfigResult.matches.length === 0) {
    return manual;
  }

  const chosenPathBySlug = options.chosenPathBySlug ?? {};
  const includeTypeSubfolders = options.includeTypeSubfolders ?? true;
  const conventions = getEffectiveDeviceConventions(autoConfigResult, chosenPathBySlug);

  const mergedSystemFolders: Record<string, string> = { ...manual.systemFolders };
  const mergedTypeOverrides: Record<string, SystemTypeFolderOverride> = {
    ...manual.systemTypeOverrides,
  };

  // Tier 3: Device-wide ROM-type subfolder naming & casing propagation across all consoles on this device
  const applyDeviceSubfolders = Boolean(
    includeTypeSubfolders && conventions?.hasInferredTypeSubfolders,
  );
  const effectiveTypeSubfoldersEnabled = applyDeviceSubfolders
    ? true
    : manual.typeSubfoldersEnabled;

  const effectiveGlobalTypeSubfolders: Record<StorageRomCategoryKey, string> = {
    ...manual.globalTypeSubfolders,
  };

  if (applyDeviceSubfolders && conventions) {
    for (const category of STORAGE_ROM_CATEGORY_KEYS) {
      const observedName = conventions.inferredTypeSubfolders[category];
      if (category === 'retail') {
        if (observedName) {
          effectiveGlobalTypeSubfolders.retail = observedName;
        }
        continue;
      }
      if (observedName) {
        effectiveGlobalTypeSubfolders[category] = observedName;
      } else {
        const defaultName = DEFAULT_ROM_TYPE_SUBFOLDERS[category];
        const manualName = manual.globalTypeSubfolders[category];
        // Respect explicit custom global subfolder names; otherwise match detected casing style on unseen types
        if (manualName === defaultName) {
          effectiveGlobalTypeSubfolders[category] = applyFolderCasingStyle(
            defaultName,
            conventions.inferredSubfolderCasing,
          );
        }
      }
    }
  }

  // Tier 2: Exact detected console folders & per-console disk subfolders
  for (const match of autoConfigResult.matches) {
    const chosenPath = chosenPathBySlug[match.canonicalSlug] || match.recommendedPath;
    const activeCandidate =
      match.candidates.find((c) => c.relativePath === chosenPath) ?? match.candidates[0];
    if (!activeCandidate) continue;

    // Tier 1 (explicit manual base folder) always wins over Tier 2 (auto-detected)
    const manualBaseKey = findStoredKeyByDisplayName(match.canonicalSlug, manual.systemFolders);
    const hasManualBase =
      manualBaseKey !== null &&
      (manual.systemFolders[manualBaseKey] ?? '').trim() !== '' &&
      (manual.systemFolders[manualBaseKey] ?? '').trim() !==
        resolveDefaultSystemFolder(match.canonicalSlug);

    if (!hasManualBase) {
      const cleanDetected = sanitizeRelativeStoragePath(activeCandidate.relativePath);
      if (cleanDetected) {
        mergedSystemFolders[match.canonicalSlug.toLowerCase()] = cleanDetected;
      }
    }

    // Tier 1 (explicit manual type override) always wins over Tier 2 detected subfolders
    if (includeTypeSubfolders) {
      const detectedSubs = activeCandidate.detectedTypeSubfolders;
      const detectedKeys = Object.keys(detectedSubs) as StorageRomCategoryKey[];
      if (detectedKeys.length > 0) {
        const manualOverrideKey = findStoredKeyByDisplayName(
          match.canonicalSlug,
          manual.systemTypeOverrides,
        );
        const existingManualOverride =
          manualOverrideKey !== null ? manual.systemTypeOverrides[manualOverrideKey] : undefined;
        const hasManualOverride = Boolean(
          existingManualOverride &&
            (existingManualOverride.mode === 'enabled' ||
              existingManualOverride.mode === 'disabled' ||
              (existingManualOverride.subfolders &&
                Object.keys(existingManualOverride.subfolders).length > 0)),
        );
        if (!hasManualOverride) {
          const perConsoleDiffSubs: Partial<Record<StorageRomCategoryKey, string>> = {};
          for (const cat of detectedKeys) {
            const cleanedSub = sanitizeRelativeStoragePath(detectedSubs[cat] || '');
            if (cleanedSub && cleanedSub !== effectiveGlobalTypeSubfolders[cat]) {
              perConsoleDiffSubs[cat] = cleanedSub;
            }
          }
          if (!effectiveTypeSubfoldersEnabled || Object.keys(perConsoleDiffSubs).length > 0) {
            mergedTypeOverrides[match.canonicalSlug.toLowerCase()] = {
              mode: 'enabled',
              ...(Object.keys(perConsoleDiffSubs).length > 0
                ? { subfolders: perConsoleDiffSubs }
                : {}),
            };
          }
        }
      }
    }
  }

  return {
    typeSubfoldersEnabled: effectiveTypeSubfoldersEnabled,
    globalTypeSubfolders: effectiveGlobalTypeSubfolders,
    systemFolders: mergedSystemFolders,
    systemTypeOverrides: mergedTypeOverrides,
    ...(conventions?.inferredRomRoot
      ? {
          runtimeBaseRomRoot: conventions.inferredRomRoot,
          runtimeConsoleCasing: conventions.inferredConsoleCasing,
        }
      : {}),
  };
}

export function resolveConsolePathSource(
  slug: string,
  savedManualConfig: StorageFolderMappingConfig | null | undefined,
  autoConfigResult: DeviceAutoConfigResult | null | undefined,
  options: ComposeEffectiveFolderOptions = {},
): ConsolePathSource {
  const manual = normalizeStorageFolderConfig(
    savedManualConfig ?? createDefaultStorageFolderConfig(),
  );
  const manualBaseKey = findStoredKeyByDisplayName(slug, manual.systemFolders);
  if (
    manualBaseKey !== null &&
    (manual.systemFolders[manualBaseKey] ?? '').trim() !== '' &&
    (manual.systemFolders[manualBaseKey] ?? '').trim() !== resolveDefaultSystemFolder(slug)
  ) {
    return 'manual';
  }
  const manualOverrideKey = findStoredKeyByDisplayName(slug, manual.systemTypeOverrides);
  const manualOverride =
    manualOverrideKey !== null ? manual.systemTypeOverrides[manualOverrideKey] : undefined;
  if (
    manualOverride &&
    (manualOverride.mode === 'enabled' ||
      manualOverride.mode === 'disabled' ||
      (manualOverride.subfolders && Object.keys(manualOverride.subfolders).length > 0))
  ) {
    return 'manual';
  }
  if (findAutoMatchForSlug(autoConfigResult, slug)) {
    return 'auto';
  }
  const conventions = getEffectiveDeviceConventions(autoConfigResult, options.chosenPathBySlug);
  const includeTypeSubfolders = options.includeTypeSubfolders ?? true;
  if (conventions) {
    const hasRootInference = Boolean(conventions.inferredRomRoot) && !isStandaloneNonRomSlug(slug);
    const hasSubfolderInference = Boolean(
      includeTypeSubfolders && conventions.hasInferredTypeSubfolders,
    );
    if (hasRootInference || hasSubfolderInference) {
      return 'inferred';
    }
  }
  return 'default';
}

export function summarizeDeviceInferredConventions(
  autoConfigResult: DeviceAutoConfigResult | null | undefined,
  options: ComposeEffectiveFolderOptions = {},
): InferredConventionSummary {
  const conventions = getEffectiveDeviceConventions(autoConfigResult, options.chosenPathBySlug);
  if (!conventions) {
    return {
      newConsolePattern: null,
      observedSubfolders: [],
      unseenCasingLabel: null,
      hasAnyInferredConvention: false,
    };
  }

  const includeTypeSubfolders = options.includeTypeSubfolders ?? true;
  const placeholderLeaf =
    conventions.inferredConsoleCasing === 'lower' ? '<system>' : '<SYSTEM>';
  const newConsolePattern = conventions.inferredRomRoot
    ? `/${conventions.inferredRomRoot}/${placeholderLeaf}`
    : null;

  const observedSubfolders: InferredConventionSummary['observedSubfolders'] = [];
  if (includeTypeSubfolders && conventions.hasInferredTypeSubfolders) {
    for (const category of STORAGE_ROM_CATEGORY_KEYS) {
      if (category === 'retail') continue;
      const folder = conventions.inferredTypeSubfolders[category];
      if (folder) {
        observedSubfolders.push({
          category,
          label: getStorageRomCategoryShortLabel(category),
          folder,
        });
      }
    }
  }

  const unseenCasingLabel =
    includeTypeSubfolders && conventions.hasInferredTypeSubfolders
      ? conventions.inferredSubfolderCasing === 'lower'
        ? 'lowercase'
        : conventions.inferredSubfolderCasing === 'upper'
          ? 'UPPERCASE'
          : 'Title Case'
      : null;

  return {
    newConsolePattern,
    observedSubfolders,
    unseenCasingLabel,
    hasAnyInferredConvention: Boolean(newConsolePattern) || observedSubfolders.length > 0,
  };
}

interface SampleGameMetadata {
  systemLabel: string;
  ext: string;
  retailTitle: string;
  retailRegion: string;
  retailInner: string;
  hackTitle: string;
  hackArchive: string;
  hackInner: string;
  translationTitle: string;
  translationDisplay: string;
  translationInner: string;
}

const KNOWN_SAMPLE_GAMES: Record<string, SampleGameMetadata> = {
  'Super Nintendo (SNES)': {
    systemLabel: 'SNES',
    ext: '.sfc',
    retailTitle: 'Super Mario World',
    retailRegion: 'USA',
    retailInner: 'Super Mario World (USA).sfc',
    hackTitle: 'Super Mario World: Return to Dinosaur Land',
    hackArchive: 'SMW_Return_v1.42.7z',
    hackInner: 'smw_rtdl.sfc',
    translationTitle: 'Seiken Densetsu 3',
    translationDisplay: 'Seiken Densetsu 3 English v1.01',
    translationInner: 'sd3_en.sfc',
  },
  'Game Boy Advance (GBA)': {
    systemLabel: 'GBA',
    ext: '.gba',
    retailTitle: 'Metroid Fusion',
    retailRegion: 'USA',
    retailInner: 'Metroid Fusion (USA).gba',
    hackTitle: 'Pokemon Unbound',
    hackArchive: 'Pokemon_Unbound_v2.1.zip',
    hackInner: 'pokemon_unbound.gba',
    translationTitle: 'Mother 3',
    translationDisplay: 'Mother 3 English v1.3',
    translationInner: 'mother3_patched.gba',
  },
  'Nintendo Entertainment System (NES)': {
    systemLabel: 'NES',
    ext: '.nes',
    retailTitle: 'Super Mario Bros. 3',
    retailRegion: 'USA',
    retailInner: 'Super Mario Bros. 3 (USA).nes',
    hackTitle: 'Super Mario Bros. 3Mix',
    hackArchive: 'SMB3Mix_v1.4.zip',
    hackInner: 'smb3mix.nes',
    translationTitle: 'Sweet Home',
    translationDisplay: 'Sweet Home English v1.0',
    translationInner: 'sweet_home_en.nes',
  },
  'Sega Genesis / Mega Drive': {
    systemLabel: 'Genesis',
    ext: '.md',
    retailTitle: 'Sonic the Hedgehog 2',
    retailRegion: 'World',
    retailInner: 'Sonic the Hedgehog 2 (World).md',
    hackTitle: 'Streets of Rage 2: Syndicate Wars',
    hackArchive: 'SOR2_Syndicate_v2.0.zip',
    hackInner: 'sor2_sw.md',
    translationTitle: 'Monster World IV',
    translationDisplay: 'Monster World IV English v1.0',
    translationInner: 'mw4_en.md',
  },
  'PlayStation (PS1)': {
    systemLabel: 'PS1',
    ext: '.chd',
    retailTitle: 'Castlevania: Symphony of the Night',
    retailRegion: 'USA',
    retailInner: 'Castlevania - Symphony of the Night (USA).chd',
    hackTitle: 'Final Fantasy Tactics: The Lion War',
    hackArchive: 'FFT_LionWar_v2.0.7z',
    hackInner: 'fft_lionwar.chd',
    translationTitle: 'Policenauts',
    translationDisplay: 'Policenauts English v1.0',
    translationInner: 'policenauts_en.chd',
  },
  'Game Boy Color': {
    systemLabel: 'GBC',
    ext: '.gbc',
    retailTitle: "The Legend of Zelda: Link's Awakening DX",
    retailRegion: 'USA',
    retailInner: 'Links Awakening DX (USA).gbc',
    hackTitle: 'Pokemon Prism',
    hackArchive: 'Pokemon_Prism_v0.95.zip',
    hackInner: 'pokemon_prism.gbc',
    translationTitle: 'Survival Kids 2',
    translationDisplay: 'Survival Kids 2 English v1.0',
    translationInner: 'survival_kids_2_en.gbc',
  },
  'Game Boy': {
    systemLabel: 'GB',
    ext: '.gb',
    retailTitle: 'Tetris',
    retailRegion: 'World',
    retailInner: 'Tetris (World).gb',
    hackTitle: 'Super Mario Land DX',
    hackArchive: 'SML_DX_v2.0.zip',
    hackInner: 'sml_dx.gb',
    translationTitle: 'For the Frog the Bell Tolls',
    translationDisplay: 'Frog Bell Tolls English v1.1',
    translationInner: 'frog_bell_en.gb',
  },
  'Nintendo 64 (N64)': {
    systemLabel: 'N64',
    ext: '.z64',
    retailTitle: 'Super Mario 64',
    retailRegion: 'USA',
    retailInner: 'Super Mario 64 (USA).z64',
    hackTitle: 'Super Mario 64: Star Road',
    hackArchive: 'SM64_StarRoad_v1.2.zip',
    hackInner: 'sm64_starroad.z64',
    translationTitle: 'Sin and Punishment',
    translationDisplay: 'Sin and Punishment English v1.0',
    translationInner: 'sin_punishment_en.z64',
  },
};

function getSampleMetaForSlug(slug: string): SampleGameMetadata {
  const info = resolveSystemDisplayInfo(slug);
  const known = KNOWN_SAMPLE_GAMES[info.displayName];
  if (known) return known;
  return {
    systemLabel: info.displayName,
    ext: '.rom',
    retailTitle: `${info.displayName} Classic`,
    retailRegion: 'USA',
    retailInner: 'classic_title.rom',
    hackTitle: `${info.displayName} Remix`,
    hackArchive: 'remix_v1.0.zip',
    hackInner: 'remix_v10.rom',
    translationTitle: `${info.displayName} Chronicles`,
    translationDisplay: `${info.displayName} Chronicles English v1.0`,
    translationInner: 'chronicles_en.rom',
  };
}

export interface LiveExportPreviewContext {
  savedManualConfig?: StorageFolderMappingConfig | null;
  autoConfigResult?: DeviceAutoConfigResult | null;
  chosenPathBySlug?: Readonly<Record<string, string>>;
  includeTypeSubfolders?: boolean;
}

const NEW_CONSOLE_PREVIEW_CANDIDATES: readonly string[] = [
  'n64-roms',
  'gba-roms',
  'psx-iso',
  'snes-roms',
  'nes-roms',
  'genesis-roms',
  'gbc-roms',
  'gb-roms',
  'nds-roms',
];

export function buildLiveExportDestinations(
  effectiveFolderConfig: StorageFolderMappingConfig,
  namingConfig: RomNamingConfig,
  context: LiveExportPreviewContext = {},
): LiveExportDestinationSample[] {
  const savedManual = context.savedManualConfig ?? effectiveFolderConfig;
  const autoResult = context.autoConfigResult ?? null;
  const resolveOpts: ComposeEffectiveFolderOptions = {
    chosenPathBySlug: context.chosenPathBySlug,
    includeTypeSubfolders: context.includeTypeSubfolders,
  };

  let retailSlug = 'snes-roms';
  let hackSlug = 'snes-roms';
  let translationSlug = 'gba-roms';

  if (autoResult && autoResult.matches.length > 0) {
    // Prefer classic recognizable platforms detected on the mounted device
    const priorityOrder = [
      'Super Nintendo (SNES)',
      'Game Boy Advance (GBA)',
      'Nintendo Entertainment System (NES)',
      'Sega Genesis / Mega Drive',
      'PlayStation (PS1)',
      'Game Boy Color',
      'Game Boy',
      'Nintendo 64 (N64)',
    ];
    const rankedMatches = [...autoResult.matches].sort((a, b) => {
      const aPri = priorityOrder.indexOf(a.displayName);
      const bPri = priorityOrder.indexOf(b.displayName);
      if (aPri !== -1 && bPri !== -1) return aPri - bPri;
      if (aPri !== -1) return -1;
      if (bPri !== -1) return 1;
      return b.candidates[0]!.fileCount - a.candidates[0]!.fileCount;
    });

    const primary = rankedMatches[0]!;
    const secondary = rankedMatches[1] ?? primary;
    const hackPreferred =
      rankedMatches.find((m) => Boolean(m.detectedTypeSubfolders.hack)) ?? primary;
    const translationPreferred =
      rankedMatches.find((m) => Boolean(m.detectedTypeSubfolders.translations)) ?? secondary;

    retailSlug = primary.canonicalSlug;
    hackSlug = hackPreferred.canonicalSlug;
    translationSlug = translationPreferred.canonicalSlug;
  }

  const retailMeta = getSampleMetaForSlug(retailSlug);
  const hackMeta = getSampleMetaForSlug(hackSlug);
  const translationMeta = getSampleMetaForSlug(translationSlug);

  const retailFolder = resolveTargetStorageFolder(retailSlug, 'retail', effectiveFolderConfig);
  const retailFile = formatPreparedRomName(
    {
      title: retailMeta.retailTitle,
      systemName: retailSlug,
      regions: [retailMeta.retailRegion],
      fileRole: 'ROM',
      innerFilename: retailMeta.retailInner,
    },
    retailMeta.ext,
    namingConfig,
  );

  const hackFolder = resolveTargetStorageFolder(hackSlug, 'hack', effectiveFolderConfig);
  const hackFile = formatPreparedRomName(
    {
      title: hackMeta.hackTitle,
      systemName: hackSlug,
      regions: ['USA'],
      fileRole: 'Hack',
      archiveFilename: hackMeta.hackArchive,
      innerFilename: hackMeta.hackInner,
    },
    hackMeta.ext,
    namingConfig,
  );

  const translationFolder = resolveTargetStorageFolder(
    translationSlug,
    'translations',
    effectiveFolderConfig,
  );
  const translationFile = formatPreparedRomName(
    {
      title: translationMeta.translationTitle,
      systemName: translationSlug,
      regions: ['Japan'],
      fileRole: 'English Translation',
      displayLabel: translationMeta.translationDisplay,
      innerFilename: translationMeta.translationInner,
    },
    translationMeta.ext,
    namingConfig,
  );

  const samples: LiveExportDestinationSample[] = [
    {
      id: 'retail',
      label: 'Retail ROM',
      systemSlug: retailSlug,
      systemLabel: retailMeta.systemLabel,
      folderPath: retailFolder,
      filename: retailFile,
      fullPath: `/${retailFolder}/${retailFile}`,
      source: resolveConsolePathSource(retailSlug, savedManual, autoResult, resolveOpts),
    },
    {
      id: 'hack',
      label: 'ROM Hack',
      systemSlug: hackSlug,
      systemLabel: hackMeta.systemLabel,
      folderPath: hackFolder,
      filename: hackFile,
      fullPath: `/${hackFolder}/${hackFile}`,
      source: resolveConsolePathSource(hackSlug, savedManual, autoResult, resolveOpts),
    },
    {
      id: 'translation',
      label: 'Translation',
      systemSlug: translationSlug,
      systemLabel: translationMeta.systemLabel,
      folderPath: translationFolder,
      filename: translationFile,
      fullPath: `/${translationFolder}/${translationFile}`,
      source: resolveConsolePathSource(translationSlug, savedManual, autoResult, resolveOpts),
    },
  ];

  // When a mounted device has an inferred ROM root or subfolder convention, add a 4th row
  // demonstrating exactly where a brand-new (not yet present) console will be created automatically.
  const conventions = getEffectiveDeviceConventions(autoResult, context.chosenPathBySlug);
  const includeTypeSubfolders = context.includeTypeSubfolders ?? true;
  const hasActiveSubfolderInference = Boolean(
    includeTypeSubfolders && conventions?.hasInferredTypeSubfolders,
  );
  if (conventions && (conventions.inferredRomRoot || hasActiveSubfolderInference)) {
    const newConsoleSlug =
      NEW_CONSOLE_PREVIEW_CANDIDATES.find((slug) => !findAutoMatchForSlug(autoResult, slug)) ??
      'n64-roms';
    const newMeta = getSampleMetaForSlug(newConsoleSlug);
    const showHomebrewExample =
      hasActiveSubfolderInference && !conventions.inferredTypeSubfolders.homebrew;
    const category: StorageRomCategoryKey = hasActiveSubfolderInference
      ? showHomebrewExample
        ? 'homebrew'
        : 'hack'
      : 'retail';

    const newFolder = resolveTargetStorageFolder(newConsoleSlug, category, effectiveFolderConfig);
    const newFile =
      category === 'homebrew'
        ? formatPreparedRomName(
            {
              title: `${newMeta.systemLabel} Homebrew Demo`,
              systemName: newConsoleSlug,
              regions: ['World'],
              fileRole: 'Homebrew',
              innerFilename: `${newMeta.systemLabel.toLowerCase()}_homebrew${newMeta.ext}`,
            },
            newMeta.ext,
            namingConfig,
          )
        : category === 'hack'
          ? formatPreparedRomName(
              {
                title: newMeta.hackTitle,
                systemName: newConsoleSlug,
                regions: ['USA'],
                fileRole: 'Hack',
                archiveFilename: newMeta.hackArchive,
                innerFilename: newMeta.hackInner,
              },
              newMeta.ext,
              namingConfig,
            )
          : formatPreparedRomName(
              {
                title: newMeta.retailTitle,
                systemName: newConsoleSlug,
                regions: [newMeta.retailRegion],
                fileRole: 'ROM',
                innerFilename: newMeta.retailInner,
              },
              newMeta.ext,
              namingConfig,
            );

    samples.push({
      id: 'new_console',
      label: 'New console',
      systemSlug: newConsoleSlug,
      systemLabel:
        category === 'homebrew'
          ? `${newMeta.systemLabel} · Homebrew`
          : category === 'hack'
            ? `${newMeta.systemLabel} · Hack`
            : newMeta.systemLabel,
      folderPath: newFolder,
      filename: newFile,
      fullPath: `/${newFolder}/${newFile}`,
      source: resolveConsolePathSource(newConsoleSlug, savedManual, autoResult, resolveOpts),
    });
  }

  return samples;
}

export function getActiveManualOverrideSlugs(
  savedManualConfig: StorageFolderMappingConfig,
): string[] {
  const seenDisplayNames = new Set<string>();
  const result: string[] = [];

  const maybeAdd = (slug: string) => {
    const lower = slug.toLowerCase();
    const displayName = resolveSystemDisplayInfo(lower).displayName;
    if (seenDisplayNames.has(displayName)) return;
    seenDisplayNames.add(displayName);
    result.push(lower);
  };

  for (const [slug, folder] of Object.entries(savedManualConfig.systemFolders)) {
    if (folder.trim() && folder.trim() !== resolveDefaultSystemFolder(slug)) {
      maybeAdd(slug);
    }
  }
  for (const [slug, override] of Object.entries(savedManualConfig.systemTypeOverrides)) {
    const hasMode = override.mode === 'enabled' || override.mode === 'disabled';
    const hasSubs = override.subfolders && Object.keys(override.subfolders).length > 0;
    if (hasMode || hasSubs) {
      maybeAdd(slug);
    }
  }

  return result.sort((a, b) =>
    resolveSystemDisplayInfo(a).displayName.localeCompare(
      resolveSystemDisplayInfo(b).displayName,
    ),
  );
}

export interface ConsoleOverrideSearchOption {
  slug: string;
  displayName: string;
  brandLabel: string;
  effectiveBasePath: string;
  isAlreadyActive: boolean;
}

export function searchConsolesForOverride(
  allConsoleSlugs: readonly string[],
  query: string,
  activeSlugs: ReadonlySet<string>,
  effectiveFolderConfig: StorageFolderMappingConfig,
  limit = 24,
): ConsoleOverrideSearchOption[] {
  const q = query.trim().toLowerCase();
  const activeDisplayNames = new Set<string>();
  for (const slug of activeSlugs) {
    activeDisplayNames.add(resolveSystemDisplayInfo(slug).displayName);
  }

  const matched: ConsoleOverrideSearchOption[] = [];
  for (const slug of allConsoleSlugs) {
    const info = resolveSystemDisplayInfo(slug);
    const effectiveBasePath = resolveBaseSystemFolder(slug, effectiveFolderConfig);
    if (q) {
      const hit =
        info.displayName.toLowerCase().includes(q) ||
        info.slug.toLowerCase().includes(q) ||
        info.brandLabel.toLowerCase().includes(q) ||
        info.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
        effectiveBasePath.toLowerCase().includes(q);
      if (!hit) continue;
    }
    matched.push({
      slug,
      displayName: info.displayName,
      brandLabel: info.brandLabel,
      effectiveBasePath,
      isAlreadyActive: activeDisplayNames.has(info.displayName),
    });
    if (matched.length >= limit) break;
  }

  return matched;
}

export function findActiveNamingPreset(template: string): NamingPresetOption | null {
  const normalized = template.trim() || DEFAULT_ROM_NAMING_TEMPLATE;
  return ROM_NAMING_PRESETS.find((preset) => preset.template === normalized) ?? null;
}

export function shouldAutoExpandAdvancedNaming(namingConfig: RomNamingConfig): boolean {
  const activePreset = findActiveNamingPreset(namingConfig.romNamingTemplate);
  const overrideCount = Object.values(namingConfig.romNamingTypeOverrides || {}).filter(
    (v) => typeof v === 'string' && v.trim().length > 0,
  ).length;
  return (
    activePreset === null ||
    overrideCount > 0 ||
    !namingConfig.romSanitizeFat32 ||
    namingConfig.romMaxFilenameLen > 0
  );
}

export function summarizeNamingOptions(namingConfig: RomNamingConfig): string {
  const parts: string[] = [];
  const overrideCount = Object.values(namingConfig.romNamingTypeOverrides || {}).filter(
    (v) => typeof v === 'string' && v.trim().length > 0,
  ).length;
  parts.push(namingConfig.romSanitizeFat32 ? 'FAT32 safe' : 'Raw characters');
  parts.push(
    namingConfig.romMaxFilenameLen > 0
      ? `Max ${namingConfig.romMaxFilenameLen} chars`
      : 'Unlimited length',
  );
  if (overrideCount > 0) {
    parts.push(`${overrideCount} type override${overrideCount === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

export function appendNamingToken(currentTemplate: string, token: string): string {
  const trimmed = currentTemplate;
  if (!trimmed) return token;
  return `${trimmed}${token}`;
}

export function insertNamingTokenAtSelection(
  currentTemplate: string,
  token: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): { value: string; caret: number } {
  const safeStart =
    typeof selectionStart === 'number' && Number.isFinite(selectionStart)
      ? Math.max(0, Math.min(currentTemplate.length, selectionStart))
      : currentTemplate.length;
  const safeEnd =
    typeof selectionEnd === 'number' && Number.isFinite(selectionEnd)
      ? Math.max(safeStart, Math.min(currentTemplate.length, selectionEnd))
      : safeStart;
  const nextValue = `${currentTemplate.slice(0, safeStart)}${token}${currentTemplate.slice(safeEnd)}`;
  return {
    value: nextValue,
    caret: safeStart + token.length,
  };
}

export interface EvaluatedScanMatch {
  match: DiscoveredConsoleMapping;
  activeCandidate: DiscoveredConsoleCandidate;
  diff: AutoConfigConsoleDiff;
  detectedSubEntries: [StorageRomCategoryKey, string][];
}

export interface ScanReviewSummary {
  rows: EvaluatedScanMatch[];
  bySlug: Map<string, EvaluatedScanMatch>;
  byDisplayName: Map<string, EvaluatedScanMatch>;
  counts: {
    total: number;
    newCount: number;
    updatesCustomCount: number;
    unchangedCount: number;
    actionableCount: number;
    withSubfoldersCount: number;
    selectedWithSubfoldersCount: number;
  };
}

export function buildScanReviewSummary(
  result: DeviceAutoConfigResult,
  currentConfig: StorageFolderMappingConfig,
  selectedSlugs: ReadonlySet<string>,
  chosenPathBySlug: Readonly<Record<string, string>>,
  includeTypeSubfolders: boolean,
): ScanReviewSummary {
  const rows: EvaluatedScanMatch[] = [];
  const bySlug = new Map<string, EvaluatedScanMatch>();
  const byDisplayName = new Map<string, EvaluatedScanMatch>();

  let newCount = 0;
  let updatesCustomCount = 0;
  let unchangedCount = 0;
  let withSubfoldersCount = 0;
  let selectedWithSubfoldersCount = 0;

  for (const match of result.matches) {
    const chosenPath = chosenPathBySlug[match.canonicalSlug] || match.recommendedPath;
    const activeCandidate =
      match.candidates.find((c) => c.relativePath === chosenPath) ?? match.candidates[0]!;
    const diff = classifyDiscoveredConsoleDiff(
      match.canonicalSlug,
      activeCandidate.relativePath,
      activeCandidate.detectedTypeSubfolders,
      includeTypeSubfolders,
      currentConfig,
    );
    const detectedSubEntries = Object.entries(activeCandidate.detectedTypeSubfolders) as [
      StorageRomCategoryKey,
      string,
    ][];

    if (diff.kind === 'new') newCount += 1;
    else if (diff.kind === 'updates_custom') updatesCustomCount += 1;
    else unchangedCount += 1;

    if (detectedSubEntries.length > 0) {
      withSubfoldersCount += 1;
      if (selectedSlugs.has(match.canonicalSlug)) {
        selectedWithSubfoldersCount += 1;
      }
    }

    const evaluated: EvaluatedScanMatch = {
      match,
      activeCandidate,
      diff,
      detectedSubEntries,
    };
    rows.push(evaluated);
    bySlug.set(match.canonicalSlug.toLowerCase(), evaluated);
    bySlug.set(canonicalizeSystemSlug(match.canonicalSlug).toLowerCase(), evaluated);
    byDisplayName.set(match.displayName, evaluated);
  }

  return {
    rows,
    bySlug,
    byDisplayName,
    counts: {
      total: rows.length,
      newCount,
      updatesCustomCount,
      unchangedCount,
      actionableCount: newCount + updatesCustomCount,
      withSubfoldersCount,
      selectedWithSubfoldersCount,
    },
  };
}

export function findEvaluatedScanMatch(
  summary: ScanReviewSummary | null,
  slug: string,
): EvaluatedScanMatch | null {
  if (!summary) return null;
  const lower = slug.toLowerCase();
  const direct = summary.bySlug.get(lower);
  if (direct) return direct;
  const canonical = canonicalizeSystemSlug(lower).toLowerCase();
  const byCanonical = summary.bySlug.get(canonical);
  if (byCanonical) return byCanonical;
  const displayName = resolveSystemDisplayInfo(lower).displayName;
  return summary.byDisplayName.get(displayName) ?? null;
}

/**
 * Excludes any scanned folders that the user has explicitly mapped via manual console overrides
 * (global or per-device profile), accounting for case differences and optional ROM root prefixes.
 */
export function filterUnmatchedDeviceFolders(
  unmatchedFolders: readonly string[] | null | undefined,
  folderConfig: StorageFolderMappingConfig | null | undefined,
  detectedRomRoot?: string | null,
): string[] {
  if (!unmatchedFolders || unmatchedFolders.length === 0) return [];
  if (!folderConfig?.systemFolders) return [...unmatchedFolders];

  const mappedLower = new Set<string>();
  const romRoot = sanitizeRelativeStoragePath(
    detectedRomRoot || folderConfig.runtimeBaseRomRoot || '',
  );
  const romRootLowerPrefix = romRoot ? `${romRoot.toLowerCase()}/` : '';

  for (const rawPath of Object.values(folderConfig.systemFolders)) {
    const clean = sanitizeRelativeStoragePath(rawPath || '');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    mappedLower.add(lower);

    // If user typed "THIRTYTWOX" while device nests under "Roms/THIRTYTWOX", recognize both
    if (romRoot && !lower.startsWith(romRootLowerPrefix)) {
      mappedLower.add(`${romRoot.toLowerCase()}/${lower}`);
    }
    // Conversely, if user typed "Roms/THIRTYTWOX" while mounted directly inside Roms/ ("THIRTYTWOX")
    if (romRootLowerPrefix && lower.startsWith(romRootLowerPrefix)) {
      const stripped = lower.slice(romRootLowerPrefix.length);
      if (stripped) mappedLower.add(stripped);
    } else if (lower.startsWith('roms/')) {
      const stripped = lower.slice('roms/'.length);
      if (stripped) mappedLower.add(stripped);
    }
  }

  return unmatchedFolders.filter((folder) => {
    const clean = sanitizeRelativeStoragePath(folder);
    if (!clean) return false;
    return !mappedLower.has(clean.toLowerCase());
  });
}
