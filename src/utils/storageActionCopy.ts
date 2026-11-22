import { formatDeviceActionLabel } from './gameDetailActions';
import type { FileSystemAccessSupportResult } from './sdCardFs';

export const MOUNT_DEVICE_LABEL = 'Mount Device';
export const SWITCH_DEVICE_LABEL = 'Switch Device';
export const SWITCH_DEVICE_COMPACT_LABEL = 'Switch';
export const RESCAN_DEVICE_LABEL = 'Rescan';

export const INSTALL_OPTIONS_SINGLE_TOOLTIP =
  'Choose version, rename ROM, or preview destination folder before installing';

export function formatMountDeviceTooltip(
  support: Pick<FileSystemAccessSupportResult, 'supported' | 'reason'>,
): string {
  return support.supported
    ? 'Mount a storage device folder (auto-configures console paths immediately)'
    : support.reason || 'Storage device mounting is unavailable in this browser context';
}

export function formatSwitchDeviceTooltip(isBusy: boolean): string {
  return isBusy
    ? 'Finish or cancel the active transfer before switching devices'
    : 'Switch to a different storage device folder (auto-configures console paths immediately)';
}

export function formatRescanDeviceTooltip(
  context: 'layout' | 'folders',
  isBusy = false,
): string {
  if (isBusy) {
    return 'Wait for the active transfer to finish before rescanning';
  }
  return context === 'layout'
    ? 'Rescan mounted device folders to refresh auto-configured console paths'
    : 'Rescan mounted device folders to check for existing or older ROM files';
}

export function formatQuickInstallLabel(params: {
  mountedDeviceName: string | null;
  isReinstall?: boolean;
  isUpdateAvailable?: boolean;
  count?: number;
  compact?: boolean;
  maxDeviceLen?: number;
}): string {
  const {
    mountedDeviceName,
    isReinstall = false,
    isUpdateAvailable = false,
    count,
    compact = false,
    maxDeviceLen = 18,
  } = params;
  const trimmedDevice = (mountedDeviceName || '').trim();
  const shortDevice = formatDeviceActionLabel(trimmedDevice, maxDeviceLen);

  if (typeof count === 'number') {
    const countSuffix = `(${count.toLocaleString()})`;
    if (isUpdateAvailable) {
      return trimmedDevice
        ? `Update on ${shortDevice} ${countSuffix}`
        : `Update on Device ${countSuffix}`;
    }
    return trimmedDevice
      ? `Install to ${shortDevice} ${countSuffix}`
      : `Install to Device ${countSuffix}`;
  }

  if (compact) {
    if (isUpdateAvailable) return 'Update';
    return isReinstall && trimmedDevice ? 'Reinstall' : 'Install';
  }

  if (isUpdateAvailable) {
    return trimmedDevice ? `Update on ${shortDevice}` : 'Update on Device';
  }

  if (trimmedDevice) {
    return `${isReinstall ? 'Reinstall' : 'Install'} to ${shortDevice}`;
  }

  return 'Install to Device';
}

export function formatQuickInstallTooltip(params: {
  mountedDeviceName: string | null;
  isReinstall?: boolean;
  isUpdateAvailable?: boolean;
  isActive?: boolean;
  isOtherBusy?: boolean;
}): string {
  const {
    mountedDeviceName,
    isReinstall = false,
    isUpdateAvailable = false,
    isActive = false,
    isOtherBusy = false,
  } = params;

  if (isActive) {
    return 'View or cancel active device installation';
  }
  if (isOtherBusy) {
    return 'Another storage device install is currently in progress';
  }

  const trimmedDevice = (mountedDeviceName || '').trim();
  if (isUpdateAvailable) {
    return trimmedDevice
      ? `Upgrade to latest local ROM on ${trimmedDevice} (replaces older copy)`
      : 'Mount a storage device and upgrade to the latest local ROM';
  }
  if (trimmedDevice) {
    return `${isReinstall ? 'Reinstall' : 'Install'} latest primary ROM directly to ${trimmedDevice}`;
  }
  return 'Mount a storage device and install the latest primary ROM';
}

export function formatInstallModalCtaLabel(params: {
  mountedDeviceName: string | null;
  isSingleGame: boolean;
  selectedCount: number;
  maxDeviceLen?: number;
}): string {
  const { mountedDeviceName, isSingleGame, selectedCount, maxDeviceLen = 20 } = params;
  const trimmedDevice = (mountedDeviceName || '').trim();
  const shortDevice = formatDeviceActionLabel(trimmedDevice, maxDeviceLen);
  const gameWord = selectedCount === 1 ? 'Game' : 'Games';

  if (!trimmedDevice) {
    return isSingleGame
      ? 'Mount Device & Install'
      : `Mount Device & Install ${selectedCount.toLocaleString()} ${gameWord}`;
  }

  return isSingleGame
    ? `Install to ${shortDevice}`
    : `Install ${selectedCount.toLocaleString()} ${gameWord} to ${shortDevice}`;
}

export function formatInstallModalCtaTooltip(params: {
  mountedDeviceName: string | null;
  isSingleGame: boolean;
  selectedCount: number;
}): string {
  const { mountedDeviceName, isSingleGame, selectedCount } = params;
  const trimmedDevice = (mountedDeviceName || '').trim();
  const gameWord = selectedCount === 1 ? 'game' : 'games';

  if (!trimmedDevice) {
    return isSingleGame
      ? 'Mount a storage device and install the selected ROM'
      : `Mount a storage device and install ${selectedCount.toLocaleString()} selected ${gameWord}`;
  }

  return isSingleGame
    ? `Install selected ROM directly to ${trimmedDevice}`
    : `Install ${selectedCount.toLocaleString()} selected ${gameWord} directly to ${trimmedDevice}`;
}
