import { useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  Check,
  ChevronRight,
  Eye,
  FolderPlus,
  FolderSync,
  HardDrive,
  Layers,
  Loader2,
  Pencil,
  Power,
  RotateCcw,
  ShieldCheck,
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
import { DeviceIconGlyph, getDeviceColorOption } from './DeviceBadge';

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
  onOpenDevicesDrawer?: () => void;
  onUpdateOutdatedOnDevice?: () => void;
  onViewOutdatedInCatalog?: () => void;
}

export function StorageDeviceSidebarDock({
  installer,
  outdatedInstalledCount = 0,
  outdatedLocalReadyCount = 0,
  onPreviewDevicePaths,
  onOpenDevicesDrawer,
  onUpdateOutdatedOnDevice,
  onViewOutdatedInCatalog,
}: StorageDeviceSidebarDockProps) {
  const support = useMemo(() => isFileSystemAccessSupported(), []);
  const [showSupportDetails, setShowSupportDetails] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const {
    sdRootHandle,
    deviceProfiles,
    activeDeviceProfile,
    activeDeviceName,
    rememberedHandles,
    reconnectingDeviceId,
    isBusy,
    mountError,
    markerWriteNotice,
    autoConfigPhase,
    autoConfigResult,
    autoConfigError,
  } = installer;

  const isScanningAutoConfig = autoConfigPhase === 'scanning';
  const displayDeviceName = activeDeviceName || sdRootHandle?.name || 'Storage Device';
  const activeColor = activeDeviceProfile
    ? getDeviceColorOption(activeDeviceProfile.colorKey)
    : null;

  const activeFleetCount = useMemo(
    () => deviceProfiles.filter((d) => !d.isArchived).length,
    [deviceProfiles],
  );

  // Pick a single smartest reconnect shortcut when disconnected: prefer a pinned non-archived remembered handle, then most recent
  const primaryReconnectHandle = useMemo(() => {
    if (rememberedHandles.length === 0) return null;
    const profileById = new Map(deviceProfiles.map((p) => [p.id, p]));
    const pinnedFirst = rememberedHandles.find((h) => {
      const p = profileById.get(h.deviceId);
      return p && !p.isArchived && p.isPinned;
    });
    if (pinnedFirst) return pinnedFirst;
    const activeFirst = rememberedHandles.find((h) => {
      const p = profileById.get(h.deviceId);
      return !p || !p.isArchived;
    });
    return activeFirst || rememberedHandles[0];
  }, [rememberedHandles, deviceProfiles]);

  const primaryReconnectProfile = useMemo(
    () =>
      primaryReconnectHandle
        ? deviceProfiles.find((p) => p.id === primaryReconnectHandle.deviceId) || null
        : null,
    [primaryReconnectHandle, deviceProfiles],
  );

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
    setEditingName(false);
    void installer.promptMountSdCard();
  };

  const handleReconnect = (deviceId?: string) => {
    if (!support.supported) {
      setShowSupportDetails(true);
      return;
    }
    setShowSupportDetails(false);
    setEditingName(false);
    void installer.reconnectStoredDevice(deviceId);
  };

  const handleEject = () => {
    if (isBusy) return;
    setEditingName(false);
    installer.setSdRootHandle(null);
    installer.clearMountError();
  };

  const handleStartRename = () => {
    if (!activeDeviceProfile) return;
    setDraftName(activeDeviceProfile.name);
    setRenameError(null);
    setEditingName(true);
  };

  const handleCommitRename = async () => {
    if (!activeDeviceProfile) return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      setRenameError('Enter a name');
      return;
    }
    if (trimmed === activeDeviceProfile.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setRenameError(null);
    try {
      await installer.renameDeviceProfile(activeDeviceProfile.id, trimmed);
      setEditingName(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setSavingName(false);
    }
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
          {/* Active Profile Name + Inline Rename */}
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCommitRename();
              }}
              className="space-y-1 px-1 py-1 -mx-1 rounded border border-crt-phosphor/40 bg-crt-elevated/60"
            >
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={80}
                  autoFocus
                  placeholder="Device nickname"
                  aria-label="Device profile name"
                  className="min-w-0 flex-1 bg-crt-void/80 border border-crt-border rounded px-1.5 py-0.5 text-xs font-mono text-crt-text focus:outline-none focus:border-crt-phosphor"
                />
                <button
                  type="submit"
                  disabled={savingName}
                  title="Save device name"
                  className="p-1 rounded text-crt-phosphor hover:bg-crt-phosphor/15 disabled:opacity-50 cursor-pointer"
                >
                  {savingName ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingName(false);
                    setRenameError(null);
                  }}
                  title="Cancel rename"
                  className="p-1 rounded text-crt-muted hover:text-crt-text cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {renameError && (
                <p className="text-[10px] font-mono text-crt-crimson">{renameError}</p>
              )}
            </form>
          ) : (
            <div
              title={
                activeDeviceProfile && activeDeviceProfile.name !== activeDeviceProfile.volumeLabel
                  ? `${activeDeviceProfile.name} (Volume: ${activeDeviceProfile.volumeLabel})${activeDeviceProfile.markerVerifiedAt ? ' · Card ID verified' : ''}`
                  : `Mounted storage root: ${displayDeviceName}`
              }
              className="flex items-center justify-between gap-1.5 px-1.5 py-1 -mx-1 rounded border border-transparent text-xs font-mono text-crt-muted"
            >
              <span className="inline-flex items-center gap-1.5 shrink-0">
                {activeDeviceProfile ? (
                  <DeviceIconGlyph
                    iconKey={activeDeviceProfile.iconKey}
                    className={`h-3.5 w-3.5 shrink-0 ${activeColor?.textClass || 'text-crt-phosphor'}`}
                  />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-crt-phosphor" />
                )}
                <span>Device</span>
              </span>
              <span className="inline-flex items-center gap-1 min-w-0">
                <span className="text-crt-phosphor font-medium truncate min-w-0">
                  {displayDeviceName}
                </span>
                {activeDeviceProfile?.markerVerifiedAt && (
                  <ShieldCheck
                    aria-label="Card ID verified"
                    className="h-3 w-3 text-crt-phosphor/75 shrink-0"
                  />
                )}
                {activeDeviceProfile && (
                  <button
                    type="button"
                    onClick={handleStartRename}
                    title="Rename this device profile"
                    aria-label="Rename device profile"
                    className="p-0.5 rounded text-crt-muted/75 hover:text-crt-phosphor hover:bg-crt-elevated transition-colors shrink-0 cursor-pointer"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            </div>
          )}

          {activeDeviceProfile && (
            <div className="flex items-center justify-between gap-2 px-1.5 py-0.5 -mx-1 text-xs font-mono text-crt-muted">
              <span className="shrink-0">Installed</span>
              <span className="text-crt-text tabular-nums">
                {activeDeviceProfile.installedCount.toLocaleString()}
              </span>
            </div>
          )}

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
                  title={`Upgrade ${outdatedLocalReadyCount} outdated ROM${outdatedLocalReadyCount === 1 ? '' : 's'} on ${displayDeviceName}`}
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
              title={`Open Device Export to view Live Export Destination Preview for "${displayDeviceName}"`}
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

          {onOpenDevicesDrawer && deviceProfiles.length > 0 && (
            <div className="pt-1.5 mt-1 border-t border-crt-border/60">
              <button
                type="button"
                onClick={onOpenDevicesDrawer}
                title="Open searchable Storage Devices drawer to switch, pin, archive, or browse any saved device"
                className="w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-transparent text-[11px] font-mono text-crt-muted hover:border-crt-border-strong hover:bg-crt-elevated/65 hover:text-crt-text transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <Layers className="h-3 w-3 shrink-0" />
                  <span className="truncate">Manage Devices</span>
                </span>
                <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0 text-crt-muted/85">
                  <span>{activeFleetCount || deviceProfiles.length}</span>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                </span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {primaryReconnectHandle && support.supported ? (
            <>
              <button
                type="button"
                disabled={Boolean(reconnectingDeviceId)}
                onClick={() => handleReconnect(primaryReconnectHandle.deviceId)}
                title={`Reconnect remembered storage device "${primaryReconnectHandle.profileName}" without re-browsing folders`}
                className="w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1.5 -mx-1 rounded border border-crt-phosphor/35 bg-crt-phosphor/8 text-xs font-mono text-crt-phosphor hover:bg-crt-phosphor/15 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-55"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  {reconnectingDeviceId === primaryReconnectHandle.deviceId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : primaryReconnectProfile ? (
                    <DeviceIconGlyph
                      iconKey={primaryReconnectProfile.iconKey}
                      className={`h-3.5 w-3.5 shrink-0 ${getDeviceColorOption(primaryReconnectProfile.colorKey).textClass}`}
                    />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">Reconnect {primaryReconnectHandle.profileName}</span>
                </span>
              </button>

              <button
                type="button"
                onClick={handleMountOrSwitch}
                title={formatMountDeviceTooltip(support)}
                className="w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-transparent text-[11px] font-mono text-crt-muted hover:border-crt-border-strong hover:bg-crt-elevated/65 hover:text-crt-text transition-colors whitespace-nowrap cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <FolderPlus className="h-3 w-3 shrink-0" />
                  <span className="truncate">Mount Another…</span>
                </span>
              </button>
            </>
          ) : (
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
          )}

          {onOpenDevicesDrawer && deviceProfiles.length > 0 && (
            <button
              type="button"
              onClick={onOpenDevicesDrawer}
              title="Open searchable Storage Devices drawer to reconnect, organize, or inspect any saved device offline"
              className="w-[calc(100%+0.5rem)] flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border border-transparent text-[11px] font-mono text-crt-muted hover:border-crt-border-strong hover:bg-crt-elevated/65 hover:text-crt-text transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Layers className="h-3 w-3 shrink-0" />
                <span className="truncate">Devices</span>
              </span>
              <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0 text-crt-muted/85">
                <span>{activeFleetCount || deviceProfiles.length}</span>
                <ChevronRight className="h-3 w-3 shrink-0" />
              </span>
            </button>
          )}

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

      {/* Accurate Secure Context / Browser Guidance, Auto-Config Error, Marker Notice, or Mount Error */}
      {(mountError || autoConfigError || markerWriteNotice || (showSupportDetails && !support.supported)) && (
        <div className="pt-2 border-t border-crt-border/70 flex items-start justify-between gap-2 text-[11px] font-mono leading-relaxed text-crt-amber">
          <span className="break-words min-w-0">
            {mountError || autoConfigError || markerWriteNotice || support.reason}
          </span>
          <button
            type="button"
            onClick={() => {
              installer.clearMountError();
              installer.clearMarkerWriteNotice();
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

