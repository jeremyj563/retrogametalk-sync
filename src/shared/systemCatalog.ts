export type SystemBrandId =
  | 'nintendo'
  | 'sony'
  | 'sega'
  | 'nec_snk'
  | 'atari_ms_other'
  | 'arcade_computers'
  | 'system_misc';

export interface SystemBrandGroupMeta {
  id: SystemBrandId;
  label: string;
  shortLabel: string;
}

export interface SystemDisplayInfo {
  slug: string;
  displayName: string;
  brandId: SystemBrandId;
  brandLabel: string;
}

export const SYSTEM_BRAND_GROUPS: readonly SystemBrandGroupMeta[] = [
  { id: 'nintendo', label: 'Nintendo', shortLabel: 'Nintendo' },
  { id: 'sony', label: 'Sony PlayStation', shortLabel: 'Sony' },
  { id: 'sega', label: 'Sega', shortLabel: 'Sega' },
  { id: 'nec_snk', label: 'NEC & SNK', shortLabel: 'NEC & SNK' },
  { id: 'atari_ms_other', label: 'Atari, Microsoft & Classic Consoles', shortLabel: 'Atari & Classic' },
  { id: 'arcade_computers', label: 'Arcade & Home Computers', shortLabel: 'Arcade & PC' },
  { id: 'system_misc', label: 'System BIOS & Other', shortLabel: 'System & Other' },
];

const BRAND_LABEL_BY_ID = new Map<SystemBrandId, string>(
  SYSTEM_BRAND_GROUPS.map((g) => [g.id, g.label] as const),
);

/**
 * WordPress informational / utility routes under /repo/<slug>/ that are NOT game console archives.
 */
export const NON_SYSTEM_SLUGS = new Set<string>([
  'wp-content',
  'wp-json',
  'wp-admin',
  'wp-includes',
  'wp-login',
  'wp-login.php',
  'xmlrpc.php',
  'guides',
  'guide',
  'database',
  'platforms',
  'platform',
  'dmca',
  'privacy-policy',
  'privacy',
  'cookie-policy',
  'cookies',
  'contact',
  'contact-us',
  'faq',
  'about',
  'about-us',
  'feed',
  'author',
  'tag',
  'category',
  'screenshots-wanted',
  'screenshot-wanted',
  'sitemap',
  'sitemap-xml',
  'user-agreement',
  'terms',
  'terms-of-service',
  'terms-and-conditions',
  'tos',
  'rules',
  'request',
  'requests',
  'game-requests',
  'donate',
  'support',
  'sponsors',
  'staff',
  'news',
  'blog',
  'changelog',
  'updates',
  'search',
  'login',
  'logout',
  'register',
  'account',
  'my-account',
  'profile',
  'members',
  'forum',
  'forums',
  'cart',
  'checkout',
  'uncategorized',
  'page',
  'comments',
  'embed',
]);

export function isNonSystemSlug(rawSlug: string): boolean {
  const clean = rawSlug.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  if (!clean) return true;
  if (NON_SYSTEM_SLUGS.has(clean)) return true;
  if (clean.startsWith('wp-')) return true;
  if (clean === 'sitemap' || clean.startsWith('sitemap-') || clean.startsWith('sitemap_')) return true;
  if (/\.(xml|txt|php|html?|json|css|js|ico|png|jpe?g|gif|svg|webp)$/i.test(clean)) return true;
  return false;
}

export function filterValidSystemSlugs(slugs: Iterable<string>): string[] {
  const deduped = new Map<string, string>();
  for (const raw of slugs) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (isNonSystemSlug(lower)) continue;
    if (!deduped.has(lower)) {
      deduped.set(lower, trimmed);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => a.localeCompare(b));
}

export function sanitizeSystemFilterString(rawFilter: string): string {
  return filterValidSystemSlugs(rawFilter.split(',')).join(',');
}

interface SystemCatalogEntry {
  displayName: string;
  brandId: SystemBrandId;
}

const KNOWN_SYSTEMS: Record<string, SystemCatalogEntry> = {
  // Nintendo
  'nes-roms': { displayName: 'Nintendo Entertainment System (NES)', brandId: 'nintendo' },
  nes: { displayName: 'Nintendo Entertainment System (NES)', brandId: 'nintendo' },
  'fds-roms': { displayName: 'Famicom Disk System (FDS)', brandId: 'nintendo' },
  famicom_disk_system: { displayName: 'Famicom Disk System (FDS)', brandId: 'nintendo' },
  'famicom-disk-system': { displayName: 'Famicom Disk System (FDS)', brandId: 'nintendo' },
  'snes-roms': { displayName: 'Super Nintendo (SNES)', brandId: 'nintendo' },
  'snes-rom': { displayName: 'Super Nintendo (SNES)', brandId: 'nintendo' },
  snes: { displayName: 'Super Nintendo (SNES)', brandId: 'nintendo' },
  satellaview: { displayName: 'Satellaview (BS-X)', brandId: 'nintendo' },
  'bs-x': { displayName: 'Satellaview (BS-X)', brandId: 'nintendo' },
  'n64-roms': { displayName: 'Nintendo 64 (N64)', brandId: 'nintendo' },
  n64: { displayName: 'Nintendo 64 (N64)', brandId: 'nintendo' },
  '64dd': { displayName: 'Nintendo 64DD', brandId: 'nintendo' },
  gamecube: { displayName: 'Nintendo GameCube', brandId: 'nintendo' },
  'gamecube-iso': { displayName: 'Nintendo GameCube', brandId: 'nintendo' },
  'gcn-iso': { displayName: 'Nintendo GameCube', brandId: 'nintendo' },
  gcn_iso: { displayName: 'Nintendo GameCube', brandId: 'nintendo' },
  'wii-iso': { displayName: 'Nintendo Wii', brandId: 'nintendo' },
  'wii-roms': { displayName: 'Nintendo Wii', brandId: 'nintendo' },
  wii: { displayName: 'Nintendo Wii', brandId: 'nintendo' },
  wiiware: { displayName: 'Nintendo WiiWare', brandId: 'nintendo' },
  'wii-u': { displayName: 'Nintendo Wii U', brandId: 'nintendo' },
  wiiu: { displayName: 'Nintendo Wii U', brandId: 'nintendo' },
  switch: { displayName: 'Nintendo Switch', brandId: 'nintendo' },
  'switch-roms': { displayName: 'Nintendo Switch', brandId: 'nintendo' },
  'nintendo-switch': { displayName: 'Nintendo Switch', brandId: 'nintendo' },
  'gb-roms': { displayName: 'Game Boy', brandId: 'nintendo' },
  'gameboy-roms': { displayName: 'Game Boy', brandId: 'nintendo' },
  gb_roms: { displayName: 'Game Boy', brandId: 'nintendo' },
  'gbc-roms': { displayName: 'Game Boy Color', brandId: 'nintendo' },
  'gameboy-color-roms': { displayName: 'Game Boy Color', brandId: 'nintendo' },
  gbc_roms: { displayName: 'Game Boy Color', brandId: 'nintendo' },
  'gba-roms': { displayName: 'Game Boy Advance (GBA)', brandId: 'nintendo' },
  gba: { displayName: 'Game Boy Advance (GBA)', brandId: 'nintendo' },
  'virtual-boy': { displayName: 'Virtual Boy', brandId: 'nintendo' },
  'vb-roms': { displayName: 'Virtual Boy', brandId: 'nintendo' },
  'nds-roms': { displayName: 'Nintendo DS', brandId: 'nintendo' },
  nds: { displayName: 'Nintendo DS', brandId: 'nintendo' },
  'nintendo-ds': { displayName: 'Nintendo DS', brandId: 'nintendo' },
  'dsi-roms': { displayName: 'Nintendo DSi / DSiWare', brandId: 'nintendo' },
  dsiware: { displayName: 'Nintendo DSiWare', brandId: 'nintendo' },
  '3ds-roms': { displayName: 'Nintendo 3DS', brandId: 'nintendo' },
  '3ds': { displayName: 'Nintendo 3DS', brandId: 'nintendo' },
  'nintendo-3ds': { displayName: 'Nintendo 3DS', brandId: 'nintendo' },
  'pokemon-mini': { displayName: 'Pokemon Mini', brandId: 'nintendo' },

  // Sony
  'psx-iso': { displayName: 'PlayStation (PS1)', brandId: 'sony' },
  'ps1-iso': { displayName: 'PlayStation (PS1)', brandId: 'sony' },
  psx: { displayName: 'PlayStation (PS1)', brandId: 'sony' },
  ps1: { displayName: 'PlayStation (PS1)', brandId: 'sony' },
  playstation: { displayName: 'PlayStation (PS1)', brandId: 'sony' },
  'psx2psp-eboots': { displayName: 'PSX2PSP & PSN Eboots', brandId: 'sony' },
  psx2psp: { displayName: 'PSX2PSP & PSN Eboots', brandId: 'sony' },
  'psn-eboot': { displayName: 'PSX2PSP & PSN Eboots', brandId: 'sony' },
  'ps2-iso': { displayName: 'PlayStation 2 (PS2)', brandId: 'sony' },
  ps2: { displayName: 'PlayStation 2 (PS2)', brandId: 'sony' },
  'playstation-2': { displayName: 'PlayStation 2 (PS2)', brandId: 'sony' },
  'ps3-iso': { displayName: 'PlayStation 3 (PS3)', brandId: 'sony' },
  ps3: { displayName: 'PlayStation 3 (PS3)', brandId: 'sony' },
  'playstation-3': { displayName: 'PlayStation 3 (PS3)', brandId: 'sony' },
  'psp-iso': { displayName: 'PlayStation Portable (PSP)', brandId: 'sony' },
  'psp-roms': { displayName: 'PlayStation Portable (PSP)', brandId: 'sony' },
  psp: { displayName: 'PlayStation Portable (PSP)', brandId: 'sony' },
  'ps-vita': { displayName: 'PlayStation Vita', brandId: 'sony' },
  psvita: { displayName: 'PlayStation Vita', brandId: 'sony' },
  vita: { displayName: 'PlayStation Vita', brandId: 'sony' },

  // Sega
  'sg-1000': { displayName: 'Sega SG-1000', brandId: 'sega' },
  sg1000: { displayName: 'Sega SG-1000', brandId: 'sega' },
  'sms-roms': { displayName: 'Sega Master System', brandId: 'sega' },
  sms_roms: { displayName: 'Sega Master System', brandId: 'sega' },
  'master-system': { displayName: 'Sega Master System', brandId: 'sega' },
  'sega-master-system': { displayName: 'Sega Master System', brandId: 'sega' },
  'gg-roms': { displayName: 'Sega Game Gear', brandId: 'sega' },
  'game-gear': { displayName: 'Sega Game Gear', brandId: 'sega' },
  gamegear: { displayName: 'Sega Game Gear', brandId: 'sega' },
  'genesis-roms': { displayName: 'Sega Genesis / Mega Drive', brandId: 'sega' },
  'megadrive-roms': { displayName: 'Sega Genesis / Mega Drive', brandId: 'sega' },
  sega_genesis_roms: { displayName: 'Sega Genesis / Mega Drive', brandId: 'sega' },
  'sega-genesis': { displayName: 'Sega Genesis / Mega Drive', brandId: 'sega' },
  megadrive: { displayName: 'Sega Genesis / Mega Drive', brandId: 'sega' },
  'sega-cd-iso': { displayName: 'Sega CD / Mega-CD', brandId: 'sega' },
  sega_cd_isos: { displayName: 'Sega CD / Mega-CD', brandId: 'sega' },
  'sega-cd': { displayName: 'Sega CD / Mega-CD', brandId: 'sega' },
  'mega-cd': { displayName: 'Sega CD / Mega-CD', brandId: 'sega' },
  '32x-roms': { displayName: 'Sega 32X', brandId: 'sega' },
  sega_32x_roms: { displayName: 'Sega 32X', brandId: 'sega' },
  'sega-32x': { displayName: 'Sega 32X', brandId: 'sega' },
  '32x': { displayName: 'Sega 32X', brandId: 'sega' },
  'saturn-iso': { displayName: 'Sega Saturn', brandId: 'sega' },
  sega_saturn_isos: { displayName: 'Sega Saturn', brandId: 'sega' },
  saturn: { displayName: 'Sega Saturn', brandId: 'sega' },
  'sega-saturn': { displayName: 'Sega Saturn', brandId: 'sega' },
  'dreamcast-iso': { displayName: 'Sega Dreamcast', brandId: 'sega' },
  'dc-iso': { displayName: 'Sega Dreamcast', brandId: 'sega' },
  dreamcast: { displayName: 'Sega Dreamcast', brandId: 'sega' },
  'sega-dreamcast': { displayName: 'Sega Dreamcast', brandId: 'sega' },
  'sega-pico': { displayName: 'Sega Pico', brandId: 'sega' },
  pico: { displayName: 'Sega Pico', brandId: 'sega' },

  // NEC & SNK
  'pc-engine-roms': { displayName: 'PC Engine / TurboGrafx-16', brandId: 'nec_snk' },
  'turbografx-16': { displayName: 'PC Engine / TurboGrafx-16', brandId: 'nec_snk' },
  'turbografx-16-roms': { displayName: 'PC Engine / TurboGrafx-16', brandId: 'nec_snk' },
  'pce-roms': { displayName: 'PC Engine / TurboGrafx-16', brandId: 'nec_snk' },
  'pc-engine': { displayName: 'PC Engine / TurboGrafx-16', brandId: 'nec_snk' },
  'pce-cd-iso': { displayName: 'PC Engine CD / TurboGrafx-CD', brandId: 'nec_snk' },
  'turbografx-cd': { displayName: 'PC Engine CD / TurboGrafx-CD', brandId: 'nec_snk' },
  'pc-engine-cd': { displayName: 'PC Engine CD / TurboGrafx-CD', brandId: 'nec_snk' },
  supergrafx: { displayName: 'PC Engine SuperGrafx', brandId: 'nec_snk' },
  'pc-engine-supergrafx': { displayName: 'PC Engine SuperGrafx', brandId: 'nec_snk' },
  'pc-fx': { displayName: 'NEC PC-FX', brandId: 'nec_snk' },
  pcfx: { displayName: 'NEC PC-FX', brandId: 'nec_snk' },
  'neogeo-roms': { displayName: 'SNK Neo Geo', brandId: 'nec_snk' },
  'neo-geo': { displayName: 'SNK Neo Geo', brandId: 'nec_snk' },
  neogeo: { displayName: 'SNK Neo Geo', brandId: 'nec_snk' },
  'neo-geo-cd': { displayName: 'SNK Neo Geo CD', brandId: 'nec_snk' },
  neogeocd: { displayName: 'SNK Neo Geo CD', brandId: 'nec_snk' },
  'ngp-roms': { displayName: 'Neo Geo Pocket / Color', brandId: 'nec_snk' },
  'neo-geo-pocket': { displayName: 'Neo Geo Pocket / Color', brandId: 'nec_snk' },
  'ngpc-roms': { displayName: 'Neo Geo Pocket Color', brandId: 'nec_snk' },
  'neo-geo-pocket-color': { displayName: 'Neo Geo Pocket Color', brandId: 'nec_snk' },

  // Atari, Microsoft & Classic Consoles
  'atari-2600-roms': { displayName: 'Atari 2600', brandId: 'atari_ms_other' },
  'atari-2600': { displayName: 'Atari 2600', brandId: 'atari_ms_other' },
  'atari-5200-roms': { displayName: 'Atari 5200', brandId: 'atari_ms_other' },
  'atari-5200': { displayName: 'Atari 5200', brandId: 'atari_ms_other' },
  'atari-7800-roms': { displayName: 'Atari 7800', brandId: 'atari_ms_other' },
  'atari-7800': { displayName: 'Atari 7800', brandId: 'atari_ms_other' },
  'atari-lynx': { displayName: 'Atari Lynx', brandId: 'atari_ms_other' },
  'lynx-roms': { displayName: 'Atari Lynx', brandId: 'atari_ms_other' },
  lynx: { displayName: 'Atari Lynx', brandId: 'atari_ms_other' },
  'atari-jaguar': { displayName: 'Atari Jaguar', brandId: 'atari_ms_other' },
  'jaguar-roms': { displayName: 'Atari Jaguar', brandId: 'atari_ms_other' },
  jaguar: { displayName: 'Atari Jaguar', brandId: 'atari_ms_other' },
  'jaguar-cd': { displayName: 'Atari Jaguar CD', brandId: 'atari_ms_other' },
  xbox: { displayName: 'Microsoft Xbox', brandId: 'atari_ms_other' },
  'xbox-iso': { displayName: 'Microsoft Xbox', brandId: 'atari_ms_other' },
  'og-xbox': { displayName: 'Microsoft Xbox', brandId: 'atari_ms_other' },
  'xbox-360': { displayName: 'Microsoft Xbox 360', brandId: 'atari_ms_other' },
  xbox360: { displayName: 'Microsoft Xbox 360', brandId: 'atari_ms_other' },
  '3do-iso': { displayName: 'Panasonic 3DO', brandId: 'atari_ms_other' },
  '3do': { displayName: 'Panasonic 3DO', brandId: 'atari_ms_other' },
  colecovision: { displayName: 'ColecoVision', brandId: 'atari_ms_other' },
  intellivision: { displayName: 'Mattel Intellivision', brandId: 'atari_ms_other' },
  vectrex: { displayName: 'GCE Vectrex', brandId: 'atari_ms_other' },
  'odyssey-2': { displayName: 'Magnavox Odyssey 2', brandId: 'atari_ms_other' },
  odyssey2: { displayName: 'Magnavox Odyssey 2', brandId: 'atari_ms_other' },
  'cd-i': { displayName: 'Philips CD-i', brandId: 'atari_ms_other' },
  cdi: { displayName: 'Philips CD-i', brandId: 'atari_ms_other' },
  'philips-cdi': { displayName: 'Philips CD-i', brandId: 'atari_ms_other' },
  'ws-roms': { displayName: 'Bandai WonderSwan / Color', brandId: 'atari_ms_other' },
  wonderswan: { displayName: 'Bandai WonderSwan / Color', brandId: 'atari_ms_other' },
  'wonderswan-color': { displayName: 'Bandai WonderSwan Color', brandId: 'atari_ms_other' },
  'fairchild-channel-f': { displayName: 'Fairchild Channel F', brandId: 'atari_ms_other' },
  'channel-f': { displayName: 'Fairchild Channel F', brandId: 'atari_ms_other' },
  'watara-supervision': { displayName: 'Watara Supervision', brandId: 'atari_ms_other' },
  supervision: { displayName: 'Watara Supervision', brandId: 'atari_ms_other' },
  'n-gage': { displayName: 'Nokia N-Gage', brandId: 'atari_ms_other' },
  ngage: { displayName: 'Nokia N-Gage', brandId: 'atari_ms_other' },

  // Arcade & Home Computers
  'arcade-roms': { displayName: 'Arcade (MAME / FBNeo)', brandId: 'arcade_computers' },
  arcade: { displayName: 'Arcade (MAME / FBNeo)', brandId: 'arcade_computers' },
  mame: { displayName: 'MAME Arcade', brandId: 'arcade_computers' },
  fbneo: { displayName: 'FinalBurn Neo (FBNeo)', brandId: 'arcade_computers' },
  cps1: { displayName: 'Capcom CPS-1', brandId: 'arcade_computers' },
  cps2: { displayName: 'Capcom CPS-2', brandId: 'arcade_computers' },
  cps3: { displayName: 'Capcom CPS-3', brandId: 'arcade_computers' },
  naomi: { displayName: 'Sega NAOMI', brandId: 'arcade_computers' },
  atomiswave: { displayName: 'Sammy Atomiswave', brandId: 'arcade_computers' },
  'amiga-roms': { displayName: 'Commodore Amiga', brandId: 'arcade_computers' },
  amiga: { displayName: 'Commodore Amiga', brandId: 'arcade_computers' },
  'amiga-cd32': { displayName: 'Commodore Amiga CD32', brandId: 'arcade_computers' },
  cd32: { displayName: 'Commodore Amiga CD32', brandId: 'arcade_computers' },
  'c64-roms': { displayName: 'Commodore 64', brandId: 'arcade_computers' },
  c64: { displayName: 'Commodore 64', brandId: 'arcade_computers' },
  'commodore-64': { displayName: 'Commodore 64', brandId: 'arcade_computers' },
  'msx-roms': { displayName: 'MSX / MSX2', brandId: 'arcade_computers' },
  msx: { displayName: 'MSX', brandId: 'arcade_computers' },
  msx2: { displayName: 'MSX2', brandId: 'arcade_computers' },
  'zx-spectrum': { displayName: 'Sinclair ZX Spectrum', brandId: 'arcade_computers' },
  'amstrad-cpc': { displayName: 'Amstrad CPC', brandId: 'arcade_computers' },
  'atari-st': { displayName: 'Atari ST', brandId: 'arcade_computers' },
  dos: { displayName: 'MS-DOS / PC', brandId: 'arcade_computers' },
  'ms-dos': { displayName: 'MS-DOS / PC', brandId: 'arcade_computers' },
  scummvm: { displayName: 'ScummVM', brandId: 'arcade_computers' },
  x68000: { displayName: 'Sharp X68000', brandId: 'arcade_computers' },
  'sharp-x68000': { displayName: 'Sharp X68000', brandId: 'arcade_computers' },
  'fm-towns': { displayName: 'Fujitsu FM Towns', brandId: 'arcade_computers' },
  'pc-88': { displayName: 'NEC PC-88', brandId: 'arcade_computers' },
  'pc-98': { displayName: 'NEC PC-98', brandId: 'arcade_computers' },
  'apple-ii': { displayName: 'Apple II', brandId: 'arcade_computers' },

  // System & Other
  'bios-files': { displayName: 'BIOS & System Firmware', brandId: 'system_misc' },
  bios: { displayName: 'BIOS & System Firmware', brandId: 'system_misc' },
  soundtracks: { displayName: 'Game Soundtracks', brandId: 'system_misc' },
};

const ACRONYM_MAP = new Map<string, string>([
  ['nes', 'NES'],
  ['fds', 'FDS'],
  ['snes', 'SNES'],
  ['n64', 'N64'],
  ['64dd', '64DD'],
  ['gcn', 'GCN'],
  ['gb', 'GB'],
  ['gbc', 'GBC'],
  ['gba', 'GBA'],
  ['nds', 'NDS'],
  ['dsi', 'DSi'],
  ['3ds', '3DS'],
  ['ps1', 'PS1'],
  ['ps2', 'PS2'],
  ['ps3', 'PS3'],
  ['ps4', 'PS4'],
  ['psx', 'PSX'],
  ['psp', 'PSP'],
  ['psx2psp', 'PSX2PSP'],
  ['psn', 'PSN'],
  ['sms', 'SMS'],
  ['gg', 'GG'],
  ['cd', 'CD'],
  ['32x', '32X'],
  ['sg', 'SG'],
  ['pce', 'PCE'],
  ['pc', 'PC'],
  ['fx', 'FX'],
  ['ngp', 'NGP'],
  ['ngpc', 'NGPC'],
  ['snk', 'SNK'],
  ['nec', 'NEC'],
  ['3do', '3DO'],
  ['cdi', 'CD-i'],
  ['cd32', 'CD32'],
  ['c64', 'C64'],
  ['msx', 'MSX'],
  ['msx2', 'MSX2'],
  ['dos', 'DOS'],
  ['cpc', 'CPC'],
  ['st', 'ST'],
  ['zx', 'ZX'],
  ['fm', 'FM'],
  ['bios', 'BIOS'],
  ['mame', 'MAME'],
  ['fbneo', 'FBNeo'],
  ['cps1', 'CPS-1'],
  ['cps2', 'CPS-2'],
  ['cps3', 'CPS-3'],
  ['ii', 'II'],
  ['iso', 'ISO'],
  ['isos', 'ISOs'],
  ['rom', 'ROM'],
  ['roms', 'ROMs'],
]);

function inferBrandId(lowerSlug: string): SystemBrandId {
  if (/(nintendo|famicom|super-?famicom|snes|\bnes\b|n64|64dd|gamecube|gcn|\bwii|\bswitch|game-?boy|\bgba|\bgbc|\bgb[-_]|virtual-?boy|\bnds\b|\bdsi|\b3ds|satellaview|pokemon-mini)/i.test(lowerSlug)) {
    return 'nintendo';
  }
  if (/(playstation|\bps[1-5x]\b|psx2psp|\bpsp\b|vita|psn)/i.test(lowerSlug)) {
    return 'sony';
  }
  if (/(sega|sg-?1000|master-?system|\bsms\b|game-?gear|\bgg\b|genesis|mega-?drive|mega-?cd|\b32x\b|saturn|dreamcast|\bdc[-_])/i.test(lowerSlug)) {
    return 'sega';
  }
  if (/(pc-?engine|turbografx|\bpce\b|supergrafx|pc-?fx|neo-?geo|neogeo|\bngp)/i.test(lowerSlug)) {
    return 'nec_snk';
  }
  if (/(atari(?!-st)|lynx|jaguar|xbox|3do|coleco|intellivision|vectrex|odyssey|cd-?i|wonderswan|supervision|channel-?f|n-?gage)/i.test(lowerSlug)) {
    return 'atari_ms_other';
  }
  if (/(arcade|mame|fbneo|cps[1-3]|naomi|atomiswave|amiga|c64|commodore|msx|spectrum|amstrad|atari-st|\bdos\b|scummvm|x68000|fm-towns|pc-88|pc-98|apple)/i.test(lowerSlug)) {
    return 'arcade_computers';
  }
  return 'system_misc';
}

function formatFallbackDisplayName(slug: string): string {
  const stripped = slug
    .trim()
    .replace(/[-_]+(?:roms?|isos?|games)$/i, '');
  const parts = (stripped || slug.trim())
    .split(/[-_]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return slug;

  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      const acronym = ACRONYM_MAP.get(lower);
      if (acronym) return acronym;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function resolveSystemDisplayInfo(slug: string): SystemDisplayInfo {
  const clean = slug.trim();
  const lower = clean.toLowerCase();
  const hyphenVariant = lower.replace(/_/g, '-');
  const underscoreVariant = lower.replace(/-/g, '_');

  const known =
    KNOWN_SYSTEMS[lower] ||
    KNOWN_SYSTEMS[hyphenVariant] ||
    KNOWN_SYSTEMS[underscoreVariant];

  if (known) {
    return {
      slug: clean,
      displayName: known.displayName,
      brandId: known.brandId,
      brandLabel: BRAND_LABEL_BY_ID.get(known.brandId) || 'System & Other',
    };
  }

  const brandId = inferBrandId(lower);
  return {
    slug: clean,
    displayName: formatFallbackDisplayName(clean),
    brandId,
    brandLabel: BRAND_LABEL_BY_ID.get(brandId) || 'System & Other',
  };
}

export interface SystemBrandGroup {
  brand: SystemBrandGroupMeta;
  items: SystemDisplayInfo[];
}

export function groupSystemsByBrand(slugs: string[]): SystemBrandGroup[] {
  const buckets = new Map<SystemBrandId, SystemDisplayInfo[]>();
  for (const group of SYSTEM_BRAND_GROUPS) {
    buckets.set(group.id, []);
  }

  for (const slug of slugs) {
    if (isNonSystemSlug(slug)) continue;
    const info = resolveSystemDisplayInfo(slug);
    buckets.get(info.brandId)!.push(info);
  }

  const result: SystemBrandGroup[] = [];
  for (const group of SYSTEM_BRAND_GROUPS) {
    const items = buckets.get(group.id) || [];
    if (items.length === 0) continue;
    items.sort((a, b) => {
      const cmp = a.displayName.localeCompare(b.displayName);
      return cmp !== 0 ? cmp : a.slug.localeCompare(b.slug);
    });
    result.push({ brand: group, items });
  }

  return result;
}
