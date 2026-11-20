import { useMemo, useState } from 'react';
import {
  FolderSearch,
  HardDrive,
  Power,
  RefreshCw,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import {
  isFileSystemAccessSupported,
  type FileSystemAccessSupportResult,
} from '../utils/sdCardFs';

export type StorageDriveBayState =
  | 'standby'
  | 'mounted'
  | 'writing'
  | 'insecure_context'
  | 'unsupported_browser';

export interface ResolvedStorageDriveBayInfo {
  state: StorageDriveBayState;
  statusLabel: string;
  ledMode: 'standby' | 'mounted' | 'writing' | 'warning';
}

export function resolveStorageDriveBayState(params: {
  hasMountedHandle: boolean;
  isBusy: boolean;
  support: Pick<FileSystemAccessSupportResult, 'supported' | 'code'>;
}): ResolvedStorageDriveBayInfo {
  if (params.hasMountedHandle) {
    if (params.isBusy) {
      return {
        state: 'writing',
        statusLabel: 'Writing',
        ledMode: 'writing',
      };
    }
    return {
      state: 'mounted',
      statusLabel: 'Mounted',
      ledMode: 'mounted',
    };
  }

  if (!params.support.supported) {
    if (params.support.code === 'insecure_context') {
      return {
        state: 'insecure_context',
        statusLabel: 'HTTPS Req',
        ledMode: 'warning',
      };
    }
    return {
      state: 'unsupported_browser',
      statusLabel: 'Unsupported',
      ledMode: 'standby',
    };
  }

  return {
    state: 'standby',
    statusLabel: 'Standby',
    ledMode: 'standby',
  };
}

interface StorageDeviceSidebarDockProps {
  installer: BulkStorageInstallerController;
  onAutoConfigureDevice: () => void;
}

export function StorageDeviceSidebarDock({
  installer,
  onAutoConfigureDevice,
}: StorageDeviceSidebarDockProps) {
  const support = useMemo(() => isFileSystemAccessSupported(), []);
  const [showSupportDetails, setShowSupportDetails] = useState(false);

  const { sdRootHandle, isBusy, mountError } = installer;

  const bayInfo = useMemo(
    () =>
      resolveStorageDriveBayState({
        hasMountedHandle: Boolean(sdRootHandle),
        isBusy,
        support,
      }),
    [sdRootHandle, isBusy, support],
  );

  const handleMountOrSwitch = () => {
    if (!support.supported) {
      setShowSupportDetails(true);
      return;
    }
    setShowSupportDetails(false);
    void installer.promptMountSdCard();
  };

  const handleEject = () => {
    if (isBusy) return;
    installer.setSdRootHandle(null);
    installer.clearMountError();
  };

  const statusTextClass =
    bayInfo.state === 'mounted' || bayInfo.state === 'writing'
      ? 'text-crt-phosphor'
      : bayInfo.state === 'insecure_context'
        ? 'text-crt-amber'
        : 'text-crt-muted';

  return (
    <section
      aria-label="Storage Device Drive Bay"
      data-drive-state={bayInfo.state}
      className="crt-drive-bay rounded-md p-2.5 space-y-2.5"
    >
      {/* Hardware Bezel Header with Real Live Mount Telemetry LED */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-display font-semibold tracking-[0.03em] text-crt-text whitespace-nowrap">
          Storage Device
        </span>
        <div className="inline-flex items-center gap-1.5 shrink-0">
          <span
            aria-hidden="true"
            data-led={bayInfo.ledMode}
            className="crt-drive-led"
          />
          <span className={`text-[10px] font-mono tabular-nums whitespace-nowrap ${statusTextClass}`}>
            {bayInfo.statusLabel}
          </span>
        </div>
      </div>

      {/* Machined SD / Cartridge Slot Groove */}
      <div aria-hidden="true" className="crt-drive-slot-groove mx-0.5" />

      {sdRootHandle ? (
        <div className="space-y-2">
          {/* Illuminated Recessed Volume Readout */}
          <div
            title={`Mounted storage root: ${sdRootHandle.name}`}
            className="crt-drive-lcd rounded px-2.5 py-2 flex items-center gap-2 min-w-0"
          >
            <HardDrive className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
            <span className="font-mono text-xs font-medium text-crt-phosphor truncate">
              {sdRootHandle.name}
            </span>
          </div>

          {/* Mounted Quick Actions: Switch, Eject, Auto-Configure */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleMountOrSwitch}
              title={
                isBusy
                  ? 'Finish or cancel the active transfer before switching devices'
                  : 'Switch to a different mounted storage folder'
              }
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor hover:text-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <RefreshCw className="h-3 w-3 shrink-0" />
              <span>Switch</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleEject}
              title={
                isBusy
                  ? 'Finish or cancel the active transfer before ejecting'
                  : 'Unmount storage device from this browser session'
              }
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:border-crt-crimson/60 hover:text-crt-crimson rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <Power className="h-3 w-3 shrink-0" />
              <span>Eject</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onAutoConfigureDevice}
            title={`Scan "${sdRootHandle.name}" in Device Export to auto-configure console folder mappings`}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono border border-crt-phosphor/45 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/18 hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderSearch className="h-3.5 w-3.5 shrink-0" />
            <span>Auto-Configure</span>
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={handleMountOrSwitch}
            title={
              support.supported
                ? 'Mount a target storage device folder (SD card, USB drive, or handheld root)'
                : support.reason
            }
            className={`crt-cta-beam w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium border rounded transition-colors whitespace-nowrap cursor-pointer ${
              support.supported
                ? 'border-crt-phosphor/70 bg-crt-phosphor/12 text-crt-phosphor hover:bg-crt-phosphor/20 hover:border-crt-phosphor'
                : 'border-crt-amber/50 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/15'
            }`}
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span>Mount Storage Device</span>
          </button>
          <div className="flex items-center justify-between gap-2 px-0.5 text-[10px] font-mono text-crt-muted">
            <span className="truncate">
              {support.supported
                ? 'SD card, USB, or handheld root'
                : support.code === 'insecure_context'
                  ? 'Blocked on plain LAN HTTP'
                  : 'Chromium browser required'}
            </span>
            {!support.supported && (
              <button
                type="button"
                onClick={() => setShowSupportDetails((prev) => !prev)}
                className="text-crt-amber hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                {showSupportDetails ? 'Hide' : 'Fix'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Accurate Secure Context / Browser Guidance or Mount Error */}
      {(mountError || (showSupportDetails && !support.supported)) && (
        <div className="pt-2 border-t border-crt-border/80 flex items-start justify-between gap-2 text-[10px] font-mono leading-relaxed text-crt-amber">
          <span className="break-words min-w-0">
            {mountError || support.reason}
          </span>
          <button
            type="button"
            onClick={() => {
              installer.clearMountError();
              setShowSupportDetails(false);
            }}
            aria-label="Dismiss storage device notice"
            className="p-0.5 text-crt-muted hover:text-crt-text rounded shrink-0 cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </section>
  );
}
