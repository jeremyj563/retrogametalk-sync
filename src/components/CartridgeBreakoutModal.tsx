import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Gamepad2,
  Heart,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  type BrickTier,
  computePaddleBounceVelocity,
  generateStageBricks,
  loadBreakoutHighScore,
  saveBreakoutHighScore,
} from '../utils/easterEggs';
import { retroSynth } from '../utils/retroSynth';

export interface CartridgeBreakoutModalProps {
  open: boolean;
  konamiBonus: boolean;
  consoleLabels: string[];
  onClose: () => void;
}

type ArcadePhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'STAGE_CLEAR' | 'GAME_OVER';
type ModalTransitionPhase = 'entering' | 'open' | 'closing';
type PowerUpKind = 'W' | 'M' | 'S';

interface LiveBrick {
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  tier: BrickTier;
  label: string;
  points: number;
  flash: number;
}

interface LiveBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  stuck: boolean;
  trail: Array<{ x: number; y: number }>;
}

interface PowerUpCapsule {
  x: number;
  y: number;
  vy: number;
  kind: PowerUpKind;
  w: number;
  h: number;
}

interface PixelParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

interface FloatingCallout {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface CrtPaletteTokens {
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

interface HudSnapshot {
  phase: ArcadePhase;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  stage: number;
  stageName: string;
  lives: number;
  bricksCleared: number;
  wideSec: number;
  slowSec: number;
}

const LOGICAL_W = 720;
const LOGICAL_H = 480;
const PADDLE_BASE_W = 104;
const PADDLE_WIDE_W = 152;
const PADDLE_H = 13;
const PADDLE_Y = LOGICAL_H - 34;
const BALL_RADIUS = 6;
const BASE_BALL_SPEED = 325;
const MAX_LIVES = 6;

const DEFAULT_PALETTE: CrtPaletteTokens = {
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

function readPaletteTokens(el: HTMLElement | null): CrtPaletteTokens {
  if (!el || typeof window === 'undefined') return DEFAULT_PALETTE;
  const styles = window.getComputedStyle(el);
  const pick = (name: string, fallback: string) => {
    const val = styles.getPropertyValue(name).trim();
    return val || fallback;
  };
  return {
    bg: pick('--color-crt-bg', DEFAULT_PALETTE.bg),
    surface: pick('--color-crt-surface', DEFAULT_PALETTE.surface),
    elevated: pick('--color-crt-elevated', DEFAULT_PALETTE.elevated),
    border: pick('--color-crt-border', DEFAULT_PALETTE.border),
    borderStrong: pick('--color-crt-border-strong', DEFAULT_PALETTE.borderStrong),
    text: pick('--color-crt-text', DEFAULT_PALETTE.text),
    muted: pick('--color-crt-muted', DEFAULT_PALETTE.muted),
    phosphor: pick('--color-crt-phosphor', DEFAULT_PALETTE.phosphor),
    phosphorDim: pick('--color-crt-phosphor-dim', DEFAULT_PALETTE.phosphorDim),
    amber: pick('--color-crt-amber', DEFAULT_PALETTE.amber),
    crimson: pick('--color-crt-crimson', DEFAULT_PALETTE.crimson),
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getStageBallSpeed(stage: number, slowActive: boolean): number {
  const base = Math.min(460, BASE_BALL_SPEED + (stage - 1) * 26);
  return slowActive ? base * 0.72 : base;
}

function buildLiveBricks(stage: number, consoleLabels: string[]): {
  stageName: string;
  bricks: LiveBrick[];
} {
  const layout = generateStageBricks(stage, consoleLabels);
  const padX = 28;
  const topY = 46;
  const gapX = 6;
  const gapY = 6;
  const usableW = LOGICAL_W - padX * 2;
  const brickW = (usableW - gapX * (layout.cols - 1)) / layout.cols;
  const brickH = layout.rows >= 7 ? 24 : 26;

  const bricks: LiveBrick[] = layout.bricks.map((bp) => ({
    x: padX + bp.col * (brickW + gapX),
    y: topY + bp.row * (brickH + gapY),
    w: brickW,
    h: brickH,
    hp: bp.maxHp,
    maxHp: bp.maxHp,
    tier: bp.tier,
    label: bp.label,
    points: bp.points,
    flash: 0,
  }));

  return { stageName: layout.stageName, bricks };
}

export function CartridgeBreakoutModal({
  open,
  konamiBonus,
  consoleLabels,
  onClose,
}: CartridgeBreakoutModalProps) {
  const [rendered, setRendered] = useState(open);
  const [modalPhase, setModalPhase] = useState<ModalTransitionPhase>(open ? 'entering' : 'closing');
  const [muted, setMuted] = useState<boolean>(() => retroSynth.isMuted());

  const modalPhaseRef = useRef<ModalTransitionPhase>(modalPhase);
  modalPhaseRef.current = modalPhase;
  const openRaf1Ref = useRef<number | null>(null);
  const openRaf2Ref = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<CrtPaletteTokens>(DEFAULT_PALETTE);
  const consoleLabelsRef = useRef<string[]>(consoleLabels);
  consoleLabelsRef.current = consoleLabels;
  const konamiBonusRef = useRef<boolean>(konamiBonus);
  konamiBonusRef.current = konamiBonus;

  const [hud, setHud] = useState<HudSnapshot>(() => ({
    phase: 'TITLE_MENU',
    score: 0,
    bestScore: loadBreakoutHighScore(),
    isNewBest: false,
    stage: 1,
    stageName: 'Classic Cartridge Wall',
    lives: konamiBonus ? 5 : 3,
    bricksCleared: 0,
    wideSec: 0,
    slowSec: 0,
  }));

  // Mutable simulation state kept in a ref for silky 60fps canvas rendering without React churn
  const simRef = useRef({
    phase: 'TITLE_MENU' as ArcadePhase,
    score: 0,
    bestScore: loadBreakoutHighScore(),
    isNewBest: false,
    stage: 1,
    stageName: 'Classic Cartridge Wall',
    lives: 3,
    bricksCleared: 0,
    combo: 0,
    paddleX: LOGICAL_W / 2,
    paddleW: PADDLE_BASE_W,
    wideTimer: 0,
    slowTimer: 0,
    stageClearTimer: 0,
    shakeTimer: 0,
    keys: { left: false, right: false },
    pointerActive: false,
    bricks: [] as LiveBrick[],
    balls: [] as LiveBall[],
    powerUps: [] as PowerUpCapsule[],
    particles: [] as PixelParticle[],
    callouts: [] as FloatingCallout[],
  });

  const syncHudFromSim = useCallback(() => {
    const s = simRef.current;
    setHud({
      phase: s.phase,
      score: s.score,
      bestScore: s.bestScore,
      isNewBest: s.isNewBest,
      stage: s.stage,
      stageName: s.stageName,
      lives: s.lives,
      bricksCleared: s.bricksCleared,
      wideSec: Math.ceil(s.wideTimer),
      slowSec: Math.ceil(s.slowTimer),
    });
  }, []);

  const spawnStuckBall = useCallback(() => {
    const s = simRef.current;
    s.balls = [
      {
        x: s.paddleX,
        y: PADDLE_Y - BALL_RADIUS - 1,
        vx: 0,
        vy: 0,
        radius: BALL_RADIUS,
        stuck: true,
        trail: [],
      },
    ];
  }, []);

  const loadStage = useCallback(
    (stageNum: number, resetPaddle = false) => {
      const s = simRef.current;
      const { stageName, bricks } = buildLiveBricks(stageNum, consoleLabelsRef.current);
      s.stage = stageNum;
      s.stageName = stageName;
      s.bricks = bricks;
      s.powerUps = [];
      s.combo = 0;
      if (resetPaddle) {
        s.paddleX = LOGICAL_W / 2;
        s.wideTimer = 0;
        s.slowTimer = 0;
        s.paddleW = PADDLE_BASE_W;
      }
      spawnStuckBall();
    },
    [spawnStuckBall],
  );

  const resetToTitle = useCallback(() => {
    const s = simRef.current;
    const savedBest = loadBreakoutHighScore();
    s.phase = 'TITLE_MENU';
    s.score = 0;
    s.bestScore = savedBest;
    s.isNewBest = false;
    s.lives = konamiBonusRef.current ? 5 : 3;
    s.bricksCleared = 0;
    s.particles = [];
    s.callouts = [];
    s.shakeTimer = 0;
    loadStage(1, true);
    syncHudFromSim();
  }, [loadStage, syncHudFromSim]);

  const startNewGame = useCallback(() => {
    const s = simRef.current;
    const savedBest = loadBreakoutHighScore();
    s.score = 0;
    s.bestScore = savedBest;
    s.isNewBest = false;
    s.lives = konamiBonusRef.current ? 5 : 3;
    s.bricksCleared = 0;
    s.particles = [];
    s.callouts = [];
    s.shakeTimer = 0;
    loadStage(1, true);
    s.phase = 'PLAYING';

    // Launch immediately with a slight crisp upward angle so Start feels responsive
    const speed = getStageBallSpeed(1, false);
    const launchOffset = (Math.random() - 0.5) * 0.45;
    const vel = computePaddleBounceVelocity(launchOffset, speed);
    if (s.balls[0]) {
      s.balls[0].stuck = false;
      s.balls[0].vx = vel.vx;
      s.balls[0].vy = vel.vy;
    }
    if (konamiBonusRef.current) {
      s.callouts.push({
        x: LOGICAL_W / 2,
        y: PADDLE_Y - 46,
        text: 'KONAMI CODE · +2 EXTRA LIVES',
        color: paletteRef.current.amber,
        life: 1.8,
        maxLife: 1.8,
      });
    }
    retroSynth.paddleHit();
    syncHudFromSim();
  }, [loadStage, syncHudFromSim]);

  const launchStuckBalls = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== 'PLAYING') return;
    let launched = false;
    const speed = getStageBallSpeed(s.stage, s.slowTimer > 0);
    for (const ball of s.balls) {
      if (ball.stuck) {
        const offset = (Math.random() - 0.5) * 0.42;
        const vel = computePaddleBounceVelocity(offset, speed);
        ball.stuck = false;
        ball.vx = vel.vx;
        ball.vy = vel.vy;
        launched = true;
      }
    }
    if (launched) {
      retroSynth.paddleHit();
    }
  }, []);

  const togglePause = useCallback(() => {
    const s = simRef.current;
    if (s.phase === 'PLAYING') {
      s.phase = 'PAUSED';
      syncHudFromSim();
    } else if (s.phase === 'PAUSED') {
      s.phase = 'PLAYING';
      syncHudFromSim();
    }
  }, [syncHudFromSim]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      retroSynth.setMuted(next);
      if (!next) {
        retroSynth.paddleHit();
      }
      return next;
    });
  }, []);

  // Modal enter/exit transitions (interruptible & smooth)
  const clearOpenRafs = useCallback(() => {
    if (openRaf1Ref.current !== null) {
      window.cancelAnimationFrame(openRaf1Ref.current);
      openRaf1Ref.current = null;
    }
    if (openRaf2Ref.current !== null) {
      window.cancelAnimationFrame(openRaf2Ref.current);
      openRaf2Ref.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (open) {
      clearCloseTimer();
      setRendered(true);
      resetToTitle();
      if (modalPhaseRef.current !== 'open') {
        setModalPhase('entering');
        clearOpenRafs();
        openRaf1Ref.current = window.requestAnimationFrame(() => {
          openRaf1Ref.current = null;
          openRaf2Ref.current = window.requestAnimationFrame(() => {
            openRaf2Ref.current = null;
            setModalPhase('open');
          });
        });
      }
    } else if (rendered) {
      clearOpenRafs();
      setModalPhase('closing');
      clearCloseTimer();
      const durationMs = prefersReducedMotion() ? 110 : 250;
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setRendered(false);
      }, durationMs);
    }
  }, [open, rendered, resetToTitle, clearCloseTimer, clearOpenRafs]);

  useEffect(() => {
    return () => {
      clearOpenRafs();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenRafs]);

  // Sample active CRT palette whenever rendered
  useEffect(() => {
    if (!rendered) return;
    paletteRef.current = readPaletteTokens(rootRef.current);
  }, [rendered, modalPhase]);

  // Keyboard controls scoped strictly while the modal is open
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();

      if (key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (key === 'ArrowLeft' || lower === 'a') {
        e.preventDefault();
        simRef.current.keys.left = true;
        return;
      }
      if (key === 'ArrowRight' || lower === 'd') {
        e.preventDefault();
        simRef.current.keys.right = true;
        return;
      }

      if (lower === 'p') {
        e.preventDefault();
        togglePause();
        return;
      }

      if (lower === 'm') {
        e.preventDefault();
        toggleMute();
        return;
      }

      if (key === ' ' || key === 'Enter') {
        const phase = simRef.current.phase;
        if (phase === 'TITLE_MENU' || phase === 'GAME_OVER') {
          e.preventDefault();
          startNewGame();
        } else if (phase === 'PAUSED') {
          e.preventDefault();
          togglePause();
        } else if (phase === 'PLAYING') {
          e.preventDefault();
          launchStuckBalls();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || lower === 'a') {
        simRef.current.keys.left = false;
      }
      if (e.key === 'ArrowRight' || lower === 'd') {
        simRef.current.keys.right = false;
      }
    };

    const handleBlur = () => {
      simRef.current.keys.left = false;
      simRef.current.keys.right = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      simRef.current.keys.left = false;
      simRef.current.keys.right = false;
    };
  }, [open, onClose, startNewGame, togglePause, toggleMute, launchStuckBalls]);

  // Main 60fps simulation & canvas render loop (only active while modal is mounted)
  useEffect(() => {
    if (!rendered) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);

    let rafId = 0;
    let lastTime = performance.now();
    let lastHudTimerSec = -1;

    const emitParticles = (x: number, y: number, color: string, count: number) => {
      const s = simRef.current;
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
        const speed = 60 + Math.random() * 145;
        s.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2.5 + Math.random() * 2.5,
          life: 0.35 + Math.random() * 0.25,
          maxLife: 0.6,
          color,
        });
      }
    };

    const emitCallout = (x: number, y: number, text: string, color: string) => {
      simRef.current.callouts.push({
        x: Math.max(64, Math.min(LOGICAL_W - 64, x)),
        y: Math.max(44, y),
        text,
        color,
        life: 0.95,
        maxLife: 0.95,
      });
    };

    const addScore = (pts: number) => {
      const s = simRef.current;
      s.score += pts;
      if (s.score > s.bestScore) {
        s.bestScore = s.score;
        s.isNewBest = true;
      }
    };

    const rescaleBallsToTargetSpeed = () => {
      const s = simRef.current;
      const targetSpeed = getStageBallSpeed(s.stage, s.slowTimer > 0);
      for (const b of s.balls) {
        if (b.stuck) continue;
        const mag = Math.hypot(b.vx, b.vy);
        if (mag > 1) {
          b.vx = (b.vx / mag) * targetSpeed;
          b.vy = (b.vy / mag) * targetSpeed;
        }
      }
    };

    const maybeSpawnPowerUp = (brick: LiveBrick) => {
      const s = simRef.current;
      if (s.powerUps.length >= 3) return;
      if (Math.random() > 0.19) return;
      const roll = Math.random();
      const kind: PowerUpKind = roll < 0.38 ? 'W' : roll < 0.72 ? 'M' : 'S';
      s.powerUps.push({
        x: brick.x + brick.w / 2,
        y: brick.y + brick.h / 2,
        vy: 138,
        kind,
        w: 32,
        h: 18,
      });
    };

    const applyPowerUp = (kind: PowerUpKind, x: number, y: number) => {
      const s = simRef.current;
      const pal = paletteRef.current;
      retroSynth.powerupCatch();
      addScore(100);

      if (kind === 'W') {
        s.wideTimer = 12;
        s.paddleW = PADDLE_WIDE_W;
        emitCallout(x, y - 10, 'WIDE PADDLE', pal.phosphor);
      } else if (kind === 'S') {
        s.slowTimer = 10;
        rescaleBallsToTargetSpeed();
        emitCallout(x, y - 10, 'SLOW BEAM', pal.amber);
      } else if (kind === 'M') {
        emitCallout(x, y - 10, 'MULTI-BALL ×3', pal.text);
        const anchor = s.balls[0];
        if (anchor) {
          const speed = getStageBallSpeed(s.stage, s.slowTimer > 0);
          if (anchor.stuck) {
            const vel = computePaddleBounceVelocity(0, speed);
            anchor.stuck = false;
            anchor.vx = vel.vx;
            anchor.vy = vel.vy;
          }
          const extraAngles = [-0.42, 0.42];
          for (const offset of extraAngles) {
            if (s.balls.length >= 3) break;
            const vel = computePaddleBounceVelocity(offset, speed);
            s.balls.push({
              x: anchor.x,
              y: anchor.y,
              vx: vel.vx,
              vy: vel.vy,
              radius: BALL_RADIUS,
              stuck: false,
              trail: [],
            });
          }
        }
      }
      syncHudFromSim();
    };

    const stepSimulation = (dt: number) => {
      const s = simRef.current;
      const pal = paletteRef.current;
      const reducedMotion = prefersReducedMotion();

      // Update cosmetic particles, brick hit flashes, callouts, and micro-shake even in STAGE_CLEAR
      if (s.shakeTimer > 0) {
        s.shakeTimer = Math.max(0, s.shakeTimer - dt);
      }
      for (const brick of s.bricks) {
        if (brick.flash > 0) brick.flash = Math.max(0, brick.flash - dt * 5);
      }
      for (let i = s.particles.length - 1; i >= 0; i -= 1) {
        const p = s.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 240 * dt;
        p.life -= dt;
        if (p.life <= 0) s.particles.splice(i, 1);
      }
      for (let i = s.callouts.length - 1; i >= 0; i -= 1) {
        const c = s.callouts[i];
        c.y -= 28 * dt;
        c.life -= dt;
        if (c.life <= 0) s.callouts.splice(i, 1);
      }

      if (s.phase === 'STAGE_CLEAR') {
        s.stageClearTimer -= dt;
        if (s.stageClearTimer <= 0) {
          loadStage(s.stage + 1, false);
          s.phase = 'PLAYING';
          syncHudFromSim();
        }
        return;
      }

      if (s.phase !== 'PLAYING') return;

      // Keyboard paddle movement
      const paddleSpeed = 520;
      if (s.keys.left) s.paddleX -= paddleSpeed * dt;
      if (s.keys.right) s.paddleX += paddleSpeed * dt;
      const halfPaddle = s.paddleW / 2;
      s.paddleX = Math.max(halfPaddle + 8, Math.min(LOGICAL_W - halfPaddle - 8, s.paddleX));

      // Active power-up countdowns
      let timerHudDirty = false;
      if (s.wideTimer > 0) {
        s.wideTimer = Math.max(0, s.wideTimer - dt);
        if (s.wideTimer === 0) {
          s.paddleW = PADDLE_BASE_W;
          timerHudDirty = true;
        }
      }
      if (s.slowTimer > 0) {
        s.slowTimer = Math.max(0, s.slowTimer - dt);
        if (s.slowTimer === 0) {
          rescaleBallsToTargetSpeed();
          timerHudDirty = true;
        }
      }
      const combinedTimerSec = Math.ceil(s.wideTimer) * 100 + Math.ceil(s.slowTimer);
      if (timerHudDirty || combinedTimerSec !== lastHudTimerSec) {
        lastHudTimerSec = combinedTimerSec;
        syncHudFromSim();
      }

      // Move & collect power-up capsules
      const paddleLeft = s.paddleX - s.paddleW / 2;
      const paddleRight = s.paddleX + s.paddleW / 2;
      for (let i = s.powerUps.length - 1; i >= 0; i -= 1) {
        const cap = s.powerUps[i];
        cap.y += cap.vy * dt;
        const caught =
          cap.y + cap.h / 2 >= PADDLE_Y &&
          cap.y - cap.h / 2 <= PADDLE_Y + PADDLE_H &&
          cap.x + cap.w / 2 >= paddleLeft &&
          cap.x - cap.w / 2 <= paddleRight;
        if (caught) {
          s.powerUps.splice(i, 1);
          applyPowerUp(cap.kind, cap.x, cap.y);
          continue;
        }
        if (cap.y - cap.h > LOGICAL_H) {
          s.powerUps.splice(i, 1);
        }
      }

      // Advance balls & collisions
      let hudDirty = false;
      for (let bi = s.balls.length - 1; bi >= 0; bi -= 1) {
        const ball = s.balls[bi];
        if (ball.stuck) {
          ball.x = s.paddleX;
          ball.y = PADDLE_Y - ball.radius - 1;
          ball.trail = [];
          continue;
        }

        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 8) ball.trail.shift();

        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;

        // Side & top wall rebounds
        if (ball.x - ball.radius < 6) {
          ball.x = 6 + ball.radius;
          ball.vx = Math.abs(ball.vx);
          retroSynth.wallHit();
        } else if (ball.x + ball.radius > LOGICAL_W - 6) {
          ball.x = LOGICAL_W - 6 - ball.radius;
          ball.vx = -Math.abs(ball.vx);
          retroSynth.wallHit();
        }
        if (ball.y - ball.radius < 6) {
          ball.y = 6 + ball.radius;
          ball.vy = Math.abs(ball.vy);
          retroSynth.wallHit();
        }

        // Paddle collision
        if (
          ball.vy > 0 &&
          ball.y + ball.radius >= PADDLE_Y &&
          ball.y - ball.radius <= PADDLE_Y + PADDLE_H + 6 &&
          ball.x + ball.radius >= paddleLeft - 2 &&
          ball.x - ball.radius <= paddleRight + 2
        ) {
          const hitOffset = (ball.x - s.paddleX) / (s.paddleW / 2);
          const speed = getStageBallSpeed(s.stage, s.slowTimer > 0);
          const vel = computePaddleBounceVelocity(hitOffset, speed);
          ball.vx = vel.vx;
          ball.vy = vel.vy;
          ball.y = PADDLE_Y - ball.radius - 0.5;
          s.combo = 0;
          retroSynth.paddleHit();
          emitParticles(ball.x, PADDLE_Y, pal.phosphor, 5);
        }

        // Brick collisions (one brick per ball per frame for deterministic bounces)
        for (let i = s.bricks.length - 1; i >= 0; i -= 1) {
          const brick = s.bricks[i];
          const closestX = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
          const closestY = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
          const dx = ball.x - closestX;
          const dy = ball.y - closestY;
          if (dx * dx + dy * dy <= ball.radius * ball.radius) {
            // Determine dominant bounce axis
            const overlapLeft = ball.x + ball.radius - brick.x;
            const overlapRight = brick.x + brick.w - (ball.x - ball.radius);
            const overlapTop = ball.y + ball.radius - brick.y;
            const overlapBottom = brick.y + brick.h - (ball.y - ball.radius);
            const minX = Math.min(overlapLeft, overlapRight);
            const minY = Math.min(overlapTop, overlapBottom);
            if (minX < minY) {
              ball.vx = -ball.vx;
            } else {
              ball.vy = -ball.vy;
            }

            brick.hp -= 1;
            brick.flash = 1;
            const cx = brick.x + brick.w / 2;
            const cy = brick.y + brick.h / 2;

            if (brick.hp <= 0) {
              s.bricks.splice(i, 1);
              s.bricksCleared += 1;
              s.combo += 1;
              const multiplier = Math.min(4, 1 + Math.floor((s.combo - 1) / 3));
              const gained = brick.points * multiplier;
              addScore(gained);
              retroSynth.brickBreak(s.combo);

              const burstColor =
                brick.tier === 'armored'
                  ? pal.amber
                  : brick.tier === 'high'
                    ? pal.crimson
                    : pal.phosphor;
              emitParticles(cx, cy, burstColor, 10);
              if (multiplier >= 2) {
                emitCallout(cx, cy, `+${gained} ×${multiplier}`, burstColor);
              } else if (brick.tier === 'armored') {
                emitCallout(cx, cy, `+${gained}`, pal.amber);
              }
              if (!reducedMotion) {
                s.shakeTimer = Math.max(s.shakeTimer, brick.tier === 'armored' ? 0.12 : 0.06);
              }
              maybeSpawnPowerUp(brick);
              hudDirty = true;
            } else {
              addScore(25);
              retroSynth.armorHit();
              emitParticles(cx, cy, pal.amber, 6);
              hudDirty = true;
            }
            break;
          }
        }

        // Bottom drain
        if (ball.y - ball.radius > LOGICAL_H + 10) {
          s.balls.splice(bi, 1);
        }
      }

      // Check stage clear
      if (s.bricks.length === 0) {
        addScore(500 * s.stage);
        s.lives = Math.min(MAX_LIVES, s.lives + 1);
        s.phase = 'STAGE_CLEAR';
        s.stageClearTimer = 1.7;
        s.powerUps = [];
        retroSynth.stageClear();
        emitCallout(LOGICAL_W / 2, LOGICAL_H / 2 - 20, `STAGE ${s.stage} CLEARED · +1 LIFE`, pal.phosphor);
        syncHudFromSim();
        return;
      }

      // Check lost life
      if (s.balls.length === 0) {
        s.lives -= 1;
        s.combo = 0;
        s.wideTimer = 0;
        s.slowTimer = 0;
        s.paddleW = PADDLE_BASE_W;
        s.powerUps = [];
        if (s.lives <= 0) {
          s.lives = 0;
          s.bestScore = saveBreakoutHighScore(s.score);
          s.phase = 'GAME_OVER';
          retroSynth.gameOver();
        } else {
          retroSynth.lifeLost();
          spawnStuckBall();
          emitCallout(LOGICAL_W / 2, PADDLE_Y - 40, 'PRESS SPACE OR CLICK TO LAUNCH', pal.muted);
        }
        syncHudFromSim();
        return;
      }

      if (hudDirty) {
        syncHudFromSim();
      }
    };

    const drawFrame = () => {
      const s = simRef.current;
      const pal = paletteRef.current;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Subtle micro-shake on heavy impacts (disabled automatically under reduced-motion)
      if (s.shakeTimer > 0) {
        const mag = s.shakeTimer * 20;
        ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
      }

      // Arena dark CRT phosphor canvas (60% breathing room)
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Subtle CRT grid lines in background
      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1;
      for (let gx = 40; gx < LOGICAL_W; gx += 40) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, LOGICAL_H);
        ctx.stroke();
      }
      for (let gy = 40; gy < LOGICAL_H; gy += 40) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(LOGICAL_W, gy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Subtle stage watermark in upper center
      ctx.fillStyle = pal.muted;
      ctx.globalAlpha = 0.35;
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `SECTOR ${String(s.stage).padStart(2, '0')} // ${s.stageName.toUpperCase()}`,
        LOGICAL_W / 2,
        22,
      );
      ctx.globalAlpha = 1;

      // Draw ROM cartridge bricks
      for (const brick of s.bricks) {
        const accent =
          brick.tier === 'armored'
            ? pal.amber
            : brick.tier === 'high'
              ? pal.crimson
              : brick.tier === 'mid'
                ? pal.phosphor
                : pal.phosphorDim;

        // Cartridge body
        ctx.fillStyle = brick.flash > 0 ? pal.text : pal.surface;
        ctx.fillRect(brick.x, brick.y, brick.w, brick.h);

        // Colored top cartridge ridge & border
        ctx.fillStyle = accent;
        ctx.globalAlpha = brick.tier === 'base' ? 0.6 : 0.88;
        ctx.fillRect(brick.x + 1, brick.y + 1, brick.w - 2, 3.5);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = brick.flash > 0 ? pal.text : accent;
        ctx.lineWidth = brick.maxHp > 1 ? 1.5 : 1;
        ctx.strokeRect(brick.x + 0.5, brick.y + 0.5, brick.w - 1, brick.h - 1);

        // Cartridge pin notches along bottom edge
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.45;
        const pinCount = 4;
        const pinSpan = brick.w - 14;
        for (let p = 0; p < pinCount; p += 1) {
          const px = brick.x + 7 + (pinSpan * p) / (pinCount - 1) - 1.5;
          ctx.fillRect(px, brick.y + brick.h - 3.5, 3, 2.5);
        }
        ctx.globalAlpha = 1;

        // Console tag label
        ctx.fillStyle = brick.flash > 0 ? pal.bg : pal.text;
        ctx.font = '600 9.5px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(brick.label, brick.x + brick.w / 2, brick.y + brick.h / 2 + 1);

        // Cracked fracture indicator on damaged armored bricks
        if (brick.maxHp > 1 && brick.hp === 1) {
          ctx.strokeStyle = pal.text;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(brick.x + brick.w * 0.22, brick.y + 4);
          ctx.lineTo(brick.x + brick.w * 0.4, brick.y + brick.h * 0.52);
          ctx.lineTo(brick.x + brick.w * 0.32, brick.y + brick.h - 3);
          ctx.stroke();
        }
      }

      // Draw falling power-up capsules (explicit icon letter + glow border)
      for (const cap of s.powerUps) {
        const capColor =
          cap.kind === 'W' ? pal.phosphor : cap.kind === 'S' ? pal.amber : pal.text;
        const rx = cap.x - cap.w / 2;
        const ry = cap.y - cap.h / 2;
        ctx.fillStyle = pal.elevated;
        ctx.fillRect(rx, ry, cap.w, cap.h);
        ctx.strokeStyle = capColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx + 0.5, ry + 0.5, cap.w - 1, cap.h - 1);
        ctx.fillStyle = capColor;
        ctx.font = '700 11px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cap.kind, cap.x, cap.y + 0.5);
      }

      // Draw CRT Paddle with phosphor energy core
      const px = s.paddleX - s.paddleW / 2;
      ctx.save();
      ctx.shadowColor = s.wideTimer > 0 ? pal.amber : pal.phosphor;
      ctx.shadowBlur = 12;
      ctx.fillStyle = pal.elevated;
      ctx.fillRect(px, PADDLE_Y, s.paddleW, PADDLE_H);
      ctx.strokeStyle = s.wideTimer > 0 ? pal.amber : pal.phosphor;
      ctx.lineWidth = 1.75;
      ctx.strokeRect(px + 0.5, PADDLE_Y + 0.5, s.paddleW - 1, PADDLE_H - 1);
      // Inner phosphor bar
      ctx.fillStyle = s.wideTimer > 0 ? pal.amber : pal.phosphor;
      ctx.fillRect(px + 8, PADDLE_Y + 4, s.paddleW - 16, PADDLE_H - 8);
      ctx.restore();

      // Draw balls & phosphor trails
      for (const ball of s.balls) {
        for (let t = 0; t < ball.trail.length; t += 1) {
          const pt = ball.trail[t];
          const alpha = ((t + 1) / (ball.trail.length + 1)) * 0.36;
          const r = ball.radius * (0.45 + ((t + 1) / ball.trail.length) * 0.5);
          ctx.fillStyle = pal.phosphor;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        ctx.save();
        ctx.shadowColor = pal.phosphor;
        ctx.shadowBlur = 12;
        ctx.fillStyle = pal.text;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw square-pixel shatter particles
      for (const p of s.particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      // Draw floating callouts
      for (const c of s.callouts) {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 1.4);
        ctx.font = '700 11px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.text, c.x, c.y);
      }
      ctx.globalAlpha = 1;

      // Subtle stage-clear banner directly on canvas
      if (s.phase === 'STAGE_CLEAR') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
        ctx.fillRect(0, LOGICAL_H / 2 - 44, LOGICAL_W, 88);
        ctx.strokeStyle = pal.phosphor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, LOGICAL_H / 2 - 44);
        ctx.lineTo(LOGICAL_W, LOGICAL_H / 2 - 44);
        ctx.moveTo(0, LOGICAL_H / 2 + 44);
        ctx.lineTo(LOGICAL_W, LOGICAL_H / 2 + 44);
        ctx.stroke();

        ctx.fillStyle = pal.phosphor;
        ctx.font = '700 22px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`STAGE ${s.stage} CLEARED`, LOGICAL_W / 2, LOGICAL_H / 2 - 10);

        ctx.fillStyle = pal.text;
        ctx.font = '500 12px "IBM Plex Mono", monospace';
        ctx.fillText('LOADING NEXT CARTRIDGE BANK · +1 LIFE', LOGICAL_W / 2, LOGICAL_H / 2 + 16);
      }

      // Subtle CRT scanline sheen inside canvas
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let sy = 0; sy < LOGICAL_H; sy += 4) {
        ctx.fillRect(0, sy, LOGICAL_W, 1);
      }

      ctx.restore();
    };

    const tick = (now: number) => {
      const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      stepSimulation(dt);
      drawFrame();
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [rendered, loadStage, spawnStuckBall, syncHudFromSim]);

  const updatePaddleFromClientX = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const normalizedX = (clientX - rect.left) / rect.width;
    const s = simRef.current;
    const half = s.paddleW / 2;
    s.paddleX = Math.max(half + 8, Math.min(LOGICAL_W - half - 8, normalizedX * LOGICAL_W));
  }, []);

  if (!rendered) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="crt-breakout-title"
      data-arcade-state={modalPhase}
      onClick={onClose}
      className="crt-arcade-backdrop fixed inset-0 z-[75] bg-black/80 backdrop-blur-[3px] flex items-center justify-center p-3 sm:p-5"
    >
      <div
        data-arcade-state={modalPhase}
        onClick={(e) => e.stopPropagation()}
        className="crt-arcade-cabinet w-full max-w-[760px] border border-crt-border-strong bg-crt-surface rounded-md shadow-[0_24px_64px_-16px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col"
      >
        {/* Single-row Unobtrusive Arcade HUD Bar (never overlaps gameplay) */}
        <div className="px-3.5 py-2.5 bg-crt-bg/95 border-b border-crt-border flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Gamepad2 className="h-4 w-4 text-crt-phosphor shrink-0" />
            <h2
              id="crt-breakout-title"
              className="font-display text-sm font-bold tracking-[0.06em] text-crt-phosphor uppercase whitespace-nowrap"
            >
              CRT Breakout
            </h2>
            <span className="text-[11px] font-mono text-crt-muted border border-crt-border bg-crt-surface px-1.5 py-0.5 rounded-[3px] tabular-nums whitespace-nowrap">
              STG {String(hud.stage).padStart(2, '0')}
            </span>
            {konamiBonus && (
              <span className="hidden sm:inline-flex items-center text-[10px] font-mono font-semibold text-crt-amber border border-crt-amber/50 bg-crt-amber/10 px-1.5 py-0.5 rounded-[3px] whitespace-nowrap">
                KONAMI +2
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 sm:gap-4 text-xs font-mono tabular-nums ml-auto">
            {hud.wideSec > 0 && (
              <span className="text-[11px] text-crt-phosphor border border-crt-phosphor/45 bg-crt-phosphor/10 px-1.5 py-0.5 rounded-[3px] whitespace-nowrap">
                [W] {hud.wideSec}s
              </span>
            )}
            {hud.slowSec > 0 && (
              <span className="text-[11px] text-crt-amber border border-crt-amber/45 bg-crt-amber/10 px-1.5 py-0.5 rounded-[3px] whitespace-nowrap">
                [S] {hud.slowSec}s
              </span>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-crt-muted">Score</span>
              <span className="text-crt-text font-semibold">
                {String(hud.score).padStart(5, '0')}
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-crt-muted">Best</span>
              <span className="text-crt-amber font-semibold">
                {String(hud.bestScore).padStart(5, '0')}
              </span>
            </div>

            <div
              className="flex items-center gap-1"
              aria-label={`Lives remaining: ${hud.lives}`}
              title={`Lives: ${hud.lives}`}
            >
              <span className="inline-flex items-center gap-0.5 text-crt-crimson">
                {Array.from({ length: Math.min(hud.lives, 5) }).map((_, i) => (
                  <Heart key={i} className="h-3 w-3 fill-current" />
                ))}
              </span>
              <span className="text-[11px] text-crt-text font-semibold">×{hud.lives}</span>
            </div>

            <div className="flex items-center gap-1 border-l border-crt-border pl-2.5">
              <button
                type="button"
                onClick={toggleMute}
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
                  {hud.phase === 'PAUSED' ? (
                    <Play className="h-3.5 w-3.5" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close CRT Breakout"
                title="Close (Esc)"
                className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-crimson hover:border-crt-crimson/50 transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Playable 3:2 CRT Canvas Viewport */}
        <div className="relative bg-crt-bg p-2.5 sm:p-3.5 flex items-center justify-center">
          <div className="relative w-full aspect-[3/2] border border-crt-border-strong rounded-[4px] overflow-hidden bg-crt-bg shadow-[inset_0_0_32px_rgba(0,0,0,0.85)]">
            <canvas
              ref={canvasRef}
              onPointerMove={(e) => {
                if (simRef.current.phase === 'PLAYING') {
                  updatePaddleFromClientX(e.clientX);
                }
              }}
              onPointerDown={(e) => {
                if (simRef.current.phase === 'PLAYING') {
                  updatePaddleFromClientX(e.clientX);
                  launchStuckBalls();
                }
              }}
              className="block w-full h-full touch-none select-none cursor-crosshair"
            />

            {/* TITLE_MENU Overlay */}
            {hud.phase === 'TITLE_MENU' && (
              <div className="absolute inset-0 bg-crt-bg/82 backdrop-blur-[2px] flex flex-col items-center justify-center p-5 text-center">
                <div className="max-w-md w-full border border-crt-border-strong bg-crt-surface/95 rounded-md px-6 py-5 shadow-2xl space-y-4">
                  <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-crt-amber">
                      <Gamepad2 className="h-3.5 w-3.5" />
                      <span>{konamiBonus ? 'Konami Code Unlocked · 5 Lives' : 'Hidden Arcade Cabinet'}</span>
                    </div>
                    <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.06em] text-crt-phosphor uppercase">
                      Cartridge Breakout
                    </h3>
                    <p className="text-xs text-crt-muted">
                      Clear rows of retro ROM cartridges, stack combo chains, and catch{' '}
                      <span className="font-mono text-crt-text">[W]</span> Wide,{' '}
                      <span className="font-mono text-crt-text">[M]</span> Multi-Ball &amp;{' '}
                      <span className="font-mono text-crt-text">[S]</span> Slow capsules.
                    </p>
                  </div>

                  {hud.bestScore > 0 && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-crt-amber/40 bg-crt-amber/10 text-xs font-mono text-crt-amber tabular-nums">
                      <Trophy className="h-3.5 w-3.5" />
                      <span>Personal Best: {hud.bestScore.toLocaleString()}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={startNewGame}
                      className="inline-flex items-center gap-2 px-5 py-2 font-display text-xs font-bold uppercase tracking-[0.08em] text-crt-bg bg-crt-phosphor hover:brightness-110 rounded transition-all whitespace-nowrap cursor-pointer"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Start Game
                    </button>
                    <button
                      type="button"
                      onClick={toggleMute}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {muted ? 'SFX Off' : 'SFX On'}
                    </button>
                  </div>

                  <p className="text-[11px] font-mono text-crt-muted/85 pt-1 border-t border-crt-border/70">
                    Mouse / Touch / ← → to move · Space to launch · P pause · Esc close
                  </p>
                </div>
              </div>
            )}

            {/* PAUSED Overlay */}
            {hud.phase === 'PAUSED' && (
              <div className="absolute inset-0 bg-crt-bg/75 backdrop-blur-[2px] flex items-center justify-center p-4">
                <div className="border border-crt-border-strong bg-crt-surface/95 rounded-md px-6 py-5 text-center space-y-4 shadow-2xl min-w-[260px]">
                  <div className="space-y-1">
                    <h3 className="font-display text-xl font-bold tracking-[0.08em] text-crt-phosphor uppercase">
                      Paused
                    </h3>
                    <p className="text-xs font-mono text-crt-muted">
                      Stage {hud.stage} · {hud.stageName}
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2.5">
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
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded whitespace-nowrap cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restart
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* GAME_OVER Overlay */}
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
                      Game Over
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
                      <div className="text-[10px] uppercase text-crt-muted">Stage</div>
                      <div className="text-sm font-semibold text-crt-phosphor">{hud.stage}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-crt-muted">Cleared</div>
                      <div className="text-sm font-semibold text-crt-amber">{hud.bricksCleared}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-2.5 pt-1">
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
                      onClick={onClose}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text rounded whitespace-nowrap cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
