import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderSearch,
  FolderTree,
  HardDrive,
  Loader2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import {
  classifyDiscoveredConsoleDiff,
  discoverStorageFolderMappings,
  mergeDiscoveredStorageMappings,
  type DeviceAutoConfigResult,
} from '../shared/storageAutoConfig';
import {
  buildUniqueConsoleMappingSlugs,
  canonicalStorageFolderConfigJson,
  createDefaultStorageFolderConfig,
  DEFAULT_ROM_TYPE_SUBFOLDERS,
  isTypeSubfoldersActiveForSystem,
  resolveBaseSystemFolder,
  resolveDefaultSystemFolder,
  resolveTargetStorageFolder,
  STORAGE_ROM_CATEGORIES,
  STORAGE_ROM_CATEGORY_KEYS,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
  type SystemTypeFolderOverride,
  type SystemTypeSubfolderMode,
} from '../shared/storageFolderMappings';
import { groupSystemsByBrand, resolveSystemDisplayInfo } from '../shared/systemCatalog';
import {
  isAbortError,
  isFileSystemAccessSupported,
  pickSdCardRootDirectory,
  scanStorageDirectoryTree,
  type SdDirectoryHandle,
} from '../utils/sdCardFs';
import { StorageAutoConfigReview } from './StorageAutoConfigReview';

type ConsoleScopeTab = 'discovered' | 'all' | 'customized';

interface StorageFolderMappingsSectionProps {
  sectionRef: RefObject<HTMLElement | null>;
  spotlightNonce: number | null;
  value: StorageFolderMappingConfig;
  onChange: (next: StorageFolderMappingConfig) => void;
  discoveredAndSyncedSlugs: string[];
  installer?: BulkStorageInstallerController;
  autoConfigureRequest?: { nonce: number } | null;
  onAutoConfigureRequestHandled?: () => void;
}

export function StorageFolderMappingsSection({
  sectionRef,
  spotlightNonce,
  value,
  onChange,
  discoveredAndSyncedSlugs,
  installer,
  autoConfigureRequest = null,
  onAutoConfigureRequestHandled,
}: StorageFolderMappingsSectionProps) {
  const [scopeTab, setScopeTab] = useState<ConsoleScopeTab>(() =>
    discoveredAndSyncedSlugs.length > 0 ? 'discovered' : 'all',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showGlobalTypeDefaults, setShowGlobalTypeDefaults] = useState(false);
  const [expandedConsoleSlug, setExpandedConsoleSlug] = useState<string | null>(null);

  // Export Device Auto-Configure state
  const fsSupport = useMemo(() => isFileSystemAccessSupported(), []);
  const [autoScanPhase, setAutoScanPhase] = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
  const [autoScanTargetLabel, setAutoScanTargetLabel] = useState<string>('');
  const [autoScanProgress, setAutoScanProgress] = useState<{
    directoriesScanned: number;
    currentPath: string;
  }>({ directoriesScanned: 0, currentPath: '' });
  const [autoScanError, setAutoScanError] = useState<string | null>(null);
  const [autoConfigResult, setAutoConfigResult] = useState<DeviceAutoConfigResult | null>(null);
  const [selectedAutoSlugs, setSelectedAutoSlugs] = useState<Set<string>>(new Set());
  const [chosenPathBySlug, setChosenPathBySlug] = useState<Record<string, string>>({});
  const [includeAutoSubfolders, setIncludeAutoSubfolders] = useState<boolean>(true);
  const [appliedAutoNotice, setAppliedAutoNotice] = useState<string | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const lastHandledAutoNonceRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort();
      scanAbortRef.current = null;
    };
  }, []);

  const defaultConfigJson = useMemo(
    () => canonicalStorageFolderConfigJson(createDefaultStorageFolderConfig()),
    [],
  );
  const hasAnyCustomizations = useMemo(
    () => canonicalStorageFolderConfigJson(value) !== defaultConfigJson,
    [value, defaultConfigJson],
  );

  const hasCustomGlobalTypeDefaults = useMemo(
    () =>
      STORAGE_ROM_CATEGORY_KEYS.some(
        (key) => (value.globalTypeSubfolders[key] ?? '') !== DEFAULT_ROM_TYPE_SUBFOLDERS[key],
      ),
    [value.globalTypeSubfolders],
  );

  const customizedSlugSet = useMemo(() => {
    const set = new Set<string>();
    for (const [slug, folder] of Object.entries(value.systemFolders)) {
      if (folder.trim() && folder.trim() !== resolveDefaultSystemFolder(slug)) {
        set.add(slug.toLowerCase());
      }
    }
    for (const [slug, override] of Object.entries(value.systemTypeOverrides)) {
      const hasMode = override.mode === 'enabled' || override.mode === 'disabled';
      const hasSubs = override.subfolders && Object.keys(override.subfolders).length > 0;
      if (hasMode || hasSubs) {
        set.add(slug.toLowerCase());
      }
    }
    return set;
  }, [value.systemFolders, value.systemTypeOverrides]);

  const discoveredConsoleSlugs = useMemo(
    () =>
      buildUniqueConsoleMappingSlugs(
        [
          ...discoveredAndSyncedSlugs,
          ...Object.keys(value.systemFolders),
          ...Object.keys(value.systemTypeOverrides),
        ],
        false,
      ),
    [discoveredAndSyncedSlugs, value.systemFolders, value.systemTypeOverrides],
  );

  const allConsoleSlugs = useMemo(
    () =>
      buildUniqueConsoleMappingSlugs(
        [
          ...discoveredAndSyncedSlugs,
          ...Object.keys(value.systemFolders),
          ...Object.keys(value.systemTypeOverrides),
        ],
        true,
      ),
    [discoveredAndSyncedSlugs, value.systemFolders, value.systemTypeOverrides],
  );

  const effectiveScopeTab: ConsoleScopeTab =
    scopeTab === 'discovered' && discoveredConsoleSlugs.length === 0 ? 'all' : scopeTab;

  const scopedSlugs = useMemo(() => {
    if (effectiveScopeTab === 'discovered') {
      return discoveredConsoleSlugs;
    }
    if (effectiveScopeTab === 'customized') {
      return allConsoleSlugs.filter((slug) => {
        const lower = slug.toLowerCase();
        if (customizedSlugSet.has(lower)) return true;
        const displayName = resolveSystemDisplayInfo(lower).displayName;
        for (const cSlug of customizedSlugSet) {
          if (resolveSystemDisplayInfo(cSlug).displayName === displayName) {
            return true;
          }
        }
        return false;
      });
    }
    return allConsoleSlugs;
  }, [effectiveScopeTab, discoveredConsoleSlugs, allConsoleSlugs, customizedSlugSet]);

  const filteredSlugs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scopedSlugs;
    return scopedSlugs.filter((slug) => {
      const info = resolveSystemDisplayInfo(slug);
      const baseFolder = resolveBaseSystemFolder(slug, value).toLowerCase();
      return (
        info.displayName.toLowerCase().includes(q) ||
        info.slug.toLowerCase().includes(q) ||
        info.brandLabel.toLowerCase().includes(q) ||
        info.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
        baseFolder.includes(q)
      );
    });
  }, [scopedSlugs, searchQuery, value]);

  const brandGroups = useMemo(() => groupSystemsByBrand(filteredSlugs), [filteredSlugs]);

  const findStoredSlugKey = <T,>(slug: string, record: Record<string, T>): string => {
    const lower = slug.toLowerCase();
    if (record[lower] !== undefined) return lower;
    const displayName = resolveSystemDisplayInfo(lower).displayName;
    for (const existingKey of Object.keys(record)) {
      if (resolveSystemDisplayInfo(existingKey).displayName === displayName) {
        return existingKey;
      }
    }
    return lower;
  };

  const handleToggleGlobalSubfolders = (enabled: boolean) => {
    onChange({
      ...value,
      typeSubfoldersEnabled: enabled,
    });
  };

  const handleUpdateGlobalTypeSubfolder = (category: StorageRomCategoryKey, nextPath: string) => {
    onChange({
      ...value,
      globalTypeSubfolders: {
        ...value.globalTypeSubfolders,
        [category]: nextPath,
      },
    });
  };

  const handleResetGlobalTypeDefaults = () => {
    onChange({
      ...value,
      globalTypeSubfolders: { ...DEFAULT_ROM_TYPE_SUBFOLDERS },
    });
  };

  const handleUpdateSystemBaseFolder = (slug: string, rawInput: string) => {
    const key = findStoredSlugKey(slug, value.systemFolders);
    const nextSystemFolders = { ...value.systemFolders };
    if (rawInput === '') {
      delete nextSystemFolders[key];
    } else {
      nextSystemFolders[key] = rawInput;
    }
    onChange({
      ...value,
      systemFolders: nextSystemFolders,
    });
  };

  const updateSystemOverrideEntry = (
    slug: string,
    updater: (prev: SystemTypeFolderOverride) => SystemTypeFolderOverride,
  ) => {
    const key = findStoredSlugKey(slug, value.systemTypeOverrides);
    const current = value.systemTypeOverrides[key] || {};
    const updated = updater(current);
    const nextOverrides = { ...value.systemTypeOverrides };

    const cleanMode =
      updated.mode === 'enabled' || updated.mode === 'disabled' ? updated.mode : undefined;
    const cleanSubfolders: Partial<Record<StorageRomCategoryKey, string>> = {};
    if (updated.subfolders) {
      for (const catKey of STORAGE_ROM_CATEGORY_KEYS) {
        if (updated.subfolders[catKey] !== undefined) {
          cleanSubfolders[catKey] = updated.subfolders[catKey];
        }
      }
    }
    const hasSubs = Object.keys(cleanSubfolders).length > 0;
    if (!cleanMode && !hasSubs) {
      delete nextOverrides[key];
    } else {
      nextOverrides[key] = {
        ...(cleanMode ? { mode: cleanMode } : {}),
        ...(hasSubs ? { subfolders: cleanSubfolders } : {}),
      };
    }

    onChange({
      ...value,
      systemTypeOverrides: nextOverrides,
    });
  };

  const handleSetConsoleSubfolderMode = (slug: string, mode: SystemTypeSubfolderMode) => {
    updateSystemOverrideEntry(slug, (prev) => ({
      ...prev,
      mode,
    }));
  };

  const handleSetConsoleCategorySubfolder = (
    slug: string,
    category: StorageRomCategoryKey,
    nextVal: string | undefined,
  ) => {
    updateSystemOverrideEntry(slug, (prev) => {
      const nextSubfolders = { ...(prev.subfolders || {}) };
      if (nextVal === undefined) {
        delete nextSubfolders[category];
      } else {
        nextSubfolders[category] = nextVal;
      }
      return {
        ...prev,
        subfolders: nextSubfolders,
      };
    });
  };

  const handleResetConsoleAllOverrides = (slug: string) => {
    const folderKey = findStoredSlugKey(slug, value.systemFolders);
    const overrideKey = findStoredSlugKey(slug, value.systemTypeOverrides);
    const nextSystemFolders = { ...value.systemFolders };
    const nextOverrides = { ...value.systemTypeOverrides };
    delete nextSystemFolders[folderKey];
    delete nextOverrides[overrideKey];
    onChange({
      ...value,
      systemFolders: nextSystemFolders,
      systemTypeOverrides: nextOverrides,
    });
  };

  const handleResetAllMappings = () => {
    onChange(createDefaultStorageFolderConfig());
  };

  const runAutoConfigureScan = useCallback(
    async (rootHandle: SdDirectoryHandle) => {
      scanAbortRef.current?.abort();
      const abortController = new AbortController();
      scanAbortRef.current = abortController;

      setAppliedAutoNotice(null);
      setAutoScanError(null);
      setAutoConfigResult(null);
      setAutoScanTargetLabel(rootHandle.name || 'Storage Device');
      setAutoScanProgress({ directoriesScanned: 0, currentPath: rootHandle.name || '' });
      setAutoScanPhase('scanning');

      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        const nodes = await scanStorageDirectoryTree(rootHandle, {
          signal: abortController.signal,
          onProgress: (prog) => {
            if (!abortController.signal.aborted) {
              setAutoScanProgress(prog);
            }
          },
        });
        if (abortController.signal.aborted) return;

        const durationMs = Math.max(
          1,
          Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt),
        );
        const preferredSlugs = [
          ...discoveredAndSyncedSlugs,
          ...Object.keys(value.systemFolders),
          ...Object.keys(value.systemTypeOverrides),
        ];
        const result = discoverStorageFolderMappings(nodes, {
          rootLabel: rootHandle.name || 'Storage Device',
          preferredSlugs,
          durationMs,
        });

        const initialSelected = new Set<string>();
        const initialChosen: Record<string, string> = {};
        for (const match of result.matches) {
          initialChosen[match.canonicalSlug] = match.recommendedPath;
          const diff = classifyDiscoveredConsoleDiff(
            match.canonicalSlug,
            match.recommendedPath,
            match.detectedTypeSubfolders,
            true,
            value,
          );
          if (diff.kind === 'new') {
            initialSelected.add(match.canonicalSlug);
          }
        }

        setChosenPathBySlug(initialChosen);
        setSelectedAutoSlugs(initialSelected);
        setIncludeAutoSubfolders(true);
        setAutoConfigResult(result);
        setAutoScanPhase('ready');
      } catch (err) {
        if (isAbortError(err)) {
          setAutoScanPhase('idle');
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setAutoScanError(msg || 'Failed scanning the selected export directory.');
        setAutoScanPhase('error');
      } finally {
        if (scanAbortRef.current === abortController) {
          scanAbortRef.current = null;
        }
      }
    },
    [discoveredAndSyncedSlugs, value],
  );

  const handlePickAndScanExportFolder = useCallback(async () => {
    setAutoScanError(null);
    setAppliedAutoNotice(null);
    if (!fsSupport.supported) {
      setAutoScanError(
        fsSupport.reason || 'Browser folder picker is not supported in this browser.',
      );
      setAutoScanPhase('error');
      return;
    }

    let handle: SdDirectoryHandle | null = null;
    if (installer) {
      handle = await installer.promptMountSdCard();
      if (!handle) {
        if (installer.mountError) {
          setAutoScanError(installer.mountError);
          setAutoScanPhase('error');
        }
        return;
      }
    } else {
      try {
        handle = await pickSdCardRootDirectory();
      } catch (err) {
        if (isAbortError(err)) return;
        const msg = err instanceof Error ? err.message : String(err);
        setAutoScanError(
          /cross origin|sub frame|user activation/i.test(msg)
            ? 'Browser blocked folder picker inside this embedded frame. Open the app directly in its own tab.'
            : msg,
        );
        setAutoScanPhase('error');
        return;
      }
    }

    if (handle) {
      await runAutoConfigureScan(handle);
    }
  }, [fsSupport, installer, runAutoConfigureScan]);

  const handleScanMountedDevice = useCallback(async () => {
    if (!installer?.sdRootHandle) {
      await handlePickAndScanExportFolder();
      return;
    }
    await runAutoConfigureScan(installer.sdRootHandle);
  }, [installer?.sdRootHandle, handlePickAndScanExportFolder, runAutoConfigureScan]);

  useEffect(() => {
    if (!autoConfigureRequest) return;
    if (autoConfigureRequest.nonce <= lastHandledAutoNonceRef.current) return;
    lastHandledAutoNonceRef.current = autoConfigureRequest.nonce;
    onAutoConfigureRequestHandled?.();
    if (installer?.sdRootHandle) {
      void runAutoConfigureScan(installer.sdRootHandle);
    }
  }, [
    autoConfigureRequest,
    installer?.sdRootHandle,
    onAutoConfigureRequestHandled,
    runAutoConfigureScan,
  ]);

  const handleCancelAutoScan = () => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    setAutoScanPhase('idle');
  };

  const handleToggleAutoSlug = (slug: string) => {
    setSelectedAutoSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleChooseAutoCandidatePath = (slug: string, relativePath: string) => {
    setChosenPathBySlug((prev) => ({
      ...prev,
      [slug]: relativePath,
    }));
    // Automatically select the console when user explicitly picks an alternate path
    setSelectedAutoSlugs((prev) => {
      if (prev.has(slug)) return prev;
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
  };

  const handleApplyAutoConfig = () => {
    if (!autoConfigResult || selectedAutoSlugs.size === 0) return;
    const merged = mergeDiscoveredStorageMappings(value, autoConfigResult, {
      selectedSlugs: selectedAutoSlugs,
      chosenPathBySlug,
      includeTypeSubfolders: includeAutoSubfolders,
    });
    const appliedCount = selectedAutoSlugs.size;
    onChange(merged);
    setAutoConfigResult(null);
    setAutoScanPhase('idle');
    setAppliedAutoNotice(
      `Applied ${appliedCount} discovered console mapping${appliedCount === 1 ? '' : 's'} from "${autoConfigResult.rootLabel}" — click Save Changes below to persist.`,
    );
  };

  const handleDismissAutoReview = () => {
    setAutoConfigResult(null);
    setAutoScanPhase('idle');
    setAutoScanError(null);
  };

  const globalDefaultsExpanded = value.typeSubfoldersEnabled || showGlobalTypeDefaults;

  // Live preview sample paths using SNES
  const samplePreviewSystem = 'snes-roms';
  const sampleRetailPath = resolveTargetStorageFolder(samplePreviewSystem, 'retail', value);
  const sampleHackPath = resolveTargetStorageFolder(samplePreviewSystem, 'hack', value);
  const sampleTranslationPath = resolveTargetStorageFolder(
    samplePreviewSystem,
    'translations',
    value,
  );

  return (
    <section
      ref={sectionRef}
      className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
    >
      <div aria-hidden="true" className="crt-edge-beam">
        <span />
      </div>
      {spotlightNonce !== null && (
        <div
          key={`storage-mappings-${spotlightNonce}`}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
        <div className="flex items-start gap-3">
          <FolderTree className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-crt-text">
                Storage Device Folder Mappings
              </h2>
              <span className="text-xs font-mono text-crt-muted tabular-nums">
                ·{' '}
                {customizedSlugSet.size > 0
                  ? `${customizedSlugSet.size} customized console${customizedSlugSet.size === 1 ? '' : 's'}`
                  : 'Universal defaults'}
                {' · '}
                {value.typeSubfoldersEnabled
                  ? 'ROM Type subfolders enabled'
                  : 'Single console folder mode'}
              </span>
            </div>
            <p className="text-xs text-crt-muted">
              Configure where each console and ROM type is placed relative to your mounted storage device root. Changes persist to SQLite once saved below.
            </p>
          </div>
        </div>

        {hasAnyCustomizations && (
          <button
            type="button"
            onClick={handleResetAllMappings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span>Reset All Mappings</span>
          </button>
        )}
      </div>

      {/* Export Device Auto-Configure Bar */}
      <div className="border border-crt-border bg-crt-bg rounded p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold text-crt-text">
                Auto-Configure from Storage Device
              </span>
              {installer?.sdRootHandle && (
                <span className="font-mono text-[11px] text-crt-muted">
                  · Mounted: <span className="text-crt-phosphor">{installer.sdRootHandle.name}</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-crt-muted max-w-2xl leading-relaxed">
              {fsSupport.supported
                ? 'Select your SD card root, Roms directory, or handheld base export path to automatically discover console base folders and existing ROM-type subfolders.'
                : fsSupport.reason ||
                  'Direct storage device scanning requires Chrome, Edge, or another Chromium browser. You can still configure folder paths manually below.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {autoScanPhase === 'scanning' ? (
              <button
                type="button"
                onClick={handleCancelAutoScan}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                <span>Cancel Scan</span>
              </button>
            ) : installer?.sdRootHandle ? (
              <>
                <button
                  type="button"
                  disabled={!fsSupport.supported}
                  onClick={() => void handleScanMountedDevice()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                  <span>Scan &ldquo;{installer.sdRootHandle.name}&rdquo;</span>
                </button>
                <button
                  type="button"
                  disabled={!fsSupport.supported}
                  onClick={() => void handlePickAndScanExportFolder()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                  <span>Choose Different Folder</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!fsSupport.supported}
                onClick={() => void handlePickAndScanExportFolder()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                <span>Auto-Configure from Folder</span>
              </button>
            )}
          </div>
        </div>

        {autoScanPhase === 'scanning' && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-crt-border/70 text-xs font-mono text-crt-muted tabular-nums">
            <Loader2 className="h-3.5 w-3.5 text-crt-phosphor animate-spin shrink-0" />
            <span>
              Scanning &ldquo;{autoScanTargetLabel}&rdquo; ·{' '}
              {autoScanProgress.directoriesScanned.toLocaleString()} folder
              {autoScanProgress.directoriesScanned === 1 ? '' : 's'} inspected
              {autoScanProgress.currentPath ? ` · /${autoScanProgress.currentPath}` : ''}
            </span>
          </div>
        )}

        {autoScanError && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-crt-border/70 text-xs font-mono text-red-400">
            <span>{autoScanError}</span>
            <button
              type="button"
              onClick={() => {
                setAutoScanError(null);
                setAutoScanPhase('idle');
              }}
              aria-label="Dismiss scan error"
              className="p-0.5 text-crt-muted hover:text-crt-text rounded cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {appliedAutoNotice && autoScanPhase === 'idle' && (
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-crt-border/70 text-xs font-mono text-crt-phosphor">
            <div className="flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{appliedAutoNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAppliedAutoNotice(null)}
              aria-label="Dismiss auto-configure applied notice"
              className="p-0.5 text-crt-muted hover:text-crt-text rounded cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Inline Auto-Configure Review & Selective Merge Workspace */}
      {autoScanPhase === 'ready' && autoConfigResult && (
        <StorageAutoConfigReview
          result={autoConfigResult}
          currentConfig={value}
          selectedSlugs={selectedAutoSlugs}
          chosenPathBySlug={chosenPathBySlug}
          includeTypeSubfolders={includeAutoSubfolders}
          onToggleSlug={handleToggleAutoSlug}
          onSetSelectedSlugs={setSelectedAutoSlugs}
          onChooseCandidatePath={handleChooseAutoCandidatePath}
          onToggleIncludeTypeSubfolders={setIncludeAutoSubfolders}
          onApply={handleApplyAutoConfig}
          onPickDifferentFolder={() => void handlePickAndScanExportFolder()}
          onDismiss={handleDismissAutoReview}
        />
      )}

      {/* Global ROM Type Subfolder Opt-In & Category Defaults */}
      <div className="border border-crt-border bg-crt-bg rounded p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="text-xs font-semibold text-crt-text">
              ROM Type Sub-Directory Routing
            </div>
            <p className="text-[11px] text-crt-muted">
              Keep all ROM types together inside each console folder by default, or opt into categorizing Hacks, Translations, Homebrew, and Ports into subfolders.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Global ROM Type subfolder mode"
              className="inline-flex items-center p-0.5 bg-crt-surface border border-crt-border rounded shrink-0"
            >
              <button
                type="button"
                onClick={() => handleToggleGlobalSubfolders(false)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !value.typeSubfoldersEnabled
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Single Console Folder
              </button>
              <button
                type="button"
                onClick={() => handleToggleGlobalSubfolders(true)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  value.typeSubfoldersEnabled
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Categorize by ROM Type
              </button>
            </div>

            {!value.typeSubfoldersEnabled && (
              <button
                type="button"
                onClick={() => setShowGlobalTypeDefaults((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>{showGlobalTypeDefaults ? 'Hide Type Defaults' : 'Edit Type Defaults'}</span>
                {showGlobalTypeDefaults ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Live SNES Folder Routing Preview */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-crt-muted pt-2 border-t border-crt-border/70">
          <span>Example (SNES):</span>
          <span>
            Retail → <span className="text-crt-phosphor">/{sampleRetailPath}/</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Hack → <span className="text-crt-phosphor">/{sampleHackPath}/</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Translation → <span className="text-crt-phosphor">/{sampleTranslationPath}/</span>
          </span>
        </div>

        {/* Editable Global ROM Type Subfolder Defaults */}
        {globalDefaultsExpanded && (
          <div className="pt-3 border-t border-crt-border space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-crt-muted">
                Default subfolder names appended under each console folder when ROM Type categorization is active. Leave blank to keep a category directly in the console root folder.
              </div>
              {hasCustomGlobalTypeDefaults && (
                <button
                  type="button"
                  onClick={handleResetGlobalTypeDefaults}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3 shrink-0" />
                  <span>Reset Type Defaults</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {STORAGE_ROM_CATEGORIES.map((cat) => {
                const currentSub = value.globalTypeSubfolders[cat.id] ?? '';
                const isDefault = currentSub === cat.defaultSubfolder;
                return (
                  <div
                    key={cat.id}
                    className="border border-crt-border bg-crt-surface rounded p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-crt-text truncate">{cat.label}</span>
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() => handleUpdateGlobalTypeSubfolder(cat.id, cat.defaultSubfolder)}
                          title={`Reset ${cat.label} to default`}
                          className="text-[11px] font-mono text-crt-muted hover:text-crt-phosphor whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={currentSub}
                        placeholder={
                          cat.defaultSubfolder ? cat.defaultSubfolder : '(console root folder)'
                        }
                        aria-label={`Global subfolder for ${cat.label}`}
                        onChange={(e) => handleUpdateGlobalTypeSubfolder(cat.id, e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted/60 focus:outline-none focus:border-crt-phosphor"
                      />
                    </div>
                    <div className="text-[11px] font-mono text-crt-muted truncate">
                      {currentSub.trim()
                        ? `/<Console>/${currentSub.trim().replace(/^\/+|\/+$/g, '')}/`
                        : '/<Console>/ (base console folder)'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Per-Console Folder Mapping Controls */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter consoles, slugs, or folder names..."
              aria-label="Filter console folder mappings"
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear console mapping search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="Console mapping list scope"
            className="inline-flex items-center p-0.5 bg-crt-bg border border-crt-border rounded shrink-0"
          >
            {discoveredConsoleSlugs.length > 0 && (
              <button
                type="button"
                onClick={() => setScopeTab('discovered')}
                className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer ${
                  effectiveScopeTab === 'discovered'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Synced &amp; Discovered ({discoveredConsoleSlugs.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setScopeTab('all')}
              className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer ${
                effectiveScopeTab === 'all'
                  ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                  : 'text-crt-muted hover:text-crt-text border border-transparent'
              }`}
            >
              All Consoles ({allConsoleSlugs.length})
            </button>
            <button
              type="button"
              onClick={() => setScopeTab('customized')}
              className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer ${
                effectiveScopeTab === 'customized'
                  ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                  : 'text-crt-muted hover:text-crt-text border border-transparent'
              }`}
            >
              Customized ({customizedSlugSet.size})
            </button>
          </div>
        </div>

        {/* Brand-Grouped Console Mapping Rows */}
        {brandGroups.length === 0 ? (
          <div className="p-8 text-center text-xs text-crt-muted border border-crt-border bg-crt-bg rounded space-y-2">
            <div>
              {effectiveScopeTab === 'customized'
                ? 'No consoles have custom folder overrides yet—all consoles are using sensible defaults.'
                : `No consoles matched "${searchQuery}".`}
            </div>
            {effectiveScopeTab === 'customized' && (
              <button
                type="button"
                onClick={() => setScopeTab(discoveredConsoleSlugs.length > 0 ? 'discovered' : 'all')}
                className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Browse Consoles
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {brandGroups.map((group) => (
              <div key={group.brand.id} className="space-y-2">
                <div className="flex items-center justify-between text-xs border-b border-crt-border/70 pb-1.5">
                  <span className="font-semibold text-crt-text">{group.brand.label}</span>
                  <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                    {group.items.length} console{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="divide-y divide-crt-border border border-crt-border bg-crt-bg rounded">
                  {group.items.map((item) => {
                    const folderKey = findStoredSlugKey(item.slug, value.systemFolders);
                    const overrideKey = findStoredSlugKey(item.slug, value.systemTypeOverrides);
                    const defaultBase = resolveDefaultSystemFolder(item.slug);
                    const customBaseVal = value.systemFolders[folderKey] ?? '';
                    const effectiveBase = resolveBaseSystemFolder(item.slug, value);

                    const sysOverride = value.systemTypeOverrides[overrideKey];
                    const sysMode: SystemTypeSubfolderMode = sysOverride?.mode || 'inherit';
                    const sysSubOverrides = sysOverride?.subfolders || {};
                    const sysSubOverrideCount = Object.keys(sysSubOverrides).length;
                    const effectiveSubfoldersActive = isTypeSubfoldersActiveForSystem(
                      item.slug,
                      value,
                    );
                    const isConsoleCustomized =
                      (customBaseVal.trim() !== '' && customBaseVal.trim() !== defaultBase) ||
                      sysMode !== 'inherit' ||
                      sysSubOverrideCount > 0;

                    const isExpanded = expandedConsoleSlug === item.slug;

                    const typeButtonSummary =
                      sysMode === 'enabled'
                        ? sysSubOverrideCount > 0
                          ? `Subfolders On · ${sysSubOverrideCount} custom`
                          : 'Subfolders On'
                        : sysMode === 'disabled'
                          ? 'Single Folder'
                          : sysSubOverrideCount > 0
                            ? `${value.typeSubfoldersEnabled ? 'Global On' : 'Global Off'} · ${sysSubOverrideCount} custom`
                            : 'Type Subfolders';

                    return (
                      <div key={item.slug} className="p-3 space-y-3">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                              <span className="font-medium text-crt-text">{item.displayName}</span>
                              <span className="font-mono text-[11px] text-crt-muted">
                                · {item.slug}
                              </span>
                              {isConsoleCustomized && (
                                <span className="font-mono text-[11px] text-crt-phosphor">
                                  · Customized
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                            <div className="relative flex items-center w-full sm:w-56">
                              <span
                                aria-hidden="true"
                                className="pl-2.5 pr-1 text-xs font-mono text-crt-muted select-none"
                              >
                                /
                              </span>
                              <input
                                type="text"
                                value={customBaseVal}
                                placeholder={defaultBase}
                                aria-label={`Base storage folder for ${item.displayName}`}
                                onChange={(e) =>
                                  handleUpdateSystemBaseFolder(item.slug, e.target.value)
                                }
                                className={`w-full py-1.5 pr-7 text-xs font-mono bg-crt-surface border rounded focus:outline-none focus:border-crt-phosphor ${
                                  customBaseVal.trim() && customBaseVal.trim() !== defaultBase
                                    ? 'border-crt-phosphor/60 text-crt-phosphor'
                                    : 'border-crt-border text-crt-text placeholder:text-crt-muted/80'
                                }`}
                              />
                              {customBaseVal !== '' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSystemBaseFolder(item.slug, '')}
                                  title={`Reset ${item.displayName} base folder to /${defaultBase}`}
                                  aria-label={`Reset ${item.displayName} base folder`}
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-crt-muted hover:text-crt-text rounded cursor-pointer"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() =>
                                setExpandedConsoleSlug((prev) =>
                                  prev === item.slug ? null : item.slug,
                                )
                              }
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                isExpanded || sysMode !== 'inherit' || sysSubOverrideCount > 0
                                  ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor'
                                  : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                              }`}
                            >
                              <span>{typeButtonSummary}</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Expandable Per-Console ROM Type Subfolder Override Drawer */}
                        {isExpanded && (
                          <div className="pt-3 border-t border-crt-border/80 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div
                                role="group"
                                aria-label={`ROM Type subfolder mode for ${item.displayName}`}
                                className="inline-flex flex-wrap items-center p-0.5 bg-crt-surface border border-crt-border rounded"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleSetConsoleSubfolderMode(item.slug, 'inherit')}
                                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    sysMode === 'inherit'
                                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                                  }`}
                                >
                                  Follow Global ({value.typeSubfoldersEnabled ? 'Subfolders On' : 'Single Folder'})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSetConsoleSubfolderMode(item.slug, 'enabled')}
                                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    sysMode === 'enabled'
                                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                                  }`}
                                >
                                  Enable Type Subfolders
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSetConsoleSubfolderMode(item.slug, 'disabled')}
                                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    sysMode === 'disabled'
                                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                                  }`}
                                >
                                  Force Single Folder
                                </button>
                              </div>

                              {isConsoleCustomized && (
                                <button
                                  type="button"
                                  onClick={() => handleResetConsoleAllOverrides(item.slug)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3 shrink-0" />
                                  <span>Reset {item.displayName}</span>
                                </button>
                              )}
                            </div>

                            {effectiveSubfoldersActive ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                {STORAGE_ROM_CATEGORIES.map((cat) => {
                                  const hasOverride = sysSubOverrides[cat.id] !== undefined;
                                  const overrideVal = sysSubOverrides[cat.id] ?? '';
                                  const inheritedGlobal = value.globalTypeSubfolders[cat.id] ?? '';
                                  const resolvedFull = resolveTargetStorageFolder(
                                    item.slug,
                                    cat.id,
                                    value,
                                  );

                                  return (
                                    <div
                                      key={cat.id}
                                      className="border border-crt-border bg-crt-surface rounded p-2.5 space-y-1.5"
                                    >
                                      <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-medium text-crt-text truncate">
                                          {cat.shortLabel}
                                        </span>
                                        <div className="flex items-center gap-2 shrink-0">
                                          {!hasOverride && inheritedGlobal !== '' && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleSetConsoleCategorySubfolder(item.slug, cat.id, '')
                                              }
                                              title={`Keep ${cat.label} in /${effectiveBase}/ on ${item.displayName}`}
                                              className="text-[11px] font-mono text-crt-muted hover:text-crt-text whitespace-nowrap shrink-0 cursor-pointer"
                                            >
                                              Use Root
                                            </button>
                                          )}
                                          {hasOverride && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleSetConsoleCategorySubfolder(
                                                  item.slug,
                                                  cat.id,
                                                  undefined,
                                                )
                                              }
                                              title="Clear console override and inherit global setting"
                                              className="text-[11px] font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                                            >
                                              Inherit Global
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      <input
                                        type="text"
                                        value={hasOverride ? overrideVal : ''}
                                        placeholder={
                                          hasOverride
                                            ? '(console root folder)'
                                            : inheritedGlobal
                                              ? `${inheritedGlobal} (global)`
                                              : '(console root folder)'
                                        }
                                        aria-label={`${item.displayName} subfolder for ${cat.label}`}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          if (raw === '' && inheritedGlobal === '') {
                                            handleSetConsoleCategorySubfolder(
                                              item.slug,
                                              cat.id,
                                              undefined,
                                            );
                                          } else {
                                            handleSetConsoleCategorySubfolder(item.slug, cat.id, raw);
                                          }
                                        }}
                                        className={`w-full px-2.5 py-1 text-xs font-mono bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                                          hasOverride
                                            ? 'border-crt-phosphor/60 text-crt-phosphor'
                                            : 'border-crt-border text-crt-text placeholder:text-crt-muted/70'
                                        }`}
                                      />

                                      <div className="text-[11px] font-mono text-crt-muted truncate">
                                        → <span className="text-crt-phosphor">/{resolvedFull}/</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-xs font-mono text-crt-muted">
                                All ROM types for {item.displayName} currently install directly into{' '}
                                <span className="text-crt-phosphor">/{effectiveBase}/</span>. Enable Type Subfolders above to route Hacks, Translations, and Homebrew into separate subdirectories.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
