import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Gauge, Save } from 'lucide-react';
import type { ScraperConfigPublic, ServiceStatusSnapshot } from '../types';
import { formatDateTime } from '../utils/format';
import { EnvLockIndicator } from './EnvLockIndicator';

interface SchedulePanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
}

const CRON_PRESETS = [
  { label: 'Every 6 Hours', expr: '0 */6 * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Every 12 Hours', expr: '0 */12 * * *' },
  { label: 'Daily Midnight', expr: '0 0 * * *' },
];

export function SchedulePanel({ config, status, onSaveConfig }: SchedulePanelProps) {
  const [cronSchedule, setCronSchedule] = useState(config.cronSchedule);
  const [scheduleEnabled, setScheduleEnabled] = useState(config.scheduleEnabled);
  const [baseDelayMs, setBaseDelayMs] = useState(config.baseDelayMs);
  const [minDelayMs, setMinDelayMs] = useState(config.minDelayMs);
  const [maxDelayMs, setMaxDelayMs] = useState(config.maxDelayMs);
  const [backoffMultiplier, setBackoffMultiplier] = useState(config.backoffMultiplier);
  const [maxRetries, setMaxRetries] = useState(config.maxRetries);
  const [maxConcurrency, setMaxConcurrency] = useState(config.maxConcurrency);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(config.requestTimeoutMs);
  const [userAgent, setUserAgent] = useState(config.userAgent);

  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cronLockedByEnv = config.envOverrides.includes('CRON_SCHEDULE');
  const scheduleEnabledLockedByEnv = config.envOverrides.includes('SCRAPER_SCHEDULE_ENABLED');
  const baseDelayLockedByEnv = config.envOverrides.includes('SCRAPER_BASE_DELAY_MS');
  const minDelayLockedByEnv = config.envOverrides.includes('SCRAPER_MIN_DELAY_MS');
  const maxDelayLockedByEnv = config.envOverrides.includes('SCRAPER_MAX_DELAY_MS');
  const backoffLockedByEnv = config.envOverrides.includes('SCRAPER_BACKOFF_MULTIPLIER');
  const maxRetriesLockedByEnv = config.envOverrides.includes('SCRAPER_MAX_RETRIES');
  const timeoutLockedByEnv = config.envOverrides.includes('SCRAPER_REQUEST_TIMEOUT_MS');
  const concurrencyLockedByEnv = config.envOverrides.includes('SCRAPER_MAX_CONCURRENCY');
  const userAgentLockedByEnv = config.envOverrides.includes('SCRAPER_USER_AGENT');

  useEffect(() => {
    setCronSchedule(config.cronSchedule);
    setScheduleEnabled(config.scheduleEnabled);
    setBaseDelayMs(config.baseDelayMs);
    setMinDelayMs(config.minDelayMs);
    setMaxDelayMs(config.maxDelayMs);
    setBackoffMultiplier(config.backoffMultiplier);
    setMaxRetries(config.maxRetries);
    setMaxConcurrency(config.maxConcurrency);
    setRequestTimeoutMs(config.requestTimeoutMs);
    setUserAgent(config.userAgent);
  }, [config]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(null);
    setErrorMsg(null);
    try {
      await onSaveConfig({
        ...(!cronLockedByEnv ? { cronSchedule } : {}),
        ...(!scheduleEnabledLockedByEnv ? { scheduleEnabled } : {}),
        ...(!baseDelayLockedByEnv ? { baseDelayMs } : {}),
        ...(!minDelayLockedByEnv ? { minDelayMs } : {}),
        ...(!maxDelayLockedByEnv ? { maxDelayMs } : {}),
        ...(!backoffLockedByEnv ? { backoffMultiplier } : {}),
        ...(!maxRetriesLockedByEnv ? { maxRetries } : {}),
        ...(!concurrencyLockedByEnv ? { maxConcurrency } : {}),
        ...(!timeoutLockedByEnv ? { requestTimeoutMs } : {}),
        ...(!userAgentLockedByEnv ? { userAgent } : {}),
      });
      setSavedNotice('Schedule and rate-limit settings saved');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 max-w-5xl">
      {/* Schedule Section */}
      <section className="border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 text-crt-phosphor mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Continuous Cron Scheduler
              </h2>
              <p className="text-xs text-crt-muted">
                Runs incremental delta checks automatically to mirror releases created or updated on RGT since the cutoff watermark (defaults to last 24h on first run).
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
            <button
              type="button"
              disabled={scheduleEnabledLockedByEnv}
              onClick={() => setScheduleEnabled((v) => !v)}
              className={`px-3.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed ${
                scheduleEnabled
                  ? 'border-crt-phosphor text-crt-phosphor bg-crt-phosphor/10'
                  : 'border-crt-border text-crt-muted bg-crt-bg'
              }`}
            >
              {scheduleEnabled ? 'Schedule: Enabled' : 'Schedule: Paused'}
            </button>
            {scheduleEnabledLockedByEnv && (
              <EnvLockIndicator envVar="SCRAPER_SCHEDULE_ENABLED" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Cron Expression (5-field UTC/Container time)
              </label>
              {cronLockedByEnv && <EnvLockIndicator envVar="CRON_SCHEDULE" />}
            </div>
            <input
              type="text"
              value={cronSchedule}
              disabled={cronLockedByEnv}
              onChange={(e) => setCronSchedule(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
              placeholder="0 */6 * * *"
            />
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-crt-text">Quick Cadence Presets</span>
            <div className="flex flex-wrap gap-2">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.expr}
                  type="button"
                  disabled={cronLockedByEnv}
                  onClick={() => setCronSchedule(preset.expr)}
                  className={`px-3 py-1.5 text-xs border rounded transition-colors whitespace-nowrap ${
                    cronSchedule === preset.expr
                      ? 'border-crt-phosphor text-crt-phosphor bg-crt-elevated'
                      : 'border-crt-border text-crt-muted bg-crt-bg hover:text-crt-text'
                  } disabled:opacity-50`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-2 text-xs font-mono text-crt-muted tabular-nums flex flex-wrap gap-x-6 gap-y-1">
          <span>Next Scheduled Run: {formatDateTime(status.nextScheduledRunAt)}</span>
          <span>
            Incremental Cutoff:{' '}
            {config.lastWatermarkAt ? formatDateTime(config.lastWatermarkAt) : 'Last 24h (auto default)'}
          </span>
        </div>
      </section>

      {/* Adaptive Rate Limiter Tuning */}
      <section className="border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div className="flex items-start gap-3 border-b border-crt-border pb-4">
          <Gauge className="h-5 w-5 text-crt-phosphor mt-0.5 shrink-0" />
          <div>
            <h2 className="font-display text-lg font-semibold text-crt-text">
              Adaptive AIMD Rate-Limit Guard
            </h2>
            <p className="text-xs text-crt-muted">
              Dynamically scales request spacing down during clean streaks and backs off exponentially on HTTP 429, 503, or Retry-After signals.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Base Request Delay (ms)
              </label>
              {baseDelayLockedByEnv && <EnvLockIndicator envVar="SCRAPER_BASE_DELAY_MS" />}
            </div>
            <input
              type="number"
              min={250}
              max={60000}
              step={50}
              value={baseDelayMs}
              disabled={baseDelayLockedByEnv}
              onChange={(e) => setBaseDelayMs(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
            <p className="text-[11px] text-crt-muted">Starting spacing with ±15% jitter</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Minimum Delay Floor (ms)
              </label>
              {minDelayLockedByEnv && <EnvLockIndicator envVar="SCRAPER_MIN_DELAY_MS" />}
            </div>
            <input
              type="number"
              min={250}
              max={30000}
              step={50}
              value={minDelayMs}
              disabled={minDelayLockedByEnv}
              onChange={(e) => setMinDelayMs(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
            <p className="text-[11px] text-crt-muted">Fastest polite crawl interval</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Max Backoff Ceiling (ms)
              </label>
              {maxDelayLockedByEnv && <EnvLockIndicator envVar="SCRAPER_MAX_DELAY_MS" />}
            </div>
            <input
              type="number"
              min={5000}
              max={300000}
              step={1000}
              value={maxDelayMs}
              disabled={maxDelayLockedByEnv}
              onChange={(e) => setMaxDelayMs(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
            <p className="text-[11px] text-crt-muted">Upper cap during repeated 429s</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Backoff Multiplier
              </label>
              {backoffLockedByEnv && <EnvLockIndicator envVar="SCRAPER_BACKOFF_MULTIPLIER" />}
            </div>
            <input
              type="number"
              min={1.2}
              max={5.0}
              step={0.1}
              value={backoffMultiplier}
              disabled={backoffLockedByEnv}
              onChange={(e) => setBackoffMultiplier(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
            <p className="text-[11px] text-crt-muted">Multiplicative penalty factor</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Max Retries per Request
              </label>
              {maxRetriesLockedByEnv && <EnvLockIndicator envVar="SCRAPER_MAX_RETRIES" />}
            </div>
            <input
              type="number"
              min={0}
              max={15}
              value={maxRetries}
              disabled={maxRetriesLockedByEnv}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
            <p className="text-[11px] text-crt-muted">Retries on 429/5xx timeouts</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Request Timeout (ms)
              </label>
              {timeoutLockedByEnv && <EnvLockIndicator envVar="SCRAPER_REQUEST_TIMEOUT_MS" />}
            </div>
            <input
              type="number"
              min={5000}
              max={180000}
              step={1000}
              value={requestTimeoutMs}
              disabled={timeoutLockedByEnv}
              onChange={(e) => setRequestTimeoutMs(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
            <p className="text-[11px] text-crt-muted">Per-request HTTP abort timeout</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                Worker Concurrency
              </label>
              {concurrencyLockedByEnv && <EnvLockIndicator envVar="SCRAPER_MAX_CONCURRENCY" />}
            </div>
            <select
              value={maxConcurrency}
              disabled={concurrencyLockedByEnv}
              onChange={(e) => setMaxConcurrency(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            >
              <option value={1}>1 (Sequential · Safest)</option>
              <option value={2}>2 (Moderate)</option>
              <option value={3}>3 (Parallel · Higher risk)</option>
            </select>
          </div>

          <div className="md:col-span-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-crt-text">
                HTTP User-Agent Header
              </label>
              {userAgentLockedByEnv && <EnvLockIndicator envVar="SCRAPER_USER_AGENT" />}
            </div>
            <input
              type="text"
              value={userAgent}
              disabled={userAgentLockedByEnv}
              onChange={(e) => setUserAgent(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
          </div>
        </div>
      </section>

      {/* Save Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs">
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-crt-phosphor">
              <CheckCircle2 className="h-4 w-4" />
              {savedNotice}
            </span>
          )}
          {errorMsg && <span className="text-crt-crimson">{errorMsg}</span>}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save Schedule & Rate Limits'}
        </button>
      </div>
    </form>
  );
}
