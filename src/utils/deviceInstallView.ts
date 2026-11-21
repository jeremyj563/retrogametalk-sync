import type { ExportQueueRow, ExportRowWriteState } from '../hooks/useBulkStorageInstaller';
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
import type { PlayableExportTarget } from '../types';
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

  return orderedItemIds.map((itemId) => {
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
    };
  });
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
