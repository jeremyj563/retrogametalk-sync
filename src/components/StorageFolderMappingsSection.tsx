import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderSearch,
  FolderTree,
  HardDrive,
  Loader2,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { buildScanReviewSummary, findEvaluatedScanMatch } from '../shared/deviceExportUi';
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
  getStorageRomCategoryShortLabel,
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

type ConsoleScopeTab = 'scan' | 'discovered' | 'all' | 'customized';

interface StorageFolderMappingsSectionProps {
  sectionRef: RefObject<HTMLElement | null>;
  spotlightNonce: number | null;
  value: StorageFolderMappingConfig;
  onChange: (next: StorageFolderMappingConfig) => void;
  onApplyAndSave?: (next: StorageFolderMappingConfig) => Promise<boolean>;
  saving?: boolean;
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
  onApplyAndSave,
  saving = false,
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

  // Unified Export Device Auto-Configure state (renders in-place inside the single console list)
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
  const [showUnmatchedFolders, setShowUnmatchedFolders] = useState<boolean>(false);
  const [appliedAutoNotice, setAppliedAutoNotice] = useState<string | null>(null);
  const [applyingAndSaving, setApplyingAndSaving] = useState<boolean>(false);
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

  const customGlobalTypeCount = useMemo(
    () =>
      STORAGE_ROM_CATEGORY_KEYS.filter(
        (key) => (value.globalTypeSubfolders[key] ?? '') !== DEFAULT_ROM_TYPE_SUBFOLDERS[key],
      ).length,
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

  const isReviewMode = autoScanPhase === 'ready' && autoConfigResult !== null;

  const scanReview = useMemo(() => {
    if (!isReviewMode || !autoConfigResult) return null;
    return buildScanReviewSummary(
      autoConfigResult,
      value,
      selectedAutoSlugs,
      chosenPathBySlug,
      includeAutoSubfolders,
    );
  }, [
    isReviewMode,
    autoConfigResult,
    value,
    selectedAutoSlugs,
    chosenPathBySlug,
    includeAutoSubfolders,
  ]);

  const scanMatchedSlugs = useMemo(
    () => (scanReview ? scanReview.rows.map((row) => row.match.canonicalSlug) : []),
    [scanReview],
  );

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
          ...scanMatchedSlugs,
        ],
        true,
      ),
    [discoveredAndSyncedSlugs, value.systemFolders, value.systemTypeOverrides, scanMatchedSlugs],
  );

  const effectiveScopeTab: ConsoleScopeTab = useMemo(() => {
    if (scopeTab === 'scan' && (!isReviewMode || scanMatchedSlugs.length === 0)) {
      return discoveredConsoleSlugs.length > 0 ? 'discovered' : 'all';
    }
    if (scopeTab === 'discovered' && discoveredConsoleSlugs.length === 0) {
      return 'all';
    }
    return scopeTab;
  }, [scopeTab, isReviewMode, scanMatchedSlugs.length, discoveredConsoleSlugs.length]);

  const scopedSlugs = useMemo(() => {
    if (effectiveScopeTab === 'scan') {
      return scanMatchedSlugs;
    }
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
  }, [
    effectiveScopeTab,
    scanMatchedSlugs,
    discoveredConsoleSlugs,
    allConsoleSlugs,
    customizedSlugSet,
  ]);

  const filteredSlugs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scopedSlugs;
    return scopedSlugs.filter((slug) => {
      const info = resolveSystemDisplayInfo(slug);
      const baseFolder = resolveBaseSystemFolder(slug, value).toLowerCase();
      const matchedPath =
        findEvaluatedScanMatch(scanReview, slug)?.activeCandidate.relativePath.toLowerCase() || '';
      return (
        info.displayName.toLowerCase().includes(q) ||
        info.slug.toLowerCase().includes(q) ||
        info.brandLabel.toLowerCase().includes(q) ||
        info.aliases.some((alias) => alias.toLowerCase().includes(q)) ||
        baseFolder.includes(q) ||
        matchedPath.includes(q)
      );
    });
  }, [scopedSlugs, searchQuery, value, scanReview]);

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
      setShowUnmatchedFolders(false);
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
        setExpandedConsoleSlug(null);
        setSearchQuery('');
        if (result.matches.length > 0) {
          setScopeTab('scan');
        }
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
    setSelectedAutoSlugs((prev) => {
      if (prev.has(slug)) return prev;
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
  };

  const handleSelectNewScanMatches = () => {
    if (!scanReview) return;
    const next = new Set<string>();
    for (const row of scanReview.rows) {
      if (row.diff.kind === 'new') {
        next.add(row.match.canonicalSlug);
      }
    }
    setSelectedAutoSlugs(next);
  };

  const handleSelectAllChangedScanMatches = () => {
    if (!scanReview) return;
    const next = new Set<string>();
    for (const row of scanReview.rows) {
      if (row.diff.kind !== 'unchanged') {
        next.add(row.match.canonicalSlug);
      }
    }
    if (next.size === 0) {
      for (const row of scanReview.rows) {
        next.add(row.match.canonicalSlug);
      }
    }
    setSelectedAutoSlugs(next);
  };

  const exitReviewModeToDefaultTab = useCallback(() => {
    setAutoConfigResult(null);
    setAutoScanPhase('idle');
    setShowUnmatchedFolders(false);
    setScopeTab((prev) =>
      prev === 'scan'
        ? discoveredConsoleSlugs.length > 0
          ? 'discovered'
          : 'all'
        : prev,
    );
  }, [discoveredConsoleSlugs.length]);

  const buildMergedAutoConfig = () => {
    if (!autoConfigResult || selectedAutoSlugs.size === 0) return null;
    return mergeDiscoveredStorageMappings(value, autoConfigResult, {
      selectedSlugs: selectedAutoSlugs,
      chosenPathBySlug,
      includeTypeSubfolders: includeAutoSubfolders,
    });
  };

  const handleApplyAutoConfigToDraft = () => {
    const merged = buildMergedAutoConfig();
    if (!merged || !autoConfigResult) return;
    const appliedCount = selectedAutoSlugs.size;
    const rootLabel = autoConfigResult.rootLabel;
    onChange(merged);
    exitReviewModeToDefaultTab();
    setAppliedAutoNotice(
      `Applied ${appliedCount} folder mapping${appliedCount === 1 ? '' : 's'} from "${rootLabel}" to draft — click Save Changes below to persist.`,
    );
  };

  const handleApplyAndSaveAutoConfig = async () => {
    const merged = buildMergedAutoConfig();
    if (!merged || !autoConfigResult) return;
    const appliedCount = selectedAutoSlugs.size;
    const rootLabel = autoConfigResult.rootLabel;

    if (!onApplyAndSave) {
      handleApplyAutoConfigToDraft();
      return;
    }

    setApplyingAndSaving(true);
    setAutoScanError(null);
    try {
      onChange(merged);
      const ok = await onApplyAndSave(merged);
      if (ok) {
        exitReviewModeToDefaultTab();
        setAppliedAutoNotice(
          `Saved ${appliedCount} auto-configured folder mapping${appliedCount === 1 ? '' : 's'} from "${rootLabel}".`,
        );
      }
    } finally {
      setApplyingAndSaving(false);
    }
  };

  const handleDismissAutoReview = () => {
    setAutoScanError(null);
    exitReviewModeToDefaultTab();
  };

  const selectedScanCount = selectedAutoSlugs.size;
  const isBusySaving = saving || applyingAndSaving;

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

      {/* Unified Header: Title + Inline Summary + Direct Auto-Configure Action */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
        <div className="flex items-start gap-3 min-w-0">
          <FolderTree className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="font-display text-lg font-semibold text-crt-text">
                01. Console Folders
              </h2>
              <span className="text-xs font-mono text-crt-muted tabular-nums">
                ·{' '}
                {customizedSlugSet.size > 0
                  ? `${customizedSlugSet.size} custom`
                  : 'Default paths'}
                {' · '}
                {value.typeSubfoldersEnabled ? 'Sorted by ROM type' : 'Single folder per console'}
              </span>
            </div>
            <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
              Where each console&apos;s ROMs are written on your storage device. Auto-configure from your SD card or edit any folder inline below.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {autoScanPhase === 'scanning' ? (
            <button
              type="button"
              onClick={handleCancelAutoScan}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              <span>Cancel Scan</span>
            </button>
          ) : installer?.sdRootHandle ? (
            <>
              <button
                type="button"
                disabled={!fsSupport.supported || isBusySaving}
                onClick={() => void handleScanMountedDevice()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[180px] truncate">
                  Auto-Configure &ldquo;{installer.sdRootHandle.name}&rdquo;
                </span>
              </button>
              <button
                type="button"
                disabled={!fsSupport.supported || isBusySaving}
                onClick={() => void handlePickAndScanExportFolder()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <HardDrive className="h-3.5 w-3.5 shrink-0" />
                <span>Scan Other</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!fsSupport.supported || isBusySaving}
              onClick={() => void handlePickAndScanExportFolder()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderSearch className="h-3.5 w-3.5 shrink-0" />
              <span>Auto-Configure from Folder</span>
            </button>
          )}

          {hasAnyCustomizations && autoScanPhase !== 'scanning' && (
            <button
              type="button"
              disabled={isBusySaving}
              onClick={handleResetAllMappings}
              title="Reset all console folders and subfolder overrides back to defaults"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-40 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              <span>Reset All</span>
            </button>
          )}
        </div>
      </div>

      {/* Transient Scan Status / Browser Support Note / Confirmation Notice */}
      {!fsSupport.supported && (
        <div className="text-[11px] font-mono text-crt-muted leading-relaxed">
          {fsSupport.reason} Manual folder mapping below still works in all browsers.
        </div>
      )}

      {autoScanPhase === 'scanning' && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border border-crt-phosphor/40 bg-crt-bg rounded text-xs font-mono text-crt-muted tabular-nums">
          <Loader2 className="h-3.5 w-3.5 text-crt-phosphor animate-spin shrink-0" />
          <span className="truncate">
            Scanning &ldquo;{autoScanTargetLabel}&rdquo; ·{' '}
            {autoScanProgress.directoriesScanned.toLocaleString()} folder
            {autoScanProgress.directoriesScanned === 1 ? '' : 's'} inspected
            {autoScanProgress.currentPath ? ` · /${autoScanProgress.currentPath}` : ''}
          </span>
        </div>
      )}

      {autoScanError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border border-crt-crimson/40 bg-crt-bg rounded text-xs font-mono text-crt-crimson">
          <span className="break-words">{autoScanError}</span>
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
        <div className="flex items-center justify-between gap-2 px-3 py-2 border border-crt-phosphor/40 bg-crt-bg rounded text-xs font-mono text-crt-phosphor">
          <div className="flex items-center gap-1.5 min-w-0">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>{appliedAutoNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setAppliedAutoNotice(null)}
            aria-label="Dismiss auto-configure notice"
            className="p-0.5 text-crt-muted hover:text-crt-text rounded cursor-pointer shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Streamlined Folder Organization Row (Hairline-separated, Zero Card-in-Card Nesting) */}
      <div className="border-b border-crt-border pb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-medium text-crt-text">ROM Organization</div>
            <p className="text-[11px] text-crt-muted">
              Keep every ROM together inside its console folder, or group Hacks, Translations, and Homebrew into subfolders.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Global ROM Type subfolder mode"
              className="inline-flex items-center p-0.5 bg-crt-bg border border-crt-border rounded shrink-0"
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
                Single Folder
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
                Sort by ROM Type
              </button>
            </div>

            <button
              type="button"
              aria-expanded={showGlobalTypeDefaults}
              onClick={() => setShowGlobalTypeDefaults((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showGlobalTypeDefaults || customGlobalTypeCount > 0
                  ? 'border-crt-phosphor/50 bg-crt-phosphor/10 text-crt-phosphor'
                  : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
              <span>
                Subfolder Names
                {customGlobalTypeCount > 0 ? ` (${customGlobalTypeCount})` : ''}
              </span>
              {showGlobalTypeDefaults ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Advanced: Default ROM-Type Subfolder Names */}
        {showGlobalTypeDefaults && (
          <div className="pt-3 border-t border-crt-border/70 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-crt-muted">
                Default subfolder names appended under each console when ROM-type sorting is active. Leave blank to place a category directly in the console root.
              </p>
              {customGlobalTypeCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetGlobalTypeDefaults}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3 shrink-0" />
                  <span>Reset Defaults</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
              {STORAGE_ROM_CATEGORIES.map((cat) => {
                const currentSub = value.globalTypeSubfolders[cat.id] ?? '';
                const isDefault = currentSub === cat.defaultSubfolder;
                return (
                  <div key={cat.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-crt-text truncate">{cat.label}</span>
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateGlobalTypeSubfolder(cat.id, cat.defaultSubfolder)
                          }
                          className="font-mono text-crt-muted hover:text-crt-phosphor whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={currentSub}
                      placeholder={
                        cat.defaultSubfolder ? cat.defaultSubfolder : '(console root)'
                      }
                      aria-label={`Global subfolder for ${cat.label}`}
                      onChange={(e) => handleUpdateGlobalTypeSubfolder(cat.id, e.target.value)}
                      className={`w-full px-2.5 py-1.5 text-xs font-mono bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                        !isDefault
                          ? 'border-crt-phosphor/60 text-crt-phosphor'
                          : 'border-crt-border text-crt-text placeholder:text-crt-muted/60'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Unified Single Console Table (Normal Mode + In-Place Auto-Configure Review Mode) */}
      <div className="space-y-3.5">
        {/* Compact In-Place Scan Review Strip (Docked Directly Above the Single Console Table) */}
        {isReviewMode && autoConfigResult && scanReview && (
          <div
            role="region"
            aria-label="Export device auto-configure review"
            className="border border-crt-phosphor/50 bg-crt-bg rounded p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <FolderSearch className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
                  <span className="font-semibold text-crt-text">
                    Reviewing &ldquo;{autoConfigResult.rootLabel}&rdquo;
                  </span>
                  <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                    · {autoConfigResult.detectedLayoutLabel} ·{' '}
                    <span className="text-crt-phosphor">
                      {scanReview.counts.total} matched
                    </span>
                    {scanReview.counts.withSubfoldersCount > 0
                      ? ` · ${scanReview.counts.withSubfoldersCount} with subfolders`
                      : ''}
                    {autoConfigResult.stats.durationMs > 0
                      ? ` · ${autoConfigResult.stats.durationMs}ms`
                      : ''}
                  </span>
                </div>

                {autoConfigResult.matches.length === 0 ? (
                  <p className="text-xs text-crt-muted leading-relaxed">
                    No recognizable console folders were found inside{' '}
                    <span className="font-mono text-crt-text">{autoConfigResult.rootLabel}</span>.
                    Try picking your SD card root, <span className="font-mono text-crt-text">Roms</span>,
                    or emulator base folder.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-crt-muted">
                    <span>Check the rows below to update, then apply.</span>
                    {scanReview.counts.updatesCustomCount > 0 && (
                      <span className="text-crt-amber">
                        {scanReview.counts.updatesCustomCount} existing custom path
                        {scanReview.counts.updatesCustomCount === 1 ? '' : 's'} left unchecked for safety.
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleDismissAutoReview}
                aria-label="Dismiss auto-configure review"
                className="p-1 text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {autoConfigResult.matches.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handlePickAndScanExportFolder()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FolderSearch className="h-3.5 w-3.5 shrink-0" />
                  <span>Pick Different Folder</span>
                </button>
                <button
                  type="button"
                  onClick={handleDismissAutoReview}
                  className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-crt-border/70">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={handleSelectNewScanMatches}
                      className="px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer"
                    >
                      New ({scanReview.counts.newCount})
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectAllChangedScanMatches}
                      className="px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer"
                    >
                      All Changed ({scanReview.counts.actionableCount})
                    </button>
                    {selectedScanCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedAutoSlugs(new Set())}
                        className="px-2 py-1 text-[11px] font-mono text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Clear
                      </button>
                    )}

                    {scanReview.counts.withSubfoldersCount > 0 && (
                      <label className="inline-flex items-center gap-1.5 pl-1 text-xs text-crt-text cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={includeAutoSubfolders}
                          onChange={(e) => setIncludeAutoSubfolders(e.target.checked)}
                          className="accent-crt-phosphor"
                        />
                        <span className="whitespace-nowrap">
                          Include subfolders ({scanReview.counts.withSubfoldersCount})
                        </span>
                      </label>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
                    <button
                      type="button"
                      disabled={selectedScanCount === 0 || isBusySaving}
                      onClick={handleApplyAutoConfigToDraft}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      <span>Apply to Draft</span>
                    </button>
                    <button
                      type="button"
                      disabled={selectedScanCount === 0 || isBusySaving}
                      onClick={() => void handleApplyAndSaveAutoConfig()}
                      className="crt-cta-beam inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer"
                    >
                      <Save className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {applyingAndSaving
                          ? 'Saving...'
                          : `Apply & Save (${selectedScanCount})`}
                      </span>
                    </button>
                  </div>
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
              </>
            )}
          </div>
        )}

        {/* Search & Scope Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter consoles or folder paths..."
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
            className="inline-flex flex-wrap items-center p-0.5 bg-crt-bg border border-crt-border rounded shrink-0"
          >
            {isReviewMode && scanMatchedSlugs.length > 0 && (
              <button
                type="button"
                onClick={() => setScopeTab('scan')}
                className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer ${
                  effectiveScopeTab === 'scan'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Scan Matches ({scanMatchedSlugs.length})
              </button>
            )}
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
                Synced ({discoveredConsoleSlugs.length})
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
              All ({allConsoleSlugs.length})
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

        {/* Single Brand-Grouped Console Table */}
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
                onClick={() =>
                  setScopeTab(discoveredConsoleSlugs.length > 0 ? 'discovered' : 'all')
                }
                className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Browse Consoles
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {brandGroups.map((group) => (
              <div key={group.brand.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs pb-1">
                  <span className="font-semibold text-crt-text">{group.brand.label}</span>
                  <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                    {group.items.length} console{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="divide-y divide-crt-border border border-crt-border bg-crt-bg rounded">
                  {group.items.map((item) => {
                    const evaluatedScan = findEvaluatedScanMatch(scanReview, item.slug);

                    // In-place Scan Review row for matched consoles
                    if (evaluatedScan) {
                      const { match, activeCandidate, diff, detectedSubEntries } = evaluatedScan;
                      const checked = selectedAutoSlugs.has(match.canonicalSlug);
                      const hasAlternatives = match.candidates.length > 1;
                      const statusLabel =
                        diff.kind === 'new'
                          ? 'New'
                          : diff.kind === 'updates_custom'
                            ? 'Updates Custom'
                            : 'Already Matches';
                      const statusClass =
                        diff.kind === 'new'
                          ? 'text-crt-phosphor'
                          : diff.kind === 'updates_custom'
                            ? 'text-crt-amber'
                            : 'text-crt-muted';

                      return (
                        <div
                          key={item.slug}
                          className={`px-3 py-2.5 transition-colors ${
                            checked ? 'bg-crt-phosphor/[0.05]' : ''
                          }`}
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                            <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleAutoSlug(match.canonicalSlug)}
                                aria-label={`Apply discovered path for ${match.displayName}`}
                                className="accent-crt-phosphor mt-0.5 shrink-0"
                              />
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                  <span className="font-medium text-crt-text">
                                    {item.displayName}
                                  </span>
                                  <span className="font-mono text-[11px] text-crt-muted">
                                    · {item.slug}
                                  </span>
                                  <span className={`font-mono text-[11px] ${statusClass}`}>
                                    · {statusLabel}
                                  </span>
                                  {activeCandidate.fileCount > 0 && (
                                    <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                                      · {activeCandidate.fileCount.toLocaleString()} file
                                      {activeCandidate.fileCount === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-mono">
                                  {diff.baseChanged ? (
                                    <>
                                      <span className="text-crt-muted">/{diff.currentBasePath}</span>
                                      <ArrowRight
                                        aria-hidden="true"
                                        className="h-3 w-3 text-crt-muted shrink-0"
                                      />
                                      <span className="text-crt-phosphor">
                                        /{activeCandidate.relativePath}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-crt-text">
                                      /{activeCandidate.relativePath}
                                    </span>
                                  )}
                                </div>

                                {detectedSubEntries.length > 0 && (
                                  <div
                                    className={`text-[11px] font-mono ${
                                      includeAutoSubfolders
                                        ? 'text-crt-muted'
                                        : 'text-crt-muted/50 line-through'
                                    }`}
                                  >
                                    Subfolders:{' '}
                                    {detectedSubEntries.map(([catKey, folderName], idx) => (
                                      <span key={catKey}>
                                        {idx > 0 && <span aria-hidden="true"> · </span>}
                                        {getStorageRomCategoryShortLabel(catKey)} →{' '}
                                        <span
                                          className={
                                            includeAutoSubfolders
                                              ? 'text-crt-text'
                                              : 'text-crt-muted/60'
                                          }
                                        >
                                          /{folderName}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </label>

                            {hasAlternatives && (
                              <div className="pl-6 md:pl-0 shrink-0">
                                <select
                                  aria-label={`Choose alternate folder path for ${match.displayName}`}
                                  value={activeCandidate.relativePath}
                                  onChange={(e) =>
                                    handleChooseAutoCandidatePath(
                                      match.canonicalSlug,
                                      e.target.value,
                                    )
                                  }
                                  className="max-w-full sm:max-w-[240px] px-2 py-1 text-[11px] font-mono bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                                >
                                  {match.candidates.map((cand) => (
                                    <option key={cand.relativePath} value={cand.relativePath}>
                                      /{cand.relativePath}
                                      {cand.fileCount > 0
                                        ? ` (${cand.fileCount} files)`
                                        : ' (empty)'}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Normal editable console row
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
                    const hasSubfolderOverride = sysMode !== 'inherit' || sysSubOverrideCount > 0;
                    const isConsoleCustomized =
                      (customBaseVal.trim() !== '' && customBaseVal.trim() !== defaultBase) ||
                      hasSubfolderOverride;

                    const isExpanded = expandedConsoleSlug === item.slug;

                    const subfolderButtonLabel =
                      sysMode === 'enabled'
                        ? sysSubOverrideCount > 0
                          ? `Subfolders · ${sysSubOverrideCount}`
                          : 'Subfolders On'
                        : sysMode === 'disabled'
                          ? 'Single Folder'
                          : sysSubOverrideCount > 0
                            ? `${sysSubOverrideCount} Custom`
                            : 'Subfolders';

                    return (
                      <div key={item.slug} className="px-3 py-2.5 space-y-3">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                              <span className="font-medium text-crt-text">{item.displayName}</span>
                              <span className="font-mono text-[11px] text-crt-muted">
                                · {item.slug}
                              </span>
                              {isConsoleCustomized && (
                                <span className="font-mono text-[11px] text-crt-phosphor">
                                  · Custom
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
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                isExpanded || hasSubfolderOverride
                                  ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor'
                                  : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                              }`}
                            >
                              <span>{subfolderButtonLabel}</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Progressive Disclosure: Per-Console ROM-Type Subfolder Overrides */}
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
                                  onClick={() =>
                                    handleSetConsoleSubfolderMode(item.slug, 'inherit')
                                  }
                                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    sysMode === 'inherit'
                                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                                  }`}
                                >
                                  Follow Global (
                                  {value.typeSubfoldersEnabled ? 'Sort by Type' : 'Single Folder'})
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSetConsoleSubfolderMode(item.slug, 'enabled')
                                  }
                                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    sysMode === 'enabled'
                                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                                  }`}
                                >
                                  Sort by Type
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSetConsoleSubfolderMode(item.slug, 'disabled')
                                  }
                                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    sysMode === 'disabled'
                                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                                  }`}
                                >
                                  Single Folder
                                </button>
                              </div>

                              {isConsoleCustomized && (
                                <button
                                  type="button"
                                  onClick={() => handleResetConsoleAllOverrides(item.slug)}
                                  className="inline-flex items-center gap-1 text-xs font-mono text-crt-muted hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <RotateCcw className="h-3 w-3 shrink-0" />
                                  <span>Reset {item.displayName}</span>
                                </button>
                              )}
                            </div>

                            {effectiveSubfoldersActive ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
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
                                    <div key={cat.id} className="space-y-1">
                                      <div className="flex items-center justify-between gap-2 text-[11px]">
                                        <span className="font-medium text-crt-text truncate">
                                          {cat.shortLabel}
                                        </span>
                                        <div className="flex items-center gap-2 shrink-0">
                                          {!hasOverride && inheritedGlobal !== '' && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleSetConsoleCategorySubfolder(
                                                  item.slug,
                                                  cat.id,
                                                  '',
                                                )
                                              }
                                              title={`Keep ${cat.label} in /${effectiveBase}/ on ${item.displayName}`}
                                              className="font-mono text-crt-muted hover:text-crt-text whitespace-nowrap shrink-0 cursor-pointer"
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
                                              className="font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                                            >
                                              Inherit
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      <input
                                        type="text"
                                        value={hasOverride ? overrideVal : ''}
                                        placeholder={
                                          hasOverride
                                            ? '(console root)'
                                            : inheritedGlobal
                                              ? `${inheritedGlobal} (global)`
                                              : '(console root)'
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
                                            handleSetConsoleCategorySubfolder(
                                              item.slug,
                                              cat.id,
                                              raw,
                                            );
                                          }
                                        }}
                                        className={`w-full px-2.5 py-1 text-xs font-mono bg-crt-surface border rounded focus:outline-none focus:border-crt-phosphor ${
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
                                All ROM types for {item.displayName} currently write to{' '}
                                <span className="text-crt-phosphor">/{effectiveBase}/</span>.
                                Switch to <span className="text-crt-text">Sort by Type</span> above
                                to route Hacks, Translations, and Homebrew into subfolders.
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
