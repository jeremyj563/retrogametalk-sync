import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Gamepad2,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { reportAchievementEvent } from '../../utils/achievementsClient';
import {
  advanceSnakeStep,
  ARCADE_CARTRIDGE_INDEX,
  computeSnakeTickInterval,
  createInitialSnake,
  type CrtPaletteTokens,
  DEFAULT_CRT_PALETTE,
  enqueueSnakeDirection,
  type GridPoint,
  prefersReducedMotion,
  readCrtPaletteTokens,
  SNAKE_COLS,
  SNAKE_ROWS,
  type SnakeDir,
  spawnSnakeFood,
} from '../../utils/arcadeGames';
import { loadArcadeHighScore, saveArcadeHighScore } from '../../utils/easterEggs';
import { retroSynth } from '../../utils/retroSynth';

export interface PhosphorSnakeGameProps {
  konamiBonus: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onSwitchCart: () => void;
  onClose: () => void;
  onHighScoreChange?: (score: number) => void;
}

type SnakePhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

interface GoldenBonus {
  pos: GridPoint;
  remainingSec: number;
  maxSec: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Callout {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface HudSnapshot {
  phase: SnakePhase;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  length: number;
  packets: number;
  shieldActive: boolean;
}

const LOGICAL_W = 720;
const LOGICAL_H = 480;
const CELL_SIZE = 24;
const BOARD_W = SNAKE_COLS * CELL_SIZE; // 672
const BOARD_H = SNAKE_ROWS * CELL_SIZE; // 432
const BOARD_X = (LOGICAL_W - BOARD_W) / 2; // 24
const BOARD_Y = (LOGICAL_H - BOARD_H) / 2; // 24

function findSafeShieldDirection(
  snake: readonly GridPoint[],
  currentDir: SnakeDir,
): SnakeDir | null {
  const head = snake[0];
  const candidates: SnakeDir[] =
    currentDir === 'left' || currentDir === 'right'
      ? ['up', 'down', currentDir === 'left' ? 'right' : 'left']
      : ['left', 'right', currentDir === 'up' ? 'down' : 'up'];

  const occupied = new Set(snake.slice(0, snake.length - 1).map((p) => `${p.x},${p.y}`));
  for (const dir of candidates) {
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    const nx = head.x + dx;
    const ny = head.y + dy;
    if (nx >= 0 && nx < SNAKE_COLS && ny >= 0 && ny < SNAKE_ROWS && !occupied.has(`${nx},${ny}`)) {
      return dir;
    }
  }
  return null;
}

export function PhosphorSnakeGame({
  konamiBonus,
  muted,
  onToggleMute,
  onSwitchCart,
  onClose,
  onHighScoreChange,
}: PhosphorSnakeGameProps) {
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
    bestScore: loadArcadeHighScore('snake'),
    isNewBest: false,
    length: 4,
    packets: 0,
    shieldActive: konamiBonus,
  }));

  const simRef = useRef({
    phase: 'TITLE_MENU' as SnakePhase,
    score: 0,
    bestScore: loadArcadeHighScore('snake'),
    isNewBest: false,
    packets: 0,
    snake: createInitialSnake(),
    dir: 'right' as SnakeDir,
    dirQueue: [] as SnakeDir[],
    food: { x: 20, y: 9 } as GridPoint | null,
    golden: null as GoldenBonus | null,
    shieldActive: konamiBonus,
    stepTimer: 0,
    pulsePhase: 0,
    shakeTimer: 0,
    sparks: [] as Spark[],
    callouts: [] as Callout[],
  });

  const syncHud = useCallback(() => {
    const s = simRef.current;
    setHud({
      phase: s.phase,
      score: s.score,
      bestScore: s.bestScore,
      isNewBest: s.isNewBest,
      length: s.snake.length,
      packets: s.packets,
      shieldActive: s.shieldActive,
    });
  }, []);

  useEffect(() => {
    paletteRef.current = readCrtPaletteTokens(containerRef.current);
    const initial = createInitialSnake();
    simRef.current.snake = initial;
    simRef.current.food = spawnSnakeFood(SNAKE_COLS, SNAKE_ROWS, initial);
    syncHud();
  }, [syncHud]);

  const queueTurn = useCallback((nextDir: SnakeDir) => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING') return;
    s.dirQueue = enqueueSnakeDirection(s.dirQueue, s.dir, nextDir);
  }, []);

  const startNewGame = useCallback(() => {
    const s = simRef.current;
    const initial = createInitialSnake();
    s.score = 0;
    s.bestScore = loadArcadeHighScore('snake');
    s.isNewBest = false;
    s.packets = 0;
    s.snake = initial;
    s.dir = 'right';
    s.dirQueue = [];
    s.food = spawnSnakeFood(SNAKE_COLS, SNAKE_ROWS, initial);
    s.golden = null;
    s.shieldActive = konamiBonusRef.current;
    s.stepTimer = 0;
    s.shakeTimer = 0;
    s.sparks = [];
    s.callouts = [];
    s.phase = 'PLAYING';
    if (konamiBonusRef.current) {
      s.callouts.push({
        x: LOGICAL_W / 2,
        y: BOARD_Y + 42,
        text: 'KONAMI DATA SHIELD · 1.5× START',
        color: paletteRef.current.amber,
        life: 1.9,
        maxLife: 1.9,
      });
    }
    retroSynth.cartBoot();
    syncHud();
  }, [syncHud]);

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
      if (key === 'ArrowUp' || lower === 'w') {
        e.preventDefault();
        queueTurn('up');
        return;
      }
      if (key === 'ArrowDown' || lower === 's') {
        e.preventDefault();
        queueTurn('down');
        return;
      }
      if (key === 'ArrowLeft' || lower === 'a') {
        e.preventDefault();
        queueTurn('left');
        return;
      }
      if (key === 'ArrowRight' || lower === 'd') {
        e.preventDefault();
        queueTurn('right');
        return;
      }
      if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        const phase = simRef.current.phase;
        if (phase === 'TITLE_MENU' || phase === 'GAME_OVER') {
          startNewGame();
        } else if (phase === 'PAUSED') {
          togglePause();
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
  }, [onClose, onToggleMute, queueTurn, startNewGame, togglePause, syncHud]);

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

    const cellCenter = (pt: GridPoint) => ({
      x: BOARD_X + pt.x * CELL_SIZE + CELL_SIZE / 2,
      y: BOARD_Y + pt.y * CELL_SIZE + CELL_SIZE / 2,
    });

    const emitSparks = (x: number, y: number, color: string, count: number) => {
      const s = simRef.current;
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 50 + Math.random() * 115;
        s.sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2.5 + Math.random() * 2,
          life: 0.3 + Math.random() * 0.2,
          maxLife: 0.5,
          color,
        });
      }
    };

    const emitCallout = (x: number, y: number, text: string, color: string) => {
      simRef.current.callouts.push({
        x: Math.max(70, Math.min(LOGICAL_W - 70, x)),
        y: Math.max(36, y),
        text,
        color,
        life: 0.95,
        maxLife: 0.95,
      });
    };

    const addScore = (pts: number) => {
      const s = simRef.current;
      s.score += pts;
      if (s.score > 0 && !reportedCartPlayedRef.current) {
        reportedCartPlayedRef.current = true;
        reportAchievementEvent('arcade_cart_played', ARCADE_CARTRIDGE_INDEX.snake);
      }
      if (s.score > s.bestScore) {
        s.bestScore = saveArcadeHighScore('snake', s.score);
        s.isNewBest = true;
        onHighScoreChangeRef.current?.(s.bestScore);
      }
      if (s.score >= 1500 || s.snake.length >= 25) {
        reportAchievementEvent('arcade_snake_milestone');
      }
    };

    const step = (dt: number) => {
      const s = simRef.current;
      const pal = paletteRef.current;
      s.pulsePhase += dt * 5;

      if (s.shakeTimer > 0) s.shakeTimer = Math.max(0, s.shakeTimer - dt);
      for (let i = s.sparks.length - 1; i >= 0; i -= 1) {
        const sp = s.sparks[i];
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        sp.life -= dt;
        if (sp.life <= 0) s.sparks.splice(i, 1);
      }
      for (let i = s.callouts.length - 1; i >= 0; i -= 1) {
        const c = s.callouts[i];
        c.y -= 26 * dt;
        c.life -= dt;
        if (c.life <= 0) s.callouts.splice(i, 1);
      }

      if (s.phase !== 'PLAYING') return;

      // Golden cartridge bonus decay
      if (s.golden) {
        s.golden.remainingSec -= dt;
        if (s.golden.remainingSec <= 0) {
          s.golden = null;
        }
      }

      const tickInterval = computeSnakeTickInterval(s.packets);
      s.stepTimer += dt;
      if (s.stepTimer < tickInterval) return;
      s.stepTimer -= tickInterval;

      if (s.dirQueue.length > 0) {
        const nextDir = s.dirQueue.shift()!;
        s.dir = nextDir;
      }

      const res = advanceSnakeStep(s.snake, s.dir, s.food, SNAKE_COLS, SNAKE_ROWS);

      if (res.hitWall || res.hitSelf) {
        if (s.shieldActive) {
          const escapeDir = findSafeShieldDirection(s.snake, s.dir);
          if (escapeDir) {
            s.shieldActive = false;
            s.dir = escapeDir;
            s.dirQueue = [];
            const headPos = cellCenter(s.snake[0]);
            retroSynth.shieldBounce();
            emitSparks(headPos.x, headPos.y, pal.amber, 14);
            emitCallout(headPos.x, headPos.y - 14, 'DATA SHIELD SAVED!', pal.amber);
            if (!prefersReducedMotion()) s.shakeTimer = 0.14;
            syncHud();
            return;
          }
        }
        s.phase = 'GAME_OVER';
        s.bestScore = saveArcadeHighScore('snake', s.score);
        onHighScoreChangeRef.current?.(s.bestScore);
        if (!prefersReducedMotion()) s.shakeTimer = 0.2;
        const headPos = cellCenter(s.snake[0]);
        emitSparks(headPos.x, headPos.y, pal.crimson, 16);
        retroSynth.gameOver();
        syncHud();
        return;
      }

      s.snake = res.nextSnake;

      // Check Golden Cartridge pickup
      if (s.golden && s.snake[0].x === s.golden.pos.x && s.snake[0].y === s.golden.pos.y) {
        const pos = cellCenter(s.golden.pos);
        const bonusPts = Math.round(250 + (s.golden.remainingSec / s.golden.maxSec) * 150);
        s.golden = null;
        addScore(bonusPts);
        retroSynth.snakeBonus();
        emitSparks(pos.x, pos.y, pal.amber, 14);
        emitCallout(pos.x, pos.y - 10, `GOLDEN CART +${bonusPts}`, pal.amber);
        syncHud();
      }

      if (res.ateFood) {
        s.packets += 1;
        const basePts = konamiBonusRef.current && s.packets <= 10 ? 75 : 50;
        const speedBonus = Math.min(50, Math.floor(s.packets / 3) * 10);
        const gained = basePts + speedBonus;
        const pos = cellCenter(res.nextHead);
        addScore(gained);
        retroSynth.snakeEat(Math.min(10, s.packets));
        emitSparks(pos.x, pos.y, pal.phosphor, 9);
        emitCallout(pos.x, pos.y - 10, `+${gained}`, pal.phosphor);

        const occupied = s.golden ? [...s.snake, s.golden.pos] : s.snake;
        s.food = spawnSnakeFood(SNAKE_COLS, SNAKE_ROWS, occupied);

        // Spawn timed Golden Cartridge every 5 packets
        if (s.packets % 5 === 0 && !s.golden) {
          const bonusPos = spawnSnakeFood(
            SNAKE_COLS,
            SNAKE_ROWS,
            s.food ? [...s.snake, s.food] : s.snake,
          );
          if (bonusPos) {
            s.golden = { pos: bonusPos, remainingSec: 7.5, maxSec: 7.5 };
          }
        }

        if (!s.food) {
          // Grid completely filled — grand victory!
          addScore(1000);
          s.phase = 'GAME_OVER';
          retroSynth.stageClear();
        }
        syncHud();
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

      // CRT Data Bus arena border & grid
      ctx.fillStyle = pal.surface;
      ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);

      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      for (let c = 1; c < SNAKE_COLS; c += 1) {
        const gx = BOARD_X + c * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(gx, BOARD_Y);
        ctx.lineTo(gx, BOARD_Y + BOARD_H);
        ctx.stroke();
      }
      for (let r = 1; r < SNAKE_ROWS; r += 1) {
        const gy = BOARD_Y + r * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(BOARD_X, gy);
        ctx.lineTo(BOARD_X + BOARD_W, gy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = pal.borderStrong;
      ctx.lineWidth = 1.75;
      ctx.strokeRect(BOARD_X - 0.5, BOARD_Y - 0.5, BOARD_W + 1, BOARD_H + 1);

      // Draw regular ROM Packet target
      if (s.food) {
        const fx = BOARD_X + s.food.x * CELL_SIZE;
        const fy = BOARD_Y + s.food.y * CELL_SIZE;
        const pulse = 0.72 + Math.sin(s.pulsePhase) * 0.28;
        ctx.save();
        ctx.shadowColor = pal.crimson;
        ctx.shadowBlur = 10 * pulse;
        ctx.fillStyle = pal.elevated;
        ctx.fillRect(fx + 3, fy + 3, CELL_SIZE - 6, CELL_SIZE - 6);
        ctx.strokeStyle = pal.crimson;
        ctx.lineWidth = 1.75;
        ctx.strokeRect(fx + 3.5, fy + 3.5, CELL_SIZE - 7, CELL_SIZE - 7);
        ctx.fillStyle = pal.crimson;
        ctx.fillRect(fx + 7, fy + 7, CELL_SIZE - 14, CELL_SIZE - 14);
        ctx.restore();
      }

      // Draw Golden Cartridge Bonus with countdown bar
      if (s.golden) {
        const gx = BOARD_X + s.golden.pos.x * CELL_SIZE;
        const gy = BOARD_Y + s.golden.pos.y * CELL_SIZE;
        const frac = Math.max(0, s.golden.remainingSec / s.golden.maxSec);
        ctx.save();
        ctx.shadowColor = pal.amber;
        ctx.shadowBlur = 14;
        ctx.fillStyle = pal.amber;
        ctx.fillRect(gx + 2.5, gy + 2.5, CELL_SIZE - 5, CELL_SIZE - 5);
        ctx.fillStyle = pal.bg;
        ctx.font = '700 10px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', gx + CELL_SIZE / 2, gy + CELL_SIZE / 2 + 0.5);
        ctx.restore();

        // Top countdown bar along top of board
        const barW = 180;
        const barX = LOGICAL_W / 2 - barW / 2;
        ctx.fillStyle = pal.bg;
        ctx.fillRect(barX, 8, barW, 8);
        ctx.fillStyle = pal.amber;
        ctx.fillRect(barX + 1, 9, Math.max(0, (barW - 2) * frac), 6);
        ctx.strokeStyle = pal.amber;
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, 8, barW, 8);
      }

      // Draw Phosphor Snake body & head
      const len = s.snake.length;
      for (let i = len - 1; i >= 0; i -= 1) {
        const seg = s.snake[i];
        const sx = BOARD_X + seg.x * CELL_SIZE;
        const sy = BOARD_Y + seg.y * CELL_SIZE;
        const isHead = i === 0;
        const t = len <= 1 ? 1 : 1 - (i / len) * 0.62;

        ctx.save();
        if (isHead) {
          ctx.shadowColor = s.shieldActive ? pal.amber : pal.phosphor;
          ctx.shadowBlur = 12;
          ctx.fillStyle = pal.text;
          ctx.fillRect(sx + 2, sy + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          ctx.strokeStyle = s.shieldActive ? pal.amber : pal.phosphor;
          ctx.lineWidth = 1.75;
          ctx.strokeRect(sx + 2.5, sy + 2.5, CELL_SIZE - 5, CELL_SIZE - 5);

          // Directional eyes
          ctx.fillStyle = pal.bg;
          if (s.dir === 'right') {
            ctx.fillRect(sx + CELL_SIZE - 8, sy + 6, 3, 3);
            ctx.fillRect(sx + CELL_SIZE - 8, sy + CELL_SIZE - 9, 3, 3);
          } else if (s.dir === 'left') {
            ctx.fillRect(sx + 5, sy + 6, 3, 3);
            ctx.fillRect(sx + 5, sy + CELL_SIZE - 9, 3, 3);
          } else if (s.dir === 'up') {
            ctx.fillRect(sx + 6, sy + 5, 3, 3);
            ctx.fillRect(sx + CELL_SIZE - 9, sy + 5, 3, 3);
          } else {
            ctx.fillRect(sx + 6, sy + CELL_SIZE - 8, 3, 3);
            ctx.fillRect(sx + CELL_SIZE - 9, sy + CELL_SIZE - 8, 3, 3);
          }
        } else {
          ctx.fillStyle = pal.phosphor;
          ctx.globalAlpha = t;
          ctx.fillRect(sx + 2.5, sy + 2.5, CELL_SIZE - 5, CELL_SIZE - 5);
          // Subtle inner circuit trace pip
          ctx.fillStyle = pal.bg;
          ctx.globalAlpha = 0.25;
          ctx.fillRect(sx + 7, sy + 7, CELL_SIZE - 14, CELL_SIZE - 14);
        }
        ctx.restore();
      }

      // Sparks & callouts
      for (const sp of s.sparks) {
        ctx.fillStyle = sp.color;
        ctx.globalAlpha = Math.max(0, sp.life / sp.maxLife);
        ctx.fillRect(sp.x - sp.size / 2, sp.y - sp.size / 2, sp.size, sp.size);
      }
      ctx.globalAlpha = 1;

      for (const c of s.callouts) {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 1.4);
        ctx.font = '700 11px "IBM Plex Mono", monospace';
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
  }, [syncHud]);

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
            Phosphor Snake
          </h2>
          <span className="text-[11px] font-mono text-crt-muted border border-crt-border bg-crt-surface px-1.5 py-0.5 rounded-[3px] tabular-nums whitespace-nowrap">
            LEN {String(hud.length).padStart(2, '0')}
          </span>
          {hud.shieldActive && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-crt-amber border border-crt-amber/50 bg-crt-amber/10 px-1.5 py-0.5 rounded-[3px] whitespace-nowrap"
              title="Konami Data Shield active"
            >
              <Shield className="h-3 w-3" />
              SHIELD
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-xs font-mono tabular-nums ml-auto">
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
                    <span>{konamiBonus ? 'Konami Mode · Data Shield + 1.5× Start' : 'Cart 03 · CRT Data Bus'}</span>
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.06em] text-crt-phosphor uppercase">
                    Phosphor Snake
                  </h3>
                  <p className="text-xs text-crt-muted">
                    Collect glowing ROM packets across the CRT data bus and grab timed{' '}
                    <span className="font-mono text-crt-amber">★ Golden Cartridges</span> every 5 pickups.
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
                    Start Run
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
                  Arrow Keys / WASD to steer (turn-buffered) · P pause · Esc close
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
                    Length {hud.length} · {hud.packets} packets
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
                    Bus Halted
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
                    <div className="text-[10px] uppercase text-crt-muted">Length</div>
                    <div className="text-sm font-semibold text-crt-phosphor">{hud.length}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-crt-muted">Packets</div>
                    <div className="text-sm font-semibold text-crt-amber">{hud.packets}</div>
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

        {/* Mobile / Touch D-Pad */}
        <div className="grid sm:hidden grid-cols-3 gap-1.5 w-36">
          <div />
          <button
            type="button"
            onPointerDown={() => queueTurn('up')}
            aria-label="Steer up"
            className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg flex items-center justify-center touch-none select-none"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <div />
          <button
            type="button"
            onPointerDown={() => queueTurn('left')}
            aria-label="Steer left"
            className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg flex items-center justify-center touch-none select-none"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onPointerDown={() => queueTurn('down')}
            aria-label="Steer down"
            className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg flex items-center justify-center touch-none select-none"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onPointerDown={() => queueTurn('right')}
            aria-label="Steer right"
            className="p-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg flex items-center justify-center touch-none select-none"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
