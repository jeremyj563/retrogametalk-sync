import type { ItemStatus } from '../types';

export interface CatalogIdsStatusPayload {
  ids?: number[];
  queueableIds?: number[];
  downloadableIds?: number[];
  alreadyQueuedIds?: number[];
}

export interface CatalogSelectionSummary {
  totalSelected: number;
  queueableIds: number[];
  installableIds: number[];
  alreadyDownloadedCount: number;
  alreadyQueuedCount: number;
  notYetDownloadedCount: number;
  unknownStatusCount: number;
}

export interface CatalogQueueabilityOptions {
  /**
   * When true (no active download queue worker is running), releases left in
   * `queued` state after a Stop or process restart (e.g., SIGTERM) are treated
   * as queueable/resumable rather than actively queued.
   */
  includePausedQueued?: boolean;
}

/**
 * Releases that can be newly queued into the background downloader.
 * Matches backend queryRepositoryItemIds eligibility 1-to-1.
 */
export function isCatalogStatusQueueable(
  status: string | null | undefined,
  options?: CatalogQueueabilityOptions,
): boolean {
  if (status === 'available' || status === 'failed' || status === 'partial') {
    return true;
  }
  return Boolean(options?.includePausedQueued) && status === 'queued';
}

/**
 * Releases that already have ROM archives on disk ready for storage device export.
 * Includes `partial` releases because at least one file has already been downloaded.
 */
export function isCatalogStatusInstallable(status: string | null | undefined): boolean {
  return status === 'downloaded' || status === 'skipped' || status === 'partial';
}

export function isCatalogStatusAlreadyDownloaded(status: string | null | undefined): boolean {
  return status === 'downloaded' || status === 'skipped';
}

export function isCatalogStatusAlreadyQueued(
  status: string | null | undefined,
  options?: CatalogQueueabilityOptions,
): boolean {
  if (options?.includePausedQueued) {
    return status === 'downloading';
  }
  return status === 'queued' || status === 'downloading';
}

/**
 * Reconstructs a per-ID status map from `/api/items/ids` buckets so cross-page
 * selections retain exact queue/install eligibility even after individual cards
 * are unchecked or pages change.
 */
export function deriveStatusMapFromIdsPayload(
  payload: CatalogIdsStatusPayload,
): Map<number, ItemStatus> {
  const queueableSet = new Set(payload.queueableIds ?? []);
  const downloadableSet = new Set(payload.downloadableIds ?? []);
  const alreadyQueuedSet = new Set(payload.alreadyQueuedIds ?? []);
  const allIds = new Set<number>([
    ...(payload.ids ?? []),
    ...queueableSet,
    ...downloadableSet,
    ...alreadyQueuedSet,
  ]);

  const map = new Map<number, ItemStatus>();
  for (const id of allIds) {
    const inQueueable = queueableSet.has(id);
    const inDownloadable = downloadableSet.has(id);
    if (inQueueable && inDownloadable) {
      map.set(id, 'partial');
    } else if (inDownloadable) {
      map.set(id, 'downloaded');
    } else if (alreadyQueuedSet.has(id)) {
      map.set(id, 'queued');
    } else if (inQueueable) {
      map.set(id, 'available');
    }
  }
  return map;
}

/**
 * Summarizes the exact queueable and installable subsets of a Catalog selection
 * along with skip counts for tooltips.
 */
export function summarizeCatalogSelection(
  selectedIds: Iterable<number>,
  statusById: ReadonlyMap<number, ItemStatus>,
  options?: CatalogQueueabilityOptions,
): CatalogSelectionSummary {
  const queueableIds: number[] = [];
  const installableIds: number[] = [];
  let totalSelected = 0;
  let alreadyDownloadedCount = 0;
  let alreadyQueuedCount = 0;
  let notYetDownloadedCount = 0;
  let unknownStatusCount = 0;

  for (const id of selectedIds) {
    totalSelected += 1;
    const status = statusById.get(id);
    if (!status) {
      unknownStatusCount += 1;
      queueableIds.push(id);
      installableIds.push(id);
      continue;
    }

    if (isCatalogStatusQueueable(status, options)) {
      queueableIds.push(id);
    }
    if (isCatalogStatusInstallable(status)) {
      installableIds.push(id);
    }

    if (isCatalogStatusAlreadyDownloaded(status)) {
      alreadyDownloadedCount += 1;
    } else if (isCatalogStatusAlreadyQueued(status, options)) {
      alreadyQueuedCount += 1;
      notYetDownloadedCount += 1;
    } else if (!isCatalogStatusInstallable(status)) {
      notYetDownloadedCount += 1;
    }
  }

  return {
    totalSelected,
    queueableIds,
    installableIds,
    alreadyDownloadedCount,
    alreadyQueuedCount,
    notYetDownloadedCount,
    unknownStatusCount,
  };
}

export function formatQueueSelectedTooltip(
  summary: CatalogSelectionSummary,
  hasCompletedLogin: boolean,
): string {
  if (!hasCompletedLogin) {
    return 'Verify login in System Settings before queueing downloads';
  }
  const count = summary.queueableIds.length;
  const base = `Queue ${count.toLocaleString()} un-downloaded release${count === 1 ? '' : 's'} for background download`;
  const skippedParts: string[] = [];
  if (summary.alreadyDownloadedCount > 0) {
    skippedParts.push(`${summary.alreadyDownloadedCount.toLocaleString()} already downloaded`);
  }
  if (summary.alreadyQueuedCount > 0) {
    skippedParts.push(`${summary.alreadyQueuedCount.toLocaleString()} already queued`);
  }
  if (skippedParts.length === 0) {
    return base;
  }
  return `${base} (${skippedParts.join(', ')} skipped)`;
}

export function formatInstallSelectedTooltip(
  mode: 'express' | 'review',
  summary: CatalogSelectionSummary,
  isBusy: boolean,
  mountedDeviceName?: string | null,
  canQueueMore = false,
): string {
  if (isBusy) {
    return 'Another storage device install is currently in progress';
  }
  const count = summary.installableIds.length;
  const gameWord = count === 1 ? 'game' : 'games';
  const trimmedDevice = (mountedDeviceName || '').trim();
  const base =
    mode === 'express'
      ? canQueueMore
        ? trimmedDevice
          ? `Add ${count.toLocaleString()} downloaded ${gameWord} to the active install queue on ${trimmedDevice}`
          : `Add ${count.toLocaleString()} downloaded ${gameWord} to the active device install queue`
        : trimmedDevice
          ? `Install the latest primary ROM for ${count.toLocaleString()} downloaded ${gameWord} directly to ${trimmedDevice}`
          : `Mount a storage device and install the latest primary ROM for ${count.toLocaleString()} downloaded ${gameWord}`
      : `Choose versions, rename ROMs, or preview destination folders for ${count.toLocaleString()} downloaded ${gameWord} before installing`;
  if (summary.notYetDownloadedCount <= 0) {
    return base;
  }
  return `${base} (${summary.notYetDownloadedCount.toLocaleString()} not yet downloaded skipped)`;
}

export function formatDownloadFilteredTooltip(params: {
  hasCompletedLogin: boolean;
  hasActiveFilters: boolean;
  queueableCount: number;
  totalMatching: number;
}): string {
  const { hasCompletedLogin, hasActiveFilters, queueableCount, totalMatching } = params;
  if (!hasCompletedLogin) {
    return 'Verify login in System Settings before queueing downloads';
  }
  const scope = hasActiveFilters ? 'matching your active filters' : 'in the catalog';
  const base = `Preview and queue ${queueableCount.toLocaleString()} un-downloaded release${queueableCount === 1 ? '' : 's'} ${scope}`;
  const skipped = Math.max(0, totalMatching - queueableCount);
  if (skipped === 0) {
    return base;
  }
  return `${base} (${skipped.toLocaleString()} already downloaded or queued skipped)`;
}
