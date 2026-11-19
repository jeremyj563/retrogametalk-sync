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

/**
 * Returns the DOM unmount delay (in milliseconds) for the full-res lightbox
 * closing transition matching CSS timings for the active motion tier.
 */
export function getLightboxCloseDurationMs(
  motionTier: string | null | undefined,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return 100;
  }
  if (motionTier === 'off') {
    return 180;
  }
  return 260;
}

/**
 * Returns how long the outgoing ghost slide stays mounted during a Prev/Next
 * directional crossfade inside the full-res lightbox.
 */
export function getLightboxSlideDurationMs(
  motionTier: string | null | undefined,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return 110;
  }
  if (motionTier === 'off') {
    return 190;
  }
  return 300;
}

/**
 * Computes the wrapped target slide index for Prev/Next lightbox navigation.
 */
export function resolveLightboxSlideStep(
  currentIndex: number,
  totalSlides: number,
  direction: 'prev' | 'next',
): { nextIndex: number; changed: boolean } {
  if (totalSlides <= 1) {
    return { nextIndex: 0, changed: false };
  }
  const normalized = ((currentIndex % totalSlides) + totalSlides) % totalSlides;
  const nextIndex =
    direction === 'next'
      ? (normalized + 1) % totalSlides
      : (normalized - 1 + totalSlides) % totalSlides;
  return { nextIndex, changed: nextIndex !== normalized };
}
