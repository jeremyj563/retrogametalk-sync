import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  FolderTree,
  HardDrive,
  Monitor,
  Play,
  ServerCog,
  Square,
} from 'lucide-react';
import { CatalogPanel } from './components/CatalogPanel';
import { OperationsPanel } from './components/OperationsPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { SchedulePanel } from './components/SchedulePanel';
import type {
  ActivityLogRecord,
  ActiveTransferState,
  LogLevel,
  NavSection,
  RunMode,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  SyncRunRecord,
} from './types';
import { formatBytes, formatCountdown } from './utils/format';
import { readJsonSafely } from './utils/http';

export default function App() {
  const [section, setSection] = useState<NavSection>('monitor');
  const [status, setStatus] = useState<ServiceStatusSnapshot | null>(null);
  const [config, setConfig] = useState<ScraperConfigPublic | null>(null);
  const [runs, setRuns] = useState<SyncRunRecord[]>([]);
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [selectedMode, setSelectedMode] = useState<RunMode>('dry_run');
  const [scanlinesEnabled, setScanlinesEnabled] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const loadInitialData = useCallback(async () => {
    try {
      const [statusRes, configRes, runsRes, logsRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/config'),
        fetch('/api/runs?limit=20'),
        fetch('/api/logs?limit=150'),
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (configRes.ok) {
        const d = await configRes.json();
        setConfig(d.config);
      }
      if (runsRes.ok) {
        const d = await runsRes.json();
        setRuns(d.runs || []);
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

    source.addEventListener('status', (ev) => {
      try {
        const nextStatus = JSON.parse((ev as MessageEvent).data) as ServiceStatusSnapshot;
        setStatus(nextStatus);
        if (nextStatus.activeRun) {
          setRuns((prev) => {
            const idx = prev.findIndex((r) => r.id === nextStatus.activeRun!.id);
            if (idx === -1) return [nextStatus.activeRun!, ...prev];
            const copy = [...prev];
            copy[idx] = nextStatus.activeRun!;
            return copy;
          });
        } else {
          setStopRequested(false);
          // Refresh runs when an active run finishes
          void fetch('/api/runs?limit=20')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.runs) setRuns(d.runs);
            })
            .catch(() => undefined);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    source.addEventListener('transfer', (ev) => {
      try {
        const transfer = JSON.parse((ev as MessageEvent).data) as ActiveTransferState;
        setStatus((prev) => (prev ? { ...prev, activeTransfer: transfer } : prev));
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

    source.addEventListener('runs_cleared', () => {
      setRuns((prev) => prev.filter((r) => r.status === 'running'));
    });

    return () => {
      source.close();
    };
  }, [loadInitialData]);

  const handleStartRun = async (mode: RunMode) => {
    setActionPending(true);
    setStopRequested(false);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
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

  const handleRetryItem = async (itemId: number, fileId?: number) => {
    const qs = fileId ? `?fileId=${encodeURIComponent(String(fileId))}` : '';
    const res = await fetch(`/api/items/${itemId}/retry${qs}`, { method: 'POST' });
    const parsed = await readJsonSafely<{ error?: string }>(res);
    if (!parsed.ok) {
      setErrorBanner(parsed.errorMessage || `Retry failed (HTTP ${res.status})`);
    }
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

  return (
    <div className={`min-h-screen crt-canvas text-crt-text flex flex-col ${scanlinesEnabled ? 'crt-scanlines' : ''}`}>
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

        {/* Sync Mode Selector + Reserved-Width Run/Stop Action */}
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <div className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded-md shrink-0">
            {(
              [
                { id: 'dry_run', label: 'Dry Run' },
                { id: 'incremental', label: 'Incremental Sync' },
                { id: 'full', label: 'Full Sync' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={Boolean(status?.activeRun)}
                onClick={() => setSelectedMode(m.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  selectedMode === m.id
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                } disabled:opacity-50`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="w-[172px] flex justify-end shrink-0">
            {status?.activeRun ? (
              <button
                type="button"
                disabled={actionPending || stopRequested}
                onClick={() => void handleStopRun()}
                className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg rounded transition-colors whitespace-nowrap shrink-0 disabled:cursor-not-allowed ${
                  stopRequested
                    ? 'bg-crt-amber opacity-85'
                    : 'bg-crt-crimson hover:brightness-110 disabled:opacity-50'
                }`}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                {stopRequested ? 'Stopping...' : 'Stop Sync'}
              </button>
            ) : (
              <button
                type="button"
                disabled={actionPending || !status}
                onClick={() => void handleStartRun(selectedMode)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {selectedMode === 'dry_run'
                  ? 'Dry Run'
                  : selectedMode === 'full'
                    ? 'Full Sync'
                    : 'Incremental Sync'}
              </button>
            )}
          </div>
        </div>
      </header>

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
                <div className="flex items-center justify-between text-crt-muted">
                  <span>Stream Link</span>
                  <span className={sseConnected ? 'text-crt-phosphor' : 'text-crt-amber'}>
                    {sseConnected ? 'Connected' : 'Reconnecting'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-crt-muted">
                  <span>Auth Session</span>
                  <span className={status.auth.authenticated ? 'text-crt-phosphor' : 'text-crt-muted'}>
                    {status.auth.authenticated ? 'Active' : status.auth.configured ? 'Standby' : 'Unset'}
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

          {/* CRT Scanline Display Toggle */}
          <div className="hidden lg:block border-t border-crt-border pt-4">
            <button
              type="button"
              onClick={() => setScanlinesEnabled((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-border-strong rounded text-crt-muted hover:text-crt-text transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <Monitor className="h-3.5 w-3.5" />
                CRT Scanlines
              </span>
              <span className={scanlinesEnabled ? 'text-crt-phosphor' : 'text-crt-muted'}>
                {scanlinesEnabled ? 'ON' : 'OFF'}
              </span>
            </button>
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
                  status={status}
                  runs={runs}
                  logs={logs}
                  onClearLogs={handleClearLogs}
                  onClearRuns={handleClearRuns}
                  onNavigateToOperations={() => setSection('operations')}
                />
              )}
              {section === 'catalog' && (
                <CatalogPanel
                  status={status}
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}
