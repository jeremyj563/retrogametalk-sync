import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import * as d3 from 'd3';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Database,
  HardDrive,
  Layers,
  PieChart as PieChartIcon,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import type {
  CatalogGrowthPoint,
  CatalogStatsSnapshot,
  CompositionStat,
  DownloadTrendDailyPoint,
  DownloadTrendRunPoint,
  ServiceStatusSnapshot,
  SystemCoverageStat,
} from '../types';
import {
  evaluateDiskSpaceGuardrail,
  formatReserveGbLabel,
} from '../shared/diskGuardrails';
import { resolveSystemDisplayInfo } from '../shared/systemCatalog';
import { formatBytes, formatDateTime, formatDurationMs } from '../utils/format';

interface CatalogStatsPanelProps {
  status: ServiceStatusSnapshot;
  catalogRevision: number;
  minFreeDiskGb?: number;
  onInspectSystem: (systemSlug: string) => void;
  onReclaimSpace?: () => void;
  onStartCatalogIndex?: (
    scope: 'filtered' | 'full',
    options?: { forceFull?: boolean },
  ) => Promise<void>;
}

type GrowthRange = '14d' | '30d' | '90d' | 'all';
type GrowthMetric = 'items' | 'bytes';
type TrendMode = 'daily' | 'runs';
type CoverageSortKey = 'coverage_desc' | 'total_desc' | 'bytes_desc' | 'remaining_desc';
type CompositionDimension = 'tags' | 'regions' | 'languages' | 'sources';

const DONUT_PALETTE = [
  'var(--color-crt-phosphor)',
  'var(--color-crt-amber)',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#fb7185',
  'var(--color-crt-muted)',
];

function parseIsoDayUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y || 1970, Math.max(0, (m || 1) - 1), d || 1));
}

function formatDayShort(day: string): string {
  const dt = parseIsoDayUtc(day);
  return d3.utcFormat('%b %d')(dt);
}

function formatDayFull(day: string): string {
  const dt = parseIsoDayUtc(day);
  return d3.utcFormat('%b %d, %Y')(dt);
}

function formatRateMbps(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0.0 MB/s';
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps >= 10) return `${mbps.toFixed(1)} MB/s`;
  if (mbps >= 0.1) return `${mbps.toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

interface HydratedGrowthPoint extends CatalogGrowthPoint {
  dateObj: Date;
}

function buildWindowedGrowthSeries(
  raw: CatalogGrowthPoint[],
  range: GrowthRange,
): HydratedGrowthPoint[] {
  if (raw.length === 0) return [];

  const parsed = raw
    .map((pt) => ({ ...pt, dateObj: parseIsoDayUtc(pt.date) }))
    .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

  // Fill calendar gaps between first and last recorded day (up to 365 days) for smooth time continuity
  const byDay = new Map<string, HydratedGrowthPoint>();
  for (const pt of parsed) {
    byDay.set(pt.date, pt);
  }

  const first = parsed[0]!.dateObj;
  const last = parsed[parsed.length - 1]!.dateObj;
  const todayUtc = new Date();
  const endUtc = new Date(
    Date.UTC(
      Math.max(last.getUTCFullYear(), todayUtc.getUTCFullYear()),
      last.getTime() > todayUtc.getTime() ? last.getUTCMonth() : todayUtc.getUTCMonth(),
      last.getTime() > todayUtc.getTime() ? last.getUTCDate() : todayUtc.getUTCDate(),
    ),
  );

  const rangeDays = range === '14d' ? 14 : range === '30d' ? 30 : range === '90d' ? 90 : null;
  const maxSpanDays = 365;
  const spanDays = Math.round((endUtc.getTime() - first.getTime()) / 86_400_000);

  let startUtc = first;
  if (rangeDays !== null) {
    const windowStart = new Date(endUtc.getTime() - (rangeDays - 1) * 86_400_000);
    if (windowStart.getTime() > first.getTime()) {
      startUtc = windowStart;
    }
  } else if (spanDays > maxSpanDays) {
    startUtc = new Date(endUtc.getTime() - maxSpanDays * 86_400_000);
  }

  // Seed baseline cumulative counters before startUtc
  let cumIndexed = 0;
  let cumDownloaded = 0;
  let cumBytes = 0;
  for (const pt of parsed) {
    if (pt.dateObj.getTime() < startUtc.getTime()) {
      cumIndexed = pt.cumulativeIndexed;
      cumDownloaded = pt.cumulativeDownloaded;
      cumBytes = pt.cumulativeBytes;
    } else {
      break;
    }
  }

  const filled: HydratedGrowthPoint[] = [];
  const totalDays = Math.min(maxSpanDays, Math.max(0, Math.round((endUtc.getTime() - startUtc.getTime()) / 86_400_000)));
  const fmt = d3.utcFormat('%Y-%m-%d');

  for (let i = 0; i <= totalDays; i++) {
    const dt = new Date(startUtc.getTime() + i * 86_400_000);
    const key = fmt(dt);
    const hit = byDay.get(key);
    if (hit) {
      cumIndexed = hit.cumulativeIndexed;
      cumDownloaded = hit.cumulativeDownloaded;
      cumBytes = hit.cumulativeBytes;
      filled.push(hit);
    } else {
      filled.push({
        date: key,
        dateObj: dt,
        indexedAdded: 0,
        downloadedAdded: 0,
        bytesAdded: 0,
        cumulativeIndexed: cumIndexed,
        cumulativeDownloaded: cumDownloaded,
        cumulativeBytes: cumBytes,
      });
    }
  }

  return filled;
}

interface HydratedDailyTrend extends DownloadTrendDailyPoint {
  dateObj: Date;
  movingAvgFiles: number;
  movingAvgBytes: number;
}

function buildDailyTrendSeries(raw: DownloadTrendDailyPoint[], limitDays = 30): HydratedDailyTrend[] {
  if (raw.length === 0) return [];
  const byDay = new Map<string, DownloadTrendDailyPoint>();
  for (const r of raw) {
    byDay.set(r.date, r);
  }

  const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date));
  const first = parseIsoDayUtc(sorted[0]!.date);
  const last = parseIsoDayUtc(sorted[sorted.length - 1]!.date);
  const now = new Date();
  const endUtc = new Date(
    Date.UTC(
      Math.max(last.getUTCFullYear(), now.getUTCFullYear()),
      last.getTime() > now.getTime() ? last.getUTCMonth() : now.getUTCMonth(),
      last.getTime() > now.getTime() ? last.getUTCDate() : now.getUTCDate(),
    ),
  );
  const windowStart = new Date(endUtc.getTime() - (limitDays - 1) * 86_400_000);
  const startUtc = first.getTime() > windowStart.getTime() ? first : windowStart;
  const totalDays = Math.min(90, Math.max(0, Math.round((endUtc.getTime() - startUtc.getTime()) / 86_400_000)));
  const fmt = d3.utcFormat('%Y-%m-%d');

  const points: HydratedDailyTrend[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const dt = new Date(startUtc.getTime() + i * 86_400_000);
    const key = fmt(dt);
    const hit = byDay.get(key);
    points.push({
      date: key,
      dateObj: dt,
      filesDownloaded: hit?.filesDownloaded ?? 0,
      bytesDownloaded: hit?.bytesDownloaded ?? 0,
      failedItems: hit?.failedItems ?? 0,
      movingAvgFiles: 0,
      movingAvgBytes: 0,
    });
  }

  // 7-day rolling mean
  for (let i = 0; i < points.length; i++) {
    const winStart = Math.max(0, i - 6);
    const slice = points.slice(winStart, i + 1);
    const n = slice.length;
    points[i]!.movingAvgFiles = slice.reduce((a, b) => a + b.filesDownloaded, 0) / n;
    points[i]!.movingAvgBytes = slice.reduce((a, b) => a + b.bytesDownloaded, 0) / n;
  }

  return points;
}

export function CatalogStatsPanel({
  status,
  catalogRevision,
  minFreeDiskGb = 2,
  onInspectSystem,
  onReclaimSpace,
  onStartCatalogIndex,
}: CatalogStatsPanelProps) {
  const [stats, setStats] = useState<CatalogStatsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [growthRange, setGrowthRange] = useState<GrowthRange>('30d');
  const [growthMetric, setGrowthMetric] = useState<GrowthMetric>('items');
  const [trendMode, setTrendMode] = useState<TrendMode>('daily');
  const [trendDailyMetric, setTrendDailyMetric] = useState<'bytes' | 'files'>('bytes');
  const [coverageSort, setCoverageSort] = useState<CoverageSortKey>('coverage_desc');
  const [compositionDim, setCompositionDim] = useState<CompositionDimension>('tags');

  // Interactive hover states across D3 charts
  const [growthHover, setGrowthHover] = useState<{ index: number; side: 'left' | 'right' } | null>(
    null,
  );
  const [trendHover, setTrendHover] = useState<{ index: number; side: 'left' | 'right' } | null>(
    null,
  );
  const [coverageHoverSlug, setCoverageHoverSlug] = useState<string | null>(null);
  const [compositionHoverLabel, setCompositionHoverLabel] = useState<string | null>(null);
  const [sizeHoverKey, setSizeHoverKey] = useState<{ key: string; side: 'left' | 'right' } | null>(
    null,
  );

  const gradIndexedId = useId().replace(/:/g, '');
  const gradMirroredId = useId().replace(/:/g, '');

  const fetchStats = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await fetch('/api/catalog/stats');
      if (!res.ok) {
        throw new Error(`Stats request failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as CatalogStatsSnapshot;
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(Boolean(stats));
  }, [fetchStats, catalogRevision]);

  // Subtle periodic refresh while a sync run or catalog indexer is active
  const isPipelineActive = Boolean(status.activeRun) || Boolean(status.indexer?.active);
  useEffect(() => {
    if (!isPipelineActive) return;
    const timer = setInterval(() => {
      void fetchStats(true);
    }, 6000);
    return () => clearInterval(timer);
  }, [isPipelineActive, fetchStats]);

  // Derived data series
  const growthSeries = useMemo(
    () => (stats ? buildWindowedGrowthSeries(stats.growthTimeline, growthRange) : []),
    [stats, growthRange],
  );

  const dailyTrends = useMemo(
    () => (stats ? buildDailyTrendSeries(stats.downloadTrends.daily, 30) : []),
    [stats],
  );

  const runTrends = useMemo(
    () => (stats ? stats.downloadTrends.runs : []),
    [stats],
  );

  const sortedCoverage = useMemo(() => {
    if (!stats) return [];
    const list = stats.systemCoverage.filter((s) => s.totalItems > 0 || s.totalPages > 0);
    return [...list].sort((a, b) => {
      const covA = a.totalItems > 0 ? a.downloadedItems / a.totalItems : 0;
      const covB = b.totalItems > 0 ? b.downloadedItems / b.totalItems : 0;
      if (coverageSort === 'coverage_desc') {
        return covB - covA || b.downloadedItems - a.downloadedItems || b.totalItems - a.totalItems;
      }
      if (coverageSort === 'bytes_desc') {
        return b.mirroredBytes - a.mirroredBytes || b.downloadedItems - a.downloadedItems;
      }
      if (coverageSort === 'remaining_desc') {
        return b.estimatedAvailableBytes - a.estimatedAvailableBytes || b.availableItems - a.availableItems;
      }
      return b.totalItems - a.totalItems || b.downloadedItems - a.downloadedItems;
    });
  }, [stats, coverageSort]);

  const activeCompositionRows = useMemo(() => {
    if (!stats) return [];
    const raw = stats.releaseComposition[compositionDim] || [];
    if (raw.length <= 6) return raw;
    const head = raw.slice(0, 6);
    const tail = raw.slice(6);
    const other: CompositionStat = {
      label: `Other (${tail.length})`,
      totalCount: tail.reduce((acc, item) => acc + item.totalCount, 0),
      downloadedCount: tail.reduce((acc, item) => acc + item.downloadedCount, 0),
      mirroredBytes: tail.reduce((acc, item) => acc + item.mirroredBytes, 0),
    };
    return [...head, other];
  }, [stats, compositionDim]);

  if (loading && !stats) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 border border-crt-border bg-crt-surface rounded-md divide-y lg:divide-y-0 lg:divide-x divide-crt-border">
          {[0, 1, 2, 3].map((idx) => (
            <div key={idx} className="p-4 space-y-2">
              <div className="h-3 w-24 bg-crt-bg rounded animate-pulse" />
              <div className="h-7 w-32 bg-crt-bg rounded animate-pulse" />
              <div className="h-3 w-36 bg-crt-bg rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-6 h-[320px] border border-crt-border bg-crt-surface rounded-md animate-pulse" />
          <div className="xl:col-span-6 h-[320px] border border-crt-border bg-crt-surface rounded-md animate-pulse" />
        </div>
        <div className="h-[300px] border border-crt-border bg-crt-surface rounded-md animate-pulse" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="relative crt-panel-living border border-crt-crimson/60 bg-crt-surface rounded-md p-8 text-center space-y-3">
        <Activity className="h-6 w-6 text-crt-crimson mx-auto" />
        <h3 className="font-display text-base font-semibold text-crt-text">
          Unable to load Repository Analytics
        </h3>
        <p className="text-xs font-mono text-crt-muted max-w-md mx-auto">{error}</p>
        <button
          type="button"
          onClick={() => void fetchStats(false)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry Telemetry Query
        </button>
      </div>
    );
  }

  if (!stats || stats.summary.totalCatalogItems === 0) {
    return (
      <div className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-10 text-center space-y-3">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <BarChart3 className="h-7 w-7 text-crt-muted mx-auto" />
        <h3 className="font-display text-base font-semibold text-crt-text">
          Catalog Telemetry Pending Discovery
        </h3>
        <p className="text-xs text-crt-muted max-w-md mx-auto leading-relaxed">
          Index consoles from the WordPress catalog or run a Sync pass to populate D3 repository growth curves, download velocity charts, and per-system coverage telemetry.
        </p>
        {onStartCatalogIndex && status.auth.hasCompletedLogin && (
          <div className="pt-1 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void onStartCatalogIndex('filtered')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/15 rounded transition-colors cursor-pointer"
            >
              <Database className="h-3.5 w-3.5" />
              Index Targeted Consoles
            </button>
          </div>
        )}
      </div>
    );
  }

  const { summary } = stats;
  const coveragePct =
    summary.totalCatalogItems > 0
      ? (summary.downloadedItems / summary.totalCatalogItems) * 100
      : 0;
  const totalEstimatedLibraryBytes = summary.mirroredBytes + summary.estimatedAvailableBytes;
  const installPct =
    summary.downloadedItems > 0
      ? (summary.installedItems / summary.downloadedItems) * 100
      : 0;

  const avgRunMbps = (() => {
    const valid = runTrends.filter((r) => r.avgBytesPerSec > 0);
    if (valid.length === 0) return 0;
    return valid.reduce((a, r) => a + r.avgBytesPerSec, 0) / valid.length;
  })();
  const peakRunMbps =
    runTrends.length > 0 ? Math.max(...runTrends.map((r) => r.avgBytesPerSec)) : 0;

  return (
    <div className="space-y-5">
      {/* KPI Telemetry Summary Strip */}
      <div className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md overflow-hidden">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <div className="px-4 py-2.5 border-b border-crt-border bg-crt-bg/50 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <div className="flex items-center gap-2 text-crt-muted">
            <BarChart3 className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
            <span className="text-crt-text font-medium">Catalog Telemetry &amp; D3 Analytics</span>
            <span className="hidden sm:inline text-crt-muted">
              · Updated {formatDateTime(stats.generatedAt)}
            </span>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void fetchStats(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin text-crt-phosphor' : ''}`} />
            <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-crt-border">
          <div className="p-4 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-crt-muted">
              Mirrored Coverage
            </p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold text-crt-phosphor tabular-nums">
                {coveragePct.toFixed(1)}%
              </span>
              <span className="font-mono text-xs text-crt-text tabular-nums">
                {summary.downloadedItems.toLocaleString()} / {summary.totalCatalogItems.toLocaleString()}
              </span>
            </div>
            <p className="text-[11px] font-mono text-crt-muted tabular-nums">
              {summary.availableItems.toLocaleString()} available ·{' '}
              {summary.queuedItems > 0 ? (
                <span className="text-sky-400">{summary.queuedItems} queued</span>
              ) : (
                <span>{summary.failedItems} attention</span>
              )}
            </p>
          </div>

          <div className="p-4 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-crt-muted">
              Archive Footprint
            </p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold text-crt-text tabular-nums">
                {formatBytes(summary.mirroredBytes)}
              </span>
              {summary.estimatedAvailableBytes > 0 && (
                <span className="font-mono text-xs text-crt-amber tabular-nums">
                  / ~{formatBytes(totalEstimatedLibraryBytes)}
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-crt-muted tabular-nums">
              ~{formatBytes(summary.estimatedAvailableBytes)} un-downloaded · avg{' '}
              {formatBytes(summary.avgMirroredFileBytes)}/file
            </p>
          </div>

          <div className="p-4 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-crt-muted">
              Acquisition Throughput
            </p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold text-crt-text tabular-nums">
                {avgRunMbps > 0 ? formatRateMbps(avgRunMbps) : '—'}
              </span>
              {peakRunMbps > 0 && (
                <span className="font-mono text-xs text-crt-phosphor tabular-nums">
                  peak {formatRateMbps(peakRunMbps)}
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-crt-muted tabular-nums">
              {runTrends.length} recent runs · {summary.systemsTracked} systems tracked
            </p>
          </div>

          <div className="p-4 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-crt-muted">
              Device Installed
            </p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold text-crt-text tabular-nums">
                {summary.installedItems.toLocaleString()}
              </span>
              <span className="font-mono text-xs text-crt-phosphor tabular-nums">
                {installPct.toFixed(1)}% of mirrored
              </span>
            </div>
            <p className="text-[11px] font-mono text-crt-muted tabular-nums">
              {formatBytes(summary.installedBytes)} deployed · {summary.fullyIndexedSystems}/
              {summary.systemsTracked} indexed
            </p>
          </div>
        </div>
      </div>

      {/* Primary D3 Time-Series Row: Repository Growth & Download Trends */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* CHART 1: REPOSITORY GROWTH (D3 Area + Dual-Line Time Series) */}
        <section className="relative crt-panel-living xl:col-span-6 border border-crt-border bg-crt-surface rounded-md p-5 flex flex-col justify-between gap-4">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold text-crt-text flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-crt-phosphor shrink-0" />
                <span>Repository Growth</span>
              </h3>
              <p className="text-xs text-crt-muted">
                {growthMetric === 'items'
                  ? 'Cumulative catalog indexed vs locally mirrored titles'
                  : 'Cumulative mirrored disk footprint expansion over time'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded">
                {(['items', 'bytes'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGrowthMetric(m)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                      growthMetric === m
                        ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                        : 'text-crt-muted hover:text-crt-text border border-transparent'
                    }`}
                  >
                    {m === 'items' ? 'Titles' : 'Storage'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded">
                {(['14d', '30d', '90d', 'all'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setGrowthRange(r)}
                    className={`px-2 py-0.5 text-[11px] font-mono uppercase rounded transition-colors cursor-pointer whitespace-nowrap ${
                      growthRange === r
                        ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                        : 'text-crt-muted hover:text-crt-text border border-transparent'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative h-[230px] border border-crt-border bg-crt-bg rounded p-2.5 overflow-hidden select-none">
            <div aria-hidden="true" className="crt-telemetry-raster" />
            {growthSeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-crt-muted">
                No growth timeline entries recorded yet.
              </div>
            ) : (
              <D3RepositoryGrowthSvg
                series={growthSeries}
                metric={growthMetric}
                gradIndexedId={gradIndexedId}
                gradMirroredId={gradMirroredId}
                hoverState={growthHover}
                onHoverChange={setGrowthHover}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-crt-border/80 text-[11px] font-mono tabular-nums text-crt-muted">
            <div className="flex items-center gap-4">
              {growthMetric === 'items' && (
                <span className="inline-flex items-center gap-1.5 text-crt-text">
                  <span
                    className="w-2.5 h-2 rounded-xs"
                    style={{ backgroundColor: 'var(--color-crt-amber)' }}
                  />
                  Indexed Total ({summary.totalCatalogItems.toLocaleString()})
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-crt-text">
                <span
                  className="w-2.5 h-2 rounded-xs"
                  style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
                />
                {growthMetric === 'items'
                  ? `Mirrored (${summary.downloadedItems.toLocaleString()})`
                  : `Mirrored Size (${formatBytes(summary.mirroredBytes)})`}
              </span>
            </div>
            <span>{growthSeries.length}d window</span>
          </div>
        </section>

        {/* CHART 2: DOWNLOAD TRENDS & RUN VELOCITY (D3 Bar + Trend Line) */}
        <section className="relative crt-panel-living xl:col-span-6 border border-crt-border bg-crt-surface rounded-md p-5 flex flex-col justify-between gap-4">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold text-crt-text flex items-center gap-2">
                <Activity className="h-4 w-4 text-crt-amber shrink-0" />
                <span>Download Trends</span>
              </h3>
              <p className="text-xs text-crt-muted">
                {trendMode === 'daily'
                  ? 'Daily acquisition volume with 7-day moving average & failure markers'
                  : 'Per-run saved/failed outcomes paired with average transfer throughput'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {trendMode === 'daily' && (
                <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded">
                  {(['bytes', 'files'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTrendDailyMetric(m)}
                      className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                        trendDailyMetric === m
                          ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                          : 'text-crt-muted hover:text-crt-text border border-transparent'
                      }`}
                    >
                      {m === 'bytes' ? 'Volume' : 'Files'}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded">
                {(['daily', 'runs'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setTrendHover(null);
                      setTrendMode(mode);
                    }}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                      trendMode === mode
                        ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                        : 'text-crt-muted hover:text-crt-text border border-transparent'
                    }`}
                  >
                    {mode === 'daily' ? 'Daily 30D' : `Runs (${runTrends.length})`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative h-[230px] border border-crt-border bg-crt-bg rounded p-2.5 overflow-hidden select-none">
            <div aria-hidden="true" className="crt-telemetry-raster" />
            {trendMode === 'daily' ? (
              dailyTrends.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-1 text-xs font-mono text-crt-muted">
                  <span>No file download activity recorded yet</span>
                  <span className="text-[11px]">
                    Queue titles or run a Sync to visualize daily acquisition throughput.
                  </span>
                </div>
              ) : (
                <D3DailyDownloadTrendsSvg
                  series={dailyTrends}
                  metric={trendDailyMetric}
                  hoverState={trendHover}
                  onHoverChange={setTrendHover}
                />
              )
            ) : runTrends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-crt-muted">
                No sync or download runs logged yet.
              </div>
            ) : (
              <D3RunVelocitySvg
                runs={runTrends}
                hoverState={trendHover}
                onHoverChange={setTrendHover}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-crt-border/80 text-[11px] font-mono tabular-nums text-crt-muted">
            {trendMode === 'daily' ? (
              <>
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-crt-text">
                    <span
                      className="w-2.5 h-2 rounded-xs"
                      style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
                    />
                    {trendDailyMetric === 'bytes' ? 'Daily Bytes' : 'Daily Files'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-crt-text">
                    <span
                      className="w-2.5 h-0.5"
                      style={{ backgroundColor: 'var(--color-crt-amber)' }}
                    />
                    7d Moving Avg
                  </span>
                </div>
                <span>
                  Window total:{' '}
                  <span className="text-crt-text">
                    {formatBytes(dailyTrends.reduce((a, d) => a + d.bytesDownloaded, 0))}
                  </span>
                </span>
              </>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-crt-text">
                    <span
                      className="w-2.5 h-2 rounded-xs"
                      style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
                    />
                    Saved
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-crt-text">
                    <span
                      className="w-2.5 h-2 rounded-xs"
                      style={{ backgroundColor: 'var(--color-crt-crimson)' }}
                    />
                    Failed
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-crt-text">
                    <span
                      className="w-2.5 h-0.5"
                      style={{ backgroundColor: 'var(--color-crt-amber)' }}
                    />
                    Avg Speed
                  </span>
                </div>
                <span>Latest {runTrends.length} runs</span>
              </>
            )}
          </div>
        </section>
      </div>

      {/* System-Specific Library Coverage Matrix (D3 Stacked Bars + Click-to-Filter) */}
      <section className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-5 space-y-4">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-crt-text flex items-center gap-2">
              <Layers className="h-4 w-4 text-crt-phosphor shrink-0" />
              <span>System-Specific Library Coverage</span>
            </h3>
            <p className="text-xs text-crt-muted">
              Per-console mirrored vs indexed completion, handheld install share, and estimated remaining archive size. Click any row to open that console in Catalog.
            </p>
          </div>

          <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded">
            {(
              [
                ['coverage_desc', 'Coverage %'],
                ['total_desc', 'Total Indexed'],
                ['bytes_desc', 'Mirrored Size'],
                ['remaining_desc', 'Est. Remaining'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCoverageSort(key)}
                className={`px-2 py-1 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                  coverageSort === key
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <D3SystemCoverageChart
          systems={sortedCoverage}
          hoveredSlug={coverageHoverSlug}
          onHoverSlug={setCoverageHoverSlug}
          onSelectSystem={onInspectSystem}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-crt-border/80 text-[11px] font-mono text-crt-muted">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-crt-text">
              <span
                className="w-2.5 h-2 rounded-xs"
                style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
              />
              Downloaded
            </span>
            <span className="inline-flex items-center gap-1.5 text-crt-text">
              <span className="w-2.5 h-2 rounded-xs bg-sky-400" />
              Queued / Active
            </span>
            <span className="inline-flex items-center gap-1.5 text-crt-text">
              <span
                className="w-2.5 h-2 rounded-xs"
                style={{ backgroundColor: 'var(--color-crt-border-strong)' }}
              />
              Available
            </span>
            <span className="inline-flex items-center gap-1.5 text-crt-text">
              <span
                className="w-2.5 h-2 rounded-xs"
                style={{ backgroundColor: 'var(--color-crt-crimson)' }}
              />
              Failed / Partial
            </span>
          </div>
          <span>Click any console to filter Catalog</span>
        </div>
      </section>

      {/* Bottom Additional Telemetry Row: Release Composition Donut & Size Distribution / Storage Forecast */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* ADDITIONAL TELEMETRY A: RELEASE COMPOSITION (D3 Pie / Donut) */}
        <section className="relative crt-panel-living xl:col-span-6 border border-crt-border bg-crt-surface rounded-md p-5 flex flex-col justify-between gap-4">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold text-crt-text flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-crt-phosphor shrink-0" />
                <span>Release Composition</span>
              </h3>
              <p className="text-xs text-crt-muted">
                Catalog taxonomy across ROM types, regional dumps, languages &amp; preservation sources
              </p>
            </div>

            <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded">
              {(
                [
                  ['tags', 'ROM Types'],
                  ['regions', 'Regions'],
                  ['languages', 'Languages'],
                  ['sources', 'Sources'],
                ] as const
              ).map(([dim, label]) => (
                <button
                  key={dim}
                  type="button"
                  onClick={() => {
                    setCompositionHoverLabel(null);
                    setCompositionDim(dim);
                  }}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${
                    compositionDim === dim
                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {activeCompositionRows.length === 0 ? (
            <div className="h-[220px] border border-crt-border bg-crt-bg rounded flex items-center justify-center text-xs font-mono text-crt-muted">
              No {compositionDim} metadata indexed yet.
            </div>
          ) : (
            <D3CompositionDonut
              rows={activeCompositionRows}
              hoveredLabel={compositionHoverLabel}
              onHoverLabel={setCompositionHoverLabel}
            />
          )}
        </section>

        {/* ADDITIONAL TELEMETRY B: ARCHIVE SIZE DISTRIBUTION & STORAGE FORECAST */}
        <section className="relative crt-panel-living xl:col-span-6 border border-crt-border bg-crt-surface rounded-md p-5 flex flex-col justify-between gap-4">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold text-crt-text flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-crt-amber shrink-0" />
                <span>Archive Size Profile &amp; Storage Forecast</span>
              </h3>
              <p className="text-xs text-crt-muted">
                File-size histogram comparing mirrored vs un-downloaded releases alongside host disk headroom
              </p>
            </div>
          </div>

          <div className="relative h-[196px] border border-crt-border bg-crt-bg rounded p-2.5 overflow-hidden select-none">
            <div aria-hidden="true" className="crt-telemetry-raster" />
            <D3SizeHistogramSvg
              buckets={stats.sizeDistribution}
              hoverState={sizeHoverKey}
              onHoverChange={setSizeHoverKey}
            />
          </div>

          <StorageCapacityForecast
            mirroredBytes={summary.mirroredBytes}
            estimatedRemainingBytes={summary.estimatedAvailableBytes}
            diskFreeBytes={status.storage.diskFreeBytes}
            diskTotalBytes={status.storage.diskTotalBytes}
            minFreeDiskGb={minFreeDiskGb}
            onReclaimSpace={onReclaimSpace}
          />
        </section>
      </div>
    </div>
  );
}

/* ============================================================================
   D3 Sub-Charts (SVG rendered declaratively from D3 scales, generators & stacks)
   ============================================================================ */

function D3RepositoryGrowthSvg({
  series,
  metric,
  gradIndexedId,
  gradMirroredId,
  hoverState,
  onHoverChange,
}: {
  series: HydratedGrowthPoint[];
  metric: GrowthMetric;
  gradIndexedId: string;
  gradMirroredId: string;
  hoverState: { index: number; side: 'left' | 'right' } | null;
  onHoverChange: (next: { index: number; side: 'left' | 'right' } | null) => void;
}) {
  const W = 540;
  const H = 200;
  const padL = 52;
  const padR = 14;
  const padT = 14;
  const padB = 24;

  const xScale = useMemo(() => {
    const minDate = series[0]!.dateObj;
    const maxDate = series[series.length - 1]!.dateObj;
    // Pad domain slightly if single-day dataset
    const endDate =
      minDate.getTime() === maxDate.getTime()
        ? new Date(maxDate.getTime() + 86_400_000)
        : maxDate;
    return d3.scaleUtc().domain([minDate, endDate]).range([padL, W - padR]);
  }, [series]);

  const maxY = useMemo(() => {
    if (metric === 'items') {
      return Math.max(4, d3.max(series, (d) => Math.max(d.cumulativeIndexed, d.cumulativeDownloaded)) ?? 4);
    }
    return Math.max(1024 * 1024, d3.max(series, (d) => d.cumulativeBytes) ?? 1024 * 1024);
  }, [series, metric]);

  const yScale = useMemo(
    () => d3.scaleLinear().domain([0, maxY * 1.08]).nice().range([H - padB, padT]),
    [maxY],
  );

  const indexedLinePath = useMemo(() => {
    if (metric !== 'items') return '';
    const gen = d3
      .line<HydratedGrowthPoint>()
      .x((d) => xScale(d.dateObj))
      .y((d) => yScale(d.cumulativeIndexed))
      .curve(d3.curveMonotoneX);
    return gen(series) || '';
  }, [series, metric, xScale, yScale]);

  const indexedAreaPath = useMemo(() => {
    if (metric !== 'items') return '';
    const gen = d3
      .area<HydratedGrowthPoint>()
      .x((d) => xScale(d.dateObj))
      .y0(H - padB)
      .y1((d) => yScale(d.cumulativeIndexed))
      .curve(d3.curveMonotoneX);
    return gen(series) || '';
  }, [series, metric, xScale, yScale]);

  const primaryLinePath = useMemo(() => {
    const gen = d3
      .line<HydratedGrowthPoint>()
      .x((d) => xScale(d.dateObj))
      .y((d) => yScale(metric === 'items' ? d.cumulativeDownloaded : d.cumulativeBytes))
      .curve(d3.curveMonotoneX);
    return gen(series) || '';
  }, [series, metric, xScale, yScale]);

  const primaryAreaPath = useMemo(() => {
    const gen = d3
      .area<HydratedGrowthPoint>()
      .x((d) => xScale(d.dateObj))
      .y0(H - padB)
      .y1((d) => yScale(metric === 'items' ? d.cumulativeDownloaded : d.cumulativeBytes))
      .curve(d3.curveMonotoneX);
    return gen(series) || '';
  }, [series, metric, xScale, yScale]);

  const bisectDate = useMemo(
    () => d3.bisector<HydratedGrowthPoint, Date>((d) => d.dateObj).center,
    [],
  );

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (series.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const clampedX = Math.max(padL, Math.min(W - padR, svgX));
    const hoveredDate = xScale.invert(clampedX);
    const idx = Math.min(series.length - 1, Math.max(0, bisectDate(series, hoveredDate)));
    const normX = (clampedX - padL) / (W - padL - padR);
    onHoverChange({ index: idx, side: normX > 0.56 ? 'left' : 'right' });
  };

  const yTicks = yScale.ticks(4);
  const xTicks = xScale.ticks(Math.min(5, Math.max(2, series.length)));

  const hIdx = hoverState ? Math.min(series.length - 1, Math.max(0, hoverState.index)) : null;
  const hPt = hIdx !== null ? series[hIdx] : null;
  const hX = hPt ? xScale(hPt.dateObj) : 0;

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full overflow-visible cursor-crosshair"
        aria-label="Repository growth D3 chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onHoverChange(null)}
      >
        <defs>
          <linearGradient id={gradIndexedId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-crt-amber)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-crt-amber)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id={gradMirroredId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--color-crt-border)"
                strokeDasharray={tick === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={padL - 7}
                y={y + 3}
                textAnchor="end"
                fill="var(--color-crt-muted)"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                {metric === 'items'
                  ? tick >= 1000
                    ? `${(tick / 1000).toFixed(1)}k`
                    : String(Math.round(tick))
                  : formatBytes(tick)}
              </text>
            </g>
          );
        })}

        {xTicks.map((tick, idx) => (
          <text
            key={tick.getTime()}
            x={xScale(tick)}
            y={H - 5}
            textAnchor={idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'}
            fill="var(--color-crt-muted)"
            fontSize="9.5"
            fontFamily="var(--font-mono)"
          >
            {d3.utcFormat('%b %d')(tick)}
          </text>
        ))}

        {metric === 'items' && (
          <>
            <path d={indexedAreaPath} fill={`url(#${gradIndexedId})`} />
            <path
              d={indexedLinePath}
              fill="none"
              stroke="var(--color-crt-amber)"
              strokeWidth="1.75"
              strokeDasharray="4 2"
            />
          </>
        )}

        <path d={primaryAreaPath} fill={`url(#${gradMirroredId})`} />
        <path
          d={primaryLinePath}
          fill="none"
          stroke="var(--color-crt-phosphor)"
          strokeWidth="2.2"
          className="crt-chart-trace-glow"
        />

        {series.length === 1 && (
          <circle
            cx={xScale(series[0]!.dateObj)}
            cy={yScale(metric === 'items' ? series[0]!.cumulativeDownloaded : series[0]!.cumulativeBytes)}
            r="3.5"
            fill="var(--color-crt-phosphor)"
          />
        )}

        {hPt && (
          <g pointerEvents="none">
            <line
              x1={hX}
              y1={padT}
              x2={hX}
              y2={H - padB}
              stroke="var(--color-crt-text)"
              strokeOpacity="0.45"
              strokeDasharray="2 2"
              strokeWidth="1"
            />
            {metric === 'items' && (
              <circle
                cx={hX}
                cy={yScale(hPt.cumulativeIndexed)}
                r="4"
                fill="var(--color-crt-amber)"
                stroke="var(--color-crt-bg)"
                strokeWidth="1.5"
              />
            )}
            <circle
              cx={hX}
              cy={yScale(metric === 'items' ? hPt.cumulativeDownloaded : hPt.cumulativeBytes)}
              r="4.5"
              fill="var(--color-crt-phosphor)"
              stroke="var(--color-crt-bg)"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>

      {hPt && hoverState && (
        <div
          data-side={hoverState.side}
          className="crt-chart-tooltip crt-chart-tooltip-wide pointer-events-none absolute top-2 z-20 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1"
        >
          <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
            <span>{formatDayFull(hPt.date)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-amber">Indexed Total</span>
            <span className="text-crt-text font-medium">
              {hPt.cumulativeIndexed.toLocaleString()}
              {hPt.indexedAdded > 0 && (
                <span className="text-crt-amber"> (+{hPt.indexedAdded})</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-phosphor">Mirrored Total</span>
            <span className="text-crt-text font-medium">
              {hPt.cumulativeDownloaded.toLocaleString()}
              {hPt.downloadedAdded > 0 && (
                <span className="text-crt-phosphor"> (+{hPt.downloadedAdded})</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-muted">Disk Footprint</span>
            <span className="text-crt-text">{formatBytes(hPt.cumulativeBytes)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function D3DailyDownloadTrendsSvg({
  series,
  metric,
  hoverState,
  onHoverChange,
}: {
  series: HydratedDailyTrend[];
  metric: 'bytes' | 'files';
  hoverState: { index: number; side: 'left' | 'right' } | null;
  onHoverChange: (next: { index: number; side: 'left' | 'right' } | null) => void;
}) {
  const W = 540;
  const H = 200;
  const padL = 52;
  const padR = 14;
  const padT = 14;
  const padB = 24;

  const xBand = useMemo(
    () =>
      d3
        .scaleBand<string>()
        .domain(series.map((d) => d.date))
        .range([padL, W - padR])
        .padding(0.24),
    [series],
  );

  const maxY = useMemo(() => {
    if (metric === 'bytes') {
      return Math.max(
        1024 * 1024,
        d3.max(series, (d) => Math.max(d.bytesDownloaded, d.movingAvgBytes)) ?? 1024 * 1024,
      );
    }
    return Math.max(4, d3.max(series, (d) => Math.max(d.filesDownloaded, d.movingAvgFiles)) ?? 4);
  }, [series, metric]);

  const yScale = useMemo(
    () => d3.scaleLinear().domain([0, maxY * 1.12]).nice().range([H - padB, padT]),
    [maxY],
  );

  const movingAvgPath = useMemo(() => {
    const bw = xBand.bandwidth();
    const gen = d3
      .line<HydratedDailyTrend>()
      .x((d) => (xBand(d.date) ?? padL) + bw / 2)
      .y((d) => yScale(metric === 'bytes' ? d.movingAvgBytes : d.movingAvgFiles))
      .curve(d3.curveMonotoneX);
    return gen(series) || '';
  }, [series, xBand, yScale, metric]);

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (series.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const plotW = W - padL - padR;
    const rel = Math.max(0, Math.min(0.9999, (svgX - padL) / plotW));
    const idx = Math.min(series.length - 1, Math.max(0, Math.floor(rel * series.length)));
    onHoverChange({ index: idx, side: rel > 0.56 ? 'left' : 'right' });
  };

  const yTicks = yScale.ticks(4);
  const labelIndices = [0, Math.floor((series.length - 1) / 2), series.length - 1].filter(
    (v, i, arr) => v >= 0 && arr.indexOf(v) === i,
  );
  const hIdx = hoverState ? Math.min(series.length - 1, Math.max(0, hoverState.index)) : null;
  const hPt = hIdx !== null ? series[hIdx] : null;

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full overflow-visible cursor-crosshair"
        aria-label="Daily download trends D3 chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onHoverChange(null)}
      >
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--color-crt-border)"
                strokeDasharray={tick === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={padL - 7}
                y={y + 3}
                textAnchor="end"
                fill="var(--color-crt-muted)"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                {metric === 'bytes' ? formatBytes(tick) : String(Math.round(tick))}
              </text>
            </g>
          );
        })}

        {labelIndices.map((idx) => {
          const pt = series[idx]!;
          const x = (xBand(pt.date) ?? padL) + xBand.bandwidth() / 2;
          return (
            <text
              key={pt.date}
              x={x}
              y={H - 5}
              textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
              fill="var(--color-crt-muted)"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
            >
              {formatDayShort(pt.date)}
            </text>
          );
        })}

        {series.map((d, idx) => {
          const x = xBand(d.date) ?? padL;
          const bw = xBand.bandwidth();
          const val = metric === 'bytes' ? d.bytesDownloaded : d.filesDownloaded;
          const y = yScale(val);
          const barH = Math.max(val > 0 ? 2 : 0, H - padB - y);
          const isHovered = hIdx === idx;
          return (
            <g key={d.date}>
              {isHovered && (
                <rect
                  x={x - 1.5}
                  y={padT}
                  width={bw + 3}
                  height={H - padT - padB}
                  fill="var(--color-crt-elevated)"
                  fillOpacity="0.45"
                  rx="1"
                />
              )}
              {barH > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={barH}
                  rx="1"
                  fill="var(--color-crt-phosphor)"
                  fillOpacity={isHovered ? 0.95 : 0.72}
                />
              )}
              {d.failedItems > 0 && (
                <rect
                  x={x}
                  y={H - padB - 3}
                  width={bw}
                  height={3}
                  fill="var(--color-crt-crimson)"
                />
              )}
            </g>
          );
        })}

        <path
          d={movingAvgPath}
          fill="none"
          stroke="var(--color-crt-amber)"
          strokeWidth="1.9"
          strokeLinecap="round"
        />

        {hPt && (
          <circle
            cx={(xBand(hPt.date) ?? padL) + xBand.bandwidth() / 2}
            cy={yScale(metric === 'bytes' ? hPt.movingAvgBytes : hPt.movingAvgFiles)}
            r="3.8"
            fill="var(--color-crt-amber)"
            stroke="var(--color-crt-bg)"
            strokeWidth="1.4"
            pointerEvents="none"
          />
        )}
      </svg>

      {hPt && hoverState && (
        <div
          data-side={hoverState.side}
          className="crt-chart-tooltip crt-chart-tooltip-wide pointer-events-none absolute top-2 z-20 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1"
        >
          <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
            <span>{formatDayFull(hPt.date)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-phosphor">Files Acquired</span>
            <span className="text-crt-text font-medium">{hPt.filesDownloaded.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-text">Bytes Mirrored</span>
            <span className="text-crt-text">{formatBytes(hPt.bytesDownloaded)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-amber">7d Moving Avg</span>
            <span className="text-crt-amber">
              {metric === 'bytes'
                ? `${formatBytes(hPt.movingAvgBytes)}/d`
                : `${hPt.movingAvgFiles.toFixed(1)} files/d`}
            </span>
          </div>
          {hPt.failedItems > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-crt-crimson">Failed</span>
              <span className="text-crt-crimson">{hPt.failedItems}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function D3RunVelocitySvg({
  runs,
  hoverState,
  onHoverChange,
}: {
  runs: DownloadTrendRunPoint[];
  hoverState: { index: number; side: 'left' | 'right' } | null;
  onHoverChange: (next: { index: number; side: 'left' | 'right' } | null) => void;
}) {
  const W = 540;
  const H = 200;
  const padL = 44;
  const padR = 46;
  const padT = 14;
  const padB = 24;

  const xBand = useMemo(
    () =>
      d3
        .scaleBand<number>()
        .domain(runs.map((r) => r.id))
        .range([padL, W - padR])
        .padding(0.28),
    [runs],
  );

  const maxCount = useMemo(
    () => Math.max(4, d3.max(runs, (r) => r.downloadedCount + r.failedCount) ?? 4),
    [runs],
  );
  const maxMbps = useMemo(
    () => Math.max(1, d3.max(runs, (r) => r.avgBytesPerSec / (1024 * 1024)) ?? 1),
    [runs],
  );

  const yLeft = useMemo(
    () => d3.scaleLinear().domain([0, maxCount * 1.15]).nice().range([H - padB, padT]),
    [maxCount],
  );
  const yRight = useMemo(
    () => d3.scaleLinear().domain([0, maxMbps * 1.15]).nice().range([H - padB, padT]),
    [maxMbps],
  );

  const speedLinePath = useMemo(() => {
    const bw = xBand.bandwidth();
    const gen = d3
      .line<DownloadTrendRunPoint>()
      .x((r) => (xBand(r.id) ?? padL) + bw / 2)
      .y((r) => yRight(r.avgBytesPerSec / (1024 * 1024)))
      .curve(d3.curveMonotoneX);
    return gen(runs) || '';
  }, [runs, xBand, yRight]);

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (runs.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const plotW = W - padL - padR;
    const rel = Math.max(0, Math.min(0.9999, (svgX - padL) / plotW));
    const idx = Math.min(runs.length - 1, Math.max(0, Math.floor(rel * runs.length)));
    onHoverChange({ index: idx, side: rel > 0.56 ? 'left' : 'right' });
  };

  const hIdx = hoverState ? Math.min(runs.length - 1, Math.max(0, hoverState.index)) : null;
  const hRun = hIdx !== null ? runs[hIdx] : null;
  const yTicks = yLeft.ticks(4);
  const ySpeedTicks = yRight.ticks(4);

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full overflow-visible cursor-crosshair"
        aria-label="Sync run outcomes and speed D3 chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onHoverChange(null)}
      >
        {yTicks.map((tick) => {
          const y = yLeft(tick);
          return (
            <g key={tick}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--color-crt-border)"
                strokeDasharray={tick === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={padL - 7}
                y={y + 3}
                textAnchor="end"
                fill="var(--color-crt-muted)"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        {ySpeedTicks.map((tick) => (
          <text
            key={`spd-${tick}`}
            x={W - padR + 7}
            y={yRight(tick) + 3}
            textAnchor="start"
            fill="var(--color-crt-amber)"
            fontSize="9"
            fontFamily="var(--font-mono)"
            opacity="0.8"
          >
            {tick.toFixed(tick >= 10 ? 0 : 1)}M/s
          </text>
        ))}

        {runs.map((r, idx) => {
          const x = xBand(r.id) ?? padL;
          const bw = xBand.bandwidth();
          const dlH = Math.max(r.downloadedCount > 0 ? 2 : 0, H - padB - yLeft(r.downloadedCount));
          const failH = Math.max(
            r.failedCount > 0 ? 2 : 0,
            H - padB - yLeft(r.downloadedCount + r.failedCount) - dlH,
          );
          const isHovered = hIdx === idx;
          return (
            <g key={r.id}>
              {isHovered && (
                <rect
                  x={x - 1.5}
                  y={padT}
                  width={bw + 3}
                  height={H - padT - padB}
                  fill="var(--color-crt-elevated)"
                  fillOpacity="0.45"
                  rx="1"
                />
              )}
              {dlH > 0 && (
                <rect
                  x={x}
                  y={H - padB - dlH}
                  width={bw}
                  height={dlH}
                  rx="1"
                  fill="var(--color-crt-phosphor)"
                  fillOpacity={isHovered ? 0.95 : 0.72}
                />
              )}
              {failH > 0 && (
                <rect
                  x={x}
                  y={H - padB - dlH - failH}
                  width={bw}
                  height={failH}
                  fill="var(--color-crt-crimson)"
                />
              )}
            </g>
          );
        })}

        <path
          d={speedLinePath}
          fill="none"
          stroke="var(--color-crt-amber)"
          strokeWidth="1.9"
          strokeLinecap="round"
        />

        {[0, Math.floor((runs.length - 1) / 2), runs.length - 1]
          .filter((v, i, arr) => v >= 0 && arr.indexOf(v) === i)
          .map((idx) => {
            const r = runs[idx]!;
            return (
              <text
                key={r.id}
                x={(xBand(r.id) ?? padL) + xBand.bandwidth() / 2}
                y={H - 5}
                textAnchor={idx === 0 ? 'start' : idx === runs.length - 1 ? 'end' : 'middle'}
                fill="var(--color-crt-muted)"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                #{r.id}
              </text>
            );
          })}

        {hRun && (
          <circle
            cx={(xBand(hRun.id) ?? padL) + xBand.bandwidth() / 2}
            cy={yRight(hRun.avgBytesPerSec / (1024 * 1024))}
            r="4"
            fill="var(--color-crt-amber)"
            stroke="var(--color-crt-bg)"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        )}
      </svg>

      {hRun && hoverState && (
        <div
          data-side={hoverState.side}
          className="crt-chart-tooltip crt-chart-tooltip-wide pointer-events-none absolute top-2 z-20 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1"
        >
          <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
            <span className="text-crt-text font-semibold">
              Run #{hRun.id} ({hRun.triggerType})
            </span>
            <span>{formatDurationMs(hRun.durationSec * 1000)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-phosphor">Saved</span>
            <span className="text-crt-text font-medium">{hRun.downloadedCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-muted">Skipped / Failed</span>
            <span className="text-crt-text">
              {hRun.skippedCount} /{' '}
              <span className={hRun.failedCount > 0 ? 'text-crt-crimson' : ''}>
                {hRun.failedCount}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-amber">Volume · Avg Speed</span>
            <span className="text-crt-amber">
              {formatBytes(hRun.bytesDownloaded)} · {formatRateMbps(hRun.avgBytesPerSec)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

type CoverageStackKey = 'downloaded' | 'queued' | 'available' | 'failed';
const COVERAGE_KEYS: CoverageStackKey[] = ['downloaded', 'queued', 'available', 'failed'];
const COVERAGE_COLORS: Record<CoverageStackKey, string> = {
  downloaded: 'var(--color-crt-phosphor)',
  queued: '#38bdf8',
  available: 'var(--color-crt-border-strong)',
  failed: 'var(--color-crt-crimson)',
};

function D3SystemCoverageChart({
  systems,
  hoveredSlug,
  onHoverSlug,
  onSelectSystem,
}: {
  systems: SystemCoverageStat[];
  hoveredSlug: string | null;
  onHoverSlug: (slug: string | null) => void;
  onSelectSystem: (slug: string) => void;
}) {
  const stackGen = useMemo(
    () =>
      d3
        .stack<SystemCoverageStat, CoverageStackKey>()
        .keys(COVERAGE_KEYS)
        .value((d, key) => {
          const total = Math.max(1, d.totalItems);
          if (key === 'downloaded') return (d.downloadedItems / total) * 100;
          if (key === 'queued') return (d.queuedItems / total) * 100;
          if (key === 'available') return (d.availableItems / total) * 100;
          return (d.failedItems / total) * 100;
        }),
    [],
  );

  const stackedSeries = useMemo(() => stackGen(systems), [stackGen, systems]);
  const xScale = useMemo(() => d3.scaleLinear().domain([0, 100]).range([0, 100]), []);

  if (systems.length === 0) {
    return (
      <div className="py-8 text-center text-xs font-mono text-crt-muted">
        No system coverage records available yet.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
      {systems.map((sys, rowIdx) => {
        const display = resolveSystemDisplayInfo(sys.systemName);
        const covPct = sys.totalItems > 0 ? (sys.downloadedItems / sys.totalItems) * 100 : 0;
        const hovered = hoveredSlug === sys.systemName;
        const dimmed = hoveredSlug !== null && !hovered;

        return (
          <button
            key={sys.systemName}
            type="button"
            onClick={() => onSelectSystem(sys.systemName)}
            onPointerEnter={() => onHoverSlug(sys.systemName)}
            onPointerLeave={() => onHoverSlug(null)}
            className={`w-full text-left px-3 py-2 rounded border transition-all duration-200 cursor-pointer ${
              hovered
                ? 'border-crt-phosphor/50 bg-crt-elevated'
                : 'border-crt-border/70 bg-crt-bg/70 hover:border-crt-border-strong'
            } ${dimmed ? 'opacity-70' : 'opacity-100'}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-sans font-medium text-crt-text truncate">
                  {display.displayName}
                </span>
                <span className="text-[11px] text-crt-muted shrink-0">({sys.systemName})</span>
                {sys.fullyIndexed ? (
                  <span className="text-[10px] text-crt-phosphor/85 shrink-0">indexed</span>
                ) : sys.totalPages > 0 ? (
                  <span className="text-[10px] text-crt-amber shrink-0">
                    p.{sys.indexedPages}/{sys.totalPages}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] shrink-0">
                <span className="text-crt-phosphor font-semibold">{covPct.toFixed(1)}%</span>
                <span className="text-crt-text">
                  {sys.downloadedItems.toLocaleString()} / {sys.totalItems.toLocaleString()}
                </span>
                <span className="text-crt-muted hidden sm:inline">
                  {formatBytes(sys.mirroredBytes)}
                  {sys.estimatedAvailableBytes > 0
                    ? ` · ~${formatBytes(sys.estimatedAvailableBytes)} left`
                    : ''}
                </span>
                {sys.installedItems > 0 && (
                  <span className="text-crt-phosphor/85 hidden md:inline">
                    {sys.installedItems} on SD
                  </span>
                )}
              </div>
            </div>

            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              className="w-full h-2 rounded-xs overflow-hidden bg-crt-surface"
              aria-hidden="true"
            >
              {stackedSeries.map((layer) => {
                const seg = layer[rowIdx];
                if (!seg) return null;
                const x0 = xScale(seg[0]);
                const x1 = xScale(seg[1]);
                const width = Math.max(0, x1 - x0);
                if (width <= 0) return null;
                return (
                  <rect
                    key={layer.key}
                    x={x0}
                    y={0}
                    width={width}
                    height={6}
                    fill={COVERAGE_COLORS[layer.key]}
                    fillOpacity={layer.key === 'available' ? 0.55 : hovered ? 1 : 0.88}
                  />
                );
              })}
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function D3CompositionDonut({
  rows,
  hoveredLabel,
  onHoverLabel,
}: {
  rows: CompositionStat[];
  hoveredLabel: string | null;
  onHoverLabel: (label: string | null) => void;
}) {
  const totalCount = useMemo(() => Math.max(1, d3.sum(rows, (r) => r.totalCount)), [rows]);

  const arcs = useMemo(() => {
    const pie = d3
      .pie<CompositionStat>()
      .value((d) => d.totalCount)
      .sort(null)
      .padAngle(0.028);
    const baseArc = d3.arc<d3.PieArcDatum<CompositionStat>>().innerRadius(52).outerRadius(78).cornerRadius(2);
    const hoverArc = d3.arc<d3.PieArcDatum<CompositionStat>>().innerRadius(52).outerRadius(84).cornerRadius(2);

    return pie(rows).map((slice, idx) => ({
      slice,
      color: DONUT_PALETTE[idx % DONUT_PALETTE.length]!,
      basePath: baseArc(slice) || '',
      hoverPath: hoverArc(slice) || '',
    }));
  }, [rows]);

  const activeItem =
    arcs.find((a) => a.slice.data.label === hoveredLabel) ?? null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
      <div className="sm:col-span-5 flex items-center justify-center">
        <svg viewBox="-92 -92 184 184" className="w-44 h-44 overflow-visible" aria-label="Release composition donut chart">
          {arcs.map((a) => {
            const isHovered = hoveredLabel === a.slice.data.label;
            const dimmed = hoveredLabel !== null && !isHovered;
            return (
              <path
                key={a.slice.data.label}
                d={isHovered ? a.hoverPath : a.basePath}
                fill={a.color}
                fillOpacity={dimmed ? 0.35 : 0.9}
                stroke="var(--color-crt-bg)"
                strokeWidth="1.5"
                className="transition-all duration-200 cursor-pointer"
                onPointerEnter={() => onHoverLabel(a.slice.data.label)}
                onPointerLeave={() => onHoverLabel(null)}
              />
            );
          })}
          <text
            x="0"
            y="-4"
            textAnchor="middle"
            fill="var(--color-crt-text)"
            fontSize="18"
            fontWeight="600"
            fontFamily="var(--font-display)"
          >
            {activeItem
              ? `${((activeItem.slice.data.totalCount / totalCount) * 100).toFixed(0)}%`
              : rows.length}
          </text>
          <text
            x="0"
            y="13"
            textAnchor="middle"
            fill="var(--color-crt-muted)"
            fontSize="9.5"
            fontFamily="var(--font-mono)"
          >
            {activeItem
              ? activeItem.slice.data.label.slice(0, 14)
              : 'categories'}
          </text>
        </svg>
      </div>

      <div className="sm:col-span-7 space-y-1.5">
        {arcs.map((a) => {
          const item = a.slice.data;
          const pct = (item.totalCount / totalCount) * 100;
          const isHovered = hoveredLabel === item.label;
          return (
            <div
              key={item.label}
              onPointerEnter={() => onHoverLabel(item.label)}
              onPointerLeave={() => onHoverLabel(null)}
              className={`px-2.5 py-1.5 rounded border text-xs font-mono tabular-nums transition-colors cursor-default ${
                isHovered
                  ? 'border-crt-border-strong bg-crt-elevated'
                  : 'border-transparent bg-crt-bg/50 hover:bg-crt-bg'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="inline-flex items-center gap-2 min-w-0 text-crt-text">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: a.color }}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="text-crt-muted shrink-0">
                  <span className="text-crt-text font-medium">{item.downloadedCount}</span>/
                  {item.totalCount} · <span className="text-crt-phosphor">{pct.toFixed(1)}%</span>
                </span>
              </div>
              <div className="h-1 w-full bg-crt-surface rounded-xs overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    backgroundColor: a.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function D3SizeHistogramSvg({
  buckets,
  hoverState,
  onHoverChange,
}: {
  buckets: CatalogStatsSnapshot['sizeDistribution'];
  hoverState: { key: string; side: 'left' | 'right' } | null;
  onHoverChange: (next: { key: string; side: 'left' | 'right' } | null) => void;
}) {
  const W = 540;
  const H = 174;
  const padL = 42;
  const padR = 12;
  const padT = 12;
  const padB = 26;

  const xOuter = useMemo(
    () =>
      d3
        .scaleBand<string>()
        .domain(buckets.map((b) => b.bucketKey))
        .range([padL, W - padR])
        .padding(0.22),
    [buckets],
  );

  const xInner = useMemo(
    () =>
      d3
        .scaleBand<'downloaded' | 'available'>()
        .domain(['downloaded', 'available'])
        .range([0, xOuter.bandwidth()])
        .padding(0.12),
    [xOuter],
  );

  const maxCount = useMemo(
    () => Math.max(4, d3.max(buckets, (b) => Math.max(b.downloadedCount, b.availableCount)) ?? 4),
    [buckets],
  );

  const yScale = useMemo(
    () => d3.scaleLinear().domain([0, maxCount * 1.15]).nice().range([H - padB, padT]),
    [maxCount],
  );

  const yTicks = yScale.ticks(4);
  const hBucket = hoverState ? buckets.find((b) => b.bucketKey === hoverState.key) ?? null : null;

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full overflow-visible"
        aria-label="Archive file size histogram D3 chart"
        onPointerLeave={() => onHoverChange(null)}
      >
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="var(--color-crt-border)"
                strokeDasharray={tick === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={padL - 7}
                y={y + 3}
                textAnchor="end"
                fill="var(--color-crt-muted)"
                fontSize="9.5"
                fontFamily="var(--font-mono)"
              >
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        {buckets.map((b, idx) => {
          const bx = xOuter(b.bucketKey) ?? padL;
          const bw = xOuter.bandwidth();
          const dlX = bx + (xInner('downloaded') ?? 0);
          const avX = bx + (xInner('available') ?? bw / 2);
          const subW = xInner.bandwidth();
          const dlH = Math.max(b.downloadedCount > 0 ? 2 : 0, H - padB - yScale(b.downloadedCount));
          const avH = Math.max(b.availableCount > 0 ? 2 : 0, H - padB - yScale(b.availableCount));
          const hovered = hoverState?.key === b.bucketKey;
          const side = idx >= buckets.length / 2 ? 'left' : 'right';

          return (
            <g
              key={b.bucketKey}
              onPointerEnter={() => onHoverChange({ key: b.bucketKey, side })}
              className="cursor-crosshair"
            >
              <rect
                x={bx - 3}
                y={padT}
                width={bw + 6}
                height={H - padT - padB}
                fill={hovered ? 'var(--color-crt-elevated)' : 'transparent'}
                fillOpacity="0.45"
                rx="2"
              />
              {dlH > 0 && (
                <rect
                  x={dlX}
                  y={H - padB - dlH}
                  width={subW}
                  height={dlH}
                  rx="1"
                  fill="var(--color-crt-phosphor)"
                  fillOpacity={hovered ? 0.95 : 0.78}
                />
              )}
              {avH > 0 && (
                <rect
                  x={avX}
                  y={H - padB - avH}
                  width={subW}
                  height={avH}
                  rx="1"
                  fill="var(--color-crt-amber)"
                  fillOpacity={hovered ? 0.9 : 0.62}
                />
              )}
              <text
                x={bx + bw / 2}
                y={H - 7}
                textAnchor="middle"
                fill={hovered ? 'var(--color-crt-text)' : 'var(--color-crt-muted)'}
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hBucket && hoverState && (
        <div
          data-side={hoverState.side}
          className="crt-chart-tooltip pointer-events-none absolute top-2 z-20 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1"
        >
          <div className="text-crt-text font-semibold border-b border-crt-border pb-1">
            {hBucket.label}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-phosphor">Mirrored</span>
            <span className="text-crt-text">
              {hBucket.downloadedCount} ({formatBytes(hBucket.downloadedBytes)})
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-crt-amber">Available</span>
            <span className="text-crt-text">
              {hBucket.availableCount} ({formatBytes(hBucket.availableBytes)})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StorageCapacityForecast({
  mirroredBytes,
  estimatedRemainingBytes,
  diskFreeBytes,
  diskTotalBytes,
  minFreeDiskGb = 2,
  onReclaimSpace,
}: {
  mirroredBytes: number;
  estimatedRemainingBytes: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  minFreeDiskGb?: number;
  onReclaimSpace?: () => void;
}) {
  const denom = Math.max(
    1,
    diskTotalBytes && diskTotalBytes > 0
      ? diskTotalBytes
      : mirroredBytes + estimatedRemainingBytes + (diskFreeBytes ?? 0),
  );
  const mirroredPct = Math.min(100, (mirroredBytes / denom) * 100);
  const remainingPct = Math.min(100 - mirroredPct, (estimatedRemainingBytes / denom) * 100);
  const guardrail = evaluateDiskSpaceGuardrail({
    diskFreeBytes,
    estimatedBytes: estimatedRemainingBytes,
    minFreeDiskGb,
  });
  const usableFreeBytes = guardrail.usableBytes;
  const fits = usableFreeBytes !== null ? usableFreeBytes >= estimatedRemainingBytes : null;
  const deltaBytes = usableFreeBytes !== null ? usableFreeBytes - estimatedRemainingBytes : null;

  return (
    <div className="pt-2 border-t border-crt-border/80 space-y-2 text-[11px] font-mono tabular-nums">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-crt-text">
            <span
              className="w-2.5 h-2 rounded-xs"
              style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
            />
            Mirrored {formatBytes(mirroredBytes)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-crt-amber">
            <span
              className="w-2.5 h-2 rounded-xs"
              style={{ backgroundColor: 'var(--color-crt-amber)' }}
            />
            ~Est. Remaining {formatBytes(estimatedRemainingBytes)}
          </span>
        </div>

        {diskFreeBytes !== null && (
          <span className={fits ? 'text-crt-phosphor' : 'text-crt-amber'}>
            {fits
              ? `Headroom +${formatBytes(deltaBytes)}`
              : `Shortfall ${formatBytes(Math.abs(deltaBytes || 0))}`}
          </span>
        )}
      </div>

      <div className="h-2 w-full bg-crt-bg border border-crt-border rounded-xs overflow-hidden flex">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${mirroredPct}%`,
            backgroundColor: 'var(--color-crt-phosphor)',
          }}
        />
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${remainingPct}%`,
            backgroundColor: 'var(--color-crt-amber)',
            opacity: 0.65,
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-crt-muted">
        <span className={guardrail.belowReserveNow ? 'text-crt-amber' : ''}>
          Host Free: {diskFreeBytes !== null ? formatBytes(diskFreeBytes) : '—'}
          {guardrail.reserveBytes > 0
            ? ` (Reserve ${formatReserveGbLabel(guardrail.reserveGb)})`
            : ''}
        </span>
        <div className="flex items-center gap-3">
          <span>
            Projected Full Mirror: ~{formatBytes(mirroredBytes + estimatedRemainingBytes)}
          </span>
          {mirroredBytes > 0 && onReclaimSpace && (
            <button
              type="button"
              onClick={onReclaimSpace}
              title="Open Downloaded items sorted by largest file size to reclaim local disk space without deleting catalog metadata"
              className="inline-flex items-center gap-1 text-crt-amber hover:underline cursor-pointer whitespace-nowrap"
            >
              <span>Free Space</span>
              <ArrowUpRight className="h-3 w-3 shrink-0" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
