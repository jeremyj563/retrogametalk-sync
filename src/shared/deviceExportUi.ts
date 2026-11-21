import {
  DEFAULT_ROM_NAMING_TEMPLATE,
  formatPreparedRomName,
  ROM_NAMING_PRESETS,
  type NamingPresetOption,
  type RomNamingConfig,
} from './romNaming.ts';
import {
  classifyDiscoveredConsoleDiff,
  type AutoConfigConsoleDiff,
  type DeviceAutoConfigResult,
  type DiscoveredConsoleCandidate,
  type DiscoveredConsoleMapping,
} from './storageAutoConfig.ts';
import {
  resolveTargetStorageFolder,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
} from './storageFolderMappings.ts';
import { canonicalizeSystemSlug, resolveSystemDisplayInfo } from './systemCatalog.ts';

export interface NamingTokenHelper {
  token: string;
  label: string;
}

export const ROM_NAMING_TOKEN_HELPERS: readonly NamingTokenHelper[] = [
  { token: '{title}', label: 'Game title' },
  { token: '{regionParen}', label: '(Region)' },
  { token: '{tagBracket}', label: '[Role Version]' },
  { token: '{roleDash}', label: '- Role Version' },
  { token: '{role}', label: 'Role only' },
  { token: '{version}', label: 'Version only' },
  { token: '{origName}', label: 'Original inner filename' },
];

export interface LiveExportDestinationSample {
  id: 'retail' | 'hack' | 'translation';
  label: string;
  systemLabel: string;
  folderPath: string;
  filename: string;
  fullPath: string;
}

export function buildLiveExportDestinations(
  storageFolderConfig: StorageFolderMappingConfig,
  namingConfig: RomNamingConfig,
): LiveExportDestinationSample[] {
  const retailFolder = resolveTargetStorageFolder('snes-roms', 'retail', storageFolderConfig);
  const retailFile = formatPreparedRomName(
    {
      title: 'Super Mario World',
      systemName: 'snes-roms',
      regions: ['USA'],
      fileRole: 'ROM',
      innerFilename: 'Super Mario World (USA).sfc',
    },
    '.sfc',
    namingConfig,
  );

  const hackFolder = resolveTargetStorageFolder('snes-roms', 'hack', storageFolderConfig);
  const hackFile = formatPreparedRomName(
    {
      title: 'Super Mario World: Return to Dinosaur Land',
      systemName: 'snes-roms',
      regions: ['USA'],
      fileRole: 'Hack',
      archiveFilename: 'SMW_Return_v1.42.7z',
      innerFilename: 'smw_rtdl.sfc',
    },
    '.sfc',
    namingConfig,
  );

  const translationFolder = resolveTargetStorageFolder(
    'gba-roms',
    'translations',
    storageFolderConfig,
  );
  const translationFile = formatPreparedRomName(
    {
      title: 'Mother 3',
      systemName: 'gba-roms',
      regions: ['Japan'],
      fileRole: 'English Translation',
      displayLabel: 'Mother 3 English v1.3',
      innerFilename: 'mother3_patched.gba',
    },
    '.gba',
    namingConfig,
  );

  return [
    {
      id: 'retail',
      label: 'Retail ROM',
      systemLabel: 'SNES',
      folderPath: retailFolder,
      filename: retailFile,
      fullPath: `/${retailFolder}/${retailFile}`,
    },
    {
      id: 'hack',
      label: 'ROM Hack',
      systemLabel: 'SNES',
      folderPath: hackFolder,
      filename: hackFile,
      fullPath: `/${hackFolder}/${hackFile}`,
    },
    {
      id: 'translation',
      label: 'Translation',
      systemLabel: 'GBA',
      folderPath: translationFolder,
      filename: translationFile,
      fullPath: `/${translationFolder}/${translationFile}`,
    },
  ];
}

export function findActiveNamingPreset(template: string): NamingPresetOption | null {
  const normalized = template.trim() || DEFAULT_ROM_NAMING_TEMPLATE;
  return ROM_NAMING_PRESETS.find((preset) => preset.template === normalized) ?? null;
}

export function shouldAutoExpandAdvancedNaming(namingConfig: RomNamingConfig): boolean {
  const activePreset = findActiveNamingPreset(namingConfig.romNamingTemplate);
  return (
    activePreset === null ||
    !namingConfig.romSanitizeFat32 ||
    namingConfig.romMaxFilenameLen > 0
  );
}

export function summarizeNamingOptions(namingConfig: RomNamingConfig): string {
  const parts: string[] = [];
  parts.push(namingConfig.romSanitizeFat32 ? 'FAT32 safe' : 'Raw characters');
  parts.push(
    namingConfig.romMaxFilenameLen > 0
      ? `Max ${namingConfig.romMaxFilenameLen} chars`
      : 'Unlimited length',
  );
  return parts.join(' · ');
}

export function appendNamingToken(currentTemplate: string, token: string): string {
  const trimmed = currentTemplate;
  if (!trimmed) return token;
  return `${trimmed}${token}`;
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
