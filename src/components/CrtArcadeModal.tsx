import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../utils/arcadeGames';
import {
  type ArcadeCartridgeId,
  type ArcadeLaunchTarget,
  loadAllArcadeHighScores,
} from '../utils/easterEggs';
import { retroSynth } from '../utils/retroSynth';
import { ArcadeMultiCartLauncher } from './arcade/ArcadeMultiCartLauncher';
import { CartridgeBreakoutGame } from './arcade/CartridgeBreakoutGame';
import { PhosphorSnakeGame } from './arcade/PhosphorSnakeGame';
import { RetroInvadersGame } from './arcade/RetroInvadersGame';
import { TetrominoDropGame } from './arcade/TetrominoDropGame';

export interface CrtArcadeModalProps {
  open: boolean;
  initialTarget: ArcadeLaunchTarget;
  konamiBonus: boolean;
  consoleLabels: string[];
  onClose: () => void;
}

type ModalTransitionPhase = 'entering' | 'open' | 'closing';

export function CrtArcadeModal({
  open,
  initialTarget,
  konamiBonus,
  consoleLabels,
  onClose,
}: CrtArcadeModalProps) {
  const [rendered, setRendered] = useState(open);
  const [modalPhase, setModalPhase] = useState<ModalTransitionPhase>(open ? 'entering' : 'closing');
  const [activeView, setActiveView] = useState<ArcadeLaunchTarget>(initialTarget);
  const [muted, setMuted] = useState<boolean>(() => retroSynth.isMuted());
  const [highScores, setHighScores] = useState<Record<ArcadeCartridgeId, number>>(() =>
    loadAllArcadeHighScores(),
  );

  const modalPhaseRef = useRef<ModalTransitionPhase>(modalPhase);
  modalPhaseRef.current = modalPhase;
  const openRaf1Ref = useRef<number | null>(null);
  const openRaf2Ref = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

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
      setActiveView(initialTarget);
      setHighScores(loadAllArcadeHighScores());
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
  }, [open, initialTarget, rendered, clearCloseTimer, clearOpenRafs]);

  useEffect(() => {
    return () => {
      clearOpenRafs();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenRafs]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      retroSynth.setMuted(next);
      if (!next) retroSynth.menuSelect();
      return next;
    });
  }, []);

  const handleSwitchToLauncher = useCallback(() => {
    setHighScores(loadAllArcadeHighScores());
    retroSynth.menuSelect();
    setActiveView('launcher');
  }, []);

  const handleHighScoreUpdate = useCallback((cartId: ArcadeCartridgeId, score: number) => {
    setHighScores((prev) => ({
      ...prev,
      [cartId]: Math.max(prev[cartId] ?? 0, score),
    }));
  }, []);

  if (!rendered) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="crt-arcade-title"
      data-arcade-state={modalPhase}
      onClick={onClose}
      className="crt-arcade-backdrop fixed inset-0 z-[75] bg-black/80 backdrop-blur-[3px] flex items-center justify-center p-3 sm:p-5"
    >
      <div
        data-arcade-state={modalPhase}
        onClick={(e) => e.stopPropagation()}
        className="crt-arcade-cabinet w-full max-w-[760px] border border-crt-border-strong bg-crt-surface rounded-md shadow-[0_24px_64px_-16px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col"
      >
        {activeView === 'launcher' && (
          <ArcadeMultiCartLauncher
            konamiBonus={konamiBonus}
            muted={muted}
            highScores={highScores}
            onToggleMute={toggleMute}
            onSelectCartridge={(cartId) => setActiveView(cartId)}
            onClose={onClose}
          />
        )}

        {activeView === 'breakout' && (
          <CartridgeBreakoutGame
            konamiBonus={konamiBonus}
            consoleLabels={consoleLabels}
            muted={muted}
            onToggleMute={toggleMute}
            onSwitchCart={handleSwitchToLauncher}
            onClose={onClose}
            onHighScoreChange={(score) => handleHighScoreUpdate('breakout', score)}
          />
        )}

        {activeView === 'invaders' && (
          <RetroInvadersGame
            konamiBonus={konamiBonus}
            muted={muted}
            onToggleMute={toggleMute}
            onSwitchCart={handleSwitchToLauncher}
            onClose={onClose}
            onHighScoreChange={(score) => handleHighScoreUpdate('invaders', score)}
          />
        )}

        {activeView === 'snake' && (
          <PhosphorSnakeGame
            konamiBonus={konamiBonus}
            muted={muted}
            onToggleMute={toggleMute}
            onSwitchCart={handleSwitchToLauncher}
            onClose={onClose}
            onHighScoreChange={(score) => handleHighScoreUpdate('snake', score)}
          />
        )}

        {activeView === 'tetromino' && (
          <TetrominoDropGame
            konamiBonus={konamiBonus}
            muted={muted}
            onToggleMute={toggleMute}
            onSwitchCart={handleSwitchToLauncher}
            onClose={onClose}
            onHighScoreChange={(score) => handleHighScoreUpdate('tetromino', score)}
          />
        )}
      </div>
    </div>
  );
}
