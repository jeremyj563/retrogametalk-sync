import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  FolderPlus,
  HardDrive,
  Library,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Power,
  Search,
  ShieldCheck,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { sortDeviceProfilesForFleet } from '../shared/deviceProfiles';
import type { DeviceColorKey, DeviceIconKey, StorageDeviceProfile } from '../types';
import { formatDateTime } from '../utils/format';
import { isFileSystemAccessSupported } from '../utils/sdCardFs';
import {
  DEVICE_COLOR_OPTIONS,
  DEVICE_ICON_OPTIONS,
  DeviceEmblem,
  DeviceIconGlyph,
} from './DeviceBadge';

interface DevicesFleetDrawerProps {
  open: boolean;
  installer: BulkStorageInstallerController;
  onBrowseDeviceInCatalog: (deviceId: string) => void;
  onClose: () => void;
}

type FleetTab = 'active' | 'pinned' | 'archived';
type DrawerPhase = 'entering' | 'open' | 'closing';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function DevicesFleetDrawer({
  open,
  installer,
  onBrowseDeviceInCatalog,
  onClose,
}: DevicesFleetDrawerProps) {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<DrawerPhase>(open ? 'entering' : 'closing');
  const [tab, setTab] = useState<FleetTab>('active');
  const [search, setSearch] = useState('');

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState<DeviceIconKey>('handheld');
  const [editColor, setEditColor] = useState<DeviceColorKey>('phosphor');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [stampingId, setStampingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    tone: 'ok' | 'error';
    message: string;
  } | null>(null);

  const support = useMemo(() => isFileSystemAccessSupported(), []);
  const phaseRef = useRef<DrawerPhase>(phase);
  phaseRef.current = phase;
  const openRaf1Ref = useRef<number | null>(null);
  const openRaf2Ref = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearOpenRafs = useCallback(() => {
    if (openRaf1Ref.current !== null) {
      window.cancelAnimationFrame(openRaf1Ref.current);
      openRaf1Ref.current = null;
    }
    if (openRaf2Ref.current !== null) {
      window.cancelAnimationFrame(openRaf2Ref.current);
      openRaf2Ref.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (open) {
      clearCloseTimer();
      setRendered(true);
      if (phaseRef.current !== 'open') {
        setPhase('entering');
        clearOpenRafs();
        openRaf1Ref.current = window.requestAnimationFrame(() => {
          openRaf1Ref.current = null;
          openRaf2Ref.current = window.requestAnimationFrame(() => {
            openRaf2Ref.current = null;
            setPhase('open');
          });
        });
      }
    } else if (rendered) {
      clearOpenRafs();
      setPhase('closing');
      clearCloseTimer();
      const durationMs = prefersReducedMotion() ? 110 : 270;
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setRendered(false);
      }, durationMs);
    }
  }, [open, rendered, clearCloseTimer, clearOpenRafs]);

  useEffect(() => {
    return () => {
      clearOpenRafs();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenRafs]);

  useEffect(() => {
    if (!open) return;
    void installer.refreshDeviceProfiles();
  }, [open, installer.refreshDeviceProfiles]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) {
          e.preventDefault();
          setEditingId(null);
          return;
        }
        if (confirmDeleteId) {
          e.preventDefault();
          setConfirmDeleteId(null);
          return;
        }
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, editingId, confirmDeleteId, onClose]);

  const {
    deviceProfiles,
    activeDeviceProfile,
    rememberedHandles,
    reconnectingDeviceId,
    isBusy,
  } = installer;

  const rememberedIdSet = useMemo(
    () => new Set(rememberedHandles.map((h) => h.deviceId)),
    [rememberedHandles],
  );

  const sortedProfiles = useMemo(
    () => sortDeviceProfilesForFleet(deviceProfiles, activeDeviceProfile?.id ?? null),
    [deviceProfiles, activeDeviceProfile?.id],
  );

  const counts = useMemo(() => {
    let active = 0;
    let pinned = 0;
    let archived = 0;
    for (const d of sortedProfiles) {
      if (d.isArchived) {
        archived += 1;
      } else {
        active += 1;
        if (d.isPinned) pinned += 1;
      }
    }
    return { active, pinned, archived };
  }, [sortedProfiles]);

  const visibleProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sortedProfiles.filter((d) => {
      if (tab === 'active' && d.isArchived) return false;
      if (tab === 'pinned' && (d.isArchived || !d.isPinned)) return false;
      if (tab === 'archived' && !d.isArchived) return false;
      if (!query) return true;
      return (
        d.name.toLowerCase().includes(query) ||
        d.volumeLabel.toLowerCase().includes(query) ||
        d.id.toLowerCase().includes(query)
      );
    });
  }, [sortedProfiles, tab, search]);

  if (!rendered) return null;

  const startEdit = (profile: StorageDeviceProfile) => {
    setConfirmDeleteId(null);
    setActionFeedback(null);
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditIcon(profile.iconKey);
    setEditColor(profile.colorKey);
  };

  const handleSaveEdit = async (profileId: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setActionFeedback({ tone: 'error', message: 'Device name cannot be empty.' });
      return;
    }
    setSavingId(profileId);
    setActionFeedback(null);
    try {
      await installer.saveDeviceProfileSettings(profileId, {
        name: trimmed,
        iconKey: editIcon,
        colorKey: editColor,
      });
      setEditingId(null);
      setActionFeedback({ tone: 'ok', message: `Saved changes to "${trimmed}".` });
    } catch (err) {
      setActionFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to save device settings.',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleTogglePin = async (profile: StorageDeviceProfile) => {
    setSavingId(profile.id);
    setActionFeedback(null);
    try {
      await installer.saveDeviceProfileSettings(profile.id, {
        isPinned: !profile.isPinned,
      });
    } catch (err) {
      setActionFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to update pin state.',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleArchive = async (profile: StorageDeviceProfile) => {
    setSavingId(profile.id);
    setActionFeedback(null);
    try {
      const nextArchived = !profile.isArchived;
      await installer.saveDeviceProfileSettings(profile.id, {
        isArchived: nextArchived,
      });
      setActionFeedback({
        tone: 'ok',
        message: nextArchived
          ? `Archived "${profile.name}" (install history preserved).`
          : `Restored "${profile.name}" to active devices.`,
      });
    } catch (err) {
      setActionFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to update archive state.',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleStampMarker = async (profileId: string) => {
    setStampingId(profileId);
    setActionFeedback(null);
    try {
      const res = await installer.stampActiveDeviceMarker();
      if (res.ok) {
        setActionFeedback({
          tone: 'ok',
          message: 'Stamped .rgt-device.json hardware ID onto mounted card.',
        });
      } else {
        setActionFeedback({
          tone: 'error',
          message: res.error || 'Could not write .rgt-device.json onto mounted card.',
        });
      }
    } finally {
      setStampingId(null);
    }
  };

  const handleDelete = async (profile: StorageDeviceProfile) => {
    setSavingId(profile.id);
    setActionFeedback(null);
    try {
      const ok = await installer.deleteDeviceProfile(profile.id);
      setConfirmDeleteId(null);
      if (ok) {
        setActionFeedback({
          tone: 'ok',
          message: `Deleted profile "${profile.name}". ROM files on the card were not touched.`,
        });
      } else {
        setActionFeedback({ tone: 'error', message: `Failed to delete "${profile.name}".` });
      }
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="devices-fleet-drawer-title"
      data-drawer-state={phase}
      onClick={onClose}
      className="crt-detail-backdrop fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex justify-end"
    >
      <div
        data-drawer-state={phase}
        onClick={(e) => e.stopPropagation()}
        className="crt-detail-sheet crt-drawer-panel w-full max-w-xl h-full bg-crt-surface border-l border-crt-border-strong shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Header */}
        <div className="px-5 py-4 bg-crt-bg/95 border-b border-crt-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-[5px] border border-crt-phosphor/45 bg-crt-phosphor/10 text-crt-phosphor flex items-center justify-center shrink-0">
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="devices-fleet-drawer-title"
                className="font-display text-base font-bold text-crt-text tracking-[0.02em] truncate"
              >
                Storage Devices
              </h2>
              <div className="text-xs font-mono text-crt-muted tabular-nums">
                {counts.active} active
                {counts.pinned > 0 ? ` · ${counts.pinned} pinned` : ''}
                {counts.archived > 0 ? ` · ${counts.archived} archived` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!support.supported || isBusy}
              onClick={() => void installer.promptMountSdCard()}
              title={
                support.supported
                  ? 'Mount a new SD card or storage folder'
                  : support.reason || 'Folder picker requires a Chromium browser over HTTPS'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-crt-phosphor text-crt-bg rounded hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <FolderPlus className="h-3.5 w-3.5 shrink-0" />
              <span>Mount New</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Storage Devices drawer"
              className="p-1.5 rounded border border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors shrink-0 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search + Segmented Fleet Filter */}
        <div className="px-5 py-3 bg-crt-bg/60 border-b border-crt-border space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices by name, volume folder, or ID…"
              className="w-full pl-9 pr-8 py-1.5 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted/55 focus:outline-none focus:border-crt-phosphor"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-crt-muted hover:text-crt-text cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div
            role="tablist"
            aria-label="Device fleet filter"
            className="grid grid-cols-3 gap-1 p-0.5 rounded border border-crt-border bg-crt-bg text-xs font-mono"
          >
            {(
              [
                { key: 'active' as const, label: 'Active', count: counts.active },
                { key: 'pinned' as const, label: 'Pinned', count: counts.pinned },
                { key: 'archived' as const, label: 'Archived', count: counts.archived },
              ] as const
            ).map((item) => {
              const selected = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(item.key)}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
                    selected
                      ? 'bg-crt-phosphor/15 text-crt-phosphor font-medium'
                      : 'text-crt-muted hover:text-crt-text'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="tabular-nums text-[11px] opacity-80">{item.count}</span>
                </button>
              );
            })}
          </div>

          {actionFeedback && (
            <div
              className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-[11px] font-mono ${
                actionFeedback.tone === 'ok'
                  ? 'border-crt-phosphor/40 bg-crt-phosphor/8 text-crt-phosphor'
                  : 'border-crt-crimson/45 bg-crt-crimson/10 text-crt-crimson'
              }`}
            >
              <span className="min-w-0 break-words">{actionFeedback.message}</span>
              <button
                type="button"
                onClick={() => setActionFeedback(null)}
                aria-label="Dismiss notice"
                className="p-0.5 opacity-75 hover:opacity-100 shrink-0 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Fleet List */}
        <div className="flex-1 overflow-y-auto">
          {sortedProfiles.length === 0 ? (
            <div className="px-6 py-14 text-center space-y-3">
              <div className="h-11 w-11 mx-auto rounded border border-crt-border bg-crt-bg flex items-center justify-center text-crt-muted">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-sm font-semibold text-crt-text">
                  No storage devices saved yet
                </h3>
                <p className="text-xs text-crt-muted max-w-sm mx-auto leading-relaxed">
                  Mount an SD card, handheld folder, or USB drive to stamp a unique hardware ID and track installed games per device.
                </p>
              </div>
              <button
                type="button"
                disabled={!support.supported}
                onClick={() => void installer.promptMountSdCard()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-crt-phosphor text-crt-bg rounded hover:brightness-110 transition-all cursor-pointer disabled:opacity-45"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span>Mount Your First Device</span>
              </button>
            </div>
          ) : visibleProfiles.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-2.5">
              <p className="text-xs font-mono text-crt-muted">
                {search.trim()
                  ? `No ${tab} devices match "${search.trim()}".`
                  : tab === 'pinned'
                    ? 'No pinned devices yet. Pin your daily drivers to keep them at the top.'
                    : tab === 'archived'
                      ? 'No archived devices. Archive retired cards to tuck them away while keeping install history.'
                      : 'All saved devices are archived.'}
              </p>
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="px-2.5 py-1 text-xs font-mono border border-crt-border text-crt-text hover:border-crt-phosphor rounded cursor-pointer"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-crt-border">
              {visibleProfiles.map((profile) => {
                const isMounted = activeDeviceProfile?.id === profile.id;
                const canReconnect = !isMounted && rememberedIdSet.has(profile.id);
                const isReconnecting = reconnectingDeviceId === profile.id;
                const isEditing = editingId === profile.id;
                const isConfirmDelete = confirmDeleteId === profile.id;
                const isRowBusy =
                  savingId === profile.id || isReconnecting || stampingId === profile.id;

                return (
                  <div
                    key={profile.id}
                    className={`px-5 py-3.5 space-y-2.5 transition-colors ${
                      isMounted ? 'bg-crt-phosphor/[0.04]' : 'hover:bg-crt-elevated/35'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <DeviceEmblem
                          iconKey={profile.iconKey}
                          colorKey={profile.colorKey}
                          size="md"
                          className="mt-0.5"
                        />
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-crt-text truncate">
                              {profile.name}
                            </span>
                            {profile.isPinned && (
                              <Pin
                                aria-label="Pinned device"
                                className="h-3 w-3 text-crt-amber shrink-0"
                              />
                            )}
                            <span
                              className={`text-[11px] font-mono shrink-0 ${
                                isMounted
                                  ? 'text-crt-phosphor font-medium'
                                  : canReconnect
                                    ? 'text-crt-text/75'
                                    : 'text-crt-muted'
                              }`}
                            >
                              · {isMounted ? 'Mounted' : canReconnect ? 'Ready' : 'Offline'}
                            </span>
                          </div>

                          <div className="text-[11px] font-mono text-crt-muted tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            {profile.volumeLabel && profile.volumeLabel !== profile.name && (
                              <>
                                <span className="text-crt-text/80">{profile.volumeLabel}</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span>
                              {profile.installedCount.toLocaleString()} installed
                            </span>
                            <span aria-hidden="true">·</span>
                            {profile.markerVerifiedAt ? (
                              <span
                                title={`Hardware ID .rgt-device.json verified ${formatDateTime(profile.markerVerifiedAt)}`}
                                className="inline-flex items-center gap-1 text-crt-phosphor/90"
                              >
                                <ShieldCheck className="h-3 w-3 shrink-0" />
                                <span>Card ID</span>
                              </span>
                            ) : (
                              <span
                                title="No .rgt-device.json marker verified on this card yet"
                                className="text-crt-amber/90"
                              >
                                Unstamped
                              </span>
                            )}
                            {profile.lastMountedAt && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Last {formatDateTime(profile.lastMountedAt)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Primary Right CTA */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isMounted ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              installer.setSdRootHandle(null);
                              installer.clearMountError();
                            }}
                            title="Unmount this storage device"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-crimson hover:border-crt-crimson/45 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                          >
                            <Power className="h-3 w-3 shrink-0" />
                            <span>Eject</span>
                          </button>
                        ) : canReconnect ? (
                          <button
                            type="button"
                            disabled={isRowBusy || isBusy}
                            onClick={() => void installer.reconnectStoredDevice(profile.id)}
                            title={`Reconnect remembered handle for ${profile.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-crt-phosphor/55 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                          >
                            {isReconnecting ? (
                              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            ) : (
                              <Plug className="h-3 w-3 shrink-0" />
                            )}
                            <span>Reconnect</span>
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* Inline Editor */}
                    {isEditing && (
                      <div className="p-3 rounded border border-crt-border-strong bg-crt-bg space-y-3">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-mono text-crt-muted">
                            Device Name
                          </label>
                          <input
                            type="text"
                            value={editName}
                            maxLength={80}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSaveEdit(profile.id);
                              }
                            }}
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-crt-surface border border-crt-border-strong rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                          />
                        </div>

                        <div className="space-y-1">
                          <span className="block text-[11px] font-mono text-crt-muted">
                            Form-Factor Icon
                          </span>
                          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
                            {DEVICE_ICON_OPTIONS.map((opt) => {
                              const selected = editIcon === opt.key;
                              return (
                                <button
                                  key={opt.key}
                                  type="button"
                                  onClick={() => setEditIcon(opt.key)}
                                  title={opt.label}
                                  className={`flex flex-col items-center gap-1 px-1 py-1.5 rounded border text-[10px] font-mono transition-colors cursor-pointer ${
                                    selected
                                      ? 'border-crt-phosphor bg-crt-phosphor/12 text-crt-phosphor'
                                      : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text'
                                  }`}
                                >
                                  <DeviceIconGlyph iconKey={opt.key} className="h-3.5 w-3.5" />
                                  <span className="truncate max-w-full">{opt.shortLabel}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="block text-[11px] font-mono text-crt-muted">
                            Color Badge
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {DEVICE_COLOR_OPTIONS.map((opt) => {
                              const selected = editColor === opt.key;
                              return (
                                <button
                                  key={opt.key}
                                  type="button"
                                  onClick={() => setEditColor(opt.key)}
                                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-mono transition-colors whitespace-nowrap cursor-pointer ${
                                    selected
                                      ? `${opt.borderClass} ${opt.bgSoftClass} ${opt.textClass} font-medium`
                                      : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text'
                                  }`}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`h-2 w-2 rounded-full ${opt.swatchClass}`}
                                  />
                                  <span>{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-crt-border/70">
                          <span className="text-[10px] font-mono text-crt-muted truncate">
                            ID: {profile.id}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => setEditingId(null)}
                              className="px-2.5 py-1 text-[11px] font-mono border border-crt-border text-crt-muted hover:text-crt-text rounded cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => void handleSaveEdit(profile.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-crt-phosphor text-crt-bg rounded hover:brightness-110 cursor-pointer disabled:opacity-50"
                            >
                              {savingId === profile.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                              <span>Save</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Row Secondary Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onBrowseDeviceInCatalog(profile.id);
                            onClose();
                          }}
                          title={`Open Catalog filtered to games installed on ${profile.name} (works offline)`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-border bg-crt-bg text-crt-text hover:border-crt-phosphor/60 hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Library className="h-3 w-3 shrink-0" />
                          <span>Browse Installed</span>
                        </button>

                        {!profile.isArchived && (
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() => void handleTogglePin(profile)}
                            title={profile.isPinned ? 'Unpin device' : 'Pin device to favorites'}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 ${
                              profile.isPinned
                                ? 'border-crt-amber/50 bg-crt-amber/10 text-crt-amber'
                                : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text'
                            }`}
                          >
                            {profile.isPinned ? (
                              <PinOff className="h-3 w-3 shrink-0" />
                            ) : (
                              <Pin className="h-3 w-3 shrink-0" />
                            )}
                            <span>{profile.isPinned ? 'Unpin' : 'Pin'}</span>
                          </button>
                        )}

                        {!isEditing && (
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() => startEdit(profile)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                          >
                            <Pencil className="h-3 w-3 shrink-0" />
                            <span>Edit</span>
                          </button>
                        )}

                        {isMounted && !profile.markerVerifiedAt && (
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() => void handleStampMarker(profile.id)}
                            title="Write .rgt-device.json hardware ID file onto this mounted card"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-amber/50 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                          >
                            {stampingId === profile.id ? (
                              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                            ) : (
                              <Stamp className="h-3 w-3 shrink-0" />
                            )}
                            <span>Stamp Card ID</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isConfirmDelete && (
                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() => void handleToggleArchive(profile)}
                            title={
                              profile.isArchived
                                ? 'Restore device to Active list'
                                : 'Archive retired device (keeps install history)'
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                          >
                            {profile.isArchived ? (
                              <ArchiveRestore className="h-3 w-3 shrink-0" />
                            ) : (
                              <Archive className="h-3 w-3 shrink-0" />
                            )}
                            <span>{profile.isArchived ? 'Restore' : 'Archive'}</span>
                          </button>
                        )}

                        {isConfirmDelete ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => void handleDelete(profile)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-crt-crimson text-crt-bg font-semibold hover:brightness-110 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3 shrink-0" />
                              <span>Confirm</span>
                            </button>
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded border border-crt-border text-crt-muted hover:text-crt-text whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isRowBusy || (isMounted && isBusy)}
                            onClick={() => {
                              setEditingId(null);
                              setConfirmDeleteId(profile.id);
                            }}
                            title="Delete profile & install tracking (never deletes ROM files)"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-crimson/40 text-crt-crimson hover:bg-crt-crimson/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                          >
                            <Trash2 className="h-3 w-3 shrink-0" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
