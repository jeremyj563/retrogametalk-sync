import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  Gamepad2,
  Image as ImageIcon,
  RefreshCw,
  RotateCcw,
  SkipForward,
  Trash2,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import type { RepositoryItemRecord } from '../types';
import { formatBytes, formatDateTime } from '../utils/format';
import { readJsonSafely } from '../utils/http';

interface GameDetailDrawerProps {
  item: RepositoryItemRecord | null;
  activeRun: boolean;
  canSync: boolean;
  onClose: () => void;
  onItemUpdated: (updated: RepositoryItemRecord) => void;
  onRetryItem: (id: number, fileId?: number) => Promise<void>;
  onDeleteItem: (id: number) => Promise<void>;
}

interface LightboxState {
  slides: { src: string; label: string }[];
  index: number;
}

export function GameDetailDrawer({
  item,
  activeRun,
  canSync,
  onClose,
  onItemUpdated,
  onRetryItem,
  onDeleteItem,
}: GameDetailDrawerProps) {
  const [fetchingMeta, setFetchingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [failedScreenshots, setFailedScreenshots] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const assetVersion = item?.metadata?.fetchedAt ? `&v=${encodeURIComponent(item.metadata.fetchedAt)}` : '';
  const screenshotCount = item?.metadata?.screenshotLocalRelPaths?.length ?? item?.screenshotsCount ?? 0;

  useEffect(() => {
    setMetaError(null);
    setConfirmDelete(false);
    setCoverFailed(false);
    setFailedScreenshots(new Set());
    setLightbox(null);
  }, [item?.id, item?.metadata?.fetchedAt]);

  useEffect(() => {
    if (!item) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) {
          setLightbox(null);
        } else {
          onClose();
        }
        return;
      }
      if (lightbox && lightbox.slides.length > 1) {
        if (e.key === 'ArrowLeft') {
          setLightbox((prev) =>
            prev ? { ...prev, index: (prev.index - 1 + prev.slides.length) % prev.slides.length } : null,
          );
        } else if (e.key === 'ArrowRight') {
          setLightbox((prev) =>
            prev ? { ...prev, index: (prev.index + 1) % prev.slides.length } : null,
          );
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, lightbox, onClose]);

  const infoRows = useMemo(() => {
    if (!item) return [];
    const meta = item.metadata;
    const tagsLabel = item.releaseTags.length > 0 ? item.releaseTags.join(' · ') : item.releaseType;
    const rows: { label: string; value: string; mono?: boolean }[] = [
      { label: 'Console', value: meta?.consoleName || item.systemName },
      { label: 'Release Tags', value: tagsLabel },
      { label: 'Source', value: item.sources.length > 0 ? item.sources.join(', ') : '—' },
      { label: 'Genre', value: item.genres.length > 0 ? item.genres.join(', ') : '—' },
      { label: 'Region', value: item.regions.length > 0 ? item.regions.join(', ') : '—' },
      { label: 'Language', value: item.languages.length > 0 ? item.languages.join(', ') : '—' },
      { label: 'Publisher', value: item.publisher || '—' },
      { label: 'Developer', value: item.developer || '—' },
      { label: 'Year', value: item.releaseYear || '—', mono: true },
      { label: 'Total Size', value: item.fileSizeBytes > 0 ? formatBytes(item.fileSizeBytes) : '—', mono: true },
      { label: 'Included Files', value: `${item.filesCount} archive${item.filesCount === 1 ? '' : 's'}`, mono: true },
    ];

    if (meta?.formats?.length) {
      rows.push({ label: 'Format', value: meta.formats.join(', ') });
    }
    if (meta?.downloadsCount) {
      rows.push({ label: 'RGT Downloads', value: meta.downloadsCount, mono: true });
    }
    if (meta?.updatedDate || meta?.releasedAgo) {
      rows.push({
        label: 'Updated',
        value: [meta.updatedDate, meta.releasedAgo].filter(Boolean).join(' · '),
        mono: true,
      });
    }

    const covered = new Set([
      'console',
      'system',
      'genre',
      'genres',
      'region',
      'regions',
      'language',
      'languages',
      'publisher',
      'developer',
      'source',
      'sources',
      'format',
      'formats',
      'release tags',
      'year',
      'released',
      'downloads',
      'updated',
    ]);
    if (meta?.specs?.length) {
      for (const spec of meta.specs) {
        if (!covered.has(spec.label.trim().toLowerCase()) && spec.value.trim()) {
          rows.push({ label: spec.label, value: spec.value });
        }
      }
    }

    return rows;
  }, [item]);

  if (!item) return null;

  const hasCover = Boolean(item.coverLocalPath) && !coverFailed;
  const coverSrc = `/api/items/${item.id}/asset?kind=cover${assetVersion}`;
  const sourceUrl = item.metadata?.sourcePageUrl || item.remoteUrl.split('#')[0];
  const primaryDownloadFile =
    item.files.find((f) => f.status === 'downloaded' || f.status === 'skipped') || null;
  const hasFailedFiles = item.status === 'failed' || item.status === 'partial' || item.files.some((f) => f.status === 'failed');

  const handleFetchMetadata = async () => {
    setFetchingMeta(true);
    setMetaError(null);
    try {
      const res = await fetch(`/api/items/${item.id}/metadata`, { method: 'POST' });
      const parsed = await readJsonSafely<{ item?: RepositoryItemRecord; error?: string }>(res);
      if (!parsed.ok) {
        setMetaError(parsed.errorMessage || `Failed to mirror metadata (HTTP ${res.status})`);
        return;
      }
      if (parsed.data?.item) {
        setCoverFailed(false);
        setFailedScreenshots(new Set());
        onItemUpdated(parsed.data.item);
      }
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingMeta(false);
    }
  };

  const handleRetry = async (fileId?: number) => {
    setRetryingKey(fileId ? `file-${fileId}` : 'release');
    try {
      await onRetryItem(item.id, fileId);
    } finally {
      setRetryingKey(null);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteItem(item.id);
    } finally {
      setDeleting(false);
    }
  };

  const openCoverLightbox = () => {
    if (!hasCover) return;
    setLightbox({
      slides: [{ src: coverSrc, label: `${item.title} — Cover Art` }],
      index: 0,
    });
  };

  const openScreenshotLightbox = (startIndex: number) => {
    const slides: { src: string; label: string }[] = [];
    let mappedIndex = 0;
    for (let i = 0; i < screenshotCount; i += 1) {
      if (failedScreenshots.has(i)) continue;
      if (i === startIndex) mappedIndex = slides.length;
      slides.push({
        src: `/api/items/${item.id}/asset?kind=screenshot&index=${i}${assetVersion}`,
        label: `${item.title} — Screenshot ${i + 1} of ${screenshotCount}`,
      });
    }
    if (slides.length > 0) {
      setLightbox({ slides, index: mappedIndex });
    }
  };

  const subtitleParts = [
    item.publisher,
    item.developer && item.developer !== item.publisher ? item.developer : null,
    item.releaseYear,
    item.systemName,
    item.releaseTags.length > 0 ? item.releaseTags.join(' · ') : item.releaseType,
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl h-full bg-crt-surface border-l border-crt-border-strong flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <header className="px-6 py-4 border-b border-crt-border bg-crt-bg flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-xl font-bold text-crt-text tracking-tight break-words">
                {item.title}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 font-mono text-xs ${
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
            </div>
            <p className="text-xs font-mono text-crt-muted truncate">
              {subtitleParts.join(' · ')}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close game details"
            className="p-1.5 border border-crt-border bg-crt-surface hover:bg-crt-elevated hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Missing Metadata Prompt */}
          {!item.hasMetadata && (
            <div className="border border-crt-amber/40 bg-crt-amber/5 rounded-md p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-crt-amber">
                  Local artwork &amp; release specs have not been mirrored yet
                </p>
                <p className="text-xs text-crt-muted">
                  Fetch cover art, full-resolution screenshots, WP taxonomies, and description directly into the local release folder.
                </p>
              </div>
              <button
                type="button"
                disabled={fetchingMeta}
                onClick={() => void handleFetchMetadata()}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium bg-crt-amber text-crt-bg hover:brightness-110 rounded transition-colors whitespace-nowrap disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${fetchingMeta ? 'animate-spin' : ''}`} />
                {fetchingMeta ? 'Mirroring...' : 'Fetch Metadata & Artwork'}
              </button>
            </div>
          )}

          {metaError && (
            <div className="border border-crt-crimson/50 bg-crt-crimson/10 rounded-md px-4 py-3 text-xs font-mono text-crt-crimson">
              {metaError}
            </div>
          )}

          {item.errorMessage && (
            <div className="border border-crt-crimson/50 bg-crt-crimson/10 rounded-md px-4 py-3 text-xs font-mono text-crt-crimson">
              Transfer Error: {item.errorMessage}
            </div>
          )}

          {/* Hero Artwork + Info Specs */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
            {/* Cover Art */}
            <div className="sm:col-span-5">
              {hasCover ? (
                <button
                  type="button"
                  onClick={openCoverLightbox}
                  className="group relative w-full aspect-[3/4] border border-crt-border bg-crt-bg rounded-md overflow-hidden block focus:outline-none focus:border-crt-phosphor"
                  title="Click to inspect full-resolution cover art"
                >
                  <img
                    src={coverSrc}
                    alt={`${item.title} cover art`}
                    onError={() => setCoverFailed(true)}
                    className="w-full h-full object-contain bg-crt-bg"
                  />
                  <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono bg-crt-bg/90 border border-crt-border text-crt-text rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    <ZoomIn className="h-3 w-3 text-crt-phosphor" />
                    Inspect
                  </span>
                </button>
              ) : (
                <div className="w-full aspect-[3/4] border border-crt-border bg-crt-bg rounded-md flex flex-col items-center justify-center p-5 text-center space-y-2.5">
                  <Gamepad2 className="h-9 w-9 text-crt-border-strong" />
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-crt-muted">{item.systemName}</p>
                    <p className="text-xs text-crt-muted/70">No local cover art</p>
                  </div>
                </div>
              )}
            </div>

            {/* Structured Specs Table */}
            <div className="sm:col-span-7 border border-crt-border bg-crt-bg rounded-md overflow-hidden">
              <div className="px-4 py-2.5 border-b border-crt-border bg-crt-surface flex items-center justify-between">
                <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-crt-text">
                  Game Information
                </h3>
                {sourceUrl.startsWith('http') && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-phosphor hover:underline"
                  >
                    Source Page
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <dl className="divide-y divide-crt-border text-xs">
                {infoRows.map((row) => (
                  <div key={row.label} className="px-4 py-2 grid grid-cols-12 gap-3 items-baseline">
                    <dt className="col-span-4 text-crt-muted font-medium truncate">{row.label}</dt>
                    <dd
                      className={`col-span-8 text-crt-text break-words ${
                        row.mono ? 'font-mono text-[11px] tabular-nums' : ''
                      }`}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
                <div className="px-4 py-2 grid grid-cols-12 gap-3 items-baseline">
                  <dt className="col-span-4 text-crt-muted font-medium">Local Folder</dt>
                  <dd className="col-span-8 font-mono text-[11px] text-crt-muted break-all">
                    {item.remotePath}
                  </dd>
                </div>
                <div className="px-4 py-2 grid grid-cols-12 gap-3 items-baseline">
                  <dt className="col-span-4 text-crt-muted font-medium">Mirrored At</dt>
                  <dd className="col-span-8 font-mono text-[11px] text-crt-muted tabular-nums">
                    {formatDateTime(item.downloadedAt || item.discoveredAt)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Included Downloads List */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-crt-text flex items-center gap-2">
                <FileArchive className="h-4 w-4 text-crt-phosphor" />
                Included Downloads ({item.filesCount})
              </h3>
              <span className="font-mono text-[11px] text-crt-muted">
                Individual mirrored ROMs &amp; patches
              </span>
            </div>

            {item.files.length === 0 ? (
              <div className="border border-crt-border bg-crt-bg rounded-md p-4 text-xs font-mono text-crt-muted">
                No downloadable archive files indexed for this release yet.
              </div>
            ) : (
              <div className="border border-crt-border bg-crt-bg rounded-md divide-y divide-crt-border">
                {item.files.map((file) => {
                  const canDownload = file.status === 'downloaded' || file.status === 'skipped';
                  const isRetryingThis = retryingKey === `file-${file.id}`;
                  const showSecondaryFilename =
                    file.displayLabel && file.displayLabel.trim() !== file.filename.trim();

                  return (
                    <div
                      key={file.id}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-medium text-crt-text break-words">
                          {file.displayLabel || file.filename}
                        </div>
                        {showSecondaryFilename && (
                          <div className="font-mono text-[11px] text-crt-muted/80 truncate">
                            {file.filename}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-crt-muted tabular-nums">
                          <span className="text-crt-phosphor/90">{file.fileRole}</span>
                          <span>·</span>
                          <span>{file.fileSizeBytes > 0 ? formatBytes(file.fileSizeBytes) : 'Size pending'}</span>
                          <span>·</span>
                          <span
                            className={`inline-flex items-center gap-1 ${
                              file.status === 'downloaded'
                                ? 'text-crt-phosphor'
                                : file.status === 'skipped'
                                  ? 'text-crt-muted'
                                  : file.status === 'failed'
                                    ? 'text-crt-crimson'
                                    : 'text-crt-amber'
                            }`}
                          >
                            {file.status === 'downloaded' && <CheckCircle2 className="h-3 w-3" />}
                            {file.status === 'skipped' && <SkipForward className="h-3 w-3" />}
                            {file.status === 'failed' && <XCircle className="h-3 w-3" />}
                            {file.status}
                          </span>
                        </div>
                        {file.errorMessage && (
                          <div className="font-mono text-[11px] text-crt-crimson break-words">
                            {file.errorMessage}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {canDownload ? (
                          <a
                            href={`/api/items/${item.id}/download?fileId=${file.id}`}
                            download={file.filename}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </a>
                        ) : file.status === 'failed' ? (
                          <button
                            type="button"
                            disabled={retryingKey !== null || activeRun || !canSync}
                            title={!canSync ? 'Verify login in Operations before retrying' : undefined}
                            onClick={() => void handleRetry(file.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-amber/60 text-crt-amber hover:bg-crt-amber/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            <RotateCcw className={`h-3.5 w-3.5 ${isRetryingThis ? 'animate-spin' : ''}`} />
                            {isRetryingThis ? 'Retrying...' : 'Retry'}
                          </button>
                        ) : (
                          <span className="font-mono text-[11px] text-crt-muted px-2">
                            {file.status}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Screenshots Gallery */}
          {screenshotCount > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-crt-text flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-crt-phosphor" />
                  Screenshots ({screenshotCount})
                </h3>
                <span className="font-mono text-[11px] text-crt-muted">
                  Stored locally in release folder
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {Array.from({ length: screenshotCount }, (_, idx) => {
                  const failed = failedScreenshots.has(idx);
                  const src = `/api/items/${item.id}/asset?kind=screenshot&index=${idx}${assetVersion}`;
                  return failed ? (
                    <div
                      key={idx}
                      className="aspect-video border border-crt-border bg-crt-bg rounded flex items-center justify-center text-[11px] font-mono text-crt-muted"
                    >
                      Missing #{idx + 1}
                    </div>
                  ) : (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => openScreenshotLightbox(idx)}
                      className="group relative aspect-video border border-crt-border hover:border-crt-phosphor bg-crt-bg rounded overflow-hidden focus:outline-none focus:border-crt-phosphor"
                      title={`View screenshot ${idx + 1}`}
                    >
                      <img
                        src={src}
                        alt={`${item.title} screenshot ${idx + 1}`}
                        loading="lazy"
                        onError={() =>
                          setFailedScreenshots((prev) => {
                            const next = new Set(prev);
                            next.add(idx);
                            return next;
                          })
                        }
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                        <ZoomIn className="h-4 w-4 text-crt-phosphor opacity-0 group-hover:opacity-100 transition-opacity" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Description & Release Notes */}
          <section className="space-y-2.5">
            <h3 className="font-display text-sm font-semibold text-crt-text">
              Release Notes &amp; Description
            </h3>
            <div className="border border-crt-border bg-crt-bg rounded-md p-4">
              {item.metadata?.descriptionHtml ? (
                <div
                  className="text-xs leading-relaxed text-crt-text/95 space-y-2 [&_a]:text-crt-phosphor [&_a]:underline [&_a:hover]:brightness-110 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_h2]:font-display [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-crt-text [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-display [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-crt-text [&_h3]:mt-2.5 [&_h3]:mb-1 [&_strong]:text-crt-text [&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-crt-surface [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_pre]:font-mono [&_pre]:text-[11px] [&_pre]:bg-crt-surface [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_hr]:border-crt-border [&_hr]:my-3"
                  dangerouslySetInnerHTML={{ __html: item.metadata.descriptionHtml }}
                />
              ) : item.metadata?.descriptionText ? (
                <p className="text-xs leading-relaxed text-crt-text/90 whitespace-pre-wrap">
                  {item.metadata.descriptionText}
                </p>
              ) : (
                <p className="text-xs text-crt-muted">
                  No description available locally yet. Use &ldquo;Fetch Metadata &amp; Artwork&rdquo; to mirror release notes from RetroGameTalk.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Sticky Footer */}
        <footer className="px-6 py-3.5 border-t border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {primaryDownloadFile ? (
              <a
                href={`/api/items/${item.id}/download?fileId=${primaryDownloadFile.id}`}
                download={primaryDownloadFile.filename}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-crt-phosphor text-crt-bg hover:brightness-110 rounded transition-colors whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                {item.filesCount > 1 ? 'Download Primary ROM' : 'Download ROM'}
              </a>
            ) : (
              <span
                title="No mirrored ROM archive is currently available on disk"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-crt-elevated text-crt-muted border border-crt-border rounded opacity-60 cursor-not-allowed whitespace-nowrap"
              >
                <FileArchive className="h-3.5 w-3.5" />
                ROM Unavailable
              </span>
            )}

            <button
              type="button"
              disabled={fetchingMeta}
              onClick={() => void handleFetchMetadata()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-crt-border bg-crt-surface hover:bg-crt-elevated hover:border-crt-border-strong text-crt-text rounded transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetchingMeta ? 'animate-spin' : ''}`} />
              {fetchingMeta ? 'Refreshing...' : item.hasMetadata ? 'Refresh Metadata' : 'Fetch Metadata'}
            </button>

            {hasFailedFiles && (
              <button
                type="button"
                disabled={retryingKey !== null || activeRun || !canSync}
                title={!canSync ? 'Verify login in Operations before retrying' : undefined}
                onClick={() => void handleRetry()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${retryingKey === 'release' ? 'animate-spin' : ''}`} />
                {retryingKey === 'release' ? 'Retrying...' : 'Retry Failed'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-crt-crimson text-crt-bg hover:brightness-110 rounded transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 text-xs border border-crt-border text-crt-muted hover:text-crt-text rounded transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border border-crt-border hover:border-crt-crimson text-crt-muted hover:text-crt-crimson rounded transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
          </div>
        </footer>
      </div>

      {/* Screenshot & Cover Lightbox Overlay */}
      {lightbox && lightbox.slides[lightbox.index] && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4 sm:p-8"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
        >
          <div className="w-full max-w-5xl flex items-center justify-between gap-4 mb-3">
            <span className="font-mono text-xs text-crt-text truncate">
              {lightbox.slides[lightbox.index].label}
            </span>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close image lightbox"
              className="p-2 border border-crt-border bg-crt-surface hover:bg-crt-elevated text-crt-text rounded transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative flex-1 w-full max-w-5xl flex items-center justify-center min-h-0">
            {lightbox.slides.length > 1 && (
              <button
                type="button"
                aria-label="Previous image"
                onClick={() =>
                  setLightbox((prev) =>
                    prev ? { ...prev, index: (prev.index - 1 + prev.slides.length) % prev.slides.length } : null,
                  )
                }
                className="absolute left-2 z-10 p-2.5 border border-crt-border bg-crt-surface/90 hover:bg-crt-elevated text-crt-text rounded transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            <img
              src={lightbox.slides[lightbox.index].src}
              alt={lightbox.slides[lightbox.index].label}
              className="max-h-[82vh] max-w-full object-contain rounded border border-crt-border bg-crt-bg"
            />

            {lightbox.slides.length > 1 && (
              <button
                type="button"
                aria-label="Next image"
                onClick={() =>
                  setLightbox((prev) =>
                    prev ? { ...prev, index: (prev.index + 1) % prev.slides.length } : null,
                  )
                }
                className="absolute right-2 z-10 p-2.5 border border-crt-border bg-crt-surface/90 hover:bg-crt-elevated text-crt-text rounded transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
