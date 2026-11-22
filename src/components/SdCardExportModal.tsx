import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Folder,
  FolderPlus,
  FolderSync,
  FolderTree,
  HardDrive,
  Loader2,
  Pencil,
  RefreshCw,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import type { ScraperConfigPublic } from '../types';
import {
  buildInstallModalTitle,
  formatDevicePath,
  groupInstallRowsByGame,
  summarizeDestinationFolders,
  type GroupedInstallGame,
  type GroupedInstallOption,
} from '../utils/deviceInstallView';
import { formatBytes } from '../utils/format';
import { formatDeviceActionLabel } from '../utils/gameDetailActions';
import { isFileSystemAccessSupported } from '../utils/sdCardFs';
import {
  formatInstallModalCtaLabel,
  formatInstallModalCtaTooltip,
  formatMountDeviceTooltip,
  formatRescanDeviceTooltip,
  formatSwitchDeviceTooltip,
  MOUNT_DEVICE_LABEL,
  RESCAN_DEVICE_LABEL,
  SWITCH_DEVICE_LABEL,
} from '../utils/storageActionCopy';

interface SdCardExportModalProps {
  installer: BulkStorageInstallerController;
  config: ScraperConfigPublic;
  onEditFolderMappings: () => void;
}

type BatchFilterTab = 'all' | 'versions' | 'installed';

export function SdCardExportModal({
  installer,
  onEditFolderMappings,
}: SdCardExportModalProps) {
  const {
    modalOpen,
    closeModal,
    job,
    metrics,
    isBusy,
    sdRootHandle,
    promptMountSdCard,
    mountError,
    folderScans,
    scanningCard,
    rescanMountedSdFolders,
    startReviewWrite,
    cancelInstall,
    dismissJob,
    toggleTargetSelection,
    selectOnlyTargetForItem,
    toggleGameIncluded,
    setAllGamesIncluded,
    excludeItemIds,
    updateRowTargetName,
  } = installer;

  const fsSupport = useMemo(() => isFileSystemAccessSupported(), []);

  // UI-only disclosure states reset cleanly per job
  const [expandedGameIds, setExpandedGameIds] = useState<Record<number, boolean>>({});
  const [multiPickByItemId, setMultiPickByItemId] = useState<Record<number, boolean>>({});
  const [editingOptionKey, setEditingOptionKey] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<BatchFilterTab>('all');

  useEffect(() => {
    setExpandedGameIds({});
    setMultiPickByItemId({});
    setEditingOptionKey(null);
    setActiveFilter('all');
  }, [job?.jobId]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingOptionKey) {
          e.preventDefault();
          setEditingOptionKey(null);
          return;
        }
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, closeModal, editingOptionKey]);

  const rows = job?.rows || [];
  const storageConfig = installer.effectiveStorageFolderConfig;
  const deviceName = sdRootHandle?.name || null;
  const shortDeviceName = formatDeviceActionLabel(deviceName, 20);

  const games = useMemo<GroupedInstallGame[]>(() => {
    if (!job) return [];
    return groupInstallRowsByGame({
      rows,
      storageConfig,
      filterContext: job.filterContext,
      folderScans,
      deviceName,
    });
  }, [job, rows, storageConfig, folderScans, deviceName]);

  const destinationSummary = useMemo(() => summarizeDestinationFolders(games), [games]);

  // Reset filter tab if it becomes empty after rescans/changes
  const gamesWithVersionsCount = useMemo(
    () => games.filter((g) => g.hasMultipleOptions).length,
    [games],
  );
  const alreadyOnDeviceGamesCount = useMemo(
    () => games.filter((g) => g.allSelectedAlreadyOnDevice).length,
    [games],
  );

  useEffect(() => {
    if (activeFilter === 'versions' && gamesWithVersionsCount === 0) {
      setActiveFilter('all');
    } else if (activeFilter === 'installed' && alreadyOnDeviceGamesCount === 0) {
      setActiveFilter('all');
    }
  }, [activeFilter, gamesWithVersionsCount, alreadyOnDeviceGamesCount]);

  if (!modalOpen || !job) return null;

  const isInspecting = job.phase === 'inspecting';
  const isRunning = job.phase === 'running' || job.phase === 'canceling';
  const isCanceling = job.phase === 'canceling';
  const isFinished =
    job.phase === 'completed' || job.phase === 'canceled' || job.phase === 'error';
  const isSingleGame = job.itemIds.length === 1;

  const installableGames = games.filter((g) => !g.hasNoPlayableRom && !g.isPlaceholder);
  const selectedGames = games.filter((g) => g.selectedOptions.length > 0);
  const selectedFilesCount = games.reduce((sum, g) => sum + g.selectedOptions.length, 0);
  const totalSelectedBytes = games.reduce((sum, g) => sum + g.totalSelectedBytes, 0);

  const selectedAlreadyOnDeviceIds = new Set(
    selectedGames.filter((g) => g.allSelectedAlreadyOnDevice).map((g) => g.itemId),
  );
  const allInstallableSelected =
    installableGames.length > 0 && selectedGames.length === installableGames.length;

  const visibleGames = games.filter((g) => {
    if (activeFilter === 'versions') return g.hasMultipleOptions;
    if (activeFilter === 'installed') return g.allSelectedAlreadyOnDevice;
    return true;
  });

  const modalTitle = buildInstallModalTitle({
    phase: job.phase,
    itemCount: job.itemIds.length,
    deviceName,
  });

  const modalSubtitle = isRunning
    ? 'You can close this window — installation continues in the background.'
    : isFinished
      ? job.phase === 'completed'
        ? 'All selected games have been processed.'
        : job.phase === 'canceled'
          ? 'Installation was stopped before finishing.'
          : 'Installation encountered an error.'
      : isSingleGame
        ? 'Latest primary ROM is pre-selected. Review destination path, version, or filename before installing.'
        : 'Latest primary ROM is pre-selected for each game. Review folders, versions, or filenames below.';

  const singleGame = isSingleGame ? games[0] || null : null;

  const renderWriteStatusText = (game: GroupedInstallGame) => {
    if (game.writeState === 'written' || game.writeState === 'upgraded') {
      return (
        <span className="inline-flex items-center gap-1 text-crt-phosphor">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{game.writeDetail || 'Installed'}</span>
        </span>
      );
    }
    if (game.writeState === 'error') {
      return (
        <span className="inline-flex items-center gap-1 text-crt-crimson">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{game.writeDetail || game.errorMessage || 'Failed'}</span>
        </span>
      );
    }
    if (game.writeState === 'canceled') {
      return <span className="text-crt-amber">{game.writeDetail || 'Canceled'}</span>;
    }
    if (game.writeState === 'writing' || game.writeState === 'inspecting') {
      return (
        <span className="inline-flex items-center gap-1.5 text-crt-amber">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>{game.writeDetail || 'Working...'}</span>
        </span>
      );
    }
    if (game.writeState === 'skipped' && (isRunning || isFinished || game.hasNoPlayableRom)) {
      return (
        <span className="text-crt-muted truncate">
          {game.writeDetail || game.errorMessage || 'Skipped'}
        </span>
      );
    }
    if (game.allSelectedAlreadyOnDevice) {
      return <span className="text-crt-muted">Already on {shortDeviceName}</span>;
    }
    if (game.hasUpgradeOnDevice) {
      return <span className="text-crt-amber">Replaces older version</span>;
    }
    return null;
  };

  const renderOptionList = (game: GroupedInstallGame) => {
    const isMultiPick = Boolean(multiPickByItemId[game.itemId]) || game.selectedOptions.length > 1;
    const distinctFolders = new Set(game.options.map((o) => o.targetFolder)).size;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-crt-muted">
            {isMultiPick
              ? `Choose versions to install (${game.selectedOptions.length} of ${game.options.length} selected)`
              : `Version (${game.options.length} available)`}
          </span>
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              setMultiPickByItemId((prev) => ({
                ...prev,
                [game.itemId]: !isMultiPick,
              }))
            }
            className="text-xs text-crt-muted hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {isMultiPick ? 'Single-pick mode' : 'Pick multiple'}
          </button>
        </div>

        <div className="border border-crt-border rounded bg-crt-bg divide-y divide-crt-border">
          {game.options.map((opt) => {
            const handleActivate = () => {
              if (isBusy) return;
              if (isMultiPick) {
                toggleTargetSelection(opt.rowKey, opt.target.id);
              } else {
                selectOnlyTargetForItem(game.itemId, opt.rowKey, opt.target.id);
              }
            };

            const metaParts: Array<{ text: string; tone?: 'phosphor' | 'amber' | 'muted' }> = [];
            if (opt.isRecommended) {
              metaParts.push({
                text: opt.smartReason || 'Recommended',
                tone: 'phosphor',
              });
            }
            if (
              opt.versionLabel &&
              (!opt.smartReason ||
                !opt.smartReason.toLowerCase().includes(opt.versionLabel.toLowerCase()))
            ) {
              metaParts.push({ text: opt.versionLabel });
            }
            metaParts.push({ text: opt.categoryLabel });
            if (distinctFolders > 1) {
              metaParts.push({ text: formatDevicePath(deviceName, opt.targetFolder) });
            }
            if (opt.deviceStatus === 'installed') {
              metaParts.push({ text: `Already on ${shortDeviceName}` });
            } else if (opt.deviceStatus === 'upgrade' && opt.replacesEntryName) {
              metaParts.push({
                text: `Replaces ${opt.replacesEntryName}`,
                tone: 'amber',
              });
            }
            if (game.hasMultipleArchives && opt.fileRole) {
              metaParts.push({ text: opt.fileRole });
            }

            return (
              <button
                key={opt.optionKey}
                type="button"
                disabled={isBusy}
                onClick={handleActivate}
                className={`w-full px-3.5 py-2.5 text-left flex items-start gap-3 transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  opt.isSelected ? 'bg-crt-phosphor/[0.06]' : 'hover:bg-crt-surface/70'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
                    isMultiPick ? 'rounded-[3px]' : 'rounded-full'
                  } ${
                    opt.isSelected
                      ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                      : 'border-crt-border-strong bg-crt-surface'
                  }`}
                >
                  {opt.isSelected &&
                    (isMultiPick ? (
                      <Check className="h-3 w-3 stroke-[2.5]" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-crt-bg" />
                    ))}
                </span>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`font-mono text-xs truncate ${
                        opt.isSelected ? 'text-crt-text font-medium' : 'text-crt-text/85'
                      }`}
                    >
                      {opt.target.displayName}
                    </span>
                    <span className="font-mono text-[11px] text-crt-muted tabular-nums whitespace-nowrap shrink-0">
                      {formatBytes(opt.target.sizeBytes)}
                    </span>
                  </div>

                  {metaParts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-crt-muted">
                      {metaParts.map((part, idx) => (
                        <span key={`${opt.optionKey}-meta-${idx}`} className="inline-flex items-center gap-1.5">
                          {idx > 0 && <span aria-hidden="true">·</span>}
                          <span
                            className={
                              part.tone === 'phosphor'
                                ? 'text-crt-phosphor'
                                : part.tone === 'amber'
                                  ? 'text-crt-amber'
                                  : undefined
                            }
                          >
                            {part.text}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderEditableDestinationRow = (opt: GroupedInstallOption) => {
    const isEditing = editingOptionKey === opt.optionKey;
    const folderPrefix = formatDevicePath(deviceName, opt.targetFolder);

    return (
      <div
        key={`dest-${opt.optionKey}`}
        className="flex flex-col gap-1.5 rounded border border-crt-border bg-crt-bg px-3.5 py-2.5"
      >
        {isEditing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-crt-muted shrink-0">{folderPrefix}</span>
            <input
              type="text"
              autoFocus
              value={opt.outputName}
              disabled={isBusy}
              aria-label={`Output filename for ${opt.target.displayName}`}
              onChange={(e) => updateRowTargetName(opt.rowKey, opt.target.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  setEditingOptionKey(null);
                }
              }}
              className="min-w-[14rem] flex-1 px-2.5 py-1 text-xs font-mono bg-crt-surface border border-crt-phosphor rounded text-crt-text focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setEditingOptionKey(null)}
              className="px-2.5 py-1 text-xs font-medium bg-crt-phosphor text-crt-bg rounded hover:brightness-110 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 font-mono text-xs truncate" title={opt.fullDestinationPath}>
              <span className="text-crt-muted">{folderPrefix}</span>
              <span className="text-crt-text font-medium">
                {opt.target.kind === 'disc_set'
                  ? `${opt.outputName.replace(/\.zip$/i, '')}/`
                  : opt.outputName}
              </span>
            </div>
            {!isBusy && !isFinished && (
              <button
                type="button"
                onClick={() => setEditingOptionKey(opt.optionKey)}
                className="inline-flex items-center gap-1 text-xs text-crt-muted hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Pencil className="h-3 w-3 shrink-0" />
                <span>Rename</span>
              </button>
            )}
          </div>
        )}

        {opt.deviceStatus === 'upgrade' && opt.replacesEntryName && (
          <p className="font-mono text-[11px] text-crt-amber">
            Replaces older file on {shortDeviceName}: {opt.replacesEntryName}
          </p>
        )}
        {opt.deviceStatus === 'installed' && (
          <p className="font-mono text-[11px] text-crt-muted">
            Already on {shortDeviceName} — will be skipped unless renamed.
          </p>
        )}
      </div>
    );
  };

  const primaryCtaLabel = formatInstallModalCtaLabel({
    mountedDeviceName: deviceName,
    isSingleGame,
    selectedCount: selectedGames.length,
    maxDeviceLen: 20,
  });

  const primaryCtaTooltip = formatInstallModalCtaTooltip({
    mountedDeviceName: deviceName,
    isSingleGame,
    selectedCount: selectedGames.length,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className={`crt-canvas crt-drawer-panel w-full ${
          isSingleGame ? 'max-w-2xl' : 'max-w-3xl'
        } max-h-[86vh] bg-crt-surface border border-crt-border-strong rounded-md flex flex-col shadow-2xl overflow-hidden`}
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-crt-border bg-crt-bg flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <HardDrive className="h-5 w-5 text-crt-phosphor shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-crt-text truncate">
                {modalTitle}
              </h2>
              <p className="text-xs text-crt-muted truncate">{modalSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close device installer"
            title={isBusy ? 'Hide window (installation continues in background)' : 'Close'}
            className="p-2 border border-crt-border hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Destination & Device Strip */}
        <div className="px-6 py-3.5 border-b border-crt-border bg-crt-bg/50 space-y-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0 text-xs">
              {sdRootHandle ? (
                <>
                  <span className="text-crt-muted">Device</span>
                  <span className="font-mono font-semibold text-crt-phosphor truncate max-w-[16rem]">
                    {sdRootHandle.name}
                  </span>
                  {fsSupport.supported && !isRunning && (
                    <>
                      <span aria-hidden="true" className="text-crt-muted">
                        ·
                      </span>
                      <button
                        type="button"
                        onClick={() => void promptMountSdCard()}
                        title={formatSwitchDeviceTooltip(isRunning)}
                        className="inline-flex items-center gap-1 text-crt-muted hover:text-crt-text hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <FolderSync className="h-3 w-3 shrink-0" />
                        <span>{SWITCH_DEVICE_LABEL}</span>
                      </button>
                    </>
                  )}
                  {!isRunning && (
                    <>
                      <span aria-hidden="true" className="text-crt-muted">
                        ·
                      </span>
                      <button
                        type="button"
                        disabled={scanningCard}
                        onClick={() => void rescanMountedSdFolders()}
                        title={formatRescanDeviceTooltip('folders', isRunning)}
                        className="inline-flex items-center gap-1 text-crt-muted hover:text-crt-text hover:underline whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw
                          className={`h-3 w-3 shrink-0 ${scanningCard ? 'animate-spin' : ''}`}
                        />
                        <span>{scanningCard ? 'Scanning...' : RESCAN_DEVICE_LABEL}</span>
                      </button>
                    </>
                  )}
                </>
              ) : fsSupport.supported ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-crt-muted">No storage device mounted</span>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => void promptMountSdCard()}
                    title={formatMountDeviceTooltip(fsSupport)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-crt-phosphor/70 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                    <span>{MOUNT_DEVICE_LABEL}</span>
                  </button>
                </div>
              ) : (
                <span className="font-mono text-crt-amber">{fsSupport.reason}</span>
              )}
            </div>

            <button
              type="button"
              onClick={onEditFolderMappings}
              title="Configure console destination folders in Device Export"
              className="inline-flex items-center gap-1.5 text-xs text-crt-muted hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderTree className="h-3.5 w-3.5 shrink-0" />
              <span>Change folders</span>
            </button>
          </div>

          {/* Clear Destination Path Summary */}
          {!isInspecting && destinationSummary.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-crt-muted">
              <Folder className="h-3.5 w-3.5 text-crt-phosphor/80 shrink-0" />
              <span className="font-sans text-crt-muted">
                {destinationSummary.length === 1 ? 'Folder' : 'Folders'}
              </span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                {destinationSummary.slice(0, 4).map((entry, idx) => (
                  <span
                    key={entry.folder}
                    className="inline-flex items-center gap-1.5 min-w-0"
                  >
                    {idx > 0 && <span aria-hidden="true">·</span>}
                    <span className="text-crt-text truncate">
                      {formatDevicePath(deviceName, entry.folder)}
                    </span>
                    {!isSingleGame && (
                      <span className="text-crt-muted tabular-nums">({entry.gameCount})</span>
                    )}
                  </span>
                ))}
                {destinationSummary.length > 4 && (
                  <span className="text-crt-muted tabular-nums">
                    · +{destinationSummary.length - 4} more
                  </span>
                )}
              </div>
            </div>
          )}

          {mountError && (
            <div className="flex items-center gap-2 text-xs font-mono text-crt-amber">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{mountError}</span>
            </div>
          )}

          {/* Live Transfer Progress */}
          {(isRunning || isFinished) && (() => {
            const active = isRunning ? job.activeTransfer : null;
            const liveActiveLabel = active
              ? active.stage === 'scanning_device'
                ? `Scanning ${shortDeviceName}…`
                : active.stage === 'inspecting'
                  ? 'Inspecting archive…'
                  : active.stage === 'extracting'
                    ? active.totalBytes
                      ? `Extracting (${formatBytes(active.totalBytes)})…`
                      : 'Extracting…'
                    : active.stage === 'finalizing'
                      ? 'Finalizing on device…'
                      : active.totalBytes && active.totalBytes > 0
                        ? `${formatBytes(active.bytesWritten)} / ${formatBytes(active.totalBytes)}${
                            active.bytesPerSec && active.bytesPerSec > 0
                              ? ` · ${formatBytes(active.bytesPerSec)}/s`
                              : ''
                          }${active.percent !== null ? ` · ${active.percent}%` : ''}`
                        : active.bytesWritten > 0
                          ? `${formatBytes(active.bytesWritten)}${
                              active.bytesPerSec && active.bytesPerSec > 0
                                ? ` · ${formatBytes(active.bytesPerSec)}/s`
                                : ''
                            }`
                          : null
              : null;
            const showIndeterminate =
              isRunning &&
              metrics.completedItems === 0 &&
              (!active ||
                active.stage === 'scanning_device' ||
                active.stage === 'inspecting' ||
                active.stage === 'extracting' ||
                (active.stage === 'writing' && active.percent === null));

            return (
              <div className="pt-2 border-t border-crt-border space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <span className="text-crt-text truncate">
                    {isCanceling
                      ? 'Stopping active transfer...'
                      : isRunning
                        ? `Installing ${metrics.completedItems} / ${metrics.totalItems} game${metrics.totalItems === 1 ? '' : 's'}${job.currentTitle ? ` · ${job.currentTitle}` : ''}`
                        : job.phase === 'canceled'
                          ? `Stopped at ${metrics.completedItems} / ${metrics.totalItems} games`
                          : job.phase === 'error'
                            ? `Error after ${metrics.completedItems} / ${metrics.totalItems} games`
                            : `Completed ${metrics.completedItems} / ${metrics.totalItems} game${metrics.totalItems === 1 ? '' : 's'}`}
                  </span>
                  <span className="text-crt-muted whitespace-nowrap shrink-0">
                    {liveActiveLabel ||
                      [
                        metrics.writtenItems > 0 ? `${metrics.writtenItems} installed` : null,
                        metrics.upgradedItems > 0 ? `${metrics.upgradedItems} updated` : null,
                        metrics.skippedItems > 0 ? `${metrics.skippedItems} already on device` : null,
                        metrics.failedItems > 0 ? `${metrics.failedItems} failed` : null,
                        metrics.canceledItems > 0 ? `${metrics.canceledItems} canceled` : null,
                        metrics.totalBytesWritten > 0 ? formatBytes(metrics.totalBytesWritten) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Storage installation progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={showIndeterminate ? undefined : metrics.progressPercent}
                  className="h-1.5 w-full overflow-hidden rounded-sm bg-crt-bg border border-crt-border/70"
                >
                  {showIndeterminate ? (
                    <div
                      className={`h-full crt-progress-indeterminate ${
                        active?.stage === 'writing' ? 'bg-crt-phosphor' : 'bg-crt-amber'
                      }`}
                    />
                  ) : (
                    <div
                      className={`h-full transition-all duration-150 ${
                        job.phase === 'error'
                          ? 'bg-crt-crimson'
                          : job.phase === 'canceled'
                            ? 'bg-crt-amber'
                            : 'bg-crt-phosphor crt-progress-beam'
                      }`}
                      style={{ width: `${metrics.progressPercent}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto">
          {job.errorMessage && (
            <div className="mx-6 mt-4 border border-crt-crimson/50 bg-crt-crimson/10 p-3.5 rounded text-xs font-mono text-crt-crimson">
              {job.errorMessage}
            </div>
          )}

          {games.length === 0 ? (
            <div className="p-10 text-center text-xs text-crt-muted">
              No archived releases queued for installation.
            </div>
          ) : isSingleGame && singleGame ? (
            /* Single-Game Focused View */
            <div className="p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h3 className="font-display text-base font-semibold text-crt-text">
                    {singleGame.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-crt-muted">
                    {singleGame.systemName && <span>{singleGame.systemName}</span>}
                    {singleGame.primaryPreviewOption && (
                      <>
                        {singleGame.systemName && <span aria-hidden="true">·</span>}
                        <span>{singleGame.primaryPreviewOption.categoryLabel}</span>
                      </>
                    )}
                    {singleGame.totalSelectedBytes > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatBytes(singleGame.totalSelectedBytes)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="font-mono text-xs shrink-0">
                  {renderWriteStatusText(singleGame)}
                </div>
              </div>

              {singleGame.isPlaceholder ? (
                <div className="flex items-center gap-2.5 py-6 text-xs font-mono text-crt-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-crt-phosphor shrink-0" />
                  <span>Inspecting archive contents...</span>
                </div>
              ) : singleGame.hasNoPlayableRom ? (
                <div className="rounded border border-crt-amber/40 bg-crt-amber/10 p-4 text-xs text-crt-amber">
                  {singleGame.errorMessage ||
                    'This archive does not contain a directly playable ROM file.'}
                </div>
              ) : (
                <>
                  {/* Destination File Preview */}
                  {singleGame.selectedOptions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-crt-muted">
                        {singleGame.selectedOptions.length === 1
                          ? 'Will be saved to'
                          : `Will save ${singleGame.selectedOptions.length} files`}
                      </p>
                      <div className="space-y-2">
                        {singleGame.selectedOptions.map((opt) => renderEditableDestinationRow(opt))}
                      </div>
                    </div>
                  )}

                  {/* Inline Version / Variant Selector when 2+ playable choices exist */}
                  {singleGame.hasMultipleOptions && !isRunning && !isFinished && (
                    <div className="pt-1">{renderOptionList(singleGame)}</div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* Multi-Game Batch View */
            <div>
              {/* Batch Filter & Quick Actions Bar */}
              {!isRunning && !isFinished && !isInspecting && games.length > 1 && (
                <div className="sticky top-0 z-10 px-6 py-2.5 border-b border-crt-border bg-crt-surface/95 backdrop-blur flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveFilter('all')}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === 'all'
                          ? 'bg-crt-elevated text-crt-text'
                          : 'text-crt-muted hover:text-crt-text'
                      }`}
                    >
                      All ({games.length})
                    </button>
                    {gamesWithVersionsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveFilter('versions')}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeFilter === 'versions'
                            ? 'bg-crt-elevated text-crt-text'
                            : 'text-crt-muted hover:text-crt-text'
                        }`}
                      >
                        Multiple versions ({gamesWithVersionsCount})
                      </button>
                    )}
                    {alreadyOnDeviceGamesCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveFilter('installed')}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeFilter === 'installed'
                            ? 'bg-crt-elevated text-crt-text'
                            : 'text-crt-muted hover:text-crt-text'
                        }`}
                      >
                        Already on device ({alreadyOnDeviceGamesCount})
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {selectedAlreadyOnDeviceIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => excludeItemIds(selectedAlreadyOnDeviceIds)}
                        className="text-xs text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Skip already installed ({selectedAlreadyOnDeviceIds.size})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAllGamesIncluded(!allInstallableSelected)}
                      className="text-xs text-crt-muted hover:text-crt-text hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {allInstallableSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                </div>
              )}

              {/* Unified Per-Game List */}
              <div className="divide-y divide-crt-border">
                {visibleGames.map((game) => {
                  const isIncluded = game.selectedOptions.length > 0;
                  const isExpanded = Boolean(expandedGameIds[game.itemId]);
                  const primaryOpt = game.primaryPreviewOption;
                  const isSingleSelectedOption = game.selectedOptions.length === 1;
                  const singleSelectedOpt = isSingleSelectedOption ? game.selectedOptions[0] : null;
                  const isEditingThisRow =
                    singleSelectedOpt !== null && editingOptionKey === singleSelectedOpt.optionKey;

                  return (
                    <div
                      key={game.itemId}
                      className={`px-6 py-3.5 transition-colors ${
                        !isIncluded && !game.isPlaceholder && !isRunning && !isFinished
                          ? 'opacity-55'
                          : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {!isRunning && !isFinished && (
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            disabled={isBusy || game.hasNoPlayableRom || game.isPlaceholder}
                            aria-label={`Include ${game.title}`}
                            onChange={() => toggleGameIncluded(game.itemId)}
                            className="accent-crt-phosphor mt-1 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                          />
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                              <span className="font-display text-sm font-semibold text-crt-text truncate">
                                {game.title}
                              </span>
                              {game.systemName && (
                                <span className="font-mono text-[11px] text-crt-muted">
                                  {game.systemName}
                                </span>
                              )}
                              {game.totalSelectedBytes > 0 && (
                                <>
                                  <span aria-hidden="true" className="font-mono text-[11px] text-crt-muted">
                                    ·
                                  </span>
                                  <span className="font-mono text-[11px] text-crt-muted tabular-nums">
                                    {formatBytes(game.totalSelectedBytes)}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="font-mono text-[11px] shrink-0">
                              {renderWriteStatusText(game)}
                            </div>
                          </div>

                          {/* Destination Preview Line or Inline Rename */}
                          {game.isPlaceholder ? (
                            <p className="font-mono text-[11px] text-crt-muted">
                              Checking archive...
                            </p>
                          ) : game.hasNoPlayableRom ? (
                            <p className="font-mono text-[11px] text-crt-muted">
                              {game.errorMessage || 'No playable ROM found'}
                            </p>
                          ) : isEditingThisRow && singleSelectedOpt ? (
                            <div className="pt-1">
                              {renderEditableDestinationRow(singleSelectedOpt)}
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div
                                className="min-w-0 font-mono text-[11px] text-crt-muted truncate"
                                title={primaryOpt?.fullDestinationPath}
                              >
                                {game.selectedOptions.length > 1 && primaryOpt ? (
                                  <>
                                    <span className="text-crt-text">
                                      {game.selectedOptions.length} files
                                    </span>
                                    <span className="mx-1.5">→</span>
                                    <span>{formatDevicePath(deviceName, primaryOpt.targetFolder)}</span>
                                  </>
                                ) : primaryOpt ? (
                                  <>
                                    <span>
                                      {formatDevicePath(deviceName, primaryOpt.targetFolder)}
                                    </span>
                                    <span className="text-crt-text">
                                      {primaryOpt.target.kind === 'disc_set'
                                        ? `${primaryOpt.outputName.replace(/\.zip$/i, '')}/`
                                        : primaryOpt.outputName}
                                    </span>
                                  </>
                                ) : null}
                              </div>

                              {!isRunning && !isFinished && (
                                <div className="flex items-center gap-3 shrink-0">
                                  {game.hasMultipleOptions && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedGameIds((prev) => ({
                                          ...prev,
                                          [game.itemId]: !isExpanded,
                                        }))
                                      }
                                      className="inline-flex items-center gap-1 text-xs text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                                    >
                                      <span>
                                        {game.selectedOptions.length > 1
                                          ? `${game.selectedOptions.length} of ${game.options.length} versions`
                                          : `Change version (${game.options.length})`}
                                      </span>
                                      {isExpanded ? (
                                        <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                                      ) : (
                                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                      )}
                                    </button>
                                  )}

                                  {singleSelectedOpt && (
                                    <button
                                      type="button"
                                      title="Rename output filename"
                                      onClick={() =>
                                        setEditingOptionKey(singleSelectedOpt.optionKey)
                                      }
                                      className="inline-flex items-center gap-1 text-xs text-crt-muted hover:text-crt-text transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                    >
                                      <Pencil className="h-3 w-3 shrink-0" />
                                      <span>Rename</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Inline Version Picker Expansion */}
                          {isExpanded && game.hasMultipleOptions && !isRunning && !isFinished && (
                            <div className="pt-3">{renderOptionList(game)}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-3.5 border-t border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-mono tabular-nums text-crt-muted">
            {isInspecting ? (
              <span className="text-crt-amber">
                Checking archives ({games.filter((g) => !g.isPlaceholder).length} / {games.length})...
              </span>
            ) : isRunning ? (
              <span className="text-crt-phosphor">
                {metrics.completedItems} / {metrics.totalItems} game
                {metrics.totalItems === 1 ? '' : 's'} processed
              </span>
            ) : isFinished ? (
              <span>
                {[
                  metrics.writtenItems + metrics.upgradedItems > 0
                    ? `${metrics.writtenItems + metrics.upgradedItems} installed`
                    : null,
                  metrics.skippedItems > 0 ? `${metrics.skippedItems} already on device` : null,
                  metrics.failedItems > 0 ? `${metrics.failedItems} failed` : null,
                  metrics.totalBytesWritten > 0 ? formatBytes(metrics.totalBytesWritten) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Complete'}
              </span>
            ) : selectedFilesCount === 0 ? (
              <span>Select at least one game to install</span>
            ) : isSingleGame ? (
              <span>
                {selectedFilesCount === 1 ? '1 file ready' : `${selectedFilesCount} files ready`}
                {totalSelectedBytes > 0 ? ` · ${formatBytes(totalSelectedBytes)}` : ''}
              </span>
            ) : (
              <span>
                {selectedGames.length.toLocaleString()} of {installableGames.length.toLocaleString()}{' '}
                games selected
                {totalSelectedBytes > 0 ? ` · ${formatBytes(totalSelectedBytes)}` : ''}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isBusy ? (
              <>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3.5 py-2 text-xs border border-crt-border bg-crt-surface text-crt-text hover:border-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Run in Background
                </button>
                <button
                  type="button"
                  disabled={isCanceling}
                  onClick={cancelInstall}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border border-crt-crimson/70 bg-crt-crimson/15 hover:bg-crt-crimson/25 text-crt-crimson rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  <Square className="h-3 w-3 fill-current shrink-0" />
                  {isCanceling ? 'Canceling...' : 'Cancel Install'}
                </button>
              </>
            ) : isFinished ? (
              <>
                {job.phase !== 'completed' && (
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-3.5 py-2 text-xs border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Close
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissJob}
                  className="px-4 py-2 text-xs font-semibold bg-crt-phosphor text-crt-bg hover:brightness-110 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3.5 py-2 text-xs border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Cancel
                </button>
                {job.mode === 'review' && (
                  <button
                    type="button"
                    disabled={selectedFilesCount === 0 || isInspecting}
                    title={primaryCtaTooltip}
                    onClick={() => void startReviewWrite()}
                    className="crt-cta-beam inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <HardDrive className="h-3.5 w-3.5 shrink-0" />
                    <span>{primaryCtaLabel}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
