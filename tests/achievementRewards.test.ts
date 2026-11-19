import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENT_REWARDS,
  BVM_PRESET_REQUIRED_POINTS,
  OPERATOR_RANKS,
  PALETTE_REQUIRED_POINTS,
  computeOperatorRank,
  getNextLockedReward,
  getVisibleRewards,
  isArcadeCabinetStyleUnlocked,
  isBvmPresetUnlocked,
  isChimePackUnlocked,
  isCrestStyleUnlocked,
  isPaletteUnlocked,
  isRewardUnlocked,
} from '../src/shared/achievementRewards.ts';
import {
  CRT_BONUS_PALETTES,
  CRT_CORE_PALETTES,
  CRT_PALETTES,
  CRT_PRESETS,
  DEFAULT_CRT_DISPLAY_SETTINGS,
  detectActiveCrtPreset,
  isValidPalette,
} from '../src/shared/crtDisplay.ts';
import { ACHIEVEMENT_CATALOG } from '../src/shared/achievements.ts';

const MAX_TROPHY_POINTS = ACHIEVEMENT_CATALOG.reduce((sum, item) => sum + item.points, 0);

test('Operator Rank ladder covers 10 monotonically ascending ranks within total points', () => {
  assert.equal(OPERATOR_RANKS.length, 10);
  assert.equal(OPERATOR_RANKS[0].level, 1);
  assert.equal(OPERATOR_RANKS[0].minPoints, 0);

  for (let i = 1; i < OPERATOR_RANKS.length; i += 1) {
    assert.equal(OPERATOR_RANKS[i].level, i + 1);
    assert.ok(
      OPERATOR_RANKS[i].minPoints > OPERATOR_RANKS[i - 1].minPoints,
      `Rank ${i + 1} minPoints must exceed Rank ${i}`,
    );
  }
  assert.ok(
    OPERATOR_RANKS[OPERATOR_RANKS.length - 1].minPoints <= MAX_TROPHY_POINTS,
    'Max rank must be reachable within total achievable trophy points',
  );
});

test('computeOperatorRank resolves boundaries, progress percent, and max rank accurately', () => {
  const rank0 = computeOperatorRank(0);
  assert.equal(rank0.current.level, 1);
  assert.equal(rank0.current.title, 'Cartridge Cadet');
  assert.equal(rank0.next?.level, 2);
  assert.equal(rank0.pointsToNext, 60);
  assert.equal(rank0.progressPercent, 0);

  const midRank1 = computeOperatorRank(30);
  assert.equal(midRank1.current.level, 1);
  assert.equal(midRank1.pointsToNext, 30);
  assert.equal(midRank1.progressPercent, 50);

  const exactRank2 = computeOperatorRank(60);
  assert.equal(exactRank2.current.level, 2);
  assert.equal(exactRank2.next?.level, 3);
  assert.equal(exactRank2.progressPercent, 0);

  const maxRank = computeOperatorRank(2100);
  assert.equal(maxRank.current.level, 10);
  assert.equal(maxRank.current.title, 'Master Preservationist');
  assert.equal(maxRank.next, null);
  assert.equal(maxRank.pointsToNext, 0);
  assert.equal(maxRank.progressPercent, 100);

  const overMax = computeOperatorRank(MAX_TROPHY_POINTS);
  assert.equal(overMax.current.level, 10);
  assert.equal(overMax.progressPercent, 100);
});

test('Core palettes are always free and collector palettes unlock at exact thresholds', () => {
  for (const palette of CRT_CORE_PALETTES) {
    assert.equal(isPaletteUnlocked(palette, 0), true);
    assert.equal(isValidPalette(palette), true);
  }

  const expectedThresholds: Record<(typeof CRT_BONUS_PALETTES)[number], number> = {
    gameboy: 100,
    synthwave: 350,
    virtualboy: 700,
    trinitron: 1200,
  };

  for (const palette of CRT_BONUS_PALETTES) {
    const req = expectedThresholds[palette];
    assert.equal(PALETTE_REQUIRED_POINTS[palette], req);
    assert.equal(isPaletteUnlocked(palette, req - 1), false);
    assert.equal(isPaletteUnlocked(palette, req), true);
    assert.equal(isValidPalette(palette), true);
    assert.ok(CRT_PALETTES[palette].label.length > 0);
  }
});

test('BVM preset, chime packs, crest trims, and secret cabinet trims enforce exact thresholds', () => {
  assert.equal(BVM_PRESET_REQUIRED_POINTS, 1500);
  assert.equal(isBvmPresetUnlocked(1499), false);
  assert.equal(isBvmPresetUnlocked(1500), true);

  // Chime packs
  assert.equal(isChimePackUnlocked('classic_8bit', 0), true);
  assert.equal(isChimePackUnlocked('fm_16bit', 199), false);
  assert.equal(isChimePackUnlocked('fm_16bit', 200), true);
  assert.equal(isChimePackUnlocked('coinop_arcade', 549), false);
  assert.equal(isChimePackUnlocked('coinop_arcade', 550), true);
  assert.equal(isChimePackUnlocked('symphonic_crt', 999), false);
  assert.equal(isChimePackUnlocked('symphonic_crt', 1000), true);

  // Prestige crest trims
  assert.equal(isCrestStyleUnlocked('standard', 0), true);
  assert.equal(isCrestStyleUnlocked('gold_trim', 899), false);
  assert.equal(isCrestStyleUnlocked('gold_trim', 900), true);
  assert.equal(isCrestStyleUnlocked('platinum_aura', 1799), false);
  assert.equal(isCrestStyleUnlocked('platinum_aura', 1800), true);

  // Secret cabinet bezel styles
  assert.equal(isArcadeCabinetStyleUnlocked('standard', 0), true);
  assert.equal(isArcadeCabinetStyleUnlocked('cabinet_gold', 449), false);
  assert.equal(isArcadeCabinetStyleUnlocked('cabinet_gold', 450), true);
  assert.equal(isArcadeCabinetStyleUnlocked('cabinet_overdrive', 1399), false);
  assert.equal(isArcadeCabinetStyleUnlocked('cabinet_overdrive', 1400), true);
});

test('Spoiler protection hides secret cabinet rewards until arcade discovery', () => {
  assert.equal(ACHIEVEMENT_REWARDS.length, 12);

  const hiddenView = getVisibleRewards({ arcadeDiscovered: false });
  assert.equal(hiddenView.length, 10);
  assert.equal(
    hiddenView.some((r) => r.requiresArcadeDiscovery),
    false,
  );

  const discoveredView = getVisibleRewards({ arcadeDiscovered: true });
  assert.equal(discoveredView.length, 12);
  assert.equal(
    discoveredView.filter((r) => r.requiresArcadeDiscovery).length,
    2,
  );

  // Next locked reward respects spoiler filter and returns null when all are unlocked
  const nextAtZero = getNextLockedReward(0, { arcadeDiscovered: false });
  assert.equal(nextAtZero?.id, 'palette_gameboy');
  assert.equal(nextAtZero?.requiredPoints, 100);

  const nextAt400Hidden = getNextLockedReward(400, { arcadeDiscovered: false });
  assert.equal(nextAt400Hidden?.id, 'chime_coinop_arcade');

  const nextAt400Discovered = getNextLockedReward(400, { arcadeDiscovered: true });
  assert.equal(nextAt400Discovered?.id, 'arcade_cabinet_gold');

  assert.equal(
    getNextLockedReward(MAX_TROPHY_POINTS, { arcadeDiscovered: true }),
    null,
  );
  for (const reward of ACHIEVEMENT_REWARDS) {
    assert.equal(isRewardUnlocked(reward, MAX_TROPHY_POINTS), true);
  }
});

test('detectActiveCrtPreset recognizes the flagship Broadcast BVM preset', () => {
  const bvmSettings = {
    ...DEFAULT_CRT_DISPLAY_SETTINGS,
    enabled: true,
    ...CRT_PRESETS.bvm.values,
  };
  assert.equal(detectActiveCrtPreset(bvmSettings), 'bvm');
});
