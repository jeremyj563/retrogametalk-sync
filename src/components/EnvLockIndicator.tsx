import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';

interface EnvLockIndicatorProps {
  envVar: string;
  detail?: string;
}

interface TooltipCoords {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

const TOOLTIP_WIDTH_PX = 288;
const VIEWPORT_MARGIN_PX = 12;

export function EnvLockIndicator({ envVar, detail }: EnvLockIndicatorProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);

  const description =
    detail ||
    `Loaded from the ${envVar} environment variable. This field is read-only in the UI — update or unset ${envVar} in your .env, Compose, or Helm configuration to change it.`;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const placement: 'top' | 'bottom' = rect.top < 120 ? 'bottom' : 'top';
    const preferredLeft = rect.right - TOOLTIP_WIDTH_PX;
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - TOOLTIP_WIDTH_PX - VIEWPORT_MARGIN_PX);
    const left = Math.min(Math.max(VIEWPORT_MARGIN_PX, preferredLeft), maxLeft);
    const top = placement === 'top' ? rect.top - 8 : rect.bottom + 8;
    setCoords({ left, top, placement });
  }, []);

  const handleOpen = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, updatePosition]);

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-crt-amber/10 border border-crt-amber/25 text-[10.5px] font-mono text-crt-amber/90 hover:text-crt-amber hover:border-crt-amber/50 hover:bg-crt-amber/15 transition-colors whitespace-nowrap shrink-0 cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-crt-amber"
      >
        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{envVar}</span>
      </span>

      {open &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              width: `${TOOLTIP_WIDTH_PX}px`,
              transform: coords.placement === 'top' ? 'translateY(-100%)' : undefined,
            }}
            className="pointer-events-none fixed z-[90] rounded-md border border-crt-amber/40 bg-crt-surface/98 px-3 py-2.5 shadow-2xl backdrop-blur-md space-y-1"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-crt-amber">
              <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">Locked by {envVar}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-crt-text/90 font-sans">
              {description}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
