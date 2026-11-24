import {
  sanitizeInstalledRelativePath,
  type DeviceUninstallTargetRecord,
} from '../shared/deviceProfiles.ts';
import { IGNORED_SCAN_DIRECTORY_NAMES } from '../shared/storageAutoConfig.ts';
import {
  STORAGE_ROM_CATEGORY_KEYS,
  classifyStorageRomCategory,
  resolveBaseSystemFolder,
  resolveTargetStorageFolder,
  type StorageFolderMappingConfig,
} from '../shared/storageFolderMappings.ts';
import {
  findMatchingRomEntriesInScan,
  removeRelativePathFromSdCard,
  resolveOrCreateSubdirectory,
  scanTargetFolder,
  unregisterEntryInScan,
  type SdDirectoryHandle,
  type SdScanFolderResult,
} from './sdCardFs.ts';

export interface DeviceUninstallBatchProgress {
  completed: number;
  total: number;
  filesRemoved: number;
  canceling: boolean;
}

export interface DeviceUninstallBatchOutcome {
  clearedIds: number[];
  filesRemovedCount: number;
  missingOnDiskCount: number;
  errors: string[];
  removedScanEntries: Array<{ folderRel: string; leafName: string }>;
  canceled: boolean;
  totalRequested: number;
  checkedFolders: string[];
}

function splitParentAndLeaf(cleanPath: string): { folderRel: string; leafName: string } {
  const slashIdx = cleanPath.lastIndexOf('/');
  const folderRel = slashIdx > 0 ? cleanPath.slice(0, slashIdx) : '';
  const leafName = slashIdx >= 0 ? cleanPath.slice(slashIdx + 1) : cleanPath;
  return { folderRel, leafName };
}

function buildRecordedPathVariants(
  rawPath: string,
  rootHandleName: string,
  storageCfg: StorageFolderMappingConfig,
): string[] {
  const clean = sanitizeInstalledRelativePath(rawPath);
  if (!clean) return [];

  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | null) => {
    if (!candidate) return;
    const sanitized = sanitizeInstalledRelativePath(candidate);
    if (!sanitized) return;
    const key = sanitized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(sanitized);
    }
  };

  add(clean);

  const segments = clean.split('/');
  const firstLower = (segments[0] || '').toLowerCase();
  const rootNameLower = (rootHandleName || '').trim().toLowerCase();
  const runtimeRoot = (storageCfg.runtimeBaseRomRoot || '').trim().replace(/^\/+|\/+$/g, '');

  // If recorded path includes a leading Roms/ or mounted root folder prefix that is already the mount root, try stripping it
  if (
    segments.length > 1 &&
    (firstLower === 'roms' ||
      (rootNameLower && firstLower === rootNameLower) ||
      (runtimeRoot && firstLower === runtimeRoot.toLowerCase()))
  ) {
    add(segments.slice(1).join('/'));
  }

  // If mounted at card root while path was recorded relative to Roms/, try prepending runtimeBaseRomRoot / Roms
  if (runtimeRoot && firstLower !== runtimeRoot.toLowerCase()) {
    add(`${runtimeRoot}/${clean}`);
  }
  if (firstLower !== 'roms') {
    add(`Roms/${clean}`);
  }

  return variants;
}

function buildBaseFolderDepthVariants(
  baseFolder: string,
  rootHandleName: string,
  storageCfg: StorageFolderMappingConfig,
): string[] {
  const cleanBase = sanitizeInstalledRelativePath(baseFolder);
  if (!cleanBase) return [];

  const bases: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | null) => {
    if (!candidate) return;
    const sanitized = sanitizeInstalledRelativePath(candidate);
    if (!sanitized) return;
    const key = sanitized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      bases.push(sanitized);
    }
  };

  add(cleanBase);

  const segments = cleanBase.split('/');
  const firstLower = (segments[0] || '').toLowerCase();
  const rootNameLower = (rootHandleName || '').trim().toLowerCase();
  const runtimeRoot = (storageCfg.runtimeBaseRomRoot || '').trim().replace(/^\/+|\/+$/g, '');

  if (
    segments.length > 1 &&
    (firstLower === 'roms' ||
      (rootNameLower && firstLower === rootNameLower) ||
      (runtimeRoot && firstLower === runtimeRoot.toLowerCase()))
  ) {
    add(segments.slice(1).join('/'));
  }

  if (runtimeRoot && firstLower !== runtimeRoot.toLowerCase()) {
    add(`${runtimeRoot}/${cleanBase}`);
  }
  if (firstLower !== 'roms') {
    add(`Roms/${cleanBase}`);
  }

  return bases;
}

const EMPTY_SCAN: SdScanFolderResult = {
  exactNames: new Set(),
  exactNamesLower: new Map(),
  entries: [],
};

export async function executeDeviceUninstallBatch(options: {
  targets: DeviceUninstallTargetRecord[];
  rootHandle: SdDirectoryHandle;
  storageCfg: StorageFolderMappingConfig;
  signal?: AbortSignal;
  onProgress?: (progress: DeviceUninstallBatchProgress) => void;
  onDebug?: (msg: string, detail?: string) => void;
}): Promise<DeviceUninstallBatchOutcome> {
  const { targets, rootHandle, storageCfg, signal, onProgress, onDebug } = options;
  const actuallyRemovedIds: number[] = [];
  const missingOnlyIds: number[] = [];
  const errors: string[] = [];
  const removedScanEntries: Array<{ folderRel: string; leafName: string }> = [];
  const checkedFoldersOrder: string[] = [];
  const checkedFoldersSeen = new Set<string>();
  let filesRemovedCount = 0;
  let missingOnDiskCount = 0;
  let canceled = false;

  const noteCheckedFolder = (folderRel: string) => {
    const clean = sanitizeInstalledRelativePath(folderRel);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!checkedFoldersSeen.has(key)) {
      checkedFoldersSeen.add(key);
      checkedFoldersOrder.push(clean);
    }
  };

  if (targets.length === 0) {
    return {
      clearedIds: [],
      filesRemovedCount,
      missingOnDiskCount,
      errors,
      removedScanEntries,
      canceled: Boolean(signal?.aborted),
      totalRequested: 0,
      checkedFolders: [],
    };
  }

  // Per-batch caches so large bulk uninstalls scan each console folder & child subfolder at most once
  const folderScanCache = new Map<string, { exists: boolean; scan: SdScanFolderResult }>();
  const systemCandidateFoldersCache = new Map<string, string[]>();

  const getOrScanFolder = async (
    folderRel: string,
  ): Promise<{ exists: boolean; scan: SdScanFolderResult }> => {
    const clean = sanitizeInstalledRelativePath(folderRel);
    if (!clean) return { exists: false, scan: EMPTY_SCAN };
    const key = clean.toLowerCase();
    const cached = folderScanCache.get(key);
    if (cached) return cached;

    const dir = await resolveOrCreateSubdirectory(rootHandle, clean, false);
    if (!dir) {
      const miss = { exists: false, scan: EMPTY_SCAN };
      folderScanCache.set(key, miss);
      return miss;
    }

    const scan = await scanTargetFolder(rootHandle, clean);
    const hit = { exists: true, scan };
    folderScanCache.set(key, hit);
    noteCheckedFolder(clean);
    return hit;
  };

  const getCandidateFoldersForSystem = async (systemName: string): Promise<string[]> => {
    const sysKey = (systemName || '').trim().toLowerCase();
    const cached = systemCandidateFoldersCache.get(sysKey);
    if (cached) return cached;

    const discovered: string[] = [];
    const seen = new Set<string>();
    const addFolder = (folderRel: string) => {
      const clean = sanitizeInstalledRelativePath(folderRel);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        discovered.push(clean);
      }
    };

    const baseFolder = resolveBaseSystemFolder(systemName, storageCfg);
    const baseVariants = buildBaseFolderDepthVariants(baseFolder, rootHandle.name, storageCfg);

    // 1. Discover real folders & live child subfolders (e.g. SFC, SFC/trans, SFC/hacks, Roms/SFC/trans)
    for (const candidateBase of baseVariants) {
      const dir = await resolveOrCreateSubdirectory(rootHandle, candidateBase, false);
      if (!dir) continue;
      addFolder(candidateBase);
      try {
        for await (const entry of dir.values()) {
          if (entry.kind !== 'directory') continue;
          const childName = entry.name.trim();
          if (!childName || childName.startsWith('.')) continue;
          if (IGNORED_SCAN_DIRECTORY_NAMES.has(childName.toLowerCase())) continue;
          addFolder(`${candidateBase}/${childName}`);
        }
      } catch {
        // Ignore directory listing failures on individual subfolders
      }
    }

    // 2. Include all configured category subfolders as fallback targets
    for (const catKey of STORAGE_ROM_CATEGORY_KEYS) {
      const configured = resolveTargetStorageFolder(systemName, catKey, storageCfg);
      addFolder(configured);
    }

    // 3. Always include primary base folder for diagnostics even if absent on disk
    addFolder(baseFolder);

    systemCandidateFoldersCache.set(sysKey, discovered);
    return discovered;
  };

  let lastProgressEmitMs = 0;
  let lastYieldMs = Date.now();

  for (let idx = 0; idx < targets.length; idx += 1) {
    if (signal?.aborted) {
      canceled = true;
      break;
    }

    // Periodically yield a macrotask so browser click events (e.g. Cancel button) are never starved
    const nowBeforeItem = Date.now();
    if (idx > 0 && nowBeforeItem - lastYieldMs >= 32) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYieldMs = Date.now();
      if (signal?.aborted) {
        canceled = true;
        break;
      }
    }

    const target = targets[idx];
    const recordedPaths = target.installedPaths || [];
    let itemHadError = false;
    let filesRemovedForItem = 0;
    const recordedLeafNames: string[] = [];

    // Step 1: Attempt exact recorded paths (plus mount-depth variants if root depth shifted)
    if (recordedPaths.length > 0) {
      for (const relPath of recordedPaths) {
        const cleanOrig = sanitizeInstalledRelativePath(relPath);
        if (cleanOrig) {
          const { folderRel, leafName } = splitParentAndLeaf(cleanOrig);
          if (folderRel) noteCheckedFolder(folderRel);
          if (leafName) recordedLeafNames.push(leafName);
        }

        const pathVariants = buildRecordedPathVariants(relPath, rootHandle.name, storageCfg);
        if (pathVariants.length === 0) {
          itemHadError = true;
          errors.push(`${target.title}: Refused to remove unsafe or empty relative path`);
          continue;
        }

        let removedThisPath = false;
        for (const variantPath of pathVariants) {
          const res = await removeRelativePathFromSdCard(rootHandle, variantPath, onDebug);
          if (res.status === 'removed') {
            removedThisPath = true;
            filesRemovedCount += 1;
            filesRemovedForItem += 1;
            const { folderRel, leafName } = splitParentAndLeaf(res.path);
            if (folderRel && leafName) {
              removedScanEntries.push({ folderRel, leafName });
              const cachedFolder = folderScanCache.get(folderRel.toLowerCase());
              if (cachedFolder?.exists) {
                unregisterEntryInScan(cachedFolder.scan, leafName);
              }
            }
            break;
          }
          if (res.status === 'error' || res.status === 'invalid') {
            itemHadError = true;
            errors.push(`${target.title}: ${res.error || `Failed removing ${variantPath}`}`);
            break;
          }
        }

        if (!removedThisPath && itemHadError) {
          break;
        }
      }
    }

    // Step 2: Cached console-tree fallback for legacy installs (no recorded paths)
    // OR when all recorded paths returned not_found (e.g. moved subfolder / renamed / mount-depth change)
    if (!itemHadError && filesRemovedForItem === 0) {
      const primaryCategory = classifyStorageRomCategory({
        systemName: target.systemName,
        releaseTags: target.releaseTags,
      });
      const primaryFolder = resolveTargetStorageFolder(
        target.systemName,
        primaryCategory,
        storageCfg,
      );
      noteCheckedFolder(primaryFolder);

      const allSystemFolders = await getCandidateFoldersForSystem(target.systemName);
      const primaryLower = primaryFolder.toLowerCase();
      const orderedFolders = [
        ...allSystemFolders.filter((f) => f.toLowerCase() === primaryLower),
        ...allSystemFolders.filter((f) => f.toLowerCase() !== primaryLower),
      ];

      const candidateNames = [
        target.installedFilename,
        target.fallbackFilename,
        ...recordedLeafNames,
      ];

      for (const folderRel of orderedFolders) {
        const folderState = await getOrScanFolder(folderRel);
        if (!folderState.exists || folderState.scan.entries.length === 0) {
          continue;
        }

        const matchedNames = findMatchingRomEntriesInScan(folderState.scan, candidateNames, {
          titleFallback: target.title,
        });
        if (matchedNames.length === 0) {
          continue;
        }

        for (const matchedName of matchedNames) {
          const fullRelPath = `${folderRel}/${matchedName}`;
          const res = await removeRelativePathFromSdCard(rootHandle, fullRelPath, onDebug);
          if (res.status === 'removed') {
            filesRemovedCount += 1;
            filesRemovedForItem += 1;
            unregisterEntryInScan(folderState.scan, matchedName);
            const { folderRel: removedFolder, leafName } = splitParentAndLeaf(res.path);
            if (removedFolder && leafName) {
              unregisterEntryInScan(folderState.scan, leafName);
              removedScanEntries.push({ folderRel: removedFolder, leafName });
            }
          } else if (res.status === 'error' && res.error) {
            itemHadError = true;
            errors.push(`${target.title}: ${fullRelPath}: ${res.error}`);
          }
        }

        if (filesRemovedForItem > 0 || itemHadError) {
          break;
        }
      }
    }

    if (!itemHadError) {
      if (filesRemovedForItem > 0) {
        actuallyRemovedIds.push(target.id);
      } else {
        missingOnDiskCount += 1;
        missingOnlyIds.push(target.id);
      }
    }

    const completed = idx + 1;
    const nowMs = Date.now();
    if (
      completed === targets.length ||
      targets.length <= 20 ||
      completed % 25 === 0 ||
      Boolean(signal?.aborted) ||
      nowMs - lastProgressEmitMs >= 60
    ) {
      lastProgressEmitMs = nowMs;
      onProgress?.({
        completed,
        total: targets.length,
        filesRemoved: filesRemovedCount,
        canceling: Boolean(signal?.aborted),
      });
    }

    if (signal?.aborted) {
      canceled = true;
      break;
    }
  }

  // Safety guard: never silently wipe bulk catalog install records if zero files were actually
  // found/deleted on disk across a multi-game uninstall (e.g. wrong mount folder or folder mapping).
  const processedCount = actuallyRemovedIds.length + missingOnlyIds.length;
  let clearedIds: number[];
  if (
    targets.length > 1 &&
    processedCount > 1 &&
    filesRemovedCount === 0 &&
    missingOnlyIds.length > 0 &&
    errors.length === 0
  ) {
    clearedIds = [];
    const checkedSummary =
      checkedFoldersOrder.length > 0
        ? `checked /${checkedFoldersOrder.slice(0, 6).join(', /')}${checkedFoldersOrder.length > 6 ? `, +${checkedFoldersOrder.length - 6} more` : ''}`
        : 'no matching console folders found on mounted root';
    errors.push(
      `No matching ROM files were found on disk for any of the ${processedCount.toLocaleString()} checked games (${checkedSummary}). Catalog install records were kept intact — verify the mounted folder or Device Export folder mapping, or use "Clear Installed" to remove badges only.`,
    );
  } else {
    clearedIds = [...actuallyRemovedIds, ...missingOnlyIds];
  }

  return {
    clearedIds,
    filesRemovedCount,
    missingOnDiskCount,
    errors,
    removedScanEntries,
    canceled,
    totalRequested: targets.length,
    checkedFolders: checkedFoldersOrder,
  };
}
