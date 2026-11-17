import { useEffect, useState, type RefObject } from 'react';
import type { ConfigFocusRequest, ConfigSectionTarget } from '../types';

export function useSectionSpotlight(
  focusRequest: ConfigFocusRequest | null | undefined,
  refs: Partial<Record<ConfigSectionTarget, RefObject<HTMLElement | null>>>,
): ConfigFocusRequest | null {
  const [spotlight, setSpotlight] = useState<ConfigFocusRequest | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const targetRef = refs[focusRequest.target];
    const targetEl = targetRef?.current ?? null;
    if (!targetEl) return;

    setSpotlight(focusRequest);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const rafId = window.requestAnimationFrame(() => {
      const stickyHeader = document.querySelector('header');
      const headerHeight = stickyHeader ? stickyHeader.getBoundingClientRect().height : 68;
      const topOffset = headerHeight + 20;
      const elementTop = targetEl.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, elementTop - topOffset),
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    });

    const clearTimer = window.setTimeout(() => {
      setSpotlight((current) =>
        current && current.nonce === focusRequest.nonce ? null : current,
      );
    }, 2500);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(clearTimer);
    };
  }, [focusRequest, refs]);

  return spotlight;
}
