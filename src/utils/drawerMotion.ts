export type DrawerPhase = 'closed' | 'entering' | 'open' | 'closing';

export type DrawerSwapDirection = 'none' | 'next' | 'prev';

export interface SwapDirectionInput {
  pendingDirection: DrawerSwapDirection;
  prevItemId: number | null;
  nextItemId: number | null;
  prevIndex: number | null;
  nextIndex: number | null;
  wasOpen: boolean;
}

/**
 * Resolves the directional crossfade vector when stepping between catalog items
 * inside an already-open GameDetailDrawer. Returns 'none' on initial drawer open
 * or same-item metadata updates so content never double-animates.
 */
export function resolveDrawerSwapDirection(input: SwapDirectionInput): DrawerSwapDirection {
  const { pendingDirection, prevItemId, nextItemId, prevIndex, nextIndex, wasOpen } = input;
  if (!wasOpen || prevItemId === null || nextItemId === null || prevItemId === nextItemId) {
    return 'none';
  }
  if (pendingDirection === 'next' || pendingDirection === 'prev') {
    return pendingDirection;
  }
  if (prevIndex !== null && nextIndex !== null && prevIndex !== nextIndex) {
    return nextIndex > prevIndex ? 'next' : 'prev';
  }
  return 'next';
}

/**
 * Returns the DOM unmount delay (in milliseconds) matching the CSS closing transition
 * for the active Living UI Motion tier and OS reduced-motion preference.
 */
export function getDrawerCloseDurationMs(
  motionTier: string | null | undefined,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return 110;
  }
  if (motionTier === 'off') {
    return 200;
  }
  return 290;
}
