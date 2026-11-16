import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Clock,
  FlaskConical,
  FolderTree,
  HardDrive,
  Play,
  ServerCog,
  Square,
} from 'lucide-react';
import { CatalogPanel } from './components/CatalogPanel';
import { CrtDisplayControl } from './components/CrtDisplayControl';
import { OperationsPanel } from './components/OperationsPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { SchedulePanel } from './components/SchedulePanel';
import {
  computeCrtCssVariables,
  type CrtDisplaySettings,
  loadInitialCrtDisplaySettings,
  saveCrtDisplaySettings,
} from './shared/crtDisplay';
import type {
  ActivityLogRecord,
  ActiveTransferState,
  LogLevel,
  NavSection,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  SyncRunRecord,
  SyncScope,
} from './types';
import { formatBytes, formatCountdown } from './utils/format';
import { readJsonSafely } from './utils/http';

const SYNC_SCOPE_STORAGE_KEY = 'rgt_sync_scope_v1';
const SYNC_DRY_RUN_STORAGE_KEY = 'rgt_sync_dry_run_v1';

function loadInitialSyncScope(): SyncScope {
  try {
    const raw = window.localStorage?.getItem(SYNC_SCOPE_STORAGE_KEY);
    return raw === 'full' ? 'full' : 'incremental';
  } catch {
    return 'incremental';
  }
}

function loadInitialDryRunEnabled(): boolean {
  try {
    const raw = window.localStorage?.getItem(SYNC_DRY_RUN_STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const [section, setSection] = useState<NavSection>('monitor');
  const [status, setStatus] = useState<ServiceStatusSnapshot | null>(null);
  const [config, setConfig] = useState<ScraperConfigPublic | null>(null);
  const [runs, setRuns] = useState<SyncRunRecord[]>([]);
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [selectedScope, setSelectedScope] = useState<SyncScope>(() => loadInitialSyncScope());
  const [dryRunEnabled, setDryRunEnabled] = useState<boolean>(() => loadInitialDryRunEnabled());
  const [crtSettings, setCrtSettings] = useState<CrtDisplaySettings>(() =>
    loadInitialCrtDisplaySettings(),
  );
  const [sseConnected, setSseConnected] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [confirmingFullSync, setConfirmingFullSync] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [activeRetryItemId, setActiveRetryItemId] = useState<number | null>(null);
  const activeRetryRunRef = useRef<{ runId: number; itemId: number } | null>(null);
  const prevActiveRunRef = useRef<SyncRunRecord | null>(null);

  const loadInitialData = useCallback(async () => {
    try {
      const [statusRes, configRes, runsRes, logsRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/config'),
        fetch('/api/runs?limit=20'),
        fetch('/api/logs?limit=150'),
      ]);

      let loadedStatus: ServiceStatusSnapshot | null = null;
      if (statusRes.ok) {
        loadedStatus = (await statusRes.json()) as ServiceStatusSnapshot;
        setStatus(loadedStatus);
        prevActiveRunRef.current = loadedStatus.activeRun;
      }
      if (configRes.ok) {
        const d = await configRes.json();
        setConfig(d.config);
      }
      if (runsRes.ok) {
        const d = await runsRes.json();
        const nextRuns = (d.runs || []) as SyncRunRecord[];
        setRuns(nextRuns);
        if (loadedStatus && !loadedStatus.activeRun && activeRetryRunRef.current) {
          const trackedId = activeRetryRunRef.current.runId;
          const finishedRun = nextRuns.find((r) => r.id === trackedId);
          if (finishedRun && finishedRun.triggerType === 'retry' && finishedRun.status === 'failed' && finishedRun.errorSummary) {
            setErrorBanner(finishedRun.errorSummary);
          }
          activeRetryRunRef.current = null;
          setActiveRetryItemId(null);
        }
      } else if (loadedStatus && !loadedStatus.activeRun) {
        activeRetryRunRef.current = null;
        setActiveRetryItemId(null);
      }
      if (logsRes.ok) {
        const d = await logsRes.json();
        setLogs(d.logs || []);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to connect to scraper service');
    }
  }, []);

  useEffect(() => {
    void loadInitialData();

    const source = new EventSource('/api/events');
    source.onopen = () => setSseConnected(true);
    source.onerror = () => setSseConnected(false);

    let catalogBumpTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCatalogRefresh = () => {
      if (catalogBumpTimer) return;
      catalogBumpTimer = setTimeout(() => {
        catalogBumpTimer = null;
        setCatalogRevision((rev) => rev + 1);
      }, 250);
    };

    source.addEventListener('status', (ev) => {
      try {
        const nextStatus = JSON.parse((ev as MessageEvent).data) as ServiceStatusSnapshot;
        const prevRun = prevActiveRunRef.current;
        prevActiveRunRef.current = nextStatus.activeRun;

        setStatus(nextStatus);
        setConfig((prev) =>
          prev && prev.lastWatermarkAt !== nextStatus.lastWatermarkAt
            ? { ...prev, lastWatermarkAt: nextStatus.lastWatermarkAt }
            : prev,
        );
        if (nextStatus.activeRun) {
          setConfirmingFullSync(false);
          setRuns((prev) => {
            const idx = prev.findIndex((r) => r.id === nextStatus.activeRun!.id);
            if (idx === -1) return [nextStatus.activeRun!, ...prev];
            const copy = [...prev];
            copy[idx] = nextStatus.activeRun!;
            return copy;
          });
        } else {
          setStopRequested(false);
          if (prevRun) {
            if (activeRetryRunRef.current?.runId === prevRun.id) {
              activeRetryRunRef.current = null;
            }
            setActiveRetryItemId(null);
            scheduleCatalogRefresh();
          }
          // Refresh runs when an active run finishes
          void fetch('/api/runs?limit=20')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.runs) {
                const nextRuns = d.runs as SyncRunRecord[];
                setRuns(nextRuns);
                if (prevRun) {
                  const finishedRun = nextRuns.find((r) => r.id === prevRun.id);
                  if (
                    finishedRun &&
                    finishedRun.triggerType === 'retry' &&
                    finishedRun.status === 'failed' &&
                    finishedRun.errorSummary
                  ) {
                    setErrorBanner(finishedRun.errorSummary);
                  }
                }
              }
            })
            .catch(() => undefined);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    let lastLiveTransferSampleMs = 0;
    source.addEventListener('transfer', (ev) => {
      try {
        const transfer = JSON.parse((ev as MessageEvent).data) as ActiveTransferState | null;
        if (!transfer) {
          setStatus((prev) => (prev && prev.activeTransfer ? { ...prev, activeTransfer: null } : prev));
          return;
        }
        const now = Date.now();
        const isDone =
          transfer.totalBytes !== null &&
          transfer.totalBytes > 0 &&
          transfer.bytesReceived >= transfer.totalBytes;
        const shouldSample =
          transfer.bytesPerSec > 0 && (now - lastLiveTransferSampleMs >= 450 || isDone);
        if (shouldSample) {
          lastLiveTransferSampleMs = now;
        }
        setStatus((prev) => {
          if (!prev) return prev;
          if (!shouldSample) {
            return { ...prev, activeTransfer: transfer };
          }
          const nextHistory = [
            ...(prev.transferHistory || []),
            {
              timestamp: new Date(now).toISOString(),
              bytesPerSec: Math.round(transfer.bytesPerSec),
              bytesReceived: transfer.bytesReceived,
              totalBytes: transfer.totalBytes,
              filename: transfer.filename,
              systemName: transfer.systemName,
            },
          ].slice(-90);
          return {
            ...prev,
            activeTransfer: transfer,
            transferHistory: nextHistory,
          };
        });
      } catch {
        // Ignore
      }
    });

    source.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as ActivityLogRecord;
        setLogs((prev) => [entry, ...prev].slice(0, 300));
      } catch {
        // Ignore
      }
    });

    source.addEventListener('logs_cleared', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as { level?: string };
        const lvl = payload.level || 'all';
        setLogs((prev) => (lvl === 'all' ? [] : prev.filter((l) => l.level !== lvl)));
      } catch {
        // Ignore
      }
    });

    source.addEventListener('catalog_updated', () => {
      scheduleCatalogRefresh();
    });

    source.addEventListener('runs_cleared', () => {
      setRuns((prev) => prev.filter((r) => r.status === 'running'));
    });

    return () => {
      if (catalogBumpTimer) clearTimeout(catalogBumpTimer);
      source.close();
    };
  }, [loadInitialData]);

  const handleStartRun = async (scope: SyncScope, dryRun = dryRunEnabled) => {
    setConfirmingFullSync(false);
    setActionPending(true);
    setStopRequested(false);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: scope, dryRun }),
      });
      const parsed = await readJsonSafely<{ run?: SyncRunRecord; error?: string }>(res);
      if (!parsed.ok) {
        throw new Error(parsed.errorMessage || `Failed to start run (HTTP ${res.status})`);
      }
      await loadInitialData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(false);
    }
  };

  const handleStopRun = async () => {
    if (stopRequested) return;
    setStopRequested(true);
    setActionPending(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/runs/stop', { method: 'POST' });
      const parsed = await readJsonSafely<{ error?: string }>(res);
      if (!parsed.ok) {
        setStopRequested(false);
        throw new Error(parsed.errorMessage || `Failed to stop run (HTTP ${res.status})`);
      }
    } catch (err) {
      setStopRequested(false);
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(false);
    }
  };

  const handleClearLogs = async (level: 'all' | LogLevel) => {
    setErrorBanner(null);
    const res = await fetch(`/api/logs?level=${encodeURIComponent(level)}`, { method: 'DELETE' });
    const parsed = await readJsonSafely<{ error?: string }>(res);
    if (!parsed.ok) {
      setErrorBanner(parsed.errorMessage || `Failed to clear logs (HTTP ${res.status})`);
      return;
    }
    setLogs((prev) => (level === 'all' ? [] : prev.filter((l) => l.level !== level)));
  };

  const handleClearRuns = async () => {
    setErrorBanner(null);
    const res = await fetch('/api/runs', { method: 'DELETE' });
    const parsed = await readJsonSafely<{ error?: string }>(res);
    if (!parsed.ok) {
      setErrorBanner(parsed.errorMessage || `Failed to clear sync runs (HTTP ${res.status})`);
      return;
    }
    setRuns((prev) => prev.filter((r) => r.status === 'running'));
  };

  const handleRetryItem = async (
    itemId: number,
    fileId?: number,
    options?: { dryRun?: boolean },
  ) => {
    setErrorBanner(null);
    const params = new URLSearchParams();
    if (fileId) params.set('fileId', String(fileId));
    if (options?.dryRun) params.set('dryRun', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/items/${itemId}/retry${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, dryRun: Boolean(options?.dryRun) }),
    });
    const parsed = await readJsonSafely<{ run?: SyncRunRecord; error?: string }>(res);
    if (!parsed.ok) {
      setErrorBanner(parsed.errorMessage || `Retry failed (HTTP ${res.status})`);
      return;
    }
    if (parsed.data?.run) {
      activeRetryRunRef.current = { runId: parsed.data.run.id, itemId };
      setActiveRetryItemId(itemId);
    }
    await loadInitialData();
  };

  const handleRetryAllFailed = async (options?: {
    system?: string;
    ids?: number[];
    dryRun?: boolean;
  }) => {
    setErrorBanner(null);
    const res = await fetch('/api/items/retry-failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
    const parsed = await readJsonSafely<{ run?: SyncRunRecord; error?: string }>(res);
    if (!parsed.ok) {
      const msg = parsed.errorMessage || `Batch retry failed (HTTP ${res.status})`;
      setErrorBanner(msg);
      throw new Error(msg);
    }
    await loadInitialData();
  };

  const handleSaveConfig = async (patch: Partial<ScraperConfigPublic> & { password?: string }) => {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const parsed = await readJsonSafely<{ config?: ScraperConfigPublic; error?: string }>(res);
    if (!parsed.ok || !parsed.data?.config) {
      throw new Error(parsed.errorMessage || `Save failed (HTTP ${res.status})`);
    }
    setConfig(parsed.data.config);
    await loadInitialData();
  };

  const navItems: { id: NavSection; label: string; icon: typeof Activity }[] = [
    { id: 'monitor', label: 'Sync', icon: Activity },
    { id: 'catalog', label: 'Catalog', icon: FolderTree },
    { id: 'schedule', label: 'Schedule', icon: Clock },
    { id: 'operations', label: 'Operations', icon: ServerCog },
  ];

  const syncAllowed = Boolean(status?.auth.hasCompletedLogin);
  const filteredConsoleSlugs = (config?.systemFilter || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fullSyncScopeSummary =
    filteredConsoleSlugs.length > 0
      ? `${filteredConsoleSlugs.length} selected console${filteredConsoleSlugs.length === 1 ? '' : 's'} (${filteredConsoleSlugs.slice(0, 4).join(', ')}${filteredConsoleSlugs.length > 4 ? `, +${filteredConsoleSlugs.length - 4} more` : ''})`
      : config && config.discoveredSystems.length > 0
        ? `all ${config.discoveredSystems.length} discovered consoles`
        : 'all repository consoles';
  const showFullSyncConfirm =
    confirmingFullSync &&
    selectedScope === 'full' &&
    !dryRunEnabled &&
    !status?.activeRun &&
    syncAllowed;

  useEffect(() => {
    try {
      window.localStorage?.setItem(SYNC_SCOPE_STORAGE_KEY, selectedScope);
    } catch {
      // Ignore storage restrictions
    }
  }, [selectedScope]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(SYNC_DRY_RUN_STORAGE_KEY, String(dryRunEnabled));
    } catch {
      // Ignore storage restrictions
    }
  }, [dryRunEnabled]);

  useEffect(() => {
    saveCrtDisplaySettings(crtSettings);
  }, [crtSettings]);

  const crtCssVars = computeCrtCssVariables(crtSettings);
  const showScanlines = crtSettings.enabled && crtSettings.scanlines > 0;
  const showGrille = crtSettings.enabled && crtSettings.apertureGrille > 0;
  const showVignette =
    crtSettings.enabled && (crtSettings.vignette > 0 || crtSettings.gaussGlow > 0);

  return (
    <div
      data-crt-palette={crtSettings.palette}
      style={crtCssVars}
      className={`min-h-screen crt-canvas text-crt-text flex flex-col ${crtSettings.enabled ? 'crt-fx-active' : ''}`}
    >
      {showGrille && <div aria-hidden="true" className="crt-layer-grille" />}
      {showScanlines && <div aria-hidden="true" className="crt-layer-scanlines" />}
      {showVignette && <div aria-hidden="true" className="crt-layer-vignette" />}
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-crt-bg/95 backdrop-blur border-b border-crt-border px-4 lg:px-6 py-3.5 flex flex-wrap md:flex-nowrap items-center justify-between gap-4">
        {/* Zone 1: Single-line Brand Title */}
        <a
          href="#monitor"
          onClick={(e) => {
            e.preventDefault();
            setSection('monitor');
          }}
          className="font-display text-lg font-bold tracking-tight text-crt-phosphor whitespace-nowrap shrink-0"
        >
          RetroGameTalk Sync
        </a>

        {/* Sync Scope + Independent Dry Run Toggle + Reserved-Width Run/Stop Action */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0 ml-auto">
          {/* 2-Way Sync Scope Selector */}
          <div
            role="group"
            aria-label="Sync scope"
            className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded-md shrink-0"
          >
            {(['incremental', 'full'] as const).map((scope) => {
              const label = scope === 'incremental' ? 'Incremental' : 'Full';
              const active = selectedScope === scope;
              return (
                <button
                  key={scope}
                  type="button"
                  disabled={Boolean(status?.activeRun) || !syncAllowed}
                  title={
                    !syncAllowed
                      ? 'Verify login in Operations before running a sync'
                      : scope === 'incremental'
                        ? 'Inspect releases created or updated since the Incremental Cutoff'
                        : 'Inspect every release across target consoles with no date cutoff'
                  }
                  onClick={() => {
                    setSelectedScope(scope);
                    if (scope !== 'full') setConfirmingFullSync(false);
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                  } disabled:opacity-45 disabled:cursor-not-allowed`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Independent Dry Run Simulation Toggle */}
          <button
            type="button"
            aria-pressed={dryRunEnabled}
            disabled={Boolean(status?.activeRun) || !syncAllowed}
            title={
              !syncAllowed
                ? 'Verify login in Operations before running a sync'
                : dryRunEnabled
                  ? `Dry Run ON: ${selectedScope === 'full' ? 'Full Sync' : 'Incremental Sync'} will simulate discovery without downloading files or modifying catalog records`
                  : `Toggle Dry Run ON to preview what ${selectedScope === 'full' ? 'Full Sync' : 'Incremental Sync'} would download without writing to disk`
            }
            onClick={() => {
              setDryRunEnabled((prev) => {
                const next = !prev;
                if (next) setConfirmingFullSync(false);
                return next;
              });
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              dryRunEnabled
                ? 'border-crt-amber/80 bg-crt-amber/12 text-crt-amber'
                : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
            } disabled:opacity-45 disabled:cursor-not-allowed`}
          >
            <span
              aria-hidden="true"
              className={`h-3.5 w-3.5 rounded-[3px] border flex items-center justify-center transition-colors shrink-0 ${
                dryRunEnabled
                  ? 'border-crt-amber bg-crt-amber text-crt-bg'
                  : 'border-crt-border-strong bg-crt-surface'
              }`}
            >
              {dryRunEnabled && <Check className="h-2.5 w-2.5 stroke-[3]" />}
            </span>
            <FlaskConical className="h-3.5 w-3.5 shrink-0" />
            <span>Dry Run</span>
          </button>

          <div className="w-[196px] flex justify-end shrink-0">
            {status?.activeRun ? (
              <button
                type="button"
                disabled={actionPending || stopRequested}
                onClick={() => void handleStopRun()}
                className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg rounded transition-colors whitespace-nowrap shrink-0 disabled:cursor-not-allowed ${
                  stopRequested
                    ? 'bg-crt-amber opacity-85'
                    : 'bg-crt-crimson hover:brightness-110 disabled:opacity-50'
                }`}
              >
                <Square className="h-3.5 w-3.5 fill-current shrink-0" />
                {stopRequested
                  ? 'Stopping...'
                  : status.activeRun.dryRun || status.activeRun.mode === 'dry_run'
                    ? 'Stop Dry Run'
                    : status.activeRun.triggerType === 'retry'
                      ? 'Stop Retry'
                      : status.activeRun.mode === 'full'
                        ? 'Stop Full Sync'
                        : 'Stop Incremental'}
              </button>
            ) : (
              <button
                type="button"
                disabled={actionPending || !status || !syncAllowed}
                title={
                  !syncAllowed
                    ? 'Login required: test and verify credentials in Operations before syncing'
                    : dryRunEnabled
                      ? `Simulate ${selectedScope === 'full' ? 'Full Sync' : 'Incremental Sync'} (0 bytes written to disk)`
                      : undefined
                }
                onClick={() => {
                  if (selectedScope === 'full' && !dryRunEnabled) {
                    setConfirmingFullSync((prev) => !prev);
                  } else {
                    void handleStartRun(selectedScope, dryRunEnabled);
                  }
                }}
                className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed ${
                  dryRunEnabled
                    ? 'bg-crt-amber hover:brightness-110'
                    : 'bg-crt-phosphor hover:brightness-110'
                }`}
              >
                {dryRunEnabled ? (
                  <FlaskConical className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current shrink-0" />
                )}
                {dryRunEnabled
                  ? selectedScope === 'full'
                    ? 'Dry Run Full'
                    : 'Dry Run Incremental'
                  : selectedScope === 'full'
                    ? 'Full Sync'
                    : 'Incremental Sync'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Inline Uncapped Full Sync Confirmation Strip */}
      {showFullSyncConfirm && (
        <div className="border-b border-crt-amber/40 bg-crt-elevated px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs text-crt-text min-w-0">
            <AlertTriangle className="h-4 w-4 text-crt-amber shrink-0" />
            <span>
              <strong className="font-semibold text-crt-amber">Confirm Uncapped Full Sync:</strong>{' '}
              This run will crawl and mirror every release across {fullSyncScopeSummary} with no page limit. You can run a Full Sync Dry Run first to preview missing archives without writing to disk.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0 ml-auto">
            <button
              type="button"
              disabled={actionPending}
              onClick={() => setConfirmingFullSync(false)}
              className="px-3 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={actionPending}
              onClick={() => {
                setDryRunEnabled(true);
                void handleStartRun('full', true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-crt-amber/80 bg-crt-amber/12 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              title="Simulate Full Sync across all target consoles without downloading archives or modifying catalog rows"
            >
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              Dry Run Full First
            </button>
            <button
              type="button"
              disabled={actionPending}
              onClick={() => void handleStartRun('full', false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-crt-bg bg-crt-amber hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Play className="h-3 w-3 fill-current shrink-0" />
              Confirm Full Sync
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace: Sidebar + Content Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left Rail Sidebar (240px on Desktop) */}
        <aside className="lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-crt-border bg-crt-surface/70 p-4 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            {/* Mobile Section Switcher */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-crt-elevated border-crt-border-strong text-crt-phosphor'
                        : 'bg-transparent border-transparent text-crt-muted hover:text-crt-text hover:bg-crt-bg'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Real Daemon & Storage Readout */}
            {status && (
              <div className="hidden lg:block border-t border-crt-border pt-4 space-y-3 text-xs font-mono">
                <div
                  className="flex items-center justify-between text-crt-muted"
                  title="Local browser SSE telemetry stream to this app backend (independent of RetroGameTalk login)"
                >
                  <span>UI Event Stream</span>
                  <span className={sseConnected ? 'text-crt-phosphor' : 'text-crt-amber'}>
                    {sseConnected ? 'Live' : 'Reconnecting'}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between text-crt-muted"
                  title={status.auth.lastMessage || undefined}
                >
                  <span>Auth Session</span>
                  <span
                    className={
                      status.auth.authenticated
                        ? 'text-crt-phosphor'
                        : status.auth.lastCheckedAt
                          ? 'text-crt-crimson'
                          : status.auth.configured
                            ? 'text-crt-amber'
                            : 'text-crt-muted'
                    }
                  >
                    {status.auth.authenticated
                      ? 'Active'
                      : status.auth.lastCheckedAt
                        ? 'Failed'
                        : status.auth.hasCompletedLogin
                          ? 'Standby'
                          : status.auth.configured
                            ? 'Unverified'
                            : 'Unset'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-crt-muted">
                  <span>Next Schedule</span>
                  <span className="text-crt-text tabular-nums">{formatCountdown(status.nextScheduledRunAt)}</span>
                </div>
                <div className="flex items-center justify-between text-crt-muted">
                  <span>Disk Used</span>
                  <span className="text-crt-text tabular-nums">{formatBytes(status.storage.totalBytesOnDisk)}</span>
                </div>
              </div>
            )}

            {/* Discovered Systems Breakdown */}
            {status && status.systems.length > 0 && (
              <div className="hidden lg:block border-t border-crt-border pt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-crt-muted">
                  <HardDrive className="h-3.5 w-3.5" />
                  <span>Mirrored Systems</span>
                </div>
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {status.systems.map((sys) => (
                    <div
                      key={sys.systemName}
                      className="flex items-center justify-between text-xs font-mono py-0.5"
                    >
                      <span className="text-crt-text truncate">{sys.systemName}</span>
                      <span className="text-crt-muted tabular-nums shrink-0">{sys.totalItems}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* CRT Display Studio & Inconspicuous Build Footer */}
          <div className="hidden lg:block border-t border-crt-border pt-4 space-y-2.5">
            <CrtDisplayControl settings={crtSettings} onChange={setCrtSettings} />

            {status?.build && (
              <div
                className="flex items-center justify-between gap-2 px-1 text-[11px] font-mono text-crt-muted/60 hover:text-crt-muted transition-colors"
                title={`Version: ${status.build.version} · Revision: ${status.build.gitSha}`}
              >
                <span className="truncate">{status.build.version}</span>
                <span className="tabular-nums shrink-0">
                  {status.build.gitSha && status.build.gitSha !== 'unknown'
                    ? status.build.gitSha.slice(0, 7)
                    : 'local'}
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-5 lg:p-7 min-w-0">
          {errorBanner && (
            <div className="mb-5 border border-crt-crimson/50 bg-crt-crimson/10 text-crt-text px-4 py-3 rounded text-xs font-mono flex items-center justify-between gap-4">
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="text-crt-muted hover:text-crt-text underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {!status || !config ? (
            <div className="space-y-4">
              <div className="h-28 border border-crt-border bg-crt-surface rounded-md animate-pulse" />
              <div className="h-24 border border-crt-border bg-crt-surface rounded-md animate-pulse" />
              <div className="h-64 border border-crt-border bg-crt-surface rounded-md animate-pulse" />
            </div>
          ) : (
            <>
              {section === 'monitor' && (
                <OverviewPanel
                  config={config}
                  status={status}
                  runs={runs}
                  logs={logs}
                  catalogRevision={catalogRevision}
                  activeRetryItemId={activeRetryItemId}
                  onSaveConfig={handleSaveConfig}
                  onClearLogs={handleClearLogs}
                  onClearRuns={handleClearRuns}
                  onNavigateToOperations={() => setSection('operations')}
                  onRetryItem={handleRetryItem}
                  onRetryAllFailed={handleRetryAllFailed}
                  onRefreshStatus={loadInitialData}
                />
              )}
              {section === 'catalog' && (
                <CatalogPanel
                  config={config}
                  status={status}
                  catalogRevision={catalogRevision}
                  activeRetryItemId={activeRetryItemId}
                  onSaveConfig={handleSaveConfig}
                  onRetryItem={handleRetryItem}
                  onRefreshStatus={loadInitialData}
                />
              )}
              {section === 'schedule' && (
                <SchedulePanel
                  config={config}
                  status={status}
                  onSaveConfig={handleSaveConfig}
                />
              )}
              {section === 'operations' && (
                <OperationsPanel
                  config={config}
                  status={status}
                  onSaveConfig={handleSaveConfig}
                  onRefreshConfig={loadInitialData}
                />
              )}

              {status.build && (
                <div
                  className="lg:hidden mt-8 pt-3 border-t border-crt-border/50 flex items-center justify-between text-[11px] font-mono text-crt-muted/60"
                  title={`Version: ${status.build.version} · Revision: ${status.build.gitSha}`}
                >
                  <span className="truncate">{status.build.version}</span>
                  <span className="tabular-nums shrink-0">
                    {status.build.gitSha && status.build.gitSha !== 'unknown'
                      ? status.build.gitSha.slice(0, 7)
                      : 'local'}
                  </span>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
