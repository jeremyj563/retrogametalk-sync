import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { ScraperConfigPublic, ServiceStatusSnapshot, SyncRunRecord } from '../types';
import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatDurationMs,
  formatRunDuration,
  formatUptime,
} from '../utils/format';

type TelemetryTopicKey =
  | 'overview'
  | 'stream'
  | 'auth'
  | 'pacing'
  | 'schedule'
  | 'catalog'
  | 'storage';

interface ServiceTelemetrySidebarProps {
  status: ServiceStatusSnapshot;
  config: ScraperConfigPublic | null;
  runs: SyncRunRecord[];
  sseConnected: boolean;
}

function formatPacingCompact(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  return sec >= 10 ? `${sec.toFixed(1)}s` : `${sec.toFixed(2)}s`;
}

export function ServiceTelemetrySidebar({
  status,
  config,
  runs,
  sseConnected,
}: ServiceTelemetrySidebarProps) {
  const [activeTopic, setActiveTopic] = useState<TelemetryTopicKey | null>(null);
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  // Keep live countdowns & cooldown timers ticking smoothly between SSE snapshots
  useEffect(() => {
    const needsTick =
      Boolean(status.nextScheduledRunAt) ||
      Boolean(status.rateLimiter.cooldownUntilMs) ||
      activeTopic !== null;
    if (!needsTick) return;
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status.nextScheduledRunAt, status.rateLimiter.cooldownUntilMs, activeTopic]);

  const authLabel = status.auth.authenticated
    ? 'Active'
    : status.auth.lastCheckedAt
      ? 'Failed'
      : status.auth.hasCompletedLogin
        ? 'Standby'
        : status.auth.configured
          ? 'Unverified'
          : 'Unset';

  const authColorClass = status.auth.authenticated
    ? 'text-crt-phosphor'
    : status.auth.lastCheckedAt
      ? 'text-crt-crimson'
      : status.auth.configured
        ? 'text-crt-amber'
        : 'text-crt-muted';

  const cooldownRemainingMs =
    status.rateLimiter.cooldownUntilMs && status.rateLimiter.cooldownUntilMs > nowTickMs
      ? status.rateLimiter.cooldownUntilMs - nowTickMs
      : 0;

  const mirroredCount = status.totals.downloadedItems + status.totals.skippedItems;
  const completionPct =
    status.totals.totalCatalogItems > 0
      ? Math.min(100, Math.round((mirroredCount / status.totals.totalCatalogItems) * 100))
      : 0;
  const completionPermille =
    status.totals.totalCatalogItems > 0
      ? Math.min(1000, Math.round((mirroredCount / status.totals.totalCatalogItems) * 1000))
      : 0;

  const pacingSpan = Math.max(1, status.rateLimiter.maxDelayMs - status.rateLimiter.minDelayMs);
  const pacingPermille = Math.max(
    0,
    Math.min(
      1000,
      Math.round(((status.rateLimiter.currentDelayMs - status.rateLimiter.minDelayMs) / pacingSpan) * 1000),
    ),
  );

  const volumeStats = useMemo(() => {
    const total = status.storage.diskTotalBytes;
    const free = status.storage.diskFreeBytes;
    if (!total || total <= 0 || free === null || free < 0) {
      return null;
    }
    const usedVolumeBytes = Math.max(status.storage.totalBytesOnDisk, total - free);
    const ratio = Math.min(1, Math.max(0, usedVolumeBytes / total));
    const pct = ratio * 100;
    const label =
      pct > 0 && pct < 0.1 ? '<0.1%' : pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
    return {
      usedVolumeBytes,
      permille: Math.round(ratio * 1000),
      label,
    };
  }, [status.storage.diskTotalBytes, status.storage.diskFreeBytes, status.storage.totalBytesOnDisk]);

  const latestRun = status.activeRun ?? (runs.length > 0 ? runs[0] : null);
  const shortSha =
    status.build.gitSha && status.build.gitSha !== 'unknown'
      ? status.build.gitSha.slice(0, 7)
      : 'unknown';

  const rowClass = (topic: TelemetryTopicKey) =>
    `flex items-center justify-between gap-2 px-1.5 py-1 -mx-1 rounded border text-xs font-mono transition-colors cursor-default focus-visible:outline-none ${
      activeTopic === topic
        ? 'border-crt-border-strong bg-crt-elevated/85 text-crt-phosphor'
        : 'border-transparent text-crt-muted hover:bg-crt-elevated/55 hover:text-crt-text'
    }`;

  const bindTopicHandlers = (topic: TelemetryTopicKey) => ({
    tabIndex: 0,
    'aria-describedby': activeTopic === topic ? 'service-telemetry-tooltip' : undefined,
    onMouseEnter: () => setActiveTopic(topic),
    onFocus: () => setActiveTopic(topic),
    onBlur: (e: React.FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setActiveTopic((prev) => (prev === topic ? null : prev));
      }
    },
  });

  return (
    <div
      className="relative hidden lg:block border-t border-crt-border pt-4 space-y-2"
      onMouseLeave={() => setActiveTopic(null)}
    >
      {/* Section Header */}
      <div
        {...bindTopicHandlers('overview')}
        className={`flex items-center justify-between gap-2 px-1.5 py-0.5 -mx-1 rounded border text-xs font-medium transition-colors cursor-default focus-visible:outline-none ${
          activeTopic === 'overview'
            ? 'border-crt-border-strong bg-crt-elevated/85 text-crt-phosphor'
            : 'border-transparent text-crt-muted hover:text-crt-text'
        }`}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <Activity className="h-3.5 w-3.5 crt-drive-activity text-crt-phosphor shrink-0" />
          <span className="truncate">Service Telemetry</span>
        </span>
        <span
          className={`font-mono text-[11px] shrink-0 ${
            status.activeRun ? 'text-crt-phosphor crt-live-readout' : 'text-crt-muted/80'
          }`}
        >
          {status.activeRun ? `Run #${status.activeRun.id}` : 'Idle'}
        </span>
      </div>

      {/* Scannable Subsystem Rows */}
      <div className="space-y-0.5">
        <div {...bindTopicHandlers('stream')} className={rowClass('stream')}>
          <span className="truncate">UI Event Stream</span>
          <span
            className={`shrink-0 ${
              sseConnected ? 'text-crt-phosphor crt-live-readout' : 'text-crt-amber'
            }`}
          >
            {sseConnected ? 'Live' : 'Reconnecting'}
          </span>
        </div>

        <div {...bindTopicHandlers('auth')} className={rowClass('auth')}>
          <span className="truncate">Auth Session</span>
          <span className={`shrink-0 ${authColorClass}`}>{authLabel}</span>
        </div>

        <div {...bindTopicHandlers('pacing')} className={rowClass('pacing')}>
          <span className="truncate">Rate Pacing</span>
          <span
            className={`tabular-nums shrink-0 ${
              cooldownRemainingMs > 0 ? 'text-crt-amber' : 'text-crt-text'
            }`}
          >
            {cooldownRemainingMs > 0
              ? `Wait ${Math.ceil(cooldownRemainingMs / 1000)}s`
              : formatPacingCompact(status.rateLimiter.currentDelayMs)}
          </span>
        </div>

        <div {...bindTopicHandlers('schedule')} className={rowClass('schedule')}>
          <span className="truncate">Next Schedule</span>
          <span
            className={`tabular-nums shrink-0 ${
              status.scheduleEnabled ? 'text-crt-text' : 'text-crt-muted/85'
            }`}
          >
            {formatCountdown(status.nextScheduledRunAt)}
          </span>
        </div>

        <div {...bindTopicHandlers('catalog')} className={rowClass('catalog')}>
          <span className="truncate">Catalog Health</span>
          <span className="flex items-center gap-1.5 tabular-nums whitespace-nowrap shrink-0">
            <span className="text-crt-text">{mirroredCount.toLocaleString()}</span>
            {status.totals.failedItems > 0 ? (
              <>
                <span aria-hidden="true" className="text-crt-muted/45">
                  ·
                </span>
                <span className="text-crt-crimson">{status.totals.failedItems} err</span>
              </>
            ) : status.totals.queuedItems > 0 ? (
              <>
                <span aria-hidden="true" className="text-crt-muted/45">
                  /
                </span>
                <span className="text-crt-muted">
                  {status.totals.totalCatalogItems.toLocaleString()}
                </span>
              </>
            ) : null}
          </span>
        </div>

        <div {...bindTopicHandlers('storage')} className={rowClass('storage')}>
          <span className="truncate">Disk Used</span>
          <span
            className={`tabular-nums shrink-0 ${
              status.storage.writable ? 'text-crt-text' : 'text-crt-crimson'
            }`}
          >
            {status.storage.writable
              ? formatBytes(status.storage.totalBytesOnDisk)
              : 'Read-Only'}
          </span>
        </div>
      </div>

      {/* Floating CRT Subsystem Telemetry Popover */}
      {activeTopic && (
        <div
          id="service-telemetry-tooltip"
          role="tooltip"
          className="pointer-events-none absolute left-full top-0 ml-3 z-40 w-76 rounded-md border border-crt-border-strong bg-crt-surface/98 p-3.5 shadow-2xl backdrop-blur-md"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>

          {activeTopic === 'overview' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  Daemon &amp; Runtime Overview
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span>{status.podId}</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {status.build.version} ({shortSha})
                  </span>
                </div>
              </div>

              <div className="mt-2.5 pt-2.5 border-t border-crt-border text-[11px] font-mono text-crt-phosphor/95 leading-relaxed break-words">
                {status.currentPhase}
              </div>

              <dl className="mt-2.5 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Process Uptime</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatUptime(status.uptimeSeconds)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">SQLite Schema</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    v{status.schemaVersion} · WAL
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">SQLite Footprint</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatBytes(status.storage.sqliteBytes)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Mirrored Systems</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.systems.length.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Total Sync Runs</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.totals.totalRuns.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </>
          )}

          {activeTopic === 'stream' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  UI Event Stream &amp; Node
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span>SSE /api/events</span>
                  <span aria-hidden="true"> · </span>
                  <span>{status.podId}</span>
                </div>
              </div>

              <dl className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Push Channel</dt>
                  <dd
                    className={`text-right whitespace-nowrap ${
                      sseConnected ? 'text-crt-phosphor font-semibold' : 'text-crt-amber'
                    }`}
                  >
                    {sseConnected ? 'Connected (Live SSE)' : 'Reconnecting…'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Process Uptime</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatUptime(status.uptimeSeconds)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Active Transfer</dt>
                  <dd className="text-crt-text text-right truncate">
                    {status.activeTransfer
                      ? `${formatBytes(status.activeTransfer.bytesPerSec)}/s${
                          status.activeTransfer.activeChunks && status.activeTransfer.activeChunks > 1
                            ? ` · ${status.activeTransfer.activeChunks} chunks`
                            : ''
                        }`
                      : 'Idle'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">SQLite Engine</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    v{status.schemaVersion} · {formatBytes(status.storage.sqliteBytes)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Build Revision</dt>
                  <dd className="text-crt-muted text-right truncate">
                    {status.build.version} · {shortSha}
                  </dd>
                </div>
              </dl>

              <div className="mt-2.5 pt-2 border-t border-crt-border text-[11px] font-mono text-crt-muted leading-relaxed break-words">
                {status.currentPhase}
              </div>
            </>
          )}

          {activeTopic === 'auth' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  Upstream Auth Session
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span>{config?.username ? `Account: ${config.username}` : 'Credentials unset'}</span>
                  <span aria-hidden="true"> · </span>
                  <span>AES-256-GCM</span>
                </div>
              </div>

              <dl className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Session State</dt>
                  <dd className={`text-right whitespace-nowrap font-semibold ${authColorClass}`}>
                    {status.auth.authenticated
                      ? 'Authenticated'
                      : status.auth.lastCheckedAt
                        ? 'Verification Failed'
                        : status.auth.hasCompletedLogin
                          ? 'Persisted Standby'
                          : status.auth.configured
                            ? 'Unverified'
                            : 'Not Configured'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Cookie Jar</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.auth.cookieCount.toLocaleString()} active cookie
                    {status.auth.cookieCount === 1 ? '' : 's'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Last Login</dt>
                  <dd className="text-crt-text text-right truncate">
                    {formatDateTime(status.auth.lastAuthenticatedAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Last Checked</dt>
                  <dd className="text-crt-text text-right truncate">
                    {formatDateTime(status.auth.lastCheckedAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Target Repo</dt>
                  <dd className="text-crt-phosphor/90 text-right truncate">
                    {config?.baseUrl
                      ? config.baseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
                      : 'retrogametalk.com/repo'}
                  </dd>
                </div>
              </dl>

              {status.auth.lastMessage && (
                <div className="mt-2.5 pt-2 border-t border-crt-border text-[11px] font-mono text-crt-muted leading-relaxed break-words">
                  {status.auth.lastMessage}
                </div>
              )}
            </>
          )}

          {activeTopic === 'pacing' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  Adaptive AIMD Rate Limiter
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span>Polite Jitter (±15%)</span>
                  <span aria-hidden="true"> · </span>
                  <span>{config?.maxConcurrency ?? 1}x Worker</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {(config?.downloadChunkConcurrency ?? 1) > 1
                      ? `${config?.downloadChunkConcurrency ?? 1}x Chunks`
                      : '1x Stream'}
                  </span>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <span className="text-crt-muted">Inter-Request Delay</span>
                  <span
                    className={
                      cooldownRemainingMs > 0
                        ? 'text-crt-amber font-semibold'
                        : 'text-crt-phosphor font-semibold'
                    }
                  >
                    {formatDurationMs(status.rateLimiter.currentDelayMs)}
                  </span>
                </div>
                <progress
                  max={1000}
                  value={Math.max(30, pacingPermille)}
                  aria-label="Current AIMD rate-limiter delay within configured bounds"
                  className="block h-1.5 w-full overflow-hidden rounded-xs bg-crt-bg border border-crt-border [&::-webkit-progress-bar]:bg-crt-bg [&::-webkit-progress-value]:bg-crt-phosphor [&::-moz-progress-bar]:bg-crt-phosphor"
                />
              </div>

              <dl className="mt-2.5 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Delay Bounds</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatPacingCompact(status.rateLimiter.minDelayMs)} –{' '}
                    {formatPacingCompact(status.rateLimiter.maxDelayMs)} (
                    {status.rateLimiter.backoffMultiplier}x)
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Avg Latency</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.rateLimiter.totalRequests > 0
                      ? `${status.rateLimiter.avgLatencyMs.toLocaleString()} ms`
                      : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Total Requests</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.rateLimiter.totalRequests.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Healthy Streak</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.rateLimiter.consecutiveSuccesses} / 5 req
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">429 / 503 Hits</dt>
                  <dd
                    className={`text-right whitespace-nowrap ${
                      status.rateLimiter.rateLimitHits > 0 ? 'text-crt-amber' : 'text-crt-text'
                    }`}
                  >
                    {status.rateLimiter.rateLimitHits.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </>
          )}

          {activeTopic === 'schedule' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  Scheduler &amp; Sync Runs
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span>{status.scheduleEnabled ? 'Cron Active' : 'Cron Paused'}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{status.cronSchedule}</span>
                </div>
              </div>

              <dl className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Next Run</dt>
                  <dd className="text-crt-phosphor text-right truncate">
                    {status.nextScheduledRunAt
                      ? `${formatDateTime(status.nextScheduledRunAt)} (${formatCountdown(status.nextScheduledRunAt)})`
                      : 'Schedule Paused'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Watermark</dt>
                  <dd className="text-crt-text text-right truncate">
                    {formatDateTime(status.lastWatermarkAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Total Runs</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.totals.totalRuns.toLocaleString()}
                  </dd>
                </div>

                {latestRun && (
                  <>
                    <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-crt-border/70">
                      <dt className="text-crt-muted shrink-0">Latest Run</dt>
                      <dd className="text-crt-text text-right truncate">
                        #{latestRun.id} · {latestRun.dryRun ? 'dry-run' : latestRun.mode} (
                        {latestRun.status})
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-crt-muted shrink-0">Run Yield</dt>
                      <dd className="text-crt-text text-right whitespace-nowrap">
                        +{latestRun.downloadedCount.toLocaleString()} dl ·{' '}
                        {formatBytes(latestRun.bytesDownloaded)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-crt-muted shrink-0">Run Duration</dt>
                      <dd className="text-crt-muted text-right whitespace-nowrap">
                        {formatRunDuration(latestRun.startedAt, latestRun.finishedAt)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </>
          )}

          {activeTopic === 'catalog' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  Catalog &amp; Preservation Health
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span>{status.systems.length} System(s)</span>
                  <span aria-hidden="true"> · </span>
                  <span>{status.releaseTypes.length} Release Type(s)</span>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <span className="text-crt-muted">Mirrored Coverage</span>
                  <span className="text-crt-phosphor font-semibold">
                    {mirroredCount.toLocaleString()} /{' '}
                    {status.totals.totalCatalogItems.toLocaleString()} ({completionPct}%)
                  </span>
                </div>
                <progress
                  max={1000}
                  value={mirroredCount > 0 ? Math.max(24, completionPermille) : 0}
                  aria-label="Catalog mirrored completion"
                  className="block h-1.5 w-full overflow-hidden rounded-xs bg-crt-bg border border-crt-border [&::-webkit-progress-bar]:bg-crt-bg [&::-webkit-progress-value]:bg-crt-phosphor [&::-moz-progress-bar]:bg-crt-phosphor"
                />
              </div>

              <dl className="mt-2.5 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Queued / Active</dt>
                  <dd
                    className={`text-right whitespace-nowrap ${
                      status.totals.queuedItems > 0 ? 'text-crt-amber' : 'text-crt-text'
                    }`}
                  >
                    {status.totals.queuedItems.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Failed / Partial</dt>
                  <dd
                    className={`text-right whitespace-nowrap ${
                      status.totals.failedItems > 0 ? 'text-crt-crimson' : 'text-crt-text'
                    }`}
                  >
                    {status.totals.failedItems.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Installed to Device</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {status.totals.installedItems.toLocaleString()} /{' '}
                    {mirroredCount.toLocaleString()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Indexed Size</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatBytes(status.totals.totalBytesMirrored)}
                  </dd>
                </div>
              </dl>
            </>
          )}

          {activeTopic === 'storage' && (
            <>
              <div className="space-y-0.5 min-w-0">
                <div className="font-display text-sm font-semibold text-crt-text leading-snug">
                  Repository Volume &amp; Storage
                </div>
                <div className="text-[11px] font-mono text-crt-muted truncate">
                  <span className={status.storage.writable ? 'text-crt-phosphor' : 'text-crt-crimson'}>
                    {status.storage.writable ? 'Read / Write' : 'Read-Only Mount'}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {status.storage.totalFilesOnDisk.toLocaleString()} file
                    {status.storage.totalFilesOnDisk === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              {volumeStats && (
                <div className="mt-3 pt-2.5 border-t border-crt-border space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                    <span className="text-crt-muted">Volume Capacity</span>
                    <span className="text-crt-phosphor font-semibold">
                      {formatBytes(volumeStats.usedVolumeBytes)} /{' '}
                      {formatBytes(status.storage.diskTotalBytes)} ({volumeStats.label})
                    </span>
                  </div>
                  <progress
                    max={1000}
                    value={Math.max(24, volumeStats.permille)}
                    aria-label="Repository volume capacity usage"
                    className="block h-1.5 w-full overflow-hidden rounded-xs bg-crt-bg border border-crt-border [&::-webkit-progress-bar]:bg-crt-bg [&::-webkit-progress-value]:bg-crt-phosphor [&::-moz-progress-bar]:bg-crt-phosphor"
                  />
                </div>
              )}

              <dl className="mt-2.5 pt-2.5 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Mirrored Archive</dt>
                  <dd className="text-crt-phosphor text-right whitespace-nowrap">
                    {formatBytes(status.storage.totalBytesOnDisk)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">Volume Free</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatBytes(status.storage.diskFreeBytes)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted">SQLite Database</dt>
                  <dd className="text-crt-text text-right whitespace-nowrap">
                    {formatBytes(status.storage.sqliteBytes)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-crt-muted shrink-0">Mirror Path</dt>
                  <dd className="text-crt-muted text-right truncate">
                    {status.storage.downloadDir}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  );
}
