import { useId } from 'react';

interface BrandMarkProps {
  isSyncRunning?: boolean;
  isDryRun?: boolean;
}

/**
 * Native CSS + inline-SVG CRT Header Banner replacing the static "RetroGameTalk Sync" title:
 * - Left: Retro cartridge hardware emblem with clipped looping sync chevrons, vertical CRT
 *   scanline sweep, 5-pin discrete stepped edge bus, and corner status LED.
 * - Right: Subpixel-crisp RETROGAMETALK SYNC wordmark underscored by a full-width luminous
 *   telemetry sweep track.
 * - Coupled in real time to CRT Palette (Green / Amber / Cyan), Gauss Glow, Living UI Motion
 *   presets (Off / Low / Med / High), and live Sync / Dry Run state.
 */
export function BrandMark({ isSyncRunning = false, isDryRun = false }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  const screenClipId = `crt-banner-screen-${uid}`;

  return (
    <span
      data-banner-dry-run={isDryRun ? 'true' : 'false'}
      data-banner-running={isSyncRunning ? 'true' : 'false'}
      className="crt-brand-banner inline-flex items-center gap-2.5 sm:gap-3 select-none shrink-0"
    >
      {/* Retro Cartridge Hardware Emblem */}
      <svg
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="crt-banner-cartridge h-8 w-8 sm:h-[34px] sm:w-[34px] shrink-0"
      >
        <defs>
          <clipPath id={screenClipId}>
            <rect x="12" y="18.5" width="40" height="27" rx="3" />
          </clipPath>
        </defs>

        {/* Outer Cartridge Casing */}
        <rect
          x="4"
          y="4"
          width="56"
          height="56"
          rx="8.5"
          fill="var(--color-crt-surface)"
          stroke="var(--color-crt-border-strong)"
          strokeWidth="2.2"
        />

        {/* Top Molded Cartridge Grip Grooves */}
        <rect
          x="16"
          y="8.5"
          width="32"
          height="2"
          rx="1"
          fill="var(--color-crt-border-strong)"
          opacity="0.9"
        />
        <rect
          x="16"
          y="12.5"
          width="32"
          height="2"
          rx="1"
          fill="var(--color-crt-border-strong)"
          opacity="0.9"
        />

        {/* Recessed Inner CRT Label Screen */}
        <rect
          x="11"
          y="17.5"
          width="42"
          height="29"
          rx="4"
          fill="var(--color-crt-bg)"
          stroke="var(--crt-banner-accent)"
          strokeOpacity="0.68"
          strokeWidth="1.6"
        />

        <g clipPath={`url(#${screenClipId})`}>
          {/* Seamless 14-unit Looping Sync Chevrons (>>>) */}
          <g
            fill="none"
            stroke="var(--crt-banner-accent)"
            strokeWidth="2.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="crt-banner-chevrons"
          >
            <polyline points="-3,26.5 3,32 -3,37.5" opacity="0.55" />
            <polyline points="11,26.5 17,32 11,37.5" opacity="0.88" />
            <polyline points="25,26.5 31,32 25,37.5" opacity="1" />
            <polyline points="39,26.5 45,32 39,37.5" opacity="0.76" />
            <polyline points="53,26.5 59,32 53,37.5" opacity="0.55" />
          </g>

          {/* Vertical CRT Scanline Beam */}
          <rect
            x="12"
            y="18.5"
            width="40"
            height="2.2"
            fill="var(--crt-banner-accent)"
            className="crt-banner-scanline"
          />
        </g>

        {/* 5-Pin Bottom Edge Connector Bus + Stepped Active Pin + Corner LED */}
        <g fill="var(--color-crt-border-strong)">
          <rect x="13" y="52.5" width="4.2" height="3.5" rx="0.6" />
          <rect x="20" y="52.5" width="4.2" height="3.5" rx="0.6" />
          <rect x="27" y="52.5" width="4.2" height="3.5" rx="0.6" />
          <rect x="34" y="52.5" width="4.2" height="3.5" rx="0.6" />
          <rect x="41" y="52.5" width="4.2" height="3.5" rx="0.6" />
        </g>
        <rect
          x="13"
          y="52.5"
          width="4.2"
          height="3.5"
          rx="0.6"
          fill="var(--crt-banner-accent)"
          className="crt-banner-pin-runner"
        />
        <circle
          cx="51.5"
          cy="54.2"
          r="2.55"
          fill="var(--crt-banner-accent)"
          className="crt-banner-led"
        />
      </svg>

      {/* Wordmark + Full-Width Telemetry Sweep Track */}
      <span className="flex flex-col justify-center gap-1.5 min-w-0">
        <span className="font-mono text-[13px] sm:text-[15px] font-extrabold tracking-[0.04em] leading-none uppercase inline-flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-crt-text">RETROGAMETALK</span>
          <span className="crt-banner-sync-word">SYNC</span>
        </span>
        <span aria-hidden="true" className="crt-banner-track">
          <span className="crt-banner-track-beam" />
        </span>
      </span>
    </span>
  );
}
