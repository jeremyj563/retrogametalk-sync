export type TrophyChimePackId =
  | 'classic_8bit'
  | 'fm_16bit'
  | 'coinop_arcade'
  | 'symphonic_crt';

export type TrophyCrestStyleId = 'standard' | 'gold_trim' | 'platinum_aura';

export type ArcadeCabinetStyleId = 'standard' | 'cabinet_gold' | 'cabinet_overdrive';

export type UnlockableCrtPaletteId = 'gameboy' | 'synthwave' | 'virtualboy' | 'trinitron';

export type RewardKind =
  | 'crt_palette'
  | 'crt_preset'
  | 'chime_pack'
  | 'crest_style'
  | 'arcade_cabinet';

export interface OperatorRankDefinition {
  level: number;
  title: string;
  minPoints: number;
  accentClass: string;
  badgeBorderClass: string;
  badgeBgClass: string;
}

export interface OperatorRankProgress {
  current: OperatorRankDefinition;
  next: OperatorRankDefinition | null;
  earnedPoints: number;
  pointsIntoRank: number;
  pointsToNext: number;
  progressPercent: number;
}

export interface AchievementRewardDefinition {
  id: string;
  title: string;
  description: string;
  kind: RewardKind;
  requiredPoints: number;
  /** Target value identifier for the reward kind (e.g., palette ID, chime pack ID) */
  targetKey: string;
  /** Optional color swatch hex for visual preview */
  swatchHex?: string;
  /** If true, hidden in the Trophy Case Rewards tab until the hidden arcade is discovered */
  requiresArcadeDiscovery?: boolean;
}

export interface RewardCosmeticPrefs {
  chimePack: TrophyChimePackId;
  crestStyle: TrophyCrestStyleId;
  arcadeCabinetStyle: ArcadeCabinetStyleId;
}

export const REWARD_COSMETICS_STORAGE_KEY = 'rgt_achievement_rewards_v1';

export const DEFAULT_REWARD_COSMETIC_PREFS: RewardCosmeticPrefs = {
  chimePack: 'classic_8bit',
  crestStyle: 'standard',
  arcadeCabinetStyle: 'standard',
};

export const OPERATOR_RANKS: readonly OperatorRankDefinition[] = [
  {
    level: 1,
    title: 'Cartridge Cadet',
    minPoints: 0,
    accentClass: 'text-crt-muted',
    badgeBorderClass: 'border-crt-border-strong',
    badgeBgClass: 'bg-crt-bg',
  },
  {
    level: 2,
    title: 'Tape Loader',
    minPoints: 60,
    accentClass: 'text-crt-text',
    badgeBorderClass: 'border-crt-phosphor/35',
    badgeBgClass: 'bg-crt-phosphor/5',
  },
  {
    level: 3,
    title: 'ROM Runner',
    minPoints: 150,
    accentClass: 'text-crt-phosphor',
    badgeBorderClass: 'border-crt-phosphor/50',
    badgeBgClass: 'bg-crt-phosphor/10',
  },
  {
    level: 4,
    title: 'Silicon Curator',
    minPoints: 300,
    accentClass: 'text-[#67e8f9]',
    badgeBorderClass: 'border-[#38d9f5]/45',
    badgeBgClass: 'bg-[#38d9f5]/10',
  },
  {
    level: 5,
    title: 'Console Archivist',
    minPoints: 500,
    accentClass: 'text-[#38d9f5]',
    badgeBorderClass: 'border-[#38d9f5]/60',
    badgeBgClass: 'bg-[#38d9f5]/14',
  },
  {
    level: 6,
    title: 'PVM Technician',
    minPoints: 750,
    accentClass: 'text-[#cfdbe6]',
    badgeBorderClass: 'border-[#cfdbe6]/55',
    badgeBgClass: 'bg-[#cfdbe6]/12',
  },
  {
    level: 7,
    title: 'Vault Keeper',
    minPoints: 1050,
    accentClass: 'text-crt-amber',
    badgeBorderClass: 'border-crt-amber/55',
    badgeBgClass: 'bg-crt-amber/12',
  },
  {
    level: 8,
    title: 'Bitstream Warden',
    minPoints: 1400,
    accentClass: 'text-[#fbbf24]',
    badgeBorderClass: 'border-[#fbbf24]/65',
    badgeBgClass: 'bg-[#fbbf24]/14',
  },
  {
    level: 9,
    title: 'Preservation Grandmaster',
    minPoints: 1800,
    accentClass: 'text-[#fde68a]',
    badgeBorderClass: 'border-[#fbbf24]/80',
    badgeBgClass: 'bg-[#fbbf24]/18',
  },
  {
    level: 10,
    title: 'Master Preservationist',
    minPoints: 2100,
    accentClass: 'text-crt-phosphor',
    badgeBorderClass: 'border-crt-phosphor/85',
    badgeBgClass: 'bg-crt-phosphor/18',
  },
];

export const ACHIEVEMENT_REWARDS: readonly AchievementRewardDefinition[] = [
  {
    id: 'palette_gameboy',
    title: 'DMG Olive Phosphor',
    description: 'Classic dot-matrix olive-sage monochrome palette in CRT Display Studio.',
    kind: 'crt_palette',
    requiredPoints: 100,
    targetKey: 'gameboy',
    swatchHex: '#9bbc0f',
  },
  {
    id: 'chime_fm_16bit',
    title: '16-Bit FM Synth Chimes',
    description: 'Warm dual-oscillator FM harmonic trophy unlock chimes with octave shimmer.',
    kind: 'chime_pack',
    requiredPoints: 200,
    targetKey: 'fm_16bit',
  },
  {
    id: 'palette_synthwave',
    title: 'Synthwave Magenta Phosphor',
    description: 'Electric outrun magenta-rose CRT phosphor palette in CRT Display Studio.',
    kind: 'crt_palette',
    requiredPoints: 350,
    targetKey: 'synthwave',
    swatchHex: '#f45bff',
  },
  {
    id: 'arcade_cabinet_gold',
    title: 'Gold Edition Cabinet Bezel',
    description: 'Brushed-gold championship arcade trim & marquee accent for the Multi-Cart Cabinet.',
    kind: 'arcade_cabinet',
    requiredPoints: 450,
    targetKey: 'cabinet_gold',
    swatchHex: '#f59e0b',
    requiresArcadeDiscovery: true,
  },
  {
    id: 'chime_coinop_arcade',
    title: 'Coin-Op Arcade Chimes',
    description: 'Punchy 1990s arcade cabinet credit & fanfare arpeggios for trophy unlocks.',
    kind: 'chime_pack',
    requiredPoints: 550,
    targetKey: 'coinop_arcade',
  },
  {
    id: 'palette_virtualboy',
    title: 'Crimson Tube Phosphor',
    description: 'Deep 1995 LED crimson-red phosphor palette in CRT Display Studio.',
    kind: 'crt_palette',
    requiredPoints: 700,
    targetKey: 'virtualboy',
    swatchHex: '#ff3b4e',
  },
  {
    id: 'crest_gold_trim',
    title: "Gold Collector's Bezel",
    description: 'Warm metallic gold trim on the header Trophy badge and Trophy Case header crest.',
    kind: 'crest_style',
    requiredPoints: 900,
    targetKey: 'gold_trim',
    swatchHex: '#fbbf24',
  },
  {
    id: 'chime_symphonic_crt',
    title: 'Hi-Fi Studio Chimes',
    description: 'Lush multi-voice crystalline console chords for trophy unlock notifications.',
    kind: 'chime_pack',
    requiredPoints: 1000,
    targetKey: 'symphonic_crt',
  },
  {
    id: 'palette_trinitron',
    title: 'Trinitron White Phosphor',
    description: 'Crisp studio P4 monochrome white phosphor palette in CRT Display Studio.',
    kind: 'crt_palette',
    requiredPoints: 1200,
    targetKey: 'trinitron',
    swatchHex: '#e8f4ff',
  },
  {
    id: 'arcade_cabinet_overdrive',
    title: 'Neon Overdrive Cabinet',
    description: 'High-contrast glowing phosphor cabinet trim & bezel aura in the Multi-Cart Cabinet.',
    kind: 'arcade_cabinet',
    requiredPoints: 1400,
    targetKey: 'cabinet_overdrive',
    swatchHex: '#38e56b',
    requiresArcadeDiscovery: true,
  },
  {
    id: 'preset_broadcast_bvm',
    title: 'Broadcast BVM Monitor Preset',
    description: 'Unlocks the flagship Sony BVM-inspired 4th hardware preset in CRT Display Studio.',
    kind: 'crt_preset',
    requiredPoints: 1500,
    targetKey: 'bvm',
  },
  {
    id: 'crest_platinum_aura',
    title: 'Platinum Prism Crest',
    description: 'Prestigious prismatic border aura for your header Trophy badge and Trophy Case crest.',
    kind: 'crest_style',
    requiredPoints: 1800,
    targetKey: 'platinum_aura',
    swatchHex: '#67e8f9',
  },
];

export const PALETTE_REQUIRED_POINTS: Partial<Record<UnlockableCrtPaletteId, number>> = {
  gameboy: 100,
  synthwave: 350,
  virtualboy: 700,
  trinitron: 1200,
};

export const BVM_PRESET_REQUIRED_POINTS = 1500;

export const CHIME_PACK_META: Record<
  TrophyChimePackId,
  { label: string; description: string; requiredPoints: number }
> = {
  classic_8bit: {
    label: 'Classic 8-Bit',
    description: 'Default crisp square & triangle retro console pings',
    requiredPoints: 0,
  },
  fm_16bit: {
    label: '16-Bit FM Synth',
    description: 'Warm dual-detuned FM bells with octave shimmer',
    requiredPoints: 200,
  },
  coinop_arcade: {
    label: 'Coin-Op Arcade',
    description: 'Snappy 90s arcade credit & fanfare arpeggios',
    requiredPoints: 550,
  },
  symphonic_crt: {
    label: 'Hi-Fi Studio',
    description: 'Crystalline multi-voice studio console chords',
    requiredPoints: 1000,
  },
};

export const ARCADE_CABINET_STYLE_META: Record<
  ArcadeCabinetStyleId,
  { label: string; shortLabel: string; requiredPoints: number }
> = {
  standard: { label: 'Standard CRT', shortLabel: 'Std', requiredPoints: 0 },
  cabinet_gold: { label: 'Gold Edition', shortLabel: 'Gold', requiredPoints: 450 },
  cabinet_overdrive: { label: 'Neon Overdrive', shortLabel: 'Neon', requiredPoints: 1400 },
};

export function computeOperatorRank(earnedPointsRaw: number): OperatorRankProgress {
  const earnedPoints = Math.max(0, Math.floor(Number.isFinite(earnedPointsRaw) ? earnedPointsRaw : 0));
  let currentIndex = 0;
  for (let i = 0; i < OPERATOR_RANKS.length; i += 1) {
    if (earnedPoints >= OPERATOR_RANKS[i].minPoints) {
      currentIndex = i;
    } else {
      break;
    }
  }

  const current = OPERATOR_RANKS[currentIndex];
  const next = currentIndex + 1 < OPERATOR_RANKS.length ? OPERATOR_RANKS[currentIndex + 1] : null;

  if (!next) {
    return {
      current,
      next: null,
      earnedPoints,
      pointsIntoRank: earnedPoints - current.minPoints,
      pointsToNext: 0,
      progressPercent: 100,
    };
  }

  const span = Math.max(1, next.minPoints - current.minPoints);
  const pointsIntoRank = Math.max(0, earnedPoints - current.minPoints);
  const pointsToNext = Math.max(0, next.minPoints - earnedPoints);
  const progressPercent = Math.min(100, Math.round((pointsIntoRank / span) * 100));

  return {
    current,
    next,
    earnedPoints,
    pointsIntoRank,
    pointsToNext,
    progressPercent,
  };
}

export function isRewardUnlocked(
  reward: Pick<AchievementRewardDefinition, 'requiredPoints'>,
  earnedPoints: number,
): boolean {
  return earnedPoints >= reward.requiredPoints;
}

export function isPaletteUnlocked(palette: string, earnedPoints: number): boolean {
  const req = PALETTE_REQUIRED_POINTS[palette as UnlockableCrtPaletteId];
  if (typeof req !== 'number') return true;
  return earnedPoints >= req;
}

export function isBvmPresetUnlocked(earnedPoints: number): boolean {
  return earnedPoints >= BVM_PRESET_REQUIRED_POINTS;
}

export function isChimePackUnlocked(pack: TrophyChimePackId, earnedPoints: number): boolean {
  return earnedPoints >= (CHIME_PACK_META[pack]?.requiredPoints ?? 0);
}

export function isCrestStyleUnlocked(style: TrophyCrestStyleId, earnedPoints: number): boolean {
  if (style === 'gold_trim') return earnedPoints >= 900;
  if (style === 'platinum_aura') return earnedPoints >= 1800;
  return true;
}

export function isArcadeCabinetStyleUnlocked(
  style: ArcadeCabinetStyleId,
  earnedPoints: number,
): boolean {
  return earnedPoints >= (ARCADE_CABINET_STYLE_META[style]?.requiredPoints ?? 0);
}

export function getVisibleRewards(options: {
  arcadeDiscovered: boolean;
}): AchievementRewardDefinition[] {
  return ACHIEVEMENT_REWARDS.filter(
    (reward) => !reward.requiresArcadeDiscovery || options.arcadeDiscovered,
  );
}

export function getNextLockedReward(
  earnedPoints: number,
  options: { arcadeDiscovered: boolean },
): AchievementRewardDefinition | null {
  const visible = getVisibleRewards(options);
  for (const reward of visible) {
    if (earnedPoints < reward.requiredPoints) {
      return reward;
    }
  }
  return null;
}

function isValidChimePack(val: unknown): val is TrophyChimePackId {
  return (
    val === 'classic_8bit' ||
    val === 'fm_16bit' ||
    val === 'coinop_arcade' ||
    val === 'symphonic_crt'
  );
}

function isValidCrestStyle(val: unknown): val is TrophyCrestStyleId {
  return val === 'standard' || val === 'gold_trim' || val === 'platinum_aura';
}

function isValidArcadeCabinetStyle(val: unknown): val is ArcadeCabinetStyleId {
  return val === 'standard' || val === 'cabinet_gold' || val === 'cabinet_overdrive';
}

export function loadRewardCosmeticPrefs(): RewardCosmeticPrefs {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_REWARD_COSMETIC_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(REWARD_COSMETICS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REWARD_COSMETIC_PREFS };
    const parsed = JSON.parse(raw) as Partial<RewardCosmeticPrefs>;
    return {
      chimePack: isValidChimePack(parsed.chimePack)
        ? parsed.chimePack
        : DEFAULT_REWARD_COSMETIC_PREFS.chimePack,
      crestStyle: isValidCrestStyle(parsed.crestStyle)
        ? parsed.crestStyle
        : DEFAULT_REWARD_COSMETIC_PREFS.crestStyle,
      arcadeCabinetStyle: isValidArcadeCabinetStyle(parsed.arcadeCabinetStyle)
        ? parsed.arcadeCabinetStyle
        : DEFAULT_REWARD_COSMETIC_PREFS.arcadeCabinetStyle,
    };
  } catch {
    return { ...DEFAULT_REWARD_COSMETIC_PREFS };
  }
}

export function saveRewardCosmeticPrefs(prefs: RewardCosmeticPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REWARD_COSMETICS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}
