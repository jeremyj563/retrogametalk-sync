import {
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Loader2,
  Square,
  X,
} from 'lucide-react';
import type { BulkStorageInstallerController } from '../hooks/useBulkStorageInstaller';
import { formatBytes } from '../utils/format';

interface BulkInstallDockProps {
  installer: BulkStorageInstallerController;
}

export function BulkInstallDock({ installer }: BulkInstallDockProps) {
  const { job, metrics, modalOpen, sdRootHandle, openModal, cancelInstall, dismissJob } = installer;

  // Hide dock when no job exists, when the modal is already open in front of the user,
  // or when a Review queue is sitting idle before starting and hasn't begun writing.
  if (!job || modalOpen) return null;
  if (job.mode === 'review' && job.phase === 'ready' && metrics.completedItems === 0) {
    return null;
  }

  const isRunning =
    job.phase === 'running' || job.phase === 'inspecting' || job.phase === 'canceling';
  const isCanceling = job.phase === 'canceling';
  const isCanceled = job.phase === 'canceled';
  const isError = job.phase === 'error';
  const isCompleted = job.phase === 'completed';

  const deviceName = sdRootHandle?.name || 'Storage Device';

  const breakdownParts: string[] = [];
  if (metrics.writtenItems > 0) breakdownParts.push(`${metrics.writtenItems} written`);
  if (metrics.upgradedItems > 0) breakdownParts.push(`${metrics.upgradedItems} upgraded`);
  if (metrics.skippedItems > 0) breakdownParts.push(`${metrics.skippedItems} already on device`);
  if (metrics.failedItems > 0) breakdownParts.push(`${metrics.failedItems} failed`);
  if (metrics.canceledItems > 0) breakdownParts.push(`${metrics.canceledItems} canceled`);

  return (
    <div
      role="region"
      aria-label="Storage device installation progress"
      className={`border-b px-4 lg:px-6 py-2.5 bg-crt-surface/95 backdrop-blur transition-colors ${
        isError
          ? 'border-crt-crimson/50'
          : isCanceled
            ? 'border-crt-amber/50'
            : 'border-crt-phosphor/40'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 text-crt-phosphor animate-spin shrink-0" />
          ) : isCompleted ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-crt-phosphor shrink-0" />
          ) : isCanceled ? (
            <AlertTriangle className="h-3.5 w-3.5 text-crt-amber shrink-0" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-crt-crimson shrink-0" />
          )}

          <HardDrive className="h-3.5 w-3.5 text-crt-muted shrink-0" />

          <span className="font-medium text-crt-text whitespace-nowrap shrink-0">
            {isCanceling
              ? `Stopping install to ${deviceName}...`
              : isRunning
                ? `Installing to ${deviceName}`
                : isCompleted
                  ? `Installed to ${deviceName}`
                  : isCanceled
                    ? `Install stopped on ${deviceName}`
                    : `Install error on ${deviceName}`}
          </span>

          <span aria-hidden="true" className="font-mono text-crt-muted">
            ·
          </span>

          <span className="font-mono tabular-nums text-crt-phosphor whitespace-nowrap shrink-0">
            {metrics.completedItems} / {metrics.totalItems} games ({metrics.progressPercent}%)
          </span>

          {metrics.totalBytesWritten > 0 && (
            <>
              <span aria-hidden="true" className="font-mono text-crt-muted">
                ·
              </span>
              <span className="font-mono tabular-nums text-crt-muted whitespace-nowrap shrink-0">
                {formatBytes(metrics.totalBytesWritten)}
              </span>
            </>
          )}

          {isRunning && job.currentTitle && (
            <>
              <span aria-hidden="true" className="font-mono text-crt-muted hidden sm:inline">
                ·
              </span>
              <span className="font-mono text-crt-muted truncate max-w-[18rem] hidden sm:inline">
                {job.currentTitle}
              </span>
            </>
          )}

          {!isRunning && breakdownParts.length > 0 && (
            <>
              <span aria-hidden="true" className="font-mono text-crt-muted hidden md:inline">
                ·
              </span>
              <span className="font-mono text-crt-muted truncate hidden md:inline">
                {breakdownParts.join(' · ')}
              </span>
            </>
          )}

          {isError && job.errorMessage && (
            <span className="font-mono text-crt-crimson truncate max-w-[20rem]">
              {job.errorMessage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={openModal}
            className="px-2.5 py-1 text-xs font-medium border border-crt-border-strong bg-crt-bg hover:border-crt-phosphor text-crt-text hover:text-crt-phosphor rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open Queue
          </button>

          {isRunning ? (
            <button
              type="button"
              disabled={isCanceling}
              onClick={cancelInstall}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-crt-crimson/60 bg-crt-crimson/10 text-crt-crimson hover:bg-crt-crimson/20 rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
            >
              <Square className="h-3 w-3 fill-current shrink-0" />
              {isCanceling ? 'Canceling...' : 'Cancel'}
            </button>
          ) : (
            <button
              type="button"
              onClick={dismissJob}
              aria-label="Dismiss storage install summary"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <progress
        max={100}
        value={isRunning && metrics.progressPercent === 0 ? 3 : metrics.progressPercent}
        aria-label="Bulk storage installation progress"
        className={`mt-2 block h-1 w-full overflow-hidden rounded-xs bg-crt-bg [&::-webkit-progress-bar]:bg-crt-bg [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-200 ${
          isError
            ? '[&::-webkit-progress-value]:bg-crt-crimson [&::-moz-progress-bar]:bg-crt-crimson'
            : isCanceled
              ? '[&::-webkit-progress-value]:bg-crt-amber [&::-moz-progress-bar]:bg-crt-amber'
              : '[&::-webkit-progress-value]:bg-crt-phosphor [&::-moz-progress-bar]:bg-crt-phosphor'
        }`}
      />
    </div>
  );
}
