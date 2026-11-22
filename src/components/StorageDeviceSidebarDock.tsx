import { useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  Eye,
  FolderPlus,
  FolderSync,
  HardDrive,
  Loader2,
  Power,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import {
  isFileSystemAccessSupported,
  type FileSystemAccessSupportResult,
} from '../utils/sdCardFs';
import {
  formatMountDeviceTooltip,
  formatSwitchDeviceTooltip,
  MOUNT_DEVICE_LABEL,
  SWITCH_DEVICE_COMPACT_LABEL,
} from '../utils/storageActionCopy';

export type StorageDriveBayState =
  | 'standby'
  | 'scanning'
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
  isScanningAutoConfig?: boolean;
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
    if (params.isScanningAutoConfig) {
      return {
        state: 'scanning',
        statusLabel: 'Scanning',
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
  outdatedInstalledCount?: number;
  outdatedLocalReadyCount?: number;
  onPreviewDevicePaths: () => void;
  onUpdateOutdatedOnDevice?: () => void;
  onViewOutdatedInCatalog?: () => void;
}

export function StorageDeviceSidebarDock({
  installer,
  outdatedInstalledCount = 0,
  outdatedLocalReadyCount = 0,
  onPreviewDevicePaths,
  onUpdateOutdatedOnDevice,
  onViewOutdatedInCatalog,
}: StorageDeviceSidebarDockProps) {
  const support = useMemo(() => isFileSystemAccessSupported(), []);
  const [showSupportDetails, setShowSupportDetails] = useState(false);

  const {
    sdRootHandle,
    isBusy,
    mountError,
    autoConfigPhase,
    autoConfigResult,
    autoConfigError,
  } = installer;

  const isScanningAutoConfig = autoConfigPhase === 'scanning';

  const bayInfo = useMemo(
    () =>
      resolveStorageDriveBayState({
        hasMountedHandle: Boolean(sdRootHandle),
        isBusy,
        isScanningAutoConfig,
        support,
      }),
    [sdRootHandle, isBusy, isScanningAutoConfig, support],
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
    bayInfo.state === 'mounted' ||
    bayInfo.state === 'writing' ||
    bayInfo.state === 'scanning'
      ? 'text-crt-phosphor crt-live-readout'
      : bayInfo.state === 'insecure_context'
        ? 'text-crt-amber'
        : 'text-crt-muted/80';

  const layoutDisplay = useMemo(() => {
    if (autoConfigPhase === 'scanning') {
      return {
        label: 'Auto-configuring...',
        count: null as number | null,
        fullTitle: 'Scanning storage device folders for automatic path configuration',
      };
    }
    if (autoConfigPhase === 'error') {
      return {
        label: 'Scan failed · Defaults',
        count: null as number | null,
        fullTitle: 'Auto-configure scan failed; using default folder mappings',
      };
    }
    if (autoConfigResult) {
      const count = autoConfigResult.matches.length;
      const shortLabel = autoConfigResult.detectedLayoutLabel
        .replace(/\s*\([^)]*\)\s*/g, '')
        .trim();
      if (count > 0) {
        return {
          label: shortLabel || autoConfigResult.detectedLayoutLabel,
          count,
          fullTitle: `${autoConfigResult.detectedLayoutLabel} · ${count} console${count === 1 ? '' : 's'} detected`,
        };
      }
      return {
        label: 'Defaults',
        count: null as number | null,
        fullTitle: 'No existing console folders detected; using inferred defaults',
      };
    }
    return {
      label: 'Ready',
      count: null as number | null,
      fullTitle: 'Ready to export',
    };
  }, [autoConfigPhase, autoConfigResult]);

  return (
    <section
      aria-label="Storage Device"
      data-drive-state={bayInfo.state}
      className="border-t border-crt-border pt-4 space-y-2"
    >
      {/* Flush Section Header matching Service Telemetry & Mirrored Systems */}
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-crt-muted">
        <span className="inline-flex items-center gap-2 min-w-0">
          {isScanningAutoConfig ? (
            <Loader2 className="h-3.5 w-3.5 text-crt-phosphor animate-spin shrink-0" />
          ) : (
            <HardDrive
              className={`h-3.5 w-3.5 shrink-0 ${
                sdRootHandle ? 'text-crt-phosphor crt-drive-activity' : 'text-crt-muted'
              }`}
            />
          )}
          <span className="truncate">Storage Device</span>
        </span>
        <span
          className={`font-mono text-[11px] tabular-nums whitespace-nowrap shrink-0 ${statusTextClass}`}
        >
          {bayInfo.statusLabel}
        </span>
      </div>

      {sdRootHandle ? (
        <div className="space-y-0.5">
          {/* Volume & Layout telemetry-style rows */}
          <div
            title={`Mounted storage root: ${sdRootHandle.name}`}
            className="flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-transparent text-xs font-mono text-crt-muted"
          >
            <span className="shrink-0">Volume</span>
            <span className="text-crt-phosphor font-medium truncate min-w-0">
              {sdRootHandle.name}
            </span>
          </div>

          <button
            type="button"
            onClick={onPreviewDevicePaths}
            title={`Open Device Export destination preview — ${layoutDisplay.fullTitle}`}
            className="w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-transparent text-xs font-mono text-crt-muted hover:border-crt-border-strong hover:bg-crt-elevated/65 hover:text-crt-text transition-colors text-left cursor-pointer"
          >
            <span className="shrink-0">Layout</span>
            <span className="flex items-center gap-1.5 min-w-0 tabular-nums">
              <span
                className={`truncate ${
                  autoConfigPhase === 'error' ? 'text-crt-amber' : 'text-crt-text'
                }`}
              >
                {layoutDisplay.label}
              </span>
              {layoutDisplay.count !== null && (
                <>
                  <span aria-hidden="true" className="text-crt-muted/45 shrink-0">
                    ·
                  </span>
                  <span className="text-crt-muted shrink-0">{layoutDisplay.count}</span>
                </>
              )}
            </span>
          </button>

          {outdatedInstalledCount > 0 && (
            <div className="flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-crt-amber/35 bg-crt-amber/8 text-[11px] font-mono">
              <button
                type="button"
                onClick={onViewOutdatedInCatalog}
                title={
                  outdatedLocalReadyCount > 0
                    ? `${outdatedLocalReadyCount} local ROM update${outdatedLocalReadyCount === 1 ? '' : 's'} ready to stream (${outdatedInstalledCount} total outdated) — click to view in Catalog`
                    : `${outdatedInstalledCount} installed game${outdatedInstalledCount === 1 ? '' : 's'} updated on RetroGameTalk — click to view in Catalog`
                }
                className="inline-flex items-center gap-1.5 min-w-0 text-crt-amber hover:underline text-left cursor-pointer"
              >
                <ArrowUpCircle className="h-3 w-3 shrink-0" />
                <span className="truncate tabular-nums">
                  {outdatedLocalReadyCount > 0
                    ? `${outdatedLocalReadyCount} update${outdatedLocalReadyCount === 1 ? '' : 's'} ready`
                    : `${outdatedInstalledCount} update${outdatedInstalledCount === 1 ? '' : 's'}`}
                </span>
              </button>
              {outdatedLocalReadyCount > 0 && onUpdateOutdatedOnDevice && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onUpdateOutdatedOnDevice}
                  title={`Upgrade ${outdatedLocalReadyCount} outdated ROM${outdatedLocalReadyCount === 1 ? '' : 's'} on ${sdRootHandle.name}`}
                  className="px-1.5 py-0.5 rounded bg-crt-amber/20 hover:bg-crt-amber/30 text-crt-amber font-semibold whitespace-nowrap shrink-0 transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  Update All
                </button>
              )}
            </div>
          )}

          {/* Quiet inline action strip — zero heavy nested buttons */}
          <div className="flex items-center justify-between gap-2 pt-1 text-[11px] font-mono">
            <button
              type="button"
              onClick={onPreviewDevicePaths}
              title={`Open Device Export to view Live Export Destination Preview for "${sdRootHandle.name}"`}
              className="inline-flex items-center gap-1 px-1.5 py-1 -ml-1.5 rounded text-crt-phosphor/90 hover:text-crt-phosphor hover:bg-crt-elevated/65 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="h-3 w-3 shrink-0" />
              <span>Preview</span>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleMountOrSwitch}
                title={formatSwitchDeviceTooltip(isBusy)}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-crt-muted hover:text-crt-text hover:bg-crt-elevated/65 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                <FolderSync className="h-3 w-3 shrink-0" />
                <span>{SWITCH_DEVICE_COMPACT_LABEL}</span>
              </button>
              <span aria-hidden="true" className="text-crt-muted/40">
                ·
              </span>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleEject}
                title={
                  isBusy
                    ? 'Finish or cancel the active transfer before ejecting'
                    : 'Unmount storage device and clear its session layout'
                }
                className="inline-flex items-center gap-1 px-1.5 py-1 -mr-1.5 rounded text-crt-muted hover:text-crt-crimson hover:bg-crt-elevated/65 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                <Power className="h-3 w-3 shrink-0" />
                <span>Eject</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleMountOrSwitch}
            title={formatMountDeviceTooltip(support)}
            className={`w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1.5 -mx-1 rounded border text-xs font-mono transition-colors whitespace-nowrap cursor-pointer ${
              support.supported
                ? 'border-transparent text-crt-text hover:border-crt-border-strong hover:bg-crt-elevated/70 hover:text-crt-phosphor'
                : 'border-transparent text-crt-amber hover:border-crt-amber/40 hover:bg-crt-amber/10'
            }`}
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <FolderPlus
                className={`h-3.5 w-3.5 shrink-0 ${
                  support.supported ? 'text-crt-phosphor' : 'text-crt-amber'
                }`}
              />
              <span className="truncate">{MOUNT_DEVICE_LABEL}</span>
            </span>
            <span className="text-[11px] text-crt-muted/85 shrink-0">
              {support.supported ? 'Auto' : 'Info'}
            </span>
          </button>

          {outdatedInstalledCount > 0 && onViewOutdatedInCatalog && (
            <button
              type="button"
              onClick={onViewOutdatedInCatalog}
              title={`View ${outdatedInstalledCount} installed game${outdatedInstalledCount === 1 ? '' : 's'} with newer versions available`}
              className="w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-crt-amber/35 bg-crt-amber/8 text-[11px] font-mono text-crt-amber hover:bg-crt-amber/15 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <ArrowUpCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">Updates Available</span>
              </span>
              <span className="tabular-nums shrink-0">{outdatedInstalledCount}</span>
            </button>
          )}

          {!support.supported && (
            <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] font-mono text-crt-muted">
              <span className="truncate">
                {support.code === 'insecure_context'
                  ? 'Blocked on plain LAN HTTP'
                  : 'Chromium browser required'}
              </span>
              <button
                type="button"
                onClick={() => setShowSupportDetails((prev) => !prev)}
                className="text-crt-amber hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                {showSupportDetails ? 'Hide' : 'Fix'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Accurate Secure Context / Browser Guidance, Auto-Config Error, or Mount Error */}
      {(mountError || autoConfigError || (showSupportDetails && !support.supported)) && (
        <div className="pt-2 border-t border-crt-border/70 flex items-start justify-between gap-2 text-[11px] font-mono leading-relaxed text-crt-amber">
          <span className="break-words min-w-0">
            {mountError || autoConfigError || support.reason}
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
