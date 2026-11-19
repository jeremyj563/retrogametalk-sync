// Pure, unit-testable simulation helpers and shared CRT palette utilities
// for the 4-in-1 CRT Multi-Cart Arcade Cabinet.

import type { ArcadeCartridgeId } from './easterEggs';

export interface CrtPaletteTokens {
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  phosphor: string;
  phosphorDim: string;
  amber: string;
  crimson: string;
}

export const DEFAULT_CRT_PALETTE: CrtPaletteTokens = {
  bg: '#070a08',
  surface: '#0d130f',
  elevated: '#121b15',
  border: '#1e2d23',
  borderStrong: '#2c4333',
  text: '#e5f2e8',
  muted: '#8aa391',
  phosphor: '#38e56b',
  phosphorDim: '#1d7a3a',
  amber: '#f59e0b',
  crimson: '#f06449',
};

export function readCrtPaletteTokens(el: HTMLElement | null): CrtPaletteTokens {
  if (!el || typeof window === 'undefined') return DEFAULT_CRT_PALETTE;
  const styles = window.getComputedStyle(el);
  const pick = (name: string, fallback: string) => {
    const val = styles.getPropertyValue(name).trim();
    return val || fallback;
  };
  return {
    bg: pick('--color-crt-bg', DEFAULT_CRT_PALETTE.bg),
    surface: pick('--color-crt-surface', DEFAULT_CRT_PALETTE.surface),
    elevated: pick('--color-crt-elevated', DEFAULT_CRT_PALETTE.elevated),
    border: pick('--color-crt-border', DEFAULT_CRT_PALETTE.border),
    borderStrong: pick('--color-crt-border-strong', DEFAULT_CRT_PALETTE.borderStrong),
    text: pick('--color-crt-text', DEFAULT_CRT_PALETTE.text),
    muted: pick('--color-crt-muted', DEFAULT_CRT_PALETTE.muted),
    phosphor: pick('--color-crt-phosphor', DEFAULT_CRT_PALETTE.phosphor),
    phosphorDim: pick('--color-crt-phosphor-dim', DEFAULT_CRT_PALETTE.phosphorDim),
    amber: pick('--color-crt-amber', DEFAULT_CRT_PALETTE.amber),
    crimson: pick('--color-crt-crimson', DEFAULT_CRT_PALETTE.crimson),
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const ARCADE_CARTRIDGE_INDEX: Record<ArcadeCartridgeId, number> = {
  breakout: 1,
  invaders: 2,
  snake: 3,
  tetromino: 4,
};

export interface ArcadeCartridgeMeta {
  id: ArcadeCartridgeId;
  slot: string;
  title: string;
  subtitle: string;
  controlsHint: string;
  konamiPerk: string;
}

export const ARCADE_CARTRIDGES: readonly ArcadeCartridgeMeta[] = [
  {
    id: 'breakout',
    slot: 'CART 01',
    title: 'Cartridge Breakout',
    subtitle: 'ROM wall breaker with combo chains & capsules',
    controlsHint: 'Mouse / ← → · Space launch',
    konamiPerk: '5 Lives',
  },
  {
    id: 'invaders',
    slot: 'CART 02',
    title: 'Retro Invaders',
    subtitle: '5-row alien waves, CRT bunkers & UFO bonus',
    controlsHint: '← → move · Space fire',
    konamiPerk: '5 Lives + Twin Pulse',
  },
  {
    id: 'snake',
    slot: 'CART 03',
    title: 'Phosphor Snake',
    subtitle: 'CRT data-bus nibbles & Golden Cartridges',
    controlsHint: 'Arrow keys / WASD steer',
    konamiPerk: 'Data Shield + 1.5× Start',
  },
  {
    id: 'tetromino',
    slot: 'CART 04',
    title: 'Tetromino Drop',
    subtitle: '10×20 well, 7-bag pieces & Quad clears',
    controlsHint: '← → move · ↑ rotate · Space drop',
    konamiPerk: 'Hold Slot (C) + Slow Start',
  },
];

// ============================================================================
// 1. RETRO INVADERS — PURE LOGIC
// ============================================================================

export type InvaderKind = 'squid' | 'crab' | 'octopus';

export interface InvaderEntity {
  id: number;
  row: number;
  col: number;
  kind: InvaderKind;
  points: number;
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
}

export interface BunkerCell {
  x: number;
  y: number;
  size: number;
  alive: boolean;
}

export const INVADER_SPRITES: Record<InvaderKind, [string[], string[]]> = {
  squid: [
    [
      '...##...',
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '..#..#..',
      '.#.##.#.',
      '#.#..#.#',
    ],
    [
      '...##...',
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '.#.##.#.',
      '#......#',
      '.#....#.',
    ],
  ],
  crab: [
    [
      '..#.....#..',
      '...#...#...',
      '..#######..',
      '.##.###.##.',
      '###########',
      '#.#######.#',
      '#.#.....#.#',
      '...##.##...',
    ],
    [
      '..#.....#..',
      '#..#...#..#',
      '#.#######.#',
      '###.###.###',
      '###########',
      '.#########.',
      '..#.....#..',
      '.#.......#.',
    ],
  ],
  octopus: [
    [
      '....####....',
      '.##########.',
      '############',
      '###..##..###',
      '############',
      '...##..##...',
      '..##.##.##..',
      '##........##',
    ],
    [
      '....####....',
      '.##########.',
      '############',
      '###..##..###',
      '############',
      '..###..###..',
      '.##..##..##.',
      '..##....##..',
    ],
  ],
};

export const UFO_SPRITE = [
  '.....######.....',
  '...##########...',
  '..############..',
  '.##.##.##.##.##.',
  '################',
  '..###..##..###..',
  '...#........#...',
];

const BUNKER_MASK = [
  '..##########..',
  '.############.',
  '##############',
  '##############',
  '##############',
  '##############',
  '#####....#####',
  '####......####',
  '####......####',
];

export const INVADERS_LOGICAL_W = 720;
export const INVADERS_LOGICAL_H = 480;
export const INVADERS_PLAYER_Y = INVADERS_LOGICAL_H - 36;
export const INVADERS_BUNKER_Y = INVADERS_LOGICAL_H - 102;

export function createInvaderWave(wave: number): InvaderEntity[] {
  const safeWave = Math.max(1, Math.floor(wave));
  const cols = 10;
  const rows = 5;
  const cellW = 50;
  const cellH = 36;
  const startX = 112;
  const waveDropOffset = Math.min(48, (safeWave - 1) * 12);
  const startY = 66 + waveDropOffset;

  const list: InvaderEntity[] = [];
  let id = 1;

  for (let row = 0; row < rows; row += 1) {
    const kind: InvaderKind = row === 0 ? 'squid' : row <= 2 ? 'crab' : 'octopus';
    const points = row === 0 ? 30 : row <= 2 ? 20 : 10;
    const w = kind === 'squid' ? 24 : kind === 'crab' ? 32 : 34;
    const h = 22;

    for (let col = 0; col < cols; col += 1) {
      list.push({
        id,
        row,
        col,
        kind,
        points,
        x: startX + col * cellW - w / 2,
        y: startY + row * cellH,
        w,
        h,
        alive: true,
      });
      id += 1;
    }
  }

  return list;
}

export function createInvaderBunkers(): BunkerCell[] {
  const cells: BunkerCell[] = [];
  const count = 4;
  const blockSize = 5;
  const maskW = BUNKER_MASK[0].length * blockSize;
  const spacing = (INVADERS_LOGICAL_W - 140 - count * maskW) / (count - 1);
  const startX = 70;

  for (let b = 0; b < count; b += 1) {
    const bx = startX + b * (maskW + spacing);
    for (let r = 0; r < BUNKER_MASK.length; r += 1) {
      for (let c = 0; c < BUNKER_MASK[r].length; c += 1) {
        if (BUNKER_MASK[r][c] === '#') {
          cells.push({
            x: bx + c * blockSize,
            y: INVADERS_BUNKER_Y + r * blockSize,
            size: blockSize,
            alive: true,
          });
        }
      }
    }
  }

  return cells;
}

export function computeInvaderStepInterval(
  aliveCount: number,
  totalCount: number,
  wave: number,
): number {
  const safeTotal = Math.max(1, totalCount);
  const ratio = Math.max(0, Math.min(1, aliveCount / safeTotal));
  const waveSpeedup = Math.min(0.22, (Math.max(1, wave) - 1) * 0.045);
  const minInterval = Math.max(0.065, 0.1 - waveSpeedup * 0.12);
  const maxInterval = Math.max(0.26, 0.56 - waveSpeedup);
  // Accelerates sharply when few invaders remain (authentic arcade feel)
  return minInterval + (maxInterval - minInterval) * Math.pow(ratio, 1.35);
}

export function stepInvaderFormation(
  invaders: InvaderEntity[],
  direction: 1 | -1,
  options?: { stepX?: number; dropY?: number; minX?: number; maxX?: number },
): { nextDirection: 1 | -1; dropped: boolean; lowestBottomY: number } {
  const stepX = options?.stepX ?? 12;
  const dropY = options?.dropY ?? 18;
  const minX = options?.minX ?? 24;
  const maxX = options?.maxX ?? INVADERS_LOGICAL_W - 24;

  const alive = invaders.filter((inv) => inv.alive);
  if (alive.length === 0) {
    return { nextDirection: direction, dropped: false, lowestBottomY: 0 };
  }

  let wouldHitEdge = false;
  for (const inv of alive) {
    const nextLeft = inv.x + direction * stepX;
    const nextRight = nextLeft + inv.w;
    if ((direction > 0 && nextRight >= maxX) || (direction < 0 && nextLeft <= minX)) {
      wouldHitEdge = true;
      break;
    }
  }

  let lowestBottomY = 0;
  if (wouldHitEdge) {
    const nextDirection: 1 | -1 = direction === 1 ? -1 : 1;
    for (const inv of alive) {
      inv.y += dropY;
      if (inv.y + inv.h > lowestBottomY) lowestBottomY = inv.y + inv.h;
    }
    return { nextDirection, dropped: true, lowestBottomY };
  }

  for (const inv of alive) {
    inv.x += direction * stepX;
    if (inv.y + inv.h > lowestBottomY) lowestBottomY = inv.y + inv.h;
  }
  return { nextDirection: direction, dropped: false, lowestBottomY };
}

// ============================================================================
// 2. PHOSPHOR SNAKE — PURE LOGIC
// ============================================================================

export type SnakeDir = 'up' | 'down' | 'left' | 'right';

export interface GridPoint {
  x: number;
  y: number;
}

export const SNAKE_COLS = 28;
export const SNAKE_ROWS = 18;

export function isOppositeSnakeDir(a: SnakeDir, b: SnakeDir): boolean {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}

/**
 * Buffers up to 2 upcoming turns cleanly so fast multi-key sequences
 * (e.g., Right -> Down within a single tick) never cause instant 180-degree self-collision.
 */
export function enqueueSnakeDirection(
  queue: readonly SnakeDir[],
  currentDir: SnakeDir,
  nextDir: SnakeDir,
): SnakeDir[] {
  const basis = queue.length > 0 ? queue[queue.length - 1] : currentDir;
  if (nextDir === basis || isOppositeSnakeDir(basis, nextDir)) {
    return [...queue];
  }
  if (queue.length >= 2) {
    return [queue[0], nextDir];
  }
  return [...queue, nextDir];
}

export function createInitialSnake(cols = SNAKE_COLS, rows = SNAKE_ROWS): GridPoint[] {
  const cx = Math.floor(cols / 2) - 1;
  const cy = Math.floor(rows / 2);
  return [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
    { x: cx - 3, y: cy },
  ];
}

export function spawnSnakeFood(
  cols: number,
  rows: number,
  occupied: readonly GridPoint[],
  rng: () => number = Math.random,
): GridPoint | null {
  const occupiedKeys = new Set(occupied.map((p) => `${p.x},${p.y}`));
  const free: GridPoint[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!occupiedKeys.has(`${x},${y}`)) {
        free.push({ x, y });
      }
    }
  }
  if (free.length === 0) return null;
  const idx = Math.floor(Math.max(0, Math.min(0.999999, rng())) * free.length);
  return free[idx];
}

export function computeSnakeTickInterval(packetsEaten: number): number {
  const safe = Math.max(0, Math.floor(packetsEaten));
  // Starts at 132ms, smoothly accelerates down to 68ms
  return Math.max(0.068, 0.132 - safe * 0.0024);
}

export function advanceSnakeStep(
  snake: readonly GridPoint[],
  dir: SnakeDir,
  food: GridPoint | null,
  cols = SNAKE_COLS,
  rows = SNAKE_ROWS,
): {
  nextHead: GridPoint;
  hitWall: boolean;
  hitSelf: boolean;
  ateFood: boolean;
  nextSnake: GridPoint[];
} {
  const head = snake[0];
  const delta =
    dir === 'up'
      ? { x: 0, y: -1 }
      : dir === 'down'
        ? { x: 0, y: 1 }
        : dir === 'left'
          ? { x: -1, y: 0 }
          : { x: 1, y: 0 };

  const nextHead = { x: head.x + delta.x, y: head.y + delta.y };
  const hitWall =
    nextHead.x < 0 || nextHead.x >= cols || nextHead.y < 0 || nextHead.y >= rows;
  const ateFood = Boolean(food && nextHead.x === food.x && nextHead.y === food.y);

  // Tail cell vacates this tick unless the snake grows
  const bodyToCheck = ateFood ? snake : snake.slice(0, snake.length - 1);
  const hitSelf = bodyToCheck.some((seg) => seg.x === nextHead.x && seg.y === nextHead.y);

  if (hitWall || hitSelf) {
    return {
      nextHead,
      hitWall,
      hitSelf,
      ateFood: false,
      nextSnake: [...snake],
    };
  }

  const nextSnake = ateFood
    ? [nextHead, ...snake]
    : [nextHead, ...snake.slice(0, snake.length - 1)];

  return {
    nextHead,
    hitWall: false,
    hitSelf: false,
    ateFood,
    nextSnake,
  };
}

// ============================================================================
// 3. TETROMINO DROP — PURE LOGIC
// ============================================================================

export type TetrominoKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export const TETROMINO_KINDS: readonly TetrominoKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const TETRO_COLS = 10;
export const TETRO_ROWS = 20;

export interface ActiveTetromino {
  kind: TetrominoKind;
  rotation: number; // 0..3
  x: number;
  y: number;
}

// Cell offsets [col, row] for each of the 4 clockwise rotations
export const TETROMINO_SHAPES: Record<TetrominoKind, ReadonlyArray<ReadonlyArray<readonly [number, number]>>> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

export type TetroBoard = (TetrominoKind | null)[][];

export function createEmptyTetroBoard(): TetroBoard {
  return Array.from({ length: TETRO_ROWS }, () =>
    Array.from({ length: TETRO_COLS }, () => null),
  );
}

/**
 * Fair 7-bag randomizer (Fisher-Yates shuffle of all 7 distinct tetrominoes).
 */
export function createSevenBag(rng: () => number = Math.random): TetrominoKind[] {
  const bag: TetrominoKind[] = [...TETROMINO_KINDS];
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.max(0, Math.min(0.999999, rng())) * (i + 1));
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return bag;
}

export function createSpawnTetromino(kind: TetrominoKind): ActiveTetromino {
  return {
    kind,
    rotation: 0,
    x: 3,
    y: 0,
  };
}

export function getTetrominoCells(
  piece: ActiveTetromino,
  dx = 0,
  dy = 0,
  rotation = piece.rotation,
): Array<{ x: number; y: number }> {
  const normRot = ((rotation % 4) + 4) % 4;
  return TETROMINO_SHAPES[piece.kind][normRot].map(([cx, cy]) => ({
    x: piece.x + cx + dx,
    y: piece.y + cy + dy,
  }));
}

export function canPlaceTetromino(
  board: TetroBoard,
  piece: ActiveTetromino,
  dx = 0,
  dy = 0,
  rotation = piece.rotation,
): boolean {
  const cells = getTetrominoCells(piece, dx, dy, rotation);
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= TETRO_COLS || cell.y >= TETRO_ROWS) {
      return false;
    }
    if (cell.y >= 0 && board[cell.y][cell.x] !== null) {
      return false;
    }
  }
  return true;
}

/**
 * Attempts clockwise (+1) or counter-clockwise (-1) rotation with forgiving wall/floor kicks.
 */
export function tryRotateTetromino(
  board: TetroBoard,
  piece: ActiveTetromino,
  delta: 1 | -1 = 1,
): ActiveTetromino | null {
  const nextRot = ((piece.rotation + delta) % 4 + 4) % 4;
  const kicks: ReadonlyArray<readonly [number, number]> =
    piece.kind === 'I'
      ? [
          [0, 0],
          [-1, 0],
          [1, 0],
          [-2, 0],
          [2, 0],
          [0, -1],
        ]
      : [
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [-1, -1],
          [1, -1],
        ];

  for (const [kx, ky] of kicks) {
    if (canPlaceTetromino(board, piece, kx, ky, nextRot)) {
      return {
        ...piece,
        x: piece.x + kx,
        y: piece.y + ky,
        rotation: nextRot,
      };
    }
  }
  return null;
}

export function computeGhostY(board: TetroBoard, piece: ActiveTetromino): number {
  let drop = 0;
  while (canPlaceTetromino(board, piece, 0, drop + 1)) {
    drop += 1;
  }
  return piece.y + drop;
}

export function lockTetrominoAndClearLines(
  board: TetroBoard,
  piece: ActiveTetromino,
): {
  nextBoard: TetroBoard;
  clearedRowIndices: number[];
  linesCleared: number;
} {
  const nextBoard: TetroBoard = board.map((row) => [...row]);
  const cells = getTetrominoCells(piece);
  for (const cell of cells) {
    if (cell.y >= 0 && cell.y < TETRO_ROWS && cell.x >= 0 && cell.x < TETRO_COLS) {
      nextBoard[cell.y][cell.x] = piece.kind;
    }
  }

  const clearedRowIndices: number[] = [];
  const surviving: TetroBoard = [];
  for (let y = 0; y < TETRO_ROWS; y += 1) {
    if (nextBoard[y].every((cell) => cell !== null)) {
      clearedRowIndices.push(y);
    } else {
      surviving.push(nextBoard[y]);
    }
  }

  const linesCleared = clearedRowIndices.length;
  while (surviving.length < TETRO_ROWS) {
    surviving.unshift(Array.from({ length: TETRO_COLS }, () => null));
  }

  return {
    nextBoard: surviving,
    clearedRowIndices,
    linesCleared,
  };
}

export function computeTetrominoClearScore(linesCleared: number, level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  switch (linesCleared) {
    case 1:
      return 100 * safeLevel;
    case 2:
      return 300 * safeLevel;
    case 3:
      return 500 * safeLevel;
    case 4:
      return 800 * safeLevel;
    default:
      return 0;
  }
}

export function computeTetrominoDropInterval(level: number, konamiSlowStart = false): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const base = Math.max(0.095, 0.72 * Math.pow(0.84, safeLevel - 1));
  return konamiSlowStart && safeLevel <= 2 ? base * 1.25 : base;
}
