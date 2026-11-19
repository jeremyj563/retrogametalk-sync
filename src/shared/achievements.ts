export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type AchievementCategory =
  | 'preservation'
  | 'collector'
  | 'catalog'
  | 'handheld'
  | 'crt_ops'
  | 'resilience'
  | 'secret';

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  hint?: string;
  category: AchievementCategory;
  tier: AchievementTier;
  points: number;
  hidden: boolean;
  target: number;
  progressUnit?: string;
}

export interface AchievementRecord extends AchievementDefinition {
  unlocked: boolean;
  unlockedAt: string | null;
  progressCurrent: number;
  progressTarget: number;
  silent: boolean;
  seen: boolean;
}

export interface AchievementTierCounts {
  bronze: { unlocked: number; total: number };
  silver: { unlocked: number; total: number };
  gold: { unlocked: number; total: number };
  platinum: { unlocked: number; total: number };
}

export interface AchievementsSummary {
  totalCount: number;
  unlockedCount: number;
  unseenCount: number;
  earnedPoints: number;
  maxPoints: number;
  completionPercent: number;
  byTier: AchievementTierCounts;
}

export interface AchievementsSnapshot {
  summary: AchievementsSummary;
  items: AchievementRecord[];
  recentUnlocked: AchievementRecord[];
}

export interface AchievementUnlockEvent {
  unlocks: AchievementRecord[];
  summary: AchievementsSummary;
}

export type ClientAchievementEventType =
  | 'detail_view'
  | 'lightbox_view'
  | 'filter_combo'
  | 'view_mode_grid'
  | 'view_mode_table'
  | 'catalog_stats_view'
  | 'sd_export_complete'
  | 'sd_version_upgrade'
  | 'crt_palette_amber'
  | 'crt_palette_cyan'
  | 'crt_motion_ultra'
  | 'crt_slider_tuned'
  | 'crt_visionary_seconds'
  | 'arcade_opened'
  | 'arcade_konami'
  | 'arcade_stage_clear'
  | 'arcade_score'
  | 'arcade_cart_played'
  | 'arcade_invaders_milestone'
  | 'arcade_snake_milestone'
  | 'arcade_tetromino_quad'
  | 'easter_barrel_roll'
  | 'easter_blow_cartridge';

export interface ClientAchievementEventPayload {
  type: ClientAchievementEventType;
  value?: number;
  localHour?: number;
}

export const TIER_POINTS: Record<AchievementTier, number> = {
  bronze: 15,
  silver: 30,
  gold: 90,
  platinum: 180,
};

export const TIER_LABELS: Record<AchievementTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  preservation: 'Preservation & Archiving',
  collector: 'Console & Era Collector',
  catalog: 'Catalog Curation',
  handheld: 'Handheld & SD Installer',
  crt_ops: 'CRT Display & Ops',
  resilience: 'Resilience & Quirks',
  secret: 'Secret Trophies',
};

export const PLATINUM_ACHIEVEMENT_ID = 'master_preservationist';

export const HANDHELD_SYSTEM_TOKENS = new Set([
  'gb',
  'gameboy',
  'game-boy',
  'gbc',
  'game-boy-color',
  'gba',
  'game-boy-advance',
  'nds',
  'ds',
  'nintendo-ds',
  '3ds',
  'nintendo-3ds',
  'psp',
  'playstation-portable',
  'psvita',
  'vita',
  'gg',
  'gamegear',
  'game-gear',
  'ws',
  'wsc',
  'wonderswan',
  'wonderswan-color',
  'ngp',
  'ngpc',
  'neo-geo-pocket',
  'lynx',
  'atari-lynx',
  'virtualboy',
  'virtual-boy',
]);

export const ERA_32_64_TOKENS = new Set([
  'n64',
  'nintendo-64',
  'psx',
  'ps1',
  'playstation',
  'saturn',
  'sega-saturn',
  'dreamcast',
  'dc',
  'sega-dreamcast',
  '3do',
  'jaguar',
  'atari-jaguar',
  'sega32x',
  '32x',
  'sega-32x',
]);

export const SNES_TOKENS = new Set(['snes', 'super-nintendo', 'sfc', 'super-famicom']);
export const GENESIS_TOKENS = new Set(['genesis', 'megadrive', 'mega-drive', 'sega-genesis', 'md']);

export function normalizeConsoleSlugToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-?(roms|isos|chds|games)$/g, '');
}

export function isNightOwlHour(localHour: number): boolean {
  return Number.isFinite(localHour) && localHour >= 2 && localHour < 5;
}

function def(
  id: string,
  title: string,
  description: string,
  category: AchievementCategory,
  tier: AchievementTier,
  opts?: { target?: number; progressUnit?: string; hidden?: boolean; hint?: string },
): AchievementDefinition {
  return {
    id,
    title,
    description,
    hint: opts?.hint,
    category,
    tier,
    points: TIER_POINTS[tier],
    hidden: Boolean(opts?.hidden),
    target: opts?.target ?? 1,
    progressUnit: opts?.progressUnit,
  };
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  // A. Preservation & Archiving (13)
  def(
    'first_contact',
    'First Contact',
    'Verify your RetroGameTalk credentials in System Settings.',
    'preservation',
    'bronze',
  ),
  def(
    'first_signal',
    'First Signal',
    'Complete your first sync run.',
    'preservation',
    'bronze',
  ),
  def(
    'scout_ahead',
    'Scout Ahead',
    'Complete a Dry Run simulation without writing bytes to disk.',
    'preservation',
    'bronze',
  ),
  def(
    'first_cartridge',
    'First Cartridge',
    'Mirror your first ROM archive onto local storage.',
    'preservation',
    'bronze',
    { target: 1, progressUnit: 'mirrored' },
  ),
  def(
    'starter_shelf',
    'Starter Shelf',
    'Mirror 10 releases onto local storage.',
    'preservation',
    'bronze',
    { target: 10, progressUnit: 'mirrored' },
  ),
  def(
    'local_arcade',
    'Local Arcade',
    'Mirror 50 releases onto local storage.',
    'preservation',
    'bronze',
    { target: 50, progressUnit: 'mirrored' },
  ),
  def(
    'cartridge_vault',
    'Cartridge Vault',
    'Mirror 250 releases onto local storage.',
    'preservation',
    'silver',
    { target: 250, progressUnit: 'mirrored' },
  ),
  def(
    'digital_museum',
    'Digital Museum',
    'Mirror 1,000 releases onto local storage.',
    'preservation',
    'gold',
    { target: 1000, progressUnit: 'mirrored' },
  ),
  def(
    'preservation_titan',
    'Preservation Titan',
    'Mirror 2,500 releases onto local storage.',
    'preservation',
    'gold',
    { target: 2500, progressUnit: 'mirrored' },
  ),
  def(
    'first_gigabyte',
    'First Gigabyte',
    'Preserve 1 GiB of mirrored ROM archives on disk.',
    'preservation',
    'bronze',
    { target: 1024, progressUnit: 'MiB' },
  ),
  def(
    'tape_library',
    'Tape Library',
    'Preserve 10 GiB of mirrored ROM archives on disk.',
    'preservation',
    'silver',
    { target: 10, progressUnit: 'GiB' },
  ),
  def(
    'homelab_hoarder',
    'Homelab Hoarder',
    'Preserve 100 GiB of mirrored ROM archives on disk.',
    'preservation',
    'silver',
    { target: 100, progressUnit: 'GiB' },
  ),
  def(
    'terabyte_archivist',
    'Terabyte Archivist',
    'Preserve 1 TiB of mirrored ROM archives on disk.',
    'preservation',
    'gold',
    { target: 1024, progressUnit: 'GiB' },
  ),

  // B. Console & Era Collector (10)
  def(
    'multi_system_owner',
    'Multi-System Owner',
    'Mirror releases across 3 distinct consoles.',
    'collector',
    'bronze',
    { target: 3, progressUnit: 'consoles' },
  ),
  def(
    'console_historian',
    'Console Historian',
    'Mirror releases across 10 distinct consoles.',
    'collector',
    'silver',
    { target: 10, progressUnit: 'consoles' },
  ),
  def(
    'living_museum',
    'Living Museum',
    'Mirror releases across 20 distinct consoles.',
    'collector',
    'gold',
    { target: 20, progressUnit: 'consoles' },
  ),
  def(
    'complete_spectrum',
    'Complete Spectrum',
    'Mirror releases across 30 or more distinct consoles.',
    'collector',
    'gold',
    { target: 30, progressUnit: 'consoles' },
  ),
  def(
    'pocket_brigade',
    'Pocket Brigade',
    'Mirror releases across at least 3 handheld platforms.',
    'collector',
    'silver',
    { target: 3, progressUnit: 'handhelds' },
  ),
  def(
    'golden_age_16bit',
    '16-Bit Golden Age',
    'Mirror releases for both Super Nintendo and Sega Genesis / Mega Drive.',
    'collector',
    'bronze',
    { target: 2, progressUnit: 'rivals' },
  ),
  def(
    'polygon_pioneers',
    'Polygon Pioneers',
    'Mirror releases across 3 or more 32/64-bit era platforms.',
    'collector',
    'silver',
    { target: 3, progressUnit: 'systems' },
  ),
  def(
    'lost_in_translation',
    'Lost in Translation',
    'Mirror 10 Fan-Translated releases.',
    'collector',
    'bronze',
    { target: 10, progressUnit: 'translations' },
  ),
  def(
    'rom_hacker',
    'ROM Hacker',
    'Mirror 10 community ROM Hacks.',
    'collector',
    'bronze',
    { target: 10, progressUnit: 'hacks' },
  ),
  def(
    'indie_and_unreleased',
    'Indie & Unreleased',
    'Mirror 5 Homebrew or Prototype releases.',
    'collector',
    'silver',
    { target: 5, progressUnit: 'releases' },
  ),

  // C. Catalog Curation & Inspection (10)
  def(
    'catalog_indexer',
    'Catalog Indexer',
    'Index 100 or more releases into your offline Catalog.',
    'catalog',
    'bronze',
    { target: 100, progressUnit: 'indexed' },
  ),
  def(
    'deep_index',
    'Deep Index',
    'Index 1,000 or more releases into your offline Catalog.',
    'catalog',
    'silver',
    { target: 1000, progressUnit: 'indexed' },
  ),
  def(
    'deep_inspection',
    'Deep Inspection',
    'Open a release detail drawer to inspect full metadata and release notes.',
    'catalog',
    'bronze',
  ),
  def(
    'pixel_peeker',
    'Pixel Peeker',
    'Inspect a full-resolution screenshot inside the lightbox viewer.',
    'catalog',
    'bronze',
  ),
  def(
    'inside_the_archive',
    'Inside the Archive',
    'Inspect the contents of a .zip, .7z, or .rar archive without unpacking to disk.',
    'catalog',
    'bronze',
  ),
  def(
    'filter_wizard',
    'Filter Wizard',
    'Combine 3 or more active Catalog filters at the same time.',
    'catalog',
    'bronze',
  ),
  def(
    'dual_perspective',
    'Dual Perspective',
    'Browse the Catalog in both Box-Art Grid and Table views.',
    'catalog',
    'bronze',
    { target: 2, progressUnit: 'views' },
  ),
  def(
    'data_cartographer',
    'Data Cartographer',
    'Explore your library analytics inside the Catalog Stats view.',
    'catalog',
    'bronze',
  ),
  def(
    'precision_sniper',
    'Precision Sniper',
    'Queue an on-demand download directly from the Catalog.',
    'catalog',
    'silver',
  ),
  def(
    'clean_slate',
    'Clean Slate',
    'Recover a failed download via Retry and return the Failed Queue to zero.',
    'catalog',
    'silver',
  ),

  // D. Handheld & SD Card Installer (8)
  def(
    'clean_cut',
    'Clean Cut',
    'Download a clutter-free Prepared ROM directly from the browser.',
    'handheld',
    'bronze',
  ),
  def(
    'ready_for_takeoff',
    'Ready for Takeoff',
    'Export your first ROM directly onto an SD card or USB drive.',
    'handheld',
    'bronze',
    { target: 1, progressUnit: 'installed' },
  ),
  def(
    'pocket_loadout',
    'Pocket Loadout',
    'Install 10 releases onto a connected storage device.',
    'handheld',
    'silver',
    { target: 10, progressUnit: 'installed' },
  ),
  def(
    'flashcart_overload',
    'Flashcart Overload',
    'Install 50 releases onto a connected storage device.',
    'handheld',
    'gold',
    { target: 50, progressUnit: 'installed' },
  ),
  def(
    'express_courier',
    'Express Courier',
    'Transfer 5 or more releases in a single Bulk Express Install batch.',
    'handheld',
    'silver',
    { target: 5, progressUnit: 'batch' },
  ),
  def(
    'folder_architect',
    'Folder Architect',
    'Customize a console storage folder mapping in Device Export.',
    'handheld',
    'bronze',
  ),
  def(
    'version_upgrader',
    'Version Upgrader',
    'Upgrade or replace an already-installed release on your storage device.',
    'handheld',
    'silver',
  ),
  def(
    'multi_platform_handheld',
    'Multi-Platform Handheld',
    'Install releases spanning 3 or more consoles onto connected storage.',
    'handheld',
    'silver',
    { target: 3, progressUnit: 'consoles' },
  ),

  // E. CRT Display Studio & Homelab Ops (8)
  def(
    'amber_nostalgia',
    'Amber Nostalgia',
    'Switch the CRT Display Studio to the Amber phosphor palette.',
    'crt_ops',
    'bronze',
  ),
  def(
    'cyan_phosphor',
    'Cyan Phosphor',
    'Switch the CRT Display Studio to the Cyan phosphor palette.',
    'crt_ops',
    'bronze',
  ),
  def(
    'maximum_crt',
    'Maximum CRT',
    'Enable Ultra Living UI Motion in the CRT Display Studio.',
    'crt_ops',
    'silver',
  ),
  def(
    'tube_calibration',
    'Tube Calibration',
    'Manually dial CRT scanlines, aperture grille, vignette, or bloom sliders.',
    'crt_ops',
    'bronze',
  ),
  def(
    'retro_visionary',
    'Retro Visionary',
    'Spend a cumulative 30 minutes with CRT Display Studio set to Ultra motion or maxed (100%) scanlines.',
    'crt_ops',
    'gold',
    { target: 30, progressUnit: 'min' },
  ),
  def(
    'autopilot',
    'Autopilot',
    'Configure and save an active automated cron sync schedule.',
    'crt_ops',
    'bronze',
  ),
  def(
    'curators_rules',
    "Curator's Rules",
    'Save custom target console or release-type filters in Sync Rules.',
    'crt_ops',
    'bronze',
  ),
  def(
    'polite_citizen',
    'Polite Citizen',
    'Customize request pacing or multi-chunk transfer settings in System Settings.',
    'crt_ops',
    'silver',
  ),

  // F. Resilience & Quirks (5)
  def(
    'weathering_the_storm',
    'Weathering the Storm',
    'Complete a download cleanly after riding out a host rate-limit throttle wave.',
    'resilience',
    'silver',
  ),
  def(
    'never_give_up',
    'Never Give Up',
    'Successfully resume a previously interrupted multi-chunk Range transfer.',
    'resilience',
    'silver',
  ),
  def(
    'night_owl_archivist',
    'Night Owl Archivist',
    'Complete a sync download or SD export between 2:00 AM and 5:00 AM local time.',
    'resilience',
    'bronze',
  ),
  def(
    'uncapped_expedition',
    'Uncapped Expedition',
    'Complete a real (non-Dry-Run) Full Sync across your target consoles.',
    'resilience',
    'gold',
  ),
  def(
    'cron_veteran',
    'Cron Veteran',
    'Complete 5 unattended scheduled cron sync runs.',
    'resilience',
    'silver',
    { target: 5, progressUnit: 'cron runs' },
  ),

  // G. Secret / Hidden Trophies (11)
  def(
    'quarter_inserted',
    'Quarter Inserted',
    'Discover and launch the hidden CRT Multi-Cart Arcade cabinet.',
    'secret',
    'bronze',
    {
      hidden: true,
      hint: 'Check the Back of the Cartridge Manual—or try tapping the top-left console emblem.',
    },
  ),
  def(
    'up_up_down_down',
    'Up Up Down Down',
    'Unlock the hidden arcade cabinet using the legendary 1980s cheat code.',
    'secret',
    'silver',
    {
      hidden: true,
      hint: 'Start with two upward steps on the D-pad anywhere outside a text input.',
    },
  ),
  def(
    'sector_clear',
    'Sector Clear',
    'Clear Stage 1 in CRT Cartridge Breakout.',
    'secret',
    'silver',
    {
      hidden: true,
      hint: 'Clear every cartridge brick in the first sector of the hidden cabinet.',
    },
  ),
  def(
    'arcade_ace',
    'Arcade Ace',
    'Score 5,000 or more points in a single run of CRT Cartridge Breakout.',
    'secret',
    'gold',
    {
      target: 5000,
      progressUnit: 'pts',
      hidden: true,
      hint: 'Chain combos and catch capsules inside the hidden cabinet to reach 5,000 points.',
    },
  ),
  def(
    'wave_defender',
    'Wave Defender',
    'Clear Wave 1 or shoot down a Mystery UFO in Retro Invaders.',
    'secret',
    'bronze',
    {
      hidden: true,
      hint: 'Defend the CRT bunkers from an entire wave—or snipe the saucer overhead.',
    },
  ),
  def(
    'data_bus_serpent',
    'Data Bus Serpent',
    'Reach length 25 or score 1,500+ points in a single run of Phosphor Snake.',
    'secret',
    'silver',
    {
      hidden: true,
      hint: 'Guide the phosphor serpent across the CRT data bus and grab Golden Cartridges.',
    },
  ),
  def(
    'quad_stacker',
    'Quad Stacker',
    'Clear 4 lines at once with a single drop in Tetromino Drop.',
    'secret',
    'silver',
    {
      hidden: true,
      hint: 'Leave a clean vertical channel in the falling-block well and wait for the long bar.',
    },
  ),
  def(
    'multi_cart_champion',
    'Multi-Cart Champion',
    'Play and post a score in all 4 cartridges inside the hidden CRT Arcade.',
    'secret',
    'gold',
    {
      target: 4,
      progressUnit: 'carts',
      hidden: true,
      hint: 'Boot every slot on the hidden 4-in-1 Multi-Cart shelf and put points on the board.',
    },
  ),
  def(
    'barrel_roll_pilot',
    'Barrel Roll Pilot',
    'Trigger a classic 360-degree viewport stunt inside the Catalog search bar.',
    'secret',
    'bronze',
    {
      hidden: true,
      hint: 'Peppy Hare would know what to type into the Catalog search bar.',
    },
  ),
  def(
    'clean_contacts',
    'Clean Contacts',
    'Perform vintage cartridge maintenance inside the Catalog search bar.',
    'secret',
    'bronze',
    {
      hidden: true,
      hint: 'What did every 1980s player do when a cartridge refused to boot?',
    },
  ),
  def(
    PLATINUM_ACHIEVEMENT_ID,
    'Master Preservationist',
    'Unlock every other trophy in RetroGameTalk Sync.',
    'secret',
    'platinum',
    {
      target: 64,
      progressUnit: 'trophies',
      hidden: false,
    },
  ),
];

export const ACHIEVEMENT_BY_ID = new Map<string, AchievementDefinition>(
  ACHIEVEMENT_CATALOG.map((item) => [item.id, item]),
);

export function computeAchievementsSummary(items: readonly AchievementRecord[]): AchievementsSummary {
  const byTier: AchievementTierCounts = {
    bronze: { unlocked: 0, total: 0 },
    silver: { unlocked: 0, total: 0 },
    gold: { unlocked: 0, total: 0 },
    platinum: { unlocked: 0, total: 0 },
  };

  let unlockedCount = 0;
  let unseenCount = 0;
  let earnedPoints = 0;
  let maxPoints = 0;

  for (const item of items) {
    byTier[item.tier].total += 1;
    maxPoints += item.points;
    if (item.unlocked) {
      unlockedCount += 1;
      byTier[item.tier].unlocked += 1;
      earnedPoints += item.points;
      if (!item.seen) {
        unseenCount += 1;
      }
    }
  }

  const totalCount = items.length;
  const completionPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  return {
    totalCount,
    unlockedCount,
    unseenCount,
    earnedPoints,
    maxPoints,
    completionPercent,
    byTier,
  };
}

export interface TrophyToastItem {
  key: string;
  kind: 'single' | 'summary';
  trophy?: AchievementRecord;
  extraCount?: number;
  extraPoints?: number;
}

/**
 * Serializes a burst of newly unlocked trophies into non-overwhelming toasts.
 * - 1..3 unlocks: show each trophy individually.
 * - 4+ unlocks in one burst: show the 2 highest-tier trophies individually,
 *   then coalesce the remainder into a single clean summary toast.
 */
export function coalesceToastBatch(unlocks: readonly AchievementRecord[]): TrophyToastItem[] {
  if (unlocks.length === 0) return [];
  const tierRank: Record<AchievementTier, number> = {
    platinum: 4,
    gold: 3,
    silver: 2,
    bronze: 1,
  };
  const sorted = [...unlocks].sort((a, b) => tierRank[b.tier] - tierRank[a.tier]);

  if (sorted.length <= 3) {
    return sorted.map((trophy) => ({
      key: `trophy:${trophy.id}`,
      kind: 'single',
      trophy,
    }));
  }

  const lead = sorted.slice(0, 2);
  const rest = sorted.slice(2);
  const extraPoints = rest.reduce((sum, item) => sum + item.points, 0);

  return [
    ...lead.map((trophy) => ({
      key: `trophy:${trophy.id}`,
      kind: 'single' as const,
      trophy,
    })),
    {
      key: `summary:${rest.map((item) => item.id).join(',')}`,
      kind: 'summary',
      trophy: rest[0],
      extraCount: rest.length,
      extraPoints,
    },
  ];
}
