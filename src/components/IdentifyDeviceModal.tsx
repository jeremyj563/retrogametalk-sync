import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  HardDrive,
  Link2,
  Loader2,
  Pin,
  PlusCircle,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { sortDeviceProfilesForFleet } from '../shared/deviceProfiles';
import type { DeviceColorKey, DeviceIconKey } from '../types';
import {
  DEVICE_COLOR_OPTIONS,
  DEVICE_ICON_OPTIONS,
  DeviceEmblem,
  DeviceIconGlyph,
} from './DeviceBadge';

interface IdentifyDeviceModalProps {
  installer: BulkStorageInstallerController;
}

export function IdentifyDeviceModal({ installer }: IdentifyDeviceModalProps) {
  const pending = installer.pendingDeviceIdentification;
  const busy = installer.identifyingDeviceBusy;
  const allProfiles = installer.deviceProfiles;

  const hasSavedProfiles = allProfiles.length > 0;
  const hasUnstampedVolumeMatch = Boolean(
    pending?.matchingVolumeProfiles.some((p) => !p.markerVerifiedAt && !p.isArchived),
  );

  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [name, setName] = useState('');
  const [iconKey, setIconKey] = useState<DeviceIconKey>('handheld');
  const [colorKey, setColorKey] = useState<DeviceColorKey>('phosphor');
  const [isPinned, setIsPinned] = useState(false);
  const [selectedLinkId, setSelectedLinkId] = useState<string>('');
  const [linkSearch, setLinkSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    setName(pending.suggestedName);
    setIconKey(pending.suggestedIconKey);
    setColorKey(pending.suggestedColorKey);
    setIsPinned(false);
    setLinkSearch('');
    setError(null);

    const unstampedMatch = pending.matchingVolumeProfiles.find(
      (p) => !p.markerVerifiedAt && !p.isArchived,
    );
    const anyVolumeMatch = pending.matchingVolumeProfiles[0] || null;
    if (unstampedMatch) {
      setMode('link');
      setSelectedLinkId(unstampedMatch.id);
    } else {
      setMode('new');
      setSelectedLinkId(anyVolumeMatch?.id || allProfiles[0]?.id || '');
    }
  }, [pending, allProfiles]);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        installer.cancelDeviceIdentification();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending, busy, installer]);

  const sortedLinkCandidates = useMemo(() => {
    if (!pending) return [];
    const lowerVol = pending.volumeLabel.trim().toLowerCase();
    const query = linkSearch.trim().toLowerCase();
    const base = sortDeviceProfilesForFleet(allProfiles, null);
    const filtered = query
      ? base.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.volumeLabel.toLowerCase().includes(query) ||
            p.id.toLowerCase().includes(query),
        )
      : base;

    return [...filtered].sort((a, b) => {
      const aVolMatch = a.volumeLabel.trim().toLowerCase() === lowerVol ? 1 : 0;
      const bVolMatch = b.volumeLabel.trim().toLowerCase() === lowerVol ? 1 : 0;
      if (aVolMatch !== bVolMatch) return bVolMatch - aVolMatch;
      const aUnstamped = !a.markerVerifiedAt ? 1 : 0;
      const bUnstamped = !b.markerVerifiedAt ? 1 : 0;
      if (aVolMatch && bVolMatch && aUnstamped !== bUnstamped) {
        return bUnstamped - aUnstamped;
      }
      return 0;
    });
  }, [pending, allProfiles, linkSearch]);

  if (!pending) return null;

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a recognizable name for this device.');
      return;
    }
    setError(null);
    await installer.confirmNewDeviceIdentification({
      name: trimmed,
      iconKey,
      colorKey,
      isPinned,
    });
  };

  const handleSubmitLink = async () => {
    if (!selectedLinkId) {
      setError('Select an existing device profile to link.');
      return;
    }
    setError(null);
    await installer.confirmLinkDeviceIdentification(selectedLinkId);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="identify-device-modal-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          installer.cancelDeviceIdentification();
        }
      }}
    >
      <div className="w-full max-w-lg border border-crt-border-strong bg-crt-surface rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-crt-border flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <DeviceEmblem iconKey={iconKey} colorKey={colorKey} size="md" className="mt-0.5" />
            <div className="min-w-0 space-y-0.5">
              <h2
                id="identify-device-modal-title"
                className="font-display text-base font-semibold text-crt-text leading-tight"
              >
                Identify Storage Device
              </h2>
              <p className="text-xs font-mono text-crt-muted truncate">
                Mounted folder:{' '}
                <span className="text-crt-text">{pending.volumeLabel}</span> · No{' '}
                <span className="text-crt-phosphor">.rgt-device.json</span> ID found
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={installer.cancelDeviceIdentification}
            aria-label="Cancel mounting device"
            className="p-1.5 rounded text-crt-muted hover:text-crt-text hover:bg-crt-elevated transition-colors shrink-0 cursor-pointer disabled:opacity-45"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {pending.markerReadError && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded border border-crt-amber/40 bg-crt-amber/8 text-xs font-mono text-crt-amber">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Existing .rgt-device.json could not be read ({pending.markerReadError}). Confirming below will stamp a fresh card ID.
              </span>
            </div>
          )}

          {hasSavedProfiles && (
            <div
              role="tablist"
              aria-label="Device identification mode"
              className="grid grid-cols-2 gap-1 p-1 rounded border border-crt-border bg-crt-bg text-xs font-mono"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'new'}
                onClick={() => {
                  setMode('new');
                  setError(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'new'
                    ? 'bg-crt-phosphor/15 text-crt-phosphor font-medium'
                    : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                <PlusCircle className="h-3.5 w-3.5 shrink-0" />
                <span>New Device</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'link'}
                onClick={() => {
                  setMode('link');
                  setError(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'link'
                    ? 'bg-crt-phosphor/15 text-crt-phosphor font-medium'
                    : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                <Link2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Link Existing
                  {hasUnstampedVolumeMatch ? ' · Match' : ` (${allProfiles.length})`}
                </span>
              </button>
            </div>
          )}

          {mode === 'new' ? (
            <form id="identify-new-device-form" onSubmit={(e) => void handleSubmitNew(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="new-device-name-input"
                  className="block text-xs font-medium text-crt-text"
                >
                  Device Name
                </label>
                <input
                  id="new-device-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  autoFocus
                  placeholder="e.g., Miyoo Mini+, Steam Deck 512GB, MiSTer"
                  className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border-strong rounded text-crt-text placeholder:text-crt-muted/50 focus:outline-none focus:border-crt-phosphor"
                />
                <p className="text-[11px] text-crt-muted leading-relaxed">
                  A unique hardware ID will be stamped into a hidden{' '}
                  <span className="font-mono text-crt-text">.rgt-device.json</span> file at the folder root so this card is recognized automatically even if other cards also use{' '}
                  <span className="font-mono text-crt-text">{pending.volumeLabel}</span>.
                </p>
              </div>

              {/* Form-Factor Icon Picker */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-crt-text">Form-Factor Icon</span>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                  {DEVICE_ICON_OPTIONS.map((opt) => {
                    const selected = iconKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setIconKey(opt.key)}
                        title={`${opt.label} (${opt.hint})`}
                        aria-pressed={selected}
                        className={`flex flex-col items-center justify-center gap-1 px-1.5 py-2 rounded border text-[10px] font-mono transition-colors cursor-pointer ${
                          selected
                            ? 'border-crt-phosphor bg-crt-phosphor/12 text-crt-phosphor'
                            : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                        }`}
                      >
                        <DeviceIconGlyph iconKey={opt.key} className="h-4 w-4 shrink-0" />
                        <span className="truncate max-w-full">{opt.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color Badge Picker */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-crt-text">Color Badge</span>
                <div className="flex flex-wrap items-center gap-2">
                  {DEVICE_COLOR_OPTIONS.map((opt) => {
                    const selected = colorKey === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setColorKey(opt.key)}
                        aria-pressed={selected}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-mono transition-colors whitespace-nowrap cursor-pointer ${
                          selected
                            ? `${opt.borderClass} ${opt.bgSoftClass} ${opt.textClass} font-medium`
                            : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${opt.swatchClass}`}
                        />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pin Toggle */}
              <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded border border-crt-border bg-crt-bg cursor-pointer hover:border-crt-border-strong transition-colors">
                <span className="inline-flex items-center gap-2 text-xs text-crt-text">
                  <Pin className="h-3.5 w-3.5 text-crt-muted shrink-0" />
                  <span>Pin to favorites (keeps near top of Devices & Catalog switchers)</span>
                </span>
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-crt-phosphor)] cursor-pointer shrink-0"
                />
              </label>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-crt-muted leading-relaxed">
                Link this physical card to an existing profile to preserve its installed games and custom folder rules, then stamp its unique{' '}
                <span className="font-mono text-crt-text">.rgt-device.json</span> ID onto the card.
              </p>

              {allProfiles.length >= 5 && (
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-crt-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                    placeholder="Filter saved profiles…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted/55 focus:outline-none focus:border-crt-phosphor"
                  />
                </div>
              )}

              <div className="max-h-60 overflow-y-auto divide-y divide-crt-border border border-crt-border bg-crt-bg rounded">
                {sortedLinkCandidates.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs font-mono text-crt-muted">
                    No saved device profiles match "{linkSearch}".
                  </div>
                ) : (
                  sortedLinkCandidates.map((profile) => {
                    const selected = selectedLinkId === profile.id;
                    const sameVolume =
                      profile.volumeLabel.trim().toLowerCase() ===
                      pending.volumeLabel.trim().toLowerCase();
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        onClick={() => setSelectedLinkId(profile.id)}
                        className={`w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                          selected ? 'bg-crt-phosphor/10' : 'hover:bg-crt-elevated/60'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <DeviceEmblem
                            iconKey={profile.iconKey}
                            colorKey={profile.colorKey}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-mono font-medium text-crt-text truncate">
                                {profile.name}
                              </span>
                              {sameVolume && (
                                <span className="text-[10px] font-mono text-crt-phosphor shrink-0">
                                  · Same folder
                                </span>
                              )}
                              {profile.isArchived && (
                                <span className="text-[10px] font-mono text-crt-muted shrink-0">
                                  · Archived
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-crt-muted tabular-nums truncate">
                              {profile.volumeLabel} · {profile.installedCount.toLocaleString()} installed ·{' '}
                              {profile.markerVerifiedAt ? 'Card ID stamped' : 'Unstamped legacy'}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
                            selected
                              ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                              : 'border-crt-border-strong'
                          }`}
                        >
                          {selected && <Check className="h-2.5 w-2.5" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs font-mono text-crt-crimson">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-crt-border bg-crt-bg/60 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-crt-muted min-w-0 truncate">
            <ShieldCheck className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
            <span className="truncate">Read-only cards still mount locally</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={installer.cancelDeviceIdentification}
              className="px-3 py-1.5 text-xs font-mono border border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
            >
              Cancel
            </button>
            {mode === 'new' ? (
              <button
                type="submit"
                form="identify-new-device-form"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-crt-phosphor text-crt-bg rounded hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>Create & Stamp Card</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !selectedLinkId}
                onClick={() => void handleSubmitLink()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-crt-phosphor text-crt-bg rounded hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>Link & Stamp Card</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
