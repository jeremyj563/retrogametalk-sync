import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  CornerLeftUp,
  Disc,
  Download,
  File,
  FileArchive,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { listArchiveDirectoryAtPath } from '../shared/archiveTree';
import type { ArchiveBrowseListing, FsTreeNode } from '../types';
import { formatBytes, formatDateTime } from '../utils/format';
import {
  classifyDiskEntry,
  getParentDiskPath,
  resolveDiskNavigationScrollTop,
  sortDiskTreeNodes,
  summarizeDiskTreeNodes,
  type DiskEntryKind,
  type DiskTreeSortDir,
  type DiskTreeSortField,
} from '../utils/localDiskTree';
import { ArchiveExplorer } from './ArchiveExplorer';

interface LocalDiskTreePanelProps {
  downloadDir: string;
  fsPath: string;
  fsSearch: string;
  fsNodes: FsTreeNode[];
  fsLoading: boolean;
  selectedFsPaths: Set<string>;
  confirmFsBulk: boolean;
  deletingKey: string | null;
  fsArchivePath: string | null;
  fsArchiveListing: ArchiveBrowseListing | null;
  fsArchiveSubpath: string;
  fsArchiveLoading: boolean;
  fsArchiveError: string | null;
  onPathChange: (nextPath: string) => void;
  onSearchChange: (nextSearch: string) => void;
  onToggleNode: (relativePath: string) => void;
  onToggleAllVisible: (visibleNodes: FsTreeNode[]) => void;
  onClearSelection: () => void;
  onConfirmBulkChange: (next: boolean) => void;
  onDeletePaths: (paths: string[]) => Promise<void>;
  onOpenArchive: (relativePath: string) => Promise<void>;
  onExitArchive: (nextDiskPath?: string) => void;
  onArchiveSubpathChange: (nextSubpath: string) => void;
}

function DiskEntryIcon({ kind }: { kind: DiskEntryKind }) {
  switch (kind) {
    case 'directory':
      return <Folder className="h-4 w-4 text-crt-amber shrink-0" />;
    case 'archive':
      return <FileArchive className="h-4 w-4 text-crt-phosphor shrink-0" />;
    case 'rom':
      return <Gamepad2 className="h-4 w-4 text-crt-phosphor shrink-0" />;
    case 'disc':
      return <Disc className="h-4 w-4 text-crt-phosphor shrink-0" />;
    case 'patch':
      return <FileCode2 className="h-4 w-4 text-crt-amber shrink-0" />;
    case 'doc':
      return <FileText className="h-4 w-4 text-crt-muted shrink-0" />;
    default:
      return <File className="h-4 w-4 text-crt-muted shrink-0" />;
  }
}

type DiskSortPreset = 'name_asc' | 'name_desc' | 'size_desc' | 'modified_desc';

function parseSortPreset(preset: DiskSortPreset): { field: DiskTreeSortField; dir: DiskTreeSortDir } {
  switch (preset) {
    case 'name_desc':
      return { field: 'name', dir: 'desc' };
    case 'size_desc':
      return { field: 'size', dir: 'desc' };
    case 'modified_desc':
      return { field: 'modified', dir: 'desc' };
    default:
      return { field: 'name', dir: 'asc' };
  }
}

export function LocalDiskTreePanel({
  downloadDir,
  fsPath,
  fsSearch,
  fsNodes,
  fsLoading,
  selectedFsPaths,
  confirmFsBulk,
  deletingKey,
  fsArchivePath,
  fsArchiveListing,
  fsArchiveSubpath,
  fsArchiveLoading,
  fsArchiveError,
  onPathChange,
  onSearchChange,
  onToggleNode,
  onToggleAllVisible,
  onClearSelection,
  onConfirmBulkChange,
  onDeletePaths,
  onOpenArchive,
  onExitArchive,
  onArchiveSubpathChange,
}: LocalDiskTreePanelProps) {
  const [sortField, setSortField] = useState<DiskTreeSortField>('name');
  const [sortDir, setSortDir] = useState<DiskTreeSortDir>('asc');
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const savedScrollByPathRef = useRef<Map<string, number>>(new Map());
  const pendingScrollTargetRef = useRef<number | null>(null);
  const prevNavLocationRef = useRef<string>(`${fsPath}::${fsArchivePath ?? ''}::${fsArchiveSubpath}`);

  // Ensure the explorer panel itself stays visible if the outer window was scrolled down
  const ensureExplorerVisible = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || typeof window === 'undefined') return;
    const rect = panel.getBoundingClientRect();
    // Leave comfortable clearance under the sticky app header (~76px)
    const desiredTopOffset = 84;
    if (rect.top < desiredTopOffset) {
      const targetY = Math.max(0, window.scrollY + rect.top - desiredTopOffset);
      window.scrollTo({ top: targetY, behavior: 'auto' });
    }
  }, []);

  const navigateToDiskPath = useCallback(
    (nextPath: string) => {
      const viewport = scrollViewportRef.current;
      if (viewport && !fsArchivePath) {
        savedScrollByPathRef.current.set(fsPath, viewport.scrollTop);
      }
      pendingScrollTargetRef.current = resolveDiskNavigationScrollTop({
        fromPath: fsPath,
        toPath: nextPath,
        savedScrollByPath: savedScrollByPathRef.current,
      });
      setPendingDeletePath(null);
      if (fsArchivePath) {
        onExitArchive(nextPath);
      } else {
        if (fsSearch.trim()) {
          onSearchChange('');
        }
        onPathChange(nextPath);
      }
      ensureExplorerVisible();
    },
    [
      fsPath,
      fsArchivePath,
      fsSearch,
      onExitArchive,
      onSearchChange,
      onPathChange,
      ensureExplorerVisible,
    ],
  );

  const handleOpenArchiveRow = useCallback(
    (relativePath: string) => {
      const viewport = scrollViewportRef.current;
      if (viewport && !fsArchivePath) {
        savedScrollByPathRef.current.set(fsPath, viewport.scrollTop);
      }
      pendingScrollTargetRef.current = 0;
      setPendingDeletePath(null);
      void onOpenArchive(relativePath);
      ensureExplorerVisible();
    },
    [fsPath, fsArchivePath, onOpenArchive, ensureExplorerVisible],
  );

  const handleExitArchive = useCallback(
    (nextDiskPath?: string) => {
      const targetPath = nextDiskPath !== undefined ? nextDiskPath : fsPath;
      const saved = savedScrollByPathRef.current.get(targetPath) ?? 0;
      pendingScrollTargetRef.current = nextDiskPath === undefined ? saved : resolveDiskNavigationScrollTop({
        fromPath: fsPath,
        toPath: targetPath,
        savedScrollByPath: savedScrollByPathRef.current,
      });
      setPendingDeletePath(null);
      onExitArchive(nextDiskPath);
      ensureExplorerVisible();
    },
    [fsPath, onExitArchive, ensureExplorerVisible],
  );

  // Apply scroll reset / parent scroll restoration synchronously as directory or archive location changes
  useLayoutEffect(() => {
    const locationKey = `${fsPath}::${fsArchivePath ?? ''}::${fsArchiveSubpath}`;
    const locationChanged = prevNavLocationRef.current !== locationKey;
    if (locationChanged) {
      prevNavLocationRef.current = locationKey;
      setPendingDeletePath(null);
    }

    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    if (locationChanged) {
      const target = pendingScrollTargetRef.current ?? 0;
      viewport.scrollTop = target;
      ensureExplorerVisible();
    } else if (!fsLoading && !fsArchiveLoading && pendingScrollTargetRef.current !== null) {
      // Re-apply once loaded rows finish mounting (important when restoring deep parent scroll offsets)
      viewport.scrollTop = pendingScrollTargetRef.current;
      pendingScrollTargetRef.current = null;
    }
  }, [fsPath, fsArchivePath, fsArchiveSubpath, fsLoading, fsArchiveLoading, fsNodes, ensureExplorerVisible]);

  // Reset inline delete prompt if selection changes or search changes
  useEffect(() => {
    setPendingDeletePath(null);
  }, [fsSearch, selectedFsPaths.size]);

  const breadcrumbs = useMemo(() => (fsPath ? fsPath.split('/').filter(Boolean) : []), [fsPath]);
  const parentPath = useMemo(() => getParentDiskPath(fsPath), [fsPath]);

  const filteredAndSortedNodes = useMemo(() => {
    const q = fsSearch.trim().toLowerCase();
    const filtered = q
      ? fsNodes.filter(
          (n) =>
            n.name.toLowerCase().includes(q) || n.relativePath.toLowerCase().includes(q),
        )
      : fsNodes;
    return sortDiskTreeNodes(filtered, sortField, sortDir);
  }, [fsNodes, fsSearch, sortField, sortDir]);

  const totalSummary = useMemo(() => summarizeDiskTreeNodes(fsNodes), [fsNodes]);
  const visibleSummary = useMemo(
    () => summarizeDiskTreeNodes(filteredAndSortedNodes),
    [filteredAndSortedNodes],
  );

  const selectedSummary = useMemo(() => {
    if (selectedFsPaths.size === 0) return { count: 0, totalBytes: 0, hasFolders: false };
    let totalBytes = 0;
    let hasFolders = false;
    for (const node of fsNodes) {
      if (selectedFsPaths.has(node.relativePath)) {
        if (node.type === 'directory') hasFolders = true;
        else totalBytes += node.sizeBytes;
      }
    }
    return { count: selectedFsPaths.size, totalBytes, hasFolders };
  }, [fsNodes, selectedFsPaths]);

  const allVisibleSelected =
    filteredAndSortedNodes.length > 0 &&
    filteredAndSortedNodes.every((n) => selectedFsPaths.has(n.relativePath));

  const archiveDirView =
    fsArchivePath && fsArchiveListing
      ? listArchiveDirectoryAtPath(fsArchiveListing.entries, fsArchiveSubpath)
      : null;
  const archiveLeafName = fsArchivePath
    ? fsArchivePath.split('/').filter(Boolean).pop() || fsArchivePath
    : null;

  const canGoUp = Boolean(fsArchivePath) || parentPath !== null;
  const handleGoUp = () => {
    if (fsArchivePath) {
      if (fsArchiveSubpath) {
        const parentSub = getParentDiskPath(fsArchiveSubpath) ?? '';
        onArchiveSubpathChange(parentSub);
      } else {
        handleExitArchive();
      }
      return;
    }
    if (parentPath !== null) {
      navigateToDiskPath(parentPath);
    }
  };

  const handleHeaderSort = (field: DiskTreeSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  const activeSortPreset: DiskSortPreset =
    sortField === 'size'
      ? 'size_desc'
      : sortField === 'modified'
        ? 'modified_desc'
        : sortDir === 'desc'
          ? 'name_desc'
          : 'name_asc';

  const handleCopyCurrentPath = async () => {
    const targetPath = fsArchivePath
      ? `${downloadDir.replace(/\/+$/, '')}/${fsArchivePath}${fsArchiveSubpath ? `::${fsArchiveSubpath}` : ''}`
      : fsPath
        ? `${downloadDir.replace(/\/+$/, '')}/${fsPath}`
        : downloadDir;
    try {
      await navigator.clipboard.writeText(targetPath);
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1600);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const isFiltered = fsSearch.trim().length > 0;

  return (
    <div
      ref={panelRef}
      className="relative crt-panel-living border border-crt-border bg-crt-surface rounded-md overflow-hidden flex flex-col"
    >
      <div aria-hidden="true" className="crt-edge-beam">
        <span />
      </div>

      {/* Row 1: Explorer Path Navigation, Search & Sort Bar */}
      <div className="px-4 py-2.5 border-b border-crt-border bg-crt-bg flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            disabled={!canGoUp}
            onClick={handleGoUp}
            title={
              fsArchivePath
                ? fsArchiveSubpath
                  ? 'Up one folder inside archive'
                  : 'Exit archive back to disk folder'
                : parentPath !== null
                  ? `Up to ${parentPath || 'repository root'}`
                  : 'At repository root'
            }
            aria-label="Go up one level"
            className="inline-flex items-center justify-center h-8 w-8 border border-crt-border bg-crt-surface hover:bg-crt-elevated hover:border-crt-border-strong text-crt-text rounded transition-colors shrink-0 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <CornerLeftUp className="h-3.5 w-3.5" />
          </button>

          {/* Interactive Breadcrumb Trail */}
          <nav
            aria-label="Local disk path"
            className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto py-0.5 text-xs font-mono"
          >
            <button
              type="button"
              onClick={() => navigateToDiskPath('')}
              className={`inline-flex items-center gap-1.5 px-1.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !fsPath && !fsArchivePath
                  ? 'text-crt-phosphor font-medium'
                  : 'text-crt-muted hover:text-crt-phosphor hover:bg-crt-elevated/60'
              }`}
              title={downloadDir}
            >
              <HardDrive className="h-3.5 w-3.5 shrink-0" />
              <span>repository</span>
            </button>

            {breadcrumbs.map((seg, i) => {
              const target = breadcrumbs.slice(0, i + 1).join('/');
              const isCurrent = !fsArchivePath && i === breadcrumbs.length - 1;
              return (
                <span key={target} className="inline-flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3 w-3 text-crt-muted/70 shrink-0" />
                  <button
                    type="button"
                    onClick={() => navigateToDiskPath(target)}
                    className={`px-1.5 py-1 rounded transition-colors max-w-[240px] truncate cursor-pointer ${
                      isCurrent
                        ? 'text-crt-phosphor font-medium'
                        : 'text-crt-text hover:text-crt-phosphor hover:bg-crt-elevated/60'
                    }`}
                    title={seg}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}

            {fsArchivePath && archiveLeafName && (
              <span className="inline-flex items-center gap-1 shrink-0">
                <ChevronRight className="h-3 w-3 text-crt-muted/70 shrink-0" />
                <button
                  type="button"
                  onClick={() => onArchiveSubpathChange('')}
                  className={`inline-flex items-center gap-1.5 px-1.5 py-1 rounded transition-colors max-w-[260px] cursor-pointer ${
                    !fsArchiveSubpath
                      ? 'text-crt-phosphor font-medium'
                      : 'text-crt-text hover:text-crt-phosphor hover:bg-crt-elevated/60'
                  }`}
                  title={`Jump to root of ${archiveLeafName}`}
                >
                  <FileArchive className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{archiveLeafName}</span>
                </button>
              </span>
            )}

            {archiveDirView?.breadcrumbs.map((crumb, i, arr) => {
              const isCurrent = i === arr.length - 1;
              return (
                <span key={crumb.path} className="inline-flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3 w-3 text-crt-muted/70 shrink-0" />
                  <button
                    type="button"
                    onClick={() => onArchiveSubpathChange(crumb.path)}
                    className={`px-1.5 py-1 rounded transition-colors max-w-[200px] truncate cursor-pointer ${
                      isCurrent
                        ? 'text-crt-phosphor font-medium'
                        : 'text-crt-text hover:text-crt-phosphor hover:bg-crt-elevated/60'
                    }`}
                    title={crumb.label}
                  >
                    {crumb.label}
                  </button>
                </span>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => void handleCopyCurrentPath()}
            title={copiedPath ? 'Path copied' : 'Copy full path to clipboard'}
            aria-label="Copy current path"
            className="inline-flex items-center justify-center h-8 w-8 border border-crt-border bg-crt-surface hover:bg-crt-elevated hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors shrink-0 cursor-pointer"
          >
            {copiedPath ? (
              <Check className="h-3.5 w-3.5 text-crt-phosphor" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Right Controls: Filter Input + Sort */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={fsSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={fsArchivePath ? 'Filter archive contents...' : 'Filter this folder...'}
              aria-label={fsArchivePath ? 'Filter archive contents' : 'Filter current folder'}
              className={`pl-8 ${fsSearch ? 'pr-7' : 'pr-3'} h-8 text-xs bg-crt-surface border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-full sm:w-52 transition-colors ${
                isFiltered ? 'border-crt-phosphor/65' : 'border-crt-border'
              }`}
            />
            {fsSearch && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label={fsArchivePath ? 'Clear archive filter' : 'Clear folder filter'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 rounded cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {!fsArchivePath && (
            <select
              aria-label="Sort folder contents"
              value={activeSortPreset}
              onChange={(e) => {
                const { field, dir } = parseSortPreset(e.target.value as DiskSortPreset);
                setSortField(field);
                setSortDir(dir);
              }}
              className="h-8 px-2.5 text-xs bg-crt-surface border border-crt-border hover:border-crt-border-strong focus:border-crt-phosphor focus:outline-none text-crt-text rounded cursor-pointer"
            >
              <option value="name_asc">Sort: Name A–Z</option>
              <option value="name_desc">Sort: Name Z–A</option>
              <option value="size_desc">Sort: Largest First</option>
              <option value="modified_desc">Sort: Recently Modified</option>
            </select>
          )}
        </div>
      </div>

      {/* Row 2: Contextual Selection Bar OR Quiet Directory Summary Strip */}
      {!fsArchivePath && selectedSummary.count > 0 ? (
        <div className="px-4 py-2 border-b border-crt-border bg-crt-phosphor/8 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 text-crt-phosphor tabular-nums">
            <span className="font-medium">
              {selectedSummary.count.toLocaleString()} selected
            </span>
            {selectedSummary.totalBytes > 0 && (
              <>
                <span aria-hidden="true" className="text-crt-muted">
                  ·
                </span>
                <span className="text-crt-text">{formatBytes(selectedSummary.totalBytes)}</span>
              </>
            )}
            {selectedSummary.hasFolders && (
              <>
                <span aria-hidden="true" className="text-crt-muted">
                  ·
                </span>
                <span className="text-crt-amber">includes directories</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {confirmFsBulk ? (
              <>
                <button
                  type="button"
                  disabled={deletingKey === 'fs-bulk'}
                  onClick={() => void onDeletePaths(Array.from(selectedFsPaths))}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-crt-bg bg-crt-crimson hover:brightness-110 rounded transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingKey === 'fs-bulk'
                    ? 'Deleting...'
                    : `Confirm Delete (${selectedSummary.count})`}
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmBulkChange(false)}
                  className="px-2.5 py-1 text-xs border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onConfirmBulkChange(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs border border-crt-crimson/60 bg-crt-crimson/10 text-crt-crimson hover:bg-crt-crimson/20 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Selected ({selectedSummary.count})
                </button>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="px-2.5 py-1 text-xs border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-crt-border/70 bg-crt-surface flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-crt-muted">
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            {fsArchivePath ? (
              archiveDirView ? (
                <>
                  <span>
                    {archiveDirView.folders.length}{' '}
                    {archiveDirView.folders.length === 1 ? 'folder' : 'folders'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {archiveDirView.files.length}{' '}
                    {archiveDirView.files.length === 1 ? 'file' : 'files'}
                  </span>
                  {fsArchiveListing && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(fsArchiveListing.archiveSizeBytes)} archive</span>
                    </>
                  )}
                </>
              ) : (
                <span>Inspecting archive contents…</span>
              )
            ) : (
              <>
                <span>
                  {visibleSummary.folderCount.toLocaleString()}{' '}
                  {visibleSummary.folderCount === 1 ? 'folder' : 'folders'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {visibleSummary.fileCount.toLocaleString()}{' '}
                  {visibleSummary.fileCount === 1 ? 'file' : 'files'}
                </span>
                {visibleSummary.totalFileBytes > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-crt-text">{formatBytes(visibleSummary.totalFileBytes)}</span>
                  </>
                )}
                {isFiltered && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-crt-phosphor">
                      showing {filteredAndSortedNodes.length.toLocaleString()} of{' '}
                      {totalSummary.folderCount + totalSummary.fileCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSearchChange('')}
                      className="text-crt-amber hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <span
            className="text-[11px] text-crt-muted/80 truncate max-w-xs sm:max-w-md"
            title={downloadDir}
          >
            Root: {downloadDir}
          </span>
        </div>
      )}

      {/* Main Scroll-Bounded Explorer Viewport */}
      <div
        ref={scrollViewportRef}
        className="overflow-y-auto max-h-[calc(100vh-270px)] min-h-[360px]"
      >
        {fsArchivePath ? (
          fsArchiveLoading ? (
            <div className="p-5 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 bg-crt-bg border border-crt-border/70 rounded animate-pulse"
                />
              ))}
            </div>
          ) : fsArchiveError ? (
            <div className="p-10 text-center space-y-3 text-xs font-mono">
              <AlertCircle className="h-6 w-6 text-crt-crimson mx-auto" />
              <p className="text-crt-crimson">{fsArchiveError}</p>
              <button
                type="button"
                onClick={() => handleExitArchive()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs border border-crt-border text-crt-text hover:border-crt-phosphor rounded transition-colors cursor-pointer"
              >
                <CornerLeftUp className="h-3.5 w-3.5" />
                Back to Folder
              </button>
            </div>
          ) : fsArchiveListing ? (
            <ArchiveExplorer
              mode="inline"
              listing={fsArchiveListing}
              subpath={fsArchiveSubpath}
              onSubpathChange={onArchiveSubpathChange}
              externalSearch={fsSearch}
              onClearExternalSearch={() => onSearchChange('')}
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
              onExitArchive={() => handleExitArchive()}
            />
          ) : null
        ) : fsLoading ? (
          <div className="p-4 space-y-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-10 bg-crt-bg border border-crt-border/60 rounded animate-pulse"
              />
            ))}
          </div>
        ) : filteredAndSortedNodes.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Folder className="h-6 w-6 text-crt-muted mx-auto" />
            <p className="text-sm font-medium text-crt-text">
              {fsNodes.length === 0 ? 'This folder is empty' : 'No matching files or folders'}
            </p>
            <p className="text-xs text-crt-muted max-w-md mx-auto">
              {fsNodes.length === 0
                ? 'Downloaded ROMs, patches, translations, and ports mirror the repository folder layout here.'
                : `No entries in ${fsPath || 'repository root'} match "${fsSearch.trim()}".`}
            </p>
            <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear Filter
                </button>
              )}
              {parentPath !== null && (
                <button
                  type="button"
                  onClick={() => navigateToDiskPath(parentPath)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-border bg-crt-bg text-crt-text hover:border-crt-phosphor rounded transition-colors cursor-pointer"
                >
                  <CornerLeftUp className="h-3.5 w-3.5" />
                  Up to Parent Folder
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            {/* Sticky Table Column Header */}
            <div className="sticky top-0 z-10 grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_136px_96px_auto] lg:grid-cols-[auto_minmax(0,1fr)_136px_96px_148px_auto] items-center gap-3 px-4 py-2 border-b border-crt-border bg-crt-bg/95 backdrop-blur-sm text-[11px] font-mono text-crt-muted">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => onToggleAllVisible(filteredAndSortedNodes)}
                  aria-label="Select all visible entries"
                  className="accent-crt-phosphor cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={() => handleHeaderSort('name')}
                className="inline-flex items-center gap-1 text-left hover:text-crt-text transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Name</span>
                {sortField === 'name' &&
                  (sortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3 text-crt-phosphor" />
                  ) : (
                    <ArrowDown className="h-3 w-3 text-crt-phosphor" />
                  ))}
              </button>

              <span className="hidden md:block whitespace-nowrap">Type</span>

              <button
                type="button"
                onClick={() => handleHeaderSort('size')}
                className="hidden md:inline-flex items-center justify-end gap-1 hover:text-crt-text transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Size</span>
                {sortField === 'size' &&
                  (sortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3 text-crt-phosphor" />
                  ) : (
                    <ArrowDown className="h-3 w-3 text-crt-phosphor" />
                  ))}
              </button>

              <button
                type="button"
                onClick={() => handleHeaderSort('modified')}
                className="hidden lg:inline-flex items-center justify-end gap-1 hover:text-crt-text transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Modified</span>
                {sortField === 'modified' &&
                  (sortDir === 'asc' ? (
                    <ArrowUp className="h-3 w-3 text-crt-phosphor" />
                  ) : (
                    <ArrowDown className="h-3 w-3 text-crt-phosphor" />
                  ))}
              </button>

              <span className="text-right min-w-[104px] whitespace-nowrap">Actions</span>
            </div>

            <div className="divide-y divide-crt-border/70">
              {/* Parent Directory Quick Row (`..`) */}
              {parentPath !== null && !isFiltered && (
                <button
                  type="button"
                  onClick={() => navigateToDiskPath(parentPath)}
                  className="w-full h-10 px-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-left text-xs font-mono text-crt-muted hover:text-crt-phosphor hover:bg-crt-elevated/80 transition-colors cursor-pointer"
                >
                  <span className="w-[13px] shrink-0" aria-hidden="true" />
                  <span className="inline-flex items-center gap-2.5 min-w-0">
                    <CornerLeftUp className="h-4 w-4 shrink-0" />
                    <span className="font-medium">..</span>
                    <span className="text-crt-muted/75 truncate">
                      Parent folder ({parentPath || 'repository root'})
                    </span>
                  </span>
                  <span className="text-[11px] text-crt-muted/70 whitespace-nowrap">Back</span>
                </button>
              )}

              {filteredAndSortedNodes.map((node) => {
                const checked = selectedFsPaths.has(node.relativePath);
                const isDeletingThis = deletingKey === `fs-${node.relativePath}`;
                const isConfirmingThis = pendingDeletePath === node.relativePath;
                const info = classifyDiskEntry(node);

                return (
                  <div
                    key={node.relativePath}
                    className={`crt-table-row min-h-11 px-4 py-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_136px_96px_auto] lg:grid-cols-[auto_minmax(0,1fr)_136px_96px_148px_auto] items-center gap-3 transition-colors text-xs font-mono ${
                      checked
                        ? 'bg-crt-phosphor/8'
                        : isConfirmingThis
                          ? 'bg-crt-crimson/8'
                          : 'hover:bg-crt-elevated'
                    }`}
                  >
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleNode(node.relativePath)}
                        aria-label={`Select ${node.name}`}
                        className="accent-crt-phosphor cursor-pointer"
                      />
                    </div>

                    {/* Name & Primary Navigation Trigger */}
                    <div className="min-w-0">
                      {node.type === 'directory' ? (
                        <button
                          type="button"
                          onClick={() => navigateToDiskPath(node.relativePath)}
                          className="w-full flex items-center gap-2.5 text-left text-crt-text hover:text-crt-phosphor min-w-0 cursor-pointer group py-0.5"
                          title={`Open folder ${node.name}`}
                        >
                          <DiskEntryIcon kind="directory" />
                          <span className="truncate font-medium group-hover:underline">
                            {node.name}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-crt-muted/60 group-hover:text-crt-phosphor shrink-0 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ) : info.browsableArchive ? (
                        <button
                          type="button"
                          onClick={() => handleOpenArchiveRow(node.relativePath)}
                          className="w-full flex items-center gap-2.5 text-left text-crt-text hover:text-crt-phosphor min-w-0 cursor-pointer group py-0.5"
                          title={`Inspect archive contents of ${node.name}`}
                        >
                          <DiskEntryIcon kind="archive" />
                          <span className="truncate group-hover:underline">{node.name}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2.5 text-crt-text min-w-0 py-0.5">
                          <DiskEntryIcon kind={info.kind} />
                          <span className="truncate" title={node.name}>
                            {node.name}
                          </span>
                        </div>
                      )}
                      {/* Compact mobile metadata fallback */}
                      <div className="md:hidden mt-0.5 pl-6 text-[11px] text-crt-muted tabular-nums flex items-center gap-1.5">
                        <span>{info.label}</span>
                        {node.type === 'file' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatBytes(node.sizeBytes)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Type / Directory Item Count (Unboxed Clean Metadata) */}
                    <span
                      className={`hidden md:block truncate tabular-nums ${
                        info.kind === 'archive' || info.kind === 'rom' || info.kind === 'disc'
                          ? 'text-crt-text/80'
                          : 'text-crt-muted'
                      }`}
                    >
                      {info.label}
                    </span>

                    {/* Size */}
                    <span className="hidden md:block text-right text-crt-muted tabular-nums whitespace-nowrap">
                      {node.type === 'directory' ? '—' : formatBytes(node.sizeBytes)}
                    </span>

                    {/* Modified */}
                    <span className="hidden lg:block text-right text-crt-muted tabular-nums whitespace-nowrap">
                      {formatDateTime(node.modifiedAt)}
                    </span>

                    {/* Row Actions */}
                    <div className="flex items-center justify-end gap-1.5 min-w-[104px] shrink-0">
                      {isConfirmingThis ? (
                        <>
                          <button
                            type="button"
                            disabled={isDeletingThis}
                            onClick={() => {
                              setPendingDeletePath(null);
                              void onDeletePaths([node.relativePath]);
                            }}
                            className="px-2 py-1 text-[11px] font-semibold bg-crt-crimson text-crt-bg hover:brightness-110 rounded transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            {isDeletingThis ? 'Deleting…' : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeletePath(null)}
                            className="px-2 py-1 text-[11px] border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {info.browsableArchive && (
                            <button
                              type="button"
                              onClick={() => handleOpenArchiveRow(node.relativePath)}
                              title={`Inspect contents of ${node.name} without unpacking`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-crt-border hover:border-crt-phosphor text-crt-text hover:text-crt-phosphor rounded transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <FolderOpen className="h-3 w-3 shrink-0" />
                              <span className="hidden sm:inline">Inspect</span>
                            </button>
                          )}
                          {node.type === 'file' && (
                            <a
                              href={`/api/fs/download?path=${encodeURIComponent(node.relativePath)}`}
                              download={node.name}
                              aria-label={`Download ${node.name}`}
                              title={`Download ${node.name} from local mirror`}
                              className="inline-flex items-center justify-center p-1.5 border border-crt-border hover:border-crt-phosphor text-crt-muted hover:text-crt-phosphor rounded transition-colors"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            disabled={isDeletingThis}
                            onClick={() => setPendingDeletePath(node.relativePath)}
                            aria-label={`Delete ${node.name}`}
                            title={
                              node.type === 'directory'
                                ? `Delete folder "${node.name}" and all contents`
                                : `Delete file "${node.name}"`
                            }
                            className="p-1.5 border border-crt-border hover:border-crt-crimson text-crt-muted hover:text-crt-crimson rounded transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
