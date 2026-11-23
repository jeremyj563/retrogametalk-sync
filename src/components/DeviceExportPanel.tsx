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
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderPlus,
  FolderSync,
  HardDrive,
  Loader2,
  Pencil,
  Pin,
  Plug,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { useSectionSpotlight } from '../hooks/useSectionSpotlight';
import { formatDateTime } from '../utils/format';
import {
  appendNamingToken,
  buildLiveExportDestinations,
  composeEffectiveStorageFolderConfig,
  findActiveNamingPreset,
  resolveConsolePathSource,
  ROM_NAMING_TOKEN_HELPERS,
  shouldAutoExpandAdvancedNaming,
  summarizeDeviceInferredConventions,
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
import {
  formatMountDeviceTooltip,
  formatRescanDeviceTooltip,
  formatSwitchDeviceTooltip,
  MOUNT_DEVICE_LABEL,
  RESCAN_DEVICE_LABEL,
  SWITCH_DEVICE_LABEL,
} from '../utils/storageActionCopy';
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
    const [profileBusyId, setProfileBusyId] = useState<string | null>(null);
    const [profileNotice, setProfileNotice] = useState<string | null>(null);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [confirmDeleteProfileId, setConfirmDeleteProfileId] = useState<string | null>(null);
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

    const inferredConventions = useMemo(
      () =>
        summarizeDeviceInferredConventions(autoConfigResult, {
          chosenPathBySlug: autoConfigChosenPaths,
          includeTypeSubfolders: autoConfigIncludeSubfolders,
        }),
      [autoConfigResult, autoConfigChosenPaths, autoConfigIncludeSubfolders],
    );

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
            chosenPathBySlug: autoConfigChosenPaths,
            includeTypeSubfolders: autoConfigIncludeSubfolders,
          },
        ),
      [
        effectiveDraftFolderConfig,
        romNamingTemplate,
        romSanitizeFat32,
        romMaxFilenameLen,
        storageFolderConfig,
        autoConfigResult,
        autoConfigChosenPaths,
        autoConfigIncludeSubfolders,
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
    const activeProfile = installer?.activeDeviceProfile ?? null;
    const activeDeviceDisplayName = installer?.activeDeviceName || mountedHandle?.name || null;
    const deviceProfiles = installer?.deviceProfiles ?? [];
    const rememberedHandleIds = useMemo(
      () => new Set((installer?.rememberedHandles ?? []).map((h) => h.deviceId)),
      [installer?.rememberedHandles],
    );
    const isBusyTransfer = installer?.isBusy ?? false;

    const activeProfileHasOverrides = Boolean(
      activeProfile && (activeProfile.folderConfig !== null || activeProfile.romNaming !== null),
    );

    const handleSaveToActiveProfile = async () => {
      if (!installer || !activeProfile) return;
      setProfileBusyId(activeProfile.id);
      setProfileNotice(null);
      setProfileError(null);
      try {
        const updated = await installer.saveDeviceProfileSettings(activeProfile.id, {
          folderConfig: normalizeStorageFolderConfig(storageFolderConfig),
          romNaming: {
            romNamingTemplate,
            romSanitizeFat32,
            romMaxFilenameLen,
          },
        });
        if (updated) {
          setProfileNotice(`Saved layout & filename rules to "${updated.name}" profile.`);
        } else {
          setProfileError('Failed to save profile overrides.');
        }
      } finally {
        setProfileBusyId(null);
      }
    };

    const handleClearActiveProfileOverrides = async () => {
      if (!installer || !activeProfile) return;
      setProfileBusyId(activeProfile.id);
      setProfileNotice(null);
      setProfileError(null);
      try {
        const updated = await installer.saveDeviceProfileSettings(activeProfile.id, {
          folderConfig: null,
          romNaming: null,
        });
        if (updated) {
          setProfileNotice(`"${updated.name}" now inherits global Device Export defaults.`);
        } else {
          setProfileError('Failed to clear profile overrides.');
        }
      } finally {
        setProfileBusyId(null);
      }
    };

    const handleLoadActiveProfileIntoEditor = () => {
      if (!activeProfile) return;
      if (activeProfile.folderConfig) {
        setStorageFolderConfig(normalizeStorageFolderConfig(activeProfile.folderConfig));
      }
      if (activeProfile.romNaming) {
        if (typeof activeProfile.romNaming.romNamingTemplate === 'string') {
          setRomNamingTemplate(activeProfile.romNaming.romNamingTemplate);
        }
        if (typeof activeProfile.romNaming.romSanitizeFat32 === 'boolean') {
          setRomSanitizeFat32(activeProfile.romNaming.romSanitizeFat32);
        }
        if (typeof activeProfile.romNaming.romMaxFilenameLen === 'number') {
          setRomMaxFilenameLen(activeProfile.romNaming.romMaxFilenameLen);
        }
      }
      setProfileNotice(`Loaded "${activeProfile.name}" overrides into the editor.`);
      setProfileError(null);
    };

    const handleCommitRenameProfile = async (deviceId: string) => {
      if (!installer) return;
      const trimmed = renameDraft.trim();
      if (!trimmed) {
        setRenamingProfileId(null);
        return;
      }
      setProfileBusyId(deviceId);
      setProfileNotice(null);
      setProfileError(null);
      try {
        const updated = await installer.renameDeviceProfile(deviceId, trimmed);
        if (updated) {
          setRenamingProfileId(null);
          setProfileNotice(`Renamed device profile to "${updated.name}".`);
        } else {
          setProfileError('Failed to rename device profile.');
        }
      } finally {
        setProfileBusyId(null);
      }
    };

    const handleDeleteProfile = async (deviceId: string, name: string) => {
      if (!installer) return;
      setProfileBusyId(deviceId);
      setProfileNotice(null);
      setProfileError(null);
      try {
        const ok = await installer.deleteDeviceProfile(deviceId);
        if (ok) {
          setConfirmDeleteProfileId(null);
          setProfileNotice(`Deleted "${name}" profile and install history.`);
        } else {
          setProfileError('Failed to delete device profile.');
        }
      } finally {
        setProfileBusyId(null);
      }
    };

    const handlePinManualOverride = (slug: string) => {
      setPinOverrideRequest((prev) => ({
        slug,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    };

    const sourceLabelMap = {
      auto: 'Auto-detected',
      inferred: 'Inferred',
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
                      ? `Mounted Device: ${activeDeviceDisplayName}`
                      : 'Live Export Destination Preview'}
                  </h2>
                  {mountedHandle && activeProfile && renamingProfileId !== activeProfile.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setRenameDraft(activeProfile.name);
                        setRenamingProfileId(activeProfile.id);
                      }}
                      title="Rename this device profile"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3 w-3 shrink-0" />
                      <span>Rename</span>
                    </button>
                  )}
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

                {mountedHandle && activeProfile && renamingProfileId === activeProfile.id && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={renameDraft}
                      maxLength={80}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCommitRenameProfile(activeProfile.id);
                        } else if (e.key === 'Escape') {
                          setRenamingProfileId(null);
                        }
                      }}
                      aria-label="Mounted device profile name"
                      className="px-2.5 py-1 text-xs font-mono bg-crt-bg border border-crt-phosphor rounded text-crt-text focus:outline-none w-56"
                    />
                    <button
                      type="button"
                      disabled={profileBusyId === activeProfile.id}
                      onClick={() => void handleCommitRenameProfile(activeProfile.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-crt-phosphor text-crt-bg rounded hover:brightness-110 disabled:opacity-50 cursor-pointer"
                    >
                      <Check className="h-3 w-3 shrink-0" />
                      <span>Save</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingProfileId(null)}
                      className="px-2 py-1 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                  {mountedHandle
                    ? activeProfile && activeProfile.name !== mountedHandle.name
                      ? `Volume: ${mountedHandle.name} · ${activeProfile.installedCount.toLocaleString()} installed · Console paths auto-configure every time you mount this device.`
                      : 'Console paths auto-configure automatically every time you mount a device. Review exactly where your games will land below.'
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
                      title={formatRescanDeviceTooltip('layout', isBusyTransfer)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-45 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                      <span>{RESCAN_DEVICE_LABEL}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!fsSupport.supported || isBusyTransfer}
                      onClick={() => void installer.promptMountSdCard()}
                      title={formatSwitchDeviceTooltip(isBusyTransfer)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor/70 bg-crt-phosphor/12 text-crt-phosphor hover:bg-crt-phosphor/20 disabled:opacity-45 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FolderSync className="h-3.5 w-3.5 shrink-0" />
                      <span>{SWITCH_DEVICE_LABEL}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!fsSupport.supported}
                    onClick={() => void installer.promptMountSdCard()}
                    title={formatMountDeviceTooltip(fsSupport)}
                    className="crt-cta-beam inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                    <span>{MOUNT_DEVICE_LABEL}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Per-Device Profile Override Controls when Mounted */}
          {mountedHandle && activeProfile && installer && (
            <div className="border border-crt-border bg-crt-bg/70 rounded px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="font-mono text-[11px] text-crt-muted min-w-0">
                <span className="text-crt-text font-medium">{activeProfile.name}</span>
                {' · '}
                {activeProfileHasOverrides ? (
                  <span className="text-crt-amber">Custom per-device overrides active</span>
                ) : (
                  <span>Using global defaults</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={profileBusyId === activeProfile.id}
                  onClick={() => void handleSaveToActiveProfile()}
                  title={`Save the folder organization & ROM naming rules below specifically for ${activeProfile.name}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors disabled:opacity-45 cursor-pointer"
                >
                  <Save className="h-3 w-3 shrink-0" />
                  <span>Save to {activeProfile.name} Profile</span>
                </button>
                {activeProfileHasOverrides && (
                  <>
                    <button
                      type="button"
                      onClick={handleLoadActiveProfileIntoEditor}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer"
                    >
                      <span>Load Profile</span>
                    </button>
                    <button
                      type="button"
                      disabled={profileBusyId === activeProfile.id}
                      onClick={() => void handleClearActiveProfileOverrides()}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-amber hover:border-crt-amber/50 rounded transition-colors disabled:opacity-45 cursor-pointer"
                    >
                      <span>Use Global Defaults</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {profileNotice && (
            <div className="text-xs font-mono text-crt-phosphor">{profileNotice}</div>
          )}
          {profileError && (
            <div className="text-xs font-mono text-crt-crimson">{profileError}</div>
          )}

          {/* Auto-Configure Error (if any) */}
          {autoConfigError && (
            <div className="text-xs font-mono text-crt-crimson">{autoConfigError}</div>
          )}

          {/* Front-and-Center Live Export Destination Preview */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-crt-muted">
              <span>Where your games will be written</span>
              <span>
                {mountedHandle
                  ? 'Active device layout + manual overrides + filename style'
                  : 'Default layout + manual overrides + filename style'}
              </span>
            </div>

            {mountedHandle &&
              autoConfigPhase === 'ready' &&
              inferredConventions.hasAnyInferredConvention && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-crt-muted">
                  {inferredConventions.newConsolePattern && (
                    <span>
                      New consoles →{' '}
                      <span className="text-crt-text">
                        {inferredConventions.newConsolePattern}
                      </span>
                    </span>
                  )}
                  {inferredConventions.observedSubfolders.length > 0 && (
                    <>
                      {inferredConventions.newConsolePattern && (
                        <span aria-hidden="true">·</span>
                      )}
                      <span>
                        Subfolders:{' '}
                        {inferredConventions.observedSubfolders.map((entry, idx) => (
                          <span key={entry.category}>
                            {idx > 0 && <span aria-hidden="true"> · </span>}
                            {entry.label} →{' '}
                            <span className="text-crt-phosphor">/{entry.folder}</span>
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                  {inferredConventions.unseenCasingLabel && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Unseen types →{' '}
                        <span className="text-crt-text">
                          {inferredConventions.unseenCasingLabel}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              )}

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
                          : sample.source === 'auto' || sample.source === 'inferred'
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
                          Apply detected subfolder convention across device (
                          {detectedWithSubfoldersCount} matched)
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

        {/* Step 03: Saved Storage Device Profiles */}
        {installer && deviceProfiles.length > 0 && (
          <section
            aria-label="Saved storage device profiles"
            className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-6 space-y-4"
          >
            <div aria-hidden="true" className="crt-edge-beam">
              <span />
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
              <div className="flex items-start gap-3 min-w-0">
                <HardDrive className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h2 className="font-display text-lg font-semibold text-crt-text">
                      03. Saved Device Profiles
                    </h2>
                    <span className="text-xs font-mono text-crt-muted tabular-nums">
                      · {deviceProfiles.length} device{deviceProfiles.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
                    Each handheld or SD card tracks its own installed games, friendly name, and optional folder/naming overrides. Deleting a profile only clears tracking history — ROM files on the card and local mirror stay untouched.
                  </p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-crt-border border border-crt-border bg-crt-bg rounded">
              {deviceProfiles.map((profile) => {
                const isActive = activeProfile?.id === profile.id;
                const canReconnect = !isActive && rememberedHandleIds.has(profile.id);
                const isRenaming = renamingProfileId === profile.id;
                const isConfirmDelete = confirmDeleteProfileId === profile.id;
                const isProfileBusy =
                  profileBusyId === profile.id || installer.reconnectingDeviceId === profile.id;
                const hasCustomOverrides =
                  profile.folderConfig !== null || profile.romNaming !== null;

                return (
                  <div
                    key={profile.id}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      {isRenaming ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="text"
                            value={renameDraft}
                            maxLength={80}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleCommitRenameProfile(profile.id);
                              } else if (e.key === 'Escape') {
                                setRenamingProfileId(null);
                              }
                            }}
                            aria-label={`Rename ${profile.name}`}
                            className="px-2 py-1 text-xs font-mono bg-crt-surface border border-crt-phosphor rounded text-crt-text focus:outline-none w-52"
                          />
                          <button
                            type="button"
                            disabled={isProfileBusy}
                            onClick={() => void handleCommitRenameProfile(profile.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-crt-phosphor text-crt-bg rounded cursor-pointer"
                          >
                            <Check className="h-3 w-3 shrink-0" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingProfileId(null)}
                            className="px-2 py-1 text-[11px] border border-crt-border text-crt-muted hover:text-crt-text rounded cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono font-semibold text-crt-text">
                            {profile.name}
                          </span>
                          {isActive && (
                            <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor">
                              Mounted
                            </span>
                          )}
                          {profile.volumeLabel && profile.volumeLabel !== profile.name && (
                            <span className="font-mono text-[11px] text-crt-muted">
                              ({profile.volumeLabel})
                            </span>
                          )}
                          {hasCustomOverrides && (
                            <span className="font-mono text-[11px] text-crt-amber">
                              · Custom rules
                            </span>
                          )}
                        </div>
                      )}
                      <div className="font-mono text-[11px] text-crt-muted tabular-nums">
                        {profile.installedCount.toLocaleString()} installed game
                        {profile.installedCount === 1 ? '' : 's'}
                        {profile.lastMountedAt
                          ? ` · Last mounted ${formatDateTime(profile.lastMountedAt)}`
                          : ''}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canReconnect && !isConfirmDelete && (
                        <button
                          type="button"
                          disabled={isProfileBusy || isBusyTransfer}
                          onClick={() => void installer.reconnectStoredDevice(profile.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors disabled:opacity-45 cursor-pointer"
                        >
                          {installer.reconnectingDeviceId === profile.id ? (
                            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                          ) : (
                            <Plug className="h-3 w-3 shrink-0" />
                          )}
                          <span>Reconnect</span>
                        </button>
                      )}
                      {!isRenaming && !isConfirmDelete && (
                        <button
                          type="button"
                          disabled={isProfileBusy}
                          onClick={() => {
                            setConfirmDeleteProfileId(null);
                            setRenameDraft(profile.name);
                            setRenamingProfileId(profile.id);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer"
                        >
                          <Pencil className="h-3 w-3 shrink-0" />
                          <span>Rename</span>
                        </button>
                      )}
                      {isConfirmDelete ? (
                        <>
                          <button
                            type="button"
                            disabled={isProfileBusy}
                            onClick={() => void handleDeleteProfile(profile.id, profile.name)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-crt-crimson text-crt-bg rounded hover:brightness-110 disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3 shrink-0" />
                            <span>Confirm Delete</span>
                          </button>
                          <button
                            type="button"
                            disabled={isProfileBusy}
                            onClick={() => setConfirmDeleteProfileId(null)}
                            className="px-2 py-1 text-[11px] border border-crt-border text-crt-muted hover:text-crt-text rounded cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isProfileBusy || (isActive && isBusyTransfer)}
                          onClick={() => {
                            setRenamingProfileId(null);
                            setConfirmDeleteProfileId(profile.id);
                          }}
                          title="Delete saved device profile and install history (does not touch ROM files)"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-crimson/45 text-crt-crimson hover:bg-crt-crimson/10 rounded transition-colors disabled:opacity-45 cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3 shrink-0" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

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
