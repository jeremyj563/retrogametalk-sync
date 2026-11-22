import { useEffect, useRef, useState } from 'react';
import {
  Ban,
  Check,
  FolderPlus,
  Minus,
  Pin,
  Plus,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import type { SyncOverrideMode, UserCollectionRecord } from '../types';

interface CollectionPickerPopoverProps {
  mode: 'single' | 'bulk';
  collections: UserCollectionRecord[];
  /** For mode="single", the collection IDs currently containing this game */
  assignedCollectionIds?: number[];
  /** Number of selected items (for mode="bulk") */
  selectedCount?: number;
  /** Placement of the popover panel relative to trigger */
  align?: 'left' | 'right';
  direction?: 'up' | 'down';
  /** Trigger button label / compact style */
  triggerLabel?: string;
  triggerTitle?: string;
  triggerClassName?: string;
  disabled?: boolean;
  onAddToCollection: (collectionId: number) => Promise<void> | void;
  onRemoveFromCollection: (collectionId: number) => Promise<void> | void;
  onCreateCollection: (name: string) => Promise<UserCollectionRecord | null>;
  /** Optional bulk curation actions (only shown when mode="bulk" and handlers provided) */
  onBulkSetFavorite?: (favorite: boolean) => Promise<void> | void;
  onBulkSetSyncOverride?: (mode: SyncOverrideMode) => Promise<void> | void;
}

export function CollectionPickerPopover({
  mode,
  collections,
  assignedCollectionIds = [],
  selectedCount = 1,
  align = 'left',
  direction = 'down',
  triggerLabel,
  triggerTitle,
  triggerClassName,
  disabled = false,
  onAddToCollection,
  onRemoveFromCollection,
  onCreateCollection,
  onBulkSetFavorite,
  onBulkSetSyncOverride,
}: CollectionPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setErrorMsg(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setCreating(false);
        setErrorMsg(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (creating) {
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [creating]);

  const assignedSet = new Set(assignedCollectionIds);

  const handleSingleToggle = async (col: UserCollectionRecord) => {
    const isMember = assignedSet.has(col.id);
    setBusyKey(`col-${col.id}`);
    setErrorMsg(null);
    try {
      if (isMember) {
        await onRemoveFromCollection(col.id);
      } else {
        await onAddToCollection(col.id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleBulkCollectionAction = async (colId: number, action: 'add' | 'remove') => {
    setBusyKey(`${action}-${colId}`);
    setErrorMsg(null);
    try {
      if (action === 'add') {
        await onAddToCollection(colId);
      } else {
        await onRemoveFromCollection(colId);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || busyKey) return;
    setBusyKey('create');
    setErrorMsg(null);
    try {
      const created = await onCreateCollection(trimmed);
      if (created) {
        await onAddToCollection(created.id);
        setNewName('');
        setCreating(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleBulkFav = async (favorite: boolean) => {
    if (!onBulkSetFavorite || busyKey) return;
    setBusyKey(favorite ? 'fav-add' : 'fav-rem');
    setErrorMsg(null);
    try {
      await onBulkSetFavorite(favorite);
      setOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const handleBulkOverride = async (override: SyncOverrideMode) => {
    if (!onBulkSetSyncOverride || busyKey) return;
    setBusyKey(`ovr-${override}`);
    setErrorMsg(null);
    try {
      await onBulkSetSyncOverride(override);
      setOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const positionClass = `${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${
    align === 'right' ? 'right-0' : 'left-0'
  }`;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((prev) => !prev);
          setErrorMsg(null);
        }}
        title={triggerTitle || (mode === 'bulk' ? 'Add selected games to collection, favorites, or sync overrides' : 'Add to collection')}
        className={
          triggerClassName ||
          `inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
            open
              ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
              : 'border-crt-border bg-crt-bg hover:bg-crt-elevated hover:border-crt-border-strong text-crt-text'
          }`
        }
      >
        <FolderPlus className="h-3.5 w-3.5 shrink-0" />
        <span>{triggerLabel ?? (mode === 'bulk' ? '+ Collection' : 'Add to Collection')}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={mode === 'bulk' ? 'Curate selected releases' : 'Manage game collections'}
          className={`absolute ${positionClass} z-40 w-72 border border-crt-border-strong bg-crt-surface rounded-md shadow-2xl text-xs overflow-hidden`}
        >
          <div className="px-3 py-2 border-b border-crt-border bg-crt-bg/80 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-crt-muted">
              {mode === 'bulk' ? `Collections (${selectedCount} selected)` : 'Collections'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close collection menu"
              className="text-crt-muted hover:text-crt-text cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {errorMsg && (
            <div className="px-3 py-1.5 bg-crt-crimson/10 border-b border-crt-crimson/30 text-[11px] font-mono text-crt-crimson">
              {errorMsg}
            </div>
          )}

          <div className="max-h-52 overflow-y-auto py-1">
            {collections.length === 0 ? (
              <div className="px-3 py-3 text-[11px] font-mono text-crt-muted text-center">
                No collections yet. Create one below.
              </div>
            ) : mode === 'single' ? (
              collections.map((col) => {
                const isMember = assignedSet.has(col.id);
                const isBusy = busyKey === `col-${col.id}`;
                return (
                  <button
                    key={col.id}
                    type="button"
                    disabled={Boolean(busyKey)}
                    onClick={() => void handleSingleToggle(col)}
                    className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-crt-elevated transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0 ${
                          isMember
                            ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                            : 'border-crt-border-strong bg-crt-bg'
                        }`}
                      >
                        {isMember && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                      </span>
                      <span className="truncate text-crt-text">{col.name}</span>
                    </span>
                    <span className="font-mono text-[10px] text-crt-muted tabular-nums shrink-0">
                      {isBusy ? '…' : col.itemCount}
                    </span>
                  </button>
                );
              })
            ) : (
              collections.map((col) => {
                const adding = busyKey === `add-${col.id}`;
                const removing = busyKey === `remove-${col.id}`;
                return (
                  <div
                    key={col.id}
                    className="px-3 py-1.5 flex items-center justify-between gap-2 hover:bg-crt-elevated/60"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="truncate block text-crt-text">{col.name}</span>
                      <span className="font-mono text-[10px] text-crt-muted tabular-nums">
                        {col.itemCount} {col.itemCount === 1 ? 'game' : 'games'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={Boolean(busyKey)}
                        onClick={() => void handleBulkCollectionAction(col.id, 'add')}
                        title={`Add ${selectedCount} selected game(s) to ${col.name}`}
                        className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-mono border border-crt-phosphor/50 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="h-3 w-3" />
                        {adding ? '…' : 'Add'}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyKey)}
                        onClick={() => void handleBulkCollectionAction(col.id, 'remove')}
                        title={`Remove ${selectedCount} selected game(s) from ${col.name}`}
                        className="inline-flex items-center px-1.5 py-1 text-[11px] font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-crimson hover:border-crt-crimson/50 rounded cursor-pointer disabled:opacity-50"
                      >
                        {removing ? '…' : <Minus className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-crt-border p-2 bg-crt-bg/50">
            {creating ? (
              <form onSubmit={(e) => void handleCreateSubmit(e)} className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={80}
                  placeholder="Collection name…"
                  className="flex-1 min-w-0 px-2 py-1 text-xs bg-crt-bg border border-crt-border-strong focus:border-crt-phosphor rounded text-crt-text placeholder:text-crt-muted focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || Boolean(busyKey)}
                  className="px-2.5 py-1 text-xs font-semibold bg-crt-phosphor text-crt-bg hover:brightness-110 rounded cursor-pointer disabled:opacity-40"
                >
                  {busyKey === 'create' ? '…' : 'Add'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full px-2 py-1.5 flex items-center gap-1.5 text-xs font-mono text-crt-phosphor hover:bg-crt-elevated rounded transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Collection…</span>
              </button>
            )}
          </div>

          {mode === 'bulk' && (onBulkSetFavorite || onBulkSetSyncOverride) && (
            <div className="border-t border-crt-border p-2 space-y-2 bg-crt-bg/80">
              {onBulkSetFavorite && (
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-crt-muted">
                    Favorites
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleBulkFav(true)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-amber/50 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded cursor-pointer disabled:opacity-50"
                    >
                      <Star className="h-3 w-3 fill-crt-amber" />
                      Star
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleBulkFav(false)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded cursor-pointer disabled:opacity-50"
                    >
                      Unstar
                    </button>
                  </div>
                </div>
              )}

              {onBulkSetSyncOverride && (
                <div className="space-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-crt-muted block">
                    Sync Rule Override
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleBulkOverride('pin')}
                      title="Always include selected games in Full & Incremental Sync"
                      className="inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-mono border border-crt-phosphor/50 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded cursor-pointer disabled:opacity-50"
                    >
                      <Pin className="h-3 w-3" />
                      Pin
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleBulkOverride('ignore')}
                      title="Skip selected games during automatic Full & Incremental Sync"
                      className="inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-mono border border-crt-crimson/40 bg-crt-crimson/10 text-crt-crimson hover:bg-crt-crimson/20 rounded cursor-pointer disabled:opacity-50"
                    >
                      <Ban className="h-3 w-3" />
                      Ignore
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleBulkOverride('default')}
                      title="Follow global Sync Rules"
                      className="inline-flex items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded cursor-pointer disabled:opacity-50"
                    >
                      <SlidersHorizontal className="h-3 w-3" />
                      Default
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
