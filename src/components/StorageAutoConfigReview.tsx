import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  FolderSearch,
  X,
} from 'lucide-react';
import {
  classifyDiscoveredConsoleDiff,
  type AutoConfigConsoleDiff,
  type DeviceAutoConfigResult,
  type DiscoveredConsoleCandidate,
  type DiscoveredConsoleMapping,
} from '../shared/storageAutoConfig';
import {
  getStorageRomCategoryShortLabel,
  type StorageFolderMappingConfig,
  type StorageRomCategoryKey,
} from '../shared/storageFolderMappings';

interface StorageAutoConfigReviewProps {
  result: DeviceAutoConfigResult;
  currentConfig: StorageFolderMappingConfig;
  selectedSlugs: Set<string>;
  chosenPathBySlug: Record<string, string>;
  includeTypeSubfolders: boolean;
  onToggleSlug: (slug: string) => void;
  onSetSelectedSlugs: (next: Set<string>) => void;
  onChooseCandidatePath: (slug: string, relativePath: string) => void;
  onToggleIncludeTypeSubfolders: (include: boolean) => void;
  onApply: () => void;
  onPickDifferentFolder: () => void;
  onDismiss: () => void;
}

interface EvaluatedMatchRow {
  match: DiscoveredConsoleMapping;
  activeCandidate: DiscoveredConsoleCandidate;
  diff: AutoConfigConsoleDiff;
  detectedSubEntries: [StorageRomCategoryKey, string][];
}

export function StorageAutoConfigReview({
  result,
  currentConfig,
  selectedSlugs,
  chosenPathBySlug,
  includeTypeSubfolders,
  onToggleSlug,
  onSetSelectedSlugs,
  onChooseCandidatePath,
  onToggleIncludeTypeSubfolders,
  onApply,
  onPickDifferentFolder,
  onDismiss,
}: StorageAutoConfigReviewProps) {
  const [showUnmatched, setShowUnmatched] = useState(false);

  const evaluatedRows = useMemo<EvaluatedMatchRow[]>(() => {
    return result.matches.map((match) => {
      const chosenPath = chosenPathBySlug[match.canonicalSlug] || match.recommendedPath;
      const activeCandidate =
        match.candidates.find((c) => c.relativePath === chosenPath) ?? match.candidates[0]!;
      const diff = classifyDiscoveredConsoleDiff(
        match.canonicalSlug,
        activeCandidate.relativePath,
        activeCandidate.detectedTypeSubfolders,
        includeTypeSubfolders,
        currentConfig,
      );
      const detectedSubEntries = Object.entries(activeCandidate.detectedTypeSubfolders) as [
        StorageRomCategoryKey,
        string,
      ][];
      return {
        match,
        activeCandidate,
        diff,
        detectedSubEntries,
      };
    });
  }, [result.matches, chosenPathBySlug, includeTypeSubfolders, currentConfig]);

  const counts = useMemo(() => {
    let newCount = 0;
    let updatesCustomCount = 0;
    let unchangedCount = 0;
    let withSubfoldersCount = 0;
    let selectedWithSubfoldersCount = 0;

    for (const row of evaluatedRows) {
      if (row.diff.kind === 'new') newCount += 1;
      else if (row.diff.kind === 'updates_custom') updatesCustomCount += 1;
      else unchangedCount += 1;

      if (row.detectedSubEntries.length > 0) {
        withSubfoldersCount += 1;
        if (selectedSlugs.has(row.match.canonicalSlug)) {
          selectedWithSubfoldersCount += 1;
        }
      }
    }

    return {
      newCount,
      updatesCustomCount,
      unchangedCount,
      withSubfoldersCount,
      selectedWithSubfoldersCount,
    };
  }, [evaluatedRows, selectedSlugs]);

  const handleSelectNewAndChanged = () => {
    const next = new Set<string>();
    for (const row of evaluatedRows) {
      if (row.diff.kind === 'new') {
        next.add(row.match.canonicalSlug);
      }
    }
    onSetSelectedSlugs(next);
  };

  const handleSelectAllActionable = () => {
    const next = new Set<string>();
    for (const row of evaluatedRows) {
      if (row.diff.kind !== 'unchanged') {
        next.add(row.match.canonicalSlug);
      }
    }
    if (next.size === 0) {
      for (const row of evaluatedRows) {
        next.add(row.match.canonicalSlug);
      }
    }
    onSetSelectedSlugs(next);
  };

  const handleClearSelection = () => {
    onSetSelectedSlugs(new Set());
  };

  const selectedCount = selectedSlugs.size;

  return (
    <div
      role="region"
      aria-label="Export device auto-configure review"
      className="border border-crt-phosphor/50 bg-crt-bg rounded p-4 space-y-4"
    >
      {/* Review Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-crt-border pb-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <FolderSearch className="h-4 w-4 text-crt-phosphor shrink-0" />
            <h3 className="text-sm font-semibold text-crt-text">
              Auto-Configure Preview
            </h3>
            <span className="text-xs font-mono text-crt-muted tabular-nums">
              · {result.rootLabel} · {result.detectedLayoutLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-crt-muted tabular-nums">
            <span>
              {result.stats.directoriesScanned.toLocaleString()} folder
              {result.stats.directoriesScanned === 1 ? '' : 's'} scanned
            </span>
            <span aria-hidden="true">·</span>
            <span className={result.matches.length > 0 ? 'text-crt-phosphor' : 'text-crt-muted'}>
              {result.matches.length} console{result.matches.length === 1 ? '' : 's'} matched
            </span>
            {counts.withSubfoldersCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {counts.withSubfoldersCount} with ROM-type subfolder
                  {counts.withSubfoldersCount === 1 ? '' : 's'}
                </span>
              </>
            )}
            {counts.unchangedCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{counts.unchangedCount} already matched</span>
              </>
            )}
            {result.stats.durationMs > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{result.stats.durationMs}ms</span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss auto-configure preview"
          className="p-1 text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {result.matches.length === 0 ? (
        <div className="py-5 text-center space-y-3">
          <p className="text-xs text-crt-muted max-w-lg mx-auto leading-relaxed">
            No recognizable console folders were found inside{' '}
            <span className="font-mono text-crt-text">{result.rootLabel}</span>. Try selecting your
            SD card root, <span className="font-mono text-crt-text">Roms</span> directory, or
            emulator base folder.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onPickDifferentFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderSearch className="h-3.5 w-3.5 shrink-0" />
              <span>Pick Different Folder</span>
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Selection & Subfolder Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={handleSelectNewAndChanged}
                className="px-2.5 py-1 text-xs font-mono border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Select New ({counts.newCount})
              </button>
              <button
                type="button"
                onClick={handleSelectAllActionable}
                className="px-2.5 py-1 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Select All Changed ({counts.newCount + counts.updatesCustomCount})
              </button>
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2.5 py-1 text-xs font-mono text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {counts.withSubfoldersCount > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-crt-text cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeTypeSubfolders}
                  onChange={(e) => onToggleIncludeTypeSubfolders(e.target.checked)}
                  className="accent-crt-phosphor"
                />
                <span>Include detected ROM-type subfolders ({counts.withSubfoldersCount})</span>
              </label>
            )}
          </div>

          {counts.updatesCustomCount > 0 && (
            <div className="text-[11px] font-mono text-amber-400/90">
              Note: {counts.updatesCustomCount} matched console
              {counts.updatesCustomCount === 1 ? ' already has' : 's already have'} a custom folder
              mapping and {counts.updatesCustomCount === 1 ? 'is' : 'are'} unchecked by default to
              prevent accidental overwrites.
            </div>
          )}

          {/* Discovered Consoles Checklist */}
          <div className="divide-y divide-crt-border border border-crt-border bg-crt-surface rounded max-h-[26rem] overflow-y-auto">
            {evaluatedRows.map(({ match, activeCandidate, diff, detectedSubEntries }) => {
              const checked = selectedSlugs.has(match.canonicalSlug);
              const hasAlternatives = match.candidates.length > 1;
              const statusLabel =
                diff.kind === 'new'
                  ? 'New'
                  : diff.kind === 'updates_custom'
                    ? 'Updates Custom'
                    : 'Already Matches';
              const statusClass =
                diff.kind === 'new'
                  ? 'text-crt-phosphor'
                  : diff.kind === 'updates_custom'
                    ? 'text-amber-400'
                    : 'text-crt-muted';

              return (
                <div
                  key={match.canonicalSlug}
                  className={`px-3 py-2.5 transition-colors ${
                    checked ? 'bg-crt-phosphor/[0.04]' : ''
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleSlug(match.canonicalSlug)}
                        aria-label={`Apply discovered path for ${match.displayName}`}
                        className="accent-crt-phosphor mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-medium text-crt-text">{match.displayName}</span>
                          <span className="font-mono text-[11px] text-crt-muted">
                            · {match.canonicalSlug}
                          </span>
                          <span className={`font-mono text-[11px] ${statusClass}`}>
                            · {statusLabel}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-mono">
                          {diff.baseChanged ? (
                            <>
                              <span className="text-crt-muted">/{diff.currentBasePath}</span>
                              <ArrowRight
                                aria-hidden="true"
                                className="h-3 w-3 text-crt-muted shrink-0"
                              />
                              <span className="text-crt-phosphor">
                                /{activeCandidate.relativePath}
                              </span>
                            </>
                          ) : (
                            <span className="text-crt-text">/{activeCandidate.relativePath}</span>
                          )}
                          {activeCandidate.fileCount > 0 && (
                            <span className="text-crt-muted tabular-nums">
                              · {activeCandidate.fileCount.toLocaleString()} file
                              {activeCandidate.fileCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>

                        {detectedSubEntries.length > 0 && (
                          <div
                            className={`text-[11px] font-mono ${
                              includeTypeSubfolders ? 'text-crt-muted' : 'text-crt-muted/50 line-through'
                            }`}
                          >
                            Subfolders:{' '}
                            {detectedSubEntries.map(([catKey, folderName], idx) => (
                              <span key={catKey}>
                                {idx > 0 && <span aria-hidden="true"> · </span>}
                                {getStorageRomCategoryShortLabel(catKey)} →{' '}
                                <span
                                  className={
                                    includeTypeSubfolders ? 'text-crt-text' : 'text-crt-muted/60'
                                  }
                                >
                                  /{folderName}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>

                    {hasAlternatives && (
                      <div className="pl-6 md:pl-0 shrink-0">
                        <select
                          aria-label={`Choose alternate folder path for ${match.displayName}`}
                          value={activeCandidate.relativePath}
                          onChange={(e) =>
                            onChooseCandidatePath(match.canonicalSlug, e.target.value)
                          }
                          className="max-w-full sm:max-w-[240px] px-2 py-1 text-[11px] font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                        >
                          {match.candidates.map((cand) => (
                            <option key={cand.relativePath} value={cand.relativePath}>
                              /{cand.relativePath}
                              {cand.fileCount > 0 ? ` (${cand.fileCount} files)` : ' (empty)'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Unmatched Folders Transparency Disclosure */}
          {result.unmatchedFolders.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                aria-expanded={showUnmatched}
                onClick={() => setShowUnmatched((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-[11px] font-mono text-crt-muted hover:text-crt-text transition-colors cursor-pointer"
              >
                {showUnmatched ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>
                  {result.unmatchedFolders.length} unrecognized folder
                  {result.unmatchedFolders.length === 1 ? '' : 's'} ignored
                </span>
              </button>
              {showUnmatched && (
                <div className="text-[11px] font-mono text-crt-muted/85 pl-5 leading-relaxed break-words">
                  {result.unmatchedFolders.map((folder, idx) => (
                    <span key={folder}>
                      {idx > 0 && <span aria-hidden="true"> · </span>}/{folder}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer Apply / Dismiss Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-crt-border">
            <div className="text-xs font-mono text-crt-muted tabular-nums">
              {selectedCount === 0 ? (
                <span>Select at least one console to merge into Device Export.</span>
              ) : (
                <span>
                  Ready to merge {selectedCount} console{selectedCount === 1 ? '' : 's'}
                  {includeTypeSubfolders && counts.selectedWithSubfoldersCount > 0
                    ? ` · ${counts.selectedWithSubfoldersCount} with ROM-type subfolders`
                    : ''}
                  {' · '}Untouched mappings stay preserved
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onDismiss}
                className="px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={onApply}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer"
              >
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span>Apply Selected ({selectedCount})</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
