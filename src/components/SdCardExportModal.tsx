import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CheckCircle2,
  Download,
  FolderInput,
  HardDrive,
  Loader2,
  RefreshCw,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import {
  DEVICE_PRESETS,
  resolveSystemFolderForDevice,
  type DevicePresetId,
} from '../shared/devicePresets';
import type { ScraperConfigPublic } from '../types';
import { formatBytes } from '../utils/format';
import { findUpgradeCandidateOnCard, isFileSystemAccessSupported } from '../utils/sdCardFs';

interface SdCardExportModalProps {
  installer: BulkStorageInstallerController;
  config: ScraperConfigPublic;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
}

export function SdCardExportModal({
  installer,
  config,
  onSaveConfig,
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
    devicePreset,
    setDevicePreset,
    folderMapDraft,
    setFolderMapDraft,
    folderScans,
    scanningCard,
    rescanMountedSdFolders,
    startReviewWrite,
    cancelInstall,
    dismissJob,
    toggleTargetSelection,
    selectAllVariantsForRow,
    autoPickSmartPrimaries,
    updateRowTargetName,
  } = installer;

  const fsSupport = useMemo(() => isFileSystemAccessSupported(), []);
  const [showFolderEditor, setShowFolderEditor] = useState(false);
  const [savingDevicePrefs, setSavingDevicePrefs] = useState(false);

  // Spotlight & round-robin jump state for unresolved multi-ROM items
  const rowElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const jumpCursorRef = useRef(-1);
  const spotlightNonceRef = useRef(0);
  const [spotlightItem, setSpotlightItem] = useState<{ itemId: number; nonce: number } | null>(null);

  useEffect(() => {
    jumpCursorRef.current = -1;
    setSpotlightItem(null);
  }, [job?.jobId]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, closeModal]);

  const rows = job?.rows || [];

  const uniqueSystemsInQueue = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.systemName).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [rows]);

  // Compute unresolved multi-ROM items (items with >1 competing playable variants and 0 currently checked)
  const unresolvedMultiItems = useMemo(() => {
    const selectedByItem = new Map<number, number>();
    const firstRowKeyByItem = new Map<number, string>();
    const multiItemOrder: number[] = [];
    const seenMulti = new Set<number>();

    for (const row of rows) {
      selectedByItem.set(
        row.itemId,
        (selectedByItem.get(row.itemId) || 0) + row.selectedTargetIds.length,
      );
      if (row.isMultiChoiceItem && !seenMulti.has(row.itemId)) {
        seenMulti.add(row.itemId);
        multiItemOrder.push(row.itemId);
        firstRowKeyByItem.set(row.itemId, row.rowKey);
      }
    }

    const out: { itemId: number; firstRowKey: string }[] = [];
    for (const itemId of multiItemOrder) {
      if ((selectedByItem.get(itemId) || 0) === 0) {
        const firstRowKey = firstRowKeyByItem.get(itemId);
        if (firstRowKey) {
          out.push({ itemId, firstRowKey });
        }
      }
    }
    return out;
  }, [rows]);

  if (!modalOpen || !job) return null;

  const isInspecting = job.phase === 'inspecting';
  const isRunning = job.phase === 'running' || job.phase === 'canceling';
  const isCanceling = job.phase === 'canceling';
  const isFinished =
    job.phase === 'completed' || job.phase === 'canceled' || job.phase === 'error';

  const totalSelectedTargets = rows.reduce((acc, r) => acc + r.selectedTargetIds.length, 0);

  const handleSaveDevicePrefs = async () => {
    setSavingDevicePrefs(true);
    try {
      await onSaveConfig({
        devicePreset,
        deviceFolderMap: folderMapDraft,
      });
    } finally {
      setSavingDevicePrefs(false);
    }
  };

  const handleJumpToNextUnresolved = () => {
    if (unresolvedMultiItems.length === 0) return;
    const nextIdx = (jumpCursorRef.current + 1) % unresolvedMultiItems.length;
    jumpCursorRef.current = nextIdx;
    const target = unresolvedMultiItems[nextIdx];
    const el = rowElementRefs.current[target.firstRowKey];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const nextNonce = ++spotlightNonceRef.current;
    setSpotlightItem({ itemId: target.itemId, nonce: nextNonce });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Install Prepared ROMs to Storage Device"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="crt-canvas crt-drawer-panel w-full max-w-4xl max-h-[90vh] bg-crt-surface border border-crt-border-strong rounded-md flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b border-crt-border bg-crt-bg flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <HardDrive className="h-5 w-5 text-crt-phosphor shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-crt-text truncate">
                {job.mode === 'express'
                  ? 'Express Storage Device Installer'
                  : 'Install Prepared ROMs to Storage Device'}
              </h2>
              <p className="text-xs text-crt-muted truncate">
                {isBusy
                  ? 'Transfers continue in the background if you close this window.'
                  : 'Extracts playable ROMs & ODE disc sets directly into console folders on your target storage device.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close storage device installer"
            title={isBusy ? 'Hide window (installation continues in background)' : 'Close window'}
            className="p-2 border border-crt-border hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Device Mount & Folder Mapping Strip */}
        <div className="px-6 py-4 border-b border-crt-border bg-crt-surface space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {fsSupport.supported ? (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => void promptMountSdCard()}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    sdRootHandle
                      ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/15'
                      : 'border-crt-phosphor bg-crt-phosphor text-crt-bg hover:brightness-110'
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                  {sdRootHandle
                    ? `Device Mounted: ${sdRootHandle.name} (Change)`
                    : 'Mount Storage Device / Target Folder'}
                </button>
              ) : (
                <span className="text-xs font-mono text-crt-amber">{fsSupport.reason}</span>
              )}

              <select
                value={devicePreset}
                disabled={isRunning}
                onChange={(e) => setDevicePreset(e.target.value)}
                aria-label="Select target device folder preset"
                className="px-3 py-2 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-50"
              >
                {Object.values(DEVICE_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    Preset: {preset.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => setShowFolderEditor((v) => !v)}
                className="px-3 py-2 text-xs border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              >
                {showFolderEditor ? 'Hide Folder Map' : 'Edit Folder Map'}
              </button>
            </div>

            {sdRootHandle && (
              <button
                type="button"
                disabled={scanningCard || isRunning}
                onClick={() => void rescanMountedSdFolders()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${scanningCard ? 'animate-spin' : ''}`} />
                {scanningCard ? 'Scanning Device...' : 'Rescan Device'}
              </button>
            )}
          </div>

          {mountError && (
            <div className="flex items-center gap-2 text-xs font-mono text-crt-amber">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{mountError}</span>
            </div>
          )}

          {/* Live progress summary bar when actively running or finished */}
          {(isRunning || isFinished) && (
            <div className="pt-2 border-t border-crt-border space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                <span className="text-crt-text">
                  {isCanceling
                    ? 'Stopping active transfer...'
                    : isRunning
                      ? `Installing ${metrics.completedItems} / ${metrics.totalItems} games`
                      : job.phase === 'canceled'
                        ? `Stopped at ${metrics.completedItems} / ${metrics.totalItems} games`
                        : job.phase === 'error'
                          ? `Error after ${metrics.completedItems} / ${metrics.totalItems} games`
                          : `Completed ${metrics.completedItems} / ${metrics.totalItems} games`}
                  {job.currentTitle && isRunning ? ` · ${job.currentTitle}` : ''}
                </span>
                <span className="text-crt-muted">
                  {[
                    metrics.writtenItems > 0 ? `${metrics.writtenItems} written` : null,
                    metrics.upgradedItems > 0 ? `${metrics.upgradedItems} upgraded` : null,
                    metrics.skippedItems > 0 ? `${metrics.skippedItems} already on device` : null,
                    metrics.failedItems > 0 ? `${metrics.failedItems} failed` : null,
                    metrics.canceledItems > 0 ? `${metrics.canceledItems} canceled` : null,
                    metrics.totalBytesWritten > 0 ? formatBytes(metrics.totalBytesWritten) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <progress
                max={100}
                value={isRunning && metrics.progressPercent === 0 ? 3 : metrics.progressPercent}
                aria-label="Storage installation progress"
                className={`block h-1.5 w-full overflow-hidden rounded-xs bg-crt-bg [&::-webkit-progress-bar]:bg-crt-bg [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-200 ${
                  job.phase === 'error'
                    ? '[&::-webkit-progress-value]:bg-crt-crimson [&::-moz-progress-bar]:bg-crt-crimson'
                    : job.phase === 'canceled'
                      ? '[&::-webkit-progress-value]:bg-crt-amber [&::-moz-progress-bar]:bg-crt-amber'
                      : '[&::-webkit-progress-value]:bg-crt-phosphor [&::-moz-progress-bar]:bg-crt-phosphor'
                }`}
              />
            </div>
          )}

          {showFolderEditor && uniqueSystemsInQueue.length > 0 && (
            <div className="pt-3 border-t border-crt-border space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-crt-muted">
                  Map each console in this queue to its relative folder on the target storage device (
                  {DEVICE_PRESETS[devicePreset as DevicePresetId]?.name || 'Custom'}).
                </span>
                <button
                  type="button"
                  disabled={savingDevicePrefs}
                  onClick={() => void handleSaveDevicePrefs()}
                  className="px-2.5 py-1 text-xs font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {savingDevicePrefs ? 'Saving...' : 'Save Mapping Defaults'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {uniqueSystemsInQueue.map((sys) => {
                  const key = sys.toLowerCase();
                  const resolved = resolveSystemFolderForDevice(sys, devicePreset, folderMapDraft);
                  return (
                    <div key={sys} className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-crt-muted truncate w-28 shrink-0">{sys}</span>
                      <span className="text-crt-muted">→</span>
                      <input
                        type="text"
                        value={folderMapDraft[key] ?? ''}
                        placeholder={resolved}
                        onChange={(e) =>
                          setFolderMapDraft((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        className="flex-1 min-w-0 px-2 py-1 bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Queue Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {job.errorMessage && (
            <div className="border border-crt-crimson/50 bg-crt-crimson/10 p-4 rounded text-xs font-mono text-crt-crimson">
              {job.errorMessage}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="p-10 text-center text-xs text-crt-muted border border-crt-border bg-crt-bg rounded">
              No archived releases queued for installation.
            </div>
          ) : (
            rows.map((row) => {
              const folder = row.systemName
                ? resolveSystemFolderForDevice(row.systemName, devicePreset, folderMapDraft)
                : 'ROMs';
              const scan = folderScans[folder];
              const isMulti = row.targets.length > 1 || row.isMultiChoiceItem;
              const isSpotlighted = spotlightItem?.itemId === row.itemId;

              return (
                <div
                  key={row.rowKey}
                  ref={(node) => {
                    rowElementRefs.current[row.rowKey] = node;
                  }}
                  className="relative scroll-mt-4 border border-crt-border bg-crt-bg rounded p-4 space-y-3"
                >
                  {isSpotlighted && spotlightItem && (
                    <div
                      key={`multi-spotlight-${row.rowKey}-${spotlightItem.nonce}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-px rounded crt-section-spotlight"
                    />
                  )}

                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-display font-semibold text-crt-text">{row.title}</span>
                        {row.systemName && (
                          <>
                            <span className="font-mono text-crt-muted">·</span>
                            <span className="font-mono text-crt-phosphor">/{folder}/</span>
                          </>
                        )}
                        {row.fileRole && row.fileRole !== 'ROM' && (
                          <>
                            <span className="font-mono text-crt-muted">·</span>
                            <span className="font-mono text-[11px] text-crt-muted">{row.fileRole}</span>
                          </>
                        )}
                        {row.ignoredEntriesCount > 0 && (
                          <>
                            <span className="font-mono text-crt-muted">·</span>
                            <span className="font-mono text-[11px] text-crt-muted">
                              strips {row.ignoredEntriesCount} junk file
                              {row.ignoredEntriesCount === 1 ? '' : 's'}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-crt-muted truncate">
                        Source: {row.sourceFilename}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                      {row.writeState === 'written' || row.writeState === 'upgraded' ? (
                        <span className="inline-flex items-center gap-1 text-crt-phosphor">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          {row.writeDetail}
                        </span>
                      ) : row.writeState === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-crt-crimson">
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          {row.writeDetail || row.error}
                        </span>
                      ) : row.writeState === 'canceled' ? (
                        <span className="text-crt-amber">{row.writeDetail || 'Canceled'}</span>
                      ) : row.writeState === 'skipped' ? (
                        <span className="text-crt-muted">
                          {row.writeDetail || row.error || 'Skipped'}
                        </span>
                      ) : row.writeState === 'writing' || row.writeState === 'inspecting' ? (
                        <span className="inline-flex items-center gap-1.5 text-crt-amber">
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                          {row.writeDetail || 'Working...'}
                        </span>
                      ) : (
                        <span className="text-crt-muted">{row.writeDetail || ''}</span>
                      )}
                    </div>
                  </div>

                  {row.targets.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-crt-border">
                      {isMulti && !isRunning && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-crt-amber font-mono">
                            {row.targets.length > 1
                              ? `${row.targets.length} playable files inside archive — pick variant(s) to install:`
                              : 'Multi-file release variant — confirm selection:'}
                          </span>
                          <div className="flex items-center gap-3">
                            {row.recommendedTargetIds.length > 0 &&
                              row.selectedTargetIds.length === 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    for (const recId of row.recommendedTargetIds) {
                                      if (!row.selectedTargetIds.includes(recId)) {
                                        toggleTargetSelection(row.rowKey, recId);
                                      }
                                    }
                                  }}
                                  className="text-xs font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  Select Smart Primary
                                </button>
                              )}
                            {row.targets.length > 1 && (
                              <button
                                type="button"
                                onClick={() => selectAllVariantsForRow(row.rowKey)}
                                className="text-xs font-mono text-crt-muted hover:text-crt-text hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Select All Variants
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {row.targets.map((target) => {
                        const checked = row.selectedTargetIds.includes(target.id);
                        const isRecommended = row.recommendedTargetIds.includes(target.id);
                        const smartReason = row.smartReasonsByTargetId[target.id];
                        const outName =
                          row.outputNamesByTargetId[target.id] ?? target.suggestedFilename;
                        const cardCheck = findUpgradeCandidateOnCard(outName, scan);
                        const browserDownloadHref = `/api/items/${row.itemId}/download-rom?fileId=${row.fileId}&targetId=${encodeURIComponent(target.id)}&name=${encodeURIComponent(outName)}`;

                        return (
                          <div
                            key={target.id}
                            className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 py-1.5 text-xs"
                          >
                            <label className="flex items-start gap-2.5 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isBusy}
                                onChange={() => toggleTargetSelection(row.rowKey, target.id)}
                                className="accent-crt-phosphor mt-1 shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="font-mono text-crt-text truncate">
                                  {target.displayName}
                                  <span className="text-crt-muted ml-2 tabular-nums">
                                    ({formatBytes(target.sizeBytes)})
                                  </span>
                                </div>
                                <div className="font-mono text-[11px] text-crt-muted flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                  <span>
                                    {target.kind === 'disc_set'
                                      ? `ODE subfolder /${folder}/${outName}/`
                                      : `Target: /${folder}/`}
                                  </span>
                                  {target.detectedVersion && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-crt-text">{target.detectedVersion}</span>
                                    </>
                                  )}
                                  {isRecommended && smartReason && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-crt-phosphor">{smartReason}</span>
                                    </>
                                  )}
                                  {cardCheck.exactMatch && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>Already on storage device</span>
                                    </>
                                  )}
                                  {cardCheck.olderEntryName && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-crt-amber">
                                        Replaces older: {cardCheck.olderEntryName}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </label>

                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="text"
                                value={outName}
                                disabled={isBusy}
                                aria-label={`Output filename for ${target.displayName}`}
                                onChange={(e) =>
                                  updateRowTargetName(row.rowKey, target.id, e.target.value)
                                }
                                className="w-72 sm:w-80 px-2.5 py-1 text-xs font-mono bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor disabled:opacity-60"
                              />
                              <a
                                href={browserDownloadHref}
                                download={target.kind === 'disc_set' ? `${outName}.zip` : outName}
                                title="Download directly via browser instead"
                                className="p-1.5 border border-crt-border hover:border-crt-phosphor text-crt-muted hover:text-crt-phosphor rounded transition-colors"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-3.5 border-t border-crt-border bg-crt-bg flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
            {!isRunning && !isInspecting && unresolvedMultiItems.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={handleJumpToNextUnresolved}
                  title="Scroll to the next multi-ROM item awaiting variant selection"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-crt-amber/70 bg-crt-amber/10 hover:bg-crt-amber/20 text-crt-amber rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>
                    {unresolvedMultiItems.length} multi-ROM item
                    {unresolvedMultiItems.length === 1 ? '' : 's'} awaiting variant selection
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold">Next</span>
                  <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={autoPickSmartPrimaries}
                  title="Automatically select the latest context-matched Primary ROM for all unresolved items"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-crt-phosphor/60 bg-crt-phosphor/10 hover:bg-crt-phosphor/20 text-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span>Auto-Pick Smart Primaries</span>
                </button>
              </>
            ) : isInspecting ? (
              <span className="text-crt-amber">
                Inspecting archives ({rows.filter((r) => !r.isPlaceholder).length} / {rows.length})...
              </span>
            ) : isRunning ? (
              <span className="text-crt-phosphor">
                {metrics.completedItems} / {metrics.totalItems} games processed
              </span>
            ) : (
              <span className="text-crt-muted">
                {totalSelectedTargets} playable target{totalSelectedTargets === 1 ? '' : 's'} ready
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
            ) : (
              <>
                {isFinished && (
                  <button
                    type="button"
                    onClick={dismissJob}
                    className="px-3.5 py-2 text-xs border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Clear Queue
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3.5 py-2 text-xs border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Close
                </button>
                {job.mode === 'review' && job.phase !== 'completed' && (
                  <button
                    type="button"
                    disabled={totalSelectedTargets === 0}
                    title={
                      !sdRootHandle
                        ? 'Prompts to mount your target storage device and begins installing'
                        : undefined
                    }
                    onClick={() => void startReviewWrite()}
                    className="crt-cta-beam inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderInput className="h-3.5 w-3.5 shrink-0" />
                    {`Install ${totalSelectedTargets} Item${totalSelectedTargets === 1 ? '' : 's'} to Storage Device`}
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
