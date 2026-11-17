import { useMemo, useState, type RefObject } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FolderTree,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
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

type ConsoleScopeTab = 'discovered' | 'all' | 'customized';

interface StorageFolderMappingsSectionProps {
  sectionRef: RefObject<HTMLElement | null>;
  spotlightNonce: number | null;
  value: StorageFolderMappingConfig;
  onChange: (next: StorageFolderMappingConfig) => void;
  discoveredAndSyncedSlugs: string[];
}

export function StorageFolderMappingsSection({
  sectionRef,
  spotlightNonce,
  value,
  onChange,
  discoveredAndSyncedSlugs,
}: StorageFolderMappingsSectionProps) {
  const [scopeTab, setScopeTab] = useState<ConsoleScopeTab>(() =>
    discoveredAndSyncedSlugs.length > 0 ? 'discovered' : 'all',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showGlobalTypeDefaults, setShowGlobalTypeDefaults] = useState(false);
  const [expandedConsoleSlug, setExpandedConsoleSlug] = useState<string | null>(null);

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
