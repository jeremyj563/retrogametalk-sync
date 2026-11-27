export const DEFAULT_MIN_FREE_DISK_GB = 2;
export const MAX_MIN_FREE_DISK_GB = 10_000;
export const GIB_BYTES = 1024 * 1024 * 1024;

export function normalizeMinFreeDiskGb(
  raw: unknown,
  fallback: number = DEFAULT_MIN_FREE_DISK_GB,
): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const clamped = Math.min(MAX_MIN_FREE_DISK_GB, Math.max(0, parsed));
  return Math.round(clamped * 10) / 10;
}

export function minFreeDiskGbToBytes(gb: number): number {
  const normalized = normalizeMinFreeDiskGb(gb, 0);
  return Math.max(0, Math.round(normalized * GIB_BYTES));
}

export function formatReserveGbLabel(gb: number): string {
  const normalized = normalizeMinFreeDiskGb(gb, 0);
  if (normalized <= 0) return '0 GB';
  return Number.isInteger(normalized) ? `${normalized} GB` : `${normalized.toFixed(1)} GB`;
}

function formatByteSizeCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = idx === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

export interface DiskSpaceEvaluation {
  checked: boolean;
  diskFreeBytes: number | null;
  reserveGb: number;
  reserveBytes: number;
  usableBytes: number | null;
  estimatedBytes: number;
  shortfallBytes: number;
  belowReserveNow: boolean;
  exceedsUsable: boolean;
  warningMessage: string | null;
}

export function evaluateDiskSpaceGuardrail(input: {
  diskFreeBytes: number | null | undefined;
  estimatedBytes?: number | null;
  minFreeDiskGb?: number | null;
}): DiskSpaceEvaluation {
  const reserveGb = normalizeMinFreeDiskGb(input.minFreeDiskGb, DEFAULT_MIN_FREE_DISK_GB);
  const reserveBytes = minFreeDiskGbToBytes(reserveGb);
  const estimatedBytes =
    typeof input.estimatedBytes === 'number' && Number.isFinite(input.estimatedBytes) && input.estimatedBytes > 0
      ? Math.round(input.estimatedBytes)
      : 0;
  const diskFreeBytes =
    typeof input.diskFreeBytes === 'number' && Number.isFinite(input.diskFreeBytes) && input.diskFreeBytes >= 0
      ? Math.round(input.diskFreeBytes)
      : null;

  if (diskFreeBytes === null) {
    return {
      checked: false,
      diskFreeBytes: null,
      reserveGb,
      reserveBytes,
      usableBytes: null,
      estimatedBytes,
      shortfallBytes: 0,
      belowReserveNow: false,
      exceedsUsable: false,
      warningMessage: null,
    };
  }

  const usableBytes = Math.max(0, diskFreeBytes - reserveBytes);
  const belowReserveNow = reserveBytes > 0 && diskFreeBytes < reserveBytes;
  const exceedsEstimated = estimatedBytes > 0 && estimatedBytes > usableBytes;
  const exceedsUsable = belowReserveNow || exceedsEstimated;
  const shortfallBytes = belowReserveNow
    ? Math.max(reserveBytes - diskFreeBytes, estimatedBytes)
    : exceedsEstimated
      ? estimatedBytes - usableBytes
      : 0;

  let warningMessage: string | null = null;
  if (belowReserveNow) {
    const reserveText = formatReserveGbLabel(reserveGb);
    warningMessage =
      estimatedBytes > 0
        ? `Estimated download (~${formatByteSizeCompact(estimatedBytes)}) exceeds available disk space (${formatByteSizeCompact(diskFreeBytes)} free on volume; below ${reserveText} safety reserve).`
        : `Free disk space (${formatByteSizeCompact(diskFreeBytes)}) is below the ${reserveText} safety reserve.`;
  } else if (exceedsEstimated) {
    const reserveSuffix = reserveBytes > 0 ? ` after ${formatReserveGbLabel(reserveGb)} safety reserve` : '';
    warningMessage = `Estimated download (~${formatByteSizeCompact(estimatedBytes)}) exceeds available disk space (${formatByteSizeCompact(usableBytes)} free${reserveSuffix}).`;
  }

  return {
    checked: true,
    diskFreeBytes,
    reserveGb,
    reserveBytes,
    usableBytes,
    estimatedBytes,
    shortfallBytes,
    belowReserveNow,
    exceedsUsable,
    warningMessage,
  };
}

export class DiskSpaceGuardrailError extends Error {
  readonly evaluation: DiskSpaceEvaluation;

  constructor(evaluation: DiskSpaceEvaluation, message?: string) {
    super(message || evaluation.warningMessage || 'Insufficient free disk space to safely continue downloads.');
    this.name = 'DiskSpaceGuardrailError';
    this.evaluation = evaluation;
  }
}
