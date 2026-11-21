import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronUp, FileText, SlidersHorizontal } from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { useSectionSpotlight } from '../hooks/useSectionSpotlight';
import {
  appendNamingToken,
  buildLiveExportDestinations,
  findActiveNamingPreset,
  ROM_NAMING_TOKEN_HELPERS,
  shouldAutoExpandAdvancedNaming,
  summarizeNamingOptions,
} from '../shared/deviceExportUi';
import { ROM_NAMING_PRESETS } from '../shared/romNaming';
import {
  canonicalStorageFolderConfigJson,
  normalizeStorageFolderConfig,
  type StorageFolderMappingConfig,
} from '../shared/storageFolderMappings';
import { filterValidSystemSlugs } from '../shared/systemCatalog';
import type {
  ConfigDirtyState,
  ConfigFocusRequest,
  ConfigPanelHandle,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
} from '../types';
import { ConfigSaveBar } from './ConfigSaveBar';
import { StorageFolderMappingsSection } from './StorageFolderMappingsSection';

interface DeviceExportPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  installer?: BulkStorageInstallerController;
  focusRequest?: ConfigFocusRequest | null;
  autoConfigureRequest?: { nonce: number } | null;
  onAutoConfigureRequestHandled?: () => void;
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
      autoConfigureRequest = null,
      onAutoConfigureRequestHandled,
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

    const liveDestinations = useMemo(
      () =>
        buildLiveExportDestinations(storageFolderConfig, {
          romNamingTemplate,
          romSanitizeFat32,
          romMaxFilenameLen,
        }),
      [storageFolderConfig, romNamingTemplate, romSanitizeFat32, romMaxFilenameLen],
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
      if (storageMappingsChanged) changedSections.push('Console Folders');

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

    const saveConfiguration = useCallback(
      async (overrideStorageFolderConfig?: StorageFolderMappingConfig): Promise<boolean> => {
        if (saveNoticeTimerRef.current !== null) {
          window.clearTimeout(saveNoticeTimerRef.current);
          saveNoticeTimerRef.current = null;
        }
        const effectiveFolderConfig = normalizeStorageFolderConfig(
          overrideStorageFolderConfig ?? storageFolderConfig,
        );
        setSaving(true);
        setSaveMsg(null);
        setSaveErr(null);
        try {
          await onSaveConfig({
            romNamingTemplate,
            romSanitizeFat32,
            romMaxFilenameLen,
            storageFolderConfig: effectiveFolderConfig,
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
      },
      [
        onSaveConfig,
        romNamingTemplate,
        romSanitizeFat32,
        romMaxFilenameLen,
        storageFolderConfig,
      ],
    );

    const handleApplyAndSaveFolderConfig = useCallback(
      async (mergedFolderConfig: StorageFolderMappingConfig): Promise<boolean> => {
        setStorageFolderConfig(mergedFolderConfig);
        return saveConfiguration(mergedFolderConfig);
      },
      [saveConfiguration],
    );

    const discardChanges = useCallback(() => {
      resetFormToConfig(config);
      setSaveMsg(null);
      setSaveErr(null);
    }, [config, resetFormToConfig]);

    useImperativeHandle(
      ref,
      () => ({
        save: () => saveConfiguration(),
        discard: discardChanges,
      }),
      [saveConfiguration, discardChanges],
    );

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveConfiguration();
        }}
        className="space-y-6 max-w-5xl"
      >
        {/* Unified Live Export Destination Preview (Combines Step 01 Folders + Step 02 Naming) */}
        <section
          aria-label="Live export destination preview"
          className="border border-crt-border bg-crt-surface rounded-md px-5 py-3.5 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-crt-text">Live Export Destination Preview</span>
              <span className="font-mono text-[11px] text-crt-muted">
                · Combines your console folders, ROM organization, and filename style
              </span>
            </div>
            {installer?.sdRootHandle && (
              <span className="font-mono text-[11px] text-crt-muted truncate max-w-[260px]">
                Target: <span className="text-crt-phosphor">{installer.sdRootHandle.name}</span>
              </span>
            )}
          </div>

          <div className="divide-y divide-crt-border/70 border-t border-crt-border/70 text-xs font-mono">
            {liveDestinations.map((sample) => (
              <div
                key={sample.id}
                className="py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4"
              >
                <span className="text-crt-muted shrink-0">
                  {sample.label} <span className="text-crt-muted/70">({sample.systemLabel})</span>
                </span>
                <span className="break-all text-right">
                  <span className="text-crt-text">/{sample.folderPath}/</span>
                  <span className="text-crt-phosphor">{sample.filename}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Step 01: Console Folders & Unified Auto-Configure */}
        <StorageFolderMappingsSection
          sectionRef={storageMappingsSectionRef}
          spotlightNonce={spotlight?.target === 'storageMappings' ? spotlight.nonce : null}
          value={storageFolderConfig}
          onChange={setStorageFolderConfig}
          onApplyAndSave={handleApplyAndSaveFolderConfig}
          saving={saving}
          discoveredAndSyncedSlugs={discoveredAndSyncedSlugs}
          installer={installer}
          autoConfigureRequest={autoConfigureRequest}
          onAutoConfigureRequestHandled={onAutoConfigureRequestHandled}
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
