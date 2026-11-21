import { load as loadHtml } from 'cheerio';

const HTML_ENTITY_PATTERN = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i;

export function hasHtmlEntities(text: string): boolean {
  return Boolean(text && text.includes('&') && HTML_ENTITY_PATTERN.test(text));
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  if (!text.includes('&') && !text.includes('<')) {
    return text.trim();
  }
  let current = loadHtml(`<span>${text}</span>`).text().trim();
  for (let pass = 0; pass < 2 && hasHtmlEntities(current); pass += 1) {
    // Protect any literal '<' characters produced by prior decoding from being parsed as HTML tags
    const shielded = current.replace(/</g, '\uE000LT\uE000');
    const decoded = loadHtml(`<span>${shielded}</span>`).text().replace(/\uE000LT\uE000/g, '<').trim();
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

export interface FileRoleClassificationContext {
  genres?: string[];
  languages?: string[];
  sources?: string[];
  title?: string;
  systemName?: string;
  siblingFilenames?: readonly string[];
}

const ARCHIVE_OR_ROM_EXT_RE =
  /\.(zip|7z|rar|tar|gz|xz|zst|nes|fds|sfc|smc|gb|gbc|gba|nds|dsi|3ds|cia|n64|z64|v64|n64|gcm|iso|rvz|wbfs|chd|cue|bin|pbp|cso|sms|gg|md|gen|32x|pce|ngp|ngc|ws|wsc|rom|dsk|mx1|mx2|ips|bps|ups|xdelta|ppf|vcdiff)$/i;

const REGION_PAREN_RE =
  /\((?:japan|usa|europe|world|korea|china|asia|australia|france|germany|spain|italy|brazil|netherlands|sweden|canada|taiwan|hong\s*kong|uk|j|u|e|w|ue|ju|je)(?:\s*,\s*(?:japan|usa|europe|world|korea|china|asia|australia|france|germany|spain|italy|brazil|netherlands|sweden|canada|taiwan|hong\s*kong|uk|j|u|e|w))*\)/i;

/**
 * Known idiomatic game/hack titles that contain a language word which is NOT a translation indicator.
 */
const FALSE_POSITIVE_LANGUAGE_PHRASE_RE =
  /\b(french\s+vanilla|french\s+kiss|french\s+toast|italian\s+job|russian\s+attack|chinese\s+checkers|english\s+training|my\s+(?:french|spanish|japanese|chinese)\s+coach|(?:graphics|audio|visual|gameplay|sprite|music|ui)\s+polish)\b/gi;

/**
 * Standard unmodified No-Intro / Redump / GoodTools parenthetical or bracketed dump tags.
 * Any tag outside this set (e.g. `(QoL v1.2)`, `(No-Touch v1.1)`, `(FastText v1.0 NoOneee)`,
 * `(Monster Trainer v1.0)`, `(NTSC Patched)`, `(v1.3)`) signals a modified/hacked ROM rather than
 * a clean bundled base dump.
 */
const STANDARD_BASE_DUMP_REGION_TOKEN =
  '(?:japan|usa|europe|world|korea|china|asia|australia|france|germany|spain|italy|brazil|netherlands|sweden|norway|denmark|finland|canada|taiwan|hong\\s*kong|uk|scandinavia|latin\\s*america|unknown|j|u|e|w|ue|ju|je|f|g|s|i|k|c|a|b|nl|sw)';

const STANDARD_BASE_DUMP_LANG_CODE =
  '(?:en|ja|jp|fr|de|es|it|nl|pt|sv|no|da|fi|zh|ko|ru|pl|ca|el|tr|ar|cs|hu|he|uk|vi|th|id|ms|hi|hr|ro|sk|sl|sr|bg|en-gb|en-us|pt-br|es-xl|zh-hans|zh-hant)';

const STANDARD_BASE_DUMP_TAG_RE = new RegExp(
  `^(?:` +
    `${STANDARD_BASE_DUMP_REGION_TOKEN}(?:\\s*,\\s*${STANDARD_BASE_DUMP_REGION_TOKEN})*` +
    `|${STANDARD_BASE_DUMP_LANG_CODE}(?:\\s*,\\s*${STANDARD_BASE_DUMP_LANG_CODE})*` +
    `|rev\\s*[a-z0-9.]+` +
    `|unl` +
    `|disc\\s*\\d+(?:\\s*of\\s*\\d+)?` +
    `|disk\\s*\\d+(?:\\s*of\\s*\\d+)?` +
    `|side\\s*[ab\\d]+` +
    `|alt(?:\\s*\\d+)?` +
    `|sgb\\s*enhanced(?:\\s*,\\s*gb\\s*compatible)?` +
    `|gb\\s*compatible` +
    `|dsi\\s*enhanced` +
    `|rumble\\s*version` +
    `|virtual\\s*console` +
    `|switch\\s*online` +
    `|nintendo\\s*power` +
    `|np` +
    `|classic\\s*mini` +
    `|mini` +
    `|collection\\s*of\\s*mana` +
    `|lgc` +
    `|competition\\s*cart` +
    `|1m|2m|4m` +
    `|[!]|b\\d*|a\\d*|o\\d*|f\\d*|h\\d*|p\\d*|t\\d*` +
    `)$`,
  'i',
);

const MOD_OR_VERSION_CUE_RE =
  /(?:^|[\s(\[_-])v\d+(?:\.\d+)*[a-z]?(?:[\s)\]._-]|$)|\b(hack|romhack|patch|patched|mod|modded|qol|redux|rebalance|rebalanced|randomizer|rando|improvement|improved|enhanced|restored|restoration|uncensored|widescreen|60fps|de-?blur|deblur|bugfix|fix|fixed|hard[\s_-]+mode|easy[\s_-]+mode|no-?touch|touchless|fasttext|singleplayer|co-?op|coop|trainer|slot-?2|ntsc[\s_-]+patched|pal[\s_-]+patched|colorization|colorized|msu-?1|sa-?1|fastrom|aftermarket|remake|remaster|deluxe|edition|custom|remix|plus|dx)\b/i;

const EXPLICIT_HACK_FILENAME_RE =
  /\b(hack|romhack|redux|rebalance|rebalanced|randomizer|rando|improvement|improved|colorization|colorized|msu-?1|sa-?1|fastrom|edition|qol|no-?touch|touchless|fasttext|slot-?2[\s_-]+patch|ntsc[\s_-]+patched|pal[\s_-]+patched|uncensored|widescreen|60fps|de-?blur|deblur|bugfix|monster[\s_-]+trainer|singleplayer[\s_-]+nookingtons|hard[\s_-]+mode|easy[\s_-]+mode|coop[\s_-]+up[\s_-]+to)\b/i;

const TRANSLATION_TAG_PATTERNS: readonly {
  label: string;
  codeRe: RegExp;
  wordRe: RegExp;
  nativeRe?: RegExp;
}[] = [
  {
    label: 'English Translation',
    codeRe: /[\(\[]\s*t[+-](?:en|eng)\b/i,
    wordRe: /\benglish\b/i,
  },
  {
    label: 'French Translation',
    codeRe: /[\(\[]\s*t[+-](?:fr|fre|fra)\b/i,
    wordRe: /\bfrench\b/i,
    nativeRe: /\b(français|francais|traduction)\b/i,
  },
  {
    label: 'Spanish Translation',
    codeRe: /[\(\[]\s*t[+-](?:es|spa)\b/i,
    wordRe: /\bspanish\b/i,
    nativeRe: /\b(español|espanol|castellano|traducción|traduccion)\b/i,
  },
  {
    label: 'Portuguese Translation',
    codeRe: /[\(\[]\s*t[+-](?:pt|por|br)\b|\bpt-?br\b/i,
    wordRe: /\b(?:brazilian\s+)?portuguese\b/i,
    nativeRe: /\b(português|portugues|tradução|traducao)\b/i,
  },
  {
    label: 'Italian Translation',
    codeRe: /[\(\[]\s*t[+-](?:it|ita)\b/i,
    wordRe: /\bitalian\b/i,
    nativeRe: /\bitaliano\b/i,
  },
  {
    label: 'German Translation',
    codeRe: /[\(\[]\s*t[+-](?:de|ger|deu)\b/i,
    wordRe: /\bgerman\b/i,
    nativeRe: /\bdeutsch\b/i,
  },
  {
    label: 'Russian Translation',
    codeRe: /[\(\[]\s*t[+-](?:ru|rus)\b/i,
    wordRe: /\brussian\b/i,
  },
  {
    label: 'Chinese Translation',
    codeRe: /[\(\[]\s*t[+-](?:cn|zh|chi|chs|cht)\b/i,
    wordRe: /\b(?:simplified\s+|traditional\s+)?chinese\b/i,
  },
  {
    label: 'Arabic Translation',
    codeRe: /[\(\[]\s*t[+-](?:ar|ara)\b/i,
    wordRe: /\barabic\b/i,
  },
  {
    label: 'Polish Translation',
    codeRe: /[\(\[]\s*t[+-](?:pl|pol)\b/i,
    wordRe: /\bpolish\b/i,
    nativeRe: /\bpolski\b/i,
  },
  {
    label: 'Catalan Translation',
    codeRe: /[\(\[]\s*t[+-](?:ca|cat)\b/i,
    wordRe: /\bcatalan\b/i,
    nativeRe: /\bcatalà\b/i,
  },
  {
    label: 'Korean Translation',
    codeRe: /[\(\[]\s*t[+-](?:ko|kor)\b/i,
    wordRe: /\bkorean\b/i,
  },
];

const GENERIC_T_PLUS_CODE_RE = /[\(\[]\s*t[+-][a-z]{2,3}\b/i;

function extractBracketSegments(text: string): string[] {
  const segments: string[] = [];
  const re = /[\(\[]([^\)\]]+)[\)\]]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const inner = match[1]?.trim();
    if (inner) segments.push(inner);
  }
  return segments;
}

function stripFileExtension(filename: string): string {
  return filename.trim().replace(ARCHIVE_OR_ROM_EXT_RE, '').trim();
}

/**
 * Returns true if the filename looks like a clean, unmodified base dump (standard region/language/
 * revision tags only, with zero mod/version/patch cues).
 */
export function isCleanUnmodifiedBaseFilename(filename: string): boolean {
  const stem = stripFileExtension(filename);
  if (!stem || !REGION_PAREN_RE.test(stem)) {
    return false;
  }
  if (MOD_OR_VERSION_CUE_RE.test(stem)) {
    return false;
  }
  const segments = extractBracketSegments(stem);
  if (segments.length === 0) {
    return false;
  }
  for (const seg of segments) {
    if (!STANDARD_BASE_DUMP_TAG_RE.test(seg.trim())) {
      return false;
    }
  }
  return true;
}

function detectExplicitTranslationLabel(
  filename: string,
  displayLabel: string,
  langTerms: string[],
): string | null {
  const rawCombined = `${filename} ${displayLabel}`.trim();
  const sanitized = rawCombined.replace(FALSE_POSITIVE_LANGUAGE_PHRASE_RE, ' ');
  const bracketSegments = extractBracketSegments(sanitized);
  const bracketText = bracketSegments.join(' ');
  const hasExplicitTranslationWord =
    /\b(trans|translation|translated|traduction|traducción|traduccion|tradução|traducao|patched|patch|mtl)\b/i.test(
      sanitized,
    );
  const hasVersionInBrackets = /\bv\d+(?:\.\d+)*\b|\bbeta\b|\balpha\b/i.test(bracketText);

  for (const pat of TRANSLATION_TAG_PATTERNS) {
    // 1. Unmistakable T+XX / T-XX / PT-BR tag anywhere (parentheses OR brackets)
    if (pat.codeRe.test(sanitized)) {
      return pat.label;
    }

    // 2. Native-language indicator (Français, Español, Português, Italiano, Deutsch, Traduction, etc.)
    if (pat.nativeRe && pat.nativeRe.test(sanitized)) {
      return pat.label;
    }

    // 3. Language name inside parentheses/brackets: e.g. `(English v1.0.0)`, `(Spanish v1.0)`,
    //    `(Brazilian Portuguese v1.0.0)`, `(French Translation)`, `(Spanish)`
    if (pat.wordRe.test(bracketText)) {
      const langBase = pat.label.replace(/\s+Translation$/i, '').toLowerCase();
      const pageHasThisPatchedLang = langTerms.some(
        (l) => l.includes('patched') && l.includes(langBase),
      );
      if (
        hasVersionInBrackets ||
        hasExplicitTranslationWord ||
        pageHasThisPatchedLang ||
        langBase !== 'english'
      ) {
        return pat.label;
      }
      // For `(English)` without version/patch cue, still treat as English Translation if it's in
      // brackets (plain retail dumps use `(En)` rather than `(English)`).
      return pat.label;
    }

    // 4. Language name outside brackets ONLY when directly paired with translation/patch keywords
    if (
      pat.wordRe.test(sanitized) &&
      new RegExp(
        `(?:${pat.wordRe.source}\\s+(?:translation|translated|patch|patched|ver(?:sion)?)|(?:translation|translated|patch|patched)\\s+(?:to\\s+|in\\s+)?${pat.wordRe.source})`,
        'i',
      ).test(sanitized)
    ) {
      return pat.label;
    }
  }

  // Catch-all for other language translation codes like `(T+Tr v1.0)`, `[T+Nl]`, `(T+Vi)`, `(T+Uk)`
  if (GENERIC_T_PLUS_CODE_RE.test(sanitized)) {
    return 'Translation';
  }

  return null;
}

export function classifyFileRole(
  filename: string,
  displayLabel = '',
  context: FileRoleClassificationContext = {},
): string {
  const fileLower = `${filename} ${displayLabel}`.toLowerCase();
  const langTerms = (context.languages || []).map((l) => l.trim().toLowerCase()).filter(Boolean);
  const genreTerms = (context.genres || []).map((g) => g.trim().toLowerCase()).filter(Boolean);
  const sourceTerms = (context.sources || []).map((s) => s.trim().toLowerCase()).filter(Boolean);

  // 1. Undub takes precedence even on combined Touchless+Undub archives
  if (/\b(undub)\b/i.test(fileLower)) return 'Undub';

  // 2. Explicit Machine / AI Translation filename cue
  if (/\b(machine[\s_-]+translation|ai[\s_-]+assisted|mtl)\b/i.test(fileLower)) {
    return 'Machine Translation';
  }

  // 3. Explicit language translation tags (bracket/paren-scoped + T+XX/T-XX + explicit phrases)
  const detectedTranslation = detectExplicitTranslationLabel(filename, displayLabel, langTerms);
  if (detectedTranslation) {
    return detectedTranslation;
  }

  // 4. PSX2PSP / PSN Eboot
  if (/\b(psx2psp|psn[\s_-]+eboot|eboot)\b/i.test(fileLower)) {
    return 'PSX2PSP';
  }

  // 5. Explicit ROM hack / QoL / mod keywords
  if (EXPLICIT_HACK_FILENAME_RE.test(fileLower)) {
    return 'Hack';
  }

  // 6. Homebrew, Aftermarket, Indie & Doujin
  if (/\b(homebrew|aftermarket)\b/i.test(fileLower)) {
    return 'Homebrew';
  }
  if (/\bindie\b/i.test(fileLower)) {
    return 'Indie';
  }
  if (/\bdoujin\b/i.test(fileLower)) {
    return 'Doujin';
  }

  // 7. Cross-platform Port & BIOS
  if (/\bport\b/i.test(fileLower)) {
    return 'Port';
  }
  if (/\bbios\b/i.test(fileLower) || context.systemName?.toLowerCase() === 'bios-files') {
    return 'BIOS';
  }

  // 8. Prototypes & Demos
  if (/\b(proto|prototype)\b/i.test(fileLower)) return 'Prototype';
  if (/\b(demo|sample|kiosk)\b/i.test(fileLower)) return 'Demo';

  // 9. DLC, OST & Title Updates (avoid false positives on "Roster Update" ROM hacks)
  const isHackOrCommunityPage =
    genreTerms.includes('hack') ||
    genreTerms.includes('homebrew') ||
    sourceTerms.includes('homebrew') ||
    sourceTerms.includes('port') ||
    langTerms.some((l) => l.includes('patched'));

  if (/\b(dlc|add-on|addon|ost|soundtrack|title[\s_-]+update)\b/i.test(fileLower)) {
    return 'DLC';
  }
  if (
    /\bupdate\b/i.test(fileLower) &&
    (sourceTerms.includes('dlc') || !isHackOrCommunityPage)
  ) {
    return 'DLC';
  }

  // 10. Bootleg / Unlicensed / Pirate
  if (/\b(bootleg|unlicensed|pirate)\b/i.test(fileLower)) {
    return 'Bootleg';
  }
  if (
    /\(unl\)/i.test(filename) &&
    (sourceTerms.some((s) => s.includes('bootleg') || s.includes('unlicensed')) ||
      genreTerms.includes('bootleg'))
  ) {
    return 'Bootleg';
  }

  // 11. Standalone patch payloads
  if (/\.(ips|bps|ups|xdelta|ppf|vcdiff)$/i.test(filename)) {
    return 'Patch';
  }

  // 12. Bundled unmodified base ROM detection (`Original ROM` -> Retail ROM).
  // ONLY classify as `Original ROM` when the filename is genuinely a clean unmodified No-Intro/Redump
  // base dump (no mod/version/patch cues, standard region/lang/rev tags only) AND the release context
  // is a Translation/Undub page OR a multi-file Hack page alongside modified siblings.
  // Never hijack sole files on Hack/Homebrew/Port/Indie pages as `Original ROM`.
  const isTranslationOrUndubPage =
    langTerms.some((l) => l.includes('patched') || l === 'undub') ||
    genreTerms.includes('undub') ||
    genreTerms.includes('translation') ||
    sourceTerms.includes('undub') ||
    sourceTerms.includes('machine translation') ||
    sourceTerms.includes('ai assisted');
  const isHackPage = genreTerms.includes('hack');

  if ((isTranslationOrUndubPage || isHackPage) && isCleanUnmodifiedBaseFilename(filename)) {
    const siblings = (context.siblingFilenames || []).filter((s) => s && s.trim().length > 0);
    const hasMultipleSiblings = siblings.length > 1;
    const hasModifiedSibling =
      hasMultipleSiblings &&
      siblings.some(
        (sib) =>
          sib.trim().toLowerCase() !== filename.trim().toLowerCase() &&
          !isCleanUnmodifiedBaseFilename(sib),
      );

    if (isTranslationOrUndubPage) {
      // On a Translation/Undub page, a clean unmodified region dump is the unpatched base ROM
      // unless it's the sole file on a pure Hack/Homebrew/Port page.
      if (hasMultipleSiblings || !isHackPage) {
        return 'Original ROM';
      }
    } else if (isHackPage && hasModifiedSibling) {
      // On a multi-file Hack page (e.g. `Salamander (Japan).zip` + `Salamander - Enhanced (Japan).zip`
      // or `Premier Manager 64 (Europe).7z` + `Premier Manager 64 (E) (NTSC Patched).7z`), the clean
      // base dump is the bundled Original ROM while the modified sibling(s) remain `Hack`.
      return 'Original ROM';
    }
  }

  // 13. Complete context fallback covering all 11 curated release types
  if (sourceTerms.includes('psx2psp')) return 'PSX2PSP';
  if (sourceTerms.includes('psn eboot')) return 'PSN Eboot';
  if (sourceTerms.includes('port')) return 'Port';
  if (sourceTerms.includes('homebrew') || genreTerms.includes('homebrew')) return 'Homebrew';
  if (sourceTerms.includes('indie') || genreTerms.includes('indie')) return 'Indie';
  if (sourceTerms.includes('doujin') || genreTerms.includes('doujin')) return 'Doujin';
  if (sourceTerms.includes('machine translation')) return 'Machine Translation';
  if (sourceTerms.includes('ai assisted')) return 'AI Assisted';
  if (genreTerms.includes('hack')) return 'Hack';
  if (sourceTerms.includes('prototype')) return 'Prototype';
  if (sourceTerms.includes('demo')) return 'Demo';
  if (sourceTerms.includes('dlc')) return 'DLC';
  if (sourceTerms.some((s) => s.includes('bootleg')) || genreTerms.includes('bootleg')) {
    return 'Bootleg';
  }
  if (langTerms.includes('undub') || genreTerms.includes('undub') || sourceTerms.includes('undub')) {
    return 'Undub';
  }

  const patchedLangs = (context.languages || [])
    .map((l) => l.trim())
    .filter((l) => /patched$/i.test(l));
  if (patchedLangs.length === 1) {
    return patchedLangs[0].replace(/\s*patched$/i, ' Translation');
  }

  if (genreTerms.includes('bios') || context.systemName?.toLowerCase() === 'bios-files') {
    return 'BIOS';
  }

  return 'ROM';
}

export function deriveReleaseTags(
  meta: {
    genres?: string[];
    languages?: string[];
    sources?: string[];
    systemName?: string | null;
  },
  fileRoles: string[] = [],
): string[] {
  const tags = new Set<string>();

  for (const lang of meta.languages || []) {
    const trimmed = lang.trim();
    if (!trimmed) continue;
    if (/patched$/i.test(trimmed)) {
      tags.add(trimmed.replace(/\s*patched$/i, ' Translation'));
    } else if (/^undub$/i.test(trimmed)) {
      tags.add('Undub');
    }
  }

  for (const genre of meta.genres || []) {
    const trimmed = genre.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === 'hack') tags.add('Hack');
    else if (lower === 'homebrew') tags.add('Homebrew');
    else if (lower === 'bootleg') tags.add('Bootleg');
    else if (lower === 'indie') tags.add('Indie');
  }

  for (const source of meta.sources || []) {
    const trimmed = source.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === 'homebrew') tags.add('Homebrew');
    else if (lower === 'port') tags.add('Port');
    else if (lower === 'machine translation') tags.add('Machine Translation');
    else if (lower === 'ai assisted') tags.add('AI Assisted');
    else if (lower === 'prototype') tags.add('Prototype');
    else if (lower === 'demo') tags.add('Demo');
    else if (lower === 'dlc') tags.add('DLC');
    else if (lower.includes('bootleg')) tags.add('Bootleg');
    else if (lower === 'doujin') tags.add('Doujin');
    else if (lower === 'indie') tags.add('Indie');
    else if (lower === 'psx2psp') tags.add('PSX2PSP');
    else if (lower === 'psn eboot') tags.add('PSN Eboot');
  }

  for (const role of fileRoles) {
    if (!role || role === 'ROM' || role === 'Original ROM') continue;
    tags.add(role);
  }

  if (tags.size === 0) {
    if (meta.systemName?.toLowerCase() === 'bios-files') {
      tags.add('BIOS');
    } else {
      tags.add('Retail ROM');
    }
  }

  return Array.from(tags);
}
