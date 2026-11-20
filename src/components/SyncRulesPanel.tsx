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
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Filter,
  Gamepad2,
  KeyRound,
  Languages,
  Pause,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useSectionSpotlight } from '../hooks/useSectionSpotlight';
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
import {
  DAILY_TIME_PRESETS,
  INTERVAL_HOUR_OPTIONS,
  MINUTE_PRESET_OPTIONS,
  WEEKDAY_OPTIONS,
  buildCronFromVisualState,
  describeCronExpression,
  formatUtcTime,
  parseCronToVisualState,
  validateCronExpression,
  type ScheduleVisualMode,
} from '../shared/syncSchedule';
import {
  canonicalizeSystemSlug,
  filterValidSystemSlugs,
  groupSystemsByBrand,
  resolveSystemDisplayInfo,
} from '../shared/systemCatalog';
import type {
  ConfigDirtyState,
  ConfigFocusRequest,
  ConfigPanelHandle,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  SyncPreflightSummary,
} from '../types';
import { formatDateTime } from '../utils/format';
import { ConfigSaveBar } from './ConfigSaveBar';
import { EnvLockIndicator } from './EnvLockIndicator';

interface SyncRulesPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  preflight?: SyncPreflightSummary | null;
  focusRequest?: ConfigFocusRequest | null;
  onDirtyChange?: (state: ConfigDirtyState) => void;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
  onStartCatalogIndex?: (scope: 'filtered' | 'full') => Promise<void>;
  onStopCatalogIndex?: () => Promise<void>;
  onPreviewRuleMatchesInCatalog?: () => void;
  onNavigateToAuth?: () => void;
}

function canonicalSystemFilterKey(raw: string): string {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const lower = canonicalizeSystemSlug(trimmed).toLowerCase();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    list.push(lower);
  }
  return list.sort((a, b) => a.localeCompare(b)).join(',');
}

const SCHEDULE_MODES: { id: ScheduleVisualMode; label: string }[] = [
  { id: 'interval', label: 'Every X Hours' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'custom', label: 'Custom Cron' },
];

const FOUR_WAY_GLIDER_OFFSET: Record<ScheduleVisualMode, string> = {
  interval: 'translate-x-0',
  daily: 'translate-x-full',
  weekly: 'translate-x-[200%]',
  custom: 'translate-x-[300%]',
};

const HOURS_0_TO_23 = Array.from({ length: 24 }, (_, idx) => idx);
const MINUTES_0_TO_59 = Array.from({ length: 60 }, (_, idx) => idx);

export const SyncRulesPanel = forwardRef<ConfigPanelHandle, SyncRulesPanelProps>(
  function SyncRulesPanel(
    {
      config,
      status,
      preflight = null,
      focusRequest = null,
      onDirtyChange,
      onSaveConfig,
      onStartCatalogIndex,
      onStopCatalogIndex,
      onPreviewRuleMatchesInCatalog,
      onNavigateToAuth,
    },
    ref,
  ) {
    const initialParsedSchedule = useMemo(
      () => parseCronToVisualState(config.cronSchedule),
      [config.cronSchedule],
    );

    const [scheduleEnabled, setScheduleEnabled] = useState(config.scheduleEnabled);
    const [autoDownloadNewReleases, setAutoDownloadNewReleases] = useState(
      config.autoDownloadNewReleases,
    );
    const [cronSchedule, setCronSchedule] = useState(config.cronSchedule);
    const [scheduleMode, setScheduleMode] = useState<ScheduleVisualMode>(initialParsedSchedule.mode);
    const [everyHours, setEveryHours] = useState<number>(initialParsedSchedule.everyHours);
    const [scheduleHour, setScheduleHour] = useState<number>(initialParsedSchedule.hour);
    const [scheduleMinute, setScheduleMinute] = useState<number>(initialParsedSchedule.minute);
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initialParsedSchedule.daysOfWeek);

    const [systemFilter, setSystemFilter] = useState(config.systemFilter);
    const [indexerBusy, setIndexerBusy] = useState(false);
    const [consoleSearch, setConsoleSearch] = useState('');
    const [showAdvancedSystemFilter, setShowAdvancedSystemFilter] = useState(false);

    const [releaseTypeMode, setReleaseTypeMode] = useState<'all' | 'custom'>(
      config.allowedReleaseTypes.length > 0 ? 'custom' : 'all',
    );
    const [allowedReleaseTypes, setAllowedReleaseTypes] = useState<string[]>(() =>
      normalizeAllowedReleaseTypes(config.allowedReleaseTypes),
    );

    const scheduleSectionRef = useRef<HTMLElement | null>(null);
    const systemsSectionRef = useRef<HTMLElement | null>(null);
    const releaseTypesSectionRef = useRef<HTMLElement | null>(null);
    const sectionRefs = useMemo(
      () => ({
        schedule: scheduleSectionRef,
        systems: systemsSectionRef,
        releaseTypes: releaseTypesSectionRef,
      }),
      [],
    );
    const spotlight = useSectionSpotlight(focusRequest, sectionRefs);

    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<string | null>(null);
    const [saveErr, setSaveErr] = useState<string | null>(null);
    const isDirtyRef = useRef(false);
    const saveNoticeTimerRef = useRef<number | null>(null);

    const cronLockedByEnv = config.envOverrides.includes('CRON_SCHEDULE');
    const scheduleEnabledLockedByEnv = config.envOverrides.includes('SCRAPER_SCHEDULE_ENABLED');
    const autoDownloadLockedByEnv = config.envOverrides.includes('SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES');
    const filterLockedByEnv = config.envOverrides.includes('SCRAPER_SYSTEM_FILTER');
    const typeFilterLockedByEnv = config.envOverrides.includes('SCRAPER_RELEASE_TYPE_FILTER');

    const resetFormToConfig = useCallback((target: ScraperConfigPublic) => {
      const parsed = parseCronToVisualState(target.cronSchedule);
      setScheduleEnabled(target.scheduleEnabled);
      setAutoDownloadNewReleases(target.autoDownloadNewReleases);
      setCronSchedule(target.cronSchedule);
      setScheduleMode(parsed.mode);
      setEveryHours(parsed.everyHours);
      setScheduleHour(parsed.hour);
      setScheduleMinute(parsed.minute);
      setDaysOfWeek(parsed.daysOfWeek);

      setSystemFilter(target.systemFilter);
      const normalizedTypes = normalizeAllowedReleaseTypes(target.allowedReleaseTypes);
      setAllowedReleaseTypes(normalizedTypes);
      setReleaseTypeMode(normalizedTypes.length > 0 ? 'custom' : 'all');
    }, []);

    useEffect(() => {
      if (!isDirtyRef.current) {
        resetFormToConfig(config);
      }
    }, [config, resetFormToConfig]);

    // Schedule mode & builder handlers
    const handleSelectScheduleMode = (nextMode: ScheduleVisualMode) => {
      if (cronLockedByEnv) return;
      setScheduleMode(nextMode);
      if (nextMode === 'custom') {
        return;
      }
      const nextCron = buildCronFromVisualState({
        mode: nextMode,
        everyHours,
        hour: scheduleHour,
        minute: scheduleMinute,
        daysOfWeek,
      });
      setCronSchedule(nextCron);
    };

    const handleSelectIntervalHours = (hours: number) => {
      if (cronLockedByEnv) return;
      setScheduleMode('interval');
      setEveryHours(hours);
      setCronSchedule(
        buildCronFromVisualState({
          mode: 'interval',
          everyHours: hours,
          hour: scheduleHour,
          minute: scheduleMinute,
          daysOfWeek,
        }),
      );
    };

    const handleChangeMinute = (nextMinute: number) => {
      if (cronLockedByEnv) return;
      const clamped = Math.max(0, Math.min(59, Math.trunc(nextMinute)));
      setScheduleMinute(clamped);
      if (scheduleMode !== 'custom') {
        setCronSchedule(
          buildCronFromVisualState({
            mode: scheduleMode,
            everyHours,
            hour: scheduleHour,
            minute: clamped,
            daysOfWeek,
          }),
        );
      }
    };

    const handleChangeHour = (nextHour: number) => {
      if (cronLockedByEnv) return;
      const clamped = Math.max(0, Math.min(23, Math.trunc(nextHour)));
      setScheduleHour(clamped);
      if (scheduleMode === 'daily' || scheduleMode === 'weekly') {
        setCronSchedule(
          buildCronFromVisualState({
            mode: scheduleMode,
            everyHours,
            hour: clamped,
            minute: scheduleMinute,
            daysOfWeek,
          }),
        );
      }
    };

    const handleSelectDailyPreset = (hour: number, minute: number) => {
      if (cronLockedByEnv) return;
      setScheduleMode('daily');
      setScheduleHour(hour);
      setScheduleMinute(minute);
      setCronSchedule(
        buildCronFromVisualState({
          mode: 'daily',
          everyHours,
          hour,
          minute,
          daysOfWeek,
        }),
      );
    };

    const handleToggleWeekday = (dayValue: number) => {
      if (cronLockedByEnv) return;
      setScheduleMode('weekly');
      const exists = daysOfWeek.includes(dayValue);
      const nextDays = exists
        ? daysOfWeek.length > 1
          ? daysOfWeek.filter((d) => d !== dayValue)
          : daysOfWeek
        : [...daysOfWeek, dayValue].sort((a, b) => a - b);
      setDaysOfWeek(nextDays);
      setCronSchedule(
        buildCronFromVisualState({
          mode: 'weekly',
          everyHours,
          hour: scheduleHour,
          minute: scheduleMinute,
          daysOfWeek: nextDays,
        }),
      );
    };

    const cronValidation = useMemo(() => validateCronExpression(cronSchedule), [cronSchedule]);
    const scheduleSummaryText = useMemo(
      () => describeCronExpression(cronSchedule),
      [cronSchedule],
    );

    // Target consoles helpers
    const selectedSystems = useMemo(
      () => new Set(filterValidSystemSlugs(systemFilter.split(','))),
      [systemFilter],
    );

    const selectedSystemsLower = useMemo(
      () => new Set(Array.from(selectedSystems).map((s) => s.toLowerCase())),
      [selectedSystems],
    );

    const availableSystems = useMemo(
      () =>
        filterValidSystemSlugs([
          ...config.discoveredSystems,
          ...status.systems.map((s) => s.systemName),
          ...Array.from(selectedSystems),
        ]),
      [config.discoveredSystems, status.systems, selectedSystems],
    );

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
          info.brandLabel.toLowerCase().includes(q) ||
          info.aliases.some((alias) => alias.toLowerCase().includes(q))
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

    // Release type helpers
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

    // Dirty state & Save payload
    const dirtyState = useMemo<ConfigDirtyState>(() => {
      const changedSections: string[] = [];

      const scheduleChanged =
        (!scheduleEnabledLockedByEnv && scheduleEnabled !== config.scheduleEnabled) ||
        (!autoDownloadLockedByEnv && autoDownloadNewReleases !== config.autoDownloadNewReleases) ||
        (!cronLockedByEnv && cronSchedule.trim() !== config.cronSchedule.trim());
      if (scheduleChanged) changedSections.push('Sync Schedule');

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
      if (releaseTypesChanged) changedSections.push('Allowed Types');

      return {
        isDirty: changedSections.length > 0,
        changedSections,
      };
    }, [
      config,
      scheduleEnabled,
      autoDownloadNewReleases,
      cronSchedule,
      systemFilter,
      releaseTypeMode,
      allowedReleaseTypes,
      scheduleEnabledLockedByEnv,
      autoDownloadLockedByEnv,
      cronLockedByEnv,
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
      if (!cronLockedByEnv && !cronValidation.valid) {
        setSaveErr(cronValidation.error || 'Enter a valid 5-field cron schedule.');
        setSaveMsg(null);
        return false;
      }
      if (customTypeSelectionEmpty) {
        setSaveErr('Select at least one allowed game or ROM type, or switch to All Release Types.');
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
        await onSaveConfig({
          ...(!scheduleEnabledLockedByEnv ? { scheduleEnabled } : {}),
          ...(!autoDownloadLockedByEnv ? { autoDownloadNewReleases } : {}),
          ...(!cronLockedByEnv ? { cronSchedule: cronSchedule.trim() } : {}),
          ...(!filterLockedByEnv ? { systemFilter } : {}),
          ...(!typeFilterLockedByEnv
            ? { allowedReleaseTypes: releaseTypeMode === 'all' ? [] : allowedReleaseTypes }
            : {}),
        });
        isDirtyRef.current = false;
        setSaveMsg('Sync Rules saved');
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
    }, [
      cronLockedByEnv,
      cronValidation,
      customTypeSelectionEmpty,
      onSaveConfig,
      scheduleEnabledLockedByEnv,
      scheduleEnabled,
      autoDownloadLockedByEnv,
      autoDownloadNewReleases,
      cronSchedule,
      filterLockedByEnv,
      systemFilter,
      typeFilterLockedByEnv,
      releaseTypeMode,
      allowedReleaseTypes,
    ]);

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

    const validationHint =
      !cronLockedByEnv && !cronValidation.valid
        ? cronValidation.error
        : customTypeSelectionEmpty
          ? 'Select at least one release type or switch back to All Release Types before saving.'
          : null;

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveConfiguration();
        }}
        className="space-y-6 max-w-5xl"
      >
        {/* 1. Automatic Sync Schedule */}
        <section
          ref={scheduleSectionRef}
          className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {spotlight?.target === 'schedule' && (
            <div
              key={`schedule-${spotlight.nonce}`}
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
            />
          )}

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Automatic Sync Schedule
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Automatically runs Incremental Sync checks in the background to mirror releases added or updated since your cutoff timestamp.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1.5 shrink-0">
              <button
                type="button"
                role="switch"
                aria-checked={scheduleEnabled}
                disabled={scheduleEnabledLockedByEnv}
                onClick={() => setScheduleEnabled((v) => !v)}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-mono border rounded transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  scheduleEnabled
                    ? 'border-crt-phosphor text-crt-phosphor bg-crt-phosphor/10'
                    : 'border-crt-border text-crt-muted bg-crt-bg hover:text-crt-text hover:border-crt-border-strong'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full transition-colors ${
                    scheduleEnabled ? 'bg-crt-phosphor' : 'bg-crt-muted/50'
                  }`}
                />
                <span>{scheduleEnabled ? 'Automatic Sync: Enabled' : 'Automatic Sync: Paused'}</span>
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {scheduleEnabledLockedByEnv && (
                  <EnvLockIndicator envVar="SCRAPER_SCHEDULE_ENABLED" />
                )}
                {cronLockedByEnv && <EnvLockIndicator envVar="CRON_SCHEDULE" />}
              </div>
            </div>
          </div>

          {/* 4-Mode Gliding Frequency Switcher */}
          <div className="space-y-4">
            <div
              role="tablist"
              aria-label="Schedule frequency mode"
              className="relative grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-0 p-1 bg-crt-bg border border-crt-border rounded-md"
            >
              <span
                aria-hidden="true"
                className={`hidden sm:block pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/4)] rounded bg-crt-elevated border border-crt-border-strong transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${FOUR_WAY_GLIDER_OFFSET[scheduleMode]}`}
              />
              {SCHEDULE_MODES.map((m) => {
                const active = scheduleMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={cronLockedByEnv}
                    onClick={() => handleSelectScheduleMode(m.id)}
                    className={`relative z-10 px-3 py-2 text-xs font-medium rounded transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${
                      active
                        ? 'text-crt-phosphor bg-crt-elevated sm:bg-transparent border border-crt-border-strong sm:border-transparent'
                        : 'text-crt-muted hover:text-crt-text border border-transparent'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Mode Content Surface */}
            <div className="border border-crt-border bg-crt-bg rounded-md p-4 space-y-4">
              {scheduleMode === 'interval' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="block text-xs font-medium text-crt-text">
                      Check for new releases every:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {INTERVAL_HOUR_OPTIONS.map((hrs) => {
                        const active = everyHours === hrs;
                        return (
                          <button
                            key={hrs}
                            type="button"
                            disabled={cronLockedByEnv}
                            onClick={() => handleSelectIntervalHours(hrs)}
                            className={`px-3.5 py-2 text-xs font-mono tabular-nums border rounded transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 ${
                              active
                                ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor font-semibold'
                                : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                            }`}
                          >
                            {hrs === 1 ? 'Every Hour' : `Every ${hrs} Hours`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-crt-border/70">
                    <span className="text-xs text-crt-muted">Minute past the hour (UTC):</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {MINUTE_PRESET_OPTIONS.map((min) => {
                        const active = scheduleMinute === min;
                        return (
                          <button
                            key={min}
                            type="button"
                            disabled={cronLockedByEnv}
                            onClick={() => handleChangeMinute(min)}
                            className={`px-2.5 py-1 text-xs font-mono tabular-nums border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 ${
                              active
                                ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
                                : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text'
                            }`}
                          >
                            :{String(min).padStart(2, '0')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {scheduleMode === 'daily' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="block text-xs font-medium text-crt-text">
                      Quick Daily Windows (UTC / Container Time)
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {DAILY_TIME_PRESETS.map((preset) => {
                        const active =
                          scheduleHour === preset.hour && scheduleMinute === preset.minute;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            disabled={cronLockedByEnv}
                            onClick={() => handleSelectDailyPreset(preset.hour, preset.minute)}
                            className={`px-3 py-1.5 text-xs font-mono tabular-nums border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 ${
                              active
                                ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor font-semibold'
                                : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-4 pt-1 border-t border-crt-border/70">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-mono text-crt-muted">
                        Hour (UTC 00–23)
                      </label>
                      <select
                        aria-label="Daily sync UTC hour"
                        value={scheduleHour}
                        disabled={cronLockedByEnv}
                        onChange={(e) => handleChangeHour(Number(e.target.value))}
                        className="px-3 py-1.5 text-xs font-mono tabular-nums bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      >
                        {HOURS_0_TO_23.map((h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-mono text-crt-muted">
                        Minute (00–59)
                      </label>
                      <select
                        aria-label="Daily sync UTC minute"
                        value={scheduleMinute}
                        disabled={cronLockedByEnv}
                        onChange={(e) => handleChangeMinute(Number(e.target.value))}
                        className="px-3 py-1.5 text-xs font-mono tabular-nums bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      >
                        {MINUTES_0_TO_59.map((m) => (
                          <option key={m} value={m}>
                            :{String(m).padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    </div>

                    <span className="pb-1.5 text-xs font-mono text-crt-phosphor tabular-nums">
                      Runs every day at {formatUtcTime(scheduleHour, scheduleMinute)}
                    </span>
                  </div>
                </div>
              )}

              {scheduleMode === 'weekly' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="block text-xs font-medium text-crt-text">
                      Days of the Week
                    </span>
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                      {WEEKDAY_OPTIONS.map((day) => {
                        const checked = daysOfWeek.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            disabled={cronLockedByEnv}
                            title={day.fullLabel}
                            onClick={() => handleToggleWeekday(day.value)}
                            className={`px-2.5 py-2 text-xs font-mono border rounded transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-55 ${
                              checked
                                ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor font-semibold'
                                : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                            }`}
                          >
                            <span>{day.shortLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-4 pt-1 border-t border-crt-border/70">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-mono text-crt-muted">
                        Hour (UTC 00–23)
                      </label>
                      <select
                        aria-label="Weekly sync UTC hour"
                        value={scheduleHour}
                        disabled={cronLockedByEnv}
                        onChange={(e) => handleChangeHour(Number(e.target.value))}
                        className="px-3 py-1.5 text-xs font-mono tabular-nums bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      >
                        {HOURS_0_TO_23.map((h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-mono text-crt-muted">
                        Minute (00–59)
                      </label>
                      <select
                        aria-label="Weekly sync UTC minute"
                        value={scheduleMinute}
                        disabled={cronLockedByEnv}
                        onChange={(e) => handleChangeMinute(Number(e.target.value))}
                        className="px-3 py-1.5 text-xs font-mono tabular-nums bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                      >
                        {MINUTES_0_TO_59.map((m) => (
                          <option key={m} value={m}>
                            :{String(m).padStart(2, '0')}
                          </option>
                        ))}
                      </select>
                    </div>

                    <span className="pb-1.5 text-xs font-mono text-crt-phosphor tabular-nums">
                      {scheduleSummaryText}
                    </span>
                  </div>
                </div>
              )}

              {scheduleMode === 'custom' && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="custom-cron-input"
                      className="text-xs font-medium text-crt-text"
                    >
                      5-Field Cron Expression (UTC / Container Time)
                    </label>
                    <span className="font-mono text-[11px] text-crt-muted">
                      minute · hour · day · month · weekday
                    </span>
                  </div>
                  <input
                    id="custom-cron-input"
                    type="text"
                    value={cronSchedule}
                    disabled={cronLockedByEnv}
                    onChange={(e) => setCronSchedule(e.target.value)}
                    placeholder="0 */6 * * *"
                    className={`w-full px-3 py-2 text-sm font-mono bg-crt-surface border rounded text-crt-text focus:outline-none disabled:opacity-60 ${
                      cronValidation.valid
                        ? 'border-crt-border focus:border-crt-phosphor'
                        : 'border-crt-crimson focus:border-crt-crimson'
                    }`}
                  />
                  {cronValidation.valid ? (
                    <p className="text-[11px] font-mono text-crt-muted">
                      Examples: <span className="text-crt-text">*/30 * * * *</span> (every 30m) ·{' '}
                      <span className="text-crt-text">15 2,14 * * *</span> (02:15 &amp; 14:15 UTC) ·{' '}
                      <span className="text-crt-text">0 4 * * 1-5</span> (weekdays 04:00 UTC)
                    </p>
                  ) : (
                    <p className="text-xs font-mono text-crt-crimson">{cronValidation.error}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Scheduled Run Acquisition Behavior */}
          <div className="border border-crt-border bg-crt-bg rounded-md p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-crt-text">
                  New Releases Behavior on Scheduled Runs
                </span>
                {autoDownloadLockedByEnv && (
                  <EnvLockIndicator envVar="SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES" />
                )}
              </div>
              <p className="text-[11px] text-crt-muted leading-relaxed">
                {autoDownloadNewReleases
                  ? 'Stage 1 indexes new and updated releases into your SQLite catalog; Stage 2 automatically mirrors items matching your Target Consoles and Allowed Types.'
                  : 'Stage 1 keeps your SQLite catalog fresh as Available during scheduled ticks; nothing downloads until you trigger a Full Sync, Queue Pending in Monitor, or cherry-pick from Catalog.'}
              </p>
            </div>
            <div
              role="group"
              aria-label="Scheduled run acquisition behavior"
              className="relative grid grid-cols-2 p-1 bg-crt-surface border border-crt-border rounded-md shrink-0"
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/2)] rounded bg-crt-elevated border border-crt-border-strong transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                  autoDownloadNewReleases ? 'translate-x-0' : 'translate-x-full'
                }`}
              />
              <button
                type="button"
                disabled={autoDownloadLockedByEnv}
                onClick={() => setAutoDownloadNewReleases(true)}
                className={`relative z-10 px-3 py-1.5 text-xs font-medium rounded transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 ${
                  autoDownloadNewReleases ? 'text-crt-phosphor' : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                Auto-Download
              </button>
              <button
                type="button"
                disabled={autoDownloadLockedByEnv}
                onClick={() => setAutoDownloadNewReleases(false)}
                className={`relative z-10 px-3 py-1.5 text-xs font-medium rounded transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-55 ${
                  !autoDownloadNewReleases ? 'text-crt-phosphor' : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                Index Only
              </button>
            </div>
          </div>

          {/* Schedule Status & Cutoff Readout */}
          <div className="pt-1 text-xs font-mono text-crt-muted tabular-nums flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-crt-text">{scheduleSummaryText}</span>
              <span aria-hidden="true">·</span>
              <span>Cron: {cronSchedule.trim() || '—'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Next Run:{' '}
                <span className={scheduleEnabled ? 'text-crt-phosphor' : 'text-crt-muted'}>
                  {scheduleEnabled ? formatDateTime(status.nextScheduledRunAt) : 'Paused'}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Incremental Cutoff:{' '}
                {config.lastWatermarkAt
                  ? formatDateTime(config.lastWatermarkAt)
                  : 'Last 24h (default)'}
              </span>
            </div>
          </div>
        </section>

        {/* 2. Target Consoles & Systems */}
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
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Target Consoles &amp; Systems
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Choose specific hardware platforms to mirror, or leave all unchecked to mirror every valid discovered system. Non-system site pages are excluded automatically.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1.5 text-xs font-mono text-crt-text tabular-nums shrink-0">
              <div>
                Scope:{' '}
                <span className={selectedSystems.size > 0 ? 'text-crt-amber' : 'text-crt-phosphor'}>
                  {selectedSystems.size === 0
                    ? 'All Consoles (Unfiltered)'
                    : `${selectedSystems.size} of ${availableSystems.length} selected`}
                </span>
                {preflight && (
                  <>
                    <span aria-hidden="true" className="text-crt-muted">{' · '}</span>
                    <span className="text-crt-muted">
                      {preflight.pendingDownloadCount.toLocaleString()} pending
                    </span>
                  </>
                )}
              </div>
              {onPreviewRuleMatchesInCatalog && (
                <button
                  type="button"
                  onClick={onPreviewRuleMatchesInCatalog}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text hover:text-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Preview Matches in Catalog</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                </button>
              )}
              {filterLockedByEnv && (
                <EnvLockIndicator
                  envVar="SCRAPER_SYSTEM_FILTER"
                  detail={`Console selection is locked by SCRAPER_SYSTEM_FILTER=${systemFilter} (read-only)`}
                />
              )}
            </div>
          </div>

          {/* Background Catalog Indexer Strip */}
          {(onStartCatalogIndex || onStopCatalogIndex) && status.auth.hasCompletedLogin && status.indexer && (() => {
            const indexer = status.indexer;
            const staleCount = preflight?.staleConsoles.length ?? 0;
            const unindexedCount = preflight?.unindexedConsoles.length ?? 0;
            const readinessIssues: string[] = [];
            if (unindexedCount > 0) readinessIssues.push(`${unindexedCount} unindexed`);
            if (staleCount > 0) readinessIssues.push(`${staleCount} stale (>12h)`);
            return (
              <div className="border border-crt-border bg-crt-bg rounded-md px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
                    <span className="font-semibold text-crt-text">Catalog Metadata Indexer</span>
                    <span aria-hidden="true" className="text-crt-muted">·</span>
                    {indexer.active ? (
                      <span className="text-crt-phosphor">
                        Indexing {indexer.systemsCompleted + (indexer.currentSystem ? 1 : 0)}/
                        {Math.max(1, indexer.systemsTotal)}
                        {indexer.currentSystem ? ` · ${indexer.currentSystem}` : ''}
                        {indexer.totalPages > 0
                          ? ` · Page ${indexer.currentPage}/${indexer.totalPages}`
                          : ''}
                        {` · ${indexer.indexedCount} cataloged`}
                      </span>
                    ) : readinessIssues.length > 0 ? (
                      <span className="text-crt-amber">
                        {readinessIssues.join(' · ')} target console{unindexedCount + staleCount === 1 ? '' : 's'} — auto-refreshed before Full Sync
                      </span>
                    ) : (
                      <span className="text-crt-muted">
                        {indexer.remainingUnindexedSystems > 0
                          ? `All target consoles fresh · ${indexer.remainingUnindexedSystems} extra console(s) unindexed`
                          : 'All target consoles indexed & fresh'}
                      </span>
                    )}
                  </div>
                  {indexer.active && (
                    <div className="h-1 w-full max-w-md bg-crt-surface border border-crt-border rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-crt-phosphor crt-indexer-bar"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              6,
                              Math.round(
                                ((indexer.systemsCompleted +
                                  (indexer.totalPages > 0
                                    ? indexer.currentPage / indexer.totalPages
                                    : 0)) /
                                  Math.max(1, indexer.systemsTotal)) *
                                  100,
                              ),
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {indexer.active ? (
                    <button
                      type="button"
                      disabled={indexerBusy}
                      onClick={async () => {
                        if (!onStopCatalogIndex) return;
                        setIndexerBusy(true);
                        try {
                          await onStopCatalogIndex();
                        } finally {
                          setIndexerBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-amber/60 text-crt-amber hover:bg-crt-amber/10 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <Pause className="h-3.5 w-3.5" />
                      Pause Indexing
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={indexerBusy || !onStartCatalogIndex}
                        onClick={async () => {
                          if (!onStartCatalogIndex) return;
                          setIndexerBusy(true);
                          try {
                            await onStartCatalogIndex('filtered');
                          } finally {
                            setIndexerBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface hover:border-crt-phosphor text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${indexerBusy ? 'animate-spin' : ''}`} />
                        Index Target Consoles
                      </button>
                      {indexer.remainingUnindexedSystems > 0 && (
                        <button
                          type="button"
                          disabled={indexerBusy || !onStartCatalogIndex}
                          onClick={async () => {
                            if (!onStartCatalogIndex) return;
                            setIndexerBusy(true);
                            try {
                              await onStartCatalogIndex('full');
                            } finally {
                              setIndexerBusy(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          Index All Remaining Consoles ({indexer.remainingUnindexedSystems})
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {availableSystems.length === 0 ? (
            <div className="border border-crt-border bg-crt-bg rounded p-6 text-center space-y-3">
              <p className="text-sm text-crt-text font-medium">No consoles discovered yet</p>
              <p className="text-xs text-crt-muted max-w-md mx-auto">
                Verify your RetroGameTalk account in System Settings to authenticate and discover available console platforms.
              </p>
              {onNavigateToAuth && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={onNavigateToAuth}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Open System Settings</span>
                  </button>
                </div>
              )}
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
                    onClick={() => setSystemFilter(availableSystems.join(','))}
                    className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    Select All ({availableSystems.length})
                  </button>
                  <button
                    type="button"
                    disabled={filterLockedByEnv || selectedSystems.size === 0}
                    onClick={() => setSystemFilter('')}
                    className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
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
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
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
                    className="px-3 py-1 text-xs font-mono border border-crt-border bg-crt-surface hover:border-crt-phosphor text-crt-phosphor rounded transition-colors cursor-pointer"
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
                                className="text-crt-phosphor hover:underline whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:no-underline"
                              >
                                Select {brand.shortLabel}
                              </button>
                            )}
                            {selectedInBrand > 0 && (
                              <button
                                type="button"
                                disabled={filterLockedByEnv}
                                onClick={() => setBrandGroupSelection(brandSlugs, false)}
                                className="text-crt-muted hover:text-crt-text hover:underline whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:no-underline"
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
                                className={`flex items-center justify-between gap-3 px-3 py-2.5 border rounded text-left transition-colors cursor-pointer disabled:opacity-60 ${
                                  isSelected
                                    ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-text'
                                    : 'border-crt-border bg-crt-bg text-crt-muted hover:border-crt-border-strong hover:text-crt-text'
                                }`}
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div
                                    className={`text-xs truncate ${
                                      isSelected
                                        ? 'text-crt-phosphor font-semibold'
                                        : 'text-crt-text font-medium'
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

          {/* Smooth Collapsible Advanced Raw Filter String */}
          <div className="border-t border-crt-border pt-3">
            <button
              type="button"
              aria-expanded={showAdvancedSystemFilter}
              onClick={() => setShowAdvancedSystemFilter((v) => !v)}
              className="w-full flex items-center justify-between gap-3 text-left text-xs text-crt-muted hover:text-crt-text transition-colors cursor-pointer"
            >
              <span className="font-medium">Advanced: Raw Console Slug List</span>
              <span className="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums shrink-0">
                <span>
                  {selectedSystems.size > 0
                    ? `${selectedSystems.size} slug(s) active`
                    : 'All systems (unfiltered)'}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${
                    showAdvancedSystemFilter ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </button>

            <div
              aria-hidden={!showAdvancedSystemFilter}
              inert={!showAdvancedSystemFilter || undefined}
              data-open={showAdvancedSystemFilter ? 'true' : 'false'}
              className={`crt-accordion-grid transition-opacity duration-200 motion-reduce:transition-none ${
                showAdvancedSystemFilter ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="crt-accordion-inner">
                <div className="space-y-1.5 pt-3">
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
              </div>
            </div>
          </div>
        </section>

        {/* 3. Allowed Game & ROM Types */}
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
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Allowed Game &amp; ROM Types
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Choose which release categories and translation languages are downloaded across synced systems. Disallowed releases are skipped before resolving download links.
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

          {/* Gliding 2-Way Mode Switcher + Quick Presets */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Release type filter mode"
              className="relative grid grid-cols-2 p-1 bg-crt-bg border border-crt-border rounded-md"
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/2)] rounded bg-crt-elevated border border-crt-border-strong transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                  releaseTypeMode === 'custom' ? 'translate-x-full' : 'translate-x-0'
                }`}
              />
              <button
                type="button"
                disabled={typeFilterLockedByEnv}
                onClick={() => handleSelectReleaseTypeMode('all')}
                className={`relative z-10 px-3.5 py-1.5 text-xs font-medium rounded transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                  releaseTypeMode === 'all' ? 'text-crt-phosphor' : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                All Release Types
              </button>
              <button
                type="button"
                disabled={typeFilterLockedByEnv}
                onClick={() => handleSelectReleaseTypeMode('custom')}
                className={`relative z-10 px-3.5 py-1.5 text-xs font-medium rounded transition-colors duration-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                  releaseTypeMode === 'custom'
                    ? 'text-crt-phosphor'
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
                    className={`px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
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
                  className={`p-3 text-left border rounded transition-colors flex items-start justify-between gap-3 cursor-pointer disabled:opacity-60 ${
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

          {/* Smooth Accordion Translation Languages Sub-Panel */}
          <div
            aria-hidden={releaseTypeMode !== 'custom'}
            inert={releaseTypeMode !== 'custom' || undefined}
            data-open={releaseTypeMode === 'custom' ? 'true' : 'false'}
            className={`crt-accordion-grid transition-opacity duration-250 motion-reduce:transition-none ${
              releaseTypeMode === 'custom' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="crt-accordion-inner">
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
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
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
                        className={`flex items-center justify-between gap-2 px-2.5 py-2 text-xs border rounded text-left transition-colors cursor-pointer disabled:opacity-60 ${
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
                      className={`inline-flex items-center gap-2.5 px-3 py-2 text-xs border rounded transition-colors cursor-pointer disabled:opacity-60 ${
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
                      <span className="font-mono text-[10px]">
                        {machineTranslationOption.shortCode}
                      </span>
                      <span className="font-medium">{machineTranslationOption.label}</span>
                      <span className="text-[11px] text-crt-muted">
                        — explicitly allow AI / automated machine translation patches
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {customTypeSelectionEmpty && (
            <div className="flex items-center gap-2.5 border border-crt-amber/40 bg-crt-amber/5 rounded px-3.5 py-2.5 text-xs text-crt-amber">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Select at least one allowed game or ROM type above before saving, or switch back to All Release Types.
              </span>
            </div>
          )}
        </section>

        <ConfigSaveBar
          ariaLabel="Sync Rules configuration save actions"
          dirtyState={dirtyState}
          saving={saving}
          saveMsg={saveMsg}
          saveErr={saveErr}
          validationHint={validationHint}
          saveDisabled={customTypeSelectionEmpty || (!cronLockedByEnv && !cronValidation.valid)}
          onDiscard={discardChanges}
        />
      </form>
    );
  },
);
