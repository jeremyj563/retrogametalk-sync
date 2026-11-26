export type EphemeralPhase = 'hidden' | 'entering' | 'open' | 'closing';

export type EphemeralTone = 'phosphor' | 'amber' | 'crimson';

export const DEFAULT_EPHEMERAL_EXIT_MS = 440;
export const DEFAULT_INLINE_EXIT_MS = 360;
export const DEFAULT_TOAST_EXIT_MS = 340;
export const REDUCED_MOTION_EXIT_MS = 140;

/**
 * Computes how many milliseconds remain on a pausable auto-dismiss timer.
 * Pure helper so pause/resume math can be verified deterministically.
 */
export function computeRemainingAutoDismissMs(params: {
  durationMs: number;
  elapsedBeforeResumeMs: number;
  resumedAtMs: number | null;
  nowMs: number;
}): number {
  const safeDuration = Math.max(0, params.durationMs);
  const priorElapsed = Math.max(0, params.elapsedBeforeResumeMs);
  const activeElapsed =
    params.resumedAtMs === null ? 0 : Math.max(0, params.nowMs - params.resumedAtMs);
  return Math.max(0, safeDuration - priorElapsed - activeElapsed);
}

/**
 * Resolves the appropriate exit transition duration based on accessibility and
 * CRT Living UI Motion preferences.
 */
export function resolveEphemeralExitMs(
  baseExitMs: number,
  options: { prefersReducedMotion: boolean; crtMotionOff?: boolean },
): number {
  if (options.prefersReducedMotion) {
    return Math.min(baseExitMs, REDUCED_MOTION_EXIT_MS);
  }
  if (options.crtMotionOff) {
    return Math.min(baseExitMs, 260);
  }
  return baseExitMs;
}
