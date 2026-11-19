import type Database from 'better-sqlite3';
import {
  ACHIEVEMENT_CATALOG,
  type AchievementRecord,
  type AchievementsSnapshot,
  type AchievementsSummary,
  type ClientAchievementEventPayload,
  computeAchievementsSummary,
  ERA_32_64_TOKENS,
  GENESIS_TOKENS,
  HANDHELD_SYSTEM_TOKENS,
  isNightOwlHour,
  normalizeConsoleSlugToken,
  PLATINUM_ACHIEVEMENT_ID,
  SNES_TOKENS,
} from '../shared/achievements.ts';
import { getDbInstance } from './db.ts';

interface StoredAchievementRow {
  id: string;
  unlocked_at: string | null;
  progress_current: number;
  progress_target: number;
  silent: number;
  seen: number;
}

interface CounterRow {
  key: string;
  value: number;
}

const BASELINE_SEEDED_META_KEY = 'baseline_seeded_at';

function resolveDb(db?: Database.Database): Database.Database {
  return db ?? getDbInstance();
}

function readAllCounters(db: Database.Database): Map<string, number> {
  const rows = db.prepare('SELECT key, value FROM achievement_counters').all() as CounterRow[];
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.key, Number(row.value || 0));
  }
  return map;
}

export function recordAchievementCounter(
  key: string,
  value = 1,
  mode: 'increment' | 'max' | 'set' = 'increment',
  dbArg?: Database.Database,
): number {
  const db = resolveDb(dbArg);
  const now = new Date().toISOString();
  const numeric = Math.max(0, Math.floor(value));

  const existing = db
    .prepare('SELECT value FROM achievement_counters WHERE key = ?')
    .get(key) as { value: number } | undefined;
  const prev = existing ? Number(existing.value || 0) : 0;

  let next = prev;
  if (mode === 'increment') {
    next = prev + numeric;
  } else if (mode === 'max') {
    next = Math.max(prev, numeric);
  } else {
    next = numeric;
  }

  db.prepare(
    `INSERT INTO achievement_counters (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, next, now);

  return next;
}

function safeParseStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function hasCustomStorageFolderConfig(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim() === '{}') return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return false;
    const overrides = parsed.systemOverrides as Record<string, unknown> | undefined;
    if (overrides && typeof overrides === 'object' && Object.keys(overrides).length > 0) {
      return true;
    }
    if (parsed.useRomTypeSubfolders === true) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

interface EvaluationMetrics {
  authVerified: boolean;
  completedRuns: number;
  dryRunsCompleted: number;
  fullRunsCompleted: number;
  cronRunsCompleted: number;
  mirroredCount: number;
  mirroredBytes: number;
  indexedCount: number;
  failedCount: number;
  distinctMirroredConsoles: number;
  handheldConsoles: number;
  hasSnesAndGenesisCount: number;
  era32_64Consoles: number;
  mirroredTranslations: number;
  mirroredHacks: number;
  mirroredHomebrewOrProto: number;
  installedCount: number;
  distinctInstalledConsoles: number;
  scheduleEnabled: boolean;
  hasCustomSyncRules: boolean;
  hasCustomFolderMappings: boolean;
  hasCustomPacing: boolean;
  counters: Map<string, number>;
}

function collectEvaluationMetrics(db: Database.Database): EvaluationMetrics {
  const counters = readAllCounters(db);

  // Catalog aggregate counts
  const releaseSummary = db
    .prepare(
      `SELECT
         COUNT(*) AS indexed_count,
         SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) AS mirrored_count,
         SUM(CASE WHEN status = 'downloaded' THEN COALESCE(file_size_bytes, 0) ELSE 0 END) AS mirrored_bytes,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
         SUM(CASE WHEN installed_at IS NOT NULL AND installed_at != '' THEN 1 ELSE 0 END) AS installed_count
       FROM catalog_releases`,
    )
    .get() as Record<string, number | null> | undefined;

  const indexedCount = Number(releaseSummary?.indexed_count || 0);
  const mirroredCount = Number(releaseSummary?.mirrored_count || 0);
  const mirroredBytes = Number(releaseSummary?.mirrored_bytes || 0);
  const failedCount = Number(releaseSummary?.failed_count || 0);
  const installedCount = Number(releaseSummary?.installed_count || 0);

  // Distinct mirrored consoles & era classification
  const mirroredSystemsRows = db
    .prepare(
      `SELECT DISTINCT system_name
       FROM catalog_releases
       WHERE status = 'downloaded' AND system_name IS NOT NULL AND system_name != ''`,
    )
    .all() as { system_name: string }[];

  const normalizedMirroredSystems = new Set<string>();
  const handheldSet = new Set<string>();
  const era3264Set = new Set<string>();
  let hasSnes = false;
  let hasGenesis = false;

  for (const row of mirroredSystemsRows) {
    const token = normalizeConsoleSlugToken(row.system_name);
    if (!token) continue;
    normalizedMirroredSystems.add(token);
    if (HANDHELD_SYSTEM_TOKENS.has(token)) handheldSet.add(token);
    if (ERA_32_64_TOKENS.has(token)) era3264Set.add(token);
    if (SNES_TOKENS.has(token)) hasSnes = true;
    if (GENESIS_TOKENS.has(token)) hasGenesis = true;
  }

  // Distinct installed consoles
  const installedSystemsRows = db
    .prepare(
      `SELECT DISTINCT system_name
       FROM catalog_releases
       WHERE installed_at IS NOT NULL AND installed_at != ''
         AND system_name IS NOT NULL AND system_name != ''`,
    )
    .all() as { system_name: string }[];
  const installedSystemsSet = new Set<string>();
  for (const row of installedSystemsRows) {
    const token = normalizeConsoleSlugToken(row.system_name);
    if (token) installedSystemsSet.add(token);
  }

  // Mirrored release types & tags (Translations, Hacks, Homebrew/Prototypes)
  const mirroredTagRows = db
    .prepare(
      `SELECT release_type, release_tags_json
       FROM catalog_releases
       WHERE status = 'downloaded'`,
    )
    .all() as { release_type: string | null; release_tags_json: string | null }[];

  let mirroredTranslations = 0;
  let mirroredHacks = 0;
  let mirroredHomebrewOrProto = 0;

  for (const row of mirroredTagRows) {
    const tags = [
      String(row.release_type || ''),
      ...safeParseStringArray(row.release_tags_json),
    ]
      .join(' ')
      .toLowerCase();

    if (tags.includes('translation') || tags.includes('mtl')) {
      mirroredTranslations += 1;
    }
    if (tags.includes('hack')) {
      mirroredHacks += 1;
    }
    if (tags.includes('homebrew') || tags.includes('prototype') || tags.includes('unreleased')) {
      mirroredHomebrewOrProto += 1;
    }
  }

  // Sync runs history
  const runsSummary = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_runs,
         SUM(CASE WHEN status = 'completed' AND (dry_run = 1 OR mode = 'dry_run') THEN 1 ELSE 0 END) AS dry_runs,
         SUM(CASE WHEN status = 'completed' AND mode = 'full' AND dry_run = 0 THEN 1 ELSE 0 END) AS full_runs,
         SUM(CASE WHEN status = 'completed' AND trigger_type IN ('scheduled', 'cron') THEN 1 ELSE 0 END) AS cron_runs
       FROM sync_runs`,
    )
    .get() as Record<string, number | null> | undefined;

  const completedRuns = Math.max(
    Number(runsSummary?.completed_runs || 0),
    counters.get('runs_completed') || 0,
  );
  const dryRunsCompleted = Math.max(
    Number(runsSummary?.dry_runs || 0),
    counters.get('dry_runs_completed') || 0,
  );
  const fullRunsCompleted = Math.max(
    Number(runsSummary?.full_runs || 0),
    counters.get('full_runs_completed') || 0,
  );
  const cronRunsCompleted = Math.max(
    Number(runsSummary?.cron_runs || 0),
    counters.get('cron_runs_completed') || 0,
  );

  // Config inspection
  const cfg = db
    .prepare(
      `SELECT
         last_authenticated_at,
         schedule_enabled,
         system_filter,
         allowed_release_types_json,
         storage_folder_config_json,
         base_delay_ms,
         max_concurrency,
         download_chunk_concurrency,
         download_chunk_min_size_mb
       FROM scraper_config
       WHERE id = 1`,
    )
    .get() as Record<string, unknown> | undefined;

  const authVerified = Boolean(
    (cfg?.last_authenticated_at && String(cfg.last_authenticated_at).trim()) ||
      (counters.get('auth_verified') || 0) > 0,
  );
  const scheduleEnabled = Boolean(
    Number(cfg?.schedule_enabled || 0) === 1 || (counters.get('autopilot_saved') || 0) > 0,
  );
  const hasCustomSyncRules = Boolean(
    (cfg?.system_filter && String(cfg.system_filter).trim().length > 0) ||
      safeParseStringArray(cfg?.allowed_release_types_json).length > 0 ||
      (counters.get('sync_rules_customized') || 0) > 0,
  );
  const hasCustomFolderMappings = Boolean(
    hasCustomStorageFolderConfig(cfg?.storage_folder_config_json) ||
      (counters.get('folder_mappings_customized') || 0) > 0,
  );
  const hasCustomPacing = Boolean((counters.get('pacing_customized') || 0) > 0);

  return {
    authVerified,
    completedRuns,
    dryRunsCompleted,
    fullRunsCompleted,
    cronRunsCompleted,
    mirroredCount,
    mirroredBytes,
    indexedCount,
    failedCount,
    distinctMirroredConsoles: normalizedMirroredSystems.size,
    handheldConsoles: handheldSet.size,
    hasSnesAndGenesisCount: (hasSnes ? 1 : 0) + (hasGenesis ? 1 : 0),
    era32_64Consoles: era3264Set.size,
    mirroredTranslations,
    mirroredHacks,
    mirroredHomebrewOrProto,
    installedCount,
    distinctInstalledConsoles: installedSystemsSet.size,
    scheduleEnabled,
    hasCustomSyncRules,
    hasCustomFolderMappings,
    hasCustomPacing,
    counters,
  };
}

function computeProgressForId(id: string, m: EvaluationMetrics): number {
  const c = (key: string) => m.counters.get(key) || 0;
  const mib = Math.floor(m.mirroredBytes / (1024 * 1024));
  const gib = Math.floor(m.mirroredBytes / (1024 * 1024 * 1024));

  switch (id) {
    // A. Preservation & Archiving
    case 'first_contact':
      return m.authVerified ? 1 : 0;
    case 'first_signal':
      return m.completedRuns >= 1 ? 1 : 0;
    case 'scout_ahead':
      return m.dryRunsCompleted >= 1 ? 1 : 0;
    case 'first_cartridge':
    case 'starter_shelf':
    case 'local_arcade':
    case 'cartridge_vault':
    case 'digital_museum':
    case 'preservation_titan':
      return m.mirroredCount;
    case 'first_gigabyte':
      return mib;
    case 'tape_library':
    case 'homelab_hoarder':
    case 'terabyte_archivist':
      return gib;

    // B. Console & Era Collector
    case 'multi_system_owner':
    case 'console_historian':
    case 'living_museum':
    case 'complete_spectrum':
      return m.distinctMirroredConsoles;
    case 'pocket_brigade':
      return m.handheldConsoles;
    case 'golden_age_16bit':
      return m.hasSnesAndGenesisCount;
    case 'polygon_pioneers':
      return m.era32_64Consoles;
    case 'lost_in_translation':
      return m.mirroredTranslations;
    case 'rom_hacker':
      return m.mirroredHacks;
    case 'indie_and_unreleased':
      return m.mirroredHomebrewOrProto;

    // C. Catalog Curation & Inspection
    case 'catalog_indexer':
    case 'deep_index':
      return m.indexedCount;
    case 'deep_inspection':
      return c('detail_views') >= 1 ? 1 : 0;
    case 'pixel_peeker':
      return c('lightbox_views') >= 1 ? 1 : 0;
    case 'inside_the_archive':
      return c('archive_inspections') >= 1 ? 1 : 0;
    case 'filter_wizard':
      return c('filter_combos') >= 1 ? 1 : 0;
    case 'dual_perspective':
      return (c('view_mode_grid') >= 1 ? 1 : 0) + (c('view_mode_table') >= 1 ? 1 : 0);
    case 'data_cartographer':
      return c('catalog_stats_views') >= 1 ? 1 : 0;
    case 'precision_sniper':
      return c('on_demand_queued') >= 1 ? 1 : 0;
    case 'clean_slate':
      return c('retry_recovered') >= 1 && m.failedCount === 0 ? 1 : 0;

    // D. Handheld & SD Card Installer
    case 'clean_cut':
      return c('prepared_downloads') >= 1 ? 1 : 0;
    case 'ready_for_takeoff':
    case 'pocket_loadout':
    case 'flashcart_overload':
      return Math.max(m.installedCount, c('sd_installs_total'));
    case 'express_courier':
      return c('sd_express_batch_max');
    case 'folder_architect':
      return m.hasCustomFolderMappings ? 1 : 0;
    case 'version_upgrader':
      return c('sd_version_upgrades') >= 1 ? 1 : 0;
    case 'multi_platform_handheld':
      return m.distinctInstalledConsoles;

    // E. CRT Display Studio & Homelab Ops
    case 'amber_nostalgia':
      return c('crt_palette_amber') >= 1 ? 1 : 0;
    case 'cyan_phosphor':
      return c('crt_palette_cyan') >= 1 ? 1 : 0;
    case 'maximum_crt':
      return c('crt_motion_ultra') >= 1 ? 1 : 0;
    case 'tube_calibration':
      return c('crt_slider_tuned') >= 1 ? 1 : 0;
    case 'retro_visionary':
      return Math.floor(c('crt_visionary_seconds') / 60);
    case 'autopilot':
      return m.scheduleEnabled ? 1 : 0;
    case 'curators_rules':
      return m.hasCustomSyncRules ? 1 : 0;
    case 'polite_citizen':
      return m.hasCustomPacing ? 1 : 0;

    // F. Resilience & Quirks
    case 'weathering_the_storm':
      return c('throttles_survived') >= 1 ? 1 : 0;
    case 'never_give_up':
      return c('resumes_completed') >= 1 ? 1 : 0;
    case 'night_owl_archivist':
      return c('night_owl_events') >= 1 ? 1 : 0;
    case 'uncapped_expedition':
      return m.fullRunsCompleted >= 1 ? 1 : 0;
    case 'cron_veteran':
      return m.cronRunsCompleted;

    // G. Secret / Hidden Trophies
    case 'quarter_inserted':
      return c('arcade_opened') >= 1 ? 1 : 0;
    case 'up_up_down_down':
      return c('arcade_konami') >= 1 ? 1 : 0;
    case 'sector_clear':
      return c('arcade_stage_clear') >= 1 ? 1 : 0;
    case 'arcade_ace':
      return c('arcade_best_score');
    case 'wave_defender':
      return c('arcade_invaders_milestone') >= 1 ? 1 : 0;
    case 'data_bus_serpent':
      return c('arcade_snake_milestone') >= 1 ? 1 : 0;
    case 'quad_stacker':
      return c('arcade_tetromino_quad') >= 1 ? 1 : 0;
    case 'multi_cart_champion':
      return (
        (c('arcade_cart_1') >= 1 ? 1 : 0) +
        (c('arcade_cart_2') >= 1 ? 1 : 0) +
        (c('arcade_cart_3') >= 1 ? 1 : 0) +
        (c('arcade_cart_4') >= 1 ? 1 : 0)
      );
    case 'barrel_roll_pilot':
      return c('easter_barrel_roll') >= 1 ? 1 : 0;
    case 'clean_contacts':
      return c('easter_blow_cartridge') >= 1 ? 1 : 0;

    default:
      return 0;
  }
}

function readStoredStateMap(db: Database.Database): Map<string, StoredAchievementRow> {
  const rows = db
    .prepare(
      'SELECT id, unlocked_at, progress_current, progress_target, silent, seen FROM achievements_state',
    )
    .all() as StoredAchievementRow[];
  const map = new Map<string, StoredAchievementRow>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function buildRecordsFromState(
  stateMap: Map<string, StoredAchievementRow>,
): AchievementRecord[] {
  return ACHIEVEMENT_CATALOG.map((def) => {
    const row = stateMap.get(def.id);
    const unlocked = Boolean(row?.unlocked_at);
    const target = def.target;
    const progressCurrent = unlocked
      ? target
      : Math.min(target, Math.max(0, Number(row?.progress_current || 0)));

    return {
      ...def,
      unlocked,
      unlockedAt: row?.unlocked_at ?? null,
      progressCurrent,
      progressTarget: target,
      silent: Boolean(row?.silent),
      seen: unlocked ? Boolean(row?.seen) : true,
    };
  });
}

/**
 * Evaluates all catalog achievements against live SQLite metrics & persistent counters.
 * Returns only newly unlocked trophies (never re-unlocks an already-earned trophy).
 */
export function evaluateAchievements(options?: {
  silent?: boolean;
  db?: Database.Database;
}): AchievementRecord[] {
  const db = resolveDb(options?.db);
  const silent = Boolean(options?.silent);
  const now = new Date().toISOString();
  const metrics = collectEvaluationMetrics(db);
  const existingMap = readStoredStateMap(db);
  const newlyUnlockedIds: string[] = [];

  const upsertStmt = db.prepare(
    `INSERT INTO achievements_state (id, unlocked_at, progress_current, progress_target, silent, seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       unlocked_at = COALESCE(achievements_state.unlocked_at, excluded.unlocked_at),
       progress_current = MAX(achievements_state.progress_current, excluded.progress_current),
       progress_target = excluded.progress_target,
       silent = CASE WHEN achievements_state.unlocked_at IS NOT NULL THEN achievements_state.silent ELSE excluded.silent END,
       seen = CASE WHEN achievements_state.unlocked_at IS NOT NULL THEN achievements_state.seen ELSE excluded.seen END`,
  );

  const tx = db.transaction(() => {
    let unlockedNonPlatinumCount = 0;

    for (const def of ACHIEVEMENT_CATALOG) {
      if (def.id === PLATINUM_ACHIEVEMENT_ID) continue;
      const existing = existingMap.get(def.id);
      const alreadyUnlocked = Boolean(existing?.unlocked_at);
      const rawProgress = Math.max(0, Math.floor(computeProgressForId(def.id, metrics)));
      const clampedProgress = Math.min(def.target, rawProgress);

      if (alreadyUnlocked) {
        unlockedNonPlatinumCount += 1;
        if (existing && existing.progress_current < def.target) {
          upsertStmt.run(
            def.id,
            existing.unlocked_at,
            def.target,
            def.target,
            existing.silent,
            existing.seen,
          );
        }
        continue;
      }

      const justUnlocked = rawProgress >= def.target;
      if (justUnlocked) {
        unlockedNonPlatinumCount += 1;
        newlyUnlockedIds.push(def.id);
        upsertStmt.run(def.id, now, def.target, def.target, silent ? 1 : 0, silent ? 1 : 0);
      } else if (clampedProgress > 0 || !existing) {
        upsertStmt.run(def.id, null, clampedProgress, def.target, 0, 1);
      }
    }

    // Auto-evaluate Platinum trophy
    const platinumDef = ACHIEVEMENT_CATALOG.find((d) => d.id === PLATINUM_ACHIEVEMENT_ID);
    if (platinumDef) {
      const existingPlat = existingMap.get(PLATINUM_ACHIEVEMENT_ID);
      const alreadyUnlocked = Boolean(existingPlat?.unlocked_at);
      const requiredOthers = ACHIEVEMENT_CATALOG.length - 1;

      if (!alreadyUnlocked && unlockedNonPlatinumCount >= requiredOthers) {
        newlyUnlockedIds.push(PLATINUM_ACHIEVEMENT_ID);
        upsertStmt.run(
          PLATINUM_ACHIEVEMENT_ID,
          now,
          requiredOthers,
          requiredOthers,
          silent ? 1 : 0,
          silent ? 1 : 0,
        );
      } else if (!alreadyUnlocked) {
        upsertStmt.run(
          PLATINUM_ACHIEVEMENT_ID,
          null,
          unlockedNonPlatinumCount,
          requiredOthers,
          0,
          1,
        );
      }
    }
  });

  tx();

  if (newlyUnlockedIds.length === 0) {
    return [];
  }

  const updatedMap = readStoredStateMap(db);
  const allRecords = buildRecordsFromState(updatedMap);
  const idSet = new Set(newlyUnlockedIds);
  return allRecords.filter((rec) => idSet.has(rec.id));
}

/**
 * Runs once on startup/upgrade to silently seed pre-existing library & config milestones
 * so existing installations never experience a jarring toast storm on first load.
 */
export function runSilentBaselineCatchUp(dbArg?: Database.Database): AchievementRecord[] {
  const db = resolveDb(dbArg);
  const alreadySeeded = db
    .prepare('SELECT value FROM achievements_meta WHERE key = ?')
    .get(BASELINE_SEEDED_META_KEY) as { value: string } | undefined;

  if (alreadySeeded) {
    return [];
  }

  const seeded = evaluateAchievements({ silent: true, db });
  db.prepare(
    `INSERT INTO achievements_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(BASELINE_SEEDED_META_KEY, new Date().toISOString());

  return seeded;
}

export function getAchievementsSnapshot(dbArg?: Database.Database): AchievementsSnapshot {
  const db = resolveDb(dbArg);
  const stateMap = readStoredStateMap(db);
  const items = buildRecordsFromState(stateMap);
  const summary = computeAchievementsSummary(items);
  const recentUnlocked = items
    .filter((item) => item.unlocked && item.unlockedAt)
    .sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''))
    .slice(0, 6);

  return {
    summary,
    items,
    recentUnlocked,
  };
}

export function markAchievementsSeen(
  ids?: string[],
  dbArg?: Database.Database,
): AchievementsSummary {
  const db = resolveDb(dbArg);
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`UPDATE achievements_state SET seen = 1 WHERE id IN (${placeholders})`).run(...ids);
  } else {
    db.prepare('UPDATE achievements_state SET seen = 1 WHERE unlocked_at IS NOT NULL').run();
  }
  return getAchievementsSnapshot(db).summary;
}

export function recordNightOwlIfApplicable(
  localHour?: number,
  dbArg?: Database.Database,
): void {
  const hour =
    typeof localHour === 'number' && Number.isFinite(localHour)
      ? localHour
      : new Date().getHours();
  if (isNightOwlHour(hour)) {
    recordAchievementCounter('night_owl_events', 1, 'increment', dbArg);
  }
}

export function recordClientAchievementEvent(
  payload: ClientAchievementEventPayload,
  dbArg?: Database.Database,
): { newlyUnlocked: AchievementRecord[]; snapshot: AchievementsSnapshot } {
  const db = resolveDb(dbArg);
  const value = typeof payload.value === 'number' && Number.isFinite(payload.value)
    ? Math.max(0, Math.floor(payload.value))
    : 1;

  switch (payload.type) {
    case 'detail_view':
      recordAchievementCounter('detail_views', 1, 'increment', db);
      break;
    case 'lightbox_view':
      recordAchievementCounter('lightbox_views', 1, 'increment', db);
      break;
    case 'filter_combo':
      if (value >= 3) {
        recordAchievementCounter('filter_combos', 1, 'increment', db);
      }
      break;
    case 'view_mode_grid':
      recordAchievementCounter('view_mode_grid', 1, 'set', db);
      break;
    case 'view_mode_table':
      recordAchievementCounter('view_mode_table', 1, 'set', db);
      break;
    case 'catalog_stats_view':
      recordAchievementCounter('catalog_stats_views', 1, 'increment', db);
      break;
    case 'sd_export_complete':
      if (value > 0) {
        recordAchievementCounter('sd_installs_total', value, 'increment', db);
        recordAchievementCounter('sd_express_batch_max', value, 'max', db);
        recordNightOwlIfApplicable(payload.localHour, db);
      }
      break;
    case 'sd_version_upgrade':
      recordAchievementCounter('sd_version_upgrades', 1, 'increment', db);
      break;
    case 'crt_palette_amber':
      recordAchievementCounter('crt_palette_amber', 1, 'set', db);
      break;
    case 'crt_palette_cyan':
      recordAchievementCounter('crt_palette_cyan', 1, 'set', db);
      break;
    case 'crt_motion_ultra':
      recordAchievementCounter('crt_motion_ultra', 1, 'set', db);
      break;
    case 'crt_slider_tuned':
      recordAchievementCounter('crt_slider_tuned', 1, 'set', db);
      break;
    case 'crt_visionary_seconds': {
      const clampedSeconds = Math.min(120, Math.max(0, value));
      if (clampedSeconds > 0) {
        recordAchievementCounter('crt_visionary_seconds', clampedSeconds, 'increment', db);
      }
      break;
    }
    case 'arcade_opened':
      recordAchievementCounter('arcade_opened', 1, 'increment', db);
      break;
    case 'arcade_konami':
      recordAchievementCounter('arcade_opened', 1, 'increment', db);
      recordAchievementCounter('arcade_konami', 1, 'set', db);
      break;
    case 'arcade_stage_clear':
      recordAchievementCounter('arcade_stage_clear', 1, 'increment', db);
      break;
    case 'arcade_score':
      recordAchievementCounter('arcade_best_score', value, 'max', db);
      if (value > 0) {
        recordAchievementCounter('arcade_cart_1', 1, 'set', db);
      }
      break;
    case 'arcade_cart_played':
      if (value >= 1 && value <= 4) {
        recordAchievementCounter(`arcade_cart_${value}`, 1, 'set', db);
      }
      break;
    case 'arcade_invaders_milestone':
      recordAchievementCounter('arcade_invaders_milestone', 1, 'set', db);
      recordAchievementCounter('arcade_cart_2', 1, 'set', db);
      break;
    case 'arcade_snake_milestone':
      recordAchievementCounter('arcade_snake_milestone', 1, 'set', db);
      recordAchievementCounter('arcade_cart_3', 1, 'set', db);
      break;
    case 'arcade_tetromino_quad':
      recordAchievementCounter('arcade_tetromino_quad', 1, 'set', db);
      recordAchievementCounter('arcade_cart_4', 1, 'set', db);
      break;
    case 'easter_barrel_roll':
      recordAchievementCounter('easter_barrel_roll', 1, 'set', db);
      break;
    case 'easter_blow_cartridge':
      recordAchievementCounter('easter_blow_cartridge', 1, 'set', db);
      break;
  }

  const newlyUnlocked = evaluateAchievements({ silent: false, db });
  const snapshot = getAchievementsSnapshot(db);
  return { newlyUnlocked, snapshot };
}
