import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { composeEffectiveStorageFolderConfig } from '../shared/deviceExportUi';
import { classifyReleaseTagToTypeKey } from '../shared/releaseTypeFilter';
import { sanitizeFat32Filename } from '../shared/romNaming';
import {
  selectSmartPrimaryTargetsForItem,
  type SmartInspectItemInput,
  type SmartRomFilterContext,
} from '../shared/smartRomPicker';
import {
  discoverStorageFolderMappings,
  type DeviceAutoConfigResult,
} from '../shared/storageAutoConfig';
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
  scanStorageDirectoryTree,
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

export type DeviceInstallStage =
  | 'scanning_device'
  | 'inspecting'
  | 'extracting'
  | 'writing'
  | 'finalizing';

export interface ActiveDeviceInstallTransfer {
  itemId: number;
  rowKey: string;
  title: string;
  stage: DeviceInstallStage;
  filename: string | null;
  destinationFolder: string | null;
  bytesWritten: number;
  totalBytes: number | null;
  percent: number | null;
  bytesPerSec: number | null;
  fileIndex: number;
  totalFiles: number;
}

export interface BulkInstallJobState {
  jobId: number;
  mode: 'express' | 'review';
  phase: BulkInstallPhase;
  itemIds: number[];
  filterContext: SmartRomFilterContext;
  rows: ExportQueueRow[];
  currentTitle: string | null;
  activeTransfer: ActiveDeviceInstallTransfer | null;
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
    if (recommendedForFile.length > 0) {
      initialSelected = [...recommendedForFile];
    } else if (totalRecommendedCount === 0 && insp.playableTargets.length > 0) {
      // Fallback when Smart Primary had no explicit pick: select the first playable target on the first playable archive
      const alreadyFallbackPicked = builtRows.some((r) => r.selectedTargetIds.length > 0);
      if (!alreadyFallbackPicked) {
        initialSelected = [insp.playableTargets[0].id];
      }
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

  // Automatic per-mounted-device Auto-Configure state (session-scoped; clears on eject/switch)
  const [autoConfigPhase, setAutoConfigPhase] = useState<'idle' | 'scanning' | 'ready' | 'error'>(
    'idle',
  );
  const [autoConfigProgress, setAutoConfigProgress] = useState<{
    directoriesScanned: number;
    currentPath: string;
  }>({ directoriesScanned: 0, currentPath: '' });
  const [autoConfigResult, setAutoConfigResult] = useState<DeviceAutoConfigResult | null>(null);
  const [autoConfigError, setAutoConfigError] = useState<string | null>(null);
  const [autoConfigChosenPaths, setAutoConfigChosenPaths] = useState<Record<string, string>>({});
  const [autoConfigIncludeSubfolders, setAutoConfigIncludeSubfolders] = useState<boolean>(true);

  const effectiveStorageFolderConfig = useMemo(
    () =>
      composeEffectiveStorageFolderConfig(config?.storageFolderConfig, autoConfigResult, {
        chosenPathBySlug: autoConfigChosenPaths,
        includeTypeSubfolders: autoConfigIncludeSubfolders,
      }),
    [
      config?.storageFolderConfig,
      autoConfigResult,
      autoConfigChosenPaths,
      autoConfigIncludeSubfolders,
    ],
  );

  const configRef = useRef(config);
  configRef.current = config;
  const effectiveStorageFolderConfigRef = useRef(effectiveStorageFolderConfig);
  effectiveStorageFolderConfigRef.current = effectiveStorageFolderConfig;
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
  const autoConfigAbortRef = useRef<AbortController | null>(null);
  const autoConfigPromiseRef = useRef<Promise<DeviceAutoConfigResult | null> | null>(null);

  useEffect(() => {
    return () => {
      autoConfigAbortRef.current?.abort();
      autoConfigAbortRef.current = null;
    };
  }, []);

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

  const clearAutoConfigState = useCallback(() => {
    autoConfigAbortRef.current?.abort();
    autoConfigAbortRef.current = null;
    autoConfigPromiseRef.current = null;
    setAutoConfigPhase('idle');
    setAutoConfigProgress({ directoriesScanned: 0, currentPath: '' });
    setAutoConfigResult(null);
    setAutoConfigError(null);
    setAutoConfigChosenPaths({});
    setAutoConfigIncludeSubfolders(true);
  }, []);

  const runDeviceAutoConfigure = useCallback(
    (rootHandle: SdDirectoryHandle): Promise<DeviceAutoConfigResult | null> => {
      autoConfigAbortRef.current?.abort();
      const abortController = new AbortController();
      autoConfigAbortRef.current = abortController;

      setAutoConfigError(null);
      setAutoConfigResult(null);
      setAutoConfigChosenPaths({});
      setAutoConfigIncludeSubfolders(true);
      setAutoConfigProgress({ directoriesScanned: 0, currentPath: rootHandle.name || '' });
      setAutoConfigPhase('scanning');

      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const scanPromise = (async (): Promise<DeviceAutoConfigResult | null> => {
        try {
          const nodes = await scanStorageDirectoryTree(rootHandle, {
            signal: abortController.signal,
            onProgress: (prog) => {
              if (!abortController.signal.aborted) {
                setAutoConfigProgress(prog);
              }
            },
          });
          if (abortController.signal.aborted) return null;

          const durationMs = Math.max(
            1,
            Math.round(
              (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
            ),
          );
          const cfg = configRef.current;
          const configuredFilterSlugs = (cfg?.systemFilter || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const preferredSlugs = [
            ...(cfg?.discoveredSystems || []),
            ...configuredFilterSlugs,
            ...Object.keys(cfg?.storageFolderConfig?.systemFolders || {}),
            ...Object.keys(cfg?.storageFolderConfig?.systemTypeOverrides || {}),
          ];
          const result = discoverStorageFolderMappings(nodes, {
            rootLabel: rootHandle.name || 'Storage Device',
            preferredSlugs,
            durationMs,
          });
          if (abortController.signal.aborted) return null;

          const initialChosen: Record<string, string> = {};
          for (const match of result.matches) {
            initialChosen[match.canonicalSlug] = match.recommendedPath;
          }

          effectiveStorageFolderConfigRef.current = composeEffectiveStorageFolderConfig(
            cfg?.storageFolderConfig,
            result,
            {
              chosenPathBySlug: initialChosen,
              includeTypeSubfolders: true,
            },
          );
          setAutoConfigChosenPaths(initialChosen);
          setAutoConfigResult(result);
          setAutoConfigPhase('ready');
          emitSdDebug(
            `Auto-configured "${rootHandle.name}": ${result.detectedLayoutLabel} (${result.matches.length} consoles in ${durationMs}ms)`,
          );
          return result;
        } catch (err) {
          if (isAbortError(err) || abortController.signal.aborted) {
            setAutoConfigPhase('idle');
            return null;
          }
          const msg = err instanceof Error ? err.message : String(err);
          emitSdDebug('Automatic device auto-configure failed', msg, true);
          setAutoConfigError(msg || 'Failed auto-configuring the mounted storage device.');
          setAutoConfigPhase('error');
          return null;
        } finally {
          if (autoConfigAbortRef.current === abortController) {
            autoConfigAbortRef.current = null;
            autoConfigPromiseRef.current = null;
          }
        }
      })();

      autoConfigPromiseRef.current = scanPromise;
      return scanPromise;
    },
    [emitSdDebug],
  );

  const applyMountedHandle = useCallback(
    (handle: SdDirectoryHandle | null) => {
      sdRootHandleRef.current = handle;
      setSdRootHandle(handle);
      setFolderScans({});
      if (!handle) {
        clearAutoConfigState();
        effectiveStorageFolderConfigRef.current = composeEffectiveStorageFolderConfig(
          configRef.current?.storageFolderConfig,
          null,
        );
        return;
      }
      void runDeviceAutoConfigure(handle);
    },
    [clearAutoConfigState, runDeviceAutoConfigure],
  );

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
      applyMountedHandle(handle);
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
  }, [applyMountedHandle, emitSdDebug]);

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
    const storageCfg = effectiveStorageFolderConfigRef.current;

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

  // Re-scan target folders if effective folder mappings change while a device is mounted
  useEffect(() => {
    if (sdRootHandle && job && job.phase === 'ready') {
      void rescanMountedSdFolders();
    }
  }, [effectiveStorageFolderConfig, sdRootHandle, job?.phase, rescanMountedSdFolders]);

  const writeSingleRowToDevice = useCallback(
    async (
      row: ExportQueueRow,
      filterContext: SmartRomFilterContext | null,
      rootHandle: SdDirectoryHandle,
      scanCache: Record<string, SdScanFolderResult>,
      dirCache: Map<string, SdDirectoryHandle>,
      signal: AbortSignal,
      onProgress?: (transfer: ActiveDeviceInstallTransfer) => void,
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
      const storageCfg = effectiveStorageFolderConfigRef.current;

      const selectedTargets = row.selectedTargetIds
        .map((id) => row.targets.find((t) => t.id === id))
        .filter((t): t is PlayableExportTarget => Boolean(t));
      const allHaveExpectedSizes =
        selectedTargets.length > 0 && selectedTargets.every((t) => (t.sizeBytes || 0) > 0);
      const rowTotalExpectedBytes = allHaveExpectedSizes
        ? selectedTargets.reduce((sum, t) => sum + (t.sizeBytes || 0), 0)
        : null;
      const totalFiles = Math.max(
        1,
        selectedTargets.reduce(
          (sum, t) => sum + (t.kind === 'disc_set' ? Math.max(1, t.entryPaths.length) : 1),
          0,
        ),
      );

      let rowBytes = 0;
      let fileIndex = 0;
      let upgradedOldName: string | null = null;
      let allSkipped = true;
      let rowFailed: string | null = null;
      const touchedFolders = new Set<string>();

      const emitTransferUpdate = (params: {
        stage: DeviceInstallStage;
        filename: string | null;
        destinationFolder: string | null;
        currentFileBytes: number;
        currentFileTotalBytes: number | null;
        bytesPerSec: number | null;
      }) => {
        if (!onProgress) return;
        const cumulativeBytes = rowBytes + params.currentFileBytes;
        const effectiveTotal =
          rowTotalExpectedBytes && rowTotalExpectedBytes > 0
            ? rowTotalExpectedBytes
            : totalFiles === 1 && params.currentFileTotalBytes && params.currentFileTotalBytes > 0
              ? params.currentFileTotalBytes
              : null;
        const percent =
          effectiveTotal !== null && effectiveTotal > 0
            ? Math.min(100, Math.round((cumulativeBytes / effectiveTotal) * 100))
            : null;
        onProgress({
          itemId: row.itemId,
          rowKey: row.rowKey,
          title: row.title,
          stage: params.stage,
          filename: params.filename,
          destinationFolder: params.destinationFolder,
          bytesWritten: cumulativeBytes,
          totalBytes: effectiveTotal,
          percent,
          bytesPerSec: params.bytesPerSec,
          fileIndex: Math.max(1, Math.min(totalFiles, fileIndex || 1)),
          totalFiles,
        });
      };

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
            const discRelFolder = `${targetFolderRel}/${discFolderName}`;
            for (const entryPath of target.entryPaths) {
              if (signal.aborted) {
                throw new DOMException('Installation canceled by user.', 'AbortError');
              }
              fileIndex += 1;
              const leaf = entryPath.split('/').pop() || entryPath;
              const cleanLeaf = sanitizeFat32 ? sanitizeFat32Filename(leaf, maxFilenameLen) : leaf;
              const url = `/api/items/${row.itemId}/extract-entry?fileId=${row.fileId}&entry=${encodeURIComponent(entryPath)}&name=${encodeURIComponent(cleanLeaf)}`;
              let latestFileBytes = 0;
              let latestFileTotal: number | null = null;
              let latestSpeed: number | null = null;
              rowBytes += await streamHttpPayloadToSdFile(url, discDir, cleanLeaf, {
                signal,
                hadExistingFile: cardStatus.exactMatch,
                onStage: (stage) =>
                  emitTransferUpdate({
                    stage,
                    filename: cleanLeaf,
                    destinationFolder: discRelFolder,
                    currentFileBytes: latestFileBytes,
                    currentFileTotalBytes: latestFileTotal,
                    bytesPerSec: stage === 'writing' ? latestSpeed : null,
                  }),
                onProgress: (prog) => {
                  latestFileBytes = prog.bytesWritten;
                  latestFileTotal = prog.totalBytes;
                  latestSpeed = prog.bytesPerSec;
                  emitTransferUpdate({
                    stage: 'writing',
                    filename: cleanLeaf,
                    destinationFolder: discRelFolder,
                    currentFileBytes: prog.bytesWritten,
                    currentFileTotalBytes: prog.totalBytes,
                    bytesPerSec: prog.bytesPerSec,
                  });
                },
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
            fileIndex += 1;
            const url = `/api/items/${row.itemId}/extract-entry?fileId=${row.fileId}&entry=${encodeURIComponent(target.primaryEntry)}&name=${encodeURIComponent(finalName)}`;
            let latestFileBytes = 0;
            let latestFileTotal: number | null = target.sizeBytes > 0 ? target.sizeBytes : null;
            let latestSpeed: number | null = null;
            rowBytes += await streamHttpPayloadToSdFile(url, systemDirHandle, finalName, {
              signal,
              hadExistingFile: cardStatus.exactMatch,
              expectedBytes: target.sizeBytes > 0 ? target.sizeBytes : null,
              onStage: (stage) =>
                emitTransferUpdate({
                  stage,
                  filename: finalName,
                  destinationFolder: targetFolderRel,
                  currentFileBytes: latestFileBytes,
                  currentFileTotalBytes: latestFileTotal,
                  bytesPerSec: stage === 'writing' ? latestSpeed : null,
                }),
              onProgress: (prog) => {
                latestFileBytes = prog.bytesWritten;
                latestFileTotal = prog.totalBytes;
                latestSpeed = prog.bytesPerSec;
                emitTransferUpdate({
                  stage: 'writing',
                  filename: finalName,
                  destinationFolder: targetFolderRel,
                  currentFileBytes: prog.bytesWritten,
                  currentFileTotalBytes: prog.totalBytes,
                  bytesPerSec: prog.bytesPerSec,
                });
              },
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

      const waitingForAutoConfig = Boolean(autoConfigPromiseRef.current);

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
          writeDetail: waitingForAutoConfig ? 'Scanning device folders...' : 'Queued',
          bytesWritten: 0,
        };
      });

      const firstPlaceholder = placeholderRows[0];
      const initialJob: BulkInstallJobState = {
        jobId,
        mode: 'express',
        phase: 'running',
        itemIds: cleanIds,
        filterContext,
        rows: placeholderRows,
        currentTitle: firstPlaceholder?.title || null,
        activeTransfer: firstPlaceholder
          ? {
              itemId: firstPlaceholder.itemId,
              rowKey: firstPlaceholder.rowKey,
              title: firstPlaceholder.title,
              stage: waitingForAutoConfig ? 'scanning_device' : 'inspecting',
              filename: null,
              destinationFolder: null,
              bytesWritten: 0,
              totalBytes: null,
              percent: null,
              bytesPerSec: null,
              fileIndex: 1,
              totalFiles: 1,
            }
          : null,
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
          if (autoConfigPromiseRef.current) {
            await autoConfigPromiseRef.current;
          }

          for (let offset = 0; offset < cleanIds.length; offset += EXPRESS_INSPECT_CHUNK_SIZE) {
            if (controller.signal.aborted) {
              throw new DOMException('Installation canceled by user.', 'AbortError');
            }

            const chunkIds = cleanIds.slice(offset, offset + EXPRESS_INSPECT_CHUNK_SIZE);
            const chunkIdSet = new Set(chunkIds);
            const chunkLeadId = chunkIds[0];
            const chunkLeadMeta = knownMeta?.get(chunkLeadId);

            setJob((prev) => {
              if (!prev || prev.jobId !== jobId) return prev;
              return {
                ...prev,
                currentTitle: chunkLeadMeta?.title || prev.currentTitle,
                activeTransfer: {
                  itemId: chunkLeadId,
                  rowKey: `${chunkLeadId}-placeholder`,
                  title: chunkLeadMeta?.title || `Catalog Release #${chunkLeadId}`,
                  stage: 'inspecting',
                  filename: null,
                  destinationFolder: null,
                  bytesWritten: 0,
                  totalBytes: null,
                  percent: null,
                  bytesPerSec: null,
                  fileIndex: 1,
                  totalFiles: 1,
                },
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

              const firstSelectedTarget = row.targets.find((t) =>
                row.selectedTargetIds.includes(t.id),
              );
              const expectedRowBytes = row.selectedTargetIds.reduce((sum, tid) => {
                const t = row.targets.find((cand) => cand.id === tid);
                return sum + (t?.sizeBytes || 0);
              }, 0);

              setJob((prev) => {
                if (!prev || prev.jobId !== jobId) return prev;
                return {
                  ...prev,
                  currentTitle: row.title,
                  activeTransfer: {
                    itemId: row.itemId,
                    rowKey: row.rowKey,
                    title: row.title,
                    stage: 'extracting',
                    filename:
                      (firstSelectedTarget &&
                        (row.outputNamesByTargetId[firstSelectedTarget.id] ||
                          firstSelectedTarget.suggestedFilename)) ||
                      null,
                    destinationFolder: null,
                    bytesWritten: 0,
                    totalBytes: expectedRowBytes > 0 ? expectedRowBytes : null,
                    percent: null,
                    bytesPerSec: null,
                    fileIndex: 1,
                    totalFiles: Math.max(1, row.selectedTargetIds.length),
                  },
                  rows: prev.rows.map((r) =>
                    r.rowKey === row.rowKey
                      ? { ...r, writeState: 'writing', writeDetail: 'Extracting ROM...' }
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
                (transfer) => {
                  const detailText =
                    transfer.stage === 'extracting'
                      ? 'Extracting ROM...'
                      : transfer.stage === 'finalizing'
                        ? 'Finalizing on device...'
                        : transfer.totalBytes && transfer.percent !== null
                          ? `Writing ${formatBytes(transfer.bytesWritten)} / ${formatBytes(transfer.totalBytes)} (${transfer.percent}%)`
                          : transfer.bytesWritten > 0
                            ? `Writing ${formatBytes(transfer.bytesWritten)}...`
                            : 'Writing ROM...';
                  setJob((prev) => {
                    if (!prev || prev.jobId !== jobId) return prev;
                    return {
                      ...prev,
                      activeTransfer: transfer,
                      rows: prev.rows.map((r) =>
                        r.rowKey === row.rowKey
                          ? { ...r, writeDetail: detailText, bytesWritten: transfer.bytesWritten }
                          : r,
                      ),
                    };
                  });
                },
              );

              if (outcome.installedSuccess) {
                unsyncedInstalledIds.add(row.itemId);
              }

              setJob((prev) => {
                if (!prev || prev.jobId !== jobId) return prev;
                return {
                  ...prev,
                  activeTransfer:
                    prev.activeTransfer?.rowKey === row.rowKey ? null : prev.activeTransfer,
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
                  activeTransfer: null,
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
                activeTransfer: null,
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
                    activeTransfer: null,
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
        activeTransfer: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });

      try {
        if (autoConfigPromiseRef.current) {
          await autoConfigPromiseRef.current;
        }
        const allTargetFolders = new Set<string>();
        const storageCfg = effectiveStorageFolderConfigRef.current;
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

    if (autoConfigPromiseRef.current) {
      await autoConfigPromiseRef.current;
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
            activeTransfer: null,
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

          const firstSelectedTarget = row.targets.find((t) =>
            row.selectedTargetIds.includes(t.id),
          );
          const expectedRowBytes = row.selectedTargetIds.reduce((sum, tid) => {
            const t = row.targets.find((cand) => cand.id === tid);
            return sum + (t?.sizeBytes || 0);
          }, 0);

          setJob((prev) => {
            if (!prev || prev.jobId !== jobId) return prev;
            return {
              ...prev,
              currentTitle: row.title,
              activeTransfer: {
                itemId: row.itemId,
                rowKey: row.rowKey,
                title: row.title,
                stage: 'extracting',
                filename:
                  (firstSelectedTarget &&
                    (row.outputNamesByTargetId[firstSelectedTarget.id] ||
                      firstSelectedTarget.suggestedFilename)) ||
                  null,
                destinationFolder: null,
                bytesWritten: 0,
                totalBytes: expectedRowBytes > 0 ? expectedRowBytes : null,
                percent: null,
                bytesPerSec: null,
                fileIndex: 1,
                totalFiles: Math.max(1, row.selectedTargetIds.length),
              },
              rows: prev.rows.map((r) =>
                r.rowKey === row.rowKey
                  ? { ...r, writeState: 'writing', writeDetail: 'Extracting ROM...' }
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
            (transfer) => {
              const detailText =
                transfer.stage === 'extracting'
                  ? 'Extracting ROM...'
                  : transfer.stage === 'finalizing'
                    ? 'Finalizing on device...'
                    : transfer.totalBytes && transfer.percent !== null
                      ? `Writing ${formatBytes(transfer.bytesWritten)} / ${formatBytes(transfer.totalBytes)} (${transfer.percent}%)`
                      : transfer.bytesWritten > 0
                        ? `Writing ${formatBytes(transfer.bytesWritten)}...`
                        : 'Writing ROM...';
              setJob((prev) => {
                if (!prev || prev.jobId !== jobId) return prev;
                return {
                  ...prev,
                  activeTransfer: transfer,
                  rows: prev.rows.map((r) =>
                    r.rowKey === row.rowKey
                      ? { ...r, writeDetail: detailText, bytesWritten: transfer.bytesWritten }
                      : r,
                  ),
                };
              });
            },
          );

          if (outcome.installedSuccess) {
            unsyncedInstalledIds.add(row.itemId);
            sinceLastSync += 1;
          }

          setJob((prev) => {
            if (!prev || prev.jobId !== jobId) return prev;
            return {
              ...prev,
              activeTransfer:
                prev.activeTransfer?.rowKey === row.rowKey ? null : prev.activeTransfer,
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
                activeTransfer: null,
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
              activeTransfer: null,
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
                  activeTransfer: null,
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

  /**
   * Switches a game cleanly to a single chosen version/variant across all of its archive rows.
   */
  const selectOnlyTargetForItem = useCallback(
    (itemId: number, rowKey: string, targetId: string) => {
      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) => {
            if (row.itemId !== itemId) return row;
            if (row.rowKey === rowKey) {
              return { ...row, selectedTargetIds: [targetId] };
            }
            return { ...row, selectedTargetIds: [] };
          }),
        };
      });
    },
    [],
  );

  /**
   * Toggles an entire game on or off in the install queue. When re-enabling a game,
   * restores its Smart Recommended version(s) (or first playable target).
   */
  const toggleGameIncluded = useCallback((itemId: number) => {
    setJob((prev) => {
      if (!prev) return prev;
      const itemRows = prev.rows.filter((r) => r.itemId === itemId);
      const currentlyIncluded = itemRows.some((r) => r.selectedTargetIds.length > 0);
      if (currentlyIncluded) {
        return {
          ...prev,
          rows: prev.rows.map((row) =>
            row.itemId === itemId ? { ...row, selectedTargetIds: [] } : row,
          ),
        };
      }
      const hasAnyRecommended = itemRows.some((r) => r.recommendedTargetIds.length > 0);
      let assignedFallback = false;
      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.itemId !== itemId) return row;
          if (hasAnyRecommended) {
            return { ...row, selectedTargetIds: [...row.recommendedTargetIds] };
          }
          if (!assignedFallback && row.targets.length > 0) {
            assignedFallback = true;
            return { ...row, selectedTargetIds: [row.targets[0].id] };
          }
          return { ...row, selectedTargetIds: [] };
        }),
      };
    });
  }, []);

  /**
   * Selects or deselects every installable game in the queue.
   */
  const setAllGamesIncluded = useCallback((included: boolean) => {
    setJob((prev) => {
      if (!prev) return prev;
      if (!included) {
        return {
          ...prev,
          rows: prev.rows.map((row) => ({ ...row, selectedTargetIds: [] })),
        };
      }
      const hasRecommendedByItem = new Map<number, boolean>();
      for (const r of prev.rows) {
        if (r.recommendedTargetIds.length > 0) {
          hasRecommendedByItem.set(r.itemId, true);
        }
      }
      const fallbackAssigned = new Set<number>();
      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.targets.length === 0) return row;
          if (hasRecommendedByItem.get(row.itemId)) {
            return { ...row, selectedTargetIds: [...row.recommendedTargetIds] };
          }
          if (!fallbackAssigned.has(row.itemId)) {
            fallbackAssigned.add(row.itemId);
            return { ...row, selectedTargetIds: [row.targets[0].id] };
          }
          return { ...row, selectedTargetIds: [] };
        }),
      };
    });
  }, []);

  /**
   * Unchecks a specific set of games (e.g., games already present on the mounted storage device).
   */
  const excludeItemIds = useCallback((itemIds: Set<number>) => {
    if (itemIds.size === 0) return;
    setJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) =>
          itemIds.has(row.itemId) ? { ...row, selectedTargetIds: [] } : row,
        ),
      };
    });
  }, []);

  const resetItemToRecommended = useCallback((itemId: number) => {
    setJob((prev) => {
      if (!prev) return prev;
      const itemRows = prev.rows.filter((r) => r.itemId === itemId);
      const hasAnyRecommended = itemRows.some((r) => r.recommendedTargetIds.length > 0);
      let assignedFallback = false;
      return {
        ...prev,
        rows: prev.rows.map((row) => {
          if (row.itemId !== itemId) return row;
          if (hasAnyRecommended) {
            return { ...row, selectedTargetIds: [...row.recommendedTargetIds] };
          }
          if (!assignedFallback && row.targets.length > 0) {
            assignedFallback = true;
            return { ...row, selectedTargetIds: [row.targets[0].id] };
          }
          return { ...row, selectedTargetIds: [] };
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
    const active = job.activeTransfer;
    const activeFraction =
      active &&
      (job.phase === 'running' || job.phase === 'canceling') &&
      completedItems < totalItems
        ? active.stage === 'finalizing'
          ? 0.99
          : active.percent !== null
            ? Math.min(0.99, Math.max(0, active.percent / 100))
            : 0
        : 0;
    const progressPercent =
      totalItems > 0
        ? Math.min(100, Math.round(((completedItems + activeFraction) / totalItems) * 100))
        : 0;

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
    setSdRootHandle: applyMountedHandle,
    promptMountSdCard,
    mountError,
    clearMountError: () => setMountError(null),
    autoConfigPhase,
    autoConfigProgress,
    autoConfigResult,
    autoConfigError,
    autoConfigChosenPaths,
    autoConfigIncludeSubfolders,
    effectiveStorageFolderConfig,
    rescanAutoConfigure: () => {
      if (sdRootHandleRef.current) {
        return runDeviceAutoConfigure(sdRootHandleRef.current);
      }
      return Promise.resolve(null);
    },
    cancelAutoConfigure: () => {
      autoConfigAbortRef.current?.abort();
      autoConfigAbortRef.current = null;
      setAutoConfigPhase('idle');
    },
    setAutoConfigCandidatePath: (slug: string, relativePath: string) => {
      setAutoConfigChosenPaths((prev) => ({
        ...prev,
        [slug]: relativePath,
      }));
    },
    setAutoConfigIncludeSubfolders,
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
    selectOnlyTargetForItem,
    toggleGameIncluded,
    setAllGamesIncluded,
    excludeItemIds,
    resetItemToRecommended,
    autoPickSmartPrimaries,
    updateRowTargetName,
  };
}

export type BulkStorageInstallerController = ReturnType<typeof useBulkStorageInstaller>;
