import { useId } from 'react';

interface BrandMarkProps {
  isSyncRunning?: boolean;
  isDryRun?: boolean;
}

/**
 * Native CSS + inline-SVG Retro Hardware Header Banner (~50% larger desktop presence):
 * - Left: Sculpted 16-bit/arcade ROM cartridge (chamfered notch, side grip indents, recessed
 *   top insertion arrow, curved mini-CRT screen with phosphor grid + looping chevrons + glass
 *   glint + scanline beam, 7-pin stepped PCB edge bus with trailing chaser, and dual-ring LED).
 * - Right: Upper calibration horizon rail, brushed-phosphor RETROGAMETALK + backlit SYNC
 *   display lockup, and segmented VFD dual-beam telemetry bus track.
 * - Coupled in real time to CRT Palette (Green / Amber / Cyan), Gauss Glow, Living UI Motion
 *   tiers (Off / Low / Med / High / Ultra), and live Sync / Dry Run state.
 */
export function BrandMark({ isSyncRunning = false, isDryRun = false }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  const screenClipId = `crt-banner-screen-${uid}`;

  return (
    <span
      data-banner-dry-run={isDryRun ? 'true' : 'false'}
      data-banner-running={isSyncRunning ? 'true' : 'false'}
      className="crt-brand-banner inline-flex items-center gap-3 sm:gap-4 select-none shrink-0"
    >
      {/* Sculpted 16-Bit / Arcade ROM Cartridge Emblem (52x52 on sm+, +53% over 34x34) */}
      <svg
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="crt-banner-cartridge h-10 w-10 sm:h-[52px] sm:w-[52px] shrink-0"
      >
        <defs>
          <clipPath id={screenClipId}>
            <rect x="11.5" y="18" width="41" height="27.5" rx="3.2" />
          </clipPath>
        </defs>

        {/* Outer Cartridge Shell with Top-Left Chamfer Notch & Bottom PCB Skirt */}
        <path
          d="M11.5 3.5H54A6.5 6.5 0 0 1 60.5 10V49.5L57.5 52.5V56.5A4 4 0 0 1 53.5 60.5H10.5A4 4 0 0 1 6.5 56.5V52.5L3.5 49.5V11.5L11.5 3.5Z"
          fill="var(--color-crt-surface)"
          stroke="var(--color-crt-border-strong)"
          strokeWidth="2"
          strokeLinejoin="round"
          className="crt-banner-shell"
        />

        {/* Subtle Top Bevel Specular Highlight */}
        <path
          d="M12.3 5.5H53.5A4.5 4.5 0 0 1 58 10"
          stroke="var(--crt-banner-accent)"
          strokeOpacity="0.28"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Side Molded Grip Indents */}
        <g fill="var(--color-crt-bg)" opacity="0.85">
          <rect x="4.5" y="23" width="2.2" height="2.6" rx="0.6" />
          <rect x="4.5" y="28" width="2.2" height="2.6" rx="0.6" />
          <rect x="4.5" y="33" width="2.2" height="2.6" rx="0.6" />
          <rect x="57.3" y="23" width="2.2" height="2.6" rx="0.6" />
          <rect x="57.3" y="28" width="2.2" height="2.6" rx="0.6" />
          <rect x="57.3" y="33" width="2.2" height="2.6" rx="0.6" />
        </g>

        {/* Top Molded Cartridge Grip Ribs + Recessed Insertion Triangle */}
        <rect
          x="15"
          y="7.5"
          width="27"
          height="1.8"
          rx="0.9"
          fill="var(--color-crt-border-strong)"
          opacity="0.95"
        />
        <rect
          x="15"
          y="10.8"
          width="27"
          height="1.8"
          rx="0.9"
          fill="var(--color-crt-border-strong)"
          opacity="0.95"
        />
        <rect
          x="15"
          y="14.1"
          width="27"
          height="1.4"
          rx="0.7"
          fill="var(--color-crt-border)"
          opacity="0.9"
        />
        <path
          d="M49.5 7.6 52.7 12.6H46.3L49.5 7.6Z"
          fill="var(--crt-banner-accent)"
          fillOpacity="0.55"
          className="crt-banner-insert-arrow"
        />

        {/* Recessed Inner CRT Label Screen Bezel */}
        <rect
          x="10.5"
          y="17"
          width="43"
          height="29.5"
          rx="4.2"
          fill="var(--color-crt-bg)"
          stroke="var(--crt-banner-accent)"
          strokeOpacity="0.74"
          strokeWidth="1.65"
          className="crt-banner-screen-bezel"
        />

        <g clipPath={`url(#${screenClipId})`}>
          {/* Subtle Retro CRT Phosphor Calibration Grid */}
          <g
            stroke="var(--crt-banner-accent)"
            strokeWidth="0.65"
            className="crt-banner-screen-grid"
          >
            <line x1="11.5" y1="25" x2="52.5" y2="25" />
            <line x1="11.5" y1="31.75" x2="52.5" y2="31.75" />
            <line x1="11.5" y1="38.5" x2="52.5" y2="38.5" />
            <line x1="22" y1="18" x2="22" y2="45.5" />
            <line x1="32" y1="18" x2="32" y2="45.5" />
            <line x1="42" y1="18" x2="42" y2="45.5" />
          </g>

          {/* Seamless 14-unit Looping Sync Chevrons (>>>) */}
          <g
            fill="none"
            stroke="var(--crt-banner-accent)"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="crt-banner-chevrons"
          >
            <polyline points="-3,25.5 3.5,31.75 -3,38" opacity="0.5" />
            <polyline points="11,25.5 17.5,31.75 11,38" opacity="0.86" />
            <polyline points="25,25.5 31.5,31.75 25,38" opacity="1" />
            <polyline points="39,25.5 45.5,31.75 39,38" opacity="0.82" />
            <polyline points="53,25.5 59.5,31.75 53,38" opacity="0.5" />
          </g>

          {/* Vertical CRT Scanline Beam */}
          <rect
            x="11.5"
            y="18"
            width="41"
            height="2.6"
            fill="var(--crt-banner-accent)"
            className="crt-banner-scanline"
          />

          {/* Curved Trinitron Glass Corner Glint */}
          <path
            d="M14 20.5H21.5M14 20.5V25"
            stroke="#ffffff"
            strokeOpacity="0.24"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </g>

        {/* Recessed Bottom PCB Edge Connector Shroud + 7-Pin ROM Bus + Dual Chasers */}
        <rect
          x="10.5"
          y="50.2"
          width="35"
          height="7.4"
          rx="1.5"
          fill="var(--color-crt-bg)"
          stroke="var(--color-crt-border)"
          strokeWidth="1"
        />
        <g fill="var(--color-crt-border-strong)">
          <rect x="12.5" y="51.7" width="3.2" height="4.4" rx="0.55" />
          <rect x="17.3" y="51.7" width="3.2" height="4.4" rx="0.55" />
          <rect x="22.1" y="51.7" width="3.2" height="4.4" rx="0.55" />
          <rect x="26.9" y="51.7" width="3.2" height="4.4" rx="0.55" />
          <rect x="31.7" y="51.7" width="3.2" height="4.4" rx="0.55" />
          <rect x="36.5" y="51.7" width="3.2" height="4.4" rx="0.55" />
          <rect x="41.3" y="51.7" width="3.2" height="4.4" rx="0.55" />
        </g>

        {/* Trailing Phosphor Decay Pin Chaser (Med / High / Ultra) */}
        <rect
          x="12.5"
          y="51.7"
          width="3.2"
          height="4.4"
          rx="0.55"
          fill="var(--crt-banner-accent)"
          className="crt-banner-pin-tail"
        />

        {/* Primary Stepped Active ROM Address Pin */}
        <rect
          x="12.5"
          y="51.7"
          width="3.2"
          height="4.4"
          rx="0.55"
          fill="var(--crt-banner-accent)"
          className="crt-banner-pin-runner"
        />

        {/* Dual-Ring Power / Sync Activity LED */}
        <circle
          cx="51.8"
          cy="53.9"
          r="4.1"
          fill="var(--color-crt-bg)"
          stroke="var(--color-crt-border-strong)"
          strokeWidth="1"
        />
        <circle
          cx="51.8"
          cy="53.9"
          r="2.5"
          fill="var(--crt-banner-accent)"
          className="crt-banner-led"
        />
        <circle cx="51.1" cy="53.1" r="0.7" fill="#ffffff" fillOpacity="0.65" />
      </svg>

      {/* Sculpted Wordmark Stack (~50% Larger Width & Height) */}
      <span className="flex flex-col justify-between gap-1 sm:gap-1.5 min-w-0 py-0.5">
        {/* Upper Calibration Horizon Rail */}
        <span aria-hidden="true" className="crt-banner-horizon">
          <span className="crt-banner-horizon-beam" />
        </span>

        {/* RETROGAMETALK SYNC Display Wordmark */}
        <span className="crt-banner-wordmark font-display text-[17px] sm:text-[22px] lg:text-[23px] font-bold tracking-[0.06em] leading-none uppercase inline-flex items-baseline gap-2 whitespace-nowrap">
          <span className="crt-banner-title-word">RETROGAMETALK</span>
          <span className="crt-banner-sync-word">SYNC</span>
        </span>

        {/* Segmented VFD / CRT Dual-Beam Telemetry Bus */}
        <span aria-hidden="true" className="crt-banner-track">
          <span className="crt-banner-track-beam" />
          <span className="crt-banner-track-return" />
          <span className="crt-banner-track-segments" />
        </span>
      </span>
    </span>
  );
}
