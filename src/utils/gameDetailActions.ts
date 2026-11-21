import type {
  ArchiveInspectResult,
  PlayableExportTarget,
  ReleaseFileRecord,
  RepositoryItemRecord,
} from '../types';
import {
  compareComparableVersions,
  parseComparableVersion,
  type ComparableVersion,
} from '../shared/smartRomPicker';

export type GameDetailPrimaryAction =
  | 'install_mounted'
  | 'download_rom'
  | 'queue_release'
  | 'retry_failed'
  | 'status_only';

export type GameDetailSecondaryAction =
  | 'download_rom'
  | 'install_unmounted'
  | null;

export interface GameDetailFooterPlanInput {
  hasDownloadedFile: boolean;
  canQueueRelease: boolean;
  status: RepositoryItemRecord['status'];
  hasFailedFiles: boolean;
  mountedDeviceName: string | null;
  canInstallToDevice: boolean;
  installedAt: string | null;
  installedDeviceLabel: string | null;
}

export interface GameDetailFooterPlan {
  primaryAction: GameDetailPrimaryAction;
  secondaryAction: GameDetailSecondaryAction;
  installButtonLabel: string;
  isReinstallOnMountedDevice: boolean;
  showReviewDeviceInstallInMore: boolean;
  showRetryInMore: boolean;
}

export type RomDownloadOutcome =
  | {
      kind: 'instant_download';
      fileId: number;
      target: PlayableExportTarget;
      filename: string;
      url: string;
    }
  | {
      kind: 'variant_picker';
      fileId: number;
      archiveFormat: string;
      sourceFilename: string;
      targets: PlayableExportTarget[];
    }
  | {
      kind: 'patch_only_fallback';
      fileId: number;
      patchOnly: boolean;
      sourceFilename: string;
    };

const STANDALONE_PATCH_EXT_RE = /\.(ips|bps|ups|xdelta|ppf|vcdiff)$/i;
const DISC_NUMBER_RE = /\b(?:disc|disk|cd|side)\s*0*([1-9]\d?|[a-d])\b/i;

function extractDiscNumber(text: string): number | null {
  const m = text.match(DISC_NUMBER_RE);
  if (!m) return null;
  const token = m[1].toUpperCase();
  const num = /^[A-D]$/.test(token) ? token.charCodeAt(0) - 64 : Number.parseInt(token, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function isModifiedPlayableRole(fileRole: string): boolean {
  const lower = fileRole.trim().toLowerCase();
  return (
    lower.includes('translation') ||
    lower === 'hack' ||
    lower === 'undub' ||
    lower === 'port' ||
    lower === 'homebrew' ||
    lower === 'indie' ||
    lower === 'doujin'
  );
}

function parseFileBestVersion(file: Pick<ReleaseFileRecord, 'filename' | 'displayLabel'>): ComparableVersion {
  const fileVer = parseComparableVersion(file.filename);
  const labelVer = file.displayLabel ? parseComparableVersion(file.displayLabel) : fileVer;
  return compareComparableVersions(labelVer, fileVer) > 0 ? labelVer : fileVer;
}

function parseTargetBestVersion(target: PlayableExportTarget): ComparableVersion {
  const displayVer = parseComparableVersion(target.displayName);
  const suggestedVer = parseComparableVersion(target.suggestedFilename);
  let best = compareComparableVersions(suggestedVer, displayVer) > 0 ? suggestedVer : displayVer;
  if (!best.hasVersion && target.detectedVersion) {
    const fallback = parseComparableVersion(target.detectedVersion);
    if (fallback.hasVersion) best = fallback;
  }
  return best;
}

/**
 * Selects the best primary mirrored file for the Game Details "Download ROM" button,
 * always preferring the latest playable version when multiple versions exist and avoiding
 * bundled unmodified Original ROMs, standalone patches, or legacy/auxiliary archives when
 * a primary playable release is available.
 */
export function selectPrimaryDownloadFile(
  item: Pick<RepositoryItemRecord, 'files'>,
): ReleaseFileRecord | null {
  const downloaded = (item.files || []).filter(
    (f) => f.status === 'downloaded' || f.status === 'skipped',
  );
  if (downloaded.length === 0) return null;
  if (downloaded.length === 1) return downloaded[0];

  const hasModifiedPlayable = downloaded.some(
    (f) => !STANDALONE_PATCH_EXT_RE.test(f.filename) && isModifiedPlayableRole(f.fileRole || ''),
  );
  const hasNonDemo = downloaded.some(
    (f) => !/\b(demo|trial|sample|preview|promo)\b/i.test(`${f.filename} ${f.displayLabel || ''} ${f.fileRole || ''}`),
  );

  const ranked = downloaded.map((file, idx) => {
    const roleLower = (file.fileRole || '').trim().toLowerCase();
    const probe = `${file.filename} ${file.displayLabel || ''}`.toLowerCase();

    const isPatch = STANDALONE_PATCH_EXT_RE.test(file.filename) || roleLower === 'patch';
    const isLegacy = /\b(old|older|legacy|deprecated|outdated|backup)\b/i.test(probe);
    const isAuxiliary = roleLower === 'dlc' || /\b(soundtrack|ost|manual|bonus)\b/i.test(probe);
    const isDemo =
      hasNonDemo && (roleLower === 'demo' || /\b(demo|trial|sample|preview|promo)\b/i.test(probe));
    const isBundledOriginal = hasModifiedPlayable && roleLower === 'original rom';
    const isPrimaryModified = hasModifiedPlayable && isModifiedPlayableRole(file.fileRole || '');

    let primaryTier = 2;
    if (isPatch) {
      primaryTier = -1;
    } else if (isLegacy || isAuxiliary) {
      primaryTier = 0;
    } else if (isBundledOriginal || isDemo) {
      primaryTier = 1;
    } else if (isPrimaryModified) {
      primaryTier = 3;
    }

    let fineScore = 0;
    if (roleLower.includes('english')) {
      fineScore += 20;
    }
    if (/\b(optional|alt|alternate|alternative)\b/i.test(probe)) {
      fineScore -= 20;
    }

    return {
      file,
      idx,
      primaryTier,
      fineScore,
      version: parseFileBestVersion(file),
      discNumber: extractDiscNumber(`${file.filename} ${file.displayLabel || ''}`),
    };
  });

  ranked.sort((a, b) => {
    // 1. Primary playable tier (e.g., playable Hack/Translation over bundled Original ROM / Demo / Legacy / Patch)
    if (a.primaryTier !== b.primaryTier) {
      return b.primaryTier - a.primaryTier;
    }

    // 2. Latest parsed version strictly wins within the same playable tier
    const verCmp = compareComparableVersions(a.version, b.version);
    if (verCmp !== 0) {
      return -verCmp;
    }

    // 3. Fine-grained tie-breaker (e.g., English over non-English, primary over optional/alternate)
    if (a.fineScore !== b.fineScore) {
      return b.fineScore - a.fineScore;
    }

    // 4. Disc 1 before Disc 2 when equal version & role
    if (a.discNumber !== null && b.discNumber !== null && a.discNumber !== b.discNumber) {
      return a.discNumber - b.discNumber;
    }

    // 5. Newer downloaded timestamp wins when versions are absent or tied
    if (a.file.downloadedAt && b.file.downloadedAt && a.file.downloadedAt !== b.file.downloadedAt) {
      return b.file.downloadedAt.localeCompare(a.file.downloadedAt);
    }

    // 6. Newer file ID wins over older SQLite row
    if (a.file.id !== b.file.id) {
      return b.file.id - a.file.id;
    }

    return a.idx - b.idx;
  });

  return ranked[0].file;
}

export function formatDeviceActionLabel(deviceName: string | null, maxLen = 18): string {
  const trimmed = (deviceName || '').trim();
  if (!trimmed) return 'Device';
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

export function buildPreparedRomDownloadUrl(
  itemId: number,
  fileId: number,
  target: PlayableExportTarget,
): { url: string; filename: string } {
  const filename =
    target.kind === 'disc_set' ? target.suggestedArchiveName : target.suggestedFilename;
  const params = new URLSearchParams({
    fileId: String(fileId),
    targetId: target.id,
    name: filename,
  });
  return {
    url: `/api/items/${itemId}/download-rom?${params.toString()}`,
    filename,
  };
}

export function resolveRomDownloadOutcome(
  itemId: number,
  inspection: ArchiveInspectResult,
): RomDownloadOutcome {
  if (inspection.playableTargets.length === 0) {
    return {
      kind: 'patch_only_fallback',
      fileId: inspection.fileId,
      patchOnly: Boolean(inspection.patchOnly),
      sourceFilename: inspection.sourceFilename,
    };
  }

  if (inspection.playableTargets.length === 1) {
    const target = inspection.playableTargets[0];
    const { url, filename } = buildPreparedRomDownloadUrl(itemId, inspection.fileId, target);
    return {
      kind: 'instant_download',
      fileId: inspection.fileId,
      target,
      filename,
      url,
    };
  }

  const sortedTargets = inspection.playableTargets
    .map((target, idx) => ({
      target,
      idx,
      version: parseTargetBestVersion(target),
      discNumber: extractDiscNumber(target.displayName),
    }))
    .sort((a, b) => {
      const verCmp = compareComparableVersions(a.version, b.version);
      if (verCmp !== 0) return -verCmp;
      if (a.discNumber !== null && b.discNumber !== null && a.discNumber !== b.discNumber) {
        return a.discNumber - b.discNumber;
      }
      return a.idx - b.idx;
    })
    .map((entry) => entry.target);

  return {
    kind: 'variant_picker',
    fileId: inspection.fileId,
    archiveFormat: inspection.archiveFormat,
    sourceFilename: inspection.sourceFilename,
    targets: sortedTargets,
  };
}

export function resolveGameDetailFooterPlan(
  input: GameDetailFooterPlanInput,
): GameDetailFooterPlan {
  const trimmedDevice = (input.mountedDeviceName || '').trim();
  const hasMountedDevice = Boolean(trimmedDevice) && input.canInstallToDevice;

  const normalizedInstalledLabel = (input.installedDeviceLabel || '').trim().toLowerCase();
  const isReinstallOnMountedDevice =
    hasMountedDevice &&
    Boolean(input.installedAt) &&
    (!normalizedInstalledLabel || normalizedInstalledLabel === trimmedDevice.toLowerCase());

  const shortDeviceName = formatDeviceActionLabel(trimmedDevice);
  const installButtonLabel = hasMountedDevice
    ? `${isReinstallOnMountedDevice ? 'Reinstall' : 'Install'} to ${shortDeviceName}`
    : 'Install to Device';

  if (input.hasDownloadedFile) {
    if (hasMountedDevice) {
      return {
        primaryAction: 'install_mounted',
        secondaryAction: 'download_rom',
        installButtonLabel,
        isReinstallOnMountedDevice,
        showReviewDeviceInstallInMore: true,
        showRetryInMore: input.hasFailedFiles,
      };
    }

    return {
      primaryAction: 'download_rom',
      secondaryAction: input.canInstallToDevice ? 'install_unmounted' : null,
      installButtonLabel,
      isReinstallOnMountedDevice: false,
      showReviewDeviceInstallInMore: false,
      showRetryInMore: input.hasFailedFiles,
    };
  }

  if (input.hasFailedFiles) {
    return {
      primaryAction: 'retry_failed',
      secondaryAction: null,
      installButtonLabel,
      isReinstallOnMountedDevice: false,
      showReviewDeviceInstallInMore: false,
      showRetryInMore: false,
    };
  }

  if (input.canQueueRelease) {
    return {
      primaryAction: 'queue_release',
      secondaryAction: null,
      installButtonLabel,
      isReinstallOnMountedDevice: false,
      showReviewDeviceInstallInMore: false,
      showRetryInMore: false,
    };
  }

  return {
    primaryAction: 'status_only',
    secondaryAction: null,
    installButtonLabel,
    isReinstallOnMountedDevice: false,
    showReviewDeviceInstallInMore: false,
    showRetryInMore: false,
  };
}

export function shouldShowPerFileDownloadButton(downloadedFilesCount: number): boolean {
  return downloadedFilesCount > 1;
}

export function triggerBrowserFileDownload(url: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
