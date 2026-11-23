import type { DeviceColorKey, DeviceIconKey } from '../types';

export interface DeviceIconOption {
  key: DeviceIconKey;
  label: string;
  shortLabel: string;
  hint: string;
}

export const DEVICE_ICON_OPTIONS: readonly DeviceIconOption[] = [
  {
    key: 'handheld',
    label: 'Horizontal Handheld',
    shortLabel: 'Handheld',
    hint: 'Steam Deck, Retroid, Odin, GBA, PSP',
  },
  {
    key: 'vertical',
    label: 'Vertical Handheld',
    shortLabel: 'Vertical',
    hint: 'Miyoo Mini, Analogue Pocket, Game Boy',
  },
  {
    key: 'clamshell',
    label: 'Clamshell',
    shortLabel: 'Clamshell',
    hint: 'RG35XX SP, Retroid Flip, 3DS, GBA SP',
  },
  {
    key: 'sdcard',
    label: 'SD Card / Flashcart',
    shortLabel: 'SD Card',
    hint: 'EverDrive, EZ-Flash, standalone microSD',
  },
  {
    key: 'console',
    label: 'FPGA / TV Console',
    shortLabel: 'Console',
    hint: 'MiSTer FPGA, RetroPie, Batocera, Mini PC',
  },
  {
    key: 'desktop',
    label: 'Desktop / NAS',
    shortLabel: 'Desktop',
    hint: 'PC emulator folder, RetroArch, network share',
  },
  {
    key: 'drive',
    label: 'External Drive',
    shortLabel: 'Drive',
    hint: 'USB flash drive, external SSD, generic folder',
  },
] as const;

export interface DeviceColorOption {
  key: DeviceColorKey;
  label: string;
  textClass: string;
  bgSoftClass: string;
  borderClass: string;
  swatchClass: string;
}

export const DEVICE_COLOR_OPTIONS: readonly DeviceColorOption[] = [
  {
    key: 'phosphor',
    label: 'Phosphor',
    textClass: 'text-crt-phosphor',
    bgSoftClass: 'bg-crt-phosphor/12',
    borderClass: 'border-crt-phosphor/45',
    swatchClass: 'bg-crt-phosphor',
  },
  {
    key: 'amber',
    label: 'Amber',
    textClass: 'text-crt-amber',
    bgSoftClass: 'bg-crt-amber/12',
    borderClass: 'border-crt-amber/45',
    swatchClass: 'bg-crt-amber',
  },
  {
    key: 'cyan',
    label: 'Cyan',
    textClass: 'text-sky-400',
    bgSoftClass: 'bg-sky-400/12',
    borderClass: 'border-sky-400/45',
    swatchClass: 'bg-sky-400',
  },
  {
    key: 'crimson',
    label: 'Crimson',
    textClass: 'text-crt-crimson',
    bgSoftClass: 'bg-crt-crimson/12',
    borderClass: 'border-crt-crimson/45',
    swatchClass: 'bg-crt-crimson',
  },
  {
    key: 'violet',
    label: 'Violet',
    textClass: 'text-violet-400',
    bgSoftClass: 'bg-violet-400/12',
    borderClass: 'border-violet-400/45',
    swatchClass: 'bg-violet-400',
  },
  {
    key: 'slate',
    label: 'Slate',
    textClass: 'text-crt-text/85',
    bgSoftClass: 'bg-crt-elevated',
    borderClass: 'border-crt-border-strong',
    swatchClass: 'bg-crt-muted',
  },
] as const;

const COLOR_MAP = new Map<DeviceColorKey, DeviceColorOption>(
  DEVICE_COLOR_OPTIONS.map((opt) => [opt.key, opt]),
);

export function getDeviceColorOption(colorKey?: DeviceColorKey | null): DeviceColorOption {
  if (colorKey && COLOR_MAP.has(colorKey)) {
    return COLOR_MAP.get(colorKey)!;
  }
  return DEVICE_COLOR_OPTIONS[0];
}

export function DeviceIconGlyph({
  iconKey = 'handheld',
  className = 'h-3.5 w-3.5',
}: {
  iconKey?: DeviceIconKey | null;
  className?: string;
}) {
  switch (iconKey) {
    case 'vertical':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <rect x="6" y="2.5" width="12" height="19" rx="2" />
          <rect x="8.5" y="5" width="7" height="6.5" rx="0.75" />
          <path d="M10 14.5v3M8.5 16h3" />
          <circle cx="15.2" cy="15.2" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="13.8" cy="17.2" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'clamshell':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <rect x="4" y="3" width="16" height="8.5" rx="1.5" />
          <rect x="7" y="5" width="10" height="4.5" rx="0.5" />
          <path d="M5 12h14" />
          <rect x="4" y="12.5" width="16" height="8.5" rx="1.5" />
          <path d="M8.5 15.5v3M7 17h3" />
          <circle cx="15.5" cy="16.2" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="14" cy="18" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'sdcard':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <path d="M9 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5L9 3Z" />
          <path d="M10 7v3M13 6v4M16 6v4" />
        </svg>
      );
    case 'console':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M7 10h6M7 14h3" />
          <circle cx="16.5" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none" />
          <path d="M7 18v2M17 18v2" />
        </svg>
      );
    case 'desktop':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <rect x="3" y="4" width="18" height="12" rx="1.75" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case 'drive':
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <path d="M3 13h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
          <path d="M5.4 5.1A2 2 0 0 1 7.2 4h9.6a2 2 0 0 1 1.8 1.1L21 13H3l2.4-7.9Z" />
          <circle cx="7" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
          <path d="M14 16.5h3" />
        </svg>
      );
    case 'handheld':
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={className}
        >
          <rect x="2" y="6" width="20" height="12" rx="3.5" />
          <rect x="8.5" y="8.5" width="7" height="7" rx="0.75" />
          <path d="M5.5 10.7v2.6M4.2 12h2.6" />
          <circle cx="18.6" cy="11.1" r="0.75" fill="currentColor" stroke="none" />
          <circle cx="17.2" cy="13.1" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

export function DeviceEmblem({
  iconKey = 'handheld',
  colorKey = 'phosphor',
  size = 'md',
  className = '',
}: {
  iconKey?: DeviceIconKey | null;
  colorKey?: DeviceColorKey | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const color = getDeviceColorOption(colorKey);
  const boxClasses =
    size === 'xs'
      ? 'h-5 w-5 rounded'
      : size === 'sm'
        ? 'h-6 w-6 rounded'
        : 'h-8 w-8 rounded';
  const iconClasses =
    size === 'xs'
      ? 'h-3 w-3'
      : size === 'sm'
        ? 'h-3.5 w-3.5'
        : 'h-4 w-4';

  return (
    <span
      className={`inline-flex items-center justify-center border shrink-0 ${boxClasses} ${color.bgSoftClass} ${color.borderClass} ${color.textClass} ${className}`}
    >
      <DeviceIconGlyph iconKey={iconKey} className={iconClasses} />
    </span>
  );
}
