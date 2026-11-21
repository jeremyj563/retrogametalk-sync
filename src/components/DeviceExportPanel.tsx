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
  ChevronDown,
  ChevronUp,
  FileText,
  FolderSearch,
  HardDrive,
  Loader2,
  Pin,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { useSectionSpotlight } from '../hooks/useSectionSpotlight';
import {
  appendNamingToken,
  buildLiveExportDestinations,
  composeEffectiveStorageFolderConfig,
  findActiveNamingPreset,
  resolveConsolePathSource,
  ROM_NAMING_TOKEN_HELPERS,
  shouldAutoExpandAdvancedNaming,
  summarizeNamingOptions,
} from '../shared/deviceExportUi';
import { ROM_NAMING_PRESETS } from '../shared/romNaming';
import {
  canonicalStorageFolderConfigJson,
  getStorageRomCategoryShortLabel,
  normalizeStorageFolderConfig,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
} from '../shared/storageFolderMappings';
import { filterValidSystemSlugs } from '../shared/systemCatalog';
import type {
  ConfigDirtyState,
  ConfigFocusRequest,
  ConfigPanelHandle,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
} from '../types';
import { isFileSystemAccessSupported } from '../utils/sdCardFs';
import { ConfigSaveBar } from './ConfigSaveBar';
import { StorageFolderMappingsSection } from './StorageFolderMappingsSection';

interface DeviceExportPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  installer?: BulkStorageInstallerController;
  focusRequest?: ConfigFocusRequest | null;
  onDirtyChange?: (state: ConfigDirtyState) => void;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
}

export const DeviceExportPanel = forwardRef<ConfigPanelHandle, DeviceExportPanelProps>(
  function DeviceExportPanel(
    {
      config,
      status,
      installer,
      focusRequest = null,
      onDirtyChange,
      onSaveConfig,
    },
    ref,
  ) {
    const [romNamingTemplate, setRomNamingTemplate] = useState(config.romNamingTemplate);
    const [romSanitizeFat32, setRomSanitizeFat32] = useState(config.romSanitizeFat32);
    const [romMaxFilenameLen, setRomMaxFilenameLen] = useState(config.romMaxFilenameLen);
    const [storageFolderConfig, setStorageFolderConfig] = useState<StorageFolderMappingConfig>(
      () => normalizeStorageFolderConfig(config.storageFolderConfig),
    );
    const [showAdvancedNaming, setShowAdvancedNaming] = useState<boolean>(() =>
      shouldAutoExpandAdvancedNaming({
        romNamingTemplate: config.romNamingTemplate,
        romSanitizeFat32: config.romSanitizeFat32,
        romMaxFilenameLen: config.romMaxFilenameLen,
      }),
    );
    const [showDetectedFolders, setShowDetectedFolders] = useState<boolean>(false);
    const [showUnmatchedFolders, setShowUnmatchedFolders] = useState<boolean>(false);
    const [pinOverrideRequest, setPinOverrideRequest] = useState<{
      slug: string;
      nonce: number;
    } | null>(null);

    const romNamingSectionRef = useRef<HTMLElement | null>(null);
    const storageMappingsSectionRef = useRef<HTMLElement | null>(null);
    const sectionRefs = useMemo(
      () => ({
        romNaming: romNamingSectionRef,
        storageMappings: storageMappingsSectionRef,
      }),
      [],
    );
    const spotlight = useSectionSpotlight(focusRequest, sectionRefs);

    const fsSupport = useMemo(() => isFileSystemAccessSupported(), []);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<string | null>(null);
    const [saveErr, setSaveErr] = useState<string | null>(null);
    const isDirtyRef = useRef(false);
    const saveNoticeTimerRef = useRef<number | null>(null);

    const resetFormToConfig = useCallback((target: ScraperConfigPublic) => {
      setRomNamingTemplate(target.romNamingTemplate);
      setRomSanitizeFat32(target.romSanitizeFat32);
      setRomMaxFilenameLen(target.romMaxFilenameLen);
      setStorageFolderConfig(normalizeStorageFolderConfig(target.storageFolderConfig));
    }, []);

    useEffect(() => {
      if (!isDirtyRef.current) {
        resetFormToConfig(config);
      }
    }, [config, resetFormToConfig]);

    // Collapse detected folders disclosure cleanly whenever mounted device changes
    useEffect(() => {
      setShowDetectedFolders(false);
      setShowUnmatchedFolders(false);
    }, [installer?.sdRootHandle]);

    const discoveredAndSyncedSlugs = useMemo(() => {
      const configuredFilterSlugs = config.systemFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return filterValidSystemSlugs([
        ...config.discoveredSystems,
        ...configuredFilterSlugs,
        ...status.systems.map((s) => s.systemName),
      ]);
    }, [config.discoveredSystems, config.systemFilter, status.systems]);

    const autoConfigResult = installer?.autoConfigResult ?? null;
    const autoConfigPhase = installer?.autoConfigPhase ?? 'idle';
    const autoConfigProgress = installer?.autoConfigProgress ?? {
      directoriesScanned: 0,
      currentPath: '',
    };
    const autoConfigError = installer?.autoConfigError ?? null;
    const autoConfigChosenPaths = installer?.autoConfigChosenPaths ?? {};
    const autoConfigIncludeSubfolders = installer?.autoConfigIncludeSubfolders ?? true;

    // Live 3-layer effective folder config combining active mounted auto-config + local draft manual overrides
    const effectiveDraftFolderConfig = useMemo(
      () =>
        composeEffectiveStorageFolderConfig(storageFolderConfig, autoConfigResult, {
          chosenPathBySlug: autoConfigChosenPaths,
          includeTypeSubfolders: autoConfigIncludeSubfolders,
        }),
      [
        storageFolderConfig,
        autoConfigResult,
        autoConfigChosenPaths,
        autoConfigIncludeSubfolders,
      ],
    );

    const detectedDeviceSlugs = useMemo(
      () => (autoConfigResult ? autoConfigResult.matches.map((m) => m.canonicalSlug) : []),
      [autoConfigResult],
    );

    const detectedWithSubfoldersCount = useMemo(() => {
      if (!autoConfigResult) return 0;
      return autoConfigResult.matches.filter((m) => {
        const chosen = autoConfigChosenPaths[m.canonicalSlug] || m.recommendedPath;
        const cand = m.candidates.find((c) => c.relativePath === chosen) ?? m.candidates[0];
        return cand && Object.keys(cand.detectedTypeSubfolders).length > 0;
      }).length;
    }, [autoConfigResult, autoConfigChosenPaths]);

    const liveDestinations = useMemo(
      () =>
        buildLiveExportDestinations(
          effectiveDraftFolderConfig,
          {
            romNamingTemplate,
            romSanitizeFat32,
            romMaxFilenameLen,
          },
          {
            savedManualConfig: storageFolderConfig,
            autoConfigResult,
          },
        ),
      [
        effectiveDraftFolderConfig,
        romNamingTemplate,
        romSanitizeFat32,
        romMaxFilenameLen,
        storageFolderConfig,
        autoConfigResult,
      ],
    );

    const activeNamingPreset = useMemo(
      () => findActiveNamingPreset(romNamingTemplate),
      [romNamingTemplate],
    );

    const namingOptionsSummary = useMemo(
      () =>
        summarizeNamingOptions({
          romNamingTemplate,
          romSanitizeFat32,
          romMaxFilenameLen,
        }),
      [romNamingTemplate, romSanitizeFat32, romMaxFilenameLen],
    );

    const dirtyState = useMemo<ConfigDirtyState>(() => {
      const changedSections: string[] = [];

      const storageMappingsChanged =
        canonicalStorageFolderConfigJson(storageFolderConfig) !==
        canonicalStorageFolderConfigJson(config.storageFolderConfig);
      if (storageMappingsChanged) changedSections.push('Folder Organization & Overrides');

      const namingChanged =
        romNamingTemplate !== config.romNamingTemplate ||
        romSanitizeFat32 !== config.romSanitizeFat32 ||
        romMaxFilenameLen !== config.romMaxFilenameLen;
      if (namingChanged) changedSections.push('ROM Filename Formatting');

      return {
        isDirty: changedSections.length > 0,
        changedSections,
      };
    }, [
      config,
      romNamingTemplate,
      romSanitizeFat32,
      romMaxFilenameLen,
      storageFolderConfig,
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
      if (saveNoticeTimerRef.current !== null) {
        window.clearTimeout(saveNoticeTimerRef.current);
        saveNoticeTimerRef.current = null;
      }
      setSaving(true);
      setSaveMsg(null);
      setSaveErr(null);
      try {
        await onSaveConfig({
          romNamingTemplate,
          romSanitizeFat32,
          romMaxFilenameLen,
          storageFolderConfig: normalizeStorageFolderConfig(storageFolderConfig),
        });
        isDirtyRef.current = false;
        setSaveMsg('Device Export settings saved');
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
      onSaveConfig,
      romNamingTemplate,
      romSanitizeFat32,
      romMaxFilenameLen,
      storageFolderConfig,
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

    const mountedHandle = installer?.sdRootHandle ?? null;
    const isBusyTransfer = installer?.isBusy ?? false;

    const handlePinManualOverride = (slug: string) => {
      setPinOverrideRequest((prev) => ({
        slug,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    };

    const sourceLabelMap = {
      auto: 'Auto-detected',
      manual: 'Manual override',
      default: 'Default',
    } as const;

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveConfiguration();
        }}
        className="space-y-6 max-w-5xl"
      >
        {/* Top Hero: Active Storage Device & Immediate Live Export Destination Preview */}
        <section
          ref={storageMappingsSectionRef}
          aria-label="Active storage device and live export destination preview"
          className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-4"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {spotlight?.target === 'storageMappings' && (
            <div
              key={`storageMappings-${spotlight.nonce}`}
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
            />
          )}

          {/* Active Device Header Row */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
            <div className="flex items-start gap-3 min-w-0">
              <HardDrive className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h2 className="font-display text-lg font-semibold text-crt-text">
                    {mountedHandle
                      ? `Mounted Device: ${mountedHandle.name}`
                      : 'Live Export Destination Preview'}
                  </h2>
                  {mountedHandle && autoConfigPhase === 'scanning' && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-crt-phosphor tabular-nums">
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      <span>
                        Auto-configuring · {autoConfigProgress.directoriesScanned.toLocaleString()}{' '}
                        folders
                      </span>
                    </span>
                  )}
                  {mountedHandle && autoConfigPhase === 'ready' && autoConfigResult && (
                    <span className="text-xs font-mono text-crt-muted tabular-nums">
                      · {autoConfigResult.detectedLayoutLabel} ·{' '}
                      <span
                        className={
                          autoConfigResult.matches.length > 0
                            ? 'text-crt-phosphor'
                            : 'text-crt-muted'
                        }
                      >
                        {autoConfigResult.matches.length} console
                        {autoConfigResult.matches.length === 1 ? '' : 's'} detected
                      </span>
                      {detectedWithSubfoldersCount > 0
                        ? ` · ${detectedWithSubfoldersCount} with subfolders`
                        : ''}
                    </span>
                  )}
                </div>

                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  {mountedHandle
                    ? 'Console paths auto-configure automatically every time you mount a device. Review exactly where your games will land below.'
                    : fsSupport.supported
                      ? 'Mount any SD card, handheld, MiSTer, or flash cart to auto-configure its folder layout immediately and preview exact export paths.'
                      : fsSupport.reason}
                </p>
              </div>
            </div>

            {installer && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {autoConfigPhase === 'scanning' ? (
                  <button
                    type="button"
                    onClick={() => installer.cancelAutoConfigure()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5 shrink-0" />
                    <span>Cancel</span>
                  </button>
                ) : mountedHandle ? (
                  <>
                    <button
                      type="button"
                      disabled={isBusyTransfer}
                      onClick={() => void installer.rescanAutoConfigure()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-45 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                      <span>Rescan</span>
                    </button>
                    <button
                      type="button"
                      disabled={!fsSupport.supported || isBusyTransfer}
                      onClick={() => void installer.promptMountSdCard()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor/70 bg-crt-phosphor/12 text-crt-phosphor hover:bg-crt-phosphor/20 disabled:opacity-45 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                      <span>Switch Device</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!fsSupport.supported}
                    onClick={() => void installer.promptMountSdCard()}
                    className="crt-cta-beam inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                    <span>Mount &amp; Auto-Configure Device</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Auto-Configure Error (if any) */}
          {autoConfigError && (
            <div className="text-xs font-mono text-crt-crimson">{autoConfigError}</div>
          )}

          {/* Front-and-Center Live Export Destination Preview */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-crt-muted">
              <span>Where your games will be written</span>
              <span>
                {mountedHandle
                  ? 'Active device layout + manual overrides + filename style'
                  : 'Default layout + manual overrides + filename style'}
              </span>
            </div>

            <div className="divide-y divide-crt-border/80 border border-crt-border bg-crt-bg rounded px-3.5">
              {liveDestinations.map((sample) => (
                <div
                  key={sample.id}
                  className="py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-1.5 md:gap-4 text-xs font-mono"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 shrink-0">
                    <span className="text-crt-text font-medium">{sample.label}</span>
                    <span className="text-crt-muted">· {sample.systemLabel}</span>
                    <span
                      className={`text-[11px] ${
                        sample.source === 'manual'
                          ? 'text-crt-amber'
                          : sample.source === 'auto'
                            ? 'text-crt-phosphor'
                            : 'text-crt-muted'
                      }`}
                    >
                      · {sourceLabelMap[sample.source]}
                    </span>
                  </div>
                  <div className="break-all md:text-right">
                    <span className="text-crt-text">/{sample.folderPath}/</span>
                    <span className="text-crt-phosphor">{sample.filename}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Optional Collapsed Disclosure: Inspect Detected Folders on Mounted Device */}
          {mountedHandle && autoConfigPhase === 'ready' && autoConfigResult && (
            <div className="pt-1 space-y-3">
              {autoConfigResult.matches.length === 0 ? (
                <div className="text-xs font-mono text-crt-muted">
                  No standard console folders were recognized inside{' '}
                  <span className="text-crt-text">{autoConfigResult.rootLabel}</span> — universal
                  defaults and any manual overrides below will be used automatically.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      aria-expanded={showDetectedFolders}
                      onClick={() => setShowDetectedFolders((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 text-xs font-mono text-crt-muted hover:text-crt-phosphor transition-colors cursor-pointer"
                    >
                      {showDetectedFolders ? (
                        <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>
                        {showDetectedFolders ? 'Hide' : 'Inspect'} {autoConfigResult.matches.length}{' '}
                        detected folder{autoConfigResult.matches.length === 1 ? '' : 's'} on{' '}
                        {autoConfigResult.rootLabel}
                      </span>
                    </button>

                    {detectedWithSubfoldersCount > 0 && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-crt-muted hover:text-crt-text cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoConfigIncludeSubfolders}
                          onChange={(e) =>
                            installer?.setAutoConfigIncludeSubfolders(e.target.checked)
                          }
                          className="accent-crt-phosphor"
                        />
                        <span>
                          Use detected ROM-type subfolders ({detectedWithSubfoldersCount})
                        </span>
                      </label>
                    )}
                  </div>

                  {showDetectedFolders && (
                    <div className="space-y-2.5">
                      <div className="divide-y divide-crt-border border border-crt-border bg-crt-bg rounded max-h-72 overflow-y-auto">
                        {autoConfigResult.matches.map((match) => {
                          const chosenPath =
                            autoConfigChosenPaths[match.canonicalSlug] || match.recommendedPath;
                          const activeCandidate =
                            match.candidates.find((c) => c.relativePath === chosenPath) ??
                            match.candidates[0]!;
                          const detectedSubEntries = Object.entries(
                            activeCandidate.detectedTypeSubfolders,
                          ) as [StorageRomCategoryKey, string][];
                          const pathSource = resolveConsolePathSource(
                            match.canonicalSlug,
                            storageFolderConfig,
                            autoConfigResult,
                          );

                          return (
                            <div
                              key={match.canonicalSlug}
                              className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="font-medium text-crt-text">
                                    {match.displayName}
                                  </span>
                                  <span className="font-mono text-[11px] text-crt-phosphor">
                                    /{activeCandidate.relativePath}
                                  </span>
                                  {activeCandidate.fileCount > 0 && (
                                    <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                                      · {activeCandidate.fileCount.toLocaleString()} file
                                      {activeCandidate.fileCount === 1 ? '' : 's'}
                                    </span>
                                  )}
                                  {pathSource === 'manual' && (
                                    <span className="font-mono text-[11px] text-crt-amber">
                                      · Overridden manually below
                                    </span>
                                  )}
                                </div>

                                {detectedSubEntries.length > 0 && (
                                  <div
                                    className={`text-[11px] font-mono ${
                                      autoConfigIncludeSubfolders
                                        ? 'text-crt-muted'
                                        : 'text-crt-muted/50 line-through'
                                    }`}
                                  >
                                    Subfolders:{' '}
                                    {detectedSubEntries.map(([catKey, folderName], idx) => (
                                      <span key={catKey}>
                                        {idx > 0 && <span aria-hidden="true"> · </span>}
                                        {getStorageRomCategoryShortLabel(catKey)} →{' '}
                                        <span className="text-crt-text">/{folderName}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {match.candidates.length > 1 && (
                                  <select
                                    aria-label={`Choose detected folder path for ${match.displayName}`}
                                    value={activeCandidate.relativePath}
                                    onChange={(e) =>
                                      installer?.setAutoConfigCandidatePath(
                                        match.canonicalSlug,
                                        e.target.value,
                                      )
                                    }
                                    className="max-w-[200px] px-2 py-1 text-[11px] font-mono bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                                  >
                                    {match.candidates.map((cand) => (
                                      <option key={cand.relativePath} value={cand.relativePath}>
                                        /{cand.relativePath}
                                        {cand.fileCount > 0
                                          ? ` (${cand.fileCount})`
                                          : ' (empty)'}
                                      </option>
                                    ))}
                                  </select>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handlePinManualOverride(match.canonicalSlug)}
                                  title={`Pin ${match.displayName} into Manual Console Overrides below`}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-phosphor hover:border-crt-phosphor/60 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Pin className="h-3 w-3 shrink-0" />
                                  <span>Override</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {autoConfigResult.unmatchedFolders.length > 0 && (
                        <div className="space-y-1">
                          <button
                            type="button"
                            aria-expanded={showUnmatchedFolders}
                            onClick={() => setShowUnmatchedFolders((prev) => !prev)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted hover:text-crt-text transition-colors cursor-pointer"
                          >
                            {showUnmatchedFolders ? (
                              <ChevronUp className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            )}
                            <span>
                              {autoConfigResult.unmatchedFolders.length} unrecognized folder
                              {autoConfigResult.unmatchedFolders.length === 1 ? '' : 's'} ignored
                            </span>
                          </button>
                          {showUnmatchedFolders && (
                            <div className="text-[11px] font-mono text-crt-muted/85 pl-4 leading-relaxed break-words">
                              {autoConfigResult.unmatchedFolders.map((folder, idx) => (
                                <span key={folder}>
                                  {idx > 0 && <span aria-hidden="true"> · </span>}/{folder}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Step 01: Folder Organization & Zero-Wall Manual Console Overrides */}
        <StorageFolderMappingsSection
          value={storageFolderConfig}
          effectiveFolderConfig={effectiveDraftFolderConfig}
          onChange={setStorageFolderConfig}
          discoveredAndSyncedSlugs={discoveredAndSyncedSlugs}
          detectedDeviceSlugs={detectedDeviceSlugs}
          pinOverrideRequest={pinOverrideRequest}
          onPinOverrideHandled={() => setPinOverrideRequest(null)}
        />

        {/* Step 02: ROM Filename Formatting (Clean Presets Upfront, Advanced Disclosed) */}
        <section
          ref={romNamingSectionRef}
          className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
        >
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {spotlight?.target === 'romNaming' && (
            <div
              key={`romNaming-${spotlight.nonce}`}
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
            />
          )}

          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
            <div className="flex items-start gap-3 min-w-0">
              <FileText className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h2 className="font-display text-lg font-semibold text-crt-text">
                    02. ROM Filename Formatting
                  </h2>
                  <span className="text-xs font-mono text-crt-muted">
                    · {activeNamingPreset ? activeNamingPreset.label : 'Custom Pattern'} ·{' '}
                    {namingOptionsSummary}
                  </span>
                </div>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Choose how extracted ROM files are named when downloaded or installed to your storage device. Raw mirrored archives on disk remain untouched.
                </p>
              </div>
            </div>
          </div>

          {/* 4-Preset Selector Grid Upfront */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {ROM_NAMING_PRESETS.map((preset) => {
              const active = romNamingTemplate === preset.template;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setRomNamingTemplate(preset.template)}
                  className={`p-3 text-left border rounded transition-colors space-y-1 cursor-pointer ${
                    active
                      ? 'border-crt-phosphor bg-crt-phosphor/10'
                      : 'border-crt-border bg-crt-bg hover:border-crt-border-strong'
                  }`}
                >
                  <div
                    className={`text-xs font-medium ${
                      active ? 'text-crt-phosphor' : 'text-crt-text'
                    }`}
                  >
                    {preset.label}
                  </div>
                  <div className="font-mono text-[11px] text-crt-muted truncate">
                    {preset.exampleHack}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Progressive Disclosure: Advanced Naming & FAT32 Rules */}
          <div className="border-t border-crt-border pt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={showAdvancedNaming}
                onClick={() => setShowAdvancedNaming((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 text-xs font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showAdvancedNaming || !activeNamingPreset
                    ? 'text-crt-phosphor'
                    : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                <span>Advanced Naming &amp; FAT32 Rules</span>
                {showAdvancedNaming ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>

              {!showAdvancedNaming && (
                <span className="text-[11px] font-mono text-crt-muted">
                  {namingOptionsSummary}
                </span>
              )}
            </div>

            {showAdvancedNaming && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start pt-1">
                <div className="md:col-span-8 space-y-2">
                  <label
                    htmlFor="device-export-naming-template"
                    className="block text-xs font-medium text-crt-text"
                  >
                    Filename Pattern Template
                  </label>
                  <input
                    id="device-export-naming-template"
                    type="text"
                    value={romNamingTemplate}
                    onChange={(e) => setRomNamingTemplate(e.target.value)}
                    placeholder="{title}{regionParen}{tagBracket}"
                    className="w-full px-3 py-2 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] font-mono text-crt-muted mr-1">
                      Insert token:
                    </span>
                    {ROM_NAMING_TOKEN_HELPERS.map((helper) => (
                      <button
                        key={helper.token}
                        type="button"
                        title={`Append ${helper.token} (${helper.label})`}
                        onClick={() =>
                          setRomNamingTemplate((prev) => appendNamingToken(prev, helper.token))
                        }
                        className="px-2 py-0.5 text-[11px] font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-phosphor hover:border-crt-phosphor/60 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {helper.token}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-4 space-y-2">
                  <label
                    htmlFor="device-export-max-filename-len"
                    className="block text-xs font-medium text-crt-text"
                  >
                    Max Filename Length (0 = unlimited)
                  </label>
                  <input
                    id="device-export-max-filename-len"
                    type="number"
                    min={0}
                    max={255}
                    value={romMaxFilenameLen}
                    onChange={(e) =>
                      setRomMaxFilenameLen(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                  />
                  <label className="inline-flex items-center gap-2 pt-1 text-xs text-crt-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={romSanitizeFat32}
                      onChange={(e) => setRomSanitizeFat32(e.target.checked)}
                      className="accent-crt-phosphor"
                    />
                    <span>FAT32 / device-safe characters</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </section>

        <ConfigSaveBar
          ariaLabel="Device Export configuration save actions"
          dirtyState={dirtyState}
          saving={saving}
          saveMsg={saveMsg}
          saveErr={saveErr}
          onDiscard={discardChanges}
        />
      </form>
    );
  },
);
