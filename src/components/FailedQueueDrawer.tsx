import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { RepositoryItemRecord, ServiceStatusSnapshot } from '../types';
import { readJsonSafely } from '../utils/http';
import { GameDetailDrawer } from './GameDetailDrawer';

interface FailedQueueDrawerProps {
  open: boolean;
  status: ServiceStatusSnapshot;
  catalogRevision: number;
  activeRetryItemId?: number | null;
  onClose: () => void;
  onRetryItem: (itemId: number, fileId?: number, options?: { dryRun?: boolean }) => Promise<void>;
  onRetryAllFailed: (options?: { system?: string; ids?: number[]; dryRun?: boolean }) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
}

export function FailedQueueDrawer({
  open,
  status,
  catalogRevision,
  activeRetryItemId = null,
  onClose,
  onRetryItem,
  onRetryAllFailed,
  onRefreshStatus,
}: FailedQueueDrawerProps) {
  const [items, setItems] = useState<RepositoryItemRecord[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [systemFilter, setSystemFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);
  const [retryDryRun, setRetryDryRun] = useState(false);
  const [activeDetailItem, setActiveDetailItem] = useState<RepositoryItemRecord | null>(null);

  const reqSeqRef = useRef(0);
  const activeDetailIdRef = useRef<number | null>(null);
  const lastHandledRevisionRef = useRef(catalogRevision);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    activeDetailIdRef.current = activeDetailItem?.id ?? null;
  }, [activeDetailItem?.id]);

  const effectiveRetryingId =
    retryingId ??
    (status.activeRun?.triggerType === 'retry'
      ? (activeRetryItemId ?? status.activeTransfer?.itemId ?? null)
      : null);

  const loadFailedQueue = useCallback(
    async (silent = false) => {
      const reqId = ++reqSeqRef.current;
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({
          search,
          system: systemFilter,
          status: 'needs_retry',
          tag: 'all',
          genre: 'all',
          region: 'all',
          language: 'all',
          sort: 'discovered_desc',
          limit: '150',
          offset: '0',
        });
        const res = await fetch(`/api/items?${qs.toString()}`);
        if (!res.ok || reqId !== reqSeqRef.current) return;
        const data = await res.json();
        if (reqId !== reqSeqRef.current) return;

        const nextItems = (data.items || []) as RepositoryItemRecord[];
        setItems(nextItems);
        setTotalItems(data.total || 0);
        hasLoadedOnceRef.current = true;

        if (!silent) {
          setConfirmBulkDelete(false);
        }

        const visibleIds = new Set(nextItems.map((i) => i.id));
        setSelectedIds((prev) => {
          if (prev.size === 0) return prev;
          const pruned = new Set<number>();
          prev.forEach((id) => {
            if (visibleIds.has(id)) pruned.add(id);
          });
          return pruned;
        });

        const openDetailId = activeDetailIdRef.current;
        if (silent && openDetailId !== null) {
          const detailRes = await fetch(`/api/items/${openDetailId}`);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData.item) {
              setActiveDetailItem((current) =>
                current?.id === openDetailId ? (detailData.item as RepositoryItemRecord) : current,
              );
            }
          }
        }
      } finally {
        if (reqId === reqSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [search, systemFilter],
  );

  useEffect(() => {
    if (!open) return;
    lastHandledRevisionRef.current = catalogRevision;
    void loadFailedQueue(hasLoadedOnceRef.current);
  }, [open, loadFailedQueue]);

  useEffect(() => {
    if (!open) return;
    if (catalogRevision === lastHandledRevisionRef.current) return;
    lastHandledRevisionRef.current = catalogRevision;
    void loadFailedQueue(true);
  }, [open, catalogRevision, loadFailedQueue]);

  useEffect(() => {
    if (open) return;
    setConfirmBulkDelete(false);
  }, [open]);

  if (!open) return null;

  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  const toggleAll = () => {
    setConfirmBulkDelete(false);
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const toggleItem = (id: number) => {
    setConfirmBulkDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const handleRetry = async (
    id: number,
    fileId?: number,
    options?: { dryRun?: boolean },
  ) => {
    setRetryingId(id);
    try {
      await onRetryItem(id, fileId, { dryRun: options?.dryRun ?? retryDryRun });
      await loadFailedQueue(true);
      if (activeDetailItem?.id === id) {
        const res = await fetch(`/api/items/${id}`);
        if (res.ok) {
          const parsed = await readJsonSafely<{ item?: RepositoryItemRecord }>(res);
          if (parsed.ok && parsed.data?.item) {
            setActiveDetailItem(parsed.data.item);
          }
        }
      }
    } finally {
      setRetryingId(null);
    }
  };

  const handleBatchRetry = async (ids?: number[]) => {
    setBatchRetrying(true);
    try {
      await onRetryAllFailed({
        system: systemFilter !== 'all' ? systemFilter : undefined,
        ids: ids && ids.length > 0 ? ids : undefined,
        dryRun: retryDryRun,
      });
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      await loadFailedQueue(true);
    } catch {
      // Error surfaced via top-level errorBanner in App.tsx
    } finally {
      setBatchRetrying(false);
    }
  };

  const handleDeleteItems = async (ids: number[]) => {
    if (ids.length === 0) return;
    setDeletingKey(ids.length === 1 ? `item-${ids[0]}` : 'bulk');
    try {
      const res = await fetch('/api/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        if (activeDetailItem && ids.includes(activeDetailItem.id)) {
          setActiveDetailItem(null);
        }
        await Promise.all([loadFailedQueue(true), onRefreshStatus()]);
      }
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <>
      <section
        aria-label="Failed Queue Drawer"
        className="border border-crt-border bg-crt-surface rounded-md overflow-hidden transition-opacity duration-150 motion-reduce:transition-none"
      >
        {/* Drawer Header Bar */}
        <div className="px-5 py-4 border-b border-crt-border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              {status.totals.failedItems > 0 ? (
                <XCircle className="h-4 w-4 text-crt-crimson shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-crt-phosphor shrink-0" />
              )}
              <h2 className="font-display text-base font-semibold text-crt-text tabular-nums">
                Failed Queue ({status.totals.failedItems})
              </h2>
            </div>
            <p className="text-xs text-crt-muted">
              Inspect failed or partial downloads, retry transfers inline, or remove broken entries without leaving Sync.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              aria-pressed={retryDryRun}
              disabled={batchRetrying || Boolean(status.activeRun) || !status.auth.hasCompletedLogin}
              title="Toggle Dry Run ON to verify fresh download link resolution on RetroGameTalk without downloading archives or modifying status"
              onClick={() => setRetryDryRun((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                retryDryRun
                  ? 'border-crt-amber/80 bg-crt-amber/12 text-crt-amber'
                  : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
              } disabled:opacity-45 disabled:cursor-not-allowed`}
            >
              <span
                aria-hidden="true"
                className={`h-3.5 w-3.5 rounded-[3px] border flex items-center justify-center transition-colors shrink-0 ${
                  retryDryRun
                    ? 'border-crt-amber bg-crt-amber text-crt-bg'
                    : 'border-crt-border-strong bg-crt-surface'
                }`}
              >
                {retryDryRun && <Check className="h-2.5 w-2.5 stroke-[3]" />}
              </span>
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              <span>Dry Run</span>
            </button>

            <button
              type="button"
              disabled={
                status.totals.failedItems === 0 ||
                batchRetrying ||
                Boolean(status.activeRun) ||
                !status.auth.hasCompletedLogin
              }
              title={
                !status.auth.hasCompletedLogin
                  ? 'Verify login in Operations before retrying failed downloads'
                  : status.activeRun
                    ? 'Wait for or stop the active sync run first'
                    : retryDryRun
                      ? 'Verify fresh download link resolution across failed/partial releases without downloading files'
                      : systemFilter !== 'all'
                        ? `Retry all failed and partial releases in ${systemFilter}`
                        : 'Retry all failed and partial releases'
              }
              onClick={() => void handleBatchRetry()}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-crt-bg rounded transition-colors whitespace-nowrap shrink-0 tabular-nums disabled:opacity-45 disabled:cursor-not-allowed ${
                retryDryRun
                  ? 'bg-crt-amber hover:brightness-110'
                  : 'bg-crt-phosphor hover:brightness-110'
              }`}
            >
              {retryDryRun ? (
                <FlaskConical className={`h-3.5 w-3.5 ${batchRetrying ? 'animate-spin' : ''}`} />
              ) : (
                <RotateCcw className={`h-3.5 w-3.5 ${batchRetrying ? 'animate-spin' : ''}`} />
              )}
              {batchRetrying
                ? retryDryRun
                  ? 'Starting Dry Run...'
                  : 'Starting Retry...'
                : retryDryRun
                  ? systemFilter !== 'all'
                    ? `Dry Run Failed (${items.length})`
                    : `Dry Run All Failed (${status.totals.failedItems})`
                  : systemFilter !== 'all'
                    ? `Retry Failed (${items.length})`
                    : `Retry All Failed (${status.totals.failedItems})`}
            </button>
            <button
              type="button"
              onClick={() => void loadFailedQueue(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Failed Queue drawer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-5 py-3 border-b border-crt-border bg-crt-bg/50 flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter failed titles or files..."
              className={`pl-8 ${search ? 'pr-7' : 'pr-3'} py-1.5 text-xs bg-crt-bg border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-64 ${
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
            aria-label="Filter failed releases by console system"
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
                {sys.systemName} ({sys.failedItems} failed)
              </option>
            ))}
          </select>

          {(search.trim() !== '' || systemFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setSystemFilter('all');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 transition-colors whitespace-nowrap"
            >
              <X className="h-3.5 w-3.5" />
              Reset Filter
            </button>
          )}

          <span className="sm:ml-auto text-xs font-mono text-crt-muted tabular-nums">
            Showing {items.length} of {totalItems} failed/partial release{totalItems === 1 ? '' : 's'}
          </span>
        </div>

        {/* Contextual Bulk Selection Bar */}
        {selectedIds.size > 0 && (
          <div className="px-5 py-2.5 border-b border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <span className="text-crt-phosphor tabular-nums">
              {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {!confirmBulkDelete && (
                <button
                  type="button"
                  disabled={batchRetrying || Boolean(status.activeRun) || !status.auth.hasCompletedLogin}
                  onClick={() => void handleBatchRetry(Array.from(selectedIds))}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed ${
                    retryDryRun
                      ? 'border-crt-amber/80 text-crt-amber hover:bg-crt-amber/10'
                      : 'border-crt-phosphor/70 text-crt-phosphor hover:bg-crt-phosphor/10'
                  }`}
                >
                  {retryDryRun ? (
                    <FlaskConical className="h-3.5 w-3.5" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  {retryDryRun ? `Dry Run Selected (${selectedIds.size})` : `Retry Selected (${selectedIds.size})`}
                </button>
              )}
              {confirmBulkDelete ? (
                <>
                  <button
                    type="button"
                    disabled={deletingKey === 'bulk'}
                    onClick={() => void handleDeleteItems(Array.from(selectedIds))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-crt-bg bg-crt-crimson hover:brightness-110 rounded transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingKey === 'bulk' ? 'Deleting...' : `Confirm Delete (${selectedIds.size})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(false)}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-crimson/60 text-crt-crimson hover:bg-crt-crimson/10 rounded transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Selected ({selectedIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="px-3 py-1.5 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Drawer Content */}
        {loading ? (
          <div className="p-5 space-y-2.5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-12 bg-crt-bg border border-crt-border rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <CheckCircle2 className="h-6 w-6 text-crt-phosphor mx-auto" />
            <p className="text-sm font-medium text-crt-text">
              {search.trim() !== '' || systemFilter !== 'all'
                ? 'No failed or partial releases match this filter'
                : 'All downloads recovered'}
            </p>
            <p className="text-xs text-crt-muted max-w-md mx-auto">
              {search.trim() !== '' || systemFilter !== 'all'
                ? 'Clear your search query or system filter to inspect remaining releases awaiting recovery.'
                : 'Every indexed release is cleanly downloaded on disk with zero remaining failures.'}
            </p>
            <div className="pt-1 flex items-center justify-center gap-2">
              {(search.trim() !== '' || systemFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setSystemFilter('all');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Reset Filter
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg hover:bg-crt-elevated text-crt-text rounded transition-colors"
              >
                Close Drawer
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-crt-border bg-crt-bg text-[11px] font-mono text-crt-muted">
                  <th className="py-2.5 pl-4 pr-2 w-9">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all failed releases"
                      className="accent-crt-phosphor cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-medium">System</th>
                  <th className="py-2.5 px-3 font-medium">Release &amp; Failing Files</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Recovery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-crt-border text-xs">
                {items.map((item) => {
                  const checked = selectedIds.has(item.id);
                  const isDeletingThis = deletingKey === `item-${item.id}`;
                  const failingFiles = item.files.filter((f) => f.status === 'failed');
                  const failureSummary =
                    failingFiles.length > 0
                      ? `${failingFiles.length} of ${item.filesCount || item.files.length} file${(item.filesCount || item.files.length) === 1 ? '' : 's'} failed`
                      : item.status === 'partial'
                        ? 'Missing local archive'
                        : 'Download failed';

                  return (
                    <tr
                      key={item.id}
                      onClick={() => void openDetailItem(item)}
                      className={`cursor-pointer transition-colors align-top ${
                        checked ? 'bg-crt-phosphor/5' : 'hover:bg-crt-elevated'
                      }`}
                    >
                      <td className="pl-4 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(item.id)}
                          aria-label={`Select ${item.title}`}
                          className="accent-crt-phosphor cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-3 font-mono text-crt-text whitespace-nowrap">
                        {item.systemName}
                      </td>
                      <td className="px-3 py-3 max-w-2xl">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-medium text-crt-text">{item.title}</span>
                            <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                              {failureSummary} · {item.remotePath}
                            </span>
                          </div>
                          {failingFiles.length > 0 ? (
                            <div className="space-y-1 pt-0.5">
                              {failingFiles.map((f) => (
                                <div key={f.id} className="font-mono text-[11px] leading-snug break-all">
                                  <span className="text-crt-text">{f.filename}</span>
                                  {f.errorMessage && (
                                    <span className="text-crt-crimson ml-2">· {f.errorMessage}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            item.errorMessage && (
                              <div className="font-mono text-[11px] text-crt-crimson leading-snug break-all">
                                {item.errorMessage}
                              </div>
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 ${
                            item.status === 'failed' ? 'text-crt-crimson' : 'text-crt-amber'
                          }`}
                        >
                          {item.status === 'failed' ? (
                            <XCircle className="h-3.5 w-3.5" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5" />
                          )}
                          {item.status}
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={
                              effectiveRetryingId === item.id ||
                              batchRetrying ||
                              Boolean(status.activeRun) ||
                              !status.auth.hasCompletedLogin
                            }
                            title={
                              !status.auth.hasCompletedLogin
                                ? 'Verify login in Operations before retrying'
                                : retryDryRun
                                  ? 'Dry-run: verify fresh download link resolution without downloading files'
                                  : 'Re-fetch download link and retry failed/missing files'
                            }
                            onClick={() => void handleRetry(item.id, undefined, { dryRun: retryDryRun })}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                              retryDryRun
                                ? 'border-crt-amber/70 hover:border-crt-amber text-crt-amber bg-crt-amber/5'
                                : 'border-crt-border hover:border-crt-phosphor text-crt-text'
                            }`}
                          >
                            {retryDryRun ? (
                              <FlaskConical className={`h-3 w-3 ${effectiveRetryingId === item.id ? 'animate-spin' : ''}`} />
                            ) : (
                              <RotateCcw className={`h-3 w-3 ${effectiveRetryingId === item.id ? 'animate-spin' : ''}`} />
                            )}
                            {effectiveRetryingId === item.id
                              ? retryDryRun
                                ? 'Checking...'
                                : 'Retrying...'
                              : retryDryRun
                                ? 'Dry Run'
                                : 'Retry'}
                          </button>
                          <button
                            type="button"
                            disabled={isDeletingThis}
                            onClick={() => void handleDeleteItems([item.id])}
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
        )}
      </section>

      <GameDetailDrawer
        item={activeDetailItem}
        activeRun={Boolean(status.activeRun)}
        canSync={Boolean(status.auth.hasCompletedLogin)}
        retryingItem={effectiveRetryingId === activeDetailItem?.id}
        onClose={() => setActiveDetailItem(null)}
        onItemUpdated={(updated) => {
          setActiveDetailItem(updated);
          setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
          void loadFailedQueue(true);
        }}
        onRetryItem={handleRetry}
        onDeleteItem={async (id) => {
          await handleDeleteItems([id]);
        }}
      />
    </>
  );
}
