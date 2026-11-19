import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  ACHIEVEMENT_CATALOG,
  coalesceToastBatch,
  computeAchievementsSummary,
  isNightOwlHour,
  PLATINUM_ACHIEVEMENT_ID,
  TIER_POINTS,
  type AchievementRecord,
} from '../src/shared/achievements.ts';
import {
  evaluateAchievements,
  getAchievementsSnapshot,
  markAchievementsSeen,
  recordClientAchievementEvent,
  runSilentBaselineCatchUp,
} from '../src/server/achievements.ts';
import { isRetroVisionaryCrtConfig } from '../src/shared/crtDisplay.ts';
import { runDatabaseMigrations } from '../src/server/migrations.ts';

function createMigratedMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  const tmpRoot = path.join(os.tmpdir(), 'rgt-ach-test');
  runDatabaseMigrations(db, {
    dataDir: tmpRoot,
    defaultDownloadDir: path.join(tmpRoot, 'downloads'),
  });
  // Seed scraper_config row matching initDb()
  db.prepare(
    `INSERT OR IGNORE INTO scraper_config (
       id, base_url, login_url, download_dir, updated_at
     ) VALUES (1, 'https://retrogametalk.com/repository/', 'https://retrogametalk.com/wp-login.php', ?, ?)`,
  ).run(path.join(tmpRoot, 'downloads'), new Date().toISOString());
  return db;
}

test('ACHIEVEMENT_CATALOG defines exactly 65 unique trophies with 31/23/10/1 tier split and 2,235 max pts', () => {
  assert.equal(ACHIEVEMENT_CATALOG.length, 65);

  const ids = new Set<string>();
  const tierCounts = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  let totalPoints = 0;

  for (const def of ACHIEVEMENT_CATALOG) {
    assert.ok(!ids.has(def.id), `Duplicate achievement ID: ${def.id}`);
    ids.add(def.id);
    tierCounts[def.tier] += 1;
    assert.equal(def.points, TIER_POINTS[def.tier]);
    totalPoints += def.points;
  }

  assert.deepEqual(tierCounts, { bronze: 31, silver: 23, gold: 10, platinum: 1 });
  assert.equal(totalPoints, 2235);

  const platinum = ACHIEVEMENT_CATALOG.find((item) => item.id === PLATINUM_ACHIEVEMENT_ID);
  assert.ok(platinum);
  assert.equal(platinum.tier, 'platinum');
  assert.equal(platinum.target, 64);
  assert.equal(platinum.hidden, false);
});

test('coalesceToastBatch preserves 1..3 unlocks individually and coalesces 4+ bursts', () => {
  const mk = (id: string, tier: AchievementRecord['tier']): AchievementRecord => ({
    id,
    title: id,
    description: id,
    category: 'preservation',
    tier,
    points: TIER_POINTS[tier],
    hidden: false,
    target: 1,
    unlocked: true,
    unlockedAt: new Date().toISOString(),
    progressCurrent: 1,
    progressTarget: 1,
    silent: false,
    seen: false,
  });

  assert.deepEqual(coalesceToastBatch([]), []);

  const small = coalesceToastBatch([mk('a', 'bronze'), mk('b', 'gold'), mk('c', 'silver')]);
  assert.equal(small.length, 3);
  assert.equal(small[0].kind, 'single');
  assert.equal(small[0].trophy?.tier, 'gold');
  assert.equal(small[1].trophy?.tier, 'silver');
  assert.equal(small[2].trophy?.tier, 'bronze');

  const burst = coalesceToastBatch([
    mk('b1', 'bronze'),
    mk('s1', 'silver'),
    mk('g1', 'gold'),
    mk('p1', 'platinum'),
    mk('b2', 'bronze'),
  ]);
  assert.equal(burst.length, 3);
  assert.equal(burst[0].kind, 'single');
  assert.equal(burst[0].trophy?.id, 'p1');
  assert.equal(burst[1].kind, 'single');
  assert.equal(burst[1].trophy?.id, 'g1');
  assert.equal(burst[2].kind, 'summary');
  assert.equal(burst[2].extraCount, 3);
  assert.equal(burst[2].extraPoints, 30 + 15 + 15);
});

test('isNightOwlHour matches 2:00 AM through 4:59 AM local time only', () => {
  assert.equal(isNightOwlHour(1), false);
  assert.equal(isNightOwlHour(2), true);
  assert.equal(isNightOwlHour(3), true);
  assert.equal(isNightOwlHour(4), true);
  assert.equal(isNightOwlHour(5), false);
  assert.equal(isNightOwlHour(23), false);
});

test('fresh install baseline catch-up unlocks zero trophies so first launch is quiet', () => {
  const db = createMigratedMemoryDb();
  try {
    const baseline = runSilentBaselineCatchUp(db);
    assert.equal(baseline.length, 0);

    const snap = getAchievementsSnapshot(db);
    assert.equal(snap.summary.totalCount, 65);
    assert.equal(snap.summary.unlockedCount, 0);
    assert.equal(snap.summary.unseenCount, 0);
    assert.equal(snap.summary.earnedPoints, 0);
    assert.equal(snap.summary.maxPoints, 2235);
  } finally {
    db.close();
  }
});

test('existing library baseline catch-up silently marks earned milestones as seen and is idempotent', () => {
  const db = createMigratedMemoryDb();
  try {
    const now = new Date().toISOString();
    db.prepare('UPDATE scraper_config SET last_authenticated_at = ? WHERE id = 1').run(now);
    db.prepare(
      `INSERT INTO sync_runs (started_at, finished_at, mode, dry_run, trigger_type, status)
       VALUES (?, ?, 'incremental', 0, 'manual', 'completed')`,
    ).run(now, now);

    const insertRelease = db.prepare(
      `INSERT INTO catalog_releases (
         remote_url, remote_path, local_path, system_name, title, status, file_size_bytes, discovered_at, downloaded_at
       ) VALUES (?, ?, ?, ?, ?, 'downloaded', ?, ?, ?)`,
    );

    const systems = ['snes', 'genesis', 'gba'];
    for (let i = 0; i < 12; i += 1) {
      const sys = systems[i % systems.length];
      insertRelease.run(
        `https://retrogametalk.com/repository/${sys}/game-${i + 1}/`,
        `${sys}/Game ${i + 1}.zip`,
        `/tmp/${sys}/Game ${i + 1}.zip`,
        sys,
        `Game ${i + 1}`,
        100 * 1024 * 1024, // 100 MiB each -> 1,200 MiB total (> 1 GiB)
        now,
        now,
      );
    }

    const firstPass = runSilentBaselineCatchUp(db);
    const unlockedIds = new Set(firstPass.map((u) => u.id));
    assert.ok(unlockedIds.has('first_contact'));
    assert.ok(unlockedIds.has('first_signal'));
    assert.ok(unlockedIds.has('first_cartridge'));
    assert.ok(unlockedIds.has('starter_shelf'));
    assert.ok(unlockedIds.has('first_gigabyte'));
    assert.ok(unlockedIds.has('multi_system_owner'));
    assert.ok(unlockedIds.has('golden_age_16bit'));
    assert.ok(firstPass.every((u) => u.silent && u.seen));

    const snap = getAchievementsSnapshot(db);
    assert.equal(snap.summary.unseenCount, 0);

    // Running baseline catch-up again must not re-unlock anything
    const secondPass = runSilentBaselineCatchUp(db);
    assert.equal(secondPass.length, 0);
  } finally {
    db.close();
  }
});

test('live client achievement events unlock once, increment unseen count, and clear on markAchievementsSeen', () => {
  const db = createMigratedMemoryDb();
  try {
    runSilentBaselineCatchUp(db);

    const detailRes = recordClientAchievementEvent({ type: 'detail_view' }, db);
    assert.equal(detailRes.newlyUnlocked.length, 1);
    assert.equal(detailRes.newlyUnlocked[0].id, 'deep_inspection');
    assert.equal(detailRes.newlyUnlocked[0].silent, false);
    assert.equal(detailRes.newlyUnlocked[0].seen, false);
    assert.equal(detailRes.snapshot.summary.unseenCount, 1);

    // Repeating same event does not duplicate unlock
    const repeatRes = recordClientAchievementEvent({ type: 'detail_view' }, db);
    assert.equal(repeatRes.newlyUnlocked.length, 0);

    // Dual Perspective requires both grid & table views
    const gridOnly = recordClientAchievementEvent({ type: 'view_mode_grid' }, db);
    assert.equal(gridOnly.newlyUnlocked.length, 0);
    const tableToo = recordClientAchievementEvent({ type: 'view_mode_table' }, db);
    assert.deepEqual(
      tableToo.newlyUnlocked.map((u) => u.id),
      ['dual_perspective'],
    );

    // SD export at 3 AM with batch of 5 unlocks Ready for Takeoff, Express Courier, and Night Owl Archivist
    const nightExport = recordClientAchievementEvent(
      { type: 'sd_export_complete', value: 5, localHour: 3 },
      db,
    );
    const exportIds = new Set(nightExport.newlyUnlocked.map((u) => u.id));
    assert.ok(exportIds.has('ready_for_takeoff'));
    assert.ok(exportIds.has('express_courier'));
    assert.ok(exportIds.has('night_owl_archivist'));

    assert.equal(nightExport.snapshot.summary.unseenCount, 5);

    const seenSummary = markAchievementsSeen(undefined, db);
    assert.equal(seenSummary.unseenCount, 0);
    assert.equal(seenSummary.unlockedCount, 5);
  } finally {
    db.close();
  }
});

test('unlocking all 64 non-Platinum trophies automatically awards Platinum Master Preservationist', () => {
  const db = createMigratedMemoryDb();
  try {
    runSilentBaselineCatchUp(db);

    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO achievements_state (
         id, unlocked_at, progress_current, progress_target, silent, seen
       ) VALUES (?, ?, ?, ?, 0, 1)
       ON CONFLICT(id) DO UPDATE SET
         unlocked_at = excluded.unlocked_at,
         progress_current = excluded.progress_current`,
    );

    for (const def of ACHIEVEMENT_CATALOG) {
      if (def.id === PLATINUM_ACHIEVEMENT_ID) continue;
      upsert.run(def.id, now, def.target, def.target);
    }

    const newlyUnlocked = evaluateAchievements({ silent: false, db });
    assert.deepEqual(
      newlyUnlocked.map((u) => u.id),
      [PLATINUM_ACHIEVEMENT_ID],
    );
    assert.equal(newlyUnlocked[0].tier, 'platinum');

    const snapshot = getAchievementsSnapshot(db);
    assert.equal(snapshot.summary.unlockedCount, 65);
    assert.equal(snapshot.summary.completionPercent, 100);
    assert.equal(snapshot.summary.earnedPoints, 2235);

    const recomputed = computeAchievementsSummary(snapshot.items);
    assert.deepEqual(recomputed, snapshot.summary);
  } finally {
    db.close();
  }
});

test('Multi-Cart Arcade hidden trophies unlock per-game milestones and 4/4 Multi-Cart Champion', () => {
  const db = createMigratedMemoryDb();
  try {
    runSilentBaselineCatchUp(db);

    const inv = recordClientAchievementEvent({ type: 'arcade_invaders_milestone' }, db);
    assert.deepEqual(
      inv.newlyUnlocked.map((u) => u.id),
      ['wave_defender'],
    );

    const snk = recordClientAchievementEvent({ type: 'arcade_snake_milestone' }, db);
    assert.deepEqual(
      snk.newlyUnlocked.map((u) => u.id),
      ['data_bus_serpent'],
    );

    const tet = recordClientAchievementEvent({ type: 'arcade_tetromino_quad' }, db);
    assert.deepEqual(
      tet.newlyUnlocked.map((u) => u.id),
      ['quad_stacker'],
    );

    // 3 of 4 carts played so far; playing Cart 1 (Breakout) completes 4/4 Multi-Cart Champion
    const champBefore = tet.snapshot.items.find((i) => i.id === 'multi_cart_champion');
    assert.equal(champBefore?.unlocked, false);
    assert.equal(champBefore?.progressCurrent, 3);

    const brk = recordClientAchievementEvent({ type: 'arcade_cart_played', value: 1 }, db);
    assert.deepEqual(
      brk.newlyUnlocked.map((u) => u.id),
      ['multi_cart_champion'],
    );
  } finally {
    db.close();
  }
});

test('Retro Visionary helper & cumulative crt_visionary_seconds unlock Gold trophy at 30 minutes', () => {
  assert.equal(isRetroVisionaryCrtConfig({ enabled: false, uiMotion: 'ultra', scanlines: 0 }), true);
  assert.equal(isRetroVisionaryCrtConfig({ enabled: true, uiMotion: 'low', scanlines: 100 }), true);
  assert.equal(isRetroVisionaryCrtConfig({ enabled: false, uiMotion: 'high', scanlines: 100 }), false);
  assert.equal(isRetroVisionaryCrtConfig({ enabled: true, uiMotion: 'high', scanlines: 99 }), false);

  const db = createMigratedMemoryDb();
  try {
    runSilentBaselineCatchUp(db);

    // Oversized single report is clamped to 120s (2 min)
    const oversized = recordClientAchievementEvent({ type: 'crt_visionary_seconds', value: 9999 }, db);
    assert.equal(oversized.newlyUnlocked.length, 0);
    const afterOversized = oversized.snapshot.items.find((i) => i.id === 'retro_visionary');
    assert.equal(afterOversized?.unlocked, false);
    assert.equal(afterOversized?.progressCurrent, 2);

    // Accumulate 14 more 120s chunks -> 15 * 120 = 1,800s (30 min)
    let latest = oversized;
    for (let i = 0; i < 13; i += 1) {
      latest = recordClientAchievementEvent({ type: 'crt_visionary_seconds', value: 120 }, db);
      assert.equal(latest.newlyUnlocked.length, 0);
    }
    const midRecord = latest.snapshot.items.find((i) => i.id === 'retro_visionary');
    assert.equal(midRecord?.progressCurrent, 28);

    const finalRes = recordClientAchievementEvent({ type: 'crt_visionary_seconds', value: 120 }, db);
    assert.deepEqual(
      finalRes.newlyUnlocked.map((u) => u.id),
      ['retro_visionary'],
    );
    assert.equal(finalRes.newlyUnlocked[0].tier, 'gold');
    assert.equal(finalRes.newlyUnlocked[0].points, 90);
  } finally {
    db.close();
  }
});
