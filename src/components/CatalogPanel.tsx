import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Download,
  FileArchive,
  Folder,
  FolderInput,
  FolderOpen,
  Gamepad2,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  Pause,
  RefreshCw,
  RotateCcw,
  Search,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { readJsonSafely } from '../utils/http';
import type {
  BulkInstallKnownItemMeta,
  BulkStorageInstallerController,
} from '../hooks/useBulkStorageInstaller';
import {
  isBrowsableArchiveName,
  listArchiveDirectoryAtPath,
} from '../shared/archiveTree';
import {
  CATALOG_SORT_OPTIONS,
  DEFAULT_CATALOG_SORT,
  normalizeCatalogSort,
} from '../shared/catalogSort';
import {
  GRANULAR_STATUS_VALUES,
  migrateLegacyCatalogDownloadPrefs,
  toggleCatalogDownloadedFilter,
} from '../shared/catalogDownloadFilter';
import {
  deriveStatusMapFromIdsPayload,
  formatDownloadFilteredTooltip,
  formatInstallSelectedTooltip,
  formatQueueSelectedTooltip,
  isCatalogStatusQueueable,
  summarizeCatalogSelection,
} from '../shared/catalogSelection';
import type { SmartRomFilterContext } from '../shared/smartRomPicker';
import { formatSyncRuleScopeSummary } from '../shared/syncRuleMatcher';
import type {
  ArchiveBrowseListing,
  CatalogDownloadedFilter,
  CatalogFacets,
  CatalogInstalledFilter,
  CatalogSortOption,
  FilterMatchMode,
  FsTreeNode,
  ItemStatus,
  RepositoryItemRecord,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
} from '../types';
import { ArchiveExplorer } from './ArchiveExplorer';
import { formatBytes, formatDateTime } from '../utils/format';
import { reportAchievementEvent } from '../utils/achievementsClient';
import {
  matchSecretSearch,
  normalizeSecretQuery,
  type SecretSearchEffect,
} from '../utils/easterEggs';
import { resolveItemTransferProgress } from '../utils/transferProgress';
import { CatalogStatsPanel } from './CatalogStatsPanel';
import { GameDetailDrawer, type GameDetailNavigation } from './GameDetailDrawer';
import { MultiSelectFilterDropdown, type FilterDropdownOption } from './MultiSelectFilterDropdown';

interface CatalogPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  installer: BulkStorageInstallerController;
  catalogRevision?: number;
  activeRetryItemId?: number | null;
  filterPreset?: {
    syncRulesOnly?: boolean;
    downloadedFilter?: CatalogDownloadedFilter;
    nonce: number;
  } | null;
  onRetryItem: (itemId: number, fileId?: number, options?: { dryRun?: boolean }) => Promise<void>;
  onQueueDownload?: (payload: {
    ids?: number[];
    filters?: Record<string, unknown>;
  }) => Promise<{
    queuedCount?: number;
    skippedCount?: number;
    alreadyQueuedCount?: number;
    alreadyDownloadedCount?: number;
  } | void>;
  onStartCatalogIndex?: (scope: 'filtered' | 'full') => Promise<void>;
  onStopCatalogIndex?: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
  onEasterEggEffect?: (effect: SecretSearchEffect | 'clear_askew') => void;
}

interface LazyCoverImageProps {
  itemId: number;
  title: string;
  systemName: string;
  hasLocalCover: boolean;
  hasRemoteCover: boolean;
  assetVersion: string;
  failed: boolean;
  compact?: boolean;
  padBottom?: boolean;
  onError: () => void;
}

function LazyCoverImage({
  itemId,
  title,
  systemName,
  hasLocalCover,
  hasRemoteCover,
  assetVersion,
  failed,
  compact = false,
  padBottom = false,
  onError,
}: LazyCoverImageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(() => hasLocalCover);
  const [loaded, setLoaded] = useState(false);

  const canShowImage = (hasLocalCover || hasRemoteCover) && !failed;
  const src = hasLocalCover
    ? `/api/items/${itemId}/asset?kind=cover${assetVersion}`
    : `/api/items/${itemId}/asset?kind=cover&lazy=1${assetVersion}`;

  // Track previous identity/URL so `loaded` only resets when `src` changes on an
  // already-mounted instance, and detect browser-cached images synchronously via `img.complete`
  // before paint so remounts never leave cached artwork stuck at opacity 0.
  const prevIdentityRef = useRef(`${itemId}:${src}`);
  useLayoutEffect(() => {
    const nextIdentity = `${itemId}:${src}`;
    const identityChanged = prevIdentityRef.current !== nextIdentity;
    if (identityChanged) {
      prevIdentityRef.current = nextIdentity;
    }

    if (!canShowImage || !shouldLoad) {
      setLoaded(false);
      return;
    }

    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    } else if (identityChanged) {
      setLoaded(false);
    }
  }, [itemId, src, shouldLoad, canShowImage]);

  useEffect(() => {
    if (hasLocalCover) {
      setShouldLoad(true);
      return;
    }
    if (!hasRemoteCover || failed) {
      setShouldLoad(false);
      return;
    }
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active) return;
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(el);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [hasLocalCover, hasRemoteCover, failed, itemId]);

  if (compact) {
    return (
      <div
        ref={containerRef}
        className="relative w-8 h-10 rounded border border-crt-border bg-crt-bg flex items-center justify-center overflow-hidden shrink-0"
      >
        <Gamepad2 className="h-3.5 w-3.5 text-crt-border-strong" />
        {canShowImage && shouldLoad && (
          <img
            ref={imgRef}
            src={src}
            alt={`${title} cover`}
            decoding="async"
            referrerPolicy="no-referrer"
            data-loaded={loaded ? 'true' : 'false'}
            onLoad={() => setLoaded(true)}
            onError={onError}
            className="crt-cover-lazy absolute inset-0 w-full h-full object-cover"
          />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-4 text-center space-y-2 ${
          padBottom ? 'pb-16' : ''
        }`}
      >
        <Gamepad2 className="h-8 w-8 text-crt-border-strong" />
        <span className="font-mono text-[11px] text-crt-muted">{systemName}</span>
      </div>
      {canShowImage && shouldLoad && (
        <img
          ref={imgRef}
          src={src}
          alt={`${title} cover art`}
          decoding="async"
          referrerPolicy="no-referrer"
          data-loaded={loaded ? 'true' : 'false'}
          onLoad={() => setLoaded(true)}
          onError={onError}
          className="crt-cover-lazy absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
        />
      )}
    </div>
  );
}

const CATALOG_VIEW_STORAGE_KEY = 'rgt_sync_catalog_view_v1';
const VALID_STATUS_VALUES = GRANULAR_STATUS_VALUES;
const VALID_VIEW_MODES = new Set(['catalog', 'stats', 'filesystem']);

const STATUS_LABELS: Record<string, string> = {
  needs_retry: 'Needs Attention',
  partial: 'Partial',
  failed: 'Failed',
  queued: 'Queued',
  downloading: 'Downloading',
};

interface CatalogViewPrefs {
  viewMode: 'catalog' | 'stats' | 'filesystem';
  catalogLayout: 'table' | 'grid';
  sort: CatalogSortOption;
  search: string;
  systems: string[];
  statuses: string[];
  downloadedFilter: CatalogDownloadedFilter;
  installedFilter: CatalogInstalledFilter;
  syncRulesOnly: boolean;
  tags: string[];
  tagsMode: FilterMatchMode;
  genres: string[];
  genresMode: FilterMatchMode;
  regions: string[];
  regionsMode: FilterMatchMode;
  languages: string[];
  languagesMode: FilterMatchMode;
  sources: string[];
  sourcesMode: FilterMatchMode;
  fsPath: string;
  fsSearch: string;
}

interface LegacyCatalogViewPrefs extends Partial<CatalogViewPrefs> {
  systemFilter?: string;
  statusFilter?: string;
  tagFilter?: string;
  genreFilter?: string;
  regionFilter?: string;
  languageFilter?: string;
}

const DEFAULT_CATALOG_VIEW_PREFS: CatalogViewPrefs = {
  viewMode: 'catalog',
  catalogLayout: 'table',
  sort: DEFAULT_CATALOG_SORT,
  search: '',
  systems: [],
  statuses: [],
  downloadedFilter: 'all',
  installedFilter: 'all',
  syncRulesOnly: false,
  tags: [],
  tagsMode: 'any',
  genres: [],
  genresMode: 'any',
  regions: [],
  regionsMode: 'any',
  languages: [],
  languagesMode: 'any',
  sources: [],
  sourcesMode: 'any',
  fsPath: '',
  fsSearch: '',
};

function sanitizeStoredList(arr: unknown, legacySingle?: unknown): string[] {
  const rawList = Array.isArray(arr)
    ? arr
    : typeof legacySingle === 'string' && legacySingle && legacySingle !== 'all'
      ? [legacySingle]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed === 'all' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sanitizeStoredStatuses(arr: unknown, legacySingle?: unknown): string[] {
  const raw = sanitizeStoredList(arr, legacySingle);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of raw) {
    const mapped = st === 'skipped' ? 'downloaded' : st;
    if (
      (!VALID_STATUS_VALUES.has(mapped) && mapped !== 'downloaded' && mapped !== 'available') ||
      seen.has(mapped)
    ) {
      continue;
    }
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

function sanitizeStoredMatchMode(raw: unknown): FilterMatchMode {
  return raw === 'all' ? 'all' : 'any';
}

function sanitizeStoredInstalledFilter(raw: unknown): CatalogInstalledFilter {
  if (raw === 'only' || raw === 'exclude') return raw;
  return 'all';
}

function loadInitialCatalogViewPrefs(): CatalogViewPrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CATALOG_VIEW_PREFS };
    }
    const raw = window.localStorage.getItem(CATALOG_VIEW_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CATALOG_VIEW_PREFS };
    const parsed = JSON.parse(raw) as LegacyCatalogViewPrefs;
    const rawStatuses = sanitizeStoredStatuses(parsed.statuses, parsed.statusFilter);
    const { downloadedFilter, statuses } = migrateLegacyCatalogDownloadPrefs(
      rawStatuses,
      parsed.downloadedFilter,
    );
    return {
      viewMode:
        typeof parsed.viewMode === 'string' && VALID_VIEW_MODES.has(parsed.viewMode)
          ? (parsed.viewMode as CatalogViewPrefs['viewMode'])
          : 'catalog',
      catalogLayout: parsed.catalogLayout === 'grid' ? 'grid' : 'table',
      sort: normalizeCatalogSort(parsed.sort),
      search: typeof parsed.search === 'string' ? parsed.search : '',
      systems: sanitizeStoredList(parsed.systems, parsed.systemFilter),
      statuses,
      downloadedFilter,
      installedFilter: sanitizeStoredInstalledFilter(parsed.installedFilter),
      syncRulesOnly: Boolean(parsed.syncRulesOnly),
      tags: sanitizeStoredList(parsed.tags, parsed.tagFilter),
      tagsMode: sanitizeStoredMatchMode(parsed.tagsMode),
      genres: sanitizeStoredList(parsed.genres, parsed.genreFilter),
      genresMode: sanitizeStoredMatchMode(parsed.genresMode),
      regions: sanitizeStoredList(parsed.regions, parsed.regionFilter),
      regionsMode: sanitizeStoredMatchMode(parsed.regionsMode),
      languages: sanitizeStoredList(parsed.languages, parsed.languageFilter),
      languagesMode: sanitizeStoredMatchMode(parsed.languagesMode),
      sources: sanitizeStoredList(parsed.sources),
      sourcesMode: sanitizeStoredMatchMode(parsed.sourcesMode),
      fsPath: typeof parsed.fsPath === 'string' ? parsed.fsPath : '',
      fsSearch: typeof parsed.fsSearch === 'string' ? parsed.fsSearch : '',
    };
  } catch {
    return { ...DEFAULT_CATALOG_VIEW_PREFS };
  }
}

function buildCatalogQueryKey(
  prefs: Pick<
    CatalogViewPrefs,
    | 'viewMode'
    | 'sort'
    | 'search'
    | 'systems'
    | 'statuses'
    | 'downloadedFilter'
    | 'installedFilter'
    | 'syncRulesOnly'
    | 'tags'
    | 'tagsMode'
    | 'genres'
    | 'genresMode'
    | 'regions'
    | 'regionsMode'
    | 'languages'
    | 'languagesMode'
    | 'sources'
    | 'sourcesMode'
  >,
): string {
  return JSON.stringify([
    prefs.viewMode,
    prefs.sort,
    prefs.search,
    prefs.systems,
    prefs.statuses,
    prefs.downloadedFilter,
    prefs.installedFilter,
    prefs.syncRulesOnly,
    prefs.tags,
    prefs.tags.length > 1 ? prefs.tagsMode : 'any',
    prefs.genres,
    prefs.genres.length > 1 ? prefs.genresMode : 'any',
    prefs.regions,
    prefs.regions.length > 1 ? prefs.regionsMode : 'any',
    prefs.languages,
    prefs.languages.length > 1 ? prefs.languagesMode : 'any',
    prefs.sources,
    prefs.sources.length > 1 ? prefs.sourcesMode : 'any',
  ]);
}

let lastHandledFilterPresetNonce = 0;

let memoryCatalogViewPrefs: CatalogViewPrefs = loadInitialCatalogViewPrefs();
let memoryCatalogFacets: CatalogFacets = {
  tags: [],
  genres: [],
  regions: [],
  languages: [],
  sources: [],
};
let memoryCatalogSnapshot: {
  queryKey: string;
  items: RepositoryItemRecord[];
  totalItems: number;
} | null = null;
let memoryFsSnapshot: {
  fsPath: string;
  nodes: FsTreeNode[];
} | null = null;

export function CatalogPanel({
  config,
  status,
  installer,
  catalogRevision = 0,
  activeRetryItemId = null,
  filterPreset = null,
  onRetryItem,
  onQueueDownload,
  onStartCatalogIndex,
  onStopCatalogIndex,
  onRefreshStatus,
  onEasterEggEffect,
}: CatalogPanelProps) {
  const initialViewMode: CatalogViewPrefs['viewMode'] = memoryCatalogViewPrefs.viewMode;

  const initialMatchedCatalog =
    memoryCatalogSnapshot?.queryKey ===
    buildCatalogQueryKey({
      ...memoryCatalogViewPrefs,
      viewMode: initialViewMode,
    })
      ? memoryCatalogSnapshot
      : null;
  const initialMatchedFs =
    memoryFsSnapshot?.fsPath === memoryCatalogViewPrefs.fsPath ? memoryFsSnapshot : null;

  const [viewMode, setViewMode] = useState<CatalogViewPrefs['viewMode']>(initialViewMode);
  const [catalogLayout, setCatalogLayout] = useState<'table' | 'grid'>(() => memoryCatalogViewPrefs.catalogLayout);
  const [sort, setSort] = useState<CatalogSortOption>(() => memoryCatalogViewPrefs.sort);
  const [search, setSearch] = useState(() => memoryCatalogViewPrefs.search);
  const lastSecretQueryRef = useRef<string>('');
  const askewAppliedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!onEasterEggEffect) return;
    const normalized = normalizeSecretQuery(search);
    const matched = matchSecretSearch(search, { submitted: false });

    if (matched === 'askew') {
      if (!askewAppliedRef.current) {
        askewAppliedRef.current = true;
        onEasterEggEffect('askew');
      }
      lastSecretQueryRef.current = normalized;
      return;
    }

    if (askewAppliedRef.current) {
      askewAppliedRef.current = false;
      onEasterEggEffect('clear_askew');
    }

    if (!matched) {
      lastSecretQueryRef.current = '';
      return;
    }

    if (lastSecretQueryRef.current !== normalized) {
      lastSecretQueryRef.current = normalized;
      onEasterEggEffect(matched);
    }
  }, [search, onEasterEggEffect]);

  useEffect(() => {
    return () => {
      if (askewAppliedRef.current && onEasterEggEffect) {
        askewAppliedRef.current = false;
        onEasterEggEffect('clear_askew');
      }
    };
  }, [onEasterEggEffect]);
  const [systems, setSystems] = useState<string[]>(() => memoryCatalogViewPrefs.systems);
  const [statuses, setStatuses] = useState<string[]>(() => memoryCatalogViewPrefs.statuses);
  const [downloadedFilter, setDownloadedFilter] = useState<CatalogDownloadedFilter>(
    () => memoryCatalogViewPrefs.downloadedFilter,
  );
  const [installedFilter, setInstalledFilter] = useState<CatalogInstalledFilter>(
    () => memoryCatalogViewPrefs.installedFilter,
  );
  const [syncRulesOnly, setSyncRulesOnly] = useState<boolean>(
    () => memoryCatalogViewPrefs.syncRulesOnly,
  );
  const [tags, setTags] = useState<string[]>(() => memoryCatalogViewPrefs.tags);
  const [tagsMode, setTagsMode] = useState<FilterMatchMode>(() => memoryCatalogViewPrefs.tagsMode);
  const [genres, setGenres] = useState<string[]>(() => memoryCatalogViewPrefs.genres);
  const [genresMode, setGenresMode] = useState<FilterMatchMode>(() => memoryCatalogViewPrefs.genresMode);
  const [regions, setRegions] = useState<string[]>(() => memoryCatalogViewPrefs.regions);
  const [regionsMode, setRegionsMode] = useState<FilterMatchMode>(() => memoryCatalogViewPrefs.regionsMode);
  const [languages, setLanguages] = useState<string[]>(() => memoryCatalogViewPrefs.languages);
  const [languagesMode, setLanguagesMode] = useState<FilterMatchMode>(() => memoryCatalogViewPrefs.languagesMode);
  const [sources, setSources] = useState<string[]>(() => memoryCatalogViewPrefs.sources);
  const [sourcesMode, setSourcesMode] = useState<FilterMatchMode>(() => memoryCatalogViewPrefs.sourcesMode);
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);

  useEffect(() => {
    if (!filterPreset || filterPreset.nonce === lastHandledFilterPresetNonce) return;
    lastHandledFilterPresetNonce = filterPreset.nonce;
    setViewMode('catalog');
    if (typeof filterPreset.syncRulesOnly === 'boolean') {
      setSyncRulesOnly(filterPreset.syncRulesOnly);
    }
    if (filterPreset.downloadedFilter) {
      setDownloadedFilter(filterPreset.downloadedFilter);
      if (filterPreset.downloadedFilter === 'only') {
        setStatuses([]);
      }
    }
  }, [filterPreset]);
  const [items, setItems] = useState<RepositoryItemRecord[]>(() => initialMatchedCatalog?.items ?? []);
  const [facets, setFacets] = useState<CatalogFacets>(() => memoryCatalogFacets);
  const [totalItems, setTotalItems] = useState(() => initialMatchedCatalog?.totalItems ?? 0);
  const [loading, setLoading] = useState(() => !initialMatchedCatalog);
  const [refreshing, setRefreshing] = useState(false);
  const hasItemsRef = useRef(items.length > 0);
  hasItemsRef.current = items.length > 0;
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [markingInstalled, setMarkingInstalled] = useState(false);
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);
  const [failedCovers, setFailedCovers] = useState<Set<number>>(new Set());
  const [activeDetailItem, setActiveDetailItem] = useState<RepositoryItemRecord | null>(null);
  const [activeDetailIndex, setActiveDetailIndex] = useState<number | null>(null);
  const [navigatingDetail, setNavigatingDetail] = useState(false);

  const effectiveRetryingId =
    retryingId ??
    (status.activeRun?.triggerType === 'retry'
      ? (activeRetryItemId ?? status.activeTransfer?.itemId ?? null)
      : null);

  // Selection state for Indexed Catalog (supports both current-page and cross-page filtered selection)
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<number>>(new Set());
  const [selectedStatusById, setSelectedStatusById] = useState<Map<number, ItemStatus>>(() => {
    const map = new Map<number, ItemStatus>();
    for (const item of initialMatchedCatalog?.items ?? []) {
      map.set(item.id, item.status);
    }
    return map;
  });
  const [confirmCatalogBulk, setConfirmCatalogBulk] = useState(false);

  // On-demand download queueing & background indexer UI state
  const [queueingIds, setQueueingIds] = useState<Set<number>>(new Set());
  const [queueingBulk, setQueueingBulk] = useState(false);
  const [filteredDownloadConfirm, setFilteredDownloadConfirm] = useState<{
    open: boolean;
    loading: boolean;
    queueableIds: number[];
    alreadyDownloadedCount: number;
    alreadyQueuedCount: number;
    estimatedQueueBytes: number;
    error: string | null;
  }>({
    open: false,
    loading: false,
    queueableIds: [],
    alreadyDownloadedCount: 0,
    alreadyQueuedCount: 0,
    estimatedQueueBytes: 0,
    error: null,
  });
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [indexerBusy, setIndexerBusy] = useState(false);

  const { sdRootHandle } = installer;

  // Local Disk Tree state + search filter + selection + in-place archive browsing
  const [fsPath, setFsPath] = useState(() => memoryCatalogViewPrefs.fsPath);
  const [fsSearch, setFsSearch] = useState(() => memoryCatalogViewPrefs.fsSearch);
  const [fsNodes, setFsNodes] = useState<FsTreeNode[]>(() => initialMatchedFs?.nodes ?? []);
  const [fsLoading, setFsLoading] = useState(false);
  const [selectedFsPaths, setSelectedFsPaths] = useState<Set<string>>(new Set());
  const [confirmFsBulk, setConfirmFsBulk] = useState(false);
  const [fsArchivePath, setFsArchivePath] = useState<string | null>(null);
  const [fsArchiveListing, setFsArchiveListing] = useState<ArchiveBrowseListing | null>(null);
  const [fsArchiveSubpath, setFsArchiveSubpath] = useState('');
  const [fsArchiveLoading, setFsArchiveLoading] = useState(false);
  const [fsArchiveError, setFsArchiveError] = useState<string | null>(null);
  const fsArchiveReqSeqRef = useRef(0);

  const filterSelectionKey = useMemo(
    () =>
      JSON.stringify([
        search.trim(),
        systems,
        statuses,
        downloadedFilter,
        installedFilter,
        syncRulesOnly,
        tags,
        tags.length > 1 ? tagsMode : 'any',
        genres,
        genres.length > 1 ? genresMode : 'any',
        regions,
        regions.length > 1 ? regionsMode : 'any',
        languages,
        languages.length > 1 ? languagesMode : 'any',
        sources,
        sources.length > 1 ? sourcesMode : 'any',
      ]),
    [
      search,
      systems,
      statuses,
      downloadedFilter,
      installedFilter,
      syncRulesOnly,
      tags,
      tagsMode,
      genres,
      genresMode,
      regions,
      regionsMode,
      languages,
      languagesMode,
      sources,
      sourcesMode,
    ],
  );
  const prevFilterSelectionKeyRef = useRef(filterSelectionKey);
  useEffect(() => {
    if (prevFilterSelectionKeyRef.current !== filterSelectionKey) {
      prevFilterSelectionKeyRef.current = filterSelectionKey;
      setSelectedCatalogIds(new Set());
      setConfirmCatalogBulk(false);
      setFilteredDownloadConfirm((prev) => (prev.open ? { ...prev, open: false, error: null } : prev));
    }
  }, [filterSelectionKey]);

  useEffect(() => {
    if (!queueNotice) return;
    const t = window.setTimeout(() => setQueueNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [queueNotice]);

  useEffect(() => {
    const nextPrefs: CatalogViewPrefs = {
      viewMode,
      catalogLayout,
      sort,
      search,
      systems,
      statuses,
      downloadedFilter,
      installedFilter,
      syncRulesOnly,
      tags,
      tagsMode,
      genres,
      genresMode,
      regions,
      regionsMode,
      languages,
      languagesMode,
      sources,
      sourcesMode,
      fsPath,
      fsSearch,
    };
    memoryCatalogViewPrefs = nextPrefs;
    try {
      window.localStorage?.setItem(CATALOG_VIEW_STORAGE_KEY, JSON.stringify(nextPrefs));
    } catch {
      // Ignore storage quota / sandbox restrictions; in-memory state still persists across tab navigation
    }
  }, [
    viewMode,
    catalogLayout,
    sort,
    search,
    systems,
    statuses,
    downloadedFilter,
    installedFilter,
    syncRulesOnly,
    tags,
    tagsMode,
    genres,
    genresMode,
    regions,
    regionsMode,
    languages,
    languagesMode,
    sources,
    sourcesMode,
    fsPath,
    fsSearch,
  ]);

  const catalogReqSeqRef = useRef(0);
  const fsReqSeqRef = useRef(0);
  const detailReqSeqRef = useRef(0);
  const activeDetailIdRef = useRef<number | null>(null);
  const lastHandledRevisionRef = useRef(catalogRevision);

  useEffect(() => {
    activeDetailIdRef.current = activeDetailItem?.id ?? null;
  }, [activeDetailItem?.id]);

  useEffect(() => {
    if (viewMode !== 'catalog') {
      setOpenFilterId(null);
    }
  }, [viewMode]);

  const buildCatalogSearchParams = useCallback(
    (limit: number, offset: number): URLSearchParams => {
      const qs = new URLSearchParams({
        search,
        sort,
        limit: String(limit),
        offset: String(offset),
      });
      for (const sys of systems) qs.append('system', sys);
      for (const st of statuses) qs.append('status', st);
      if (downloadedFilter !== 'all') qs.set('downloaded', downloadedFilter);
      if (installedFilter !== 'all') qs.set('installed', installedFilter);
      if (syncRulesOnly) qs.set('syncRules', 'true');
      for (const t of tags) qs.append('tag', t);
      if (tags.length > 1) qs.set('tagMode', tagsMode);
      for (const g of genres) qs.append('genre', g);
      if (genres.length > 1) qs.set('genreMode', genresMode);
      for (const r of regions) qs.append('region', r);
      if (regions.length > 1) qs.set('regionMode', regionsMode);
      for (const l of languages) qs.append('language', l);
      if (languages.length > 1) qs.set('languageMode', languagesMode);
      for (const s of sources) qs.append('source', s);
      if (sources.length > 1) qs.set('sourceMode', sourcesMode);
      return qs;
    },
    [
      search,
      sort,
      systems,
      statuses,
      downloadedFilter,
      installedFilter,
      syncRulesOnly,
      tags,
      tagsMode,
      genres,
      genresMode,
      regions,
      regionsMode,
      languages,
      languagesMode,
      sources,
      sourcesMode,
    ],
  );

  const loadCatalog = useCallback(
    async (silent = false, options?: { softRefresh?: boolean }) => {
      const reqId = ++catalogReqSeqRef.current;
      const useSoftRefresh = Boolean(options?.softRefresh && hasItemsRef.current);
      if (!silent) {
        if (useSoftRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      }
      try {
        const qs = buildCatalogSearchParams(150, 0);

        const res = await fetch(`/api/items?${qs.toString()}`);
        if (!res.ok || reqId !== catalogReqSeqRef.current) return;
        const data = await res.json();
        if (reqId !== catalogReqSeqRef.current) return;

        const nextItems = (data.items || []) as RepositoryItemRecord[];
        const nextTotal = data.total || 0;
        memoryCatalogSnapshot = {
          queryKey: buildCatalogQueryKey({
            viewMode,
            sort,
            search,
            systems,
            statuses,
            downloadedFilter,
            installedFilter,
            syncRulesOnly,
            tags,
            tagsMode,
            genres,
            genresMode,
            regions,
            regionsMode,
            languages,
            languagesMode,
            sources,
            sourcesMode,
          }),
          items: nextItems,
          totalItems: nextTotal,
        };
        setItems(nextItems);
        setTotalItems(nextTotal);
        setSelectedStatusById((prev) => {
          let changed = false;
          for (const item of nextItems) {
            if (prev.get(item.id) !== item.status) {
              changed = true;
              break;
            }
          }
          if (!changed) return prev;
          const next = new Map(prev);
          for (const item of nextItems) {
            next.set(item.id, item.status);
          }
          return next;
        });
        if (data.facets) {
          const nextFacets: CatalogFacets = {
            tags: Array.isArray(data.facets.tags) ? data.facets.tags : [],
            genres: Array.isArray(data.facets.genres) ? data.facets.genres : [],
            regions: Array.isArray(data.facets.regions) ? data.facets.regions : [],
            languages: Array.isArray(data.facets.languages) ? data.facets.languages : [],
            sources: Array.isArray(data.facets.sources) ? data.facets.sources : [],
            counts: data.facets.counts && typeof data.facets.counts === 'object' ? data.facets.counts : undefined,
          };
          memoryCatalogFacets = nextFacets;
          setFacets(nextFacets);
        }

        if (!silent) {
          setFailedCovers(new Set());
          setConfirmCatalogBulk(false);
        } else {
          // Clear any cover-load error entry if an item now reports a cover path or remote cover
          setFailedCovers((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set(prev);
            for (const item of nextItems) {
              if (item.coverLocalPath || item.metadata?.coverUrl) next.delete(item.id);
            }
            return next;
          });
        }

        // If all matching items fit on this page, prune deleted IDs; otherwise preserve multi-page selection
        if (nextTotal <= nextItems.length) {
          const visibleIds = new Set(nextItems.map((i) => i.id));
          setSelectedCatalogIds((prev) => {
            if (prev.size === 0) return prev;
            const pruned = new Set<number>();
            prev.forEach((id) => {
              if (visibleIds.has(id)) pruned.add(id);
            });
            return pruned.size === prev.size ? prev : pruned;
          });
        }

        // Also live-update the open slide-over detail drawer if visible
        const openId = activeDetailIdRef.current;
        if (silent && openId !== null) {
          const detailRes = await fetch(`/api/items/${openId}`);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData.item) {
              setActiveDetailItem((current) =>
                current?.id === openId ? (detailData.item as RepositoryItemRecord) : current,
              );
            }
          }
        }
      } finally {
        if (reqId === catalogReqSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [
      buildCatalogSearchParams,
      viewMode,
      sort,
      search,
      systems,
      statuses,
      downloadedFilter,
      installedFilter,
      syncRulesOnly,
      tags,
      tagsMode,
      genres,
      genresMode,
      regions,
      regionsMode,
      languages,
      languagesMode,
      sources,
      sourcesMode,
    ],
  );

  const loadFsTree = useCallback(async (subpath: string, silent = false) => {
    const reqId = ++fsReqSeqRef.current;
    if (!silent) setFsLoading(true);
    try {
      const res = await fetch(`/api/fs/tree?path=${encodeURIComponent(subpath)}`);
      if (!res.ok) {
        if (subpath !== '' && reqId === fsReqSeqRef.current) {
          setFsPath('');
        }
        return;
      }
      if (reqId !== fsReqSeqRef.current) return;
      const data = await res.json();
      if (reqId !== fsReqSeqRef.current) return;
      const nextNodes = (data.nodes || []) as FsTreeNode[];
      const resolvedPath = data.currentPath || '';
      memoryFsSnapshot = { fsPath: resolvedPath, nodes: nextNodes };
      setFsPath(resolvedPath);
      setFsNodes(nextNodes);
      if (!silent) {
        setSelectedFsPaths(new Set());
        setConfirmFsBulk(false);
      }
    } finally {
      if (reqId === fsReqSeqRef.current) {
        setFsLoading(false);
      }
    }
  }, []);

  const exitFsArchive = useCallback((nextDiskPath?: string) => {
    fsArchiveReqSeqRef.current += 1;
    setFsArchivePath(null);
    setFsArchiveListing(null);
    setFsArchiveSubpath('');
    setFsArchiveLoading(false);
    setFsArchiveError(null);
    setFsSearch('');
    if (nextDiskPath !== undefined) {
      setFsPath(nextDiskPath);
    }
  }, []);

  const openFsArchive = useCallback(async (relativePath: string) => {
    const reqId = ++fsArchiveReqSeqRef.current;
    setFsArchivePath(relativePath);
    setFsArchiveSubpath('');
    setFsArchiveError(null);
    setFsArchiveLoading(true);
    setFsSearch('');
    setSelectedFsPaths(new Set());
    setConfirmFsBulk(false);
    try {
      const res = await fetch(`/api/fs/archive?path=${encodeURIComponent(relativePath)}`);
      const parsed = await readJsonSafely<{
        relativePath?: string;
        listing?: ArchiveBrowseListing;
        error?: string;
      }>(res);
      if (reqId !== fsArchiveReqSeqRef.current) return;
      if (!parsed.ok || !parsed.data?.listing) {
        setFsArchiveListing(null);
        setFsArchiveError(parsed.errorMessage || `Unable to inspect archive (HTTP ${res.status})`);
        return;
      }
      setFsArchiveListing(parsed.data.listing);
    } catch (err) {
      if (reqId !== fsArchiveReqSeqRef.current) return;
      setFsArchiveListing(null);
      setFsArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqId === fsArchiveReqSeqRef.current) {
        setFsArchiveLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'catalog') {
      const hasCached =
        memoryCatalogSnapshot?.queryKey ===
        buildCatalogQueryKey({
          viewMode,
          sort,
          search,
          systems,
          statuses,
          downloadedFilter,
          installedFilter,
          syncRulesOnly,
          tags,
          tagsMode,
          genres,
          genresMode,
          regions,
          regionsMode,
          languages,
          languagesMode,
          sources,
          sourcesMode,
        });
      void loadCatalog(hasCached);
    } else {
      const hasCachedFs = memoryFsSnapshot?.fsPath === fsPath;
      void loadFsTree(fsPath, hasCachedFs);
    }
  }, [
    viewMode,
    sort,
    loadCatalog,
    loadFsTree,
    fsPath,
    search,
    systems,
    statuses,
    downloadedFilter,
    installedFilter,
    syncRulesOnly,
    tags,
    tagsMode,
    genres,
    genresMode,
    regions,
    regionsMode,
    languages,
    languagesMode,
    sources,
    sourcesMode,
  ]);

  // Live background refresh whenever backend emits catalog_updated during sync
  useEffect(() => {
    if (catalogRevision === lastHandledRevisionRef.current) return;
    lastHandledRevisionRef.current = catalogRevision;
    if (viewMode === 'catalog') {
      void loadCatalog(true);
    } else {
      void loadFsTree(fsPath, true);
    }
  }, [catalogRevision, viewMode, fsPath, loadCatalog, loadFsTree]);

  const filteredFsNodes = useMemo(() => {
    const q = fsSearch.trim().toLowerCase();
    if (!q) return fsNodes;
    return fsNodes.filter((n) => n.name.toLowerCase().includes(q) || n.relativePath.toLowerCase().includes(q));
  }, [fsNodes, fsSearch]);

  // Prune FS selection if search filter narrows displayed nodes
  useEffect(() => {
    const visible = new Set(filteredFsNodes.map((n) => n.relativePath));
    setSelectedFsPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((p) => {
        if (visible.has(p)) {
          next.add(p);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setConfirmFsBulk(false);
  }, [filteredFsNodes]);

  const closeDetailDrawer = useCallback(() => {
    detailReqSeqRef.current += 1;
    setNavigatingDetail(false);
    setActiveDetailItem(null);
    setActiveDetailIndex(null);
  }, []);

  const openDetailItem = useCallback(
    async (item: RepositoryItemRecord, indexHint?: number) => {
      const reqSeq = ++detailReqSeqRef.current;
      setNavigatingDetail(false);
      setActiveDetailItem(item);
      const resolvedIdx =
        typeof indexHint === 'number' ? indexHint : items.findIndex((row) => row.id === item.id);
      setActiveDetailIndex(resolvedIdx >= 0 ? resolvedIdx : null);
      try {
        const res = await fetch(`/api/items/${item.id}`);
        if (reqSeq !== detailReqSeqRef.current || !res.ok) return;
        const data = await res.json();
        if (reqSeq !== detailReqSeqRef.current) return;
        if (data.item) {
          const fresh = data.item as RepositoryItemRecord;
          setActiveDetailItem((current) => (current?.id === fresh.id ? fresh : current));
          setItems((prev) => prev.map((row) => (row.id === fresh.id ? fresh : row)));
        }
      } catch {
        // Keep optimistic cached item open on transient error
      }
    },
    [items],
  );

  const resolvedDetailIndex = useMemo(() => {
    if (!activeDetailItem) return -1;
    const loadedIdx = items.findIndex((row) => row.id === activeDetailItem.id);
    if (loadedIdx >= 0) return loadedIdx;
    const effectiveTotal = Math.max(totalItems, items.length);
    if (
      activeDetailIndex !== null &&
      activeDetailIndex >= items.length &&
      activeDetailIndex < effectiveTotal
    ) {
      return activeDetailIndex;
    }
    return -1;
  }, [activeDetailItem, activeDetailIndex, items, totalItems]);

  const navigateDetailBy = useCallback(
    async (delta: -1 | 1) => {
      if (!activeDetailItem || resolvedDetailIndex < 0) return;
      const effectiveTotal = Math.max(totalItems, items.length);
      const targetIndex = resolvedDetailIndex + delta;
      if (targetIndex < 0 || targetIndex >= effectiveTotal) return;

      if (targetIndex < items.length && items[targetIndex]) {
        await openDetailItem(items[targetIndex], targetIndex);
        return;
      }

      const reqSeq = ++detailReqSeqRef.current;
      setNavigatingDetail(true);
      try {
        const qs = buildCatalogSearchParams(1, targetIndex);
        const res = await fetch(`/api/items?${qs.toString()}`);
        if (reqSeq !== detailReqSeqRef.current || !res.ok) return;
        const data = await res.json();
        if (reqSeq !== detailReqSeqRef.current) return;
        const fetchedItem = (data.items?.[0] ?? null) as RepositoryItemRecord | null;
        if (typeof data.total === 'number') {
          setTotalItems(data.total);
        }
        if (fetchedItem) {
          setActiveDetailIndex(targetIndex);
          setActiveDetailItem(fetchedItem);
        }
      } catch {
        // Ignore transient network errors; keep current item open
      } finally {
        if (reqSeq === detailReqSeqRef.current) {
          setNavigatingDetail(false);
        }
      }
    },
    [activeDetailItem, buildCatalogSearchParams, items, openDetailItem, resolvedDetailIndex, totalItems],
  );

  const detailNavigation = useMemo<GameDetailNavigation | null>(() => {
    if (!activeDetailItem || resolvedDetailIndex < 0) return null;
    const effectiveTotal = Math.max(totalItems, items.length);
    if (effectiveTotal <= 0) return null;
    const prevIdx = resolvedDetailIndex - 1;
    const nextIdx = resolvedDetailIndex + 1;
    const sortChoice = CATALOG_SORT_OPTIONS.find((opt) => opt.value === sort);
    return {
      currentIndex: resolvedDetailIndex + 1,
      totalCount: effectiveTotal,
      canPrev: prevIdx >= 0,
      canNext: nextIdx < effectiveTotal,
      loading: navigatingDetail,
      prevTitle: prevIdx >= 0 && prevIdx < items.length ? items[prevIdx]?.title ?? null : null,
      nextTitle: nextIdx >= 0 && nextIdx < items.length ? items[nextIdx]?.title ?? null : null,
      orderLabel: sortChoice ? sortChoice.label.replace(/^Sort:\s*/i, 'Catalog Order: ') : undefined,
      onPrev: () => {
        void navigateDetailBy(-1);
      },
      onNext: () => {
        void navigateDetailBy(1);
      },
    };
  }, [activeDetailItem, items, navigateDetailBy, navigatingDetail, resolvedDetailIndex, sort, totalItems]);

  const handleItemUpdated = (updated: RepositoryItemRecord) => {
    setActiveDetailItem(updated);
    setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    setFailedCovers((prev) => {
      if (!prev.has(updated.id)) return prev;
      const next = new Set(prev);
      next.delete(updated.id);
      return next;
    });
    void loadCatalog(true);
  };

  const currentSmartFilterContext = useMemo<SmartRomFilterContext>(
    () => ({
      tags,
      languages,
      regions,
      search,
      syncIncludeTags: config.allowedReleaseTypes,
    }),
    [tags, languages, regions, search, config.allowedReleaseTypes],
  );

  const knownItemMetaMap = useMemo(() => {
    const map = new Map<number, BulkInstallKnownItemMeta>();
    for (const item of items) {
      map.set(item.id, { title: item.title, systemName: item.systemName });
    }
    if (activeDetailItem && !map.has(activeDetailItem.id)) {
      map.set(activeDetailItem.id, {
        title: activeDetailItem.title,
        systemName: activeDetailItem.systemName,
      });
    }
    return map;
  }, [items, activeDetailItem]);

  const effectiveStatusById = useMemo(() => {
    const map = new Map<number, ItemStatus>(selectedStatusById);
    for (const item of items) {
      map.set(item.id, item.status);
    }
    if (activeDetailItem) {
      map.set(activeDetailItem.id, activeDetailItem.status);
    }
    const activeTransfersList =
      status.activeTransfers && status.activeTransfers.length > 0
        ? status.activeTransfers
        : status.activeTransfer
          ? [status.activeTransfer]
          : [];
    for (const transfer of activeTransfersList) {
      if (typeof transfer.itemId === 'number' && transfer.itemId > 0) {
        map.set(transfer.itemId, 'downloading');
      }
    }
    return map;
  }, [selectedStatusById, items, activeDetailItem, status.activeTransfers, status.activeTransfer]);

  const selectionSummary = useMemo(
    () => summarizeCatalogSelection(selectedCatalogIds, effectiveStatusById),
    [selectedCatalogIds, effectiveStatusById],
  );

  const queueableFilteredCount = useMemo(() => {
    if (typeof facets.counts?.queueableFiltered === 'number') {
      return facets.counts.queueableFiltered;
    }
    return items.filter((item) => isCatalogStatusQueueable(item.status)).length;
  }, [facets.counts?.queueableFiltered, items]);

  // Auto-collapse the Download Filtered preview strip if live sync finishes all matching items
  useEffect(() => {
    if (filteredDownloadConfirm.open && !filteredDownloadConfirm.loading && queueableFilteredCount === 0) {
      setFilteredDownloadConfirm((prev) => (prev.open ? { ...prev, open: false, error: null } : prev));
    }
  }, [filteredDownloadConfirm.open, filteredDownloadConfirm.loading, queueableFilteredCount]);

  // Keep cross-page selection statuses fresh as background downloads complete or queue updates arrive
  const hasOffPageSelection = useMemo(() => {
    if (selectedCatalogIds.size === 0) return false;
    const visibleIdSet = new Set(items.map((i) => i.id));
    for (const id of selectedCatalogIds) {
      if (!visibleIdSet.has(id)) return true;
    }
    return false;
  }, [selectedCatalogIds, items]);

  useEffect(() => {
    if (!hasOffPageSelection || viewMode !== 'catalog') return;
    let cancelled = false;
    const qs = buildCatalogSearchParams(1, 0);
    void fetch(`/api/items/ids?${qs.toString()}`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          ids?: number[];
          queueableIds?: number[];
          downloadableIds?: number[];
          alreadyQueuedIds?: number[];
        };
        if (cancelled) return;
        const derived = deriveStatusMapFromIdsPayload(data);
        if (derived.size === 0) return;
        setSelectedStatusById((prev) => {
          let changed = false;
          derived.forEach((st, id) => {
            if (prev.get(id) !== st) changed = true;
          });
          if (!changed) return prev;
          const next = new Map(prev);
          derived.forEach((st, id) => next.set(id, st));
          return next;
        });
      })
      .catch(() => {
        // Non-fatal: visible items still stay synchronized via loadCatalog
      });
    return () => {
      cancelled = true;
    };
  }, [catalogRevision, hasOffPageSelection, viewMode, buildCatalogSearchParams]);

  const handleSelectAllMatching = async () => {
    if (selectingAllMatching || totalItems <= 0) return;
    if (totalItems <= items.length) {
      setConfirmCatalogBulk(false);
      setSelectedStatusById((prev) => {
        const next = new Map(prev);
        for (const item of items) {
          next.set(item.id, item.status);
        }
        return next;
      });
      setSelectedCatalogIds(new Set(items.map((i) => i.id)));
      return;
    }
    setSelectingAllMatching(true);
    setConfirmCatalogBulk(false);
    try {
      const qs = buildCatalogSearchParams(1, 0);
      const res = await fetch(`/api/items/ids?${qs.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as {
          ids?: number[];
          queueableIds?: number[];
          downloadableIds?: number[];
          alreadyQueuedIds?: number[];
        };
        if (Array.isArray(data.ids) && data.ids.length > 0) {
          const derived = deriveStatusMapFromIdsPayload(data);
          setSelectedStatusById((prev) => {
            const next = new Map(prev);
            derived.forEach((st, id) => next.set(id, st));
            for (const item of items) {
              next.set(item.id, item.status);
            }
            return next;
          });
          setSelectedCatalogIds(new Set(data.ids));
        }
      }
    } finally {
      setSelectingAllMatching(false);
    }
  };

  const handleBulkSetInstalled = async (ids: number[], installed: boolean) => {
    if (ids.length === 0 || markingInstalled) return;
    setMarkingInstalled(true);
    try {
      const res = await fetch('/api/items/installed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          installed,
          deviceLabel: installed ? (sdRootHandle?.name || null) : null,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { items?: RepositoryItemRecord[] };
        if (Array.isArray(data.items) && data.items.length > 0) {
          const byId = new Map(data.items.map((row) => [row.id, row]));
          setItems((prev) => prev.map((row) => byId.get(row.id) ?? row));
          setActiveDetailItem((current) => (current ? (byId.get(current.id) ?? current) : current));
        }
        await loadCatalog(true);
      }
    } finally {
      setMarkingInstalled(false);
    }
  };

  const handleRetry = async (
    id: number,
    fileId?: number,
    options?: { dryRun?: boolean },
  ) => {
    setRetryingId(id);
    try {
      await onRetryItem(id, fileId, options);
      await loadCatalog(true);
      if (activeDetailItem?.id === id) {
        const res = await fetch(`/api/items/${id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.item) setActiveDetailItem(data.item as RepositoryItemRecord);
        }
      }
    } finally {
      setRetryingId(null);
    }
  };

  const buildFilterPayload = useCallback(() => {
    return {
      search,
      sort,
      system: systems,
      status: statuses,
      downloaded: downloadedFilter !== 'all' ? downloadedFilter : undefined,
      installed: installedFilter !== 'all' ? installedFilter : undefined,
      syncRules: syncRulesOnly || undefined,
      tag: tags,
      tagMode: tags.length > 1 ? tagsMode : undefined,
      genre: genres,
      genreMode: genres.length > 1 ? genresMode : undefined,
      region: regions,
      regionMode: regions.length > 1 ? regionsMode : undefined,
      language: languages,
      languageMode: languages.length > 1 ? languagesMode : undefined,
      source: sources,
      sourceMode: sources.length > 1 ? sourcesMode : undefined,
    };
  }, [
    search,
    sort,
    systems,
    statuses,
    downloadedFilter,
    installedFilter,
    syncRulesOnly,
    tags,
    tagsMode,
    genres,
    genresMode,
    regions,
    regionsMode,
    languages,
    languagesMode,
    sources,
    sourcesMode,
  ]);

  const formatQueueSkipBreakdown = (
    alreadyQueuedCount: number,
    alreadyDownloadedCount: number,
    fallbackSkippedCount: number,
  ): string | null => {
    const parts: string[] = [];
    if (alreadyQueuedCount > 0) {
      parts.push(`${alreadyQueuedCount.toLocaleString()} already queued`);
    }
    if (alreadyDownloadedCount > 0) {
      parts.push(`${alreadyDownloadedCount.toLocaleString()} already downloaded`);
    }
    if (parts.length > 0) {
      return `${parts.join(', ')} skipped`;
    }
    if (fallbackSkippedCount > 0) {
      return `${fallbackSkippedCount.toLocaleString()} already queued/downloaded skipped`;
    }
    return null;
  };

  const handleQueueIds = async (ids: number[], clearSelection = false) => {
    if (!onQueueDownload || ids.length === 0) return;
    if (ids.length === 1) {
      setQueueingIds((prev) => new Set(prev).add(ids[0]));
    } else {
      setQueueingBulk(true);
    }
    setQueueNotice(null);
    try {
      const outcome = await onQueueDownload({ ids });
      const queuedCount = outcome?.queuedCount ?? ids.length;
      const alreadyQueuedCount = outcome?.alreadyQueuedCount ?? 0;
      const alreadyDownloadedCount = outcome?.alreadyDownloadedCount ?? 0;
      const skippedCount = outcome?.skippedCount ?? alreadyQueuedCount + alreadyDownloadedCount;

      if (queuedCount === 0) {
        if (alreadyQueuedCount > 0 && alreadyDownloadedCount > 0) {
          setQueueNotice(
            `No new downloads queued — ${alreadyQueuedCount.toLocaleString()} already queued/downloading and ${alreadyDownloadedCount.toLocaleString()} already downloaded.`,
          );
        } else if (alreadyQueuedCount > 0) {
          setQueueNotice(
            `Already queued — ${alreadyQueuedCount.toLocaleString()} selected release${alreadyQueuedCount === 1 ? ' is' : 's are'} already queued or downloading.`,
          );
        } else {
          setQueueNotice('All selected releases are already downloaded.');
        }
      } else {
        const skipDetail = formatQueueSkipBreakdown(
          alreadyQueuedCount,
          alreadyDownloadedCount,
          skippedCount,
        );
        setQueueNotice(
          skipDetail
            ? `Queued ${queuedCount.toLocaleString()} release${queuedCount === 1 ? '' : 's'} for download (${skipDetail}).`
            : `Queued ${queuedCount.toLocaleString()} release${queuedCount === 1 ? '' : 's'} for download.`,
        );
      }
      if (clearSelection) {
        setSelectedCatalogIds(new Set());
      }
      await loadCatalog(true);
    } catch (err) {
      setQueueNotice(err instanceof Error ? err.message : String(err));
    } finally {
      if (ids.length === 1) {
        setQueueingIds((prev) => {
          const next = new Set(prev);
          next.delete(ids[0]);
          return next;
        });
      } else {
        setQueueingBulk(false);
      }
    }
  };

  const handleOpenFilteredDownloadConfirm = async () => {
    if (filteredDownloadConfirm.open && !filteredDownloadConfirm.loading) {
      setFilteredDownloadConfirm((prev) => ({ ...prev, open: false }));
      return;
    }
    setFilteredDownloadConfirm({
      open: true,
      loading: true,
      queueableIds: [],
      alreadyDownloadedCount: 0,
      alreadyQueuedCount: 0,
      estimatedQueueBytes: 0,
      error: null,
    });
    try {
      const qs = buildCatalogSearchParams(1, 0);
      const res = await fetch(`/api/items/ids?${qs.toString()}`);
      const parsed = await readJsonSafely<{
        queueableIds?: number[];
        alreadyDownloadedCount?: number;
        alreadyQueuedCount?: number;
        estimatedQueueBytes?: number;
        error?: string;
      }>(res);
      if (!parsed.ok || !parsed.data) {
        throw new Error(parsed.errorMessage || `Failed to inspect filtered releases (HTTP ${res.status})`);
      }
      setFilteredDownloadConfirm({
        open: true,
        loading: false,
        queueableIds: parsed.data.queueableIds || [],
        alreadyDownloadedCount: parsed.data.alreadyDownloadedCount || 0,
        alreadyQueuedCount: parsed.data.alreadyQueuedCount || 0,
        estimatedQueueBytes: parsed.data.estimatedQueueBytes || 0,
        error: null,
      });
    } catch (err) {
      setFilteredDownloadConfirm((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const handleConfirmDownloadFiltered = async () => {
    if (!onQueueDownload || queueingBulk || filteredDownloadConfirm.queueableIds.length === 0) return;
    setQueueingBulk(true);
    setQueueNotice(null);
    try {
      const outcome = await onQueueDownload({ filters: buildFilterPayload() });
      const queuedCount = outcome?.queuedCount ?? filteredDownloadConfirm.queueableIds.length;
      const alreadyQueuedCount =
        outcome?.alreadyQueuedCount ?? filteredDownloadConfirm.alreadyQueuedCount;
      const alreadyDownloadedCount =
        outcome?.alreadyDownloadedCount ?? filteredDownloadConfirm.alreadyDownloadedCount;
      const skippedCount =
        outcome?.skippedCount ?? alreadyQueuedCount + alreadyDownloadedCount;
      setFilteredDownloadConfirm((prev) => ({ ...prev, open: false }));
      if (queuedCount === 0) {
        if (alreadyQueuedCount > 0 && alreadyDownloadedCount > 0) {
          setQueueNotice(
            `No new downloads queued — ${alreadyQueuedCount.toLocaleString()} already queued/downloading and ${alreadyDownloadedCount.toLocaleString()} already downloaded.`,
          );
        } else if (alreadyQueuedCount > 0) {
          setQueueNotice(
            `All ${alreadyQueuedCount.toLocaleString()} matching release${alreadyQueuedCount === 1 ? ' is' : 's are'} already queued or downloading.`,
          );
        } else {
          setQueueNotice('All matching releases are already downloaded.');
        }
      } else {
        const skipDetail = formatQueueSkipBreakdown(
          alreadyQueuedCount,
          alreadyDownloadedCount,
          skippedCount,
        );
        const estLabel =
          filteredDownloadConfirm.estimatedQueueBytes > 0
            ? ` (~${formatBytes(filteredDownloadConfirm.estimatedQueueBytes)})`
            : '';
        setQueueNotice(
          skipDetail
            ? `Queued ${queuedCount.toLocaleString()} filtered release${queuedCount === 1 ? '' : 's'}${estLabel} (${skipDetail}).`
            : `Queued ${queuedCount.toLocaleString()} filtered release${queuedCount === 1 ? '' : 's'}${estLabel} for download.`,
        );
      }
      await loadCatalog(true);
    } catch (err) {
      setFilteredDownloadConfirm((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setQueueingBulk(false);
    }
  };

  const handleDeleteCatalogItems = async (ids: number[]) => {
    if (ids.length === 0) return;
    setDeletingKey(ids.length === 1 ? `item-${ids[0]}` : 'catalog-bulk');
    try {
      const res = await fetch('/api/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setSelectedCatalogIds(new Set());
        setConfirmCatalogBulk(false);
        if (activeDetailItem && ids.includes(activeDetailItem.id)) {
          closeDetailDrawer();
        }
        await Promise.all([loadCatalog(false, { softRefresh: true }), onRefreshStatus()]);
      }
    } finally {
      setDeletingKey(null);
    }
  };

  const handleDeleteFsPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setDeletingKey(paths.length === 1 ? `fs-${paths[0]}` : 'fs-bulk');
    try {
      const res = await fetch('/api/fs/entry', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (res.ok) {
        setSelectedFsPaths(new Set());
        setConfirmFsBulk(false);
        await Promise.all([loadFsTree(fsPath), onRefreshStatus()]);
      }
    } finally {
      setDeletingKey(null);
    }
  };

  const allCatalogSelected = items.length > 0 && items.every((i) => selectedCatalogIds.has(i.id));
  const toggleAllCatalog = () => {
    setConfirmCatalogBulk(false);
    if (allCatalogSelected) {
      setSelectedCatalogIds(new Set());
    } else {
      setSelectedCatalogIds(new Set(items.map((i) => i.id)));
    }
  };

  const toggleCatalogItem = (id: number) => {
    setConfirmCatalogBulk(false);
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFsSelected = filteredFsNodes.length > 0 && filteredFsNodes.every((n) => selectedFsPaths.has(n.relativePath));
  const toggleAllFs = () => {
    setConfirmFsBulk(false);
    if (allFsSelected) {
      setSelectedFsPaths(new Set());
    } else {
      setSelectedFsPaths(new Set(filteredFsNodes.map((n) => n.relativePath)));
    }
  };

  const toggleFsNode = (relPath: string) => {
    setConfirmFsBulk(false);
    setSelectedFsPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const systemOptions = useMemo<FilterDropdownOption[]>(
    () =>
      status.systems.map((sys) => ({
        value: sys.systemName,
        label: sys.systemName,
        count: sys.totalItems,
      })),
    [status.systems],
  );

  const tagOptions = useMemo<FilterDropdownOption[]>(
    () =>
      facets.tags.map((val) => ({
        value: val,
        label: val,
        count: facets.counts?.tags?.[val],
      })),
    [facets.tags, facets.counts],
  );

  const genreOptions = useMemo<FilterDropdownOption[]>(
    () =>
      facets.genres.map((val) => ({
        value: val,
        label: val,
        count: facets.counts?.genres?.[val],
      })),
    [facets.genres, facets.counts],
  );

  const regionOptions = useMemo<FilterDropdownOption[]>(
    () =>
      facets.regions.map((val) => ({
        value: val,
        label: val,
        count: facets.counts?.regions?.[val],
      })),
    [facets.regions, facets.counts],
  );

  const languageOptions = useMemo<FilterDropdownOption[]>(
    () =>
      facets.languages.map((val) => ({
        value: val,
        label: val,
        count: facets.counts?.languages?.[val],
      })),
    [facets.languages, facets.counts],
  );

  const sourceOptions = useMemo<FilterDropdownOption[]>(
    () =>
      facets.sources.map((val) => ({
        value: val,
        label: val,
        count: facets.counts?.sources?.[val],
      })),
    [facets.sources, facets.counts],
  );

  const handleStatusesChange = useCallback(
    (next: string[]) => {
      setStatuses(next);
      if (next.length > 0 && downloadedFilter === 'only') {
        setDownloadedFilter('all');
      }
    },
    [downloadedFilter],
  );

  const statusOptions = useMemo<FilterDropdownOption[]>(() => {
    const counts = facets.counts?.statuses;
    const base: FilterDropdownOption[] = [
      {
        value: 'needs_retry',
        label: 'Needs Attention (Failed & Partial)',
        count: counts?.needs_retry ?? status.totals.failedItems,
      },
      {
        value: 'partial',
        label: 'Partial',
        count: counts?.partial,
      },
      {
        value: 'failed',
        label: 'Failed',
        count: counts?.failed,
      },
    ];
    if ((counts?.queued ?? 0) > 0 || statuses.includes('queued')) {
      base.push({ value: 'queued', label: 'Queued', count: counts?.queued });
    }
    if ((counts?.downloading ?? 0) > 0 || statuses.includes('downloading')) {
      base.push({ value: 'downloading', label: 'Downloading', count: counts?.downloading });
    }
    return base;
  }, [facets.counts, status.totals.failedItems, statuses]);

  const activeFilterTokens = useMemo(() => {
    const tokens: {
      key: string;
      groupLabel: string;
      valueLabel: string;
      matchAll: boolean;
      onRemove: () => void;
    }[] = [];

    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      tokens.push({
        key: 'search',
        groupLabel: 'Search',
        valueLabel: `"${trimmedSearch}"`,
        matchAll: false,
        onRemove: () => setSearch(''),
      });
    }

    for (const val of systems) {
      tokens.push({
        key: `sys:${val}`,
        groupLabel: 'System',
        valueLabel: val,
        matchAll: false,
        onRemove: () => setSystems((prev) => prev.filter((v) => v !== val)),
      });
    }

    for (const val of tags) {
      tokens.push({
        key: `tag:${val}`,
        groupLabel: 'Type',
        valueLabel: val,
        matchAll: tagsMode === 'all' && tags.length > 1,
        onRemove: () => setTags((prev) => prev.filter((v) => v !== val)),
      });
    }

    for (const val of genres) {
      tokens.push({
        key: `genre:${val}`,
        groupLabel: 'Genre',
        valueLabel: val,
        matchAll: genresMode === 'all' && genres.length > 1,
        onRemove: () => setGenres((prev) => prev.filter((v) => v !== val)),
      });
    }

    for (const val of regions) {
      tokens.push({
        key: `region:${val}`,
        groupLabel: 'Region',
        valueLabel: val,
        matchAll: regionsMode === 'all' && regions.length > 1,
        onRemove: () => setRegions((prev) => prev.filter((v) => v !== val)),
      });
    }

    for (const val of languages) {
      tokens.push({
        key: `lang:${val}`,
        groupLabel: 'Language',
        valueLabel: val,
        matchAll: languagesMode === 'all' && languages.length > 1,
        onRemove: () => setLanguages((prev) => prev.filter((v) => v !== val)),
      });
    }

    for (const val of sources) {
      tokens.push({
        key: `source:${val}`,
        groupLabel: 'Source',
        valueLabel: val,
        matchAll: sourcesMode === 'all' && sources.length > 1,
        onRemove: () => setSources((prev) => prev.filter((v) => v !== val)),
      });
    }

    if (downloadedFilter === 'only') {
      tokens.push({
        key: 'downloaded',
        groupLabel: 'Download',
        valueLabel: 'Downloaded',
        matchAll: false,
        onRemove: () => setDownloadedFilter('all'),
      });
    } else if (downloadedFilter === 'exclude') {
      tokens.push({
        key: 'downloaded',
        groupLabel: 'Download',
        valueLabel: 'Not Downloaded',
        matchAll: false,
        onRemove: () => setDownloadedFilter('all'),
      });
    }

    for (const val of statuses) {
      tokens.push({
        key: `status:${val}`,
        groupLabel: 'Status',
        valueLabel: STATUS_LABELS[val] || val,
        matchAll: false,
        onRemove: () => setStatuses((prev) => prev.filter((v) => v !== val)),
      });
    }

    if (installedFilter === 'only') {
      tokens.push({
        key: 'installed',
        groupLabel: 'Install',
        valueLabel: 'Installed',
        matchAll: false,
        onRemove: () => setInstalledFilter('all'),
      });
    } else if (installedFilter === 'exclude') {
      tokens.push({
        key: 'installed',
        groupLabel: 'Install',
        valueLabel: 'Not Installed',
        matchAll: false,
        onRemove: () => setInstalledFilter('all'),
      });
    }

    if (syncRulesOnly) {
      tokens.push({
        key: 'syncRules',
        groupLabel: 'Sync Rules',
        valueLabel: formatSyncRuleScopeSummary(config.systemFilter, config.allowedReleaseTypes),
        matchAll: false,
        onRemove: () => setSyncRulesOnly(false),
      });
    }

    return tokens;
  }, [
    search,
    systems,
    tags,
    tagsMode,
    genres,
    genresMode,
    regions,
    regionsMode,
    languages,
    languagesMode,
    sources,
    sourcesMode,
    downloadedFilter,
    statuses,
    installedFilter,
    syncRulesOnly,
    config.systemFilter,
    config.allowedReleaseTypes,
  ]);

  const activeFilterCount = activeFilterTokens.length;
  const hasActiveFilters = activeFilterCount > 0;
  const hasMountedFiltersRef = useRef(false);

  useEffect(() => {
    if (!hasMountedFiltersRef.current) {
      hasMountedFiltersRef.current = true;
      return;
    }
    if (activeFilterCount >= 3) {
      reportAchievementEvent('filter_combo', activeFilterCount);
    }
  }, [activeFilterCount]);

  const clearCatalogFilters = () => {
    setSearch('');
    setSystems([]);
    setStatuses([]);
    setDownloadedFilter('all');
    setInstalledFilter('all');
    setSyncRulesOnly(false);
    setTags([]);
    setTagsMode('any');
    setGenres([]);
    setGenresMode('any');
    setRegions([]);
    setRegionsMode('any');
    setLanguages([]);
    setLanguagesMode('any');
    setSources([]);
    setSourcesMode('any');
    setOpenFilterId(null);
  };

  const breadcrumbs = fsPath ? fsPath.split('/').filter(Boolean) : [];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md p-4 space-y-3">
        <div aria-hidden="true" className="crt-edge-beam">
          <span />
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-crt-bg border border-crt-border rounded-md self-start">
              <button
                type="button"
                onClick={() => setViewMode('catalog')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'catalog'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Indexed Catalog ({viewMode === 'catalog' ? totalItems : status.totals.totalCatalogItems})
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode('stats');
                  reportAchievementEvent('catalog_stats_view');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'stats'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5 shrink-0" />
                <span>Stats</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('filesystem')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'filesystem'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Local Disk Tree
              </button>
            </div>

            {viewMode === 'catalog' && (
              <div className="flex items-center gap-1 p-1 bg-crt-bg border border-crt-border rounded-md self-start">
                <button
                  type="button"
                  onClick={() => {
                    if (catalogLayout !== 'table') {
                      reportAchievementEvent('view_mode_grid');
                      reportAchievementEvent('view_mode_table');
                    }
                    setCatalogLayout('table');
                  }}
                  aria-label="Table view"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    catalogLayout === 'table'
                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (catalogLayout !== 'grid') {
                      reportAchievementEvent('view_mode_table');
                      reportAchievementEvent('view_mode_grid');
                    }
                    setCatalogLayout('grid');
                  }}
                  aria-label="Box-Art Grid view"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    catalogLayout === 'grid'
                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Box-Art Grid
                </button>
              </div>
            )}
          </div>

          {viewMode === 'catalog' ? (
            <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
              {onQueueDownload && totalItems > 0 && queueableFilteredCount > 0 && (
                <button
                  type="button"
                  disabled={!status.auth.hasCompletedLogin}
                  aria-expanded={filteredDownloadConfirm.open}
                  onClick={() => void handleOpenFilteredDownloadConfirm()}
                  title={formatDownloadFilteredTooltip({
                    hasCompletedLogin: status.auth.hasCompletedLogin,
                    hasActiveFilters,
                    queueableCount: queueableFilteredCount,
                    totalMatching: totalItems,
                  })}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                    filteredDownloadConfirm.open
                      ? 'border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor'
                      : 'border-crt-phosphor/60 bg-crt-bg text-crt-phosphor hover:bg-crt-phosphor/10'
                  }`}
                >
                  <Download className="h-3.5 w-3.5 shrink-0" />
                  <span className="tabular-nums">
                    {hasActiveFilters
                      ? `Download Filtered (${queueableFilteredCount.toLocaleString()})`
                      : `Download All (${queueableFilteredCount.toLocaleString()})`}
                  </span>
                </button>
              )}
              {totalItems > 0 && selectedCatalogIds.size < totalItems && (
                <button
                  type="button"
                  disabled={selectingAllMatching}
                  onClick={() => void handleSelectAllMatching()}
                  title={
                    hasActiveFilters
                      ? `Select all ${totalItems} catalog releases matching your active filters across all pages`
                      : `Select all ${totalItems} indexed catalog releases across all pages`
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text hover:text-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {selectingAllMatching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : null}
                  <span>
                    {hasActiveFilters
                      ? `Select All Filtered (${totalItems})`
                      : `Select All (${totalItems})`}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void installer.promptMountSdCard()}
                title={
                  sdRootHandle
                    ? `Mounted storage device: ${sdRootHandle.name} (click to switch)`
                    : 'Mount a target storage device folder (SD card, HDD, SSD, or USB drive)'
                }
                className={`crt-cta-beam inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sdRootHandle
                    ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/15'
                    : 'border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text'
                }`}
              >
                <HardDrive className="h-3.5 w-3.5 shrink-0" />
                {sdRootHandle ? `Device: ${sdRootHandle.name}` : 'Mount Storage Device'}
              </button>
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void loadCatalog(false, { softRefresh: true })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          ) : viewMode === 'filesystem' ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={fsSearch}
                  onChange={(e) => setFsSearch(e.target.value)}
                  placeholder={fsArchivePath ? 'Filter archive contents...' : 'Filter current folder...'}
                  className={`pl-8 ${fsSearch ? 'pr-7' : 'pr-3'} py-1.5 text-xs bg-crt-bg border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-56 ${
                    fsSearch.trim() ? 'border-crt-phosphor/60' : 'border-crt-border'
                  }`}
                />
                {fsSearch && (
                  <button
                    type="button"
                    onClick={() => setFsSearch('')}
                    aria-label={fsArchivePath ? 'Clear archive filter' : 'Clear folder filter'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 rounded"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <span className="text-xs font-mono text-crt-muted truncate max-w-xs">
                Root: {status.storage.downloadDir}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (fsArchivePath) {
                    void openFsArchive(fsArchivePath);
                  } else {
                    void loadFsTree(fsPath);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Rescan
              </button>
            </div>
          ) : (
            <div className="text-xs font-mono text-crt-muted">
              D3 growth, velocity &amp; system coverage insights
            </div>
          )}
        </div>

        {/* Catalog Filter Row */}
        {viewMode === 'catalog' && (
          <div className="space-y-2.5 pt-2 border-t border-crt-border">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && onEasterEggEffect) {
                      const submittedEffect = matchSecretSearch(search, { submitted: true });
                      if (submittedEffect && submittedEffect !== 'askew') {
                        e.preventDefault();
                        lastSecretQueryRef.current = normalizeSecretQuery(search);
                        onEasterEggEffect(submittedEffect);
                      }
                    }
                  }}
                  placeholder="Search title, publisher, file..."
                  className={`pl-8 ${search ? 'pr-7' : 'pr-3'} py-1.5 text-xs bg-crt-bg border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-56 ${
                    search.trim() ? 'border-crt-phosphor/60' : 'border-crt-border'
                  }`}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search query"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 rounded"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <MultiSelectFilterDropdown
                id="systems"
                label="Systems"
                allLabel="All Systems"
                options={systemOptions}
                selected={systems}
                onChange={setSystems}
                open={openFilterId === 'systems'}
                onOpenChange={(open) => setOpenFilterId(open ? 'systems' : null)}
                searchPlaceholder="Filter consoles..."
              />

              <MultiSelectFilterDropdown
                id="tags"
                label="Types"
                allLabel="All Types"
                options={tagOptions}
                selected={tags}
                onChange={setTags}
                matchMode={tagsMode}
                onMatchModeChange={setTagsMode}
                open={openFilterId === 'tags'}
                onOpenChange={(open) => setOpenFilterId(open ? 'tags' : null)}
                searchPlaceholder="Filter ROM types..."
              />

              <MultiSelectFilterDropdown
                id="genres"
                label="Genres"
                allLabel="All Genres"
                options={genreOptions}
                selected={genres}
                onChange={setGenres}
                matchMode={genresMode}
                onMatchModeChange={setGenresMode}
                open={openFilterId === 'genres'}
                onOpenChange={(open) => setOpenFilterId(open ? 'genres' : null)}
                searchPlaceholder="Filter genres..."
              />

              <MultiSelectFilterDropdown
                id="regions"
                label="Regions"
                allLabel="All Regions"
                options={regionOptions}
                selected={regions}
                onChange={setRegions}
                matchMode={regionsMode}
                onMatchModeChange={setRegionsMode}
                open={openFilterId === 'regions'}
                onOpenChange={(open) => setOpenFilterId(open ? 'regions' : null)}
                searchPlaceholder="Filter regions..."
              />

              <MultiSelectFilterDropdown
                id="languages"
                label="Languages"
                allLabel="All Languages"
                options={languageOptions}
                selected={languages}
                onChange={setLanguages}
                matchMode={languagesMode}
                onMatchModeChange={setLanguagesMode}
                open={openFilterId === 'languages'}
                onOpenChange={(open) => setOpenFilterId(open ? 'languages' : null)}
                searchPlaceholder="Filter languages..."
              />

              <MultiSelectFilterDropdown
                id="sources"
                label="Sources"
                allLabel="All Sources"
                options={sourceOptions}
                selected={sources}
                onChange={setSources}
                matchMode={sourcesMode}
                onMatchModeChange={setSourcesMode}
                open={openFilterId === 'sources'}
                onOpenChange={(open) => setOpenFilterId(open ? 'sources' : null)}
                searchPlaceholder="Filter release sources..."
              />

              <MultiSelectFilterDropdown
                id="statuses"
                label="Status"
                allLabel="All Statuses"
                options={statusOptions}
                selected={statuses}
                onChange={handleStatusesChange}
                open={openFilterId === 'statuses'}
                onOpenChange={(open) => setOpenFilterId(open ? 'statuses' : null)}
                showTotalOptionCount={false}
                searchPlaceholder="Filter statuses..."
              />
            </div>

            {/* Quick-Filter Action Buttons & Sort Row */}
            <div className="pt-2 border-t border-crt-border/60 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Filter by local download state"
                  className="inline-flex items-center gap-1.5 shrink-0"
                >
                  <button
                    type="button"
                    aria-pressed={downloadedFilter === 'only'}
                    onClick={() => {
                      const next = toggleCatalogDownloadedFilter(downloadedFilter, 'only');
                      setDownloadedFilter(next);
                      if (next === 'only') {
                        setStatuses([]);
                      }
                    }}
                    title={
                      downloadedFilter === 'only'
                        ? 'Click to clear Downloaded filter and show all matching games'
                        : 'Show only matching games already downloaded locally'
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      downloadedFilter === 'only'
                        ? 'bg-crt-phosphor/15 text-crt-phosphor border-crt-phosphor/70 font-medium'
                        : 'bg-crt-bg text-crt-text border-crt-border hover:border-crt-border-strong'
                    }`}
                  >
                    <Download
                      className={`h-3.5 w-3.5 shrink-0 ${
                        downloadedFilter === 'only' ? 'text-crt-phosphor' : 'text-crt-muted'
                      }`}
                    />
                    <span>Downloaded</span>
                    {facets.counts?.downloaded && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          downloadedFilter === 'only' ? 'text-crt-phosphor/90' : 'text-crt-muted'
                        }`}
                      >
                        ({facets.counts.downloaded.downloaded.toLocaleString()})
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-pressed={downloadedFilter === 'exclude'}
                    onClick={() =>
                      setDownloadedFilter((prev) => toggleCatalogDownloadedFilter(prev, 'exclude'))
                    }
                    title={
                      downloadedFilter === 'exclude'
                        ? 'Click to clear Not Downloaded filter and show all matching games'
                        : 'Show all matching un-downloaded games (Available, Queued, Failed)'
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      downloadedFilter === 'exclude'
                        ? 'bg-crt-amber/15 text-crt-amber border-crt-amber/70 font-medium'
                        : 'bg-crt-bg text-crt-text border-crt-border hover:border-crt-border-strong'
                    }`}
                  >
                    <span>Not Downloaded</span>
                    {facets.counts?.downloaded && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          downloadedFilter === 'exclude' ? 'text-crt-amber/90' : 'text-crt-muted'
                        }`}
                      >
                        ({facets.counts.downloaded.notDownloaded.toLocaleString()})
                      </span>
                    )}
                  </button>
                </div>

                <span
                  aria-hidden="true"
                  className="hidden sm:inline-block h-4 w-px bg-crt-border mx-0.5 shrink-0"
                />

                <div
                  role="group"
                  aria-label="Filter by storage device installation"
                  className="inline-flex items-center gap-1.5 shrink-0"
                >
                  <button
                    type="button"
                    aria-pressed={installedFilter === 'only'}
                    onClick={() =>
                      setInstalledFilter((prev) => (prev === 'only' ? 'all' : 'only'))
                    }
                    title={
                      installedFilter === 'only'
                        ? 'Click to clear Installed filter and show all matching games'
                        : 'Show only matching games installed to a storage device'
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      installedFilter === 'only'
                        ? 'bg-crt-phosphor/15 text-crt-phosphor border-crt-phosphor/70 font-medium'
                        : 'bg-crt-bg text-crt-text border-crt-border hover:border-crt-border-strong'
                    }`}
                  >
                    <HardDrive
                      className={`h-3.5 w-3.5 shrink-0 ${
                        installedFilter === 'only' ? 'text-crt-phosphor' : 'text-crt-muted'
                      }`}
                    />
                    <span>Installed</span>
                    {facets.counts?.installed && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          installedFilter === 'only' ? 'text-crt-phosphor/90' : 'text-crt-muted'
                        }`}
                      >
                        ({facets.counts.installed.installed.toLocaleString()})
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-pressed={installedFilter === 'exclude'}
                    onClick={() =>
                      setInstalledFilter((prev) => (prev === 'exclude' ? 'all' : 'exclude'))
                    }
                    title={
                      installedFilter === 'exclude'
                        ? 'Click to clear Not Installed filter and show all matching games'
                        : 'Show only matching games not yet installed to a storage device'
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      installedFilter === 'exclude'
                        ? 'bg-crt-amber/15 text-crt-amber border-crt-amber/70 font-medium'
                        : 'bg-crt-bg text-crt-text border-crt-border hover:border-crt-border-strong'
                    }`}
                  >
                    <span>Not Installed</span>
                    {facets.counts?.installed && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          installedFilter === 'exclude' ? 'text-crt-amber/90' : 'text-crt-muted'
                        }`}
                      >
                        ({facets.counts.installed.notInstalled.toLocaleString()})
                      </span>
                    )}
                  </button>
                </div>

                <span
                  aria-hidden="true"
                  className="hidden sm:inline-block h-4 w-px bg-crt-border mx-0.5 shrink-0"
                />

                <button
                  type="button"
                  aria-pressed={syncRulesOnly}
                  onClick={() => setSyncRulesOnly((prev) => !prev)}
                  title={
                    syncRulesOnly
                      ? 'Click to clear Sync Rules filter and show all consoles and release types'
                      : `Show only releases matching active Sync Rules (${formatSyncRuleScopeSummary(config.systemFilter, config.allowedReleaseTypes)})`
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    syncRulesOnly
                      ? 'bg-crt-phosphor/15 text-crt-phosphor border-crt-phosphor/70 font-medium'
                      : 'bg-crt-bg text-crt-text border-crt-border hover:border-crt-border-strong'
                  }`}
                >
                  <SlidersHorizontal
                    className={`h-3.5 w-3.5 shrink-0 ${
                      syncRulesOnly ? 'text-crt-phosphor' : 'text-crt-muted'
                    }`}
                  />
                  <span>Matches Sync Rules</span>
                  {typeof facets.counts?.syncRulesMatched === 'number' && (
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        syncRulesOnly ? 'text-crt-phosphor/90' : 'text-crt-muted'
                      }`}
                    >
                      ({facets.counts.syncRulesMatched.toLocaleString()})
                    </span>
                  )}
                </button>
              </div>

              <select
                value={sort}
                onChange={(e) => setSort(normalizeCatalogSort(e.target.value))}
                aria-label="Sort catalog releases"
                className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor shrink-0 ${
                  sort !== DEFAULT_CATALOG_SORT
                    ? 'border-crt-phosphor/60 text-crt-phosphor'
                    : 'border-crt-border text-crt-text'
                }`}
              >
                {CATALOG_SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Removable Active Filter Summary Bar */}
            {hasActiveFilters && (
              <div className="pt-2 border-t border-crt-border/70 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-crt-muted mr-0.5 whitespace-nowrap shrink-0">
                    Active:
                  </span>
                  {activeFilterTokens.map((tok) => (
                    <button
                      key={tok.key}
                      type="button"
                      onClick={tok.onRemove}
                      title={`Remove ${tok.groupLabel}: ${tok.valueLabel}`}
                      className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono border border-crt-border-strong bg-crt-bg hover:border-crt-crimson/60 text-crt-text hover:text-crt-crimson rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span className="text-crt-muted">
                        {tok.groupLabel}
                        {tok.matchAll ? ' [ALL]' : ''}:
                      </span>
                      <span className="text-crt-phosphor truncate max-w-[12rem]">{tok.valueLabel}</span>
                      <X className="h-3 w-3 shrink-0 opacity-75" />
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={clearCatalogFilters}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear All ({activeFilterCount})
                </button>
              </div>
            )}
            {/* Mellow Smooth Accordion: Download Filtered Confirmation Strip */}
            <div
              aria-hidden={!filteredDownloadConfirm.open}
              inert={!filteredDownloadConfirm.open || undefined}
              data-open={filteredDownloadConfirm.open ? 'true' : 'false'}
              className={`crt-accordion-grid transition-opacity duration-250 motion-reduce:transition-none ${
                filteredDownloadConfirm.open ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="crt-accordion-inner">
                <div className="mt-1 border border-crt-phosphor/45 bg-crt-bg rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  {filteredDownloadConfirm.loading ? (
                    <div className="inline-flex items-center gap-2 font-mono text-crt-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-crt-phosphor" />
                      <span>Calculating queueable releases and estimated archive footprint…</span>
                    </div>
                  ) : filteredDownloadConfirm.error ? (
                    <span className="font-mono text-crt-crimson">{filteredDownloadConfirm.error}</span>
                  ) : filteredDownloadConfirm.queueableIds.length === 0 ? (
                    <span className="font-mono text-crt-muted">
                      {filteredDownloadConfirm.alreadyQueuedCount > 0 &&
                      filteredDownloadConfirm.alreadyDownloadedCount > 0
                        ? `All matching releases are already handled (${filteredDownloadConfirm.alreadyQueuedCount.toLocaleString()} queued/downloading, ${filteredDownloadConfirm.alreadyDownloadedCount.toLocaleString()} downloaded).`
                        : filteredDownloadConfirm.alreadyQueuedCount > 0
                          ? `All ${filteredDownloadConfirm.alreadyQueuedCount.toLocaleString()} matching release${filteredDownloadConfirm.alreadyQueuedCount === 1 ? ' is' : 's are'} already queued or downloading.`
                          : `All ${filteredDownloadConfirm.alreadyDownloadedCount.toLocaleString()} matching release${filteredDownloadConfirm.alreadyDownloadedCount === 1 ? ' is' : 's are'} already downloaded on disk.`}
                    </span>
                  ) : (
                    <div className="font-mono text-crt-text tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-crt-phosphor font-semibold">
                        {filteredDownloadConfirm.queueableIds.length.toLocaleString()} un-downloaded release
                        {filteredDownloadConfirm.queueableIds.length === 1 ? '' : 's'}
                      </span>
                      {filteredDownloadConfirm.estimatedQueueBytes > 0 && (
                        <>
                          <span aria-hidden="true" className="text-crt-muted">·</span>
                          <span>~{formatBytes(filteredDownloadConfirm.estimatedQueueBytes)} est.</span>
                        </>
                      )}
                      {filteredDownloadConfirm.alreadyQueuedCount > 0 && (
                        <>
                          <span aria-hidden="true" className="text-crt-muted">·</span>
                          <span className="text-crt-muted">
                            {filteredDownloadConfirm.alreadyQueuedCount.toLocaleString()} already queued skipped
                          </span>
                        </>
                      )}
                      {filteredDownloadConfirm.alreadyDownloadedCount > 0 && (
                        <>
                          <span aria-hidden="true" className="text-crt-muted">·</span>
                          <span className="text-crt-muted">
                            {filteredDownloadConfirm.alreadyDownloadedCount.toLocaleString()} already downloaded skipped
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <button
                      type="button"
                      disabled={queueingBulk}
                      onClick={() => setFilteredDownloadConfirm((prev) => ({ ...prev, open: false }))}
                      className="px-3 py-1.5 text-xs font-medium border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Cancel
                    </button>
                    {!filteredDownloadConfirm.loading &&
                      filteredDownloadConfirm.queueableIds.length > 0 && (
                        <button
                          type="button"
                          disabled={queueingBulk}
                          onClick={() => void handleConfirmDownloadFiltered()}
                          className="crt-cta-beam inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-crt-phosphor text-crt-bg hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5 shrink-0" />
                          {queueingBulk
                            ? 'Queueing...'
                            : `Queue ${filteredDownloadConfirm.queueableIds.length.toLocaleString()} Download${
                                filteredDownloadConfirm.queueableIds.length === 1 ? '' : 's'
                              }`}
                        </button>
                      )}
                  </div>
                </div>
              </div>
            </div>

            {/* Mellow Smooth Accordion: Background Catalog Indexer Banner */}
            {status.auth.hasCompletedLogin && status.indexer && (() => {
              const indexer = status.indexer;
              const isOpen = indexer.active || indexer.remainingUnindexedSystems > 0;
              return (
                <div
                  aria-hidden={!isOpen}
                  inert={!isOpen || undefined}
                  data-open={isOpen ? 'true' : 'false'}
                  className={`crt-accordion-grid transition-opacity duration-300 motion-reduce:transition-none ${
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <div className="crt-accordion-inner">
                    <div className="pt-2 border-t border-crt-border/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                          {indexer.active ? (
                            <>
                              <span className="text-crt-phosphor font-medium">
                                Indexing Catalog {indexer.systemsCompleted + (indexer.currentSystem ? 1 : 0)}/
                                {Math.max(1, indexer.systemsTotal)}
                              </span>
                              {indexer.currentSystem && (
                                <>
                                  <span aria-hidden="true" className="text-crt-muted">·</span>
                                  <span className="text-crt-text">{indexer.currentSystem}</span>
                                </>
                              )}
                              {indexer.totalPages > 0 && (
                                <>
                                  <span aria-hidden="true" className="text-crt-muted">·</span>
                                  <span className="text-crt-muted">
                                    Page {indexer.currentPage}/{indexer.totalPages}
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true" className="text-crt-muted">·</span>
                              <span className="text-crt-muted">
                                {indexer.indexedCount.toLocaleString()} indexed
                              </span>
                            </>
                          ) : (
                            <span className="text-crt-muted">
                              {indexer.remainingUnindexedSystems} console
                              {indexer.remainingUnindexedSystems === 1 ? '' : 's'} remaining outside your current filter
                            </span>
                          )}
                        </div>
                        {indexer.active && (
                          <div className="h-1 w-full max-w-md bg-crt-bg border border-crt-border rounded-sm overflow-hidden">
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
                        {indexer.active && onStopCatalogIndex && (
                          <button
                            type="button"
                            disabled={indexerBusy}
                            onClick={async () => {
                              setIndexerBusy(true);
                              try {
                                await onStopCatalogIndex();
                              } finally {
                                setIndexerBusy(false);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-crt-amber/60 text-crt-amber hover:bg-crt-amber/10 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <Pause className="h-3 w-3" />
                            Pause Indexing
                          </button>
                        )}
                        {(!indexer.active || indexer.scope === 'filtered') &&
                          indexer.remainingUnindexedSystems > 0 &&
                          onStartCatalogIndex && (
                            <button
                              type="button"
                              disabled={indexerBusy}
                              onClick={async () => {
                                setIndexerBusy(true);
                                try {
                                  await onStartCatalogIndex('full');
                                } finally {
                                  setIndexerBusy(false);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className={`h-3 w-3 ${indexerBusy ? 'animate-spin' : ''}`} />
                              Index All Remaining Consoles ({indexer.remainingUnindexedSystems})
                            </button>
                          )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {queueNotice && (
              <div className="border border-crt-phosphor/45 bg-crt-phosphor/8 rounded px-3 py-2 text-xs font-mono text-crt-phosphor flex items-center justify-between gap-3">
                <span>{queueNotice}</span>
                <button
                  type="button"
                  onClick={() => setQueueNotice(null)}
                  className="text-crt-muted hover:text-crt-text shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* Contextual Bulk Selection Bar (Indexed Catalog) */}
        {viewMode === 'catalog' && selectedCatalogIds.size > 0 && (
          <div className="pt-3 border-t border-crt-border flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-crt-phosphor tabular-nums whitespace-nowrap shrink-0">
                {selectedCatalogIds.size} item{selectedCatalogIds.size === 1 ? '' : 's'} selected
                {selectedCatalogIds.size > items.length ? ' across all pages' : ''}
              </span>
              {totalItems > selectedCatalogIds.size && (
                <button
                  type="button"
                  disabled={selectingAllMatching}
                  onClick={() => void handleSelectAllMatching()}
                  className="text-xs font-mono text-crt-amber hover:underline whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {selectingAllMatching
                    ? 'Selecting all...'
                    : `Select all ${totalItems} matching`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!confirmCatalogBulk && (
                <>
                  {onQueueDownload && selectionSummary.queueableIds.length > 0 && (
                    <button
                      type="button"
                      disabled={queueingBulk || !status.auth.hasCompletedLogin}
                      title={formatQueueSelectedTooltip(
                        selectionSummary,
                        status.auth.hasCompletedLogin,
                      )}
                      onClick={() => void handleQueueIds(selectionSummary.queueableIds, true)}
                      className="crt-cta-beam inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0" />
                      {queueingBulk
                        ? 'Queueing...'
                        : `Queue Downloads (${selectionSummary.queueableIds.length.toLocaleString()})`}
                    </button>
                  )}
                  {selectionSummary.installableIds.length > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={installer.isBusy}
                        title={formatInstallSelectedTooltip(
                          'express',
                          selectionSummary,
                          installer.isBusy,
                        )}
                        onClick={() =>
                          void installer.startExpressInstall(
                            selectionSummary.installableIds,
                            currentSmartFilterContext,
                            knownItemMetaMap,
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold border border-crt-phosphor/70 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <FolderInput className="h-3.5 w-3.5 shrink-0" />
                        Express Install ({selectionSummary.installableIds.length.toLocaleString()})
                      </button>
                      <button
                        type="button"
                        disabled={installer.isBusy}
                        title={formatInstallSelectedTooltip(
                          'review',
                          selectionSummary,
                          installer.isBusy,
                        )}
                        onClick={() =>
                          void installer.openReviewQueue(
                            selectionSummary.installableIds,
                            currentSmartFilterContext,
                            knownItemMetaMap,
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold border border-crt-phosphor/70 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <HardDrive className="h-3.5 w-3.5 shrink-0" />
                        Install to Storage Device ({selectionSummary.installableIds.length.toLocaleString()})
                      </button>
                    </>
                  )}
                  {(selectedCatalogIds.size > items.length ||
                    items.some((i) => selectedCatalogIds.has(i.id) && !i.installedAt)) && (
                    <button
                      type="button"
                      disabled={markingInstalled}
                      onClick={() => void handleBulkSetInstalled(Array.from(selectedCatalogIds), true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border text-crt-text hover:border-crt-phosphor hover:text-crt-phosphor rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Flag Installed
                    </button>
                  )}
                  {(selectedCatalogIds.size > items.length ||
                    items.some((i) => selectedCatalogIds.has(i.id) && Boolean(i.installedAt))) && (
                    <button
                      type="button"
                      disabled={markingInstalled}
                      onClick={() => void handleBulkSetInstalled(Array.from(selectedCatalogIds), false)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:border-crt-amber hover:text-crt-amber rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear Installed
                    </button>
                  )}
                </>
              )}
              {confirmCatalogBulk ? (
                <>
                  <button
                    type="button"
                    disabled={deletingKey === 'catalog-bulk'}
                    onClick={() => void handleDeleteCatalogItems(Array.from(selectedCatalogIds))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-crt-bg bg-crt-crimson hover:brightness-110 rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    {deletingKey === 'catalog-bulk' ? 'Deleting...' : `Confirm Delete (${selectedCatalogIds.size})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCatalogBulk(false)}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmCatalogBulk(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-crimson/60 text-crt-crimson hover:bg-crt-crimson/10 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                    Delete Selected ({selectedCatalogIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCatalogIds(new Set())}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Contextual Bulk Selection Bar (Local Disk Tree) */}
        {viewMode === 'filesystem' && !fsArchivePath && selectedFsPaths.size > 0 && (
          <div className="pt-3 border-t border-crt-border flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <span className="text-crt-phosphor tabular-nums">
              {selectedFsPaths.size} disk entr{selectedFsPaths.size === 1 ? 'y' : 'ies'} selected
            </span>
            <div className="flex items-center gap-2">
              {confirmFsBulk ? (
                <>
                  <button
                    type="button"
                    disabled={deletingKey === 'fs-bulk'}
                    onClick={() => void handleDeleteFsPaths(Array.from(selectedFsPaths))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-crt-bg bg-crt-crimson hover:brightness-110 rounded transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingKey === 'fs-bulk' ? 'Deleting...' : `Confirm Delete (${selectedFsPaths.size})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmFsBulk(false)}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmFsBulk(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-crimson/60 text-crt-crimson hover:bg-crt-crimson/10 rounded transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Selected ({selectedFsPaths.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFsPaths(new Set())}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Content View */}
      {viewMode === 'catalog' ? (
        <div className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md overflow-hidden">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="h-10 bg-crt-bg border border-crt-border rounded animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <FileArchive className="h-6 w-6 text-crt-muted mx-auto" />
              <p className="text-sm font-medium text-crt-text">
                {hasActiveFilters
                  ? 'No catalog releases match your active filters'
                  : 'No mirrored repository items yet'}
              </p>
              <p className="text-xs text-crt-muted max-w-md mx-auto">
                {hasActiveFilters
                  ? 'Adjust or reset your active search and dropdown filters to display all indexed releases.'
                  : 'Run an Incremental Sync from the Sync tab to crawl retrogametalk.com/repo and mirror releases locally.'}
              </p>
              {hasActiveFilters && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={clearCatalogFilters}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear All Filters ({activeFilterCount})
                  </button>
                </div>
              )}
            </div>
          ) : catalogLayout === 'table' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-crt-border bg-crt-bg text-[11px] font-mono text-crt-muted">
                    <th className="py-2.5 pl-4 pr-2 w-9">
                      <input
                        type="checkbox"
                        checked={allCatalogSelected}
                        onChange={toggleAllCatalog}
                        aria-label="Select all filtered catalog items"
                        className="accent-crt-phosphor cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      <button
                        type="button"
                        onClick={() => setSort((cur) => (cur === 'system_asc' ? 'system_desc' : 'system_asc'))}
                        className={`inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0 transition-colors hover:text-crt-text cursor-pointer focus-visible:outline-none focus-visible:text-crt-phosphor ${
                          sort === 'system_asc' || sort === 'system_desc' ? 'text-crt-phosphor' : ''
                        }`}
                        title="Sort by console system"
                      >
                        <span>System</span>
                        {sort === 'system_asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : sort === 'system_desc' ? (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      <button
                        type="button"
                        onClick={() => setSort((cur) => (cur === 'title_asc' ? 'title_desc' : 'title_asc'))}
                        className={`inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0 transition-colors hover:text-crt-text cursor-pointer focus-visible:outline-none focus-visible:text-crt-phosphor ${
                          sort === 'title_asc' || sort === 'title_desc' ? 'text-crt-phosphor' : ''
                        }`}
                        title="Sort alphabetically by title"
                      >
                        <span>Release &amp; Mirrored Path</span>
                        {sort === 'title_asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : sort === 'title_desc' ? (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium">Type</th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => setSort((cur) => (cur === 'size_desc' ? 'size_asc' : 'size_desc'))}
                        className={`inline-flex items-center justify-end gap-1 font-medium whitespace-nowrap shrink-0 transition-colors hover:text-crt-text cursor-pointer focus-visible:outline-none focus-visible:text-crt-phosphor ${
                          sort === 'size_desc' || sort === 'size_asc' ? 'text-crt-phosphor' : ''
                        }`}
                        title="Sort by file size"
                      >
                        <span>Size</span>
                        {sort === 'size_asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : sort === 'size_desc' ? (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => setSort((cur) => (cur === 'submitted_desc' ? 'submitted_asc' : 'submitted_desc'))}
                        className={`inline-flex items-center justify-end gap-1 font-medium whitespace-nowrap shrink-0 transition-colors hover:text-crt-text cursor-pointer focus-visible:outline-none focus-visible:text-crt-phosphor ${
                          sort === 'submitted_desc' || sort === 'submitted_asc' || sort === 'downloaded_desc' || sort === 'discovered_desc'
                            ? 'text-crt-phosphor'
                            : ''
                        }`}
                        title="Toggle newest/oldest site submissions"
                      >
                        <span>
                          {sort === 'downloaded_desc'
                            ? 'Downloaded'
                            : sort === 'discovered_desc'
                              ? 'Discovered'
                              : 'Submitted'}
                        </span>
                        {sort === 'submitted_asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : sort === 'submitted_desc' || sort === 'downloaded_desc' || sort === 'discovered_desc' ? (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-50" />
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-crt-border text-xs">
                  {items.map((item, idx) => {
                    const checked = selectedCatalogIds.has(item.id);
                    const isDeletingThis = deletingKey === `item-${item.id}`;
                    const showCoverThumb = Boolean(item.coverLocalPath) && !failedCovers.has(item.id);
                    const assetVersion = item.metadata?.fetchedAt
                      ? `&v=${encodeURIComponent(item.metadata.fetchedAt)}`
                      : '';
                    const subMeta = [
                      item.genres.length > 0 ? item.genres.join(', ') : null,
                      item.regions.length > 0 ? item.regions.join(', ') : null,
                      item.releaseYear,
                      `${item.filesCount} file${item.filesCount === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    const tagsDisplay =
                      item.releaseTags.length > 0 ? item.releaseTags.join(' · ') : item.releaseType;
                    const transfer = resolveItemTransferProgress(
                      item.status,
                      item.id,
                      status.activeTransfer,
                      item.files,
                    );

                    return (
                      <tr
                        key={item.id}
                        onClick={() => void openDetailItem(item, idx)}
                        className={`crt-table-row cursor-pointer transition-colors ${
                          checked ? 'bg-crt-phosphor/5' : 'hover:bg-crt-elevated'
                        }`}
                      >
                        <td className="pl-4 pr-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCatalogItem(item.id)}
                            aria-label={`Select ${item.title}`}
                            className="accent-crt-phosphor cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-crt-text whitespace-nowrap">
                          {item.systemName}
                        </td>
                        <td className="px-3 py-2 max-w-md">
                          <div className="flex items-center gap-3 min-w-0">
                            <LazyCoverImage
                              itemId={item.id}
                              title={item.title}
                              systemName={item.systemName}
                              hasLocalCover={Boolean(item.coverLocalPath)}
                              hasRemoteCover={Boolean(item.metadata?.coverUrl)}
                              assetVersion={assetVersion}
                              failed={failedCovers.has(item.id)}
                              compact
                              onError={() =>
                                setFailedCovers((prev) => {
                                  const next = new Set(prev);
                                  next.add(item.id);
                                  return next;
                                })
                              }
                            />
                            <div className="min-w-0">
                              <div className="font-medium text-crt-text truncate">{item.title}</div>
                              {subMeta && (
                                <div className="text-[11px] text-crt-muted truncate">{subMeta}</div>
                              )}
                              <div className="font-mono text-[11px] text-crt-muted/80 truncate">
                                {item.remotePath}
                              </div>
                              {item.errorMessage && (
                                <div className="font-mono text-[11px] text-crt-crimson truncate">
                                  {item.errorMessage}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-crt-muted max-w-xs">
                          <span className="line-clamp-2">{tagsDisplay}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-right text-crt-text tabular-nums whitespace-nowrap">
                          {transfer.active
                            ? transfer.totalBytes
                              ? formatBytes(transfer.totalBytes)
                              : item.fileSizeBytes > 0
                                ? formatBytes(item.fileSizeBytes)
                                : transfer.bytesReceived > 0
                                  ? formatBytes(transfer.bytesReceived)
                                  : 'Pending'
                            : item.sizeIsEstimated && item.fileSizeBytes > 0
                              ? `~${formatBytes(item.fileSizeBytes)}`
                              : formatBytes(item.fileSizeBytes)}
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {transfer.active ? (
                            <div className="min-w-[180px] max-w-[230px] space-y-1.5">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                                  <span
                                    className={`inline-flex items-center gap-1 font-medium ${
                                      transfer.mode === 'preparing' ? 'text-crt-amber' : 'text-crt-phosphor'
                                    }`}
                                    title={transfer.filename || undefined}
                                  >
                                    <Download className="h-3 w-3 shrink-0" />
                                    <span>
                                      {transfer.mode === 'preparing'
                                        ? 'Preparing'
                                        : transfer.fileSequenceLabel
                                          ? transfer.percent !== null
                                            ? `${transfer.fileSequenceLabel} · ${transfer.percent}%`
                                            : transfer.fileSequenceLabel
                                          : transfer.percent !== null
                                            ? `Downloading · ${transfer.percent}%`
                                            : 'Downloading'}
                                    </span>
                                  </span>
                                  {transfer.speedLabel && (
                                    <span className="text-crt-muted">{transfer.speedLabel}</span>
                                  )}
                                </div>
                                <div
                                  role="progressbar"
                                  aria-label={`Current file download progress for ${item.title}`}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={transfer.percent ?? undefined}
                                  className="h-1.5 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
                                >
                                  {transfer.mode === 'determinate' ? (
                                    <div
                                      className="h-full bg-crt-phosphor crt-progress-beam transition-all duration-200"
                                      style={{ width: `${transfer.percent}%` }}
                                    />
                                  ) : (
                                    <div
                                      className={`h-full crt-progress-indeterminate ${
                                        transfer.mode === 'preparing' ? 'bg-crt-amber' : 'bg-crt-phosphor'
                                      }`}
                                    />
                                  )}
                                </div>
                                <div className="text-[10px] text-crt-muted tabular-nums truncate">
                                  {transfer.bytesLabel}
                                </div>
                              </div>

                              {transfer.overall.show && (
                                <div className="pt-1 border-t border-crt-border/70 space-y-1">
                                  <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
                                    <span className="text-crt-muted">
                                      Overall · {transfer.overall.completedFiles}/{transfer.overall.totalFiles} files
                                    </span>
                                    <span className="text-crt-phosphor font-semibold">
                                      {transfer.overall.percent}%
                                    </span>
                                  </div>
                                  <div
                                    role="progressbar"
                                    aria-label={`Overall catalog item progress for ${item.title}`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={transfer.overall.percent}
                                    className="h-1 w-full bg-crt-bg border border-crt-border rounded-sm overflow-hidden"
                                  >
                                    <div
                                      className="h-full bg-crt-phosphor/80 crt-progress-beam transition-all duration-200"
                                      style={{ width: `${transfer.overall.percent}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <span
                                className={`inline-flex items-center gap-1.5 ${
                                  item.status === 'downloaded'
                                    ? 'text-crt-phosphor'
                                    : item.status === 'available'
                                      ? 'text-crt-phosphor/80'
                                      : item.status === 'skipped'
                                        ? 'text-crt-muted'
                                        : item.status === 'failed'
                                          ? 'text-crt-crimson'
                                          : 'text-crt-amber'
                                }`}
                              >
                                {item.status === 'downloaded' && <CheckCircle2 className="h-3.5 w-3.5" />}
                                {item.status === 'available' && <Cloud className="h-3.5 w-3.5" />}
                                {item.status === 'skipped' && <SkipForward className="h-3.5 w-3.5" />}
                                {item.status === 'failed' && <XCircle className="h-3.5 w-3.5" />}
                                {item.status === 'partial' && <AlertCircle className="h-3.5 w-3.5" />}
                                {item.status}
                              </span>
                              {item.installedAt && (
                                <div
                                  title={`Installed${item.installedDeviceLabel ? ` to ${item.installedDeviceLabel}` : ''} on ${formatDateTime(item.installedAt)}`}
                                  className="flex items-center gap-1.5 text-[11px] text-crt-text/90"
                                >
                                  <HardDrive className="h-3 w-3 text-crt-phosphor shrink-0" />
                                  <span className="truncate max-w-[140px]">
                                    Installed{item.installedDeviceLabel ? ` · ${item.installedDeviceLabel}` : ''}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td
                          className="px-4 py-2 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-2">
                            {item.status === 'available' && onQueueDownload ? (
                              <button
                                type="button"
                                disabled={queueingIds.has(item.id) || !status.auth.hasCompletedLogin}
                                title={
                                  !status.auth.hasCompletedLogin
                                    ? 'Verify login in System Settings before downloading'
                                    : 'Queue this release for download'
                                }
                                onClick={() => void handleQueueIds([item.id])}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <Download className="h-3 w-3" />
                                {queueingIds.has(item.id) ? 'Queueing...' : 'Download'}
                              </button>
                            ) : item.status === 'failed' || item.status === 'partial' ? (
                              <button
                                type="button"
                                disabled={effectiveRetryingId === item.id || Boolean(status.activeRun) || !status.auth.hasCompletedLogin}
                                title={!status.auth.hasCompletedLogin ? 'Verify login in System Settings before retrying' : undefined}
                                onClick={() => void handleRetry(item.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-crt-border hover:border-crt-phosphor text-crt-text rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <RotateCcw className={`h-3 w-3 ${effectiveRetryingId === item.id ? 'animate-spin' : ''}`} />
                                {effectiveRetryingId === item.id ? 'Retrying...' : 'Retry'}
                              </button>
                            ) : (
                              <span
                                className="font-mono text-[11px] text-crt-muted tabular-nums"
                                title={
                                  sort === 'downloaded_desc'
                                    ? 'Downloaded to disk'
                                    : sort === 'discovered_desc'
                                      ? 'Indexed into catalog'
                                      : item.publishedAt
                                        ? 'Site submission date'
                                        : item.remoteUpdatedAt
                                          ? 'Site updated date'
                                          : 'Indexed into catalog'
                                }
                              >
                                {formatDateTime(
                                  sort === 'downloaded_desc'
                                    ? item.downloadedAt || item.discoveredAt
                                    : sort === 'discovered_desc'
                                      ? item.discoveredAt
                                      : item.publishedAt || item.remoteUpdatedAt || item.downloadedAt || item.discoveredAt,
                                )}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={isDeletingThis}
                              onClick={() => void handleDeleteCatalogItems([item.id])}
                              aria-label={`Delete ${item.title}`}
                              title="Delete release and local mirrored files"
                              className="p-1.5 border border-crt-border hover:border-crt-crimson text-crt-muted hover:text-crt-crimson rounded transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div>
              {/* Grid Header Bar */}
              <div className="px-4 py-2.5 border-b border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-crt-muted">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-crt-text">
                    <input
                      type="checkbox"
                      checked={allCatalogSelected}
                      onChange={toggleAllCatalog}
                      aria-label="Select all visible catalog items"
                      className="accent-crt-phosphor cursor-pointer"
                    />
                    <span>Select visible ({items.length})</span>
                  </label>
                  {totalItems > items.length && selectedCatalogIds.size < totalItems && (
                    <button
                      type="button"
                      disabled={selectingAllMatching}
                      onClick={() => void handleSelectAllMatching()}
                      className="text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {selectingAllMatching
                        ? 'Selecting all...'
                        : `Select all ${totalItems} matching`}
                    </button>
                  )}
                </div>
                <span>Click any release to inspect artwork, specs &amp; ROMs</span>
              </div>

              {/* Box-Art Grid */}
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {items.map((item, idx) => {
                  const checked = selectedCatalogIds.has(item.id);
                  const showCover = Boolean(item.coverLocalPath) && !failedCovers.has(item.id);
                  const assetVersion = item.metadata?.fetchedAt
                    ? `&v=${encodeURIComponent(item.metadata.fetchedAt)}`
                    : '';
                  const subline = [
                    item.systemName,
                    item.releaseYear,
                    item.regions.length > 0 ? item.regions.join('/') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const tagsDisplay =
                    item.releaseTags.length > 0 ? item.releaseTags.join(' · ') : item.releaseType;
                  const transfer = resolveItemTransferProgress(
                    item.status,
                    item.id,
                    status.activeTransfer,
                    item.files,
                  );

                  return (
                    <div
                      key={item.id}
                      onClick={() => void openDetailItem(item, idx)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void openDetailItem(item, idx);
                        }
                      }}
                      className={`crt-catalog-card group relative border rounded-md overflow-hidden bg-crt-bg cursor-pointer transition-colors flex flex-col text-left focus:outline-none focus:border-crt-phosphor ${
                        checked
                          ? 'border-crt-phosphor bg-crt-phosphor/5'
                          : 'border-crt-border hover:border-crt-border-strong'
                      }`}
                    >
                      {/* Cover Art Container */}
                      <div className="relative aspect-[3/4] bg-crt-surface border-b border-crt-border overflow-hidden">
                        <div aria-hidden="true" className="crt-card-holo" />
                        <LazyCoverImage
                          itemId={item.id}
                          title={item.title}
                          systemName={item.systemName}
                          hasLocalCover={Boolean(item.coverLocalPath)}
                          hasRemoteCover={Boolean(item.metadata?.coverUrl)}
                          assetVersion={assetVersion}
                          failed={failedCovers.has(item.id)}
                          padBottom={transfer.active}
                          onError={() =>
                            setFailedCovers((prev) => {
                              const next = new Set(prev);
                              next.add(item.id);
                              return next;
                            })
                          }
                        />

                        {transfer.active && (
                          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-crt-bg via-crt-bg/92 to-transparent pt-10 px-3 pb-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                              <span
                                className={`inline-flex items-center gap-1.5 font-medium truncate ${
                                  transfer.mode === 'preparing' ? 'text-crt-amber' : 'text-crt-phosphor'
                                }`}
                              >
                                <Download className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {transfer.filename ||
                                    (transfer.mode === 'preparing' ? 'Preparing release…' : 'Downloading…')}
                                </span>
                              </span>
                              {transfer.fileSequenceLabel && (
                                <span className="text-[10px] text-crt-muted whitespace-nowrap shrink-0 tabular-nums">
                                  {transfer.fileSequenceLabel}
                                </span>
                              )}
                            </div>

                            <div
                              role="progressbar"
                              aria-label={`Current file download progress for ${item.title}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={transfer.percent ?? undefined}
                              className="h-1.5 w-full bg-crt-surface/90 border border-crt-border rounded-sm overflow-hidden"
                            >
                              {transfer.mode === 'determinate' ? (
                                <div
                                  className="h-full bg-crt-phosphor crt-progress-beam transition-all duration-200"
                                  style={{ width: `${transfer.percent}%` }}
                                />
                              ) : (
                                <div
                                  className={`h-full crt-progress-indeterminate ${
                                    transfer.mode === 'preparing' ? 'bg-crt-amber' : 'bg-crt-phosphor'
                                  }`}
                                />
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-crt-muted">
                              <span className="truncate text-crt-text/90">{transfer.bytesLabel}</span>
                              <span className="whitespace-nowrap shrink-0">
                                {transfer.speedLabel && <span>{transfer.speedLabel}</span>}
                                {transfer.speedLabel && transfer.percent !== null && (
                                  <span aria-hidden="true"> · </span>
                                )}
                                {transfer.percent !== null && (
                                  <span className="text-crt-phosphor font-semibold">{transfer.percent}%</span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}

                        <div
                          className="absolute top-2 left-2 z-10 p-1 rounded bg-crt-bg/85 border border-crt-border"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCatalogItem(item.id)}
                            aria-label={`Select ${item.title}`}
                            className="accent-crt-phosphor cursor-pointer block"
                          />
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                        <div className="space-y-1">
                          <h3 className="font-display text-sm font-semibold text-crt-text leading-snug line-clamp-2 group-hover:text-crt-phosphor transition-colors">
                            {item.title}
                          </h3>
                          <p className="font-mono text-[11px] text-crt-muted truncate">{subline}</p>
                          <p className="font-mono text-[11px] text-crt-phosphor/90 truncate">{tagsDisplay}</p>
                          {item.installedAt && (
                            <p
                              title={`Installed${item.installedDeviceLabel ? ` to ${item.installedDeviceLabel}` : ''} on ${formatDateTime(item.installedAt)}`}
                              className="flex items-center gap-1.5 font-mono text-[11px] text-crt-text/90 truncate pt-0.5"
                            >
                              <HardDrive className="h-3 w-3 text-crt-phosphor shrink-0" />
                              <span className="truncate">
                                Installed{item.installedDeviceLabel ? ` · ${item.installedDeviceLabel}` : ''}
                              </span>
                            </p>
                          )}
                        </div>

                        {transfer.active ? (
                          transfer.overall.show ? (
                            <div className="pt-2 border-t border-crt-border space-y-1.5 text-[11px] font-mono tabular-nums">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-crt-muted truncate">
                                  Overall · {transfer.overall.completedFiles}/{transfer.overall.totalFiles} files
                                </span>
                                <span className="text-crt-phosphor font-semibold shrink-0">
                                  {transfer.overall.percent}%
                                </span>
                              </div>
                              <div
                                role="progressbar"
                                aria-label={`Overall catalog item progress for ${item.title}`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={transfer.overall.percent}
                                className="h-1.5 w-full bg-crt-surface border border-crt-border rounded-sm overflow-hidden"
                              >
                                <div
                                  className="h-full bg-crt-phosphor/80 crt-progress-beam transition-all duration-200"
                                  style={{ width: `${transfer.overall.percent}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="pt-2 border-t border-crt-border flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                              <span className="text-crt-text truncate">
                                {transfer.totalBytes
                                  ? formatBytes(transfer.totalBytes)
                                  : item.fileSizeBytes > 0
                                    ? formatBytes(item.fileSizeBytes)
                                    : transfer.bytesReceived > 0
                                      ? formatBytes(transfer.bytesReceived)
                                      : 'Pending'}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 shrink-0 ${
                                  transfer.mode === 'preparing' ? 'text-crt-amber' : 'text-crt-phosphor'
                                }`}
                              >
                                <Download className="h-3 w-3 shrink-0" />
                                <span>
                                  {transfer.percent !== null
                                    ? `${transfer.percent}%`
                                    : transfer.mode === 'preparing'
                                      ? 'preparing'
                                      : 'downloading'}
                                </span>
                              </span>
                            </div>
                          )
                        ) : (
                          <div className="pt-2 border-t border-crt-border flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                            <span className="text-crt-text truncate">
                              {item.sizeIsEstimated && item.fileSizeBytes > 0 ? '~' : ''}
                              {formatBytes(item.fileSizeBytes)} · {item.filesCount}f
                            </span>
                            {item.status === 'available' && onQueueDownload ? (
                              <button
                                type="button"
                                disabled={queueingIds.has(item.id) || !status.auth.hasCompletedLogin}
                                title={
                                  !status.auth.hasCompletedLogin
                                    ? 'Verify login in System Settings before downloading'
                                    : 'Queue this release for download'
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleQueueIds([item.id]);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <Download className="h-3 w-3" />
                                {queueingIds.has(item.id) ? 'Queueing' : 'Download'}
                              </button>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 shrink-0 ${
                                  item.status === 'downloaded'
                                    ? 'text-crt-phosphor'
                                    : item.status === 'available'
                                      ? 'text-crt-phosphor/80'
                                      : item.status === 'skipped'
                                        ? 'text-crt-muted'
                                        : item.status === 'failed'
                                          ? 'text-crt-crimson'
                                          : 'text-crt-amber'
                                }`}
                              >
                                {item.status === 'downloaded' && <CheckCircle2 className="h-3 w-3" />}
                                {item.status === 'available' && <Cloud className="h-3 w-3" />}
                                {item.status === 'skipped' && <SkipForward className="h-3 w-3" />}
                                {item.status === 'failed' && <XCircle className="h-3 w-3" />}
                                {item.status === 'partial' && <AlertCircle className="h-3 w-3" />}
                                {item.status}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : viewMode === 'stats' ? (
        <CatalogStatsPanel
          status={status}
          catalogRevision={catalogRevision}
          onStartCatalogIndex={onStartCatalogIndex}
          onInspectSystem={(slug) => {
            setSystems([slug]);
            setViewMode('catalog');
          }}
        />
      ) : (
        <div className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md overflow-hidden">
          <div aria-hidden="true" className="crt-edge-beam">
            <span />
          </div>
          {/* Breadcrumbs + Select All Header */}
          {(() => {
            const archiveDirView =
              fsArchivePath && fsArchiveListing
                ? listArchiveDirectoryAtPath(fsArchiveListing.entries, fsArchiveSubpath)
                : null;
            const archiveLeafName = fsArchivePath
              ? fsArchivePath.split('/').filter(Boolean).pop() || fsArchivePath
              : null;

            return (
              <>
                <div className="px-4 py-2.5 border-b border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex flex-wrap items-center gap-2">
                    {!fsArchivePath && filteredFsNodes.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allFsSelected}
                        onChange={toggleAllFs}
                        aria-label="Select all visible filesystem entries"
                        className="accent-crt-phosphor cursor-pointer mr-1"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (fsArchivePath) {
                          exitFsArchive('');
                        } else {
                          setFsPath('');
                        }
                      }}
                      className="text-crt-phosphor hover:underline cursor-pointer"
                    >
                      repository
                    </button>
                    {breadcrumbs.map((seg, i) => {
                      const target = breadcrumbs.slice(0, i + 1).join('/');
                      return (
                        <span key={target} className="inline-flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 text-crt-muted" />
                          <button
                            type="button"
                            onClick={() => {
                              if (fsArchivePath) {
                                exitFsArchive(target);
                              } else {
                                setFsPath(target);
                              }
                            }}
                            className="text-crt-text hover:text-crt-phosphor hover:underline cursor-pointer"
                          >
                            {seg}
                          </button>
                        </span>
                      );
                    })}
                    {fsArchivePath && archiveLeafName && (
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-crt-muted" />
                        <button
                          type="button"
                          onClick={() => setFsArchiveSubpath('')}
                          className="inline-flex items-center gap-1.5 text-crt-phosphor hover:underline cursor-pointer"
                          title="Jump to archive root"
                        >
                          <FileArchive className="h-3.5 w-3.5 shrink-0" />
                          <span>{archiveLeafName}</span>
                        </button>
                      </span>
                    )}
                    {archiveDirView?.breadcrumbs.map((crumb) => (
                      <span key={crumb.path} className="inline-flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-crt-muted" />
                        <button
                          type="button"
                          onClick={() => setFsArchiveSubpath(crumb.path)}
                          className="text-crt-text hover:text-crt-phosphor hover:underline cursor-pointer"
                        >
                          {crumb.label}
                        </button>
                      </span>
                    ))}
                  </div>
                  <span className="text-crt-muted tabular-nums">
                    {fsArchivePath
                      ? archiveDirView
                        ? `${archiveDirView.folders.length + archiveDirView.files.length} in folder`
                        : 'inspecting...'
                      : `${filteredFsNodes.length} visible`}
                  </span>
                </div>

                {fsArchivePath ? (
                  fsArchiveLoading ? (
                    <div className="p-6 space-y-2">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-9 bg-crt-bg border border-crt-border rounded animate-pulse"
                        />
                      ))}
                    </div>
                  ) : fsArchiveError ? (
                    <div className="p-8 text-center space-y-3 text-xs font-mono">
                      <AlertCircle className="h-6 w-6 text-crt-crimson mx-auto" />
                      <p className="text-crt-crimson">{fsArchiveError}</p>
                      <button
                        type="button"
                        onClick={() => exitFsArchive()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border text-crt-text hover:border-crt-phosphor rounded transition-colors cursor-pointer"
                      >
                        Back to Disk Folder
                      </button>
                    </div>
                  ) : fsArchiveListing ? (
                    <ArchiveExplorer
                      mode="inline"
                      listing={fsArchiveListing}
                      subpath={fsArchiveSubpath}
                      onSubpathChange={setFsArchiveSubpath}
                      externalSearch={fsSearch}
                      onClearExternalSearch={() => setFsSearch('')}
                      buildEntryDownloadUrl={(entryPath) =>
                        `/api/fs/archive/entry?path=${encodeURIComponent(
                          fsArchivePath,
                        )}&entry=${encodeURIComponent(entryPath)}`
                      }
                      buildEntryPreviewUrl={(entryPath) =>
                        `/api/fs/archive/preview?path=${encodeURIComponent(
                          fsArchivePath,
                        )}&entry=${encodeURIComponent(entryPath)}`
                      }
                      onExitArchive={() => exitFsArchive()}
                    />
                  ) : null
                ) : fsLoading ? (
                  <div className="p-6 space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-9 bg-crt-bg border border-crt-border rounded animate-pulse" />
                    ))}
                  </div>
                ) : filteredFsNodes.length === 0 ? (
                  <div className="p-12 text-center space-y-3">
                    <Folder className="h-6 w-6 text-crt-muted mx-auto" />
                    <p className="text-sm font-medium text-crt-text">
                      {fsNodes.length === 0 ? 'Directory is empty' : 'No files or folders match your filter'}
                    </p>
                    <p className="text-xs text-crt-muted">
                      {fsNodes.length === 0
                        ? 'Downloaded ROMs, hacks, translations, and ports will appear here mirroring the exact remote hierarchy.'
                        : 'Clear the folder filter input to view all entries in this directory.'}
                    </p>
                    {fsNodes.length > 0 && fsSearch && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setFsSearch('')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                          Clear Folder Filter
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-crt-border">
                    {filteredFsNodes.map((node) => {
                      const checked = selectedFsPaths.has(node.relativePath);
                      const isDeletingThis = deletingKey === `fs-${node.relativePath}`;
                      const browsableArchive =
                        node.type === 'file' &&
                        (Boolean(node.isArchive) || isBrowsableArchiveName(node.name));
                      const formatLabel =
                        node.archiveFormat && node.archiveFormat !== 'raw'
                          ? node.archiveFormat.toUpperCase()
                          : null;

                      return (
                        <div
                          key={node.relativePath}
                          className={`crt-table-row h-10 px-4 flex items-center justify-between gap-4 transition-colors text-xs font-mono ${
                            checked ? 'bg-crt-phosphor/5' : 'hover:bg-crt-elevated'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFsNode(node.relativePath)}
                              aria-label={`Select ${node.name}`}
                              className="accent-crt-phosphor cursor-pointer shrink-0"
                            />
                            {node.type === 'directory' ? (
                              <button
                                type="button"
                                onClick={() => setFsPath(node.relativePath)}
                                className="flex items-center gap-2.5 text-crt-text hover:text-crt-phosphor text-left min-w-0 cursor-pointer"
                              >
                                <Folder className="h-4 w-4 text-crt-amber shrink-0" />
                                <span className="truncate">{node.name}/</span>
                              </button>
                            ) : browsableArchive ? (
                              <button
                                type="button"
                                onClick={() => void openFsArchive(node.relativePath)}
                                title={`Browse contents of ${node.name} without unpacking to disk`}
                                className="flex items-center gap-2.5 text-crt-text hover:text-crt-phosphor text-left min-w-0 cursor-pointer group"
                              >
                                <FileArchive className="h-4 w-4 text-crt-phosphor shrink-0" />
                                <span className="truncate group-hover:underline">{node.name}</span>
                                {formatLabel && (
                                  <span className="px-1.5 py-0.5 text-[10px] leading-none border border-crt-phosphor/40 bg-crt-phosphor/10 text-crt-phosphor rounded shrink-0">
                                    {formatLabel}
                                  </span>
                                )}
                              </button>
                            ) : (
                              <div className="flex items-center gap-2.5 text-crt-text min-w-0">
                                <FileArchive className="h-4 w-4 text-crt-muted shrink-0" />
                                <span className="truncate">{node.name}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-3 sm:gap-5 text-crt-muted tabular-nums shrink-0">
                            <span>
                              {node.type === 'directory'
                                ? `${node.childrenCount ?? 0} entries`
                                : formatBytes(node.sizeBytes)}
                            </span>
                            <span className="hidden sm:inline">{formatDateTime(node.modifiedAt)}</span>
                            <div className="flex items-center gap-1.5">
                              {browsableArchive && (
                                <button
                                  type="button"
                                  onClick={() => void openFsArchive(node.relativePath)}
                                  title={`Inspect contents of ${node.name} without unpacking`}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-crt-border hover:border-crt-phosphor text-crt-text hover:text-crt-phosphor rounded transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  <FolderOpen className="h-3 w-3 shrink-0" />
                                  <span className="hidden sm:inline">Inspect</span>
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isDeletingThis}
                                onClick={() => void handleDeleteFsPaths([node.relativePath])}
                                aria-label={`Delete ${node.name}`}
                                title={
                                  node.type === 'directory'
                                    ? 'Delete directory and all contents'
                                    : 'Delete file'
                                }
                                className="p-1.5 border border-crt-border hover:border-crt-crimson text-crt-muted hover:text-crt-crimson rounded transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Slide-Over Game Detail Drawer */}
      <GameDetailDrawer
        item={activeDetailItem}
        activeRun={Boolean(status.activeRun)}
        activeTransfer={status.activeTransfer}
        canSync={Boolean(status.auth.hasCompletedLogin)}
        retryingItem={effectiveRetryingId === activeDetailItem?.id}
        navigation={detailNavigation}
        onClose={closeDetailDrawer}
        onItemUpdated={handleItemUpdated}
        onRetryItem={handleRetry}
        onQueueDownload={onQueueDownload ? (ids) => handleQueueIds(ids) : undefined}
        onExportToSdCard={(id) =>
          void installer.openReviewQueue([id], currentSmartFilterContext, knownItemMetaMap)
        }
        onDeleteItem={async (id) => {
          await handleDeleteCatalogItems([id]);
        }}
      />

      {installer.mountError && !installer.modalOpen && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md border border-crt-amber/60 bg-crt-surface px-4 py-3 rounded text-xs font-mono text-crt-amber shadow-lg flex items-center justify-between gap-3">
          <span>{installer.mountError}</span>
          <button
            type="button"
            onClick={installer.clearMountError}
            className="text-crt-muted hover:text-crt-text shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
