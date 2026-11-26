import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FlaskConical,
  Gamepad2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { EphemeralInlineNotice, EphemeralNotice } from './EphemeralNotice';
import type {
  BulkInstallKnownItemMeta,
  BulkStorageInstallerController,
} from '../hooks/useBulkStorageInstaller';
import {
  computeSyncSpeedWaveParams,
  type CrtPalette,
  type CrtUiMotionLevel,
} from '../shared/crtDisplay';
import {
  formatAllowedReleaseTypesSummary,
  normalizeAllowedReleaseTypes,
} from '../shared/releaseTypeFilter';
import {
  formatAutoResumeDuration,
  formatInterruptionCauseLabel,
} from '../shared/queueAutoResume';
import type { SmartRomFilterContext } from '../shared/smartRomPicker';
import type {
  ActiveTransferState,
  ActivityLogRecord,
  LogLevel,
  OperationsSectionTarget,
  RepositoryItemRecord,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  SyncPreflightSummary,
  SyncRunRecord,
} from '../types';
import { resolveItemDeviceInstallState } from '../utils/deviceInstallView';
import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatRunDuration,
  formatTimeShort,
} from '../utils/format';
import { isFileSystemAccessSupported } from '../utils/sdCardFs';
import {
  type ActiveSyncTargetCover,
  HERO_DETAIL_LOADING_DELAY_MS,
  computeHeroCoverFrameWidthPx,
  deriveSyncReleaseIdentityKey,
  getHeroSwapDurationMs,
  parseSyncStatusHeader,
  resolveActiveSyncTargetCover,
} from '../utils/syncStatusPhase';
import { FailedQueueDrawer } from './FailedQueueDrawer';
import { GameDetailDrawer } from './GameDetailDrawer';
import { LivingNavIcon, LivingTerminalIcon } from './LivingNavIcon';
import { SyncSpeedWaveCanvas } from './SyncSpeedWaveCanvas';
import { TelemetryDeck } from './TelemetryDeck';

interface OverviewPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  installer: BulkStorageInstallerController;
  runs: SyncRunRecord[];
  logs: ActivityLogRecord[];
  preflight?: SyncPreflightSummary | null;
  logsClearedRevision?: number;
  catalogRevision: number;
  activeRetryItemId?: number | null;
  uiMotion?: CrtUiMotionLevel;
  syncSpeedWave?: boolean;
  crtPalette?: CrtPalette;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
  onClearLogs: (level: 'all' | LogLevel) => Promise<void>;
  onClearRuns: () => Promise<void>;
  onNavigateToOperations: (target?: OperationsSectionTarget) => void;
  onQueueRuleMatches?: () => Promise<void>;
  onPreviewRuleMatchesInCatalog?: (onlyNotDownloaded?: boolean) => void;
  onQueueDownload?: (ids: number[]) => Promise<unknown>;
  onResumeDownloadQueue?: () => Promise<{ queuedCount?: number; skippedCount?: number } | void>;
  onPauseQueueAutoResume?: () => Promise<void>;
  onClearDownloadQueue?: () => Promise<{ clearedCount?: number } | void>;
  onViewQueuedInCatalog?: () => void;
  onRetryItem: (itemId: number, fileId?: number, options?: { dryRun?: boolean }) => Promise<void>;
  onRetryAllFailed: (options?: { system?: string; ids?: number[]; dryRun?: boolean }) => Promise<void>;
  onStartCatalogIndex?: (scope: 'filtered' | 'full', options?: { forceFull?: boolean }) => Promise<void>;
  onStopCatalogIndex?: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

interface LogFilterOption {
  value: 'all' | LogLevel;
  label: string;
  clearLabel: string;
  emptyLabel: string;
  activeClass: string;
}

const LOG_FILTER_OPTIONS: readonly LogFilterOption[] = [
  {
    value: 'all',
    label: 'All Events',
    clearLabel: 'All',
    emptyLabel: 'events',
    activeClass: 'bg-crt-elevated text-crt-phosphor',
  },
  {
    value: 'info',
    label: 'Info',
    clearLabel: 'Info',
    emptyLabel: 'info events',
    activeClass: 'bg-crt-elevated text-crt-text',
  },
  {
    value: 'download',
    label: 'Downloads',
    clearLabel: 'Downloads',
    emptyLabel: 'download events',
    activeClass: 'bg-crt-elevated text-crt-phosphor',
  },
  {
    value: 'warn',
    label: 'Warnings',
    clearLabel: 'Warnings',
    emptyLabel: 'warnings',
    activeClass: 'bg-crt-elevated text-crt-amber',
  },
  {
    value: 'throttle',
    label: 'Throttle',
    clearLabel: 'Throttle',
    emptyLabel: 'throttle events',
    activeClass: 'bg-crt-elevated text-crt-amber',
  },
  {
    value: 'error',
    label: 'Errors',
    clearLabel: 'Errors',
    emptyLabel: 'errors',
    activeClass: 'bg-crt-elevated text-crt-crimson',
  },
  {
    value: 'debug',
    label: 'Debug',
    clearLabel: 'Debug',
    emptyLabel: 'debug events',
    activeClass: 'bg-crt-elevated text-crt-text',
  },
];

const PROGRESS_WIDTH_CLASSES: readonly string[] = [
  'w-[0%]', 'w-[1%]', 'w-[2%]', 'w-[3%]', 'w-[4%]', 'w-[5%]', 'w-[6%]', 'w-[7%]', 'w-[8%]', 'w-[9%]',
  'w-[10%]', 'w-[11%]', 'w-[12%]', 'w-[13%]', 'w-[14%]', 'w-[15%]', 'w-[16%]', 'w-[17%]', 'w-[18%]', 'w-[19%]',
  'w-[20%]', 'w-[21%]', 'w-[22%]', 'w-[23%]', 'w-[24%]', 'w-[25%]', 'w-[26%]', 'w-[27%]', 'w-[28%]', 'w-[29%]',
  'w-[30%]', 'w-[31%]', 'w-[32%]', 'w-[33%]', 'w-[34%]', 'w-[35%]', 'w-[36%]', 'w-[37%]', 'w-[38%]', 'w-[39%]',
  'w-[40%]', 'w-[41%]', 'w-[42%]', 'w-[43%]', 'w-[44%]', 'w-[45%]', 'w-[46%]', 'w-[47%]', 'w-[48%]', 'w-[49%]',
  'w-[50%]', 'w-[51%]', 'w-[52%]', 'w-[53%]', 'w-[54%]', 'w-[55%]', 'w-[56%]', 'w-[57%]', 'w-[58%]', 'w-[59%]',
  'w-[60%]', 'w-[61%]', 'w-[62%]', 'w-[63%]', 'w-[64%]', 'w-[65%]', 'w-[66%]', 'w-[67%]', 'w-[68%]', 'w-[69%]',
  'w-[70%]', 'w-[71%]', 'w-[72%]', 'w-[73%]', 'w-[74%]', 'w-[75%]', 'w-[76%]', 'w-[77%]', 'w-[78%]', 'w-[79%]',
  'w-[80%]', 'w-[81%]', 'w-[82%]', 'w-[83%]', 'w-[84%]', 'w-[85%]', 'w-[86%]', 'w-[87%]', 'w-[88%]', 'w-[89%]',
  'w-[90%]', 'w-[91%]', 'w-[92%]', 'w-[93%]', 'w-[94%]', 'w-[95%]', 'w-[96%]', 'w-[97%]', 'w-[98%]', 'w-[99%]',
  'w-[100%]',
];

interface CompletedTransferHold {
  runId: number | null;
  itemId: number | null;
  hasCover: boolean;
  fileKey: string;
  itemTitle: string;
  systemName: string;
  filename: string;
  fileIndex: number | null;
  totalFiles: number | null;
  bytes: number;
  downloadedCount: number;
}

interface SyncTargetCoverThumbnailProps {
  target: ActiveSyncTargetCover;
  isDryRun: boolean;
  uiMotion: CrtUiMotionLevel;
  compact?: boolean;
  highlighted?: boolean;
  onHoverChange?: (hovering: boolean) => void;
  onInspect: (itemId: number) => void;
}

interface CommittedCoverArt {
  key: number;
  url: string;
  title: string;
  naturalWidth: number;
  naturalHeight: number;
}

function readMediaMatch(query: string, fallback: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return fallback;
  }
  return window.matchMedia(query).matches;
}

function SyncTargetCoverThumbnail({
  target,
  isDryRun,
  uiMotion,
  compact = false,
  highlighted = false,
  onHoverChange,
  onInspect,
}: SyncTargetCoverThumbnailProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    readMediaMatch('(min-width: 640px)', true),
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() =>
    readMediaMatch('(prefers-reduced-motion: reduce)', false),
  );
  const [displayedCover, setDisplayedCover] = useState<CommittedCoverArt | null>(null);
  const [outgoingCover, setOutgoingCover] = useState<CommittedCoverArt | null>(null);
  const [swapSeq, setSwapSeq] = useState<number>(0);

  const displayedCoverRef = useRef<CommittedCoverArt | null>(null);
  const targetTitleRef = useRef<string>(target.title);
  const requestIdRef = useRef<number>(0);
  const keySeqRef = useRef<number>(0);
  const cleanupTimerRef = useRef<number | null>(null);
  const uiMotionRef = useRef<CrtUiMotionLevel>(uiMotion);
  const prefersReducedMotionRef = useRef<boolean>(prefersReducedMotion);

  displayedCoverRef.current = displayedCover;
  targetTitleRef.current = target.title;
  uiMotionRef.current = uiMotion;
  prefersReducedMotionRef.current = prefersReducedMotion;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const smQuery = window.matchMedia('(min-width: 640px)');
    const rmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onSmChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    const onRmChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);

    setIsDesktop(smQuery.matches);
    setPrefersReducedMotion(rmQuery.matches);
    smQuery.addEventListener('change', onSmChange);
    rmQuery.addEventListener('change', onRmChange);
    return () => {
      smQuery.removeEventListener('change', onSmChange);
      rmQuery.removeEventListener('change', onRmChange);
    };
  }, []);

  const clearOutgoingTimer = useCallback(() => {
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
  }, []);

  // Immediately clear any in-flight outgoing layer if user disables motion mid-transition
  useEffect(() => {
    if (uiMotion === 'off' || prefersReducedMotion) {
      clearOutgoingTimer();
      setOutgoingCover(null);
    }
  }, [uiMotion, prefersReducedMotion, clearOutgoingTimer]);

  // Retained-outgoing preload & decode pipeline: keeps previous cover crisp until incoming art is decoded
  useEffect(() => {
    const nextUrl = target.coverUrl;
    const current = displayedCoverRef.current;

    if (nextUrl && current?.url === nextUrl) {
      return;
    }

    const reqId = ++requestIdRef.current;
    let cancelled = false;

    const commitCover = (nextCover: CommittedCoverArt | null) => {
      if (cancelled || requestIdRef.current !== reqId) return;
      const prev = displayedCoverRef.current;
      if (prev?.url === nextCover?.url) return;

      const swapMs = prefersReducedMotionRef.current
        ? 0
        : getHeroSwapDurationMs(uiMotionRef.current);

      clearOutgoingTimer();
      if (swapMs > 0 && prev) {
        setOutgoingCover(prev);
        cleanupTimerRef.current = window.setTimeout(() => {
          cleanupTimerRef.current = null;
          setOutgoingCover(null);
        }, swapMs + 45);
      } else {
        setOutgoingCover(null);
      }

      setDisplayedCover(nextCover);
      if (swapMs > 0 && nextCover) {
        setSwapSeq((n) => n + 1);
      }
    };

    if (!nextUrl) {
      commitCover(null);
      return () => {
        cancelled = true;
      };
    }

    const loader = new Image();
    loader.referrerPolicy = 'no-referrer';
    loader.decoding = 'async';
    let settled = false;

    const finalizeLoad = () => {
      if (settled) return;
      settled = true;
      loader.onload = null;
      loader.onerror = null;
      const naturalWidth = loader.naturalWidth;
      const naturalHeight = loader.naturalHeight;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        commitCover(null);
        return;
      }
      const nextRecord: CommittedCoverArt = {
        key: ++keySeqRef.current,
        url: nextUrl,
        title: targetTitleRef.current,
        naturalWidth,
        naturalHeight,
      };
      if (typeof loader.decode === 'function') {
        loader
          .decode()
          .catch(() => undefined)
          .finally(() => commitCover(nextRecord));
      } else {
        commitCover(nextRecord);
      }
    };

    const finalizeError = () => {
      if (settled) return;
      settled = true;
      loader.onload = null;
      loader.onerror = null;
      commitCover(null);
    };

    loader.onload = finalizeLoad;
    loader.onerror = finalizeError;
    loader.src = nextUrl;

    // Fast path for images already decoded in the browser cache
    if (loader.complete && loader.naturalWidth > 0) {
      finalizeLoad();
    }

    return () => {
      cancelled = true;
      loader.onload = null;
      loader.onerror = null;
    };
  }, [target.coverUrl, clearOutgoingTimer]);

  useEffect(() => clearOutgoingTimer, [clearOutgoingTimer]);

  const animationsEnabled = uiMotion !== 'off' && !prefersReducedMotion;
  const hasVisibleArt = displayedCover !== null;
  const isInteractive = target.itemId !== null;
  const frameWidthPx = computeHeroCoverFrameWidthPx({
    naturalWidth: displayedCover?.naturalWidth,
    naturalHeight: displayedCover?.naturalHeight,
    compact,
    isDesktop,
  });

  const heightClass = compact ? 'h-[62px] sm:h-[70px]' : 'h-[80px] sm:h-[90px]';
  const accentBorderClass = isDryRun
    ? highlighted
      ? 'border-crt-amber/85 focus-visible:ring-crt-amber/75'
      : 'border-crt-amber/45 hover:border-crt-amber/85 focus-visible:ring-crt-amber/75'
    : highlighted
      ? 'border-crt-phosphor/80 focus-visible:ring-crt-phosphor/75'
      : 'border-crt-border-strong/90 hover:border-crt-phosphor/80 focus-visible:ring-crt-phosphor/75';
  const frameStyle = {
    '--crt-hero-frame-width': `${frameWidthPx}px`,
  } as CSSProperties;
  const swapAccent = isDryRun ? 'amber' : 'phosphor';

  const innerContent = (
    <>
      {/* Recessed 3:4 CRT placeholder frame: steady silhouette before initial art loads or when artwork is absent */}
      <span
        aria-hidden="true"
        className={`crt-hero-cover-placeholder pointer-events-none absolute inset-0 z-0 flex items-center justify-center bg-crt-bg text-crt-muted/70 ${
          hasVisibleArt ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <span className="absolute inset-[3px] rounded-[2px] border border-crt-border/45" />
        <span className="absolute top-[4px] left-[4px] h-2 w-2 border-t border-l border-crt-border-strong/70" />
        <span className="absolute bottom-[4px] right-[4px] h-2 w-2 border-b border-r border-crt-border-strong/70" />
        <Gamepad2
          className={`relative z-10 h-5 w-5 transition-opacity duration-150 ${
            highlighted ? 'opacity-100 text-crt-text' : 'opacity-70'
          }`}
        />
      </span>

      {/* Outgoing cover art retained during crossfade so consecutive releases never flash blank */}
      {outgoingCover && animationsEnabled && (
        <img
          key={`out-${outgoingCover.key}`}
          src={outgoingCover.url}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          className="crt-hero-cover-layer crt-hero-cover-exit pointer-events-none z-10"
        />
      )}

      {/* Active committed adaptive-aspect cover art */}
      {displayedCover && (
        <img
          key={`in-${displayedCover.key}`}
          src={displayedCover.url}
          alt={`${target.title} cover art`}
          referrerPolicy="no-referrer"
          className={`crt-hero-cover-layer z-20 ${
            animationsEnabled && swapSeq > 0 ? 'crt-hero-cover-enter' : ''
          }`}
        />
      )}

      {/* Living UI Motion accent rim pulse (Medium/High/Ultra) */}
      {animationsEnabled && swapSeq > 0 && (
        <span
          key={`rim-${swapSeq}`}
          aria-hidden="true"
          className="crt-hero-cover-rim z-30"
        />
      )}

      {/* Ultra-tier fleeting specular scan-glint sweep */}
      {animationsEnabled && uiMotion === 'ultra' && swapSeq > 0 && (
        <span
          key={`glint-${swapSeq}`}
          aria-hidden="true"
          className="crt-hero-cover-glint z-30"
        />
      )}

      {/* Subtle top edge bevel sheen */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      />
    </>
  );

  if (isInteractive && target.itemId !== null) {
    const inspectId = target.itemId;
    return (
      <button
        type="button"
        style={frameStyle}
        data-swap-accent={swapAccent}
        onClick={() => onInspect(inspectId)}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onBlur={() => onHoverChange?.(false)}
        title={`Inspect "${target.title}" details`}
        aria-label={`Inspect ${target.title} details`}
        className={`crt-hero-cover-frame group relative inline-flex ${heightClass} shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-crt-bg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-crt-surface ${accentBorderClass}`}
      >
        {innerContent}
      </button>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={frameStyle}
      data-swap-accent={swapAccent}
      className={`crt-hero-cover-frame relative inline-flex ${heightClass} shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-crt-border bg-crt-bg`}
    >
      {innerContent}
    </span>
  );
}

function toLocalDateTimeInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function OverviewPanel({
  config,
  status,
  installer,
  runs,
  logs,
  preflight = null,
  logsClearedRevision = 0,
  catalogRevision,
  activeRetryItemId = null,
  uiMotion = 'low',
  syncSpeedWave = true,
  crtPalette = 'green',
  onSaveConfig,
  onClearLogs,
  onClearRuns,
  onNavigateToOperations,
  onQueueRuleMatches,
  onPreviewRuleMatchesInCatalog,
  onQueueDownload,
  onResumeDownloadQueue,
  onPauseQueueAutoResume,
  onClearDownloadQueue,
  onViewQueuedInCatalog,
  onRetryItem,
  onRetryAllFailed,
  onStartCatalogIndex,
  onStopCatalogIndex,
  onRefreshStatus,
}: OverviewPanelProps) {
  const [logFilter, setLogFilter] = useState<'all' | LogLevel>('all');
  const [levelHistory, setLevelHistory] = useState<{
    level: LogLevel;
    entries: ActivityLogRecord[];
    clearedRev: number;
  } | null>(null);
  const [failedQueueOpen, setFailedQueueOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [editingCutoff, setEditingCutoff] = useState(false);
  const [cutoffLocalInput, setCutoffLocalInput] = useState('');
  const [cutoffSaving, setCutoffSaving] = useState(false);
  const [cutoffError, setCutoffError] = useState<string | null>(null);
  const [cutoffSavedNotice, setCutoffSavedNotice] = useState<string | null>(null);
  const [transferDetailsOpen, setTransferDetailsOpen] = useState(false);
  const [queueingRuleMatches, setQueueingRuleMatches] = useState(false);
  const [confirmQueueRuleMatches, setConfirmQueueRuleMatches] = useState(false);
  const [monitorQueueNotice, setMonitorQueueNotice] = useState<string | null>(null);
  const [resumingQueue, setResumingQueue] = useState(false);
  const [pausingAutoResume, setPausingAutoResume] = useState(false);
  const [clearingQueue, setClearingQueue] = useState(false);
  const [confirmClearQueue, setConfirmClearQueue] = useState(false);
  const [pausedQueueNotice, setPausedQueueNotice] = useState<string | null>(null);
  const [indexerBusy, setIndexerBusy] = useState(false);
  const [activeDetailItem, setActiveDetailItem] = useState<RepositoryItemRecord | null>(null);
  const [slowLoadingDetailId, setSlowLoadingDetailId] = useState<number | null>(null);
  const [heroInspectHover, setHeroInspectHover] = useState(false);
  const [, setTick] = useState(0);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const detailReqSeqRef = useRef(0);
  const inFlightDetailIdRef = useRef<number | null>(null);
  const detailLoadingTimerRef = useRef<number | null>(null);

  const clearDetailLoadingTimer = useCallback(() => {
    if (detailLoadingTimerRef.current !== null) {
      window.clearTimeout(detailLoadingTimerRef.current);
      detailLoadingTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearDetailLoadingTimer, [clearDetailLoadingTimer]);

  const openSyncItemDetail = useCallback(
    async (itemId: number) => {
      if (!Number.isInteger(itemId) || itemId <= 0) return;
      if (inFlightDetailIdRef.current === itemId) return;
      const reqId = ++detailReqSeqRef.current;
      inFlightDetailIdRef.current = itemId;
      clearDetailLoadingTimer();
      setSlowLoadingDetailId(null);
      detailLoadingTimerRef.current = window.setTimeout(() => {
        detailLoadingTimerRef.current = null;
        if (reqId === detailReqSeqRef.current) {
          setSlowLoadingDetailId(itemId);
        }
      }, HERO_DETAIL_LOADING_DELAY_MS);
      try {
        const res = await fetch(`/api/items/${itemId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { item?: RepositoryItemRecord };
        if (reqId === detailReqSeqRef.current && data.item) {
          setActiveDetailItem(data.item);
        }
      } catch {
        // Ignore transient network errors when inspecting active sync item
      } finally {
        if (reqId === detailReqSeqRef.current) {
          clearDetailLoadingTimer();
          inFlightDetailIdRef.current = null;
          setSlowLoadingDetailId(null);
        }
      }
    },
    [clearDetailLoadingTimer],
  );

  const closeSyncItemDetail = useCallback(() => {
    detailReqSeqRef.current += 1;
    clearDetailLoadingTimer();
    inFlightDetailIdRef.current = null;
    setSlowLoadingDetailId(null);
    setActiveDetailItem(null);
  }, [clearDetailLoadingTimer]);

  // Keep an open Monitor Game Detail Drawer fresh as files finish or metadata updates
  useEffect(() => {
    if (!activeDetailItem) return;
    let cancelled = false;
    const targetId = activeDetailItem.id;
    void (async () => {
      try {
        const res = await fetch(`/api/items/${targetId}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { item?: RepositoryItemRecord };
        if (!cancelled && data.item) {
          setActiveDetailItem((current) => (current?.id === targetId ? data.item! : current));
        }
      } catch {
        // Ignore transient poll errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogRevision, activeDetailItem?.id]);

  // Patch installed metadata synchronously when a mounted-device install/upgrade finishes
  useEffect(() => {
    return installer.subscribeItemsInstalled((updatedItems) => {
      if (updatedItems.length === 0) return;
      const byId = new Map(updatedItems.map((row) => [row.id, row]));
      setActiveDetailItem((current) => (current ? (byId.get(current.id) ?? current) : current));
    });
  }, [installer]);

  const handleDeleteDetailItem = useCallback(
    async (id: number) => {
      const res = await fetch('/api/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (res.ok) {
        closeSyncItemDetail();
        await onRefreshStatus();
      }
    },
    [closeSyncItemDetail, onRefreshStatus],
  );

  const latestDryRunWithSummary = useMemo(
    () =>
      runs.find(
        (r) => r.status !== 'running' && (r.dryRun || r.mode === 'dry_run') && Boolean(r.summary),
      ) ?? null,
    [runs],
  );

  const handleQueueRuleMatchesAction = async () => {
    if (!onQueueRuleMatches || queueingRuleMatches) return;
    setQueueingRuleMatches(true);
    setConfirmQueueRuleMatches(false);
    setMonitorQueueNotice(null);
    try {
      await onQueueRuleMatches();
      setMonitorQueueNotice('Queued pending Sync Rule matches into download worker queue.');
    } catch (err) {
      setMonitorQueueNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueingRuleMatches(false);
    }
  };

  const handleResumePausedQueueAction = async () => {
    if (!onResumeDownloadQueue || resumingQueue || clearingQueue || pausingAutoResume) return;
    setResumingQueue(true);
    setConfirmClearQueue(false);
    setPausedQueueNotice(null);
    try {
      await onResumeDownloadQueue();
    } catch (err) {
      setPausedQueueNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setResumingQueue(false);
    }
  };

  const handlePauseAutoResumeAction = async () => {
    if (!onPauseQueueAutoResume || pausingAutoResume || resumingQueue || clearingQueue) return;
    setPausingAutoResume(true);
    setConfirmClearQueue(false);
    setPausedQueueNotice(null);
    try {
      await onPauseQueueAutoResume();
    } catch (err) {
      setPausedQueueNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPausingAutoResume(false);
    }
  };

  const handleClearPausedQueueAction = async () => {
    if (!onClearDownloadQueue || clearingQueue || resumingQueue) return;
    setClearingQueue(true);
    setConfirmClearQueue(false);
    setPausedQueueNotice(null);
    try {
      const res = await onClearDownloadQueue();
      const cleared = res?.clearedCount ?? 0;
      if (cleared > 0) {
        setPausedQueueNotice(`Cleared ${cleared.toLocaleString()} paused queued release${cleared === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setPausedQueueNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingQueue(false);
    }
  };

  // Refresh countdown clock every second while idle/running
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 10000), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch per-level history when a specific event filter is active so sparse warnings/throttles/errors
  // beyond the latest 300 mixed stream entries remain visible.
  useEffect(() => {
    if (logFilter === 'all') {
      return;
    }
    const controller = new AbortController();
    const targetLevel = logFilter;
    const targetRev = logsClearedRevision;
    void fetch(`/api/logs?level=${encodeURIComponent(targetLevel)}&limit=150`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { logs?: ActivityLogRecord[] };
        if (!controller.signal.aborted) {
          setLevelHistory({
            level: targetLevel,
            entries: data.logs || [],
            clearedRev: targetRev,
          });
        }
      })
      .catch(() => {
        // Ignore abort / transient fetch errors; live buffer still renders
      });
    return () => controller.abort();
  }, [logFilter, logsClearedRevision]);

  const activeFilterOption = useMemo(
    () => LOG_FILTER_OPTIONS.find((opt) => opt.value === logFilter) ?? LOG_FILTER_OPTIONS[0],
    [logFilter],
  );

  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs;
    const liveMatching = logs.filter((l) => l.level === logFilter);
    if (
      !levelHistory ||
      levelHistory.level !== logFilter ||
      levelHistory.clearedRev !== logsClearedRevision
    ) {
      return liveMatching;
    }
    const mergedById = new Map<number, ActivityLogRecord>();
    for (const entry of levelHistory.entries) {
      mergedById.set(entry.id, entry);
    }
    for (const entry of liveMatching) {
      mergedById.set(entry.id, entry);
    }
    return Array.from(mergedById.values()).sort((a, b) => b.id - a.id);
  }, [logs, logFilter, levelHistory, logsClearedRevision]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [filteredLogs.length, autoScroll]);

  const parallelTransfers = useMemo<ActiveTransferState[]>(() => {
    if (status.activeTransfers && status.activeTransfers.length > 0) {
      return status.activeTransfers;
    }
    return status.activeTransfer ? [status.activeTransfer] : [];
  }, [status.activeTransfers, status.activeTransfer]);

  const hasMultipleParallelTransfers = parallelTransfers.length > 1;

  const parsedSyncHeader = useMemo(
    () =>
      parseSyncStatusHeader({
        currentPhase: status.currentPhase,
        activeRun: status.activeRun,
        activeTransfer: status.activeTransfer,
        parallelTransferCount: parallelTransfers.length,
        runProgress: status.runProgress ?? null,
      }),
    [
      status.currentPhase,
      status.activeRun,
      status.activeTransfer,
      status.runProgress,
      parallelTransfers.length,
    ],
  );

  // Preserve the system item counter (e.g. "9/424") seamlessly when phase hands off to "Downloading..."
  const [heldSystemProgress, setHeldSystemProgress] = useState<{
    runId: number;
    systemName: string;
    progressLabel: string;
  } | null>(null);

  useEffect(() => {
    const runId = status.activeRun?.id ?? null;
    if (runId === null) {
      setHeldSystemProgress(null);
      return;
    }
    if (parsedSyncHeader.systemName && parsedSyncHeader.progressLabel) {
      setHeldSystemProgress((prev) => {
        if (
          prev &&
          prev.runId === runId &&
          prev.systemName === parsedSyncHeader.systemName &&
          prev.progressLabel === parsedSyncHeader.progressLabel
        ) {
          return prev;
        }
        return {
          runId,
          systemName: parsedSyncHeader.systemName!,
          progressLabel: parsedSyncHeader.progressLabel!,
        };
      });
    }
  }, [status.activeRun?.id, parsedSyncHeader.systemName, parsedSyncHeader.progressLabel]);

  const effectiveSystemProgress = useMemo(() => {
    if (parsedSyncHeader.progressLabel) return parsedSyncHeader.progressLabel;
    if (
      status.activeRun &&
      heldSystemProgress &&
      heldSystemProgress.runId === status.activeRun.id &&
      heldSystemProgress.systemName === parsedSyncHeader.systemName
    ) {
      return heldSystemProgress.progressLabel;
    }
    return null;
  }, [parsedSyncHeader.progressLabel, parsedSyncHeader.systemName, status.activeRun, heldSystemProgress]);

  const combinedTransfer = useMemo(() => {
    if (parallelTransfers.length === 0) return null;
    let bytesReceived = 0;
    let bytesPerSec = 0;
    let knownTotalBytes = 0;
    let allHaveTotals = true;
    let totalChunks = 0;

    for (const entry of parallelTransfers) {
      bytesReceived += Math.max(0, entry.bytesReceived || 0);
      bytesPerSec += Math.max(0, entry.bytesPerSec || 0);
      totalChunks += Math.max(1, entry.activeChunks ?? 1);
      if (entry.totalBytes !== null && entry.totalBytes > 0) {
        knownTotalBytes += entry.totalBytes;
      } else {
        allHaveTotals = false;
      }
    }

    const totalBytes = allHaveTotals && knownTotalBytes > 0 ? knownTotalBytes : null;
    const pct =
      totalBytes !== null && totalBytes > 0
        ? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
        : null;

    return {
      workerCount: parallelTransfers.length,
      bytesReceived,
      totalBytes,
      bytesPerSec,
      pct,
      totalChunks,
    };
  }, [parallelTransfers]);

  const combinedWaveParams = useMemo(
    () =>
      computeSyncSpeedWaveParams(
        combinedTransfer?.bytesPerSec ?? 0,
        uiMotion,
        syncSpeedWave,
      ),
    [combinedTransfer?.bytesPerSec, uiMotion, syncSpeedWave],
  );

  const isDryRunActive = Boolean(
    status.activeRun && (status.activeRun.dryRun || status.activeRun.mode === 'dry_run'),
  );
  const isLiveSyncRun = Boolean(status.activeRun && !isDryRunActive);
  const hasTransferDemand = isLiveSyncRun || Boolean(status.activeTransfer);

  const [lastCompletedTransfer, setLastCompletedTransfer] = useState<CompletedTransferHold | null>(
    null,
  );
  const [postRunHold, setPostRunHold] = useState(false);
  const [unknownSizeGraceElapsed, setUnknownSizeGraceElapsed] = useState(false);
  const prevTransferDemandRef = useRef(hasTransferDemand);
  const hadTransferInCurrentRunRef = useRef(Boolean(status.activeTransfer));

  // Clear stale last-file snapshot when a brand-new sync run ID starts
  useEffect(() => {
    const currentRunId = status.activeRun?.id ?? null;
    if (
      currentRunId !== null &&
      !status.activeTransfer &&
      lastCompletedTransfer &&
      lastCompletedTransfer.runId !== null &&
      lastCompletedTransfer.runId !== currentRunId
    ) {
      hadTransferInCurrentRunRef.current = false;
      setLastCompletedTransfer(null);
    }
  }, [status.activeRun?.id, status.activeTransfer, lastCompletedTransfer]);

  // Continuously capture the active file snapshot so inter-file rate-limit pauses hold steady
  useEffect(() => {
    const t = status.activeTransfer;
    if (!t) return;
    hadTransferInCurrentRunRef.current = true;
    const fileKey = `${t.itemId ?? 'item'}:${t.fileId ?? t.filename}`;
    const bytes = Math.max(t.bytesReceived, t.totalBytes ?? 0);
    const resolvedTitle = (t.itemTitle || '').trim() || t.filename;
    setLastCompletedTransfer((prev) => {
      const nextRunId = status.activeRun?.id ?? prev?.runId ?? null;
      const nextItemId = t.itemId ?? prev?.itemId ?? null;
      const nextHasCover = Boolean(t.hasCover ?? prev?.hasCover ?? false);
      const nextDownloadedCount = status.activeRun?.downloadedCount ?? prev?.downloadedCount ?? 0;
      if (
        prev &&
        prev.runId === nextRunId &&
        prev.itemId === nextItemId &&
        prev.hasCover === nextHasCover &&
        prev.fileKey === fileKey &&
        prev.itemTitle === resolvedTitle &&
        prev.bytes === bytes &&
        prev.downloadedCount === nextDownloadedCount
      ) {
        return prev;
      }
      return {
        runId: nextRunId,
        itemId: nextItemId,
        hasCover: nextHasCover,
        fileKey,
        itemTitle: resolvedTitle,
        systemName: t.systemName,
        filename: t.filename,
        fileIndex: t.fileIndex ?? null,
        totalFiles: t.totalFiles ?? null,
        bytes,
        downloadedCount: nextDownloadedCount,
      };
    });
  }, [status.activeTransfer, status.activeRun?.id, status.activeRun?.downloadedCount]);

  // Keep transfer bay open across the entire sync run and settle gently once the run ends
  useEffect(() => {
    const wasActive = prevTransferDemandRef.current;
    prevTransferDemandRef.current = hasTransferDemand;

    if (hasTransferDemand) {
      setPostRunHold(false);
      return;
    }

    if (!wasActive) {
      return;
    }

    setPostRunHold(true);
    const settleMs = hadTransferInCurrentRunRef.current ? 900 : 320;
    const timer = window.setTimeout(() => {
      hadTransferInCurrentRunRef.current = false;
      setPostRunHold(false);
    }, settleMs);

    return () => window.clearTimeout(timer);
  }, [hasTransferDemand]);

  const activeTransferFileKey = status.activeTransfer
    ? `${status.activeTransfer.itemId ?? 'item'}:${status.activeTransfer.fileId ?? status.activeTransfer.filename}`
    : null;
  const activeTransferHasTotal = Boolean(
    combinedTransfer?.totalBytes && combinedTransfer.totalBytes > 0,
  );

  // Avoid flashing an indeterminate sweep bar during the brief 30–200ms pre-header handshake on small files
  useEffect(() => {
    if (!activeTransferFileKey || activeTransferHasTotal) {
      setUnknownSizeGraceElapsed(false);
      return;
    }
    setUnknownSizeGraceElapsed(false);
    const timer = window.setTimeout(() => {
      setUnknownSizeGraceElapsed(true);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [activeTransferFileKey, activeTransferHasTotal]);

  const isTransferBayOpen = hasTransferDemand || postRunHold;
  const heldTransferForActiveRun =
    lastCompletedTransfer &&
    (status.activeRun === null ||
      lastCompletedTransfer.runId === null ||
      lastCompletedTransfer.runId === status.activeRun.id)
      ? lastCompletedTransfer
      : null;

  const displayedSyncSubject =
    parsedSyncHeader.subjectKind === 'download' && heldTransferForActiveRun?.itemTitle
      ? heldTransferForActiveRun.itemTitle
      : parsedSyncHeader.subject;
  const isHighlightedGameTarget =
    parsedSyncHeader.subjectKind === 'title' || parsedSyncHeader.subjectKind === 'download';
  const activeSyncTargetCover = useMemo(
    () =>
      resolveActiveSyncTargetCover({
        parsedHeader: parsedSyncHeader,
        displayedSubject: displayedSyncSubject,
        activeRun: status.activeRun,
        activeTransfer: status.activeTransfer,
        activeSyncItem: status.activeSyncItem ?? null,
        heldTransfer: heldTransferForActiveRun,
      }),
    [
      parsedSyncHeader,
      displayedSyncSubject,
      status.activeRun,
      status.activeTransfer,
      status.activeSyncItem,
      heldTransferForActiveRun,
    ],
  );
  const activeReleaseIdentityKey = useMemo(
    () => deriveSyncReleaseIdentityKey(activeSyncTargetCover),
    [activeSyncTargetCover],
  );
  const prevReleaseIdentityRef = useRef<string | null>(null);
  const [titleSwapSeq, setTitleSwapSeq] = useState<number>(0);

  useEffect(() => {
    const prevKey = prevReleaseIdentityRef.current;
    if (!activeReleaseIdentityKey) {
      prevReleaseIdentityRef.current = null;
      return;
    }
    if (prevKey !== null && prevKey !== activeReleaseIdentityKey) {
      setTitleSwapSeq((n) => n + 1);
    }
    prevReleaseIdentityRef.current = activeReleaseIdentityKey;
  }, [activeReleaseIdentityKey]);
  const activeDetailTransfer = useMemo(() => {
    if (!activeDetailItem) return null;
    return (
      parallelTransfers.find((t) => t.itemId === activeDetailItem.id) ??
      (status.activeTransfer?.itemId === activeDetailItem.id ? status.activeTransfer : null)
    );
  }, [activeDetailItem, parallelTransfers, status.activeTransfer]);

  // Immediately re-fetch the open detail item when its live transfer finishes so
  // status, downloaded files, and mounted-device install actions appear without waiting
  const prevDetailTransferItemIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prevTransferItemId = prevDetailTransferItemIdRef.current;
    const nextTransferItemId = activeDetailTransfer?.itemId ?? null;
    prevDetailTransferItemIdRef.current = nextTransferItemId;

    if (
      prevTransferItemId === null ||
      nextTransferItemId === prevTransferItemId ||
      !activeDetailItem ||
      activeDetailItem.id !== prevTransferItemId
    ) {
      return;
    }

    let cancelled = false;
    const targetId = activeDetailItem.id;
    void (async () => {
      try {
        const res = await fetch(`/api/items/${targetId}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { item?: RepositoryItemRecord };
        if (!cancelled && data.item) {
          setActiveDetailItem((current) => (current?.id === targetId ? data.item! : current));
        }
      } catch {
        // Ignore transient fetch errors after transfer completion
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDetailTransfer?.itemId, activeDetailItem]);

  const { sdRootHandle, activeDeviceProfile, activeDeviceName } = installer;
  const effectiveMountedDeviceName = activeDeviceName || sdRootHandle?.name || null;
  const fsSupport = useMemo(() => isFileSystemAccessSupported(), []);
  const syncSmartFilterContext = useMemo<SmartRomFilterContext>(
    () => ({
      syncIncludeTags: config.allowedReleaseTypes,
    }),
    [config.allowedReleaseTypes],
  );
  const detailKnownItemMetaMap = useMemo(() => {
    const map = new Map<number, BulkInstallKnownItemMeta>();
    if (activeDetailItem) {
      map.set(activeDetailItem.id, {
        title: activeDetailItem.title,
        systemName: activeDetailItem.systemName,
        previousInstalledFilename: activeDetailItem.installedFilename,
      });
    }
    return map;
  }, [activeDetailItem]);

  const activeDetailInstallState = useMemo(
    () =>
      activeDetailItem
        ? resolveItemDeviceInstallState(
            activeDetailItem.id,
            installer.job,
            installer.metrics,
            effectiveMountedDeviceName,
          )
        : null,
    [activeDetailItem, installer.job, installer.metrics, effectiveMountedDeviceName],
  );

  const handleExpressInstallDetail = useCallback(
    (id: number) => {
      if (installer.isBusy && !installer.canAppendToQueue) {
        if (installer.job?.itemIds.includes(id)) {
          installer.openModal();
        }
        return;
      }
      if (sdRootHandle || fsSupport.supported) {
        void installer.startExpressInstall([id], syncSmartFilterContext, detailKnownItemMetaMap);
      } else {
        void installer.openReviewQueue([id], syncSmartFilterContext, detailKnownItemMetaMap);
      }
    },
    [installer, sdRootHandle, fsSupport.supported, syncSmartFilterContext, detailKnownItemMetaMap],
  );

  const handleUpgradeDetail = useCallback(
    (id: number) => {
      if (installer.isBusy && !installer.canAppendToQueue) {
        if (installer.job?.itemIds.includes(id)) {
          installer.openModal();
        }
        return;
      }
      if (sdRootHandle || fsSupport.supported) {
        void installer.upgradeOutdatedItems([id], syncSmartFilterContext, detailKnownItemMetaMap);
      } else {
        void installer.openReviewQueue([id], syncSmartFilterContext, detailKnownItemMetaMap);
      }
    },
    [installer, sdRootHandle, fsSupport.supported, syncSmartFilterContext, detailKnownItemMetaMap],
  );

  const handleExportDetailToSdCard = useCallback(
    (id: number) => {
      void installer.openReviewQueue([id], syncSmartFilterContext, detailKnownItemMetaMap);
    },
    [installer, syncSmartFilterContext, detailKnownItemMetaMap],
  );

  const handleUninstallDetailFromDevice = useCallback(
    async (targetItem: RepositoryItemRecord) => {
      const res = await installer.uninstallItemsFromMountedDevice([targetItem]);
      if (res.uninstalledCount > 0) {
        const updated = res.updatedItems.find((row) => row.id === targetItem.id);
        if (updated) {
          setActiveDetailItem((current) => (current?.id === targetItem.id ? updated : current));
        }
        await onRefreshStatus();
      }
      return res;
    },
    [installer, onRefreshStatus],
  );

  const activeWatermakVal = status.lastWatermarkAt ?? config.lastWatermarkAt;
  const activeWatermark = activeWatermakVal;

  const activeReleaseTypesSummary = useMemo(() => {
    const normalized = normalizeAllowedReleaseTypes(config.allowedReleaseTypes);
    if (normalized.length === 0) return null;
    return formatAllowedReleaseTypesSummary(normalized);
  }, [config.allowedReleaseTypes]);

  const activeSystemScopeCount = useMemo(() => {
    return config.systemFilter
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length;
  }, [config.systemFilter]);

  const resolvedCutoffPreviewIso = useMemo(() => {
    if (!cutoffLocalInput.trim()) return null;
    const ms = Date.parse(cutoffLocalInput);
    if (Number.isNaN(ms)) return null;
    return new Date(ms).toISOString();
  }, [cutoffLocalInput]);

  const handleToggleCutoffEditor = () => {
    if (editingCutoff) {
      setEditingCutoff(false);
      setCutoffError(null);
      return;
    }
    const baseDate = activeWatermark
      ? new Date(activeWatermark)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    setCutoffLocalInput(toLocalDateTimeInputValue(baseDate));
    setCutoffError(null);
    setCutoffSavedNotice(null);
    setEditingCutoff(true);
  };

  const applyCutoffPresetHoursAgo = (hoursAgo: number) => {
    const target = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    setCutoffLocalInput(toLocalDateTimeInputValue(target));
    setCutoffError(null);
  };

  const handleSaveCutoff = async () => {
    const parsedMs = Date.parse(cutoffLocalInput);
    if (!cutoffLocalInput.trim() || Number.isNaN(parsedMs)) {
      setCutoffError('Enter a valid cutoff date and time.');
      return;
    }
    setCutoffSaving(true);
    setCutoffError(null);
    try {
      const iso = new Date(parsedMs).toISOString();
      await onSaveConfig({ lastWatermarkAt: iso });
      setEditingCutoff(false);
      setCutoffSavedNotice('Cutoff updated');
    } catch (err) {
      setCutoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setCutoffSaving(false);
    }
  };

  const handleResetCutoffDefault = async () => {
    setCutoffSaving(true);
    setCutoffError(null);
    try {
      await onSaveConfig({ lastWatermarkAt: null });
      setEditingCutoff(false);
      setCutoffSavedNotice('Reset to 24h default');
    } catch (err) {
      setCutoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setCutoffSaving(false);
    }
  };

  const isHeroSlowLoadingDetail = Boolean(
    activeSyncTargetCover?.itemId !== null &&
      activeSyncTargetCover?.itemId !== undefined &&
      slowLoadingDetailId === activeSyncTargetCover.itemId,
  );

  const transferProgressBarBlock = combinedTransfer ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
        <div className="flex items-center gap-1.5 text-crt-muted min-w-0">
          <Download className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
          <span className="text-crt-text/85 font-medium truncate">
            {hasMultipleParallelTransfers
              ? `Combined progress (${combinedTransfer.workerCount} active)`
              : 'Transfer progress'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
          <span>
            {combinedTransfer.bytesReceived > 0 || combinedTransfer.totalBytes
              ? `${formatBytes(combinedTransfer.bytesReceived)}${
                  combinedTransfer.totalBytes ? ` / ${formatBytes(combinedTransfer.totalBytes)}` : ''
                }`
              : 'Connecting…'}
          </span>
          {combinedTransfer.bytesPerSec > 0 && (
            <>
              <span aria-hidden="true" className="hidden sm:inline text-crt-border-strong">
                ·
              </span>
              <span className="hidden sm:inline">
                {formatBytes(combinedTransfer.bytesPerSec)}/s
              </span>
            </>
          )}
          {combinedTransfer.pct !== null && (
            <>
              <span aria-hidden="true" className="text-crt-border-strong">
                ·
              </span>
              <span className="text-crt-phosphor font-semibold inline-block min-w-[3.5ch] text-right">
                {combinedTransfer.pct}%
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => setTransferDetailsOpen((prev) => !prev)}
            aria-expanded={transferDetailsOpen}
            aria-controls="sync-transfer-details-drawer"
            className={`ml-0.5 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-sm border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              transferDetailsOpen
                ? 'bg-crt-elevated border-crt-border-strong text-crt-phosphor'
                : 'bg-crt-bg/80 border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
            }`}
          >
            <span>Details</span>
            {transferDetailsOpen ? (
              <ChevronUp className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0" />
            )}
          </button>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={`Combined download progress for ${displayedSyncSubject}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={combinedTransfer.pct ?? undefined}
        className="h-1.5 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
      >
        {combinedTransfer.pct !== null ? (
          <div
            key={`combined-${status.activeRun?.id ?? 'active'}`}
            style={
              combinedWaveParams.active
                ? ({
                    '--crt-wave-duration': `${combinedWaveParams.progressWaveDurationSec}s`,
                  } as CSSProperties)
                : undefined
            }
            className={`h-full bg-crt-phosphor crt-progress-beam ${
              combinedWaveParams.active ? 'crt-progress-beam-wave' : ''
            } transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none ${
              PROGRESS_WIDTH_CLASSES[Math.max(3, Math.min(100, combinedTransfer.pct))]
            }`}
          />
        ) : unknownSizeGraceElapsed ? (
          <div className="h-full bg-crt-phosphor crt-progress-indeterminate" />
        ) : (
          <div
            key={`handshake-${status.activeRun?.id ?? 'active'}`}
            style={
              combinedWaveParams.active
                ? ({
                    '--crt-wave-duration': `${combinedWaveParams.progressWaveDurationSec}s`,
                  } as CSSProperties)
                : undefined
            }
            className={`h-full bg-crt-phosphor/75 crt-progress-beam ${
              combinedWaveParams.active ? 'crt-progress-beam-wave' : ''
            } transition-opacity duration-150 motion-reduce:transition-none ${PROGRESS_WIDTH_CLASSES[4]}`}
          />
        )}
      </div>
    </div>
  ) : heldTransferForActiveRun ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
        <div className="flex items-center gap-1.5 text-crt-text/90 min-w-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-crt-phosphor/80 shrink-0" />
          <span className="truncate">
            {isLiveSyncRun ? 'Saved — queuing next…' : 'Sync transfer complete'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
          {heldTransferForActiveRun.bytes > 0 && (
            <>
              <span>{formatBytes(heldTransferForActiveRun.bytes)}</span>
              <span aria-hidden="true" className="text-crt-border-strong">
                ·
              </span>
            </>
          )}
          <span className="text-crt-phosphor/80 font-semibold inline-block min-w-[3.5ch] text-right">
            100%
          </span>
          <button
            type="button"
            onClick={() => setTransferDetailsOpen((prev) => !prev)}
            aria-expanded={transferDetailsOpen}
            aria-controls="sync-transfer-details-drawer"
            className={`ml-0.5 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-sm border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              transferDetailsOpen
                ? 'bg-crt-elevated border-crt-border-strong text-crt-phosphor'
                : 'bg-crt-bg/80 border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
            }`}
          >
            <span>Details</span>
            {transferDetailsOpen ? (
              <ChevronUp className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0" />
            )}
          </button>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={`Completed download for ${heldTransferForActiveRun.itemTitle}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={100}
        className="h-1.5 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
      >
        <div
          key={heldTransferForActiveRun.fileKey}
          className={`h-full bg-crt-phosphor transition-opacity duration-200 motion-reduce:transition-none ${
            isLiveSyncRun ? 'opacity-45' : 'opacity-75'
          } ${PROGRESS_WIDTH_CLASSES[100]}`}
        />
      </div>
    </div>
  ) : (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
        <div className="flex items-center gap-1.5 text-crt-muted min-w-0">
          <Activity className="h-3.5 w-3.5 text-crt-phosphor/80 shrink-0" />
          <span className="truncate">
            {isLiveSyncRun ? 'Preparing next downloadable archive…' : 'Sync scan complete'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
          {status.activeRun ? (
            <span>
              {status.activeRun.newFound} matched · {status.activeRun.skippedCount} on disk
            </span>
          ) : (
            <span>Done</span>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="Preparing repository transfer"
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
      >
        {isLiveSyncRun ? (
          <div className="h-full bg-crt-phosphor/65 crt-progress-indeterminate" />
        ) : (
          <div className={`h-full bg-crt-phosphor/50 ${PROGRESS_WIDTH_CLASSES[100]}`} />
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 [overflow-anchor:none]">
      {/* Login / credentials notice until at least one login succeeds */}
      {!status.auth.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-crt-amber/40 bg-crt-amber/5 px-5 py-3.5 rounded-md">
          <div className="flex items-center gap-3 text-sm text-crt-text">
            <AlertTriangle className="h-4 w-4 text-crt-amber shrink-0" />
            <span>
              Repository credentials are not configured yet. Add and verify your retrogametalk.com login in System Settings to enable syncing.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToOperations('auth')}
            className="crt-cta-beam px-3.5 py-1.5 text-xs font-medium text-crt-bg bg-crt-amber hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Configure Credentials
          </button>
        </div>
      ) : !status.auth.hasCompletedLogin ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-crt-amber/40 bg-crt-amber/5 px-5 py-3.5 rounded-md">
          <div className="flex items-center gap-3 text-sm text-crt-text min-w-0">
            <AlertTriangle className="h-4 w-4 text-crt-amber shrink-0" />
            <span className="break-words">
              {status.auth.lastCheckedAt && status.auth.lastMessage
                ? `Sync locked — login has not succeeded yet (${status.auth.lastMessage})`
                : 'Sync locked — run "Test Login & Discover Consoles" in System Settings to verify your account before syncing.'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToOperations('auth')}
            className="crt-cta-beam px-3.5 py-1.5 text-xs font-medium text-crt-bg bg-crt-amber hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open System Settings
          </button>
        </div>
      ) : null}

      {/* Active Runner Phase Status Panel (Hero Showcase) */}
      <section className="relative crt-panel-living crt-panel-hero border border-crt-border bg-crt-surface rounded-md p-5">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-md z-0"
            >
              <SyncSpeedWaveCanvas
                bytesPerSec={combinedTransfer?.bytesPerSec ?? 0}
                uiMotion={uiMotion}
                syncSpeedWave={syncSpeedWave}
                active={Boolean(combinedTransfer)}
                palette={crtPalette}
                isDryRun={isDryRunActive}
              />
            </div>

            <div className="relative z-10 min-w-0">
              {/* Tier 1: Clean Unboxed Telemetry Eyebrow (Zero-Pill Metadata) */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs font-mono min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span
                    className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                      status.activeRun
                        ? `${isDryRunActive ? 'text-crt-amber' : 'text-crt-phosphor'} crt-phase-sync-active`
                        : 'text-crt-muted'
                    }`}
                  >
                    <LivingNavIcon section="monitor" className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {status.activeRun
                        ? `${isDryRunActive ? 'Dry Run Active' : 'Sync Active'} · Run #${status.activeRun.id}`
                        : 'Standby'}
                    </span>
                  </span>

                  {parsedSyncHeader.syncType && (
                    <>
                      <span aria-hidden="true" className="text-crt-border-strong select-none">
                        ·
                      </span>
                      <span className="text-crt-muted font-medium whitespace-nowrap shrink-0">
                        {parsedSyncHeader.syncType}
                      </span>
                    </>
                  )}

                  {parsedSyncHeader.systemName && (
                    <>
                      <span aria-hidden="true" className="text-crt-border-strong select-none">
                        ·
                      </span>
                      <span className="text-crt-text font-semibold truncate">
                        {parsedSyncHeader.systemName}
                      </span>
                    </>
                  )}

                  {effectiveSystemProgress && (
                    <>
                      <span aria-hidden="true" className="text-crt-border-strong select-none">
                        ·
                      </span>
                      <span
                        className={`font-medium tabular-nums whitespace-nowrap shrink-0 ${
                          isDryRunActive ? 'text-crt-amber' : 'text-crt-phosphor'
                        }`}
                      >
                        {effectiveSystemProgress}
                      </span>
                    </>
                  )}
                </div>

                {status.activeRun ? (
                  <span className="text-crt-muted tabular-nums truncate">
                    {formatRunDuration(status.activeRun.startedAt, null)} elapsed
                    {status.activeRun.downloadedCount > 0
                      ? ` · ${status.activeRun.downloadedCount} downloaded`
                      : ''}
                  </span>
                ) : (
                  <EphemeralInlineNotice
                    message={!editingCutoff ? cutoffSavedNotice : null}
                    tone="phosphor"
                    autoDismissMs={3500}
                    onDismiss={() => setCutoffSavedNotice(null)}
                  />
                )}
              </div>

              {/* Tier 2: Hero Showcase (Adaptive Box-Art spanning Unboxed Title + Docked Transfer Bar) */}
              {activeSyncTargetCover ? (
                <div className="mt-3 pt-3.5 border-t border-crt-border/70 flex items-stretch gap-4 min-w-0">
                  <SyncTargetCoverThumbnail
                    target={activeSyncTargetCover}
                    isDryRun={isDryRunActive}
                    uiMotion={uiMotion}
                    compact={!isTransferBayOpen}
                    highlighted={heroInspectHover}
                    onHoverChange={setHeroInspectHover}
                    onInspect={openSyncItemDetail}
                  />

                  <div
                    className={`flex-1 min-w-0 flex flex-col ${
                      isTransferBayOpen ? 'justify-between gap-2.5' : 'justify-center gap-1'
                    }`}
                  >
                    <h1 title={status.currentPhase} className="min-w-0">
                      <span className="flex items-baseline gap-2.5 min-w-0">
                        {parsedSyncHeader.actionPrefix && (
                          <span className="font-mono text-xs font-medium text-crt-muted whitespace-nowrap shrink-0">
                            {parsedSyncHeader.actionPrefix}
                          </span>
                        )}

                        {activeSyncTargetCover.itemId !== null ? (
                          <button
                            type="button"
                            onClick={() => openSyncItemDetail(activeSyncTargetCover.itemId!)}
                            onMouseEnter={() => setHeroInspectHover(true)}
                            onMouseLeave={() => setHeroInspectHover(false)}
                            onFocus={() => setHeroInspectHover(true)}
                            onBlur={() => setHeroInspectHover(false)}
                            aria-busy={isHeroSlowLoadingDetail}
                            title={`Inspect "${displayedSyncSubject}" details`}
                            className="group/title inline-flex items-baseline gap-2.5 max-w-full min-w-0 text-left cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crt-phosphor/70 focus-visible:ring-offset-2 focus-visible:ring-offset-crt-surface"
                          >
                            <span
                              key={`hero-title-${titleSwapSeq}`}
                              data-swap-accent={isDryRunActive ? 'amber' : 'phosphor'}
                              className={`crt-hero-game-title ${
                                titleSwapSeq > 0 && uiMotion !== 'off' ? 'crt-hero-title-enter' : ''
                              } font-display text-lg sm:text-[22px] font-bold tracking-tight leading-tight truncate min-w-0 transition-colors duration-150 ${
                                heroInspectHover
                                  ? isDryRunActive
                                    ? 'text-crt-amber'
                                    : 'text-crt-phosphor'
                                  : 'text-crt-text'
                              }`}
                            >
                              {displayedSyncSubject}
                            </span>
                            <span
                              aria-hidden="true"
                              className={`hidden sm:inline-flex items-center gap-0.5 text-[11px] font-mono whitespace-nowrap shrink-0 transition-opacity duration-150 motion-reduce:transition-none ${
                                heroInspectHover || isHeroSlowLoadingDetail
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              } ${isDryRunActive ? 'text-crt-amber/90' : 'text-crt-phosphor/90'}`}
                            >
                              {isHeroSlowLoadingDetail ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Opening…</span>
                                </>
                              ) : (
                                <>
                                  <span>Inspect</span>
                                  <ArrowUpRight className="h-3 w-3" />
                                </>
                              )}
                            </span>
                          </button>
                        ) : (
                          <span
                            key={`hero-title-static-${titleSwapSeq}`}
                            data-swap-accent={isDryRunActive ? 'amber' : 'phosphor'}
                            title={displayedSyncSubject}
                            className={`crt-hero-game-title ${
                              titleSwapSeq > 0 && uiMotion !== 'off' ? 'crt-hero-title-enter' : ''
                            } font-display text-lg sm:text-[22px] font-bold tracking-tight leading-tight text-crt-text truncate min-w-0`}
                          >
                            {displayedSyncSubject}
                          </span>
                        )}
                      </span>
                    </h1>

                    {isTransferBayOpen ? (
                      transferProgressBarBlock
                    ) : (
                      <p className="text-xs font-mono text-crt-muted truncate">
                        {isDryRunActive
                          ? 'Dry run preview · inspecting release metadata and sync rules'
                          : 'Preparing release assets and download queue'}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <h1
                    title={status.currentPhase}
                    className="mt-2.5 pt-2.5 border-t border-crt-border/70 min-w-0"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 min-w-0">
                      {parsedSyncHeader.actionPrefix && (
                        <span className="font-mono text-xs font-medium text-crt-muted whitespace-nowrap shrink-0">
                          {parsedSyncHeader.actionPrefix}
                        </span>
                      )}

                      {isHighlightedGameTarget ? (
                        <span
                          title={displayedSyncSubject}
                          className="crt-hero-game-title font-display text-lg sm:text-[21px] font-bold tracking-tight leading-tight text-crt-text truncate min-w-0"
                        >
                          {displayedSyncSubject}
                        </span>
                      ) : parsedSyncHeader.subjectKind === 'path' ? (
                        <span
                          title={displayedSyncSubject}
                          className="font-mono text-sm sm:text-[15px] font-medium leading-snug text-crt-text/90 truncate min-w-0"
                        >
                          {displayedSyncSubject}
                        </span>
                      ) : parsedSyncHeader.subjectKind === 'idle' ? (
                        <span
                          title={displayedSyncSubject}
                          className="font-display text-base sm:text-lg font-medium leading-snug text-crt-muted truncate min-w-0"
                        >
                          {displayedSyncSubject}
                        </span>
                      ) : (
                        <span
                          title={displayedSyncSubject}
                          className="font-display text-base sm:text-lg font-medium leading-snug text-crt-text/95 truncate min-w-0"
                        >
                          {displayedSyncSubject}
                        </span>
                      )}
                    </span>
                  </h1>

                  {/* Fallback Full-Width Transfer Bay when transfer runs before a game title resolves */}
                  <div
                    aria-hidden={!isTransferBayOpen}
                    inert={!isTransferBayOpen || undefined}
                    data-open={isTransferBayOpen ? 'true' : 'false'}
                    className={`crt-accordion-grid transition-opacity duration-300 motion-reduce:transition-none ${
                      isTransferBayOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <div className="crt-accordion-inner">
                      <div className="pt-3.5 mt-3 border-t border-crt-border/70">
                        {transferProgressBarBlock}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Full-Width Collapsible Transfer Details Drawer (starts collapsed every visit) */}
              {isTransferBayOpen && (combinedTransfer || heldTransferForActiveRun) && (
                <div
                  id="sync-transfer-details-drawer"
                  aria-hidden={!transferDetailsOpen}
                  inert={!transferDetailsOpen || undefined}
                  data-open={transferDetailsOpen ? 'true' : 'false'}
                  className={`crt-accordion-grid transition-opacity duration-300 motion-reduce:transition-none ${
                    transferDetailsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="crt-accordion-inner">
                    <div className="pt-3 mt-3.5 border-t border-crt-border/70 space-y-2.5">
                        {combinedTransfer ? (
                          <>
                            {hasMultipleParallelTransfers && (
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-crt-muted tabular-nums">
                                <span>
                                  {combinedTransfer.workerCount} parallel workers
                                  {combinedTransfer.totalChunks > 1
                                    ? ` · ${combinedTransfer.totalChunks} chunks total`
                                    : ''}
                                </span>
                                {combinedTransfer.bytesPerSec > 0 && (
                                  <span className="text-crt-phosphor/90">
                                    {formatBytes(combinedTransfer.bytesPerSec)}/s combined
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="space-y-2.5">
                              {parallelTransfers.map((item, idx) => {
                                const itemKey =
                                  item.workerKey ??
                                  `${item.itemId ?? 'item'}:${item.fileId ?? item.filename}:${idx}`;
                                const itemPct =
                                  item.totalBytes && item.totalBytes > 0
                                    ? Math.min(
                                        100,
                                        Math.round((item.bytesReceived / item.totalBytes) * 100),
                                      )
                                    : null;
                                return (
                                  <div key={itemKey} className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span
                                          aria-hidden="true"
                                          className="h-1.5 w-1.5 rounded-full bg-crt-phosphor shrink-0"
                                        />
                                        <span
                                          title={`${item.systemName} / ${item.filename}`}
                                          className="truncate min-w-0"
                                        >
                                          <span className="text-crt-muted">{item.systemName} /</span>{' '}
                                          <span className="text-crt-text font-medium">
                                            {item.filename}
                                          </span>
                                        </span>
                                        {item.activeWorkers && item.activeWorkers > 1 && (
                                          <span className="text-crt-muted whitespace-nowrap shrink-0 tabular-nums hidden md:inline">
                                            · {item.activeWorkers} workers
                                          </span>
                                        )}
                                        {item.activeChunks && item.activeChunks > 1 && (
                                          <span className="text-crt-muted whitespace-nowrap shrink-0 tabular-nums hidden sm:inline">
                                            · {item.activeChunks} chunks
                                          </span>
                                        )}
                                        {item.totalFiles && item.totalFiles > 1 && item.fileIndex && (
                                          <span className="text-crt-muted whitespace-nowrap shrink-0 tabular-nums hidden sm:inline">
                                            · File {item.fileIndex}/{item.totalFiles}
                                          </span>
                                        )}
                                        {item.resumed && (
                                          <span className="text-crt-phosphor/90 whitespace-nowrap shrink-0 hidden md:inline">
                                            · Resumed
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2.5 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
                                        <span>
                                          {item.bytesReceived > 0 || item.totalBytes
                                            ? `${formatBytes(item.bytesReceived)}${
                                                item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ''
                                              }`
                                            : 'Connecting…'}
                                        </span>
                                        {item.bytesPerSec > 0 && (
                                          <span className="hidden sm:inline">
                                            {formatBytes(item.bytesPerSec)}/s
                                          </span>
                                        )}
                                        {itemPct !== null && (
                                          <span className="text-crt-phosphor font-semibold inline-block min-w-[3.5ch] text-right">
                                            {itemPct}%
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {hasMultipleParallelTransfers && (() => {
                                      const workerWaveParams = computeSyncSpeedWaveParams(
                                        item.bytesPerSec,
                                        uiMotion,
                                        syncSpeedWave,
                                      );
                                      const workerWaveStyle = workerWaveParams.active
                                        ? ({
                                            '--crt-wave-duration': `${workerWaveParams.progressWaveDurationSec}s`,
                                          } as CSSProperties)
                                        : undefined;
                                      return (
                                        <div
                                          role="progressbar"
                                          aria-label={`Active download progress for ${item.filename}`}
                                          aria-valuemin={0}
                                          aria-valuemax={100}
                                          aria-valuenow={itemPct ?? undefined}
                                          className="h-1.5 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
                                        >
                                          {itemPct !== null ? (
                                            <div
                                              style={workerWaveStyle}
                                              className={`h-full bg-crt-phosphor crt-progress-beam ${
                                                workerWaveParams.active
                                                  ? 'crt-progress-beam-wave'
                                                  : ''
                                              } transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none ${
                                                PROGRESS_WIDTH_CLASSES[
                                                  Math.max(3, Math.min(100, itemPct))
                                                ]
                                              }`}
                                            />
                                          ) : unknownSizeGraceElapsed || item.bytesReceived > 0 ? (
                                            <div className="h-full bg-crt-phosphor crt-progress-indeterminate" />
                                          ) : (
                                            <div
                                              style={workerWaveStyle}
                                              className={`h-full bg-crt-phosphor/75 crt-progress-beam ${
                                                workerWaveParams.active
                                                  ? 'crt-progress-beam-wave'
                                                  : ''
                                              } transition-opacity duration-150 motion-reduce:transition-none ${PROGRESS_WIDTH_CLASSES[4]}`}
                                            />
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : heldTransferForActiveRun ? (
                          <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0 text-crt-muted">
                            <span
                              title={`${heldTransferForActiveRun.systemName} / ${heldTransferForActiveRun.filename}`}
                              className="truncate min-w-0"
                            >
                              Last file: {heldTransferForActiveRun.systemName} /{' '}
                              <span className="text-crt-text/90">
                                {heldTransferForActiveRun.filename}
                              </span>
                              {heldTransferForActiveRun.totalFiles &&
                              heldTransferForActiveRun.totalFiles > 1 &&
                              heldTransferForActiveRun.fileIndex
                                ? ` · File ${heldTransferForActiveRun.fileIndex}/${heldTransferForActiveRun.totalFiles}`
                                : ''}
                            </span>
                            <span className="tabular-nums whitespace-nowrap shrink-0">
                              {heldTransferForActiveRun.bytes > 0
                                ? `${formatBytes(heldTransferForActiveRun.bytes)} · `
                                : ''}
                              100%
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
            </div>

        {/* Zone 3: 4-Column Operational Summary Strip */}
        <div className="relative z-10 mt-4 pt-3.5 border-t border-crt-border grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-x-6">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-crt-muted">Next Schedule</span>
              <button
                type="button"
                onClick={() => onNavigateToOperations('schedule')}
                className="font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Edit
              </button>
            </div>
            <div className="text-xs font-mono text-crt-text tabular-nums truncate">
              {formatCountdown(status.nextScheduledRunAt)}
            </div>
          </div>

          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-crt-muted">Incremental Cutoff</span>
              <button
                type="button"
                disabled={Boolean(status.activeRun)}
                onClick={handleToggleCutoffEditor}
                title={
                  status.activeRun
                    ? 'Stop or wait for the active sync run before changing cutoff'
                    : 'View or manually override Incremental Sync cutoff timestamp'
                }
                className="font-mono text-crt-phosphor hover:underline disabled:opacity-45 disabled:no-underline disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
              >
                {editingCutoff ? 'Close' : 'Edit'}
              </button>
            </div>
            <div className="text-xs font-mono text-crt-text tabular-nums truncate">
              {activeWatermark ? formatDateTime(activeWatermark) : 'Last 24h (default)'}
            </div>
          </div>

          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-crt-muted">Type Filter</span>
              <button
                type="button"
                onClick={() => onNavigateToOperations('releaseTypes')}
                className="font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Edit
              </button>
            </div>
            <div
              className={`text-xs font-mono truncate ${
                activeReleaseTypesSummary ? 'text-crt-amber' : 'text-crt-text'
              }`}
              title={activeReleaseTypesSummary || 'All release types'}
            >
              {activeReleaseTypesSummary || 'All release types'}
            </div>
          </div>

          <div className="space-y-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-crt-muted">Target Consoles</span>
              <button
                type="button"
                onClick={() => onNavigateToOperations('systems')}
                className="font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Edit
              </button>
            </div>
            <div className="text-xs font-mono text-crt-text tabular-nums truncate">
              {activeSystemScopeCount > 0 ? `${activeSystemScopeCount} selected` : 'All consoles'}
            </div>
          </div>
        </div>

        {/* Zone 3.4: Auto-Resume / Paused Download Queue Recovery Strip */}
        {!status.activeRun && status.totals.queuedItems > 0 && (onResumeDownloadQueue || onClearDownloadQueue) && (() => {
          const autoResume = status.queueAutoResume;
          const isScheduled = autoResume?.phase === 'scheduled';
          const isCircuitOpen = autoResume?.phase === 'circuit_open';
          const isBlockedAuth = autoResume?.phase === 'blocked_auth';
          const remainingMs =
            isScheduled && autoResume?.resumeAt
              ? Math.max(0, Date.parse(autoResume.resumeAt) - Date.now())
              : 0;
          const causeLabel = formatInterruptionCauseLabel(autoResume?.lastInterruptionCause ?? null);
          const attemptSuffix =
            autoResume && autoResume.attempt > 1
              ? ` · backoff attempt ${autoResume.attempt}/${autoResume.maxAttempts}`
              : autoResume && autoResume.attempt > 0
                ? ` · attempt ${autoResume.attempt}/${autoResume.maxAttempts}`
                : '';

          return (
            <div
              className={`mt-3.5 pt-3 border-t flex flex-wrap items-center justify-between gap-3 ${
                isScheduled
                  ? 'border-crt-phosphor/45'
                  : isCircuitOpen
                    ? 'border-crt-crimson/45'
                    : 'border-crt-amber/40'
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`inline-flex items-center gap-1.5 font-mono font-semibold ${
                      isScheduled
                        ? 'text-crt-phosphor'
                        : isCircuitOpen
                          ? 'text-crt-crimson'
                          : 'text-crt-amber'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${
                        isScheduled
                          ? 'bg-crt-phosphor animate-pulse'
                          : isCircuitOpen
                            ? 'bg-crt-crimson'
                            : 'bg-crt-amber'
                      }`}
                    />
                    {isScheduled
                      ? 'Auto-Resuming Queue'
                      : isCircuitOpen
                        ? 'Auto-Resume Paused · Backoff Limit'
                        : 'Paused Download Queue'}
                  </span>
                  <span className="font-mono text-crt-text tabular-nums">
                    · {status.totals.queuedItems.toLocaleString()} release
                    {status.totals.queuedItems === 1 ? '' : 's'} waiting
                  </span>
                </div>
                <p className="text-xs font-mono text-crt-muted tabular-nums">
                  {isScheduled
                    ? `${causeLabel} — resuming automatically in ${formatAutoResumeDuration(remainingMs)}${attemptSuffix}.`
                    : isCircuitOpen
                      ? autoResume?.reason ||
                        'Interrupted repeatedly without stabilizing — auto-resume paused to prevent a restart loop.'
                      : isBlockedAuth
                        ? 'Verify repository login in System Settings to automatically resume downloads.'
                        : autoResume?.phase === 'user_paused'
                          ? 'Paused by user — resume where it left off or clear back to available.'
                          : 'Left pending after a stop or container restart — resume where it left off or clear back to available.'}
                </p>
                <EphemeralNotice
                  message={pausedQueueNotice}
                  tone="amber"
                  variant="compact"
                  autoDismissMs={5000}
                  onDismiss={() => setPausedQueueNotice(null)}
                  surfaceClassName="text-[11px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {onResumeDownloadQueue && (
                  <button
                    type="button"
                    disabled={!status.auth.hasCompletedLogin || resumingQueue || clearingQueue || pausingAutoResume}
                    onClick={() => void handleResumePausedQueueAction()}
                    title={
                      !status.auth.hasCompletedLogin
                        ? 'Verify login in System Settings before resuming downloads'
                        : isScheduled
                          ? `Skip countdown and resume downloading ${status.totals.queuedItems.toLocaleString()} queued release${status.totals.queuedItems === 1 ? '' : 's'} immediately`
                          : `Resume downloading ${status.totals.queuedItems.toLocaleString()} paused queued release${status.totals.queuedItems === 1 ? '' : 's'}`
                    }
                    className="crt-cta-beam inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-crt-phosphor text-crt-bg hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer tabular-nums"
                  >
                    {resumingQueue ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    ) : (
                      <Play className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {resumingQueue
                        ? 'Resuming...'
                        : isScheduled
                          ? `Resume Now (${status.totals.queuedItems.toLocaleString()})`
                          : `Resume Queue (${status.totals.queuedItems.toLocaleString()})`}
                    </span>
                  </button>
                )}
                {isScheduled && onPauseQueueAutoResume && (
                  <button
                    type="button"
                    disabled={pausingAutoResume || resumingQueue || clearingQueue}
                    onClick={() => void handlePauseAutoResumeAction()}
                    title="Cancel automatic resume and keep the download queue paused"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-amber/70 hover:text-crt-amber text-crt-text rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 cursor-pointer"
                  >
                    {pausingAutoResume ? (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    ) : (
                      <Pause className="h-3 w-3 shrink-0" />
                    )}
                    <span>Pause</span>
                  </button>
                )}
                {onViewQueuedInCatalog && (
                  <button
                    type="button"
                    onClick={onViewQueuedInCatalog}
                    className="px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    View Queued
                  </button>
                )}
              {onClearDownloadQueue && (
                confirmClearQueue ? (
                  <div className="inline-flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-mono text-crt-amber tabular-nums">
                      Clear {status.totals.queuedItems.toLocaleString()}?
                    </span>
                    <button
                      type="button"
                      disabled={clearingQueue}
                      onClick={() => void handleClearPausedQueueAction()}
                      className="px-2.5 py-1.5 text-xs font-semibold border border-crt-crimson/70 bg-crt-crimson/15 text-crt-crimson hover:bg-crt-crimson/25 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                    >
                      {clearingQueue ? 'Clearing...' : 'Confirm Clear'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearQueue(false)}
                      className="px-2 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={resumingQueue || clearingQueue}
                    onClick={() => setConfirmClearQueue(true)}
                    title="Reset paused queued releases back to available without deleting already downloaded files"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-crimson/60 text-crt-muted hover:text-crt-crimson rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Clear Queue</span>
                  </button>
                )
              )}
              </div>
            </div>
          );
        })()}

        {/* Zone 3.5: Catalog Index Readiness & Direct Rule Queue Strip */}
        {preflight && (
          <div className="mt-3.5 pt-3 border-t border-crt-border flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-crt-muted">Sync Rule Readiness</span>
                <span className="font-mono text-crt-text truncate max-w-md" title={preflight.ruleScopeLabel}>
                  · {preflight.ruleScopeLabel}
                </span>
              </div>
              <p className="text-xs font-mono text-crt-muted tabular-nums">
                <span className={preflight.pendingDownloadCount > 0 ? 'text-crt-phosphor font-medium' : 'text-crt-text'}>
                  {preflight.pendingDownloadCount.toLocaleString()} pending
                </span>
                {preflight.estimatedPendingBytes > 0 && (
                  <span> (~{formatBytes(preflight.estimatedPendingBytes)})</span>
                )}
                {' · '}
                <span>{preflight.alreadyDownloadedCount.toLocaleString()} on disk</span>
                {preflight.excludedByRulesCount > 0 && (
                  <span> · {preflight.excludedByRulesCount.toLocaleString()} excluded</span>
                )}
                {' · '}
                <span
                  className="cursor-help"
                  title={`Fresh = catalog metadata checked against RetroGameTalk within 12h (${preflight.freshConsoles.length}/${preflight.targetSystemsCount}). Stale = last checked >12h ago (${preflight.staleConsoles.length}).${
                    preflight.oldestIndexedAt
                      ? ` Oldest target check: ${formatDateTime(preflight.oldestIndexedAt)}.`
                      : ''
                  }`}
                >
                  <span>
                    Index {preflight.freshConsoles.length}/{preflight.targetSystemsCount} fresh
                  </span>
                  {preflight.unindexedConsoles.length > 0 && (
                    <span className="text-crt-amber"> · {preflight.unindexedConsoles.length} unindexed</span>
                  )}
                  {preflight.staleConsoles.length > 0 && (
                    <span className="text-crt-amber"> · {preflight.staleConsoles.length} stale (&gt;12h)</span>
                  )}
                </span>
              </p>
              <EphemeralNotice
                message={monitorQueueNotice}
                tone="phosphor"
                variant="compact"
                autoDismissMs={5000}
                onDismiss={() => setMonitorQueueNotice(null)}
                surfaceClassName="text-[11px]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {status.auth.hasCompletedLogin && status.indexer?.active && onStopCatalogIndex ? (
                <button
                  type="button"
                  disabled={indexerBusy}
                  onClick={async () => {
                    setIndexerBusy(true);
                    try {
                      await onStopCatalogIndex();
                    } finally {
                      setIndexerBusy(false);
                    }
                  }}
                  title="Pause background catalog indexing (already indexed games stay saved)"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-amber/60 text-crt-amber hover:bg-crt-amber/10 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Pause className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Indexing {status.indexer.systemsCompleted + (status.indexer.currentSystem ? 1 : 0)}/
                    {Math.max(1, status.indexer.systemsTotal)} · Pause
                  </span>
                </button>
              ) : (
                status.auth.hasCompletedLogin &&
                onStartCatalogIndex &&
                (preflight.staleConsoles.length > 0 || preflight.unindexedConsoles.length > 0) && (
                  <button
                    type="button"
                    disabled={indexerBusy}
                    onClick={async () => {
                      setIndexerBusy(true);
                      try {
                        await onStartCatalogIndex('filtered');
                      } finally {
                        setIndexerBusy(false);
                      }
                    }}
                    title="Check RetroGameTalk for new or modified games across your stale/unindexed target consoles (metadata delta check; does not download ROMs)"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-amber/65 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/18 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${indexerBusy ? 'animate-spin' : ''}`} />
                    <span>
                      {preflight.unindexedConsoles.length > 0 && preflight.staleConsoles.length > 0
                        ? `Update Index (${preflight.unindexedConsoles.length} new · ${preflight.staleConsoles.length} stale)`
                        : preflight.unindexedConsoles.length > 0
                          ? `Index Consoles (${preflight.unindexedConsoles.length} new)`
                          : `Update Index (${preflight.staleConsoles.length} stale)`}
                    </span>
                  </button>
                )
              )}
              {onPreviewRuleMatchesInCatalog && (
                <button
                  type="button"
                  onClick={() => onPreviewRuleMatchesInCatalog(true)}
                  className="px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  View in Catalog
                </button>
              )}
              {onQueueRuleMatches && preflight.pendingDownloadCount > 0 && (
                confirmQueueRuleMatches ? (
                  <div className="inline-flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-mono text-crt-amber tabular-nums">
                      Queue {preflight.pendingDownloadCount.toLocaleString()}?
                    </span>
                    <button
                      type="button"
                      disabled={queueingRuleMatches}
                      onClick={() => void handleQueueRuleMatchesAction()}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-crt-phosphor text-crt-bg hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                    >
                      {queueingRuleMatches ? 'Queueing...' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmQueueRuleMatches(false)}
                      className="px-2 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      queueingRuleMatches ||
                      Boolean(status.activeRun && status.activeRun.triggerType !== 'download')
                    }
                    onClick={() => {
                      if (preflight.pendingDownloadCount > 25) {
                        setConfirmQueueRuleMatches(true);
                      } else {
                        void handleQueueRuleMatchesAction();
                      }
                    }}
                    title="Queue all cataloged releases matching active Sync Rules that are not yet downloaded"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {queueingRuleMatches
                        ? 'Queueing...'
                        : `Queue Pending (${preflight.pendingDownloadCount.toLocaleString()})`}
                    </span>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Latest Structured Dry Run Result Callout */}
        {latestDryRunWithSummary?.summary && (
          <div className="mt-3 pt-3 border-t border-crt-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <FlaskConical className="h-4 w-4 text-crt-amber shrink-0 mt-0.5" />
              <div className="space-y-0.5 min-w-0">
                <div className="text-[11px] font-mono text-crt-amber tabular-nums">
                  Latest Dry Run (#{latestDryRunWithSummary.id} ·{' '}
                  {latestDryRunWithSummary.mode === 'full' ? 'Index-First Full' : 'Incremental Delta'})
                </div>
                <p className="text-xs font-mono text-crt-muted tabular-nums">
                  <span className="text-crt-text font-medium">
                    {latestDryRunWithSummary.summary.wouldDownloadCount.toLocaleString()} would download
                  </span>
                  {latestDryRunWithSummary.summary.estimatedDownloadBytes > 0 && (
                    <span> (~{formatBytes(latestDryRunWithSummary.summary.estimatedDownloadBytes)})</span>
                  )}
                  {' · '}
                  <span>{latestDryRunWithSummary.summary.alreadyOnDiskCount.toLocaleString()} on disk</span>
                  {latestDryRunWithSummary.summary.excludedByRulesCount > 0 && (
                    <span> · {latestDryRunWithSummary.summary.excludedByRulesCount.toLocaleString()} rule-excluded</span>
                  )}
                  {latestDryRunWithSummary.summary.refreshedConsoles.length > 0 && (
                    <span> · {latestDryRunWithSummary.summary.refreshedConsoles.length} console index(es) checked</span>
                  )}
                </p>
              </div>
            </div>
            {latestDryRunWithSummary.summary.wouldDownloadCount > 0 && onPreviewRuleMatchesInCatalog && (
              <button
                type="button"
                onClick={() => onPreviewRuleMatchesInCatalog(true)}
                className="px-2.5 py-1 text-xs font-mono border border-crt-amber/50 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Inspect Pending Matches
              </button>
            )}
          </div>
        )}

        {/* Inline Incremental Cutoff Timestamp Editor (Smooth Accordion Disclosure) */}
        <div
          aria-hidden={!(editingCutoff && !status.activeRun)}
          inert={!(editingCutoff && !status.activeRun) || undefined}
          data-open={editingCutoff && !status.activeRun ? 'true' : 'false'}
          className={`crt-accordion-grid transition-opacity duration-250 motion-reduce:transition-none ${
            editingCutoff && !status.activeRun
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="crt-accordion-inner">
            <div className="pt-4">
              <div className="pt-4 border-t border-crt-border space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-crt-muted">
                    Incremental Sync (live or dry-run) inspects releases created or updated after this cutoff. Full Sync (live or dry-run) inspects every release in scope.
                  </span>
                  <span className="font-mono text-crt-muted tabular-nums">
                    UTC: {resolvedCutoffPreviewIso ?? '—'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      aria-label="Incremental cutoff date and time"
                      value={cutoffLocalInput}
                      disabled={cutoffSaving}
                      onChange={(e) => {
                        setCutoffLocalInput(e.target.value);
                        setCutoffError(null);
                      }}
                      className="px-3 py-1.5 text-xs font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-50"
                    />

                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { label: '24h Ago', hours: 24 },
                        { label: '7d Ago', hours: 24 * 7 },
                        { label: '30d Ago', hours: 24 * 30 },
                        { label: 'Now', hours: 0 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={cutoffSaving}
                          onClick={() => applyCutoffPresetHoursAgo(preset.hours)}
                          className="px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                        >
                          {preset.label}
                        </button>
                      ))}

                      <button
                        type="button"
                        disabled={cutoffSaving || !activeWatermark}
                        onClick={() => void handleResetCutoffDefault()}
                        title="Clear stored watermark so Incremental Sync uses the rolling 24-hour default lookback"
                        className="px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-amber hover:text-crt-amber text-crt-muted rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Reset Default
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <button
                      type="button"
                      disabled={cutoffSaving}
                      onClick={() => {
                        setEditingCutoff(false);
                        setCutoffError(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={cutoffSaving || !resolvedCutoffPreviewIso}
                      onClick={() => void handleSaveCutoff()}
                      className="crt-cta-beam px-3.5 py-1.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {cutoffSaving ? 'Saving...' : 'Save Cutoff'}
                    </button>
                  </div>
                </div>

                {cutoffError && (
                  <p className="text-xs font-mono text-crt-crimson">{cutoffError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4-Column KPI Strip + Inline Collapsible Failed Queue */}
      <div>
        <section className="relative crt-panel-living grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 border border-crt-border bg-crt-surface rounded-md divide-y sm:divide-y-0 sm:divide-x divide-crt-border">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          <div className="p-4 space-y-1">
          <p className="text-xs text-crt-muted">Mirrored Files on Disk</p>
          <p className="crt-kpi-value font-mono text-2xl font-semibold text-crt-text tabular-nums">
            {status.storage.totalFilesOnDisk.toLocaleString()}
          </p>
          <p className="text-xs font-mono text-crt-muted tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>
              {status.totals.downloadedItems.toLocaleString()} downloaded
            </span>
            {status.totals.availableItems > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{status.totals.availableItems.toLocaleString()} available</span>
              </>
            )}
            {(status.totals.failedItems > 0 || failedQueueOpen) && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  aria-expanded={failedQueueOpen}
                  onClick={() => setFailedQueueOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1 hover:underline whitespace-nowrap shrink-0 cursor-pointer ${
                    status.totals.failedItems > 0 ? 'text-crt-crimson' : 'text-crt-phosphor'
                  }`}
                  title={
                    failedQueueOpen
                      ? 'Hide inline Failed Queue drawer'
                      : 'Open inline Failed Queue drawer to inspect errors and retry downloads'
                  }
                >
                  {status.totals.failedItems > 0 ? (
                    <XCircle className="h-3 w-3 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  )}
                  <span>
                    {status.totals.failedItems} failed · {failedQueueOpen ? 'Hide' : 'Review'}
                  </span>
                  {failedQueueOpen ? (
                    <ChevronUp className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                </button>
              </>
            )}
          </p>
        </div>

        <div className="p-4 space-y-1">
          <p className="text-xs text-crt-muted">Local Archive Footprint</p>
          <p className="crt-kpi-value font-mono text-2xl font-semibold text-crt-text tabular-nums">
            {formatBytes(status.storage.totalBytesOnDisk)}
          </p>
          <p className="text-xs font-mono text-crt-muted tabular-nums">
            {status.storage.diskFreeBytes !== null
              ? `${formatBytes(status.storage.diskFreeBytes)} free on volume`
              : status.storage.writable ? 'Volume writable' : 'Volume read-only'}
          </p>
        </div>

        <div className="p-4 space-y-1">
          <p className="text-xs text-crt-muted">Adaptive Request Delay</p>
          <p className="crt-kpi-value font-mono text-2xl font-semibold text-crt-phosphor tabular-nums">
            {status.rateLimiter.currentDelayMs} ms
          </p>
          <p className="text-xs font-mono text-crt-muted tabular-nums">
            Avg latency {status.rateLimiter.avgLatencyMs} ms · Floor {status.rateLimiter.minDelayMs} ms
          </p>
        </div>

        <div className="p-4 space-y-1">
          <p className="text-xs text-crt-muted">Rate Limit Events</p>
          <p
            className={`crt-kpi-value font-mono text-2xl font-semibold tabular-nums ${
              status.rateLimiter.rateLimitHits > 0 ? 'text-crt-amber' : 'text-crt-text'
            }`}
          >
            {status.rateLimiter.rateLimitHits}
          </p>
          <p className="text-xs font-mono text-crt-muted tabular-nums">
            {status.rateLimiter.cooldownUntilMs
              ? `Cooldown active`
              : `${status.rateLimiter.totalRequests} requests tracked`}
          </p>
        </div>
      </section>

        {/* Slide-Down Failed Queue Drawer */}
        <FailedQueueDrawer
          open={failedQueueOpen}
          status={status}
          installer={installer}
          allowedReleaseTypes={config.allowedReleaseTypes}
          catalogRevision={catalogRevision}
          activeRetryItemId={activeRetryItemId}
          onClose={() => setFailedQueueOpen(false)}
          onRetryItem={onRetryItem}
          onRetryAllFailed={onRetryAllFailed}
          onRefreshStatus={onRefreshStatus}
        />
      </div>

      {/* Grafana-Style Telemetry Deck & Recent Sync Runs (2-Column Balanced Split) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <TelemetryDeck status={status} runs={runs} />

        {/* Recent Sync Runs Table */}
        <div className="relative crt-panel-living lg:col-span-6 border border-crt-border bg-crt-surface rounded-md p-5 flex flex-col">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-crt-text">
                Recent Synchronization Runs
              </h2>
              <p className="text-xs text-crt-muted">
                Incremental delta checks, dry runs, and full archive mirrors
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-xs text-crt-muted tabular-nums">
                {status.totals.totalRuns} total runs
              </span>
              <button
                type="button"
                disabled={!runs.some((r) => r.status !== 'running')}
                onClick={() => void onClearRuns()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-crimson hover:text-crt-crimson text-crt-muted rounded transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                title="Clear completed, stopped, and failed sync run history"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          {runs.length === 0 ? (
            <div className="flex-1 border border-crt-border bg-crt-bg rounded flex flex-col items-center justify-center p-8 text-center space-y-2">
              <Clock className="h-5 w-5 text-crt-muted" />
              <p className="text-sm text-crt-text font-medium">No sync runs recorded yet</p>
              <p className="text-xs text-crt-muted max-w-sm">
                Choose Incremental or Full scope in the top header bar (and toggle Dry Run to simulate safely) to preview or mirror releases.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-crt-border rounded">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-crt-border bg-crt-bg text-[11px] font-mono text-crt-muted">
                    <th className="py-2 px-3 font-medium">Run</th>
                    <th className="py-2 px-3 font-medium">Mode</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                    <th className="py-2 px-3 font-medium text-right">New</th>
                    <th className="py-2 px-3 font-medium text-right">Saved</th>
                    <th className="py-2 px-3 font-medium text-right">Skipped</th>
                    <th className="py-2 px-3 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crt-border text-xs font-mono tabular-nums">
                  {runs.slice(0, 7).map((run) => {
                    const isDry = Boolean(run.dryRun) || run.mode === 'dry_run';
                    const baseScope =
                      run.triggerType === 'retry'
                        ? 'retry'
                        : run.triggerType === 'download'
                          ? 'queue'
                          : run.mode === 'dry_run'
                            ? 'incremental'
                            : run.mode;
                    const wouldDownload = Math.max(0, run.newFound - run.skippedCount - run.failedCount);
                    return (
                      <tr key={run.id} className="crt-table-row h-9 hover:bg-crt-elevated transition-colors">
                        <td className="px-3 text-crt-text whitespace-nowrap">
                          #{run.id} <span className="text-crt-muted">· {run.triggerType}</span>
                        </td>
                        <td className="px-3 text-crt-muted whitespace-nowrap">
                          <span>{baseScope}</span>
                          {isDry && <span className="text-crt-amber"> · dry-run</span>}
                        </td>
                        <td className="px-3 whitespace-nowrap" title={run.errorSummary || undefined}>
                          <span
                            className={`inline-flex items-center gap-1.5 ${
                              run.status === 'completed'
                                ? 'text-crt-phosphor'
                                : run.status === 'running'
                                  ? 'text-crt-amber'
                                  : run.status === 'failed'
                                    ? 'text-crt-crimson'
                                    : 'text-crt-muted'
                            }`}
                          >
                            {run.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5" />}
                            {run.status === 'failed' && <XCircle className="h-3.5 w-3.5" />}
                            {run.status === 'running' && <Activity className="h-3.5 w-3.5" />}
                            {run.status === 'stopped' && <Pause className="h-3.5 w-3.5" />}
                            {run.status}
                          </span>
                        </td>
                        <td
                          className="px-3 text-right text-crt-text"
                          title={
                            isDry
                              ? `Dry Run: ${wouldDownload} would download · ${run.skippedCount} already on disk`
                              : undefined
                          }
                        >
                          {run.newFound}
                        </td>
                        <td className="px-3 text-right text-crt-phosphor">
                          {isDry ? '—' : run.downloadedCount}
                        </td>
                        <td className="px-3 text-right text-crt-muted">{run.skippedCount}</td>
                        <td className="px-3 text-right text-crt-muted whitespace-nowrap">
                          {formatRunDuration(run.startedAt, run.finishedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Live Event Stream Console */}
      <section className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-5 space-y-3">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <LivingTerminalIcon />
            <h2 className="font-display text-base font-semibold text-crt-text">
              Live Scraper Event Stream
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="Filter scraper events by type"
              className="flex flex-wrap items-center gap-1 p-1 bg-crt-bg border border-crt-border rounded"
            >
              {LOG_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={logFilter === opt.value}
                  onClick={() => setLogFilter(opt.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    logFilter === opt.value
                      ? opt.activeClass
                      : 'text-crt-muted hover:text-crt-text'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setAutoScroll((s) => !s)}
              className={`px-3 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoScroll
                  ? 'border-crt-phosphor/50 text-crt-phosphor bg-crt-phosphor/5'
                  : 'border-crt-border text-crt-muted hover:text-crt-text'
              }`}
            >
              {autoScroll ? 'Auto-Follow: ON' : 'Auto-Follow: OFF'}
            </button>

            <div className="w-[164px] flex justify-end shrink-0">
              <button
                type="button"
                disabled={filteredLogs.length === 0}
                onClick={() => void onClearLogs(logFilter)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-crimson hover:text-crt-crimson text-crt-muted rounded transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title={`Clear ${activeFilterOption.clearLabel.toLowerCase()} log entries`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear {activeFilterOption.clearLabel}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="crt-console-shell relative border border-crt-border bg-crt-bg rounded overflow-hidden">
          <div aria-hidden="true" className="crt-console-scan" />
          <div
            ref={logContainerRef}
            className="h-64 overflow-y-auto p-3 font-mono text-xs space-y-1.5"
          >
            {filteredLogs.length === 0 ? (
              <div className="text-crt-muted py-6 text-center space-y-1">
                <p>No {activeFilterOption.emptyLabel} recorded yet.</p>
                {logFilter === 'debug' && !status.debugLogging && (
                  <p className="text-[11px] text-crt-muted/80">
                    DEBUG logging is currently disabled. Set{' '}
                    <code className="text-crt-text">SCRAPER_DEBUG=true</code> or Helm{' '}
                    <code className="text-crt-text">scraper.debug: true</code> and restart to stream debug telemetry.
                  </p>
                )}
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 leading-relaxed">
                  <span className="text-crt-muted tabular-nums shrink-0">
                    {formatTimeShort(entry.createdAt)}
                  </span>
                  <span
                    className={`w-20 shrink-0 uppercase ${
                      entry.level === 'download'
                        ? 'text-crt-phosphor'
                        : entry.level === 'throttle' || entry.level === 'warn'
                          ? 'text-crt-amber'
                          : entry.level === 'error'
                            ? 'text-crt-crimson'
                            : entry.level === 'debug'
                              ? 'text-crt-muted/75'
                              : 'text-crt-muted'
                    }`}
                  >
                    [{entry.level}]
                  </span>
                  <div className="min-w-0 text-crt-text break-words">
                    <span>{entry.message}</span>
                    {entry.detail && (
                      <span className="text-crt-muted ml-2">· {entry.detail}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <GameDetailDrawer
        item={activeDetailItem}
        activeRun={Boolean(status.activeRun)}
        activeTransfer={activeDetailTransfer}
        canSync={Boolean(status.auth.hasCompletedLogin)}
        retryingItem={activeRetryItemId === activeDetailItem?.id}
        mountedDeviceName={effectiveMountedDeviceName}
        mountedDeviceId={activeDeviceProfile?.id ?? null}
        isInstallingToDevice={Boolean(activeDetailInstallState?.isActive)}
        isAnotherDeviceInstallBusy={Boolean(
          installer.isBusy && !installer.canAppendToQueue && !activeDetailInstallState?.isActive,
        )}
        canQueueDeviceInstall={Boolean(
          installer.canAppendToQueue && !activeDetailInstallState?.isActive,
        )}
        deviceInstallState={activeDetailInstallState}
        uninstallingFromDevice={Boolean(
          activeDetailItem && installer.uninstallingItemIds.has(activeDetailItem.id),
        )}
        onClose={closeSyncItemDetail}
        onItemUpdated={(updated) => setActiveDetailItem(updated)}
        onRetryItem={onRetryItem}
        onQueueDownload={onQueueDownload}
        onExpressInstallToDevice={handleExpressInstallDetail}
        onUpgradeOnDevice={handleUpgradeDetail}
        onExportToSdCard={handleExportDetailToSdCard}
        onUninstallFromDevice={handleUninstallDetailFromDevice}
        onCancelDeviceInstall={installer.cancelInstall}
        onDismissDeviceInstall={installer.dismissJob}
        onViewDeviceInstallQueue={installer.openModal}
        onDeleteItem={handleDeleteDetailItem}
      />
    </div>
  );
}
