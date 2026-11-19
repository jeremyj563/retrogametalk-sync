export const KONAMI_SEQUENCE = [
  'arrowup',
  'arrowup',
  'arrowdown',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowleft',
  'arrowright',
  'b',
  'a',
] as const;

export type ArcadeCartridgeId = 'breakout' | 'invaders' | 'snake' | 'tetromino';
export type ArcadeLaunchTarget = 'launcher' | ArcadeCartridgeId;

export type SecretSearchEffect =
  | 'arcade_launcher'
  | 'breakout'
  | 'invaders'
  | 'snake'
  | 'tetromino'
  | 'konami_breakout'
  | 'barrel_roll'
  | 'askew'
  | 'blow_cartridge';

export type BrickTier = 'armored' | 'high' | 'mid' | 'base';

export interface BrickBlueprint {
  col: number;
  row: number;
  maxHp: number;
  tier: BrickTier;
  label: string;
  points: number;
}

export interface StageLayout {
  stage: number;
  stageName: string;
  cols: number;
  rows: number;
  bricks: BrickBlueprint[];
}

export const STAGE_NAMES = [
  'Classic Cartridge Wall',
  'Space Invader Mosaic',
  'Pyramid Vault',
  'Fortress Grid',
] as const;

const DEFAULT_CARTRIDGE_LABELS = ['NES', 'SNES', 'N64', 'GBA', 'PS1', 'GEN', 'GBC', 'DC'];

const SYSTEM_TAG_MAP: Record<string, string> = {
  nes: 'NES',
  'nes-roms': 'NES',
  famicom: 'NES',
  snes: 'SNES',
  'snes-roms': 'SNES',
  'super-nintendo': 'SNES',
  sfc: 'SFC',
  n64: 'N64',
  'n64-roms': 'N64',
  'nintendo-64': 'N64',
  gb: 'GB',
  'gb-roms': 'GB',
  'game-boy': 'GB',
  gbc: 'GBC',
  'gbc-roms': 'GBC',
  'game-boy-color': 'GBC',
  gba: 'GBA',
  'gba-roms': 'GBA',
  'game-boy-advance': 'GBA',
  nds: 'NDS',
  'nds-roms': 'NDS',
  ds: 'NDS',
  '3ds': '3DS',
  '3ds-roms': '3DS',
  gc: 'GCN',
  gamecube: 'GCN',
  'gamecube-roms': 'GCN',
  wii: 'WII',
  'wii-roms': 'WII',
  psx: 'PS1',
  ps1: 'PS1',
  'ps1-roms': 'PS1',
  'psx-roms': 'PS1',
  playstation: 'PS1',
  ps2: 'PS2',
  'ps2-roms': 'PS2',
  psp: 'PSP',
  'psp-roms': 'PSP',
  genesis: 'GEN',
  'genesis-roms': 'GEN',
  megadrive: 'MD',
  'mega-drive': 'MD',
  sms: 'SMS',
  'master-system': 'SMS',
  gg: 'GG',
  gamegear: 'GG',
  'game-gear': 'GG',
  saturn: 'SAT',
  'saturn-roms': 'SAT',
  dreamcast: 'DC',
  'dreamcast-roms': 'DC',
  dc: 'DC',
  pce: 'PCE',
  'pc-engine': 'PCE',
  tg16: 'TG16',
  neogeo: 'NEO',
  'neo-geo': 'NEO',
  arcade: 'ARC',
  mame: 'ARC',
  fba: 'ARC',
  atari2600: '2600',
  'atari-2600': '2600',
  lynx: 'LYNX',
  jaguar: 'JAG',
  wonderswan: 'WS',
  ngp: 'NGP',
  virtualboy: 'VB',
  'virtual-boy': 'VB',
  sega32x: '32X',
  '32x': '32X',
  segacd: 'SCD',
  'sega-cd': 'SCD',
};

const HIGH_SCORE_STORAGE_KEYS: Record<ArcadeCartridgeId, string> = {
  breakout: 'rgt_crt_breakout_best_v1',
  invaders: 'rgt_crt_invaders_best_v1',
  snake: 'rgt_crt_snake_best_v1',
  tetromino: 'rgt_crt_tetromino_best_v1',
};
const MUTE_STORAGE_KEY = 'rgt_easter_egg_muted_v1';

export function normalizeKeyToken(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Pure Konami Code progress step function with longest-prefix fallback
 * so extra leading Up presses (e.g. ↑ ↑ ↑ ↓ ↓ ← → ← → B A) still match cleanly.
 */
export function advanceKonamiProgress(
  progress: number,
  key: string,
): { nextProgress: number; unlocked: boolean } {
  const token = normalizeKeyToken(key);
  if (!token) {
    return { nextProgress: 0, unlocked: false };
  }

  const safeProgress = Math.max(0, Math.min(progress, KONAMI_SEQUENCE.length - 1));
  if (token === KONAMI_SEQUENCE[safeProgress]) {
    const next = safeProgress + 1;
    if (next >= KONAMI_SEQUENCE.length) {
      return { nextProgress: 0, unlocked: true };
    }
    return { nextProgress: next, unlocked: false };
  }

  // Try longest proper prefix of the sequence that ends with this token.
  const matchedPrefix = KONAMI_SEQUENCE.slice(0, safeProgress);
  const candidate = [...matchedPrefix, token];
  for (let len = Math.min(safeProgress, KONAMI_SEQUENCE.length - 1); len >= 1; len -= 1) {
    let matches = true;
    const start = candidate.length - len;
    for (let i = 0; i < len; i += 1) {
      if (candidate[start + i] !== KONAMI_SEQUENCE[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { nextProgress: len, unlocked: false };
    }
  }

  return { nextProgress: 0, unlocked: false };
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function normalizeSecretQuery(rawQuery: string): string {
  return rawQuery
    .trim()
    .toLowerCase()
    .replace(/[!?.]+$/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Matches classic Google-style secret phrases in the Catalog search input.
 * Ambiguous single-word queries ("breakout", "konami", "invaders", "snake", "tetris", "arcade")
 * require explicit Enter submission so casual searches for ROM titles are never interrupted mid-typing.
 */
export function matchSecretSearch(
  rawQuery: string,
  options?: { submitted?: boolean },
): SecretSearchEffect | null {
  const q = normalizeSecretQuery(rawQuery);
  if (!q) return null;

  if (q === 'atari breakout' || q === 'crt breakout' || q === 'cartridge breakout') {
    return 'breakout';
  }
  if (q === 'retro invaders' || q === 'space invaders' || q === 'crt invaders') {
    return 'invaders';
  }
  if (q === 'phosphor snake' || q === 'crt snake' || q === 'data bus snake') {
    return 'snake';
  }
  if (q === 'tetromino drop' || q === 'crt tetris' || q === 'block drop') {
    return 'tetromino';
  }
  if (q === 'insert coin' || q === 'multi cart' || q === 'multicart' || q === 'crt arcade') {
    return 'arcade_launcher';
  }
  if (q === 'up up down down' || q === 'konami code') {
    return 'konami_breakout';
  }
  if (q === 'do a barrel roll' || q === 'z or r twice') {
    return 'barrel_roll';
  }
  if (q === 'askew' || q === 'tilt') {
    return 'askew';
  }
  if (
    q === 'blow cartridge' ||
    q === 'blow the cartridge' ||
    q === 'blow on cartridge' ||
    q === 'blow on the cartridge'
  ) {
    return 'blow_cartridge';
  }

  if (options?.submitted) {
    if (q === 'breakout') return 'breakout';
    if (q === 'invaders') return 'invaders';
    if (q === 'snake') return 'snake';
    if (q === 'tetris' || q === 'tetromino') return 'tetromino';
    if (q === 'arcade') return 'arcade_launcher';
    if (q === 'konami') return 'konami_breakout';
  }

  return null;
}

/**
 * Tracks rapid clicks on the top-left header cartridge logo within a rolling window.
 */
export function recordHeaderTap(
  timestamps: number[],
  now: number,
  windowMs = 2500,
  requiredTaps = 5,
): { nextTimestamps: number[]; triggered: boolean } {
  const recent = timestamps.filter((ts) => now - ts <= windowMs);
  recent.push(now);
  if (recent.length >= requiredTaps) {
    return { nextTimestamps: [], triggered: true };
  }
  return { nextTimestamps: recent, triggered: false };
}

export function formatCartridgeTag(systemSlugOrName: string): string {
  const cleaned = systemSlugOrName
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  if (!cleaned) return 'ROM';

  if (SYSTEM_TAG_MAP[cleaned]) {
    return SYSTEM_TAG_MAP[cleaned];
  }

  const withoutRoms = cleaned.replace(/-?(roms|isos|chds|games)$/g, '');
  if (withoutRoms && SYSTEM_TAG_MAP[withoutRoms]) {
    return SYSTEM_TAG_MAP[withoutRoms];
  }

  const parts = (withoutRoms || cleaned).split('-').filter(Boolean);
  if (parts.length >= 2) {
    const acronym = parts
      .map((part) => (/^\d+$/.test(part) ? part : part[0]))
      .join('')
      .toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 4) {
      return acronym;
    }
  }

  const compact = (withoutRoms || cleaned).replace(/-/g, '').toUpperCase();
  return compact.slice(0, 4) || 'ROM';
}

export function buildCartridgeLabelPool(discoveredSystems?: string[]): string[] {
  if (!discoveredSystems || discoveredSystems.length === 0) {
    return [...DEFAULT_CARTRIDGE_LABELS];
  }
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of discoveredSystems) {
    const tag = formatCartridgeTag(raw);
    if (!seen.has(tag)) {
      seen.add(tag);
      labels.push(tag);
    }
  }
  return labels.length > 0 ? labels : [...DEFAULT_CARTRIDGE_LABELS];
}

const INVADER_MASK = [
  '..#.....#..',
  '...#...#...',
  '..#######..',
  '.##.###.##.',
  '###########',
  '#.#######.#',
  '#.#.....#.#',
];

const PYRAMID_MASK = [
  '.....#.....',
  '....###....',
  '...#####...',
  '..#######..',
  '.#########.',
  '###########',
  '###.###.###',
];

const FORTRESS_MASK = [
  '##..##..##',
  '####..####',
  '###.##.###',
  '##.####.##',
  '###.##.###',
  '####..####',
  '##########',
];

function tierForRow(row: number, totalRows: number, armored: boolean): { tier: BrickTier; points: number } {
  if (armored) return { tier: 'armored', points: 150 };
  const ratio = totalRows <= 1 ? 0 : row / (totalRows - 1);
  if (ratio < 0.34) return { tier: 'high', points: 100 };
  if (ratio < 0.68) return { tier: 'mid', points: 75 };
  return { tier: 'base', points: 50 };
}

export function generateStageBricks(stage: number, consoleLabels?: string[]): StageLayout {
  const safeStage = Math.max(1, Math.floor(stage));
  const patternIndex = (safeStage - 1) % STAGE_NAMES.length;
  const cycleBonus = Math.floor((safeStage - 1) / STAGE_NAMES.length);
  const labels = buildCartridgeLabelPool(consoleLabels);

  const bricks: BrickBlueprint[] = [];
  let cols = 10;
  let rows = 6;

  if (patternIndex === 0) {
    // Classic Cartridge Wall
    cols = 10;
    rows = 6;
    for (let row = 0; row < rows; row += 1) {
      const label = labels[row % labels.length];
      for (let col = 0; col < cols; col += 1) {
        const armored = row === 0 || (cycleBonus > 0 && row === 1 && col % 2 === 0);
        const { tier, points } = tierForRow(row, rows, armored);
        bricks.push({
          col,
          row,
          maxHp: armored ? 2 : 1,
          tier,
          label,
          points: points + cycleBonus * 25,
        });
      }
    }
  } else if (patternIndex === 1) {
    // Space Invader Mosaic
    cols = INVADER_MASK[0].length;
    rows = INVADER_MASK.length;
    for (let row = 0; row < rows; row += 1) {
      const label = labels[(row + 1) % labels.length];
      for (let col = 0; col < cols; col += 1) {
        if (INVADER_MASK[row][col] !== '#') continue;
        const armored = row <= 1 || (row === 3 && (col === 2 || col === 8)) || (cycleBonus > 0 && row === 2);
        const { tier, points } = tierForRow(row, rows, armored);
        bricks.push({
          col,
          row,
          maxHp: armored ? 2 : 1,
          tier,
          label,
          points: points + cycleBonus * 25,
        });
      }
    }
  } else if (patternIndex === 2) {
    // Pyramid Vault
    cols = PYRAMID_MASK[0].length;
    rows = PYRAMID_MASK.length;
    for (let row = 0; row < rows; row += 1) {
      const label = labels[(row + 2) % labels.length];
      for (let col = 0; col < cols; col += 1) {
        if (PYRAMID_MASK[row][col] !== '#') continue;
        const isEdge =
          col === 0 ||
          col === cols - 1 ||
          PYRAMID_MASK[row][col - 1] !== '#' ||
          PYRAMID_MASK[row][col + 1] !== '#';
        const armored = row <= 1 || (row < 5 && isEdge);
        const { tier, points } = tierForRow(row, rows, armored);
        bricks.push({
          col,
          row,
          maxHp: armored ? 2 : 1,
          tier,
          label,
          points: points + cycleBonus * 25,
        });
      }
    }
  } else {
    // Fortress Grid
    cols = FORTRESS_MASK[0].length;
    rows = FORTRESS_MASK.length;
    for (let row = 0; row < rows; row += 1) {
      const label = labels[(row + 3) % labels.length];
      for (let col = 0; col < cols; col += 1) {
        if (FORTRESS_MASK[row][col] !== '#') continue;
        const armored = row === 0 || (row === 3 && col >= 3 && col <= 6);
        const { tier, points } = tierForRow(row, rows, armored);
        bricks.push({
          col,
          row,
          maxHp: armored ? 2 : 1,
          tier,
          label,
          points: points + cycleBonus * 25,
        });
      }
    }
  }

  return {
    stage: safeStage,
    stageName: STAGE_NAMES[patternIndex],
    cols,
    rows,
    bricks,
  };
}

/**
 * Computes crisp breakout ball bounce velocity off the paddle.
 * Clamps deflection angle to +/-62 degrees from vertical so the ball never gets stuck horizontally.
 */
export function computePaddleBounceVelocity(
  hitOffsetNormalized: number,
  speed: number,
): { vx: number; vy: number } {
  const clampedOffset = Math.max(-1, Math.min(1, hitOffsetNormalized));
  const maxAngleRad = (62 * Math.PI) / 180;
  const angle = clampedOffset * maxAngleRad;
  const safeSpeed = Math.max(120, speed);
  return {
    vx: Math.sin(angle) * safeSpeed,
    vy: -Math.cos(angle) * safeSpeed,
  };
}

export function loadArcadeHighScore(cartId: ArcadeCartridgeId): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(HIGH_SCORE_STORAGE_KEYS[cartId]);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function saveArcadeHighScore(cartId: ArcadeCartridgeId, score: number): number {
  const clean = Math.max(0, Math.floor(score));
  const current = loadArcadeHighScore(cartId);
  const next = Math.max(current, clean);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(HIGH_SCORE_STORAGE_KEYS[cartId], String(next));
    } catch {
      // Ignore storage quota / private-mode errors
    }
  }
  return next;
}

export function loadAllArcadeHighScores(): Record<ArcadeCartridgeId, number> {
  return {
    breakout: loadArcadeHighScore('breakout'),
    invaders: loadArcadeHighScore('invaders'),
    snake: loadArcadeHighScore('snake'),
    tetromino: loadArcadeHighScore('tetromino'),
  };
}

export function loadBreakoutHighScore(): number {
  return loadArcadeHighScore('breakout');
}

export function saveBreakoutHighScore(score: number): number {
  return saveArcadeHighScore('breakout', score);
}

export function loadEasterEggMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveEasterEggMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore storage quota / private-mode errors
  }
}
