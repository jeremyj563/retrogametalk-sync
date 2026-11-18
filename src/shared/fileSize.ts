export function parseHumanFileSizeToBytes(raw: string | null | undefined): number {
  if (!raw) return 0;
  const normalized = String(raw).trim().replace(/,/g, '');
  if (!normalized) return 0;

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib)?$/i);
  if (!match) return 0;

  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num) || num <= 0) return 0;

  const unit = (match[2] || 'b').toLowerCase();
  if (unit === 'b' || unit === 'byte' || unit === 'bytes') return Math.round(num);
  if (unit === 'kb' || unit === 'kib') return Math.round(num * 1024);
  if (unit === 'mb' || unit === 'mib') return Math.round(num * 1024 * 1024);
  if (unit === 'gb' || unit === 'gib') return Math.round(num * 1024 * 1024 * 1024);
  if (unit === 'tb' || unit === 'tib') return Math.round(num * 1024 * 1024 * 1024 * 1024);
  return Math.round(num);
}

export function estimateDownloadHintsBytes(
  hints: readonly { filename: string; fileSize: string }[] | null | undefined,
): number {
  if (!hints || hints.length === 0) return 0;
  let total = 0;
  for (const hint of hints) {
    total += parseHumanFileSizeToBytes(hint.fileSize);
  }
  return total;
}
