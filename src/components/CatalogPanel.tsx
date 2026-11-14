import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  FileArchive,
  Folder,
  RefreshCw,
  RotateCcw,
  Search,
  SkipForward,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { FsTreeNode, RepositoryItemRecord, ServiceStatusSnapshot } from '../types';
import { formatBytes, formatDateTime } from '../utils/format';

interface CatalogPanelProps {
  status: ServiceStatusSnapshot;
  onRetryItem: (itemId: number) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

export function CatalogPanel({ status, onRetryItem, onRefreshStatus }: CatalogPanelProps) {
  const [viewMode, setViewMode] = useState<'catalog' | 'filesystem'>('catalog');
  const [search, setSearch] = useState('');
  const [systemFilter, setSystemFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [items, setItems] = useState<RepositoryItemRecord[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Selection state for Indexed Catalog (filtered items)
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<number>>(new Set());
  const [confirmCatalogBulk, setConfirmCatalogBulk] = useState(false);

  // Local Disk Tree state + search filter + selection
  const [fsPath, setFsPath] = useState('');
  const [fsSearch, setFsSearch] = useState('');
  const [fsNodes, setFsNodes] = useState<FsTreeNode[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [selectedFsPaths, setSelectedFsPaths] = useState<Set<string>>(new Set());
  const [confirmFsBulk, setConfirmFsBulk] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        search,
        system: systemFilter,
        status: statusFilter,
        limit: '150',
        offset: '0',
      });
      const res = await fetch(`/api/items?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const nextItems = (data.items || []) as RepositoryItemRecord[];
        setItems(nextItems);
        setTotalItems(data.total || 0);
        // Keep selection scoped strictly to visible/filtered items
        const visibleIds = new Set(nextItems.map((i) => i.id));
        setSelectedCatalogIds((prev) => {
          const pruned = new Set<number>();
          prev.forEach((id) => {
            if (visibleIds.has(id)) pruned.add(id);
          });
          return pruned;
        });
        setConfirmCatalogBulk(false);
      }
    } finally {
      setLoading(false);
    }
  }, [search, systemFilter, statusFilter]);

  const loadFsTree = useCallback(async (subpath: string) => {
    setFsLoading(true);
    try {
      const res = await fetch(`/api/fs/tree?path=${encodeURIComponent(subpath)}`);
      if (res.ok) {
        const data = await res.json();
        const nextNodes = (data.nodes || []) as FsTreeNode[];
        setFsPath(data.currentPath || '');
        setFsNodes(nextNodes);
        setSelectedFsPaths(new Set());
        setConfirmFsBulk(false);
      }
    } finally {
      setFsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'catalog') {
      void loadCatalog();
    } else {
      void loadFsTree(fsPath);
    }
  }, [viewMode, loadCatalog, loadFsTree, fsPath]);

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

  const handleRetry = async (id: number) => {
    setRetryingId(id);
    try {
      await onRetryItem(id);
      await loadCatalog();
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

  const breadcrumbs = fsPath ? fsPath.split('/').filter(Boolean) : [];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="border border-crt-border bg-crt-surface rounded-md p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
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

          {viewMode === 'catalog' ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title, filename, path..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-60"
                />
              </div>

              <select
                value={systemFilter}
                onChange={(e) => setSystemFilter(e.target.value)}
                aria-label="Filter by console system"
                className="px-3 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
              >
                <option value="all">All Systems ({status.systems.length})</option>
                {status.systems.map((sys) => (
                  <option key={sys.systemName} value={sys.systemName}>
                    {sys.systemName} ({sys.totalItems})
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by transfer status"
                className="px-3 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
              >
                <option value="all">All Statuses</option>
                <option value="downloaded">Downloaded</option>
                <option value="skipped">Skipped (Exists)</option>
                <option value="failed">Failed</option>
              </select>

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
                <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={fsSearch}
                  onChange={(e) => setFsSearch(e.target.value)}
                  placeholder="Filter current folder..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-56"
                />
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
                <div key={row} className="h-9 bg-crt-bg border border-crt-border rounded animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <FileArchive className="h-6 w-6 text-crt-muted mx-auto" />
              <p className="text-sm font-medium text-crt-text">No mirrored repository items match your filter</p>
              <p className="text-xs text-crt-muted max-w-md mx-auto">
                Run an Incremental Sync from the Sync tab to crawl retrogametalk.com/repo and mirror releases locally.
              </p>
            </div>
          ) : (
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
                    return (
                      <tr
                        key={item.id}
                        className={`h-10 transition-colors ${
                          checked ? 'bg-crt-phosphor/5' : 'hover:bg-crt-elevated'
                        }`}
                      >
                        <td className="pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCatalogItem(item.id)}
                            aria-label={`Select ${item.filename}`}
                            className="accent-crt-phosphor cursor-pointer"
                          />
                        </td>
                        <td className="px-3 font-mono text-crt-text whitespace-nowrap">
                          {item.systemName}
                        </td>
                        <td className="px-3 max-w-md">
                          <div className="font-medium text-crt-text truncate">{item.title}</div>
                          <div className="font-mono text-[11px] text-crt-muted truncate">
                            {item.remotePath}
                          </div>
                          {item.errorMessage && (
                            <div className="font-mono text-[11px] text-crt-crimson truncate">
                              {item.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-3 font-mono text-crt-muted whitespace-nowrap">
                          {item.releaseType}
                        </td>
                        <td className="px-3 font-mono text-right text-crt-text tabular-nums whitespace-nowrap">
                          {formatBytes(item.fileSizeBytes)}
                        </td>
                        <td className="px-3 font-mono whitespace-nowrap">
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
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            {item.status === 'failed' ? (
                              <button
                                type="button"
                                disabled={retryingId === item.id || Boolean(status.activeRun)}
                                onClick={() => void handleRetry(item.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-crt-border hover:border-crt-phosphor text-crt-text rounded transition-colors disabled:opacity-50"
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
                              aria-label={`Delete ${item.filename}`}
                              title="Delete item and local mirrored file"
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
            <div className="p-12 text-center space-y-2">
              <Folder className="h-6 w-6 text-crt-muted mx-auto" />
              <p className="text-sm font-medium text-crt-text">
                {fsNodes.length === 0 ? 'Directory is empty' : 'No files or folders match your filter'}
              </p>
              <p className="text-xs text-crt-muted">
                {fsNodes.length === 0
                  ? 'Downloaded ROMs, hacks, translations, and ports will appear here mirroring the exact remote hierarchy.'
                  : 'Try clearing the folder filter input above.'}
              </p>
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
    </div>
  );
}
