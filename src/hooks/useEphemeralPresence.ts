import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeRemainingAutoDismissMs,
  DEFAULT_EPHEMERAL_EXIT_MS,
  resolveEphemeralExitMs,
  type EphemeralPhase,
} from '../shared/ephemeralNotice';

export interface UseEphemeralPresenceOptions {
  /** Optional explicit key to force a fresh notice cycle even when message text repeats */
  noticeKey?: string | number;
  /** Exit animation duration in ms (default 440ms for block notices) */
  exitMs?: number;
  /** Optional auto-dismiss duration in ms; enables hover/focus pause & decay bar timing */
  autoDismissMs?: number | null;
  /** Invoked when the auto-dismiss timer expires (parent should clear value to null) */
  onAutoDismiss?: () => void;
}

export interface EphemeralPresenceResult<T> {
  /** Whether the element should remain mounted in the DOM */
  mounted: boolean;
  /** Current visual transition phase */
  phase: EphemeralPhase;
  /** Retained last non-null value so text stays visible while exiting */
  displayValue: T | null;
  /** True while hover/focus is pausing an active auto-dismiss timer */
  isPaused: boolean;
  /** Increments on each new notice cycle so CSS decay bars restart cleanly */
  generation: number;
  /** Spread onto the notice element to pause/resume auto-dismiss on hover/focus */
  pauseHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (e: React.FocusEvent<HTMLElement>) => void;
  };
}

function readMotionPrefs(): { prefersReducedMotion: boolean; crtMotionOff: boolean } {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { prefersReducedMotion: false, crtMotionOff: false };
  }
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const crtMotionOff = document.documentElement.getAttribute('data-crt-motion') === 'off';
  return { prefersReducedMotion, crtMotionOff };
}

/**
 * Retains outgoing ephemeral notice content across an animated CRT exit transition
 * and optionally drives a hover-pausable auto-dismiss timer.
 */
export function useEphemeralPresence<T>(
  value: T | null | undefined,
  options: UseEphemeralPresenceOptions = {},
): EphemeralPresenceResult<T> {
  const {
    noticeKey,
    exitMs = DEFAULT_EPHEMERAL_EXIT_MS,
    autoDismissMs = null,
    onAutoDismiss,
  } = options;

  const hasValue = value !== null && value !== undefined && value !== '';

  const [displayValue, setDisplayValue] = useState<T | null>(() => (hasValue ? (value as T) : null));
  const [phase, setPhase] = useState<EphemeralPhase>(() => (hasValue ? 'entering' : 'hidden'));
  const [isPaused, setIsPaused] = useState(false);
  const [generation, setGeneration] = useState(() => (hasValue ? 1 : 0));

  const phaseRef = useRef<EphemeralPhase>(phase);
  phaseRef.current = phase;

  const onAutoDismissRef = useRef(onAutoDismiss);
  onAutoDismissRef.current = onAutoDismiss;

  const exitTimerRef = useRef<number | null>(null);
  const raf1Ref = useRef<number | null>(null);
  const raf2Ref = useRef<number | null>(null);

  const autoDismissTimerRef = useRef<number | null>(null);
  const elapsedBeforePauseRef = useRef<number>(0);
  const resumedAtRef = useRef<number | null>(null);
  const hoveredRef = useRef<boolean>(false);
  const focusedRef = useRef<boolean>(false);

  const prevIdentityRef = useRef<{ value: T | null | undefined; key: string | number | undefined }>(
    { value: hasValue ? value : null, key: noticeKey },
  );

  const clearExitArtifacts = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (raf1Ref.current !== null) {
      window.cancelAnimationFrame(raf1Ref.current);
      raf1Ref.current = null;
    }
    if (raf2Ref.current !== null) {
      window.cancelAnimationFrame(raf2Ref.current);
      raf2Ref.current = null;
    }
  }, []);

  const clearAutoDismissTimer = useCallback(() => {
    if (autoDismissTimerRef.current !== null) {
      window.clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
  }, []);

  const scheduleAutoDismiss = useCallback(
    (remainingMs: number) => {
      clearAutoDismissTimer();
      if (remainingMs <= 0) {
        onAutoDismissRef.current?.();
        return;
      }
      resumedAtRef.current = Date.now();
      autoDismissTimerRef.current = window.setTimeout(() => {
        autoDismissTimerRef.current = null;
        resumedAtRef.current = null;
        onAutoDismissRef.current?.();
      }, remainingMs);
    },
    [clearAutoDismissTimer],
  );

  // Sync mount/enter/exit lifecycle with incoming value
  useLayoutEffect(() => {
    const prev = prevIdentityRef.current;
    const identityChanged = prev.value !== value || prev.key !== noticeKey;
    prevIdentityRef.current = { value, key: noticeKey };

    if (hasValue) {
      clearExitArtifacts();
      setDisplayValue(value as T);

      const currentPhase = phaseRef.current;
      if (currentPhase === 'hidden' || currentPhase === 'closing') {
        setPhase('entering');
        setGeneration((g) => g + 1);
        hoveredRef.current = false;
        focusedRef.current = false;
        setIsPaused(false);
        raf1Ref.current = window.requestAnimationFrame(() => {
          raf1Ref.current = null;
          raf2Ref.current = window.requestAnimationFrame(() => {
            raf2Ref.current = null;
            setPhase('open');
          });
        });
      } else if (currentPhase === 'entering') {
        // First mount with an already-truthy value: kick open on next animation frame
        raf1Ref.current = window.requestAnimationFrame(() => {
          raf1Ref.current = null;
          raf2Ref.current = window.requestAnimationFrame(() => {
            raf2Ref.current = null;
            setPhase('open');
          });
        });
      } else if (identityChanged) {
        // Replaced with a fresh message while already open — bump generation to reset decay timer
        setGeneration((g) => g + 1);
      }
      return;
    }

    // Value cleared -> transition smoothly to 'closing' while retaining displayValue
    clearAutoDismissTimer();
    hoveredRef.current = false;
    focusedRef.current = false;
    setIsPaused(false);

    if (phaseRef.current === 'hidden') {
      return;
    }

    if (phaseRef.current !== 'closing') {
      clearExitArtifacts();
      setPhase('closing');
      const effectiveExitMs = resolveEphemeralExitMs(exitMs, readMotionPrefs());
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        setPhase('hidden');
        setDisplayValue(null);
      }, effectiveExitMs);
    }
  }, [hasValue, value, noticeKey, exitMs, clearExitArtifacts, clearAutoDismissTimer]);

  // Manage optional hover-pausable auto-dismiss timer
  useEffect(() => {
    clearAutoDismissTimer();
    elapsedBeforePauseRef.current = 0;
    resumedAtRef.current = null;

    if (!hasValue || !autoDismissMs || autoDismissMs <= 0 || !onAutoDismissRef.current) {
      return;
    }

    if (hoveredRef.current || focusedRef.current) {
      setIsPaused(true);
      return;
    }

    setIsPaused(false);
    scheduleAutoDismiss(autoDismissMs);

    return () => {
      clearAutoDismissTimer();
    };
  }, [hasValue, autoDismissMs, generation, scheduleAutoDismiss, clearAutoDismissTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearExitArtifacts();
      clearAutoDismissTimer();
    };
  }, [clearExitArtifacts, clearAutoDismissTimer]);

  const updatePauseState = useCallback(() => {
    if (!hasValue || !autoDismissMs || autoDismissMs <= 0 || !onAutoDismissRef.current) {
      return;
    }
    const shouldPause = hoveredRef.current || focusedRef.current;
    if (shouldPause) {
      if (resumedAtRef.current !== null) {
        const remaining = computeRemainingAutoDismissMs({
          durationMs: autoDismissMs,
          elapsedBeforeResumeMs: elapsedBeforePauseRef.current,
          resumedAtMs: resumedAtRef.current,
          nowMs: Date.now(),
        });
        elapsedBeforePauseRef.current = Math.max(0, autoDismissMs - remaining);
        resumedAtRef.current = null;
      }
      clearAutoDismissTimer();
      setIsPaused(true);
    } else {
      const remaining = computeRemainingAutoDismissMs({
        durationMs: autoDismissMs,
        elapsedBeforeResumeMs: elapsedBeforePauseRef.current,
        resumedAtMs: null,
        nowMs: Date.now(),
      });
      setIsPaused(false);
      scheduleAutoDismiss(remaining);
    }
  }, [hasValue, autoDismissMs, clearAutoDismissTimer, scheduleAutoDismiss]);

  const onMouseEnter = useCallback(() => {
    hoveredRef.current = true;
    updatePauseState();
  }, [updatePauseState]);

  const onMouseLeave = useCallback(() => {
    hoveredRef.current = false;
    updatePauseState();
  }, [updatePauseState]);

  const onFocusCapture = useCallback(() => {
    focusedRef.current = true;
    updatePauseState();
  }, [updatePauseState]);

  const onBlurCapture = useCallback(
    (e: React.FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        focusedRef.current = false;
        updatePauseState();
      }
    },
    [updatePauseState],
  );

  return {
    mounted: phase !== 'hidden' && displayValue !== null,
    phase,
    displayValue,
    isPaused,
    generation,
    pauseHandlers: {
      onMouseEnter,
      onMouseLeave,
      onFocusCapture,
      onBlurCapture,
    },
  };
}
