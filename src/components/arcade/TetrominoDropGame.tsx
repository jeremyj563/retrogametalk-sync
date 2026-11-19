import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { reportAchievementEvent } from '../../utils/achievementsClient';
import {
  type ActiveTetromino,
  ARCADE_CARTRIDGE_INDEX,
  canPlaceTetromino,
  computeGhostY,
  computeTetrominoClearScore,
  computeTetrominoDropInterval,
  createEmptyTetroBoard,
  createSevenBag,
  createSpawnTetromino,
  type CrtPaletteTokens,
  DEFAULT_CRT_PALETTE,
  getTetrominoCells,
  lockTetrominoAndClearLines,
  prefersReducedMotion,
  readCrtPaletteTokens,
  TETRO_COLS,
  TETRO_ROWS,
  type TetroBoard,
  TETROMINO_SHAPES,
  type TetrominoKind,
  tryRotateTetromino,
} from '../../utils/arcadeGames';
import { loadArcadeHighScore, saveArcadeHighScore } from '../../utils/easterEggs';
import { retroSynth } from '../../utils/retroSynth';

export interface TetrominoDropGameProps {
  konamiBonus: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onSwitchCart: () => void;
  onClose: () => void;
  onHighScoreChange?: (score: number) => void;
}

type TetroPhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

interface Callout {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface HudSnapshot {
  phase: TetroPhase;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  level: number;
  lines: number;
  quads: number;
}

const LOGICAL_W = 720;
const LOGICAL_H = 480;
const CELL = 22;
const WELL_W = TETRO_COLS * CELL; // 220
const WELL_H = TETRO_ROWS * CELL; // 440
const WELL_X = Math.floor((LOGICAL_W - WELL_W) / 2); // 250
const WELL_Y = Math.floor((LOGICAL_H - WELL_H) / 2); // 20

function styleForPiece(kind: TetrominoKind, pal: CrtPaletteTokens): {
  stroke: string;
  fill: string;
  pip: 'dot' | 'bar' | 'ring' | 'diag';
} {
  switch (kind) {
    case 'I':
      return { stroke: pal.text, fill: pal.phosphor, pip: 'bar' };
    case 'O':
      return { stroke: pal.amber, fill: pal.amber, pip: 'ring' };
    case 'T':
      return { stroke: pal.phosphor, fill: pal.phosphor, pip: 'dot' };
    case 'S':
      return { stroke: pal.phosphor, fill: pal.phosphorDim, pip: 'diag' };
    case 'Z':
      return { stroke: pal.crimson, fill: pal.crimson, pip: 'diag' };
    case 'J':
      return { stroke: pal.text, fill: pal.phosphorDim, pip: 'ring' };
    case 'L':
      return { stroke: pal.amber, fill: pal.crimson, pip: 'dot' };
  }
}

function drawTetroBlock(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  kind: TetrominoKind,
  pal: CrtPaletteTokens,
  alpha = 1,
) {
  const style = styleForPiece(kind, pal);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pal.surface;
  ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
  ctx.fillStyle = style.fill;
  ctx.globalAlpha = alpha * 0.72;
  ctx.fillRect(px + 2.5, py + 2.5, size - 5, size - 5);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);

  // Subtle non-color internal pip so every piece stays distinguishable in monochrome CRT
  ctx.fillStyle = pal.bg;
  ctx.globalAlpha = alpha * 0.42;
  if (style.pip === 'dot') {
    ctx.fillRect(px + size / 2 - 2, py + size / 2 - 2, 4, 4);
  } else if (style.pip === 'bar') {
    ctx.fillRect(px + 4, py + size / 2 - 1.5, size - 8, 3);
  } else if (style.pip === 'ring') {
    ctx.strokeStyle = pal.bg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 5, py + 5, size - 10, size - 10);
  } else {
    ctx.fillRect(px + 5, py + 5, 3, 3);
    ctx.fillRect(px + size - 8, py + size - 8, 3, 3);
  }
  ctx.restore();
}

function drawMiniPreviewPiece(
  ctx: CanvasRenderingContext2D,
  kind: TetrominoKind | null,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  pal: CrtPaletteTokens,
  dimmed = false,
) {
  if (!kind) return;
  const cells = TETROMINO_SHAPES[kind][0];
  let minC = 99;
  let maxC = -99;
  let minR = 99;
  let maxR = -99;
  for (const [c, r] of cells) {
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  const unit = 18;
  const pieceW = (maxC - minC + 1) * unit;
  const pieceH = (maxR - minR + 1) * unit;
  const ox = boxX + (boxW - pieceW) / 2 - minC * unit;
  const oy = boxY + (boxH - pieceH) / 2 - minR * unit;
  for (const [c, r] of cells) {
    drawTetroBlock(ctx, ox + c * unit, oy + r * unit, unit, kind, pal, dimmed ? 0.4 : 1);
  }
}

export function TetrominoDropGame({
  konamiBonus,
  muted,
  onToggleMute,
  onSwitchCart,
  onClose,
  onHighScoreChange,
}: TetrominoDropGameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<CrtPaletteTokens>(DEFAULT_CRT_PALETTE);
  const konamiBonusRef = useRef(konamiBonus);
  konamiBonusRef.current = konamiBonus;
  const onHighScoreChangeRef = useRef(onHighScoreChange);
  onHighScoreChangeRef.current = onHighScoreChange;
  const reportedCartPlayedRef = useRef(false);

  const [hud, setHud] = useState<HudSnapshot>(() => ({
    phase: 'TITLE_MENU',
    score: 0,
    bestScore: loadArcadeHighScore('tetromino'),
    isNewBest: false,
    level: 1,
    lines: 0,
    quads: 0,
  }));

  const simRef = useRef({
    phase: 'TITLE_MENU' as TetroPhase,
    score: 0,
    bestScore: loadArcadeHighScore('tetromino'),
    isNewBest: false,
    level: 1,
    lines: 0,
    quads: 0,
    board: createEmptyTetroBoard() as TetroBoard,
    bag: createSevenBag(),
    active: createSpawnTetromino('T') as ActiveTetromino,
    nextKind: 'I' as TetrominoKind,
    holdKind: null as TetrominoKind | null,
    holdUsedThisTurn: false,
    dropTimer: 0,
    flashTimer: 0,
    flashRows: [] as number[],
    shakeTimer: 0,
    callouts: [] as Callout[],
  });

  const syncHud = useCallback(() => {
    const s = simRef.current;
    setHud({
      phase: s.phase,
      score: s.score,
      bestScore: s.bestScore,
      isNewBest: s.isNewBest,
      level: s.level,
      lines: s.lines,
      quads: s.quads,
    });
  }, []);

  const popNextFromBag = useCallback((): TetrominoKind => {
    const s = simRef.current;
    if (s.bag.length === 0) {
      s.bag = createSevenBag();
    }
    return s.bag.shift()!;
  }, []);

  const addScore = useCallback((pts: number) => {
    const s = simRef.current;
    s.score += pts;
    if (s.score > 0 && !reportedCartPlayedRef.current) {
      reportedCartPlayedRef.current = true;
      reportAchievementEvent('arcade_cart_played', ARCADE_CARTRIDGE_INDEX.tetromino);
    }
    if (s.score > s.bestScore) {
      s.bestScore = saveArcadeHighScore('tetromino', s.score);
      s.isNewBest = true;
      onHighScoreChangeRef.current?.(s.bestScore);
    }
  }, []);

  const lockActivePiece = useCallback(() => {
    const s = simRef.current;
    const pal = paletteRef.current;
    const { nextBoard, clearedRowIndices, linesCleared } = lockTetrominoAndClearLines(
      s.board,
      s.active,
    );
    s.board = nextBoard;
    s.holdUsedThisTurn = false;

    if (linesCleared > 0) {
      s.lines += linesCleared;
      s.level = Math.floor(s.lines / 10) + 1;
      const gained = computeTetrominoClearScore(linesCleared, s.level);
      addScore(gained);
      s.flashRows = clearedRowIndices;
      s.flashTimer = linesCleared >= 4 ? 0.34 : 0.18;
      retroSynth.tetroLineClear(linesCleared);

      const label =
        linesCleared >= 4
          ? `QUAD! +${gained}`
          : linesCleared === 3
            ? `TRIPLE +${gained}`
            : linesCleared === 2
              ? `DOUBLE +${gained}`
              : `+${gained}`;
      s.callouts.push({
        x: WELL_X + WELL_W / 2,
        y: WELL_Y + (clearedRowIndices[0] ?? 10) * CELL,
        text: label,
        color: linesCleared >= 4 ? pal.amber : pal.phosphor,
        life: linesCleared >= 4 ? 1.4 : 0.9,
        maxLife: linesCleared >= 4 ? 1.4 : 0.9,
      });

      if (linesCleared >= 4) {
        s.quads += 1;
        if (!prefersReducedMotion()) s.shakeTimer = 0.2;
        reportAchievementEvent('arcade_tetromino_quad');
      }
    } else {
      retroSynth.tetroLock();
    }

    // Spawn next piece
    const spawned = createSpawnTetromino(s.nextKind);
    s.nextKind = popNextFromBag();
    s.active = spawned;
    s.dropTimer = 0;

    if (!canPlaceTetromino(s.board, spawned)) {
      s.phase = 'GAME_OVER';
      s.bestScore = saveArcadeHighScore('tetromino', s.score);
      onHighScoreChangeRef.current?.(s.bestScore);
      retroSynth.gameOver();
    }
    syncHud();
  }, [addScore, popNextFromBag, syncHud]);

  const moveHorizontal = useCallback((dx: -1 | 1) => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING') return;
    if (canPlaceTetromino(s.board, s.active, dx, 0)) {
      s.active = { ...s.active, x: s.active.x + dx };
      retroSynth.tetroMove();
    }
  }, []);

  const rotatePiece = useCallback((delta: 1 | -1 = 1) => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING') return;
    const rotated = tryRotateTetromino(s.board, s.active, delta);
    if (rotated) {
      s.active = rotated;
      retroSynth.tetroRotate();
    }
  }, []);

  const softDrop = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING') return;
    if (canPlaceTetromino(s.board, s.active, 0, 1)) {
      s.active = { ...s.active, y: s.active.y + 1 };
      s.dropTimer = 0;
      addScore(1);
      syncHud();
    } else {
      lockActivePiece();
    }
  }, [addScore, lockActivePiece, syncHud]);

  const hardDrop = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING') return;
    const ghostY = computeGhostY(s.board, s.active);
    const dist = Math.max(0, ghostY - s.active.y);
    s.active = { ...s.active, y: ghostY };
    if (dist > 0) addScore(dist * 2);
    lockActivePiece();
  }, [addScore, lockActivePiece]);

  const holdActivePiece = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING' || !konamiBonusRef.current || s.holdUsedThisTurn) return;
    const currentKind = s.active.kind;
    if (s.holdKind) {
      const swapped = createSpawnTetromino(s.holdKind);
      s.holdKind = currentKind;
      s.active = swapped;
    } else {
      s.holdKind = currentKind;
      s.active = createSpawnTetromino(s.nextKind);
      s.nextKind = popNextFromBag();
    }
    s.holdUsedThisTurn = true;
    s.dropTimer = 0;
    retroSynth.tetroRotate();
  }, [popNextFromBag]);

  useEffect(() => {
    paletteRef.current = readCrtPaletteTokens(containerRef.current);
    const s = simRef.current;
    s.bag = createSevenBag();
    s.active = createSpawnTetromino(popNextFromBag());
    s.nextKind = popNextFromBag();
    syncHud();
  }, [popNextFromBag, syncHud]);

  const startNewGame = useCallback(() => {
    const s = simRef.current;
    s.score = 0;
    s.bestScore = loadArcadeHighScore('tetromino');
    s.isNewBest = false;
    s.level = 1;
    s.lines = 0;
    s.quads = 0;
    s.board = createEmptyTetroBoard();
    s.bag = createSevenBag();
    s.active = createSpawnTetromino(popNextFromBag());
    s.nextKind = popNextFromBag();
    s.holdKind = null;
    s.holdUsedThisTurn = false;
    s.dropTimer = 0;
    s.flashTimer = 0;
    s.flashRows = [];
    s.shakeTimer = 0;
    s.callouts = [];
    s.phase = 'PLAYING';
    if (konamiBonusRef.current) {
      s.callouts.push({
        x: WELL_X + WELL_W / 2,
        y: WELL_Y + 60,
        text: 'KONAMI HOLD SLOT (C) UNLOCKED',
        color: paletteRef.current.amber,
        life: 1.9,
        maxLife: 1.9,
      });
    }
    retroSynth.cartBoot();
    syncHud();
  }, [popNextFromBag, syncHud]);

  const togglePause = useCallback(() => {
    const s = simRef.current;
    if (s.phase === 'PLAYING') {
      s.phase = 'PAUSED';
      syncHud();
    } else if (s.phase === 'PAUSED') {
      s.phase = 'PLAYING';
      syncHud();
    }
  }, [syncHud]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();

      if (key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (lower === 'p') {
        e.preventDefault();
        togglePause();
        return;
      }
      if (lower === 'm') {
        e.preventDefault();
        onToggleMute();
        return;
      }
      if (key === 'ArrowLeft' || lower === 'a') {
        e.preventDefault();
        moveHorizontal(-1);
        return;
      }
      if (key === 'ArrowRight' || lower === 'd') {
        e.preventDefault();
        moveHorizontal(1);
        return;
      }
      if (key === 'ArrowUp' || lower === 'w' || lower === 'x') {
        e.preventDefault();
        rotatePiece(1);
        return;
      }
      if (lower === 'z') {
        e.preventDefault();
        rotatePiece(-1);
        return;
      }
      if (key === 'ArrowDown' || lower === 's') {
        e.preventDefault();
        softDrop();
        return;
      }
      if (lower === 'c' || key === 'Shift') {
        if (simRef.current.phase === 'PLAYING' && konamiBonusRef.current) {
          e.preventDefault();
          holdActivePiece();
        }
        return;
      }
      if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        const phase = simRef.current.phase;
        if (phase === 'TITLE_MENU' || phase === 'GAME_OVER') {
          startNewGame();
        } else if (phase === 'PAUSED') {
          togglePause();
        } else if (phase === 'PLAYING' && key === ' ') {
          hardDrop();
        }
      }
    };

    const handleBlur = () => {
      if (simRef.current.phase === 'PLAYING') {
        simRef.current.phase = 'PAUSED';
        syncHud();
      }
    };

    const handleVisibility = () => {
      if (document.hidden && simRef.current.phase === 'PLAYING') {
        simRef.current.phase = 'PAUSED';
        syncHud();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    onClose,
    onToggleMute,
    togglePause,
    moveHorizontal,
    rotatePiece,
    softDrop,
    hardDrop,
    holdActivePiece,
    startNewGame,
    syncHud,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);

    let rafId = 0;
    let lastTime = performance.now();

    const step = (dt: number) => {
      const s = simRef.current;
      if (s.shakeTimer > 0) s.shakeTimer = Math.max(0, s.shakeTimer - dt);
      if (s.flashTimer > 0) s.flashTimer = Math.max(0, s.flashTimer - dt);
      for (let i = s.callouts.length - 1; i >= 0; i -= 1) {
        const c = s.callouts[i];
        c.y -= 28 * dt;
        c.life -= dt;
        if (c.life <= 0) s.callouts.splice(i, 1);
      }

      if (s.phase !== 'PLAYING') return;

      const interval = computeTetrominoDropInterval(s.level, konamiBonusRef.current);
      s.dropTimer += dt;
      if (s.dropTimer >= interval) {
        s.dropTimer -= interval;
        if (canPlaceTetromino(s.board, s.active, 0, 1)) {
          s.active = { ...s.active, y: s.active.y + 1 };
        } else {
          lockActivePiece();
        }
      }
    };

    const draw = () => {
      const s = simRef.current;
      const pal = paletteRef.current;

      ctx.save();
      ctx.scale(dpr, dpr);

      if (s.shakeTimer > 0) {
        const mag = s.shakeTimer * 18;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }

      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Left Panel: Hold Slot (if Konami) + Controls legend
      const leftPanelX = 48;
      const panelW = 166;

      if (konamiBonusRef.current) {
        ctx.fillStyle = pal.surface;
        ctx.fillRect(leftPanelX, WELL_Y, panelW, 108);
        ctx.strokeStyle = pal.amber;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(leftPanelX + 0.5, WELL_Y + 0.5, panelW - 1, 107);
        ctx.fillStyle = pal.amber;
        ctx.font = '700 10px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('HOLD [C]', leftPanelX + 12, WELL_Y + 10);
        drawMiniPreviewPiece(
          ctx,
          s.holdKind,
          leftPanelX + 8,
          WELL_Y + 28,
          panelW - 16,
          70,
          pal,
          s.holdUsedThisTurn,
        );
      } else {
        ctx.fillStyle = pal.surface;
        ctx.fillRect(leftPanelX, WELL_Y, panelW, 108);
        ctx.strokeStyle = pal.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(leftPanelX + 0.5, WELL_Y + 0.5, panelW - 1, 107);
        ctx.fillStyle = pal.muted;
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('SCORING', leftPanelX + 12, WELL_Y + 12);
        ctx.font = '500 10px "IBM Plex Mono", monospace';
        ctx.fillStyle = pal.text;
        ctx.fillText('1 LINE   100×LV', leftPanelX + 12, WELL_Y + 34);
        ctx.fillText('2 LINES  300×LV', leftPanelX + 12, WELL_Y + 52);
        ctx.fillText('3 LINES  500×LV', leftPanelX + 12, WELL_Y + 70);
        ctx.fillStyle = pal.amber;
        ctx.fillText('4 QUAD   800×LV', leftPanelX + 12, WELL_Y + 88);
      }

      // Left lower quick keys card
      ctx.fillStyle = pal.surface;
      ctx.fillRect(leftPanelX, WELL_Y + 124, panelW, 132);
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(leftPanelX + 0.5, WELL_Y + 124.5, panelW - 1, 131);
      ctx.fillStyle = pal.muted;
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('CONTROLS', leftPanelX + 12, WELL_Y + 136);
      ctx.fillStyle = pal.text;
      ctx.fillText('← →   MOVE', leftPanelX + 12, WELL_Y + 158);
      ctx.fillText('↑ / Z ROTATE', leftPanelX + 12, WELL_Y + 176);
      ctx.fillText('↓     SOFT DROP', leftPanelX + 12, WELL_Y + 194);
      ctx.fillText('SPACE HARD DROP', leftPanelX + 12, WELL_Y + 212);
      ctx.fillText('P     PAUSE', leftPanelX + 12, WELL_Y + 230);

      // Right Panel: Next Piece + Stats
      const rightPanelX = WELL_X + WELL_W + 36;
      ctx.fillStyle = pal.surface;
      ctx.fillRect(rightPanelX, WELL_Y, panelW, 108);
      ctx.strokeStyle = pal.borderStrong;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(rightPanelX + 0.5, WELL_Y + 0.5, panelW - 1, 107);
      ctx.fillStyle = pal.phosphor;
      ctx.font = '700 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('NEXT PIECE', rightPanelX + 12, WELL_Y + 10);
      drawMiniPreviewPiece(ctx, s.nextKind, rightPanelX + 8, WELL_Y + 28, panelW - 16, 70, pal);

      // Right telemetry box
      ctx.fillStyle = pal.surface;
      ctx.fillRect(rightPanelX, WELL_Y + 124, panelW, 132);
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(rightPanelX + 0.5, WELL_Y + 124.5, panelW - 1, 131);
      ctx.fillStyle = pal.muted;
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText('LEVEL', rightPanelX + 12, WELL_Y + 136);
      ctx.fillStyle = pal.phosphor;
      ctx.font = '700 18px "IBM Plex Mono", monospace';
      ctx.fillText(String(s.level).padStart(2, '0'), rightPanelX + 12, WELL_Y + 150);

      ctx.fillStyle = pal.muted;
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText('LINES CLEARED', rightPanelX + 12, WELL_Y + 182);
      ctx.fillStyle = pal.text;
      ctx.font = '700 18px "IBM Plex Mono", monospace';
      ctx.fillText(String(s.lines).padStart(3, '0'), rightPanelX + 12, WELL_Y + 196);

      ctx.fillStyle = pal.muted;
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText(`QUADS: ${s.quads}`, rightPanelX + 12, WELL_Y + 228);

      // Central 10x20 Playfield Well
      ctx.fillStyle = pal.surface;
      ctx.fillRect(WELL_X, WELL_Y, WELL_W, WELL_H);

      // Subtle well grid
      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      for (let c = 1; c < TETRO_COLS; c += 1) {
        const gx = WELL_X + c * CELL;
        ctx.beginPath();
        ctx.moveTo(gx, WELL_Y);
        ctx.lineTo(gx, WELL_Y + WELL_H);
        ctx.stroke();
      }
      for (let r = 1; r < TETRO_ROWS; r += 1) {
        const gy = WELL_Y + r * CELL;
        ctx.beginPath();
        ctx.moveTo(WELL_X, gy);
        ctx.lineTo(WELL_X + WELL_W, gy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Locked board blocks
      for (let r = 0; r < TETRO_ROWS; r += 1) {
        for (let c = 0; c < TETRO_COLS; c += 1) {
          const cellKind = s.board[r][c];
          if (cellKind) {
            drawTetroBlock(ctx, WELL_X + c * CELL, WELL_Y + r * CELL, CELL, cellKind, pal, 1);
          }
        }
      }

      // Ghost drop preview & Active falling piece
      if (s.phase === 'PLAYING' || s.phase === 'PAUSED') {
        const ghostY = computeGhostY(s.board, s.active);
        if (ghostY > s.active.y) {
          const ghostCells = getTetrominoCells(s.active, 0, ghostY - s.active.y);
          for (const cell of ghostCells) {
            if (cell.y < 0) continue;
            ctx.strokeStyle = pal.phosphor;
            ctx.globalAlpha = 0.34;
            ctx.lineWidth = 1.25;
            ctx.strokeRect(
              WELL_X + cell.x * CELL + 2.5,
              WELL_Y + cell.y * CELL + 2.5,
              CELL - 5,
              CELL - 5,
            );
          }
          ctx.globalAlpha = 1;
        }

        const activeCells = getTetrominoCells(s.active);
        for (const cell of activeCells) {
          if (cell.y < 0) continue;
          drawTetroBlock(
            ctx,
            WELL_X + cell.x * CELL,
            WELL_Y + cell.y * CELL,
            CELL,
            s.active.kind,
            pal,
            1,
          );
        }
      }

      // Line clear flash overlay
      if (s.flashTimer > 0) {
        ctx.fillStyle = s.flashRows.length >= 4 ? pal.amber : pal.text;
        ctx.globalAlpha = Math.min(0.7, s.flashTimer * 2.5);
        for (const rowIdx of s.flashRows) {
          ctx.fillRect(WELL_X, WELL_Y + rowIdx * CELL, WELL_W, CELL);
        }
        ctx.globalAlpha = 1;
      }

      // Well crisp outer bezel
      ctx.strokeStyle = pal.phosphor;
      ctx.lineWidth = 1.75;
      ctx.strokeRect(WELL_X - 0.5, WELL_Y - 0.5, WELL_W + 1, WELL_H + 1);

      // Floating callouts
      for (const c of s.callouts) {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 1.4);
        ctx.font = '700 12px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.text, c.x, c.y);
      }
      ctx.globalAlpha = 1;

      // Scanline sheen
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let sy = 0; sy < LOGICAL_H; sy += 4) {
        ctx.fillRect(0, sy, LOGICAL_W, 1);
      }

      ctx.restore();
    };

    const tick = (now: number) => {
      const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      step(dt);
      draw();
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [lockActivePiece]);

  return (
    <div ref={containerRef} className="flex flex-col">
      {/* HUD Header */}
      <div className="px-3.5 py-2.5 bg-crt-bg/95 border-b border-crt-border flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onSwitchCart}
            title="Switch Cartridge"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-crt-border bg-crt-surface text-[11px] font-mono text-crt-muted hover:text-crt-phosphor hover:border-crt-phosphor/50 transition-colors cursor-pointer shrink-0"
          >
            <LayoutGrid className="h-3 w-3" />
            <span className="hidden sm:inline">Carts</span>
          </button>
          <Gamepad2 className="h-4 w-4 text-crt-phosphor shrink-0" />
          <h2
            id="crt-arcade-title"
            className="font-display text-sm font-bold tracking-[0.06em] text-crt-phosphor uppercase whitespace-nowrap"
          >
            Tetromino Drop
          </h2>
          <span className="text-[11px] font-mono text-crt-muted border border-crt-border bg-crt-surface px-1.5 py-0.5 rounded-[3px] tabular-nums whitespace-nowrap">
            LV {String(hud.level).padStart(2, '0')}
          </span>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-xs font-mono tabular-nums ml-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-crt-muted">Lines</span>
            <span className="text-crt-phosphor font-semibold">{hud.lines}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-crt-muted">Score</span>
            <span className="text-crt-text font-semibold">{String(hud.score).padStart(5, '0')}</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-crt-muted">Best</span>
            <span className="text-crt-amber font-semibold">{String(hud.bestScore).padStart(5, '0')}</span>
          </div>

          <div className="flex items-center gap-1 border-l border-crt-border pl-2.5">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'Unmute 8-bit sound effects' : 'Mute 8-bit sound effects'}
              title={muted ? 'Unmute SFX (M)' : 'Mute SFX (M)'}
              className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            {(hud.phase === 'PLAYING' || hud.phase === 'PAUSED') && (
              <button
                type="button"
                onClick={togglePause}
                aria-label={hud.phase === 'PAUSED' ? 'Resume game' : 'Pause game'}
                title={hud.phase === 'PAUSED' ? 'Resume (P)' : 'Pause (P)'}
                className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors cursor-pointer"
              >
                {hud.phase === 'PAUSED' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close CRT Arcade"
              title="Close (Esc)"
              className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-crimson hover:border-crt-crimson/50 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Playable CRT Canvas */}
      <div className="relative bg-crt-bg p-2.5 sm:p-3.5 flex flex-col items-center gap-2.5">
        <div className="relative w-full aspect-[3/2] border border-crt-border-strong rounded-[4px] overflow-hidden bg-crt-bg shadow-[inset_0_0_32px_rgba(0,0,0,0.85)]">
          <canvas ref={canvasRef} className="block w-full h-full touch-none select-none" />

          {hud.phase === 'TITLE_MENU' && (
            <div className="absolute inset-0 bg-crt-bg/82 backdrop-blur-[2px] flex flex-col items-center justify-center p-5 text-center">
              <div className="max-w-md w-full border border-crt-border-strong bg-crt-surface/95 rounded-md px-6 py-5 shadow-2xl space-y-4">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-crt-amber">
                    <Gamepad2 className="h-3.5 w-3.5" />
                    <span>{konamiBonus ? 'Konami Mode · Hold Slot (C) + Slow Start' : 'Cart 04 · Falling Blocks'}</span>
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.06em] text-crt-phosphor uppercase">
                    Tetromino Drop
                  </h3>
                  <p className="text-xs text-crt-muted">
                    Stack classic 7-bag tetrominoes inside the 10×20 CRT well, line up ghost drops, and clear 4 rows at once for a{' '}
                    <span className="font-mono text-crt-amber">QUAD!</span> bonus.
                  </p>
                </div>

                {hud.bestScore > 0 && (
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-crt-amber/40 bg-crt-amber/10 text-xs font-mono text-crt-amber tabular-nums">
                    <Trophy className="h-3.5 w-3.5" />
                    <span>Personal Best: {hud.bestScore.toLocaleString()}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={startNewGame}
                    className="inline-flex items-center gap-2 px-5 py-2 font-display text-xs font-bold uppercase tracking-[0.08em] text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-all whitespace-nowrap cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Drop Blocks
                  </button>
                  <button
                    type="button"
                    onClick={onSwitchCart}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Switch Cart
                  </button>
                </div>

                <p className="text-[11px] font-mono text-crt-muted/85 pt-1 border-t border-crt-border/70">
                  ← → move · ↑ / Z rotate · ↓ soft drop · Space hard drop · P pause
                </p>
              </div>
            </div>
          )}

          {hud.phase === 'PAUSED' && (
            <div className="absolute inset-0 bg-crt-bg/75 backdrop-blur-[2px] flex items-center justify-center p-4">
              <div className="border border-crt-border-strong bg-crt-surface/95 rounded-md px-6 py-5 text-center space-y-4 shadow-2xl min-w-[260px]">
                <div className="space-y-1">
                  <h3 className="font-display text-xl font-bold tracking-[0.08em] text-crt-phosphor uppercase">
                    Paused
                  </h3>
                  <p className="text-xs font-mono text-crt-muted">
                    Level {hud.level} · {hud.lines} lines
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={togglePause}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 font-display text-xs font-bold uppercase tracking-[0.06em] text-crt-bg bg-crt-phosphor hover:brightness-110 rounded whitespace-nowrap cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={startNewGame}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded whitespace-nowrap cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restart
                  </button>
                  <button
                    type="button"
                    onClick={onSwitchCart}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded whitespace-nowrap cursor-pointer"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Carts
                  </button>
                </div>
              </div>
            </div>
          )}

          {hud.phase === 'GAME_OVER' && (
            <div className="absolute inset-0 bg-crt-bg/82 backdrop-blur-[2px] flex items-center justify-center p-4">
              <div className="max-w-sm w-full border border-crt-border-strong bg-crt-surface/95 rounded-md px-6 py-5 text-center space-y-4 shadow-2xl">
                <div className="space-y-1">
                  {hud.isNewBest && hud.score > 0 && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-crt-amber uppercase tracking-[0.1em]">
                      <Trophy className="h-3.5 w-3.5" />
                      <span>New High Score</span>
                    </div>
                  )}
                  <h3 className="font-display text-2xl font-bold tracking-[0.08em] text-crt-crimson uppercase">
                    Top Out
                  </h3>
                </div>

                <div className="grid grid-cols-3 gap-2 border border-crt-border bg-crt-bg/80 rounded p-2.5 font-mono tabular-nums">
                  <div>
                    <div className="text-[10px] uppercase text-crt-muted">Score</div>
                    <div className="text-sm font-semibold text-crt-text">
                      {hud.score.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-crt-muted">Level</div>
                    <div className="text-sm font-semibold text-crt-phosphor">{hud.level}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-crt-muted">Lines</div>
                    <div className="text-sm font-semibold text-crt-amber">{hud.lines}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={startNewGame}
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-display text-xs font-bold uppercase tracking-[0.06em] text-crt-bg bg-crt-phosphor hover:brightness-110 rounded whitespace-nowrap cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Play Again
                  </button>
                  <button
                    type="button"
                    onClick={onSwitchCart}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded whitespace-nowrap cursor-pointer"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Switch Cart
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile / Touch Controls */}
        <div className="flex sm:hidden items-center justify-between w-full gap-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onPointerDown={() => moveHorizontal(-1)}
              aria-label="Move left"
              className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg touch-none select-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={() => softDrop()}
              aria-label="Soft drop"
              className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg touch-none select-none"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={() => moveHorizontal(1)}
              aria-label="Move right"
              className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg touch-none select-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onPointerDown={() => rotatePiece(1)}
              aria-label="Rotate piece"
              className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-amber active:bg-crt-amber active:text-crt-bg touch-none select-none"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={() => hardDrop()}
              aria-label="Hard drop"
              className="inline-flex items-center gap-1 px-3 py-2.5 rounded border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor font-display text-xs font-bold uppercase active:bg-crt-phosphor active:text-crt-bg touch-none select-none"
            >
              <ArrowDownToLine className="h-4 w-4" />
              Drop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
