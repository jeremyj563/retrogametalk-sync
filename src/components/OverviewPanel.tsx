import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Pause,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  formatAllowedReleaseTypesSummary,
  normalizeAllowedReleaseTypes,
} from '../shared/releaseTypeFilter';
import type {
  ActivityLogRecord,
  LogLevel,
  OperationsSectionTarget,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  SyncRunRecord,
} from '../types';
import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatRunDuration,
  formatTimeShort,
} from '../utils/format';
import { FailedQueueDrawer } from './FailedQueueDrawer';
import { LivingNavIcon, LivingTerminalIcon } from './LivingNavIcon';
import { TelemetryDeck } from './TelemetryDeck';

interface OverviewPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  runs: SyncRunRecord[];
  logs: ActivityLogRecord[];
  logsClearedRevision?: number;
  catalogRevision: number;
  activeRetryItemId?: number | null;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
  onClearLogs: (level: 'all' | LogLevel) => Promise<void>;
  onClearRuns: () => Promise<void>;
  onNavigateToOperations: (target?: OperationsSectionTarget) => void;
  onRetryItem: (itemId: number, fileId?: number, options?: { dryRun?: boolean }) => Promise<void>;
  onRetryAllFailed: (options?: { system?: string; ids?: number[]; dryRun?: boolean }) => Promise<void>;
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
  fileKey: string;
  systemName: string;
  filename: string;
  fileIndex: number | null;
  totalFiles: number | null;
  bytes: number;
  downloadedCount: number;
}

function toLocalDateTimeInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function OverviewPanel({
  config,
  status,
  runs,
  logs,
  logsClearedRevision = 0,
  catalogRevision,
  activeRetryItemId = null,
  onSaveConfig,
  onClearLogs,
  onClearRuns,
  onNavigateToOperations,
  onRetryItem,
  onRetryAllFailed,
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
  const [, setTick] = useState(0);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

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

  const transferPct = useMemo(() => {
    const t = status.activeTransfer;
    if (!t || !t.totalBytes || t.totalBytes <= 0) return null;
    return Math.min(100, Math.round((t.bytesReceived / t.totalBytes) * 100));
  }, [status.activeTransfer]);

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
    setLastCompletedTransfer((prev) => {
      const nextRunId = status.activeRun?.id ?? prev?.runId ?? null;
      const nextDownloadedCount = status.activeRun?.downloadedCount ?? prev?.downloadedCount ?? 0;
      if (
        prev &&
        prev.runId === nextRunId &&
        prev.fileKey === fileKey &&
        prev.bytes === bytes &&
        prev.downloadedCount === nextDownloadedCount
      ) {
        return prev;
      }
      return {
        runId: nextRunId,
        fileKey,
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
    status.activeTransfer?.totalBytes && status.activeTransfer.totalBytes > 0,
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
      setTimeout(() => setCutoffSavedNotice(null), 3500);
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
      setTimeout(() => setCutoffSavedNotice(null), 3500);
    } catch (err) {
      setCutoffError(err instanceof Error ? err.message : String(err));
    } finally {
      setCutoffSaving(false);
    }
  };

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

      {/* Active Runner Phase Status Panel */}
      <section className="relative crt-panel-living crt-panel-hero border border-crt-border bg-crt-surface rounded-md p-5">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        {/* Zone 1: Full-Width Phase Header (Locked Single-Line Geometry) */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center justify-between gap-3 text-xs font-mono min-w-0">
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

            {status.activeRun ? (
              <span className="text-crt-muted tabular-nums truncate">
                {formatRunDuration(status.activeRun.startedAt, null)} elapsed
                {status.activeRun.downloadedCount > 0
                  ? ` · ${status.activeRun.downloadedCount} downloaded`
                  : ''}
              </span>
            ) : cutoffSavedNotice && !editingCutoff ? (
              <span className="text-crt-phosphor whitespace-nowrap shrink-0">{cutoffSavedNotice}</span>
            ) : null}
          </div>

          <h1
            title={status.currentPhase}
            className="font-display text-lg sm:text-xl font-semibold tracking-tight text-crt-text leading-snug truncate"
          >
            {status.currentPhase}
          </h1>
        </div>

        {/* Zone 2: Run-Docked Active Transfer Telemetry Bay (Zero Inter-File Layout Shift) */}
        <div
          aria-hidden={!isTransferBayOpen}
          inert={!isTransferBayOpen || undefined}
          data-open={isTransferBayOpen ? 'true' : 'false'}
          className={`crt-accordion-grid transition-opacity duration-200 motion-reduce:transition-none ${
            isTransferBayOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="crt-accordion-inner">
            <div className="pt-4">
              <div className="pt-3.5 border-t border-crt-border space-y-2">
                {status.activeTransfer ? (
                  <>
                    <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
                      <div className="flex items-center gap-2 text-crt-text min-w-0">
                        <Download className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
                        <span className="truncate">
                          {status.activeTransfer.systemName} / {status.activeTransfer.filename}
                        </span>
                        {status.activeTransfer.totalFiles &&
                          status.activeTransfer.totalFiles > 1 &&
                          status.activeTransfer.fileIndex && (
                            <span className="text-crt-muted whitespace-nowrap shrink-0 tabular-nums hidden sm:inline">
                              · File {status.activeTransfer.fileIndex}/{status.activeTransfer.totalFiles}
                            </span>
                          )}
                        {status.activeTransfer.activeWorkers &&
                          status.activeTransfer.activeWorkers > 1 && (
                            <span className="text-crt-muted whitespace-nowrap shrink-0 tabular-nums hidden md:inline">
                              · {status.activeTransfer.activeWorkers} workers
                            </span>
                          )}
                        {status.activeTransfer.activeChunks &&
                          status.activeTransfer.activeChunks > 1 && (
                            <span className="text-crt-muted whitespace-nowrap shrink-0 tabular-nums hidden sm:inline">
                              · {status.activeTransfer.activeChunks} chunks
                            </span>
                          )}
                        {status.activeTransfer.resumed && (
                          <span className="text-crt-phosphor/90 whitespace-nowrap shrink-0 hidden md:inline">
                            · Resumed
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
                        <span>
                          {status.activeTransfer.bytesReceived > 0 || status.activeTransfer.totalBytes
                            ? `${formatBytes(status.activeTransfer.bytesReceived)}${
                                status.activeTransfer.totalBytes
                                  ? ` / ${formatBytes(status.activeTransfer.totalBytes)}`
                                  : ''
                              }`
                            : 'Connecting…'}
                        </span>
                        {status.activeTransfer.bytesPerSec > 0 && (
                          <span className="hidden sm:inline">
                            {formatBytes(status.activeTransfer.bytesPerSec)}/s
                          </span>
                        )}
                        {transferPct !== null && (
                          <span className="text-crt-phosphor font-semibold inline-block min-w-[3.5ch] text-right">
                            {transferPct}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div
                      role="progressbar"
                      aria-label={`Active download progress for ${status.activeTransfer.filename}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={transferPct ?? undefined}
                      className="h-1.5 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
                    >
                      {transferPct !== null ? (
                        <div
                          key={activeTransferFileKey ?? 'active'}
                          className={`h-full bg-crt-phosphor crt-progress-beam transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none ${
                            PROGRESS_WIDTH_CLASSES[Math.max(3, Math.min(100, transferPct))]
                          }`}
                        />
                      ) : unknownSizeGraceElapsed ? (
                        <div className="h-full bg-crt-phosphor crt-progress-indeterminate" />
                      ) : (
                        <div
                          key={activeTransferFileKey ?? 'handshake'}
                          className={`h-full bg-crt-phosphor/75 crt-progress-beam transition-opacity duration-150 motion-reduce:transition-none ${PROGRESS_WIDTH_CLASSES[4]}`}
                        />
                      )}
                    </div>
                  </>
                ) : heldTransferForActiveRun ? (
                  <>
                    <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
                      <div className="flex items-center gap-2 text-crt-text/90 min-w-0">
                        <CheckCircle2 className="h-3.5 w-3.5 text-crt-phosphor/80 shrink-0" />
                        <span className="truncate">
                          {heldTransferForActiveRun.systemName} / {heldTransferForActiveRun.filename}
                        </span>
                        <span className="text-crt-muted whitespace-nowrap shrink-0 hidden sm:inline">
                          · {isLiveSyncRun ? 'Saved — queuing next…' : 'Sync transfer complete'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
                        {heldTransferForActiveRun.bytes > 0 && (
                          <span>{formatBytes(heldTransferForActiveRun.bytes)}</span>
                        )}
                        <span className="text-crt-phosphor/80 font-semibold inline-block min-w-[3.5ch] text-right">
                          100%
                        </span>
                      </div>
                    </div>

                    <div
                      role="progressbar"
                      aria-label={`Completed download for ${heldTransferForActiveRun.filename}`}
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
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3 h-5 text-xs font-mono min-w-0">
                      <div className="flex items-center gap-2 text-crt-muted min-w-0">
                        <Activity className="h-3.5 w-3.5 text-crt-phosphor/80 shrink-0" />
                        <span className="truncate">
                          {isLiveSyncRun
                            ? 'Scanning repository pages — awaiting next downloadable archive…'
                            : 'Sync scan complete'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 text-crt-muted tabular-nums whitespace-nowrap shrink-0">
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
                      aria-label="Scanning repository for downloadable files"
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Zone 3: 4-Column Operational Summary Strip */}
        <div className="mt-4 pt-3.5 border-t border-crt-border grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-x-6">
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
    </div>
  );
}
