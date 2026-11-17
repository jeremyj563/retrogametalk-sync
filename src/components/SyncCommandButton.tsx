import type { ButtonHTMLAttributes } from 'react';

export type SyncTriggerVisualMode =
  | 'incremental'
  | 'full'
  | 'dry_run'
  | 'stop'
  | 'stopping';

interface SyncCommandButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  mode: SyncTriggerVisualMode;
  label: string;
  armed?: boolean;
  compact?: boolean;
}

function SyncTriggerGlyph({ mode }: { mode: SyncTriggerVisualMode }) {
  if (mode === 'stop') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="crt-trigger-glyph h-3.5 w-3.5 shrink-0"
      >
        {/* Outer broadcast transport ring */}
        <circle
          cx="8"
          cy="8"
          r="6.25"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeOpacity="0.36"
        />
        {/* Live orbiting transport arc */}
        <circle
          cx="8"
          cy="8"
          r="6.25"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="11 29"
          className="crt-trigger-stop-orbit"
        />
        {/* Recessed tactile halt square */}
        <rect
          x="5.35"
          y="5.35"
          width="5.3"
          height="5.3"
          rx="1"
          fill="currentColor"
          className="crt-trigger-stop-core"
        />
      </svg>
    );
  }

  if (mode === 'stopping') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="crt-trigger-glyph h-3.5 w-3.5 shrink-0"
      >
        <circle
          cx="8"
          cy="8"
          r="6.25"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="3 2.5"
          className="crt-trigger-stopping-ring"
        />
        <rect
          x="5.6"
          y="5.6"
          width="4.8"
          height="4.8"
          rx="0.9"
          fill="currentColor"
          fillOpacity="0.85"
        />
      </svg>
    );
  }

  if (mode === 'dry_run') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="crt-trigger-glyph h-3.5 w-3.5 shrink-0"
      >
        {/* Diagnostic simulation flask body */}
        <path
          d="M6.2 2.5h3.6M6.8 2.5v3.1L3.5 11.4a1.4 1.4 0 0 0 1.22 2.1h6.56a1.4 1.4 0 0 0 1.22-2.1L9.2 5.6V2.5"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Simulation phosphor meniscus */}
        <path
          d="M4.65 10.55h6.7"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeOpacity="0.78"
        />
        {/* Rising simulation vapor nodes */}
        <circle
          cx="7.2"
          cy="11.9"
          r="0.75"
          fill="currentColor"
          className="crt-trigger-sim-bubble"
        />
        <circle
          cx="9.1"
          cy="9.2"
          r="0.65"
          fill="currentColor"
          className="crt-trigger-sim-bubble crt-trigger-sim-bubble-alt"
        />
      </svg>
    );
  }

  if (mode === 'full') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="crt-trigger-glyph h-3.5 w-3.5 shrink-0"
      >
        {/* Dual-stage high-throughput drive chevrons + primary engage wedge */}
        <path
          d="M2.6 3.7 6.3 8l-3.7 4.3"
          stroke="currentColor"
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="crt-trigger-lead-chevron"
        />
        <path
          d="M7.1 3.35 13.7 8l-6.6 4.65V3.35Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinejoin="round"
          className="crt-trigger-engage-core"
        />
      </svg>
    );
  }

  // Default: 'incremental'
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="crt-trigger-glyph h-3.5 w-3.5 shrink-0"
    >
      {/* Precision vertical index bar + illuminated phosphor engage vector */}
      <path
        d="M3.1 3.8v8.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.65"
        className="crt-trigger-index-bar"
      />
      <path
        d="M6.1 3.4 13.4 8l-7.3 4.6V3.4Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
        className="crt-trigger-engage-core"
      />
    </svg>
  );
}

export function SyncCommandButton({
  mode,
  label,
  armed = false,
  compact = false,
  className = '',
  disabled,
  ...rest
}: SyncCommandButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-trigger-mode={mode}
      data-trigger-armed={armed ? 'true' : 'false'}
      className={`crt-sync-trigger group relative inline-flex items-center justify-center gap-2 rounded-[5px] font-display text-xs font-semibold tracking-[0.03em] whitespace-nowrap shrink-0 select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        compact ? 'px-3.5 py-1.5' : 'w-full px-3.5 py-2'
      } ${className}`}
      {...rest}
    >
      {/* Top & bottom self-contained bezel electron rails */}
      <span aria-hidden="true" className="crt-sync-trigger-rail-top">
        <span />
      </span>
      <span aria-hidden="true" className="crt-sync-trigger-rail-bottom">
        <span />
      </span>

      {/* Corner hardware registration micro-brackets */}
      <span aria-hidden="true" className="crt-sync-trigger-corners" />

      {/* Recessed tally status lamp + vector glyph + crisp backlit label */}
      <SyncTriggerGlyph mode={mode} />
      <span className="crt-sync-trigger-label relative z-10">{label}</span>
    </button>
  );
}
