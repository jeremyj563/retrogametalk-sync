import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Disc3,
  FolderTree,
  HardDrive,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  CHD_CACHE_PRESET_GB,
  DEFAULT_CHD_ELIGIBLE_SYSTEMS,
  DISC_CAPABLE_SYSTEM_OPTIONS,
  type DiscExportConfig,
  type M3uLayoutMode,
  type RuntimeCapabilities,
} from '../shared/discExport';
import { formatBytes } from '../utils/format';

interface DiscExportSettingsSectionProps {
  value: DiscExportConfig;
  onChange: (next: DiscExportConfig) => void;
  capabilities: RuntimeCapabilities | null;
  onCacheCleared?: (nextStats: { fileCount: number; totalBytes: number; maxBytes: number }) => void;
}

export function DiscExportSettingsSection({
  value,
  onChange,
  capabilities,
  onCacheCleared,
}: DiscExportSettingsSectionProps) {
  const [expanded, setExpanded] = useState<boolean>(
    () => value.chdConvertEnabled || value.m3uPlaylistEnabled,
  );
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const chdmanAvailable = Boolean(capabilities?.chdman);
  const chdCache = capabilities?.chdCache ?? { fileCount: 0, totalBytes: 0, maxBytes: 0 };

  const selectedSystemsSet = new Set(value.chdEligibleSystems);

  const handleToggleSystem = (slug: string) => {
    const next = new Set(value.chdEligibleSystems);
    if (next.has(slug)) {
      next.delete(slug);
    } else {
      next.add(slug);
    }
    onChange({
      ...value,
      chdEligibleSystems: Array.from(next),
    });
  };

  const handleResetDefaultSystems = () => {
    onChange({
      ...value,
      chdEligibleSystems: [...DEFAULT_CHD_ELIGIBLE_SYSTEMS],
    });
  };

  const handleLayoutChange = (layout: M3uLayoutMode) => {
    onChange({
      ...value,
      m3uLayout: layout,
    });
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    setCacheNotice(null);
    setCacheError(null);
    try {
      const res = await fetch('/api/chd-cache', {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'rgt-sync' },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deletedCount?: number;
        freedBytes?: number;
        chdCache?: { fileCount: number; totalBytes: number; maxBytes: number };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Failed clearing CHD cache (HTTP ${res.status})`);
      }
      if (data.chdCache) {
        onCacheCleared?.(data.chdCache);
      }
      const deleted = data.deletedCount ?? 0;
      const freed = data.freedBytes ?? 0;
      setCacheNotice(
        deleted > 0
          ? `Cleared ${deleted} cached .chd image${deleted === 1 ? '' : 's'} (${formatBytes(freed)} freed).`
          : 'CHD cache is already empty.',
      );
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingCache(false);
    }
  };

  const sampleExt = value.chdConvertEnabled && chdmanAvailable ? '.chd' : '.cue';
  const sampleM3uPath = '/PS/Final Fantasy VII (USA).m3u';
  const sampleDiscLine1 =
    value.m3uLayout === 'subfolder'
      ? sampleExt === '.chd'
        ? './.multidisc/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 1).chd'
        : './.multidisc/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 1)/Final Fantasy VII (USA) (Disc 1).cue'
      : sampleExt === '.chd'
        ? './Final Fantasy VII (USA) (Disc 1).chd'
        : './Final Fantasy VII (USA) (Disc 1)/Final Fantasy VII (USA) (Disc 1).cue';
  const sampleDiscLine2 = sampleDiscLine1.replace(/Disc 1/g, 'Disc 2');

  const chdSummaryText = !chdmanAvailable
    ? 'CHD unavailable (no chdman)'
    : value.chdConvertEnabled
      ? `CHD On (${value.chdEligibleSystems.length} console${value.chdEligibleSystems.length === 1 ? '' : 's'})`
      : 'CHD Off';
  const m3uSummaryText = value.m3uPlaylistEnabled
    ? `.m3u On (${value.m3uLayout === 'subfolder' ? '.multidisc/' : 'inline'})`
    : '.m3u Off';

  return (
    <section
      aria-label="Disc Images (.chd and .m3u)"
      className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-6 space-y-4"
    >
      <div aria-hidden="true" className="crt-edge-beam">
        <span />
      </div>

      {/* Collapsible Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Disc3 className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="font-display text-lg font-semibold text-crt-text">
                03. Disc Images (.chd &amp; .m3u)
              </h2>
              <span className="text-xs font-mono text-crt-muted">
                · {chdSummaryText} · {m3uSummaryText}
              </span>
            </div>
            <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
              Optionally compress optical disc sets (<span className="font-mono text-crt-text">.cue/.bin</span>,{' '}
              <span className="font-mono text-crt-text">.gdi</span>,{' '}
              <span className="font-mono text-crt-text">.iso</span>) into single-file{' '}
              <span className="font-mono text-crt-text">.chd</span> images on device export and auto-generate{' '}
              <span className="font-mono text-crt-text">.m3u</span> playlists for multi-disc games. Source archives in your local mirror remain untouched.
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border-strong bg-crt-bg text-crt-text hover:border-crt-phosphor/60 hover:text-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>{expanded ? 'Hide Options' : 'Configure Disc Export'}</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="space-y-5 pt-4 border-t border-crt-border">
          {/* Sub-section A: Optional .chd Disc Compression */}
          <div className="border border-crt-border bg-crt-bg/70 rounded p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={chdmanAvailable && value.chdConvertEnabled}
                    disabled={!chdmanAvailable}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        chdConvertEnabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-crt-phosphor rounded border-crt-border bg-crt-bg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="text-sm font-medium text-crt-text">
                    Convert disc images to <span className="font-mono text-crt-phosphor">.chd</span> on device export
                  </span>
                </label>
                <p className="text-xs text-crt-muted pl-6 leading-relaxed">
                  Shrinks multi-track <span className="font-mono text-crt-text">.cue/.bin</span> and{' '}
                  <span className="font-mono text-crt-text">.gdi</span> releases by ~40–60% into a single lossless{' '}
                  <span className="font-mono text-crt-text">.chd</span> file compatible with RetroArch, DuckStation, Flycast, PCSX2, OnionOS, muOS, and ES-DE.
                </p>
              </div>

              <div className="shrink-0 text-right font-mono text-[11px]">
                {chdmanAvailable ? (
                  <span className="inline-flex items-center gap-1.5 text-crt-phosphor">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span>chdman ready</span>
                  </span>
                ) : (
                  <span className="text-crt-amber">chdman unavailable</span>
                )}
                {capabilities?.chdmanVersion && (
                  <div className="text-[10px] text-crt-muted mt-0.5 max-w-[220px] truncate">
                    {capabilities.chdmanVersion}
                  </div>
                )}
              </div>
            </div>

            {!chdmanAvailable && (
              <div className="ml-6 border border-crt-amber/40 bg-crt-amber/10 rounded px-3 py-2 text-xs text-crt-amber">
                The <span className="font-mono">chdman</span> binary was not detected in this runtime. Install{' '}
                <span className="font-mono">mame-tools</span> on your host or deploy the official RetroGameTalk Sync Docker image (which bundles{' '}
                <span className="font-mono">chdman</span>) to enable on-export <span className="font-mono">.chd</span> compression.
              </div>
            )}

            {/* Eligible Disc Consoles */}
            <div className={`pl-6 space-y-2.5 ${!chdmanAvailable || !value.chdConvertEnabled ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-mono uppercase tracking-wider text-crt-muted">
                  Eligible Disc Consoles ({value.chdEligibleSystems.length})
                </div>
                <button
                  type="button"
                  disabled={!chdmanAvailable || !value.chdConvertEnabled}
                  onClick={handleResetDefaultSystems}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted hover:text-crt-phosphor disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  <RotateCcw className="h-3 w-3 shrink-0" />
                  <span>Reset Defaults</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {DISC_CAPABLE_SYSTEM_OPTIONS.map((opt) => {
                  const checked = selectedSystemsSet.has(opt.slug);
                  return (
                    <label
                      key={opt.slug}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 border rounded text-xs transition-colors ${
                        checked
                          ? 'border-crt-phosphor/50 bg-crt-phosphor/5 text-crt-text'
                          : 'border-crt-border bg-crt-surface/60 text-crt-muted'
                      } ${!chdmanAvailable || !value.chdConvertEnabled ? 'cursor-not-allowed' : 'cursor-pointer hover:border-crt-border-strong'}`}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!chdmanAvailable || !value.chdConvertEnabled}
                          onChange={() => handleToggleSystem(opt.slug)}
                          className="h-3.5 w-3.5 accent-crt-phosphor shrink-0 cursor-pointer disabled:cursor-not-allowed"
                        />
                        <span className="truncate">{opt.label}</span>
                      </span>
                      <span className="font-mono text-[10px] text-crt-muted shrink-0">
                        {opt.dvdCapable ? 'CD/DVD' : 'CD'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Bounded LRU Disk Cache */}
            <div
              className={`pl-6 pt-3 border-t border-crt-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                !chdmanAvailable || !value.chdConvertEnabled ? 'opacity-60' : ''
              }`}
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-crt-text">
                  <HardDrive className="h-3.5 w-3.5 text-crt-muted shrink-0" />
                  <span>CHD Conversion Cache Limit (LRU)</span>
                </div>
                <p className="text-[11px] text-crt-muted leading-relaxed">
                  Reuses recently converted <span className="font-mono text-crt-text">.chd</span> files when installing the same game to multiple handhelds. Set to <span className="font-mono text-crt-text">0 GB</span> to convert into a temporary file and delete immediately after transfer.
                </p>
                {(chdCache.fileCount > 0 || cacheNotice || cacheError) && (
                  <div className="text-[11px] font-mono pt-1 space-y-0.5">
                    {chdCache.fileCount > 0 && (
                      <div className="text-crt-muted tabular-nums">
                        Cache on disk: {chdCache.fileCount} file{chdCache.fileCount === 1 ? '' : 's'} ·{' '}
                        {formatBytes(chdCache.totalBytes)}
                        {value.chdCacheMaxGb > 0 ? ` / ${value.chdCacheMaxGb} GB max` : ''}
                      </div>
                    )}
                    {cacheNotice && <div className="text-crt-phosphor">{cacheNotice}</div>}
                    {cacheError && <div className="text-crt-crimson">{cacheError}</div>}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label="CHD cache size limit"
                  disabled={!chdmanAvailable || !value.chdConvertEnabled}
                  value={value.chdCacheMaxGb}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      chdCacheMaxGb: Number(e.target.value) || 0,
                    })
                  }
                  className="px-2.5 py-1.5 text-xs font-mono bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-50"
                >
                  {CHD_CACHE_PRESET_GB.map((gb) => (
                    <option key={gb} value={gb}>
                      {gb === 0 ? '0 GB (Temp only)' : `${gb} GB cache`}
                    </option>
                  ))}
                  {!CHD_CACHE_PRESET_GB.includes(value.chdCacheMaxGb) && (
                    <option value={value.chdCacheMaxGb}>{value.chdCacheMaxGb} GB cache</option>
                  )}
                </select>

                {chdCache.fileCount > 0 && (
                  <button
                    type="button"
                    disabled={clearingCache}
                    onClick={() => void handleClearCache()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-crimson hover:border-crt-crimson/60 rounded transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {clearingCache ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>Clear Cache</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Sub-section B: Automatic Multi-Disc .m3u Playlists */}
          <div className="border border-crt-border bg-crt-bg/70 rounded p-4 space-y-4">
            <div className="space-y-1">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={value.m3uPlaylistEnabled}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      m3uPlaylistEnabled: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-crt-phosphor rounded border-crt-border bg-crt-bg cursor-pointer"
                />
                <span className="text-sm font-medium text-crt-text">
                  Generate <span className="font-mono text-crt-phosphor">.m3u</span> playlists for multi-disc games
                </span>
              </label>
              <p className="text-xs text-crt-muted pl-6 leading-relaxed">
                Automatically detects multi-disc releases (<span className="font-mono text-crt-text">(Disc 1)</span>,{' '}
                <span className="font-mono text-crt-text">(CD 2)</span>,{' '}
                <span className="font-mono text-crt-text">(Side A/B)</span>), orders discs numerically, and writes a UTF-8{' '}
                <span className="font-mono text-crt-text">.m3u</span> playlist so launchers display one clean entry with seamless disc-swapping. Single-disc games are left untouched.
              </p>
            </div>

            <div className={`pl-6 space-y-3 ${!value.m3uPlaylistEnabled ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label
                  className={`flex items-start gap-2.5 p-3 border rounded text-xs transition-colors ${
                    value.m3uLayout === 'subfolder'
                      ? 'border-crt-phosphor/60 bg-crt-phosphor/5 text-crt-text'
                      : 'border-crt-border bg-crt-surface/60 text-crt-muted'
                  } ${!value.m3uPlaylistEnabled ? 'cursor-not-allowed' : 'cursor-pointer hover:border-crt-border-strong'}`}
                >
                  <input
                    type="radio"
                    name="m3u-layout-mode"
                    checked={value.m3uLayout === 'subfolder'}
                    disabled={!value.m3uPlaylistEnabled}
                    onChange={() => handleLayoutChange('subfolder')}
                    className="mt-0.5 accent-crt-phosphor cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="font-medium text-crt-text">
                      Hidden subfolder (<span className="font-mono text-crt-phosphor">.multidisc/</span>) · Recommended
                    </div>
                    <p className="text-[11px] text-crt-muted leading-relaxed">
                      Places disc files inside <span className="font-mono">.multidisc/&lt;Game&gt;/</span> and keeps only{' '}
                      <span className="font-mono">&lt;Game&gt;.m3u</span> visible at the console folder root (ideal for OnionOS, ES-DE, muOS, and ArkOS).
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-3 border rounded text-xs transition-colors ${
                    value.m3uLayout === 'inline'
                      ? 'border-crt-phosphor/60 bg-crt-phosphor/5 text-crt-text'
                      : 'border-crt-border bg-crt-surface/60 text-crt-muted'
                  } ${!value.m3uPlaylistEnabled ? 'cursor-not-allowed' : 'cursor-pointer hover:border-crt-border-strong'}`}
                >
                  <input
                    type="radio"
                    name="m3u-layout-mode"
                    checked={value.m3uLayout === 'inline'}
                    disabled={!value.m3uPlaylistEnabled}
                    onChange={() => handleLayoutChange('inline')}
                    className="mt-0.5 accent-crt-phosphor cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="font-medium text-crt-text">
                      Inline beside discs
                    </div>
                    <p className="text-[11px] text-crt-muted leading-relaxed">
                      Writes <span className="font-mono">&lt;Game&gt;.m3u</span> directly alongside the disc files inside the console folder using relative <span className="font-mono">./</span> paths.
                    </p>
                  </div>
                </label>
              </div>

              {/* Live Example Layout Preview */}
              <div className="border border-crt-border bg-crt-surface/70 rounded p-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex items-center gap-1.5 text-crt-muted text-[10px] uppercase tracking-wider">
                  <FolderTree className="h-3 w-3 shrink-0" />
                  <span>Playlist Output Preview ({sampleM3uPath})</span>
                </div>
                <div className="text-crt-phosphor break-all">{sampleDiscLine1}</div>
                <div className="text-crt-phosphor/85 break-all">{sampleDiscLine2}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
