import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FlaskConical,
} from 'lucide-react';
import { BrandMark } from './components/BrandMark';
import { BulkInstallDock } from './components/BulkInstallDock';
import { CatalogPanel } from './components/CatalogPanel';
import { CrtDisplayControl } from './components/CrtDisplayControl';
import { DeviceExportPanel } from './components/DeviceExportPanel';
import { LivingNavIcon } from './components/LivingNavIcon';
import { MirroredSystemsSidebar } from './components/MirroredSystemsSidebar';
import { OverviewPanel } from './components/OverviewPanel';
import { SdCardExportModal } from './components/SdCardExportModal';
import { ServiceTelemetrySidebar } from './components/ServiceTelemetrySidebar';
import { SyncCommandButton } from './components/SyncCommandButton';
import { SyncRulesPanel } from './components/SyncRulesPanel';
import { SystemSettingsPanel } from './components/SystemSettingsPanel';
import { useBulkStorageInstaller } from './hooks/useBulkStorageInstaller';
import {
  computeCrtCssVariables,
  type CrtDisplaySettings,
  loadInitialCrtDisplaySettings,
  saveCrtDisplaySettings,
} from './shared/crtDisplay';
import {
  buildGitCommitUrl,
  isSemverTagRef,
  resolveGitRefDestination,
} from './shared/gitUrl';
import type {
  ActivityLogRecord,
  ActiveTransferState,
  ConfigDirtyState,
  ConfigFocusRequest,
  ConfigPanelHandle,
  ConfigSectionTarget,
  LogLevel,
  NavSection,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  SyncRunRecord,
  SyncScope,
} from './types';
import { formatLocalDateTimeWithAge } from './utils/format';
import { readJsonSafely } from './utils/http';

const SYNC_SCOPE_STORAGE_KEY = 'rgt_sync_scope_v1';
const SYNC_DRY_RUN_STORAGE_KEY = 'rgt_sync_dry_run_v1';

interface AppHistoryState {
  section: NavSection;
  target: ConfigSectionTarget | null;
  scrollY: number;
  index: number;
}

interface PendingNavIntent {
  section: NavSection;
  target: ConfigSectionTarget | null;
  historyDelta: number;
}

function BuildFooterMeta({
  build,
  className,
}: {
  build: ServiceStatusSnapshot['build'];
  className: string;
}) {
  const [activeTarget, setActiveTarget] = useState<'version' | 'sha' | null>(null);
  const tooltipId = useId();
  const refDest = resolveGitRefDestination(build.gitUrl, build.gitRef, build.version);
  const branchUrl = refDest?.url ?? null;
  const commitUrl = buildGitCommitUrl(build.gitUrl, build.gitSha);
  const hasRealSha = Boolean(build.gitSha && build.gitSha !== 'unknown');
  const shortSha = hasRealSha ? build.gitSha.slice(0, 7) : 'local';
  const displaySha = hasRealSha ? build.gitSha.slice(0, 12) : 'local (untracked)';
  const isSemverRelease = isSemverTagRef(build.gitRef, build.version);
  const showDistinctGitRef = Boolean(build.gitRef && build.gitRef !== build.version);
  const builtInfo = formatLocalDateTimeWithAge(build.builtAt);
  const activeLinkHint =
    activeTarget === 'version' && refDest
      ? refDest.kind === 'release'
        ? `Click to open release ${refDest.refName}`
        : refDest.kind === 'pr'
          ? `Click to open pull request ${refDest.refName}`
          : `Click to open branch ${refDest.refName}`
      : activeTarget === 'sha' && commitUrl
        ? 'Click to open commit in repository'
        : null;

  return (
    <div
      className={`relative ${className}`}
      onMouseLeave={() => setActiveTarget(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setActiveTarget(null);
      }}
    >
      {branchUrl ? (
        <a
          href={branchUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={activeTarget === 'version' ? tooltipId : undefined}
          onMouseEnter={() => setActiveTarget('version')}
          onFocus={() => setActiveTarget('version')}
          onBlur={() => setActiveTarget((prev) => (prev === 'version' ? null : prev))}
          className="truncate hover:text-crt-phosphor hover:underline underline-offset-2 focus-visible:outline-none focus-visible:text-crt-phosphor focus-visible:underline transition-colors"
        >
          {build.version}
        </a>
      ) : (
        <span
          tabIndex={0}
          aria-describedby={activeTarget === 'version' ? tooltipId : undefined}
          onMouseEnter={() => setActiveTarget('version')}
          onFocus={() => setActiveTarget('version')}
          onBlur={() => setActiveTarget((prev) => (prev === 'version' ? null : prev))}
          className="truncate cursor-default hover:text-crt-phosphor focus-visible:outline-none focus-visible:text-crt-phosphor focus-visible:underline underline-offset-2 transition-colors"
        >
          {build.version}
        </span>
      )}

      {commitUrl ? (
        <a
          href={commitUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={activeTarget === 'sha' ? tooltipId : undefined}
          onMouseEnter={() => setActiveTarget('sha')}
          onFocus={() => setActiveTarget('sha')}
          onBlur={() => setActiveTarget((prev) => (prev === 'sha' ? null : prev))}
          className="tabular-nums shrink-0 hover:text-crt-phosphor hover:underline underline-offset-2 focus-visible:outline-none focus-visible:text-crt-phosphor focus-visible:underline transition-colors"
        >
          {shortSha}
        </a>
      ) : (
        <span
          tabIndex={0}
          aria-describedby={activeTarget === 'sha' ? tooltipId : undefined}
          onMouseEnter={() => setActiveTarget('sha')}
          onFocus={() => setActiveTarget('sha')}
          onBlur={() => setActiveTarget((prev) => (prev === 'sha' ? null : prev))}
          className="tabular-nums shrink-0 cursor-default hover:text-crt-phosphor focus-visible:outline-none focus-visible:text-crt-phosphor focus-visible:underline underline-offset-2 transition-colors"
        >
          {shortSha}
        </span>
      )}

      {activeTarget && (
        <div
          id={tooltipId}
          role="tooltip"
          className={`pointer-events-none absolute bottom-full mb-2.5 lg:bottom-0 lg:mb-0 lg:left-full lg:right-auto lg:ml-3 z-40 w-72 max-w-[calc(100vw-2.5rem)] rounded-md border border-crt-border-strong bg-crt-surface/98 p-3.5 shadow-2xl backdrop-blur-md text-left ${
            activeTarget === 'sha' ? 'right-0' : 'left-0'
          }`}
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>

          <div className="space-y-0.5 min-w-0">
            <div className="font-display text-sm font-semibold text-crt-text leading-snug">
              Build &amp; Release Provenance
            </div>
            <div className="text-[11px] font-mono text-crt-muted truncate">
              {activeTarget === 'version'
                ? refDest?.kind === 'release'
                  ? 'Version / Release Tag'
                  : refDest?.kind === 'pr'
                    ? 'Version / Pull Request Ref'
                    : 'Version / Git Ref'
                : 'Commit / Revision Hash'}
            </div>
          </div>

          <dl className="mt-2.5 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted shrink-0">Version</dt>
              <dd
                className={`text-right truncate ${
                  activeTarget === 'version'
                    ? 'text-crt-phosphor font-semibold'
                    : 'text-crt-text'
                }`}
              >
                {build.version}
              </dd>
            </div>

            {showDistinctGitRef && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-crt-muted shrink-0">Git Ref</dt>
                <dd className="text-right text-crt-text truncate">{build.gitRef}</dd>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <dt className="text-crt-muted shrink-0">Revision</dt>
              <dd
                className={`text-right truncate ${
                  activeTarget === 'sha'
                    ? 'text-crt-phosphor font-semibold'
                    : 'text-crt-text'
                }`}
              >
                {displaySha}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-crt-muted shrink-0">
                {isSemverRelease ? 'Released' : 'Built'}
              </dt>
              <dd className="text-right text-crt-text">
                {builtInfo ? (
                  <span>
                    {builtInfo.formatted}
                    <span aria-hidden="true" className="text-crt-muted">
                      {' · '}
                    </span>
                    <span className="text-crt-phosphor">{builtInfo.relative}</span>
                  </span>
                ) : (
                  <span className="text-crt-muted/80">Not reported in status</span>
                )}
              </dd>
            </div>
          </dl>

          {activeLinkHint && (
            <div className="mt-2.5 pt-2 border-t border-crt-border text-[10px] font-mono text-crt-phosphor/90 truncate">
              {activeLinkHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isConfigSection(section: NavSection): boolean {
  return section === 'sync-rules' || section === 'device-export' || section === 'settings';
}

function resolveSectionForTarget(target: ConfigSectionTarget): NavSection {
  switch (target) {
    case 'schedule':
    case 'systems':
    case 'releaseTypes':
      return 'sync-rules';
    case 'romNaming':
    case 'storageMappings':
      return 'device-export';
    case 'auth':
    case 'pacing':
      return 'settings';
  }
}

const CONFIG_TARGET_HASH_SLUG: Record<ConfigSectionTarget, string> = {
  schedule: 'schedule',
  systems: 'systems',
  releaseTypes: 'release-types',
  romNaming: 'rom-naming',
  storageMappings: 'storage-mappings',
  auth: 'auth',
  pacing: 'pacing',
};

const HASH_SLUG_TO_CONFIG_TARGET: Record<string, ConfigSectionTarget> = {
  schedule: 'schedule',
  systems: 'systems',
  'release-types': 'releaseTypes',
  releasetypes: 'releaseTypes',
  'rom-naming': 'romNaming',
  romnaming: 'romNaming',
  'storage-mappings': 'storageMappings',
  storagemappings: 'storageMappings',
  auth: 'auth',
  pacing: 'pacing',
};

function parseLocationHash(rawHash: string): {
  section: NavSection;
  target: ConfigSectionTarget | null;
} {
  const cleaned = rawHash.replace(/^#\/?/, '').trim().toLowerCase();
  if (!cleaned) {
    return { section: 'monitor', target: null };
  }
  const [head, sub] = cleaned.split('/');
  if (head === 'monitor' || head === 'sync') {
    return { section: 'monitor', target: null };
  }
  if (head === 'catalog') {
    return { section: 'catalog', target: null };
  }
  if (head === 'sync-rules' || head === 'syncrules') {
    const candidate = sub ? (HASH_SLUG_TO_CONFIG_TARGET[sub] ?? null) : null;
    const validTarget =
      candidate && resolveSectionForTarget(candidate) === 'sync-rules' ? candidate : null;
    return { section: 'sync-rules', target: validTarget };
  }
  if (head === 'device-export' || head === 'deviceexport' || head === 'export') {
    const candidate = sub ? (HASH_SLUG_TO_CONFIG_TARGET[sub] ?? null) : null;
    const validTarget =
      candidate && resolveSectionForTarget(candidate) === 'device-export' ? candidate : null;
    return { section: 'device-export', target: validTarget };
  }
  if (head === 'settings' || head === 'system-settings') {
    const candidate = sub ? (HASH_SLUG_TO_CONFIG_TARGET[sub] ?? null) : null;
    const validTarget =
      candidate && resolveSectionForTarget(candidate) === 'settings' ? candidate : null;
    return { section: 'settings', target: validTarget };
  }
  // Legacy bookmark & history redirects
  if (head === 'schedule') {
    return { section: 'sync-rules', target: 'schedule' };
  }
  if (head === 'operations') {
    const legacyTarget = sub ? (HASH_SLUG_TO_CONFIG_TARGET[sub] ?? null) : null;
    if (legacyTarget) {
      return {
        section: resolveSectionForTarget(legacyTarget),
        target: legacyTarget,
      };
    }
    return { section: 'settings', target: null };
  }
  return { section: 'monitor', target: null };
}

function formatLocationHash(
  section: NavSection,
  target: ConfigSectionTarget | null = null,
): string {
  if (target && resolveSectionForTarget(target) === section) {
    return `#${section}/${CONFIG_TARGET_HASH_SLUG[target]}`;
  }
  return `#${section}`;
}

function isAppHistoryState(raw: unknown): raw is AppHistoryState {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<AppHistoryState>;
  return (
    (candidate.section === 'monitor' ||
      candidate.section === 'catalog' ||
      candidate.section === 'sync-rules' ||
      candidate.section === 'device-export' ||
      candidate.section === 'settings') &&
    typeof candidate.index === 'number'
  );
}

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
  const initialRouteRef = useRef<{
    section: NavSection;
    target: ConfigSectionTarget | null;
  } | null>(null);
  if (!initialRouteRef.current) {
    initialRouteRef.current = parseLocationHash(
      typeof window !== 'undefined' ? window.location.hash : '',
    );
  }

  const [section, setSection] = useState<NavSection>(() => initialRouteRef.current!.section);
  const [configFocus, setConfigFocus] = useState<ConfigFocusRequest | null>(() =>
    initialRouteRef.current!.target
      ? { target: initialRouteRef.current!.target, nonce: 1 }
      : null,
  );
  const configFocusNonceRef = useRef(initialRouteRef.current.target ? 1 : 0);
  const configPanelRef = useRef<ConfigPanelHandle | null>(null);
  const [configDirty, setConfigDirty] = useState<ConfigDirtyState>({
    isDirty: false,
    changedSections: [],
  });
  const [pendingNavIntent, setPendingNavIntent] = useState<PendingNavIntent | null>(null);
  const [navGuardSaving, setNavGuardSaving] = useState(false);
  const [navGuardError, setNavGuardError] = useState<string | null>(null);

  const sectionRef = useRef<NavSection>(initialRouteRef.current.section);
  const configDirtyRef = useRef(false);
  const currentHistoryStateRef = useRef<AppHistoryState>({
    section: initialRouteRef.current.section,
    target: initialRouteRef.current.target,
    scrollY: 0,
    index: 0,
  });
  const historyIndexRef = useRef(0);
  const ignoringNextPopstateRef = useRef(false);
  const pendingScrollRestoreRef = useRef<{ section: NavSection; scrollY: number } | null>(null);

  sectionRef.current = section;
  configDirtyRef.current = configDirty.isDirty;

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
  const [logsClearedRevision, setLogsClearedRevision] = useState(0);
  const [activeRetryItemId, setActiveRetryItemId] = useState<number | null>(null);
  const activeRetryRunRef = useRef<{ runId: number; itemId: number } | null>(null);
  const prevActiveRunRef = useRef<SyncRunRecord | null>(null);

  const bulkInstaller = useBulkStorageInstaller({
    config,
    debugLogging: Boolean(status?.debugLogging),
    onItemsInstalled: () => {
      setCatalogRevision((rev) => rev + 1);
    },
  });

  const loadInitialData = useCallback(async () => {
    try {
      const [statusRes, configRes, runsRes, logsRes] = await Promise.all([
        fetch('/api/status'),
        fetch('/api/config'),
        fetch('/api/runs?limit=20'),
        fetch('/api/logs?limit=300'),
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
          setStatus((prev) =>
            prev && (prev.activeTransfer || (prev.activeTransfers && prev.activeTransfers.length > 0))
              ? { ...prev, activeTransfer: null, activeTransfers: [] }
              : prev,
          );
          return;
        }
        const { parallelTransfers, ...primaryTransfer } = transfer;
        const nextActiveTransfers =
          Array.isArray(parallelTransfers) && parallelTransfers.length > 0
            ? parallelTransfers
            : [primaryTransfer];
        const now = Date.now();
        const isDone =
          primaryTransfer.totalBytes !== null &&
          primaryTransfer.totalBytes > 0 &&
          primaryTransfer.bytesReceived >= primaryTransfer.totalBytes;
        const shouldSample =
          primaryTransfer.bytesPerSec > 0 && (now - lastLiveTransferSampleMs >= 450 || isDone);
        if (shouldSample) {
          lastLiveTransferSampleMs = now;
        }
        setStatus((prev) => {
          if (!prev) return prev;
          if (!shouldSample) {
            return {
              ...prev,
              activeTransfer: primaryTransfer,
              activeTransfers: nextActiveTransfers,
            };
          }
          const nextHistory = [
            ...(prev.transferHistory || []),
            {
              timestamp: new Date(now).toISOString(),
              bytesPerSec: Math.round(primaryTransfer.bytesPerSec),
              bytesReceived: primaryTransfer.bytesReceived,
              totalBytes: primaryTransfer.totalBytes,
              filename: primaryTransfer.filename,
              systemName: primaryTransfer.systemName,
            },
          ].slice(-90);
          return {
            ...prev,
            activeTransfer: primaryTransfer,
            activeTransfers: nextActiveTransfers,
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
        setLogsClearedRevision((r) => r + 1);
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
    setLogsClearedRevision((r) => r + 1);
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

  const handleQueueDownload = async (payload: {
    ids?: number[];
    filters?: Record<string, unknown>;
  }): Promise<{ queuedCount?: number; skippedCount?: number } | void> => {
    setErrorBanner(null);
    const res = await fetch('/api/items/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const parsed = await readJsonSafely<{
      run?: SyncRunRecord;
      queuedCount?: number;
      skippedCount?: number;
      error?: string;
    }>(res);
    if (!parsed.ok) {
      const msg = parsed.errorMessage || `Failed to queue downloads (HTTP ${res.status})`;
      setErrorBanner(msg);
      throw new Error(msg);
    }
    await loadInitialData();
    return {
      queuedCount: parsed.data?.queuedCount,
      skippedCount: parsed.data?.skippedCount,
    };
  };

  const handleStartCatalogIndex = async (scope: 'filtered' | 'full' = 'filtered') => {
    setErrorBanner(null);
    const res = await fetch('/api/catalog/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    const parsed = await readJsonSafely<{
      started?: boolean;
      targets?: string[];
      status?: ServiceStatusSnapshot;
      error?: string;
    }>(res);
    if (!parsed.ok) {
      const msg = parsed.errorMessage || `Failed to start catalog indexing (HTTP ${res.status})`;
      setErrorBanner(msg);
      throw new Error(msg);
    }
    if (parsed.data?.status) {
      setStatus(parsed.data.status);
    } else {
      await loadInitialData();
    }
  };

  const handleStopCatalogIndex = async () => {
    setErrorBanner(null);
    const res = await fetch('/api/catalog/index/stop', { method: 'POST' });
    const parsed = await readJsonSafely<{ status?: ServiceStatusSnapshot; error?: string }>(res);
    if (!parsed.ok) {
      setErrorBanner(parsed.errorMessage || `Failed to pause catalog indexing (HTTP ${res.status})`);
      return;
    }
    if (parsed.data?.status) {
      setStatus(parsed.data.status);
    } else {
      await loadInitialData();
    }
  };

  const navItems: { id: NavSection; label: string }[] = [
    { id: 'monitor', label: 'Sync' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'sync-rules', label: 'Sync Rules' },
    { id: 'device-export', label: 'Device Export' },
    { id: 'settings', label: 'System Settings' },
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

  const commitNavigation = useCallback(
    (nextSection: NavSection, target: ConfigSectionTarget | null = null) => {
      const normalizedTarget =
        target && resolveSectionForTarget(target) === nextSection ? target : null;

      if (typeof window !== 'undefined') {
        const currentEntry: AppHistoryState = {
          ...currentHistoryStateRef.current,
          scrollY: window.scrollY,
        };
        window.history.replaceState(currentEntry, '', window.location.href);

        const nextIndex = historyIndexRef.current + 1;
        historyIndexRef.current = nextIndex;
        const nextEntry: AppHistoryState = {
          section: nextSection,
          target: normalizedTarget,
          scrollY: 0,
          index: nextIndex,
        };
        currentHistoryStateRef.current = nextEntry;
        window.history.pushState(
          nextEntry,
          '',
          formatLocationHash(nextEntry.section, nextEntry.target),
        );
      }

      if (normalizedTarget) {
        pendingScrollRestoreRef.current = null;
        configFocusNonceRef.current += 1;
        setConfigFocus({
          target: normalizedTarget,
          nonce: configFocusNonceRef.current,
        });
      } else {
        setConfigFocus(null);
        pendingScrollRestoreRef.current = { section: nextSection, scrollY: 0 };
      }
      setSection(nextSection);
    },
    [],
  );

  const requestSectionChange = useCallback(
    (nextSection: NavSection, target: ConfigSectionTarget | null = null) => {
      if (nextSection === section && !target) return;
      if (isConfigSection(section) && nextSection !== section && configDirty.isDirty) {
        setNavGuardError(null);
        setPendingNavIntent({
          section: nextSection,
          target,
          historyDelta: 0,
        });
        return;
      }
      commitNavigation(nextSection, target);
    },
    [section, configDirty.isDirty, commitNavigation],
  );

  const navigateToConfigTarget = useCallback(
    (target?: ConfigSectionTarget) => {
      const resolvedTarget = target ?? 'auth';
      const targetSection = resolveSectionForTarget(resolvedTarget);
      requestSectionChange(targetSection, resolvedTarget);
    },
    [requestSectionChange],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const existingState = window.history.state;
    if (isAppHistoryState(existingState)) {
      currentHistoryStateRef.current = existingState;
      historyIndexRef.current = existingState.index;
      if (existingState.scrollY > 0) {
        pendingScrollRestoreRef.current = {
          section: existingState.section,
          scrollY: existingState.scrollY,
        };
      }
    } else {
      const parsed = parseLocationHash(window.location.hash);
      const initialEntry: AppHistoryState = {
        section: parsed.section,
        target: parsed.target,
        scrollY: 0,
        index: 0,
      };
      currentHistoryStateRef.current = initialEntry;
      historyIndexRef.current = 0;
      window.history.replaceState(
        initialEntry,
        '',
        formatLocationHash(initialEntry.section, initialEntry.target),
      );
    }

    const onPopState = (ev: PopStateEvent) => {
      if (ignoringNextPopstateRef.current) {
        ignoringNextPopstateRef.current = false;
        return;
      }

      const rawState = ev.state;
      let nextState: AppHistoryState;
      let hasIndexedState = false;

      if (isAppHistoryState(rawState)) {
        hasIndexedState = true;
        nextState = {
          section: rawState.section,
          target: rawState.target ?? null,
          scrollY: typeof rawState.scrollY === 'number' ? rawState.scrollY : 0,
          index: rawState.index,
        };
      } else {
        const parsed = parseLocationHash(window.location.hash);
        const nextIdx = historyIndexRef.current + 1;
        nextState = {
          section: parsed.section,
          target: parsed.target,
          scrollY: 0,
          index: nextIdx,
        };
      }

      if (
        isConfigSection(sectionRef.current) &&
        nextState.section !== sectionRef.current &&
        configDirtyRef.current
      ) {
        const currentIndex = currentHistoryStateRef.current.index;
        const revertDelta = hasIndexedState
          ? nextState.index < currentIndex
            ? Math.max(1, currentIndex - nextState.index)
            : Math.min(-1, currentIndex - nextState.index)
          : -1;
        ignoringNextPopstateRef.current = true;
        window.history.go(revertDelta);
        setNavGuardError(null);
        setPendingNavIntent({
          section: nextState.section,
          target: nextState.target,
          historyDelta: -revertDelta,
        });
        return;
      }

      if (!hasIndexedState) {
        historyIndexRef.current = nextState.index;
        window.history.replaceState(
          nextState,
          '',
          formatLocationHash(nextState.section, nextState.target),
        );
      } else {
        historyIndexRef.current = Math.max(historyIndexRef.current, nextState.index);
      }

      currentHistoryStateRef.current = nextState;

      if (
        nextState.target &&
        resolveSectionForTarget(nextState.target) === nextState.section &&
        nextState.scrollY === 0
      ) {
        pendingScrollRestoreRef.current = null;
        configFocusNonceRef.current += 1;
        setConfigFocus({
          target: nextState.target,
          nonce: configFocusNonceRef.current,
        });
      } else {
        setConfigFocus(null);
        pendingScrollRestoreRef.current = {
          section: nextState.section,
          scrollY: nextState.scrollY,
        };
      }
      setSection(nextState.section);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const hasLoadedWorkspace = Boolean(status && config);
  useEffect(() => {
    if (!hasLoadedWorkspace) return;
    const pending = pendingScrollRestoreRef.current;
    if (!pending || pending.section !== section) return;
    pendingScrollRestoreRef.current = null;

    let rafInner = 0;
    const rafOuter = window.requestAnimationFrame(() => {
      rafInner = window.requestAnimationFrame(() => {
        window.scrollTo({ top: pending.scrollY, behavior: 'auto' });
      });
    });
    return () => {
      window.cancelAnimationFrame(rafOuter);
      if (rafInner) window.cancelAnimationFrame(rafInner);
    };
  }, [section, hasLoadedWorkspace]);

  useEffect(() => {
    if (!showFullSyncConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !actionPending) {
        setConfirmingFullSync(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullSyncConfirm, actionPending]);

  useEffect(() => {
    if (!pendingNavIntent) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !navGuardSaving) {
        setPendingNavIntent(null);
        setNavGuardError(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingNavIntent, navGuardSaving]);

  const handleGuardSaveAndLeave = async () => {
    if (!pendingNavIntent) return;
    const currentLabel = navItems.find((n) => n.id === section)?.label ?? 'this page';
    setNavGuardSaving(true);
    setNavGuardError(null);
    const saved = await configPanelRef.current?.save();
    setNavGuardSaving(false);
    if (!saved) {
      setNavGuardError(
        `Fix the validation or save error shown in ${currentLabel} before leaving.`,
      );
      return;
    }
    const intent = pendingNavIntent;
    setPendingNavIntent(null);
    configDirtyRef.current = false;
    if (intent.historyDelta !== 0) {
      window.history.go(intent.historyDelta);
    } else {
      commitNavigation(intent.section, intent.target);
    }
  };

  const handleGuardDiscardAndLeave = () => {
    if (!pendingNavIntent || navGuardSaving) return;
    const intent = pendingNavIntent;
    configPanelRef.current?.discard();
    setPendingNavIntent(null);
    setNavGuardError(null);
    configDirtyRef.current = false;
    if (intent.historyDelta !== 0) {
      window.history.go(intent.historyDelta);
    } else {
      commitNavigation(intent.section, intent.target);
    }
  };

  const crtCssVars = computeCrtCssVariables(crtSettings);
  const isUltraMotion = crtSettings.uiMotion === 'ultra';
  const isHighOrUltraMotion =
    crtSettings.uiMotion === 'high' || crtSettings.uiMotion === 'ultra';
  const showScanlines = crtSettings.enabled && (crtSettings.scanlines > 0 || isUltraMotion);
  const showGrille = crtSettings.enabled && (crtSettings.apertureGrille > 0 || isUltraMotion);
  const showVignette =
    crtSettings.enabled &&
    (crtSettings.vignette > 0 || crtSettings.gaussGlow > 0 || isUltraMotion);
  const showHumBar = crtSettings.enabled && isHighOrUltraMotion;
  const showDegauss = crtSettings.enabled && isUltraMotion;

  return (
    <div
      data-crt-palette={crtSettings.palette}
      data-crt-motion={crtSettings.uiMotion}
      data-sync-running={status?.activeRun ? 'true' : 'false'}
      style={crtCssVars}
      className={`min-h-screen crt-canvas text-crt-text flex flex-col ${crtSettings.enabled ? 'crt-fx-active' : ''}`}
    >
      {showGrille && <div aria-hidden="true" className="crt-layer-grille" />}
      {showScanlines && <div aria-hidden="true" className="crt-layer-scanlines" />}
      {showHumBar && (
        <div aria-hidden="true" className="crt-layer-humbar">
          <div className="crt-layer-humbar-band" />
        </div>
      )}
      {showVignette && <div aria-hidden="true" className="crt-layer-vignette" />}
      {showDegauss && <div aria-hidden="true" className="crt-layer-degauss" />}
      {/* Sticky Top Header & Full Sync Confirmation Container */}
      <div className="sticky top-0 z-30">
        <header className="relative bg-crt-bg/95 backdrop-blur border-b border-crt-border px-4 lg:px-6 py-3 flex flex-wrap lg:flex-nowrap items-center justify-between gap-4">
          <div aria-hidden="true" className="crt-header-beam">
            <span />
          </div>
        {/* Zone 1: Native CSS Animated CRT Brand Banner */}
        <a
          href="#monitor"
          onClick={(e) => {
            e.preventDefault();
            requestSectionChange('monitor');
          }}
          aria-label="RetroGameTalk Sync"
          className="crt-brand-link inline-flex items-center shrink-0 min-h-10 sm:min-h-[52px] rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-crt-phosphor"
        >
          <BrandMark
            isSyncRunning={Boolean(status?.activeRun)}
            isDryRun={
              status?.activeRun
                ? Boolean(status.activeRun.dryRun || status.activeRun.mode === 'dry_run')
                : dryRunEnabled
            }
          />
        </a>

        {/* Sync Scope + Independent Dry Run Toggle + Reserved-Width Run/Stop Action */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0 ml-auto">
          {/* 2-Way Sync Scope Selector */}
          <div
            role="group"
            aria-label="Sync scope"
            className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded-[5px] shrink-0"
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
                      ? 'Verify login in System Settings before running a sync'
                      : scope === 'incremental'
                        ? 'Inspect releases created or updated since the Incremental Cutoff'
                        : 'Inspect every release across target consoles with no date cutoff'
                  }
                  onClick={() => {
                    setSelectedScope(scope);
                    if (scope !== 'full') setConfirmingFullSync(false);
                  }}
                  className={`px-3 py-1 font-display text-xs font-medium tracking-[0.02em] rounded-[4px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                ? 'Verify login in System Settings before running a sync'
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
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 font-display text-xs font-medium tracking-[0.02em] rounded-[5px] border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              dryRunEnabled
                ? 'border-crt-amber/75 bg-crt-amber/12 text-crt-amber'
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
            <FlaskConical
              className={`h-3.5 w-3.5 shrink-0 ${dryRunEnabled ? 'crt-dryrun-flask-active' : ''}`}
            />
            <span>Dry Run</span>
          </button>

          <div className="w-[208px] flex justify-end shrink-0">
            {status?.activeRun ? (
              <SyncCommandButton
                mode={stopRequested ? 'stopping' : 'stop'}
                disabled={actionPending || stopRequested}
                title={
                  stopRequested
                    ? 'Waiting for active transfer or scrape step to halt cleanly'
                    : 'Gracefully halt the active run after the current step completes'
                }
                onClick={() => void handleStopRun()}
                label={
                  stopRequested
                    ? 'Stopping...'
                    : status.activeRun.dryRun || status.activeRun.mode === 'dry_run'
                      ? 'Stop Dry Run'
                      : status.activeRun.triggerType === 'retry'
                        ? 'Stop Retry'
                        : status.activeRun.triggerType === 'download'
                          ? 'Stop Queue'
                          : status.activeRun.mode === 'full'
                            ? 'Stop Full Sync'
                            : 'Stop Incremental'
                }
              />
            ) : (
              <SyncCommandButton
                mode={
                  dryRunEnabled
                    ? 'dry_run'
                    : selectedScope === 'full'
                      ? 'full'
                      : 'incremental'
                }
                armed={selectedScope === 'full' && !dryRunEnabled && showFullSyncConfirm}
                aria-expanded={
                  selectedScope === 'full' && !dryRunEnabled ? showFullSyncConfirm : undefined
                }
                disabled={actionPending || !status || !syncAllowed}
                title={
                  !syncAllowed
                    ? 'Login required: test and verify credentials in System Settings before syncing'
                    : dryRunEnabled
                      ? `Simulate ${selectedScope === 'full' ? 'Full Sync' : 'Incremental Sync'} (0 bytes written to disk)`
                      : selectedScope === 'full'
                        ? 'Crawl and mirror every release across target consoles with no date cutoff'
                        : 'Mirror releases added or updated since the Incremental Cutoff'
                }
                onClick={() => {
                  if (selectedScope === 'full' && !dryRunEnabled) {
                    setConfirmingFullSync((prev) => !prev);
                  } else {
                    void handleStartRun(selectedScope, dryRunEnabled);
                  }
                }}
                label={
                  dryRunEnabled
                    ? selectedScope === 'full'
                      ? 'Dry Run Full'
                      : 'Dry Run Incremental'
                    : selectedScope === 'full'
                      ? 'Full Sync'
                      : 'Incremental Sync'
                }
              />
            )}
          </div>
        </div>
      </header>

      {/* Inline Uncapped Full Sync Confirmation Strip (anchored inside sticky top container) */}
      {showFullSyncConfirm && (
        <div
          role="region"
          aria-label="Confirm uncapped Full Sync"
          className="border-b border-crt-amber/50 bg-crt-elevated/95 backdrop-blur px-4 lg:px-6 py-3 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.9)] flex flex-wrap items-center justify-between gap-3"
        >
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
              className="px-3 py-1.5 font-display text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded-[5px] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-display text-xs font-semibold border border-crt-amber/75 bg-crt-amber/12 text-crt-amber hover:bg-crt-amber/20 rounded-[5px] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              title="Simulate Full Sync across all target consoles without downloading archives or modifying catalog rows"
            >
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              Dry Run Full First
            </button>
            <SyncCommandButton
              mode="full"
              compact
              disabled={actionPending}
              onClick={() => void handleStartRun('full', false)}
              label="Confirm Full Sync"
            />
          </div>
        </div>
      )}

      {/* Non-blocking Background Storage Device Installer Progress Dock */}
      <BulkInstallDock installer={bulkInstaller} />
      </div>

      {/* Main Workspace: Sidebar + Content Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left Rail Sidebar (240px on Desktop) */}
        <aside className="crt-sidebar-rail relative lg:z-20 lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-crt-border bg-crt-surface/70 p-4 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            {/* Mobile & Desktop Section Switcher */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1.5">
              {navItems.map((item) => {
                const active = section === item.id;
                const showDirtyBadge =
                  active && isConfigSection(item.id) && configDirty.isDirty;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-nav-active={active ? 'true' : 'false'}
                    onClick={() => requestSectionChange(item.id)}
                    className={`crt-nav-btn flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-crt-elevated border-crt-border-strong text-crt-phosphor'
                        : 'bg-transparent border-transparent text-crt-muted hover:text-crt-text hover:bg-crt-bg'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5 min-w-0">
                      <LivingNavIcon section={item.id} />
                      <span>{item.label}</span>
                    </span>
                    {showDirtyBadge && (
                      <span
                        title={`Unsaved changes: ${configDirty.changedSections.join(', ')}`}
                        className="text-[10px] font-mono text-crt-amber shrink-0"
                      >
                        Unsaved
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Real Daemon & Storage Telemetry Readout */}
            {status && (
              <ServiceTelemetrySidebar
                status={status}
                config={config}
                runs={runs}
                sseConnected={sseConnected}
              />
            )}

            {/* Discovered Systems Breakdown */}
            {status && status.systems.length > 0 && (
              <MirroredSystemsSidebar
                systems={status.systems}
                totalBytesOnDisk={status.storage.totalBytesOnDisk}
                storageFolderConfig={config?.storageFolderConfig}
              />
            )}

            {/* Permanent CRT Display & Living UI Motion Controls */}
            <CrtDisplayControl settings={crtSettings} onChange={setCrtSettings} />
          </div>

          {/* Inconspicuous Build Footer */}
          {status?.build && (
            <div className="hidden lg:block border-t border-crt-border pt-3">
              <BuildFooterMeta
                build={status.build}
                className="flex items-center justify-between gap-2 px-1 text-[11px] font-mono text-crt-muted/60 hover:text-crt-muted transition-colors"
              />
            </div>
          )}
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
                  logsClearedRevision={logsClearedRevision}
                  catalogRevision={catalogRevision}
                  activeRetryItemId={activeRetryItemId}
                  onSaveConfig={handleSaveConfig}
                  onClearLogs={handleClearLogs}
                  onClearRuns={handleClearRuns}
                  onNavigateToOperations={navigateToConfigTarget}
                  onRetryItem={handleRetryItem}
                  onRetryAllFailed={handleRetryAllFailed}
                  onRefreshStatus={loadInitialData}
                />
              )}
              {section === 'catalog' && (
                <CatalogPanel
                  config={config}
                  status={status}
                  installer={bulkInstaller}
                  catalogRevision={catalogRevision}
                  activeRetryItemId={activeRetryItemId}
                  onRetryItem={handleRetryItem}
                  onQueueDownload={handleQueueDownload}
                  onStartCatalogIndex={handleStartCatalogIndex}
                  onStopCatalogIndex={handleStopCatalogIndex}
                  onRefreshStatus={loadInitialData}
                />
              )}
              {section === 'sync-rules' && (
                <SyncRulesPanel
                  ref={configPanelRef}
                  config={config}
                  status={status}
                  focusRequest={configFocus}
                  onDirtyChange={setConfigDirty}
                  onSaveConfig={handleSaveConfig}
                  onStartCatalogIndex={handleStartCatalogIndex}
                  onStopCatalogIndex={handleStopCatalogIndex}
                  onNavigateToAuth={() => requestSectionChange('settings', 'auth')}
                />
              )}
              {section === 'device-export' && (
                <DeviceExportPanel
                  ref={configPanelRef}
                  config={config}
                  status={status}
                  focusRequest={configFocus}
                  onDirtyChange={setConfigDirty}
                  onSaveConfig={handleSaveConfig}
                />
              )}
              {section === 'settings' && (
                <SystemSettingsPanel
                  ref={configPanelRef}
                  config={config}
                  status={status}
                  focusRequest={configFocus}
                  onDirtyChange={setConfigDirty}
                  onSaveConfig={handleSaveConfig}
                  onRefreshConfig={loadInitialData}
                />
              )}

              {status.build && (
                <BuildFooterMeta
                  build={status.build}
                  className="lg:hidden mt-8 pt-3 border-t border-crt-border/50 flex items-center justify-between gap-2 text-[11px] font-mono text-crt-muted/60"
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* App-Wide Storage Device Installer Modal (can be closed & reopened while transfers run) */}
      {config && (
        <SdCardExportModal
          installer={bulkInstaller}
          config={config}
          onEditFolderMappings={() => {
            bulkInstaller.closeModal();
            requestSectionChange('device-export', 'storageMappings');
          }}
        />
      )}

      {/* Unsaved Configuration Changes Guard Modal */}
      {pendingNavIntent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-ops-title"
          onClick={() => {
            if (!navGuardSaving) {
              setPendingNavIntent(null);
              setNavGuardError(null);
            }
          }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md border border-crt-border-strong bg-crt-surface rounded-md p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-crt-amber shrink-0 mt-0.5" />
              <div className="space-y-1.5 min-w-0">
                <h2
                  id="unsaved-ops-title"
                  className="font-display text-base font-semibold text-crt-text"
                >
                  Unsaved Configuration Changes
                </h2>
                <p className="text-xs text-crt-muted leading-relaxed">
                  You have unsaved edits in{' '}
                  <span className="font-mono text-crt-text">
                    {configDirty.changedSections.join(', ')}
                  </span>
                  . Save before switching to{' '}
                  <span className="text-crt-text font-medium">
                    {navItems.find((n) => n.id === pendingNavIntent.section)?.label ??
                      pendingNavIntent.section}
                  </span>
                  ?
                </p>
              </div>
            </div>

            {navGuardError && (
              <p className="text-xs font-mono text-crt-crimson border border-crt-crimson/40 bg-crt-crimson/10 rounded px-3 py-2">
                {navGuardError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={navGuardSaving}
                onClick={() => {
                  setPendingNavIntent(null);
                  setNavGuardError(null);
                }}
                className="px-3 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                Keep Editing
              </button>
              <button
                type="button"
                disabled={navGuardSaving}
                onClick={handleGuardDiscardAndLeave}
                className="px-3 py-1.5 text-xs font-medium border border-crt-crimson/45 bg-crt-crimson/10 text-crt-crimson hover:bg-crt-crimson/20 rounded transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                Discard &amp; Leave
              </button>
              <button
                type="button"
                disabled={navGuardSaving}
                onClick={() => void handleGuardSaveAndLeave()}
                className="crt-cta-beam px-4 py-1.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors whitespace-nowrap disabled:opacity-50 cursor-pointer"
              >
                {navGuardSaving ? 'Saving...' : 'Save & Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
