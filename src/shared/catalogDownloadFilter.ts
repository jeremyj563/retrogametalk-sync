export const NOT_DOWNLOADED_STATUS_KEYS = [
  'available',
  'partial',
  'failed',
  'queued',
  'downloading',
] as const;

export function isDownloadedQuickFilterActive(statuses: readonly string[]): boolean {
  return statuses.length === 1 && statuses[0] === 'downloaded';
}

export function isNotDownloadedQuickFilterActive(statuses: readonly string[]): boolean {
  if (statuses.includes('downloaded')) return false;
  return (
    statuses.includes('available') &&
    (statuses.includes('needs_retry') ||
      (statuses.includes('partial') && statuses.includes('failed'))) &&
    statuses.includes('queued') &&
    statuses.includes('downloading')
  );
}

export function toggleDownloadedQuickFilter(statuses: readonly string[]): string[] {
  return isDownloadedQuickFilterActive(statuses) ? [] : ['downloaded'];
}

export function toggleNotDownloadedQuickFilter(statuses: readonly string[]): string[] {
  return isNotDownloadedQuickFilterActive(statuses) ? [] : [...NOT_DOWNLOADED_STATUS_KEYS];
}

export function reconcileManualStatusChange(
  previousStatuses: readonly string[],
  nextStatuses: readonly string[],
  statusCounts?: Record<string, number>,
): string[] {
  if (
    isNotDownloadedQuickFilterActive(previousStatuses) &&
    !isNotDownloadedQuickFilterActive(nextStatuses)
  ) {
    return nextStatuses.filter((st) => {
      if (st === 'queued' && (statusCounts?.queued ?? 0) === 0) return false;
      if (st === 'downloading' && (statusCounts?.downloading ?? 0) === 0) return false;
      return true;
    });
  }
  return [...nextStatuses];
}
