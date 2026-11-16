import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderInput,
  HardDrive,
  RefreshCw,
  Usb,
  X,
  XCircle,
} from 'lucide-react';
import { DEVICE_PRESETS, resolveSystemFolderForDevice, type DevicePresetId } from '../shared/devicePresets';
import { sanitizeFat32Filename } from '../shared/romNaming';
import type { ArchiveInspectResult, PlayableExportTarget, ScraperConfigPublic } from '../types';
import { formatBytes } from '../utils/format';
import { readJsonSafely } from '../utils/http';
import {
  findUpgradeCandidateOnCard,
  isFileSystemAccessSupported,
  pickSdCardRootDirectory,
  resolveOrCreateSubdirectory,
  scanTargetFolder,
  streamHttpPayloadToSdFile,
  type SdDirectoryHandle,
  type SdScanFolderResult,
} from '../utils/sdCardFs';

export interface SdExportBatchItemResult {
  itemId: number;
  title: string;
  systemName: string;
  inspections: ArchiveInspectResult[];
  error: string | null;
}

interface ExportQueueRow {
  rowKey: string;
  itemId: number;
  fileId: number;
  title: string;
  systemName: string;
  sourceFilename: string;
  targets: PlayableExportTarget[];
  selectedTargetIds: string[];
  outputNamesByTargetId: Record<string, string>;
  replaceOlderByTargetId: Record<string, boolean>;
  overwriteExisting: boolean;
  error: string | null;
  patchOnly: boolean;
  ignoredEntriesCount: number;
  writeState: 'pending' | 'writing' | 'written' | 'upgraded' | 'skipped' | 'error';
  writeDetail: string | null;
}

interface SdCardExportModalProps {
  open: boolean;
  itemIds: number[];
  config: ScraperConfigPublic;
  sdRootHandle: SdDirectoryHandle | null;
  onMountSdHandle: (handle: SdDirectoryHandle | null) => void;
  onSaveConfig: (patch: Partial<ScraperConfigPublic>) => Promise<void>;
  onClose: () => void;
}

export function SdCardExportModal({
  open,
  itemIds,
  config,
  sdRootHandle,
  onMountSdHandle,
  onSaveConfig,
  onClose,
}: SdCardExportModalProps) {
  const fsSupport = useMemo(() => isFileSystemAccessSupported(), []);
  const [mountError, setMountError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [rows, setRows] = useState<ExportQueueRow[]>([]);
  const [folderScans, setFolderScans] = useState<Record<string, SdScanFolderResult>>({});
  const [scanningCard, setScanningCard] = useState(false);
  const [writing, setWriting] = useState(false);

  const [devicePreset, setDevicePreset] = useState<string>(config.devicePreset || 'everdrive');
  const [folderMapDraft, setFolderMapDraft] = useState<Record<string, string>>(config.deviceFolderMap || {});
  const [showFolderEditor, setShowFolderEditor] = useState(false);
  const [savingDevicePrefs, setSavingDevicePrefs] = useState(false);

  useEffect(() => {
    setDevicePreset(config.devicePreset || 'everdrive');
    setFolderMapDraft(config.deviceFolderMap || {});
  }, [config.devicePreset, config.deviceFolderMap]);

  const loadInspectionBatch = useCallback(async () => {
    if (!open || itemIds.length === 0) return;
    setInspecting(true);
    setInspectError(null);
    try {
      const res = await fetch('/api/items/inspect-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: itemIds }),
      });
      const parsed = await readJsonSafely<{ results?: SdExportBatchItemResult[]; error?: string }>(res);
      if (!parsed.ok || !parsed.data?.results) {
        throw new Error(parsed.errorMessage || `Inspection failed (HTTP ${res.status})`);
      }

      const nextRows: ExportQueueRow[] = [];
      for (const entry of parsed.data.results) {
        if (entry.inspections.length === 0) {
          nextRows.push({
            rowKey: `${entry.itemId}-empty`,
            itemId: entry.itemId,
            fileId: 0,
            title: entry.title,
            systemName: entry.systemName,
            sourceFilename: '—',
            targets: [],
            selectedTargetIds: [],
            outputNamesByTargetId: {},
            replaceOlderByTargetId: {},
            overwriteExisting: false,
            error: entry.error || 'No downloadable archive found',
            patchOnly: false,
            ignoredEntriesCount: 0,
            writeState: 'error',
            writeDetail: entry.error || 'Unavailable',
          });
          continue;
        }

        for (const insp of entry.inspections) {
          const namesMap: Record<string, string> = {};
          const replaceMap: Record<string, boolean> = {};
          for (const t of insp.playableTargets) {
            namesMap[t.id] = t.suggestedFilename;
            replaceMap[t.id] = true;
          }
          const initialSelected =
            insp.playableTargets.length === 1 ? [insp.playableTargets[0].id] : [];

          nextRows.push({
            rowKey: `${entry.itemId}-${insp.fileId}`,
            itemId: entry.itemId,
            fileId: insp.fileId,
            title: entry.title,
            systemName: entry.systemName,
            sourceFilename: insp.sourceFilename,
            targets: insp.playableTargets,
            selectedTargetIds: initialSelected,
            outputNamesByTargetId: namesMap,
            replaceOlderByTargetId: replaceMap,
            overwriteExisting: false,
            error: insp.playableTargets.length === 0
              ? (insp.patchOnly ? 'Patch-only archive (no ROM payload)' : 'No playable ROM found')
              : null,
            patchOnly: insp.patchOnly,
            ignoredEntriesCount: insp.ignoredEntriesCount,
            writeState: insp.playableTargets.length === 0 ? 'skipped' : 'pending',
            writeDetail: null,
          });
        }
      }

      setRows(nextRows);
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    } finally {
      setInspecting(false);
    }
  }, [open, itemIds]);

  useEffect(() => {
    if (open) {
      void loadInspectionBatch();
    } else {
      setRows([]);
      setMountError(null);
      setInspectError(null);
    }
  }, [open, loadInspectionBatch]);

  const uniqueSystemsInQueue = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.systemName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const rescanMountedSdFolders = useCallback(async () => {
    if (!sdRootHandle || uniqueSystemsInQueue.length === 0) {
      setFolderScans({});
      return;
    }
    setScanningCard(true);
    try {
      const nextScans: Record<string, SdScanFolderResult> = {};
      for (const sys of uniqueSystemsInQueue) {
        const folder = resolveSystemFolderForDevice(sys, devicePreset, folderMapDraft);
        if (!nextScans[folder]) {
          nextScans[folder] = await scanTargetFolder(sdRootHandle, folder);
        }
      }
      setFolderScans(nextScans);
    } catch (err) {
      setMountError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanningCard(false);
    }
  }, [sdRootHandle, uniqueSystemsInQueue, devicePreset, folderMapDraft]);

  useEffect(() => {
    if (open && sdRootHandle) {
      void rescanMountedSdFolders();
    }
  }, [open, sdRootHandle, rescanMountedSdFolders]);

  if (!open) return null;

  const handleMountSdCard = async () => {
    setMountError(null);
    try {
      const handle = await pickSdCardRootDirectory();
      onMountSdHandle(handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setMountError(
        /cross origin|sub frame|user activation/i.test(msg)
          ? 'Browser blocked folder picker inside this embedded frame. Open the app directly in its own tab or use Prepared ROM browser downloads.'
          : msg,
      );
    }
  };

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

  const toggleTargetSelection = (rowKey: string, targetId: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowKey !== rowKey) return row;
        const exists = row.selectedTargetIds.includes(targetId);
        const nextIds = exists
          ? row.selectedTargetIds.filter((id) => id !== targetId)
          : [...row.selectedTargetIds, targetId];
        return { ...row, selectedTargetIds: nextIds };
      }),
    );
  };

  const selectAllVariantsForRow = (rowKey: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.rowKey === rowKey ? { ...row, selectedTargetIds: row.targets.map((t) => t.id) } : row,
      ),
    );
  };

  const updateRowTargetName = (rowKey: string, targetId: string, nextName: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.rowKey === rowKey
          ? { ...row, outputNamesByTargetId: { ...row.outputNamesByTargetId, [targetId]: nextName } }
          : row,
      ),
    );
  };

  const totalSelectedTargets = rows.reduce((acc, r) => acc + r.selectedTargetIds.length, 0);
  const unresolvedMultiRows = rows.filter((r) => r.targets.length > 1 && r.selectedTargetIds.length === 0).length;

  const handleWriteToSdCard = async () => {
    if (!sdRootHandle || writing || totalSelectedTargets === 0) return;
    setWriting(true);
    setMountError(null);

    try {
      for (const row of rows) {
        if (row.selectedTargetIds.length === 0) continue;

        setRows((prev) =>
          prev.map((r) =>
            r.rowKey === row.rowKey ? { ...r, writeState: 'writing', writeDetail: 'Extracting...' } : r,
          ),
        );

        const targetFolderRel = resolveSystemFolderForDevice(row.systemName, devicePreset, folderMapDraft);
        const systemDirHandle = await resolveOrCreateSubdirectory(sdRootHandle, targetFolderRel, true);
        if (!systemDirHandle) {
          setRows((prev) =>
            prev.map((r) =>
              r.rowKey === row.rowKey
                ? { ...r, writeState: 'error', writeDetail: `Could not create folder ${targetFolderRel}` }
                : r,
            ),
          );
          continue;
        }

        const scan = folderScans[targetFolderRel];
        let rowBytes = 0;
        let upgradedOldName: string | null = null;
        let allSkipped = true;
        let rowFailed: string | null = null;

        for (const targetId of row.selectedTargetIds) {
          const target = row.targets.find((t) => t.id === targetId);
          if (!target) continue;
          const rawDesiredName = (row.outputNamesByTargetId[targetId] || target.suggestedFilename).trim();
          const finalName = config.romSanitizeFat32
            ? sanitizeFat32Filename(rawDesiredName, config.romMaxFilenameLen)
            : rawDesiredName;

          const cardStatus = findUpgradeCandidateOnCard(finalName, scan);
          if (cardStatus.exactMatch && !row.overwriteExisting) {
            continue;
          }
          allSkipped = false;

          try {
            if (target.kind === 'disc_set') {
              const discFolderName = finalName.replace(/\.zip$/i, '');
              const discDir = await systemDirHandle.getDirectoryHandle(discFolderName, { create: true });
              for (const entryPath of target.entryPaths) {
                const leaf = entryPath.split('/').pop() || entryPath;
                const cleanLeaf = config.romSanitizeFat32 ? sanitizeFat32Filename(leaf, config.romMaxFilenameLen) : leaf;
                const url = `/api/items/${row.itemId}/extract-entry?fileId=${row.fileId}&entry=${encodeURIComponent(entryPath)}&name=${encodeURIComponent(cleanLeaf)}`;
                rowBytes += await streamHttpPayloadToSdFile(url, discDir, cleanLeaf);
              }
            } else {
              const url = `/api/items/${row.itemId}/extract-entry?fileId=${row.fileId}&entry=${encodeURIComponent(target.primaryEntry)}&name=${encodeURIComponent(finalName)}`;
              rowBytes += await streamHttpPayloadToSdFile(url, systemDirHandle, finalName);
            }

            if (cardStatus.olderEntryName && row.replaceOlderByTargetId[targetId] !== false) {
              try {
                await systemDirHandle.removeEntry(cardStatus.olderEntryName, { recursive: true });
                upgradedOldName = cardStatus.olderEntryName;
              } catch {
                // Non-fatal if older file could not be deleted
              }
            }
          } catch (err) {
            rowFailed = err instanceof Error ? err.message : String(err);
          }
        }

        setRows((prev) =>
          prev.map((r) => {
            if (r.rowKey !== row.rowKey) return r;
            if (rowFailed) {
              return { ...r, writeState: 'error', writeDetail: rowFailed };
            }
            if (allSkipped) {
              return { ...r, writeState: 'skipped', writeDetail: `Already on SD in /${targetFolderRel}` };
            }
            if (upgradedOldName) {
              return {
                ...r,
                writeState: 'upgraded',
                writeDetail: `Updated in /${targetFolderRel} (replaced ${upgradedOldName}) · ${formatBytes(rowBytes)}`,
              };
            }
            return {
              ...r,
              writeState: 'written',
              writeDetail: `Saved to /${targetFolderRel} · ${formatBytes(rowBytes)}`,
            };
          }),
        );
      }

      await rescanMountedSdFolders();
    } finally {
      setWriting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Send Prepared ROMs to SD Card"
      onClick={(e) => {
        if (e.target === e.currentTarget && !writing) onClose();
      }}
    >
      <div className="crt-canvas crt-drawer-panel w-full max-w-4xl max-h-[90vh] bg-crt-surface border border-crt-border-strong rounded-md flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="px-6 py-4 border-b border-crt-border bg-crt-bg flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Usb className="h-5 w-5 text-crt-phosphor shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-crt-text truncate">
                Send Prepared ROMs to SD Card
              </h2>
              <p className="text-xs text-crt-muted truncate">
                Extracts playable ROMs &amp; ODE disc sets directly into console folders on your device storage.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={writing}
            onClick={onClose}
            aria-label="Close SD card exporter"
            className="p-2 border border-crt-border hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors disabled:opacity-40"
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
                  disabled={writing}
                  onClick={() => void handleMountSdCard()}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded border transition-colors whitespace-nowrap ${
                    sdRootHandle
                      ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/15'
                      : 'border-crt-phosphor bg-crt-phosphor text-crt-bg hover:brightness-110'
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  {sdRootHandle ? `SD Mounted: ${sdRootHandle.name} (Change)` : 'Mount SD Card / Target Folder'}
                </button>
              ) : (
                <span className="text-xs font-mono text-crt-amber">
                  {fsSupport.reason}
                </span>
              )}

              <select
                value={devicePreset}
                disabled={writing}
                onChange={(e) => setDevicePreset(e.target.value)}
                aria-label="Select target device folder preset"
                className="px-3 py-2 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
              >
                {Object.values(DEVICE_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    Preset: {preset.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setShowFolderEditor((v) => !v)}
                className="px-3 py-2 text-xs border border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap"
              >
                {showFolderEditor ? 'Hide Folder Map' : 'Edit Folder Map'}
              </button>
            </div>

            {sdRootHandle && (
              <button
                type="button"
                disabled={scanningCard || writing}
                onClick={() => void rescanMountedSdFolders()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-crt-border bg-crt-bg hover:border-crt-phosphor text-crt-muted hover:text-crt-text rounded transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanningCard ? 'animate-spin' : ''}`} />
                {scanningCard ? 'Scanning Card...' : 'Rescan Card'}
              </button>
            )}
          </div>

          {mountError && (
            <div className="flex items-center gap-2 text-xs font-mono text-crt-amber">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{mountError}</span>
            </div>
          )}

          {showFolderEditor && uniqueSystemsInQueue.length > 0 && (
            <div className="pt-3 border-t border-crt-border space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-crt-muted">
                  Map each console in this queue to its relative folder on the SD card ({DEVICE_PRESETS[devicePreset as DevicePresetId]?.name || 'Custom'}).
                </span>
                <button
                  type="button"
                  disabled={savingDevicePrefs}
                  onClick={() => void handleSaveDevicePrefs()}
                  className="px-2.5 py-1 text-xs font-medium border border-crt-phosphor/60 text-crt-phosphor hover:bg-crt-phosphor/10 rounded transition-colors"
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
          {inspecting ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="h-16 border border-crt-border bg-crt-bg rounded animate-pulse" />
              ))}
            </div>
          ) : inspectError ? (
            <div className="border border-crt-crimson/50 bg-crt-crimson/10 p-4 rounded text-xs font-mono text-crt-crimson">
              {inspectError}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-xs text-crt-muted border border-crt-border bg-crt-bg rounded">
              No archived releases queued for export.
            </div>
          ) : (
            rows.map((row) => {
              const folder = resolveSystemFolderForDevice(row.systemName, devicePreset, folderMapDraft);
              const scan = folderScans[folder];
              const isMulti = row.targets.length > 1;

              return (
                <div
                  key={row.rowKey}
                  className="border border-crt-border bg-crt-bg rounded p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-display font-semibold text-crt-text">{row.title}</span>
                        <span className="font-mono text-crt-muted">·</span>
                        <span className="font-mono text-crt-phosphor">/{folder}/</span>
                        {row.ignoredEntriesCount > 0 && (
                          <>
                            <span className="font-mono text-crt-muted">·</span>
                            <span className="font-mono text-[11px] text-crt-muted">
                              strips {row.ignoredEntriesCount} junk file{row.ignoredEntriesCount === 1 ? '' : 's'}
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
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {row.writeDetail}
                        </span>
                      ) : row.writeState === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-crt-crimson">
                          <XCircle className="h-3.5 w-3.5" />
                          {row.writeDetail || row.error}
                        </span>
                      ) : row.writeState === 'skipped' ? (
                        <span className="text-crt-muted">{row.writeDetail || row.error || 'Skipped'}</span>
                      ) : row.writeState === 'writing' ? (
                        <span className="text-crt-amber">{row.writeDetail || 'Writing...'}</span>
                      ) : null}
                    </div>
                  </div>

                  {row.targets.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-crt-border">
                      {isMulti && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-crt-amber font-mono">
                            {row.targets.length} playable files inside archive — pick variant(s) to export:
                          </span>
                          <button
                            type="button"
                            onClick={() => selectAllVariantsForRow(row.rowKey)}
                            className="text-xs font-mono text-crt-phosphor hover:underline"
                          >
                            Export All Variants
                          </button>
                        </div>
                      )}

                      {row.targets.map((target) => {
                        const checked = row.selectedTargetIds.includes(target.id);
                        const outName = row.outputNamesByTargetId[target.id] ?? target.suggestedFilename;
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
                                disabled={writing}
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
                                <div className="font-mono text-[11px] text-crt-muted">
                                  {target.kind === 'disc_set'
                                    ? `ODE subfolder /${folder}/${outName}/`
                                    : `Target: /${folder}/`}
                                  {cardCheck.exactMatch && (
                                    <span className="text-crt-muted ml-2">· Already on SD card</span>
                                  )}
                                  {cardCheck.olderEntryName && (
                                    <span className="text-crt-amber ml-2">
                                      · Replaces older: {cardCheck.olderEntryName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </label>

                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="text"
                                value={outName}
                                disabled={writing}
                                aria-label={`Output filename for ${target.displayName}`}
                                onChange={(e) => updateRowTargetName(row.rowKey, target.id, e.target.value)}
                                className="w-72 sm:w-80 px-2.5 py-1 text-xs font-mono bg-crt-surface border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
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
          <div className="text-xs font-mono text-crt-muted tabular-nums">
            {unresolvedMultiRows > 0 ? (
              <span className="text-crt-amber">
                {unresolvedMultiRows} multi-ROM item{unresolvedMultiRows === 1 ? '' : 's'} awaiting variant selection
              </span>
            ) : (
              <span>
                {totalSelectedTargets} playable target{totalSelectedTargets === 1 ? '' : 's'} ready
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={writing}
              onClick={onClose}
              className="px-3.5 py-2 text-xs border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text rounded transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              disabled={!sdRootHandle || writing || totalSelectedTargets === 0}
              title={!sdRootHandle ? 'Mount your SD card or target folder first' : undefined}
              onClick={() => void handleWriteToSdCard()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <FolderInput className="h-3.5 w-3.5" />
              {writing
                ? 'Writing to SD Card...'
                : `Write ${totalSelectedTargets} Item${totalSelectedTargets === 1 ? '' : 's'} to SD Card`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
