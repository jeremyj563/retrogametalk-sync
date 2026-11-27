import { useEffect, useRef } from 'react';
import {
  Check,
  ChevronDown,
  Minus,
  Pause,
  Plus,
  RefreshCw,
  Star,
} from 'lucide-react';
import {
  formatRatingFilterButtonLabel,
  formatUserRating,
  MAX_USER_RATING_FILTER,
  MIN_USER_RATING_FILTER,
  normalizeMinRatingFilter,
  RATING_PRESET_THRESHOLDS,
  type CatalogRatingFilterMode,
} from '../shared/catalogRating';
import type { CatalogFacetCounts, RatingsSyncStatus } from '../types';

interface RatingFilterDropdownProps {
  minRating: number | null;
  ratingMode: CatalogRatingFilterMode;
  counts?: CatalogFacetCounts['ratings'];
  ratingsSync?: RatingsSyncStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: { minRating: number | null; ratingMode: CatalogRatingFilterMode }) => void;
  onStartRatingsSync?: (scope?: 'filtered' | 'full') => Promise<void>;
  onStopRatingsSync?: () => Promise<void>;
  syncBusy?: boolean;
}

export function RatingFilterDropdown({
  minRating,
  ratingMode,
  counts,
  ratingsSync,
  open,
  onOpenChange,
  onChange,
  onStartRatingsSync,
  onStopRatingsSync,
  syncBusy = false,
}: RatingFilterDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  const isActive = ratingMode !== 'all' || minRating !== null;
  const buttonLabel = formatRatingFilterButtonLabel(minRating, ratingMode);
  const sliderValue = minRating ?? 4.0;
  const isSyncing = Boolean(ratingsSync?.active);

  const presetCountFor = (threshold: number): number | undefined => {
    if (!counts) return undefined;
    if (threshold === 4.8) return counts.atLeast48;
    if (threshold === 4.5) return counts.atLeast45;
    if (threshold === 4.0) return counts.atLeast40;
    if (threshold === 3.5) return counts.atLeast35;
    if (threshold === 3.0) return counts.atLeast30;
    return undefined;
  };

  const stepThreshold = (delta: number) => {
    const base = minRating ?? 4.0;
    const next = normalizeMinRatingFilter(
      Math.min(MAX_USER_RATING_FILTER, Math.max(MIN_USER_RATING_FILTER, Math.round((base + delta) * 10) / 10)),
    );
    if (next !== null) {
      onChange({ minRating: next, ratingMode: 'all' });
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        title={
          isActive
            ? `Filtering by Users Score (${buttonLabel}) — click to adjust or clear`
            : 'Filter by RetroGameTalk Users Score (0.5–5.0 stars, down to the tenth)'
        }
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          isActive
            ? 'bg-crt-amber/15 text-crt-amber border-crt-amber/65 font-medium'
            : open
              ? 'bg-crt-elevated text-crt-text border-crt-border-strong'
              : 'bg-crt-bg text-crt-muted border-crt-border hover:border-crt-border-strong hover:text-crt-text'
        }`}
      >
        <Star
          className={`h-3.5 w-3.5 shrink-0 ${
            isActive ? 'text-crt-amber fill-crt-amber' : 'text-crt-amber/80'
          }`}
        />
        <span>{isActive ? buttonLabel : 'Score'}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter by Users Score"
          className="absolute left-0 top-full mt-1.5 z-40 w-72 rounded-md border border-crt-border-strong bg-crt-surface shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-crt-border bg-crt-bg flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-crt-text">
              <Star className="h-3.5 w-3.5 text-crt-amber fill-crt-amber shrink-0" />
              <span>Users Score</span>
            </div>
            {isActive && (
              <button
                type="button"
                onClick={() => onChange({ minRating: null, ratingMode: 'all' })}
                className="text-[11px] font-mono text-crt-muted hover:text-crt-amber hover:underline cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>

          {/* Quick Presets */}
          <div className="p-1.5 space-y-0.5 border-b border-crt-border">
            <button
              type="button"
              onClick={() => onChange({ minRating: null, ratingMode: 'all' })}
              className={`w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                !isActive
                  ? 'bg-crt-phosphor/12 text-crt-phosphor font-medium'
                  : 'text-crt-text hover:bg-crt-elevated'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {!isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5" />}
                <span>All Scores</span>
              </span>
              {counts && (
                <span className="font-mono text-[11px] tabular-nums text-crt-muted">
                  {counts.total.toLocaleString()}
                </span>
              )}
            </button>

            {RATING_PRESET_THRESHOLDS.map((threshold) => {
              const selected = ratingMode === 'all' && minRating === threshold;
              const cnt = presetCountFor(threshold);
              return (
                <button
                  key={threshold}
                  type="button"
                  onClick={() => onChange({ minRating: threshold, ratingMode: 'all' })}
                  className={`w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-crt-amber/15 text-crt-amber font-medium'
                      : 'text-crt-text hover:bg-crt-elevated'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    {selected ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <span className="w-3.5" />
                    )}
                    <span>≥ {formatUserRating(threshold)} ★</span>
                  </span>
                  {cnt !== undefined && (
                    <span className="font-mono text-[11px] tabular-nums text-crt-muted">
                      {cnt.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-1 border-t border-crt-border/70" />

            <button
              type="button"
              onClick={() => onChange({ minRating: null, ratingMode: 'rated' })}
              className={`w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                ratingMode === 'rated' && minRating === null
                  ? 'bg-crt-amber/15 text-crt-amber font-medium'
                  : 'text-crt-text hover:bg-crt-elevated'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {ratingMode === 'rated' && minRating === null ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <span className="w-3.5" />
                )}
                <span>Any Rated</span>
              </span>
              {counts && (
                <span className="font-mono text-[11px] tabular-nums text-crt-muted">
                  {counts.rated.toLocaleString()}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onChange({ minRating: null, ratingMode: 'unrated' })}
              className={`w-full px-2.5 py-1.5 text-xs rounded flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                ratingMode === 'unrated'
                  ? 'bg-crt-elevated text-crt-text font-medium'
                  : 'text-crt-muted hover:bg-crt-elevated hover:text-crt-text'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {ratingMode === 'unrated' ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <span className="w-3.5" />
                )}
                <span>Unrated Only</span>
              </span>
              {counts && (
                <span className="font-mono text-[11px] tabular-nums text-crt-muted">
                  {counts.unrated.toLocaleString()}
                </span>
              )}
            </button>
          </div>

          {/* Fine-grained Tenth-of-a-Star Slider */}
          <div className="px-3 py-2.5 space-y-2 border-b border-crt-border bg-crt-bg/50">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              <span className="text-crt-muted">Minimum (0.1 steps)</span>
              <span
                className={
                  minRating !== null
                    ? 'text-crt-amber font-semibold tabular-nums'
                    : 'text-crt-muted tabular-nums'
                }
              >
                {minRating !== null ? `≥ ${formatUserRating(minRating)} ★` : 'Off'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease minimum score by 0.1"
                onClick={() => stepThreshold(-0.1)}
                disabled={minRating !== null && minRating <= MIN_USER_RATING_FILTER}
                className="p-1 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-40 cursor-pointer"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="range"
                aria-label="Minimum Users Score"
                min={MIN_USER_RATING_FILTER}
                max={MAX_USER_RATING_FILTER}
                step={0.1}
                value={sliderValue}
                onChange={(e) => {
                  const next = normalizeMinRatingFilter(e.target.value);
                  if (next !== null) {
                    onChange({ minRating: next, ratingMode: 'all' });
                  }
                }}
                className="flex-1 accent-crt-amber cursor-pointer"
              />
              <button
                type="button"
                aria-label="Increase minimum score by 0.1"
                onClick={() => stepThreshold(0.1)}
                disabled={minRating !== null && minRating >= MAX_USER_RATING_FILTER}
                className="p-1 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Ratings Sync Footer */}
          <div className="px-3 py-2 bg-crt-bg flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-crt-muted tabular-nums truncate">
              {isSyncing && ratingsSync
                ? `Syncing ${ratingsSync.currentSystem || ''} (${ratingsSync.ratedCount.toLocaleString()} rated)`
                : counts
                  ? `${counts.rated.toLocaleString()} / ${counts.total.toLocaleString()} rated`
                  : 'Sync from RGT'}
            </span>
            {isSyncing && onStopRatingsSync ? (
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void onStopRatingsSync()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-amber/55 text-crt-amber hover:bg-crt-amber/10 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Pause className="h-3 w-3" />
                Pause
              </button>
            ) : onStartRatingsSync ? (
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void onStartRatingsSync('filtered')}
                title="Fetch latest Users Scores from RetroGameTalk for cataloged consoles"
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-amber/55 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/18 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${syncBusy ? 'animate-spin' : ''}`} />
                Sync Scores
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
