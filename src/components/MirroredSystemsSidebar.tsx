import { useMemo, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { resolveBaseSystemFolder } from '../shared/storageFolderMappings';
import { resolveSystemDisplayInfo } from '../shared/systemCatalog';
import type { StorageFolderMappingConfig, SystemBreakdown } from '../types';
import { formatBytes, formatDateTime } from '../utils/format';

interface MirroredSystemsSidebarProps {
  systems: SystemBreakdown[];
  totalBytesOnDisk: number;
  storageFolderConfig?: StorageFolderMappingConfig | null;
}

export function MirroredSystemsSidebar({
  systems,
  totalBytesOnDisk,
  storageFolderConfig,
}: MirroredSystemsSidebarProps) {
  const [activeSystemName, setActiveSystemName] = useState<string | null>(null);

  const totalSystemsBytes = useMemo(() => {
    const sum = systems.reduce((acc, s) => acc + Math.max(0, s.totalBytes), 0);
    return Math.max(totalBytesOnDisk, sum);
  }, [systems, totalBytesOnDisk]);

  const activeSystem = useMemo(
    () =>
      activeSystemName
        ? systems.find((s) => s.systemName === activeSystemName) ?? null
        : null,
    [systems, activeSystemName],
  );

  const tooltipMeta = useMemo(() => {
    if (!activeSystem) return null;
    const displayInfo = resolveSystemDisplayInfo(activeSystem.systemName);
    const mirroredCount = activeSystem.downloadedItems + activeSystem.skippedItems;
    const completionPct =
      activeSystem.totalItems > 0
        ? Math.min(100, Math.round((mirroredCount / activeSystem.totalItems) * 100))
        : 0;
    const shareRatio =
      totalSystemsBytes > 0 && activeSystem.totalBytes > 0
        ? Math.min(1, activeSystem.totalBytes / totalSystemsBytes)
        : 0;
    const sharePermille = Math.round(shareRatio * 1000);
    const sharePercentValue = shareRatio * 100;
    const shareLabel =
      activeSystem.totalBytes <= 0
        ? '0%'
        : sharePercentValue > 0 && sharePercentValue < 0.1
          ? '<0.1%'
          : sharePercentValue < 10
            ? `${sharePercentValue.toFixed(1)}%`
            : `${Math.round(sharePercentValue)}%`;
    const avgReleaseBytes =
      mirroredCount > 0 && activeSystem.totalBytes > 0
        ? Math.round(activeSystem.totalBytes / mirroredCount)
        : null;
    const targetFolder = resolveBaseSystemFolder(activeSystem.systemName, storageFolderConfig);

    return {
      displayInfo,
      mirroredCount,
      completionPct,
      sharePermille,
      shareLabel,
      avgReleaseBytes,
      targetFolder,
    };
  }, [activeSystem, totalSystemsBytes, storageFolderConfig]);

  if (systems.length === 0) return null;

  return (
    <div
      className="relative hidden lg:block border-t border-crt-border pt-4 space-y-2"
      onMouseLeave={() => setActiveSystemName(null)}
    >
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-crt-muted">
        <span className="inline-flex items-center gap-2 min-w-0">
          <HardDrive className="h-3.5 w-3.5 crt-drive-activity shrink-0" />
          <span className="truncate">Mirrored Systems</span>
        </span>
        <span className="font-mono text-[11px] text-crt-muted/80 tabular-nums shrink-0">
          {systems.length}
        </span>
      </div>

      <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
        {systems.map((sys) => {
          const isHovered = activeSystemName === sys.systemName;
          return (
            <div
              key={sys.systemName}
              tabIndex={0}
              aria-describedby={isHovered ? 'mirrored-system-tooltip' : undefined}
              onMouseEnter={() => setActiveSystemName(sys.systemName)}
              onFocus={() => setActiveSystemName(sys.systemName)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setActiveSystemName((prev) => (prev === sys.systemName ? null : prev));
                }
              }}
              className={`flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border text-xs font-mono transition-colors cursor-default focus-visible:outline-none ${
                isHovered
                  ? 'border-crt-border-strong bg-crt-elevated/85 text-crt-phosphor'
                  : 'border-transparent text-crt-text hover:bg-crt-elevated/55'
              }`}
            >
              <span className="truncate min-w-0">{sys.systemName}</span>
              <span className="flex items-center gap-1.5 text-[11px] tabular-nums whitespace-nowrap shrink-0">
                <span className={sys.totalBytes > 0 ? 'text-crt-phosphor/90' : 'text-crt-muted/70'}>
                  {formatBytes(sys.totalBytes)}
                </span>
                <span aria-hidden="true" className="text-crt-muted/45">
                  ·
                </span>
                <span className="text-crt-muted min-w-[2ch] text-right">{sys.totalItems}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Detailed Per-System CRT Telemetry Popover Tooltip */}
      {activeSystem && tooltipMeta && (
        <div
          id="mirrored-system-tooltip"
          role="tooltip"
          className="pointer-events-none absolute left-full top-0 ml-3 z-40 w-72 rounded-md border border-crt-border-strong bg-crt-surface/98 p-3.5 shadow-2xl backdrop-blur-md"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>

          <div className="space-y-0.5 min-w-0">
            <div className="font-display text-sm font-semibold text-crt-text leading-snug truncate">
              {tooltipMeta.displayInfo.displayName}
            </div>
            <div className="text-[11px] font-mono text-crt-muted truncate">
              <span>{tooltipMeta.displayInfo.brandLabel}</span>
              <span aria-hidden="true"> · </span>
              <span>{activeSystem.systemName}</span>
            </div>
          </div>

          {/* Disk Footprint & Share of Archive */}
          <div className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
              <span className="text-crt-muted">Disk Footprint</span>
              <span className="text-crt-phosphor font-semibold">
                {formatBytes(activeSystem.totalBytes)} · {tooltipMeta.shareLabel}
              </span>
            </div>
            <progress
              max={1000}
              value={activeSystem.totalBytes > 0 ? Math.max(24, tooltipMeta.sharePermille) : 0}
              aria-label={`Disk share for ${activeSystem.systemName}`}
              className="block h-1.5 w-full overflow-hidden rounded-xs bg-crt-bg border border-crt-border [&::-webkit-progress-bar]:bg-crt-bg [&::-webkit-progress-value]:bg-crt-phosphor [&::-moz-progress-bar]:bg-crt-phosphor"
            />
          </div>

          {/* Detailed Telemetry Breakdown */}
          <dl className="mt-2.5 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted">Mirrored Releases</dt>
              <dd className="text-crt-text text-right whitespace-nowrap">
                {tooltipMeta.mirroredCount.toLocaleString()} /{' '}
                {activeSystem.totalItems.toLocaleString()} ({tooltipMeta.completionPct}%)
              </dd>
            </div>

            {(activeSystem.queuedItems > 0 || activeSystem.failedItems > 0) && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-crt-muted">Queue / Alerts</dt>
                <dd className="text-right whitespace-nowrap">
                  {activeSystem.queuedItems > 0 && (
                    <span className="text-crt-amber">
                      {activeSystem.queuedItems.toLocaleString()} active
                    </span>
                  )}
                  {activeSystem.queuedItems > 0 && activeSystem.failedItems > 0 && (
                    <span aria-hidden="true" className="text-crt-muted">
                      {' · '}
                    </span>
                  )}
                  {activeSystem.failedItems > 0 && (
                    <span className="text-crt-crimson">
                      {activeSystem.failedItems.toLocaleString()} failed
                    </span>
                  )}
                </dd>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted">Archive Files</dt>
              <dd className="text-crt-text text-right whitespace-nowrap">
                {activeSystem.mirroredFiles.toLocaleString()}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted">Avg / Release</dt>
              <dd className="text-crt-text text-right whitespace-nowrap">
                {tooltipMeta.avgReleaseBytes !== null
                  ? formatBytes(tooltipMeta.avgReleaseBytes)
                  : '—'}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted">Installed to Device</dt>
              <dd className="text-crt-text text-right whitespace-nowrap">
                {activeSystem.installedItems.toLocaleString()} /{' '}
                {tooltipMeta.mirroredCount.toLocaleString()}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted shrink-0">Device Folder</dt>
              <dd className="text-crt-phosphor/90 text-right truncate">
                /{tooltipMeta.targetFolder}/
              </dd>
            </div>

            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted shrink-0">Last Activity</dt>
              <dd className="text-crt-muted text-right truncate">
                {activeSystem.lastActivityAt ? formatDateTime(activeSystem.lastActivityAt) : '—'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
