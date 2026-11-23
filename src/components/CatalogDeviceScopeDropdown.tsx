import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Pin,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { sortDeviceProfilesForFleet } from '../shared/deviceProfiles';
import type { StorageDeviceProfile } from '../types';
import { DeviceIconGlyph, getDeviceColorOption } from './DeviceBadge';

interface CatalogDeviceScopeDropdownProps {
  devices: StorageDeviceProfile[];
  mountedDeviceId: string | null;
  selectedDeviceId: string | 'any';
  onSelectDevice: (deviceId: string | 'any') => void;
  onManageDevices: () => void;
}

export function CatalogDeviceScopeDropdown({
  devices,
  mountedDeviceId,
  selectedDeviceId,
  onSelectDevice,
  onManageDevices,
}: CatalogDeviceScopeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const sortedDevices = useMemo(
    () => sortDeviceProfilesForFleet(devices, mountedDeviceId),
    [devices, mountedDeviceId],
  );

  const selectedProfile = useMemo(
    () =>
      selectedDeviceId === 'any'
        ? null
        : sortedDevices.find((d) => d.id === selectedDeviceId) || null,
    [selectedDeviceId, sortedDevices],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && devices.length >= 5) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    } else if (!open) {
      setSearch('');
    }
  }, [open, devices.length]);

  const query = search.trim().toLowerCase();

  const { mountedList, pinnedList, otherActiveList, archivedList } = useMemo(() => {
    const matches = (d: StorageDeviceProfile) =>
      !query ||
      d.name.toLowerCase().includes(query) ||
      d.volumeLabel.toLowerCase().includes(query);

    const mounted: StorageDeviceProfile[] = [];
    const pinned: StorageDeviceProfile[] = [];
    const otherActive: StorageDeviceProfile[] = [];
    const archived: StorageDeviceProfile[] = [];

    for (const d of sortedDevices) {
      if (!matches(d)) continue;
      if (mountedDeviceId && d.id === mountedDeviceId) {
        mounted.push(d);
      } else if (d.isArchived) {
        archived.push(d);
      } else if (d.isPinned) {
        pinned.push(d);
      } else {
        otherActive.push(d);
      }
    }
    return {
      mountedList: mounted,
      pinnedList: pinned,
      otherActiveList: otherActive,
      archivedList: archived,
    };
  }, [sortedDevices, mountedDeviceId, query]);

  if (devices.length === 0) return null;

  const isSelectedMounted = Boolean(selectedProfile && selectedProfile.id === mountedDeviceId);
  const selectedColor = selectedProfile ? getDeviceColorOption(selectedProfile.colorKey) : null;

  const renderOption = (profile: StorageDeviceProfile) => {
    const isSelected = selectedDeviceId === profile.id;
    const isMounted = Boolean(mountedDeviceId && profile.id === mountedDeviceId);
    const color = getDeviceColorOption(profile.colorKey);
    return (
      <button
        key={profile.id}
        type="button"
        onClick={() => {
          onSelectDevice(profile.id);
          setOpen(false);
        }}
        className={`w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left text-xs font-mono transition-colors cursor-pointer ${
          isSelected
            ? 'bg-crt-phosphor/12 text-crt-text'
            : 'text-crt-text/90 hover:bg-crt-elevated/75'
        }`}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <DeviceIconGlyph
            iconKey={profile.iconKey}
            className={`h-3.5 w-3.5 shrink-0 ${color.textClass}`}
          />
          <span className="truncate">{profile.name}</span>
          {profile.isPinned && !isMounted && (
            <Pin className="h-2.5 w-2.5 text-crt-amber/85 shrink-0" />
          )}
          {isMounted && (
            <span className="text-[10px] text-crt-phosphor shrink-0">· Mounted</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 shrink-0 tabular-nums text-[11px] text-crt-muted">
          <span>{profile.installedCount.toLocaleString()}</span>
          {isSelected && <Check className="h-3 w-3 text-crt-phosphor shrink-0" />}
        </span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        title={
          selectedProfile
            ? `Scoping Installed / Not Installed / Updates filters to ${selectedProfile.name}${isSelectedMounted ? ' (Mounted)' : ' (Offline)'}`
            : 'Scoping Installed / Not Installed / Updates filters across all saved devices'
        }
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          selectedProfile
            ? isSelectedMounted
              ? 'bg-crt-phosphor/12 text-crt-phosphor border-crt-phosphor/55 font-medium'
              : 'bg-crt-elevated/85 text-crt-text border-crt-border-strong font-medium'
            : 'bg-crt-bg text-crt-muted border-crt-border hover:border-crt-border-strong hover:text-crt-text'
        }`}
      >
        {selectedProfile ? (
          <DeviceIconGlyph
            iconKey={selectedProfile.iconKey}
            className={`h-3.5 w-3.5 shrink-0 ${selectedColor?.textClass || 'text-crt-phosphor'}`}
          />
        ) : (
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-crt-muted" />
        )}
        <span className="max-w-[140px] truncate">
          {selectedProfile ? selectedProfile.name : 'Any Device'}
        </span>
        {selectedProfile && !isSelectedMounted && (
          <span className="text-[10px] text-crt-muted font-normal shrink-0">Offline</span>
        )}
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-crt-muted transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Filter catalog by storage device"
          className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 z-50 w-72 border border-crt-border-strong bg-crt-surface rounded-md shadow-2xl overflow-hidden flex flex-col"
        >
          {devices.length >= 5 && (
            <div className="p-2 border-b border-crt-border bg-crt-bg/60">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search saved devices…"
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted/55 focus:outline-none focus:border-crt-phosphor"
                />
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto divide-y divide-crt-border/70">
            {/* Any Device aggregate option */}
            {(!query || 'any device'.includes(query)) && (
              <button
                type="button"
                onClick={() => {
                  onSelectDevice('any');
                  setOpen(false);
                }}
                className={`w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left text-xs font-mono transition-colors cursor-pointer ${
                  selectedDeviceId === 'any'
                    ? 'bg-crt-phosphor/12 text-crt-phosphor font-medium'
                    : 'text-crt-text hover:bg-crt-elevated/75'
                }`}
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-crt-muted" />
                  <span>Any Device</span>
                </span>
                <span className="inline-flex items-center gap-1.5 shrink-0 text-[11px] text-crt-muted tabular-nums">
                  <span>{devices.length}</span>
                  {selectedDeviceId === 'any' && <Check className="h-3 w-3 text-crt-phosphor" />}
                </span>
              </button>
            )}

            {mountedList.length > 0 && (
              <div>
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-crt-phosphor/80 bg-crt-bg/40">
                  Mounted Now
                </div>
                {mountedList.map(renderOption)}
              </div>
            )}

            {pinnedList.length > 0 && (
              <div>
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-crt-muted bg-crt-bg/40">
                  Pinned
                </div>
                {pinnedList.map(renderOption)}
              </div>
            )}

            {otherActiveList.length > 0 && (
              <div>
                {(mountedList.length > 0 || pinnedList.length > 0) && (
                  <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-crt-muted bg-crt-bg/40">
                    Saved Devices
                  </div>
                )}
                {otherActiveList.map(renderOption)}
              </div>
            )}

            {archivedList.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowArchived((prev) => !prev)}
                  className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-wider text-crt-muted hover:text-crt-text bg-crt-bg/40 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1">
                    <Archive className="h-3 w-3 shrink-0" />
                    <span>Archived ({archivedList.length})</span>
                  </span>
                  <ChevronRight
                    className={`h-3 w-3 transition-transform ${
                      showArchived || Boolean(query) ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                {(showArchived || Boolean(query)) && archivedList.map(renderOption)}
              </div>
            )}

            {mountedList.length === 0 &&
              pinnedList.length === 0 &&
              otherActiveList.length === 0 &&
              archivedList.length === 0 &&
              query && (
                <div className="px-3 py-4 text-center text-xs font-mono text-crt-muted">
                  No devices match "{search}".
                </div>
              )}
          </div>

          <div className="border-t border-crt-border bg-crt-bg/70 p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManageDevices();
              }}
              className="w-full px-2 py-1.5 rounded flex items-center justify-center gap-1.5 text-xs font-mono text-crt-muted hover:text-crt-phosphor hover:bg-crt-elevated/70 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="h-3 w-3 shrink-0" />
              <span>Manage Devices ({devices.length})</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
