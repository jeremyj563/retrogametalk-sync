import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Gamepad2,
  Heart,
  LayoutGrid,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { reportAchievementEvent } from '../../utils/achievementsClient';
import {
  ARCADE_CARTRIDGE_INDEX,
  type BunkerCell,
  computeInvaderStepInterval,
  createInvaderBunkers,
  createInvaderWave,
  type CrtPaletteTokens,
  DEFAULT_CRT_PALETTE,
  INVADER_SPRITES,
  INVADERS_LOGICAL_H,
  INVADERS_LOGICAL_W,
  INVADERS_PLAYER_Y,
  type InvaderEntity,
  prefersReducedMotion,
  readCrtPaletteTokens,
  stepInvaderFormation,
  UFO_SPRITE,
} from '../../utils/arcadeGames';
import { loadArcadeHighScore, saveArcadeHighScore } from '../../utils/easterEggs';
import { retroSynth } from '../../utils/retroSynth';

export interface RetroInvadersGameProps {
  konamiBonus: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onSwitchCart: () => void;
  onClose: () => void;
  onHighScoreChange?: (score: number) => void;
}

type InvadersPhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'WAVE_CLEAR' | 'GAME_OVER';

interface LaserBolt {
  x: number;
  y: number;
  vy: number;
  w: number;
  h: number;
  fromPlayer: boolean;
}

interface MysteryUfo {
  x: number;
  y: number;
  vx: number;
  w: number;
  h: number;
  points: number;
  warbleTimer: number;
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
  phase: InvadersPhase;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  wave: number;
  lives: number;
  destroyed: number;
}

const LOGICAL_W = INVADERS_LOGICAL_W;
const LOGICAL_H = INVADERS_LOGICAL_H;
const PLAYER_W = 40;
const PLAYER_H = 18;
const PLAYER_SPEED = 360;

function drawSprite(
  ctx: CanvasRenderingContext2D,
  bitmap: readonly string[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  const rows = bitmap.length;
  const cols = bitmap[0].length;
  const pxW = w / cols;
  const pxH = h / rows;
  ctx.fillStyle = color;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (bitmap[r][c] === '#') {
        ctx.fillRect(x + c * pxW, y + r * pxH, Math.ceil(pxW), Math.ceil(pxH));
      }
    }
  }
}

export function RetroInvadersGame({
  konamiBonus,
  muted,
  onToggleMute,
  onSwitchCart,
  onClose,
  onHighScoreChange,
}: RetroInvadersGameProps) {
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
    bestScore: loadArcadeHighScore('invaders'),
    isNewBest: false,
    wave: 1,
    lives: konamiBonus ? 5 : 3,
    destroyed: 0,
  }));

  const simRef = useRef({
    phase: 'TITLE_MENU' as InvadersPhase,
    score: 0,
    bestScore: loadArcadeHighScore('invaders'),
    isNewBest: false,
    wave: 1,
    lives: konamiBonus ? 5 : 3,
    destroyed: 0,
    playerX: LOGICAL_W / 2,
    invulnTimer: 0,
    fireCooldown: 0,
    waveClearTimer: 0,
    shakeTimer: 0,
    invaders: createInvaderWave(1) as InvaderEntity[],
    bunkers: createInvaderBunkers() as BunkerCell[],
    direction: 1 as 1 | -1,
    marchTimer: 0,
    marchStepIndex: 0,
    animFrame: 0 as 0 | 1,
    enemyFireTimer: 0.9,
    ufo: null as MysteryUfo | null,
    ufoSpawnTimer: 11,
    bolts: [] as LaserBolt[],
    sparks: [] as Spark[],
    callouts: [] as Callout[],
    keys: { left: false, right: false, fire: false },
  });

  const syncHud = useCallback(() => {
    const s = simRef.current;
    setHud({
      phase: s.phase,
      score: s.score,
      bestScore: s.bestScore,
      isNewBest: s.isNewBest,
      wave: s.wave,
      lives: s.lives,
      destroyed: s.destroyed,
    });
  }, []);

  const loadWave = useCallback((waveNum: number, resetBunkers: boolean) => {
    const s = simRef.current;
    s.wave = waveNum;
    s.invaders = createInvaderWave(waveNum);
    if (resetBunkers) {
      s.bunkers = createInvaderBunkers();
    } else {
      // Partial bunker repair between waves
      const fresh = createInvaderBunkers();
      for (let i = 0; i < s.bunkers.length && i < fresh.length; i += 1) {
        if (!s.bunkers[i].alive && Math.random() < 0.35) {
          s.bunkers[i].alive = true;
        }
      }
    }
    s.direction = 1;
    s.marchTimer = 0;
    s.marchStepIndex = 0;
    s.animFrame = 0;
    s.bolts = [];
    s.ufo = null;
    s.ufoSpawnTimer = 10 + Math.random() * 6;
    s.enemyFireTimer = Math.max(0.42, 0.95 - (waveNum - 1) * 0.08);
  }, []);

  useEffect(() => {
    paletteRef.current = readCrtPaletteTokens(containerRef.current);
    loadWave(1, true);
    syncHud();
  }, [loadWave, syncHud]);

  const startNewGame = useCallback(() => {
    const s = simRef.current;
    s.score = 0;
    s.bestScore = loadArcadeHighScore('invaders');
    s.isNewBest = false;
    s.lives = konamiBonusRef.current ? 5 : 3;
    s.destroyed = 0;
    s.playerX = LOGICAL_W / 2;
    s.invulnTimer = 0.6;
    s.fireCooldown = 0;
    s.shakeTimer = 0;
    s.sparks = [];
    s.callouts = [];
    loadWave(1, true);
    s.phase = 'PLAYING';
    if (konamiBonusRef.current) {
      s.callouts.push({
        x: LOGICAL_W / 2,
        y: INVADERS_PLAYER_Y - 36,
        text: 'KONAMI TWIN PULSE · 5 LIVES',
        color: paletteRef.current.amber,
        life: 1.9,
        maxLife: 1.9,
      });
    }
    retroSynth.cartBoot();
    syncHud();
  }, [loadWave, syncHud]);

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
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        if (key === 'ArrowUp') simRef.current.keys.fire = true;
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
      if (key === ' ' || key === 'Enter') {
        e.preventDefault();
        const phase = simRef.current.phase;
        if (phase === 'TITLE_MENU' || phase === 'GAME_OVER') {
          startNewGame();
        } else if (phase === 'PAUSED') {
          togglePause();
        } else if (phase === 'PLAYING') {
          simRef.current.keys.fire = true;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || lower === 'a') simRef.current.keys.left = false;
      if (e.key === 'ArrowRight' || lower === 'd') simRef.current.keys.right = false;
      if (e.key === ' ' || e.key === 'ArrowUp') simRef.current.keys.fire = false;
    };

    const handleBlur = () => {
      simRef.current.keys = { left: false, right: false, fire: false };
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
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
      simRef.current.keys = { left: false, right: false, fire: false };
    };
  }, [onClose, onToggleMute, startNewGame, togglePause, syncHud]);

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

    const emitSparks = (x: number, y: number, color: string, count: number) => {
      const s = simRef.current;
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 55 + Math.random() * 145;
        s.sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2.5 + Math.random() * 2,
          life: 0.3 + Math.random() * 0.22,
          maxLife: 0.52,
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
        life: 1.0,
        maxLife: 1.0,
      });
    };

    const addScore = (pts: number) => {
      const s = simRef.current;
      s.score += pts;
      if (s.score > 0 && !reportedCartPlayedRef.current) {
        reportedCartPlayedRef.current = true;
        reportAchievementEvent('arcade_cart_played', ARCADE_CARTRIDGE_INDEX.invaders);
      }
      if (s.score > s.bestScore) {
        s.bestScore = saveArcadeHighScore('invaders', s.score);
        s.isNewBest = true;
        onHighScoreChangeRef.current?.(s.bestScore);
      }
    };

    const triggerPlayerHit = () => {
      const s = simRef.current;
      const pal = paletteRef.current;
      s.lives -= 1;
      emitSparks(s.playerX, INVADERS_PLAYER_Y, pal.crimson, 16);
      if (!prefersReducedMotion()) s.shakeTimer = 0.22;
      if (s.lives <= 0) {
        s.lives = 0;
        s.phase = 'GAME_OVER';
        s.bestScore = saveArcadeHighScore('invaders', s.score);
        onHighScoreChangeRef.current?.(s.bestScore);
        retroSynth.gameOver();
      } else {
        s.invulnTimer = 1.6;
        s.bolts = s.bolts.filter((b) => b.fromPlayer);
        retroSynth.lifeLost();
        emitCallout(s.playerX, INVADERS_PLAYER_Y - 26, 'HULL BREACHED', pal.crimson);
      }
      syncHud();
    };

    const step = (dt: number) => {
      const s = simRef.current;
      const pal = paletteRef.current;
      const reduced = prefersReducedMotion();

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

      if (s.phase === 'WAVE_CLEAR') {
        s.waveClearTimer -= dt;
        if (s.waveClearTimer <= 0) {
          loadWave(s.wave + 1, false);
          s.phase = 'PLAYING';
          syncHud();
        }
        return;
      }

      if (s.phase !== 'PLAYING') return;

      if (s.invulnTimer > 0) s.invulnTimer = Math.max(0, s.invulnTimer - dt);
      if (s.fireCooldown > 0) s.fireCooldown = Math.max(0, s.fireCooldown - dt);

      // Player movement
      if (s.keys.left) s.playerX -= PLAYER_SPEED * dt;
      if (s.keys.right) s.playerX += PLAYER_SPEED * dt;
      s.playerX = Math.max(PLAYER_W / 2 + 14, Math.min(LOGICAL_W - PLAYER_W / 2 - 14, s.playerX));

      // Player firing
      const maxPlayerBolts = konamiBonusRef.current ? 4 : 2;
      const activePlayerBolts = s.bolts.filter((b) => b.fromPlayer).length;
      if (s.keys.fire && s.fireCooldown <= 0 && activePlayerBolts < maxPlayerBolts) {
        if (konamiBonusRef.current) {
          s.bolts.push(
            { x: s.playerX - 10, y: INVADERS_PLAYER_Y - 10, vy: -520, w: 3, h: 12, fromPlayer: true },
            { x: s.playerX + 10, y: INVADERS_PLAYER_Y - 10, vy: -520, w: 3, h: 12, fromPlayer: true },
          );
          s.fireCooldown = 0.24;
        } else {
          s.bolts.push({
            x: s.playerX,
            y: INVADERS_PLAYER_Y - 12,
            vy: -490,
            w: 3,
            h: 13,
            fromPlayer: true,
          });
          s.fireCooldown = 0.28;
        }
        retroSynth.laserShot();
      }

      // Mystery UFO spawn & glide
      if (!s.ufo) {
        s.ufoSpawnTimer -= dt;
        if (s.ufoSpawnTimer <= 0) {
          const fromLeft = Math.random() < 0.5;
          const ptsPool = [150, 200, 250, 300];
          s.ufo = {
            x: fromLeft ? -48 : LOGICAL_W + 4,
            y: 30,
            vx: fromLeft ? 128 : -128,
            w: 44,
            h: 18,
            points: ptsPool[Math.floor(Math.random() * ptsPool.length)],
            warbleTimer: 0,
          };
          s.ufoSpawnTimer = 16 + Math.random() * 10;
        }
      } else {
        s.ufo.x += s.ufo.vx * dt;
        s.ufo.warbleTimer -= dt;
        if (s.ufo.warbleTimer <= 0) {
          retroSynth.ufoWarble();
          s.ufo.warbleTimer = 0.42;
        }
        if (s.ufo.x < -64 || s.ufo.x > LOGICAL_W + 64) {
          s.ufo = null;
        }
      }

      // Marching alien formation
      const aliveInvaders = s.invaders.filter((inv) => inv.alive);
      const stepInterval = computeInvaderStepInterval(aliveInvaders.length, s.invaders.length, s.wave);
      s.marchTimer += dt;
      if (s.marchTimer >= stepInterval) {
        s.marchTimer = 0;
        s.animFrame = s.animFrame === 0 ? 1 : 0;
        const stepResult = stepInvaderFormation(s.invaders, s.direction, {
          stepX: 11,
          dropY: 16,
          minX: 22,
          maxX: LOGICAL_W - 22,
        });
        s.direction = stepResult.nextDirection;
        retroSynth.invaderMarch(s.marchStepIndex);
        s.marchStepIndex += 1;

        // Destroy bunker pixels touched by marching invaders
        for (const inv of aliveInvaders) {
          for (const cell of s.bunkers) {
            if (!cell.alive) continue;
            if (
              cell.x + cell.size >= inv.x &&
              cell.x <= inv.x + inv.w &&
              cell.y + cell.size >= inv.y &&
              cell.y <= inv.y + inv.h
            ) {
              cell.alive = false;
            }
          }
        }

        // Invasion reached the player line
        if (stepResult.lowestBottomY >= INVADERS_PLAYER_Y - 12) {
          s.lives = 0;
          s.phase = 'GAME_OVER';
          s.bestScore = saveArcadeHighScore('invaders', s.score);
          onHighScoreChangeRef.current?.(s.bestScore);
          retroSynth.gameOver();
          syncHud();
          return;
        }
      }

      // Enemy firing from bottom-most alive invader per column
      s.enemyFireTimer -= dt;
      if (s.enemyFireTimer <= 0 && aliveInvaders.length > 0) {
        const bottomByCol = new Map<number, InvaderEntity>();
        for (const inv of aliveInvaders) {
          const prev = bottomByCol.get(inv.col);
          if (!prev || inv.row > prev.row) bottomByCol.set(inv.col, inv);
        }
        const shooters = Array.from(bottomByCol.values());
        const shooter = shooters[Math.floor(Math.random() * shooters.length)];
        if (shooter) {
          s.bolts.push({
            x: shooter.x + shooter.w / 2,
            y: shooter.y + shooter.h + 2,
            vy: Math.min(310, 210 + (s.wave - 1) * 20),
            w: 4,
            h: 11,
            fromPlayer: false,
          });
        }
        s.enemyFireTimer = Math.max(0.32, 0.92 - (s.wave - 1) * 0.08) * (0.7 + Math.random() * 0.6);
      }

      // Move bolts & check collisions
      let hudDirty = false;
      for (let bi = s.bolts.length - 1; bi >= 0; bi -= 1) {
        const bolt = s.bolts[bi];
        bolt.y += bolt.vy * dt;

        if (bolt.y < -16 || bolt.y > LOGICAL_H + 16) {
          s.bolts.splice(bi, 1);
          continue;
        }

        // Bunker erosion
        let hitBunker = false;
        for (const cell of s.bunkers) {
          if (!cell.alive) continue;
          if (
            bolt.x + bolt.w / 2 >= cell.x &&
            bolt.x - bolt.w / 2 <= cell.x + cell.size &&
            bolt.y + bolt.h / 2 >= cell.y &&
            bolt.y - bolt.h / 2 <= cell.y + cell.size
          ) {
            cell.alive = false;
            // Small blast radius for tactile cratering
            for (const neighbor of s.bunkers) {
              if (!neighbor.alive) continue;
              const dist = Math.hypot(neighbor.x - cell.x, neighbor.y - cell.y);
              if (dist <= cell.size * 1.45 && Math.random() < 0.65) {
                neighbor.alive = false;
              }
            }
            emitSparks(bolt.x, bolt.y, pal.phosphorDim, 4);
            hitBunker = true;
            break;
          }
        }
        if (hitBunker) {
          s.bolts.splice(bi, 1);
          continue;
        }

        if (bolt.fromPlayer) {
          // Check UFO hit
          if (
            s.ufo &&
            bolt.x + bolt.w / 2 >= s.ufo.x &&
            bolt.x - bolt.w / 2 <= s.ufo.x + s.ufo.w &&
            bolt.y - bolt.h / 2 <= s.ufo.y + s.ufo.h &&
            bolt.y + bolt.h / 2 >= s.ufo.y
          ) {
            const pts = s.ufo.points;
            const ux = s.ufo.x + s.ufo.w / 2;
            const uy = s.ufo.y + s.ufo.h / 2;
            s.ufo = null;
            s.bolts.splice(bi, 1);
            addScore(pts);
            retroSynth.ufoDestroy();
            emitSparks(ux, uy, pal.amber, 16);
            emitCallout(ux, uy, `UFO +${pts}`, pal.amber);
            if (!reduced) s.shakeTimer = 0.14;
            reportAchievementEvent('arcade_invaders_milestone');
            hudDirty = true;
            continue;
          }

          // Check invader hit
          let hitInvader = false;
          for (const inv of s.invaders) {
            if (!inv.alive) continue;
            if (
              bolt.x + bolt.w / 2 >= inv.x &&
              bolt.x - bolt.w / 2 <= inv.x + inv.w &&
              bolt.y - bolt.h / 2 <= inv.y + inv.h &&
              bolt.y + bolt.h / 2 >= inv.y
            ) {
              inv.alive = false;
              s.destroyed += 1;
              addScore(inv.points);
              retroSynth.invaderHit();
              const color =
                inv.kind === 'squid' ? pal.amber : inv.kind === 'crab' ? pal.crimson : pal.phosphor;
              emitSparks(inv.x + inv.w / 2, inv.y + inv.h / 2, color, 9);
              if (!reduced) s.shakeTimer = Math.max(s.shakeTimer, 0.05);
              hitInvader = true;
              hudDirty = true;
              break;
            }
          }
          if (hitInvader) {
            s.bolts.splice(bi, 1);
            continue;
          }
        } else if (s.invulnTimer <= 0) {
          // Enemy bolt vs player turret
          if (
            bolt.x + bolt.w / 2 >= s.playerX - PLAYER_W / 2 &&
            bolt.x - bolt.w / 2 <= s.playerX + PLAYER_W / 2 &&
            bolt.y + bolt.h / 2 >= INVADERS_PLAYER_Y - PLAYER_H / 2 &&
            bolt.y - bolt.h / 2 <= INVADERS_PLAYER_Y + PLAYER_H / 2
          ) {
            s.bolts.splice(bi, 1);
            triggerPlayerHit();
            return;
          }
        }
      }

      // Check wave cleared
      if (s.invaders.every((inv) => !inv.alive)) {
        addScore(250 * s.wave);
        s.phase = 'WAVE_CLEAR';
        s.waveClearTimer = 1.65;
        s.bolts = [];
        retroSynth.stageClear();
        reportAchievementEvent('arcade_invaders_milestone');
        emitCallout(LOGICAL_W / 2, LOGICAL_H / 2 - 20, `WAVE ${s.wave} CLEARED`, pal.phosphor);
        syncHud();
        return;
      }

      if (hudDirty) syncHud();
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

      // Subtle CRT grid
      ctx.strokeStyle = pal.border;
      ctx.globalAlpha = 0.2;
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

      // Ground defense horizon line
      ctx.strokeStyle = pal.phosphorDim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, LOGICAL_H - 16);
      ctx.lineTo(LOGICAL_W - 16, LOGICAL_H - 16);
      ctx.stroke();

      // Mystery UFO
      if (s.ufo) {
        ctx.save();
        ctx.shadowColor = pal.amber;
        ctx.shadowBlur = 10;
        drawSprite(ctx, UFO_SPRITE, s.ufo.x, s.ufo.y, s.ufo.w, s.ufo.h, pal.amber);
        ctx.restore();
      }

      // Alien formation
      for (const inv of s.invaders) {
        if (!inv.alive) continue;
        const color =
          inv.kind === 'squid' ? pal.amber : inv.kind === 'crab' ? pal.crimson : pal.phosphor;
        const bitmap = INVADER_SPRITES[inv.kind][s.animFrame];
        drawSprite(ctx, bitmap, inv.x, inv.y, inv.w, inv.h, color);
      }

      // Destructible CRT bunkers
      ctx.fillStyle = pal.phosphor;
      ctx.globalAlpha = 0.85;
      for (const cell of s.bunkers) {
        if (!cell.alive) continue;
        ctx.fillRect(cell.x, cell.y, cell.size - 0.5, cell.size - 0.5);
      }
      ctx.globalAlpha = 1;

      // Player laser turret
      const blinkSkip = s.invulnTimer > 0 && Math.floor(s.invulnTimer * 14) % 2 === 0;
      if (!blinkSkip) {
        ctx.save();
        ctx.shadowColor = pal.phosphor;
        ctx.shadowBlur = 10;
        ctx.fillStyle = pal.text;
        ctx.fillRect(s.playerX - PLAYER_W / 2, INVADERS_PLAYER_Y - 2, PLAYER_W, 10);
        ctx.fillRect(s.playerX - 11, INVADERS_PLAYER_Y - 7, 22, 6);
        ctx.fillRect(s.playerX - 3, INVADERS_PLAYER_Y - 12, 6, 6);
        ctx.fillStyle = konamiBonusRef.current ? pal.amber : pal.phosphor;
        ctx.fillRect(s.playerX - 14, INVADERS_PLAYER_Y + 1, 28, 4);
        ctx.restore();
      }

      // Laser bolts
      for (const bolt of s.bolts) {
        ctx.save();
        ctx.fillStyle = bolt.fromPlayer ? pal.phosphor : pal.crimson;
        ctx.shadowColor = bolt.fromPlayer ? pal.phosphor : pal.crimson;
        ctx.shadowBlur = 8;
        ctx.fillRect(bolt.x - bolt.w / 2, bolt.y - bolt.h / 2, bolt.w, bolt.h);
        ctx.restore();
      }

      // Sparks
      for (const sp of s.sparks) {
        ctx.fillStyle = sp.color;
        ctx.globalAlpha = Math.max(0, sp.life / sp.maxLife);
        ctx.fillRect(sp.x - sp.size / 2, sp.y - sp.size / 2, sp.size, sp.size);
      }
      ctx.globalAlpha = 1;

      // Floating callouts
      for (const c of s.callouts) {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 1.4);
        ctx.font = '700 11px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.text, c.x, c.y);
      }
      ctx.globalAlpha = 1;

      // Wave clear banner
      if (s.phase === 'WAVE_CLEAR') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, LOGICAL_H / 2 - 42, LOGICAL_W, 84);
        ctx.strokeStyle = pal.phosphor;
        ctx.beginPath();
        ctx.moveTo(0, LOGICAL_H / 2 - 42);
        ctx.lineTo(LOGICAL_W, LOGICAL_H / 2 - 42);
        ctx.moveTo(0, LOGICAL_H / 2 + 42);
        ctx.lineTo(LOGICAL_W, LOGICAL_H / 2 + 42);
        ctx.stroke();

        ctx.fillStyle = pal.phosphor;
        ctx.font = '700 22px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`WAVE ${s.wave} CLEARED`, LOGICAL_W / 2, LOGICAL_H / 2 - 10);

        ctx.fillStyle = pal.text;
        ctx.font = '500 12px "IBM Plex Mono", monospace';
        ctx.fillText('RECHARGING BUNKERS · NEXT FLEET INCOMING', LOGICAL_W / 2, LOGICAL_H / 2 + 16);
      }

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
  }, [loadWave, syncHud]);

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
            Retro Invaders
          </h2>
          <span className="text-[11px] font-mono text-crt-muted border border-crt-border bg-crt-surface px-1.5 py-0.5 rounded-[3px] tabular-nums whitespace-nowrap">
            WAVE {String(hud.wave).padStart(2, '0')}
          </span>
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

          <div className="flex items-center gap-1" aria-label={`Lives remaining: ${hud.lives}`}>
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
                    <span>{konamiBonus ? 'Konami Mode · 5 Lives + Twin Pulse' : 'Cart 02 · Wave Shooter'}</span>
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.06em] text-crt-phosphor uppercase">
                    Retro Invaders
                  </h3>
                  <p className="text-xs text-crt-muted">
                    Hold the CRT phosphor bunkers against descending alien waves and snipe the Mystery UFO for bonus points.
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
                    Start Wave 1
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
                  ← → or A / D move · Space or ↑ fire · P pause · Esc close
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
                  <p className="text-xs font-mono text-crt-muted">Wave {hud.wave}</p>
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
                    <div className="text-[10px] uppercase text-crt-muted">Wave</div>
                    <div className="text-sm font-semibold text-crt-phosphor">{hud.wave}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-crt-muted">Invaders</div>
                    <div className="text-sm font-semibold text-crt-amber">{hud.destroyed}</div>
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
        <div className="flex sm:hidden items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onPointerDown={() => {
                simRef.current.keys.left = true;
              }}
              onPointerUp={() => {
                simRef.current.keys.left = false;
              }}
              onPointerLeave={() => {
                simRef.current.keys.left = false;
              }}
              aria-label="Move left"
              className="px-4 py-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg select-none touch-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={() => {
                simRef.current.keys.right = true;
              }}
              onPointerUp={() => {
                simRef.current.keys.right = false;
              }}
              onPointerLeave={() => {
                simRef.current.keys.right = false;
              }}
              aria-label="Move right"
              className="px-4 py-2.5 rounded border border-crt-border-strong bg-crt-surface text-crt-text active:bg-crt-phosphor active:text-crt-bg select-none touch-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onPointerDown={() => {
              if (simRef.current.phase !== 'PLAYING') {
                startNewGame();
              } else {
                simRef.current.keys.fire = true;
              }
            }}
            onPointerUp={() => {
              simRef.current.keys.fire = false;
            }}
            onPointerLeave={() => {
              simRef.current.keys.fire = false;
            }}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded border border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor font-display text-xs font-bold uppercase tracking-wider active:bg-crt-phosphor active:text-crt-bg select-none touch-none"
          >
            <Crosshair className="h-4 w-4" />
            Fire
          </button>
        </div>
      </div>
    </div>
  );
}
