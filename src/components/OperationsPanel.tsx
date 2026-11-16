import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Filter,
  Gamepad2,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Save,
  Search,
  ShieldCheck,
  Usb,
  X,
  XCircle,
} from 'lucide-react';
import { validateBrandLogoUrl } from '../shared/brandLogo';
import { DEVICE_PRESETS, type DevicePresetId } from '../shared/devicePresets';
import { BrandMark } from './BrandMark';
import {
  CURATED_RELEASE_TYPE_OPTIONS,
  MACHINE_TRANSLATION_KEY,
  RELEASE_TYPE_PRESETS,
  TRANSLATION_LANGUAGE_OPTIONS,
  TRANSLATIONS_ALL_KEY,
  formatAllowedReleaseTypesSummary,
  isHumanTranslationLanguageKey,
  normalizeAllowedReleaseTypes,
} from '../shared/releaseTypeFilter';
import { formatPreparedRomName, ROM_NAMING_PRESETS } from '../shared/romNaming';
import {
  filterValidSystemSlugs,
  groupSystemsByBrand,
  resolveSystemDisplayInfo,
} from '../shared/systemCatalog';
import type {
  AuthTestResult,
  OperationsFocusRequest,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
} from '../types';
import { formatBytes } from '../utils/format';
import { readJsonSafely } from '../utils/http';
import { EnvLockIndicator } from './EnvLockIndicator';

export interface OperationsDirtyState {
  isDirty: boolean;
  changedSections: string[];
}

export interface OperationsPanelHandle {
  save: () => Promise<boolean>;
  discard: () => void;
}

interface OperationsPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  focusRequest?: OperationsFocusRequest | null;
  onDirtyChange?: (state: OperationsDirtyState) => void;
  onSaveConfig: (patch: Partial<ScraperConfigPublic> & { password?: string }) => Promise<void>;
  onRefreshConfig: () => Promise<void>;
}

function canonicalSystemFilterKey(raw: string): string {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    list.push(lower);
  }
  return list.sort((a, b) => a.localeCompare(b)).join(',');
}

export const OperationsPanel = forwardRef<OperationsPanelHandle, OperationsPanelProps>(
  function OperationsPanel(
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
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [loginUrl, setLoginUrl] = useState(config.loginUrl);
  const [username, setUsername] = useState(config.username);
  const [password, setPassword] = useState(config.password);
  const [showPassword, setShowPassword] = useState(false);
  const [downloadDir, setDownloadDir] = useState(config.downloadDir);
  const [systemFilter, setSystemFilter] = useState(config.systemFilter);
  const [consoleSearch, setConsoleSearch] = useState('');
  const [showAdvancedSystemFilter, setShowAdvancedSystemFilter] = useState(false);
  const [releaseTypeMode, setReleaseTypeMode] = useState<'all' | 'custom'>(
    config.allowedReleaseTypes.length > 0 ? 'custom' : 'all',
  );
  const [allowedReleaseTypes, setAllowedReleaseTypes] = useState<string[]>(() =>
    normalizeAllowedReleaseTypes(config.allowedReleaseTypes),
  );
  const [romNamingTemplate, setRomNamingTemplate] = useState(config.romNamingTemplate);
  const [romSanitizeFat32, setRomSanitizeFat32] = useState(config.romSanitizeFat32);
  const [romMaxFilenameLen, setRomMaxFilenameLen] = useState(config.romMaxFilenameLen);
  const [devicePreset, setDevicePreset] = useState(config.devicePreset || 'everdrive');
  const [customBrandLogoUrl, setCustomBrandLogoUrl] = useState(config.customBrandLogoUrl || '');
  const [brandPreviewError, setBrandPreviewError] = useState(false);

  const [spotlight, setSpotlight] = useState<OperationsFocusRequest | null>(null);
  const authSectionRef = useRef<HTMLElement | null>(null);
  const systemsSectionRef = useRef<HTMLElement | null>(null);
  const releaseTypesSectionRef = useRef<HTMLElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [testingAuth, setTestingAuth] = useState(false);
  const [authResult, setAuthResult] = useState<AuthTestResult | null>(null);

  const isDirtyRef = useRef(false);
  const saveNoticeTimerRef = useRef<number | null>(null);

  const baseUrlLockedByEnv = config.envOverrides.includes('RGT_BASE_URL');
  const loginUrlLockedByEnv = config.envOverrides.includes('RGT_LOGIN_URL');
  const usernameLockedByEnv = config.envOverrides.includes('RGT_USERNAME');
  const passwordLockedByEnv = config.envOverrides.includes('RGT_PASSWORD');
  const dataDirLockedByEnv = config.envOverrides.includes('DATA_DIR');
  const downloadDirLockedByEnv = config.envOverrides.includes('DOWNLOAD_DIR');
  const filterLockedByEnv = config.envOverrides.includes('SCRAPER_SYSTEM_FILTER');
  const typeFilterLockedByEnv = config.envOverrides.includes('SCRAPER_RELEASE_TYPE_FILTER');

  const resetFormToConfig = useCallback((target: ScraperConfigPublic) => {
    setBaseUrl(target.baseUrl);
    setLoginUrl(target.loginUrl);
    setUsername(target.username);
    setPassword(target.password);
    setDownloadDir(target.downloadDir);
    setSystemFilter(target.systemFilter);
    const normalizedTypes = normalizeAllowedReleaseTypes(target.allowedReleaseTypes);
    setAllowedReleaseTypes(normalizedTypes);
    setReleaseTypeMode(normalizedTypes.length > 0 ? 'custom' : 'all');
    setRomNamingTemplate(target.romNamingTemplate);
    setRomSanitizeFat32(target.romSanitizeFat32);
    setRomMaxFilenameLen(target.romMaxFilenameLen);
    setDevicePreset(target.devicePreset || 'everdrive');
    setCustomBrandLogoUrl(target.customBrandLogoUrl || '');
    setBrandPreviewError(false);
  }, []);

  useEffect(() => {
    setBrandPreviewError(false);
  }, [customBrandLogoUrl]);

  useEffect(() => {
    if (!isDirtyRef.current) {
      resetFormToConfig(config);
    }
  }, [config, resetFormToConfig]);

  const selectedSystems = useMemo(() => {
    return new Set(
      systemFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [systemFilter]);

  const selectedSystemsLower = useMemo(() => {
    return new Set(Array.from(selectedSystems).map((s) => s.toLowerCase()));
  }, [selectedSystems]);

  const availableSystems = useMemo(() => {
    return filterValidSystemSlugs([
      ...config.discoveredSystems,
      ...(authResult?.discoveredSystems || []),
      ...Array.from(selectedSystems),
    ]);
  }, [config.discoveredSystems, authResult, selectedSystems]);

  const allBrandGroups = useMemo(
    () => groupSystemsByBrand(availableSystems),
    [availableSystems],
  );

  const filteredConsoles = useMemo(() => {
    const q = consoleSearch.trim().toLowerCase();
    if (!q) return availableSystems;
    return availableSystems.filter((slug) => {
      const info = resolveSystemDisplayInfo(slug);
      return (
        info.slug.toLowerCase().includes(q) ||
        info.displayName.toLowerCase().includes(q) ||
        info.brandLabel.toLowerCase().includes(q)
      );
    });
  }, [availableSystems, consoleSearch]);

  const filteredBrandGroups = useMemo(
    () => groupSystemsByBrand(filteredConsoles),
    [filteredConsoles],
  );

  const toggleConsole = (slug: string) => {
    if (filterLockedByEnv) return;
    const next = new Set(selectedSystems);
    const matchingExisting = Array.from(next).find(
      (s) => s.toLowerCase() === slug.toLowerCase(),
    );
    if (matchingExisting) {
      next.delete(matchingExisting);
    } else {
      next.add(slug);
    }
    setSystemFilter(Array.from(next).sort((a, b) => a.localeCompare(b)).join(','));
  };

  const setBrandGroupSelection = (brandSlugs: string[], select: boolean) => {
    if (filterLockedByEnv) return;
    const targetLower = new Set(brandSlugs.map((s) => s.toLowerCase()));
    const next = new Set(
      Array.from(selectedSystems).filter((s) => !targetLower.has(s.toLowerCase())),
    );
    if (select) {
      for (const slug of brandSlugs) {
        next.add(slug);
      }
    }
    setSystemFilter(Array.from(next).sort((a, b) => a.localeCompare(b)).join(','));
  };

  const toggleBrandGroup = (brandSlugs: string[]) => {
    if (filterLockedByEnv) return;
    const allSelected =
      brandSlugs.length > 0 &&
      brandSlugs.every((slug) => selectedSystemsLower.has(slug.toLowerCase()));
    setBrandGroupSelection(brandSlugs, !allSelected);
  };

  const handleSelectAllConsoles = () => {
    if (filterLockedByEnv) return;
    setSystemFilter(availableSystems.join(','));
  };

  const handleClearConsoleFilter = () => {
    if (filterLockedByEnv) return;
    setSystemFilter('');
  };

  const humanTranslationOptions = useMemo(
    () => TRANSLATION_LANGUAGE_OPTIONS.filter((o) => !o.isMachine),
    [],
  );
  const machineTranslationOption = useMemo(
    () => TRANSLATION_LANGUAGE_OPTIONS.find((o) => o.isMachine) ?? null,
    [],
  );

  const translationsAllEnabled = allowedReleaseTypes.includes(TRANSLATIONS_ALL_KEY);
  const machineTranslationEnabled = allowedReleaseTypes.includes(MACHINE_TRANSLATION_KEY);
  const specificLanguageKeys = useMemo(
    () => allowedReleaseTypes.filter((k) => isHumanTranslationLanguageKey(k)),
    [allowedReleaseTypes],
  );
  const translationsCategoryActive =
    releaseTypeMode === 'custom' &&
    (translationsAllEnabled || specificLanguageKeys.length > 0 || machineTranslationEnabled);
  const customTypeSelectionEmpty =
    releaseTypeMode === 'custom' && allowedReleaseTypes.length === 0;

  const activePresetId = useMemo(() => {
    if (releaseTypeMode === 'all') return 'all';
    if (allowedReleaseTypes.length === 0) return null;
    const match = RELEASE_TYPE_PRESETS.find(
      (p) =>
        p.values.length > 0 &&
        p.values.length === allowedReleaseTypes.length &&
        p.values.every((v, idx) => allowedReleaseTypes[idx] === v),
    );
    return match?.id ?? null;
  }, [releaseTypeMode, allowedReleaseTypes]);

  const handleSelectReleaseTypeMode = (mode: 'all' | 'custom') => {
    if (typeFilterLockedByEnv) return;
    if (mode === 'all') {
      setReleaseTypeMode('all');
      setAllowedReleaseTypes([]);
      return;
    }
    setReleaseTypeMode('custom');
    if (allowedReleaseTypes.length === 0) {
      setAllowedReleaseTypes(['retail']);
    }
  };

  const handleApplyReleaseTypePreset = (values: string[]) => {
    if (typeFilterLockedByEnv) return;
    if (values.length === 0) {
      setReleaseTypeMode('all');
      setAllowedReleaseTypes([]);
      return;
    }
    setReleaseTypeMode('custom');
    setAllowedReleaseTypes(normalizeAllowedReleaseTypes(values));
  };

  const handleToggleCuratedType = (typeId: string) => {
    if (typeFilterLockedByEnv) return;
    setReleaseTypeMode('custom');
    if (typeId === TRANSLATIONS_ALL_KEY) {
      if (translationsCategoryActive) {
        setAllowedReleaseTypes((prev) =>
          normalizeAllowedReleaseTypes(
            prev.filter(
              (k) =>
                k !== TRANSLATIONS_ALL_KEY &&
                !isHumanTranslationLanguageKey(k) &&
                k !== MACHINE_TRANSLATION_KEY,
            ),
          ),
        );
      } else {
        setAllowedReleaseTypes((prev) =>
          normalizeAllowedReleaseTypes([...prev, TRANSLATIONS_ALL_KEY]),
        );
      }
      return;
    }

    setAllowedReleaseTypes((prev) => {
      const exists = prev.includes(typeId);
      const next = exists ? prev.filter((k) => k !== typeId) : [...prev, typeId];
      return normalizeAllowedReleaseTypes(next);
    });
  };

  const handleToggleAllFanTranslationLanguages = () => {
    if (typeFilterLockedByEnv) return;
    setReleaseTypeMode('custom');
    setAllowedReleaseTypes((prev) => {
      if (prev.includes(TRANSLATIONS_ALL_KEY)) {
        return normalizeAllowedReleaseTypes(
          prev.filter((k) => k !== TRANSLATIONS_ALL_KEY && !isHumanTranslationLanguageKey(k)),
        );
      }
      return normalizeAllowedReleaseTypes([...prev, TRANSLATIONS_ALL_KEY]);
    });
  };

  const handleToggleSpecificLanguage = (langId: string) => {
    if (typeFilterLockedByEnv) return;
    setReleaseTypeMode('custom');
    if (langId === MACHINE_TRANSLATION_KEY) {
      setAllowedReleaseTypes((prev) =>
        normalizeAllowedReleaseTypes(
          prev.includes(MACHINE_TRANSLATION_KEY)
            ? prev.filter((k) => k !== MACHINE_TRANSLATION_KEY)
            : [...prev, MACHINE_TRANSLATION_KEY],
        ),
      );
      return;
    }

    setAllowedReleaseTypes((prev) => {
      if (prev.includes(TRANSLATIONS_ALL_KEY)) {
        // Expand master 'translations' to all human languages except the deselected one
        const withoutAll = prev.filter((k) => k !== TRANSLATIONS_ALL_KEY);
        const remainingHumanLangs = humanTranslationOptions
          .map((o) => o.id)
          .filter((id) => id !== langId);
        return normalizeAllowedReleaseTypes([...withoutAll, ...remainingHumanLangs]);
      }
      const exists = prev.includes(langId);
      const next = exists ? prev.filter((k) => k !== langId) : [...prev, langId];
      return normalizeAllowedReleaseTypes(next);
    });
  };

  const buildSavePayload = () => ({
    ...(!config.envOverrides.includes('RGT_BASE_URL') ? { baseUrl } : {}),
    ...(!config.envOverrides.includes('RGT_LOGIN_URL') ? { loginUrl } : {}),
    ...(!usernameLockedByEnv ? { username } : {}),
    ...(!passwordLockedByEnv ? { password } : {}),
    ...(!downloadDirLockedByEnv ? { downloadDir } : {}),
    ...(!filterLockedByEnv ? { systemFilter } : {}),
    ...(!typeFilterLockedByEnv && !customTypeSelectionEmpty
      ? { allowedReleaseTypes: releaseTypeMode === 'all' ? [] : allowedReleaseTypes }
      : {}),
    romNamingTemplate,
    romSanitizeFat32,
    romMaxFilenameLen,
    devicePreset,
    customBrandLogoUrl: customBrandLogoUrl.trim(),
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

  const dirtyState = useMemo<OperationsDirtyState>(() => {
    const changedSections: string[] = [];

    const credentialsChanged =
      (!config.envOverrides.includes('RGT_BASE_URL') && baseUrl !== config.baseUrl) ||
      (!config.envOverrides.includes('RGT_LOGIN_URL') && loginUrl !== config.loginUrl) ||
      (!usernameLockedByEnv && username !== config.username) ||
      (!passwordLockedByEnv && password !== config.password) ||
      (!downloadDirLockedByEnv && downloadDir !== config.downloadDir);
    if (credentialsChanged) changedSections.push('Credentials & Path');

    const systemsChanged =
      !filterLockedByEnv &&
      canonicalSystemFilterKey(systemFilter) !== canonicalSystemFilterKey(config.systemFilter);
    if (systemsChanged) changedSections.push('Target Consoles');

    const savedReleaseTypes = normalizeAllowedReleaseTypes(config.allowedReleaseTypes);
    const savedReleaseMode: 'all' | 'custom' = savedReleaseTypes.length > 0 ? 'custom' : 'all';
    const currentReleaseTypes =
      releaseTypeMode === 'all' ? [] : normalizeAllowedReleaseTypes(allowedReleaseTypes);
    const releaseTypesChanged =
      !typeFilterLockedByEnv &&
      (releaseTypeMode !== savedReleaseMode ||
        currentReleaseTypes.length !== savedReleaseTypes.length ||
        currentReleaseTypes.some((v, idx) => v !== savedReleaseTypes[idx]));
    if (releaseTypesChanged) changedSections.push('Type Filter');

    const namingChanged =
      romNamingTemplate !== config.romNamingTemplate ||
      romSanitizeFat32 !== config.romSanitizeFat32 ||
      romMaxFilenameLen !== config.romMaxFilenameLen ||
      (devicePreset || 'everdrive') !== (config.devicePreset || 'everdrive');
    if (namingChanged) changedSections.push('ROM Naming & Export');

    const brandingChanged =
      customBrandLogoUrl.trim() !== (config.customBrandLogoUrl || '').trim();
    if (brandingChanged) changedSections.push('Interface Branding');

    return {
      isDirty: changedSections.length > 0,
      changedSections,
    };
  }, [
    config,
    baseUrl,
    loginUrl,
    username,
    password,
    downloadDir,
    systemFilter,
    releaseTypeMode,
    allowedReleaseTypes,
    romNamingTemplate,
    romSanitizeFat32,
    romMaxFilenameLen,
    devicePreset,
    customBrandLogoUrl,
    usernameLockedByEnv,
    passwordLockedByEnv,
    downloadDirLockedByEnv,
    filterLockedByEnv,
    typeFilterLockedByEnv,
  ]);

  isDirtyRef.current = dirtyState.isDirty;

  useEffect(() => {
    onDirtyChange?.(dirtyState);
  }, [dirtyState, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.({ isDirty: false, changedSections: [] });
      if (saveNoticeTimerRef.current !== null) {
        window.clearTimeout(saveNoticeTimerRef.current);
      }
    };
  }, [onDirtyChange]);

  useEffect(() => {
    if (dirtyState.isDirty && saveMsg) {
      setSaveMsg(null);
    }
  }, [dirtyState.isDirty, saveMsg]);

  const saveConfiguration = useCallback(async (): Promise<boolean> => {
    if (customTypeSelectionEmpty) {
      setSaveErr('Select at least one allowed game or ROM type, or switch to All Release Types.');
      setSaveMsg(null);
      return false;
    }
    try {
      validateBrandLogoUrl(customBrandLogoUrl);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
      setSaveMsg(null);
      return false;
    }
    if (saveNoticeTimerRef.current !== null) {
      window.clearTimeout(saveNoticeTimerRef.current);
      saveNoticeTimerRef.current = null;
    }
    setSaving(true);
    setSaveMsg(null);
    setSaveErr(null);
    try {
      await onSaveConfig(buildSavePayload());
      isDirtyRef.current = false;
      setSaveMsg('Operations configuration saved');
      saveNoticeTimerRef.current = window.setTimeout(() => {
        setSaveMsg(null);
        saveNoticeTimerRef.current = null;
      }, 3500);
      return true;
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [customTypeSelectionEmpty, customBrandLogoUrl, onSaveConfig, buildSavePayload]);

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveConfiguration();
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

  useEffect(() => {
    if (!focusRequest) return;

    const targetMap = {
      auth: authSectionRef.current,
      systems: systemsSectionRef.current,
      releaseTypes: releaseTypesSectionRef.current,
    } as const;
    const targetEl = targetMap[focusRequest.target];
    if (!targetEl) return;

    setSpotlight(focusRequest);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const rafId = window.requestAnimationFrame(() => {
      const stickyHeader = document.querySelector('header');
      const headerHeight = stickyHeader ? stickyHeader.getBoundingClientRect().height : 68;
      const topOffset = headerHeight + 20;
      const elementTop = targetEl.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, elementTop - topOffset),
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    });

    const clearTimer = window.setTimeout(() => {
      setSpotlight((current) =>
        current && current.nonce === focusRequest.nonce ? null : current,
      );
    }, 2500);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(clearTimer);
    };
  }, [focusRequest]);

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-6 max-w-5xl">
      {/* Credentials & Local Filesystem Storage Form */}
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
            className="crt-cta-beam inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {testingAuth ? 'Probing Repository...' : 'Test Login & Discover Consoles'}
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
              <label className="text-xs font-medium text-crt-text">
                Repository Password
              </label>
              {passwordLockedByEnv && <EnvLockIndicator envVar="RGT_PASSWORD" />}
            </div>
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
            {!passwordLockedByEnv && (
              <p className="text-[11px] font-mono text-crt-muted">
                {config.hasPassword ? 'Persisted encrypted in SQLite' : 'Not set yet'}
              </p>
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
            <p className="text-[11px] font-mono text-crt-muted">
              Status: {status.storage.writable ? 'Writable' : 'Read-Only'} · {formatBytes(status.storage.totalBytesOnDisk)} mirrored across {status.storage.totalFilesOnDisk} files
            </p>
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
      <section
        ref={systemsSectionRef}
        className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
      >
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        {spotlight?.target === 'systems' && (
          <div
            key={`systems-${spotlight.nonce}`}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
          />
        )}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <Gamepad2 className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Target Consoles &amp; Systems
              </h2>
              <p className="text-xs text-crt-muted">
                Choose specific hardware platforms to mirror, or leave all unchecked to mirror every valid discovered system. Non-system site pages are excluded automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-1 text-xs font-mono text-crt-text tabular-nums shrink-0">
            <div>
              Scope:{' '}
              <span className={selectedSystems.size > 0 ? 'text-crt-amber' : 'text-crt-phosphor'}>
                {selectedSystems.size === 0
                  ? 'All Consoles (Unfiltered)'
                  : `${selectedSystems.size} of ${availableSystems.length} selected`}
              </span>
            </div>
            {filterLockedByEnv && (
              <EnvLockIndicator
                envVar="SCRAPER_SYSTEM_FILTER"
                detail={`Console selection is locked by SCRAPER_SYSTEM_FILTER=${systemFilter} (read-only)`}
              />
            )}
          </div>
        </div>

        {availableSystems.length === 0 ? (
          <div className="border border-crt-border bg-crt-bg rounded p-6 text-center space-y-3">
            <p className="text-sm text-crt-text font-medium">No consoles discovered yet</p>
            <p className="text-xs text-crt-muted max-w-md mx-auto">
              Click &ldquo;Test Login &amp; Discover Consoles&rdquo; above to authenticate and fetch the list of available systems from RetroGameTalk.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search & Global Scope Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={consoleSearch}
                  onChange={(e) => setConsoleSearch(e.target.value)}
                  placeholder="Search by console name, brand, or slug..."
                  className="w-full pl-8 pr-8 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor"
                />
                {consoleSearch && (
                  <button
                    type="button"
                    aria-label="Clear console search"
                    onClick={() => setConsoleSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-crt-muted hover:text-crt-text"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={filterLockedByEnv}
                  onClick={handleSelectAllConsoles}
                  className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  Select All ({availableSystems.length})
                </button>
                <button
                  type="button"
                  disabled={filterLockedByEnv || selectedSystems.size === 0}
                  onClick={handleClearConsoleFilter}
                  className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  All Consoles (Unfiltered)
                </button>
              </div>
            </div>

            {/* Brand Quick-Toggle Strip */}
            {allBrandGroups.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-crt-muted whitespace-nowrap">
                  Brands:
                </span>
                {allBrandGroups.map(({ brand, items }) => {
                  const brandSlugs = items.map((i) => i.slug);
                  const selectedInBrand = items.filter((i) =>
                    selectedSystemsLower.has(i.slug.toLowerCase()),
                  ).length;
                  const allInBrandSelected = selectedInBrand === items.length;
                  const someInBrandSelected = selectedInBrand > 0 && !allInBrandSelected;

                  return (
                    <button
                      key={brand.id}
                      type="button"
                      disabled={filterLockedByEnv}
                      onClick={() => toggleBrandGroup(brandSlugs)}
                      title={
                        allInBrandSelected
                          ? `Deselect all ${brand.label} systems`
                          : `Select all ${items.length} ${brand.label} systems`
                      }
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                        allInBrandSelected
                          ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
                          : someInBrandSelected
                            ? 'border-crt-phosphor/45 bg-crt-bg text-crt-text hover:border-crt-phosphor'
                            : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                      }`}
                    >
                      <span>{brand.shortLabel}</span>
                      <span className="text-[10px] tabular-nums opacity-80">
                        {selectedInBrand}/{items.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Grouped Hardware Brand Grids */}
            {filteredBrandGroups.length === 0 ? (
              <div className="border border-crt-border bg-crt-bg rounded p-6 text-center space-y-2.5">
                <p className="text-xs font-medium text-crt-text">
                  No consoles match &ldquo;{consoleSearch}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => setConsoleSearch('')}
                  className="px-3 py-1 text-xs font-mono border border-crt-border bg-crt-surface hover:border-crt-phosphor text-crt-phosphor rounded transition-colors"
                >
                  Clear Search
                </button>
              </div>
            ) : (
              <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
                {filteredBrandGroups.map(({ brand, items }) => {
                  const brandSlugs = items.map((i) => i.slug);
                  const selectedInBrand = items.filter((i) =>
                    selectedSystemsLower.has(i.slug.toLowerCase()),
                  ).length;
                  const allSelected = selectedInBrand === items.length;

                  return (
                    <div key={brand.id} className="border-t border-crt-border pt-4 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-crt-text">{brand.label}</span>
                          <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                            · {selectedInBrand} of {items.length} selected
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-mono">
                          {!allSelected && (
                            <button
                              type="button"
                              disabled={filterLockedByEnv}
                              onClick={() => setBrandGroupSelection(brandSlugs, true)}
                              className="text-crt-phosphor hover:underline whitespace-nowrap disabled:opacity-45 disabled:no-underline"
                            >
                              Select {brand.shortLabel}
                            </button>
                          )}
                          {selectedInBrand > 0 && (
                            <button
                              type="button"
                              disabled={filterLockedByEnv}
                              onClick={() => setBrandGroupSelection(brandSlugs, false)}
                              className="text-crt-muted hover:text-crt-text hover:underline whitespace-nowrap disabled:opacity-45 disabled:no-underline"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {items.map((info) => {
                          const isSelected = selectedSystemsLower.has(info.slug.toLowerCase());
                          return (
                            <button
                              key={info.slug}
                              type="button"
                              disabled={filterLockedByEnv}
                              onClick={() => toggleConsole(info.slug)}
                              className={`flex items-center justify-between gap-3 px-3 py-2.5 border rounded text-left transition-colors disabled:opacity-60 ${
                                isSelected
                                  ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-text'
                                  : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                              }`}
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div
                                  className={`text-xs truncate ${
                                    isSelected ? 'text-crt-phosphor font-semibold' : 'text-crt-text font-medium'
                                  }`}
                                >
                                  {info.displayName}
                                </div>
                                <div className="text-[11px] font-mono text-crt-muted truncate">
                                  {info.slug}
                                </div>
                              </div>

                              <span
                                aria-hidden="true"
                                className={`h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                                    : 'border-crt-border bg-crt-surface'
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Collapsible Advanced Raw Filter String */}
        <div className="border-t border-crt-border pt-3 space-y-2.5">
          <button
            type="button"
            aria-expanded={showAdvancedSystemFilter}
            onClick={() => setShowAdvancedSystemFilter((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left text-xs text-crt-muted hover:text-crt-text transition-colors"
          >
            <span className="font-medium">Advanced: Raw Filter String</span>
            <span className="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums shrink-0">
              <span>
                {selectedSystems.size > 0
                  ? `${selectedSystems.size} slug(s) active`
                  : 'All systems (unfiltered)'}
              </span>
              {showAdvancedSystemFilter ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </button>

          {showAdvancedSystemFilter && (
            <div className="space-y-1.5 pt-1">
              <label className="block text-[11px] font-mono text-crt-muted">
                Comma-separated system slugs (empty = mirror all valid systems)
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
          )}
        </div>
      </section>

      {/* Allowed Game & ROM Types Section */}
      <section
        ref={releaseTypesSectionRef}
        className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
      >
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        {spotlight?.target === 'releaseTypes' && (
          <div
            key={`releaseTypes-${spotlight.nonce}`}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
          />
        )}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <Filter className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Allowed Game &amp; ROM Types
              </h2>
              <p className="text-xs text-crt-muted">
                Choose which release categories and translation languages are downloaded across all synced systems. Disallowed releases and sibling archives are skipped before resolving download links.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:items-end gap-1 text-xs font-mono text-crt-text tabular-nums shrink-0">
            <div>
              Scope:{' '}
              <span className={releaseTypeMode === 'custom' ? 'text-crt-amber' : 'text-crt-phosphor'}>
                {releaseTypeMode === 'all'
                  ? 'All Types (Unfiltered)'
                  : customTypeSelectionEmpty
                    ? 'None Selected'
                    : formatAllowedReleaseTypesSummary(allowedReleaseTypes)}
              </span>
            </div>
            {typeFilterLockedByEnv && (
              <EnvLockIndicator
                envVar="SCRAPER_RELEASE_TYPE_FILTER"
                detail="Release type filtering is locked by SCRAPER_RELEASE_TYPE_FILTER (read-only)"
              />
            )}
          </div>
        </div>

        {/* Mode Switcher + Quick Presets */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Release type filter mode"
            className="inline-flex items-center p-1 bg-crt-bg border border-crt-border rounded"
          >
            <button
              type="button"
              disabled={typeFilterLockedByEnv}
              onClick={() => handleSelectReleaseTypeMode('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                releaseTypeMode === 'all'
                  ? 'bg-crt-elevated text-crt-phosphor'
                  : 'text-crt-muted hover:text-crt-text'
              }`}
            >
              All Release Types
            </button>
            <button
              type="button"
              disabled={typeFilterLockedByEnv}
              onClick={() => handleSelectReleaseTypeMode('custom')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                releaseTypeMode === 'custom'
                  ? 'bg-crt-elevated text-crt-phosphor'
                  : 'text-crt-muted hover:text-crt-text'
              }`}
            >
              Selected Types Only
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono text-crt-muted whitespace-nowrap">
              Presets:
            </span>
            {RELEASE_TYPE_PRESETS.filter((p) => p.id !== 'all').map((preset) => {
              const isPresetActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={typeFilterLockedByEnv}
                  onClick={() => handleApplyReleaseTypePreset(preset.values)}
                  className={`px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                    isPresetActive
                      ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
                      : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Curated Category Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {CURATED_RELEASE_TYPE_OPTIONS.map((option) => {
            const isTranslations = option.id === TRANSLATIONS_ALL_KEY;
            const isActive =
              releaseTypeMode === 'all'
                ? true
                : isTranslations
                  ? translationsCategoryActive
                  : allowedReleaseTypes.includes(option.id);

            const translationBadgeText =
              releaseTypeMode === 'custom' && isTranslations
                ? translationsAllEnabled
                  ? machineTranslationEnabled
                    ? 'All + MTL'
                    : 'All Languages'
                  : specificLanguageKeys.length > 0 || machineTranslationEnabled
                    ? `${specificLanguageKeys.length + (machineTranslationEnabled ? 1 : 0)} selected`
                    : null
                : null;

            return (
              <button
                key={option.id}
                type="button"
                disabled={typeFilterLockedByEnv}
                onClick={() => handleToggleCuratedType(option.id)}
                className={`p-3 text-left border rounded transition-colors flex items-start justify-between gap-3 disabled:opacity-60 ${
                  isActive
                    ? releaseTypeMode === 'all'
                      ? 'border-crt-phosphor/35 bg-crt-bg text-crt-text'
                      : 'border-crt-phosphor bg-crt-phosphor/10 text-crt-text'
                    : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        isActive
                          ? releaseTypeMode === 'all'
                            ? 'text-crt-text'
                            : 'text-crt-phosphor'
                          : 'text-crt-text'
                      }`}
                    >
                      {option.label}
                    </span>
                    {translationBadgeText && (
                      <span className="text-[11px] font-mono text-crt-phosphor tabular-nums">
                        · {translationBadgeText}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-crt-muted leading-snug">{option.description}</p>
                </div>

                <span
                  aria-hidden="true"
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                    isActive
                      ? releaseTypeMode === 'all'
                        ? 'border-crt-phosphor/50 bg-crt-phosphor/15 text-crt-phosphor'
                        : 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                      : 'border-crt-border bg-crt-surface'
                  }`}
                >
                  {isActive && <Check className="h-3 w-3" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grouped Translation Languages Sub-Panel (visible when customizing allowlist) */}
        {releaseTypeMode === 'custom' && (
          <div className="border-t border-crt-border pt-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Languages className="h-4 w-4 text-crt-phosphor shrink-0" />
                <div>
                  <h3 className="text-xs font-semibold text-crt-text">
                    Translation Language Scope
                  </h3>
                  <p className="text-[11px] text-crt-muted">
                    Select All Fan Translation Languages or pick specific target languages. Machine / AI translations remain excluded unless explicitly enabled below.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={typeFilterLockedByEnv}
                onClick={handleToggleAllFanTranslationLanguages}
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  translationsAllEnabled
                    ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
                    : 'border-crt-border bg-crt-bg text-crt-text hover:border-crt-border-strong'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center ${
                    translationsAllEnabled
                      ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                      : 'border-crt-border bg-crt-surface'
                  }`}
                >
                  {translationsAllEnabled && <Check className="h-2.5 w-2.5" />}
                </span>
                <span>All Fan Translation Languages</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {humanTranslationOptions.map((lang) => {
                const checked = translationsAllEnabled || allowedReleaseTypes.includes(lang.id);
                return (
                  <button
                    key={lang.id}
                    type="button"
                    disabled={typeFilterLockedByEnv}
                    onClick={() => handleToggleSpecificLanguage(lang.id)}
                    className={`flex items-center justify-between gap-2 px-2.5 py-2 text-xs border rounded text-left transition-colors disabled:opacity-60 ${
                      checked
                        ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-text'
                        : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                    }`}
                  >
                    <span className="truncate">
                      <span className="font-mono text-[10px] text-crt-muted mr-1.5">
                        {lang.shortCode}
                      </span>
                      <span className={checked ? 'text-crt-phosphor font-medium' : ''}>
                        {lang.label}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                        checked
                          ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                          : 'border-crt-border bg-crt-surface'
                      }`}
                    >
                      {checked && <Check className="h-2.5 w-2.5" />}
                    </span>
                  </button>
                );
              })}
            </div>

            {machineTranslationOption && (
              <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={typeFilterLockedByEnv}
                  onClick={() => handleToggleSpecificLanguage(machineTranslationOption.id)}
                  className={`inline-flex items-center gap-2.5 px-3 py-2 text-xs border rounded transition-colors disabled:opacity-60 ${
                    machineTranslationEnabled
                      ? 'border-crt-amber bg-crt-amber/10 text-crt-amber'
                      : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
                      machineTranslationEnabled
                        ? 'border-crt-amber bg-crt-amber text-crt-bg'
                        : 'border-crt-border bg-crt-surface'
                    }`}
                  >
                    {machineTranslationEnabled && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="font-mono text-[10px]">{machineTranslationOption.shortCode}</span>
                  <span className="font-medium">{machineTranslationOption.label}</span>
                  <span className="text-[11px] text-crt-muted">
                    — explicitly allow AI / automated machine translation patches
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {customTypeSelectionEmpty && (
          <div className="flex items-center gap-2.5 border border-crt-amber/40 bg-crt-amber/5 rounded px-3.5 py-2.5 text-xs text-crt-amber">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Select at least one allowed game or ROM type above before saving, or switch back to All Release Types.
            </span>
          </div>
        )}
      </section>

      {/* Prepared ROM Naming & SD Card Device Export Defaults */}
      <section className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
          <div className="flex items-start gap-3">
            <Usb className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
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

      {/* Section: Interface Branding (Custom Top-Left Header Logo / Animated Banner) */}
      <section className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-2.5 min-w-0">
            <ImageIcon className="h-4 w-4 text-crt-phosphor crt-section-icon shrink-0 mt-1" />
            <div>
              <h2 className="font-display text-base font-semibold text-crt-text">
                Interface Branding
              </h2>
              <p className="text-xs text-crt-muted">
                Replace the top-left RetroGameTalk Sync header title with a custom logo or looping animated banner across all browsers.
              </p>
            </div>
          </div>
          {customBrandLogoUrl.trim() !== '' && (
            <button
              type="button"
              onClick={() => setCustomBrandLogoUrl('')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>Restore Default Title</span>
            </button>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="custom-brand-logo-url" className="block text-xs text-crt-muted">
            Custom Logo / Banner URL
          </label>
          <input
            id="custom-brand-logo-url"
            type="text"
            value={customBrandLogoUrl}
            onChange={(e) => setCustomBrandLogoUrl(e.target.value)}
            placeholder="https://example.com/retro-banner.gif (leave blank for default title)"
            className="w-full px-3 py-2 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted/50 focus:outline-none focus:border-crt-phosphor"
          />
          <p className="text-[11px] font-mono text-crt-muted">
            Supports static and looping animated GIF, APNG, WebP, PNG, SVG, or looping MP4 / WebM URLs. Automatically constrained to header height (32px max).
          </p>
        </div>

        {/* Simulated Sticky Top Header Preview */}
        <div className="border border-crt-border bg-crt-bg rounded overflow-hidden">
          <div className="px-3.5 py-2 border-b border-crt-border/70 flex items-center justify-between gap-2 text-[11px] font-mono text-crt-muted">
            <span>Top-Left Header Preview</span>
            <span>
              {!customBrandLogoUrl.trim()
                ? 'Default wordmark'
                : brandPreviewError
                  ? 'Load failed · falling back to title'
                  : 'Constrained to 32px height'}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-4 bg-crt-bg/95">
            <div className="inline-flex items-center min-h-8">
              <BrandMark
                url={customBrandLogoUrl}
                onMediaLoad={() => setBrandPreviewError(false)}
                onMediaError={() => setBrandPreviewError(true)}
              />
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-crt-muted/50 select-none">
              <span>Incremental · Full</span>
              <span aria-hidden="true">·</span>
              <span>Run Sync</span>
            </div>
          </div>
          {brandPreviewError && customBrandLogoUrl.trim() !== '' && (
            <div className="px-3.5 py-2 border-t border-crt-amber/30 bg-crt-amber/5 flex items-center gap-2 text-[11px] font-mono text-crt-amber">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Could not load this media URL in the browser. Verify the link is reachable and publicly readable—until fixed, the header displays the default title.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Sticky Dirty-Only Save / Discard Bar */}
      {(dirtyState.isDirty || saving || Boolean(saveErr) || Boolean(saveMsg)) && (
        <div
          role="region"
          aria-label="Operations configuration save actions"
          className={`sticky bottom-3 z-20 border rounded-md px-4 py-3 shadow-[0_-8px_28px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md transition-colors ${
            saveErr
              ? 'border-crt-crimson/60 bg-crt-surface/95'
              : dirtyState.isDirty
                ? 'border-crt-amber/60 bg-crt-surface/95'
                : 'border-crt-phosphor/50 bg-crt-surface/95'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-xs">
              {saveErr ? (
                <div className="flex items-center gap-2 text-crt-crimson font-mono">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="break-words">{saveErr}</span>
                </div>
              ) : dirtyState.isDirty ? (
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-crt-amber font-medium">
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Unsaved changes</span>
                    </span>
                    <span className="font-mono font-normal text-crt-text truncate">
                      · {dirtyState.changedSections.join(', ')}
                    </span>
                  </div>
                  {customTypeSelectionEmpty && (
                    <p className="text-[11px] font-mono text-crt-amber/90">
                      Select at least one release type or switch back to All Release Types before saving.
                    </p>
                  )}
                </div>
              ) : saveMsg ? (
                <div className="flex items-center gap-2 text-crt-phosphor font-mono">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{saveMsg}</span>
                </div>
              ) : null}
            </div>

            {(dirtyState.isDirty || saving || Boolean(saveErr)) && (
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                  type="button"
                  disabled={saving || !dirtyState.isDirty}
                  onClick={discardChanges}
                  className="px-3 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={saving || customTypeSelectionEmpty || !dirtyState.isDirty}
                  className="crt-cta-beam inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </form>
  );
});

