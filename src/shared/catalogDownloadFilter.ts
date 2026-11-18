import type { CatalogDownloadedFilter } from '../types';

export const GRANULAR_STATUS_VALUES = new Set([
  'needs_retry',
  'partial',
  'failed',
  'queued',
  'downloading',
]);

export function sanitizeStoredDownloadedFilter(raw: unknown): CatalogDownloadedFilter {
  if (raw === 'only' || raw === 'exclude') return raw;
  return 'all';
}

export function toggleCatalogDownloadedFilter(
  current: CatalogDownloadedFilter,
  target: 'only' | 'exclude',
): CatalogDownloadedFilter {
  return current === target ? 'all' : target;
}

export function migrateLegacyCatalogDownloadPrefs(
  rawStatuses: readonly string[],
  rawDownloadedFilter: unknown,
): {
  downloadedFilter: CatalogDownloadedFilter;
  statuses: string[];
} {
  if (rawDownloadedFilter === 'only' || rawDownloadedFilter === 'exclude' || rawDownloadedFilter === 'all') {
    return {
      downloadedFilter: rawDownloadedFilter,
      statuses: rawStatuses.filter((st) => GRANULAR_STATUS_VALUES.has(st)),
    };
  }

  // Migrate 1.5.2/1.5.3 status-array presets stored in localStorage
  if (rawStatuses.length === 1 && rawStatuses[0] === 'downloaded') {
    return { downloadedFilter: 'only', statuses: [] };
  }

  const hasNotDownloadedPreset =
    !rawStatuses.includes('downloaded') &&
    rawStatuses.includes('available') &&
    (rawStatuses.includes('needs_retry') ||
      (rawStatuses.includes('partial') && rawStatuses.includes('failed'))) &&
    rawStatuses.includes('queued') &&
    rawStatuses.includes('downloading');

  if (hasNotDownloadedPreset) {
    return { downloadedFilter: 'exclude', statuses: [] };
  }

  if (rawStatuses.includes('available') && !rawStatuses.includes('downloaded')) {
    return {
      downloadedFilter: 'exclude',
      statuses: rawStatuses.filter((st) => GRANULAR_STATUS_VALUES.has(st)),
    };
  }

  return {
    downloadedFilter: 'all',
    statuses: rawStatuses.filter((st) => GRANULAR_STATUS_VALUES.has(st)),
  };
}
