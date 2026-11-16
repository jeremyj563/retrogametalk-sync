import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Gamepad2,
  HardDrive,
  Layers,
  Repeat,
} from 'lucide-react';
import type {
  RateLimitSample,
  ReleaseTypeBreakdown,
  ServiceStatusSnapshot,
  SyncRunRecord,
  TransferSpeedSample,
} from '../types';
import { formatBytes, formatRunDuration, formatTimeShort } from '../utils/format';

export type TelemetrySlideId =
  | 'pacing'
  | 'bandwidth'
  | 'outcomes'
  | 'consoles'
  | 'types'
  | 'percentiles';

interface TelemetryDeckProps {
  status: ServiceStatusSnapshot;
  runs: SyncRunRecord[];
}

interface TelemetryDeckPrefs {
  activeSlide: TelemetrySlideId;
  autoCycle: boolean;
}

const TELEMETRY_DECK_STORAGE_KEY = 'rgt_sync_telemetry_deck_v1';
const SLIDE_ORDER: TelemetrySlideId[] = [
  'pacing',
  'bandwidth',
  'outcomes',
  'consoles',
  'types',
  'percentiles',
];

const SLIDE_META: Record<
  TelemetrySlideId,
  { tabLabel: string; title: string; subtitle: string }
> = {
  pacing: {
    tabLabel: 'Pacing',
    title: 'Adaptive Rate Limiter Pacing',
    subtitle: 'AIMD request spacing (phosphor) vs HTTP latency (amber)',
  },
  bandwidth: {
    tabLabel: 'Speed',
    title: 'Download Speed & Bandwidth',
    subtitle: 'Real-time file transfer throughput (MB/s) & run volume',
  },
  outcomes: {
    tabLabel: 'Runs',
    title: 'Sync Run Outcomes & Volume',
    subtitle: 'Downloaded, skipped & failed items with mirrored bytes',
  },
  consoles: {
    tabLabel: 'Consoles',
    title: 'Storage Footprint by Console',
    subtitle: 'Disk usage & downloaded release share across systems',
  },
  types: {
    tabLabel: 'Types',
    title: 'Downloaded Release Types',
    subtitle: 'Translations, hacks, ports, homebrew & retail distribution',
  },
  percentiles: {
    tabLabel: 'Latency',
    title: 'Upstream Latency Percentiles',
    subtitle: 'Rolling p50 median, p95 tail & peak HTTP response times',
  },
};

function isValidSlideId(val: unknown): val is TelemetrySlideId {
  return typeof val === 'string' && (SLIDE_ORDER as string[]).includes(val);
}

function loadDeckPrefs(): TelemetryDeckPrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { activeSlide: 'pacing', autoCycle: false };
    }
    const raw = window.localStorage.getItem(TELEMETRY_DECK_STORAGE_KEY);
    if (!raw) return { activeSlide: 'pacing', autoCycle: false };
    const parsed = JSON.parse(raw) as Partial<TelemetryDeckPrefs>;
    return {
      activeSlide: isValidSlideId(parsed.activeSlide) ? parsed.activeSlide : 'pacing',
      autoCycle: typeof parsed.autoCycle === 'boolean' ? parsed.autoCycle : false,
    };
  } catch {
    return { activeSlide: 'pacing', autoCycle: false };
  }
}

function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return Math.round(sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo));
}

function formatMbps(bytesPerSec: number): string {
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps >= 10) return `${mbps.toFixed(1)} MB/s`;
  if (mbps >= 0.1) return `${mbps.toFixed(2)} MB/s`;
  if (bytesPerSec > 0) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return '0.00 MB/s';
}

function classifyTypeAccent(typeName: string): {
  barStyle: string;
  dotColor: string;
  isModOrTrans: boolean;
} {
  const lower = typeName.toLowerCase();
  if (lower.includes('translation') || lower.includes('undub')) {
    return {
      barStyle: 'var(--color-crt-phosphor)',
      dotColor: 'var(--color-crt-phosphor)',
      isModOrTrans: true,
    };
  }
  if (lower.includes('hack') || lower.includes('patch')) {
    return {
      barStyle: 'var(--color-crt-amber)',
      dotColor: 'var(--color-crt-amber)',
      isModOrTrans: true,
    };
  }
  if (lower.includes('port') || lower.includes('homebrew') || lower.includes('indie') || lower.includes('doujin')) {
    return {
      barStyle: '#38bdf8',
      dotColor: '#38bdf8',
      isModOrTrans: true,
    };
  }
  if (lower.includes('proto') || lower.includes('demo') || lower.includes('bootleg')) {
    return {
      barStyle: '#a78bfa',
      dotColor: '#a78bfa',
      isModOrTrans: true,
    };
  }
  return {
    barStyle: 'var(--color-crt-phosphor-dim)',
    dotColor: 'var(--color-crt-muted)',
    isModOrTrans: false,
  };
}

// SVG plot geometry constants
const VB_W = 460;
const VB_H = 180;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

export function TelemetryDeck({ status, runs }: TelemetryDeckProps) {
  const [initialPrefs] = useState<TelemetryDeckPrefs>(() => loadDeckPrefs());
  const [activeSlide, setActiveSlide] = useState<TelemetrySlideId>(initialPrefs.activeSlide);
  const [autoCycle, setAutoCycle] = useState<boolean>(initialPrefs.autoCycle);
  const [bandwidthSource, setBandwidthSource] = useState<'auto' | 'stream' | 'runs'>('auto');
  const [isHovering, setIsHovering] = useState(false);
  const [hoverState, setHoverState] = useState<{
    index: number;
    normX: number;
    normY: number;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage?.setItem(
        TELEMETRY_DECK_STORAGE_KEY,
        JSON.stringify({ activeSlide, autoCycle }),
      );
    } catch {
      // Ignore storage errors
    }
  }, [activeSlide, autoCycle]);

  // Clear hover state whenever active slide changes
  useEffect(() => {
    setHoverState(null);
  }, [activeSlide, bandwidthSource]);

  // Hover-paused auto-cycle timer
  useEffect(() => {
    if (!autoCycle || isHovering) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => {
        const idx = SLIDE_ORDER.indexOf(prev);
        return SLIDE_ORDER[(idx + 1) % SLIDE_ORDER.length];
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [autoCycle, isHovering]);

  const stepSlide = (delta: number) => {
    setActiveSlide((prev) => {
      const idx = SLIDE_ORDER.indexOf(prev);
      const nextIdx = (idx + delta + SLIDE_ORDER.length) % SLIDE_ORDER.length;
      return SLIDE_ORDER[nextIdx];
    });
  };

  // --- Data derivations ---
  const delaySeries: RateLimitSample[] = status.rateLimiter.history;
  const transferSeries: TransferSpeedSample[] = useMemo(
    () => status.transferHistory || [],
    [status.transferHistory],
  );

  // Chronological runs (oldest -> newest, up to 14)
  const chronologicalRuns = useMemo(() => {
    return [...runs].slice(0, 14).reverse();
  }, [runs]);

  const runBandwidthPoints = useMemo(() => {
    return chronologicalRuns.map((r) => {
      const startMs = Date.parse(r.startedAt);
      const endMs = r.finishedAt ? Date.parse(r.finishedAt) : Date.now();
      const durSec = Math.max(1, (endMs - startMs) / 1000);
      const avgBytesPerSec = r.bytesDownloaded > 0 ? r.bytesDownloaded / durSec : 0;
      return {
        run: r,
        durSec,
        avgBytesPerSec,
      };
    });
  }, [chronologicalRuns]);

  const effectiveBandwidthMode: 'stream' | 'runs' = useMemo(() => {
    if (bandwidthSource === 'stream') return 'stream';
    if (bandwidthSource === 'runs') return 'runs';
    if (transferSeries.length >= 2) return 'stream';
    if (runBandwidthPoints.some((p) => p.run.bytesDownloaded > 0)) return 'runs';
    return 'stream';
  }, [bandwidthSource, transferSeries.length, runBandwidthPoints]);

  // Systems sorted by bytes descending (with fallback to totalItems)
  const rankedSystems = useMemo(() => {
    return [...status.systems]
      .filter((s) => s.totalBytes > 0 || s.totalItems > 0)
      .sort((a, b) => b.totalBytes - a.totalBytes || b.downloadedItems - a.downloadedItems);
  }, [status.systems]);

  // Downloaded release types (fallback to totalItems if zero downloaded so dry-run repos still visualize)
  const releaseTypesData = useMemo(() => {
    const raw: ReleaseTypeBreakdown[] = status.releaseTypes || [];
    const hasDownloaded = raw.some((t) => t.downloadedItems > 0);
    return {
      usingDownloadedOnly: hasDownloaded,
      rows: raw
        .filter((t) => (hasDownloaded ? t.downloadedItems > 0 : t.totalItems > 0))
        .sort((a, b) =>
          hasDownloaded
            ? b.downloadedItems - a.downloadedItems || b.totalBytes - a.totalBytes
            : b.totalItems - a.totalItems,
        ),
    };
  }, [status.releaseTypes]);

  // Rolling latency percentiles (window = 12 samples)
  const rollingPercentiles = useMemo(() => {
    const windowSize = 12;
    return delaySeries.map((sample, i) => {
      const start = Math.max(0, i - windowSize + 1);
      const slice = delaySeries
        .slice(start, i + 1)
        .map((s) => s.latencyMs)
        .sort((a, b) => a - b);
      return {
        timestamp: sample.timestamp,
        sampleMs: sample.latencyMs,
        throttled: sample.throttled,
        p50: computePercentile(slice, 50),
        p95: computePercentile(slice, 95),
        max: slice[slice.length - 1] || 0,
      };
    });
  }, [delaySeries]);

  // Overall stats for Pacing & Latency
  const pacingStats = useMemo(() => {
    if (delaySeries.length === 0) {
      return {
        delayMin: status.rateLimiter.minDelayMs,
        delayAvg: status.rateLimiter.currentDelayMs,
        delayMax: status.rateLimiter.currentDelayMs,
        delayLast: status.rateLimiter.currentDelayMs,
        latMin: 0,
        latAvg: status.rateLimiter.avgLatencyMs,
        latMax: 0,
        latLast: 0,
        p50: 0,
        p90: 0,
        p95: 0,
      };
    }
    const delays = delaySeries.map((s) => s.delayMs);
    const lats = delaySeries.map((s) => s.latencyMs);
    const sortedLats = [...lats].sort((a, b) => a - b);
    const sum = (arr: number[]) => arr.reduce((acc, v) => acc + v, 0);
    return {
      delayMin: Math.min(...delays),
      delayAvg: Math.round(sum(delays) / delays.length),
      delayMax: Math.max(...delays),
      delayLast: delays[delays.length - 1],
      latMin: sortedLats[0],
      latAvg: Math.round(sum(lats) / lats.length),
      latMax: sortedLats[sortedLats.length - 1],
      latLast: lats[lats.length - 1],
      p50: computePercentile(sortedLats, 50),
      p90: computePercentile(sortedLats, 90),
      p95: computePercentile(sortedLats, 95),
    };
  }, [delaySeries, status.rateLimiter]);

  // Pointer handler for continuous / bar SVG charts
  const handleSvgPointerMove = (
    e: ReactPointerEvent<SVGSVGElement>,
    pointCount: number,
    mode: 'line' | 'bar',
  ) => {
    if (pointCount <= 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const svgX = ((e.clientX - rect.left) / rect.width) * VB_W;
    const svgY = ((e.clientY - rect.top) / rect.height) * VB_H;
    const clampedPlotX = Math.max(0, Math.min(PLOT_W, svgX - PAD_L));
    const clampedPlotY = Math.max(0, Math.min(PLOT_H, svgY - PAD_T));

    let index = 0;
    if (pointCount === 1) {
      index = 0;
    } else if (mode === 'bar') {
      index = Math.min(pointCount - 1, Math.max(0, Math.floor((clampedPlotX / PLOT_W) * pointCount)));
    } else {
      index = Math.round((clampedPlotX / PLOT_W) * (pointCount - 1));
    }

    setHoverState({
      index,
      normX: clampedPlotX / PLOT_W,
      normY: clampedPlotY / PLOT_H,
    });
  };

  // Header right badge text
  const headerBadge = useMemo(() => {
    switch (activeSlide) {
      case 'pacing':
      case 'percentiles':
        return `${delaySeries.length} samples`;
      case 'bandwidth':
        return effectiveBandwidthMode === 'stream'
          ? `${transferSeries.length} stream pts`
          : `${runBandwidthPoints.length} runs`;
      case 'outcomes':
        return `${chronologicalRuns.length} runs`;
      case 'consoles':
        return `${rankedSystems.length} consoles`;
      case 'types':
        return `${releaseTypesData.rows.length} types`;
    }
  }, [
    activeSlide,
    delaySeries.length,
    effectiveBandwidthMode,
    transferSeries.length,
    runBandwidthPoints.length,
    chronologicalRuns.length,
    rankedSystems.length,
    releaseTypesData.rows.length,
  ]);

  const meta = SLIDE_META[activeSlide];

  return (
    <div
      className="lg:col-span-6 border border-crt-border bg-crt-surface rounded-md p-5 flex flex-col justify-between"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false);
        setHoverState(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          stepSlide(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          stepSlide(1);
        }
      }}
    >
      {/* Top Header + Navigation Deck Bar */}
      <div className="space-y-3 mb-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-crt-text truncate">
              {meta.title}
            </h2>
            <p className="text-xs text-crt-muted truncate">{meta.subtitle}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeSlide === 'bandwidth' &&
              transferSeries.length >= 2 &&
              runBandwidthPoints.some((p) => p.run.bytesDownloaded > 0) && (
                <button
                  type="button"
                  onClick={() =>
                    setBandwidthSource((cur) =>
                      (cur === 'auto' ? effectiveBandwidthMode : cur) === 'stream' ? 'runs' : 'stream',
                    )
                  }
                  className="px-2 py-0.5 text-[11px] font-mono border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Switch between live stream samples and per-run average throughput"
                >
                  {effectiveBandwidthMode === 'stream' ? 'View: Live' : 'View: Runs'}
                </button>
              )}
            <span className="font-mono text-xs text-crt-muted tabular-nums whitespace-nowrap">
              {headerBadge}
            </span>
          </div>
        </div>

        {/* Slide Deck Switcher: 6 Tabs + Prev/Next Arrows + Auto-Cycle */}
        <div className="flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Telemetry graph views"
            className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded overflow-x-auto min-w-0"
          >
            {SLIDE_ORDER.map((id) => {
              const selected = activeSlide === id;
              return (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setActiveSlide(id)}
                  className={`px-2 py-1 text-[11px] font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selected
                      ? 'bg-crt-elevated text-crt-phosphor font-medium border border-crt-border-strong'
                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                  }`}
                >
                  {SLIDE_META[id].tabLabel}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => stepSlide(-1)}
              aria-label="Previous telemetry graph"
              title="Previous graph"
              className="p-1 border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepSlide(1)}
              aria-label="Next telemetry graph"
              title="Next graph"
              className="p-1 border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer shrink-0"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-pressed={autoCycle}
              onClick={() => setAutoCycle((v) => !v)}
              title={
                autoCycle
                  ? 'Auto-cycling slides every 8s (pauses on hover)'
                  : 'Enable automatic 8s slide cycling'
              }
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoCycle
                  ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor'
                  : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text'
              }`}
            >
              <Repeat className="h-3 w-3 shrink-0" />
              <span>Auto</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Grafana Viewport (Fixed 212px Height to Prevent Layout Shift) */}
      <div className="relative h-[212px] border border-crt-border bg-crt-bg rounded p-2.5 flex flex-col justify-center overflow-hidden select-none">
        {/* SLIDE 1: PACING */}
        {activeSlide === 'pacing' &&
          (delaySeries.length < 2 ? (
            <div className="text-center space-y-1.5 py-6">
              <Activity className="h-5 w-5 text-crt-muted mx-auto" />
              <p className="text-xs text-crt-text font-medium">Awaiting HTTP pacing telemetry</p>
              <p className="text-xs text-crt-muted max-w-xs mx-auto">
                Start a Dry Run, Incremental Sync, or login check to plot live AIMD delay and latency curves.
              </p>
            </div>
          ) : (
            (() => {
              const maxVal = Math.max(
                status.rateLimiter.baseDelayMs * 1.4,
                ...delaySeries.map((s) => Math.max(s.delayMs, s.latencyMs)),
                100,
              );
              const xFor = (i: number) => PAD_L + (i / Math.max(1, delaySeries.length - 1)) * PLOT_W;
              const yFor = (val: number) => PAD_T + PLOT_H - Math.min(1, Math.max(0, val / maxVal)) * PLOT_H;

              const delayPts = delaySeries.map((pt, i) => `${xFor(i).toFixed(1)},${yFor(pt.delayMs).toFixed(1)}`);
              const latPts = delaySeries.map((pt, i) => `${xFor(i).toFixed(1)},${yFor(pt.latencyMs).toFixed(1)}`);
              const areaPath = `M ${PAD_L},${PAD_T + PLOT_H} L ${delayPts.join(' L ')} L ${xFor(delaySeries.length - 1).toFixed(1)},${PAD_T + PLOT_H} Z`;

              const hIdx =
                hoverState !== null ? Math.min(delaySeries.length - 1, Math.max(0, hoverState.index)) : null;
              const hSample = hIdx !== null ? delaySeries[hIdx] : null;
              const hX = hIdx !== null ? xFor(hIdx) : 0;
              const hCursorY = hoverState !== null ? PAD_T + hoverState.normY * PLOT_H : 0;
              const cursorMs =
                hoverState !== null ? Math.round((1 - hoverState.normY) * maxVal) : 0;
              const flipLeft = hIdx !== null && hIdx / Math.max(1, delaySeries.length - 1) > 0.55;

              return (
                <div className="relative w-full h-full">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-full overflow-visible cursor-crosshair"
                    aria-label="Adaptive rate limiter pacing chart"
                    onPointerMove={(e) => handleSvgPointerMove(e, delaySeries.length, 'line')}
                    onPointerLeave={() => setHoverState(null)}
                  >
                    <defs>
                      <linearGradient id="crtPacingArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Y-Axis Gridlines & Labels */}
                    {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                      const y = PAD_T + PLOT_H - frac * PLOT_H;
                      const labelVal = Math.round(frac * maxVal);
                      return (
                        <g key={frac}>
                          <line
                            x1={PAD_L}
                            y1={y}
                            x2={VB_W - PAD_R}
                            y2={y}
                            stroke="var(--color-crt-border)"
                            strokeDasharray={frac === 0 ? undefined : '3 3'}
                            strokeWidth="1"
                          />
                          <text
                            x={PAD_L - 6}
                            y={y + 3}
                            textAnchor="end"
                            fill="var(--color-crt-muted)"
                            fontSize="9"
                            fontFamily="var(--font-mono)"
                          >
                            {labelVal}ms
                          </text>
                        </g>
                      );
                    })}

                    {/* X-Axis Timestamps */}
                    {[0, Math.floor((delaySeries.length - 1) / 2), delaySeries.length - 1]
                      .filter((v, idx, arr) => arr.indexOf(v) === idx)
                      .map((idx) => (
                        <text
                          key={idx}
                          x={xFor(idx)}
                          y={VB_H - 4}
                          textAnchor={idx === 0 ? 'start' : idx === delaySeries.length - 1 ? 'end' : 'middle'}
                          fill="var(--color-crt-muted)"
                          fontSize="9"
                          fontFamily="var(--font-mono)"
                        >
                          {formatTimeShort(delaySeries[idx].timestamp)}
                        </text>
                      ))}

                    {/* Area + Polylines */}
                    <path d={areaPath} fill="url(#crtPacingArea)" />
                    <polyline
                      fill="none"
                      stroke="var(--color-crt-amber)"
                      strokeWidth="1.5"
                      strokeOpacity="0.9"
                      points={latPts.join(' ')}
                    />
                    <polyline
                      fill="none"
                      stroke="var(--color-crt-phosphor)"
                      strokeWidth="2"
                      points={delayPts.join(' ')}
                    />

                    {/* Throttle Event Markers */}
                    {delaySeries.map((pt, i) => {
                      if (!pt.throttled) return null;
                      return (
                        <circle
                          key={i}
                          cx={xFor(i)}
                          cy={yFor(pt.delayMs)}
                          r="3.5"
                          fill="var(--color-crt-crimson)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1"
                        />
                      );
                    })}

                    {/* Grafana Snapped Crosshair & Active Point Rings */}
                    {hSample && (
                      <g pointerEvents="none">
                        <line
                          x1={hX}
                          y1={PAD_T}
                          x2={hX}
                          y2={PAD_T + PLOT_H}
                          stroke="var(--color-crt-text)"
                          strokeOpacity="0.5"
                          strokeDasharray="2 2"
                          strokeWidth="1"
                        />
                        <line
                          x1={PAD_L}
                          y1={hCursorY}
                          x2={VB_W - PAD_R}
                          y2={hCursorY}
                          stroke="var(--color-crt-muted)"
                          strokeOpacity="0.35"
                          strokeDasharray="2 3"
                          strokeWidth="1"
                        />
                        <rect
                          x={2}
                          y={Math.max(PAD_T, Math.min(PAD_T + PLOT_H - 13, hCursorY - 6.5))}
                          width={PAD_L - 5}
                          height={13}
                          rx={2}
                          fill="var(--color-crt-elevated)"
                          stroke="var(--color-crt-border-strong)"
                          strokeWidth="0.75"
                        />
                        <text
                          x={PAD_L - 6}
                          y={Math.max(PAD_T + 9, Math.min(PAD_T + PLOT_H - 3.5, hCursorY + 3))}
                          textAnchor="end"
                          fill="var(--color-crt-text)"
                          fontSize="8.5"
                          fontFamily="var(--font-mono)"
                        >
                          {cursorMs}ms
                        </text>

                        <circle
                          cx={hX}
                          cy={yFor(hSample.latencyMs)}
                          r="4"
                          fill="var(--color-crt-amber)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={hX}
                          cy={yFor(hSample.delayMs)}
                          r="4.5"
                          fill="var(--color-crt-phosphor)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1.5"
                        />
                      </g>
                    )}
                  </svg>

                  {/* Floating Grafana Tooltip */}
                  {hSample && hIdx !== null && (
                    <div
                      className={`pointer-events-none absolute top-2 z-20 w-48 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1 ${
                        flipLeft ? 'left-12' : 'right-2'
                      }`}
                    >
                      <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
                        <span>{formatTimeShort(hSample.timestamp)}</span>
                        <span>#{hIdx + 1}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-crt-muted">
                          <span
                            className="w-2 h-2 rounded-xs shrink-0"
                            style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
                          />
                          AIMD Delay
                        </span>
                        <span className="text-crt-text font-medium">{hSample.delayMs} ms</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-crt-muted">
                          <span
                            className="w-2 h-2 rounded-xs shrink-0"
                            style={{ backgroundColor: 'var(--color-crt-amber)' }}
                          />
                          Latency
                        </span>
                        <span className="text-crt-text font-medium">{hSample.latencyMs} ms</span>
                      </div>
                      {hSample.throttled && (
                        <div className="text-crt-crimson font-semibold pt-0.5">
                          429 / Retry-After Backoff
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          ))}

        {/* SLIDE 2: BANDWIDTH / SPEED */}
        {activeSlide === 'bandwidth' &&
          (effectiveBandwidthMode === 'stream' && transferSeries.length >= 2 ? (
            (() => {
              const maxBps = Math.max(
                1024 * 512,
                ...transferSeries.map((s) => s.bytesPerSec),
              );
              const xFor = (i: number) => PAD_L + (i / Math.max(1, transferSeries.length - 1)) * PLOT_W;
              const yFor = (bps: number) => PAD_T + PLOT_H - Math.min(1, Math.max(0, bps / maxBps)) * PLOT_H;

              const pts = transferSeries.map((pt, i) => `${xFor(i).toFixed(1)},${yFor(pt.bytesPerSec).toFixed(1)}`);
              const areaPath = `M ${PAD_L},${PAD_T + PLOT_H} L ${pts.join(' L ')} L ${xFor(transferSeries.length - 1).toFixed(1)},${PAD_T + PLOT_H} Z`;

              const hIdx =
                hoverState !== null ? Math.min(transferSeries.length - 1, Math.max(0, hoverState.index)) : null;
              const hPt = hIdx !== null ? transferSeries[hIdx] : null;
              const hX = hIdx !== null ? xFor(hIdx) : 0;
              const hCursorY = hoverState !== null ? PAD_T + hoverState.normY * PLOT_H : 0;
              const flipLeft = hIdx !== null && hIdx / Math.max(1, transferSeries.length - 1) > 0.55;

              return (
                <div className="relative w-full h-full">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-full overflow-visible cursor-crosshair"
                    aria-label="Live download speed chart"
                    onPointerMove={(e) => handleSvgPointerMove(e, transferSeries.length, 'line')}
                    onPointerLeave={() => setHoverState(null)}
                  >
                    <defs>
                      <linearGradient id="crtSpeedArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {[0, 0.5, 1].map((frac) => {
                      const y = PAD_T + PLOT_H - frac * PLOT_H;
                      const mbps = ((frac * maxBps) / (1024 * 1024)).toFixed(1);
                      return (
                        <g key={frac}>
                          <line
                            x1={PAD_L}
                            y1={y}
                            x2={VB_W - PAD_R}
                            y2={y}
                            stroke="var(--color-crt-border)"
                            strokeDasharray={frac === 0 ? undefined : '3 3'}
                            strokeWidth="1"
                          />
                          <text
                            x={PAD_L - 6}
                            y={y + 3}
                            textAnchor="end"
                            fill="var(--color-crt-muted)"
                            fontSize="8.5"
                            fontFamily="var(--font-mono)"
                          >
                            {mbps}M
                          </text>
                        </g>
                      );
                    })}

                    {[0, Math.floor((transferSeries.length - 1) / 2), transferSeries.length - 1]
                      .filter((v, idx, arr) => arr.indexOf(v) === idx)
                      .map((idx) => (
                        <text
                          key={idx}
                          x={xFor(idx)}
                          y={VB_H - 4}
                          textAnchor={idx === 0 ? 'start' : idx === transferSeries.length - 1 ? 'end' : 'middle'}
                          fill="var(--color-crt-muted)"
                          fontSize="9"
                          fontFamily="var(--font-mono)"
                        >
                          {formatTimeShort(transferSeries[idx].timestamp)}
                        </text>
                      ))}

                    <path d={areaPath} fill="url(#crtSpeedArea)" />
                    <polyline
                      fill="none"
                      stroke="var(--color-crt-phosphor)"
                      strokeWidth="2"
                      points={pts.join(' ')}
                    />

                    {hPt && (
                      <g pointerEvents="none">
                        <line
                          x1={hX}
                          y1={PAD_T}
                          x2={hX}
                          y2={PAD_T + PLOT_H}
                          stroke="var(--color-crt-text)"
                          strokeOpacity="0.5"
                          strokeDasharray="2 2"
                          strokeWidth="1"
                        />
                        <line
                          x1={PAD_L}
                          y1={hCursorY}
                          x2={VB_W - PAD_R}
                          y2={hCursorY}
                          stroke="var(--color-crt-muted)"
                          strokeOpacity="0.35"
                          strokeDasharray="2 3"
                          strokeWidth="1"
                        />
                        <circle
                          cx={hX}
                          cy={yFor(hPt.bytesPerSec)}
                          r="4.5"
                          fill="var(--color-crt-phosphor)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1.5"
                        />
                      </g>
                    )}
                  </svg>

                  {hPt && (
                    <div
                      className={`pointer-events-none absolute top-2 z-20 w-56 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1 ${
                        flipLeft ? 'left-12' : 'right-2'
                      }`}
                    >
                      <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
                        <span>{formatTimeShort(hPt.timestamp)}</span>
                        <span className="text-crt-phosphor font-semibold">
                          {formatMbps(hPt.bytesPerSec)}
                        </span>
                      </div>
                      <div className="text-crt-text truncate" title={hPt.filename}>
                        {hPt.systemName} / {hPt.filename}
                      </div>
                      <div className="flex items-center justify-between text-crt-muted">
                        <span>Transferred</span>
                        <span className="text-crt-text">
                          {formatBytes(hPt.bytesReceived)}
                          {hPt.totalBytes ? ` / ${formatBytes(hPt.totalBytes)}` : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : runBandwidthPoints.some((p) => p.run.bytesDownloaded > 0) ? (
            (() => {
              const maxRunBps = Math.max(
                1024 * 256,
                ...runBandwidthPoints.map((p) => p.avgBytesPerSec),
              );
              const count = runBandwidthPoints.length;
              const slotW = PLOT_W / Math.max(1, count);
              const barW = Math.min(24, Math.max(6, slotW * 0.58));

              const hIdx =
                hoverState !== null ? Math.min(count - 1, Math.max(0, hoverState.index)) : null;
              const hItem = hIdx !== null ? runBandwidthPoints[hIdx] : null;
              const flipLeft = hIdx !== null && (hIdx + 0.5) / Math.max(1, count) > 0.55;

              return (
                <div className="relative w-full h-full">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-full overflow-visible cursor-crosshair"
                    aria-label="Per-run download throughput chart"
                    onPointerMove={(e) => handleSvgPointerMove(e, count, 'bar')}
                    onPointerLeave={() => setHoverState(null)}
                  >
                    {[0, 0.5, 1].map((frac) => {
                      const y = PAD_T + PLOT_H - frac * PLOT_H;
                      const mbps = ((frac * maxRunBps) / (1024 * 1024)).toFixed(1);
                      return (
                        <g key={frac}>
                          <line
                            x1={PAD_L}
                            y1={y}
                            x2={VB_W - PAD_R}
                            y2={y}
                            stroke="var(--color-crt-border)"
                            strokeDasharray={frac === 0 ? undefined : '3 3'}
                            strokeWidth="1"
                          />
                          <text
                            x={PAD_L - 6}
                            y={y + 3}
                            textAnchor="end"
                            fill="var(--color-crt-muted)"
                            fontSize="8.5"
                            fontFamily="var(--font-mono)"
                          >
                            {mbps}M
                          </text>
                        </g>
                      );
                    })}

                    {runBandwidthPoints.map((pt, i) => {
                      const cx = PAD_L + (i + 0.5) * slotW;
                      const h = Math.max(
                        pt.avgBytesPerSec > 0 ? 2 : 0,
                        (pt.avgBytesPerSec / maxRunBps) * PLOT_H,
                      );
                      const isHovered = hIdx === i;
                      return (
                        <g key={pt.run.id}>
                          {isHovered && (
                            <rect
                              x={PAD_L + i * slotW}
                              y={PAD_T}
                              width={slotW}
                              height={PLOT_H}
                              fill="var(--color-crt-elevated)"
                              opacity="0.65"
                            />
                          )}
                          <rect
                            x={cx - barW / 2}
                            y={PAD_T + PLOT_H - h}
                            width={barW}
                            height={h}
                            rx={1.5}
                            fill="var(--color-crt-phosphor)"
                            fillOpacity={isHovered ? 1 : 0.78}
                          />
                          {(count <= 8 || i % 2 === 0 || i === count - 1) && (
                            <text
                              x={cx}
                              y={VB_H - 4}
                              textAnchor="middle"
                              fill="var(--color-crt-muted)"
                              fontSize="8.5"
                              fontFamily="var(--font-mono)"
                            >
                              #{pt.run.id}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {hItem && (
                    <div
                      className={`pointer-events-none absolute top-2 z-20 w-52 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1 ${
                        flipLeft ? 'left-12' : 'right-2'
                      }`}
                    >
                      <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
                        <span className="text-crt-text font-medium">Run #{hItem.run.id}</span>
                        <span>{hItem.run.mode}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Avg Speed</span>
                        <span className="text-crt-phosphor font-medium">
                          {formatMbps(hItem.avgBytesPerSec)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Mirrored</span>
                        <span className="text-crt-text">{formatBytes(hItem.run.bytesDownloaded)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Duration</span>
                        <span className="text-crt-text">
                          {formatRunDuration(hItem.run.startedAt, hItem.run.finishedAt)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="text-center space-y-1.5 py-6">
              <Download className="h-5 w-5 text-crt-muted mx-auto" />
              <p className="text-xs text-crt-text font-medium">No active or recorded file transfers yet</p>
              <p className="text-xs text-crt-muted max-w-xs mx-auto">
                Run an Incremental Sync or Full Sync to stream real-time MB/s download curves here.
              </p>
            </div>
          ))}

        {/* SLIDE 3: OUTCOMES (SYNC RUNS STACKED BARS + VOLUME) */}
        {activeSlide === 'outcomes' &&
          (chronologicalRuns.length === 0 ? (
            <div className="text-center space-y-1.5 py-6">
              <Clock className="h-5 w-5 text-crt-muted mx-auto" />
              <p className="text-xs text-crt-text font-medium">No sync runs recorded yet</p>
              <p className="text-xs text-crt-muted max-w-xs mx-auto">
                Completed and running sync executions will plot downloaded, skipped, and failed item stacks here.
              </p>
            </div>
          ) : (
            (() => {
              const count = chronologicalRuns.length;
              const maxStack = Math.max(
                1,
                ...chronologicalRuns.map(
                  (r) => r.downloadedCount + r.skippedCount + r.failedCount || r.newFound || 0,
                ),
              );
              const maxBytes = Math.max(1, ...chronologicalRuns.map((r) => r.bytesDownloaded));
              const slotW = PLOT_W / count;
              const barW = Math.min(24, Math.max(6, slotW * 0.58));

              const byteLinePts = chronologicalRuns.map((r, i) => {
                const cx = PAD_L + (i + 0.5) * slotW;
                const y = PAD_T + PLOT_H - (r.bytesDownloaded / maxBytes) * (PLOT_H * 0.88);
                return `${cx.toFixed(1)},${y.toFixed(1)}`;
              });

              const hIdx =
                hoverState !== null ? Math.min(count - 1, Math.max(0, hoverState.index)) : null;
              const hRun = hIdx !== null ? chronologicalRuns[hIdx] : null;
              const flipLeft = hIdx !== null && (hIdx + 0.5) / count > 0.55;

              return (
                <div className="relative w-full h-full">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-full overflow-visible cursor-crosshair"
                    aria-label="Sync run outcomes stacked bar chart"
                    onPointerMove={(e) => handleSvgPointerMove(e, count, 'bar')}
                    onPointerLeave={() => setHoverState(null)}
                  >
                    {[0, 0.5, 1].map((frac) => {
                      const y = PAD_T + PLOT_H - frac * PLOT_H;
                      return (
                        <g key={frac}>
                          <line
                            x1={PAD_L}
                            y1={y}
                            x2={VB_W - PAD_R}
                            y2={y}
                            stroke="var(--color-crt-border)"
                            strokeDasharray={frac === 0 ? undefined : '3 3'}
                            strokeWidth="1"
                          />
                          <text
                            x={PAD_L - 6}
                            y={y + 3}
                            textAnchor="end"
                            fill="var(--color-crt-muted)"
                            fontSize="8.5"
                            fontFamily="var(--font-mono)"
                          >
                            {Math.round(frac * maxStack)}
                          </text>
                        </g>
                      );
                    })}

                    {chronologicalRuns.map((r, i) => {
                      const cx = PAD_L + (i + 0.5) * slotW;
                      const dlH = (r.downloadedCount / maxStack) * PLOT_H;
                      const skH = (r.skippedCount / maxStack) * PLOT_H;
                      const flH = (r.failedCount / maxStack) * PLOT_H;
                      const dryH =
                        dlH + skH + flH === 0 && r.newFound > 0
                          ? (r.newFound / maxStack) * PLOT_H
                          : 0;
                      const isHovered = hIdx === i;

                      let curY = PAD_T + PLOT_H;
                      return (
                        <g key={r.id}>
                          {isHovered && (
                            <rect
                              x={PAD_L + i * slotW}
                              y={PAD_T}
                              width={slotW}
                              height={PLOT_H}
                              fill="var(--color-crt-elevated)"
                              opacity="0.7"
                            />
                          )}
                          {dlH > 0 && (
                            <rect
                              x={cx - barW / 2}
                              y={(curY -= dlH)}
                              width={barW}
                              height={dlH}
                              fill="var(--color-crt-phosphor)"
                            />
                          )}
                          {skH > 0 && (
                            <rect
                              x={cx - barW / 2}
                              y={(curY -= skH)}
                              width={barW}
                              height={skH}
                              fill="var(--color-crt-border-strong)"
                            />
                          )}
                          {flH > 0 && (
                            <rect
                              x={cx - barW / 2}
                              y={(curY -= flH)}
                              width={barW}
                              height={flH}
                              fill="var(--color-crt-crimson)"
                            />
                          )}
                          {dryH > 0 && (
                            <rect
                              x={cx - barW / 2}
                              y={PAD_T + PLOT_H - dryH}
                              width={barW}
                              height={dryH}
                              fill="none"
                              stroke="var(--color-crt-phosphor)"
                              strokeDasharray="2 2"
                              strokeWidth="1.2"
                            />
                          )}
                          {(count <= 8 || i % 2 === 0 || i === count - 1) && (
                            <text
                              x={cx}
                              y={VB_H - 4}
                              textAnchor="middle"
                              fill="var(--color-crt-muted)"
                              fontSize="8.5"
                              fontFamily="var(--font-mono)"
                            >
                              #{r.id}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {chronologicalRuns.some((r) => r.bytesDownloaded > 0) && count >= 2 && (
                      <polyline
                        fill="none"
                        stroke="var(--color-crt-amber)"
                        strokeWidth="1.5"
                        points={byteLinePts.join(' ')}
                      />
                    )}

                    {hRun && hIdx !== null && hRun.bytesDownloaded > 0 && (
                      <circle
                        cx={PAD_L + (hIdx + 0.5) * slotW}
                        cy={PAD_T + PLOT_H - (hRun.bytesDownloaded / maxBytes) * (PLOT_H * 0.88)}
                        r="3.5"
                        fill="var(--color-crt-amber)"
                        stroke="var(--color-crt-bg)"
                        strokeWidth="1.5"
                      />
                    )}
                  </svg>

                  {hRun && (
                    <div
                      className={`pointer-events-none absolute top-2 z-20 w-52 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1 ${
                        flipLeft ? 'left-12' : 'right-2'
                      }`}
                    >
                      <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
                        <span className="text-crt-text font-semibold">
                          Run #{hRun.id} · {hRun.mode}
                        </span>
                        <span>{formatRunDuration(hRun.startedAt, hRun.finishedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-phosphor">Downloaded</span>
                        <span className="text-crt-text">{hRun.downloadedCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Skipped (Disk)</span>
                        <span className="text-crt-text">{hRun.skippedCount}</span>
                      </div>
                      {hRun.failedCount > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-crt-crimson">Failed</span>
                          <span className="text-crt-crimson font-medium">{hRun.failedCount}</span>
                        </div>
                      )}
                      {hRun.mode === 'dry_run' && (
                        <div className="flex items-center justify-between">
                          <span className="text-crt-muted">New Discovered</span>
                          <span className="text-crt-text">{hRun.newFound}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-crt-border pt-1">
                        <span className="text-crt-amber">Bytes Saved</span>
                        <span className="text-crt-text">{formatBytes(hRun.bytesDownloaded)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ))}

        {/* SLIDE 4: CONSOLES STORAGE FOOTPRINT */}
        {activeSlide === 'consoles' &&
          (rankedSystems.length === 0 ? (
            <div className="text-center space-y-1.5 py-6">
              <HardDrive className="h-5 w-5 text-crt-muted mx-auto" />
              <p className="text-xs text-crt-text font-medium">No mirrored console storage yet</p>
              <p className="text-xs text-crt-muted max-w-xs mx-auto">
                Console storage breakdown populates automatically once releases are indexed and mirrored.
              </p>
            </div>
          ) : (
            (() => {
              const totalBytesAll = Math.max(
                1,
                rankedSystems.reduce((acc, s) => acc + s.totalBytes, 0),
              );
              const maxSysBytes = Math.max(1, rankedSystems[0]?.totalBytes || 1);
              const maxSysItems = Math.max(1, ...rankedSystems.map((s) => s.totalItems));
              const useBytes = rankedSystems.some((s) => s.totalBytes > 0);
              const hIdx = hoverState?.index ?? null;
              const hSys = hIdx !== null ? rankedSystems[hIdx] : null;

              return (
                <div className="relative w-full h-full flex flex-col">
                  <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
                    {rankedSystems.map((sys, idx) => {
                      const pctWidth = useBytes
                        ? (sys.totalBytes / maxSysBytes) * 100
                        : (sys.totalItems / maxSysItems) * 100;
                      const sharePct = useBytes
                        ? ((sys.totalBytes / totalBytesAll) * 100).toFixed(1)
                        : (
                            (sys.totalItems / Math.max(1, status.totals.totalCatalogItems)) *
                            100
                          ).toFixed(1);
                      const hovered = hIdx === idx;

                      return (
                        <div
                          key={sys.systemName}
                          onPointerEnter={() =>
                            setHoverState({
                              index: idx,
                              normX: 0.5,
                              normY: idx / Math.max(1, rankedSystems.length),
                            })
                          }
                          className={`px-2 py-1 rounded transition-colors cursor-crosshair ${
                            hovered ? 'bg-crt-elevated' : 'hover:bg-crt-elevated/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums mb-1">
                            <span className="text-crt-text truncate font-medium">{sys.systemName}</span>
                            <span className="text-crt-muted shrink-0">
                              {useBytes ? formatBytes(sys.totalBytes) : `${sys.totalItems} items`} ·{' '}
                              <span className="text-crt-phosphor">{sharePct}%</span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-crt-surface rounded-xs overflow-hidden">
                            <div
                              className="h-full transition-all duration-150"
                              style={{
                                width: `${Math.max(2, pctWidth)}%`,
                                backgroundColor: hovered
                                  ? 'var(--color-crt-phosphor)'
                                  : 'var(--color-crt-phosphor-dim)',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {hSys && (
                    <div className="pointer-events-none absolute bottom-2 right-2 z-20 w-56 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1">
                      <div className="flex items-center justify-between border-b border-crt-border pb-1">
                        <span className="text-crt-text font-semibold truncate">{hSys.systemName}</span>
                        <span className="text-crt-phosphor shrink-0">
                          {useBytes
                            ? `${((hSys.totalBytes / totalBytesAll) * 100).toFixed(1)}%`
                            : `${hSys.totalItems} rel`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Disk Size</span>
                        <span className="text-crt-text">{formatBytes(hSys.totalBytes)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Downloaded</span>
                        <span className="text-crt-phosphor">
                          {hSys.downloadedItems} / {hSys.totalItems}
                        </span>
                      </div>
                      {hSys.failedItems > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-crt-crimson">Failed / Partial</span>
                          <span className="text-crt-crimson">{hSys.failedItems}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          ))}

        {/* SLIDE 5: DOWNLOADED RELEASE TYPES */}
        {activeSlide === 'types' &&
          (releaseTypesData.rows.length === 0 ? (
            <div className="text-center space-y-1.5 py-6">
              <Gamepad2 className="h-5 w-5 text-crt-muted mx-auto" />
              <p className="text-xs text-crt-text font-medium">No categorized ROM types yet</p>
              <p className="text-xs text-crt-muted max-w-xs mx-auto">
                Downloaded translations, ROM hacks, ports, homebrew, and retail games will break down here.
              </p>
            </div>
          ) : (
            (() => {
              const { rows, usingDownloadedOnly } = releaseTypesData;
              const denomCount = usingDownloadedOnly
                ? Math.max(1, status.totals.downloadedItems + status.totals.skippedItems)
                : Math.max(1, status.totals.totalCatalogItems);
              const maxCount = Math.max(
                1,
                ...rows.map((r) => (usingDownloadedOnly ? r.downloadedItems : r.totalItems)),
              );
              const hIdx = hoverState?.index ?? null;
              const hType = hIdx !== null ? rows[hIdx] : null;

              return (
                <div className="relative w-full h-full flex flex-col">
                  <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
                    {rows.map((row, idx) => {
                      const countVal = usingDownloadedOnly ? row.downloadedItems : row.totalItems;
                      const barPct = (countVal / maxCount) * 100;
                      const sharePct = Math.min(100, (countVal / denomCount) * 100).toFixed(1);
                      const accent = classifyTypeAccent(row.typeName);
                      const hovered = hIdx === idx;

                      return (
                        <div
                          key={row.typeName}
                          onPointerEnter={() =>
                            setHoverState({
                              index: idx,
                              normX: 0.5,
                              normY: idx / Math.max(1, rows.length),
                            })
                          }
                          className={`px-2 py-1 rounded transition-colors cursor-crosshair ${
                            hovered ? 'bg-crt-elevated' : 'hover:bg-crt-elevated/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums mb-1">
                            <span className="inline-flex items-center gap-1.5 min-w-0 text-crt-text font-medium">
                              <span
                                className="w-2 h-2 rounded-xs shrink-0"
                                style={{ backgroundColor: accent.dotColor }}
                              />
                              <span className="truncate">{row.typeName}</span>
                            </span>
                            <span className="text-crt-muted shrink-0">
                              <span className="text-crt-text">{countVal.toLocaleString()}</span> ·{' '}
                              <span className="text-crt-phosphor">{sharePct}%</span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-crt-surface rounded-xs overflow-hidden">
                            <div
                              className="h-full transition-all duration-150"
                              style={{
                                width: `${Math.max(2, barPct)}%`,
                                backgroundColor: accent.barStyle,
                                opacity: hovered ? 1 : 0.85,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {hType && (
                    <div className="pointer-events-none absolute bottom-2 right-2 z-20 w-56 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1">
                      <div className="flex items-center justify-between gap-2 border-b border-crt-border pb-1">
                        <span className="text-crt-text font-semibold truncate">{hType.typeName}</span>
                        <span className="text-crt-phosphor shrink-0">
                          {Math.min(
                            100,
                            ((usingDownloadedOnly ? hType.downloadedItems : hType.totalItems) /
                              denomCount) *
                              100,
                          ).toFixed(1)}
                          %
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Downloaded</span>
                        <span className="text-crt-phosphor font-medium">
                          {hType.downloadedItems.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Indexed Total</span>
                        <span className="text-crt-text">{hType.totalItems.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-muted">Disk Footprint</span>
                        <span className="text-crt-text">{formatBytes(hType.totalBytes)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ))}

        {/* SLIDE 6: LATENCY PERCENTILES (ROLLING P50 / P95 / MAX) */}
        {activeSlide === 'percentiles' &&
          (rollingPercentiles.length < 2 ? (
            <div className="text-center space-y-1.5 py-6">
              <Layers className="h-5 w-5 text-crt-muted mx-auto" />
              <p className="text-xs text-crt-text font-medium">Awaiting latency percentile samples</p>
              <p className="text-xs text-crt-muted max-w-xs mx-auto">
                Rolling p50 median, p95 tail, and peak response latency curves appear as HTTP requests complete.
              </p>
            </div>
          ) : (
            (() => {
              const maxLat = Math.max(
                100,
                ...rollingPercentiles.map((p) => p.max),
              );
              const xFor = (i: number) =>
                PAD_L + (i / Math.max(1, rollingPercentiles.length - 1)) * PLOT_W;
              const yFor = (ms: number) =>
                PAD_T + PLOT_H - Math.min(1, Math.max(0, ms / maxLat)) * PLOT_H;

              const p50Pts = rollingPercentiles.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.p50).toFixed(1)}`);
              const p95Pts = rollingPercentiles.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.p95).toFixed(1)}`);
              const maxPts = rollingPercentiles.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.max).toFixed(1)}`);
              const p50Area = `M ${PAD_L},${PAD_T + PLOT_H} L ${p50Pts.join(' L ')} L ${xFor(rollingPercentiles.length - 1).toFixed(1)},${PAD_T + PLOT_H} Z`;

              const hIdx =
                hoverState !== null
                  ? Math.min(rollingPercentiles.length - 1, Math.max(0, hoverState.index))
                  : null;
              const hPt = hIdx !== null ? rollingPercentiles[hIdx] : null;
              const hX = hIdx !== null ? xFor(hIdx) : 0;
              const hCursorY = hoverState !== null ? PAD_T + hoverState.normY * PLOT_H : 0;
              const flipLeft =
                hIdx !== null && hIdx / Math.max(1, rollingPercentiles.length - 1) > 0.55;

              return (
                <div className="relative w-full h-full">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-full overflow-visible cursor-crosshair"
                    aria-label="Upstream latency percentiles chart"
                    onPointerMove={(e) => handleSvgPointerMove(e, rollingPercentiles.length, 'line')}
                    onPointerLeave={() => setHoverState(null)}
                  >
                    <defs>
                      <linearGradient id="crtP50Area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="var(--color-crt-phosphor)" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {[0, 0.5, 1].map((frac) => {
                      const y = PAD_T + PLOT_H - frac * PLOT_H;
                      return (
                        <g key={frac}>
                          <line
                            x1={PAD_L}
                            y1={y}
                            x2={VB_W - PAD_R}
                            y2={y}
                            stroke="var(--color-crt-border)"
                            strokeDasharray={frac === 0 ? undefined : '3 3'}
                            strokeWidth="1"
                          />
                          <text
                            x={PAD_L - 6}
                            y={y + 3}
                            textAnchor="end"
                            fill="var(--color-crt-muted)"
                            fontSize="8.5"
                            fontFamily="var(--font-mono)"
                          >
                            {Math.round(frac * maxLat)}ms
                          </text>
                        </g>
                      );
                    })}

                    {[0, Math.floor((rollingPercentiles.length - 1) / 2), rollingPercentiles.length - 1]
                      .filter((v, idx, arr) => arr.indexOf(v) === idx)
                      .map((idx) => (
                        <text
                          key={idx}
                          x={xFor(idx)}
                          y={VB_H - 4}
                          textAnchor={
                            idx === 0
                              ? 'start'
                              : idx === rollingPercentiles.length - 1
                                ? 'end'
                                : 'middle'
                          }
                          fill="var(--color-crt-muted)"
                          fontSize="9"
                          fontFamily="var(--font-mono)"
                        >
                          {formatTimeShort(rollingPercentiles[idx].timestamp)}
                        </text>
                      ))}

                    <path d={p50Area} fill="url(#crtP50Area)" />
                    <polyline
                      fill="none"
                      stroke="var(--color-crt-crimson)"
                      strokeWidth="1.2"
                      strokeDasharray="3 2"
                      strokeOpacity="0.75"
                      points={maxPts.join(' ')}
                    />
                    <polyline
                      fill="none"
                      stroke="var(--color-crt-amber)"
                      strokeWidth="1.6"
                      points={p95Pts.join(' ')}
                    />
                    <polyline
                      fill="none"
                      stroke="var(--color-crt-phosphor)"
                      strokeWidth="2"
                      points={p50Pts.join(' ')}
                    />

                    {hPt && (
                      <g pointerEvents="none">
                        <line
                          x1={hX}
                          y1={PAD_T}
                          x2={hX}
                          y2={PAD_T + PLOT_H}
                          stroke="var(--color-crt-text)"
                          strokeOpacity="0.5"
                          strokeDasharray="2 2"
                          strokeWidth="1"
                        />
                        <line
                          x1={PAD_L}
                          y1={hCursorY}
                          x2={VB_W - PAD_R}
                          y2={hCursorY}
                          stroke="var(--color-crt-muted)"
                          strokeOpacity="0.35"
                          strokeDasharray="2 3"
                          strokeWidth="1"
                        />
                        <circle
                          cx={hX}
                          cy={yFor(hPt.max)}
                          r="3.5"
                          fill="var(--color-crt-crimson)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1.2"
                        />
                        <circle
                          cx={hX}
                          cy={yFor(hPt.p95)}
                          r="4"
                          fill="var(--color-crt-amber)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={hX}
                          cy={yFor(hPt.p50)}
                          r="4.5"
                          fill="var(--color-crt-phosphor)"
                          stroke="var(--color-crt-bg)"
                          strokeWidth="1.5"
                        />
                      </g>
                    )}
                  </svg>

                  {hPt && (
                    <div
                      className={`pointer-events-none absolute top-2 z-20 w-48 border border-crt-border-strong bg-crt-bg/95 px-2.5 py-2 rounded text-[11px] font-mono tabular-nums shadow-lg space-y-1 ${
                        flipLeft ? 'left-12' : 'right-2'
                      }`}
                    >
                      <div className="flex items-center justify-between text-crt-muted border-b border-crt-border pb-1">
                        <span>{formatTimeShort(hPt.timestamp)}</span>
                        <span>req {hPt.sampleMs}ms</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-phosphor">Rolling p50</span>
                        <span className="text-crt-text font-medium">{hPt.p50} ms</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-amber">Rolling p95</span>
                        <span className="text-crt-text font-medium">{hPt.p95} ms</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-crt-crimson">Window Max</span>
                        <span className="text-crt-text">{hPt.max} ms</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          ))}
      </div>

      {/* Grafana Tabular Summary Legend Footer */}
      <div className="mt-3 pt-2.5 border-t border-crt-border/80 text-[11px] font-mono tabular-nums">
        {activeSlide === 'pacing' && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-crt-text">
                <span
                  className="w-2 h-2 rounded-xs shrink-0"
                  style={{ backgroundColor: 'var(--color-crt-phosphor)' }}
                />
                AIMD Delay
              </span>
              <span className="text-crt-muted">
                min <span className="text-crt-text">{pacingStats.delayMin}ms</span> · avg{' '}
                <span className="text-crt-text">{pacingStats.delayAvg}ms</span> · max{' '}
                <span className="text-crt-text">{pacingStats.delayMax}ms</span> · last{' '}
                <span className="text-crt-phosphor">{pacingStats.delayLast}ms</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-crt-text">
                <span
                  className="w-2 h-2 rounded-xs shrink-0"
                  style={{ backgroundColor: 'var(--color-crt-amber)' }}
                />
                HTTP Latency
              </span>
              <span className="text-crt-muted">
                min <span className="text-crt-text">{pacingStats.latMin}ms</span> · avg{' '}
                <span className="text-crt-text">{pacingStats.latAvg}ms</span> · max{' '}
                <span className="text-crt-text">{pacingStats.latMax}ms</span> · last{' '}
                <span className="text-crt-amber">{pacingStats.latLast}ms</span>
              </span>
            </div>
          </div>
        )}

        {activeSlide === 'bandwidth' &&
          (() => {
            const bpsValues =
              effectiveBandwidthMode === 'stream' && transferSeries.length > 0
                ? transferSeries.map((s) => s.bytesPerSec)
                : runBandwidthPoints.map((p) => p.avgBytesPerSec).filter((v) => v > 0);
            const peak = bpsValues.length > 0 ? Math.max(...bpsValues) : 0;
            const avg =
              bpsValues.length > 0
                ? bpsValues.reduce((a, b) => a + b, 0) / bpsValues.length
                : 0;
            const current =
              status.activeTransfer?.bytesPerSec ??
              (bpsValues.length > 0 ? bpsValues[bpsValues.length - 1] : 0);

            return (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-crt-muted">
                    Peak <span className="text-crt-phosphor">{formatMbps(peak)}</span> · Avg{' '}
                    <span className="text-crt-text">{formatMbps(avg)}</span>
                  </span>
                  <span className="text-crt-muted">
                    {status.activeTransfer ? 'Live' : 'Last'}{' '}
                    <span className="text-crt-text">{formatMbps(current)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-crt-muted">
                  <span>Total Archive Mirrored</span>
                  <span className="text-crt-text">
                    {formatBytes(status.totals.totalBytesMirrored)}
                  </span>
                </div>
              </div>
            );
          })()}

        {activeSlide === 'outcomes' &&
          (() => {
            const dlSum = chronologicalRuns.reduce((a, r) => a + r.downloadedCount, 0);
            const skSum = chronologicalRuns.reduce((a, r) => a + r.skippedCount, 0);
            const flSum = chronologicalRuns.reduce((a, r) => a + r.failedCount, 0);
            const bytesSum = chronologicalRuns.reduce((a, r) => a + r.bytesDownloaded, 0);
            return (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-crt-muted">
                    Saved <span className="text-crt-phosphor">{dlSum}</span> · Skipped{' '}
                    <span className="text-crt-text">{skSum}</span> · Failed{' '}
                    <span className={flSum > 0 ? 'text-crt-crimson' : 'text-crt-text'}>{flSum}</span>
                  </span>
                  <span className="text-crt-muted">
                    Window <span className="text-crt-amber">{formatBytes(bytesSum)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-crt-muted">
                  <span>Bars: Saved / Skipped / Failed</span>
                  <span>Line: Mirrored Bytes</span>
                </div>
              </div>
            );
          })()}

        {activeSlide === 'consoles' &&
          (() => {
            const top = rankedSystems[0];
            const totalB = Math.max(1, rankedSystems.reduce((a, s) => a + s.totalBytes, 0));
            return (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-crt-muted truncate">
                    Largest:{' '}
                    <span className="text-crt-phosphor">
                      {top ? `${top.systemName} (${((top.totalBytes / totalB) * 100).toFixed(1)}%)` : '—'}
                    </span>
                  </span>
                  <span className="text-crt-muted shrink-0">
                    Disk <span className="text-crt-text">{formatBytes(status.storage.totalBytesOnDisk)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-crt-muted">
                  <span>Mirrored Consoles: {rankedSystems.length}</span>
                  <span>Hover any console bar for breakdown</span>
                </div>
              </div>
            );
          })()}

        {activeSlide === 'types' &&
          (() => {
            const { rows, usingDownloadedOnly } = releaseTypesData;
            const top = rows[0];
            const modCount = rows
              .filter((r) => classifyTypeAccent(r.typeName).isModOrTrans)
              .reduce((acc, r) => acc + (usingDownloadedOnly ? r.downloadedItems : r.totalItems), 0);
            const denom = usingDownloadedOnly
              ? Math.max(1, status.totals.downloadedItems + status.totals.skippedItems)
              : Math.max(1, status.totals.totalCatalogItems);

            return (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-crt-muted truncate">
                    Top:{' '}
                    <span className="text-crt-phosphor">
                      {top
                        ? `${top.typeName} (${usingDownloadedOnly ? top.downloadedItems : top.totalItems})`
                        : '—'}
                    </span>
                  </span>
                  <span className="text-crt-muted shrink-0">
                    {usingDownloadedOnly ? 'Downloaded' : 'Indexed'}{' '}
                    <span className="text-crt-text">{denom.toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-crt-muted">
                  <span>Mods / Translations / Ports tags: {modCount.toLocaleString()}</span>
                  <span>{usingDownloadedOnly ? 'On-disk releases' : 'Dry-run preview'}</span>
                </div>
              </div>
            );
          })()}

        {activeSlide === 'percentiles' && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-crt-muted">
                p50 <span className="text-crt-phosphor">{pacingStats.p50}ms</span> · p90{' '}
                <span className="text-crt-text">{pacingStats.p90}ms</span> · p95{' '}
                <span className="text-crt-amber">{pacingStats.p95}ms</span>
              </span>
              <span className="text-crt-muted">
                max <span className="text-crt-crimson">{pacingStats.latMax}ms</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-crt-muted">
              <span>Rolling 12-request percentile window</span>
              <span>Tracked: {status.rateLimiter.totalRequests} reqs</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
