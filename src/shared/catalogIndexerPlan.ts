import {
  classifySystemIndexFreshness,
  DEFAULT_INDEX_STALE_MS,
  findLocalCatalogCountForSystem,
  isSystemIndexCursorComplete,
  type SystemIndexCursorLike,
} from './syncRuleMatcher.ts';
import { canonicalizeSystemSlug } from './systemCatalog.ts';

export type CatalogIndexScope = 'filtered' | 'full';
export type CatalogIndexStrategy = 'delta' | 'full';
export type CatalogIndexMode = 'delta' | 'full' | 'mixed';

/**
 * Safety overlap subtracted from each console's `lastIndexedAt` cursor during delta updates
 * so minor clock skew between the container and RetroGameTalk's WordPress server never drops
 * releases published or edited near the boundary.
 */
export const CATALOG_DELTA_OVERLAP_MS = 2 * 60 * 1000;

export interface CatalogIndexCursorRecord extends SystemIndexCursorLike {
  lastIndexedAt?: string;
  totalWpPosts?: number;
  totalPages?: number;
  pagesIndexed?: number;
  fullyIndexed?: boolean;
  scope?: CatalogIndexScope;
}

export interface PlannedCatalogIndexTarget {
  slug: string;
  strategy: CatalogIndexStrategy;
  modifiedAfterIso: string | null;
  existingCursor: CatalogIndexCursorRecord | null;
}

export interface CatalogIndexPlan {
  targets: PlannedCatalogIndexTarget[];
  mode: CatalogIndexMode | null;
}

export function findSystemIndexCursor<T extends CatalogIndexCursorRecord>(
  indexState: Record<string, T> | undefined,
  systemSlug: string,
): T | null {
  if (!indexState) return null;
  const canonical = canonicalizeSystemSlug(systemSlug).toLowerCase();
  if (indexState[canonical]) return indexState[canonical];
  if (indexState[systemSlug]) return indexState[systemSlug];
  for (const [key, cursor] of Object.entries(indexState)) {
    if (canonicalizeSystemSlug(key).toLowerCase() === canonical) {
      return cursor;
    }
  }
  return null;
}

export function computeCatalogDeltaCutoffIso(
  lastIndexedAt: string | null | undefined,
  overlapMs = CATALOG_DELTA_OVERLAP_MS,
): string | null {
  if (!lastIndexedAt) return null;
  const parsedMs = Date.parse(lastIndexedAt);
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(Math.max(0, parsedMs - Math.max(0, overlapMs))).toISOString();
}

export function planCatalogIndexTargets(params: {
  candidateTargets: readonly string[];
  indexState: Record<string, CatalogIndexCursorRecord> | undefined;
  scope: CatalogIndexScope;
  auto?: boolean;
  forceFull?: boolean;
  nowMs?: number;
  staleMs?: number;
  overlapMs?: number;
  catalogCountsBySystem?: Record<string, number>;
}): CatalogIndexPlan {
  const {
    candidateTargets,
    indexState,
    scope,
    auto = false,
    forceFull = false,
    nowMs = Date.now(),
    staleMs = DEFAULT_INDEX_STALE_MS,
    overlapMs = CATALOG_DELTA_OVERLAP_MS,
    catalogCountsBySystem,
  } = params;

  const dedupedTargets: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidateTargets) {
    const slug = canonicalizeSystemSlug(raw).toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    dedupedTargets.push(slug);
  }

  if (dedupedTargets.length === 0) {
    return { targets: [], mode: null };
  }

  const makeFullTarget = (slug: string): PlannedCatalogIndexTarget => ({
    slug,
    strategy: 'full',
    modifiedAfterIso: null,
    existingCursor: findSystemIndexCursor(indexState, slug),
  });

  const makeDeltaOrFullTarget = (slug: string): PlannedCatalogIndexTarget => {
    const existingCursor = findSystemIndexCursor(indexState, slug);
    const localCount = findLocalCatalogCountForSystem(catalogCountsBySystem, slug);
    const cutoffIso = isSystemIndexCursorComplete(existingCursor ?? undefined, localCount)
      ? computeCatalogDeltaCutoffIso(existingCursor?.lastIndexedAt, overlapMs)
      : null;
    if (cutoffIso) {
      return {
        slug,
        strategy: 'delta',
        modifiedAfterIso: cutoffIso,
        existingCursor,
      };
    }
    return {
      slug,
      strategy: 'full',
      modifiedAfterIso: null,
      existingCursor,
    };
  };

  let targets: PlannedCatalogIndexTarget[] = [];

  if (forceFull) {
    targets = dedupedTargets.map(makeFullTarget);
  } else {
    const freshness = classifySystemIndexFreshness(
      dedupedTargets,
      indexState,
      nowMs,
      staleMs,
      catalogCountsBySystem,
    );

    if (auto) {
      targets = freshness.unindexed.map(makeFullTarget);
    } else if (scope === 'full') {
      if (freshness.unindexed.length > 0) {
        targets = freshness.unindexed.map(makeFullTarget);
      } else {
        targets = [...freshness.stale, ...freshness.fresh].map(makeDeltaOrFullTarget);
      }
    } else {
      // Manual target-console indexing:
      // - If unindexed/incomplete consoles exist, full-index them and delta-check any stale ones (skip fresh).
      // - If all target consoles are already indexed, fast delta-check all of them (stale first, then fresh).
      if (freshness.unindexed.length > 0) {
        targets = [
          ...freshness.unindexed.map(makeFullTarget),
          ...freshness.stale.map(makeDeltaOrFullTarget),
        ];
      } else {
        targets = [...freshness.stale, ...freshness.fresh].map(makeDeltaOrFullTarget);
      }
    }
  }

  if (targets.length === 0) {
    return { targets: [], mode: null };
  }

  const hasFull = targets.some((t) => t.strategy === 'full');
  const hasDelta = targets.some((t) => t.strategy === 'delta');
  const mode: CatalogIndexMode = hasFull && hasDelta ? 'mixed' : hasDelta ? 'delta' : 'full';

  return { targets, mode };
}

export function buildUpdatedSystemIndexCursor(params: {
  existingCursor: CatalogIndexCursorRecord | null | undefined;
  strategy: CatalogIndexStrategy;
  scope: CatalogIndexScope;
  scanStartedAtIso: string;
  totalPostsFetched: number;
  newPostsDiscovered: number;
  totalPagesFetched: number;
  pagesIndexed: number;
  completed?: boolean;
  headerTotalPosts?: number | null;
}): {
  lastIndexedAt: string;
  totalWpPosts: number;
  totalPages: number;
  pagesIndexed: number;
  fullyIndexed: boolean;
  scope: CatalogIndexScope;
} {
  const {
    existingCursor,
    strategy,
    scope,
    scanStartedAtIso,
    totalPostsFetched,
    newPostsDiscovered,
    totalPagesFetched,
    pagesIndexed,
    completed = true,
    headerTotalPosts = null,
  } = params;

  if (strategy === 'delta' && existingCursor?.fullyIndexed) {
    // If a delta pagination scan stopped early, keep the previous timestamp so missed pages are retried next time
    const nextIndexedAt =
      completed ? scanStartedAtIso : (existingCursor.lastIndexedAt || scanStartedAtIso);
    return {
      lastIndexedAt: nextIndexedAt,
      totalWpPosts: Math.max(0, (existingCursor.totalWpPosts ?? 0) + Math.max(0, newPostsDiscovered)),
      totalPages: existingCursor.totalPages ?? (totalPagesFetched || pagesIndexed),
      pagesIndexed: existingCursor.pagesIndexed ?? pagesIndexed,
      fullyIndexed: true,
      scope: existingCursor.scope ?? scope,
    };
  }

  const resolvedTotalPages = Math.max(0, totalPagesFetched || 0, pagesIndexed || 0);
  const resolvedPagesIndexed = Math.max(0, pagesIndexed || 0);
  const hasHeaderZero = typeof headerTotalPosts === 'number' && headerTotalPosts === 0;
  const reachedAllPages = resolvedTotalPages === 0 || resolvedPagesIndexed >= resolvedTotalPages;
  const isComplete =
    completed &&
    reachedAllPages &&
    (totalPostsFetched > 0 || resolvedPagesIndexed > 0 || hasHeaderZero);

  const resolvedTotalPosts = isComplete
    ? Math.max(0, totalPostsFetched)
    : Math.max(
        0,
        totalPostsFetched,
        typeof headerTotalPosts === 'number' && Number.isFinite(headerTotalPosts) ? headerTotalPosts : 0,
        existingCursor?.totalWpPosts ?? 0,
      );

  return {
    lastIndexedAt: scanStartedAtIso,
    totalWpPosts: resolvedTotalPosts,
    totalPages: resolvedTotalPages,
    pagesIndexed: resolvedPagesIndexed,
    fullyIndexed: isComplete,
    scope,
  };
}

export interface LiveIndexerReloadReceipt {
  applied: boolean;
  scope: CatalogIndexScope;
  addedSystems: string[];
  removedSystems: string[];
  abortedCurrentSystem: string | null;
  reprioritized: boolean;
  changeSummary: string;
}

export interface ReconciledCatalogIndexQueue {
  abortCurrentSystem: boolean;
  nextQueue: PlannedCatalogIndexTarget[];
  addedSlugs: string[];
  removedSlugs: string[];
  reprioritized: boolean;
  changed: boolean;
}

/**
 * Reconciles an active catalog indexer's current console and pending queue against
 * newly saved Target Console rules without losing progress on still-selected consoles.
 *
 * - For `filtered` runs: immediately cancels the active console if unchecked, drops
 *   unchecked queued consoles, and splices newly added consoles from `desiredPlan`
 *   directly into the live queue (prioritizing newly added full-index targets ahead
 *   of remaining delta checks).
 * - For `full` runs: never drops site consoles, but pulls newly selected priority
 *   consoles to the front of the remaining queue and splices in any newly configured
 *   target not yet queued or completed.
 */
export function reconcileActiveCatalogIndexQueue(params: {
  scope: CatalogIndexScope;
  currentTarget: PlannedCatalogIndexTarget | null;
  remainingQueue: readonly PlannedCatalogIndexTarget[];
  completedSlugs: ReadonlySet<string>;
  desiredCandidateSlugs: readonly string[];
  desiredPlan: CatalogIndexPlan;
}): ReconciledCatalogIndexQueue {
  const {
    scope,
    currentTarget,
    remainingQueue,
    completedSlugs,
    desiredCandidateSlugs,
    desiredPlan,
  } = params;

  const canonicalize = (slug: string) => canonicalizeSystemSlug(slug).toLowerCase();

  const desiredCandidateOrder: string[] = [];
  const desiredCandidateSet = new Set<string>();
  for (const raw of desiredCandidateSlugs) {
    const slug = canonicalize(raw);
    if (!slug || desiredCandidateSet.has(slug)) continue;
    desiredCandidateSet.add(slug);
    desiredCandidateOrder.push(slug);
  }

  const completedCanonical = new Set<string>();
  for (const slug of completedSlugs) {
    completedCanonical.add(canonicalize(slug));
  }

  const currentSlug = currentTarget ? canonicalize(currentTarget.slug) : null;

  if (scope === 'full') {
    const priorityRank = new Map<string, number>();
    desiredCandidateOrder.forEach((slug, idx) => {
      priorityRank.set(slug, idx);
    });

    const existingSlugs = new Set<string>();
    const keptQueue: PlannedCatalogIndexTarget[] = [];
    for (const item of remainingQueue) {
      const slug = canonicalize(item.slug);
      existingSlugs.add(slug);
      keptQueue.push(item);
    }

    const addedTargets: PlannedCatalogIndexTarget[] = [];
    const addedSlugs: string[] = [];
    for (const target of desiredPlan.targets) {
      const slug = canonicalize(target.slug);
      if (completedCanonical.has(slug) || slug === currentSlug || existingSlugs.has(slug)) {
        continue;
      }
      existingSlugs.add(slug);
      addedTargets.push(target);
      addedSlugs.push(slug);
    }

    const combined = [...addedTargets, ...keptQueue];
    const beforeOrder = remainingQueue.map((t) => canonicalize(t.slug));
    const reordered = [...combined].sort((a, b) => {
      const rankA = priorityRank.get(canonicalize(a.slug));
      const rankB = priorityRank.get(canonicalize(b.slug));
      const aHas = rankA !== undefined;
      const bHas = rankB !== undefined;
      if (aHas && bHas) return rankA - rankB;
      if (aHas) return -1;
      if (bHas) return 1;
      return 0;
    });
    const afterOrder = reordered.map((t) => canonicalize(t.slug));
    const reprioritized =
      addedSlugs.length === 0 &&
      beforeOrder.length === afterOrder.length &&
      beforeOrder.some((slug, idx) => slug !== afterOrder[idx]);

    return {
      abortCurrentSystem: false,
      nextQueue: reordered,
      addedSlugs,
      removedSlugs: [],
      reprioritized,
      changed: addedSlugs.length > 0 || reprioritized,
    };
  }

  // Filtered (Target Consoles) scope:
  // 1. Check whether the currently paginating console was unchecked
  const abortCurrentSystem = Boolean(currentSlug && !desiredCandidateSet.has(currentSlug));
  const removedSlugs: string[] = [];
  if (abortCurrentSystem && currentSlug) {
    removedSlugs.push(currentSlug);
  }

  // 2. Keep still-selected queued consoles; drop unchecked ones
  const survivingQueue: PlannedCatalogIndexTarget[] = [];
  const survivingSet = new Set<string>();
  for (const item of remainingQueue) {
    const slug = canonicalize(item.slug);
    if (!desiredCandidateSet.has(slug)) {
      removedSlugs.push(slug);
      continue;
    }
    if (!survivingSet.has(slug)) {
      survivingSet.add(slug);
      survivingQueue.push(item);
    }
  }

  // 3. Splice in newly checked consoles from desiredPlan that aren't already running/queued/completed
  const addedTargets: PlannedCatalogIndexTarget[] = [];
  const addedSlugs: string[] = [];
  for (const target of desiredPlan.targets) {
    const slug = canonicalize(target.slug);
    const isActiveUnaborted = Boolean(currentSlug && slug === currentSlug && !abortCurrentSystem);
    if (completedCanonical.has(slug) || isActiveUnaborted || survivingSet.has(slug)) {
      continue;
    }
    survivingSet.add(slug);
    addedTargets.push(target);
    addedSlugs.push(slug);
  }

  // Put newly added full-index targets ahead of any lingering delta targets so freshly checked
  // unindexed consoles populate Catalog as soon as possible.
  const newlyAddedFull = addedTargets.filter((t) => t.strategy === 'full');
  const newlyAddedDelta = addedTargets.filter((t) => t.strategy !== 'full');
  const survivingFull = survivingQueue.filter((t) => t.strategy === 'full');
  const survivingDelta = survivingQueue.filter((t) => t.strategy !== 'full');
  const nextQueue = [...survivingFull, ...newlyAddedFull, ...survivingDelta, ...newlyAddedDelta];

  return {
    abortCurrentSystem,
    nextQueue,
    addedSlugs,
    removedSlugs,
    reprioritized: false,
    changed: abortCurrentSystem || addedSlugs.length > 0 || removedSlugs.length > 0,
  };
}

export function formatLiveIndexerReloadSummary(params: {
  addedSystems: readonly string[];
  removedSystems: readonly string[];
  abortedCurrentSystem: string | null;
  reprioritized: boolean;
}): string {
  const formatList = (items: readonly string[]): string =>
    items.length <= 3 ? items.join(', ') : `${items.slice(0, 2).join(', ')} +${items.length - 2} more`;

  const parts: string[] = [];
  if (params.addedSystems.length > 0) {
    parts.push(`queued ${formatList(params.addedSystems)}`);
  }
  if (params.removedSystems.length > 0) {
    const removedLabel = formatList(params.removedSystems);
    parts.push(
      params.abortedCurrentSystem
        ? `dropped ${removedLabel} (cancelled active ${params.abortedCurrentSystem})`
        : `dropped ${removedLabel}`,
    );
  }
  if (parts.length === 0 && params.reprioritized) {
    parts.push('reprioritized remaining queue');
  }
  return parts.join(' · ');
}

