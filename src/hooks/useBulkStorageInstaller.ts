import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classifyReleaseTagToTypeKey } from '../shared/releaseTypeFilter';
import { sanitizeFat32Filename } from '../shared/romNaming';
import {
  selectSmartPrimaryTargetsForItem,
  type SmartInspectItemInput,
  type SmartRomFilterContext,
} from '../shared/smartRomPicker';
import {
  classifyStorageRomCategory,
  resolveTargetStorageFolder,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
} from '../shared/storageFolderMappings';
import type {
  ArchiveInspectResult,
  PlayableExportTarget,
  RepositoryItemRecord,
  ScraperConfigPublic,
} from '../types';
import { formatBytes } from '../utils/format';
import { readJsonSafely } from '../utils/http';
import { reportAchievementEvent } from '../utils/achievementsClient';
import {
  findUpgradeCandidateOnCard,
  isAbortError,
  isFileSystemAccessSupported,
  pickSdCardRootDirectory,
  registerWrittenEntryInScan,
  resolveOrCreateSubdirectory,
  scanTargetFolder,
  streamHttpPayloadToSdFile,
  type SdDirectoryHandle,
  type SdScanFolderResult,
} from '../utils/sdCardFs';

export interface SdExportBatchItemResult extends SmartInspectItemInput {
  itemId: number;
  title: string;
  systemName: string;
  releaseTags: string[];
  languages: string[];
  regions: string[];
  inspections: ArchiveInspectResult[];
  error: string | null;
}

export type ExportRowWriteState =
  | 'pending'
  | 'inspecting'
  | 'writing'
  | 'written'
  | 'upgraded'
  | 'skipped'
  | 'canceled'
  | 'error';

export interface ExportQueueRow {
  rowKey: string;
  itemId: number;
  fileId: number;
  title: string;
  systemName: string;
  releaseTags: string[];
  sourceFilename: string;
  fileRole?: string;
  fileDisplayLabel?: string;
  targets: PlayableExportTarget[];
  selectedTargetIds: string[];
  recommendedTargetIds: string[];
  smartReasonsByTargetId: Record<string, string>;
  isMultiChoiceItem: boolean;
  isPlaceholder?: boolean;
  outputNamesByTargetId: Record<string, string>;
  replaceOlderByTargetId: Record<string, boolean>;
  overwriteExisting: boolean;
  error: string | null;
  patchOnly: boolean;
  ignoredEntriesCount: number;
  writeState: ExportRowWriteState;
  writeDetail: string | null;
  bytesWritten: number;
}

export type BulkInstallPhase =
  | 'idle'
  | 'inspecting'
  | 'ready'
  | 'running'
  | 'canceling'
  | 'completed'
  | 'canceled'
  | 'error';

export interface BulkInstallJobState {
  jobId: number;
  mode: 'express' | 'review';
  phase: BulkInstallPhase;
  itemIds: number[];
  filterContext: SmartRomFilterContext;
  rows: ExportQueueRow[];
  currentTitle: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface BulkInstallKnownItemMeta {
  title: string;
  systemName: string;
}

export interface BulkInstallMetrics {
  totalItems: number;
  completedItems: number;
  writtenItems: number;
  upgradedItems: number;
  skippedItems: number;
  failedItems: number;
  canceledItems: number;
  totalBytesWritten: number;
  progressPercent: number;
}

interface UseBulkStorageInstallerOptions {
  config: ScraperConfigPublic | null;
  debugLogging?: boolean;
  onItemsInstalled?: (updatedItems: RepositoryItemRecord[], deviceLabel: string) => void;
}

const EXPRESS_INSPECT_CHUNK_SIZE = 15;
const REVIEW_INSPECT_CHUNK_SIZE = 30;

function extractPreferredTypeKeys(filterContext?: SmartRomFilterContext | null): string[] {
  if (!filterContext) return [];
  const keys = new Set<string>();
  for (const tag of filterContext.tags || []) {
    keys.add(classifyReleaseTagToTypeKey(tag));
  }
  if (filterContext.languages && filterContext.languages.length > 0) {
    keys.add('translation:other');
  }
  for (const allowed of filterContext.syncIncludeTags || []) {
    keys.add(classifyReleaseTagToTypeKey(allowed));
  }
  return Array.from(keys);
}

export function resolveRowTargetCategoryAndFolder(
  row: Pick<
    ExportQueueRow,
    'systemName' | 'releaseTags' | 'fileRole' | 'fileDisplayLabel'
  >,
  target: Pick<PlayableExportTarget, 'roleBadge' | 'displayName'> | null,
  storageConfig?: StorageFolderMappingConfig | null,
  filterContext?: SmartRomFilterContext | null,
): { category: StorageRomCategoryKey; folder: string } {
  const category = classifyStorageRomCategory({
    systemName: row.systemName,
    releaseTags: row.releaseTags,
    fileRole: row.fileRole,
    fileDisplayLabel: row.fileDisplayLabel,
    targetRoleBadge: target?.roleBadge ?? null,
    targetDisplayName: target?.displayName ?? null,
    preferredFilterTypeKeys: extractPreferredTypeKeys(filterContext),
  });
  const folder = row.systemName
    ? resolveTargetStorageFolder(row.systemName, category, storageConfig)
    : 'ROMS';
  return { category, folder };
}

function buildRowsFromInspectedItem(
  entry: SdExportBatchItemResult,
  mode: 'express' | 'review',
  filterContext: SmartRomFilterContext,
): ExportQueueRow[] {
  if (entry.inspections.length === 0) {
    return [
      {
        rowKey: `${entry.itemId}-empty`,
        itemId: entry.itemId,
        fileId: 0,
        title: entry.title,
        systemName: entry.systemName,
        releaseTags: entry.releaseTags || [],
        sourceFilename: '—',
        targets: [],
        selectedTargetIds: [],
        recommendedTargetIds: [],
        smartReasonsByTargetId: {},
        isMultiChoiceItem: false,
        outputNamesByTargetId: {},
        replaceOlderByTargetId: {},
        overwriteExisting: false,
        error: entry.error || 'No downloadable archive found',
        patchOnly: false,
        ignoredEntriesCount: 0,
        writeState: 'error',
        writeDetail: entry.error || 'Unavailable',
        bytesWritten: 0,
      },
    ];
  }

  const totalPlayableTargets = entry.inspections.reduce(
    (sum, insp) => sum + insp.playableTargets.filter((t) => t.kind !== 'patch_only').length,
    0,
  );

  const smartPick = selectSmartPrimaryTargetsForItem(entry, filterContext);
  const totalRecommendedCount = Object.values(smartPick.selectedByFileId).reduce(
    (sum, ids) => sum + ids.length,
    0,
  );

  // An item requires variant choice in Review mode when it has >1 playable files AND
  // Smart Primary didn't determine that ALL of them belong together as a single multi-disc set.
  const hasCompetingVariants =
    totalPlayableTargets > 1 && totalRecommendedCount < totalPlayableTargets;

  const builtRows: ExportQueueRow[] = [];

  for (const insp of entry.inspections) {
    const namesMap: Record<string, string> = {};
    const replaceMap: Record<string, boolean> = {};
    const reasonsMap: Record<string, string> = {};
    for (const t of insp.playableTargets) {
      namesMap[t.id] = t.suggestedFilename;
      replaceMap[t.id] = true;
      const reason = smartPick.reasonByTargetKey[`${insp.fileId}:${t.id}`];
      if (reason) {
        reasonsMap[t.id] = reason;
      }
    }

    const recommendedForFile = smartPick.selectedByFileId[insp.fileId] || [];

    // In Express mode, if this release has multiple archive files and Smart Primary chose
    // a newer/matching sibling archive file, omit redundant older archive files so queue stays 1:1.
    if (
      mode === 'express' &&
      entry.inspections.length > 1 &&
      totalRecommendedCount > 0 &&
      recommendedForFile.length === 0
    ) {
      continue;
    }

    let initialSelected: string[] = [];
    if (mode === 'express') {
      initialSelected = recommendedForFile;
    } else if (!hasCompetingVariants) {
      // Single playable ROM or complete single-version multi-disc set: auto-select cleanly
      initialSelected = recommendedForFile.length > 0
        ? recommendedForFile
        : insp.playableTargets.length === 1
          ? [insp.playableTargets[0].id]
          : [];
    } else {
      // Review mode with competing variants/versions: leave unselected for user review or 1-click Smart Auto-Pick
      initialSelected = [];
    }

    builtRows.push({
      rowKey: `${entry.itemId}-${insp.fileId}`,
      itemId: entry.itemId,
      fileId: insp.fileId,
      title: entry.title,
      systemName: entry.systemName,
      releaseTags: entry.releaseTags || [],
      sourceFilename: insp.sourceFilename,
      fileRole: insp.fileRole,
      fileDisplayLabel: insp.fileDisplayLabel,
      targets: insp.playableTargets,
      selectedTargetIds: initialSelected,
      recommendedTargetIds: recommendedForFile,
      smartReasonsByTargetId: reasonsMap,
      isMultiChoiceItem: hasCompetingVariants && insp.playableTargets.length > 0,
      outputNamesByTargetId: namesMap,
      replaceOlderByTargetId: replaceMap,
      overwriteExisting: false,
      error:
        insp.playableTargets.length === 0
          ? insp.patchOnly
            ? 'Patch-only archive (no ROM payload)'
            : 'No playable ROM found'
          : null,
      patchOnly: insp.patchOnly,
      ignoredEntriesCount: insp.ignoredEntriesCount,
      writeState: insp.playableTargets.length === 0 ? 'skipped' : 'pending',
      writeDetail:
        insp.playableTargets.length === 0
          ? insp.patchOnly
            ? 'Patch-only archive'
            : 'No playable ROM found'
          : null,
      bytesWritten: 0,
    });
  }

  return builtRows;
}

export function useBulkStorageInstaller({
  config,
  debugLogging = false,
  onItemsInstalled,
}: UseBulkStorageInstallerOptions) {
  const [sdRootHandle, setSdRootHandle] = useState<SdDirectoryHandle | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [job, setJob] = useState<BulkInstallJobState | null>(null);
  const [folderScans, setFolderScans] = useState<Record<string, SdScanFolderResult>>({});
  const [scanningCard, setScanningCard] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;
  const debugLoggingRef = useRef(debugLogging);
  debugLoggingRef.current = debugLogging;
  const sdRootHandleRef = useRef(sdRootHandle);
  sdRootHandleRef.current = sdRootHandle;
  const onItemsInstalledRef = useRef(onItemsInstalled);
  onItemsInstalledRef.current = onItemsInstalled;
  const jobRef = useRef(job);
  jobRef.current = job;

  const jobSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const emitSdDebug = useCallback(
    (message: string, detail?: string, alsoPostToServer = false) => {
      if (!debugLoggingRef.current) return;
      console.debug('[RGT:SD-INSTALL]', message, detail ?? '');
      if (alsoPostToServer) {
        void fetch('/api/logs/debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'SD-INSTALL', message, detail: detail ?? null }),
        }).catch(() => undefined);
      }
    },
    [],
  );

  const isBusy =
    job?.phase === 'inspecting' || job?.phase === 'running' || job?.phase === 'canceling';

  const promptMountSdCard = useCallback(async (): Promise<SdDirectoryHandle | null> => {
    setMountError(null);
    const support = isFileSystemAccessSupported();
    if (!support.supported) {
      setMountError(support.reason || 'Folder picker not supported in this browser.');
      emitSdDebug('SD folder picker unsupported', support.reason, true);
      return null;
    }
    try {
      const handle = await pickSdCardRootDirectory();
      sdRootHandleRef.current = handle;
      setSdRootHandle(handle);
      emitSdDebug(`Mounted storage root "${handle.name}"`);
      return handle;
    } catch (err) {
      if (isAbortError(err)) return null;
      const msg = err instanceof Error ? err.message : String(err);
      emitSdDebug('Failed mounting storage root', msg, true);
      setMountError(
        /cross origin|sub frame|user activation/i.test(msg)
          ? 'Browser blocked folder picker inside this embedded frame. Open the app directly in its own tab or use Prepared ROM browser downloads.'
          : msg,
      );
      return null;
    }
  }, [emitSdDebug]);

  const syncInstalledIdsToServer = useCallback(
    async (ids: number[], deviceLabel: string) => {
      if (ids.length === 0) return;
      try {
        const res = await fetch('/api/items/installed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            installed: true,
            deviceLabel,
          }),
        });
        const parsed = await readJsonSafely<{ items?: RepositoryItemRecord[] }>(res);
        if (parsed.ok && Array.isArray(parsed.data?.items) && parsed.data.items.length > 0) {
          onItemsInstalledRef.current?.(parsed.data.items, deviceLabel);
          reportAchievementEvent('sd_export_complete', parsed.data.items.length);
        }
      } catch {
        // Non-fatal if install flag sync fails after file write
      }
    },
    [],
  );

  const rescanMountedSdFolders = useCallback(async (explicitFolders?: string[]) => {
    const handle = sdRootHandleRef.current;
    const currentJob = jobRef.current;
    const currentRows = currentJob?.rows || [];
    const storageCfg = configRef.current?.storageFolderConfig;

    let foldersToScan: string[] = [];
    if (explicitFolders && explicitFolders.length > 0) {
      foldersToScan = Array.from(new Set(explicitFolders.filter(Boolean)));
    } else {
      const folderSet = new Set<string>();
      for (const r of currentRows) {
        if (!r.systemName) continue;
        if (r.targets.length === 0) {
          folderSet.add(
            resolveRowTargetCategoryAndFolder(r, null, storageCfg, currentJob?.filterContext).folder,
          );
        } else {
          for (const t of r.targets) {
            folderSet.add(
              resolveRowTargetCategoryAndFolder(r, t, storageCfg, currentJob?.filterContext).folder,
            );
          }
        }
      }
      foldersToScan = Array.from(folderSet);
    }

    if (!handle || foldersToScan.length === 0) {
      if (!handle) setFolderScans({});
      return {};
    }
    setScanningCard(true);
    try {
      const nextScans: Record<string, SdScanFolderResult> = {};
      for (const folder of foldersToScan) {
        if (!nextScans[folder]) {
          nextScans[folder] = await scanTargetFolder(handle, folder);
        }
      }
      setFolderScans((prev) => ({ ...prev, ...nextScans }));
      return nextScans;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitSdDebug('Failed scanning target folders on mounted device', msg, true);
      setMountError(msg);
      return {};
    } finally {
      setScanningCard(false);
    }
  }, [emitSdDebug]);

  // Re-scan target folders if the user updates Storage Folder Mappings in Operations while a device is mounted
  useEffect(() => {
    if (sdRootHandle && job && job.phase === 'ready') {
      void rescanMountedSdFolders();
    }
  }, [config?.storageFolderConfig, sdRootHandle, job?.phase, rescanMountedSdFolders]);

  const writeSingleRowToDevice = useCallback(
    async (
      row: ExportQueueRow,
      filterContext: SmartRomFilterContext | null,
      rootHandle: SdDirectoryHandle,
      scanCache: Record<string, SdScanFolderResult>,
      dirCache: Map<string, SdDirectoryHandle>,
      signal: AbortSignal,
    ): Promise<{
      nextState: ExportRowWriteState;
      detail: string;
      bytesWritten: number;
      installedSuccess: boolean;
    }> => {
      if (signal.aborted) {
        throw new DOMException('Installation canceled by user.', 'AbortError');
      }

      const cfg = configRef.current;
      const sanitizeFat32 = cfg?.romSanitizeFat32 ?? true;
      const maxFilenameLen = cfg?.romMaxFilenameLen ?? 0;
      const storageCfg = cfg?.storageFolderConfig;

      let rowBytes = 0;
      let upgradedOldName: string | null = null;
      let allSkipped = true;
      let rowFailed: string | null = null;
      const touchedFolders = new Set<string>();

      for (const targetId of row.selectedTargetIds) {
        if (signal.aborted) {
          throw new DOMException('Installation canceled by user.', 'AbortError');
        }
        const target = row.targets.find((t) => t.id === targetId);
        if (!target) continue;

        const { folder: targetFolderRel } = resolveRowTargetCategoryAndFolder(
          row,
          target,
          storageCfg,
          filterContext,
        );
        touchedFolders.add(`/${targetFolderRel}`);

        if (!scanCache[targetFolderRel]) {
          scanCache[targetFolderRel] = await scanTargetFolder(rootHandle, targetFolderRel);
          setFolderScans((prev) => ({ ...prev, [targetFolderRel]: scanCache[targetFolderRel] }));
        }
        const scan = scanCache[targetFolderRel];

        let systemDirHandle = dirCache.get(targetFolderRel) || null;
        if (!systemDirHandle) {
          systemDirHandle = await resolveOrCreateSubdirectory(
            rootHandle,
            targetFolderRel,
            true,
            (msg, detail) => emitSdDebug(msg, detail, true),
          );
          if (systemDirHandle) {
            dirCache.set(targetFolderRel, systemDirHandle);
          }
        }

        if (!systemDirHandle) {
          const detail = `Could not create folder /${targetFolderRel}`;
          emitSdDebug(`Folder creation failed for "${row.title}"`, `itemId=${row.itemId}, folder=/${targetFolderRel}`, true);
          return {
            nextState: 'error',
            detail,
            bytesWritten: rowBytes,
            installedSuccess: false,
          };
        }

        const rawDesiredName = (row.outputNamesByTargetId[targetId] || target.suggestedFilename).trim();
        const finalName = sanitizeFat32
          ? sanitizeFat32Filename(
              rawDesiredName,
              maxFilenameLen,
              target.kind !== 'disc_set',
            )
          : rawDesiredName;

        const cardStatus = findUpgradeCandidateOnCard(finalName, scan);
        if (cardStatus.exactMatch && !row.overwriteExisting) {
          continue;
        }
        allSkipped = false;

        try {
          if (target.kind === 'disc_set') {
            const discFolderName = finalName.replace(/\.zip$/i, '');
            const discDir = await systemDirHandle.getDirectoryHandle(discFolderName, { create: true });
            for (const entryPath of target.entryPaths) {
              if (signal.aborted) {
                throw new DOMException('Installation canceled by user.', 'AbortError');
              }
              const leaf = entryPath.split('/').pop() || entryPath;
              const cleanLeaf = sanitizeFat32 ? sanitizeFat32Filename(leaf, maxFilenameLen) : leaf;
              const url = `/api/items/${row.itemId}/extract-entry?fileId=${row.fileId}&entry=${encodeURIComponent(entryPath)}&name=${encodeURIComponent(cleanLeaf)}`;
              rowBytes += await streamHttpPayloadToSdFile(url, discDir, cleanLeaf, {
                signal,
                hadExistingFile: cardStatus.exactMatch,
                onDebug: (msg, detail) => emitSdDebug(msg, detail),
              });
            }
            registerWrittenEntryInScan(
              scan,
              discFolderName,
              'directory',
              cardStatus.olderEntryName && row.replaceOlderByTargetId[targetId] !== false
                ? cardStatus.olderEntryName
                : null,
            );
          } else {
            const url = `/api/items/${row.itemId}/extract-entry?fileId=${row.fileId}&entry=${encodeURIComponent(target.primaryEntry)}&name=${encodeURIComponent(finalName)}`;
            rowBytes += await streamHttpPayloadToSdFile(url, systemDirHandle, finalName, {
              signal,
              hadExistingFile: cardStatus.exactMatch,
              onDebug: (msg, detail) => emitSdDebug(msg, detail),
            });
            registerWrittenEntryInScan(
              scan,
              finalName,
              'file',
              cardStatus.olderEntryName && row.replaceOlderByTargetId[targetId] !== false
                ? cardStatus.olderEntryName
                : null,
            );
          }

          if (cardStatus.olderEntryName && row.replaceOlderByTargetId[targetId] !== false) {
            try {
              await systemDirHandle.removeEntry(cardStatus.olderEntryName, { recursive: true });
              upgradedOldName = cardStatus.olderEntryName;
            } catch (removeErr) {
              emitSdDebug(
                `Could not remove superseded file "${cardStatus.olderEntryName}" in /${targetFolderRel}`,
                removeErr instanceof Error ? removeErr.message : String(removeErr),
                true,
              );
            }
          }
        } catch (err) {
          if (isAbortError(err)) {
            throw err;
          }
          const errDetail =
            err instanceof DOMException
              ? `${err.name}: ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
          rowFailed = errDetail;
          emitSdDebug(
            `Write failed for "${row.title}" -> /${targetFolderRel}/${finalName}`,
            `itemId=${row.itemId}, fileId=${row.fileId}, target=${targetId}, error=${errDetail}`,
            true,
          );
        }
      }

      const folderSummary =
        touchedFolders.size > 0
          ? Array.from(touchedFolders).join(', ')
          : `/${resolveRowTargetCategoryAndFolder(row, null, storageCfg, filterContext).folder}`;

      if (rowFailed) {
        return {
          nextState: 'error',
          detail: rowFailed,
          bytesWritten: rowBytes,
          installedSuccess: false,
        };
      }
      if (allSkipped) {
        return {
          nextState: 'skipped',
          detail: `Already on device in ${folderSummary}`,
          bytesWritten: 0,
          installedSuccess: true,
        };
      }
      if (upgradedOldName) {
        reportAchievementEvent('sd_version_upgrade');
        return {
          nextState: 'upgraded',
          detail: `Updated in ${folderSummary} (replaced ${upgradedOldName}) · ${formatBytes(rowBytes)}`,
          bytesWritten: rowBytes,
          installedSuccess: true,
        };
      }
      return {
        nextState: 'written',
        detail: `Saved to ${folderSummary} · ${formatBytes(rowBytes)}`,
        bytesWritten: rowBytes,
        installedSuccess: true,
      };
    },
    [emitSdDebug],
  );

  /**
   * 2-Click Express Install:
   * Prompts storage device mount if none is mounted yet, then immediately inspects
   * and streams Smart Primary ROMs asynchronously in the background.
   */
  const startExpressInstall = useCallback(
    async (
      rawItemIds: number[],
      filterContext: SmartRomFilterContext,
      knownMeta?: Map<number, BulkInstallKnownItemMeta>,
    ): Promise<boolean> => {
      const cleanIds = Array.from(
        new Set(rawItemIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
      );
      if (cleanIds.length === 0) return false;

      if (isBusy) {
        setModalOpen(true);
        return false;
      }

      let activeHandle = sdRootHandleRef.current;
      if (!activeHandle) {
        activeHandle = await promptMountSdCard();
        if (!activeHandle) {
          return false;
        }
      }

      setMountError(null);
      const jobId = ++jobSeqRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const placeholderRows: ExportQueueRow[] = cleanIds.map((id) => {
        const meta = knownMeta?.get(id);
        return {
          rowKey: `${id}-placeholder`,
          itemId: id,
          fileId: 0,
          title: meta?.title || `Catalog Release #${id}`,
          systemName: meta?.systemName || '',
          releaseTags: [],
          sourceFilename: 'Queued for inspection...',
          targets: [],
          selectedTargetIds: [],
          recommendedTargetIds: [],
          smartReasonsByTargetId: {},
          isMultiChoiceItem: false,
          isPlaceholder: true,
          outputNamesByTargetId: {},
          replaceOlderByTargetId: {},
          overwriteExisting: false,
          error: null,
          patchOnly: false,
          ignoredEntriesCount: 0,
          writeState: 'pending',
          writeDetail: 'Queued',
          bytesWritten: 0,
        };
      });

      const initialJob: BulkInstallJobState = {
        jobId,
        mode: 'express',
        phase: 'running',
        itemIds: cleanIds,
        filterContext,
        rows: placeholderRows,
        currentTitle: placeholderRows[0]?.title || null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      setJob(initialJob);

      // Run pipeline asynchronously without awaiting in the UI gesture caller
      void (async () => {
        const scanCache: Record<string, SdScanFolderResult> = {};
        const dirCache = new Map<string, SdDirectoryHandle>();
        const unsyncedInstalledIds = new Set<number>();

        const flushInstalled = async () => {
          if (unsyncedInstalledIds.size === 0) return;
          const batch = Array.from(unsyncedInstalledIds);
          unsyncedInstalledIds.clear();
          await syncInstalledIdsToServer(batch, activeHandle!.name);
        };

        try {
          for (let offset = 0; offset < cleanIds.length; offset += EXPRESS_INSPECT_CHUNK_SIZE) {
            if (controller.signal.aborted) {
              throw new DOMException('Installation canceled by user.', 'AbortError');
            }

            const chunkIds = cleanIds.slice(offset, offset + EXPRESS_INSPECT_CHUNK_SIZE);
            const chunkIdSet = new Set(chunkIds);

            setJob((prev) => {
              if (!prev || prev.jobId !== jobId) return prev;
              return {
                ...prev,
                rows: prev.rows.map((r) =>
                  r.isPlaceholder && chunkIdSet.has(r.itemId)
                    ? { ...r, writeState: 'inspecting', writeDetail: 'Inspecting archive...' }
                    : r,
                ),
              };
            });

            const res = await fetch('/api/items/inspect-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: chunkIds }),
              signal: controller.signal,
            });
            const parsed = await readJsonSafely<{ results?: SdExportBatchItemResult[]; error?: string }>(
              res,
            );
            if (!parsed.ok || !parsed.data?.results) {
              const inspectErr = parsed.errorMessage || `Archive inspection failed (HTTP ${res.status})`;
              emitSdDebug('Express inspect-batch failed', `chunk=${chunkIds.join(',')}, ${inspectErr}`, true);
              throw new Error(inspectErr);
            }

            const expandedChunkRows: ExportQueueRow[] = [];
            for (const entry of parsed.data.results) {
              const itemRows = buildRowsFromInspectedItem(entry, 'express', filterContext);
              expandedChunkRows.push(...itemRows);
            }

            // Replace chunk placeholders with real inspected rows
            setJob((prev) => {
              if (!prev || prev.jobId !== jobId) return prev;
              const nextRows: ExportQueueRow[] = [];
              const insertedItems = new Set<number>();
              for (const existing of prev.rows) {
                if (existing.isPlaceholder && chunkIdSet.has(existing.itemId)) {
                  if (!insertedItems.has(existing.itemId)) {
                    insertedItems.add(existing.itemId);
                    nextRows.push(
                      ...expandedChunkRows.filter((er) => er.itemId === existing.itemId),
                    );
                  }
                } else {
                  nextRows.push(existing);
                }
              }
              return { ...prev, rows: nextRows };
            });

            // Stream each inspected row in this chunk directly to the mounted storage device
            for (const row of expandedChunkRows) {
              if (controller.signal.aborted) {
                throw new DOMException('Installation canceled by user.', 'AbortError');
              }
              if (row.selectedTargetIds.length === 0) {
                continue;
              }

              setJob((prev) => {
                if (!prev || prev.jobId !== jobId) return prev;
                return {
                  ...prev,
                  currentTitle: row.title,
                  rows: prev.rows.map((r) =>
                    r.rowKey === row.rowKey
                      ? { ...r, writeState: 'writing', writeDetail: 'Extracting & writing ROM...' }
                      : r,
                  ),
                };
              });

              const outcome = await writeSingleRowToDevice(
                row,
                filterContext,
                activeHandle!,
                scanCache,
                dirCache,
                controller.signal,
              );

              if (outcome.installedSuccess) {
                unsyncedInstalledIds.add(row.itemId);
              }

              setJob((prev) => {
                if (!prev || prev.jobId !== jobId) return prev;
                return {
                  ...prev,
                  rows: prev.rows.map((r) =>
                    r.rowKey === row.rowKey
                      ? {
                          ...r,
                          writeState: outcome.nextState,
                          writeDetail: outcome.detail,
                          bytesWritten: outcome.bytesWritten,
                        }
                      : r,
                  ),
                };
              });
            }

            // Commit installed flags at the end of every chunk so progress persists live
            await flushInstalled();
          }

          await flushInstalled();
          setJob((prev) =>
            prev && prev.jobId === jobId
              ? {
                  ...prev,
                  phase: 'completed',
                  currentTitle: null,
                  finishedAt: new Date().toISOString(),
                }
              : prev,
          );
        } catch (err) {
          await flushInstalled();
          if (isAbortError(err) || controller.signal.aborted) {
            setJob((prev) => {
              if (!prev || prev.jobId !== jobId) return prev;
              return {
                ...prev,
                phase: 'canceled',
                currentTitle: null,
                finishedAt: new Date().toISOString(),
                rows: prev.rows.map((r) =>
                  r.writeState === 'pending' ||
                  r.writeState === 'inspecting' ||
                  r.writeState === 'writing'
                    ? { ...r, writeState: 'canceled', writeDetail: 'Canceled by user' }
                    : r,
                ),
              };
            });
          } else {
            const errMsg = err instanceof Error ? err.message : String(err);
            emitSdDebug('Express SD install pipeline failed', errMsg, true);
            setJob((prev) =>
              prev && prev.jobId === jobId
                ? {
                    ...prev,
                    phase: 'error',
                    currentTitle: null,
                    errorMessage: errMsg,
                    finishedAt: new Date().toISOString(),
                  }
                : prev,
            );
          }
        } finally {
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
          }
        }
      })();

      return true;
    },
    [emitSdDebug, isBusy, promptMountSdCard, syncInstalledIdsToServer, writeSingleRowToDevice],
  );

  /**
   * Opens the interactive Review Queue modal for granular inspection, filename editing,
   * variant picking, and Next Unresolved Multi-ROM spotlight navigation.
   */
  const openReviewQueue = useCallback(
    async (
      rawItemIds: number[],
      filterContext: SmartRomFilterContext,
      knownMeta?: Map<number, BulkInstallKnownItemMeta>,
    ) => {
      const cleanIds = Array.from(
        new Set(rawItemIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
      );
      if (cleanIds.length === 0) return;

      if (isBusy) {
        setModalOpen(true);
        return;
      }

      setMountError(null);
      setModalOpen(true);

      const jobId = ++jobSeqRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const placeholderRows: ExportQueueRow[] = cleanIds.map((id) => {
        const meta = knownMeta?.get(id);
        return {
          rowKey: `${id}-placeholder`,
          itemId: id,
          fileId: 0,
          title: meta?.title || `Catalog Release #${id}`,
          systemName: meta?.systemName || '',
          releaseTags: [],
          sourceFilename: 'Inspecting archive...',
          targets: [],
          selectedTargetIds: [],
          recommendedTargetIds: [],
          smartReasonsByTargetId: {},
          isMultiChoiceItem: false,
          isPlaceholder: true,
          outputNamesByTargetId: {},
          replaceOlderByTargetId: {},
          overwriteExisting: false,
          error: null,
          patchOnly: false,
          ignoredEntriesCount: 0,
          writeState: 'inspecting',
          writeDetail: 'Inspecting...',
          bytesWritten: 0,
        };
      });

      setJob({
        jobId,
        mode: 'review',
        phase: 'inspecting',
        itemIds: cleanIds,
        filterContext,
        rows: placeholderRows,
        currentTitle: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });

      try {
        const allTargetFolders = new Set<string>();
        const storageCfg = configRef.current?.storageFolderConfig;
        for (let offset = 0; offset < cleanIds.length; offset += REVIEW_INSPECT_CHUNK_SIZE) {
          if (controller.signal.aborted) {
            throw new DOMException('Inspection canceled.', 'AbortError');
          }
          const chunkIds = cleanIds.slice(offset, offset + REVIEW_INSPECT_CHUNK_SIZE);
          const chunkIdSet = new Set(chunkIds);

          const res = await fetch('/api/items/inspect-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: chunkIds }),
            signal: controller.signal,
          });
          const parsed = await readJsonSafely<{ results?: SdExportBatchItemResult[]; error?: string }>(
            res,
          );
          if (!parsed.ok || !parsed.data?.results) {
            const inspectErr = parsed.errorMessage || `Inspection failed (HTTP ${res.status})`;
            emitSdDebug('Review inspect-batch failed', `chunk=${chunkIds.join(',')}, ${inspectErr}`, true);
            throw new Error(inspectErr);
          }

          const expandedChunkRows: ExportQueueRow[] = [];
          for (const entry of parsed.data.results) {
            const built = buildRowsFromInspectedItem(entry, 'review', filterContext);
            for (const r of built) {
              if (!r.systemName) continue;
              if (r.targets.length === 0) {
                allTargetFolders.add(
                  resolveRowTargetCategoryAndFolder(r, null, storageCfg, filterContext).folder,
                );
              } else {
                for (const t of r.targets) {
                  allTargetFolders.add(
                    resolveRowTargetCategoryAndFolder(r, t, storageCfg, filterContext).folder,
                  );
                }
              }
            }
            expandedChunkRows.push(...built);
          }

          setJob((prev) => {
            if (!prev || prev.jobId !== jobId) return prev;
            const nextRows: ExportQueueRow[] = [];
            const inserted = new Set<number>();
            for (const existing of prev.rows) {
              if (existing.isPlaceholder && chunkIdSet.has(existing.itemId)) {
                if (!inserted.has(existing.itemId)) {
                  inserted.add(existing.itemId);
                  nextRows.push(
                    ...expandedChunkRows.filter((er) => er.itemId === existing.itemId),
                  );
                }
              } else {
                nextRows.push(existing);
              }
            }
            return { ...prev, rows: nextRows };
          });
        }

        setJob((prev) =>
          prev && prev.jobId === jobId ? { ...prev, phase: 'ready' } : prev,
        );

        if (sdRootHandleRef.current && allTargetFolders.size > 0) {
          await rescanMountedSdFolders(Array.from(allTargetFolders));
        }
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) {
          setJob((prev) =>
            prev && prev.jobId === jobId
              ? {
                  ...prev,
                  phase: 'canceled',
                  finishedAt: new Date().toISOString(),
                  rows: prev.rows.map((r) =>
                    r.isPlaceholder
                      ? { ...r, isPlaceholder: false, writeState: 'canceled', writeDetail: 'Inspection canceled' }
                      : r,
                  ),
                }
              : prev,
          );
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setJob((prev) =>
            prev && prev.jobId === jobId
              ? { ...prev, phase: 'error', errorMessage: msg, finishedAt: new Date().toISOString() }
              : prev,
          );
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [isBusy, rescanMountedSdFolders],
  );

  /**
   * Starts streaming the currently selected targets in Review mode asynchronously,
   * allowing the user to close the modal and monitor/cancel in the background.
   */
  const startReviewWrite = useCallback(async () => {
    const currentJob = jobRef.current;
    if (!currentJob || isBusy) return;

    let activeHandle = sdRootHandleRef.current;
    if (!activeHandle) {
      activeHandle = await promptMountSdCard();
      if (!activeHandle) return;
    }

    const selectedRows = currentJob.rows.filter((r) => r.selectedTargetIds.length > 0);
    if (selectedRows.length === 0) return;

    const jobId = currentJob.jobId;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setJob((prev) =>
      prev && prev.jobId === jobId
        ? {
            ...prev,
            phase: 'running',
            errorMessage: null,
            finishedAt: null,
            rows: prev.rows.map((r) =>
              r.selectedTargetIds.length > 0
                ? { ...r, writeState: 'pending', writeDetail: 'Queued', bytesWritten: 0 }
                : r,
            ),
          }
        : prev,
    );

    void (async () => {
      const scanCache: Record<string, SdScanFolderResult> = { ...folderScans };
      const dirCache = new Map<string, SdDirectoryHandle>();
      const unsyncedInstalledIds = new Set<number>();
      let sinceLastSync = 0;

      const flushInstalled = async () => {
        if (unsyncedInstalledIds.size === 0) return;
        const batch = Array.from(unsyncedInstalledIds);
        unsyncedInstalledIds.clear();
        sinceLastSync = 0;
        await syncInstalledIdsToServer(batch, activeHandle!.name);
      };

      try {
        const snapshotRows = jobRef.current?.rows || currentJob.rows;
        for (const row of snapshotRows) {
          if (controller.signal.aborted) {
            throw new DOMException('Installation canceled by user.', 'AbortError');
          }
          if (row.selectedTargetIds.length === 0) continue;

          setJob((prev) => {
            if (!prev || prev.jobId !== jobId) return prev;
            return {
              ...prev,
              currentTitle: row.title,
              rows: prev.rows.map((r) =>
                r.rowKey === row.rowKey
                  ? { ...r, writeState: 'writing', writeDetail: 'Extracting & writing ROM...' }
                  : r,
              ),
            };
          });

          const outcome = await writeSingleRowToDevice(
            row,
            currentJob.filterContext,
            activeHandle!,
            scanCache,
            dirCache,
            controller.signal,
          );

          if (outcome.installedSuccess) {
            unsyncedInstalledIds.add(row.itemId);
            sinceLastSync += 1;
          }

          setJob((prev) => {
            if (!prev || prev.jobId !== jobId) return prev;
            return {
              ...prev,
              rows: prev.rows.map((r) =>
                r.rowKey === row.rowKey
                  ? {
                      ...r,
                      writeState: outcome.nextState,
                      writeDetail: outcome.detail,
                      bytesWritten: outcome.bytesWritten,
                    }
                  : r,
              ),
            };
          });

          if (sinceLastSync >= 10) {
            await flushInstalled();
          }
        }

        await flushInstalled();
        await rescanMountedSdFolders();
        setJob((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                phase: 'completed',
                currentTitle: null,
                finishedAt: new Date().toISOString(),
              }
            : prev,
        );
      } catch (err) {
        await flushInstalled();
        if (isAbortError(err) || controller.signal.aborted) {
          setJob((prev) => {
            if (!prev || prev.jobId !== jobId) return prev;
            return {
              ...prev,
              phase: 'canceled',
              currentTitle: null,
              finishedAt: new Date().toISOString(),
              rows: prev.rows.map((r) =>
                r.writeState === 'pending' || r.writeState === 'writing'
                  ? { ...r, writeState: 'canceled', writeDetail: 'Canceled by user' }
                  : r,
              ),
            };
          });
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          emitSdDebug('Review SD install pipeline failed', msg, true);
          setJob((prev) =>
            prev && prev.jobId === jobId
              ? {
                  ...prev,
                  phase: 'error',
                  currentTitle: null,
                  errorMessage: msg,
                  finishedAt: new Date().toISOString(),
                }
              : prev,
          );
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    })();
  }, [
    emitSdDebug,
    folderScans,
    isBusy,
    promptMountSdCard,
    rescanMountedSdFolders,
    syncInstalledIdsToServer,
    writeSingleRowToDevice,
  ]);

  const cancelInstall = useCallback(() => {
    if (!abortControllerRef.current) return;
    setJob((prev) => (prev ? { ...prev, phase: 'canceling' } : prev));
    abortControllerRef.current.abort();
  }, []);

  const dismissJob = useCallback(() => {
    if (isBusy) return;
    setJob(null);
    setModalOpen(false);
  }, [isBusy]);

  const toggleTargetSelection = useCallback((rowKey: string, targetId: string) => {
    setJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.rowKey !== rowKey) return row;
          const exists = row.selectedTargetIds.includes(targetId);
          const nextIds = exists
            ? row.selectedTargetIds.filter((id) => id !== targetId)
            : [...row.selectedTargetIds, targetId];
          return { ...row, selectedTargetIds: nextIds };
        }),
      };
    });
  }, []);

  const selectAllVariantsForRow = useCallback((rowKey: string) => {
    setJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) =>
          row.rowKey === rowKey ? { ...row, selectedTargetIds: row.targets.map((t) => t.id) } : row,
        ),
      };
    });
  }, []);

  /**
   * Resolves all unresolved multi-ROM items in Review mode using Smart Primary
   * (latest version + active Catalog/Sync context).
   */
  const autoPickSmartPrimaries = useCallback(() => {
    setJob((prev) => {
      if (!prev) return prev;
      // Group rows by itemId so we only auto-pick items that currently have 0 targets selected
      const selectedCountByItem = new Map<number, number>();
      for (const r of prev.rows) {
        selectedCountByItem.set(
          r.itemId,
          (selectedCountByItem.get(r.itemId) || 0) + r.selectedTargetIds.length,
        );
      }

      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (!row.isMultiChoiceItem) return row;
          if ((selectedCountByItem.get(row.itemId) || 0) > 0) return row;
          return {
            ...row,
            selectedTargetIds: [...row.recommendedTargetIds],
          };
        }),
      };
    });
  }, []);

  const updateRowTargetName = useCallback((rowKey: string, targetId: string, nextName: string) => {
    setJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) =>
          row.rowKey === rowKey
            ? { ...row, outputNamesByTargetId: { ...row.outputNamesByTargetId, [targetId]: nextName } }
            : row,
        ),
      };
    });
  }, []);

  const metrics = useMemo<BulkInstallMetrics>(() => {
    if (!job) {
      return {
        totalItems: 0,
        completedItems: 0,
        writtenItems: 0,
        upgradedItems: 0,
        skippedItems: 0,
        failedItems: 0,
        canceledItems: 0,
        totalBytesWritten: 0,
        progressPercent: 0,
      };
    }

    const rowsByItem = new Map<number, ExportQueueRow[]>();
    let totalBytesWritten = 0;
    for (const r of job.rows) {
      totalBytesWritten += r.bytesWritten || 0;
      const list = rowsByItem.get(r.itemId) || [];
      list.push(r);
      rowsByItem.set(r.itemId, list);
    }

    let completedItems = 0;
    let writtenItems = 0;
    let upgradedItems = 0;
    let skippedItems = 0;
    let failedItems = 0;
    let canceledItems = 0;

    for (const itemId of job.itemIds) {
      const itemRows = rowsByItem.get(itemId) || [];
      if (itemRows.length === 0) continue;

      const activeRows = itemRows.filter(
        (r) =>
          r.isPlaceholder ||
          r.selectedTargetIds.length > 0 ||
          r.writeState === 'error' ||
          r.writeState === 'skipped' ||
          r.writeState === 'canceled',
      );
      const checkSet = activeRows.length > 0 ? activeRows : itemRows;

      const stillRunning = checkSet.some(
        (r) =>
          r.writeState === 'pending' ||
          r.writeState === 'inspecting' ||
          r.writeState === 'writing',
      );
      if (stillRunning) continue;

      completedItems += 1;
      if (checkSet.some((r) => r.writeState === 'upgraded')) {
        upgradedItems += 1;
      } else if (checkSet.some((r) => r.writeState === 'written')) {
        writtenItems += 1;
      } else if (checkSet.some((r) => r.writeState === 'error')) {
        failedItems += 1;
      } else if (checkSet.some((r) => r.writeState === 'canceled')) {
        canceledItems += 1;
      } else {
        skippedItems += 1;
      }
    }

    const totalItems = job.itemIds.length;
    const progressPercent =
      totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;

    return {
      totalItems,
      completedItems,
      writtenItems,
      upgradedItems,
      skippedItems,
      failedItems,
      canceledItems,
      totalBytesWritten,
      progressPercent,
    };
  }, [job]);

  return {
    sdRootHandle,
    setSdRootHandle: (handle: SdDirectoryHandle | null) => {
      sdRootHandleRef.current = handle;
      setSdRootHandle(handle);
    },
    promptMountSdCard,
    mountError,
    clearMountError: () => setMountError(null),
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    job,
    metrics,
    isBusy,
    folderScans,
    scanningCard,
    rescanMountedSdFolders,
    startExpressInstall,
    openReviewQueue,
    startReviewWrite,
    cancelInstall,
    dismissJob,
    toggleTargetSelection,
    selectAllVariantsForRow,
    autoPickSmartPrimaries,
    updateRowTargetName,
  };
}

export type BulkStorageInstallerController = ReturnType<typeof useBulkStorageInstaller>;
