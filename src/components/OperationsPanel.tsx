import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Gamepad2,
  KeyRound,
  Save,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { AuthTestResult, ScraperConfigPublic, ServiceStatusSnapshot } from '../types';
import { formatBytes } from '../utils/format';

interface OperationsPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  onSaveConfig: (patch: Partial<ScraperConfigPublic> & { password?: string }) => Promise<void>;
  onRefreshConfig: () => Promise<void>;
}

export function OperationsPanel({
  config,
  status,
  onSaveConfig,
  onRefreshConfig,
}: OperationsPanelProps) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [loginUrl, setLoginUrl] = useState(config.loginUrl);
  const [username, setUsername] = useState(config.username);
  const [password, setPassword] = useState(config.password);
  const [showPassword, setShowPassword] = useState(false);
  const [downloadDir, setDownloadDir] = useState(config.downloadDir);
  const [systemFilter, setSystemFilter] = useState(config.systemFilter);
  const [consoleSearch, setConsoleSearch] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [testingAuth, setTestingAuth] = useState(false);
  const [authResult, setAuthResult] = useState<AuthTestResult | null>(null);

  const usernameLockedByEnv = config.envOverrides.includes('RGT_USERNAME');
  const passwordLockedByEnv = config.envOverrides.includes('RGT_PASSWORD');
  const dataDirLockedByEnv = config.envOverrides.includes('DATA_DIR');
  const downloadDirLockedByEnv = config.envOverrides.includes('DOWNLOAD_DIR');
  const filterLockedByEnv = config.envOverrides.includes('SCRAPER_SYSTEM_FILTER');

  useEffect(() => {
    setBaseUrl(config.baseUrl);
    setLoginUrl(config.loginUrl);
    setUsername(config.username);
    setPassword(config.password);
    setDownloadDir(config.downloadDir);
    setSystemFilter(config.systemFilter);
  }, [config]);

  const selectedSystems = useMemo(() => {
    return new Set(
      systemFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [systemFilter]);

  const availableSystems = useMemo(() => {
    const merged = new Set<string>([
      ...config.discoveredSystems,
      ...(authResult?.discoveredSystems || []),
      ...Array.from(selectedSystems),
    ]);
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [config.discoveredSystems, authResult, selectedSystems]);

  const filteredConsoles = useMemo(() => {
    const q = consoleSearch.trim().toLowerCase();
    if (!q) return availableSystems;
    return availableSystems.filter((s) => s.toLowerCase().includes(q));
  }, [availableSystems, consoleSearch]);

  const toggleConsole = (slug: string) => {
    if (filterLockedByEnv) return;
    const next = new Set(selectedSystems);
    if (next.has(slug)) {
      next.delete(slug);
    } else {
      next.add(slug);
    }
    setSystemFilter(Array.from(next).sort((a, b) => a.localeCompare(b)).join(','));
  };

  const handleSelectAllConsoles = () => {
    if (filterLockedByEnv) return;
    setSystemFilter(availableSystems.join(','));
  };

  const handleClearConsoleFilter = () => {
    if (filterLockedByEnv) return;
    setSystemFilter('');
  };

  const buildSavePayload = () => ({
    ...(!config.envOverrides.includes('RGT_BASE_URL') ? { baseUrl } : {}),
    ...(!config.envOverrides.includes('RGT_LOGIN_URL') ? { loginUrl } : {}),
    ...(!usernameLockedByEnv ? { username } : {}),
    ...(!passwordLockedByEnv ? { password } : {}),
    ...(!downloadDirLockedByEnv ? { downloadDir } : {}),
    ...(!filterLockedByEnv ? { systemFilter } : {}),
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    setSaveErr(null);
    try {
      await onSaveConfig(buildSavePayload());
      setSaveMsg('Credentials, storage path, and console preferences saved');
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTestAuth = async () => {
    setTestingAuth(true);
    setAuthResult(null);
    setSaveMsg(null);
    setSaveErr(null);
    try {
      // Save any typed credentials/URLs prior to testing unless locked by env
      await onSaveConfig(buildSavePayload());
      const res = await fetch('/api/auth/test', { method: 'POST' });
      const data = (await res.json()) as AuthTestResult;
      setAuthResult(data);
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

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-6 max-w-5xl">
      {/* Credentials & Local Filesystem Storage Form */}
      <section className="border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <KeyRound className="h-5 w-5 text-crt-phosphor mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Repository Credentials &amp; Local Mirror Path
              </h2>
              <p className="text-xs text-crt-muted">
                Credentials entered here are encrypted with AES-256-GCM in SQLite, or locked to RGT_USERNAME / RGT_PASSWORD environment variables when provided.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={testingAuth}
            onClick={() => void handleTestAuth()}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {testingAuth ? 'Probing Repository...' : 'Test Login & Discover Consoles'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">Repository Base URL</label>
            <input
              type="url"
              value={baseUrl}
              disabled={config.envOverrides.includes('RGT_BASE_URL')}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">Login Endpoint URL</label>
            <input
              type="url"
              value={loginUrl}
              disabled={config.envOverrides.includes('RGT_LOGIN_URL')}
              onChange={(e) => setLoginUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">Repository Username</label>
            <input
              type="text"
              value={username}
              disabled={usernameLockedByEnv}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="RetroGameTalk account username"
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-70"
            />
            {usernameLockedByEnv && (
              <p className="text-[11px] font-mono text-crt-amber">
                Loaded from RGT_USERNAME environment variable (read-only).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">
              Repository Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                disabled={passwordLockedByEnv}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter repository password"
                className="w-full pl-3 pr-10 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-70"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-crt-muted hover:text-crt-phosphor transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordLockedByEnv ? (
              <p className="text-[11px] font-mono text-crt-amber">
                Loaded from RGT_PASSWORD environment variable (read-only).
              </p>
            ) : (
              <p className="text-[11px] font-mono text-crt-muted">
                {config.hasPassword ? 'Persisted encrypted in SQLite' : 'Not set yet'}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">
              Data Directory (SQLite &amp; Sessions)
            </label>
            <input
              type="text"
              value={config.dataDir}
              disabled
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none disabled:opacity-70"
            />
            {dataDirLockedByEnv ? (
              <p className="text-[11px] font-mono text-crt-amber">
                Loaded from DATA_DIR environment variable (read-only).
              </p>
            ) : (
              <p className="text-[11px] font-mono text-crt-muted">
                Default /run/repo (configurable via DATA_DIR environment variable).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">
              Local Filesystem Mirror Root
            </label>
            <input
              type="text"
              value={downloadDir}
              disabled={downloadDirLockedByEnv}
              onChange={(e) => setDownloadDir(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-70"
            />
            {downloadDirLockedByEnv ? (
              <p className="text-[11px] font-mono text-crt-amber">
                Loaded from DOWNLOAD_DIR environment variable (read-only).
              </p>
            ) : (
              <p className="text-[11px] font-mono text-crt-muted">
                Status: {status.storage.writable ? 'Writable' : 'Read-Only'} · {formatBytes(status.storage.totalBytesOnDisk)} mirrored across {status.storage.totalFilesOnDisk} files
              </p>
            )}
          </div>
        </div>

        {/* Auth Probe Diagnostic Result */}
        {authResult && (
          <div
            className={`border rounded p-4 space-y-2 text-xs font-mono ${
              authResult.success
                ? 'border-crt-phosphor/40 bg-crt-phosphor/5 text-crt-text'
                : 'border-crt-crimson/40 bg-crt-crimson/5 text-crt-text'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 font-semibold">
                {authResult.success ? (
                  <CheckCircle2 className="h-4 w-4 text-crt-phosphor" />
                ) : (
                  <XCircle className="h-4 w-4 text-crt-crimson" />
                )}
                {authResult.message}
              </span>
              <span className="text-crt-muted tabular-nums">
                {authResult.latencyMs}ms · {authResult.cookieCount} cookies
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Console / System Selection Section */}
      <section className="border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <Gamepad2 className="h-5 w-5 text-crt-phosphor mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Target Consoles &amp; Systems
              </h2>
              <p className="text-xs text-crt-muted">
                Choose specific systems to mirror, or leave none selected to mirror the entire repository. Selection persists in SQLite across restarts.
              </p>
            </div>
          </div>

          <div className="text-xs font-mono text-crt-text tabular-nums">
            {selectedSystems.size === 0
              ? 'Scope: All Consoles (Unfiltered)'
              : `Scope: ${selectedSystems.size} of ${availableSystems.length} selected`}
          </div>
        </div>

        {filterLockedByEnv && (
          <p className="text-xs font-mono text-crt-amber">
            Console selection is locked by the SCRAPER_SYSTEM_FILTER environment variable ({systemFilter}).
          </p>
        )}

        {availableSystems.length === 0 ? (
          <div className="border border-crt-border bg-crt-bg rounded p-6 text-center space-y-3">
            <p className="text-sm text-crt-text font-medium">No consoles discovered yet</p>
            <p className="text-xs text-crt-muted max-w-md mx-auto">
              Click &ldquo;Test Login &amp; Discover Consoles&rdquo; above to authenticate and fetch the full list of available systems from RetroGameTalk.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={consoleSearch}
                  onChange={(e) => setConsoleSearch(e.target.value)}
                  placeholder="Filter discovered consoles..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-64"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={filterLockedByEnv}
                  onClick={handleSelectAllConsoles}
                  className="px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text rounded transition-colors disabled:opacity-50"
                >
                  Select All ({availableSystems.length})
                </button>
                <button
                  type="button"
                  disabled={filterLockedByEnv}
                  onClick={handleClearConsoleFilter}
                  className="px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors disabled:opacity-50"
                >
                  Mirror All (Unfiltered)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-80 overflow-y-auto pr-1">
              {filteredConsoles.map((slug) => {
                const isSelected = selectedSystems.has(slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    disabled={filterLockedByEnv}
                    onClick={() => toggleConsole(slug)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 text-xs font-mono border rounded text-left transition-colors ${
                      isSelected
                        ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
                        : 'border-crt-border bg-crt-bg text-crt-text hover:border-crt-border-strong'
                    } disabled:opacity-60`}
                  >
                    <span className="truncate">{slug}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1.5 pt-2 border-t border-crt-border">
          <label className="block text-xs font-medium text-crt-text">
            Active Console Filter String (comma-separated slugs, empty = all systems)
          </label>
          <input
            type="text"
            value={systemFilter}
            disabled={filterLockedByEnv}
            onChange={(e) => setSystemFilter(e.target.value)}
            placeholder="All systems (unfiltered)"
            className="w-full px-3 py-2 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
          />
        </div>
      </section>

      {/* Unified Save Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs">
          {saveMsg && (
            <span className="inline-flex items-center gap-1.5 text-crt-phosphor">
              <CheckCircle2 className="h-4 w-4" />
              {saveMsg}
            </span>
          )}
          {saveErr && <span className="text-crt-crimson">{saveErr}</span>}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </form>
  );
}
