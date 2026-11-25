export type RomNamingTypeKey =
  | 'retail'
  | 'translation'
  | 'machine_translation'
  | 'hack'
  | 'undub'
  | 'homebrew'
  | 'port'
  | 'prototype'
  | 'demo'
  | 'bootleg'
  | 'dlc';

export type RomNamingTypeOverrides = Partial<Record<RomNamingTypeKey, string>>;

export interface RomNamingConfig {
  romNamingTemplate: string;
  romNamingTypeOverrides?: RomNamingTypeOverrides;
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
  shortDesc: string;
  recommended?: boolean;
  template: string;
  exampleRetail: string;
  exampleHack: string;
  exampleStatus: string;
}

export interface RomNamingTypeMeta {
  id: RomNamingTypeKey;
  label: string;
  shortLabel: string;
  group: 'retail' | 'patch' | 'status';
  conventionHint: string;
}

export interface RomNamingPreviewSample {
  typeKey: RomNamingTypeKey;
  source: 'builtin' | 'catalog';
  itemId?: number | null;
  systemLabel: string;
  extension: string;
  context: RomNamingContext;
}

export interface RomNamingSegment {
  text: string;
  kind: 'title' | 'paren' | 'bracket' | 'ext' | 'other';
}

export interface RomNamingValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface RomNamingValidationResult {
  valid: boolean;
  issues: RomNamingValidationIssue[];
}

export interface RomNamingDetailedResult {
  filename: string;
  rawFilename: string;
  typeKey: RomNamingTypeKey;
  usedOverride: boolean;
  effectiveTemplate: string;
  wasSanitized: boolean;
  wasTruncated: boolean;
  charLength: number;
  statusTag: string | null;
  modTag: string | null;
  version: string | null;
  tokens: Record<string, string>;
  segments: RomNamingSegment[];
}

export const DEFAULT_ROM_NAMING_TEMPLATE = '{title}{regionParen}{statusParen}{modBracket}';
export const LEGACY_ROM_NAMING_TEMPLATE = '{title}{regionParen}{tagBracket}';

export const ROM_NAMING_TYPE_CATALOG: readonly RomNamingTypeMeta[] = [
  {
    id: 'retail',
    label: 'Retail ROM',
    shortLabel: 'Retail',
    group: 'retail',
    conventionHint: 'Title + (Region) + optional (Rev)',
  },
  {
    id: 'translation',
    label: 'Fan Translation',
    shortLabel: 'Translation',
    group: 'patch',
    conventionHint: 'Language patch in [T-En vX] / [T-Es]',
  },
  {
    id: 'machine_translation',
    label: 'Machine Translation',
    shortLabel: 'Machine Trans.',
    group: 'patch',
    conventionHint: 'Language-aware [T-En MTL vX]',
  },
  {
    id: 'hack',
    label: 'ROM Hack',
    shortLabel: 'ROM Hack',
    group: 'patch',
    conventionHint: 'Fan modification in [Hack vX]',
  },
  {
    id: 'undub',
    label: 'Undub',
    shortLabel: 'Undub',
    group: 'patch',
    conventionHint: 'Restored audio patch in [Undub vX]',
  },
  {
    id: 'homebrew',
    label: 'Homebrew & Indie',
    shortLabel: 'Homebrew',
    group: 'status',
    conventionHint: 'Independent release in (Homebrew)',
  },
  {
    id: 'port',
    label: 'Port / Demake',
    shortLabel: 'Port',
    group: 'status',
    conventionHint: 'Platform conversion in (Port)',
  },
  {
    id: 'prototype',
    label: 'Prototype / Beta',
    shortLabel: 'Prototype',
    group: 'status',
    conventionHint: 'Dev build status in (Proto)',
  },
  {
    id: 'demo',
    label: 'Demo / Sample',
    shortLabel: 'Demo',
    group: 'status',
    conventionHint: 'Promo/kiosk status in (Demo)',
  },
  {
    id: 'bootleg',
    label: 'Bootleg & Unlicensed',
    shortLabel: 'Unlicensed',
    group: 'status',
    conventionHint: 'Unlicensed status in (Unl)',
  },
  {
    id: 'dlc',
    label: 'DLC / Add-on',
    shortLabel: 'DLC',
    group: 'patch',
    conventionHint: 'Expansion content in [DLC]',
  },
] as const;

export const ROM_NAMING_TYPE_KEYS: readonly RomNamingTypeKey[] = ROM_NAMING_TYPE_CATALOG.map(
  (item) => item.id,
);

/** The 10 primary ROM categories shown in Step 02's live preview matrix. */
export const ROM_NAMING_PREVIEW_TYPE_KEYS: readonly RomNamingTypeKey[] = [
  'retail',
  'translation',
  'machine_translation',
  'hack',
  'undub',
  'homebrew',
  'port',
  'prototype',
  'demo',
  'bootleg',
] as const;

const ROM_NAMING_TYPE_KEY_SET = new Set<string>(ROM_NAMING_TYPE_KEYS);

export const ROM_NAMING_KNOWN_TOKENS: readonly string[] = [
  '{title}',
  '{regionParen}',
  '{region}',
  '{statusParen}',
  '{status}',
  '{modBracket}',
  '{mod}',
  '{version}',
  '{tagBracket}',
  '{tag}',
  '{roleDash}',
  '{role}',
  '{system}',
  '{origName}',
] as const;

const ROM_NAMING_KNOWN_TOKEN_SET = new Set<string>(ROM_NAMING_KNOWN_TOKENS);

export const ROM_NAMING_PRESETS: NamingPresetOption[] = [
  {
    id: 'standard',
    label: 'No-Intro + T-En Hybrid',
    shortDesc: 'Status in ( ), fan patches in [ ]',
    recommended: true,
    template: DEFAULT_ROM_NAMING_TEMPLATE,
    exampleRetail: 'Chrono Trigger (USA).sfc',
    exampleHack: 'Super Mario World (USA) [Hack v1.42].sfc',
    exampleStatus: 'Star Fox 2 (USA) (Proto).sfc',
  },
  {
    id: 'legacy-brackets',
    label: 'Uniform Brackets (Legacy)',
    shortDesc: 'All non-retail tags in [Role Version]',
    template: LEGACY_ROM_NAMING_TEMPLATE,
    exampleRetail: 'Chrono Trigger (USA).sfc',
    exampleHack: 'Super Mario World (USA) [Hack v1.42].sfc',
    exampleStatus: 'Star Fox 2 (USA) [Proto].sfc',
  },
  {
    id: 'clean-handheld',
    label: 'Clean Handheld Display',
    shortDesc: 'Compact names, omits (Region)',
    template: '{title}{statusParen}{modBracket}',
    exampleRetail: 'Chrono Trigger.sfc',
    exampleHack: 'Super Mario World [Hack v1.42].sfc',
    exampleStatus: 'Star Fox 2 (Proto).sfc',
  },
  {
    id: 'original',
    label: 'Original Inner ROM Name',
    shortDesc: 'Keep clean archive inner filename',
    template: '{origName}',
    exampleRetail: 'Chrono Trigger (USA).sfc',
    exampleHack: 'smw_hack_v142.sfc',
    exampleStatus: 'starfox2_proto.sfc',
  },
];

export const BUILT_IN_NAMING_PREVIEW_SAMPLES: readonly RomNamingPreviewSample[] = [
  {
    typeKey: 'retail',
    source: 'builtin',
    systemLabel: 'SNES',
    extension: '.sfc',
    context: {
      title: 'The Legend of Zelda: A Link to the Past',
      systemName: 'snes-roms',
      regions: ['USA'],
      fileRole: 'ROM',
      releaseTags: ['Retail ROM'],
      innerFilename: 'Legend of Zelda, The - A Link to the Past (USA).sfc',
    },
  },
  {
    typeKey: 'translation',
    source: 'builtin',
    systemLabel: 'GBA',
    extension: '.gba',
    context: {
      title: 'Mother 3',
      systemName: 'gba-roms',
      regions: ['Japan'],
      languages: ['English'],
      fileRole: 'English Translation',
      releaseTags: ['English Translation'],
      archiveFilename: 'Mother_3_T-En_v1.3.zip',
      displayLabel: 'Mother 3 English Translation v1.3',
      innerFilename: 'Mother 3 (Japan) [T-En v1.3].gba',
    },
  },
  {
    typeKey: 'machine_translation',
    source: 'builtin',
    systemLabel: 'SNES',
    extension: '.sfc',
    context: {
      title: 'Bahamut Lagoon',
      systemName: 'snes-roms',
      regions: ['Japan'],
      languages: ['English'],
      fileRole: 'Machine Translation',
      releaseTags: ['Machine Translation', 'English Translation'],
      archiveFilename: 'Bahamut_Lagoon_MTL_v1.0.zip',
      displayLabel: 'Bahamut Lagoon English MTL v1.0',
      innerFilename: 'bahamut_lagoon_en_mtl_v1.0.sfc',
    },
  },
  {
    typeKey: 'hack',
    source: 'builtin',
    systemLabel: 'SNES',
    extension: '.sfc',
    context: {
      title: 'Super Mario World: Return to Dinosaur Land',
      systemName: 'snes-roms',
      regions: ['USA'],
      fileRole: 'Hack',
      releaseTags: ['Hack'],
      archiveFilename: 'SMW_Return_Dinosaur_Land_v1.42.zip',
      displayLabel: 'Return to Dinosaur Land v1.42',
      innerFilename: 'smw_rtdl_v1.42.sfc',
    },
  },
  {
    typeKey: 'undub',
    source: 'builtin',
    systemLabel: 'PS2',
    extension: '.chd',
    context: {
      title: 'Final Fantasy X',
      systemName: 'ps2-isos',
      regions: ['USA'],
      fileRole: 'Undub',
      releaseTags: ['Undub'],
      archiveFilename: 'Final_Fantasy_X_Undub_v1.1.zip',
      displayLabel: 'Final Fantasy X Undub v1.1',
      innerFilename: 'ffx_undub_v1.1.chd',
    },
  },
  {
    typeKey: 'homebrew',
    source: 'builtin',
    systemLabel: 'NES',
    extension: '.nes',
    context: {
      title: 'Micro Mages',
      systemName: 'nes-roms',
      regions: ['World'],
      fileRole: 'Homebrew',
      releaseTags: ['Homebrew'],
      archiveFilename: 'Micro_Mages_Homebrew.zip',
      innerFilename: 'micro_mages.nes',
    },
  },
  {
    typeKey: 'port',
    source: 'builtin',
    systemLabel: 'GBA',
    extension: '.gba',
    context: {
      title: 'Celeste Classic',
      systemName: 'gba-roms',
      regions: ['World'],
      fileRole: 'Port',
      releaseTags: ['Port'],
      archiveFilename: 'Celeste_Classic_GBA_Port.zip',
      innerFilename: 'celeste_classic_port.gba',
    },
  },
  {
    typeKey: 'prototype',
    source: 'builtin',
    systemLabel: 'SNES',
    extension: '.sfc',
    context: {
      title: 'Star Fox 2',
      systemName: 'snes-roms',
      regions: ['USA'],
      fileRole: 'Prototype',
      releaseTags: ['Prototype'],
      archiveFilename: 'Star_Fox_2_Proto.zip',
      innerFilename: 'starfox2_proto.sfc',
    },
  },
  {
    typeKey: 'demo',
    source: 'builtin',
    systemLabel: 'GameCube',
    extension: '.rvz',
    context: {
      title: 'Metroid Prime',
      systemName: 'gamecube-isos',
      regions: ['USA'],
      fileRole: 'Demo',
      releaseTags: ['Demo'],
      archiveFilename: 'Metroid_Prime_Kiosk_Demo.zip',
      innerFilename: 'metroid_prime_demo.rvz',
    },
  },
  {
    typeKey: 'bootleg',
    source: 'builtin',
    systemLabel: 'NES',
    extension: '.nes',
    context: {
      title: 'Somari',
      systemName: 'nes-roms',
      regions: ['Asia'],
      fileRole: 'Bootleg',
      releaseTags: ['Bootleg'],
      archiveFilename: 'Somari_Asia_Unl.zip',
      innerFilename: 'somari_unl.nes',
    },
  },
] as const;

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
  [/\benglish\b/i, 'T-En'],
  [/\bfrench\b|français/i, 'T-Fr'],
  [/\bspanish\b|español|castellano/i, 'T-Es'],
  [/\bportuguese\b|português/i, 'T-Pt'],
  [/\bitalian\b|italiano/i, 'T-It'],
  [/\bgerman\b|deutsch/i, 'T-De'],
  [/\brussian\b/i, 'T-Ru'],
  [/\bchinese\b|mandarin|cantonese/i, 'T-Cn'],
  [/\bjapanese\b/i, 'T-Jp'],
  [/\bkorean\b/i, 'T-Ko'],
  [/\bpolish\b/i, 'T-Pl'],
  [/\barabic\b/i, 'T-Ar'],
  [/\bcatalan\b/i, 'T-Ca'],
  [/\bdutch\b|nederlands/i, 'T-Nl'],
  [/\bswedish\b|svenska/i, 'T-Sv'],
  [/\bturkish\b|türkçe/i, 'T-Tr'],
  [/\bukrainian\b/i, 'T-Uk'],
  [/\bvietnamese\b/i, 'T-Vi'],
  [/\bindonesian\b/i, 'T-Id'],
  [/\bthai\b/i, 'T-Th'],
];

const SHORT_TRANS_CODE_PATTERNS: [RegExp, string][] = [
  [/\[t\+en(?:g)?\]|\bt-?en\b/i, 'T-En'],
  [/\[t\+fr(?:e)?\]|\bt-?fr\b/i, 'T-Fr'],
  [/\[t\+es(?:p|pa)?\]|\bt-?es\b/i, 'T-Es'],
  [/\[t\+pt(?:b|g)?\]|\bt-?pt\b/i, 'T-Pt'],
  [/\[t\+it(?:a)?\]|\bt-?it\b/i, 'T-It'],
  [/\[t\+de(?:u|ger)?\]|\bt-?de\b/i, 'T-De'],
  [/\[t\+ru(?:s)?\]|\bt-?ru\b/i, 'T-Ru'],
  [/\[t\+cn\]|\[t\+zh\]|\bt-?(?:cn|zh)\b/i, 'T-Cn'],
  [/\[t\+jp(?:n)?\]|\bt-?jp\b/i, 'T-Jp'],
  [/\[t\+ko(?:r)?\]|\bt-?ko\b/i, 'T-Ko'],
  [/\[t\+pl\]|\bt-?pl\b/i, 'T-Pl'],
  [/\[t\+ar\]|\bt-?ar\b/i, 'T-Ar'],
  [/\[t\+ca\]|\bt-?ca\b/i, 'T-Ca'],
];

export function normalizeRomNamingTypeOverrides(raw: unknown): RomNamingTypeOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const out: RomNamingTypeOverrides = {};
  for (const key of ROM_NAMING_TYPE_KEYS) {
    const val = obj[key];
    if (typeof val === 'string') {
      const trimmed = val.trim().slice(0, 200);
      if (trimmed) {
        out[key] = trimmed;
      }
    }
  }
  return out;
}

export function canonicalRomNamingTypeOverridesJson(
  overrides: RomNamingTypeOverrides | null | undefined,
): string {
  const normalized = normalizeRomNamingTypeOverrides(overrides);
  const ordered: Record<string, string> = {};
  for (const key of ROM_NAMING_TYPE_KEYS) {
    if (normalized[key]) {
      ordered[key] = normalized[key]!;
    }
  }
  return JSON.stringify(ordered);
}

export function isRomNamingTypeKey(raw: string): raw is RomNamingTypeKey {
  return ROM_NAMING_TYPE_KEY_SET.has(raw);
}

function matchLanguageToShortTrans(text: string): string | null {
  for (const [regex, shortCode] of LANGUAGE_TO_SHORT_TRANS) {
    if (regex.test(text)) return shortCode;
  }
  return null;
}

function matchFilenameShortTransCode(text: string): string | null {
  for (const [regex, shortCode] of SHORT_TRANS_CODE_PATTERNS) {
    if (regex.test(text)) return shortCode;
  }
  return null;
}

function deriveTranslationLangCode(ctx: {
  fileRole?: string;
  releaseTags?: string[];
  languages?: string[];
  innerFilename?: string;
  archiveFilename?: string;
  displayLabel?: string;
}): string | null {
  const roleAndTags = [ctx.fileRole || '', ...(ctx.releaseTags || [])]
    .map((s) => s.trim())
    .filter(Boolean);

  // 1. Explicit "<Language> Translation" tags or fileRole take highest priority
  for (const entry of roleAndTags) {
    if (entry.toLowerCase().includes('translation')) {
      const code = matchLanguageToShortTrans(entry);
      if (code) return code;
    }
  }

  // 2. Explicit short codes inside inner/archive filename or display label ([T-En], [T+Eng], T-Es)
  const combinedText = `${ctx.innerFilename || ''} ${ctx.archiveFilename || ''} ${ctx.displayLabel || ''}`;
  const fromCode = matchFilenameShortTransCode(combinedText);
  if (fromCode) return fromCode;

  // 3. Language words in displayLabel or filename ("English MTL", "Spanish Patch")
  const fromDisplay = matchLanguageToShortTrans(ctx.displayLabel || '');
  if (fromDisplay) return fromDisplay;

  // 4. Release languages metadata (prefer non-Japanese target language if multiple exist, else first recognized)
  const langs = (ctx.languages || []).map((l) => l.trim()).filter(Boolean);
  const langCodes: string[] = [];
  for (const lang of langs) {
    const code = matchLanguageToShortTrans(lang);
    if (code && !langCodes.includes(code)) {
      langCodes.push(code);
    }
  }
  if (langCodes.length > 0) {
    const nonJp = langCodes.find((c) => c !== 'T-Jp');
    return nonJp ?? langCodes[0]!;
  }

  // 5. Fallback filename language hint ("_en_", "_es_", "_fr_")
  if (/(?:^|[\s._\-[(\]])(?:en|eng)(?=$|[\s._\-)\]])/i.test(combinedText)) return 'T-En';
  if (/(?:^|[\s._\-[(\]])(?:es|esp)(?=$|[\s._\-)\]])/i.test(combinedText)) return 'T-Es';
  if (/(?:^|[\s._\-[(\]])(?:fr|fre)(?=$|[\s._\-)\]])/i.test(combinedText)) return 'T-Fr';
  if (/(?:^|[\s._\-[(\]])(?:pt|pt-?br)(?=$|[\s._\-)\]])/i.test(combinedText)) return 'T-Pt';

  return null;
}

interface DualChannelTags {
  typeKey: RomNamingTypeKey;
  statusTag: string | null;
  modTag: string | null;
  legacyRoleTag: string | null;
}

function resolveDualChannelTags(ctx: {
  fileRole?: string;
  releaseTags?: string[];
  languages?: string[];
  innerFilename?: string;
  archiveFilename?: string;
  displayLabel?: string;
}): DualChannelTags {
  const candidates = [ctx.fileRole || '', ...(ctx.releaseTags || [])]
    .map((s) => s.trim())
    .filter(Boolean);
  const lowerCandidates = candidates.map((s) => s.toLowerCase());
  const combined = `${ctx.innerFilename || ''} ${ctx.archiveFilename || ''} ${ctx.displayLabel || ''}`;
  const combinedLower = combined.toLowerCase();

  // --- Channel A: Commercial / Development Origin Status -> Parentheses () ---
  let statusTag: string | null = null;
  for (const lower of lowerCandidates) {
    if (lower === 'prototype' || lower === 'proto' || lower === 'beta') {
      statusTag = 'Proto';
      break;
    }
    if (lower === 'demo' || lower === 'sample') {
      statusTag = 'Demo';
      break;
    }
    if (lower === 'homebrew' || lower === 'indie' || lower === 'aftermarket') {
      statusTag = 'Homebrew';
      break;
    }
    if (lower === 'port' || lower === 'demake') {
      statusTag = 'Port';
      break;
    }
    if (lower === 'bootleg' || lower === 'unlicensed' || lower === 'pirate') {
      statusTag = 'Unl';
      break;
    }
    if (lower === 'original rom') {
      statusTag = 'Original';
      break;
    }
  }

  if (!statusTag) {
    if (/\b(proto|prototype)\b/i.test(combinedLower)) statusTag = 'Proto';
    else if (/\b(demo|kiosk\s*demo|sample)\b/i.test(combinedLower)) statusTag = 'Demo';
    else if (/\b(homebrew)\b/i.test(combinedLower)) statusTag = 'Homebrew';
    else if (/\b(port)\b/i.test(combinedLower)) statusTag = 'Port';
    else if (/\b(bootleg|unlicensed|pirate)\b|\(unl\)/i.test(combinedLower)) statusTag = 'Unl';
  }

  // --- Channel B: Post-Release Fan Patch / Modification -> Square Brackets [] ---
  let modTag: string | null = null;
  let isMachineTranslation = false;
  let isTranslation = false;

  for (const lower of lowerCandidates) {
    if (lower === 'machine translation' || lower === 'mtl' || lower.includes('machine translation')) {
      isMachineTranslation = true;
      break;
    }
  }
  if (!isMachineTranslation && /\b(mtl|machine\s*trans(?:lation)?)\b/i.test(combinedLower)) {
    isMachineTranslation = true;
  }

  if (isMachineTranslation) {
    const langCode = deriveTranslationLangCode(ctx);
    modTag = langCode ? `${langCode} MTL` : 'MTL';
  } else {
    for (const raw of candidates) {
      const lower = raw.toLowerCase();
      if (lower === 'retail rom' || lower === 'rom' || lower === 'bios') continue;
      if (lower.includes('translation')) {
        isTranslation = true;
        const fromEntry = matchLanguageToShortTrans(raw) || deriveTranslationLangCode(ctx);
        modTag = fromEntry || 'Trans';
        break;
      }
      if (lower === 'undub') {
        modTag = 'Undub';
        break;
      }
      if (lower === 'hack' || lower === 'rom hack') {
        modTag = 'Hack';
        break;
      }
      if (lower === 'dlc') {
        modTag = 'DLC';
        break;
      }
      if (lower === 'patch') {
        modTag = 'Patch';
        break;
      }
    }

    if (!modTag) {
      const codeFromFilename = matchFilenameShortTransCode(combined);
      if (codeFromFilename) {
        isTranslation = true;
        modTag = codeFromFilename;
      } else if (/\b(undub)\b/i.test(combinedLower)) {
        modTag = 'Undub';
      } else if (/\b(hack|romhack|redux|rebalance|improvement|colorization|fastrom|msu-?1)\b/i.test(combinedLower)) {
        modTag = 'Hack';
      }
    }
  }

  // Determine canonical primary RomNamingTypeKey (used for per-type override lookup)
  let typeKey: RomNamingTypeKey = 'retail';
  if (isMachineTranslation) typeKey = 'machine_translation';
  else if (isTranslation || (modTag && (modTag.startsWith('T-') || modTag === 'Trans'))) typeKey = 'translation';
  else if (modTag === 'Undub') typeKey = 'undub';
  else if (modTag === 'Hack' || modTag === 'Patch') typeKey = 'hack';
  else if (modTag === 'DLC') typeKey = 'dlc';
  else if (statusTag === 'Proto') typeKey = 'prototype';
  else if (statusTag === 'Demo') typeKey = 'demo';
  else if (statusTag === 'Homebrew') typeKey = 'homebrew';
  else if (statusTag === 'Port') typeKey = 'port';
  else if (statusTag === 'Unl') typeKey = 'bootleg';

  // Legacy single-role string (for backward-compatible {role}, {tagBracket}, {roleDash})
  const legacyRoleTag = modTag || statusTag || null;

  return {
    typeKey,
    statusTag,
    modTag,
    legacyRoleTag,
  };
}

export function classifyRomNamingType(ctx: RomNamingContext): RomNamingTypeKey {
  return resolveDualChannelTags(ctx).typeKey;
}

export function deriveShortRoleTag(
  fileRole?: string,
  releaseTags: string[] = [],
  innerFilename = '',
  archiveFilename = '',
  displayLabel = '',
  languages: string[] = [],
): string | null {
  return resolveDualChannelTags({
    fileRole,
    releaseTags,
    languages,
    innerFilename,
    archiveFilename,
    displayLabel,
  }).legacyRoleTag;
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
  return rawTitle.replace(/\s+/g, ' ').trim();
}

export function sanitizeFat32Filename(raw: string, maxLen = 0, hasExtension = true): string {
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

export function resolveEffectiveTemplateForType(
  namingConfig: RomNamingConfig,
  typeKey: RomNamingTypeKey,
): { template: string; usedOverride: boolean } {
  const override = namingConfig.romNamingTypeOverrides?.[typeKey]?.trim();
  if (override) {
    return { template: override, usedOverride: true };
  }
  const base = (namingConfig.romNamingTemplate || DEFAULT_ROM_NAMING_TEMPLATE).trim();
  return {
    template: base || DEFAULT_ROM_NAMING_TEMPLATE,
    usedOverride: false,
  };
}

/**
 * Splits a formatted ROM filename into subtle semantic parts so the live preview
 * can differentiate base titles, parenthetical origin/status tags, bracketed fan patches,
 * and file extensions without using cluttered pill badges.
 */
export function tokenizeFormattedFilename(filename: string): RomNamingSegment[] {
  if (!filename) return [];
  const extMatch = filename.match(/^(.*?)(\.[a-z0-9]{1,8})$/i);
  const body = extMatch ? extMatch[1] : filename;
  const ext = extMatch ? extMatch[2] : '';

  const segments: RomNamingSegment[] = [];
  const tokenRe = /(\([^)]*\)|\[[^\]]*\])/g;
  let lastIndex = 0;
  let seenTitle = false;

  for (const match of body.matchAll(tokenRe)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      const chunk = body.slice(lastIndex, idx);
      segments.push({ text: chunk, kind: !seenTitle && chunk.trim() ? 'title' : 'other' });
      if (chunk.trim()) seenTitle = true;
    }
    const tokenText = match[0];
    segments.push({
      text: tokenText,
      kind: tokenText.startsWith('[') ? 'bracket' : 'paren',
    });
    lastIndex = idx + tokenText.length;
  }

  if (lastIndex < body.length) {
    const tail = body.slice(lastIndex);
    segments.push({ text: tail, kind: !seenTitle && tail.trim() ? 'title' : 'other' });
  }

  if (ext) {
    segments.push({ text: ext, kind: 'ext' });
  }

  return segments;
}

export function validateRomNamingTemplate(template: string): RomNamingValidationResult {
  const trimmed = template.trim();
  const issues: RomNamingValidationIssue[] = [];

  if (!trimmed) {
    issues.push({
      severity: 'error',
      message: 'Template is empty — it will fall back to the default hybrid pattern.',
    });
    return { valid: false, issues };
  }

  // Check brace balance
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceError = false;
  let parenError = false;
  let bracketError = false;

  for (const ch of trimmed) {
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) braceError = true;
    } else if (ch === '(') parenDepth += 1;
    else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth < 0) parenError = true;
    } else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) bracketError = true;
    }
  }

  if (braceError || braceDepth !== 0) {
    issues.push({
      severity: 'error',
      message: 'Unmatched curly brace "{" or "}" in template token.',
    });
  }
  if (parenError || parenDepth !== 0) {
    issues.push({
      severity: 'warning',
      message: 'Unbalanced parentheses "(" or ")" in template.',
    });
  }
  if (bracketError || bracketDepth !== 0) {
    issues.push({
      severity: 'warning',
      message: 'Unbalanced square brackets "[" or "]" in template.',
    });
  }

  // Check unknown tokens
  const foundTokens = trimmed.match(/\{[^{}]*\}/g) || [];
  const unknownSeen = new Set<string>();
  for (const tok of foundTokens) {
    if (!ROM_NAMING_KNOWN_TOKEN_SET.has(tok) && !unknownSeen.has(tok)) {
      unknownSeen.add(tok);
      issues.push({
        severity: 'error',
        message: `Unrecognized token ${tok} — it will appear literally in exported filenames.`,
      });
    }
  }

  if (!trimmed.includes('{title}') && !trimmed.includes('{origName}')) {
    issues.push({
      severity: 'warning',
      message: 'Template omits {title} and {origName} — multiple games may collide into similar filenames.',
    });
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}

export function formatPreparedRomNameDetailed(
  ctx: RomNamingContext,
  extensionWithDot: string,
  namingConfig: RomNamingConfig,
  options: { variantSuffix?: string | null; omitExtension?: boolean } = {},
): RomNamingDetailedResult {
  const ext = options.omitExtension
    ? ''
    : extensionWithDot
      ? (extensionWithDot.startsWith('.') ? extensionWithDot.toLowerCase() : `.${extensionWithDot.toLowerCase()}`)
      : '';

  const dual = resolveDualChannelTags(ctx);
  const { template, usedOverride } = resolveEffectiveTemplateForType(namingConfig, dual.typeKey);

  const rawBaseSource = ctx.innerFilename || ctx.archiveFilename || ctx.title || 'rom';
  const origBase = stripKnownFileExtension(rawBaseSource.trim()).trim();

  const title = cleanTitleBase(ctx.title || origBase);
  const regions = extractRegionsList(ctx);
  const regionText = regions.join(', ');
  const titleLower = title.toLowerCase();

  const regionParen =
    regionText && !titleLower.includes(`(${regionText.toLowerCase()})`)
      ? ` (${regionText})`
      : '';

  const version = extractVersionToken(ctx);
  const effectiveVersion =
    version && !titleLower.includes(version.toLowerCase()) ? version : null;

  const effectiveStatus =
    dual.statusTag &&
    !titleLower.includes(`(${dual.statusTag.toLowerCase()}`) &&
    !titleLower.includes(`[${dual.statusTag.toLowerCase()}`)
      ? dual.statusTag
      : null;

  const effectiveMod =
    dual.modTag && !titleLower.includes(`[${dual.modTag.toLowerCase()}`)
      ? dual.modTag
      : null;

  const effectiveRole =
    dual.legacyRoleTag &&
    !titleLower.includes(`[${dual.legacyRoleTag.toLowerCase()}`) &&
    !titleLower.includes(`(${dual.legacyRoleTag.toLowerCase()}`)
      ? dual.legacyRoleTag
      : null;

  // Smart version placement:
  // - Patched ROMs (mod present): version goes inside [Mod Version] -> {modBracket}, while {statusParen} stays clean (Status)
  // - Status-only ROMs (Homebrew/Proto/Port/Demo/Unl): version goes inside (Status Version) -> {statusParen}
  // - Retail ROMs with revision (Rev A / v1.1): revision goes inside (Rev A) -> {statusParen}
  const modParts = effectiveMod ? [effectiveMod, effectiveVersion].filter(Boolean) : [];
  const modBracket = modParts.length > 0 ? ` [${modParts.join(' ')}]` : '';

  const statusParts = effectiveStatus
    ? effectiveMod
      ? [effectiveStatus]
      : [effectiveStatus, effectiveVersion].filter(Boolean)
    : !effectiveMod && effectiveVersion
      ? [effectiveVersion]
      : [];
  const statusParen = statusParts.length > 0 ? ` (${statusParts.join(' ')})` : '';

  // Legacy combined tag tokens
  const tagParts = [effectiveRole, effectiveVersion].filter(Boolean);
  const tagText = tagParts.join(' ');
  const tagBracket = tagText ? ` [${tagText}]` : '';
  const roleDash = tagText ? ` - ${tagText}` : '';
  const variantParen = options.variantSuffix ? ` (${options.variantSuffix})` : '';

  const tokens: Record<string, string> = {
    '{title}': title,
    '{region}': regionText,
    '{regionParen}': regionParen,
    '{status}': effectiveStatus || '',
    '{statusParen}': statusParen,
    '{mod}': effectiveMod || '',
    '{modBracket}': modBracket,
    '{tag}': tagText,
    '{tagBracket}': tagBracket,
    '{role}': effectiveRole || '',
    '{roleDash}': roleDash,
    '{version}': effectiveVersion || '',
    '{system}': ctx.systemName || '',
    '{origName}': origBase,
  };

  let rawFilename: string;
  if (template === '{origName}') {
    rawFilename = options.variantSuffix ? `${origBase} (${options.variantSuffix})${ext}` : `${origBase}${ext}`;
  } else {
    let rendered = template;
    for (const [token, value] of Object.entries(tokens)) {
      rendered = rendered.split(token).join(value);
    }

    // Clean dangling empty brackets/parens from custom templates
    rendered = rendered
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+-\s*$/g, '')
      .trim();

    rawFilename = `${rendered || title}${variantParen}${ext}`;
  }

  let filename = rawFilename;
  let wasSanitized = false;
  let wasTruncated = false;

  if (namingConfig.romSanitizeFat32) {
    const sanitizedNoLimit = sanitizeFat32Filename(rawFilename, 0, !options.omitExtension);
    wasSanitized = sanitizedNoLimit !== rawFilename;
    filename = sanitizeFat32Filename(
      rawFilename,
      namingConfig.romMaxFilenameLen,
      !options.omitExtension,
    );
    wasTruncated = namingConfig.romMaxFilenameLen >= 12 && filename.length < sanitizedNoLimit.length;
  } else if (namingConfig.romMaxFilenameLen >= 12 && rawFilename.length > namingConfig.romMaxFilenameLen) {
    // Respect max length limit even if FAT32 char replacement is off
    const extMatch = !options.omitExtension ? rawFilename.match(/^(.*)(\.[a-z0-9]{1,8})$/i) : null;
    const base = extMatch ? extMatch[1] : rawFilename;
    const fileExt = extMatch ? extMatch[2] : '';
    const allowedBase = Math.max(4, namingConfig.romMaxFilenameLen - fileExt.length);
    if (base.length > allowedBase) {
      filename = `${base.slice(0, allowedBase).trim() || 'rom'}${fileExt}`;
      wasTruncated = true;
    }
  }

  return {
    filename,
    rawFilename,
    typeKey: dual.typeKey,
    usedOverride,
    effectiveTemplate: template,
    wasSanitized,
    wasTruncated,
    charLength: filename.length,
    statusTag: effectiveStatus,
    modTag: effectiveMod,
    version: effectiveVersion,
    tokens,
    segments: tokenizeFormattedFilename(filename),
  };
}

export function formatPreparedRomName(
  ctx: RomNamingContext,
  extensionWithDot: string,
  namingConfig: RomNamingConfig,
  options: { variantSuffix?: string | null; omitExtension?: boolean } = {},
): string {
  return formatPreparedRomNameDetailed(ctx, extensionWithDot, namingConfig, options).filename;
}

const KNOWN_STATUS_PAREN_RE =
  /\((proto(?:type)?|beta|alpha|demo|sample|homebrew|indie|aftermarket|port|demake|unl|unlicensed|pirate|bootleg|original)(?:\s+[^)]*)?\)/gi;

function normalizeRoleForStem(rawRole: string): string {
  const cleaned = rawRole
    .replace(/\b(?:v\d+(?:\.\d+)*[a-z]?(?:-(?:fix|hotfix|final|rc\d*|beta\d*|alpha\d*))?|rev\s*[a-z0-9]+(?:\.\d+)?|r\d+[a-z]?|build\s*[\d-]+|beta\s*\d*|alpha\s*\d*|rc\s*\d*)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return '';
  if (cleaned === 'prototype') return 'proto';
  if (cleaned === 'unlicensed' || cleaned === 'bootleg' || cleaned === 'pirate') return 'unl';
  if (cleaned === 'sample') return 'demo';
  if (cleaned === 'indie' || cleaned === 'aftermarket') return 'homebrew';
  // Normalize bare "mtl" and language-prefixed "t-en mtl" cleanly into consistent "mtl" family
  if (/^(?:t-[a-z]{2}\s+)?mtl$/.test(cleaned)) return 'mtl';
  return cleaned;
}

/**
 * Computes a normalized comparison stem for detecting older versions of the same game/hack
 * already present on a mounted SD card folder across both legacy `[Proto v0.9]` and hybrid
 * `(Proto v1.0)` / `[Hack v1.42]` naming conventions.
 */
export function buildUpgradeMatchStem(filename: string): { stem: string; role: string | null; version: string | null } {
  const withoutExt = stripKnownFileExtension(filename.trim());
  const version = extractVersionFromText(withoutExt);

  const roleParts: string[] = [];

  // 1. Capture known parenthetical status tags like (Proto), (Homebrew v1.2), (Unl), (Demo)
  for (const m of withoutExt.matchAll(KNOWN_STATUS_PAREN_RE)) {
    const norm = normalizeRoleForStem(m[1] || '');
    if (norm && !roleParts.includes(norm)) {
      roleParts.push(norm);
    }
  }

  // 2. Capture bracketed patch/role tags like [Hack v1.42], [T-En v1.3], [Proto]
  for (const m of withoutExt.matchAll(/\[([^\]]+)\]/g)) {
    const norm = normalizeRoleForStem(m[1] || '');
    if (norm && !roleParts.includes(norm)) {
      roleParts.push(norm);
    }
  }

  const stem = withoutExt
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(KNOWN_STATUS_PAREN_RE, ' ')
    .replace(/\((?:v\d+[^)]*|rev\s*[^)]+|beta\s*\d*[^)]*|rc\s*\d*[^)]*)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return {
    stem,
    role: roleParts.length > 0 ? roleParts.join('+') : null,
    version,
  };
}
