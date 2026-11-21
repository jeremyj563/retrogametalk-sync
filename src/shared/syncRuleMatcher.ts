import {
  classifyFileRoleToTypeKeys,
  classifyReleaseTagsToTypeKeys,
  evaluateReleaseTypeMatch,
  formatAllowedReleaseTypesSummary,
  normalizeAllowedReleaseTypes,
} from './releaseTypeFilter.ts';
import {
  canonicalizeSystemSlug,
  filterValidSystemSlugs,
} from './systemCatalog.ts';

export const DEFAULT_INDEX_STALE_HOURS = 12;
export const DEFAULT_INDEX_STALE_MS = DEFAULT_INDEX_STALE_HOURS * 60 * 60 * 1000;

export interface SystemIndexCursorLike {
  lastIndexedAt?: string;
  fullyIndexed?: boolean;
}

export interface SystemIndexFreshnessSummary {
  fresh: string[];
  stale: string[];
  unindexed: string[];
  oldestIndexedAt: string | null;
}

export interface SyncRuleReleaseCandidate {
  systemName: string;
  releaseType?: string | null;
  releaseTags?: readonly string[] | null;
  fileRoles?: readonly string[] | null;
}

export interface SyncRuleConfigLike {
  systemFilter?: string | null;
  allowedReleaseTypes?: readonly string[] | string | null;
}

export function normalizeTargetConsoleSlugs(systemFilter: string | null | undefined): string[] {
  const raw = String(systemFilter || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length === 0) return [];
  return filterValidSystemSlugs(raw).map((s) => s.toLowerCase());
}

export function resolveTargetConsoleScope(
  systemFilter: string | null | undefined,
  discoveredSystems: readonly string[] = [],
): string[] {
  const explicit = normalizeTargetConsoleSlugs(systemFilter);
  if (explicit.length > 0) return explicit;
  return filterValidSystemSlugs(discoveredSystems).map((s) => s.toLowerCase());
}

export function classifySystemIndexFreshness(
  targetSystems: readonly string[],
  systemIndexState: Record<string, SystemIndexCursorLike> | undefined,
  nowMs = Date.now(),
  staleMs = DEFAULT_INDEX_STALE_MS,
): SystemIndexFreshnessSummary {
  const state = systemIndexState || {};
  const fresh: string[] = [];
  const stale: string[] = [];
  const unindexed: string[] = [];
  let oldestMs = Infinity;
  let oldestIndexedAt: string | null = null;

  const findCursor = (canonicalSlug: string): SystemIndexCursorLike | undefined => {
    if (state[canonicalSlug]) return state[canonicalSlug];
    for (const [key, cursor] of Object.entries(state)) {
      if (canonicalizeSystemSlug(key).toLowerCase() === canonicalSlug) {
        return cursor;
      }
    }
    return undefined;
  };

  const seen = new Set<string>();
  for (const raw of targetSystems) {
    const slug = canonicalizeSystemSlug(raw).toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const cursor = findCursor(slug);
    if (!cursor || !cursor.fullyIndexed || !cursor.lastIndexedAt) {
      unindexed.push(slug);
      continue;
    }

    const indexedMs = Date.parse(cursor.lastIndexedAt);
    if (!Number.isFinite(indexedMs)) {
      unindexed.push(slug);
      continue;
    }

    if (indexedMs < oldestMs) {
      oldestMs = indexedMs;
      oldestIndexedAt = cursor.lastIndexedAt;
    }

    if (nowMs - indexedMs > staleMs) {
      stale.push(slug);
    } else {
      fresh.push(slug);
    }
  }

  return {
    fresh,
    stale,
    unindexed,
    oldestIndexedAt,
  };
}

export function doesCatalogReleaseMatchSyncRules(
  release: SyncRuleReleaseCandidate,
  config: SyncRuleConfigLike,
): boolean {
  const targetSystems = normalizeTargetConsoleSlugs(config.systemFilter);
  if (targetSystems.length > 0) {
    const releaseSystemCanonical = canonicalizeSystemSlug(release.systemName).toLowerCase();
    if (!targetSystems.includes(releaseSystemCanonical)) {
      return false;
    }
  }

  const allowedTypes = normalizeAllowedReleaseTypes(config.allowedReleaseTypes ?? []);
  if (allowedTypes.length === 0) {
    return true;
  }

  const tags =
    release.releaseTags && release.releaseTags.length > 0
      ? [...release.releaseTags]
      : release.releaseType
        ? [release.releaseType]
        : [];

  const fileRoles = (release.fileRoles || []).map((r) => r.trim()).filter(Boolean);
  if (fileRoles.length > 0) {
    for (const role of fileRoles) {
      const roleKeys = classifyFileRoleToTypeKeys(role, tags, release.systemName);
      if (evaluateReleaseTypeMatch(roleKeys, allowedTypes).allowed) {
        return true;
      }
    }
    return false;
  }

  const releaseKeys = classifyReleaseTagsToTypeKeys(tags, release.systemName);
  return evaluateReleaseTypeMatch(releaseKeys, allowedTypes).allowed;
}

export function formatSyncRuleScopeSummary(
  systemFilter: string | null | undefined,
  allowedReleaseTypes: readonly string[] | string | null | undefined,
): string {
  const systems = normalizeTargetConsoleSlugs(systemFilter);
  const sysPart =
    systems.length === 0
      ? 'All consoles'
      : systems.length <= 3
        ? systems.join(', ')
        : `${systems.slice(0, 2).join(', ')} +${systems.length - 2} more`;

  const normalizedTypes = normalizeAllowedReleaseTypes(allowedReleaseTypes ?? []);
  const typePart =
    normalizedTypes.length === 0
      ? 'All release types'
      : formatAllowedReleaseTypesSummary(normalizedTypes);

  return `${sysPart} · ${typePart}`;
}

export interface LiveSyncReloadReceipt {
  applied: boolean;
  runId: number;
  runMode: 'incremental' | 'full' | 'download' | 'retry';
  dryRun: boolean;
  kind?: 'rules' | 'runtime' | 'both';
  changeSummary: string;
  scopeSummary: string;
}

export function formatLiveReloadRunLabel(run: {
  runMode?: 'incremental' | 'full' | 'download' | 'retry' | string;
  mode?: string;
  triggerType?: string;
  dryRun?: boolean;
}): string {
  const mode =
    run.runMode ??
    (run.triggerType === 'download'
      ? 'download'
      : run.triggerType === 'retry'
        ? 'retry'
        : run.mode === 'full'
          ? 'full'
          : 'incremental');
  const baseLabel =
    mode === 'full'
      ? 'Full Sync'
      : mode === 'download'
        ? 'Download Queue'
        : mode === 'retry'
          ? 'Retry Failed'
          : 'Incremental Sync';
  return run.dryRun ? `${baseLabel} Dry Run` : baseLabel;
}

export interface RuntimeSyncSettingsConfigLike {
  baseDelayMs?: number | null;
  minDelayMs?: number | null;
  maxDelayMs?: number | null;
  backoffMultiplier?: number | null;
  maxRetries?: number | null;
  maxConcurrency?: number | null;
  downloadChunkConcurrency?: number | null;
  downloadChunkMinSizeMb?: number | null;
  requestTimeoutMs?: number | null;
  userAgent?: string | null;
  autoDownloadNewReleases?: boolean | null;
}

export interface RuntimeSyncSettingsDiff {
  changed: boolean;
  pacingChanged: boolean;
  concurrencyChanged: boolean;
  chunkingChanged: boolean;
  networkChanged: boolean;
  autoDownloadChanged: boolean;
  changedFields: string[];
  changeSummary: string;
}

function formatMsCompact(ms: number): string {
  if (ms >= 1000 && ms % 1000 === 0) {
    return `${ms / 1000}s`;
  }
  return `${ms}ms`;
}

export function diffRuntimeSyncSettings(
  prevConfig: RuntimeSyncSettingsConfigLike,
  nextConfig: RuntimeSyncSettingsConfigLike,
): RuntimeSyncSettingsDiff {
  const parts: string[] = [];
  const changedFields: string[] = [];

  const prevBase = Number(prevConfig.baseDelayMs ?? 0);
  const nextBase = Number(nextConfig.baseDelayMs ?? 0);
  const prevMin = Number(prevConfig.minDelayMs ?? 0);
  const nextMin = Number(nextConfig.minDelayMs ?? 0);
  const prevMax = Number(prevConfig.maxDelayMs ?? 0);
  const nextMax = Number(nextConfig.maxDelayMs ?? 0);
  const prevBackoff = Number(prevConfig.backoffMultiplier ?? 0);
  const nextBackoff = Number(nextConfig.backoffMultiplier ?? 0);

  let pacingChanged = false;
  if (prevBase !== nextBase) {
    pacingChanged = true;
    changedFields.push('baseDelayMs');
    parts.push(`Delay ${formatMsCompact(prevBase)}→${formatMsCompact(nextBase)}`);
  }
  if (prevMin !== nextMin) {
    pacingChanged = true;
    changedFields.push('minDelayMs');
    if (prevBase === nextBase) {
      parts.push(`Min delay ${formatMsCompact(prevMin)}→${formatMsCompact(nextMin)}`);
    }
  }
  if (prevMax !== nextMax) {
    pacingChanged = true;
    changedFields.push('maxDelayMs');
    if (prevBase === nextBase) {
      parts.push(`Max cooldown ${formatMsCompact(prevMax)}→${formatMsCompact(nextMax)}`);
    }
  }
  if (Math.abs(prevBackoff - nextBackoff) >= 0.001) {
    pacingChanged = true;
    changedFields.push('backoffMultiplier');
    parts.push(`Backoff ${prevBackoff.toFixed(1)}x→${nextBackoff.toFixed(1)}x`);
  }

  const prevWorkers = Number(prevConfig.maxConcurrency ?? 1);
  const nextWorkers = Number(nextConfig.maxConcurrency ?? 1);
  const concurrencyChanged = prevWorkers !== nextWorkers;
  if (concurrencyChanged) {
    changedFields.push('maxConcurrency');
    parts.push(`Workers ${prevWorkers}→${nextWorkers}`);
  }

  const prevChunks = Number(prevConfig.downloadChunkConcurrency ?? 1);
  const nextChunks = Number(nextConfig.downloadChunkConcurrency ?? 1);
  const prevChunkMb = Number(prevConfig.downloadChunkMinSizeMb ?? 32);
  const nextChunkMb = Number(nextConfig.downloadChunkMinSizeMb ?? 32);
  let chunkingChanged = false;
  if (prevChunks !== nextChunks) {
    chunkingChanged = true;
    changedFields.push('downloadChunkConcurrency');
    parts.push(`Chunks ${prevChunks}x→${nextChunks}x`);
  }
  if (prevChunkMb !== nextChunkMb) {
    chunkingChanged = true;
    changedFields.push('downloadChunkMinSizeMb');
    parts.push(`Chunk threshold ${prevChunkMb}→${nextChunkMb} MiB`);
  }

  const prevRetries = Number(prevConfig.maxRetries ?? 0);
  const nextRetries = Number(nextConfig.maxRetries ?? 0);
  const prevTimeout = Number(prevConfig.requestTimeoutMs ?? 0);
  const nextTimeout = Number(nextConfig.requestTimeoutMs ?? 0);
  const prevUa = String(prevConfig.userAgent ?? '').trim();
  const nextUa = String(nextConfig.userAgent ?? '').trim();
  let networkChanged = false;
  if (prevRetries !== nextRetries) {
    networkChanged = true;
    changedFields.push('maxRetries');
    parts.push(`Retries ${prevRetries}→${nextRetries}`);
  }
  if (prevTimeout !== nextTimeout) {
    networkChanged = true;
    changedFields.push('requestTimeoutMs');
    parts.push(`Timeout ${formatMsCompact(prevTimeout)}→${formatMsCompact(nextTimeout)}`);
  }
  if (prevUa !== nextUa) {
    networkChanged = true;
    changedFields.push('userAgent');
    parts.push('User-Agent updated');
  }

  const autoDownloadChanged =
    prevConfig.autoDownloadNewReleases !== undefined &&
    nextConfig.autoDownloadNewReleases !== undefined &&
    Boolean(prevConfig.autoDownloadNewReleases) !== Boolean(nextConfig.autoDownloadNewReleases);
  if (autoDownloadChanged) {
    changedFields.push('autoDownloadNewReleases');
    parts.push(
      nextConfig.autoDownloadNewReleases
        ? 'Scheduled auto-download enabled'
        : 'Scheduled auto-download paused',
    );
  }

  const changed =
    pacingChanged || concurrencyChanged || chunkingChanged || networkChanged || autoDownloadChanged;

  return {
    changed,
    pacingChanged,
    concurrencyChanged,
    chunkingChanged,
    networkChanged,
    autoDownloadChanged,
    changedFields,
    changeSummary: parts.join(' · ') || 'No runtime changes',
  };
}

export interface SyncRuleDiff {
  changed: boolean;
  consolesChanged: boolean;
  releaseTypesChanged: boolean;
  releaseTypesWidened: boolean;
  addedConsoles: string[];
  removedConsoles: string[];
  scopeSummary: string;
  changeSummary: string;
}

export function isConsoleAllowedBySyncRules(
  systemSlug: string | null | undefined,
  config: SyncRuleConfigLike,
): boolean {
  const targetSystems = normalizeTargetConsoleSlugs(config.systemFilter);
  if (targetSystems.length === 0) {
    return true;
  }
  const canonical = canonicalizeSystemSlug(String(systemSlug || '')).toLowerCase();
  if (!canonical) return false;
  return targetSystems.includes(canonical);
}

/**
 * Only Full Sync and Incremental Sync runs (manual or scheduled, including Dry Runs)
 * participate in live mid-run Sync Rule hot-reloading.
 * Manual Catalog download queues ('download') and failed-item retries ('retry') stay untouched.
 */
export function isSyncRunEligibleForLiveRuleReload(
  run: { triggerType?: string; mode?: string } | null | undefined,
): boolean {
  if (!run) return false;
  return run.triggerType !== 'download' && run.triggerType !== 'retry';
}

export function diffSyncRules(
  prevConfig: SyncRuleConfigLike,
  nextConfig: SyncRuleConfigLike,
  discoveredSystems: readonly string[] = [],
): SyncRuleDiff {
  const prevExplicit = normalizeTargetConsoleSlugs(prevConfig.systemFilter);
  const nextExplicit = normalizeTargetConsoleSlugs(nextConfig.systemFilter);
  const prevResolved = resolveTargetConsoleScope(prevConfig.systemFilter, discoveredSystems);
  const nextResolved = resolveTargetConsoleScope(nextConfig.systemFilter, discoveredSystems);

  const prevResolvedSet = new Set(prevResolved);
  const nextResolvedSet = new Set(nextResolved);

  const addedConsoles = nextResolved.filter((slug) => !prevResolvedSet.has(slug));
  const removedConsoles = prevResolved.filter((slug) => !nextResolvedSet.has(slug));

  const prevExplicitSorted = [...prevExplicit].sort().join(',');
  const nextExplicitSorted = [...nextExplicit].sort().join(',');
  const consolesChanged =
    prevExplicitSorted !== nextExplicitSorted ||
    addedConsoles.length > 0 ||
    removedConsoles.length > 0;

  const prevTypes = normalizeAllowedReleaseTypes(prevConfig.allowedReleaseTypes ?? []);
  const nextTypes = normalizeAllowedReleaseTypes(nextConfig.allowedReleaseTypes ?? []);
  const prevTypeSet = new Set(prevTypes);
  const nextTypeSet = new Set(nextTypes);

  const releaseTypesChanged =
    prevTypes.length !== nextTypes.length ||
    prevTypes.some((t) => !nextTypeSet.has(t)) ||
    nextTypes.some((t) => !prevTypeSet.has(t));

  // Widened means: switched from custom allowlist to All Release Types ([]),
  // OR added at least one new release type key while staying in custom allowlist mode.
  const releaseTypesWidened =
    releaseTypesChanged &&
    ((prevTypes.length > 0 && nextTypes.length === 0) ||
      (prevTypes.length > 0 && nextTypes.some((t) => !prevTypeSet.has(t))));

  const parts: string[] = [];
  if (addedConsoles.length > 0) {
    parts.push(
      addedConsoles.length <= 3
        ? `+${addedConsoles.join(', +')}`
        : `+${addedConsoles.length} consoles`,
    );
  }
  if (removedConsoles.length > 0) {
    parts.push(
      removedConsoles.length <= 3
        ? `-${removedConsoles.join(', -')}`
        : `-${removedConsoles.length} consoles`,
    );
  }
  if (consolesChanged && addedConsoles.length === 0 && removedConsoles.length === 0) {
    parts.push(nextExplicit.length === 0 ? 'All consoles enabled' : 'Console scope updated');
  }
  if (releaseTypesChanged) {
    parts.push(
      nextTypes.length === 0
        ? 'All release types enabled'
        : `Types: ${formatAllowedReleaseTypesSummary(nextTypes)}`,
    );
  }

  return {
    changed: consolesChanged || releaseTypesChanged,
    consolesChanged,
    releaseTypesChanged,
    releaseTypesWidened,
    addedConsoles,
    removedConsoles,
    scopeSummary: formatSyncRuleScopeSummary(nextConfig.systemFilter, nextConfig.allowedReleaseTypes),
    changeSummary: parts.join(' · ') || 'No rule changes',
  };
}

