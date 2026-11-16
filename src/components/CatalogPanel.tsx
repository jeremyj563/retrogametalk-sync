import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  FileArchive,
  Folder,
  Gamepad2,
  LayoutGrid,
  List,
  RefreshCw,
  RotateCcw,
  Search,
  SkipForward,
  Trash2,
  Usb,
  X,
  XCircle,
} from 'lucide-react';
import {
  CATALOG_SORT_OPTIONS,
  DEFAULT_CATALOG_SORT,
  normalizeCatalogSort,
} from '../shared/catalogSort';
import type {
  CatalogFacets,
  CatalogSortOption,
  FilterMatchMode,
  FsTreeNode,
  RepositoryItemRecord,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
} from '../types';
import { formatBytes, formatDateTime } from '../utils/format';
import { isFileSystemAccessSupported, pickSdCardRootDirectory, type SdDirectoryHandle } from '../utils/sdCardFs';
import { GameDetailDrawer } from './GameDetailDrawer';
import { MultiSelectFilterDropdown, type FilterDropdownOption } from './MultiSelectFilterDropdown';
import { SdCardExportModal } from './SdCardExportModal';

interface CatalogPanelProps {
  config: ScraperConfigPublic;
  status: ServiceStatusSnapshot;
  catalogRevision?: number;
  activeRetryItemId?: number | null;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
  onRetryItem: (itemId: number, fileId?: number) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

const CATALOG_VIEW_STORAGE_KEY = 'rgt_sync_catalog_view_v1';
const VALID_STATUS_VALUES = new Set(['downloaded', 'partial', 'failed', 'needs_retry', 'queued', 'downloading']);
const VALID_VIEW_MODES = new Set(['catalog', 'filesystem']);

const STATUS_LABELS: Record<string, string> = {
  downloaded: 'Downloaded',
  needs_retry: 'Needs Attention',
  partial: 'Partial',
  failed: 'Failed',
  queued: 'Queued',
  downloading: 'Downloading',
};

interface CatalogViewPrefs {
  viewMode: 'catalog' | 'filesystem';
  catalogLayout: 'table' | 'grid';
  sort: CatalogSortOption;
  search: string;
  systems: string[];
  statuses: string[];
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
    if (!VALID_STATUS_VALUES.has(mapped) || seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

function sanitizeStoredMatchMode(raw: unknown): FilterMatchMode {
  return raw === 'all' ? 'all' : 'any';
}

function loadInitialCatalogViewPrefs(): CatalogViewPrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CATALOG_VIEW_PREFS };
    }
    const raw = window.localStorage.getItem(CATALOG_VIEW_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CATALOG_VIEW_PREFS };
    const parsed = JSON.parse(raw) as LegacyCatalogViewPrefs;
    return {
      viewMode:
        typeof parsed.viewMode === 'string' && VALID_VIEW_MODES.has(parsed.viewMode)
          ? (parsed.viewMode as CatalogViewPrefs['viewMode'])
          : 'catalog',
      catalogLayout: parsed.catalogLayout === 'grid' ? 'grid' : 'table',
      sort: normalizeCatalogSort(parsed.sort),
      search: typeof parsed.search === 'string' ? parsed.search : '',
      systems: sanitizeStoredList(parsed.systems, parsed.systemFilter),
      statuses: sanitizeStoredStatuses(parsed.statuses, parsed.statusFilter),
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
  catalogRevision = 0,
  activeRetryItemId = null,
  onSaveConfig,
  onRetryItem,
  onRefreshStatus,
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

  const [viewMode, setViewMode] = useState<'catalog' | 'filesystem'>(initialViewMode);
  const [catalogLayout, setCatalogLayout] = useState<'table' | 'grid'>(() => memoryCatalogViewPrefs.catalogLayout);
  const [sort, setSort] = useState<CatalogSortOption>(() => memoryCatalogViewPrefs.sort);
  const [search, setSearch] = useState(() => memoryCatalogViewPrefs.search);
  const [systems, setSystems] = useState<string[]>(() => memoryCatalogViewPrefs.systems);
  const [statuses, setStatuses] = useState<string[]>(() => memoryCatalogViewPrefs.statuses);
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
  const [items, setItems] = useState<RepositoryItemRecord[]>(() => initialMatchedCatalog?.items ?? []);
  const [facets, setFacets] = useState<CatalogFacets>(() => memoryCatalogFacets);
  const [totalItems, setTotalItems] = useState(() => initialMatchedCatalog?.totalItems ?? 0);
  const [loading, setLoading] = useState(() => !initialMatchedCatalog);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [failedCovers, setFailedCovers] = useState<Set<number>>(new Set());
  const [activeDetailItem, setActiveDetailItem] = useState<RepositoryItemRecord | null>(null);

  const effectiveRetryingId =
    retryingId ??
    (status.activeRun?.triggerType === 'retry'
      ? (activeRetryItemId ?? status.activeTransfer?.itemId ?? null)
      : null);

  // Selection state for Indexed Catalog
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<number>>(new Set());
  const [confirmCatalogBulk, setConfirmCatalogBulk] = useState(false);

  // SD Card Export state
  const [sdRootHandle, setSdRootHandle] = useState<SdDirectoryHandle | null>(null);
  const [sdExportIds, setSdExportIds] = useState<number[] | null>(null);
  const [sdMountNotice, setSdMountNotice] = useState<string | null>(null);

  // Local Disk Tree state + search filter + selection
  const [fsPath, setFsPath] = useState(() => memoryCatalogViewPrefs.fsPath);
  const [fsSearch, setFsSearch] = useState(() => memoryCatalogViewPrefs.fsSearch);
  const [fsNodes, setFsNodes] = useState<FsTreeNode[]>(() => initialMatchedFs?.nodes ?? []);
  const [fsLoading, setFsLoading] = useState(false);
  const [selectedFsPaths, setSelectedFsPaths] = useState<Set<string>>(new Set());
  const [confirmFsBulk, setConfirmFsBulk] = useState(false);

  const handleQuickMountSdCard = async () => {
    setSdMountNotice(null);
    const support = isFileSystemAccessSupported();
    if (!support.supported) {
      setSdMountNotice(support.reason || 'Folder picker not supported in this browser.');
      return;
    }
    try {
      const handle = await pickSdCardRootDirectory();
      setSdRootHandle(handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setSdMountNotice(
        /cross origin|sub frame|user activation/i.test(msg)
          ? 'Open the app directly in its own browser tab to mount an SD card folder.'
          : msg,
      );
    }
  };

  useEffect(() => {
    const nextPrefs: CatalogViewPrefs = {
      viewMode,
      catalogLayout,
      sort,
      search,
      systems,
      statuses,
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

  const loadCatalog = useCallback(
    async (silent = false) => {
      const reqId = ++catalogReqSeqRef.current;
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({
          search,
          sort,
          limit: '150',
          offset: '0',
        });
        for (const sys of systems) qs.append('system', sys);
        for (const st of statuses) qs.append('status', st);
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
          // Clear any cover-load error entry if an item now reports a mirrored cover
          setFailedCovers((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set(prev);
            for (const item of nextItems) {
              if (item.coverLocalPath) next.delete(item.id);
            }
            return next;
          });
        }

        // Keep selection scoped strictly to visible/filtered items
        const visibleIds = new Set(nextItems.map((i) => i.id));
        setSelectedCatalogIds((prev) => {
          if (prev.size === 0) return prev;
          const pruned = new Set<number>();
          prev.forEach((id) => {
            if (visibleIds.has(id)) pruned.add(id);
          });
          return pruned;
        });

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
        }
      }
    },
    [
      viewMode,
      sort,
      search,
      systems,
      statuses,
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

  const openDetailItem = async (item: RepositoryItemRecord) => {
    setActiveDetailItem(item);
    try {
      const res = await fetch(`/api/items/${item.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.item) {
          const fresh = data.item as RepositoryItemRecord;
          setActiveDetailItem((current) => (current?.id === fresh.id ? fresh : current));
          setItems((prev) => prev.map((row) => (row.id === fresh.id ? fresh : row)));
        }
      }
    } catch {
      // Keep optimistic cached item open on transient error
    }
  };

  const handleItemUpdated = (updated: RepositoryItemRecord) => {
    setActiveDetailItem(updated);
    setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    setFailedCovers((prev) => {
      if (!prev.has(updated.id)) return prev;
      const next = new Set(prev);
      next.delete(updated.id);
      return next;
    });
    void loadCatalog();
  };

  const handleRetry = async (id: number, fileId?: number) => {
    setRetryingId(id);
    try {
      await onRetryItem(id, fileId);
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
          setActiveDetailItem(null);
        }
        await Promise.all([loadCatalog(), onRefreshStatus()]);
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

  const statusOptions = useMemo<FilterDropdownOption[]>(() => {
    const counts = facets.counts?.statuses;
    const base: FilterDropdownOption[] = [
      {
        value: 'downloaded',
        label: 'Downloaded',
        count: counts?.downloaded ?? status.totals.downloadedItems + status.totals.skippedItems,
      },
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
  }, [facets.counts, status.totals, statuses]);

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

    for (const val of statuses) {
      tokens.push({
        key: `status:${val}`,
        groupLabel: 'Status',
        valueLabel: STATUS_LABELS[val] || val,
        matchAll: false,
        onRemove: () => setStatuses((prev) => prev.filter((v) => v !== val)),
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
    statuses,
  ]);

  const activeFilterCount = activeFilterTokens.length;
  const hasActiveFilters = activeFilterCount > 0;

  const clearCatalogFilters = () => {
    setSearch('');
    setSystems([]);
    setStatuses([]);
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
      <div className="border border-crt-border bg-crt-surface rounded-md p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-crt-bg border border-crt-border rounded-md self-start">
              <button
                type="button"
                onClick={() => setViewMode('catalog')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'catalog'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Indexed Catalog ({viewMode === 'catalog' ? totalItems : status.totals.totalCatalogItems})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('filesystem')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
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
                  onClick={() => setCatalogLayout('table')}
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
                  onClick={() => setCatalogLayout('grid')}
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
            <div className="flex items-center gap-2 self-start lg:self-auto">
              <button
                type="button"
                onClick={() => void handleQuickMountSdCard()}
                title={
                  sdRootHandle
                    ? `Mounted SD card folder: ${sdRootHandle.name} (click to switch)`
                    : 'Mount a flash cart, ODE, or handheld SD card root folder'
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition-colors whitespace-nowrap shrink-0 ${
                  sdRootHandle
                    ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/15'
                    : 'border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-text'
                }`}
              >
                <Usb className="h-3.5 w-3.5" />
                {sdRootHandle ? `SD: ${sdRootHandle.name}` : 'Mount SD Card'}
              </button>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={fsSearch}
                  onChange={(e) => setFsSearch(e.target.value)}
                  placeholder="Filter current folder..."
                  className={`pl-8 ${fsSearch ? 'pr-7' : 'pr-3'} py-1.5 text-xs bg-crt-bg border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-56 ${
                    fsSearch.trim() ? 'border-crt-phosphor/60' : 'border-crt-border'
                  }`}
                />
                {fsSearch && (
                  <button
                    type="button"
                    onClick={() => setFsSearch('')}
                    aria-label="Clear folder filter"
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
                onClick={() => void loadFsTree(fsPath)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Rescan
              </button>
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
                onChange={setStatuses}
                open={openFilterId === 'statuses'}
                onOpenChange={(open) => setOpenFilterId(open ? 'statuses' : null)}
                showTotalOptionCount={false}
                searchPlaceholder="Filter statuses..."
              />

              <select
                value={sort}
                onChange={(e) => setSort(normalizeCatalogSort(e.target.value))}
                aria-label="Sort catalog releases"
                className={`xl:ml-auto px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
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
          </div>
        )}

        {/* Contextual Bulk Selection Bar (Indexed Catalog) */}
        {viewMode === 'catalog' && selectedCatalogIds.size > 0 && (
          <div className="pt-3 border-t border-crt-border flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <span className="text-crt-phosphor tabular-nums">
              {selectedCatalogIds.size} item{selectedCatalogIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {!confirmCatalogBulk && (
                <button
                  type="button"
                  onClick={() => setSdExportIds(Array.from(selectedCatalogIds))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-crt-phosphor/70 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap shrink-0"
                >
                  <Usb className="h-3.5 w-3.5" />
                  Send to SD Card ({selectedCatalogIds.size})
                </button>
              )}
              {confirmCatalogBulk ? (
                <>
                  <button
                    type="button"
                    disabled={deletingKey === 'catalog-bulk'}
                    onClick={() => void handleDeleteCatalogItems(Array.from(selectedCatalogIds))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-crt-bg bg-crt-crimson hover:brightness-110 rounded transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingKey === 'catalog-bulk' ? 'Deleting...' : `Confirm Delete (${selectedCatalogIds.size})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCatalogBulk(false)}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmCatalogBulk(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-crimson/60 text-crt-crimson hover:bg-crt-crimson/10 rounded transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Selected ({selectedCatalogIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCatalogIds(new Set())}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Contextual Bulk Selection Bar (Local Disk Tree) */}
        {viewMode === 'filesystem' && selectedFsPaths.size > 0 && (
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
        <div className="border border-crt-border bg-crt-surface rounded-md overflow-hidden">
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
                  {items.map((item) => {
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

                    return (
                      <tr
                        key={item.id}
                        onClick={() => void openDetailItem(item)}
                        className={`cursor-pointer transition-colors ${
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
                            {showCoverThumb ? (
                              <img
                                src={`/api/items/${item.id}/asset?kind=cover${assetVersion}`}
                                alt={`${item.title} cover`}
                                loading="lazy"
                                onError={() =>
                                  setFailedCovers((prev) => {
                                    const next = new Set(prev);
                                    next.add(item.id);
                                    return next;
                                  })
                                }
                                className="w-8 h-10 object-cover rounded border border-crt-border bg-crt-bg shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-10 rounded border border-crt-border bg-crt-bg flex items-center justify-center shrink-0">
                                <Gamepad2 className="h-3.5 w-3.5 text-crt-border-strong" />
                              </div>
                            )}
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
                          {formatBytes(item.fileSizeBytes)}
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 ${
                              item.status === 'downloaded'
                                ? 'text-crt-phosphor'
                                : item.status === 'skipped'
                                  ? 'text-crt-muted'
                                  : item.status === 'failed'
                                    ? 'text-crt-crimson'
                                    : 'text-crt-amber'
                            }`}
                          >
                            {item.status === 'downloaded' && <CheckCircle2 className="h-3.5 w-3.5" />}
                            {item.status === 'skipped' && <SkipForward className="h-3.5 w-3.5" />}
                            {item.status === 'failed' && <XCircle className="h-3.5 w-3.5" />}
                            {item.status === 'partial' && <AlertCircle className="h-3.5 w-3.5" />}
                            {item.status}
                          </span>
                        </td>
                        <td
                          className="px-4 py-2 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center justify-end gap-2">
                            {item.status === 'failed' || item.status === 'partial' ? (
                              <button
                                type="button"
                                disabled={effectiveRetryingId === item.id || Boolean(status.activeRun) || !status.auth.hasCompletedLogin}
                                title={!status.auth.hasCompletedLogin ? 'Verify login in Operations before retrying' : undefined}
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
              <div className="px-4 py-2.5 border-b border-crt-border bg-crt-bg flex items-center justify-between text-xs font-mono text-crt-muted">
                <label className="inline-flex items-center gap-2 cursor-pointer text-crt-text">
                  <input
                    type="checkbox"
                    checked={allCatalogSelected}
                    onChange={toggleAllCatalog}
                    aria-label="Select all filtered catalog items"
                    className="accent-crt-phosphor cursor-pointer"
                  />
                  <span>Select all visible ({items.length})</span>
                </label>
                <span>Click any release to inspect artwork, specs &amp; ROMs</span>
              </div>

              {/* Box-Art Grid */}
              <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {items.map((item) => {
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

                  return (
                    <div
                      key={item.id}
                      onClick={() => void openDetailItem(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void openDetailItem(item);
                        }
                      }}
                      className={`group relative border rounded-md overflow-hidden bg-crt-bg cursor-pointer transition-colors flex flex-col text-left focus:outline-none focus:border-crt-phosphor ${
                        checked
                          ? 'border-crt-phosphor bg-crt-phosphor/5'
                          : 'border-crt-border hover:border-crt-border-strong'
                      }`}
                    >
                      {/* Cover Art Container */}
                      <div className="relative aspect-[3/4] bg-crt-surface border-b border-crt-border overflow-hidden">
                        {showCover ? (
                          <img
                            src={`/api/items/${item.id}/asset?kind=cover${assetVersion}`}
                            alt={`${item.title} cover art`}
                            loading="lazy"
                            onError={() =>
                              setFailedCovers((prev) => {
                                const next = new Set(prev);
                                next.add(item.id);
                                return next;
                              })
                            }
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center space-y-2">
                            <Gamepad2 className="h-8 w-8 text-crt-border-strong" />
                            <span className="font-mono text-[11px] text-crt-muted">{item.systemName}</span>
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
                        </div>

                        <div className="pt-2 border-t border-crt-border flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                          <span className="text-crt-text truncate">
                            {formatBytes(item.fileSizeBytes)} · {item.filesCount}f
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 shrink-0 ${
                              item.status === 'downloaded'
                                ? 'text-crt-phosphor'
                                : item.status === 'skipped'
                                  ? 'text-crt-muted'
                                  : item.status === 'failed'
                                    ? 'text-crt-crimson'
                                    : 'text-crt-amber'
                            }`}
                          >
                            {item.status === 'downloaded' && <CheckCircle2 className="h-3 w-3" />}
                            {item.status === 'skipped' && <SkipForward className="h-3 w-3" />}
                            {item.status === 'failed' && <XCircle className="h-3 w-3" />}
                            {item.status === 'partial' && <AlertCircle className="h-3 w-3" />}
                            {item.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="border border-crt-border bg-crt-surface rounded-md overflow-hidden">
          {/* Breadcrumbs + Select All Header */}
          <div className="px-4 py-2.5 border-b border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex flex-wrap items-center gap-2">
              {filteredFsNodes.length > 0 && (
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
                onClick={() => setFsPath('')}
                className="text-crt-phosphor hover:underline"
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
                      onClick={() => setFsPath(target)}
                      className="text-crt-text hover:text-crt-phosphor hover:underline"
                    >
                      {seg}
                    </button>
                  </span>
                );
              })}
            </div>
            <span className="text-crt-muted tabular-nums">
              {filteredFsNodes.length} visible
            </span>
          </div>

          {fsLoading ? (
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
                return (
                  <div
                    key={node.relativePath}
                    className={`h-10 px-4 flex items-center justify-between gap-4 transition-colors text-xs font-mono ${
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
                          className="flex items-center gap-2.5 text-crt-text hover:text-crt-phosphor text-left min-w-0"
                        >
                          <Folder className="h-4 w-4 text-crt-amber shrink-0" />
                          <span className="truncate">{node.name}/</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2.5 text-crt-text min-w-0">
                          <FileArchive className="h-4 w-4 text-crt-phosphor shrink-0" />
                          <span className="truncate">{node.name}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-5 text-crt-muted tabular-nums shrink-0">
                      <span>
                        {node.type === 'directory'
                          ? `${node.childrenCount ?? 0} entries`
                          : formatBytes(node.sizeBytes)}
                      </span>
                      <span className="hidden sm:inline">{formatDateTime(node.modifiedAt)}</span>
                      <button
                        type="button"
                        disabled={isDeletingThis}
                        onClick={() => void handleDeleteFsPaths([node.relativePath])}
                        aria-label={`Delete ${node.name}`}
                        title={node.type === 'directory' ? 'Delete directory and all contents' : 'Delete file'}
                        className="p-1.5 border border-crt-border hover:border-crt-crimson text-crt-muted hover:text-crt-crimson rounded transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Slide-Over Game Detail Drawer */}
      <GameDetailDrawer
        item={activeDetailItem}
        activeRun={Boolean(status.activeRun)}
        canSync={Boolean(status.auth.hasCompletedLogin)}
        retryingItem={effectiveRetryingId === activeDetailItem?.id}
        onClose={() => setActiveDetailItem(null)}
        onItemUpdated={handleItemUpdated}
        onRetryItem={handleRetry}
        onExportToSdCard={(id) => setSdExportIds([id])}
        onDeleteItem={async (id) => {
          await handleDeleteCatalogItems([id]);
        }}
      />

      {/* SD Card Batch / Single Export Modal */}
      <SdCardExportModal
        open={Boolean(sdExportIds && sdExportIds.length > 0)}
        itemIds={sdExportIds || []}
        config={config}
        sdRootHandle={sdRootHandle}
        onMountSdHandle={(handle) => setSdRootHandle(handle)}
        onSaveConfig={onSaveConfig}
        onClose={() => setSdExportIds(null)}
      />

      {sdMountNotice && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md border border-crt-amber/60 bg-crt-surface px-4 py-3 rounded text-xs font-mono text-crt-amber shadow-lg flex items-center justify-between gap-3">
          <span>{sdMountNotice}</span>
          <button
            type="button"
            onClick={() => setSdMountNotice(null)}
            className="text-crt-muted hover:text-crt-text shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
