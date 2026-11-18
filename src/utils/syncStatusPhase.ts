import type { ActiveTransferState, SyncRunRecord } from '../types';

export type SyncStatusSubjectKind = 'download' | 'title' | 'path' | 'detail' | 'idle';

export interface ParsedSyncStatusHeader {
  syncType: string | null;
  systemName: string | null;
  progressLabel: string | null;
  actionPrefix: string;
  subject: string;
  subjectKind: SyncStatusSubjectKind;
  workerCount: number;
}

export function deriveRunSyncTypeLabel(activeRun: SyncRunRecord | null): string | null {
  if (!activeRun) return null;
  const isDry = Boolean(activeRun.dryRun) || activeRun.mode === 'dry_run';
  if (activeRun.triggerType === 'retry') {
    return isDry ? 'Dry Run (Retry)' : 'Retry Failed';
  }
  if (activeRun.triggerType === 'download') {
    return isDry ? 'Dry Run (Queue)' : 'Download Queue';
  }
  if (activeRun.mode === 'full') {
    return isDry ? 'Dry Run (Full)' : 'Full Sync';
  }
  return isDry ? 'Dry Run (Incremental)' : 'Incremental';
}

function inferSystemFromRelativePath(relPath: string): string | null {
  const clean = relPath.trim().replace(/^\/+/, '');
  if (!clean) return null;
  const firstSegment = clean.split('/')[0]?.trim();
  if (!firstSegment || firstSegment === 'page' || firstSegment.startsWith('?')) {
    return null;
  }
  if (/^[a-z0-9][a-z0-9-]*$/i.test(firstSegment)) {
    return firstSegment.toLowerCase();
  }
  return null;
}

export function parseSyncStatusHeader(params: {
  currentPhase: string;
  activeRun: SyncRunRecord | null;
  activeTransfer: ActiveTransferState | null;
  parallelTransferCount: number;
}): ParsedSyncStatusHeader {
  const { currentPhase, activeRun, activeTransfer, parallelTransferCount } = params;
  const phase = (currentPhase || '').trim();
  const runSyncType = deriveRunSyncTypeLabel(activeRun);

  // 1. Active binary download (from live transfer snapshot or phase text fallback)
  if (activeTransfer && phase.startsWith('Downloading ')) {
    const workerCount = Math.max(parallelTransferCount, activeTransfer.activeWorkers ?? 1, 1);
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: activeTransfer.systemName || null,
      progressLabel: null,
      actionPrefix: workerCount > 1 ? `Downloading (${workerCount}x)` : 'Downloading',
      subject: activeTransfer.filename,
      subjectKind: 'download',
      workerCount,
    };
  }

  const parallelDlMatch = phase.match(
    /^Downloading\s+(\d+)\s+files?\s+in\s+parallel\s*\(primary:\s*([^/]+?)\s*\/\s*(.+)\)$/i,
  );
  if (parallelDlMatch) {
    const workerCount = Math.max(2, Number(parallelDlMatch[1]) || 2);
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: parallelDlMatch[2].trim() || null,
      progressLabel: null,
      actionPrefix: `Downloading (${workerCount}x)`,
      subject: parallelDlMatch[3].trim(),
      subjectKind: 'download',
      workerCount,
    };
  }

  const singleDlMatch = phase.match(/^Downloading\s+([^/]+?)\s*\/\s*(.+)$/i);
  if (singleDlMatch) {
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: singleDlMatch[1].trim() || null,
      progressLabel: null,
      actionPrefix: 'Downloading',
      subject: singleDlMatch[2].trim(),
      subjectKind: 'download',
      workerCount: 1,
    };
  }

  // 2. Idle / Standby
  if (/^Idle\b/i.test(phase)) {
    const detail = phase.replace(/^Idle\s*(?:·|:|-)?\s*/i, '').trim();
    return {
      syncType: null,
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Standby',
      subject: detail || 'Waiting for next scheduled run or manual trigger',
      subjectKind: 'idle',
      workerCount: 0,
    };
  }

  // 3. Stopping / Initializing / Authenticating
  const stoppingMatch = phase.match(/^Stopping\s+run\s+(#\d+)\.{0,3}$/i);
  if (stoppingMatch) {
    return {
      syncType: runSyncType ?? 'Stopping',
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Stopping',
      subject: `Aborting run ${stoppingMatch[1]}`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const initMatch = phase.match(/^Run\s+(#\d+)\s+initializing\s*\(([^)]+)\)$/i);
  if (initMatch) {
    return {
      syncType: initMatch[2].trim(),
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Initializing',
      subject: `Preparing run ${initMatch[1]}`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const authMatch = phase.match(/^Authenticating\s+with\s+(.+)$/i);
  if (authMatch) {
    return {
      syncType: runSyncType,
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Authenticating',
      subject: authMatch[1].trim(),
      subjectKind: 'path',
      workerCount: 0,
    };
  }

  // 4. Per-release processing: "Full Sync · n64-roms (9/424): The Legend of Zelda..."
  const releaseMatch = phase.match(
    /^(Dry Run \((?:Full|Incremental)\)|Full Sync|Incremental)\s+·\s+([^\s(]+)\s+\((\d+\/\d+)\):\s+(.+)$/,
  );
  if (releaseMatch) {
    return {
      syncType: releaseMatch[1].trim(),
      systemName: releaseMatch[2].trim(),
      progressLabel: releaseMatch[3].trim(),
      actionPrefix: 'Inspecting',
      subject: releaseMatch[4].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  // 5. WP REST enumeration & pagination
  const wpPageFullMatch = phase.match(
    /^(Dry Run \(Full\)|Full Sync)\s+\((\d+\/\d+)\):\s+([^\s·]+)\s+·\s+WP page\s+(\d+\/\d+)$/i,
  );
  if (wpPageFullMatch) {
    return {
      syncType: wpPageFullMatch[1].trim(),
      systemName: wpPageFullMatch[3].trim(),
      progressLabel: `System ${wpPageFullMatch[2]} · WP ${wpPageFullMatch[4]}`,
      actionPrefix: 'Enumerating',
      subject: `Fetching release catalog page ${wpPageFullMatch[4]}`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const wpPageDeltaMatch = phase.match(
    /^(Dry Run \(Incremental\)|Checking)\s+([^\s(]+)\s+\((\d+\/\d+)\)\s+·\s+WP page\s+(\d+\/\d+)$/i,
  );
  if (wpPageDeltaMatch) {
    const isDry = wpPageDeltaMatch[1].toLowerCase().startsWith('dry run');
    return {
      syncType: isDry ? 'Dry Run (Incremental)' : 'Incremental',
      systemName: wpPageDeltaMatch[2].trim(),
      progressLabel: `System ${wpPageDeltaMatch[3]} · WP ${wpPageDeltaMatch[4]}`,
      actionPrefix: 'Checking',
      subject: `Fetching delta catalog page ${wpPageDeltaMatch[4]}`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const enumFullMatch = phase.match(
    /^(Dry Run \(Full\)|Full Sync)\s+\((\d+\/\d+)\):\s+enumerating\s+(.+)$/i,
  );
  if (enumFullMatch) {
    return {
      syncType: enumFullMatch[1].trim(),
      systemName: enumFullMatch[3].trim(),
      progressLabel: `System ${enumFullMatch[2]}`,
      actionPrefix: 'Enumerating',
      subject: `Indexing ${enumFullMatch[3].trim()} catalog`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const checkSinceMatch = phase.match(
    /^(Dry Run \(Incremental\)|Checking)\s+([^\s(]+)\s+\((\d+\/\d+)\)\s+since\s+(.+)$/i,
  );
  if (checkSinceMatch) {
    const isDry = checkSinceMatch[1].toLowerCase().startsWith('dry run');
    return {
      syncType: isDry ? 'Dry Run (Incremental)' : 'Incremental',
      systemName: checkSinceMatch[2].trim(),
      progressLabel: `System ${checkSinceMatch[3]}`,
      actionPrefix: 'Checking',
      subject: `Modified since ${checkSinceMatch[4].trim()}`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  // 6. Retry queues & single-item retries
  const batchRetryItemMatch = phase.match(
    /^(Dry Run \(Retry\)|Retry Failed)\s+\((\d+\/\d+)\):\s+([^/]+?)\s*\/\s*(.+)$/i,
  );
  if (batchRetryItemMatch) {
    return {
      syncType: batchRetryItemMatch[1].trim(),
      systemName: batchRetryItemMatch[3].trim(),
      progressLabel: batchRetryItemMatch[2].trim(),
      actionPrefix: 'Retrying',
      subject: batchRetryItemMatch[4].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  const batchRetryStartMatch = phase.match(
    /^(Dry Run \(Retry\)|Retry Failed):\s+(\d+\s+failed\/partial\s+releases?)$/i,
  );
  if (batchRetryStartMatch) {
    return {
      syncType: batchRetryStartMatch[1].trim(),
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Retrying',
      subject: batchRetryStartMatch[2].trim(),
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const singleRetryMatch = phase.match(/^(Dry Run \(Retry\)|Retrying):\s+(.+)$/i);
  if (singleRetryMatch) {
    const isDry = singleRetryMatch[1].toLowerCase().startsWith('dry run');
    return {
      syncType: runSyncType ?? (isDry ? 'Dry Run (Retry)' : 'Retry Failed'),
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Retrying',
      subject: singleRetryMatch[2].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  // 6b. On-demand Download Queue phases
  const queueItemMatch = phase.match(/^Queue\s+\((\d+\/\d+)\):\s+([^/]+?)\s*\/\s*(.+)$/i);
  if (queueItemMatch) {
    return {
      syncType: runSyncType ?? 'Download Queue',
      systemName: queueItemMatch[2].trim(),
      progressLabel: queueItemMatch[1].trim(),
      actionPrefix: 'Downloading',
      subject: queueItemMatch[3].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  const queueStartMatch = phase.match(/^Downloading\s+(\d+\s+queued\s+releases?)$/i);
  if (queueStartMatch) {
    return {
      syncType: runSyncType ?? 'Download Queue',
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Queueing',
      subject: queueStartMatch[1].trim(),
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  // 7. HTML crawling & fallback page inspection
  const scanIndexMatch = phase.match(/^Scanning repository index:\s+(.+)$/i);
  if (scanIndexMatch) {
    return {
      syncType: runSyncType,
      systemName: null,
      progressLabel: null,
      actionPrefix: 'Scanning',
      subject: scanIndexMatch[1].trim(),
      subjectKind: 'path',
      workerCount: 0,
    };
  }

  const scanPageMatch = phase.match(/^Scanning page\s+\((\d+)\):\s+(.+)$/i);
  if (scanPageMatch) {
    const relPath = scanPageMatch[2].trim();
    return {
      syncType: runSyncType,
      systemName: inferSystemFromRelativePath(relPath),
      progressLabel: `Page ${scanPageMatch[1]}`,
      actionPrefix: 'Scanning',
      subject: relPath,
      subjectKind: 'path',
      workerCount: 0,
    };
  }

  const htmlInspectMatch = phase.match(
    /^(Dry Run \([^)]+\)\s+inspecting|Inspecting delta candidate|Full Sync inspecting):\s+(.+)$/i,
  );
  if (htmlInspectMatch) {
    const relPath = htmlInspectMatch[2].trim();
    return {
      syncType: runSyncType,
      systemName: inferSystemFromRelativePath(relPath),
      progressLabel: null,
      actionPrefix: 'Inspecting',
      subject: relPath,
      subjectKind: 'path',
      workerCount: 0,
    };
  }

  // 8. Clean fallback
  return {
    syncType: runSyncType,
    systemName: null,
    progressLabel: null,
    actionPrefix: activeRun ? 'Status' : 'Standby',
    subject: phase || 'Ready',
    subjectKind: 'detail',
    workerCount: 0,
  };
}
