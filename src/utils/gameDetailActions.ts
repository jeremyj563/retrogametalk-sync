import type {
  ArchiveInspectResult,
  PlayableExportTarget,
  RepositoryItemRecord,
} from '../types';

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

  return {
    kind: 'variant_picker',
    fileId: inspection.fileId,
    archiveFormat: inspection.archiveFormat,
    sourceFilename: inspection.sourceFilename,
    targets: inspection.playableTargets,
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
