import type { M3uLayoutMode } from './discExport.ts';

export interface DiscSequenceInfo {
  isMultiDisc: boolean;
  /** Clean base title with disc token and extension stripped. */
  baseTitle: string;
  /** Numeric sort index (1-based; Side A = 1, Side B = 2, etc.). */
  discNumber: number;
  /** Normalized label such as "Disc 1" or "Side A". */
  discLabel: string | null;
}

export interface MultiDiscInputEntry<T = unknown> {
  /** Unique identifier for callers to map planned output paths back to inputs. */
  id: string;
  /** Logical game key (e.g. catalog item ID or console+baseTitle). */
  gameKey?: string;
  /** Human-readable game title fallback when filename lacks clean title. */
  gameTitle?: string;
  /** Planned output filename (e.g. `Final Fantasy VII (USA) (Disc 1).chd` or `.cue`). */
  outputFilename: string;
  /** Whether this entry is a multi-file `.cue`/`.bin` disc set rather than a single file (`.chd`/`.iso`). */
  isDiscSetFolder?: boolean;
  /** Optional subfolder name used when `isDiscSetFolder` is true (e.g. `Final Fantasy VII (USA) (Disc 1)`). */
  discSetFolderName?: string;
  payload?: T;
}

export interface PlannedDiscEntry<T = unknown> {
  id: string;
  discNumber: number;
  discLabel: string | null;
  /** Relative subfolder segments beneath the console root where this disc's file(s) should be written. */
  subpathSegments: string[];
  /** Output filename inside `subpathSegments` (e.g. `Final Fantasy VII (USA) (Disc 1).chd`). */
  filename: string;
  /** POSIX relative path written inside the `.m3u` file (e.g. `./.multidisc/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 1).chd`). */
  m3uLine: string;
  payload?: T;
}

export interface PlannedMultiDiscGroup<T = unknown> {
  gameKey: string;
  /** Base game name used for `<Game>.m3u` and `.multidisc/<Game>/`. */
  gameBaseName: string;
  /** Filename of the `.m3u` playlist placed in the console folder root. */
  m3uFilename: string;
  /** UTF-8 playlist contents using POSIX relative paths and `\n` line endings. */
  m3uContent: string;
  /** Relative folder segments for `.multidisc/<Game>` (empty when `layout === 'inline'`). */
  multidiscSubpathSegments: string[];
  layout: M3uLayoutMode;
  entries: PlannedDiscEntry<T>[];
}

export interface MultiDiscExportPlan<T = unknown> {
  groups: PlannedMultiDiscGroup<T>[];
  singles: MultiDiscInputEntry<T>[];
}

const FAT32_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

/**
 * Strip file extension (including double archive extensions like `.tar.gz` or single ROM/disc extensions).
 */
function stripFileExtension(name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const withoutTar = trimmed.replace(/\.(tar\.(?:gz|bz2|xz))$/i, '');
  if (withoutTar !== trimmed) return withoutTar;
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot > 0 && trimmed.length - lastDot <= 6) {
    return trimmed.slice(0, lastDot);
  }
  return trimmed;
}

/**
 * Sanitize a game folder or `.m3u` stem for FAT32/exFAT SD cards.
 */
export function sanitizeFat32Segment(raw: string, maxLen = 120): string {
  let clean = String(raw || '')
    .replace(FAT32_INVALID_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove trailing dots and spaces (illegal on FAT32/Windows)
  clean = clean.replace(/[. ]+$/g, '').trim();
  // Prevent dot-only traversal segments
  if (!clean || clean === '.' || clean === '..') {
    return 'Multi-Disc Game';
  }
  if (clean.length > maxLen) {
    clean = clean.slice(0, maxLen).replace(/[. ]+$/g, '').trim();
  }
  return clean || 'Multi-Disc Game';
}

const SIDE_TO_NUMBER: Record<string, number> = {
  a: 1,
  b: 2,
  c: 3,
  d: 4,
  e: 5,
  f: 6,
};

/**
 * Extract multi-disc sequence metadata from a ROM/disc filename or display name.
 * Recognizes:
 * - `(Disc 1)`, `(Disc 2 of 4)`, `[Disc 1]`, `Disc 01`
 * - `(CD 1)`, `(CD2)`, `CD 1`
 * - `(Disk 1)`, `(Disk 2)`
 * - `(Side A)`, `(Side B)`, `(Disk 1 Side A)`
 */
export function extractDiscSequenceInfo(name: string): DiscSequenceInfo {
  const stem = stripFileExtension(name);
  if (!stem) {
    return { isMultiDisc: false, baseTitle: '', discNumber: 1, discLabel: null };
  }

  // Pattern 1: Bracketed / parenthesized Disc/Disk/CD + number (+ optional "of N")
  const bracketedDisc = /[\(\[]\s*(?:disc|disk|cd)\s*0*(\d+)(?:\s*(?:of|\/)\s*\d+)?(?:\s*[-,: ]+[^)\]]*)?\s*[\)\]]/i;
  const m1 = stem.match(bracketedDisc);
  if (m1 && m1[1]) {
    const discNum = Math.max(1, Number.parseInt(m1[1], 10));
    const baseTitle = stem
      .replace(bracketedDisc, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s*$/, '')
      .trim();
    return {
      isMultiDisc: true,
      baseTitle: baseTitle || stem,
      discNumber: discNum,
      discLabel: `Disc ${discNum}`,
    };
  }

  // Pattern 2: Bracketed / parenthesized Side A / B / C / D
  const bracketedSide = /[\(\[]\s*side\s*([a-f1-6])\s*[\)\]]/i;
  const m2 = stem.match(bracketedSide);
  if (m2 && m2[1]) {
    const token = m2[1].toLowerCase();
    const discNum = SIDE_TO_NUMBER[token] ?? Math.max(1, Number.parseInt(token, 10) || 1);
    const baseTitle = stem.replace(bracketedSide, ' ').replace(/\s+/g, ' ').trim();
    return {
      isMultiDisc: true,
      baseTitle: baseTitle || stem,
      discNumber: discNum,
      discLabel: `Side ${m2[1].toUpperCase()}`,
    };
  }

  // Pattern 3: Unbracketed trailing or separator-delimited Disc/Disk/CD N (e.g. "Game - Disc 2" or "Game_CD1")
  const bareDisc = /(?:^|[\s._-])(?:disc|disk|cd)\s*0*(\d+)(?:\s*(?:of|\/)\s*\d+)?(?=$|[\s._-]|[\(\[])/i;
  const m3 = stem.match(bareDisc);
  if (m3 && m3[1]) {
    const discNum = Math.max(1, Number.parseInt(m3[1], 10));
    const baseTitle = stem
      .replace(bareDisc, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[-_.\s]+$/, '')
      .trim();
    return {
      isMultiDisc: true,
      baseTitle: baseTitle || stem,
      discNumber: discNum,
      discLabel: `Disc ${discNum}`,
    };
  }

  return {
    isMultiDisc: false,
    baseTitle: stem.trim(),
    discNumber: 1,
    discLabel: null,
  };
}

/**
 * Build POSIX-compliant UTF-8 `.m3u` playlist contents using `\n` line endings.
 */
export function buildM3uPlaylistContent(relativeDiscPaths: string[]): string {
  const normalized = relativeDiscPaths
    .map((p) => String(p || '').replace(/\\/g, '/').trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('./') || p.startsWith('../') || p.startsWith('/') ? p : `./${p}`));
  if (normalized.length === 0) return '';
  return `${normalized.join('\n')}\n`;
}

const DISC_MEDIA_EXTENSIONS = new Set([
  '.chd',
  '.cue',
  '.gdi',
  '.iso',
  '.pbp',
  '.cso',
  '.m3u',
  '.toc',
  '.ccd',
  '.mds',
]);

export function isPlaylistEligibleDiscFilename(filename: string): boolean {
  const lower = String(filename || '').trim().toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx <= 0) return false;
  const ext = lower.slice(dotIdx);
  return ext !== '.m3u' && DISC_MEDIA_EXTENSIONS.has(ext);
}

/**
 * Group multi-disc entries and compute deterministic `.m3u` playlists and folder layouts.
 * Single-disc releases remain untouched in `singles`.
 */
export function planMultiDiscExportLayout<T = unknown>(
  entries: MultiDiscInputEntry<T>[],
  options?: {
    layout?: M3uLayoutMode;
    sanitizeFat32?: boolean;
    maxFilenameLen?: number;
  },
): MultiDiscExportPlan<T> {
  const layout: M3uLayoutMode = options?.layout === 'inline' ? 'inline' : 'subfolder';
  const sanitize = options?.sanitizeFat32 !== false;
  const maxLen = Math.max(48, Math.min(220, Number(options?.maxFilenameLen || 120)));

  const buckets = new Map<
    string,
    Array<{
      entry: MultiDiscInputEntry<T>;
      info: DiscSequenceInfo;
    }>
  >();

  const singles: MultiDiscInputEntry<T>[] = [];

  for (const entry of entries) {
    if (!isPlaylistEligibleDiscFilename(entry.outputFilename)) {
      singles.push(entry);
      continue;
    }

    const info = extractDiscSequenceInfo(entry.outputFilename);
    const keySource = entry.gameKey?.trim() || info.baseTitle.toLowerCase();
    if (!keySource) {
      singles.push(entry);
      continue;
    }

    const bucket = buckets.get(keySource) || [];
    bucket.push({ entry, info });
    buckets.set(keySource, bucket);
  }

  const groups: PlannedMultiDiscGroup<T>[] = [];

  for (const [gameKey, items] of buckets.entries()) {
    // Only generate `.m3u` when 2+ disc entries belong to the same game and at least one
    // carries a multi-disc token (or multiple discs share an explicit gameKey).
    const hasDiscTokens = items.some((item) => item.info.isMultiDisc);
    if (items.length < 2 || (!hasDiscTokens && !items.every((item) => Boolean(item.entry.gameKey)))) {
      for (const item of items) {
        singles.push(item.entry);
      }
      continue;
    }

    // Sort numerically by disc number, then lexicographically by filename for deterministic output
    const sorted = [...items].sort((a, b) => {
      if (a.info.discNumber !== b.info.discNumber) {
        return a.info.discNumber - b.info.discNumber;
      }
      return a.entry.outputFilename.localeCompare(b.entry.outputFilename, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });

    const preferredBaseRaw =
      sorted.find((item) => item.info.baseTitle)?.info.baseTitle ||
      sorted.find((item) => item.entry.gameTitle)?.entry.gameTitle ||
      'Multi-Disc Game';
    const gameBaseName = sanitize
      ? sanitizeFat32Segment(preferredBaseRaw, Math.max(32, maxLen - 4))
      : preferredBaseRaw.replace(/[\\/]/g, ' ').trim() || 'Multi-Disc Game';

    const m3uFilename = `${gameBaseName}.m3u`;
    const multidiscSubpathSegments = layout === 'subfolder' ? ['.multidisc', gameBaseName] : [];

    const plannedEntries: PlannedDiscEntry<T>[] = sorted.map((item, idx) => {
      const discNumber = item.info.isMultiDisc ? item.info.discNumber : idx + 1;
      const discLabel = item.info.discLabel || `Disc ${discNumber}`;
      const filename = item.entry.outputFilename;
      const subpathSegments = [...multidiscSubpathSegments];

      if (item.entry.isDiscSetFolder) {
        const rawFolder =
          item.entry.discSetFolderName || stripFileExtension(filename) || `${gameBaseName} (${discLabel})`;
        const safeFolder = sanitize
          ? sanitizeFat32Segment(rawFolder, Math.max(32, maxLen))
          : rawFolder.replace(/[\\/]/g, ' ').trim();
        subpathSegments.push(safeFolder);
      }

      const posixParts = [...subpathSegments, filename].map((part) => part.replace(/\\/g, '/'));
      const m3uLine = `./${posixParts.join('/')}`;

      return {
        id: item.entry.id,
        discNumber,
        discLabel,
        subpathSegments,
        filename,
        m3uLine,
        payload: item.entry.payload,
      };
    });

    const m3uContent = buildM3uPlaylistContent(plannedEntries.map((e) => e.m3uLine));

    groups.push({
      gameKey,
      gameBaseName,
      m3uFilename,
      m3uContent,
      multidiscSubpathSegments,
      layout,
      entries: plannedEntries,
    });
  }

  return { groups, singles };
}
