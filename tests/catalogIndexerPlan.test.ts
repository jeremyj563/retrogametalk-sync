import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildUpdatedSystemIndexCursor,
  CATALOG_DELTA_OVERLAP_MS,
  computeCatalogDeltaCutoffIso,
  findSystemIndexCursor,
  formatLiveIndexerReloadSummary,
  planCatalogIndexTargets,
  reconcileActiveCatalogIndexQueue,
  type CatalogIndexCursorRecord,
  type PlannedCatalogIndexTarget,
} from '../src/shared/catalogIndexerPlan.ts';
import { DEFAULT_INDEX_STALE_MS } from '../src/shared/syncRuleMatcher.ts';

const NOW_ISO = '2026-11-22T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const FRESH_ISO = new Date(NOW_MS - 30 * 60 * 1000).toISOString(); // 30m ago
const STALE_ISO = new Date(NOW_MS - DEFAULT_INDEX_STALE_MS - 60 * 60 * 1000).toISOString(); // > stale threshold

test('computeCatalogDeltaCutoffIso subtracts safety overlap and handles invalid input', () => {
  assert.equal(computeCatalogDeltaCutoffIso(null), null);
  assert.equal(computeCatalogDeltaCutoffIso(undefined), null);
  assert.equal(computeCatalogDeltaCutoffIso('not-a-date'), null);

  const expectedDefault = new Date(Date.parse(NOW_ISO) - CATALOG_DELTA_OVERLAP_MS).toISOString();
  assert.equal(computeCatalogDeltaCutoffIso(NOW_ISO), expectedDefault);

  const expectedCustom = new Date(Date.parse(NOW_ISO) - 5 * 60 * 1000).toISOString();
  assert.equal(computeCatalogDeltaCutoffIso(NOW_ISO, 5 * 60 * 1000), expectedCustom);
});

test('findSystemIndexCursor resolves canonical and alias system slugs', () => {
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    gb_roms: {
      lastIndexedAt: FRESH_ISO,
      fullyIndexed: true,
      totalWpPosts: 420,
    },
    gamecube: {
      lastIndexedAt: STALE_ISO,
      fullyIndexed: true,
      totalWpPosts: 310,
    },
  };

  assert.equal(findSystemIndexCursor(indexState, 'gameboy-roms')?.totalWpPosts, 420);
  assert.equal(findSystemIndexCursor(indexState, 'gb-roms')?.totalWpPosts, 420);
  assert.equal(findSystemIndexCursor(indexState, 'gcn-iso')?.totalWpPosts, 310);
  assert.equal(findSystemIndexCursor(indexState, 'snes'), null);
});

test('planCatalogIndexTargets runs delta checks on all targets when all target consoles are already indexed', () => {
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 800, totalPages: 8, pagesIndexed: 8 },
    gba: { lastIndexedAt: STALE_ISO, fullyIndexed: true, totalWpPosts: 1200, totalPages: 12, pagesIndexed: 12 },
    gb_roms: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 500, totalPages: 5, pagesIndexed: 5 },
  };

  const plan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba', 'gameboy-roms', 'gb-roms'],
    indexState,
    scope: 'filtered',
    nowMs: NOW_MS,
  });

  assert.equal(plan.mode, 'delta');
  // Stale console prioritized first, then fresh consoles (deduped via canonical slug)
  assert.deepEqual(
    plan.targets.map((t) => t.slug),
    ['gba', 'snes', 'gameboy-roms'],
  );
  assert.ok(plan.targets.every((t) => t.strategy === 'delta'));
  assert.equal(plan.targets[0]?.modifiedAfterIso, computeCatalogDeltaCutoffIso(STALE_ISO));
  assert.equal(plan.targets[1]?.modifiedAfterIso, computeCatalogDeltaCutoffIso(FRESH_ISO));
  assert.equal(plan.targets[2]?.modifiedAfterIso, computeCatalogDeltaCutoffIso(FRESH_ISO));
});

test('planCatalogIndexTargets runs mixed mode when unindexed, stale, and fresh target consoles coexist', () => {
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 800 },
    gba: { lastIndexedAt: STALE_ISO, fullyIndexed: true, totalWpPosts: 1200 },
    n64: { lastIndexedAt: FRESH_ISO, fullyIndexed: false, totalWpPosts: 50 },
  };

  const plan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba', 'n64', 'psx'],
    indexState,
    scope: 'filtered',
    nowMs: NOW_MS,
  });

  assert.equal(plan.mode, 'mixed');
  // Unindexed consoles run full, stale consoles run delta, already-fresh consoles are skipped
  assert.deepEqual(
    plan.targets.map((t) => ({ slug: t.slug, strategy: t.strategy })),
    [
      { slug: 'n64', strategy: 'full' },
      { slug: 'psx', strategy: 'full' },
      { slug: 'gba', strategy: 'delta' },
    ],
  );
  assert.equal(plan.targets[0]?.modifiedAfterIso, null);
  assert.equal(plan.targets[1]?.modifiedAfterIso, null);
  assert.equal(plan.targets[2]?.modifiedAfterIso, computeCatalogDeltaCutoffIso(STALE_ISO));
});

test('planCatalogIndexTargets with auto=true only indexes unindexed consoles and returns empty when all indexed', () => {
  const partialState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: STALE_ISO, fullyIndexed: true, totalWpPosts: 800 },
  };

  const partialPlan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba'],
    indexState: partialState,
    scope: 'filtered',
    auto: true,
    nowMs: NOW_MS,
  });
  assert.equal(partialPlan.mode, 'full');
  assert.deepEqual(
    partialPlan.targets.map((t) => ({ slug: t.slug, strategy: t.strategy })),
    [{ slug: 'gba', strategy: 'full' }],
  );

  const completeState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: STALE_ISO, fullyIndexed: true, totalWpPosts: 800 },
    gba: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 1200 },
  };
  const completePlan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba'],
    indexState: completeState,
    scope: 'filtered',
    auto: true,
    nowMs: NOW_MS,
  });
  assert.equal(completePlan.mode, null);
  assert.deepEqual(completePlan.targets, []);
});

test('planCatalogIndexTargets with scope=full indexes only unindexed consoles first, then delta-checks once all indexed', () => {
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: STALE_ISO, fullyIndexed: true, totalWpPosts: 800 },
  };

  const remainingPlan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba', 'psx'],
    indexState,
    scope: 'full',
    nowMs: NOW_MS,
  });
  assert.equal(remainingPlan.mode, 'full');
  assert.deepEqual(
    remainingPlan.targets.map((t) => t.slug),
    ['gba', 'psx'],
  );

  const allIndexedState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 800 },
    gba: { lastIndexedAt: STALE_ISO, fullyIndexed: true, totalWpPosts: 1200 },
  };
  const deltaFullPlan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba'],
    indexState: allIndexedState,
    scope: 'full',
    nowMs: NOW_MS,
  });
  assert.equal(deltaFullPlan.mode, 'delta');
  assert.deepEqual(
    deltaFullPlan.targets.map((t) => ({ slug: t.slug, strategy: t.strategy })),
    [
      { slug: 'gba', strategy: 'delta' },
      { slug: 'snes', strategy: 'delta' },
    ],
  );
});

test('planCatalogIndexTargets with forceFull=true forces full re-index across all candidate targets', () => {
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    snes: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 800 },
    gba: { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 1200 },
  };

  const plan = planCatalogIndexTargets({
    candidateTargets: ['snes', 'gba'],
    indexState,
    scope: 'filtered',
    forceFull: true,
    nowMs: NOW_MS,
  });

  assert.equal(plan.mode, 'full');
  assert.deepEqual(
    plan.targets.map((t) => ({ slug: t.slug, strategy: t.strategy, modifiedAfterIso: t.modifiedAfterIso })),
    [
      { slug: 'snes', strategy: 'full', modifiedAfterIso: null },
      { slug: 'gba', strategy: 'full', modifiedAfterIso: null },
    ],
  );
});

test('buildUpdatedSystemIndexCursor preserves totals in delta mode and replaces totals in full mode', () => {
  const existing: CatalogIndexCursorRecord = {
    lastIndexedAt: STALE_ISO,
    totalWpPosts: 950,
    totalPages: 10,
    pagesIndexed: 10,
    fullyIndexed: true,
    scope: 'filtered',
  };

  // Delta with 0 changes advances lastIndexedAt without clobbering counts
  const deltaZero = buildUpdatedSystemIndexCursor({
    existingCursor: existing,
    strategy: 'delta',
    scope: 'filtered',
    scanStartedAtIso: NOW_ISO,
    totalPostsFetched: 0,
    newPostsDiscovered: 0,
    totalPagesFetched: 1,
    pagesIndexed: 0,
  });
  assert.deepEqual(deltaZero, {
    lastIndexedAt: NOW_ISO,
    totalWpPosts: 950,
    totalPages: 10,
    pagesIndexed: 10,
    fullyIndexed: true,
    scope: 'filtered',
  });

  // Delta with 5 updated posts where 2 are brand new increments totalWpPosts by 2 only
  const deltaUpdates = buildUpdatedSystemIndexCursor({
    existingCursor: existing,
    strategy: 'delta',
    scope: 'full',
    scanStartedAtIso: NOW_ISO,
    totalPostsFetched: 5,
    newPostsDiscovered: 2,
    totalPagesFetched: 1,
    pagesIndexed: 1,
  });
  assert.deepEqual(deltaUpdates, {
    lastIndexedAt: NOW_ISO,
    totalWpPosts: 952,
    totalPages: 10,
    pagesIndexed: 10,
    fullyIndexed: true,
    scope: 'filtered',
  });

  // Full re-index replaces totalWpPosts and page totals cleanly
  const fullRebuild = buildUpdatedSystemIndexCursor({
    existingCursor: existing,
    strategy: 'full',
    scope: 'filtered',
    scanStartedAtIso: NOW_ISO,
    totalPostsFetched: 963,
    newPostsDiscovered: 13,
    totalPagesFetched: 10,
    pagesIndexed: 10,
  });
  assert.deepEqual(fullRebuild, {
    lastIndexedAt: NOW_ISO,
    totalWpPosts: 963,
    totalPages: 10,
    pagesIndexed: 10,
    fullyIndexed: true,
    scope: 'filtered',
  });
});

test('buildUpdatedSystemIndexCursor refuses to mark incomplete full scans as fullyIndexed and preserves lastIndexedAt on truncated deltas', () => {
  // Full scan stopped at page 2 of 24 (e.g., mid-pagination HTTP error or non-JSON hiccup)
  const partialFull = buildUpdatedSystemIndexCursor({
    existingCursor: null,
    strategy: 'full',
    scope: 'filtered',
    scanStartedAtIso: NOW_ISO,
    totalPostsFetched: 200,
    newPostsDiscovered: 200,
    totalPagesFetched: 24,
    pagesIndexed: 2,
    completed: false,
    headerTotalPosts: 2325,
  });
  assert.equal(partialFull.fullyIndexed, false);
  assert.equal(partialFull.totalWpPosts, 2325);
  assert.equal(partialFull.totalPages, 24);
  assert.equal(partialFull.pagesIndexed, 2);

  // Even if completed flag was omitted, pagesIndexed < totalPagesFetched marks incomplete
  const pageMismatch = buildUpdatedSystemIndexCursor({
    existingCursor: null,
    strategy: 'full',
    scope: 'filtered',
    scanStartedAtIso: NOW_ISO,
    totalPostsFetched: 100,
    newPostsDiscovered: 100,
    totalPagesFetched: 24,
    pagesIndexed: 1,
  });
  assert.equal(pageMismatch.fullyIndexed, false);

  // Truncated delta scan does NOT advance lastIndexedAt so missed delta window is retried
  const existingComplete: CatalogIndexCursorRecord = {
    lastIndexedAt: STALE_ISO,
    totalWpPosts: 2325,
    totalPages: 24,
    pagesIndexed: 24,
    fullyIndexed: true,
    scope: 'filtered',
  };
  const truncatedDelta = buildUpdatedSystemIndexCursor({
    existingCursor: existingComplete,
    strategy: 'delta',
    scope: 'filtered',
    scanStartedAtIso: NOW_ISO,
    totalPostsFetched: 10,
    newPostsDiscovered: 3,
    totalPagesFetched: 2,
    pagesIndexed: 1,
    completed: false,
  });
  assert.equal(truncatedDelta.lastIndexedAt, STALE_ISO);
  assert.equal(truncatedDelta.totalWpPosts, 2328);
  assert.equal(truncatedDelta.fullyIndexed, true);
});

test('planCatalogIndexTargets auto-heals depleted, partial-page, and poisoned zero-post consoles back to full index', () => {
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    // Looks "fresh" in cursor, but local DB only has 10 rows instead of 2325
    'snes-rom': {
      lastIndexedAt: FRESH_ISO,
      fullyIndexed: true,
      totalWpPosts: 2325,
      totalPages: 24,
      pagesIndexed: 24,
    },
    // Poisoned legacy cursor from a failed/unsupported page-1 scan
    gba: {
      lastIndexedAt: FRESH_ISO,
      fullyIndexed: true,
      totalWpPosts: 0,
      totalPages: 0,
      pagesIndexed: 0,
    },
    // Partial pagination cursor from an interrupted scan
    nes: {
      lastIndexedAt: FRESH_ISO,
      fullyIndexed: true,
      totalWpPosts: 900,
      totalPages: 9,
      pagesIndexed: 2,
    },
    // Healthy fresh console matching local SQLite count
    psx: {
      lastIndexedAt: FRESH_ISO,
      fullyIndexed: true,
      totalWpPosts: 500,
      totalPages: 5,
      pagesIndexed: 5,
    },
  };

  const plan = planCatalogIndexTargets({
    candidateTargets: ['snes-rom', 'gba', 'nes', 'psx'],
    indexState,
    scope: 'filtered',
    nowMs: NOW_MS,
    catalogCountsBySystem: {
      'snes-rom': 10,
      gba: 0,
      nes: 200,
      psx: 500,
    },
  });

  assert.equal(plan.mode, 'full');
  assert.deepEqual(
    plan.targets.map((t) => ({ slug: t.slug, strategy: t.strategy, modifiedAfterIso: t.modifiedAfterIso })),
    [
      { slug: 'snes-rom', strategy: 'full', modifiedAfterIso: null },
      { slug: 'gba', strategy: 'full', modifiedAfterIso: null },
      { slug: 'nes', strategy: 'full', modifiedAfterIso: null },
    ],
  );
});

const makeTarget = (
  slug: string,
  strategy: 'full' | 'delta' = 'full',
): PlannedCatalogIndexTarget => ({
  slug,
  strategy,
  modifiedAfterIso: strategy === 'delta' ? FRESH_ISO : null,
  existingCursor: null,
});

test('reconcileActiveCatalogIndexQueue aborts unchecked active console, drops unchecked queued ones, and splices newly added consoles live', () => {
  const currentTarget = makeTarget('psx', 'full');
  const remainingQueue = [makeTarget('snes-rom', 'full'), makeTarget('nes-roms', 'delta')];
  const completedSlugs = new Set<string>(['gb']);

  // User unchecks psx (currently scanning) and nes-roms (queued), keeps snes-rom, and adds gba-roms (unindexed)
  const desiredCandidates = ['snes-rom', 'gba-roms'];
  const desiredPlan = planCatalogIndexTargets({
    candidateTargets: desiredCandidates,
    indexState: {},
    scope: 'filtered',
    nowMs: NOW_MS,
  });

  const reconciled = reconcileActiveCatalogIndexQueue({
    scope: 'filtered',
    currentTarget,
    remainingQueue,
    completedSlugs,
    desiredCandidateSlugs: desiredCandidates,
    desiredPlan,
  });

  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.abortCurrentSystem, true);
  assert.deepEqual(reconciled.removedSlugs, ['psx', 'nes-roms']);
  assert.deepEqual(reconciled.addedSlugs, ['gba-roms']);
  assert.deepEqual(
    reconciled.nextQueue.map((t) => t.slug),
    ['snes-rom', 'gba-roms'],
  );

  assert.equal(
    formatLiveIndexerReloadSummary({
      addedSystems: reconciled.addedSlugs,
      removedSystems: reconciled.removedSlugs,
      abortedCurrentSystem: 'psx',
      reprioritized: reconciled.reprioritized,
    }),
    'queued gba-roms · dropped psx, nes-roms (cancelled active psx)',
  );
});

test('reconcileActiveCatalogIndexQueue keeps active fresh delta console running when a new unindexed console is added', () => {
  // User started a delta check on [snes-rom, nes-roms] (both fresh), then added unindexed gba-roms mid-run.
  // desiredPlan now plans ONLY [gba-roms] because unindexed consoles skip fresh deltas,
  // but snes-rom and nes-roms are still in desiredCandidateSlugs so neither should be aborted/dropped.
  const indexState: Record<string, CatalogIndexCursorRecord> = {
    'snes-rom': { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 100, totalPages: 1, pagesIndexed: 1 },
    'nes-roms': { lastIndexedAt: FRESH_ISO, fullyIndexed: true, totalWpPosts: 100, totalPages: 1, pagesIndexed: 1 },
  };
  const desiredCandidates = ['snes-rom', 'nes-roms', 'gba-roms'];
  const desiredPlan = planCatalogIndexTargets({
    candidateTargets: desiredCandidates,
    indexState,
    scope: 'filtered',
    nowMs: NOW_MS,
    catalogCountsBySystem: { 'snes-rom': 100, 'nes-roms': 100 },
  });

  const reconciled = reconcileActiveCatalogIndexQueue({
    scope: 'filtered',
    currentTarget: makeTarget('snes-rom', 'delta'),
    remainingQueue: [makeTarget('nes-roms', 'delta')],
    completedSlugs: new Set(),
    desiredCandidateSlugs: desiredCandidates,
    desiredPlan,
  });

  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.abortCurrentSystem, false);
  assert.deepEqual(reconciled.removedSlugs, []);
  assert.deepEqual(reconciled.addedSlugs, ['gba-roms']);
  // Newly added full-index target jumps ahead of lingering delta target
  assert.deepEqual(
    reconciled.nextQueue.map((t) => ({ slug: t.slug, strategy: t.strategy })),
    [
      { slug: 'gba-roms', strategy: 'full' },
      { slug: 'nes-roms', strategy: 'delta' },
    ],
  );
});

test('reconcileActiveCatalogIndexQueue reprioritizes full-site queue without dropping any site consoles', () => {
  const remainingQueue = [
    makeTarget('atari-2600', 'full'),
    makeTarget('n64', 'full'),
    makeTarget('gba-roms', 'full'),
  ];
  const desiredCandidates = ['gba-roms', 'n64', 'atari-2600'];
  const desiredPlan = { targets: desiredCandidates.map((s) => makeTarget(s, 'full')), mode: 'full' as const };

  const reconciled = reconcileActiveCatalogIndexQueue({
    scope: 'full',
    currentTarget: makeTarget('snes-rom', 'full'),
    remainingQueue,
    completedSlugs: new Set(),
    desiredCandidateSlugs: desiredCandidates,
    desiredPlan,
  });

  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.abortCurrentSystem, false);
  assert.equal(reconciled.reprioritized, true);
  assert.deepEqual(reconciled.removedSlugs, []);
  assert.deepEqual(reconciled.addedSlugs, []);
  assert.deepEqual(
    reconciled.nextQueue.map((t) => t.slug),
    ['gba-roms', 'n64', 'atari-2600'],
  );
  assert.equal(
    formatLiveIndexerReloadSummary({
      addedSystems: reconciled.addedSlugs,
      removedSystems: reconciled.removedSlugs,
      abortedCurrentSystem: null,
      reprioritized: reconciled.reprioritized,
    }),
    'reprioritized remaining queue',
  );
});

test('reconcileActiveCatalogIndexQueue returns changed=false when already-completed or unchanged targets match', () => {
  const reconciled = reconcileActiveCatalogIndexQueue({
    scope: 'filtered',
    currentTarget: makeTarget('snes-rom', 'full'),
    remainingQueue: [makeTarget('gba-roms', 'full')],
    completedSlugs: new Set(['nes-roms']),
    desiredCandidateSlugs: ['nes-roms', 'snes-rom', 'gba-roms'],
    desiredPlan: {
      targets: [makeTarget('nes-roms', 'full'), makeTarget('snes-rom', 'full'), makeTarget('gba-roms', 'full')],
      mode: 'full',
    },
  });

  assert.equal(reconciled.changed, false);
  assert.equal(reconciled.abortCurrentSystem, false);
  assert.deepEqual(reconciled.addedSlugs, []);
  assert.deepEqual(reconciled.removedSlugs, []);
  assert.deepEqual(
    reconciled.nextQueue.map((t) => t.slug),
    ['gba-roms'],
  );
});


