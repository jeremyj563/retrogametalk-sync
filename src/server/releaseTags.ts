import { load as loadHtml } from 'cheerio';

export function decodeHtmlEntities(text: string): string {
  return loadHtml(`<span>${text}</span>`).text().trim();
}

export function classifyFileRole(
  filename: string,
  displayLabel = '',
  context: {
    genres?: string[];
    languages?: string[];
    sources?: string[];
    title?: string;
    systemName?: string;
  } = {},
): string {
  const fileLower = `${filename} ${displayLabel}`.toLowerCase();
  const langTerms = (context.languages || []).map((l) => l.toLowerCase());
  const genreTerms = (context.genres || []).map((g) => g.toLowerCase());
  const sourceTerms = (context.sources || []).map((s) => s.toLowerCase());

  if (/\b(undub)\b/i.test(fileLower)) return 'Undub';

  const patchedPatterns: [RegExp, string][] = [
    [/(\benglish\b|\bt-?en\b|\[t\+en\]|\beng\b.*(patch|trans)|patched.*english)/i, 'English Translation'],
    [/(\bfrench\b|français|\bt-?fr\b|\[t\+fr\]|traduction)/i, 'French Translation'],
    [/(\bspanish\b|español|castellano|\bt-?es\b|\[t\+es\])/i, 'Spanish Translation'],
    [/(\bportuguese\b|português|pt-br|\bt-?pt\b|\[t\+pt\])/i, 'Portuguese Translation'],
    [/(\bitalian\b|italiano|\bt-?it\b|\[t\+it\])/i, 'Italian Translation'],
    [/(\bgerman\b|deutsch|\bt-?de\b|\[t\+de\])/i, 'German Translation'],
    [/(\brussian\b|\bt-?ru\b|\[t\+ru\])/i, 'Russian Translation'],
    [/(\bchinese\b|\bt-?cn\b|\[t\+cn\]|simplified chinese|traditional chinese)/i, 'Chinese Translation'],
    [/(\barabic\b|\bt-?ar\b)/i, 'Arabic Translation'],
    [/(\bpolish\b|\bt-?pl\b)/i, 'Polish Translation'],
    [/(\bcatalan\b)/i, 'Catalan Translation'],
    [/(\bkorean\b|\bt-?ko\b)/i, 'Korean Translation'],
  ];

  const isExplicitPatchOrTrans =
    /\b(trans|translation|patched|patch|v\d+(?:\.\d+)*|beta|mtl)\b/i.test(fileLower) ||
    /\[t\+/i.test(fileLower) ||
    langTerms.some((l) => l.includes('patched'));

  for (const [regex, label] of patchedPatterns) {
    if (regex.test(fileLower)) {
      const isPlainRetailRegion =
        /\((usa|europe|world|japan|australia|u|e|j|w)\)/i.test(fileLower) &&
        !/\b(english|french|spanish|portuguese|italian|german|russian|chinese|trans|translation|patched|patch|t-?en|t\+en|v\d+\.\d+)\b/i.test(
          fileLower,
        );
      if (!isPlainRetailRegion && (isExplicitPatchOrTrans || !/\b(usa|europe)\b/i.test(fileLower))) {
        return label;
      }
    }
  }

  if (/\b(machine translation|mtl)\b/i.test(fileLower)) return 'Machine Translation';
  if (/\b(hack|romhack|redux|rebalance|randomizer|improvement|colorization|msu-?1|sa-?1|fastrom|edition)\b/i.test(fileLower)) {
    return 'Hack';
  }
  if (/\bhomebrew\b/i.test(fileLower)) return 'Homebrew';
  if (/\bport\b/i.test(fileLower)) return 'Port';
  if (/\b(proto|prototype)\b/i.test(fileLower)) return 'Prototype';
  if (/\b(demo|sample|kiosk)\b/i.test(fileLower)) return 'Demo';
  if (/\b(dlc|update|add-on|addon|ost)\b/i.test(fileLower)) return 'DLC';
  if (/\b(bootleg|unlicensed)\b/i.test(fileLower)) return 'Bootleg';
  if (/\.(ips|bps|ups|xdelta|ppf|vcdiff)$/i.test(filename)) return 'Patch';

  const hasNonRetailContext =
    langTerms.some((l) => l.includes('patched') || l === 'undub') ||
    genreTerms.some((g) => g === 'hack' || g === 'homebrew') ||
    sourceTerms.some((s) => ['port', 'homebrew', 'machine translation', 'ai assisted'].includes(s));

  if (
    hasNonRetailContext &&
    /\((japan|usa|europe|world|korea|china|asia|france|germany|spain|italy|brazil|j|u|e|w)(?:,[^)]*)?\)/i.test(
      filename,
    )
  ) {
    return 'Original ROM';
  }

  if (sourceTerms.includes('port')) return 'Port';
  if (sourceTerms.includes('homebrew') || genreTerms.includes('homebrew')) return 'Homebrew';
  if (genreTerms.includes('hack')) return 'Hack';
  if (sourceTerms.includes('prototype')) return 'Prototype';
  if (sourceTerms.includes('demo')) return 'Demo';
  if (sourceTerms.includes('dlc')) return 'DLC';
  if (sourceTerms.some((s) => s.includes('bootleg'))) return 'Bootleg';
  if (context.systemName?.toLowerCase() === 'bios-files') return 'BIOS';

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
