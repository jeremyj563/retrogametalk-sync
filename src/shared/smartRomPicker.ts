import type { ArchiveInspectResult, PlayableExportTarget } from '../types';
import { deriveShortRoleTag, extractVersionFromText } from './romNaming';

export interface SmartRomFilterContext {
  tags?: string[];
  languages?: string[];
  regions?: string[];
  search?: string;
  syncIncludeTags?: string[];
}

export interface SmartInspectItemInput {
  itemId: number;
  title: string;
  systemName: string;
  releaseTags?: string[];
  languages?: string[];
  regions?: string[];
  inspections: ArchiveInspectResult[];
}

export interface ComparableVersion {
  hasVersion: boolean;
  /**
   * 4 = explicit semantic / dotted / vN version (e.g. v1.42, ver 2.0)
   * 3 = build date or build number (e.g. Build 2026-04-12, 20251103)
   * 2 = revision / release number (e.g. Rev B, Rev 1.1, r142)
   * 1 = standalone pre-release stage (e.g. RC2, Beta 1)
   * 0 = no version token detected
   */
  schemeRank: number;
  numericParts: number[];
  letterSuffix: number;
  /**
   * Maturity stage for equal base version:
   * 5 = hotfix / fix / final / complete
   * 4 = standard stable release
   * 3 = release candidate (RC)
   * 2 = beta
   * 1 = alpha / pre / wip / proto
   */
  stageRank: number;
  stageNumber: number;
  rawLabel: string | null;
}

const STAGE_RANK = {
  ALPHA: 1,
  BETA: 2,
  RC: 3,
  STABLE: 4,
  FINAL_FIX: 5,
} as const;

function parseNumericSegments(dotted: string): number[] {
  return dotted
    .split('.')
    .map((seg) => {
      const n = Number.parseInt(seg, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function parseStageModifier(raw: string): { stageRank: number; stageNumber: number } {
  const lower = raw.toLowerCase();
  const fixMatch = lower.match(/\b(hotfix|bugfix|fix|final|complete)\s*(\d+)?\b/);
  if (fixMatch) {
    return {
      stageRank: STAGE_RANK.FINAL_FIX,
      stageNumber: fixMatch[2] ? Number.parseInt(fixMatch[2], 10) : 1,
    };
  }
  const rcMatch = lower.match(/\brc\s*[-._]?(\d+)?\b/);
  if (rcMatch) {
    return {
      stageRank: STAGE_RANK.RC,
      stageNumber: rcMatch[1] ? Number.parseInt(rcMatch[1], 10) : 1,
    };
  }
  const betaMatch = lower.match(/\bbeta\s*[-._]?(\d+)?\b/);
  if (betaMatch) {
    return {
      stageRank: STAGE_RANK.BETA,
      stageNumber: betaMatch[1] ? Number.parseInt(betaMatch[1], 10) : 1,
    };
  }
  const alphaMatch = lower.match(/\b(alpha|wip|preview)\s*[-._]?(\d+)?\b/);
  if (alphaMatch) {
    return {
      stageRank: STAGE_RANK.ALPHA,
      stageNumber: alphaMatch[2] ? Number.parseInt(alphaMatch[2], 10) : 1,
    };
  }
  return { stageRank: STAGE_RANK.STABLE, stageNumber: 0 };
}

/**
 * Extracts a structured, numerically comparable version representation from
 * filenames, archive labels, or pre-extracted version tokens.
 */
export function parseComparableVersion(text: string): ComparableVersion {
  const empty: ComparableVersion = {
    hasVersion: false,
    schemeRank: 0,
    numericParts: [],
    letterSuffix: 0,
    stageRank: STAGE_RANK.STABLE,
    stageNumber: 0,
    rawLabel: null,
  };
  if (!text || !text.trim()) return empty;

  const cleaned = text
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/\[[0-9a-f]{8}\]/gi, ' ');

  const stageInfo = parseStageModifier(cleaned);

  // 1. Explicit semantic / dotted / v-prefixed version (pick highest if multiple appear in string)
  const verMatches = Array.from(
    cleaned.matchAll(
      /(?:^|[\s._\-[(\]])(?:version|ver\.?|v)\s*(\d+(?:\.\d+){0,3})([a-z])?(?:[-._]?(?:fix|hotfix|final|rc\d*|beta\d*|alpha\d*))?(?=$|[\s._\-)\]])/gi,
    ),
  );
  let bestSemver: ComparableVersion | null = null;
  for (const m of verMatches) {
    const rawNum = m[1];
    const rawFull = m[0].trim();
    // Skip bare 4-digit years like "ver 2024" unless explicitly "v2024"
    if (/^\d{4}$/.test(rawNum) && !/^[\s._\-[(\]]*v/i.test(m[0])) {
      continue;
    }
    const letter = m[2] ? m[2].toLowerCase().charCodeAt(0) - 96 : 0;
    const localStage = parseStageModifier(rawFull);
    const candidate: ComparableVersion = {
      hasVersion: true,
      schemeRank: 4,
      numericParts: parseNumericSegments(rawNum),
      letterSuffix: Math.max(0, letter),
      stageRank: localStage.stageRank !== STAGE_RANK.STABLE ? localStage.stageRank : stageInfo.stageRank,
      stageNumber: localStage.stageRank !== STAGE_RANK.STABLE ? localStage.stageNumber : stageInfo.stageNumber,
      rawLabel: extractVersionFromText(cleaned) || `v${rawNum}${m[2] || ''}`,
    };
    if (!bestSemver || compareComparableVersions(candidate, bestSemver) > 0) {
      bestSemver = candidate;
    }
  }
  if (bestSemver) return bestSemver;

  // 2. ISO / compact date stamp (e.g. Build 2026-03-14, 2025-11-08, 20251108)
  const isoDateMatch = cleaned.match(
    /(?:^|[\s._\-[(\]])(?:build\s*)?(20\d{2})[-._](0[1-9]|1[0-2])[-._](0[1-9]|[12]\d|3[01])(?=$|[\s._\-)\]])/i,
  );
  if (isoDateMatch) {
    const y = Number.parseInt(isoDateMatch[1], 10);
    const mo = Number.parseInt(isoDateMatch[2], 10);
    const d = Number.parseInt(isoDateMatch[3], 10);
    return {
      hasVersion: true,
      schemeRank: 3,
      numericParts: [y, mo, d],
      letterSuffix: 0,
      stageRank: stageInfo.stageRank,
      stageNumber: stageInfo.stageNumber,
      rawLabel: `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`,
    };
  }

  const compactDateMatch = cleaned.match(
    /(?:^|[\s._\-[(\]])(?:build\s*)?(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=$|[\s._\-)\]])/i,
  );
  if (compactDateMatch) {
    const y = Number.parseInt(compactDateMatch[1], 10);
    const mo = Number.parseInt(compactDateMatch[2], 10);
    const d = Number.parseInt(compactDateMatch[3], 10);
    return {
      hasVersion: true,
      schemeRank: 3,
      numericParts: [y, mo, d],
      letterSuffix: 0,
      stageRank: stageInfo.stageRank,
      stageNumber: stageInfo.stageNumber,
      rawLabel: `${compactDateMatch[1]}-${compactDateMatch[2]}-${compactDateMatch[3]}`,
    };
  }

  // 3. Revision (Rev A, Rev B, Rev 1, Rev 1.2) or Release r142 / Build 120
  const revMatch = cleaned.match(
    /(?:^|[\s._\-[(\]])rev(?:ision)?\.?\s*([a-z]|\d+(?:\.\d+)?)(?=$|[\s._\-)\]])/i,
  );
  if (revMatch) {
    const token = revMatch[1];
    if (/^[a-z]$/i.test(token)) {
      const code = token.toUpperCase().charCodeAt(0) - 64; // A=1, B=2...
      return {
        hasVersion: true,
        schemeRank: 2,
        numericParts: [code],
        letterSuffix: 0,
        stageRank: stageInfo.stageRank,
        stageNumber: stageInfo.stageNumber,
        rawLabel: `Rev ${token.toUpperCase()}`,
      };
    }
    return {
      hasVersion: true,
      schemeRank: 2,
      numericParts: parseNumericSegments(token),
      letterSuffix: 0,
      stageRank: stageInfo.stageRank,
      stageNumber: stageInfo.stageNumber,
      rawLabel: `Rev ${token}`,
    };
  }

  const rBuildMatch = cleaned.match(
    /(?:^|[\s._\-[(\]])(?:r(\d{1,4})([a-z])?|build\s*(\d{1,5}))(?=$|[\s._\-)\]])/i,
  );
  if (rBuildMatch) {
    const numStr = rBuildMatch[1] || rBuildMatch[3] || '0';
    const letter = rBuildMatch[2] ? rBuildMatch[2].toLowerCase().charCodeAt(0) - 96 : 0;
    return {
      hasVersion: true,
      schemeRank: 2,
      numericParts: [Number.parseInt(numStr, 10)],
      letterSuffix: Math.max(0, letter),
      stageRank: stageInfo.stageRank,
      stageNumber: stageInfo.stageNumber,
      rawLabel: rBuildMatch[1] ? `r${rBuildMatch[1]}${rBuildMatch[2] || ''}` : `Build ${rBuildMatch[3]}`,
    };
  }

  // 4. Standalone pre-release stage (e.g. "Beta 2", "RC1")
  if (stageInfo.stageRank !== STAGE_RANK.STABLE) {
    return {
      hasVersion: true,
      schemeRank: 1,
      numericParts: [stageInfo.stageNumber],
      letterSuffix: 0,
      stageRank: stageInfo.stageRank,
      stageNumber: stageInfo.stageNumber,
      rawLabel: extractVersionFromText(cleaned),
    };
  }

  return empty;
}

/**
 * Returns > 0 if `a` is newer than `b`, < 0 if `a` is older than `b`, 0 if tied.
 */
export function compareComparableVersions(a: ComparableVersion, b: ComparableVersion): number {
  if (a.hasVersion !== b.hasVersion) {
    return a.hasVersion ? 1 : -1;
  }
  if (!a.hasVersion && !b.hasVersion) return 0;

  if (a.schemeRank !== b.schemeRank) {
    return a.schemeRank - b.schemeRank;
  }

  const maxLen = Math.max(a.numericParts.length, b.numericParts.length);
  for (let i = 0; i < maxLen; i += 1) {
    const va = a.numericParts[i] ?? 0;
    const vb = b.numericParts[i] ?? 0;
    if (va !== vb) return va - vb;
  }

  if (a.letterSuffix !== b.letterSuffix) {
    return a.letterSuffix - b.letterSuffix;
  }

  if (a.stageRank !== b.stageRank) {
    return a.stageRank - b.stageRank;
  }

  if (a.stageNumber !== b.stageNumber) {
    return a.stageNumber - b.stageNumber;
  }

  return 0;
}

const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  english: /\b(english|eng|t-?en|\[t\+en\]|en)\b/i,
  japanese: /\b(japanese|jpn|jap|t-?jp|jp)\b/i,
  spanish: /\b(spanish|espanol|español|castellano|esp|t-?es|\[t\+es\])\b/i,
  french: /\b(french|francais|français|fra|t-?fr|\[t\+fr\])\b/i,
  portuguese: /\b(portuguese|portugues|português|pt-?br|por|t-?pt|\[t\+pt\])\b/i,
  german: /\b(german|deutsch|ger|deu|t-?de|\[t\+de\])\b/i,
  italian: /\b(italian|italiano|ita|t-?it|\[t\+it\])\b/i,
  russian: /\b(russian|rus|t-?ru|\[t\+ru\])\b/i,
  chinese: /\b(chinese|chn|zh|t-?cn|t-?zh)\b/i,
  korean: /\b(korean|kor|t-?ko)\b/i,
  polish: /\b(polish|pol|t-?pl)\b/i,
  arabic: /\b(arabic|ara|t-?ar)\b/i,
  catalan: /\b(catalan|cat|t-?ca)\b/i,
};

const REGION_PATTERNS: Record<string, RegExp> = {
  usa: /\b(usa|us|ntsc-?u|\(u\))\b/i,
  europe: /\b(europe|eur|pal|\(e\))\b/i,
  japan: /\b(japan|jpn|ntsc-?j|\(j\))\b/i,
  world: /\b(world|\(w\)|\(ue\)|\(ju\))\b/i,
  brazil: /\b(brazil|bra)\b/i,
  korea: /\b(korea|kor)\b/i,
  china: /\b(china|chn)\b/i,
  australia: /\b(australia|aus)\b/i,
  france: /\b(france|fra)\b/i,
  germany: /\b(germany|ger|deu)\b/i,
  spain: /\b(spain|esp)\b/i,
  italy: /\b(italy|ita)\b/i,
};

function extractDiscInfo(text: string): { stemWithoutDisc: string; discNumber: number } | null {
  const m = text.match(/\b(?:disc|disk|cd|side)\s*0*([1-9]\d?|[a-d])\b/i);
  if (!m) return null;
  const token = m[1].toUpperCase();
  const discNumber = /^[A-D]$/.test(token)
    ? token.charCodeAt(0) - 64
    : Number.parseInt(token, 10);
  if (!Number.isFinite(discNumber) || discNumber <= 0) return null;

  const stemWithoutDisc = text
    .replace(/\b(?:disc|disk|cd|side)\s*0*(?:[1-9]\d?|[a-d])\b/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return { stemWithoutDisc, discNumber };
}

interface CandidateDescriptor {
  fileId: number;
  fileOrderIndex: number;
  fileDownloadedAt: string | null;
  target: PlayableExportTarget;
  targetOrderIndex: number;
  combinedText: string;
  roleCategory: string;
  version: ComparableVersion;
  contextScore: number;
  qualityScore: number;
  discInfo: { stemWithoutDisc: string; discNumber: number } | null;
  reason: string;
}

function classifyCandidateCategory(
  fileRole: string | undefined,
  roleBadge: string | null | undefined,
  releaseTags: string[],
  combinedText: string,
): string {
  const explicit = `${fileRole || ''} ${roleBadge || ''}`.toLowerCase();
  if (explicit.includes('machine translation') || /\b(mtl|machine\s*trans)/i.test(combinedText)) {
    return 'machine_translation';
  }
  if (explicit.includes('translation') || /\b(translation|translated|t-?en|t-?es|t-?fr|t-?pt|t-?de|t-?it|t-?ru|\[t\+)/i.test(combinedText)) {
    return 'translation';
  }
  if (explicit.includes('undub') || /\bundub\b/i.test(combinedText)) {
    return 'undub';
  }
  if (explicit.includes('hack') || /\b(hack|romhack|redux|improvement|rebalance|colorization|fastrom|msu-?1)\b/i.test(combinedText)) {
    return 'hack';
  }
  if (explicit.includes('port') || /\bport\b/i.test(combinedText)) {
    return 'port';
  }
  if (explicit.includes('homebrew') || /\bhomebrew\b/i.test(combinedText)) {
    return 'homebrew';
  }
  if (explicit.includes('prototype') || explicit.includes('proto') || /\b(proto|prototype)\b/i.test(combinedText)) {
    return 'prototype';
  }
  if (explicit.includes('demo') || /\b(demo|sample|trial)\b/i.test(combinedText)) {
    return 'demo';
  }
  if (explicit.includes('original rom')) {
    return 'original_base';
  }

  // Fallback to release tags when the file itself has generic "ROM" role
  const shortFromTags = deriveShortRoleTag(fileRole, releaseTags, combinedText);
  if (shortFromTags?.startsWith('T-')) return 'translation';
  if (shortFromTags === 'MTL') return 'machine_translation';
  if (shortFromTags === 'Undub') return 'undub';
  if (shortFromTags === 'Hack') return 'hack';
  if (shortFromTags === 'Port') return 'port';
  if (shortFromTags === 'Homebrew') return 'homebrew';
  if (shortFromTags === 'Proto') return 'prototype';

  return 'retail';
}

function computeContextScore(
  cand: {
    fileRole?: string;
    fileDisplayLabel?: string;
    sourceFilename: string;
    target: PlayableExportTarget;
    roleCategory: string;
    combinedText: string;
  },
  entry: SmartInspectItemInput,
  ctx: SmartRomFilterContext,
  releaseHasModifiedVariant: boolean,
): { score: number; matchedSignals: string[] } {
  let score = 0;
  const matchedSignals: string[] = [];

  const activeTags = (ctx.tags && ctx.tags.length > 0 ? ctx.tags : ctx.syncIncludeTags || []).map((t) =>
    t.toLowerCase(),
  );
  const activeLanguages = (ctx.languages || []).map((l) => l.toLowerCase());
  const activeRegions = (ctx.regions || []).map((r) => r.toLowerCase());
  const searchLower = (ctx.search || '').trim().toLowerCase();

  // 1. Active Type / Tag Filter Alignment
  const wantsTranslation =
    activeTags.some((t) => t.includes('translation')) ||
    activeLanguages.length > 0 ||
    /\b(translation|translated|t-en|english)\b/i.test(searchLower);
  const wantsMtl = activeTags.some((t) => t.includes('machine translation'));
  const wantsHack = activeTags.some((t) => t === 'hack') || /\b(hack|redux|improvement)\b/i.test(searchLower);
  const wantsUndub = activeTags.some((t) => t === 'undub') || /\bundub\b/i.test(searchLower);
  const wantsPort = activeTags.some((t) => t === 'port') || /\bport\b/i.test(searchLower);
  const wantsHomebrew = activeTags.some((t) => t === 'homebrew');
  const wantsProto = activeTags.some((t) => t.includes('proto'));
  const wantsDemo = activeTags.some((t) => t === 'demo');
  const wantsOriginalOrRetailOnly =
    activeTags.length > 0 &&
    activeTags.every((t) => t === 'retail rom' || t === 'original rom');

  if (wantsTranslation) {
    if (cand.roleCategory === 'translation') {
      score += 120;
      matchedSignals.push('Translation match');
    } else if (cand.roleCategory === 'machine_translation') {
      score += wantsMtl ? 125 : 85;
      matchedSignals.push('MTL match');
    }
  }
  if (wantsHack && cand.roleCategory === 'hack') {
    score += 115;
    matchedSignals.push('Hack match');
  }
  if (wantsUndub && cand.roleCategory === 'undub') {
    score += 115;
    matchedSignals.push('Undub match');
  }
  if (wantsPort && cand.roleCategory === 'port') {
    score += 115;
    matchedSignals.push('Port match');
  }
  if (wantsHomebrew && cand.roleCategory === 'homebrew') {
    score += 115;
    matchedSignals.push('Homebrew match');
  }
  if (wantsProto && cand.roleCategory === 'prototype') {
    score += 110;
    matchedSignals.push('Prototype match');
  }
  if (wantsDemo && cand.roleCategory === 'demo') {
    score += 110;
    matchedSignals.push('Demo match');
  }
  if (wantsOriginalOrRetailOnly && (cand.roleCategory === 'original_base' || cand.roleCategory === 'retail')) {
    score += 110;
    matchedSignals.push('Original/Retail match');
  }

  // Extract explicit language embedded in tag filters (e.g. "English Translation", "Spanish Translation")
  const impliedLanguagesFromTags: string[] = [];
  for (const tag of activeTags) {
    for (const langKey of Object.keys(LANGUAGE_PATTERNS)) {
      if (tag.includes(langKey)) impliedLanguagesFromTags.push(langKey);
    }
  }
  const desiredLanguages = Array.from(new Set([...activeLanguages, ...impliedLanguagesFromTags]));

  for (const lang of desiredLanguages) {
    const pat = LANGUAGE_PATTERNS[lang];
    if (pat && pat.test(cand.combinedText)) {
      score += 95;
      matchedSignals.push(`${lang.charAt(0).toUpperCase() + lang.slice(1)} match`);
    } else if (cand.combinedText.toLowerCase().includes(lang)) {
      score += 75;
      matchedSignals.push(`${lang} match`);
    }
  }

  // If no explicit language filter is set, gently prefer English over non-English translations when multiple languages exist in one release
  if (desiredLanguages.length === 0 && (cand.roleCategory === 'translation' || cand.roleCategory === 'machine_translation')) {
    if (LANGUAGE_PATTERNS.english.test(cand.combinedText)) {
      score += 25;
    }
  }

  // 2. Active Region Filter Alignment
  for (const reg of activeRegions) {
    const pat = REGION_PATTERNS[reg];
    if (pat && pat.test(cand.combinedText)) {
      score += 60;
      matchedSignals.push(`${reg.toUpperCase()} region`);
    } else if (cand.combinedText.toLowerCase().includes(reg)) {
      score += 45;
    }
  }

  // 3. Search Query Token Alignment (helps when user searches e.g. "MSU-1", "FastROM", "Bugfix", "Rev 1")
  if (searchLower.length >= 2) {
    const tokens = searchLower.split(/\s+/).filter((t) => t.length >= 2);
    const titleLower = entry.title.toLowerCase();
    for (const tok of tokens) {
      // Score tokens that specifically distinguish a file/variant beyond the shared release title
      if (!titleLower.includes(tok) && cand.combinedText.toLowerCase().includes(tok)) {
        score += 50;
      }
    }
  }

  // 4. Release-Intrinsic Intent (when release is a Translation/Hack/Undub/Port that also bundles an unmodified "Original ROM" or backup)
  if (releaseHasModifiedVariant && !wantsOriginalOrRetailOnly) {
    if (cand.roleCategory === 'original_base') {
      score -= 90;
    } else if (
      cand.roleCategory === 'translation' ||
      cand.roleCategory === 'machine_translation' ||
      cand.roleCategory === 'hack' ||
      cand.roleCategory === 'undub' ||
      cand.roleCategory === 'port'
    ) {
      score += 45;
    }
  }

  // 5. Penalize auxiliary / old / optional / secondary variants when clean primary exists
  const auxProbe = `${cand.fileDisplayLabel || ''} ${cand.sourceFilename} ${cand.target.displayName}`.toLowerCase();
  if (/\b(old|older|legacy|deprecated|outdated|archive|backup)\b/i.test(auxProbe)) {
    score -= 80;
  }
  if (!wantsDemo && /\b(demo|trial|sample|preview|promo)\b/i.test(auxProbe)) {
    score -= 65;
  }
  if (/\b(optional|alt|alternate|alternative|bonus|soundtrack|ost|manual)\b/i.test(auxProbe)) {
    score -= 35;
  }
  if (/\bunheadered\b/i.test(auxProbe) && !/\bunheadered\b/i.test(searchLower)) {
    score -= 15;
  }

  return { score, matchedSignals };
}

function computeFormatQualityScore(target: PlayableExportTarget): number {
  let q = 0;
  if (target.kind === 'disc_set') q += 20;
  const ext = target.extension.toLowerCase();
  if (ext === '.chd' || ext === '.rvz' || ext === '.pbp') q += 18;
  // Slightly prefer larger main ROM payloads over tiny loader stubs within the same category/version
  if (target.sizeBytes > 0) {
    q += Math.min(12, Math.floor(Math.log2(Math.max(1, target.sizeBytes / 1024))));
  }
  return q;
}

/**
 * Selects the smartest Primary ROM target(s) across all archives and inner playable
 * files of a single Catalog item, factoring in active Catalog/Sync context and
 * always preferring the latest version available.
 *
 * Also automatically preserves complete multi-disc sets (Disc 1 + Disc 2..N) when
 * the winning primary belongs to a multi-disc release of the same role & version.
 */
export function selectSmartPrimaryTargetsForItem(
  entry: SmartInspectItemInput,
  context: SmartRomFilterContext = {},
): {
  selectedByFileId: Record<number, string[]>;
  reasonByTargetKey: Record<string, string>;
} {
  const selectedByFileId: Record<number, string[]> = {};
  const reasonByTargetKey: Record<string, string> = {};

  const rawCandidates: {
    insp: ArchiveInspectResult;
    fileOrderIndex: number;
    target: PlayableExportTarget;
    targetOrderIndex: number;
    combinedText: string;
    roleCategory: string;
  }[] = [];

  entry.inspections.forEach((insp, fileOrderIndex) => {
    insp.playableTargets.forEach((target, targetOrderIndex) => {
      if (target.kind === 'patch_only') return;
      const combinedText = [
        target.displayName,
        target.suggestedFilename,
        target.roleBadge || '',
        target.detectedVersion || '',
        insp.fileDisplayLabel || '',
        insp.sourceFilename,
        insp.fileRole || '',
      ]
        .filter(Boolean)
        .join(' ');

      const roleCategory = classifyCandidateCategory(
        insp.fileRole,
        target.roleBadge,
        entry.releaseTags || [],
        combinedText,
      );

      rawCandidates.push({
        insp,
        fileOrderIndex,
        target,
        targetOrderIndex,
        combinedText,
        roleCategory,
      });
    });
  });

  if (rawCandidates.length === 0) {
    return { selectedByFileId, reasonByTargetKey };
  }

  if (rawCandidates.length === 1) {
    const only = rawCandidates[0];
    selectedByFileId[only.insp.fileId] = [only.target.id];
    return { selectedByFileId, reasonByTargetKey };
  }

  const releaseHasModifiedVariant = rawCandidates.some((c) =>
    ['translation', 'machine_translation', 'hack', 'undub', 'port', 'homebrew'].includes(c.roleCategory),
  );

  const descriptors: CandidateDescriptor[] = rawCandidates.map((c) => {
    // Parse version prioritizing target inner name -> archive filename -> display label -> detectedVersion
    const innerVer = parseComparableVersion(c.target.displayName);
    const archiveVer = parseComparableVersion(`${c.insp.sourceFilename} ${c.insp.fileDisplayLabel || ''}`);
    const fallbackVer = parseComparableVersion(c.target.detectedVersion || '');

    let bestVer = innerVer;
    if (compareComparableVersions(archiveVer, bestVer) > 0) bestVer = archiveVer;
    if (!bestVer.hasVersion && fallbackVer.hasVersion) bestVer = fallbackVer;

    const { score: contextScore, matchedSignals } = computeContextScore(
      {
        fileRole: c.insp.fileRole,
        fileDisplayLabel: c.insp.fileDisplayLabel,
        sourceFilename: c.insp.sourceFilename,
        target: c.target,
        roleCategory: c.roleCategory,
        combinedText: c.combinedText,
      },
      entry,
      context,
      releaseHasModifiedVariant,
    );

    const qualityScore = computeFormatQualityScore(c.target);
    const discInfo = extractDiscInfo(`${c.target.displayName} ${c.insp.sourceFilename}`);

    const reasonParts: string[] = ['Smart Primary'];
    if (matchedSignals.length > 0) {
      reasonParts.push(matchedSignals[0]);
    }
    if (bestVer.rawLabel) {
      reasonParts.push(`Latest ${bestVer.rawLabel}`);
    }

    return {
      fileId: c.insp.fileId,
      fileOrderIndex: c.fileOrderIndex,
      fileDownloadedAt: c.insp.fileDownloadedAt || null,
      target: c.target,
      targetOrderIndex: c.targetOrderIndex,
      combinedText: c.combinedText,
      roleCategory: c.roleCategory,
      version: bestVer,
      contextScore,
      qualityScore,
      discInfo,
      reason: reasonParts.join(' · '),
    };
  });

  // Sort candidates:
  // 1. Context relevance bucket (significant difference >= 30 points wins on intent;
  //    within the same intent tier, latest version strictly wins!)
  // 2. Latest parsed version (`compareComparableVersions`)
  // 3. Exact context score tie-breaker
  // 4. Disc 1 before Disc 2 when ranking lead candidate
  // 5. Newer file download timestamp / higher fileId (latest upload on RGT)
  // 6. Format quality score
  const sorted = [...descriptors].sort((a, b) => {
    const contextDelta = a.contextScore - b.contextScore;
    if (Math.abs(contextDelta) >= 30) {
      return b.contextScore - a.contextScore;
    }

    const verCmp = compareComparableVersions(a.version, b.version);
    if (verCmp !== 0) {
      return -verCmp; // Descending: newer version first
    }

    if (a.contextScore !== b.contextScore) {
      return b.contextScore - a.contextScore;
    }

    if (a.discInfo && b.discInfo && a.discInfo.discNumber !== b.discInfo.discNumber) {
      return a.discInfo.discNumber - b.discInfo.discNumber;
    }

    if (a.fileDownloadedAt && b.fileDownloadedAt && a.fileDownloadedAt !== b.fileDownloadedAt) {
      return b.fileDownloadedAt.localeCompare(a.fileDownloadedAt);
    }

    if (a.fileId !== b.fileId) {
      return b.fileId - a.fileId;
    }

    if (a.qualityScore !== b.qualityScore) {
      return b.qualityScore - a.qualityScore;
    }

    return a.targetOrderIndex - b.targetOrderIndex;
  });

  const winner = sorted[0];
  const chosen: CandidateDescriptor[] = [winner];

  // Multi-disc completeness: if winner is part of a multi-disc set, include sibling disc numbers
  // that belong to the same role category and version so all discs of the game install together.
  if (winner.discInfo) {
    const seenDiscNumbers = new Set<number>([winner.discInfo.discNumber]);
    for (const cand of sorted.slice(1)) {
      if (!cand.discInfo) continue;
      if (seenDiscNumbers.has(cand.discInfo.discNumber)) continue;
      if (cand.roleCategory !== winner.roleCategory) continue;
      if (compareComparableVersions(cand.version, winner.version) !== 0) continue;
      if (cand.target.extension.toLowerCase() !== winner.target.extension.toLowerCase()) continue;
      seenDiscNumbers.add(cand.discInfo.discNumber);
      chosen.push(cand);
    }
    chosen.sort((a, b) => (a.discInfo?.discNumber ?? 0) - (b.discInfo?.discNumber ?? 0));
  }

  for (const pick of chosen) {
    const list = selectedByFileId[pick.fileId] || [];
    if (!list.includes(pick.target.id)) {
      list.push(pick.target.id);
    }
    selectedByFileId[pick.fileId] = list;
    reasonByTargetKey[`${pick.fileId}:${pick.target.id}`] = pick.reason;
  }

  return { selectedByFileId, reasonByTargetKey };
}
