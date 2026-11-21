import type {
  ActiveRunProgress,
  ActiveSyncItemSummary,
  ActiveTransferState,
  SyncRunRecord,
} from '../types';

export type SyncStatusSubjectKind = 'download' | 'title' | 'path' | 'detail' | 'idle';

export interface ActiveSyncTargetCover {
  itemId: number | null;
  title: string;
  systemName: string | null;
  hasCoverHint: boolean;
  coverUrl: string | null;
}

export interface ParsedSyncStatusHeader {
  syncType: string | null;
  systemName: string | null;
  progressLabel: string | null;
  actionPrefix: string | null;
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

export function formatRunProgressLabel(
  runProgress: ActiveRunProgress | null | undefined,
  systemName: string | null,
): string | null {
  if (!runProgress || !Number.isFinite(runProgress.total) || runProgress.total <= 0) {
    return null;
  }
  if (
    runProgress.scope === 'system' &&
    systemName &&
    runProgress.systemName &&
    runProgress.systemName.toLowerCase() !== systemName.toLowerCase()
  ) {
    return null;
  }
  const total = Math.max(1, Math.floor(runProgress.total));
  const processed = Math.max(0, Math.min(Math.floor(runProgress.processed), total));
  return `${processed}/${total}`;
}

export function parseSyncStatusHeader(params: {
  currentPhase: string;
  activeRun: SyncRunRecord | null;
  activeTransfer: ActiveTransferState | null;
  parallelTransferCount: number;
  runProgress?: ActiveRunProgress | null;
}): ParsedSyncStatusHeader {
  const { currentPhase, activeRun, activeTransfer, parallelTransferCount, runProgress } = params;
  const phase = (currentPhase || '').trim();
  const runSyncType = deriveRunSyncTypeLabel(activeRun);

  // 1. Idle / Standby (always takes precedence over stale state; Tier 1 already displays "Standby")
  if (/^Idle\b/i.test(phase)) {
    const detail = phase.replace(/^Idle\s*(?:·|:|-)?\s*/i, '').trim();
    return {
      syncType: null,
      systemName: null,
      progressLabel: null,
      actionPrefix: null,
      subject: detail || 'Waiting for next scheduled run or manual trigger',
      subjectKind: 'idle',
      workerCount: 0,
    };
  }

  // 2. Stopping
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

  // 3. Active transfer snapshot — foreground the game/catalog-item title directly (Tier 1 already displays "Sync Active")
  if (activeTransfer) {
    const workerCount = Math.max(parallelTransferCount, activeTransfer.activeWorkers ?? 1, 1);
    const resolvedTitle = (activeTransfer.itemTitle || '').trim();
    const subject = resolvedTitle || activeTransfer.filename;
    const transferSystem = activeTransfer.systemName || null;
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: transferSystem,
      progressLabel: formatRunProgressLabel(runProgress, transferSystem),
      actionPrefix: null,
      subject,
      subjectKind: resolvedTitle ? 'title' : 'download',
      workerCount,
    };
  }

  // 3b. Inter-file or phase-text download fallbacks (when activeTransfer snapshot is momentarily null)
  const syncingItemMatch = phase.match(/^Syncing\s+·\s+([^\s:]+):\s+(.+)$/i);
  if (syncingItemMatch) {
    const sys = syncingItemMatch[1].trim() || null;
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: sys,
      progressLabel: formatRunProgressLabel(runProgress, sys),
      actionPrefix: null,
      subject: syncingItemMatch[2].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  const parallelDlMatch = phase.match(
    /^Downloading\s+(\d+)\s+files?\s+in\s+parallel\s*\(primary:\s*([^/]+?)\s*\/\s*(.+)\)$/i,
  );
  if (parallelDlMatch) {
    const workerCount = Math.max(2, Number(parallelDlMatch[1]) || 2);
    const sys = parallelDlMatch[2].trim() || null;
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: sys,
      progressLabel: formatRunProgressLabel(runProgress, sys),
      actionPrefix: null,
      subject: parallelDlMatch[3].trim(),
      subjectKind: 'download',
      workerCount,
    };
  }

  const singleDlMatch = phase.match(/^Downloading\s+([^/]+?)\s*\/\s*(.+)$/i);
  if (singleDlMatch) {
    const sys = singleDlMatch[1].trim() || null;
    return {
      syncType: runSyncType ?? 'Sync',
      systemName: sys,
      progressLabel: formatRunProgressLabel(runProgress, sys),
      actionPrefix: null,
      subject: singleDlMatch[2].trim(),
      subjectKind: 'download',
      workerCount: 1,
    };
  }

  // 4. Initializing / Authenticating
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

  // 5. Per-release processing (warm-up -> seamless transition into transfer): title only without redundant "Syncing"
  const releaseMatch = phase.match(
    /^(Dry Run \((?:Full|Incremental)\)|Full Sync|Incremental)\s+·\s+([^\s(]+)\s+\((\d+\/\d+)\):\s+(.+)$/,
  );
  if (releaseMatch) {
    return {
      syncType: releaseMatch[1].trim(),
      systemName: releaseMatch[2].trim(),
      progressLabel: releaseMatch[3].trim(),
      actionPrefix: null,
      subject: releaseMatch[4].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  // 6. WP REST enumeration & pagination (must run before generic "<Mode> (n/m): <sys> · <title>" matcher)
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

  // 5b. Alternate Index-First Full Sync per-release format: "Full Sync (98/110): nes-roms · Parallel World"
  const indexFirstReleaseMatch = phase.match(
    /^(Dry Run \((?:Full|Incremental)\)|Full Sync|Incremental)\s+\((\d+\/\d+)\):\s+([^\s·]+)\s+·\s+(.+)$/,
  );
  if (indexFirstReleaseMatch) {
    return {
      syncType: indexFirstReleaseMatch[1].trim(),
      systemName: indexFirstReleaseMatch[3].trim(),
      progressLabel: indexFirstReleaseMatch[2].trim(),
      actionPrefix: null,
      subject: indexFirstReleaseMatch[4].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  // 6b. Index-First Phase 1 console indexing & delta checks
  const indexFirstWpPageMatch = phase.match(
    /^(Dry Run\s+·\s+)?(Indexing|Delta)\s+([^\s·]+)\s+·\s+WP page\s+(\d+\/\d+)$/i,
  );
  if (indexFirstWpPageMatch) {
    const isDelta = indexFirstWpPageMatch[2].toLowerCase() === 'delta';
    const isDry = Boolean(indexFirstWpPageMatch[1]);
    return {
      syncType: runSyncType ?? (isDry ? 'Dry Run (Full)' : 'Full Sync'),
      systemName: indexFirstWpPageMatch[3].trim(),
      progressLabel: `WP ${indexFirstWpPageMatch[4]}`,
      actionPrefix: isDelta ? 'Checking' : 'Enumerating',
      subject: isDelta
        ? `Fetching delta catalog page ${indexFirstWpPageMatch[4]}`
        : `Fetching release catalog page ${indexFirstWpPageMatch[4]}`,
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  const indexFirstConsoleMatch = phase.match(
    /^(Dry Run\s+·\s+)?(Indexing|Delta check)\s+([^\s(]+)\s+\((\d+\/\d+)\)$/i,
  );
  if (indexFirstConsoleMatch) {
    const isDelta = indexFirstConsoleMatch[2].toLowerCase().startsWith('delta');
    const isDry = Boolean(indexFirstConsoleMatch[1]);
    const sys = indexFirstConsoleMatch[3].trim();
    return {
      syncType: runSyncType ?? (isDry ? 'Dry Run (Full)' : 'Full Sync'),
      systemName: sys,
      progressLabel: `System ${indexFirstConsoleMatch[4]}`,
      actionPrefix: isDelta ? 'Checking' : 'Enumerating',
      subject: isDelta ? `Checking ${sys} for recent updates` : `Indexing ${sys} catalog`,
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

  // 7. Retry queues & single-item retries — highlighted title without redundant "Syncing"
  const batchRetryItemMatch = phase.match(
    /^(Dry Run \(Retry\)|Retry Failed)\s+\((\d+\/\d+)\):\s+([^/]+?)\s*\/\s*(.+)$/i,
  );
  if (batchRetryItemMatch) {
    return {
      syncType: batchRetryItemMatch[1].trim(),
      systemName: batchRetryItemMatch[3].trim(),
      progressLabel: batchRetryItemMatch[2].trim(),
      actionPrefix: null,
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
      actionPrefix: null,
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
      actionPrefix: null,
      subject: singleRetryMatch[2].trim(),
      subjectKind: 'title',
      workerCount: 0,
    };
  }

  // 7b. On-demand Download Queue phases — highlighted title without redundant "Syncing"
  const queueItemMatch = phase.match(/^Queue\s+\((\d+\/\d+)\):\s+([^/]+?)\s*\/\s*(.+)$/i);
  if (queueItemMatch) {
    return {
      syncType: runSyncType ?? 'Download Queue',
      systemName: queueItemMatch[2].trim(),
      progressLabel: queueItemMatch[1].trim(),
      actionPrefix: null,
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
      actionPrefix: null,
      subject: queueStartMatch[1].trim(),
      subjectKind: 'detail',
      workerCount: 0,
    };
  }

  // 8. HTML crawling & fallback page inspection
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
      actionPrefix: null,
      subject: relPath,
      subjectKind: 'path',
      workerCount: 0,
    };
  }

  // 9. Clean fallback
  return {
    syncType: runSyncType,
    systemName: null,
    progressLabel: null,
    actionPrefix: activeRun ? 'Status' : null,
    subject: phase || 'Ready',
    subjectKind: 'detail',
    workerCount: 0,
  };
}

function normalizePositiveItemId(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function resolveActiveSyncTargetCover(params: {
  parsedHeader: ParsedSyncStatusHeader;
  displayedSubject?: string | null;
  activeRun: SyncRunRecord | null;
  activeTransfer: ActiveTransferState | null;
  activeSyncItem?: ActiveSyncItemSummary | null;
  heldTransfer?: {
    itemId?: number | null;
    itemTitle?: string;
    systemName?: string;
    hasCover?: boolean;
  } | null;
}): ActiveSyncTargetCover | null {
  const { parsedHeader, displayedSubject, activeRun, activeTransfer, activeSyncItem, heldTransfer } =
    params;

  // Never show a cover thumbnail in Standby or non-game phases (Authenticating, Enumerating, Checking, Stopping)
  const isGameTarget =
    parsedHeader.subjectKind === 'title' || parsedHeader.subjectKind === 'download';
  if (!isGameTarget) {
    return null;
  }
  if (!activeRun && !activeTransfer) {
    return null;
  }

  const transferItemId = normalizePositiveItemId(activeTransfer?.itemId);
  const syncItemId = normalizePositiveItemId(activeSyncItem?.itemId);
  const heldItemId = normalizePositiveItemId(heldTransfer?.itemId);

  const itemId = transferItemId ?? syncItemId ?? heldItemId ?? null;
  const title =
    (displayedSubject || '').trim() ||
    (activeTransfer?.itemTitle || '').trim() ||
    (activeSyncItem?.title || '').trim() ||
    parsedHeader.subject;
  const systemName =
    activeTransfer?.systemName ||
    activeSyncItem?.systemName ||
    parsedHeader.systemName ||
    heldTransfer?.systemName ||
    null;

  let hasCoverHint = false;
  if (itemId !== null) {
    if (transferItemId === itemId && activeTransfer?.hasCover !== undefined) {
      hasCoverHint = Boolean(activeTransfer.hasCover);
    } else if (syncItemId === itemId && activeSyncItem) {
      hasCoverHint = Boolean(activeSyncItem.hasCover);
    } else if (heldItemId === itemId && heldTransfer?.hasCover !== undefined) {
      hasCoverHint = Boolean(heldTransfer.hasCover);
    } else {
      hasCoverHint = true;
    }
  }

  const coverUrl =
    itemId !== null
      ? `/api/items/${itemId}/asset?kind=cover&lazy=1${hasCoverHint ? '&cv=1' : ''}`
      : null;

  return {
    itemId,
    title,
    systemName,
    hasCoverHint,
    coverUrl,
  };
}

export type HeroCoverMotionTier = 'off' | 'low' | 'medium' | 'high' | 'ultra';

export interface HeroCoverFrameDimensions {
  heightPx: number;
  placeholderWidthPx: number;
  minWidthPx: number;
  maxWidthPx: number;
}

export function getHeroCoverFrameDimensions(params: {
  compact: boolean;
  isDesktop: boolean;
}): HeroCoverFrameDimensions {
  const { compact, isDesktop } = params;
  if (compact) {
    return {
      heightPx: isDesktop ? 70 : 62,
      placeholderWidthPx: isDesktop ? 56 : 50,
      minWidthPx: 50,
      maxWidthPx: isDesktop ? 144 : 124,
    };
  }
  return {
    heightPx: isDesktop ? 90 : 80,
    placeholderWidthPx: isDesktop ? 72 : 64,
    minWidthPx: 50,
    maxWidthPx: isDesktop ? 144 : 124,
  };
}

export function computeHeroCoverFrameWidthPx(params: {
  naturalWidth: number | null | undefined;
  naturalHeight: number | null | undefined;
  compact: boolean;
  isDesktop: boolean;
}): number {
  const { naturalWidth, naturalHeight, compact, isDesktop } = params;
  const dims = getHeroCoverFrameDimensions({ compact, isDesktop });
  if (
    typeof naturalWidth !== 'number' ||
    typeof naturalHeight !== 'number' ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return dims.placeholderWidthPx;
  }
  const scaled = Math.round((naturalWidth / naturalHeight) * dims.heightPx);
  return Math.max(dims.minWidthPx, Math.min(dims.maxWidthPx, scaled));
}

export function getHeroSwapDurationMs(uiMotion: HeroCoverMotionTier): number {
  switch (uiMotion) {
    case 'off':
      return 0;
    case 'low':
      return 200;
    case 'medium':
      return 240;
    case 'high':
      return 260;
    case 'ultra':
      return 300;
  }
}

export function deriveSyncReleaseIdentityKey(
  target: ActiveSyncTargetCover | null,
): string | null {
  if (!target) return null;
  if (target.itemId !== null) {
    return `item:${target.itemId}`;
  }
  const normalizedTitle = target.title.trim().toLowerCase();
  if (!normalizedTitle) return null;
  const normalizedSystem = (target.systemName || '').trim().toLowerCase();
  return `title:${normalizedSystem}:${normalizedTitle}`;
}

/**
 * Grace window (in ms) before surfacing the subtle inline "Opening…" cue beside
 * the Monitor Hero Showcase game title when fetching release details. Local SQLite
 * lookups settle well below this threshold so normal clicks open cleanly with zero flash.
 */
export const HERO_DETAIL_LOADING_DELAY_MS = 250;


