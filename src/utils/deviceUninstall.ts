import type { DeviceUninstallTargetRecord } from '../shared/deviceProfiles.ts';
import {
  classifyStorageRomCategory,
  resolveTargetStorageFolder,
  type StorageFolderMappingConfig,
} from '../shared/storageFolderMappings.ts';
import {
  removeRelativePathFromSdCard,
  removeStemFallbackFromSdCard,
  type SdDirectoryHandle,
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
}

export async function executeDeviceUninstallBatch(options: {
  targets: DeviceUninstallTargetRecord[];
  rootHandle: SdDirectoryHandle;
  storageCfg: StorageFolderMappingConfig;
  signal?: AbortSignal;
  onProgress?: (progress: DeviceUninstallBatchProgress) => void;
  onDebug?: (msg: string, detail?: string) => void;
}): Promise<DeviceUninstallBatchOutcome> {
  const { targets, rootHandle, storageCfg, signal, onProgress, onDebug } = options;
  const clearedIds: number[] = [];
  const errors: string[] = [];
  const removedScanEntries: Array<{ folderRel: string; leafName: string }> = [];
  let filesRemovedCount = 0;
  let missingOnDiskCount = 0;
  let canceled = false;

  if (targets.length === 0) {
    return {
      clearedIds,
      filesRemovedCount,
      missingOnDiskCount,
      errors,
      removedScanEntries,
      canceled: Boolean(signal?.aborted),
      totalRequested: 0,
    };
  }

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

    if (recordedPaths.length > 0) {
      for (const relPath of recordedPaths) {
        const res = await removeRelativePathFromSdCard(rootHandle, relPath, onDebug);
        if (res.status === 'removed') {
          filesRemovedCount += 1;
          const slashIdx = res.path.lastIndexOf('/');
          const folderRel = slashIdx > 0 ? res.path.slice(0, slashIdx) : '';
          const leafName = slashIdx >= 0 ? res.path.slice(slashIdx + 1) : res.path;
          if (folderRel && leafName) {
            removedScanEntries.push({ folderRel, leafName });
          }
        } else if (res.status === 'not_found') {
          missingOnDiskCount += 1;
        } else {
          itemHadError = true;
          errors.push(`${target.title}: ${res.error || `Failed removing ${relPath}`}`);
        }
      }
    } else {
      const category = classifyStorageRomCategory({
        systemName: target.systemName,
        releaseTags: target.releaseTags,
      });
      const folderRel = resolveTargetStorageFolder(target.systemName, category, storageCfg);
      const candidateName = target.installedFilename || target.fallbackFilename || null;
      const fallbackRes = await removeStemFallbackFromSdCard(
        rootHandle,
        folderRel,
        candidateName,
        onDebug,
      );
      filesRemovedCount += fallbackRes.removedPaths.length;
      for (const removedPath of fallbackRes.removedPaths) {
        const slashIdx = removedPath.lastIndexOf('/');
        const removedFolder = slashIdx > 0 ? removedPath.slice(0, slashIdx) : '';
        const leafName = slashIdx >= 0 ? removedPath.slice(slashIdx + 1) : removedPath;
        if (removedFolder && leafName) {
          removedScanEntries.push({ folderRel: removedFolder, leafName });
        }
      }
      if (fallbackRes.removedPaths.length === 0 && fallbackRes.errors.length === 0) {
        missingOnDiskCount += 1;
      }
      if (fallbackRes.errors.length > 0) {
        itemHadError = true;
        for (const e of fallbackRes.errors) {
          errors.push(`${target.title}: ${e}`);
        }
      }
    }

    if (!itemHadError) {
      clearedIds.push(target.id);
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

  return {
    clearedIds,
    filesRemovedCount,
    missingOnDiskCount,
    errors,
    removedScanEntries,
    canceled,
    totalRequested: targets.length,
  };
}
