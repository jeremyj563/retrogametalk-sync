import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { EphemeralNotice } from './EphemeralNotice';
import { useSectionSpotlight } from '../hooks/useSectionSpotlight';
import {
  parseAndValidateConfigBackup,
  type ParsedConfigBackupPlan,
} from '../shared/configBackup';
import {
  PACING_PROFILES,
  describeCurrentPacing,
  detectPacingProfile,
  type PacingProfileDefinition,
} from '../shared/requestPacing';
import { formatLiveReloadRunLabel } from '../shared/syncRuleMatcher';
import type {
  AuthTestResult,
  ConfigBackupImportResult,
  ConfigDirtyState,
  ConfigFocusRequest,
  ConfigPanelHandle,
  ConfigPatchPayload,
  LiveSyncReloadReceipt,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
} from '../types';
import {
  DEFAULT_MIN_FREE_DISK_GB,
  evaluateDiskSpaceGuardrail,
  formatReserveGbLabel,
  normalizeMinFreeDiskGb,
} from '../shared/diskGuardrails';
import { formatBytes } from '../utils/format';
import { readJsonSafely } from '../utils/http';
import { ConfigSaveBar } from './ConfigSaveBar';
import { EnvLockIndicator } from './EnvLockIndicator';

interface SystemSettingsPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  focusRequest?: ConfigFocusRequest | null;
  onDirtyChange?: (state: ConfigDirtyState) => void;
  onSaveConfig: (
    patch: ConfigPatchPayload,
  ) => Promise<{ liveSyncReload?: LiveSyncReloadReceipt | null } | void>;
  onRefreshConfig: () => Promise<void>;
}

export const SystemSettingsPanel = forwardRef<ConfigPanelHandle, SystemSettingsPanelProps>(
  function SystemSettingsPanel(
    {
      config,
      status,
      focusRequest = null,
      onDirtyChange,
      onSaveConfig,
      onRefreshConfig,
    },
    ref,
  ) {
    // 1. Repository Account & Local Mirror Paths state
    const [baseUrl, setBaseUrl] = useState(config.baseUrl);
    const [loginUrl, setLoginUrl] = useState(config.loginUrl);
    const [username, setUsername] = useState(config.username);
    const [passwordInput, setPasswordInput] = useState('');
    const [clearSavedPassword, setClearSavedPassword] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [downloadDir, setDownloadDir] = useState(config.downloadDir);
    const [minFreeDiskGb, setMinFreeDiskGb] = useState(
      normalizeMinFreeDiskGb(config.minFreeDiskGb, DEFAULT_MIN_FREE_DISK_GB),
    );

    // 2. Request Pacing & Rate Protection state
    const [baseDelayMs, setBaseDelayMs] = useState(config.baseDelayMs);
    const [minDelayMs, setMinDelayMs] = useState(config.minDelayMs);
    const [maxDelayMs, setMaxDelayMs] = useState(config.maxDelayMs);
    const [backoffMultiplier, setBackoffMultiplier] = useState(config.backoffMultiplier);
    const [maxRetries, setMaxRetries] = useState(config.maxRetries);
    const [maxConcurrency, setMaxConcurrency] = useState(config.maxConcurrency);
    const [downloadChunkConcurrency, setDownloadChunkConcurrency] = useState(
      config.downloadChunkConcurrency,
    );
    const [downloadChunkMinSizeMb, setDownloadChunkMinSizeMb] = useState(
      config.downloadChunkMinSizeMb,
    );
    const [requestTimeoutMs, setRequestTimeoutMs] = useState(config.requestTimeoutMs);
    const [userAgent, setUserAgent] = useState(config.userAgent);
    const [showAdvancedPacing, setShowAdvancedPacing] = useState(false);

    // 3. Configuration Backup & Restore state
    const backupFileInputRef = useRef<HTMLInputElement | null>(null);
    const [exportingBackup, setExportingBackup] = useState(false);
    const [applyingBackup, setApplyingBackup] = useState(false);
    const [backupPreview, setBackupPreview] = useState<{
      filename: string;
      rawPayload: unknown;
      plan: ParsedConfigBackupPlan;
    } | null>(null);
    const [backupNotice, setBackupNotice] = useState<string | null>(null);
    const [backupError, setBackupError] = useState<string | null>(null);

    const authSectionRef = useRef<HTMLElement | null>(null);
    const pacingSectionRef = useRef<HTMLElement | null>(null);
    const sectionRefs = useMemo(
      () => ({
        auth: authSectionRef,
        pacing: pacingSectionRef,
      }),
      [],
    );
    const spotlight = useSectionSpotlight(focusRequest, sectionRefs);

    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<string | null>(null);
    const [saveNoticeDurationMs, setSaveNoticeDurationMs] = useState<number>(3500);
    const [saveErr, setSaveErr] = useState<string | null>(null);

    const [testingAuth, setTestingAuth] = useState(false);
    const [authResult, setAuthResult] = useState<AuthTestResult | null>(null);

    const isDirtyRef = useRef(false);

    // Environment override flags
    const baseUrlLockedByEnv = config.envOverrides.includes('RGT_BASE_URL');
    const loginUrlLockedByEnv = config.envOverrides.includes('RGT_LOGIN_URL');
    const usernameLockedByEnv = config.envOverrides.includes('RGT_USERNAME');
    const passwordLockedByEnv = config.envOverrides.includes('RGT_PASSWORD');
    const dataDirLockedByEnv = config.envOverrides.includes('DATA_DIR');
    const downloadDirLockedByEnv = config.envOverrides.includes('DOWNLOAD_DIR');
    const minFreeDiskLockedByEnv = config.envOverrides.includes('SCRAPER_MIN_FREE_DISK_GB');

    const baseDelayLockedByEnv = config.envOverrides.includes('SCRAPER_BASE_DELAY_MS');
    const minDelayLockedByEnv = config.envOverrides.includes('SCRAPER_MIN_DELAY_MS');
    const maxDelayLockedByEnv = config.envOverrides.includes('SCRAPER_MAX_DELAY_MS');
    const backoffLockedByEnv = config.envOverrides.includes('SCRAPER_BACKOFF_MULTIPLIER');
    const maxRetriesLockedByEnv = config.envOverrides.includes('SCRAPER_MAX_RETRIES');
    const timeoutLockedByEnv = config.envOverrides.includes('SCRAPER_REQUEST_TIMEOUT_MS');
    const concurrencyLockedByEnv = config.envOverrides.includes('SCRAPER_MAX_CONCURRENCY');
    const chunkConcurrencyLockedByEnv = config.envOverrides.includes(
      'SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY',
    );
    const chunkThresholdLockedByEnv = config.envOverrides.includes(
      'SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB',
    );
    const userAgentLockedByEnv = config.envOverrides.includes('SCRAPER_USER_AGENT');

    const allPacingNumericLockedByEnv =
      baseDelayLockedByEnv &&
      minDelayLockedByEnv &&
      maxDelayLockedByEnv &&
      backoffLockedByEnv &&
      maxRetriesLockedByEnv &&
      timeoutLockedByEnv &&
      concurrencyLockedByEnv;

    const anyPacingLockedByEnv =
      baseDelayLockedByEnv ||
      minDelayLockedByEnv ||
      maxDelayLockedByEnv ||
      backoffLockedByEnv ||
      maxRetriesLockedByEnv ||
      timeoutLockedByEnv ||
      concurrencyLockedByEnv ||
      chunkConcurrencyLockedByEnv ||
      chunkThresholdLockedByEnv ||
      userAgentLockedByEnv;

    const resetFormToConfig = useCallback((target: ScraperConfigPublic) => {
      setBaseUrl(target.baseUrl);
      setLoginUrl(target.loginUrl);
      setUsername(target.username);
      setPasswordInput('');
      setClearSavedPassword(false);
      setDownloadDir(target.downloadDir);
      setMinFreeDiskGb(normalizeMinFreeDiskGb(target.minFreeDiskGb, DEFAULT_MIN_FREE_DISK_GB));

      setBaseDelayMs(target.baseDelayMs);
      setMinDelayMs(target.minDelayMs);
      setMaxDelayMs(target.maxDelayMs);
      setBackoffMultiplier(target.backoffMultiplier);
      setMaxRetries(target.maxRetries);
      setMaxConcurrency(target.maxConcurrency);
      setDownloadChunkConcurrency(target.downloadChunkConcurrency);
      setDownloadChunkMinSizeMb(target.downloadChunkMinSizeMb);
      setRequestTimeoutMs(target.requestTimeoutMs);
      setUserAgent(target.userAgent);
    }, []);

    useEffect(() => {
      if (!isDirtyRef.current) {
        resetFormToConfig(config);
      }
    }, [config, resetFormToConfig]);

    const currentPacingNumeric = useMemo(
      () => ({
        baseDelayMs,
        minDelayMs,
        maxDelayMs,
        backoffMultiplier,
        maxRetries,
        maxConcurrency,
        requestTimeoutMs,
      }),
      [
        baseDelayMs,
        minDelayMs,
        maxDelayMs,
        backoffMultiplier,
        maxRetries,
        maxConcurrency,
        requestTimeoutMs,
      ],
    );

    const activeProfileId = useMemo(
      () => detectPacingProfile(currentPacingNumeric),
      [currentPacingNumeric],
    );

    const pacingSummary = useMemo(
      () => describeCurrentPacing(currentPacingNumeric),
      [currentPacingNumeric],
    );

    const handleApplyPacingProfile = (profile: PacingProfileDefinition) => {
      if (allPacingNumericLockedByEnv) return;
      const v = profile.values;
      if (!minDelayLockedByEnv) setMinDelayMs(v.minDelayMs);
      if (!maxDelayLockedByEnv) setMaxDelayMs(v.maxDelayMs);
      if (!baseDelayLockedByEnv) setBaseDelayMs(v.baseDelayMs);
      if (!backoffLockedByEnv) setBackoffMultiplier(v.backoffMultiplier);
      if (!maxRetriesLockedByEnv) setMaxRetries(v.maxRetries);
      if (!concurrencyLockedByEnv) setMaxConcurrency(v.maxConcurrency);
      if (!timeoutLockedByEnv) setRequestTimeoutMs(v.requestTimeoutMs);
    };

    const normalizedDelays = useMemo(() => {
      const clampedMin = Math.max(250, Math.min(30000, Math.round(minDelayMs || 250)));
      const clampedMax = Math.max(clampedMin, Math.min(300000, Math.round(maxDelayMs || 60000)));
      const clampedBase = Math.max(clampedMin, Math.min(clampedMax, Math.round(baseDelayMs || 1500)));
      return {
        minDelayMs: clampedMin,
        maxDelayMs: clampedMax,
        baseDelayMs: clampedBase,
      };
    }, [minDelayMs, maxDelayMs, baseDelayMs]);

    const buildAccountPayload = useCallback(
      (): ConfigPatchPayload => ({
        ...(!baseUrlLockedByEnv ? { baseUrl } : {}),
        ...(!loginUrlLockedByEnv ? { loginUrl } : {}),
        ...(!usernameLockedByEnv ? { username } : {}),
        ...(!passwordLockedByEnv && clearSavedPassword
          ? { clearPassword: true }
          : !passwordLockedByEnv && passwordInput.length > 0
            ? { password: passwordInput }
            : {}),
        ...(!downloadDirLockedByEnv ? { downloadDir } : {}),
        ...(!minFreeDiskLockedByEnv
          ? { minFreeDiskGb: normalizeMinFreeDiskGb(minFreeDiskGb, DEFAULT_MIN_FREE_DISK_GB) }
          : {}),
      }),
      [
        baseUrlLockedByEnv,
        baseUrl,
        loginUrlLockedByEnv,
        loginUrl,
        usernameLockedByEnv,
        username,
        passwordLockedByEnv,
        clearSavedPassword,
        passwordInput,
        downloadDirLockedByEnv,
        downloadDir,
        minFreeDiskLockedByEnv,
        minFreeDiskGb,
      ],
    );

    const buildSavePayload = useCallback(
      () => ({
        ...buildAccountPayload(),
        ...(!minDelayLockedByEnv ? { minDelayMs: normalizedDelays.minDelayMs } : {}),
        ...(!maxDelayLockedByEnv ? { maxDelayMs: normalizedDelays.maxDelayMs } : {}),
        ...(!baseDelayLockedByEnv ? { baseDelayMs: normalizedDelays.baseDelayMs } : {}),
        ...(!backoffLockedByEnv
          ? { backoffMultiplier: Math.max(1.2, Math.min(5.0, Number(backoffMultiplier) || 2.0)) }
          : {}),
        ...(!maxRetriesLockedByEnv
          ? { maxRetries: Math.max(0, Math.min(15, Math.round(maxRetries || 0))) }
          : {}),
        ...(!concurrencyLockedByEnv ? { maxConcurrency } : {}),
        ...(!chunkConcurrencyLockedByEnv
          ? {
              downloadChunkConcurrency: Math.max(
                1,
                Math.min(4, Math.round(Number(downloadChunkConcurrency) || 1)),
              ),
            }
          : {}),
        ...(!chunkThresholdLockedByEnv
          ? {
              downloadChunkMinSizeMb: Math.max(
                4,
                Math.min(128, Math.round(Number(downloadChunkMinSizeMb) || 32)),
              ),
            }
          : {}),
        ...(!timeoutLockedByEnv
          ? { requestTimeoutMs: Math.max(5000, Math.min(180000, Math.round(requestTimeoutMs || 30000))) }
          : {}),
        ...(!userAgentLockedByEnv ? { userAgent } : {}),
      }),
      [
        buildAccountPayload,
        minDelayLockedByEnv,
        maxDelayLockedByEnv,
        baseDelayLockedByEnv,
        normalizedDelays,
        backoffLockedByEnv,
        backoffMultiplier,
        maxRetriesLockedByEnv,
        maxRetries,
        concurrencyLockedByEnv,
        maxConcurrency,
        chunkConcurrencyLockedByEnv,
        downloadChunkConcurrency,
        chunkThresholdLockedByEnv,
        downloadChunkMinSizeMb,
        timeoutLockedByEnv,
        requestTimeoutMs,
        userAgentLockedByEnv,
        userAgent,
      ],
    );

    const dirtyState = useMemo<ConfigDirtyState>(() => {
      const changedSections: string[] = [];

      const accountChanged =
        (!baseUrlLockedByEnv && baseUrl !== config.baseUrl) ||
        (!loginUrlLockedByEnv && loginUrl !== config.loginUrl) ||
        (!usernameLockedByEnv && username !== config.username) ||
        (!passwordLockedByEnv &&
          (passwordInput.length > 0 || (clearSavedPassword && config.hasPassword))) ||
        (!downloadDirLockedByEnv && downloadDir !== config.downloadDir) ||
        (!minFreeDiskLockedByEnv &&
          Math.abs(
            normalizeMinFreeDiskGb(minFreeDiskGb, DEFAULT_MIN_FREE_DISK_GB) -
              normalizeMinFreeDiskGb(config.minFreeDiskGb, DEFAULT_MIN_FREE_DISK_GB),
          ) >= 0.05);
      if (accountChanged) changedSections.push('Account & Paths');

      const pacingChanged =
        (!baseDelayLockedByEnv && baseDelayMs !== config.baseDelayMs) ||
        (!minDelayLockedByEnv && minDelayMs !== config.minDelayMs) ||
        (!maxDelayLockedByEnv && maxDelayMs !== config.maxDelayMs) ||
        (!backoffLockedByEnv &&
          Math.abs(Number(backoffMultiplier) - config.backoffMultiplier) >= 0.001) ||
        (!maxRetriesLockedByEnv && maxRetries !== config.maxRetries) ||
        (!concurrencyLockedByEnv && maxConcurrency !== config.maxConcurrency) ||
        (!chunkConcurrencyLockedByEnv &&
          Math.max(1, Math.min(4, Math.round(Number(downloadChunkConcurrency) || 1))) !==
            config.downloadChunkConcurrency) ||
        (!chunkThresholdLockedByEnv &&
          Math.max(4, Math.min(128, Math.round(Number(downloadChunkMinSizeMb) || 32))) !==
            config.downloadChunkMinSizeMb) ||
        (!timeoutLockedByEnv && requestTimeoutMs !== config.requestTimeoutMs) ||
        (!userAgentLockedByEnv && userAgent !== config.userAgent);
      if (pacingChanged) changedSections.push('Request Pacing');

      return {
        isDirty: changedSections.length > 0,
        changedSections,
      };
    }, [
      config,
      baseUrlLockedByEnv,
      baseUrl,
      loginUrlLockedByEnv,
      loginUrl,
      usernameLockedByEnv,
      username,
      passwordLockedByEnv,
      passwordInput,
      clearSavedPassword,
      downloadDirLockedByEnv,
      downloadDir,
      minFreeDiskLockedByEnv,
      minFreeDiskGb,
      baseDelayLockedByEnv,
      baseDelayMs,
      minDelayLockedByEnv,
      minDelayMs,
      maxDelayLockedByEnv,
      maxDelayMs,
      backoffLockedByEnv,
      backoffMultiplier,
      maxRetriesLockedByEnv,
      maxRetries,
      concurrencyLockedByEnv,
      maxConcurrency,
      chunkConcurrencyLockedByEnv,
      downloadChunkConcurrency,
      chunkThresholdLockedByEnv,
      downloadChunkMinSizeMb,
      timeoutLockedByEnv,
      requestTimeoutMs,
      userAgentLockedByEnv,
      userAgent,
    ]);

    isDirtyRef.current = dirtyState.isDirty;

    useEffect(() => {
      onDirtyChange?.(dirtyState);
    }, [dirtyState, onDirtyChange]);

    useEffect(() => {
      return () => {
        onDirtyChange?.({ isDirty: false, changedSections: [] });
      };
    }, [onDirtyChange]);

    useEffect(() => {
      if (dirtyState.isDirty && saveMsg) {
        setSaveMsg(null);
      }
    }, [dirtyState.isDirty, saveMsg]);

    const saveConfiguration = useCallback(async (): Promise<boolean> => {
      setSaving(true);
      setSaveMsg(null);
      setSaveErr(null);
      try {
        const saveResult = await onSaveConfig(buildSavePayload());
        isDirtyRef.current = false;
        setPasswordInput('');
        setClearSavedPassword(false);
        const liveReceipt =
          saveResult && 'liveSyncReload' in saveResult ? saveResult.liveSyncReload : null;
        if (liveReceipt?.applied) {
          const runLabel = formatLiveReloadRunLabel(liveReceipt);
          const detail = liveReceipt.changeSummary ? ` (${liveReceipt.changeSummary})` : '';
          setSaveNoticeDurationMs(6000);
          setSaveMsg(
            `System Settings saved — applied live to active ${runLabel} #${liveReceipt.runId}${detail}`,
          );
        } else {
          setSaveNoticeDurationMs(3500);
          setSaveMsg('System Settings saved');
        }
        return true;
      } catch (err) {
        setSaveErr(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSaving(false);
      }
    }, [onSaveConfig, buildSavePayload]);

    const discardChanges = useCallback(() => {
      resetFormToConfig(config);
      setSaveMsg(null);
      setSaveErr(null);
    }, [config, resetFormToConfig]);

    useImperativeHandle(
      ref,
      () => ({
        save: saveConfiguration,
        discard: discardChanges,
      }),
      [saveConfiguration, discardChanges],
    );

    const handleTestAuth = async () => {
      setTestingAuth(true);
      setAuthResult(null);
      setSaveMsg(null);
      setSaveErr(null);
      try {
        await onSaveConfig(buildSavePayload());
        isDirtyRef.current = false;
        setPasswordInput('');
        setClearSavedPassword(false);
        const res = await fetch('/api/auth/test', {
          method: 'POST',
          headers: { 'X-Requested-With': 'rgt-sync' },
        });
        const parsed = await readJsonSafely<AuthTestResult>(res);
        if (parsed.data && typeof parsed.data.message === 'string') {
          setAuthResult(parsed.data);
        } else {
          setAuthResult({
            success: false,
            statusCode: parsed.status || null,
            authenticated: false,
            cookieCount: 0,
            discoveredSystems: [],
            sampleReleaseUrls: [],
            message: parsed.errorMessage || `Auth probe failed (HTTP ${res.status})`,
            latencyMs: 0,
          });
        }
        await onRefreshConfig();
      } catch (err) {
        setAuthResult({
          success: false,
          statusCode: null,
          authenticated: false,
          cookieCount: 0,
          discoveredSystems: [],
          sampleReleaseUrls: [],
          message: err instanceof Error ? err.message : String(err),
          latencyMs: 0,
        });
      } finally {
        setTestingAuth(false);
      }
    };

    const handleExportBackup = async () => {
      setExportingBackup(true);
      setBackupError(null);
      setBackupNotice(null);
      try {
        const res = await fetch('/api/backup/export');
        if (!res.ok) {
          throw new Error(`Backup export failed (HTTP ${res.status})`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const fallbackDate = new Date().toISOString().slice(0, 10);
        const filename = match?.[1] || `rgt-sync-backup-${fallbackDate}.json`;

        const objectUrl = URL.createObjectURL(blob);
        try {
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        setBackupNotice(`Downloaded secret-free backup: ${filename}`);
      } catch (err) {
        setBackupError(err instanceof Error ? err.message : String(err));
      } finally {
        setExportingBackup(false);
      }
    };

    const handleSelectBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      setBackupError(null);
      setBackupNotice(null);
      setBackupPreview(null);

      try {
        const text = await file.text();
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(text);
        } catch {
          setBackupError(`"${file.name}" is not valid JSON.`);
          return;
        }

        const validation = parseAndValidateConfigBackup(parsedJson, config);
        if (!validation.valid) {
          setBackupError(validation.error);
          return;
        }

        setBackupPreview({
          filename: file.name,
          rawPayload: parsedJson,
          plan: validation,
        });
      } catch (err) {
        setBackupError(err instanceof Error ? err.message : 'Unable to read backup file.');
      }
    };

    const handleApplyBackup = async () => {
      if (!backupPreview || applyingBackup) return;
      setApplyingBackup(true);
      setBackupError(null);
      setBackupNotice(null);
      try {
        const res = await fetch('/api/backup/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'rgt-sync',
          },
          body: JSON.stringify(backupPreview.rawPayload),
        });
        const parsed = await readJsonSafely<ConfigBackupImportResult & { error?: string }>(res);
        if (!parsed.ok || !parsed.data?.ok) {
          throw new Error(parsed.data?.error || parsed.errorMessage || `Import failed (HTTP ${res.status})`);
        }
        isDirtyRef.current = false;
        resetFormToConfig(parsed.data.config);
        await onRefreshConfig();

        const appliedCount = parsed.data.appliedFields.length;
        const skippedCount = parsed.data.skippedEnvLocked.length;
        const skipSuffix =
          skippedCount > 0 ? ` (${skippedCount} env-locked field${skippedCount === 1 ? '' : 's'} skipped)` : '';
        setBackupNotice(
          appliedCount > 0
            ? `Applied ${appliedCount} setting${appliedCount === 1 ? '' : 's'} from ${backupPreview.filename}${skipSuffix}.`
            : `No changes needed — active configuration already matches ${backupPreview.filename}${skipSuffix}.`,
        );
        setBackupPreview(null);
      } catch (err) {
        setBackupError(err instanceof Error ? err.message : String(err));
      } finally {
        setApplyingBackup(false);
      }
    };

    const activeProfileDisplayLabel =
      activeProfileId === 'custom'
        ? 'Custom Tuning'
        : PACING_PROFILES.find((p) => p.id === activeProfileId)?.label ?? 'Balanced';

    const liveReloadHint =
      status.activeRun && dirtyState.changedSections.includes('Request Pacing')
        ? `Active ${formatLiveReloadRunLabel(status.activeRun)} #${status.activeRun.id} running — saved pacing, concurrency, chunk, timeout & retry changes will apply live immediately.`
        : null;

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveConfiguration();
        }}
        className="space-y-6 max-w-5xl"
      >
        {/* 1. Repository Account & Local Mirror Paths */}
        <section
          ref={authSectionRef}
          className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {spotlight?.target === 'auth' && (
            <div
              key={`auth-${spotlight.nonce}`}
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
            />
          )}

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Repository Account &amp; Local Mirror Paths
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Credentials entered here are encrypted with AES-256-GCM in SQLite, or locked to RGT_USERNAME / RGT_PASSWORD environment variables when provided.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={testingAuth}
              onClick={() => void handleTestAuth()}
              className="crt-cta-beam inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{testingAuth ? 'Probing Repository...' : 'Test Login & Discover Consoles'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-crt-text">Repository Base URL</label>
                {baseUrlLockedByEnv && <EnvLockIndicator envVar="RGT_BASE_URL" />}
              </div>
              <input
                type="url"
                value={baseUrl}
                disabled={baseUrlLockedByEnv}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-crt-text">Login Endpoint URL</label>
                {loginUrlLockedByEnv && <EnvLockIndicator envVar="RGT_LOGIN_URL" />}
              </div>
              <input
                type="url"
                value={loginUrl}
                disabled={loginUrlLockedByEnv}
                onChange={(e) => setLoginUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-crt-text">Repository Username</label>
                {usernameLockedByEnv && <EnvLockIndicator envVar="RGT_USERNAME" />}
              </div>
              <input
                type="text"
                value={username}
                disabled={usernameLockedByEnv}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="RetroGameTalk account username"
                className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-70"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-crt-text">Repository Password</label>
                {passwordLockedByEnv && (
                  <EnvLockIndicator
                    envVar="RGT_PASSWORD"
                    detail="Loaded from the RGT_PASSWORD environment variable. Update or unset it in your .env, Compose, or Helm configuration to change it — for security, the value stays strictly on the server and cannot be revealed in the UI."
                  />
                )}
              </div>
              <div className="relative">
                <input
                  type={!passwordLockedByEnv && passwordInput.length > 0 && showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={passwordLockedByEnv ? '••••••••••••••' : passwordInput}
                  disabled={passwordLockedByEnv}
                  title={
                    passwordLockedByEnv
                      ? 'Controlled by RGT_PASSWORD environment variable (read-only)'
                      : undefined
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    setPasswordInput(next);
                    if (next.length === 0) {
                      setShowPassword(false);
                    }
                    if (clearSavedPassword && next.length > 0) {
                      setClearSavedPassword(false);
                    }
                  }}
                  placeholder={
                    passwordLockedByEnv
                      ? undefined
                      : clearSavedPassword
                        ? 'Saved password will be cleared when you save'
                        : config.hasPassword
                          ? 'Saved on server — enter a new password to replace'
                          : 'Enter repository password'
                  }
                  className={`w-full pl-3 ${!passwordLockedByEnv && passwordInput.length > 0 ? 'pr-10' : 'pr-3'} py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-70`}
                />
                {!passwordLockedByEnv && passwordInput.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-crt-muted hover:text-crt-phosphor transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {!passwordLockedByEnv && (
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className={clearSavedPassword ? 'text-crt-amber' : 'text-crt-muted'}>
                    {clearSavedPassword
                      ? 'Marked for removal on Save'
                      : passwordInput.length > 0
                        ? 'New password staged — save to replace stored secret'
                        : config.hasPassword
                          ? 'Stored encrypted on server (never transmitted back to browser)'
                          : 'Not set yet'}
                  </span>
                  {config.hasPassword && passwordInput.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setClearSavedPassword((v) => !v)}
                      title={
                        clearSavedPassword
                          ? 'Keep the currently saved repository password'
                          : 'Remove the saved repository password on next save'
                      }
                      className={`inline-flex items-center gap-1 underline transition-colors cursor-pointer shrink-0 ${
                        clearSavedPassword
                          ? 'text-crt-phosphor hover:text-crt-text'
                          : 'text-crt-muted hover:text-crt-crimson'
                      }`}
                    >
                      {!clearSavedPassword && <Trash2 className="h-3 w-3" />}
                      <span>{clearSavedPassword ? 'Keep saved' : 'Clear'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-crt-text">
                  Data Directory (SQLite &amp; Sessions)
                </label>
                {dataDirLockedByEnv && <EnvLockIndicator envVar="DATA_DIR" />}
              </div>
              <input
                type="text"
                value={config.dataDir}
                disabled
                className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none disabled:opacity-70"
              />
              {!dataDirLockedByEnv && (
                <p className="text-[11px] font-mono text-crt-muted">
                  Default /run/repo (configurable via DATA_DIR environment variable).
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-crt-text">
                  Local Filesystem Mirror Root
                </label>
                {downloadDirLockedByEnv && <EnvLockIndicator envVar="DOWNLOAD_DIR" />}
              </div>
              <input
                type="text"
                value={downloadDir}
                disabled={downloadDirLockedByEnv}
                onChange={(e) => setDownloadDir(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-70"
              />
              <p className="text-[11px] font-mono text-crt-muted tabular-nums">
                Status: {status.storage.writable ? 'Writable' : 'Read-Only'} ·{' '}
                {formatBytes(status.storage.totalBytesOnDisk)} mirrored across{' '}
                {status.storage.totalFilesOnDisk} files
              </p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="system-min-free-disk-gb"
                  className="text-xs font-medium text-crt-text"
                >
                  Minimum Free Disk Space Reserve (GB)
                </label>
                {minFreeDiskLockedByEnv && <EnvLockIndicator envVar="SCRAPER_MIN_FREE_DISK_GB" />}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="system-min-free-disk-gb"
                  type="number"
                  min={0}
                  max={10000}
                  step={0.5}
                  value={minFreeDiskGb}
                  disabled={minFreeDiskLockedByEnv}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    setMinFreeDiskGb(
                      Number.isFinite(parsed) && parsed >= 0 ? Math.min(10000, parsed) : 0,
                    );
                  }}
                  className="w-36 px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-70 tabular-nums"
                />
                {(() => {
                  const evalRes = evaluateDiskSpaceGuardrail({
                    diskFreeBytes: status.storage.diskFreeBytes,
                    estimatedBytes: 0,
                    minFreeDiskGb,
                  });
                  if (!evalRes.checked || evalRes.diskFreeBytes === null) {
                    return (
                      <span className="text-[11px] font-mono text-crt-muted">
                        Warns before queueing oversized batches and pauses active downloads if free space drops below{' '}
                        {formatReserveGbLabel(minFreeDiskGb)} (set 0 to disable).
                      </span>
                    );
                  }
                  return (
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        evalRes.belowReserveNow ? 'text-crt-amber' : 'text-crt-muted'
                      }`}
                    >
                      {evalRes.belowReserveNow
                        ? `Below reserve now: ${formatBytes(evalRes.diskFreeBytes)} free on volume (${formatReserveGbLabel(evalRes.reserveGb)} safety floor).`
                        : `${formatBytes(evalRes.diskFreeBytes)} free on volume · ${formatBytes(evalRes.usableBytes ?? 0)} usable after ${formatReserveGbLabel(evalRes.reserveGb)} safety reserve${
                            evalRes.reserveBytes === 0 ? ' (guardrail disabled)' : ''
                          }.`}
                    </span>
                  );
                })()}
              </div>
              <p className="text-[11px] font-mono text-crt-muted">
                Default 2 GB (overridable via SCRAPER_MIN_FREE_DISK_GB). Warns in Catalog &amp; Monitor pre-flight checks and pauses active transfers gracefully before filling the mirror volume.
              </p>
            </div>
          </div>

          {authResult && (
            <div
              className={`border rounded p-4 space-y-2 text-xs font-mono ${
                authResult.success
                  ? 'border-crt-phosphor/40 bg-crt-phosphor/5 text-crt-text'
                  : 'border-crt-crimson/40 bg-crt-crimson/5 text-crt-text'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <span className="inline-flex items-start gap-2 font-semibold break-words min-w-0">
                  {authResult.success ? (
                    <CheckCircle2 className="h-4 w-4 text-crt-phosphor shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-4 w-4 text-crt-crimson shrink-0 mt-0.5" />
                  )}
                  <span className="break-words">{authResult.message}</span>
                </span>
                <span className="text-crt-muted tabular-nums shrink-0">
                  {authResult.latencyMs}ms · {authResult.cookieCount} cookies
                </span>
              </div>
            </div>
          )}
        </section>

        {/* 2. Request Pacing & Rate Protection */}
        <section
          ref={pacingSectionRef}
          className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {spotlight?.target === 'pacing' && (
            <div
              key={`pacing-${spotlight.nonce}`}
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
            />
          )}

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
            <div className="flex items-start gap-3">
              <Gauge className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Request Pacing &amp; Rate Protection
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Choose how politely RetroGameTalk Sync spaces page requests. Every profile automatically slows down and waits if the site signals busy traffic, then recovers smoothly once pages respond cleanly.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1 text-xs font-mono text-crt-text tabular-nums shrink-0">
              <div>
                Profile:{' '}
                <span
                  className={
                    activeProfileId === 'custom' ? 'text-crt-amber' : 'text-crt-phosphor'
                  }
                >
                  {activeProfileDisplayLabel}
                </span>
              </div>
              {anyPacingLockedByEnv && (
                <span className="text-[11px] text-crt-amber">
                  1+ parameters locked by ENV (see Advanced)
                </span>
              )}
            </div>
          </div>

          {/* 3 Friendly Crawl Speed Profile Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {PACING_PROFILES.map((profile) => {
              const active = activeProfileId === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  disabled={allPacingNumericLockedByEnv}
                  onClick={() => handleApplyPacingProfile(profile)}
                  className={`p-4 text-left border rounded-md transition-colors duration-200 flex flex-col justify-between gap-3 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${
                    active
                      ? 'border-crt-phosphor bg-crt-phosphor/10'
                      : 'border-crt-border bg-crt-bg hover:border-crt-border-strong'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`font-display text-sm font-semibold ${
                              active ? 'text-crt-phosphor' : 'text-crt-text'
                            }`}
                          >
                            {profile.label}
                          </span>
                          {profile.recommended && (
                            <span className="text-[11px] font-mono text-crt-muted">
                              · Recommended
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-crt-muted tabular-nums">
                          {profile.rateLabel} · {profile.tagline}
                        </div>
                      </div>

                      <span
                        aria-hidden="true"
                        className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                          active
                            ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                            : 'border-crt-border bg-crt-surface'
                        }`}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                    </div>

                    <p className="text-xs text-crt-muted leading-relaxed">{profile.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Plain-English Active Behavior Summary Strip */}
          <div className="border border-crt-border bg-crt-bg rounded px-4 py-3 text-xs font-mono text-crt-muted tabular-nums flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-crt-text">{pacingSummary.spacingSummary}</span>
            <span aria-hidden="true">·</span>
            <span>{pacingSummary.workersSummary}</span>
            <span aria-hidden="true">·</span>
            <span>
              {downloadChunkConcurrency > 1
                ? `${downloadChunkConcurrency}x Range chunks (≥${downloadChunkMinSizeMb} MiB) + resume`
                : 'Single-stream downloads + resume'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{pacingSummary.cooldownSummary}</span>
          </div>

          {/* Smooth Collapsible Advanced Network & Retry Tuning */}
          <div className="border-t border-crt-border pt-3">
            <button
              type="button"
              aria-expanded={showAdvancedPacing}
              onClick={() => setShowAdvancedPacing((v) => !v)}
              className="w-full flex items-center justify-between gap-3 text-left text-xs text-crt-muted hover:text-crt-text transition-colors cursor-pointer"
            >
              <span className="font-medium">
                Advanced Network &amp; Retry Tuning
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums shrink-0">
                <span>
                  {activeProfileId === 'custom' ? 'Custom values active' : `${activeProfileDisplayLabel} defaults`}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${
                    showAdvancedPacing ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </button>

            <div
              aria-hidden={!showAdvancedPacing}
              inert={!showAdvancedPacing || undefined}
              data-open={showAdvancedPacing ? 'true' : 'false'}
              className={`crt-accordion-grid transition-opacity duration-250 motion-reduce:transition-none ${
                showAdvancedPacing ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="crt-accordion-inner">
                <div className="pt-4 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Starting Request Spacing (ms)
                        </label>
                        {baseDelayLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_BASE_DELAY_MS" />
                        )}
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
                      <p className="text-[11px] text-crt-muted">
                        Initial pause between requests (±15% natural jitter)
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Fastest Clean-Streak Spacing (ms)
                        </label>
                        {minDelayLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_MIN_DELAY_MS" />
                        )}
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
                      <p className="text-[11px] text-crt-muted">
                        Shortest interval reached when responses stay healthy
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Max Busy-Server Cooldown (ms)
                        </label>
                        {maxDelayLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_MAX_DELAY_MS" />
                        )}
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
                      <p className="text-[11px] text-crt-muted">
                        Maximum wait cap during repeated HTTP 429 signals
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Busy-Signal Slowdown Factor
                        </label>
                        {backoffLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_BACKOFF_MULTIPLIER" />
                        )}
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
                      <p className="text-[11px] text-crt-muted">
                        How sharply spacing increases when rate-limited (e.g. 2.0x)
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Automatic Retries per Request
                        </label>
                        {maxRetriesLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_MAX_RETRIES" />
                        )}
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
                      <p className="text-[11px] text-crt-muted">
                        Retry attempts on temporary HTTP 429/5xx or timeouts
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Request Timeout (ms)
                        </label>
                        {timeoutLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_REQUEST_TIMEOUT_MS" />
                        )}
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
                      <p className="text-[11px] text-crt-muted">
                        Abort threshold for unresponsive page requests
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-1">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          Parallel File &amp; Page Workers
                        </label>
                        {concurrencyLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_MAX_CONCURRENCY" />
                        )}
                      </div>
                      <select
                        value={maxConcurrency}
                        disabled={concurrencyLockedByEnv}
                        onChange={(e) => setMaxConcurrency(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      >
                        <option value={1}>1 (Sequential · Safest)</option>
                        <option value={2}>2 (Moderate)</option>
                        <option value={3}>3 (Parallel · Higher load)</option>
                      </select>
                      <p className="text-[11px] text-crt-muted">
                        Concurrent release pages and archive downloads
                      </p>
                    </div>

                    <div className="md:col-span-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-crt-text">
                          HTTP User-Agent Header
                        </label>
                        {userAgentLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_USER_AGENT" />
                        )}
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-crt-border/60">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="download-chunk-concurrency"
                          className="text-xs font-medium text-crt-text"
                        >
                          Connections per Large File (HTTP Range)
                        </label>
                        {chunkConcurrencyLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY" />
                        )}
                      </div>
                      <select
                        id="download-chunk-concurrency"
                        value={downloadChunkConcurrency}
                        disabled={chunkConcurrencyLockedByEnv}
                        onChange={(e) => setDownloadChunkConcurrency(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      >
                        <option value={1}>1 (Recommended · Single stream — Safe for RGT)</option>
                        <option value={2}>2 (Experimental · May trigger mirror 503)</option>
                        <option value={3}>3 (Aggressive · High mirror 503 risk)</option>
                        <option value={4}>4 (Max · Not recommended for RGT mirrors)</option>
                      </select>
                      <p className="text-[11px] text-crt-muted">
                        RGT download mirrors enforce strict concurrent connection limits (/503.html); steps straight to 1x if throttled without inflating API pacing
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="download-chunk-threshold"
                          className="text-xs font-medium text-crt-text"
                        >
                          Multi-Chunk Size Threshold (MiB)
                        </label>
                        {chunkThresholdLockedByEnv && (
                          <EnvLockIndicator envVar="SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB" />
                        )}
                      </div>
                      <input
                        id="download-chunk-threshold"
                        type="number"
                        min={4}
                        max={128}
                        step={4}
                        value={downloadChunkMinSizeMb}
                        disabled={chunkThresholdLockedByEnv}
                        onChange={(e) => setDownloadChunkMinSizeMb(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      />
                      <p className="text-[11px] text-crt-muted">
                        ROMs at or below this size finish in 1 stream; larger archives split when multi-chunk is enabled (4–128 MiB; default 32 MiB)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Configuration Backup & Restore */}
        <section className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
            <div className="flex items-start gap-3">
              <Archive className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Configuration Backup &amp; Restore
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Export a portable JSON snapshot of your Mirror URLs, Sync Rules, schedule, request pacing, ROM naming template, and console folder mappings. Passwords, usernames, session cookies, and local disk paths are always excluded.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={exportingBackup}
                onClick={() => void handleExportBackup()}
                title="Download a secret-free JSON backup of your Sync Rules, pacing, and folder mappings"
                className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{exportingBackup ? 'Exporting...' : 'Export Settings Backup (.json)'}</span>
              </button>

              <button
                type="button"
                disabled={applyingBackup}
                onClick={() => backupFileInputRef.current?.click()}
                title="Load a RetroGameTalk Sync JSON backup file and preview changes before applying"
                className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border border-crt-border-strong bg-crt-bg text-crt-text hover:border-crt-phosphor hover:text-crt-phosphor rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Import Settings Backup</span>
              </button>

              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleSelectBackupFile(e)}
                className="hidden"
              />
            </div>
          </div>

          <EphemeralNotice
            message={backupError}
            tone="crimson"
            icon={<XCircle className="h-4 w-4 text-crt-crimson" />}
            onDismiss={() => setBackupError(null)}
            surfaceClassName="px-4 py-3 items-start"
          />

          <EphemeralNotice
            message={backupNotice}
            tone="phosphor"
            autoDismissMs={6000}
            icon={<CheckCircle2 className="h-4 w-4 text-crt-phosphor" />}
            onDismiss={() => setBackupNotice(null)}
            surfaceClassName="px-4 py-3 items-start text-crt-text"
          />

          {backupPreview && (
            <div className="border border-crt-border-strong bg-crt-bg rounded-md p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-crt-border pb-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-xs font-display font-semibold text-crt-text truncate">
                    Preview Import: {backupPreview.filename}
                  </div>
                  <div className="text-[11px] font-mono text-crt-muted tabular-nums">
                    v{backupPreview.plan.snapshot.appVersion} · Exported{' '}
                    {backupPreview.plan.snapshot.exportedAt.slice(0, 10)} ·{' '}
                    {backupPreview.plan.summaryTags.join(' · ')}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={applyingBackup}
                    onClick={() => setBackupPreview(null)}
                    className="px-3 py-1.5 text-xs font-mono text-crt-muted hover:text-crt-text border border-crt-border rounded transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={applyingBackup || backupPreview.plan.changes.length === 0}
                    onClick={() => void handleApplyBackup()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-display font-semibold border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25 rounded transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>
                      {applyingBackup
                        ? 'Applying...'
                        : `Apply Backup (${backupPreview.plan.changes.length})`}
                    </span>
                  </button>
                </div>
              </div>

              {backupPreview.plan.changes.length === 0 ? (
                <p className="text-xs font-mono text-crt-muted">
                  This backup matches your current active configuration — no changes need to be applied.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {backupPreview.plan.changes.map((change) => (
                    <div
                      key={change.field}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-mono py-1 border-b border-crt-border/40 last:border-b-0"
                    >
                      <span className="text-crt-text">
                        <span className="text-crt-muted">[{change.section}]</span> {change.label}
                      </span>
                      <span className="text-crt-muted tabular-nums">
                        {change.from} <span className="text-crt-phosphor">→</span>{' '}
                        <span className="text-crt-text">{change.to}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {backupPreview.plan.skippedEnvLocked.length > 0 && (
                <div className="border border-crt-amber/40 bg-crt-amber/8 rounded px-3 py-2 text-[11px] font-mono text-crt-amber flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Skipped because locked by environment variables:{' '}
                    {backupPreview.plan.skippedEnvLocked.map((item) => item.envVar).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        <ConfigSaveBar
          ariaLabel="System Settings configuration save actions"
          dirtyState={dirtyState}
          saving={saving}
          saveMsg={saveMsg}
          saveErr={saveErr}
          saveNoticeDurationMs={saveNoticeDurationMs}
          onDismissSaveMsg={() => setSaveMsg(null)}
          infoHint={liveReloadHint}
          onDiscard={discardChanges}
        />
      </form>
    );
  },
);
