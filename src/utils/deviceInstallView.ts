import type {
  BulkInstallJobState,
  BulkInstallMetrics,
  DeviceInstallStage,
  ExportQueueRow,
  ExportRowWriteState,
} from '../hooks/useBulkStorageInstaller';
import { resolveRowTargetCategoryAndFolder } from '../hooks/useBulkStorageInstaller';
import {
  compareComparableVersions,
  parseComparableVersion,
  type ComparableVersion,
  type SmartRomFilterContext,
} from '../shared/smartRomPicker';
import {
  getStorageRomCategoryShortLabel,
  type StorageFolderMappingConfig,
} from '../shared/storageFolderMappings';
import { findItemInstallForDevice } from '../shared/deviceProfiles';
import type { PlayableExportTarget, ReleaseDeviceInstallRecord } from '../types';
import { formatBytes } from './format';
import { findUpgradeCandidateOnCard, type SdScanFolderResult } from './sdCardFs';

export type OptionDeviceStatus = 'new' | 'installed' | 'upgrade';

export interface GroupedInstallOption {
  optionKey: string;
  rowKey: string;
  itemId: number;
  fileId: number;
  sourceFilename: string;
  fileRole: string | null;
  target: PlayableExportTarget;
  outputName: string;
  targetFolder: string;
  fullDestinationPath: string;
  categoryLabel: string;
  versionLabel: string | null;
  version: ComparableVersion;
  discNumber: number | null;
  isSelected: boolean;
  isRecommended: boolean;
  smartReason: string | null;
  deviceStatus: OptionDeviceStatus;
  replacesEntryName: string | null;
  hasDuplicateDestination: boolean;
}

export interface GroupedInstallGame {
  itemId: number;
  title: string;
  systemName: string;
  rows: ExportQueueRow[];
  options: GroupedInstallOption[];
  selectedOptions: GroupedInstallOption[];
  primaryPreviewOption: GroupedInstallOption | null;
  totalSelectedBytes: number;
  hasMultipleOptions: boolean;
  hasMultipleArchives: boolean;
  isPlaceholder: boolean;
  hasNoPlayableRom: boolean;
  errorMessage: string | null;
  writeState: ExportRowWriteState;
  writeDetail: string | null;
  allSelectedAlreadyOnDevice: boolean;
  hasUpgradeOnDevice: boolean;
  hasDuplicateDestination: boolean;
}

export interface DestinationFolderSummary {
  folder: string;
  gameCount: number;
  fileCount: number;
  totalBytes: number;
}

const DISC_NUMBER_RE = /\b(?:disc|disk|cd|side)\s*0*([1-9]\d?|[a-d])\b/i;

function extractDiscNumber(text: string): number | null {
  const m = text.match(DISC_NUMBER_RE);
  if (!m) return null;
  const token = m[1].toUpperCase();
  const num = /^[A-D]$/.test(token) ? token.charCodeAt(0) - 64 : Number.parseInt(token, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseOptionBestVersion(
  row: Pick<ExportQueueRow, 'sourceFilename' | 'fileDisplayLabel'>,
  target: Pick<PlayableExportTarget, 'displayName' | 'suggestedFilename' | 'detectedVersion'>,
): ComparableVersion {
  const candidates = [
    parseComparableVersion(target.displayName),
    parseComparableVersion(target.suggestedFilename),
    parseComparableVersion(row.sourceFilename),
    row.fileDisplayLabel ? parseComparableVersion(row.fileDisplayLabel) : null,
    target.detectedVersion ? parseComparableVersion(target.detectedVersion) : null,
  ].filter((c): c is ComparableVersion => Boolean(c));

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (compareComparableVersions(candidates[i], best) > 0) {
      best = candidates[i];
    }
  }
  return best;
}

export function formatDevicePath(
  deviceName: string | null | undefined,
  targetFolder: string,
  outputName?: string | null,
  isDiscSet = false,
): string {
  const cleanFolder = targetFolder.replace(/^\/+|\/+$/g, '');
  const rootPrefix = deviceName ? `${deviceName}/` : '/';
  const folderSegment = cleanFolder ? `${rootPrefix}${cleanFolder}/` : rootPrefix;
  if (!outputName) return folderSegment;
  const cleanName = isDiscSet ? `${outputName.replace(/\.zip$/i, '')}/` : outputName;
  return `${folderSegment}${cleanName}`;
}

export function buildInstallModalTitle(params: {
  phase: string;
  itemCount: number;
  deviceName: string | null;
}): string {
  const { phase, itemCount, deviceName } = params;
  const targetLabel = deviceName || 'Device';

  if (phase === 'running' || phase === 'canceling') {
    return `Installing to ${targetLabel}`;
  }
  if (phase === 'completed') {
    return `Installed to ${targetLabel}`;
  }
  if (phase === 'canceled') {
    return 'Install Stopped';
  }
  if (phase === 'error') {
    return 'Install Error';
  }
  if (itemCount <= 1) {
    return `Install to ${targetLabel}`;
  }
  return `Install ${itemCount.toLocaleString()} Games to ${targetLabel}`;
}

function resolveAggregateWriteState(rows: ExportQueueRow[]): {
  writeState: ExportRowWriteState;
  writeDetail: string | null;
} {
  const activeRows = rows.filter(
    (r) =>
      r.isPlaceholder ||
      r.selectedTargetIds.length > 0 ||
      r.writeState === 'writing' ||
      r.writeState === 'written' ||
      r.writeState === 'upgraded' ||
      r.writeState === 'error' ||
      r.writeState === 'canceled',
  );
  const check = activeRows.length > 0 ? activeRows : rows;

  const writing = check.find((r) => r.writeState === 'writing');
  if (writing) return { writeState: 'writing', writeDetail: writing.writeDetail };

  const inspecting = check.find((r) => r.writeState === 'inspecting');
  if (inspecting) return { writeState: 'inspecting', writeDetail: inspecting.writeDetail };

  const errored = check.find((r) => r.writeState === 'error');
  if (errored) return { writeState: 'error', writeDetail: errored.writeDetail || errored.error };

  const upgraded = check.find((r) => r.writeState === 'upgraded');
  if (upgraded) return { writeState: 'upgraded', writeDetail: upgraded.writeDetail };

  const written = check.find((r) => r.writeState === 'written');
  if (written) return { writeState: 'written', writeDetail: written.writeDetail };

  const canceled = check.find((r) => r.writeState === 'canceled');
  if (canceled) return { writeState: 'canceled', writeDetail: canceled.writeDetail || 'Canceled' };

  const skipped = check.find((r) => r.writeState === 'skipped');
  if (skipped && check.every((r) => r.writeState === 'skipped')) {
    return { writeState: 'skipped', writeDetail: skipped.writeDetail || skipped.error || 'Skipped' };
  }

  return { writeState: 'pending', writeDetail: check[0]?.writeDetail || null };
}

/**
 * Collapses archive-level ExportQueueRows into unified per-game view models so multi-file
 * releases appear once with all playable versions/variants sorted newest-first.
 */
export function groupInstallRowsByGame(params: {
  rows: ExportQueueRow[];
  storageConfig: StorageFolderMappingConfig;
  filterContext: SmartRomFilterContext;
  folderScans: Record<string, SdScanFolderResult>;
  deviceName: string | null;
}): GroupedInstallGame[] {
  const { rows, storageConfig, filterContext, folderScans, deviceName } = params;

  const orderedItemIds: number[] = [];
  const rowsByItem = new Map<number, ExportQueueRow[]>();
  for (const row of rows) {
    let list = rowsByItem.get(row.itemId);
    if (!list) {
      list = [];
      rowsByItem.set(row.itemId, list);
      orderedItemIds.push(row.itemId);
    }
    list.push(row);
  }

  const games: GroupedInstallGame[] = orderedItemIds.map((itemId) => {
    const itemRows = rowsByItem.get(itemId) || [];
    const first = itemRows[0];
    const isPlaceholder = itemRows.every((r) => Boolean(r.isPlaceholder));

    const rawOptions: Array<GroupedInstallOption & { originalIdx: number }> = [];
    let optIdx = 0;

    for (const row of itemRows) {
      for (const target of row.targets) {
        const meta = resolveRowTargetCategoryAndFolder(row, target, storageConfig, filterContext);
        const outputName = row.outputNamesByTargetId[target.id] ?? target.suggestedFilename;
        const scan = folderScans[meta.folder];
        const cardCheck = findUpgradeCandidateOnCard(outputName, scan);
        const version = parseOptionBestVersion(row, target);
        const discNumber = extractDiscNumber(`${target.displayName} ${row.sourceFilename}`);
        const deviceStatus: OptionDeviceStatus = cardCheck.exactMatch
          ? 'installed'
          : cardCheck.olderEntryName
            ? 'upgrade'
            : 'new';

        rawOptions.push({
          originalIdx: optIdx++,
          optionKey: `${row.rowKey}:${target.id}`,
          rowKey: row.rowKey,
          itemId: row.itemId,
          fileId: row.fileId,
          sourceFilename: row.sourceFilename,
          fileRole: row.fileRole && row.fileRole !== 'ROM' ? row.fileRole : null,
          target,
          outputName,
          targetFolder: meta.folder,
          fullDestinationPath: formatDevicePath(
            deviceName,
            meta.folder,
            outputName,
            target.kind === 'disc_set',
          ),
          categoryLabel: getStorageRomCategoryShortLabel(meta.category),
          versionLabel: target.detectedVersion || version.rawLabel,
          version,
          discNumber,
          isSelected: row.selectedTargetIds.includes(target.id),
          isRecommended: row.recommendedTargetIds.includes(target.id),
          smartReason: row.smartReasonsByTargetId[target.id] || null,
          deviceStatus,
          replacesEntryName: cardCheck.olderEntryName,
          hasDuplicateDestination: false,
        });
      }
    }

    rawOptions.sort((a, b) => {
      if (a.isRecommended !== b.isRecommended) {
        return a.isRecommended ? -1 : 1;
      }
      const verCmp = compareComparableVersions(a.version, b.version);
      if (verCmp !== 0) {
        return -verCmp;
      }
      if (a.discNumber !== null && b.discNumber !== null && a.discNumber !== b.discNumber) {
        return a.discNumber - b.discNumber;
      }
      return a.originalIdx - b.originalIdx;
    });

    const options: GroupedInstallOption[] = rawOptions.map(({ originalIdx: _ignored, ...rest }) => rest);
    const selectedOptions = options.filter((o) => o.isSelected);
    const primaryPreviewOption = selectedOptions[0] || options[0] || null;
    const totalSelectedBytes = selectedOptions.reduce((sum, o) => sum + (o.target.sizeBytes || 0), 0);
    const distinctArchives = new Set(options.map((o) => o.fileId)).size;
    const { writeState, writeDetail } = resolveAggregateWriteState(itemRows);

    const hasNoPlayableRom = !isPlaceholder && options.length === 0;
    const errorMessage = hasNoPlayableRom
      ? itemRows.map((r) => r.error || r.writeDetail).find(Boolean) || 'No playable ROM found'
      : null;

    const allSelectedAlreadyOnDevice =
      selectedOptions.length > 0 && selectedOptions.every((o) => o.deviceStatus === 'installed');
    const hasUpgradeOnDevice = selectedOptions.some((o) => o.deviceStatus === 'upgrade');

    return {
      itemId,
      title: first.title,
      systemName: first.systemName,
      rows: itemRows,
      options,
      selectedOptions,
      primaryPreviewOption,
      totalSelectedBytes,
      hasMultipleOptions: options.length > 1,
      hasMultipleArchives: distinctArchives > 1,
      isPlaceholder,
      hasNoPlayableRom,
      errorMessage,
      writeState,
      writeDetail,
      allSelectedAlreadyOnDevice,
      hasUpgradeOnDevice,
      hasDuplicateDestination: false,
    };
  });

  // Detect any remaining duplicate destination paths across all selected files in the batch
  // (e.g., from manual renames or cross-release filename collisions).
  const destinationCounts = new Map<string, number>();
  const getDestinationKey = (opt: GroupedInstallOption): string | null => {
    const cleanName = (
      opt.target.kind === 'disc_set' ? opt.outputName.replace(/\.zip$/i, '') : opt.outputName
    )
      .trim()
      .toLowerCase();
    if (!cleanName) return null;
    const cleanFolder = opt.targetFolder.replace(/^\/+|\/+$/g, '').toLowerCase();
    return `${cleanFolder}::${cleanName}`;
  };

  for (const game of games) {
    for (const opt of game.selectedOptions) {
      const key = getDestinationKey(opt);
      if (!key) continue;
      destinationCounts.set(key, (destinationCounts.get(key) || 0) + 1);
    }
  }

  for (const game of games) {
    let gameHasDup = false;
    for (const opt of game.selectedOptions) {
      const key = getDestinationKey(opt);
      const isDup = Boolean(key && (destinationCounts.get(key) || 0) > 1);
      opt.hasDuplicateDestination = isDup;
      if (isDup) gameHasDup = true;
    }
    game.hasDuplicateDestination = gameHasDup;
  }

  return games;
}

export function summarizeDestinationFolders(
  games: GroupedInstallGame[],
): DestinationFolderSummary[] {
  const byFolder = new Map<string, { gameIds: Set<number>; fileCount: number; totalBytes: number }>();

  for (const game of games) {
    for (const opt of game.selectedOptions) {
      let bucket = byFolder.get(opt.targetFolder);
      if (!bucket) {
        bucket = { gameIds: new Set<number>(), fileCount: 0, totalBytes: 0 };
        byFolder.set(opt.targetFolder, bucket);
      }
      bucket.gameIds.add(game.itemId);
      bucket.fileCount += 1;
      bucket.totalBytes += opt.target.sizeBytes || 0;
    }
  }

  return Array.from(byFolder.entries())
    .map(([folder, stats]) => ({
      folder,
      gameCount: stats.gameIds.size,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
    }))
    .sort((a, b) => b.gameCount - a.gameCount || a.folder.localeCompare(b.folder));
}

export type ItemDeviceInstallStatus =
  | 'idle'
  | 'active'
  | 'queued'
  | 'completed'
  | 'error'
  | 'canceled';

export type ItemDeviceInstallBarMode = 'idle' | 'preparing' | 'determinate' | 'indeterminate';

export interface ResolvedItemDeviceInstallState {
  status: ItemDeviceInstallStatus;
  isActive: boolean;
  isFinished: boolean;
  stage: DeviceInstallStage | 'queued' | 'canceling' | null;
  mode: ItemDeviceInstallBarMode;
  percent: number | null;
  bytesWritten: number;
  totalBytes: number | null;
  bytesLabel: string;
  speedLabel: string;
  stageLabel: string;
  filename: string | null;
  destinationPath: string | null;
  fileSequenceLabel: string | null;
  outcomeKind: 'written' | 'upgraded' | 'skipped' | 'error' | 'canceled' | null;
  outcomeSummary: string | null;
  isBatchJob: boolean;
  batchCompletedItems: number;
  batchTotalItems: number;
  jobId: number | null;
}

const IDLE_ITEM_DEVICE_INSTALL: ResolvedItemDeviceInstallState = {
  status: 'idle',
  isActive: false,
  isFinished: false,
  stage: null,
  mode: 'idle',
  percent: null,
  bytesWritten: 0,
  totalBytes: null,
  bytesLabel: '',
  speedLabel: '',
  stageLabel: '',
  filename: null,
  destinationPath: null,
  fileSequenceLabel: null,
  outcomeKind: null,
  outcomeSummary: null,
  isBatchJob: false,
  batchCompletedItems: 0,
  batchTotalItems: 0,
  jobId: null,
};

/**
 * Resolves live device installation progress or finished outcome for a specific catalog item.
 * Shared across GameDetailDrawer, Catalog grid cards, and Catalog list rows.
 */
export function resolveItemDeviceInstallState(
  itemId: number,
  job: BulkInstallJobState | null,
  metrics: Pick<BulkInstallMetrics, 'completedItems' | 'totalItems'> | null,
  deviceName: string | null,
): ResolvedItemDeviceInstallState {
  if (!job || !job.itemIds.includes(itemId)) {
    return IDLE_ITEM_DEVICE_INSTALL;
  }

  // Do not show active/finished progress for a review queue that hasn't started writing yet
  if (job.mode === 'review' && (job.phase === 'inspecting' || job.phase === 'ready')) {
    return IDLE_ITEM_DEVICE_INSTALL;
  }

  const targetLabel = (deviceName || '').trim() || 'device';
  const isBatchJob = job.itemIds.length > 1;
  const batchCompletedItems = metrics?.completedItems ?? 0;
  const batchTotalItems = metrics?.totalItems ?? job.itemIds.length;
  const jobIsBusy = job.phase === 'running' || job.phase === 'inspecting' || job.phase === 'canceling';
  const isCanceling = job.phase === 'canceling';

  const active = job.activeTransfer;
  if (jobIsBusy && active && active.itemId === itemId) {
    const destPath =
      active.destinationFolder && active.filename
        ? `/${active.destinationFolder.replace(/^\/+|\/+$/g, '')}/${active.filename}`
        : active.filename || null;
    const fileSequenceLabel =
      active.totalFiles > 1 ? `File ${active.fileIndex}/${active.totalFiles}` : null;
    const speedLabel =
      active.bytesPerSec && active.bytesPerSec > 0 ? `${formatBytes(active.bytesPerSec)}/s` : '';

    if (isCanceling) {
      return {
        status: 'active',
        isActive: true,
        isFinished: false,
        stage: 'canceling',
        mode: 'preparing',
        percent: active.percent,
        bytesWritten: active.bytesWritten,
        totalBytes: active.totalBytes,
        bytesLabel: 'Stopping transfer…',
        speedLabel: '',
        stageLabel: `Stopping install to ${targetLabel}…`,
        filename: active.filename,
        destinationPath: destPath,
        fileSequenceLabel,
        outcomeKind: null,
        outcomeSummary: null,
        isBatchJob,
        batchCompletedItems,
        batchTotalItems,
        jobId: job.jobId,
      };
    }

    if (active.stage === 'scanning_device') {
      return {
        status: 'active',
        isActive: true,
        isFinished: false,
        stage: 'scanning_device',
        mode: 'preparing',
        percent: null,
        bytesWritten: 0,
        totalBytes: null,
        bytesLabel: `Scanning folders on ${targetLabel}…`,
        speedLabel: '',
        stageLabel: `Preparing ${targetLabel}…`,
        filename: null,
        destinationPath: null,
        fileSequenceLabel: null,
        outcomeKind: null,
        outcomeSummary: null,
        isBatchJob,
        batchCompletedItems,
        batchTotalItems,
        jobId: job.jobId,
      };
    }

    if (active.stage === 'inspecting') {
      return {
        status: 'active',
        isActive: true,
        isFinished: false,
        stage: 'inspecting',
        mode: 'preparing',
        percent: null,
        bytesWritten: 0,
        totalBytes: null,
        bytesLabel: 'Inspecting archive…',
        speedLabel: '',
        stageLabel: `Preparing install to ${targetLabel}…`,
        filename: null,
        destinationPath: null,
        fileSequenceLabel: null,
        outcomeKind: null,
        outcomeSummary: null,
        isBatchJob,
        batchCompletedItems,
        batchTotalItems,
        jobId: job.jobId,
      };
    }

    if (active.stage === 'extracting') {
      return {
        status: 'active',
        isActive: true,
        isFinished: false,
        stage: 'extracting',
        mode: 'preparing',
        percent: null,
        bytesWritten: active.bytesWritten,
        totalBytes: active.totalBytes,
        bytesLabel: active.totalBytes
          ? `Extracting ROM (${formatBytes(active.totalBytes)})…`
          : 'Extracting ROM from archive…',
        speedLabel: '',
        stageLabel: `Extracting for ${targetLabel}…`,
        filename: active.filename,
        destinationPath: destPath,
        fileSequenceLabel,
        outcomeKind: null,
        outcomeSummary: null,
        isBatchJob,
        batchCompletedItems,
        batchTotalItems,
        jobId: job.jobId,
      };
    }

    if (active.stage === 'converting_chd') {
      const pct = active.percent !== null ? Math.max(0, Math.min(100, Math.round(active.percent))) : null;
      return {
        status: 'active',
        isActive: true,
        isFinished: false,
        stage: 'converting_chd',
        mode: pct !== null ? 'determinate' : 'preparing',
        percent: pct,
        bytesWritten: active.bytesWritten,
        totalBytes: active.totalBytes,
        bytesLabel:
          pct !== null ? `Compressing disc to .chd (${pct}%)…` : 'Compressing disc to .chd…',
        speedLabel: '',
        stageLabel:
          pct !== null ? `Converting to .chd (${pct}%)…` : 'Converting to .chd…',
        filename: active.filename,
        destinationPath: destPath,
        fileSequenceLabel,
        outcomeKind: null,
        outcomeSummary: null,
        isBatchJob,
        batchCompletedItems,
        batchTotalItems,
        jobId: job.jobId,
      };
    }

    if (active.stage === 'finalizing') {
      const bytesLabel =
        active.totalBytes && active.totalBytes > 0
          ? `${formatBytes(active.bytesWritten)} / ${formatBytes(active.totalBytes)} · Finalizing…`
          : active.bytesWritten > 0
            ? `${formatBytes(active.bytesWritten)} · Finalizing…`
            : `Finalizing on ${targetLabel}…`;
      return {
        status: 'active',
        isActive: true,
        isFinished: false,
        stage: 'finalizing',
        mode: 'determinate',
        percent: 100,
        bytesWritten: active.bytesWritten,
        totalBytes: active.totalBytes ?? active.bytesWritten,
        bytesLabel,
        speedLabel: '',
        stageLabel: `Finalizing on ${targetLabel}…`,
        filename: active.filename,
        destinationPath: destPath,
        fileSequenceLabel,
        outcomeKind: null,
        outcomeSummary: null,
        isBatchJob,
        batchCompletedItems,
        batchTotalItems,
        jobId: job.jobId,
      };
    }

    // stage === 'writing'
    const isDeterminate = active.totalBytes !== null && active.totalBytes > 0 && active.percent !== null;
    const bytesLabel = isDeterminate
      ? `${formatBytes(active.bytesWritten)} / ${formatBytes(active.totalBytes!)}`
      : active.bytesWritten > 0
        ? formatBytes(active.bytesWritten)
        : `Writing to ${targetLabel}…`;

    return {
      status: 'active',
      isActive: true,
      isFinished: false,
      stage: 'writing',
      mode: isDeterminate ? 'determinate' : 'indeterminate',
      percent: isDeterminate ? active.percent : null,
      bytesWritten: active.bytesWritten,
      totalBytes: active.totalBytes,
      bytesLabel,
      speedLabel,
      stageLabel: `Installing to ${targetLabel}`,
      filename: active.filename,
      destinationPath: destPath,
      fileSequenceLabel,
      outcomeKind: null,
      outcomeSummary: null,
      isBatchJob,
      batchCompletedItems,
      batchTotalItems,
      jobId: job.jobId,
    };
  }

  const itemRows = job.rows.filter((r) => r.itemId === itemId);
  if (itemRows.length === 0) {
    return IDLE_ITEM_DEVICE_INSTALL;
  }

  const { writeState, writeDetail } = resolveAggregateWriteState(itemRows);
  const totalBytesWritten = itemRows.reduce((sum, r) => sum + (r.bytesWritten || 0), 0);

  if (jobIsBusy && (writeState === 'pending' || writeState === 'inspecting' || writeState === 'writing')) {
    return {
      status: writeState === 'pending' ? 'queued' : 'active',
      isActive: true,
      isFinished: false,
      stage: isCanceling
        ? 'canceling'
        : writeState === 'inspecting'
          ? 'inspecting'
          : writeState === 'writing'
            ? 'extracting'
            : 'queued',
      mode: 'preparing',
      percent: null,
      bytesWritten: totalBytesWritten,
      totalBytes: null,
      bytesLabel:
        writeState === 'inspecting'
          ? 'Inspecting archive…'
          : isBatchJob
            ? `Queued · ${batchCompletedItems}/${batchTotalItems} games done`
            : `Preparing install to ${targetLabel}…`,
      speedLabel: '',
      stageLabel:
        writeState === 'pending'
          ? `Queued for ${targetLabel}`
          : `Installing to ${targetLabel}`,
      filename: null,
      destinationPath: null,
      fileSequenceLabel: null,
      outcomeKind: null,
      outcomeSummary: null,
      isBatchJob,
      batchCompletedItems,
      batchTotalItems,
      jobId: job.jobId,
    };
  }

  if (writeState === 'written' || writeState === 'upgraded' || writeState === 'skipped') {
    return {
      status: 'completed',
      isActive: false,
      isFinished: true,
      stage: null,
      mode: 'idle',
      percent: 100,
      bytesWritten: totalBytesWritten,
      totalBytes: totalBytesWritten > 0 ? totalBytesWritten : null,
      bytesLabel: totalBytesWritten > 0 ? formatBytes(totalBytesWritten) : '',
      speedLabel: '',
      stageLabel:
        writeState === 'upgraded'
          ? `Updated on ${targetLabel}`
          : writeState === 'skipped'
            ? `Already on ${targetLabel}`
            : `Installed to ${targetLabel}`,
      filename: null,
      destinationPath: null,
      fileSequenceLabel: null,
      outcomeKind: writeState,
      outcomeSummary: writeDetail,
      isBatchJob,
      batchCompletedItems,
      batchTotalItems,
      jobId: job.jobId,
    };
  }

  if (writeState === 'error' || job.phase === 'error') {
    return {
      status: 'error',
      isActive: false,
      isFinished: true,
      stage: null,
      mode: 'idle',
      percent: null,
      bytesWritten: totalBytesWritten,
      totalBytes: null,
      bytesLabel: '',
      speedLabel: '',
      stageLabel: `Install to ${targetLabel} failed`,
      filename: null,
      destinationPath: null,
      fileSequenceLabel: null,
      outcomeKind: 'error',
      outcomeSummary: writeDetail || job.errorMessage || 'Device install failed',
      isBatchJob,
      batchCompletedItems,
      batchTotalItems,
      jobId: job.jobId,
    };
  }

  if (writeState === 'canceled' || job.phase === 'canceled') {
    return {
      status: 'canceled',
      isActive: false,
      isFinished: true,
      stage: null,
      mode: 'idle',
      percent: null,
      bytesWritten: totalBytesWritten,
      totalBytes: null,
      bytesLabel: '',
      speedLabel: '',
      stageLabel: `Install to ${targetLabel} canceled`,
      filename: null,
      destinationPath: null,
      fileSequenceLabel: null,
      outcomeKind: 'canceled',
      outcomeSummary: writeDetail || 'Canceled by user',
      isBatchJob,
      batchCompletedItems,
      batchTotalItems,
      jobId: job.jobId,
    };
  }

  return IDLE_ITEM_DEVICE_INSTALL;
}

/**
 * Determines whether a catalog item should present as already installed on the
 * currently mounted storage device (`Reinstall` instead of `Install`).
 *
 * Checks persisted catalog metadata (`installedAt` + `installedDeviceLabel`), and
 * while a multi-item device install job is still running (`installerIsBusy`), also
 * honors an already-completed live row outcome (`written` / `upgraded` / `skipped`)
 * so completed rows never flash back to `Install` before the batch finishes.
 */
export function isItemInstalledOnMountedDevice(params: {
  mountedDeviceName: string | null | undefined;
  activeDeviceId?: string | null;
  deviceInstalls?: ReleaseDeviceInstallRecord[] | null;
  installedAt: string | null | undefined;
  installedDeviceLabel: string | null | undefined;
  liveInstallState?: Pick<ResolvedItemDeviceInstallState, 'isFinished' | 'outcomeKind'> | null;
  installerIsBusy?: boolean;
}): boolean {
  const mounted = (params.mountedDeviceName || '').trim().toLowerCase();
  const activeId = (params.activeDeviceId || '').trim();
  if (!mounted && !activeId) return false;

  if (Array.isArray(params.deviceInstalls) && params.deviceInstalls.length > 0) {
    const match = findItemInstallForDevice(
      {
        deviceInstalls: params.deviceInstalls,
        installedAt: params.installedAt ?? null,
        installedDeviceLabel: params.installedDeviceLabel ?? null,
        installedFileId: null,
        installedFilename: null,
      },
      activeId || null,
      params.mountedDeviceName ?? null,
    );
    if (match) return true;
  } else if (params.installedAt) {
    const installedLabel = (params.installedDeviceLabel || '').trim().toLowerCase();
    if (!installedLabel || (mounted && installedLabel === mounted)) {
      return true;
    }
  }

  if (
    params.installerIsBusy &&
    params.liveInstallState?.isFinished &&
    (params.liveInstallState.outcomeKind === 'written' ||
      params.liveInstallState.outcomeKind === 'upgraded' ||
      params.liveInstallState.outcomeKind === 'skipped')
  ) {
    return true;
  }

  return false;
}

