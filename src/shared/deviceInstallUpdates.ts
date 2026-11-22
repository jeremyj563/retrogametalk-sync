export const INSTALL_UPDATE_GRACE_MS = 60_000;

export type InstalledUpdateState =
  | 'not_installed'
  | 'up_to_date'
  | 'update_ready_local'
  | 'update_available_remote';

export interface InstalledUpdateFileLike {
  id: number;
  filename: string;
  localPath?: string | null;
  status: string;
  downloadedAt: string | null;
}

export interface InstalledUpdateDownloadHintLike {
  filename?: string | null;
  fileSize?: string | null;
}

export interface InstalledUpdateItemLike {
  status: string;
  installedAt: string | null;
  installedDeviceLabel?: string | null;
  installedFileId?: number | null;
  installedFilename?: string | null;
  downloadedAt: string | null;
  remoteUpdatedAt: string | null;
  remoteCheckedAt?: string | null;
  downloadHints?: readonly InstalledUpdateDownloadHintLike[] | null;
  metadata?: {
    downloadHints?: readonly InstalledUpdateDownloadHintLike[] | null;
  } | null;
  files?: InstalledUpdateFileLike[];
}

export interface InstalledUpdateInfo {
  state: InstalledUpdateState;
  hasUpdate: boolean;
  readyToUpgradeLocal: boolean;
  needsLocalDownload: boolean;
  installedAt: string | null;
  latestLocalDownloadedAt: string | null;
  remoteUpdatedAt: string | null;
  newerLocalFile: {
    id: number;
    filename: string;
    downloadedAt: string | null;
  } | null;
  summaryLabel: string | null;
  tooltip: string | null;
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Normalizes a ROM archive filename or path into a canonical comparison key
 * matching the server's path sanitization rules (safe URI decoding, basename
 * extraction, Windows-illegal char replacement, whitespace/case folding).
 */
export function normalizeUpdateFilenameKey(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  const normalizedSlashes = decoded.replace(/\\/g, '/');
  const slashIdx = normalizedSlashes.lastIndexOf('/');
  const base = slashIdx >= 0 ? normalizedSlashes.slice(slashIdx + 1) : normalizedSlashes;
  return base
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveItemDownloadHints(
  item: Pick<InstalledUpdateItemLike, 'downloadHints' | 'metadata'> | null | undefined,
): readonly InstalledUpdateDownloadHintLike[] | null {
  if (!item) return null;
  if (Array.isArray(item.downloadHints)) return item.downloadHints;
  if (Array.isArray(item.metadata?.downloadHints)) return item.metadata.downloadHints;
  return null;
}

/**
 * Compares catalog `downloadHints` filenames (from WordPress ACF or live page inspection)
 * against locally mirrored files in `catalog_release_files`.
 *
 * Returns:
 * - `null` when no usable `downloadHints` filenames are available (caller falls back to timestamps)
 * - `false` when every remote hint filename is already mirrored locally (metadata-only WP edit)
 * - `true` when at least one remote hint filename is not yet mirrored locally
 */
export function hasUnmirroredRemoteDownloadHints(
  hints: readonly InstalledUpdateDownloadHintLike[] | null | undefined,
  files: readonly InstalledUpdateFileLike[] | null | undefined,
): boolean | null {
  if (!hints || hints.length === 0) return null;
  const hintKeys = new Set<string>();
  for (const hint of hints) {
    const key = normalizeUpdateFilenameKey(hint?.filename);
    if (key) hintKeys.add(key);
  }
  if (hintKeys.size === 0) return null;

  const localKeys = new Set<string>();
  for (const file of files || []) {
    if (file.status !== 'downloaded' && file.status !== 'skipped') continue;
    const filenameKey = normalizeUpdateFilenameKey(file.filename);
    if (filenameKey) localKeys.add(filenameKey);
    if (file.localPath) {
      const localPathKey = normalizeUpdateFilenameKey(file.localPath);
      if (localPathKey) localKeys.add(localPathKey);
    }
  }

  for (const hintKey of hintKeys) {
    if (!localKeys.has(hintKey)) {
      return true;
    }
  }
  return false;
}

function isRemoteTimestampAlreadyVerified(
  remoteMs: number | null,
  remoteCheckedMs: number | null,
  graceMs: number,
): boolean {
  if (remoteMs === null || remoteCheckedMs === null) return false;
  return remoteMs - remoteCheckedMs <= graceMs;
}

export function formatShortUpdateDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown date';
  const ms = parseIsoMs(iso);
  if (ms === null) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Determines whether a downloaded release actually has an unverified, actionable
 * upstream update on RetroGameTalk that warrants re-queueing for download.
 *
 * Prevents WordPress metadata-only edits (`post.modified_gmt` bumps where every
 * `downloadHints` filename is already mirrored) and already-verified release pages
 * (`remoteCheckedAt >= remoteUpdatedAt`) from looping forever in the download queue.
 */
export function hasActionableRemoteUpdate(
  item: Pick<
    InstalledUpdateItemLike,
    'status' | 'downloadedAt' | 'remoteUpdatedAt' | 'remoteCheckedAt' | 'downloadHints' | 'metadata' | 'files'
  > | null | undefined,
  graceMs = INSTALL_UPDATE_GRACE_MS,
): boolean {
  if (!item) return false;
  const remoteMs = parseIsoMs(item.remoteUpdatedAt);
  if (remoteMs === null) return false;

  const remoteCheckedMs = parseIsoMs(item.remoteCheckedAt);
  if (isRemoteTimestampAlreadyVerified(remoteMs, remoteCheckedMs, graceMs)) {
    return false;
  }

  let latestLocalMs: number | null =
    item.status === 'downloaded' || item.status === 'partial'
      ? parseIsoMs(item.downloadedAt)
      : null;

  for (const file of item.files || []) {
    if (file.status !== 'downloaded' || !file.downloadedAt) continue;
    const fileMs = parseIsoMs(file.downloadedAt);
    if (fileMs !== null && (latestLocalMs === null || fileMs > latestLocalMs)) {
      latestLocalMs = fileMs;
    }
  }

  const remoteNewerThanLocal =
    latestLocalMs === null || remoteMs - latestLocalMs > graceMs;
  if (!remoteNewerThanLocal) {
    return false;
  }

  const unmirroredHints = hasUnmirroredRemoteDownloadHints(
    resolveItemDownloadHints(item),
    item.files,
  );
  return unmirroredHints !== false;
}

/**
 * Classifies whether an installed catalog release has a newer version mirrored
 * locally (`update_ready_local`) or published upstream on RetroGameTalk
 * (`update_available_remote`).
 *
 * Uses a 60-second grace window to prevent false positives when a ROM is
 * downloaded and installed within the same minute, cross-checks `downloadHints`
 * against locally mirrored files to filter out WordPress metadata-only edits,
 * and respects `remoteCheckedAt` once the live release page has been verified.
 */
export function classifyInstalledUpdateState(
  item: InstalledUpdateItemLike | null | undefined,
  graceMs = INSTALL_UPDATE_GRACE_MS,
): InstalledUpdateInfo {
  if (!item || !item.installedAt) {
    return {
      state: 'not_installed',
      hasUpdate: false,
      readyToUpgradeLocal: false,
      needsLocalDownload: false,
      installedAt: item?.installedAt ?? null,
      latestLocalDownloadedAt: item?.downloadedAt ?? null,
      remoteUpdatedAt: item?.remoteUpdatedAt ?? null,
      newerLocalFile: null,
      summaryLabel: null,
      tooltip: null,
    };
  }

  const installedMs = parseIsoMs(item.installedAt);
  if (installedMs === null) {
    return {
      state: 'up_to_date',
      hasUpdate: false,
      readyToUpgradeLocal: false,
      needsLocalDownload: false,
      installedAt: item.installedAt,
      latestLocalDownloadedAt: item.downloadedAt ?? null,
      remoteUpdatedAt: item.remoteUpdatedAt ?? null,
      newerLocalFile: null,
      summaryLabel: null,
      tooltip: null,
    };
  }

  const downloadedFiles = (item.files || []).filter(
    (f) => f.status === 'downloaded' && Boolean(f.downloadedAt),
  );

  let latestLocalMs: number | null =
    item.status === 'downloaded' || item.status === 'partial'
      ? parseIsoMs(item.downloadedAt)
      : null;
  let latestLocalIso: string | null = latestLocalMs !== null ? item.downloadedAt : null;

  let newerLocalFile: { id: number; filename: string; downloadedAt: string | null } | null = null;
  let newerLocalFileMs = -Infinity;
  let hasDifferentNewerFile = false;

  for (const file of downloadedFiles) {
    const fileMs = parseIsoMs(file.downloadedAt);
    if (fileMs === null) continue;
    if (latestLocalMs === null || fileMs > latestLocalMs) {
      latestLocalMs = fileMs;
      latestLocalIso = file.downloadedAt;
    }
    const exceedsGrace = fileMs - installedMs > graceMs;
    const isDifferentFileAfterInstall =
      item.installedFileId != null &&
      file.id !== item.installedFileId &&
      fileMs > installedMs;

    if ((exceedsGrace || isDifferentFileAfterInstall) && fileMs >= newerLocalFileMs) {
      newerLocalFileMs = fileMs;
      newerLocalFile = {
        id: file.id,
        filename: file.filename,
        downloadedAt: file.downloadedAt,
      };
      if (isDifferentFileAfterInstall) {
        hasDifferentNewerFile = true;
      }
    }
  }

  const hasLocalUpdateByTimestamp =
    latestLocalMs !== null && latestLocalMs - installedMs > graceMs;
  const isLocalUpdateReady = hasLocalUpdateByTimestamp || hasDifferentNewerFile;

  const remoteMs = parseIsoMs(item.remoteUpdatedAt);
  const remoteCheckedMs = parseIsoMs(item.remoteCheckedAt);
  const remoteNewerThanInstalled =
    remoteMs !== null && remoteMs - installedMs > graceMs;
  const remoteNewerThanLocal =
    remoteMs !== null &&
    (latestLocalMs === null || remoteMs - latestLocalMs > graceMs);
  const remoteAlreadyVerified = isRemoteTimestampAlreadyVerified(
    remoteMs,
    remoteCheckedMs,
    graceMs,
  );
  const unmirroredHints = hasUnmirroredRemoteDownloadHints(
    resolveItemDownloadHints(item),
    item.files,
  );
  const isRemoteUpdateAvailable =
    remoteNewerThanInstalled &&
    remoteNewerThanLocal &&
    !remoteAlreadyVerified &&
    unmirroredHints !== false;

  const installedDateLabel = formatShortUpdateDate(item.installedAt);
  const deviceSuffix = item.installedDeviceLabel ? ` on ${item.installedDeviceLabel}` : '';

  if (isLocalUpdateReady) {
    const localDateLabel = formatShortUpdateDate(latestLocalIso);
    const fileHint =
      newerLocalFile?.filename &&
      item.installedFilename &&
      newerLocalFile.filename !== item.installedFilename
        ? ` (${newerLocalFile.filename})`
        : '';
    return {
      state: 'update_ready_local',
      hasUpdate: true,
      readyToUpgradeLocal: true,
      needsLocalDownload: false,
      installedAt: item.installedAt,
      latestLocalDownloadedAt: latestLocalIso,
      remoteUpdatedAt: item.remoteUpdatedAt,
      newerLocalFile,
      summaryLabel: 'Update ready',
      tooltip: `Newer local ROM ready${fileHint} — Installed${deviceSuffix} ${installedDateLabel} · Downloaded ${localDateLabel}`,
    };
  }

  if (isRemoteUpdateAvailable) {
    const remoteDateLabel = formatShortUpdateDate(item.remoteUpdatedAt);
    return {
      state: 'update_available_remote',
      hasUpdate: true,
      readyToUpgradeLocal: false,
      needsLocalDownload: true,
      installedAt: item.installedAt,
      latestLocalDownloadedAt: latestLocalIso,
      remoteUpdatedAt: item.remoteUpdatedAt,
      newerLocalFile: null,
      summaryLabel: 'Update on RGT',
      tooltip: `Newer version available on RetroGameTalk — Installed${deviceSuffix} ${installedDateLabel} · Updated on RGT ${remoteDateLabel}`,
    };
  }

  return {
    state: 'up_to_date',
    hasUpdate: false,
    readyToUpgradeLocal: false,
    needsLocalDownload: false,
    installedAt: item.installedAt,
    latestLocalDownloadedAt: latestLocalIso,
    remoteUpdatedAt: item.remoteUpdatedAt,
    newerLocalFile: null,
    summaryLabel: null,
    tooltip: null,
  };
}

export function formatInstalledUpdateComparison(
  info: InstalledUpdateInfo,
): string | null {
  if (!info.hasUpdate) return null;
  const installedDate = formatShortUpdateDate(info.installedAt);
  if (info.readyToUpgradeLocal) {
    const downloadedDate = formatShortUpdateDate(info.latestLocalDownloadedAt);
    return `Installed ${installedDate} · Downloaded ${downloadedDate}`;
  }
  if (info.needsLocalDownload) {
    const remoteDate = formatShortUpdateDate(info.remoteUpdatedAt);
    return `Installed ${installedDate} · Updated on RGT ${remoteDate}`;
  }
  return null;
}
