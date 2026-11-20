import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { HardDrive } from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { useSectionSpotlight } from '../hooks/useSectionSpotlight';
import { formatPreparedRomName, ROM_NAMING_PRESETS } from '../shared/romNaming';
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

    const dirtyState = useMemo<ConfigDirtyState>(() => {
      const changedSections: string[] = [];

      const namingChanged =
        romNamingTemplate !== config.romNamingTemplate ||
        romSanitizeFat32 !== config.romSanitizeFat32 ||
        romMaxFilenameLen !== config.romMaxFilenameLen;
      if (namingChanged) changedSections.push('ROM Naming & Formatting');

      const storageMappingsChanged =
        canonicalStorageFolderConfigJson(storageFolderConfig) !==
        canonicalStorageFolderConfigJson(config.storageFolderConfig);
      if (storageMappingsChanged) changedSections.push('Storage Folder Mappings');

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

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveConfiguration();
        }}
        className="space-y-6 max-w-5xl"
      >
        {/* 1. Prepared ROM Naming & Storage Device Formatting */}
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
            <div className="flex items-start gap-3">
              <HardDrive className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
              <div className="space-y-1">
                <h2 className="font-display text-lg font-semibold text-crt-text">
                  Prepared ROM Naming &amp; FAT32 Formatting
                </h2>
                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  Controls how extracted ROMs are named when downloading Prepared ROMs or installing to handheld SD cards, flash carts, and ODEs. Raw mirrored archives on disk remain untouched.
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
            <div className="md:col-span-8 space-y-1.5">
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

            <div className="md:col-span-4 space-y-1.5">
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
                <span>FAT32 / device-safe characters</span>
              </label>
            </div>
          </div>

          {/* Live Output Preview */}
          <div className="border border-crt-border bg-crt-bg rounded p-3.5 space-y-1.5">
            <div className="text-[11px] font-mono text-crt-muted">
              Live Filename Output Preview
            </div>
            <div className="divide-y divide-crt-border text-xs font-mono">
              {namingPreviews.map((p) => (
                <div
                  key={p.label}
                  className="py-1.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-crt-muted">{p.label}</span>
                  <span className="text-crt-phosphor break-all">{p.output}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 2. Storage Device Console & ROM-Type Folder Mappings */}
        <StorageFolderMappingsSection
          sectionRef={storageMappingsSectionRef}
          spotlightNonce={spotlight?.target === 'storageMappings' ? spotlight.nonce : null}
          value={storageFolderConfig}
          onChange={setStorageFolderConfig}
          discoveredAndSyncedSlugs={discoveredAndSyncedSlugs}
          installer={installer}
          autoConfigureRequest={autoConfigureRequest}
          onAutoConfigureRequestHandled={onAutoConfigureRequestHandled}
        />

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
