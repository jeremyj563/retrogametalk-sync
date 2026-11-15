import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
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
  X,
  XCircle,
} from 'lucide-react';
import type { CatalogFacets, FsTreeNode, RepositoryItemRecord, ServiceStatusSnapshot } from '../types';
import { formatBytes, formatDateTime } from '../utils/format';
import { GameDetailDrawer } from './GameDetailDrawer';

interface CatalogPanelProps {
  status: ServiceStatusSnapshot;
  catalogRevision?: number;
  onRetryItem: (itemId: number, fileId?: number) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

const CATALOG_VIEW_STORAGE_KEY = 'rgt_sync_catalog_view_v1';
const VALID_STATUS_FILTERS = new Set(['all', 'downloaded', 'skipped', 'partial', 'failed']);

interface CatalogViewPrefs {
  viewMode: 'catalog' | 'filesystem';
  catalogLayout: 'table' | 'grid';
  search: string;
  systemFilter: string;
  statusFilter: string;
  tagFilter: string;
  genreFilter: string;
  regionFilter: string;
  languageFilter: string;
  fsPath: string;
  fsSearch: string;
}

const DEFAULT_CATALOG_VIEW_PREFS: CatalogViewPrefs = {
  viewMode: 'catalog',
  catalogLayout: 'table',
  search: '',
  systemFilter: 'all',
  statusFilter: 'all',
  tagFilter: 'all',
  genreFilter: 'all',
  regionFilter: 'all',
  languageFilter: 'all',
  fsPath: '',
  fsSearch: '',
};

function loadInitialCatalogViewPrefs(): CatalogViewPrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CATALOG_VIEW_PREFS };
    }
    const raw = window.localStorage.getItem(CATALOG_VIEW_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CATALOG_VIEW_PREFS };
    const parsed = JSON.parse(raw) as Partial<CatalogViewPrefs>;
    return {
      viewMode: parsed.viewMode === 'filesystem' ? 'filesystem' : 'catalog',
      catalogLayout: parsed.catalogLayout === 'grid' ? 'grid' : 'table',
      search: typeof parsed.search === 'string' ? parsed.search : '',
      systemFilter: typeof parsed.systemFilter === 'string' && parsed.systemFilter ? parsed.systemFilter : 'all',
      statusFilter:
        typeof parsed.statusFilter === 'string' && VALID_STATUS_FILTERS.has(parsed.statusFilter)
          ? parsed.statusFilter
          : 'all',
      tagFilter: typeof parsed.tagFilter === 'string' && parsed.tagFilter ? parsed.tagFilter : 'all',
      genreFilter: typeof parsed.genreFilter === 'string' && parsed.genreFilter ? parsed.genreFilter : 'all',
      regionFilter: typeof parsed.regionFilter === 'string' && parsed.regionFilter ? parsed.regionFilter : 'all',
      languageFilter:
        typeof parsed.languageFilter === 'string' && parsed.languageFilter ? parsed.languageFilter : 'all',
      fsPath: typeof parsed.fsPath === 'string' ? parsed.fsPath : '',
      fsSearch: typeof parsed.fsSearch === 'string' ? parsed.fsSearch : '',
    };
  } catch {
    return { ...DEFAULT_CATALOG_VIEW_PREFS };
  }
}

function buildCatalogQueryKey(prefs: Pick<
  CatalogViewPrefs,
  'search' | 'systemFilter' | 'statusFilter' | 'tagFilter' | 'genreFilter' | 'regionFilter' | 'languageFilter'
>): string {
  return JSON.stringify([
    prefs.search,
    prefs.systemFilter,
    prefs.statusFilter,
    prefs.tagFilter,
    prefs.genreFilter,
    prefs.regionFilter,
    prefs.languageFilter,
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

export function CatalogPanel({ status, catalogRevision = 0, onRetryItem, onRefreshStatus }: CatalogPanelProps) {
  const initialMatchedCatalog =
    memoryCatalogSnapshot?.queryKey === buildCatalogQueryKey(memoryCatalogViewPrefs)
      ? memoryCatalogSnapshot
      : null;
  const initialMatchedFs =
    memoryFsSnapshot?.fsPath === memoryCatalogViewPrefs.fsPath ? memoryFsSnapshot : null;

  const [viewMode, setViewMode] = useState<'catalog' | 'filesystem'>(() => memoryCatalogViewPrefs.viewMode);
  const [catalogLayout, setCatalogLayout] = useState<'table' | 'grid'>(() => memoryCatalogViewPrefs.catalogLayout);
  const [search, setSearch] = useState(() => memoryCatalogViewPrefs.search);
  const [systemFilter, setSystemFilter] = useState(() => memoryCatalogViewPrefs.systemFilter);
  const [statusFilter, setStatusFilter] = useState(() => memoryCatalogViewPrefs.statusFilter);
  const [tagFilter, setTagFilter] = useState(() => memoryCatalogViewPrefs.tagFilter);
  const [genreFilter, setGenreFilter] = useState(() => memoryCatalogViewPrefs.genreFilter);
  const [regionFilter, setRegionFilter] = useState(() => memoryCatalogViewPrefs.regionFilter);
  const [languageFilter, setLanguageFilter] = useState(() => memoryCatalogViewPrefs.languageFilter);
  const [items, setItems] = useState<RepositoryItemRecord[]>(() => initialMatchedCatalog?.items ?? []);
  const [facets, setFacets] = useState<CatalogFacets>(() => memoryCatalogFacets);
  const [totalItems, setTotalItems] = useState(() => initialMatchedCatalog?.totalItems ?? 0);
  const [loading, setLoading] = useState(() => !initialMatchedCatalog);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [failedCovers, setFailedCovers] = useState<Set<number>>(new Set());
  const [activeDetailItem, setActiveDetailItem] = useState<RepositoryItemRecord | null>(null);

  // Selection state for Indexed Catalog (filtered items)
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<number>>(new Set());
  const [confirmCatalogBulk, setConfirmCatalogBulk] = useState(false);

  // Local Disk Tree state + search filter + selection
  const [fsPath, setFsPath] = useState(() => memoryCatalogViewPrefs.fsPath);
  const [fsSearch, setFsSearch] = useState(() => memoryCatalogViewPrefs.fsSearch);
  const [fsNodes, setFsNodes] = useState<FsTreeNode[]>(() => initialMatchedFs?.nodes ?? []);
  const [fsLoading, setFsLoading] = useState(false);
  const [selectedFsPaths, setSelectedFsPaths] = useState<Set<string>>(new Set());
  const [confirmFsBulk, setConfirmFsBulk] = useState(false);

  useEffect(() => {
    const nextPrefs: CatalogViewPrefs = {
      viewMode,
      catalogLayout,
      search,
      systemFilter,
      statusFilter,
      tagFilter,
      genreFilter,
      regionFilter,
      languageFilter,
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
    search,
    systemFilter,
    statusFilter,
    tagFilter,
    genreFilter,
    regionFilter,
    languageFilter,
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

  const loadCatalog = useCallback(
    async (silent = false) => {
      const reqId = ++catalogReqSeqRef.current;
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({
          search,
          system: systemFilter,
          status: statusFilter,
          tag: tagFilter,
          genre: genreFilter,
          region: regionFilter,
          language: languageFilter,
          limit: '150',
          offset: '0',
        });
        const res = await fetch(`/api/items?${qs.toString()}`);
        if (!res.ok || reqId !== catalogReqSeqRef.current) return;
        const data = await res.json();
        if (reqId !== catalogReqSeqRef.current) return;

        const nextItems = (data.items || []) as RepositoryItemRecord[];
        const nextTotal = data.total || 0;
        memoryCatalogSnapshot = {
          queryKey: buildCatalogQueryKey({
            search,
            systemFilter,
            statusFilter,
            tagFilter,
            genreFilter,
            regionFilter,
            languageFilter,
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
    [search, systemFilter, statusFilter, tagFilter, genreFilter, regionFilter, languageFilter],
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
          search,
          systemFilter,
          statusFilter,
          tagFilter,
          genreFilter,
          regionFilter,
          languageFilter,
        });
      void loadCatalog(hasCached);
    } else {
      const hasCachedFs = memoryFsSnapshot?.fsPath === fsPath;
      void loadFsTree(fsPath, hasCachedFs);
    }
  }, [
    viewMode,
    loadCatalog,
    loadFsTree,
    fsPath,
    search,
    systemFilter,
    statusFilter,
    tagFilter,
    genreFilter,
    regionFilter,
    languageFilter,
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
      await loadCatalog();
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

  const activeFilterCount =
    (search.trim() !== '' ? 1 : 0) +
    (systemFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (tagFilter !== 'all' ? 1 : 0) +
    (genreFilter !== 'all' ? 1 : 0) +
    (regionFilter !== 'all' ? 1 : 0) +
    (languageFilter !== 'all' ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const clearCatalogFilters = () => {
    setSearch('');
    setSystemFilter('all');
    setStatusFilter('all');
    setTagFilter('all');
    setGenreFilter('all');
    setRegionFilter('all');
    setLanguageFilter('all');
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
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  viewMode === 'catalog'
                    ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                    : 'text-crt-muted hover:text-crt-text border border-transparent'
                }`}
              >
                Indexed Catalog ({totalItems})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('filesystem')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
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
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
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
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
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
                onClick={() => void loadCatalog()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors whitespace-nowrap"
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
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-crt-border">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, publisher, file..."
                className={`pl-8 ${search ? 'pr-7' : 'pr-3'} py-1.5 text-xs bg-crt-bg border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-60 ${
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

            <select
              value={systemFilter}
              onChange={(e) => setSystemFilter(e.target.value)}
              aria-label="Filter by console system"
              className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                systemFilter !== 'all' ? 'border-crt-phosphor/60 text-crt-phosphor' : 'border-crt-border text-crt-text'
              }`}
            >
              <option value="all">All Systems ({status.systems.length})</option>
              {systemFilter !== 'all' && !status.systems.some((sys) => sys.systemName === systemFilter) && (
                <option value={systemFilter}>{systemFilter}</option>
              )}
              {status.systems.map((sys) => (
                <option key={sys.systemName} value={sys.systemName}>
                  {sys.systemName} ({sys.totalItems})
                </option>
              ))}
            </select>

            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Filter by release type"
              className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                tagFilter !== 'all' ? 'border-crt-phosphor/60 text-crt-phosphor' : 'border-crt-border text-crt-text'
              }`}
            >
              <option value="all">All Types ({facets.tags.length})</option>
              {tagFilter !== 'all' && !facets.tags.includes(tagFilter) && (
                <option value={tagFilter}>{tagFilter}</option>
              )}
              {facets.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>

            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              aria-label="Filter by genre"
              className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                genreFilter !== 'all' ? 'border-crt-phosphor/60 text-crt-phosphor' : 'border-crt-border text-crt-text'
              }`}
            >
              <option value="all">All Genres ({facets.genres.length})</option>
              {genreFilter !== 'all' && !facets.genres.includes(genreFilter) && (
                <option value={genreFilter}>{genreFilter}</option>
              )}
              {facets.genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>

            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              aria-label="Filter by region"
              className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                regionFilter !== 'all' ? 'border-crt-phosphor/60 text-crt-phosphor' : 'border-crt-border text-crt-text'
              }`}
            >
              <option value="all">All Regions ({facets.regions.length})</option>
              {regionFilter !== 'all' && !facets.regions.includes(regionFilter) && (
                <option value={regionFilter}>{regionFilter}</option>
              )}
              {facets.regions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>

            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              aria-label="Filter by language"
              className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                languageFilter !== 'all' ? 'border-crt-phosphor/60 text-crt-phosphor' : 'border-crt-border text-crt-text'
              }`}
            >
              <option value="all">All Languages ({facets.languages.length})</option>
              {languageFilter !== 'all' && !facets.languages.includes(languageFilter) && (
                <option value={languageFilter}>{languageFilter}</option>
              )}
              {facets.languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by transfer status"
              className={`px-3 py-1.5 text-xs bg-crt-bg border rounded focus:outline-none focus:border-crt-phosphor ${
                statusFilter !== 'all' ? 'border-crt-phosphor/60 text-crt-phosphor' : 'border-crt-border text-crt-text'
              }`}
            >
              <option value="all">All Statuses</option>
              <option value="downloaded">Downloaded</option>
              <option value="skipped">Skipped (Exists)</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
            </select>

            <button
              type="button"
              disabled={!hasActiveFilters}
              onClick={clearCatalogFilters}
              className={`sm:ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                hasActiveFilters
                  ? 'border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20'
                  : 'border-crt-border bg-crt-bg text-crt-muted opacity-50 cursor-not-allowed'
              }`}
            >
              <X className="h-3.5 w-3.5" />
              {hasActiveFilters ? `Clear All Filters (${activeFilterCount})` : 'Clear All Filters'}
            </button>
          </div>
        )}

        {/* Contextual Bulk Selection Bar (Indexed Catalog) */}
        {viewMode === 'catalog' && selectedCatalogIds.size > 0 && (
          <div className="pt-3 border-t border-crt-border flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <span className="text-crt-phosphor tabular-nums">
              {selectedCatalogIds.size} item{selectedCatalogIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
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
                    <th className="py-2.5 px-3 font-medium">System</th>
                    <th className="py-2.5 px-3 font-medium">Release &amp; Mirrored Path</th>
                    <th className="py-2.5 px-3 font-medium">Type</th>
                    <th className="py-2.5 px-3 font-medium text-right">Size</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
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
                                disabled={retryingId === item.id || Boolean(status.activeRun) || !status.auth.hasCompletedLogin}
                                title={!status.auth.hasCompletedLogin ? 'Verify login in Operations before retrying' : undefined}
                                onClick={() => void handleRetry(item.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-crt-border hover:border-crt-phosphor text-crt-text rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Retry
                              </button>
                            ) : (
                              <span className="font-mono text-[11px] text-crt-muted">
                                {formatDateTime(item.downloadedAt || item.discoveredAt)}
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
        onClose={() => setActiveDetailItem(null)}
        onItemUpdated={handleItemUpdated}
        onRetryItem={handleRetry}
        onDeleteItem={async (id) => {
          await handleDeleteCatalogItems([id]);
        }}
      />
    </div>
  );
}
