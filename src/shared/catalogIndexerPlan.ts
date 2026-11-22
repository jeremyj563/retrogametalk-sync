import {
  classifySystemIndexFreshness,
  DEFAULT_INDEX_STALE_MS,
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
    const cutoffIso =
      existingCursor?.fullyIndexed
        ? computeCatalogDeltaCutoffIso(existingCursor.lastIndexedAt, overlapMs)
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
    const freshness = classifySystemIndexFreshness(dedupedTargets, indexState, nowMs, staleMs);

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
      // - If unindexed consoles exist, full-index them and delta-check any stale ones (skip fresh).
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
  } = params;

  if (strategy === 'delta' && existingCursor?.fullyIndexed) {
    return {
      lastIndexedAt: scanStartedAtIso,
      totalWpPosts: Math.max(0, (existingCursor.totalWpPosts ?? 0) + Math.max(0, newPostsDiscovered)),
      totalPages: existingCursor.totalPages ?? (totalPagesFetched || pagesIndexed),
      pagesIndexed: existingCursor.pagesIndexed ?? pagesIndexed,
      fullyIndexed: true,
      scope: existingCursor.scope ?? scope,
    };
  }

  return {
    lastIndexedAt: scanStartedAtIso,
    totalWpPosts: Math.max(0, totalPostsFetched),
    totalPages: totalPagesFetched || pagesIndexed,
    pagesIndexed,
    fullyIndexed: true,
    scope,
  };
}
