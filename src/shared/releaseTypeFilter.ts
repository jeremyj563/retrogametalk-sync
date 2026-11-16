export interface CuratedReleaseTypeOption {
  id: string;
  label: string;
  description: string;
}

export interface TranslationLanguageOption {
  id: string;
  label: string;
  shortCode: string;
  isMachine?: boolean;
}

export interface ReleaseTypePreset {
  id: string;
  label: string;
  values: string[];
}

export const TRANSLATIONS_ALL_KEY = 'translations';
export const MACHINE_TRANSLATION_KEY = 'machine_translation';

export const CURATED_RELEASE_TYPE_OPTIONS: readonly CuratedReleaseTypeOption[] = [
  {
    id: 'retail',
    label: 'Retail ROM',
    description: 'Official commercial cartridge, disc, and arcade dumps',
  },
  {
    id: 'translations',
    label: 'Translations',
    description: 'Fan-translated patches and pre-patched releases by language',
  },
  {
    id: 'hack',
    label: 'ROM Hacks',
    description: 'Gameplay mods, Redux, MSU-1, colorizations, and randomizers',
  },
  {
    id: 'undub',
    label: 'Undub',
    description: 'Original Japanese/native voice audio restored in localized releases',
  },
  {
    id: 'homebrew',
    label: 'Homebrew & Indie',
    description: 'Community-developed games, Indie, and Doujin releases',
  },
  {
    id: 'port',
    label: 'Ports',
    description: 'Cross-platform ports and reverse-engineered source conversions',
  },
  {
    id: 'bios',
    label: 'BIOS & System',
    description: 'Console firmware, system boot ROMs, and add-on BIOS files',
  },
  {
    id: 'demo_proto',
    label: 'Demos & Prototypes',
    description: 'Unreleased prototypes, betas, samples, and kiosk demos',
  },
  {
    id: 'bootleg',
    label: 'Bootleg & Unlicensed',
    description: 'Unlicensed originals, pirate conversions, and multicarts',
  },
  {
    id: 'dlc',
    label: 'DLC & Updates',
    description: 'Downloadable add-on content, OST packages, and title updates',
  },
  {
    id: 'psx2psp',
    label: 'PSX2PSP & Eboot',
    description: 'PSP-converted PS1 EBOOT and PSN Eboot packages',
  },
];

export const TRANSLATION_LANGUAGE_OPTIONS: readonly TranslationLanguageOption[] = [
  { id: 'translation:english', label: 'English', shortCode: 'EN' },
  { id: 'translation:spanish', label: 'Spanish', shortCode: 'ES' },
  { id: 'translation:french', label: 'French', shortCode: 'FR' },
  { id: 'translation:portuguese', label: 'Portuguese', shortCode: 'PT' },
  { id: 'translation:german', label: 'German', shortCode: 'DE' },
  { id: 'translation:italian', label: 'Italian', shortCode: 'IT' },
  { id: 'translation:russian', label: 'Russian', shortCode: 'RU' },
  { id: 'translation:chinese', label: 'Chinese', shortCode: 'ZH' },
  { id: 'translation:korean', label: 'Korean', shortCode: 'KO' },
  { id: 'translation:polish', label: 'Polish', shortCode: 'PL' },
  { id: 'translation:arabic', label: 'Arabic', shortCode: 'AR' },
  { id: 'translation:catalan', label: 'Catalan', shortCode: 'CA' },
  { id: 'translation:other', label: 'Other Languages', shortCode: 'OTHER' },
  {
    id: MACHINE_TRANSLATION_KEY,
    label: 'Machine / AI Assisted',
    shortCode: 'MTL',
    isMachine: true,
  },
];

export const RELEASE_TYPE_PRESETS: readonly ReleaseTypePreset[] = [
  {
    id: 'all',
    label: 'All Release Types',
    values: [],
  },
  {
    id: 'retail_only',
    label: 'Retail Only',
    values: ['retail'],
  },
  {
    id: 'retail_english',
    label: 'Retail + English Translations',
    values: ['retail', 'translation:english'],
  },
  {
    id: 'retail_hacks_english',
    label: 'Retail + Hacks + English',
    values: ['retail', 'hack', 'translation:english'],
  },
  {
    id: 'all_translations',
    label: 'All Fan Translations',
    values: ['translations'],
  },
];

const CURATED_LABEL_BY_ID = new Map<string, string>([
  ...CURATED_RELEASE_TYPE_OPTIONS.map((o) => [o.id, o.label] as const),
  ...TRANSLATION_LANGUAGE_OPTIONS.map((o) => [
    o.id,
    o.isMachine ? o.label : `${o.label} Translation`,
  ] as const),
]);

const VALID_TYPE_KEYS = new Set<string>([
  ...CURATED_RELEASE_TYPE_OPTIONS.map((o) => o.id),
  ...TRANSLATION_LANGUAGE_OPTIONS.map((o) => o.id),
]);

const CANONICAL_ORDER = [
  'retail',
  'translations',
  ...TRANSLATION_LANGUAGE_OPTIONS.map((o) => o.id),
  'hack',
  'undub',
  'homebrew',
  'port',
  'bios',
  'demo_proto',
  'bootleg',
  'dlc',
  'psx2psp',
];

export function isTranslationTypeKey(key: string): boolean {
  return (
    key === TRANSLATIONS_ALL_KEY ||
    key === MACHINE_TRANSLATION_KEY ||
    key.startsWith('translation:')
  );
}

export function isHumanTranslationLanguageKey(key: string): boolean {
  return key.startsWith('translation:');
}

export function normalizeAllowedReleaseTypes(raw: unknown): string[] {
  let items: string[] = [];
  if (Array.isArray(raw)) {
    items = raw.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  } else if (typeof raw === 'string') {
    items = raw
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }

  const deduped = new Set<string>();
  for (const item of items) {
    if (VALID_TYPE_KEYS.has(item)) {
      deduped.add(item);
    }
  }

  // If master 'translations' is enabled, it already covers all human language sub-keys
  if (deduped.has(TRANSLATIONS_ALL_KEY)) {
    for (const opt of TRANSLATION_LANGUAGE_OPTIONS) {
      if (!opt.isMachine) {
        deduped.delete(opt.id);
      }
    }
  }

  return Array.from(deduped).sort((a, b) => {
    const idxA = CANONICAL_ORDER.indexOf(a);
    const idxB = CANONICAL_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}

const KNOWN_LANGUAGE_SLUGS = new Set([
  'english',
  'spanish',
  'french',
  'portuguese',
  'german',
  'italian',
  'russian',
  'chinese',
  'korean',
  'polish',
  'arabic',
  'catalan',
]);

export function classifyReleaseTagToTypeKey(rawTag: string): string {
  const lower = rawTag.trim().toLowerCase();
  if (!lower || lower === 'retail rom' || lower === 'rom' || lower === 'original rom') {
    return 'retail';
  }
  if (lower === 'machine translation' || lower === 'ai assisted') {
    return MACHINE_TRANSLATION_KEY;
  }
  if (lower === 'undub') return 'undub';
  if (lower === 'hack') return 'hack';
  if (lower === 'homebrew' || lower === 'indie' || lower === 'doujin') return 'homebrew';
  if (lower === 'port') return 'port';
  if (lower === 'bios' || lower === 'bios-files') return 'bios';
  if (lower === 'prototype' || lower === 'demo') return 'demo_proto';
  if (lower === 'bootleg' || lower.includes('unlicensed')) return 'bootleg';
  if (lower === 'dlc') return 'dlc';
  if (lower === 'psx2psp' || lower === 'psn eboot') return 'psx2psp';
  if (lower === 'translation' || lower === 'translations') return 'translation:other';

  const transMatch = lower.match(/^([a-z\s-]+?)\s+(?:translation|patched)$/i);
  if (transMatch?.[1]) {
    const langSlug = transMatch[1].trim().toLowerCase();
    if (KNOWN_LANGUAGE_SLUGS.has(langSlug)) {
      return `translation:${langSlug}`;
    }
    return 'translation:other';
  }

  if (lower.includes('translation') || lower.includes('patched')) {
    return 'translation:other';
  }

  return 'retail';
}

export function classifyReleaseTagsToTypeKeys(tags: string[], systemName?: string | null): string[] {
  const keys = new Set<string>();
  for (const tag of tags) {
    keys.add(classifyReleaseTagToTypeKey(tag));
  }
  if (keys.size === 0) {
    if (systemName?.trim().toLowerCase() === 'bios-files') {
      keys.add('bios');
    } else {
      keys.add('retail');
    }
  }
  return Array.from(keys);
}

export function classifyFileRoleToTypeKeys(
  fileRole: string,
  releaseTags: string[] = [],
  systemName?: string | null,
): string[] {
  const lower = fileRole.trim().toLowerCase();
  if (lower === 'original rom') {
    return ['retail'];
  }
  if (lower === 'rom') {
    // Generic 'ROM' file inherits specific release-level tags (e.g. Hack, Port, Homebrew) if non-retail tags exist,
    // otherwise it is a Retail ROM.
    const releaseKeys = classifyReleaseTagsToTypeKeys(releaseTags, systemName);
    return releaseKeys.length > 0 ? releaseKeys : ['retail'];
  }
  if (lower === 'patch') {
    const releaseKeys = classifyReleaseTagsToTypeKeys(releaseTags, systemName).filter(
      (k) => k === 'hack' || k === 'undub' || isTranslationTypeKey(k),
    );
    return releaseKeys.length > 0 ? releaseKeys : ['hack', TRANSLATIONS_ALL_KEY];
  }
  return [classifyReleaseTagToTypeKey(fileRole)];
}

export function isTypeKeyAllowed(typeKey: string, allowedTypes: string[]): boolean {
  if (allowedTypes.length === 0) return true;
  if (allowedTypes.includes(typeKey)) return true;
  if (typeKey.startsWith('translation:') && allowedTypes.includes(TRANSLATIONS_ALL_KEY)) {
    return true;
  }
  if (typeKey === TRANSLATIONS_ALL_KEY) {
    return allowedTypes.some((k) => k === TRANSLATIONS_ALL_KEY || k.startsWith('translation:'));
  }
  return false;
}

export function evaluateReleaseTypeMatch(
  detectedTypeKeys: string[],
  allowedTypes: string[],
): {
  allowed: boolean;
  matchedKeys: string[];
  rejectedKeys: string[];
  detectedLabels: string[];
} {
  const uniqueKeys = Array.from(new Set(detectedTypeKeys));
  const detectedLabels = uniqueKeys.map((k) => CURATED_LABEL_BY_ID.get(k) || k);

  if (allowedTypes.length === 0) {
    return {
      allowed: true,
      matchedKeys: uniqueKeys,
      rejectedKeys: [],
      detectedLabels,
    };
  }

  const matchedKeys: string[] = [];
  const rejectedKeys: string[] = [];
  for (const key of uniqueKeys) {
    if (isTypeKeyAllowed(key, allowedTypes)) {
      matchedKeys.push(key);
    } else {
      rejectedKeys.push(key);
    }
  }

  return {
    allowed: matchedKeys.length > 0,
    matchedKeys,
    rejectedKeys,
    detectedLabels,
  };
}

export function formatTypeKeyLabel(key: string): string {
  return CURATED_LABEL_BY_ID.get(key) || key;
}

export function formatAllowedReleaseTypesSummary(allowedTypes: string[]): string {
  const normalized = normalizeAllowedReleaseTypes(allowedTypes);
  if (normalized.length === 0) {
    return 'All Types (Unfiltered)';
  }
  const presetMatch = RELEASE_TYPE_PRESETS.find(
    (p) =>
      p.values.length > 0 &&
      p.values.length === normalized.length &&
      p.values.every((v, idx) => normalized[idx] === v),
  );
  if (presetMatch) {
    return presetMatch.label;
  }
  const labels = normalized.map(formatTypeKeyLabel);
  if (labels.length <= 3) {
    return labels.join(' · ');
  }
  return `${labels.slice(0, 2).join(' · ')} +${labels.length - 2} more`;
}
