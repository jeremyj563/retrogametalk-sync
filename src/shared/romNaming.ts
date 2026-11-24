export interface RomNamingConfig {
  romNamingTemplate: string;
  romSanitizeFat32: boolean;
  romMaxFilenameLen: number;
}

export interface RomNamingContext {
  title: string;
  systemName: string;
  regions?: string[];
  languages?: string[];
  releaseTags?: string[];
  fileRole?: string;
  archiveFilename?: string;
  displayLabel?: string;
  innerFilename?: string;
  descriptionText?: string | null;
}

export interface NamingPresetOption {
  id: string;
  label: string;
  template: string;
  exampleRetail: string;
  exampleHack: string;
}

export const DEFAULT_ROM_NAMING_TEMPLATE = '{title}{regionParen}{tagBracket}';

export const ROM_NAMING_PRESETS: NamingPresetOption[] = [
  {
    id: 'standard',
    label: 'Title (Region) [Role Version]',
    template: '{title}{regionParen}{tagBracket}',
    exampleRetail: 'Gimmick! (Japan).nes',
    exampleHack: 'Super Mario World (USA) [Hack v1.42].sfc',
  },
  {
    id: 'tag-first',
    label: 'Title [Role Version] (Region)',
    template: '{title}{tagBracket}{regionParen}',
    exampleRetail: 'Gimmick! (Japan).nes',
    exampleHack: 'Super Mario World [Hack v1.42] (USA).sfc',
  },
  {
    id: 'dash-role',
    label: 'Title - Role Version (Region)',
    template: '{title}{roleDash}{regionParen}',
    exampleRetail: 'Gimmick! (Japan).nes',
    exampleHack: 'Super Mario World - Hack v1.42 (USA).sfc',
  },
  {
    id: 'original',
    label: 'Keep Clean Inner ROM Filename',
    template: '{origName}',
    exampleRetail: 'Gimmick! (Japan).nes',
    exampleHack: 'smw_hack_v142.sfc',
  },
];

const REGION_CODE_MAP: Record<string, string> = {
  u: 'USA',
  usa: 'USA',
  us: 'USA',
  e: 'Europe',
  eur: 'Europe',
  europe: 'Europe',
  j: 'Japan',
  jp: 'Japan',
  jpn: 'Japan',
  japan: 'Japan',
  w: 'World',
  world: 'World',
  au: 'Australia',
  aus: 'Australia',
  australia: 'Australia',
  br: 'Brazil',
  bra: 'Brazil',
  brazil: 'Brazil',
  kr: 'Korea',
  kor: 'Korea',
  korea: 'Korea',
  cn: 'China',
  chn: 'China',
  china: 'China',
  fr: 'France',
  france: 'France',
  de: 'Germany',
  germany: 'Germany',
  es: 'Spain',
  spain: 'Spain',
  it: 'Italy',
  italy: 'Italy',
  asia: 'Asia',
};

const LANGUAGE_TO_SHORT_TRANS: [RegExp, string][] = [
  [/english/i, 'T-En'],
  [/french|français/i, 'T-Fr'],
  [/spanish|español|castellano/i, 'T-Es'],
  [/portuguese|português/i, 'T-Pt'],
  [/italian|italiano/i, 'T-It'],
  [/german|deutsch/i, 'T-De'],
  [/russian/i, 'T-Ru'],
  [/chinese/i, 'T-Cn'],
  [/japanese/i, 'T-Jp'],
  [/korean/i, 'T-Ko'],
  [/polish/i, 'T-Pl'],
  [/arabic/i, 'T-Ar'],
  [/catalan/i, 'T-Ca'],
];

export function deriveShortRoleTag(
  fileRole?: string,
  releaseTags: string[] = [],
  innerFilename = '',
  archiveFilename = '',
  displayLabel = '',
): string | null {
  const candidates = [
    fileRole || '',
    ...releaseTags,
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  for (const raw of candidates) {
    const lower = raw.toLowerCase();
    if (lower === 'retail rom' || lower === 'rom' || lower === 'bios') {
      continue;
    }
    if (lower === 'original rom') {
      return 'Original';
    }
    if (lower === 'undub') return 'Undub';
    if (lower === 'hack') return 'Hack';
    if (lower === 'port') return 'Port';
    if (lower === 'homebrew') return 'Homebrew';
    if (lower === 'prototype') return 'Proto';
    if (lower === 'demo') return 'Demo';
    if (lower === 'bootleg') return 'Unl';
    if (lower === 'machine translation') return 'MTL';
    if (lower === 'dlc') return 'DLC';
    if (lower === 'patch') return 'Patch';
    if (lower.includes('translation')) {
      for (const [regex, shortCode] of LANGUAGE_TO_SHORT_TRANS) {
        if (regex.test(raw)) return shortCode;
      }
      return 'Trans';
    }
  }

  const combined = `${innerFilename} ${archiveFilename} ${displayLabel}`.toLowerCase();
  if (/\[t\+en\]|\bt-?en\b/i.test(combined)) return 'T-En';
  if (/\[t\+fr\]|\bt-?fr\b/i.test(combined)) return 'T-Fr';
  if (/\[t\+es\]|\bt-?es\b/i.test(combined)) return 'T-Es';
  if (/\[t\+pt\]|\bt-?pt\b/i.test(combined)) return 'T-Pt';
  if (/\b(undub)\b/i.test(combined)) return 'Undub';
  if (/\b(hack|romhack|redux|rebalance|improvement|colorization|fastrom|msu-?1)\b/i.test(combined)) return 'Hack';
  if (/\b(homebrew)\b/i.test(combined)) return 'Homebrew';
  if (/\b(port)\b/i.test(combined)) return 'Port';
  if (/\b(proto|prototype)\b/i.test(combined)) return 'Proto';

  return null;
}

function normalizeVersionMatch(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[\[(]+|[\])]+$/g, '').trim();
  if (!cleaned) return null;

  // Handle "ver 1.4" / "version 1.4" / "v 1.4"
  const verNum = cleaned.match(/^(?:ver(?:sion)?\.?\s*|v\.?\s*)(\d+(?:\.\d+){0,3}[a-z]?(?:-(?:fix|hotfix|final|rc\d*|beta\d*|alpha\d*))?)$/i);
  if (verNum) {
    const num = verNum[1];
    // Reject bare 4-digit years like v2024 unless preceded explicitly by v
    if (/^\d{4}$/.test(num) && !/^v/i.test(cleaned)) return null;
    return `v${num}`;
  }

  // Handle "rev A" / "rev 2" / "revision B"
  const revMatch = cleaned.match(/^(?:rev(?:ision)?\.?\s*)([A-Z0-9]+(?:\.\d+)?)$/i);
  if (revMatch) {
    return `Rev ${revMatch[1].toUpperCase()}`;
  }

  // Handle "r14" or "r123"
  const rMatch = cleaned.match(/^r(\d{1,4}[a-z]?)$/i);
  if (rMatch) {
    return `r${rMatch[1]}`;
  }

  // Handle "beta 2" / "rc1"
  const preMatch = cleaned.match(/^(beta|alpha|rc)\s*(\d+(?:\.\d+)*)?$/i);
  if (preMatch) {
    const kind = preMatch[1].toLowerCase() === 'rc'
      ? 'RC'
      : preMatch[1].charAt(0).toUpperCase() + preMatch[1].slice(1).toLowerCase();
    return preMatch[2] ? `${kind}${preMatch[2]}` : kind;
  }

  // Handle "build 2025-04-12" / "build 14"
  const buildMatch = cleaned.match(/^build\s*(\d{4}-\d{2}-\d{2}|\d{1,5})$/i);
  if (buildMatch) {
    return `Build ${buildMatch[1]}`;
  }

  return null;
}

const KNOWN_FILE_EXT_RE =
  /\.(?:tar\.(?:gz|bz2|xz)|zip|7z|rar|tar|gz|tgz|xz|bz2|nes|fds|unf|unif|sfc|smc|fig|swc|bs|gb|gbc|gba|srl|nds|dsi|3ds|cia|vb|vboy|n64|z64|v64|ndd|gen|md|smd|32x|sms|gg|sg|pce|hes|ngp|ngc|ws|wsc|col|int|vec|a26|a52|a78|j64|jag|lnx|lyx|min|p8|tic|d64|t64|prg|crt|adf|ipf|tzx|tap|dsk|mx1|mx2|rom|wad|bin|iso|chd|cso|pbp|rvz|gcz|wia|wbfs|xiso|cci|cue|gdi|ccd|m3u|ips|bps|ups|xdelta|vcdiff|ppf|txt|nfo|pdf|url|html|htm)$/i;

export function stripKnownFileExtension(text: string): string {
  return text.replace(KNOWN_FILE_EXT_RE, '');
}

export function extractVersionFromText(text: string): string | null {
  if (!text) return null;
  // Strip known file extension (without truncating ".3" in "v1.3") and bracketed CRC32 hex like [A1B2C3D4]
  const withoutExt = stripKnownFileExtension(text.trim()).replace(/\[[0-9a-f]{8}\]/gi, ' ');

  const patterns: RegExp[] = [
    // Explicit v1.2, v1.2.3b, ver 1.4, version 2.0, v1.2-hotfix
    /(?:^|[\s._\-[(\]])((?:version|ver\.?|v)\s*\d+(?:\.\d+){1,3}[a-z]?(?:-(?:fix|hotfix|final|rc\d*|beta\d*|alpha\d*))?)(?=$|[\s._\-)\]])/i,
    // Single integer version explicitly prefixed by v (e.g., v2, v3b) — avoid matching standalone numbers
    /(?:^|[\s._\-[(\]])(v\d{1,2}[a-z]?)(?=$|[\s._\-)\]])/i,
    // Revision (Rev A, Rev 1, Rev 1.1)
    /(?:^|[\s._\-[(\]])((?:rev(?:ision)?\.?\s*)(?:[A-Z]|\d+(?:\.\d+)?))(?=$|[\s._\-)\]])/i,
    // Release number r12, r104
    /(?:^|[\s._\-[(\]])(r\d{1,4}[a-z]?)(?=$|[\s._\-)\]])/i,
    // Build 2025-04-12 or Build 120
    /(?:^|[\s._\-[(\]])(build\s*(?:\d{4}-\d{2}-\d{2}|\d{1,5}))(?=$|[\s._\-)\]])/i,
    // Beta 2 / RC1
    /(?:^|[\s._\-[(\]])((?:beta|alpha|rc)\s*\d+(?:\.\d+)*)(?=$|[\s._\-)\]])/i,
  ];

  for (const regex of patterns) {
    const match = withoutExt.match(regex);
    if (match?.[1]) {
      const normalized = normalizeVersionMatch(match[1]);
      if (normalized) return normalized;
    }
  }

  return null;
}

export function extractVersionToken(ctx: RomNamingContext): string | null {
  const sources = [
    ctx.innerFilename || '',
    ctx.archiveFilename || '',
    ctx.displayLabel || '',
    ctx.title || '',
    ctx.descriptionText ? ctx.descriptionText.slice(0, 600) : '',
  ];

  for (const src of sources) {
    const found = extractVersionFromText(src);
    if (found) return found;
  }

  return null;
}

export function extractRegionsList(ctx: RomNamingContext): string[] {
  if (ctx.regions && ctx.regions.length > 0) {
    return ctx.regions.map((r) => r.trim()).filter(Boolean);
  }

  const probe = `${ctx.innerFilename || ''} ${ctx.archiveFilename || ''}`;
  const parenMatches = probe.matchAll(/\(([^)]+)\)/g);
  for (const m of parenMatches) {
    const parts = m[1]
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    const mapped = parts.map((p) => REGION_CODE_MAP[p]).filter(Boolean);
    if (mapped.length > 0 && mapped.length === parts.length) {
      return Array.from(new Set(mapped));
    }
  }

  return [];
}

function cleanTitleBase(rawTitle: string): string {
  // Remove leading/trailing whitespace and collapse multiple spaces
  return rawTitle
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeFat32Filename(raw: string, maxLen = 0, hasExtension = true): string {
  // Separate extension if present and expected
  const extMatch = hasExtension ? raw.match(/^(.*)(\.[a-z0-9]{1,8})$/i) : null;
  const hasExt = Boolean(extMatch);
  let base = extMatch ? extMatch[1] : raw;
  const ext = extMatch ? extMatch[2] : '';

  // Replace common colon-separated subtitles cleanly ("Zelda: A Link..." -> "Zelda - A Link...")
  base = base
    .replace(/:\s+/g, ' - ')
    .replace(/:/g, '-')
    .replace(/[/\\*?"<>|]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();

  if (!base) base = 'rom';

  if (maxLen > 0 && maxLen >= 12) {
    const allowedBase = Math.max(4, maxLen - ext.length);
    if (base.length > allowedBase) {
      base = base.slice(0, allowedBase).replace(/[. ]+$/g, '').trim() || 'rom';
    }
  }

  return hasExt ? `${base}${ext}` : base;
}

export function formatPreparedRomName(
  ctx: RomNamingContext,
  extensionWithDot: string,
  namingConfig: RomNamingConfig,
  options: { variantSuffix?: string | null; omitExtension?: boolean } = {},
): string {
  const ext = options.omitExtension
    ? ''
    : extensionWithDot
      ? (extensionWithDot.startsWith('.') ? extensionWithDot.toLowerCase() : `.${extensionWithDot.toLowerCase()}`)
      : '';

  const template = (namingConfig.romNamingTemplate || DEFAULT_ROM_NAMING_TEMPLATE).trim() || DEFAULT_ROM_NAMING_TEMPLATE;
  const rawBaseSource = ctx.innerFilename || ctx.archiveFilename || ctx.title || 'rom';
  const origBase = stripKnownFileExtension(rawBaseSource.trim()).trim();

  if (template === '{origName}') {
    const withSuffix = options.variantSuffix ? `${origBase} (${options.variantSuffix})${ext}` : `${origBase}${ext}`;
    return namingConfig.romSanitizeFat32
      ? sanitizeFat32Filename(withSuffix, namingConfig.romMaxFilenameLen, !options.omitExtension)
      : withSuffix;
  }

  const title = cleanTitleBase(ctx.title || origBase);
  const regions = extractRegionsList(ctx);
  const regionText = regions.join(', ');
  const regionParen =
    regionText && !title.toLowerCase().includes(`(${regionText.toLowerCase()})`)
      ? ` (${regionText})`
      : '';

  const role = deriveShortRoleTag(
    ctx.fileRole,
    ctx.releaseTags,
    ctx.innerFilename,
    ctx.archiveFilename,
    ctx.displayLabel,
  );
  const version = extractVersionToken(ctx);

  // Avoid duplicating tag or version if already embedded inside title
  const titleLower = title.toLowerCase();
  const effectiveVersion =
    version && !titleLower.includes(version.toLowerCase()) ? version : null;
  const effectiveRole =
    role && !titleLower.includes(`[${role.toLowerCase()}`) ? role : null;

  const tagParts = [effectiveRole, effectiveVersion].filter(Boolean);
  const tagText = tagParts.join(' ');
  const tagBracket = tagText ? ` [${tagText}]` : '';
  const roleDash = tagText ? ` - ${tagText}` : '';
  const variantParen = options.variantSuffix ? ` (${options.variantSuffix})` : '';

  const replacements: Record<string, string> = {
    '{title}': title,
    '{region}': regionText,
    '{regionParen}': regionParen,
    '{tag}': tagText,
    '{tagBracket}': tagBracket,
    '{role}': effectiveRole || '',
    '{roleDash}': roleDash,
    '{version}': effectiveVersion || '',
    '{system}': ctx.systemName || '',
    '{origName}': origBase,
  };

  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }

  // Clean dangling empty brackets/parens from custom templates
  rendered = rendered
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+-\s*$/g, '')
    .trim();

  const fullName = `${rendered || title}${variantParen}${ext}`;
  return namingConfig.romSanitizeFat32
    ? sanitizeFat32Filename(fullName, namingConfig.romMaxFilenameLen, !options.omitExtension)
    : fullName;
}

/**
 * Computes a normalized comparison stem for detecting older versions of the same game/hack
 * already present on a mounted SD card folder (e.g., matching "[Hack v1.3]" against "[Hack v1.42]").
 */
export function buildUpgradeMatchStem(filename: string): { stem: string; role: string | null; version: string | null } {
  const withoutExt = stripKnownFileExtension(filename.trim());
  const version = extractVersionFromText(withoutExt);
  const bracketMatch = withoutExt.match(/\[([^\]]+)\]/);
  let role: string | null = null;
  if (bracketMatch?.[1]) {
    role = bracketMatch[1]
      .replace(/\b(?:v\d+(?:\.\d+)*[a-z]?|rev\s*[a-z0-9]+|r\d+|build\s*[\d-]+)\b/gi, '')
      .trim() || null;
  }

  const stem = withoutExt
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\((?:v\d+[^)]*|rev\s*[^)]+)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return { stem, role: role ? role.toLowerCase() : null, version };
}
