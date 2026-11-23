import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import yazl from 'yazl';
import {
  extractVersionFromText,
  formatPreparedRomName,
  sanitizeFat32Filename,
  type RomNamingConfig,
} from '../shared/romNaming.ts';
import { formatErrorDetails, logServer } from './logger.ts';
import type {
  ArchiveBrowseEntry,
  ArchiveBrowseListing,
  ArchiveEntryCategory,
  ArchiveFormat,
  ArchiveInspectResult,
  ArchiveTextPreviewResult,
  PlayableExportTarget,
  ReleaseFileRecord,
  RepositoryItemRecord,
} from './types.ts';

interface RawArchiveEntry {
  entryPath: string;
  sizeBytes: number;
  isDir: boolean;
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.nfo', '.diz', '.cue', '.gdi', '.ccd', '.m3u',
  '.ini', '.cfg', '.json', '.xml', '.sfv', '.md5', '.sha1', '.sha256', '.log',
  '.url', '.webloc', '.rtf', '.html', '.htm', '.csv', '.yaml', '.yml',
]);

const MAX_TEXT_PREVIEW_FILE_BYTES = 512 * 1024;
const DEFAULT_TEXT_PREVIEW_READ_BYTES = 128 * 1024;

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.xz', '.bz2']);

// Note: `.md` is intentionally NOT in unconditional CLUTTER_EXTENSIONS because Sega Genesis /
// Mega Drive ROMs use the `.md` extension (No-Intro standard). `.md` entries are disambiguated
// via `isMarkdownDocEntry()` so README.md / CHANGELOG.md docs are stripped while Genesis ROMs are kept.
const CLUTTER_EXTENSIONS = new Set([
  '.txt', '.markdown', '.nfo', '.diz', '.url', '.webloc', '.lnk',
  '.html', '.htm', '.pdf', '.doc', '.docx', '.rtf', '.jpg', '.jpeg', '.png',
  '.gif', '.webp', '.bmp', '.ico', '.xml', '.json', '.ini', '.cfg', '.sfv',
  '.md5', '.sha1', '.sha256', '.log', '.cue~', '.bak',
]);

const PATCH_EXTENSIONS = new Set(['.ips', '.bps', '.ups', '.xdelta', '.vcdiff', '.ppf', '.bdf']);

const DISC_DESCRIPTOR_EXTENSIONS = new Set(['.cue', '.gdi', '.ccd', '.m3u']);

const SINGLE_DISC_EXTENSIONS = new Set(['.chd', '.iso', '.cso', '.pbp', '.rvz', '.gcz', '.wia', '.wbfs', '.xiso', '.cci']);

const DISC_TRACK_EXTENSIONS = new Set(['.bin', '.raw', '.img', '.sub', '.wav', '.mp3', '.ogg', '.pcm', '.toc']);

const PLAYABLE_ROM_EXTENSIONS = new Set([
  '.nes', '.fds', '.unf', '.unif', '.sfc', '.smc', '.fig', '.swc', '.bs',
  '.gb', '.gbc', '.gba', '.srl', '.nds', '.dsi', '.3ds', '.cia', '.vb', '.vboy',
  '.n64', '.z64', '.v64', '.ndd', '.gen', '.md', '.smd', '.32x', '.sms', '.gg',
  '.sg', '.pce', '.hes', '.ngp', '.ngc', '.ws', '.wsc', '.col', '.int', '.vec',
  '.a26', '.a52', '.a78', '.j64', '.jag', '.lnx', '.lyx', '.min', '.p8', '.tic',
  '.d64', '.t64', '.prg', '.crt', '.adf', '.ipf', '.tzx', '.tap', '.dsk',
  '.mx1', '.mx2', '.rom', '.wad', '.bin',
  ...SINGLE_DISC_EXTENSIONS,
]);

const MARKDOWN_DOC_BASENAME_RE =
  /^(readme|read[\s._-]?me|changelog|change[\s._-]?log|changes|history|license|licence|credits|notes|release[\s._-]?notes|manual|faq|todo|contributing|instructions|guide|howto|how[\s._-]?to|about|info|whatsnew|whats[\s._-]?new|version|patch[\s._-]?notes|install|authors|acknowledgments?)(\b|[._\s-]|$)/i;

const MARKDOWN_DOC_DIR_SEGMENT_RE = /^(docs?|documentation|readme|readmes|info|manual|manuals)$/i;

const SEGA_GENESIS_SYSTEM_RE = /genesis|mega[\s_-]*drive|\bmd\b|\bgen\b/i;

export function isSegaGenesisSystemName(systemName?: string | null): boolean {
  if (!systemName) return false;
  return SEGA_GENESIS_SYSTEM_RE.test(systemName);
}

/**
 * Disambiguates `.md` archive entries between Sega Mega Drive / Genesis ROMs and Markdown docs.
 * Retail Mega Drive ROMs are >= 128 KB (tiny homebrews typically >= 32 KB), while Markdown docs
 * are small text files (< 128 KB) named README/CHANGELOG/NOTES/etc. or sitting in non-Genesis archives.
 */
export function isMarkdownDocEntry(
  entryPath: string,
  sizeBytes: number,
  systemName?: string | null,
): boolean {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const ext = getExtLower(normalized);
  if (ext !== '.md') return false;

  // Retail Genesis/Mega Drive carts start at 128 KB and go up to 4 MB+
  if (sizeBytes >= 131_072) return false;

  const base = path.posix.basename(normalized);
  const stem = base.slice(0, -ext.length).trim();
  if (MARKDOWN_DOC_BASENAME_RE.test(stem)) {
    return true;
  }

  const dirSegments = normalized.split('/').slice(0, -1);
  if (dirSegments.some((seg) => MARKDOWN_DOC_DIR_SEGMENT_RE.test(seg))) {
    return true;
  }

  // In non-Genesis systems (e.g., SNES, GBA, PSX), any small `.md` file is a Markdown document
  if (systemName && !isSegaGenesisSystemName(systemName) && sizeBytes < 65_536) {
    return true;
  }

  // Without system context (e.g., direct filesystem archive browsing), tiny < 16 KB `.md` files are docs
  if (!systemName && sizeBytes < 16_384) {
    return true;
  }

  return false;
}

export function isClutterEntry(
  entryPath: string,
  sizeBytes: number,
  systemName?: string | null,
): boolean {
  const ext = getExtLower(entryPath);
  if (CLUTTER_EXTENSIONS.has(ext)) return true;
  if (ext === '.md') return isMarkdownDocEntry(entryPath, sizeBytes, systemName);
  return false;
}

export function escapeUnzipGlobPattern(entryPath: string): string {
  return entryPath.replace(/([\\[\]*?])/g, '\\$1');
}

export function escapeBsdtarGlobPattern(entryPath: string): string {
  return entryPath.replace(/([\\[\]*?])/g, '\\$1');
}

function buildExtractorEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const lang = (env.LANG || '').trim();
  const lcAll = (env.LC_ALL || '').trim();
  if (!lang || /^(C|POSIX)$/i.test(lang)) {
    env.LANG = 'C.UTF-8';
  }
  if (!lcAll || /^(C|POSIX)$/i.test(lcAll)) {
    env.LC_ALL = 'C.UTF-8';
  }
  return env;
}

let cached7zPath: string | null | undefined;
let cached7zSupportsRar: boolean | undefined;
let cachedUnrarPath: string | null | undefined;
let cachedBsdtarPath: string | null | undefined;

export type SniffedArchiveMagicKind =
  | 'rar5'
  | 'rar4'
  | 'zip'
  | '7z'
  | 'gzip'
  | 'xz'
  | 'bzip2'
  | 'html'
  | 'empty'
  | 'unknown';

export interface SniffedArchiveMagic {
  kind: SniffedArchiveMagicKind;
  sizeBytes: number;
  hexHead: string;
}

export function classifyArchiveMagicBytes(buf: Buffer, sizeBytes = buf.length): SniffedArchiveMagic {
  if (sizeBytes === 0 || buf.length === 0) {
    return { kind: 'empty', sizeBytes: 0, hexHead: '' };
  }
  const hexHead = Array.from(buf.subarray(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');

  // RAR5: 52 61 72 21 1a 07 01 00 ("Rar!\x1a\x07\x01\x00")
  if (
    buf.length >= 8 &&
    buf[0] === 0x52 &&
    buf[1] === 0x61 &&
    buf[2] === 0x72 &&
    buf[3] === 0x21 &&
    buf[4] === 0x1a &&
    buf[5] === 0x07 &&
    buf[6] === 0x01 &&
    buf[7] === 0x00
  ) {
    return { kind: 'rar5', sizeBytes, hexHead };
  }

  // RAR4 / legacy RAR: 52 61 72 21 1a 07 00 ("Rar!\x1a\x07\x00")
  if (
    buf.length >= 7 &&
    buf[0] === 0x52 &&
    buf[1] === 0x61 &&
    buf[2] === 0x72 &&
    buf[3] === 0x21 &&
    buf[4] === 0x1a &&
    buf[5] === 0x07 &&
    buf[6] === 0x00
  ) {
    return { kind: 'rar4', sizeBytes, hexHead };
  }

  // ZIP: PK\x03\x04, PK\x05\x06, PK\x07\x08
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    ((buf[2] === 0x03 && buf[3] === 0x04) ||
      (buf[2] === 0x05 && buf[3] === 0x06) ||
      (buf[2] === 0x07 && buf[3] === 0x08))
  ) {
    return { kind: 'zip', sizeBytes, hexHead };
  }

  // 7z: 37 7a bc af 27 1c
  if (
    buf.length >= 6 &&
    buf[0] === 0x37 &&
    buf[1] === 0x7a &&
    buf[2] === 0xbc &&
    buf[3] === 0xaf &&
    buf[4] === 0x27 &&
    buf[5] === 0x1c
  ) {
    return { kind: '7z', sizeBytes, hexHead };
  }

  // GZIP: 1f 8b
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return { kind: 'gzip', sizeBytes, hexHead };
  }

  // XZ: fd 37 7a 58 5a 00
  if (
    buf.length >= 6 &&
    buf[0] === 0xfd &&
    buf[1] === 0x37 &&
    buf[2] === 0x7a &&
    buf[3] === 0x58 &&
    buf[4] === 0x5a &&
    buf[5] === 0x00
  ) {
    return { kind: 'xz', sizeBytes, hexHead };
  }

  // BZIP2: BZh
  if (buf.length >= 3 && buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
    return { kind: 'bzip2', sizeBytes, hexHead };
  }

  // Detect HTML/XML error or login pages saved with an archive extension
  const textHead = buf.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (
    textHead.startsWith('<!doctype html') ||
    textHead.startsWith('<html') ||
    textHead.startsWith('<head') ||
    textHead.startsWith('<body') ||
    textHead.startsWith('<?xml')
  ) {
    return { kind: 'html', sizeBytes, hexHead };
  }

  return { kind: 'unknown', sizeBytes, hexHead };
}

export function sniffArchiveMagic(archivePath: string): SniffedArchiveMagic {
  const st = fs.statSync(archivePath);
  if (st.size === 0) {
    return { kind: 'empty', sizeBytes: 0, hexHead: '' };
  }
  const readLen = Math.min(st.size, 512);
  const buf = Buffer.alloc(readLen);
  const fd = fs.openSync(archivePath, 'r');
  try {
    fs.readSync(fd, buf, 0, readLen, 0);
  } finally {
    fs.closeSync(fd);
  }
  return classifyArchiveMagicBytes(buf, st.size);
}

export function detect7zRarSupportFromInfoOutput(stdout: string): boolean {
  const normalized = stdout.replace(/\r\n/g, '\n');
  const formatsIdx = normalized.indexOf('Formats:');
  const section = formatsIdx >= 0 ? normalized.slice(formatsIdx) : normalized;
  const codecsIdx = section.indexOf('\nCodecs:');
  const formatsOnly = codecsIdx >= 0 ? section.slice(0, codecsIdx) : section;
  return /^\s*[0-9A-Za-z.]+\s+Rar5?\b/im.test(formatsOnly);
}

export async function resolve7zBinary(): Promise<string | null> {
  if (cached7zPath !== undefined) return cached7zPath;

  for (const cmd of ['7zz', '7z', '7za']) {
    try {
      const found = execFileSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (found) {
        cached7zPath = found;
        logServer('ARCHIVE', 'debug', `Resolved 7-Zip binary "${cmd}" -> ${found}`);
        return cached7zPath;
      }
    } catch {
      // Not on PATH; continue checking fallbacks
    }
  }

  try {
    const mod = await import('7zip-bin');
    const candidate = mod.path7za || (mod.default as { path7za?: string } | undefined)?.path7za;
    if (candidate && fs.existsSync(candidate)) {
      try {
        fs.chmodSync(candidate, 0o755);
      } catch {
        // Ignore chmod failure on read-only mounts
      }
      cached7zPath = candidate;
      logServer('ARCHIVE', 'debug', `Resolved bundled 7zip-bin binary -> ${candidate}`);
      return cached7zPath;
    }
  } catch (err) {
    logServer('ARCHIVE', 'debug', 'Failed loading bundled 7zip-bin fallback', formatErrorDetails(err));
  }

  cached7zPath = null;
  logServer('ARCHIVE', 'debug', 'No 7-Zip binary resolved; falling back to unzip/unrar/bsdtar');
  return null;
}

export async function check7zSupportsRar(bin7z: string): Promise<boolean> {
  if (cached7zSupportsRar !== undefined) return cached7zSupportsRar;
  try {
    const res = await runProcessCapture(bin7z, ['i']);
    cached7zSupportsRar = res.code === 0 && detect7zRarSupportFromInfoOutput(res.stdout);
  } catch {
    cached7zSupportsRar = false;
  }
  logServer(
    'ARCHIVE',
    'debug',
    `7-Zip RAR codec probe (${path.basename(bin7z)}): ${cached7zSupportsRar ? 'supported' : 'not compiled in'}`,
  );
  return cached7zSupportsRar;
}

export async function resolveUnrarBinary(): Promise<string | null> {
  if (cachedUnrarPath !== undefined) return cachedUnrarPath;
  for (const cmd of ['unrar', 'unrar-nonfree']) {
    try {
      const found = execFileSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (found) {
        cachedUnrarPath = found;
        logServer('ARCHIVE', 'debug', `Resolved unrar binary "${cmd}" -> ${found}`);
        return cachedUnrarPath;
      }
    } catch {
      // Not on PATH; continue
    }
  }
  cachedUnrarPath = null;
  return null;
}

export async function resolveBsdtarBinary(): Promise<string | null> {
  if (cachedBsdtarPath !== undefined) return cachedBsdtarPath;
  try {
    const found = execFileSync('which', ['bsdtar'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found) {
      cachedBsdtarPath = found;
      logServer('ARCHIVE', 'debug', `Resolved bsdtar binary -> ${found}`);
      return cachedBsdtarPath;
    }
  } catch {
    // Not on PATH
  }
  cachedBsdtarPath = null;
  return null;
}

function describeUnrarExitCode(code: number): string {
  switch (code) {
    case 1:
      return 'non-fatal warning';
    case 2:
      return 'fatal error';
    case 3:
      return 'CRC or corrupt archive data';
    case 5:
      return 'write error';
    case 6:
      return 'file open error';
    case 7:
      return 'invalid command line option';
    case 8:
      return 'not enough memory';
    case 10:
      return 'no matching files found in archive';
    case 11:
      return 'wrong password (encrypted RAR archive)';
    default:
      return `exit code ${code}`;
  }
}

export function detectArchiveFormat(filePath: string): ArchiveFormat {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.7z')) return '7z';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.tar') || lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || lower.endsWith('.tar.xz')) {
    return 'tar';
  }
  return 'raw';
}

function isSafeArchiveEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes('\0')) return false;
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  const parts = normalized.split('/');
  if (parts.some((p) => p === '..')) return false;
  if (normalized.includes('__MACOSX/') || path.posix.basename(normalized) === '.DS_Store' || path.posix.basename(normalized).toLowerCase() === 'thumbs.db') {
    return false;
  }
  return true;
}

function runProcessCapture(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildExtractorEnv(),
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => outChunks.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
        code: code ?? 1,
      });
    });
  });
}

function parse7zSltOutput(stdout: string): RawArchiveEntry[] {
  const entries: RawArchiveEntry[] = [];
  const normalized = stdout.replace(/\r\n/g, '\n');
  const separatorIdx = normalized.indexOf('----------\n');
  const body = separatorIdx >= 0 ? normalized.slice(separatorIdx + '----------\n'.length) : normalized;
  const blocks = body.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let entryPath = '';
    let sizeBytes = 0;
    let isDir = false;

    for (const line of lines) {
      const eq = line.indexOf(' = ');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 3).trim();
      if (key === 'Path') entryPath = val.replace(/\\/g, '/');
      else if (key === 'Size') sizeBytes = Math.max(0, Number(val) || 0);
      else if (key === 'Folder') isDir = val === '+';
      else if (key === 'Attributes' && val.startsWith('D')) isDir = true;
    }

    if (entryPath && !isDir && isSafeArchiveEntryPath(entryPath)) {
      entries.push({ entryPath, sizeBytes, isDir: false });
    }
  }

  return entries;
}

export function parseUnrarLtOutput(stdout: string): RawArchiveEntry[] {
  const entries: RawArchiveEntry[] = [];
  const normalized = stdout.replace(/\r\n/g, '\n');
  let current: { entryPath: string; sizeBytes: number; isDir: boolean } | null = null;

  const flush = () => {
    if (!current) return;
    const cleanedPath = current.entryPath.replace(/^\.\//, '');
    if (cleanedPath && !current.isDir && isSafeArchiveEntryPath(cleanedPath)) {
      entries.push({ entryPath: cleanedPath, sizeBytes: current.sizeBytes, isDir: false });
    }
    current = null;
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (key === 'Name') {
      flush();
      current = {
        entryPath: val.replace(/\\/g, '/'),
        sizeBytes: 0,
        isDir: false,
      };
      continue;
    }

    if (!current) continue;

    if (key === 'Type') {
      const lower = val.toLowerCase();
      if (lower === 'directory' || lower === 'dir' || lower.includes('link')) {
        current.isDir = true;
      }
    } else if (key === 'Size') {
      current.sizeBytes = Math.max(0, Number(val.replace(/,/g, '')) || 0);
    } else if (key === 'Attributes') {
      if (val.startsWith('d') || val.startsWith('D') || /^[\.\-]*D[\.\-]*$/i.test(val)) {
        current.isDir = true;
      }
    }
  }
  flush();
  return entries;
}

export function parseBsdtarVerboseOutput(stdout: string): RawArchiveEntry[] {
  const entries: RawArchiveEntry[] = [];
  for (const rawLine of stdout.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Standard bsdtar -tvf format:
    // -rw-r--r--  0 0      0   451234567 Mar 10  2024 Sonic Megamix 5.0a.bin
    // drwxr-xr-x  0 0      0           0 Mar 10  2024 Docs/
    const match = line.match(
      /^([-dlbcps][rwxstST-]{9}[.+@]?)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(?:[A-Za-z]{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/,
    );
    if (!match) continue;
    const mode = match[1];
    if (mode.startsWith('d') || mode.startsWith('l')) continue;
    const sizeBytes = Math.max(0, Number(match[2]) || 0);
    const entryPath = match[3].replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (entryPath && !entryPath.endsWith('/') && isSafeArchiveEntryPath(entryPath)) {
      entries.push({ entryPath, sizeBytes, isDir: false });
    }
  }
  return entries;
}

export async function listArchiveEntries(archivePath: string): Promise<{ format: ArchiveFormat; entries: RawArchiveEntry[] }> {
  const format = detectArchiveFormat(archivePath);
  if (format === 'raw') {
    const st = fs.statSync(archivePath);
    return {
      format: 'raw',
      entries: [{ entryPath: path.basename(archivePath), sizeBytes: st.size, isDir: false }],
    };
  }

  const magic = sniffArchiveMagic(archivePath);
  if (magic.kind === 'empty') {
    throw new Error(`Archive file "${path.basename(archivePath)}" is empty (0 bytes) on disk — retry downloading this release.`);
  }
  if (magic.kind === 'html') {
    throw new Error(
      `File "${path.basename(archivePath)}" appears to be an HTML page rather than a valid ${format.toUpperCase()} archive — retry downloading this release.`,
    );
  }

  const isRarPayload =
    magic.kind === 'rar4' ||
    magic.kind === 'rar5' ||
    (format === 'rar' && magic.kind !== 'zip' && magic.kind !== '7z');

  if (isRarPayload) {
    const errors: string[] = [];

    // 1. Prefer native RARLAB `unrar` (supports RAR1-RAR5, solid archives, and multi-GB streams)
    const unrarBin = await resolveUnrarBinary();
    if (unrarBin) {
      const res = await runProcessCapture(unrarBin, ['lt', '-p-', '--', archivePath]);
      if (res.code === 0) {
        const entries = parseUnrarLtOutput(res.stdout);
        logServer(
          'ARCHIVE',
          'debug',
          `Listed RAR archive via ${path.basename(unrarBin)}`,
          `${path.basename(archivePath)} (${magic.kind}, ${entries.length} entries)`,
        );
        return { format: 'rar', entries };
      }
      const detail = res.stderr.trim() || res.stdout.trim() || describeUnrarExitCode(res.code);
      logServer(
        'ARCHIVE',
        'debug',
        `unrar list returned exit code ${res.code} for ${path.basename(archivePath)}`,
        detail,
      );
      errors.push(`unrar: ${detail}`);
    }

    // 2. Try 7-Zip if its compiled binary actually includes RAR codec support
    const bin7z = await resolve7zBinary();
    const sevenZipSupportsRar = bin7z ? await check7zSupportsRar(bin7z) : false;
    if (bin7z && sevenZipSupportsRar) {
      const res = await runProcessCapture(bin7z, ['l', '-slt', '-sccUTF-8', '--', archivePath]);
      if (res.code === 0) {
        const entries = parse7zSltOutput(res.stdout);
        logServer(
          'ARCHIVE',
          'debug',
          `Listed RAR archive via ${path.basename(bin7z)}`,
          `${path.basename(archivePath)} (${magic.kind}, ${entries.length} entries)`,
        );
        return { format: 'rar', entries };
      }
      const detail = res.stderr.trim() || `exit code ${res.code}`;
      logServer(
        'ARCHIVE',
        'debug',
        `7-Zip list returned exit code ${res.code} for ${path.basename(archivePath)}`,
        detail,
      );
      errors.push(`7-Zip: ${detail}`);
    }

    // 3. Fallback to libarchive's bsdtar (handles non-solid RAR4 and RAR5 when unrar is absent)
    const bsdtarBin = await resolveBsdtarBinary();
    if (bsdtarBin) {
      const res = await runProcessCapture(bsdtarBin, ['-tvf', archivePath]);
      if (res.code === 0) {
        const entries = parseBsdtarVerboseOutput(res.stdout);
        logServer(
          'ARCHIVE',
          'debug',
          `Listed RAR archive via bsdtar fallback`,
          `${path.basename(archivePath)} (${magic.kind}, ${entries.length} entries)`,
        );
        return { format: 'rar', entries };
      }
      const detail = res.stderr.trim() || `exit code ${res.code}`;
      logServer(
        'ARCHIVE',
        'debug',
        `bsdtar list returned exit code ${res.code} for ${path.basename(archivePath)}`,
        detail,
      );
      errors.push(`bsdtar: ${detail}`);
    }

    if (magic.kind !== 'rar4' && magic.kind !== 'rar5') {
      throw new Error(
        `Unable to list RAR archive: "${path.basename(archivePath)}" does not have a valid RAR header (magic: ${magic.hexHead || 'unknown'}). Try re-downloading this release.`,
      );
    }

    if (!unrarBin && !sevenZipSupportsRar && !bsdtarBin) {
      throw new Error(
        `Unable to list RAR archive: this runtime has no RAR-capable extractor installed (install unrar or update to the latest container image).`,
      );
    }

    throw new Error(`Unable to list RAR archive: ${errors.join(' | ')}`);
  }

  const bin7z = await resolve7zBinary();
  if (bin7z) {
    const res = await runProcessCapture(bin7z, ['l', '-slt', '-sccUTF-8', '--', archivePath]);
    if (res.code === 0) {
      const entries = parse7zSltOutput(res.stdout);
      logServer('ARCHIVE', 'debug', `Listed archive via ${path.basename(bin7z)}`, `${path.basename(archivePath)} (${format}, ${entries.length} entries)`);
      return { format, entries };
    }
    logServer(
      'ARCHIVE',
      'debug',
      `7-Zip list returned exit code ${res.code} for ${path.basename(archivePath)}`,
      res.stderr.trim() || 'no stderr',
    );
    if (format !== 'zip') {
      const bsdtarBin = await resolveBsdtarBinary();
      if (bsdtarBin) {
        const tarRes = await runProcessCapture(bsdtarBin, ['-tvf', archivePath]);
        if (tarRes.code === 0) {
          const entries = parseBsdtarVerboseOutput(tarRes.stdout);
          logServer('ARCHIVE', 'debug', `Listed archive via bsdtar fallback`, `${path.basename(archivePath)} (${format}, ${entries.length} entries)`);
          return { format, entries };
        }
      }
      throw new Error(`Unable to list ${format.toUpperCase()} archive: ${res.stderr.trim() || `exit code ${res.code}`}`);
    }
  }

  // Fallback to unzip -l for .zip if 7z wasn't found or failed
  if (format === 'zip') {
    const res = await runProcessCapture('unzip', ['-l', archivePath]);
    if (res.code !== 0) {
      logServer(
        'ARCHIVE',
        'debug',
        `unzip list failed (exit=${res.code}) for ${path.basename(archivePath)}`,
        res.stderr.trim() || 'no stderr',
      );
      throw new Error(`Unable to inspect ZIP archive: ${res.stderr.trim() || `exit code ${res.code}`}`);
    }
    const entries: RawArchiveEntry[] = [];
    for (const line of res.stdout.split(/\r?\n/)) {
      // unzip -l format: "  12345  2024-01-01 12:00   folder/file.nes" or "  12345  01-01-2024 12:00   folder/file.nes"
      const m = line.match(/^\s*(\d+)\s+\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/);
      if (m) {
        const sizeBytes = Number(m[1]) || 0;
        const entryPath = m[2].replace(/\\/g, '/').trim();
        if (entryPath && !entryPath.endsWith('/') && isSafeArchiveEntryPath(entryPath)) {
          entries.push({ entryPath, sizeBytes, isDir: false });
        }
      }
    }
    logServer('ARCHIVE', 'debug', `Listed ZIP archive via unzip fallback`, `${path.basename(archivePath)} (${entries.length} entries)`);
    return { format: 'zip', entries };
  }

  throw new Error(`Archive inspection requires 7-Zip (${format.toUpperCase()} archive cannot be read).`);
}

function getExtLower(filePath: string): string {
  const base = path.posix.basename(filePath);
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx).toLowerCase() : '';
}

export function classifyArchiveEntry(
  entryPath: string,
  sizeBytes: number,
  systemName?: string | null,
): ArchiveBrowseEntry {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const name = path.posix.basename(normalized);
  const ext = getExtLower(normalized);
  const markdownDoc = ext === '.md' && isMarkdownDocEntry(normalized, sizeBytes, systemName);

  let category: ArchiveEntryCategory = 'other';
  if (DISC_DESCRIPTOR_EXTENSIONS.has(ext) || SINGLE_DISC_EXTENSIONS.has(ext) || DISC_TRACK_EXTENSIONS.has(ext)) {
    category = 'disc';
  } else if (markdownDoc) {
    category = 'doc';
  } else if (PLAYABLE_ROM_EXTENSIONS.has(ext)) {
    category = 'rom';
  } else if (PATCH_EXTENSIONS.has(ext)) {
    category = 'patch';
  } else if (ARCHIVE_EXTENSIONS.has(ext)) {
    category = 'archive';
  } else if (CLUTTER_EXTENSIONS.has(ext)) {
    category = 'doc';
  }

  const previewableText =
    (ext === '.md' ? markdownDoc : TEXT_PREVIEW_EXTENSIONS.has(ext)) &&
    sizeBytes <= MAX_TEXT_PREVIEW_FILE_BYTES;

  return {
    path: normalized,
    name,
    sizeBytes,
    extension: ext,
    category,
    previewableText,
  };
}

export async function browseArchiveAtPath(
  archiveAbsPath: string,
  systemName?: string | null,
): Promise<ArchiveBrowseListing> {
  const st = fs.statSync(archiveAbsPath);
  const { format, entries } = await listArchiveEntries(archiveAbsPath);

  const browseEntries = entries
    .map((entry) => classifyArchiveEntry(entry.entryPath, entry.sizeBytes, systemName))
    .sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }),
    );

  const totalUncompressedBytes = browseEntries.reduce((sum, e) => sum + e.sizeBytes, 0);

  return {
    sourceFilename: path.basename(archiveAbsPath),
    archiveFormat: format,
    archiveSizeBytes: st.size,
    totalFiles: browseEntries.length,
    totalUncompressedBytes,
    entries: browseEntries,
  };
}

function cleanVariantDistinguisher(entryPath: string, totalVariants: number): string | null {
  if (totalVariants <= 1) return null;
  const base = path.posix.basename(entryPath).replace(/\.[^.]+$/, '').trim();
  const parens = Array.from(base.matchAll(/\(([^)]+)\)/g)).map((m) => m[1].trim());
  const brackets = Array.from(base.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1].trim());
  const hints = [...parens, ...brackets].filter(
    (h) => !/^(usa|u|eur|e|jpn|j|world|w|europe|japan)$/i.test(h),
  );
  if (hints.length > 0) {
    return hints[hints.length - 1];
  }
  return base.slice(0, 48);
}

export async function inspectArchiveForItem(
  item: RepositoryItemRecord,
  file: ReleaseFileRecord,
  archiveAbsPath: string,
  namingConfig: RomNamingConfig,
): Promise<ArchiveInspectResult> {
  const { format, entries } = await listArchiveEntries(archiveAbsPath);

  const ignoredPaths: string[] = [];
  const patchPaths: string[] = [];
  const descriptorEntries: RawArchiveEntry[] = [];
  const trackByDirAndBase = new Map<string, RawArchiveEntry[]>();
  const singleRomCandidates: RawArchiveEntry[] = [];
  const unknownEntries: RawArchiveEntry[] = [];

  for (const entry of entries) {
    const ext = getExtLower(entry.entryPath);
    if (isClutterEntry(entry.entryPath, entry.sizeBytes, item.systemName) || ARCHIVE_EXTENSIONS.has(ext)) {
      ignoredPaths.push(entry.entryPath);
      continue;
    }
    if (PATCH_EXTENSIONS.has(ext)) {
      patchPaths.push(entry.entryPath);
      ignoredPaths.push(entry.entryPath);
      continue;
    }
    if (DISC_DESCRIPTOR_EXTENSIONS.has(ext)) {
      descriptorEntries.push(entry);
      continue;
    }
    if (PLAYABLE_ROM_EXTENSIONS.has(ext) || DISC_TRACK_EXTENSIONS.has(ext)) {
      const dir = path.posix.dirname(entry.entryPath);
      const list = trackByDirAndBase.get(dir) || [];
      list.push(entry);
      trackByDirAndBase.set(dir, list);
      singleRomCandidates.push(entry);
      continue;
    }
    unknownEntries.push(entry);
  }

  const playableTargets: PlayableExportTarget[] = [];
  const consumedPaths = new Set<string>();
  const notes: string[] = [];

  // 1. Group multi-file disc sets (.cue/.gdi/.ccd/.m3u + tracks in the same folder)
  for (const desc of descriptorEntries) {
    const descDir = path.posix.dirname(desc.entryPath);
    const descExt = getExtLower(desc.entryPath);
    const siblings = trackByDirAndBase.get(descDir) || [];

    // Group tracks in the same directory; for multi-disc directories where multiple .cue exist,
    // match tracks sharing the cue stem first, otherwise claim all disc track files in that folder
    const descStem = path.posix.basename(desc.entryPath, descExt).toLowerCase();
    const sameDirDescriptors = descriptorEntries.filter((d) => path.posix.dirname(d.entryPath) === descDir);

    const matchedTracks = siblings.filter((sib) => {
      const sibExt = getExtLower(sib.entryPath);
      if (!DISC_TRACK_EXTENSIONS.has(sibExt) && !SINGLE_DISC_EXTENSIONS.has(sibExt)) return false;
      if (sameDirDescriptors.length === 1) return true;
      const sibBase = path.posix.basename(sib.entryPath).toLowerCase();
      return sibBase.startsWith(descStem);
    });

    const bundleEntries = [desc, ...matchedTracks];
    for (const b of bundleEntries) {
      consumedPaths.add(b.entryPath);
    }

    const totalSize = bundleEntries.reduce((sum, e) => sum + e.sizeBytes, 0);
    const baseDisplay = path.posix.basename(desc.entryPath);
    const discNameBase = formatPreparedRomName(
      {
        title: item.title,
        systemName: item.systemName,
        regions: item.regions,
        languages: item.languages,
        releaseTags: item.releaseTags,
        fileRole: file.fileRole,
        archiveFilename: file.filename,
        displayLabel: file.displayLabel,
        innerFilename: baseDisplay,
        descriptionText: item.metadata?.descriptionText || null,
      },
      '',
      namingConfig,
      { omitExtension: true },
    );

    const roleBadge = deriveTargetRoleBadge(item, file, baseDisplay);
    const detectedVersion = extractVersionFromText(
      `${baseDisplay} ${file.filename} ${file.displayLabel} ${item.title}`,
    );

    playableTargets.push({
      id: desc.entryPath,
      kind: 'disc_set',
      displayName: `${baseDisplay} (${matchedTracks.length} track${matchedTracks.length === 1 ? '' : 's'})`,
      primaryEntry: desc.entryPath,
      entryPaths: bundleEntries.map((e) => e.entryPath),
      extension: descExt,
      sizeBytes: totalSize,
      suggestedFilename: discNameBase,
      suggestedArchiveName: namingConfig.romSanitizeFat32
        ? sanitizeFat32Filename(`${discNameBase}.zip`, namingConfig.romMaxFilenameLen)
        : `${discNameBase}.zip`,
      detectedVersion,
      roleBadge,
    });
  }

  // 2. Remaining standalone ROMs & single-file disc images (.nes, .sfc, .gba, .chd, .iso, etc.)
  const standaloneRoms = singleRomCandidates.filter((c) => !consumedPaths.has(c.entryPath));

  // If no standard ROM extension matched, consider large unknown binary files (>64KB) as fallback candidates
  if (standaloneRoms.length === 0 && playableTargets.length === 0 && unknownEntries.length > 0) {
    for (const u of unknownEntries) {
      if (u.sizeBytes >= 16_384) {
        standaloneRoms.push(u);
      } else {
        ignoredPaths.push(u.entryPath);
      }
    }
  } else {
    for (const u of unknownEntries) {
      ignoredPaths.push(u.entryPath);
    }
  }

  for (let i = 0; i < standaloneRoms.length; i += 1) {
    const rom = standaloneRoms[i];
    const baseName = path.posix.basename(rom.entryPath);
    const ext = getExtLower(rom.entryPath);
    const variantSuffix = cleanVariantDistinguisher(rom.entryPath, standaloneRoms.length);

    const suggestedFilename = formatPreparedRomName(
      {
        title: item.title,
        systemName: item.systemName,
        regions: item.regions,
        languages: item.languages,
        releaseTags: item.releaseTags,
        fileRole: file.fileRole,
        archiveFilename: file.filename,
        displayLabel: file.displayLabel,
        innerFilename: baseName,
        descriptionText: item.metadata?.descriptionText || null,
      },
      ext,
      namingConfig,
      { variantSuffix },
    );

    const detectedVersion =
      extractVersionFromText(baseName) ||
      extractVersionFromText(file.filename) ||
      extractVersionFromText(file.displayLabel) ||
      extractVersionFromText(item.title) ||
      (item.metadata?.descriptionText ? extractVersionFromText(item.metadata.descriptionText.slice(0, 600)) : null);

    playableTargets.push({
      id: rom.entryPath,
      kind: 'rom',
      displayName: baseName,
      primaryEntry: rom.entryPath,
      entryPaths: [rom.entryPath],
      extension: ext,
      sizeBytes: rom.sizeBytes,
      suggestedFilename,
      suggestedArchiveName: suggestedFilename,
      detectedVersion,
      roleBadge: deriveTargetRoleBadge(item, file, baseName),
    });
  }

  // Deduplicate accidental identical suggested filenames across multi-variant archives
  const seenNames = new Set<string>();
  for (let idx = 0; idx < playableTargets.length; idx += 1) {
    const t = playableTargets[idx];
    const key = t.suggestedFilename.toLowerCase();
    if (seenNames.has(key)) {
      const ext = t.extension && t.kind === 'rom' ? t.extension : '';
      const stem = ext ? t.suggestedFilename.slice(0, -ext.length) : t.suggestedFilename;
      t.suggestedFilename = `${stem} (${idx + 1})${ext}`;
      if (t.kind === 'rom') t.suggestedArchiveName = t.suggestedFilename;
    }
    seenNames.add(t.suggestedFilename.toLowerCase());
  }

  const patchOnly = playableTargets.length === 0 && patchPaths.length > 0;
  if (patchOnly) {
    notes.push(
      `Patch-only archive (${patchPaths.map((p) => path.posix.basename(p)).join(', ')}); no playable ROM payload inside.`,
    );
  } else if (ignoredPaths.length > 0) {
    notes.push(`Stripped ${ignoredPaths.length} non-game file${ignoredPaths.length === 1 ? '' : 's'} (readmes, links, docs, or patches).`);
  }

  if (playableTargets.length === 0) {
    const entrySummary = entries
      .slice(0, 8)
      .map((e) => `${path.posix.basename(e.entryPath)} (${e.sizeBytes}B)`)
      .join(', ');
    logServer(
      'ARCHIVE',
      'debug',
      `No playable ROM found in "${file.filename}" (system=${item.systemName}, format=${format})`,
      `entries=${entries.length}, ignored=${ignoredPaths.length}, patches=${patchPaths.length}, patchOnly=${patchOnly}, sample=[${entrySummary || 'none'}]`,
    );
  } else {
    const targetSummary = playableTargets
      .slice(0, 4)
      .map((t) => `${t.primaryEntry} (${t.sizeBytes}B -> "${t.suggestedFilename}")`)
      .join(', ');
    logServer(
      'ARCHIVE',
      'debug',
      `Inspected "${file.filename}" (system=${item.systemName}, format=${format}): ${playableTargets.length} playable target(s), ${ignoredPaths.length} ignored`,
      targetSummary,
    );
  }

  return {
    itemId: item.id,
    fileId: file.id,
    sourceFilename: file.filename,
    fileRole: file.fileRole,
    fileDisplayLabel: file.displayLabel,
    fileDownloadedAt: file.downloadedAt,
    archiveFormat: format,
    playableTargets,
    ignoredEntriesCount: ignoredPaths.length,
    ignoredSample: ignoredPaths.slice(0, 5).map((p) => path.posix.basename(p)),
    patchOnly,
    notes,
  };
}

function deriveTargetRoleBadge(item: RepositoryItemRecord, file: ReleaseFileRecord, innerName: string): string | null {
  const combined = `${file.fileRole} ${item.releaseTags.join(' ')} ${innerName}`.toLowerCase();
  if (file.fileRole && !['ROM', 'BIOS', 'Original ROM'].includes(file.fileRole)) {
    return file.fileRole;
  }
  if (combined.includes('hack')) return 'Hack';
  if (combined.includes('translation') || /t-?en|t\+en/i.test(combined)) return 'Translation';
  if (combined.includes('port')) return 'Port';
  if (combined.includes('undub')) return 'Undub';
  if (combined.includes('homebrew')) return 'Homebrew';
  return null;
}

/**
 * Builds an HTTP-compliant RFC 6266 / RFC 5987 Content-Disposition attachment header.
 * Node.js rejects header field values containing non-ISO-8859-1 or control characters
 * (e.g., ™, –, ’, CJK characters), throwing ERR_INVALID_CHAR inside legacy `filename="..."`.
 * This guarantees `filename="..."` stays strictly printable ASCII while preserving the full
 * UTF-8 name inside `filename*=UTF-8''...`.
 */
export function buildContentDispositionAttachment(filename: string): {
  headerValue: string;
  asciiFallback: string;
  utf8Filename: string;
  adjusted: boolean;
} {
  // Replace lone UTF-16 surrogates & strip ASCII control characters / path separators
  const wellFormed = filename.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '_',
  );
  const cleanUtf8 =
    wellFormed
      .replace(/[\u0000-\u001F\u007F/\\]/g, '_')
      .trim() || 'rom-download';

  const extMatch = cleanUtf8.match(/(\.[A-Za-z0-9]{1,8})$/);
  const ext = extMatch ? extMatch[1] : '';

  const transliterated = cleanUtf8
    .replace(/\u2122/g, 'TM')
    .replace(/\u00A9/g, '(C)')
    .replace(/\u00AE/g, '(R)')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '_')
    .replace(/\u2026/g, '...')
    .replace(/\u00D7/g, 'x')
    .replace(/\u00B0/g, 'deg')
    .replace(/\u00A0/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  let asciiFallback = transliterated
    .replace(/["\\;/\r\n\t]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!asciiFallback || asciiFallback.replace(/[_\s.]/g, '') === '') {
    asciiFallback = `rom-download${ext}`;
  }

  // RFC 5987 attr-char encoding (also percent-encodes !'()*)
  const encodedUtf8 = encodeURIComponent(cleanUtf8).replace(
    /['()*!]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return {
    headerValue: `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`,
    asciiFallback,
    utf8Filename: cleanUtf8,
    adjusted: asciiFallback !== cleanUtf8,
  };
}

function spawnExtractorStream(
  label: string,
  bin: string,
  args: string[],
  archivePath: string,
  entryPath: string,
  describeExitCode?: (code: number) => string,
): NodeJS.ReadableStream {
  logServer(
    'ARCHIVE',
    'debug',
    `Spawning ${label} extraction`,
    `bin="${path.basename(bin)}", archive="${path.basename(archivePath)}", entry="${entryPath}"`,
  );

  const child = spawn(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildExtractorEnv(),
  });

  const pass = new PassThrough();
  let errBuf = '';
  let bytesEmitted = 0;
  let stdoutEnded = false;
  let childClosed = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let failed = false;

  const fail = (err: Error) => {
    if (failed) return;
    failed = true;
    if (!pass.destroyed) {
      pass.destroy(err);
    }
  };

  const maybeComplete = () => {
    if (failed || !stdoutEnded || !childClosed) return;
    if (exitCode !== 0) {
      const fallbackReason =
        exitSignal
          ? `killed by signal ${exitSignal}`
          : describeExitCode
            ? describeExitCode(exitCode ?? 1)
            : `exited with code ${exitCode ?? 1}`;
      const reason = errBuf.trim() || fallbackReason;
      logServer(
        'ARCHIVE',
        'debug',
        `${label} extraction failed (exit=${exitCode}, bytes=${bytesEmitted}) for "${entryPath}"`,
        reason,
      );
      fail(new Error(`${label} extraction failed: ${reason}`));
      return;
    }
    logServer(
      'ARCHIVE',
      'debug',
      `${label} extraction completed (exit=0, bytes=${bytesEmitted})`,
      `archive="${path.basename(archivePath)}", entry="${entryPath}"`,
    );
    if (!pass.destroyed && !pass.writableEnded) {
      pass.end();
    }
  };

  child.stderr.on('data', (d: Buffer) => {
    if (errBuf.length < 8192) {
      errBuf += d.toString('utf8');
    }
  });

  child.stdout.on('data', (chunk: Buffer) => {
    bytesEmitted += chunk.length;
    if (!pass.destroyed) {
      if (!pass.write(chunk)) {
        child.stdout.pause();
        pass.once('drain', () => {
          if (!child.stdout.destroyed) {
            child.stdout.resume();
          }
        });
      }
    }
  });

  child.stdout.on('end', () => {
    stdoutEnded = true;
    maybeComplete();
  });

  child.stdout.on('error', (err) => {
    logServer('ARCHIVE', 'debug', `${label} stdout error for "${entryPath}"`, formatErrorDetails(err));
    fail(err);
  });

  child.on('error', (err) => {
    logServer('ARCHIVE', 'debug', `${label} spawn error for "${entryPath}"`, formatErrorDetails(err));
    fail(err);
  });

  child.on('close', (code, signal) => {
    childClosed = true;
    exitCode = code;
    exitSignal = signal;
    if (child.stdout.destroyed || child.stdout.readableEnded) {
      stdoutEnded = true;
    }
    maybeComplete();
  });

  // Cleanly terminate subprocess if consumer aborts early (e.g., preview truncation or client abort)
  pass.on('close', () => {
    if (!childClosed && child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already exited
      }
    }
  });

  return pass;
}

async function openEntryReadableStream(archivePath: string, entryPath: string): Promise<NodeJS.ReadableStream> {
  if (!isSafeArchiveEntryPath(entryPath)) {
    throw new Error('Invalid archive entry path');
  }

  const format = detectArchiveFormat(archivePath);
  if (format === 'raw') {
    logServer('ARCHIVE', 'debug', `Opening raw file read stream: ${path.basename(archivePath)}`);
    return fs.createReadStream(archivePath);
  }

  const magic = sniffArchiveMagic(archivePath);
  const isRarPayload =
    magic.kind === 'rar4' ||
    magic.kind === 'rar5' ||
    (format === 'rar' && magic.kind !== 'zip' && magic.kind !== '7z');

  if (isRarPayload) {
    const unrarBin = await resolveUnrarBinary();
    if (unrarBin) {
      return spawnExtractorStream(
        path.basename(unrarBin),
        unrarBin,
        ['p', '-inul', '-p-', '--', archivePath, entryPath],
        archivePath,
        entryPath,
        describeUnrarExitCode,
      );
    }

    const bin7z = await resolve7zBinary();
    if (bin7z && (await check7zSupportsRar(bin7z))) {
      return spawnExtractorStream(
        `${path.basename(bin7z)} (RAR)`,
        bin7z,
        ['e', '-so', '-sccUTF-8', '-spd', `-i!${entryPath}`, '--', archivePath],
        archivePath,
        entryPath,
      );
    }

    const bsdtarBin = await resolveBsdtarBinary();
    if (bsdtarBin) {
      return spawnExtractorStream(
        'bsdtar (RAR)',
        bsdtarBin,
        ['-xOf', archivePath, '--', escapeBsdtarGlobPattern(entryPath)],
        archivePath,
        entryPath,
      );
    }

    throw new Error('Cannot extract RAR archive: no RAR-capable extractor (unrar) is installed in this runtime.');
  }

  const bin7z = await resolve7zBinary();
  if (bin7z) {
    return spawnExtractorStream(
      path.basename(bin7z),
      bin7z,
      ['e', '-so', '-sccUTF-8', '-spd', `-i!${entryPath}`, '--', archivePath],
      archivePath,
      entryPath,
    );
  }

  if (format === 'zip') {
    return spawnExtractorStream(
      'unzip',
      'unzip',
      ['-p', archivePath, escapeUnzipGlobPattern(entryPath)],
      archivePath,
      entryPath,
    );
  }

  throw new Error(`Cannot extract ${format.toUpperCase()} archive without 7-Zip binary.`);
}

export async function readArchiveTextPreview(
  archivePath: string,
  entryPath: string,
  maxBytes = DEFAULT_TEXT_PREVIEW_READ_BYTES,
): Promise<ArchiveTextPreviewResult> {
  if (!isSafeArchiveEntryPath(entryPath)) {
    throw new Error('Invalid archive entry path');
  }
  const { entries } = await listArchiveEntries(archivePath);
  const normalizedTarget = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const matched = entries.find(
    (e) => e.entryPath.replace(/\\/g, '/').replace(/^\/+/, '') === normalizedTarget,
  );
  if (!matched) {
    throw new Error('Entry not found inside archive');
  }
  const ext = getExtLower(matched.entryPath);
  if (!TEXT_PREVIEW_EXTENSIONS.has(ext)) {
    throw new Error(`Preview is not supported for ${ext || 'binary'} files`);
  }

  const stream = await openEntryReadableStream(archivePath, matched.entryPath);
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  let truncated = false;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytesRead + buf.length > maxBytes) {
        const remaining = Math.max(0, maxBytes - bytesRead);
        if (remaining > 0) {
          chunks.push(buf.subarray(0, remaining));
          bytesRead += remaining;
        }
        truncated = true;
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
        done();
        return;
      }
      chunks.push(buf);
      bytesRead += buf.length;
    });

    stream.on('error', (err) => {
      if (truncated) {
        done();
      } else {
        done(err);
      }
    });
    stream.on('end', () => done());
    stream.on('close', () => done());
  });

  const combined = Buffer.concat(chunks);
  // Guard against binary files disguised with text extensions
  if (combined.includes(0)) {
    throw new Error('File appears to contain binary data and cannot be previewed as text.');
  }

  return {
    entryPath: normalizedTarget,
    filename: path.posix.basename(normalizedTarget),
    text: combined.toString('utf8'),
    truncated,
    bytesRead,
  };
}

export async function streamExtractedEntryToResponse(
  archivePath: string,
  entryPath: string,
  downloadFilename: string,
  res: Response,
  expectedSizeBytes?: number,
): Promise<void> {
  const disposition = buildContentDispositionAttachment(downloadFilename);
  if (disposition.adjusted) {
    logServer(
      'ARCHIVE',
      'debug',
      `Normalized non-ASCII Content-Disposition fallback`,
      `utf8="${disposition.utf8Filename}", ascii="${disposition.asciiFallback}"`,
    );
  }
  logServer(
    'ARCHIVE',
    'debug',
    `Starting archive entry stream for "${disposition.asciiFallback}"`,
    `archive="${path.basename(archivePath)}", entry="${entryPath}", expectedSizeBytes=${expectedSizeBytes ?? 'unknown'}`,
  );

  const stream = await openEntryReadableStream(archivePath, entryPath);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let headersPrepared = false;
    let bytesStreamed = 0;

    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const prepareHeaders = (firstChunkLen: number) => {
      if (headersPrepared) return;
      headersPrepared = true;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', disposition.headerValue);
      if (
        expectedSizeBytes &&
        expectedSizeBytes > 0 &&
        firstChunkLen <= expectedSizeBytes
      ) {
        res.setHeader('Content-Length', String(expectedSizeBytes));
      }
    };

    stream.on('data', (rawChunk: Buffer | string) => {
      if (settled) return;
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      if (chunk.length === 0) return;
      prepareHeaders(chunk.length);
      bytesStreamed += chunk.length;
      if (!res.write(chunk)) {
        stream.pause();
        res.once('drain', () => {
          if (!settled) {
            stream.resume();
          }
        });
      }
    });

    stream.on('end', () => {
      if (settled) return;
      if (bytesStreamed === 0 && expectedSizeBytes && expectedSizeBytes > 0) {
        const err = new Error(
          `Archive extraction produced 0 bytes for "${path.posix.basename(entryPath)}" (expected ${expectedSizeBytes} bytes).`,
        );
        logServer(
          'ARCHIVE',
          'debug',
          `Empty extraction stream for "${entryPath}" (${disposition.asciiFallback})`,
          `archive="${path.basename(archivePath)}", expectedSizeBytes=${expectedSizeBytes}, bytesStreamed=0`,
        );
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        } else {
          res.destroy(err);
        }
        finish(err);
        return;
      }

      if (!headersPrepared) {
        headersPrepared = true;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', disposition.headerValue);
        res.setHeader('Content-Length', '0');
      }

      if (expectedSizeBytes && expectedSizeBytes > 0 && bytesStreamed !== expectedSizeBytes) {
        logServer(
          'ARCHIVE',
          'warn',
          `Extracted byte count mismatch for "${disposition.asciiFallback}"`,
          `archive="${path.basename(archivePath)}", entry="${entryPath}", streamed=${bytesStreamed}, expected=${expectedSizeBytes}`,
        );
      } else {
        logServer(
          'ARCHIVE',
          'debug',
          `Finished streaming "${disposition.asciiFallback}" (${bytesStreamed} bytes)`,
          `archive="${path.basename(archivePath)}", entry="${entryPath}"`,
        );
      }
      res.end();
    });

    stream.on('error', (err) => {
      logServer(
        'ARCHIVE',
        'debug',
        `Extraction stream error for "${entryPath}" (${disposition.asciiFallback}) after ${bytesStreamed} bytes`,
        formatErrorDetails(err),
      );
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.destroy(err);
      }
      finish(err);
    });

    res.on('error', (err) => {
      logServer('ARCHIVE', 'debug', `HTTP response stream error for "${disposition.asciiFallback}"`, formatErrorDetails(err));
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
      finish(err);
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        logServer(
          'ARCHIVE',
          'debug',
          `Client disconnected while streaming "${disposition.asciiFallback}" after ${bytesStreamed} bytes`,
          `archive="${path.basename(archivePath)}", entry="${entryPath}"`,
        );
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
      }
      finish();
    });

    res.on('finish', () => finish());
  });
}

export async function streamCleanDiscZipToResponse(
  archivePath: string,
  entryPaths: string[],
  zipDownloadName: string,
  res: Response,
): Promise<void> {
  const rawZipName = zipDownloadName.endsWith('.zip') ? zipDownloadName : `${zipDownloadName}.zip`;
  const disposition = buildContentDispositionAttachment(rawZipName);
  if (disposition.adjusted) {
    logServer(
      'ARCHIVE',
      'debug',
      `Normalized non-ASCII disc ZIP Content-Disposition fallback`,
      `utf8="${disposition.utf8Filename}", ascii="${disposition.asciiFallback}"`,
    );
  }

  const zipFile = new yazl.ZipFile();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', disposition.headerValue);

  const pipePromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    zipFile.outputStream.on('error', (err) => {
      logServer('ARCHIVE', 'debug', `ZIP output stream error for "${disposition.asciiFallback}"`, formatErrorDetails(err));
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      } else {
        res.destroy(err instanceof Error ? err : new Error(String(err)));
      }
      done(err);
    });
    res.on('error', (err) => done(err));
    res.on('close', () => done());
    res.on('finish', () => done());
  });

  zipFile.outputStream.pipe(res);

  for (const entryPath of entryPaths) {
    if (!isSafeArchiveEntryPath(entryPath)) continue;
    const entryStream = await openEntryReadableStream(archivePath, entryPath);
    const cleanLeaf = path.posix.basename(entryPath);
    zipFile.addReadStream(entryStream as NodeJS.ReadableStream, cleanLeaf);
  }

  zipFile.end();
  await pipePromise;
}
