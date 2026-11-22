export const INSTALL_UPDATE_GRACE_MS = 60_000;

export type InstalledUpdateState =
  | 'not_installed'
  | 'up_to_date'
  | 'update_ready_local'
  | 'update_available_remote';

export interface InstalledUpdateFileLike {
  id: number;
  filename: string;
  status: string;
  downloadedAt: string | null;
}

export interface InstalledUpdateItemLike {
  status: string;
  installedAt: string | null;
  installedDeviceLabel?: string | null;
  installedFileId?: number | null;
  installedFilename?: string | null;
  downloadedAt: string | null;
  remoteUpdatedAt: string | null;
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
 * Classifies whether an installed catalog release has a newer version mirrored
 * locally (`update_ready_local`) or published upstream on RetroGameTalk
 * (`update_available_remote`).
 *
 * Uses a 60-second grace window to prevent false positives when a ROM is
 * downloaded and installed within the same minute. Keep aligned with the
 * SQLite `julianday()` predicates in `src/server/db.ts`.
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
  const remoteNewerThanInstalled =
    remoteMs !== null && remoteMs - installedMs > graceMs;
  const remoteNewerThanLocal =
    remoteMs !== null &&
    (latestLocalMs === null || remoteMs - latestLocalMs > graceMs);
  const isRemoteUpdateAvailable = remoteNewerThanInstalled && remoteNewerThanLocal;

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
