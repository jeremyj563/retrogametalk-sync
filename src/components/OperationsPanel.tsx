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
  Usb,
  XCircle,
} from 'lucide-react';
import { DEVICE_PRESETS, type DevicePresetId } from '../shared/devicePresets';
import { formatPreparedRomName, ROM_NAMING_PRESETS } from '../shared/romNaming';
import type { AuthTestResult, ScraperConfigPublic, ServiceStatusSnapshot } from '../types';
import { formatBytes } from '../utils/format';
import { readJsonSafely } from '../utils/http';

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
  const [romNamingTemplate, setRomNamingTemplate] = useState(config.romNamingTemplate);
  const [romSanitizeFat32, setRomSanitizeFat32] = useState(config.romSanitizeFat32);
  const [romMaxFilenameLen, setRomMaxFilenameLen] = useState(config.romMaxFilenameLen);
  const [devicePreset, setDevicePreset] = useState(config.devicePreset || 'everdrive');

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
    setRomNamingTemplate(config.romNamingTemplate);
    setRomSanitizeFat32(config.romSanitizeFat32);
    setRomMaxFilenameLen(config.romMaxFilenameLen);
    setDevicePreset(config.devicePreset || 'everdrive');
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
    romNamingTemplate,
    romSanitizeFat32,
    romMaxFilenameLen,
    devicePreset,
  });

  const namingPreviews = useMemo(() => {
    const cfg = { romNamingTemplate, romSanitizeFat32, romMaxFilenameLen };
    return [
      {
        label: 'Retail ROM',
        output: formatPreparedRomName(
          {
            title: 'Gimmick!',
            systemName: 'nes-roms',
            regions: ['Japan'],
            fileRole: 'ROM',
            innerFilename: 'Gimmick! (J).nes',
          },
          '.nes',
          cfg,
        ),
      },
      {
        label: 'ROM Hack',
        output: formatPreparedRomName(
          {
            title: 'Super Mario World: Return to Dinosaur Land',
            systemName: 'snes-roms',
            regions: ['USA'],
            fileRole: 'Hack',
            archiveFilename: 'SMW_Return_v1.42.7z',
            innerFilename: 'smw_rtdl.sfc',
          },
          '.sfc',
          cfg,
        ),
      },
      {
        label: 'Translation',
        output: formatPreparedRomName(
          {
            title: 'Mother 3',
            systemName: 'gba-roms',
            regions: ['Japan'],
            fileRole: 'English Translation',
            displayLabel: 'Mother 3 English v1.3',
            innerFilename: 'mother3_patched.gba',
          },
          '.gba',
          cfg,
        ),
      },
    ];
  }, [romNamingTemplate, romSanitizeFat32, romMaxFilenameLen]);

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
            {config.envOverrides.includes('RGT_BASE_URL') && (
              <p className="text-[11px] font-mono text-crt-amber">
                Loaded from RGT_BASE_URL environment variable (read-only).
              </p>
            )}
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
            {config.envOverrides.includes('RGT_LOGIN_URL') && (
              <p className="text-[11px] font-mono text-crt-amber">
                Loaded from RGT_LOGIN_URL environment variable (read-only).
              </p>
            )}
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

      {/* Prepared ROM Naming & SD Card Device Export Defaults */}
      <section className="border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <Usb className="h-5 w-5 text-crt-phosphor mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Prepared ROM Naming &amp; SD Card Export
              </h2>
              <p className="text-xs text-crt-muted">
                Controls how extracted ROMs are named for flash carts, ODEs, and handhelds while keeping raw archives untouched on disk.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-crt-text">Naming Presets</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ROM_NAMING_PRESETS.map((preset) => {
              const active = romNamingTemplate === preset.template;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setRomNamingTemplate(preset.template)}
                  className={`p-3 text-left border rounded transition-colors space-y-1 ${
                    active
                      ? 'border-crt-phosphor bg-crt-phosphor/10'
                      : 'border-crt-border bg-crt-bg hover:border-crt-border-strong'
                  }`}
                >
                  <div className={`text-xs font-medium ${active ? 'text-crt-phosphor' : 'text-crt-text'}`}>
                    {preset.label}
                  </div>
                  <div className="font-mono text-[11px] text-crt-muted truncate">
                    {preset.exampleHack}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
          <div className="md:col-span-6 space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">
              Filename Pattern Template
            </label>
            <input
              type="text"
              value={romNamingTemplate}
              onChange={(e) => setRomNamingTemplate(e.target.value)}
              placeholder="{title}{regionParen}{tagBracket}"
              className="w-full px-3 py-2 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
            />
            <p className="text-[11px] font-mono text-crt-muted">
              Tokens: {'{title}'}, {'{regionParen}'}, {'{tagBracket}'}, {'{role}'}, {'{version}'}, {'{origName}'}
            </p>
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">
              Default SD Card Preset
            </label>
            <select
              value={devicePreset}
              onChange={(e) => setDevicePreset(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
            >
              {Object.values(DEVICE_PRESETS).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-crt-muted">
              {DEVICE_PRESETS[devicePreset as DevicePresetId]?.description}
            </p>
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-xs font-medium text-crt-text">
              Max Filename Length (0 = unlimited)
            </label>
            <input
              type="number"
              min={0}
              max={255}
              value={romMaxFilenameLen}
              onChange={(e) => setRomMaxFilenameLen(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
            />
            <label className="inline-flex items-center gap-2 pt-1 text-xs text-crt-muted cursor-pointer">
              <input
                type="checkbox"
                checked={romSanitizeFat32}
                onChange={(e) => setRomSanitizeFat32(e.target.checked)}
                className="accent-crt-phosphor"
              />
              <span>FAT32 / SD-safe characters</span>
            </label>
          </div>
        </div>

        {/* Live Output Preview */}
        <div className="border border-crt-border bg-crt-bg rounded p-3.5 space-y-1.5">
          <div className="text-[11px] font-mono text-crt-muted">Live Template Output Preview</div>
          <div className="divide-y divide-crt-border text-xs font-mono">
            {namingPreviews.map((p) => (
              <div key={p.label} className="py-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-crt-muted">{p.label}</span>
                <span className="text-crt-phosphor break-all">{p.output}</span>
              </div>
            ))}
          </div>
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
