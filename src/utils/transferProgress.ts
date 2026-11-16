import type { ActiveTransferState, ReleaseFileRecord } from '../types';
import { formatBytes } from './format';

export type TransferProgressMode = 'idle' | 'preparing' | 'determinate' | 'indeterminate';

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
}

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
};

function buildActiveProgress(
  transfer: ActiveTransferState,
  fallbackFilename?: string,
): ResolvedTransferProgress {
  const bytesReceived = Math.max(0, transfer.bytesReceived || 0);
  const totalBytes =
    transfer.totalBytes !== null && transfer.totalBytes > 0 ? transfer.totalBytes : null;
  const bytesPerSec = Math.max(0, transfer.bytesPerSec || 0);
  const filename = transfer.filename || fallbackFilename || '';
  const fileSequenceLabel =
    transfer.totalFiles && transfer.totalFiles > 1 && transfer.fileIndex
      ? `File ${transfer.fileIndex}/${transfer.totalFiles}`
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
  };
}

function buildPreparingProgress(filename = ''): ResolvedTransferProgress {
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
  };
}

export function resolveItemTransferProgress(
  itemStatus: string,
  itemId: number,
  activeTransfer: ActiveTransferState | null,
): ResolvedTransferProgress {
  if (activeTransfer && activeTransfer.itemId === itemId) {
    return buildActiveProgress(activeTransfer);
  }
  if (itemStatus === 'downloading') {
    return buildPreparingProgress();
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
