import type { CrtPalette } from '../shared/crtDisplay';

interface CartridgeFaviconPalette {
  bg: string;
  shellTop: string;
  shellBottom: string;
  border: string;
  borderStrong: string;
  accent: string;
  amber: string;
}

const FAVICON_PALETTES: Record<CrtPalette, CartridgeFaviconPalette> = {
  green: {
    bg: '#070a08',
    shellTop: '#16221a',
    shellBottom: '#0b110d',
    border: '#1e2d23',
    borderStrong: '#35523e',
    accent: '#38e56b',
    amber: '#f59e0b',
  },
  amber: {
    bg: '#0a0806',
    shellTop: '#211b12',
    shellBottom: '#110d08',
    border: '#2f2619',
    borderStrong: '#54432a',
    accent: '#ffb000',
    amber: '#fb923c',
  },
  cyan: {
    bg: '#06090b',
    shellTop: '#121f29',
    shellBottom: '#090f14',
    border: '#1c2b36',
    borderStrong: '#314c60',
    accent: '#38d9f5',
    amber: '#f59e0b',
  },
  gameboy: {
    bg: '#080b05',
    shellTop: '#1a2412',
    shellBottom: '#0d1209',
    border: '#27361a',
    borderStrong: '#46602d',
    accent: '#9bbc0f',
    amber: '#d4b82c',
  },
  synthwave: {
    bg: '#09060d',
    shellTop: '#20132e',
    shellBottom: '#100918',
    border: '#2e1d42',
    borderStrong: '#563478',
    accent: '#f45bff',
    amber: '#ff9f43',
  },
  virtualboy: {
    bg: '#0a0405',
    shellTop: '#250e13',
    shellBottom: '#120709',
    border: '#38151c',
    borderStrong: '#692532',
    accent: '#ff3b4e',
    amber: '#ff8a3d',
  },
  trinitron: {
    bg: '#07080a',
    shellTop: '#1b1f26',
    shellBottom: '#0e1014',
    border: '#272c36',
    borderStrong: '#475163',
    accent: '#e8f4ff',
    amber: '#f5b942',
  },
};

export function buildCartridgeFaviconSvg(palette: CrtPalette, isDryRun = false): string {
  const colors = FAVICON_PALETTES[palette] ?? FAVICON_PALETTES.green;
  const accent = isDryRun ? colors.amber : colors.accent;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <clipPath id="s"><rect x="11.5" y="18" width="41" height="27.5" rx="3.2"/></clipPath>
    <radialGradient id="g" cx="50%" cy="50%" r="58%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.28"/>
      <stop offset="65%" stop-color="${accent}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${colors.bg}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="c" x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${colors.shellTop}"/>
      <stop offset="100%" stop-color="${colors.shellBottom}"/>
    </linearGradient>
  </defs>
  <path d="M11.5 3.5H54A6.5 6.5 0 0 1 60.5 10V49.5L57.5 52.5V56.5A4 4 0 0 1 53.5 60.5H10.5A4 4 0 0 1 6.5 56.5V52.5L3.5 49.5V11.5L11.5 3.5Z" fill="url(#c)" stroke="${colors.borderStrong}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M12.3 5.6H53.5A4.5 4.5 0 0 1 58 10" stroke="${accent}" stroke-opacity="0.4" stroke-width="1.2" stroke-linecap="round"/>
  <g fill="${colors.bg}" opacity="0.9">
    <rect x="4.5" y="23" width="2.4" height="2.6" rx="0.6"/>
    <rect x="4.5" y="28" width="2.4" height="2.6" rx="0.6"/>
    <rect x="4.5" y="33" width="2.4" height="2.6" rx="0.6"/>
    <rect x="57.1" y="23" width="2.4" height="2.6" rx="0.6"/>
    <rect x="57.1" y="28" width="2.4" height="2.6" rx="0.6"/>
    <rect x="57.1" y="33" width="2.4" height="2.6" rx="0.6"/>
  </g>
  <rect x="15" y="7.5" width="27" height="1.9" rx="0.95" fill="${colors.borderStrong}"/>
  <rect x="15" y="10.9" width="27" height="1.9" rx="0.95" fill="${colors.borderStrong}" opacity="0.82"/>
  <rect x="15" y="14.2" width="27" height="1.4" rx="0.7" fill="${colors.border}"/>
  <path d="M49.5 7.5 52.9 12.8H46.1L49.5 7.5Z" fill="${accent}" fill-opacity="0.72"/>
  <rect x="10.5" y="17" width="43" height="29.5" rx="4.2" fill="${colors.bg}" stroke="${accent}" stroke-opacity="0.88" stroke-width="2"/>
  <g clip-path="url(#s)">
    <rect x="11.5" y="18" width="41" height="27.5" fill="url(#g)"/>
    <g stroke="${accent}" stroke-opacity="0.16" stroke-width="0.7">
      <line x1="11.5" y1="25" x2="52.5" y2="25"/>
      <line x1="11.5" y1="31.75" x2="52.5" y2="31.75"/>
      <line x1="11.5" y1="38.5" x2="52.5" y2="38.5"/>
      <line x1="22" y1="18" x2="22" y2="45.5"/>
      <line x1="32" y1="18" x2="32" y2="45.5"/>
      <line x1="42" y1="18" x2="42" y2="45.5"/>
    </g>
    <g fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15.5,24.8 22.3,31.75 15.5,38.7" opacity="0.76"/>
      <polyline points="27.6,24.8 34.4,31.75 27.6,38.7" opacity="1"/>
      <polyline points="39.7,24.8 46.5,31.75 39.7,38.7" opacity="0.9"/>
    </g>
    <path d="M14 20.5H21.5M14 20.5V25" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.2" stroke-linecap="round"/>
  </g>
  <rect x="10.5" y="50.2" width="35" height="7.4" rx="1.5" fill="${colors.bg}" stroke="${colors.border}" stroke-width="1.1"/>
  <g fill="${colors.borderStrong}">
    <rect x="12.5" y="51.7" width="3.2" height="4.4" rx="0.55"/>
    <rect x="17.3" y="51.7" width="3.2" height="4.4" rx="0.55"/>
    <rect x="22.1" y="51.7" width="3.2" height="4.4" rx="0.55" fill="${accent}" opacity="0.45"/>
    <rect x="26.9" y="51.7" width="3.2" height="4.4" rx="0.55" fill="${accent}"/>
    <rect x="31.7" y="51.7" width="3.2" height="4.4" rx="0.55"/>
    <rect x="36.5" y="51.7" width="3.2" height="4.4" rx="0.55"/>
    <rect x="41.3" y="51.7" width="3.2" height="4.4" rx="0.55"/>
  </g>
  <circle cx="51.8" cy="53.9" r="4.1" fill="${colors.bg}" stroke="${colors.borderStrong}" stroke-width="1.1"/>
  <circle cx="51.8" cy="53.9" r="2.6" fill="${accent}"/>
  <circle cx="51.1" cy="53.1" r="0.75" fill="#ffffff" fill-opacity="0.75"/>
</svg>`;
}

export function syncDocumentFavicon(palette: CrtPalette, isDryRun = false): void {
  if (typeof document === 'undefined') return;
  const colors = FAVICON_PALETTES[palette] ?? FAVICON_PALETTES.green;
  const svg = buildCartridgeFaviconSvg(palette, isDryRun);
  const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  let iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (!iconLink) {
    iconLink = document.createElement('link');
    iconLink.rel = 'icon';
    iconLink.type = 'image/svg+xml';
    document.head.appendChild(iconLink);
  }
  iconLink.href = dataUri;

  const shortcutLink = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
  if (shortcutLink) {
    shortcutLink.href = dataUri;
  }

  let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement('meta');
    themeMeta.name = 'theme-color';
    document.head.appendChild(themeMeta);
  }
  themeMeta.content = colors.bg;
}
