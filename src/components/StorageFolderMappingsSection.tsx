import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FolderTree,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  getActiveManualOverrideSlugs,
  searchConsolesForOverride,
} from '../shared/deviceExportUi';
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
import { resolveSystemDisplayInfo } from '../shared/systemCatalog';

interface StorageFolderMappingsSectionProps {
  value: StorageFolderMappingConfig;
  effectiveFolderConfig: StorageFolderMappingConfig;
  onChange: (next: StorageFolderMappingConfig) => void;
  discoveredAndSyncedSlugs: string[];
  detectedDeviceSlugs?: string[];
  pinOverrideRequest?: { slug: string; nonce: number } | null;
  onPinOverrideHandled?: () => void;
}

export function StorageFolderMappingsSection({
  value,
  effectiveFolderConfig,
  onChange,
  discoveredAndSyncedSlugs,
  detectedDeviceSlugs = [],
  pinOverrideRequest = null,
  onPinOverrideHandled,
}: StorageFolderMappingsSectionProps) {
  const [showGlobalTypeDefaults, setShowGlobalTypeDefaults] = useState(false);
  const [expandedConsoleSlug, setExpandedConsoleSlug] = useState<string | null>(null);
  const [pinnedDraftSlugs, setPinnedDraftSlugs] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingFocusSlug, setPendingFocusSlug] = useState<string | null>(null);

  const pickerContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRefsBySlug = useRef<Record<string, HTMLInputElement | null>>({});
  const lastPinNonceRef = useRef<number>(0);

  // Close Search-to-Add dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        pickerContainerRef.current &&
        !pickerContainerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [pickerOpen]);

  // Focus newly added override input smoothly
  useEffect(() => {
    if (!pendingFocusSlug) return;
    const inputEl = inputRefsBySlug.current[pendingFocusSlug.toLowerCase()];
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
      setPendingFocusSlug(null);
    }
  }, [pendingFocusSlug, pinnedDraftSlugs, value]);

  // Handle "Override" pin request coming from the top Active Device detected-folders disclosure
  useEffect(() => {
    if (!pinOverrideRequest) return;
    if (pinOverrideRequest.nonce <= lastPinNonceRef.current) return;
    lastPinNonceRef.current = pinOverrideRequest.nonce;
    const slugLower = pinOverrideRequest.slug.toLowerCase();
    setPinnedDraftSlugs((prev) => (prev.includes(slugLower) ? prev : [...prev, slugLower]));
    setPendingFocusSlug(slugLower);
    onPinOverrideHandled?.();
  }, [pinOverrideRequest, onPinOverrideHandled]);

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

  const persistedOverrideSlugs = useMemo(
    () => getActiveManualOverrideSlugs(value),
    [value],
  );

  const activeOverrideSlugs = useMemo(() => {
    const seenDisplayNames = new Set<string>();
    const combined: string[] = [];
    for (const slug of [...persistedOverrideSlugs, ...pinnedDraftSlugs]) {
      const lower = slug.toLowerCase();
      const displayName = resolveSystemDisplayInfo(lower).displayName;
      if (seenDisplayNames.has(displayName)) continue;
      seenDisplayNames.add(displayName);
      combined.push(lower);
    }
    return combined;
  }, [persistedOverrideSlugs, pinnedDraftSlugs]);

  const activeOverrideSet = useMemo(() => new Set(activeOverrideSlugs), [activeOverrideSlugs]);

  const allSearchableConsoleSlugs = useMemo(
    () =>
      buildUniqueConsoleMappingSlugs(
        [
          ...detectedDeviceSlugs,
          ...discoveredAndSyncedSlugs,
          ...Object.keys(value.systemFolders),
          ...Object.keys(value.systemTypeOverrides),
        ],
        true,
      ),
    [detectedDeviceSlugs, discoveredAndSyncedSlugs, value.systemFolders, value.systemTypeOverrides],
  );

  const searchOptions = useMemo(
    () =>
      searchConsolesForOverride(
        allSearchableConsoleSlugs,
        pickerQuery,
        activeOverrideSet,
        effectiveFolderConfig,
        28,
      ),
    [allSearchableConsoleSlugs, pickerQuery, activeOverrideSet, effectiveFolderConfig],
  );

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

  const handleAddConsoleOverride = (slug: string) => {
    const lower = slug.toLowerCase();
    const targetName = resolveSystemDisplayInfo(lower).displayName;
    const alreadyExisting = activeOverrideSlugs.find(
      (s) => resolveSystemDisplayInfo(s).displayName === targetName,
    );
    const focusTarget = alreadyExisting ?? lower;
    if (!alreadyExisting) {
      setPinnedDraftSlugs((prev) => (prev.includes(lower) ? prev : [...prev, lower]));
    }
    setPickerQuery('');
    setPickerOpen(false);
    setPendingFocusSlug(focusTarget);
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

  const handleRemoveConsoleOverride = (slug: string) => {
    const lower = slug.toLowerCase();
    const targetName = resolveSystemDisplayInfo(lower).displayName;
    const folderKey = findStoredSlugKey(lower, value.systemFolders);
    const overrideKey = findStoredSlugKey(lower, value.systemTypeOverrides);
    const nextSystemFolders = { ...value.systemFolders };
    const nextOverrides = { ...value.systemTypeOverrides };
    delete nextSystemFolders[folderKey];
    delete nextOverrides[overrideKey];

    setPinnedDraftSlugs((prev) =>
      prev.filter((s) => resolveSystemDisplayInfo(s).displayName !== targetName),
    );
    if (expandedConsoleSlug === lower) {
      setExpandedConsoleSlug(null);
    }

    onChange({
      ...value,
      systemFolders: nextSystemFolders,
      systemTypeOverrides: nextOverrides,
    });
  };

  const handleResetAllManualOverrides = () => {
    setPinnedDraftSlugs([]);
    setExpandedConsoleSlug(null);
    onChange(createDefaultStorageFolderConfig());
  };

  return (
    <section className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-6 space-y-5">
      <div aria-hidden="true" className="crt-edge-beam">
        <span />
      </div>

      {/* Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
        <div className="flex items-start gap-3 min-w-0">
          <FolderTree className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="font-display text-lg font-semibold text-crt-text">
                01. Folder Organization &amp; Overrides
              </h2>
              <span className="text-xs font-mono text-crt-muted tabular-nums">
                · {value.typeSubfoldersEnabled ? 'Sorted by ROM type' : 'Single folder per console'}
                {' · '}
                {persistedOverrideSlugs.length > 0
                  ? `${persistedOverrideSlugs.length} manual override${persistedOverrideSlugs.length === 1 ? '' : 's'}`
                  : 'No manual overrides'}
              </span>
            </div>
            <p className="text-xs text-crt-muted max-w-2xl leading-relaxed">
              Auto-configure handles console paths automatically for each mounted device. Use these saved rules only when you want to sort ROM types into subfolders or pin a specific console path across all devices.
            </p>
          </div>
        </div>

        {(hasAnyCustomizations || pinnedDraftSlugs.length > 0) && (
          <button
            type="button"
            onClick={handleResetAllManualOverrides}
            title="Clear all manual overrides and reset ROM organization back to defaults"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span>Reset All</span>
          </button>
        )}
      </div>

      {/* ROM Organization Row */}
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

        {/* Collapsible Default ROM-Type Subfolder Names */}
        {showGlobalTypeDefaults && (
          <div className="pt-3 border-t border-crt-border/70 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-crt-muted">
                Default subfolder names appended under each console when ROM-type sorting is active. Leave blank to keep a category directly in the console root.
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
                      placeholder={cat.defaultSubfolder ? cat.defaultSubfolder : '(console root)'}
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

      {/* Zero-Wall Manual Console Overrides: Search-to-Add + Active Overrides Only */}
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-medium text-crt-text">Manual Console Overrides</div>
            <p className="text-[11px] text-crt-muted">
              Optional. Add a console below only if you want to permanently override its auto-detected or default folder path.
            </p>
          </div>

          {/* Search-to-Add Console Picker */}
          <div ref={pickerContainerRef} className="relative w-full sm:w-80">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              role="combobox"
              aria-expanded={pickerOpen}
              aria-controls="manual-override-console-listbox"
              aria-label="Search any console to add a manual folder override"
              value={pickerQuery}
              onFocus={() => setPickerOpen(true)}
              onChange={(e) => {
                setPickerQuery(e.target.value);
                setPickerOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setPickerOpen(false);
                } else if (e.key === 'Enter' && pickerOpen && searchOptions.length > 0) {
                  e.preventDefault();
                  handleAddConsoleOverride(searchOptions[0]!.slug);
                }
              }}
              placeholder="Search any console to add override..."
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted/75 focus:outline-none focus:border-crt-phosphor"
            />
            {pickerQuery && (
              <button
                type="button"
                onClick={() => setPickerQuery('')}
                aria-label="Clear console search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}

            {pickerOpen && (
              <div
                id="manual-override-console-listbox"
                role="listbox"
                aria-label="Available consoles"
                className="absolute right-0 left-0 mt-1 z-30 border border-crt-border-strong bg-crt-surface rounded shadow-xl max-h-64 overflow-y-auto divide-y divide-crt-border/70"
              >
                {searchOptions.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-crt-muted">
                    No consoles matched &ldquo;{pickerQuery}&rdquo;.
                  </div>
                ) : (
                  searchOptions.map((opt) => (
                    <button
                      key={opt.slug}
                      type="button"
                      role="option"
                      aria-selected={opt.isAlreadyActive}
                      onClick={() => handleAddConsoleOverride(opt.slug)}
                      className="w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-crt-elevated transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-crt-text truncate">
                          {opt.displayName}
                        </div>
                        <div className="text-[11px] font-mono text-crt-muted truncate">
                          {opt.brandLabel} · /{opt.effectiveBasePath}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-mono whitespace-nowrap shrink-0 ${
                          opt.isAlreadyActive ? 'text-crt-phosphor' : 'text-crt-muted'
                        }`}
                      >
                        {opt.isAlreadyActive ? (
                          'Active'
                        ) : (
                          <>
                            <Plus className="h-3 w-3 shrink-0" />
                            <span>Add</span>
                          </>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Active Overrides Table (Zero Wall When Empty) */}
        {activeOverrideSlugs.length === 0 ? (
          <div className="px-4 py-4 border border-dashed border-crt-border bg-crt-bg/60 rounded text-xs text-crt-muted">
            No manual overrides saved — auto-configured device paths and universal defaults handle all consoles automatically.
          </div>
        ) : (
          <div className="divide-y divide-crt-border border border-crt-border bg-crt-bg rounded">
            {activeOverrideSlugs.map((slug) => {
              const info = resolveSystemDisplayInfo(slug);
              const folderKey = findStoredSlugKey(slug, value.systemFolders);
              const overrideKey = findStoredSlugKey(slug, value.systemTypeOverrides);
              const defaultBase = resolveDefaultSystemFolder(slug);
              const activeEffectiveBase = resolveBaseSystemFolder(slug, effectiveFolderConfig);
              const customBaseVal = value.systemFolders[folderKey] ?? '';

              const sysOverride = value.systemTypeOverrides[overrideKey];
              const sysMode: SystemTypeSubfolderMode = sysOverride?.mode || 'inherit';
              const sysSubOverrides = sysOverride?.subfolders || {};
              const sysSubOverrideCount = Object.keys(sysSubOverrides).length;
              const effectiveSubfoldersActive = isTypeSubfoldersActiveForSystem(slug, value);
              const hasSubfolderOverride = sysMode !== 'inherit' || sysSubOverrideCount > 0;
              const isExpanded = expandedConsoleSlug === slug;

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
                <div key={slug} className="px-3 py-2.5 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-medium text-crt-text">{info.displayName}</span>
                        <span className="font-mono text-[11px] text-crt-muted">
                          · {info.brandLabel}
                        </span>
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
                          ref={(el) => {
                            inputRefsBySlug.current[slug.toLowerCase()] = el;
                          }}
                          type="text"
                          value={customBaseVal}
                          placeholder={activeEffectiveBase || defaultBase}
                          aria-label={`Manual base storage folder override for ${info.displayName}`}
                          onChange={(e) => handleUpdateSystemBaseFolder(slug, e.target.value)}
                          className={`w-full py-1.5 pr-2.5 text-xs font-mono bg-crt-surface border rounded focus:outline-none focus:border-crt-phosphor ${
                            customBaseVal.trim() && customBaseVal.trim() !== defaultBase
                              ? 'border-crt-phosphor/60 text-crt-phosphor'
                              : 'border-crt-border text-crt-text placeholder:text-crt-muted/75'
                          }`}
                        />
                      </div>

                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedConsoleSlug((prev) => (prev === slug ? null : slug))
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

                      <button
                        type="button"
                        onClick={() => handleRemoveConsoleOverride(slug)}
                        title={`Remove manual override for ${info.displayName}`}
                        aria-label={`Remove manual override for ${info.displayName}`}
                        className="p-1.5 text-crt-muted hover:text-crt-crimson border border-transparent hover:border-crt-crimson/40 rounded transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Per-Console ROM-Type Subfolder Override Drawer */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-crt-border/80 space-y-3">
                      <div
                        role="group"
                        aria-label={`ROM Type subfolder mode for ${info.displayName}`}
                        className="inline-flex flex-wrap items-center p-0.5 bg-crt-surface border border-crt-border rounded"
                      >
                        <button
                          type="button"
                          onClick={() => handleSetConsoleSubfolderMode(slug, 'inherit')}
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
                          onClick={() => handleSetConsoleSubfolderMode(slug, 'enabled')}
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
                          onClick={() => handleSetConsoleSubfolderMode(slug, 'disabled')}
                          className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            sysMode === 'disabled'
                              ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong font-medium'
                              : 'text-crt-muted hover:text-crt-text border border-transparent'
                          }`}
                        >
                          Single Folder
                        </button>
                      </div>

                      {effectiveSubfoldersActive ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
                          {STORAGE_ROM_CATEGORIES.map((cat) => {
                            const hasOverride = sysSubOverrides[cat.id] !== undefined;
                            const overrideVal = sysSubOverrides[cat.id] ?? '';
                            const inheritedGlobal = value.globalTypeSubfolders[cat.id] ?? '';
                            const resolvedFull = resolveTargetStorageFolder(
                              slug,
                              cat.id,
                              effectiveFolderConfig,
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
                                          handleSetConsoleCategorySubfolder(slug, cat.id, '')
                                        }
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
                                            slug,
                                            cat.id,
                                            undefined,
                                          )
                                        }
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
                                  aria-label={`${info.displayName} subfolder for ${cat.label}`}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === '' && inheritedGlobal === '') {
                                      handleSetConsoleCategorySubfolder(slug, cat.id, undefined);
                                    } else {
                                      handleSetConsoleCategorySubfolder(slug, cat.id, raw);
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
                          All ROM types for {info.displayName} currently write to{' '}
                          <span className="text-crt-phosphor">/{activeEffectiveBase}/</span>.
                          Switch to <span className="text-crt-text">Sort by Type</span> above to
                          route Hacks, Translations, and Homebrew into subfolders.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
