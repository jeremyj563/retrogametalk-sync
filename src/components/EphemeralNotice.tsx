import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEphemeralPresence } from '../hooks/useEphemeralPresence';
import {
  DEFAULT_EPHEMERAL_EXIT_MS,
  DEFAULT_INLINE_EXIT_MS,
  DEFAULT_TOAST_EXIT_MS,
  type EphemeralTone,
} from '../shared/ephemeralNotice';

export interface EphemeralNoticeProps {
  /** Notice message; transitioning from string -> null triggers the CRT dissolve & collapse exit */
  message: string | null | undefined;
  /** Optional key to restart the notice lifecycle when identical text is re-triggered */
  noticeKey?: string | number;
  /** Semantic phosphor palette tone */
  tone?: EphemeralTone;
  /** Visual density: bordered banner (default) or borderless compact text line */
  variant?: 'banner' | 'compact' | 'strip';
  /** Auto-dismiss delay in ms (enables subtle bottom phosphor decay hairline + hover pause) */
  autoDismissMs?: number | null;
  /** Called on auto-dismiss timeout or manual Dismiss click */
  onDismiss?: () => void;
  /** Control how the dismiss affordance is rendered (default: 'text' for banner, 'none' for compact) */
  dismissStyle?: 'text' | 'icon' | 'none';
  /** Accessible label for icon dismiss button */
  dismissAriaLabel?: string;
  /** Optional leading icon element */
  icon?: ReactNode;
  /** Optional class applied to the outer collapse wrapper (e.g. mb-5) */
  className?: string;
  /** Optional class merged onto the inner notice surface */
  surfaceClassName?: string;
  /** Override ARIA role (defaults to 'alert' for crimson, 'status' otherwise) */
  role?: 'status' | 'alert';
}

const BANNER_TONE_CLASSES: Record<EphemeralTone, string> = {
  phosphor: 'border border-crt-phosphor/45 bg-crt-phosphor/8 text-crt-phosphor',
  amber: 'border border-crt-amber/50 bg-crt-amber/10 text-crt-amber',
  crimson: 'border border-crt-crimson/45 bg-crt-crimson/10 text-crt-text',
};

const STRIP_TONE_CLASSES: Record<EphemeralTone, string> = {
  phosphor: 'border-t border-crt-phosphor/35 bg-crt-phosphor/8 text-crt-phosphor',
  amber: 'border-t border-crt-amber/40 bg-crt-amber/10 text-crt-amber',
  crimson: 'border-t border-crt-crimson/40 bg-crt-crimson/10 text-crt-crimson',
};

const COMPACT_TONE_CLASSES: Record<EphemeralTone, string> = {
  phosphor: 'text-crt-phosphor',
  amber: 'text-crt-amber',
  crimson: 'text-crt-crimson',
};

/**
 * Block-level ephemeral notice with smooth CRT phosphor afterglow dissolve,
 * hover-pausable bottom decay hairline, and zero-jump height collapse.
 */
export function EphemeralNotice({
  message,
  noticeKey,
  tone = 'phosphor',
  variant = 'banner',
  autoDismissMs = null,
  onDismiss,
  dismissStyle,
  dismissAriaLabel = 'Dismiss notice',
  icon,
  className = '',
  surfaceClassName = '',
  role,
}: EphemeralNoticeProps) {
  const { mounted, phase, displayValue, isPaused, generation, pauseHandlers } =
    useEphemeralPresence(message, {
      noticeKey,
      exitMs: DEFAULT_EPHEMERAL_EXIT_MS,
      autoDismissMs,
      onAutoDismiss: onDismiss,
    });

  if (!mounted || !displayValue) return null;

  const resolvedDismissStyle =
    dismissStyle ?? (variant === 'compact' ? 'none' : onDismiss ? 'text' : 'none');
  const resolvedRole = role ?? (tone === 'crimson' ? 'alert' : 'status');
  const showDecayBar =
    variant !== 'compact' && Boolean(autoDismissMs && autoDismissMs > 0) && phase !== 'closing';
  const isClosing = phase === 'closing';

  const decayStyle = showDecayBar
    ? ({ '--crt-ephemeral-duration': `${autoDismissMs}ms` } as CSSProperties)
    : undefined;

  return (
    <div
      data-ephemeral-state={phase}
      className={`crt-ephemeral-collapse ${className}`.trim()}
    >
      <div className="crt-ephemeral-collapse-inner">
        <div
          role={resolvedRole}
          aria-live={resolvedRole === 'alert' ? 'assertive' : 'polite'}
          data-ephemeral-state={phase}
          data-ephemeral-tone={tone}
          {...pauseHandlers}
          className={
            variant === 'compact'
              ? `crt-ephemeral-surface crt-ephemeral-surface-compact text-xs font-mono ${COMPACT_TONE_CLASSES[tone]} ${surfaceClassName}`.trim()
              : variant === 'strip'
                ? `crt-ephemeral-surface relative overflow-hidden px-6 py-2 flex items-center justify-between gap-2 text-xs font-mono ${STRIP_TONE_CLASSES[tone]} ${surfaceClassName}`.trim()
                : `crt-ephemeral-surface relative overflow-hidden rounded px-3 py-2 text-xs font-mono flex items-center justify-between gap-3 ${BANNER_TONE_CLASSES[tone]} ${surfaceClassName}`.trim()
          }
        >
          {variant === 'compact' ? (
            <span>{displayValue}</span>
          ) : (
            <>
              <span className="inline-flex items-start gap-2 min-w-0">
                {icon ? <span className="shrink-0 mt-0.5">{icon}</span> : null}
                <span className="min-w-0 break-words">{displayValue}</span>
              </span>
              {onDismiss && resolvedDismissStyle === 'text' && (
                <button
                  type="button"
                  disabled={isClosing}
                  onClick={onDismiss}
                  className="text-crt-muted hover:text-crt-text shrink-0 cursor-pointer transition-colors disabled:pointer-events-none"
                >
                  Dismiss
                </button>
              )}
              {onDismiss && resolvedDismissStyle === 'icon' && (
                <button
                  type="button"
                  disabled={isClosing}
                  onClick={onDismiss}
                  aria-label={dismissAriaLabel}
                  className="p-0.5 text-crt-muted hover:text-crt-text shrink-0 cursor-pointer transition-colors disabled:pointer-events-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}

          {showDecayBar && (
            <span
              key={generation}
              aria-hidden="true"
              data-paused={isPaused ? 'true' : 'false'}
              style={decayStyle}
              className="crt-ephemeral-decay-bar"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export interface EphemeralInlineNoticeProps {
  message: string | null | undefined;
  noticeKey?: string | number;
  tone?: EphemeralTone;
  autoDismissMs?: number | null;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Inline ephemeral confirmation label (e.g. "Cutoff updated") with smooth CRT
 * phosphor fade-out instead of abrupt unmounting.
 */
export function EphemeralInlineNotice({
  message,
  noticeKey,
  tone = 'phosphor',
  autoDismissMs = null,
  onDismiss,
  className = '',
}: EphemeralInlineNoticeProps) {
  const { mounted, phase, displayValue, pauseHandlers } = useEphemeralPresence(message, {
    noticeKey,
    exitMs: DEFAULT_INLINE_EXIT_MS,
    autoDismissMs,
    onAutoDismiss: onDismiss,
  });

  if (!mounted || !displayValue) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      data-ephemeral-state={phase}
      data-ephemeral-tone={tone}
      {...pauseHandlers}
      className={`crt-ephemeral-inline whitespace-nowrap shrink-0 ${COMPACT_TONE_CLASSES[tone]} ${className}`.trim()}
    >
      {displayValue}
    </span>
  );
}

export interface EphemeralFloatingToastProps {
  message: string | null | undefined;
  noticeKey?: string | number;
  tone?: EphemeralTone;
  autoDismissMs?: number | null;
  onDismiss?: () => void;
  dismissStyle?: 'text' | 'icon' | 'none';
  icon?: ReactNode;
  className?: string;
  pointerEventsNone?: boolean;
}

/**
 * Fixed bottom-right floating ephemeral toast with smooth slide & CRT phosphor dissolve.
 */
export function EphemeralFloatingToast({
  message,
  noticeKey,
  tone = 'phosphor',
  autoDismissMs = null,
  onDismiss,
  dismissStyle,
  icon,
  className = '',
  pointerEventsNone = false,
}: EphemeralFloatingToastProps) {
  const { mounted, phase, displayValue, isPaused, generation, pauseHandlers } =
    useEphemeralPresence(message, {
      noticeKey,
      exitMs: DEFAULT_TOAST_EXIT_MS,
      autoDismissMs,
      onAutoDismiss: onDismiss,
    });

  if (!mounted || !displayValue) return null;

  const resolvedDismissStyle = dismissStyle ?? (onDismiss ? 'text' : 'none');
  const showDecayBar = Boolean(autoDismissMs && autoDismissMs > 0) && phase !== 'closing';
  const isClosing = phase === 'closing';
  const decayStyle = showDecayBar
    ? ({ '--crt-ephemeral-duration': `${autoDismissMs}ms` } as CSSProperties)
    : undefined;

  const toneStyle: Record<EphemeralTone, string> = {
    phosphor: 'border-crt-phosphor/60 bg-crt-surface/95 text-crt-phosphor',
    amber: 'border-crt-amber/60 bg-crt-surface/95 text-crt-amber',
    crimson: 'border-crt-crimson/60 bg-crt-surface/95 text-crt-crimson',
  };

  return (
    <div
      role={tone === 'crimson' ? 'alert' : 'status'}
      aria-live={tone === 'crimson' ? 'assertive' : 'polite'}
      data-ephemeral-state={phase}
      data-ephemeral-tone={tone}
      {...(pointerEventsNone ? {} : pauseHandlers)}
      className={`crt-ephemeral-toast fixed bottom-5 right-5 z-[72] max-w-md overflow-hidden border backdrop-blur px-3.5 py-2.5 rounded-[5px] shadow-2xl text-xs font-mono flex items-center justify-between gap-3 ${toneStyle[tone]} ${pointerEventsNone ? 'pointer-events-none' : ''} ${className}`.trim()}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        {icon}
        <span className="min-w-0 break-words">{displayValue}</span>
      </span>
      {onDismiss && resolvedDismissStyle === 'text' && (
        <button
          type="button"
          disabled={isClosing}
          onClick={onDismiss}
          className="text-crt-muted hover:text-crt-text shrink-0 cursor-pointer transition-colors disabled:pointer-events-none"
        >
          Dismiss
        </button>
      )}
      {onDismiss && resolvedDismissStyle === 'icon' && (
        <button
          type="button"
          disabled={isClosing}
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="p-0.5 text-crt-muted hover:text-crt-text shrink-0 cursor-pointer transition-colors disabled:pointer-events-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {showDecayBar && (
        <span
          key={generation}
          aria-hidden="true"
          data-paused={isPaused ? 'true' : 'false'}
          style={decayStyle}
          className="crt-ephemeral-decay-bar"
        />
      )}
    </div>
  );
}
