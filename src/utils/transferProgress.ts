import type { ActiveTransferState, ReleaseFileRecord } from '../types';
import { formatBytes } from './format';

export type TransferProgressMode = 'idle' | 'preparing' | 'determinate' | 'indeterminate';

export interface OverallItemProgress {
  show: boolean;
  completedFiles: number;
  totalFiles: number;
  percent: number;
}

export interface ResolvedTransferProgress {
  active: boolean;
  mode: TransferProgressMode;
  percent: number | null;
  bytesReceived: number;
  totalBytes: number | null;
  bytesPerSec: number;
  bytesLabel: string;
  speedLabel: string;
  filename: string;
  fileSequenceLabel: string | null;
  overall: OverallItemProgress;
}

const DEFAULT_OVERALL: OverallItemProgress = {
  show: false,
  completedFiles: 0,
  totalFiles: 1,
  percent: 0,
};

const IDLE_PROGRESS: ResolvedTransferProgress = {
  active: false,
  mode: 'idle',
  percent: null,
  bytesReceived: 0,
  totalBytes: null,
  bytesPerSec: 0,
  bytesLabel: '',
  speedLabel: '',
  filename: '',
  fileSequenceLabel: null,
  overall: DEFAULT_OVERALL,
};

function resolveOverallProgress(
  transfer: ActiveTransferState | null,
  fileMode: TransferProgressMode,
  bytesReceived: number,
  totalBytes: number | null,
  itemFiles?: readonly Pick<ReleaseFileRecord, 'id' | 'status'>[],
): OverallItemProgress {
  const dbTotal = itemFiles?.length ?? 0;
  const totalFiles = Math.max(transfer?.totalFiles ?? 0, dbTotal, 1);

  if (totalFiles <= 1) {
    return DEFAULT_OVERALL;
  }

  const dbCompleted = itemFiles
    ? itemFiles.filter(
        (f) =>
          (!transfer || transfer.fileId == null || f.id !== transfer.fileId) &&
          (f.status === 'downloaded' || f.status === 'skipped'),
      ).length
    : 0;

  const completedFiles = Math.min(
    totalFiles,
    Math.max(0, transfer?.completedFiles ?? dbCompleted),
  );

  const currentFraction =
    fileMode === 'determinate' && totalBytes !== null && totalBytes > 0
      ? Math.min(1, Math.max(0, bytesReceived / totalBytes))
      : 0;

  const percent = Math.min(100, Math.round(((completedFiles + currentFraction) / totalFiles) * 100));

  return {
    show: true,
    completedFiles,
    totalFiles,
    percent,
  };
}

function buildActiveProgress(
  transfer: ActiveTransferState,
  fallbackFilename?: string,
  itemFiles?: readonly Pick<ReleaseFileRecord, 'id' | 'status'>[],
): ResolvedTransferProgress {
  const bytesReceived = Math.max(0, transfer.bytesReceived || 0);
  const totalBytes =
    transfer.totalBytes !== null && transfer.totalBytes > 0 ? transfer.totalBytes : null;
  const bytesPerSec = Math.max(0, transfer.bytesPerSec || 0);
  const filename = transfer.filename || fallbackFilename || '';
  const totalFilesCount = Math.max(transfer.totalFiles ?? 0, itemFiles?.length ?? 0);
  const fileSequenceLabel =
    totalFilesCount > 1 && transfer.fileIndex
      ? `File ${transfer.fileIndex}/${totalFilesCount}`
      : null;

  if (totalBytes !== null) {
    const percent = Math.min(100, Math.round((bytesReceived / totalBytes) * 100));
    return {
      active: true,
      mode: 'determinate',
      percent,
      bytesReceived,
      totalBytes,
      bytesPerSec,
      bytesLabel: `${formatBytes(bytesReceived)} / ${formatBytes(totalBytes)}`,
      speedLabel: bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : 'Starting…',
      filename,
      fileSequenceLabel,
      overall: resolveOverallProgress(transfer, 'determinate', bytesReceived, totalBytes, itemFiles),
    };
  }

  if (bytesReceived > 0 || bytesPerSec > 0) {
    return {
      active: true,
      mode: 'indeterminate',
      percent: null,
      bytesReceived,
      totalBytes: null,
      bytesPerSec,
      bytesLabel: formatBytes(bytesReceived),
      speedLabel: bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '',
      filename,
      fileSequenceLabel,
      overall: resolveOverallProgress(transfer, 'indeterminate', bytesReceived, null, itemFiles),
    };
  }

  return {
    active: true,
    mode: 'preparing',
    percent: null,
    bytesReceived: 0,
    totalBytes: null,
    bytesPerSec: 0,
    bytesLabel: 'Connecting to mirror…',
    speedLabel: '',
    filename,
    fileSequenceLabel,
    overall: resolveOverallProgress(transfer, 'preparing', 0, null, itemFiles),
  };
}

function buildPreparingProgress(
  filename = '',
  itemFiles?: readonly Pick<ReleaseFileRecord, 'id' | 'status'>[],
): ResolvedTransferProgress {
  return {
    active: true,
    mode: 'preparing',
    percent: null,
    bytesReceived: 0,
    totalBytes: null,
    bytesPerSec: 0,
    bytesLabel: 'Preparing transfer…',
    speedLabel: '',
    filename,
    fileSequenceLabel: null,
    overall: resolveOverallProgress(null, 'preparing', 0, null, itemFiles),
  };
}

export function resolveItemTransferProgress(
  itemStatus: string,
  itemId: number,
  activeTransfer: ActiveTransferState | null,
  itemFiles?: readonly Pick<ReleaseFileRecord, 'id' | 'status'>[],
): ResolvedTransferProgress {
  if (activeTransfer && activeTransfer.itemId === itemId) {
    return buildActiveProgress(activeTransfer, undefined, itemFiles);
  }
  if (itemStatus === 'downloading') {
    return buildPreparingProgress('', itemFiles);
  }
  return IDLE_PROGRESS;
}

export function resolveFileTransferProgress(
  file: Pick<ReleaseFileRecord, 'id' | 'filename' | 'status'>,
  itemId: number,
  activeTransfer: ActiveTransferState | null,
): ResolvedTransferProgress {
  const matchesItem = activeTransfer !== null && activeTransfer.itemId === itemId;
  const matchesFile =
    matchesItem &&
    (activeTransfer.fileId != null
      ? activeTransfer.fileId === file.id
      : activeTransfer.filename === file.filename);

  if (matchesFile && activeTransfer) {
    return buildActiveProgress(activeTransfer, file.filename);
  }
  if (file.status === 'downloading') {
    return buildPreparingProgress(file.filename);
  }
  return IDLE_PROGRESS;
}
