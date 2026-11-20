import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Copy,
  CornerLeftUp,
  Disc,
  Download,
  Eye,
  File,
  FileArchive,
  FileCode2,
  FileText,
  Folder,
  Gamepad2,
  Search,
  X,
} from 'lucide-react';
import {
  filterArchiveEntries,
  listArchiveDirectoryAtPath,
  type ArchiveBrowseEntry,
  type ArchiveBrowseListing,
  type ArchiveEntryCategory,
  type ArchiveTextPreviewResult,
} from '../shared/archiveTree';
import { formatBytes } from '../utils/format';
import { readJsonSafely } from '../utils/http';

interface ArchiveExplorerProps {
  listing: ArchiveBrowseListing;
  mode?: 'drawer' | 'inline';
  subpath: string;
  onSubpathChange: (next: string) => void;
  externalSearch?: string;
  onClearExternalSearch?: () => void;
  buildEntryDownloadUrl: (entryPath: string) => string;
  buildEntryPreviewUrl: (entryPath: string) => string;
  onExitArchive?: () => void;
  onClose?: () => void;
}

const CATEGORY_META: Record<
  ArchiveEntryCategory,
  { label: string; badgeClass: string; iconClass: string }
> = {
  rom: {
    label: 'ROM',
    badgeClass: 'border-crt-phosphor/45 bg-crt-phosphor/10 text-crt-phosphor',
    iconClass: 'text-crt-phosphor',
  },
  disc: {
    label: 'DISC',
    badgeClass: 'border-crt-phosphor/45 bg-crt-phosphor/10 text-crt-phosphor',
    iconClass: 'text-crt-phosphor',
  },
  patch: {
    label: 'PATCH',
    badgeClass: 'border-crt-amber/50 bg-crt-amber/10 text-crt-amber',
    iconClass: 'text-crt-amber',
  },
  doc: {
    label: 'DOC',
    badgeClass: 'border-crt-border bg-crt-surface text-crt-muted',
    iconClass: 'text-crt-muted',
  },
  archive: {
    label: 'ARCHIVE',
    badgeClass: 'border-crt-amber/40 bg-crt-amber/10 text-crt-amber',
    iconClass: 'text-crt-amber',
  },
  other: {
    label: 'FILE',
    badgeClass: 'border-crt-border bg-crt-surface text-crt-muted',
    iconClass: 'text-crt-muted',
  },
};

function EntryCategoryIcon({ category }: { category: ArchiveEntryCategory }) {
  const cls = `h-4 w-4 shrink-0 ${CATEGORY_META[category].iconClass}`;
  switch (category) {
    case 'rom':
      return <Gamepad2 className={cls} />;
    case 'disc':
      return <Disc className={cls} />;
    case 'patch':
      return <FileCode2 className={cls} />;
    case 'doc':
      return <FileText className={cls} />;
    case 'archive':
      return <FileArchive className={cls} />;
    default:
      return <File className={cls} />;
  }
}

export function ArchiveExplorer({
  listing,
  mode = 'drawer',
  subpath,
  onSubpathChange,
  externalSearch,
  onClearExternalSearch,
  buildEntryDownloadUrl,
  buildEntryPreviewUrl,
  onExitArchive,
  onClose,
}: ArchiveExplorerProps) {
  const [localSearch, setLocalSearch] = useState('');
  const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<ArchiveTextPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);

  // Reset preview & local search when switching to a different archive
  useEffect(() => {
    setLocalSearch('');
    setPreviewLoadingPath(null);
    setPreviewData(null);
    setPreviewError(null);
    setCopiedPreview(false);
  }, [listing.sourceFilename, listing.archiveSizeBytes, listing.totalFiles]);

  const effectiveSearch = externalSearch !== undefined ? externalSearch : localSearch;
  const trimmedSearch = effectiveSearch.trim();

  const dirView = useMemo(
    () => listArchiveDirectoryAtPath(listing.entries, subpath),
    [listing.entries, subpath],
  );

  const searchResults = useMemo(
    () => (trimmedSearch ? filterArchiveEntries(listing.entries, trimmedSearch) : []),
    [listing.entries, trimmedSearch],
  );

  const handlePreviewEntry = async (entry: ArchiveBrowseEntry) => {
    if (previewData?.entryPath === entry.path) {
      setPreviewData(null);
      setPreviewError(null);
      return;
    }
    setPreviewLoadingPath(entry.path);
    setPreviewError(null);
    setCopiedPreview(false);
    try {
      const res = await fetch(buildEntryPreviewUrl(entry.path));
      const parsed = await readJsonSafely<{ preview?: ArchiveTextPreviewResult; error?: string }>(res);
      if (!parsed.ok || !parsed.data?.preview) {
        setPreviewError(parsed.errorMessage || `Preview failed (HTTP ${res.status})`);
        setPreviewData(null);
        return;
      }
      setPreviewData(parsed.data.preview);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewData(null);
    } finally {
      setPreviewLoadingPath(null);
    }
  };

  const handleCopyPreview = async () => {
    if (!previewData) return;
    try {
      await navigator.clipboard.writeText(previewData.text);
      setCopiedPreview(true);
      window.setTimeout(() => setCopiedPreview(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleClearSearch = () => {
    if (externalSearch !== undefined) {
      onClearExternalSearch?.();
    } else {
      setLocalSearch('');
    }
  };

  const renderFileRow = (entry: ArchiveBrowseEntry, showRelativeDir: boolean) => {
    const meta = CATEGORY_META[entry.category];
    const isPreviewing = previewData?.entryPath === entry.path;
    const isLoadingPreview = previewLoadingPath === entry.path;
    const parentDir =
      showRelativeDir && entry.path.includes('/')
        ? entry.path.slice(0, entry.path.lastIndexOf('/'))
        : null;

    return (
      <div
        key={entry.path}
        className={`crt-table-row min-h-10 px-4 py-2 flex items-center justify-between gap-3 transition-colors text-xs font-mono ${
          isPreviewing ? 'bg-crt-phosphor/8' : 'hover:bg-crt-elevated'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <EntryCategoryIcon category={entry.category} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-crt-text truncate" title={entry.path}>
                {entry.name}
              </span>
              <span
                className={`px-1.5 py-0.5 text-[10px] leading-none border rounded shrink-0 ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
            </div>
            {parentDir && (
              <div className="text-[10px] text-crt-muted truncate mt-0.5">{parentDir}/</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-crt-muted tabular-nums whitespace-nowrap">
            {formatBytes(entry.sizeBytes)}
          </span>
          {entry.previewableText && (
            <button
              type="button"
              disabled={isLoadingPreview}
              onClick={() => void handlePreviewEntry(entry)}
              title={isPreviewing ? 'Close text preview' : `Preview ${entry.name} without unpacking`}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] border rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                isPreviewing
                  ? 'border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor'
                  : 'border-crt-border text-crt-muted hover:border-crt-phosphor hover:text-crt-phosphor'
              }`}
            >
              <Eye className="h-3 w-3 shrink-0" />
              <span>{isLoadingPreview ? 'Reading...' : isPreviewing ? 'Hide' : 'Preview'}</span>
            </button>
          )}
          <a
            href={buildEntryDownloadUrl(entry.path)}
            download={entry.name}
            title={`Stream & download ${entry.name} directly from archive`}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-crt-border text-crt-muted hover:border-crt-phosphor hover:text-crt-phosphor rounded transition-colors whitespace-nowrap"
          >
            <Download className="h-3 w-3 shrink-0" />
            <span className="hidden sm:inline">Download</span>
          </a>
        </div>
      </div>
    );
  };

  const renderPreviewPanel = () => {
    if (!previewError && !previewData) return null;
    return (
      <div className="border-t border-crt-border bg-crt-bg/95 p-3.5 space-y-2">
        {previewError ? (
          <div className="flex items-center justify-between gap-2 text-xs font-mono text-crt-crimson">
            <span>{previewError}</span>
            <button
              type="button"
              onClick={() => setPreviewError(null)}
              className="text-crt-muted hover:text-crt-text p-1 rounded cursor-pointer"
              aria-label="Dismiss preview error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : previewData ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
                <span className="text-crt-phosphor font-semibold truncate">
                  {previewData.entryPath}
                </span>
                <span className="text-crt-muted tabular-nums shrink-0">
                  · {formatBytes(previewData.bytesRead)}
                  {previewData.truncated ? ' (truncated at 128 KB)' : ''}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleCopyPreview()}
                  className="inline-flex items-center gap-1 px-2 py-1 border border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors cursor-pointer"
                >
                  {copiedPreview ? (
                    <>
                      <Check className="h-3 w-3 text-crt-phosphor" />
                      <span className="text-crt-phosphor">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewData(null)}
                  aria-label="Close text preview"
                  className="p-1 border border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <pre className="max-h-72 overflow-auto p-3 text-[11px] leading-relaxed font-mono text-crt-text bg-crt-surface border border-crt-border rounded whitespace-pre-wrap break-words">
              {previewData.text || '(empty file)'}
            </pre>
          </>
        ) : null}
      </div>
    );
  };

  const renderBody = () => {
    if (listing.entries.length === 0) {
      return (
        <div className="p-8 text-center space-y-2 text-xs font-mono text-crt-muted">
          <FileArchive className="h-5 w-5 mx-auto text-crt-muted" />
          <p className="text-crt-text">Archive contains no readable file entries.</p>
        </div>
      );
    }

    if (trimmedSearch) {
      if (searchResults.length === 0) {
        return (
          <div className="p-8 text-center space-y-2.5 text-xs font-mono">
            <p className="text-crt-text">No entries inside this archive match &ldquo;{trimmedSearch}&rdquo;</p>
            <button
              type="button"
              onClick={handleClearSearch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-amber/60 bg-crt-amber/10 text-crt-amber hover:bg-crt-amber/20 rounded transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Clear Filter
            </button>
          </div>
        );
      }

      return (
        <div className="divide-y divide-crt-border">
          <div className="px-4 py-1.5 bg-crt-bg/60 text-[11px] font-mono text-crt-muted flex items-center justify-between gap-2">
            <span>
              {searchResults.length} matching entr{searchResults.length === 1 ? 'y' : 'ies'} across archive
            </span>
            <button
              type="button"
              onClick={handleClearSearch}
              className="text-crt-amber hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          {searchResults.map((entry) => renderFileRow(entry, true))}
        </div>
      );
    }

    const showParentRow = dirView.parentPath !== null || (mode === 'inline' && Boolean(onExitArchive));

    return (
      <div className="divide-y divide-crt-border">
        {showParentRow && (
          <button
            type="button"
            onClick={() => {
              if (dirView.parentPath !== null) {
                onSubpathChange(dirView.parentPath);
              } else {
                onExitArchive?.();
              }
            }}
            className="w-full crt-table-row h-10 px-4 flex items-center justify-between gap-4 hover:bg-crt-elevated transition-colors text-xs font-mono text-left cursor-pointer"
          >
            <span className="flex items-center gap-2.5 text-crt-muted hover:text-crt-phosphor">
              <CornerLeftUp className="h-3.5 w-3.5 text-crt-amber shrink-0" />
              <span>
                {dirView.parentPath !== null ? '.. (Parent folder)' : '.. (Exit archive to disk folder)'}
              </span>
            </span>
            <span className="text-[11px] text-crt-muted">Up</span>
          </button>
        )}

        {dirView.folders.map((folder) => (
          <button
            key={folder.path}
            type="button"
            onClick={() => onSubpathChange(folder.path)}
            className="w-full crt-table-row h-10 px-4 flex items-center justify-between gap-4 hover:bg-crt-elevated transition-colors text-xs font-mono text-left cursor-pointer"
          >
            <span className="flex items-center gap-2.5 text-crt-text hover:text-crt-phosphor min-w-0">
              <Folder className="h-4 w-4 text-crt-amber shrink-0" />
              <span className="truncate">{folder.name}/</span>
            </span>
            <span className="flex items-center gap-4 text-crt-muted tabular-nums shrink-0">
              <span>
                {folder.fileCount} file{folder.fileCount === 1 ? '' : 's'}
              </span>
              <span className="hidden sm:inline">{formatBytes(folder.totalBytes)}</span>
              <ChevronRight className="h-3.5 w-3.5 text-crt-muted" />
            </span>
          </button>
        ))}

        {dirView.files.map((entry) => renderFileRow(entry, false))}
      </div>
    );
  };

  if (mode === 'inline') {
    return (
      <div>
        <div className="px-4 py-2 border-b border-crt-border bg-crt-bg/50 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-crt-muted">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-1.5 py-0.5 text-[10px] font-semibold border border-crt-phosphor/45 bg-crt-phosphor/10 text-crt-phosphor rounded uppercase">
              {listing.archiveFormat}
            </span>
            <span className="tabular-nums">
              {listing.totalFiles.toLocaleString()} file{listing.totalFiles === 1 ? '' : 's'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {formatBytes(listing.totalUncompressedBytes)} uncompressed
            </span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="hidden sm:inline text-crt-muted/80">
              Inspected in-place without unpacking to disk
            </span>
          </div>
          {onExitArchive && (
            <button
              type="button"
              onClick={onExitArchive}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border border-crt-border text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3 w-3" />
              Exit Archive
            </button>
          )}
        </div>
        {renderBody()}
        {renderPreviewPanel()}
      </div>
    );
  }

  // Drawer mode: self-contained recessed CRT archive explorer panel
  return (
    <div className="border border-crt-phosphor/50 bg-crt-bg rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-crt-border flex flex-wrap items-center justify-between gap-2.5">
        <div className="space-y-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileArchive className="h-4 w-4 text-crt-phosphor shrink-0" />
            <span className="text-xs font-semibold text-crt-phosphor">
              Archive Contents · {listing.archiveFormat.toUpperCase()}
            </span>
            <span className="font-mono text-[11px] text-crt-muted tabular-nums">
              ({listing.totalFiles.toLocaleString()} file{listing.totalFiles === 1 ? '' : 's'} ·{' '}
              {formatBytes(listing.totalUncompressedBytes)} uncompressed)
            </span>
          </div>
          <div className="font-mono text-[11px] text-crt-muted truncate">
            {listing.sourceFilename} — browsed in-place without unpacking to disk
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {listing.totalFiles > 6 && externalSearch === undefined && (
            <div className="relative">
              <Search className="h-3 w-3 text-crt-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Filter files..."
                aria-label="Filter archive entries"
                className="pl-7 pr-6 py-1 text-[11px] font-mono bg-crt-surface border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor w-40"
              />
              {localSearch && (
                <button
                  type="button"
                  onClick={() => setLocalSearch('')}
                  aria-label="Clear archive filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close archive contents panel"
              className="p-1 text-crt-muted hover:text-crt-text rounded cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Internal archive breadcrumbs */}
      <div className="px-4 py-2 border-b border-crt-border bg-crt-surface/60 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => onSubpathChange('')}
            className="text-crt-phosphor hover:underline truncate max-w-[220px] cursor-pointer"
            title={listing.sourceFilename}
          >
            {listing.sourceFilename}
          </button>
          {dirView.breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="inline-flex items-center gap-1.5 min-w-0">
              <ChevronRight className="h-3 w-3 text-crt-muted shrink-0" />
              <button
                type="button"
                onClick={() => onSubpathChange(crumb.path)}
                className="text-crt-text hover:text-crt-phosphor hover:underline truncate cursor-pointer"
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        <span className="text-crt-muted tabular-nums shrink-0">
          {trimmedSearch
            ? `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'}`
            : `${dirView.folders.length + dirView.files.length} item${
                dirView.folders.length + dirView.files.length === 1 ? '' : 's'
              }`}
        </span>
      </div>

      <div className="max-h-96 overflow-y-auto">{renderBody()}</div>
      {renderPreviewPanel()}
    </div>
  );
}
