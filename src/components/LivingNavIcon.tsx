import { useId } from 'react';
import type { NavSection } from '../types';

interface LivingNavIconProps {
  section: NavSection;
  className?: string;
}

/**
 * Custom 16x16 hardware-CRT kinetic icons for primary navigation:
 * - Sync (monitor): Traveling oscilloscope ECG phosphor pulse sweeping left-to-right
 * - Catalog (catalog): Vertically scrolling 2-level directory tree inside a masked window
 * - Schedule (schedule): Precision chronometer with sweeping minute hand & cardinal ticks
 * - Operations (operations): Machined 8-tooth servo cog assembly with breathing optical core
 */
export function LivingNavIcon({ section, className = 'h-4 w-4 shrink-0' }: LivingNavIconProps) {
  const uid = useId();
  const clipId = `crt-nav-clip-${section}-${uid.replace(/:/g, '')}`;

  if (section === 'monitor') {
    const ecgPath = 'M 0.75 8.5 H 3.7 L 5.35 3.1 L 7.65 13.1 L 9.55 5.4 L 11.0 8.5 H 15.25';
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className={`${className} crt-living-icon crt-living-icon-sync overflow-hidden`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0.5" y="0.5" width="15" height="15" rx="1.5" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Base oscilloscope trace */}
          <path
            d={ecgPath}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="crt-svg-sync-base"
          />
          {/* Traveling phosphor electron beam */}
          <path
            d={ecgPath}
            pathLength={100}
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="crt-svg-sync-beam"
          />
        </g>
      </svg>
    );
  }

  if (section === 'catalog') {
    // Seamless 12px vertical period (two stacked cycles inside a 13px tall window)
    const renderTreeCycle = (offsetY: number) => (
      <g key={offsetY} transform={`translate(0, ${offsetY})`}>
        {/* Row 1: Root folder branch */}
        <path
          d="M 3.2 3 H 5.6"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <rect
          x="6.2"
          y="1.65"
          width="7.4"
          height="2.6"
          rx="0.65"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        {/* Row 2: Indented ROM entry */}
        <path
          d="M 3.2 7 H 6.8"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <rect
          x="7.5"
          y="5.75"
          width="6.1"
          height="2.4"
          rx="0.6"
          fill="currentColor"
          fillOpacity="0.82"
        />
        {/* Row 3: Subdirectory branch */}
        <path
          d="M 3.2 11 H 5.6"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <rect
          x="6.2"
          y="9.75"
          width="5.6"
          height="2.45"
          rx="0.65"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </g>
    );

    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className={`${className} crt-living-icon crt-living-icon-catalog overflow-hidden`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="1" y="1.4" width="14" height="13.2" rx="1" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Vertical directory spine */}
          <line
            x1="3.2"
            y1="1.2"
            x2="3.2"
            y2="14.8"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeOpacity="0.72"
          />
          {/* Scrolling directory nodes */}
          <g className="crt-svg-tree-scroll">
            {renderTreeCycle(0)}
            {renderTreeCycle(12)}
          </g>
        </g>
      </svg>
    );
  }

  if (section === 'schedule') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className={`${className} crt-living-icon crt-living-icon-schedule`}
      >
        {/* Outer dial */}
        <circle cx="8" cy="8" r="6.35" stroke="currentColor" strokeWidth="1.4" />
        {/* Cardinal dial ticks */}
        <path
          d="M 8 2.55 V 3.35 M 13.45 8 H 12.65 M 8 13.45 V 12.65 M 2.55 8 H 3.35"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeOpacity="0.55"
        />
        {/* Steady hour hand */}
        <line
          x1="8"
          y1="8"
          x2="10.6"
          y2="9.5"
          stroke="currentColor"
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeOpacity="0.85"
        />
        {/* Sweeping minute hand */}
        <g className="crt-svg-clock-hand">
          <line
            x1="8"
            y1="8"
            x2="8"
            y2="3.65"
            stroke="currentColor"
            strokeWidth="1.45"
            strokeLinecap="round"
          />
        </g>
        <circle cx="8" cy="8" r="1.05" fill="currentColor" />
      </svg>
    );
  }

  // Operations: 8-tooth precision servo gear + optical core
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={`${className} crt-living-icon crt-living-icon-operations`}
    >
      <g className="crt-svg-cog-rotor">
        <circle cx="8" cy="8" r="4.35" stroke="currentColor" strokeWidth="1.45" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <line
            key={deg}
            x1="8"
            y1="1.35"
            x2="8"
            y2="3.2"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            transform={`rotate(${deg} 8 8)`}
          />
        ))}
      </g>
      <circle cx="8" cy="8" r="1.65" fill="currentColor" className="crt-svg-cog-core" />
    </svg>
  );
}

/**
 * Living CRT Terminal icon (`>_`) with phosphor persistence blinking cursor
 * for the Live Scraper Event Stream console header.
 */
export function LivingTerminalIcon({ className = 'h-4 w-4 text-crt-phosphor shrink-0' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={`${className} crt-living-icon`}
    >
      <rect
        x="1.25"
        y="2.25"
        width="13.5"
        height="11.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <polyline
        points="4.1,5.7 6.8,8 4.1,10.3"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="8.2"
        y1="10.3"
        x2="11.8"
        y2="10.3"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        className="crt-terminal-cursor"
      />
    </svg>
  );
}
