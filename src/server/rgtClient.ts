import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { load as loadHtml } from 'cheerio';
import { type Browser, type HttpMethod, Impit, type ImpitResponse } from 'impit';
import { CookieJar } from 'tough-cookie';
import { getCookieJarPath } from './db.ts';
import { formatErrorDetails, isDebugLoggingEnabled, logServer } from './logger.ts';
import {
  type ByteRange,
  findMissingByteRanges,
  getPartialMetaPath,
  isValidatorCompatibleForResume,
  loadPartialTransferMeta,
  mergeByteRanges,
  parseContentRange,
  pickIfRangeValidator,
  removePartialTransferFiles,
  RollingThroughputMeter,
  savePartialTransferMeta,
  splitMissingRangesIntoSlices,
  streamResponseToFileOffset,
  sumByteRanges,
  type PartialTransferMeta,
} from './rangeDownload.ts';
import type { AdaptiveRateLimiter } from './rateLimiter.ts';
import { classifyFileRole, decodeHtmlEntities, deriveReleaseTags } from './releaseTags.ts';
import {
  CANONICAL_SYSTEM_ALIAS_GROUPS,
  canonicalizeSystemSlug,
  filterValidSystemSlugs,
  isNonSystemSlug,
} from '../shared/systemCatalog.ts';
import type {
  AuthSessionStatus,
  AuthTestResult,
  LogLevel,
  ReleaseMetadata,
  ScraperConfigInternal,
} from './types.ts';

export { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';

const DEFAULT_BROWSER_USER_AGENTS = new Set([
  '',
  'Mozilla/5.0 (compatible; RetroGameTalkSync/1.0)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
]);

const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz',
  '.iso', '.chd', '.bin', '.cue', '.img', '.mdf', '.mds',
  '.rom', '.nes', '.fds', '.sfc', '.smc', '.gba', '.gbc', '.gb',
  '.n64', '.z64', '.v64', '.nds', '.3ds', '.cia', '.nsp', '.xci',
  '.cso', '.pbp', '.rvz', '.wbfs', '.gcm', '.md', '.gen', '.smd',
  '.gg', '.sms', '.pce', '.ngp', '.ws', '.wsc', '.a26', '.a78',
  '.ips', '.bps', '.ups', '.xdelta', '.ppf', '.vcdiff',
]);

const IGNORED_REPO_PREFIXES = new Set([
  'wp-content',
  'wp-json',
  'wp-admin',
  'wp-includes',
  'guides',
  'database',
  'platforms',
  'dmca',
  'privacy-policy',
  'contact',
  'faq',
  'about',
  'feed',
  'author',
  'tag',
  'category',
]);

function expandSystemFilterAliases(filters: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const raw of filters) {
    const clean = raw.trim().toLowerCase();
    if (!clean) continue;
    const canonical = canonicalizeSystemSlug(clean).toLowerCase();
    expanded.add(clean);
    expanded.add(canonical);
    expanded.add(clean.replace(/_/g, '-'));
    expanded.add(clean.replace(/-/g, '_'));
    for (const group of CANONICAL_SYSTEM_ALIAS_GROUPS) {
      if (group.includes(clean) || group.includes(canonical)) {
        for (const alias of group) expanded.add(alias);
      }
    }
  }
  return expanded;
}

export interface DiscoveredRelease {
  remoteUrl: string;
  pageUrl: string;
  downloadUrl: string;
  remotePath: string;
  filename: string;
  displayLabel?: string;
  systemName: string;
  releaseType: string;
  title: string;
  publishedAt: string | null;
  metadata?: ReleaseMetadata;
}

export const SCREENSHOT_FULLRES_VERSION = 1;

const WP_RESIZE_SUFFIX_RE = /-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp|gif|bmp|avif)$)/i;
const IMAGE_PATH_EXT_RE = /\.(?:jpe?g|png|webp|gif|bmp|avif)$/i;
const RESIZE_QUERY_PARAMS = ['resize', 'fit', 'w', 'h', 'width', 'height', 'crop'];

function resolveHttpAssetUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.toLowerCase().startsWith('data:') ||
    trimmed.toLowerCase().startsWith('blob:') ||
    trimmed.toLowerCase().startsWith('javascript:') ||
    trimmed.toLowerCase().startsWith('mailto:')
  ) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export function isLikelyImageAssetUrl(raw: string | null | undefined, baseUrl: string): boolean {
  const resolved = resolveHttpAssetUrl(raw, baseUrl);
  if (!resolved) return false;
  try {
    const parsed = new URL(resolved);
    const pathname = parsed.pathname.toLowerCase();
    if (IMAGE_PATH_EXT_RE.test(pathname)) return true;
    if (pathname.includes('/wp-content/uploads/')) return true;
    for (const val of parsed.searchParams.values()) {
      if (IMAGE_PATH_EXT_RE.test(val.toLowerCase())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parseSrcsetCandidates(rawSrcset: string | null | undefined, baseUrl: string): string[] {
  if (!rawSrcset || typeof rawSrcset !== 'string') return [];
  const entries: { url: string; score: number }[] = [];
  const pattern = /(\S+)(?:\s+(\d+(?:\.\d+)?)([wx]))?\s*(?:,|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawSrcset)) !== null) {
    const rawUrl = match[1]?.replace(/,+$/, '');
    const resolved = resolveHttpAssetUrl(rawUrl, baseUrl);
    if (!resolved) continue;
    const num = match[2] ? Number(match[2]) : 1;
    const unit = (match[3] || 'x').toLowerCase();
    const score = unit === 'w' ? num : num * 1000;
    entries.push({ url: resolved, score: Number.isFinite(score) ? score : 0 });
  }
  entries.sort((a, b) => b.score - a.score);
  return Array.from(new Set(entries.map((e) => e.url)));
}

function stripResizeQueryParams(urlStr: string): string[] {
  try {
    const parsed = new URL(urlStr);
    let mutated = false;
    for (const key of RESIZE_QUERY_PARAMS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.delete(key);
        mutated = true;
      }
    }
    const results: string[] = [];
    if (mutated) {
      results.push(parsed.toString());
    }
    // Unwrap Jetpack Photon CDN URLs (e.g. https://i0.wp.com/example.com/wp-content/uploads/...)
    const photonMatch = parsed.hostname.match(/^i\d\.wp\.com$/i);
    if (photonMatch && parsed.pathname.length > 1) {
      results.push(`https://${parsed.pathname.replace(/^\/+/, '')}`);
    }
    return results;
  } catch {
    return [];
  }
}

export function expandFullResImageCandidates(
  rawUrls: (string | null | undefined)[],
  baseUrl: string,
): string[] {
  const resolvedInputs: string[] = [];
  for (const raw of rawUrls) {
    const resolved = resolveHttpAssetUrl(raw, baseUrl);
    if (resolved && !resolvedInputs.includes(resolved)) {
      resolvedInputs.push(resolved);
    }
  }
  if (resolvedInputs.length === 0) return [];

  // Identify URLs that are already confirmed originals because a sibling URL in rawUrls
  // strips its -WxH suffix down to that exact pathname (e.g. game-320x240-150x150.png -> game-320x240.png)
  const confirmedOriginalPathnames = new Set<string>();
  for (const candidate of resolvedInputs) {
    try {
      const u = new URL(candidate);
      if (WP_RESIZE_SUFFIX_RE.test(u.pathname)) {
        const strippedPath = u.pathname.replace(WP_RESIZE_SUFFIX_RE, '');
        for (const other of resolvedInputs) {
          if (other === candidate) continue;
          const otherUrl = new URL(other);
          if (otherUrl.pathname === strippedPath) {
            confirmedOriginalPathnames.add(otherUrl.pathname);
          }
        }
      }
    } catch {
      // Ignore URL parse error
    }
  }

  const out: string[] = [];
  const pushUnique = (u: string | null | undefined) => {
    if (u && !out.includes(u)) out.push(u);
  };

  for (const candidate of resolvedInputs) {
    for (const queryClean of stripResizeQueryParams(candidate)) {
      try {
        const qu = new URL(queryClean);
        if (WP_RESIZE_SUFFIX_RE.test(qu.pathname) && !confirmedOriginalPathnames.has(qu.pathname)) {
          const origUrl = new URL(queryClean);
          origUrl.pathname = qu.pathname.replace(WP_RESIZE_SUFFIX_RE, '');
          pushUnique(origUrl.toString());

          const scaledUrl = new URL(queryClean);
          scaledUrl.pathname = qu.pathname.replace(WP_RESIZE_SUFFIX_RE, '-scaled');
          pushUnique(scaledUrl.toString());
        }
      } catch {
        // Ignore
      }
      pushUnique(queryClean);
    }

    try {
      const u = new URL(candidate);
      if (WP_RESIZE_SUFFIX_RE.test(u.pathname) && !confirmedOriginalPathnames.has(u.pathname)) {
        const origUrl = new URL(candidate);
        origUrl.pathname = u.pathname.replace(WP_RESIZE_SUFFIX_RE, '');
        origUrl.search = '';
        pushUnique(origUrl.toString());

        const scaledUrl = new URL(candidate);
        scaledUrl.pathname = u.pathname.replace(WP_RESIZE_SUFFIX_RE, '-scaled');
        scaledUrl.search = '';
        pushUnique(scaledUrl.toString());
      }
    } catch {
      // Ignore
    }

    pushUnique(candidate);
  }

  return out;
}

export function canonicalImageAssetKey(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    let cleanPath = u.pathname.toLowerCase();
    cleanPath = cleanPath.replace(WP_RESIZE_SUFFIX_RE, '');
    cleanPath = cleanPath.replace(/-scaled(?=\.(?:jpe?g|png|webp|gif|bmp|avif)$)/i, '');
    if (cleanPath.includes('/wp-content/uploads/')) {
      cleanPath = cleanPath.replace(/\.(?:jpe?g|png|webp|gif|bmp|avif)$/i, '');
    }
    return `${u.hostname.toLowerCase().replace(/^i\d\.wp\.com$/, '')}${cleanPath}`;
  } catch {
    return urlStr.trim().toLowerCase();
  }
}

export interface WpPostMetadata {
  wpPostId: number;
  wpPostType: string;
  link: string | null;
  dateGmt: string | null;
  modifiedGmt: string | null;
  title: string | null;
  originalTitle: string | null;
  publisher: string | null;
  developer: string | null;
  releaseYear: string | null;
  genres: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  formats: string[];
  descriptionHtml: string;
  coverUrl?: string | null;
  screenshotUrls?: string[];
  downloadHints: { filename: string; fileSize: string }[];
}

export interface DownloadProgress {
  bytesReceived: number;
  totalBytes: number | null;
  bytesPerSec: number;
  activeChunks?: number;
  resumed?: boolean;
}

class RangeThrottleError extends Error {
  readonly status: number;
  readonly cooldownMs: number;
  readonly retryAfterSec?: number;
  readonly hostname: string;

  constructor(status: number, cooldownMs: number, retryAfterSec: number | undefined, hostname: string) {
    super(`HTTP ${status} rate limit from ${hostname}`);
    this.name = 'RangeThrottleError';
    this.status = status;
    this.cooldownMs = cooldownMs;
    this.retryAfterSec = retryAfterSec;
    this.hostname = hostname;
  }
}

function isThrottleErrorPageUrl(urlStr: string): boolean {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    return /(?:^|\/)(?:429|503)(?:\.html?)?$/.test(pathname);
  } catch {
    return /(?:^|\/)(?:429|503)(?:\.html?)?(?:[?#]|$)/i.test(urlStr);
  }
}

function inferThrottleStatusFromUrl(urlStr: string): number {
  try {
    const pathname = new URL(urlStr).pathname.toLowerCase();
    return /(?:^|\/)429(?:\.html?)?$/.test(pathname) ? 429 : 503;
  } catch {
    return /429/i.test(urlStr) ? 429 : 503;
  }
}

function isHtmlThrottleBody(bodySnippet: string): boolean {
  const sample = bodySnippet.slice(0, 4000).toLowerCase();
  return /\b(?:503|429)\b|service unavailable|too many requests|too many connections|connection limit|rate limit(?:ed)?|temporarily unavailable|temporarily busy|server\s+(?:is\s+)?(?:temporarily\s+)?busy|please try again/i.test(
    sample,
  );
}

function safeHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return 'mirror';
  }
}

function createLinkedAbortController(parentSignal: AbortSignal): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const onParentAbort = () => {
    controller.abort(parentSignal.reason ?? new DOMException('Aborted', 'AbortError'));
  };
  if (parentSignal.aborted) {
    onParentAbort();
    return { controller, dispose: () => undefined };
  }
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  return {
    controller,
    dispose: () => parentSignal.removeEventListener('abort', onParentAbort),
  };
}

export type LoggerFn = (level: LogLevel, message: string, detail?: string | null) => void;

export function sanitizePathSegment(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();

  const cleaned = decoded
    .replace(/\0/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+$/, '')
    .trim();

  return cleaned || 'unknown';
}

function getRootDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return hostname.toLowerCase();
  return parts.slice(-2).join('.');
}

function isSameRootDomain(hostA: string, hostB: string): boolean {
  return getRootDomain(hostA) === getRootDomain(hostB);
}

export function resolveMirroredPaths(
  baseUrlStr: string,
  targetUrlStr: string,
  downloadDir: string,
  fallbackFilename?: string,
): { remotePath: string; localPath: string; filename: string; systemName: string } {
  const baseUrl = new URL(baseUrlStr);
  const targetUrl = new URL(targetUrlStr);

  const baseSegments = baseUrl.pathname.split('/').filter(Boolean);
  const targetSegments = targetUrl.pathname.split('/').filter(Boolean);

  // Strip shared base prefix (e.g. ['repo']) so we mirror exact structure under DOWNLOAD_DIR
  let idx = 0;
  while (
    idx < baseSegments.length &&
    idx < targetSegments.length &&
    baseSegments[idx].toLowerCase() === targetSegments[idx].toLowerCase()
  ) {
    idx += 1;
  }

  const relativeSegments = targetSegments.slice(idx).map(sanitizePathSegment).filter(Boolean);

  if (fallbackFilename) {
    const cleanFallback = sanitizePathSegment(fallbackFilename);
    const lastSeg = relativeSegments[relativeSegments.length - 1] || '';
    const lastExt = path.extname(lastSeg).toLowerCase();
    if (!lastExt || !ARCHIVE_EXTENSIONS.has(lastExt)) {
      relativeSegments.push(cleanFallback);
    } else {
      relativeSegments[relativeSegments.length - 1] = cleanFallback;
    }
  }

  if (relativeSegments.length === 0) {
    relativeSegments.push('uncategorized', sanitizePathSegment(fallbackFilename || 'release.zip'));
  } else if (relativeSegments.length === 1) {
    relativeSegments.unshift('root');
  }

  const remotePath = relativeSegments.join('/');
  const resolvedRoot = path.resolve(downloadDir);
  const localPath = path.resolve(resolvedRoot, ...relativeSegments);

  if (!localPath.startsWith(resolvedRoot + path.sep) && localPath !== resolvedRoot) {
    throw new Error(`Unsafe mirrored path rejected: ${remotePath}`);
  }

  return {
    remotePath,
    localPath,
    filename: relativeSegments[relativeSegments.length - 1],
    systemName: canonicalizeSystemSlug(relativeSegments[0] || 'uncategorized'),
  };
}

function parseRetryAfter(headerVal: string | null): number | undefined {
  if (!headerVal) return undefined;
  const seconds = Number(headerVal);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds;
  }
  const dateMs = Date.parse(headerVal);
  if (!Number.isNaN(dateMs)) {
    return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
}

function parseContentDispositionFilename(headerVal: string | null): string | null {
  if (!headerVal) return null;
  const utf8Match = headerVal.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (utf8Match?.[1]) {
    try {
      return path.basename(decodeURIComponent(utf8Match[1].replace(/["']/g, '')));
    } catch {
      return path.basename(utf8Match[1].replace(/["']/g, ''));
    }
  }
  const basicMatch = headerVal.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  if (basicMatch?.[1]) {
    return path.basename(basicMatch[1].trim());
  }
  return null;
}

function inferReleaseType(text: string, urlStr: string): string {
  return classifyFileRole(urlStr, text);
}

function isDownloadCandidateUrl(url: URL, anchorText: string, hasDownloadAttr: boolean): boolean {
  if (hasDownloadAttr) return true;
  const ext = path.extname(url.pathname).toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(ext)) return true;
  const lowerUrl = url.href.toLowerCase();
  const lowerText = anchorText.toLowerCase();
  if (
    lowerUrl.includes('download.php') ||
    lowerUrl.includes('/download/') ||
    lowerUrl.includes('wpdmdl=') ||
    lowerUrl.includes('action=download') ||
    (lowerText.includes('download') && !lowerUrl.includes('#'))
  ) {
    return true;
  }
  return false;
}

const MAX_LOGGED_COOKIE_NAMES = 12;

function isIgnoredTrackingCookie(name: string): boolean {
  return /^downloaded-/i.test(name.trim());
}

function formatCookieNamesForLog(names: string[]): string {
  if (names.length === 0) return 'none';
  if (names.length <= MAX_LOGGED_COOKIE_NAMES) return names.join(', ');
  const priority = names.filter(
    (n) =>
      n === 'xf_user' ||
      n === 'xf_session' ||
      n === 'xf_csrf' ||
      n === 'xf_online' ||
      n === 'PHPSESSID' ||
      n === 'cf_clearance' ||
      n.startsWith('wordpress_logged_in_'),
  );
  const prioritySet = new Set(priority);
  const rest = names.filter((n) => !prioritySet.has(n));
  const shown = [...priority, ...rest].slice(0, MAX_LOGGED_COOKIE_NAMES);
  const omitted = names.length - shown.length;
  return `${shown.join(', ')}, ... (+${omitted} more, total=${names.length})`;
}

function logAuthContainer(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
  if (level === 'DEBUG' && !isDebugLoggingEnabled()) {
    return;
  }
  const line = `[${new Date().toISOString()}] [AUTH] [${level}] ${message}`;
  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else if (level === 'DEBUG') {
    console.debug(line);
  } else {
    console.log(line);
  }
}

function normalizeWpGmtIso(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('0000-00-00')) return null;
  const withTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`;
  const ms = Date.parse(withTz);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeIsoTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('0000-00-00')) return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function ensureTrailingSlash(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (!u.pathname.endsWith('/')) {
      u.pathname += '/';
    }
    return u.toString();
  } catch {
    return urlStr.endsWith('/') ? urlStr : `${urlStr}/`;
  }
}

export class RetroGameTalkClient {
  private jar: CookieJar;
  private httpClient: Impit;
  private activeBrowserProfile: Browser = 'chrome142';
  private rateLimiter: AdaptiveRateLimiter;
  private wpTypesCache: Map<string, string> | null = null;
  private wpTypesCacheBaseUrl: string | null = null;
  private hostChunkCaps = new Map<string, { maxChunks: number; updatedAt: number }>();
  private authStatus: AuthSessionStatus = {
    configured: false,
    authenticated: false,
    hasCompletedLogin: false,
    lastAuthenticatedAt: null,
    cookieCount: 0,
    lastCheckedAt: null,
    lastMessage: null,
  };

  constructor(rateLimiter: AdaptiveRateLimiter) {
    this.rateLimiter = rateLimiter;
    this.jar = this.loadCookieJar();
    this.httpClient = new Impit({
      browser: this.activeBrowserProfile,
      followRedirects: false,
    });
  }

  private getEffectiveHostChunkConcurrency(urlStr: string, configured: number): number {
    const host = safeHostname(urlStr);
    const entry = this.hostChunkCaps.get(host);
    if (!entry) return configured;
    // Expire learned mirror ceiling after 15 minutes so capacity can re-probe in future runs
    if (Date.now() - entry.updatedAt > 15 * 60_000) {
      this.hostChunkCaps.delete(host);
      return configured;
    }
    return Math.max(1, Math.min(configured, entry.maxChunks));
  }

  private recordHostChunkCap(urlStr: string, maxChunks: number): void {
    const host = safeHostname(urlStr);
    const clamped = Math.max(1, Math.min(4, Math.round(maxChunks)));
    const existing = this.hostChunkCaps.get(host);
    if (!existing || Date.now() - existing.updatedAt > 15 * 60_000 || clamped < existing.maxChunks) {
      this.hostChunkCaps.set(host, { maxChunks: clamped, updatedAt: Date.now() });
    }
  }

  private switchBrowserProfile(profile: Browser): void {
    if (this.activeBrowserProfile === profile) return;
    this.activeBrowserProfile = profile;
    this.httpClient = new Impit({
      browser: profile,
      followRedirects: false,
    });
  }

  private loadCookieJar(): CookieJar {
    const jarPath = getCookieJarPath();
    try {
      if (fs.existsSync(jarPath)) {
        const raw = fs.readFileSync(jarPath, 'utf8');
        const parsed = JSON.parse(raw) as { cookies?: Array<{ key?: string }> } & Record<string, unknown>;
        let prunedCount = 0;
        if (parsed && Array.isArray(parsed.cookies)) {
          const before = parsed.cookies.length;
          parsed.cookies = parsed.cookies.filter((c) => !isIgnoredTrackingCookie(String(c?.key || '')));
          prunedCount = before - parsed.cookies.length;
        }
        const jar = CookieJar.deserializeSync(parsed as Parameters<typeof CookieJar.deserializeSync>[0]);
        if (prunedCount > 0) {
          try {
            fs.writeFileSync(jarPath, JSON.stringify(jar.serializeSync()), { mode: 0o600 });
          } catch (pruneWriteErr) {
            logAuthContainer('DEBUG', `Failed writing pruned cookie jar ${jarPath}: ${formatErrorDetails(pruneWriteErr)}`);
          }
          logAuthContainer(
            'INFO',
            `Pruned ${prunedCount} accumulated "downloaded-*" tracking cookie(s) from persisted cookie jar to prevent HTTP 400 header bloat`,
          );
        }
        logAuthContainer('DEBUG', `Loaded persisted cookie jar from ${jarPath}`);
        return jar;
      }
    } catch (loadErr) {
      // Ignore corrupt cookie jar and start fresh
      logAuthContainer('DEBUG', `Failed loading cookie jar ${jarPath}; starting fresh: ${formatErrorDetails(loadErr)}`);
    }
    return new CookieJar();
  }

  private saveCookieJar(): void {
    const jarPath = getCookieJarPath();
    try {
      fs.mkdirSync(path.dirname(jarPath), { recursive: true });
      fs.writeFileSync(jarPath, JSON.stringify(this.jar.serializeSync()), { mode: 0o600 });
    } catch (saveErr) {
      logAuthContainer('DEBUG', `Failed persisting cookie jar ${jarPath}: ${formatErrorDetails(saveErr)}`);
    }
  }

  private getSafeCookieCount(urlStr: string): number {
    try {
      return this.jar.getCookiesSync(urlStr).length;
    } catch {
      return 0;
    }
  }

  private getSafeCookieNames(urlStr: string): string {
    try {
      const names = this.jar.getCookiesSync(urlStr).map((c) => c.key);
      return formatCookieNamesForLog(names);
    } catch {
      return 'none';
    }
  }

  private validateHttpUrlOrExplain(raw: string, fieldLabel: string): URL {
    const trimmed = (raw || '').trim();
    if (!trimmed) {
      throw new Error(`${fieldLabel} is missing. Enter a full URL starting with https:// or http://.`);
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error(`Invalid ${fieldLabel} ("${trimmed}"): enter a valid URL starting with https:// or http://.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid ${fieldLabel} ("${trimmed}"): protocol must be http:// or https://.`);
    }
    if (!parsed.hostname) {
      throw new Error(`Invalid ${fieldLabel} ("${trimmed}"): hostname is missing.`);
    }
    return parsed;
  }

  private isNonRetryableNetworkError(err: unknown): boolean {
    const anyErr = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | null;
    const code = String(anyErr?.cause?.code || anyErr?.code || '');
    const msg = String(anyErr?.cause?.message || anyErr?.message || err || '');
    return (
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ERR_INVALID_URL' ||
      code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code.startsWith('CERT_') ||
      anyErr?.name === 'InvalidURL' ||
      /dns error|failed to lookup address|name or service not known|nodename nor servname/i.test(msg) ||
      /connectionrefused|connection refused/i.test(msg) ||
      /certificate|unknownissuer|invalidpeer|cert_/i.test(msg)
    );
  }

  private formatNetworkError(err: unknown, targetUrl: string): string {
    const anyErr = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string; hostname?: string } } | null;
    const code = String(anyErr?.cause?.code || anyErr?.code || '');
    const causeMsg = String(anyErr?.cause?.message || anyErr?.message || err || '');
    let host = targetUrl;
    try {
      host = new URL(targetUrl).host || targetUrl;
    } catch {
      // Keep raw targetUrl
    }

    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      /dns error|failed to lookup address|name or service not known|nodename nor servname/i.test(causeMsg)
    ) {
      return `Cannot resolve hostname "${anyErr?.cause?.hostname || host}" — verify the URL spelling and DNS/network access.`;
    }
    if (code === 'ECONNREFUSED' || /connectionrefused|connection refused/i.test(causeMsg)) {
      return `Connection refused by "${host}" — the target server appears to be down or unreachable on that port.`;
    }
    if (
      anyErr?.name === 'TimeoutError' ||
      anyErr?.name === 'ConnectTimeout' ||
      anyErr?.name === 'ReadTimeout' ||
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      /timed? out/i.test(causeMsg)
    ) {
      return `Connection to "${host}" timed out — server may be down, firewalled, or unreachable.`;
    }
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || /connectionreset|connection reset|broken pipe/i.test(causeMsg)) {
      return `Connection reset by "${host}" before a response was received.`;
    }
    if (
      code.startsWith('CERT_') ||
      code.startsWith('ERR_TLS_') ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      /certificate|tls|ssl|handshake/i.test(causeMsg)
    ) {
      return `TLS/SSL certificate error connecting to "${host}": ${causeMsg}`;
    }
    return causeMsg || `Network error connecting to "${host}"`;
  }

  private isRetryableStreamError(err: unknown): boolean {
    const anyErr = err as {
      name?: string;
      message?: string;
      code?: string;
      cause?: { code?: string; message?: string };
    } | null;
    const code = String(anyErr?.cause?.code || anyErr?.code || '');
    const msg = String(anyErr?.cause?.message || anyErr?.message || err || '');
    if (this.isNonRetryableNetworkError(err)) {
      return false;
    }
    return (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'EPIPE' ||
      code === 'UND_ERR_SOCKET' ||
      code === 'UND_ERR_BODY_TIMEOUT' ||
      code === 'ERR_STREAM_PREMATURE_CLOSE' ||
      anyErr?.name === 'TimeoutError' ||
      anyErr?.name === 'ReadTimeout' ||
      /timed ?out|timedout|body|decode|econnreset|connection reset|premature close|socket hang up|empty response stream|unexpected eof/i.test(
        msg,
      )
    );
  }

  isCloudflareChallengeResponse(status: number, headers: Headers, body: string): boolean {
    return this.isCloudflareChallenge(status, headers, body);
  }

  private isCloudflareChallenge(status: number, headers: Headers, body: string): boolean {
    if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge') return true;
    if (status === 403 || status === 503) {
      const lower = body.slice(0, 4000).toLowerCase();
      if (lower.includes('<title>just a moment...</title>') || lower.includes('challenges.cloudflare.com')) {
        return true;
      }
    }
    return false;
  }

  private setAuthState(next: {
    configured: boolean;
    authenticated: boolean;
    cookieCount: number;
    lastMessage: string;
    lastCheckedAt?: string;
  }): void {
    const now = next.lastCheckedAt || new Date().toISOString();
    const lastAuthenticatedAt = next.authenticated ? now : this.authStatus.lastAuthenticatedAt;
    this.authStatus = {
      configured: next.configured,
      authenticated: next.authenticated,
      hasCompletedLogin: Boolean(next.authenticated || lastAuthenticatedAt),
      lastAuthenticatedAt,
      cookieCount: next.cookieCount,
      lastCheckedAt: now,
      lastMessage: next.lastMessage,
    };
  }

  setPersistedLastAuthenticatedAt(lastAuthenticatedAt: string | null): void {
    this.authStatus = {
      ...this.authStatus,
      lastAuthenticatedAt,
      hasCompletedLogin: Boolean(this.authStatus.authenticated || lastAuthenticatedAt),
    };
  }

  hydratePersistedSession(
    config: ScraperConfigInternal,
    persistedLastAuthenticatedAt: string | null,
  ): { restoredActiveCookies: boolean; cookieCount: number; cookieNames: string } {
    const cookies = (() => {
      try {
        return this.jar.getCookiesSync(config.baseUrl);
      } catch {
        return [];
      }
    })();
    const hasAuthCookie = cookies.some(
      (c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'),
    );
    const cookieNames = formatCookieNamesForLog(cookies.map((c) => c.key));
    const configured = Boolean(config.username && config.password);

    if (hasAuthCookie) {
      const now = new Date().toISOString();
      const effectiveLastAuthAt = persistedLastAuthenticatedAt || now;
      this.authStatus = {
        configured,
        authenticated: true,
        hasCompletedLogin: true,
        lastAuthenticatedAt: effectiveLastAuthAt,
        cookieCount: cookies.length,
        lastCheckedAt: now,
        lastMessage: `Restored persisted session (${cookies.length} cookies)`,
      };
      return {
        restoredActiveCookies: true,
        cookieCount: cookies.length,
        cookieNames,
      };
    }

    this.authStatus = {
      configured,
      authenticated: false,
      hasCompletedLogin: Boolean(persistedLastAuthenticatedAt),
      lastAuthenticatedAt: persistedLastAuthenticatedAt,
      cookieCount: cookies.length,
      lastCheckedAt: null,
      lastMessage: persistedLastAuthenticatedAt
        ? 'Verified login history restored; session will refresh automatically on next sync'
        : null,
    };
    return {
      restoredActiveCookies: false,
      cookieCount: cookies.length,
      cookieNames,
    };
  }

  resetAuthSession(clearHistory = false): void {
    this.jar = new CookieJar();
    this.saveCookieJar();
    const lastAuthenticatedAt = clearHistory ? null : this.authStatus.lastAuthenticatedAt;
    this.authStatus = {
      ...this.authStatus,
      authenticated: false,
      hasCompletedLogin: Boolean(lastAuthenticatedAt),
      lastAuthenticatedAt,
      cookieCount: 0,
      lastCheckedAt: clearHistory ? null : this.authStatus.lastCheckedAt,
      lastMessage: clearHistory ? null : this.authStatus.lastMessage,
    };
  }

  getAuthStatus(config: ScraperConfigInternal, persistedLastAuthAt?: string | null): AuthSessionStatus {
    const effectiveLastAuthAt =
      this.authStatus.lastAuthenticatedAt || persistedLastAuthAt || null;
    return {
      ...this.authStatus,
      configured: Boolean(config.username && config.password),
      hasCompletedLogin: Boolean(this.authStatus.authenticated || effectiveLastAuthAt),
      lastAuthenticatedAt: effectiveLastAuthAt,
      cookieCount: this.getSafeCookieCount(config.baseUrl),
    };
  }

  private async fetchWithRedirects(
    url: string,
    config: ScraperConfigInternal,
    init: RequestInit = {},
    signal?: AbortSignal,
    log?: LoggerFn,
    maxRedirects = 8,
    timeoutMsOverride?: number,
  ): Promise<{ response: ImpitResponse; finalUrl: string; latencyMs: number }> {
    let currentUrl = url;
    let attempt = 0;

    while (true) {
      await this.rateLimiter.acquire(signal);

      const started = performance.now();
      let cookieHeader = await this.jar.getCookieString(currentUrl);
      // Also forward root-domain cookies if a download subdomain (e.g. squall/rinoa.retrogametalk.com) needs them
      try {
        if (!cookieHeader && isSameRootDomain(new URL(currentUrl).hostname, new URL(config.baseUrl).hostname)) {
          cookieHeader = await this.jar.getCookieString(config.baseUrl);
        }
      } catch {
        // Ignore invalid baseUrl during fallback cookie lookup
      }

      const headers = new Headers(init.headers || {});
      const trimmedUa = (config.userAgent || '').trim();
      // Preserve impit's matched browser profile User-Agent + Sec-CH-UA coherence unless a custom UA was explicitly configured
      if (trimmedUa && !DEFAULT_BROWSER_USER_AGENTS.has(trimmedUa)) {
        headers.set('User-Agent', trimmedUa);
      }
      // Align Sec-Fetch-Site with Referer so same-origin navigations and form POSTs match real Chrome
      const referer = headers.get('Referer');
      if (referer && !headers.has('Sec-Fetch-Site')) {
        try {
          const refOrigin = new URL(referer).origin;
          const curOrigin = new URL(currentUrl).origin;
          headers.set('Sec-Fetch-Site', refOrigin === curOrigin ? 'same-origin' : 'cross-site');
        } catch {
          // Keep default Sec-Fetch-Site
        }
      }
      if (cookieHeader) {
        headers.set('Cookie', cookieHeader);
      }

      let res: ImpitResponse;
      try {
        res = await this.httpClient.fetch(currentUrl, {
          method: ((init.method || 'GET').toUpperCase() as HttpMethod),
          headers,
          body: init.body !== undefined && init.body !== null ? String(init.body) : undefined,
          redirect: 'manual',
          timeout: timeoutMsOverride ?? config.requestTimeoutMs,
          signal,
        });
      } catch (err) {
        const latency = performance.now() - started;
        if (signal?.aborted) throw err;
        this.rateLimiter.recordError(latency);
        const nonRetryable = this.isNonRetryableNetworkError(err);
        const errDetails = formatErrorDetails(err);
        log?.(
          'debug',
          `[HTTP] Request exception after ${Math.round(latency)}ms: ${(init.method || 'GET').toUpperCase()} ${currentUrl}`,
          `nonRetryable=${nonRetryable}, attempt=${attempt}/${config.maxRetries}, ${errDetails}`,
        );
        if (nonRetryable) {
          throw err;
        }
        attempt += 1;
        if (attempt > config.maxRetries) {
          throw err;
        }
        log?.('warn', `Network retry (${attempt}/${config.maxRetries}) for ${currentUrl}`, this.formatNetworkError(err, currentUrl));
        continue;
      }

      const latency = performance.now() - started;

      // Capture Set-Cookie headers (ignoring ephemeral per-ROM "downloaded-*" UI tracking cookies to prevent header bloat)
      const setCookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
      let storedCookies = 0;
      for (const rawCookie of setCookies) {
        const cookieName = rawCookie.split('=', 1)[0]?.trim() || '';
        if (isIgnoredTrackingCookie(cookieName)) {
          continue;
        }
        try {
          await this.jar.setCookie(rawCookie, currentUrl);
          storedCookies += 1;
        } catch (cookieErr) {
          logAuthContainer('DEBUG', `Skipped malformed Set-Cookie "${cookieName}" from ${currentUrl}: ${formatErrorDetails(cookieErr)}`);
        }
      }
      if (storedCookies > 0) {
        this.saveCookieJar();
      }

      // Handle HTTP rate-limits & temporary upstream throttling
      if (res.status === 429 || res.status === 503) {
        await res.body?.cancel().catch(() => undefined);
        const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
        const cooldownMs = this.rateLimiter.recordThrottle(retryAfterSec, latency);
        attempt += 1;
        log?.(
          'throttle',
          `HTTP ${res.status} rate limit from ${new URL(currentUrl).hostname}; backing off ${Math.round(cooldownMs / 1000)}s`,
          `Attempt ${attempt}/${config.maxRetries}${retryAfterSec ? ` · Retry-After: ${retryAfterSec}s` : ''}`,
        );
        if (attempt > config.maxRetries) {
          throw new Error(`Exceeded max retries (${config.maxRetries}) after HTTP ${res.status} from ${new URL(currentUrl).hostname}`);
        }
        continue;
      }

      // Handle redirects manually so cookies across XenForo -> WordPress rgt_gate -> /repo/ are preserved
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel().catch(() => undefined);
        const nextUrl = new URL(res.headers.get('location')!, currentUrl).toString();
        if (isThrottleErrorPageUrl(nextUrl)) {
          const inferredStatus = inferThrottleStatusFromUrl(nextUrl);
          const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
          const cooldownMs = this.rateLimiter.recordThrottle(retryAfterSec, latency);
          attempt += 1;
          log?.(
            'throttle',
            `HTTP ${inferredStatus} throttle redirect (${new URL(nextUrl).pathname}) from ${safeHostname(currentUrl)}; backing off ${Math.round(cooldownMs / 1000)}s`,
            `Attempt ${attempt}/${config.maxRetries}${retryAfterSec ? ` · Retry-After: ${retryAfterSec}s` : ''}`,
          );
          if (attempt > config.maxRetries) {
            throw new RangeThrottleError(inferredStatus, cooldownMs, retryAfterSec, safeHostname(currentUrl));
          }
          continue;
        }
        if (maxRedirects <= 0) {
          throw new Error(`Too many redirects while fetching ${url}`);
        }
        logServer('HTTP', 'debug', `Redirect HTTP ${res.status} -> ${nextUrl}`, `from=${currentUrl}`);
        currentUrl = nextUrl;
        maxRedirects -= 1;
        if (res.status === 301 || res.status === 302 || res.status === 303) {
          const nextHeaders = new Headers(init.headers || {});
          nextHeaders.delete('content-type');
          nextHeaders.delete('content-length');
          init = { method: 'GET', headers: nextHeaders };
        }
        this.rateLimiter.recordSuccess(latency);
        continue;
      }

      if (res.status >= 500) {
        await res.body?.cancel().catch(() => undefined);
        this.rateLimiter.recordError(latency);
        attempt += 1;
        log?.('debug', `[HTTP] Server HTTP ${res.status} on ${currentUrl}`, `attempt=${attempt}/${config.maxRetries}, latency=${Math.round(latency)}ms`);
        if (attempt > config.maxRetries) {
          throw new Error(`Target server error HTTP ${res.status} at ${currentUrl}`);
        }
        log?.('warn', `Server HTTP ${res.status}; retrying (${attempt}/${config.maxRetries})`, currentUrl);
        continue;
      }

      logServer(
        'HTTP',
        'debug',
        `${(init.method || 'GET').toUpperCase()} ${currentUrl} -> HTTP ${res.status} (${Math.round(latency)}ms)`,
        storedCookies > 0 ? `storedCookies=${storedCookies}` : null,
      );
      this.rateLimiter.recordSuccess(latency);
      return { response: res, finalUrl: currentUrl, latencyMs: latency };
    }
  }

  async login(
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<{ authenticated: boolean; statusCode: number; message: string }> {
    const username = (config.username || '').trim();
    const password = config.password || '';

    if (!username && !password) {
      const msg = 'Credentials missing: enter both Repository Username and Repository Password.';
      logAuthContainer('WARN', `Login aborted before network request: ${msg}`);
      this.setAuthState({
        configured: false,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }
    if (!username) {
      const msg = 'Repository Username is missing. Enter a valid username.';
      logAuthContainer('WARN', `Login aborted before network request: ${msg}`);
      this.setAuthState({
        configured: false,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }
    if (!password) {
      const msg = `Repository Password is missing for user "${username}".`;
      logAuthContainer('WARN', `Login aborted before network request: ${msg}`);
      this.setAuthState({
        configured: false,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }

    try {
      this.validateHttpUrlOrExplain(config.loginUrl, 'Login Endpoint URL');
      this.validateHttpUrlOrExplain(config.baseUrl, 'Repository Base URL');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logAuthContainer('WARN', `Login aborted due to invalid URL configuration: ${msg}`);
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: 0,
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }

    log?.('info', `Authenticating XenForo + Repo gate at ${config.loginUrl}`);
    logAuthContainer(
      'INFO',
      `Starting login flow — user="${username}", loginUrl="${config.loginUrl}", baseUrl="${config.baseUrl}", existingCookies=[${this.getSafeCookieNames(config.baseUrl)}]`,
    );

    // Step 1: Load the XenForo login form page to obtain xf_csrf cookie + _xfToken hidden field.
    // Note: commit b70de40 used chrome131 whose legacy JA4 TLS fingerprint triggers Cloudflare 403;
    // we now use chrome142 (post-quantum MLKEM JA4) with automatic fallback to firefox144 and native curl.
    const trimmedLoginUrl = config.loginUrl.trim();
    const isXenForoPostEndpoint = /\/login\/login\/?$/i.test(trimmedLoginUrl);
    const parentFormUrl = isXenForoPostEndpoint
      ? trimmedLoginUrl.replace(/\/login\/login\/?$/i, '/login/')
      : null;

    let formPage: { response: ImpitResponse; finalUrl: string; latencyMs: number } | null = null;
    let html = '';
    let lastCfChallengeStatus: number | null = null;
    let lastCfRay: string | null = null;

    const summarizeHttpBody = (rawHtml: string): string => {
      try {
        const body$ = loadHtml(rawHtml);
        const title = body$('title').first().text().replace(/\s+/g, ' ').trim();
        const blockMsg = body$('.blockMessage--error, .blockMessage, #login_error, h1')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim();
        const plain = (blockMsg || title || rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180);
        return plain || 'empty body';
      } catch {
        return rawHtml.replace(/\s+/g, ' ').trim().slice(0, 180) || 'empty body';
      }
    };

    const tryLoadFormWithCurrentProfile = async (
      approachLabel: string,
    ): Promise<
      | { kind: 'ok'; page: { response: ImpitResponse; finalUrl: string; latencyMs: number }; html: string }
      | { kind: 'cf'; status: number; cfRay: string | null }
      | { kind: 'http_err'; page: { response: ImpitResponse; finalUrl: string; latencyMs: number }; html: string }
      | { kind: 'net_err'; err: unknown }
    > => {
      if (parentFormUrl) {
        logAuthContainer('INFO', `${approachLabel}: Attempting login form GET ${parentFormUrl}`);
        try {
          const candidatePage = await this.fetchWithRedirects(parentFormUrl, config, { method: 'GET' }, signal, log);
          const candidateHtml = await candidatePage.response.text();
          if (this.isCloudflareChallenge(candidatePage.response.status, candidatePage.response.headers, candidateHtml)) {
            const cfRay = candidatePage.response.headers.get('cf-ray');
            logAuthContainer(
              'WARN',
              `${approachLabel}: FAILED on GET ${parentFormUrl} — blocked by Cloudflare challenge (HTTP ${candidatePage.response.status}${cfRay ? `, CF-Ray: ${cfRay}` : ''})`,
            );
            return {
              kind: 'cf',
              status: candidatePage.response.status,
              cfRay,
            };
          }
          const candidateHasForm = loadHtml(candidateHtml)('input[type="password"]').length > 0;
          if (
            (candidatePage.response.ok && (candidateHasForm || this.getSafeCookieCount(config.baseUrl) > 0)) ||
            (candidatePage.response.status < 500 && candidateHasForm)
          ) {
            logAuthContainer(
              'INFO',
              `${approachLabel}: Loaded login page ${candidatePage.finalUrl} (HTTP ${candidatePage.response.status}, ${Math.round(candidatePage.latencyMs)}ms, cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
            );
            return { kind: 'ok', page: candidatePage, html: candidateHtml };
          }
          const serverHdr = candidatePage.response.headers.get('server') || 'unknown';
          const snippet = candidatePage.response.status >= 400 ? ` · server=${serverHdr} · "${summarizeHttpBody(candidateHtml)}"` : '';
          logAuthContainer(
            'INFO',
            `${approachLabel}: GET ${parentFormUrl} returned HTTP ${candidatePage.response.status} without password form${snippet}; falling back to GET ${config.loginUrl}`,
          );
        } catch (err) {
          logAuthContainer(
            'WARN',
            `${approachLabel}: Network error on GET ${parentFormUrl} (${this.formatNetworkError(err, parentFormUrl)}); falling back to GET ${config.loginUrl}`,
          );
        }
      }

      logAuthContainer('INFO', `${approachLabel}: Attempting login endpoint GET ${config.loginUrl}`);
      try {
        const directPage = await this.fetchWithRedirects(config.loginUrl, config, { method: 'GET' }, signal, log);
        const directHtml = await directPage.response.text();
        if (this.isCloudflareChallenge(directPage.response.status, directPage.response.headers, directHtml)) {
          const cfRay = directPage.response.headers.get('cf-ray');
          logAuthContainer(
            'WARN',
            `${approachLabel}: FAILED on GET ${config.loginUrl} — blocked by Cloudflare challenge (HTTP ${directPage.response.status}${cfRay ? `, CF-Ray: ${cfRay}` : ''})`,
          );
          return {
            kind: 'cf',
            status: directPage.response.status,
            cfRay,
          };
        }
        const directHasForm = loadHtml(directHtml)('input[type="password"]').length > 0;
        if (directPage.response.status >= 400 && !(directPage.response.status < 500 && directHasForm)) {
          const serverHdr = directPage.response.headers.get('server') || 'unknown';
          logAuthContainer(
            'WARN',
            `${approachLabel}: FAILED on GET ${config.loginUrl} — HTTP ${directPage.response.status} (${directPage.finalUrl}, server=${serverHdr}, body="${summarizeHttpBody(directHtml)}")`,
          );
          return { kind: 'http_err', page: directPage, html: directHtml };
        }
        logAuthContainer(
          'INFO',
          `${approachLabel}: Loaded login page ${directPage.finalUrl} (HTTP ${directPage.response.status}, ${Math.round(directPage.latencyMs)}ms, cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
        );
        return { kind: 'ok', page: directPage, html: directHtml };
      } catch (err) {
        logAuthContainer(
          'ERROR',
          `${approachLabel}: FAILED on GET ${config.loginUrl} — ${this.formatNetworkError(err, config.loginUrl)}`,
        );
        return { kind: 'net_err', err };
      }
    };

    let activeImpitLabel = `Approach 1 [impit:${this.activeBrowserProfile}]`;
    let loadAttempt = await tryLoadFormWithCurrentProfile(activeImpitLabel);

    // If HTTP 4xx (e.g. XenForo/Cloudflare HTTP 400 due to stale cookies or already-signed-in state),
    // first check if existing cookies already unlock /repo/, otherwise reset stale jar & retry clean.
    if (loadAttempt.kind === 'http_err' && loadAttempt.page.response.status >= 400 && loadAttempt.page.response.status < 500) {
      if (this.getSafeCookieCount(config.baseUrl) > 0 || this.getSafeCookieCount(config.loginUrl) > 0) {
        try {
          const repoCheck = await this.fetchWithRedirects(config.baseUrl, config, { method: 'GET' }, signal, log);
          const repoHtml = await repoCheck.response.text();
          const repo$ = loadHtml(repoHtml);
          const repoTitle = repo$('title').first().text().trim();
          const repoOk =
            repoCheck.response.ok &&
            !repoCheck.finalUrl.includes('/login') &&
            repo$('input[name="login"]').length === 0 &&
            repo$('input[type="password"]').length === 0;
          if (repoOk) {
            const cookies = await this.jar.getCookies(config.baseUrl);
            const msg = `Authenticated as ${username} (${cookies.length} cookies${repoTitle ? ` · "${repoTitle}"` : ''})`;
            logAuthContainer('INFO', `${activeImpitLabel}: Recovered session directly via ${config.baseUrl} after HTTP ${loadAttempt.page.response.status}`);
            this.setAuthState({
              configured: true,
              authenticated: true,
              cookieCount: cookies.length,
              lastMessage: msg,
            });
            log?.('info', msg);
            return { authenticated: true, statusCode: repoCheck.response.status, message: msg };
          }
        } catch {
          // Proceed to clean-cookie retry
        }

        logAuthContainer(
          'WARN',
          `Resetting stale cookie jar ([${this.getSafeCookieNames(config.baseUrl)}]) after HTTP ${loadAttempt.page.response.status} and retrying clean`,
        );
        this.jar = new CookieJar();
        this.saveCookieJar();
        loadAttempt = await tryLoadFormWithCurrentProfile(`${activeImpitLabel} (clean-cookies)`);
      }
    }

    if (loadAttempt.kind === 'cf' || (loadAttempt.kind === 'http_err' && loadAttempt.page.response.status === 400)) {
      const reasonLabel = loadAttempt.kind === 'cf' ? 'Cloudflare challenge' : `HTTP ${loadAttempt.page.response.status}`;
      const prevProfile = this.activeBrowserProfile;
      const alternateProfile: Browser = prevProfile === 'firefox144' ? 'chrome142' : 'firefox144';
      logAuthContainer(
        'INFO',
        `Switching impit TLS/HTTP2 browser profile from ${prevProfile} -> ${alternateProfile} after ${reasonLabel}`,
      );
      this.switchBrowserProfile(alternateProfile);
      activeImpitLabel = `Approach 2 [impit:${alternateProfile}]`;
      loadAttempt = await tryLoadFormWithCurrentProfile(activeImpitLabel);
    }

    if (loadAttempt.kind === 'net_err') {
      const msg = `Cannot reach Login Endpoint URL (${config.loginUrl}): ${this.formatNetworkError(loadAttempt.err, config.loginUrl)}`;
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }

    if (loadAttempt.kind === 'cf') {
      lastCfChallengeStatus = loadAttempt.status;
      lastCfRay = loadAttempt.cfRay;
      logAuthContainer(
        'WARN',
        `Both impit browser profiles were blocked by Cloudflare challenge; falling back to native curl`,
      );
      // Fallback to native curl (direct POST username & password, then CSRF form POST if needed)
      const curlFallback = await this.tryCurlLoginFallback(config, username, password, parentFormUrl, signal, log);
      if (curlFallback) {
        return curlFallback;
      }

      const msg = `Blocked by Cloudflare Managed Challenge (HTTP ${lastCfChallengeStatus}${lastCfRay ? ` · CF-Ray ${lastCfRay}` : ''}) at Login Endpoint URL (${config.loginUrl}). Cloudflare returned an interactive Turnstile/JS challenge page instead of the XenForo login form.`;
      logAuthContainer(
        'ERROR',
        `All login approaches (impit:chrome142, impit:firefox144, curl:direct-post, curl:csrf-form) FAILED — ${msg}`,
      );
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: lastCfChallengeStatus, message: msg };
    }

    if (loadAttempt.kind === 'http_err') {
      const httpStatus = loadAttempt.page.response.status;
      if (httpStatus === 400 || httpStatus === 403 || httpStatus === 405 || httpStatus === 429) {
        logAuthContainer(
          'WARN',
          `Both impit browser profiles received HTTP ${httpStatus}; falling back to native curl`,
        );
        const curlFallback = await this.tryCurlLoginFallback(config, username, password, parentFormUrl, signal, log);
        if (curlFallback) {
          return curlFallback;
        }
      }
      const errSnippet = summarizeHttpBody(loadAttempt.html);
      const msg = `Login Endpoint URL returned HTTP ${httpStatus} (${loadAttempt.page.finalUrl}${errSnippet && errSnippet !== 'empty body' ? ` · ${errSnippet}` : ''}). Check that the Login Endpoint URL is correct.`;
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: httpStatus, message: msg };
    }

    formPage = loadAttempt.page;
    html = loadAttempt.html;

    const $ = loadHtml(html);
    const passwordInput = $('input[type="password"]').first();
    const form = passwordInput.closest('form');

    if (form.length === 0 || passwordInput.length === 0) {
      const preCookies = await this.jar.getCookies(config.baseUrl);
      const alreadySignedIn = preCookies.some(
        (c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'),
      );
      if (!alreadySignedIn) {
        const msg = `No login form found at Login Endpoint URL (${formPage.finalUrl}). Verify the Login Endpoint URL points to the login page.`;
        logAuthContainer('WARN', `${activeImpitLabel}: FAILED — ${msg}`);
        this.setAuthState({
          configured: true,
          authenticated: false,
          cookieCount: preCookies.length,
          lastMessage: msg,
        });
        return { authenticated: false, statusCode: formPage.response.status, message: msg };
      }

      logAuthContainer(
        'INFO',
        `${activeImpitLabel}: Active session cookie already present (cookies=[${this.getSafeCookieNames(config.baseUrl)}]); verifying repository gate GET ${config.baseUrl}`,
      );

      // Already have a valid session cookie (e.g. /login/ redirected away because user is already signed in)
      let repoTitle = '';
      let repoOk = false;
      try {
        const repoCheck = await this.fetchWithRedirects(config.baseUrl, config, { method: 'GET' }, signal, log);
        const repoHtml = await repoCheck.response.text();
        const repo$ = loadHtml(repoHtml);
        repoTitle = repo$('title').first().text().trim();
        repoOk =
          repoCheck.response.ok &&
          !repoCheck.finalUrl.includes('/login') &&
          repo$('input[name="login"]').length === 0 &&
          repo$('input[type="password"]').length === 0;
      } catch {
        repoOk = false;
      }

      if (repoOk) {
        const cookies = await this.jar.getCookies(config.baseUrl);
        const msg = `Authenticated as ${username} (${cookies.length} cookies${repoTitle ? ` · "${repoTitle}"` : ''})`;
        logAuthContainer(
          'INFO',
          `${activeImpitLabel}: SUCCEEDED (reused active session cookie) — ${msg} (cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
        );
        this.setAuthState({
          configured: true,
          authenticated: true,
          cookieCount: cookies.length,
          lastMessage: msg,
        });
        log?.('info', msg);
        return {
          authenticated: true,
          statusCode: formPage.response.status,
          message: msg,
        };
      }

      const msg = `Session cookies present but Repository Base URL (${config.baseUrl}) could not be verified as authenticated.`;
      logAuthContainer('WARN', `${activeImpitLabel}: FAILED — ${msg}`);
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: preCookies.length,
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: formPage.response.status, message: msg };
    }

    const { actionUrl, params } = this.buildLoginFormParams($, form, passwordInput, formPage.finalUrl, config, username, password);
    logAuthContainer(
      'INFO',
      `${activeImpitLabel}: Submitting credentials POST ${actionUrl} (fields=[${Array.from(params.keys()).join(', ')}])`,
    );

    let postRes: { response: ImpitResponse; finalUrl: string; latencyMs: number };
    try {
      postRes = await this.fetchWithRedirects(
        actionUrl,
        config,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: formPage.finalUrl,
            Origin: new URL(formPage.finalUrl).origin,
          },
          body: params.toString(),
        },
        signal,
        log,
      );
    } catch (err) {
      const msg = `Failed submitting credentials to "${actionUrl}": ${this.formatNetworkError(err, actionUrl)}`;
      logAuthContainer('ERROR', `${activeImpitLabel}: FAILED submitting POST — ${msg}`);
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }

    const postBody = await postRes.response.text();
    if (this.isCloudflareChallenge(postRes.response.status, postRes.response.headers, postBody)) {
      const cfRay = postRes.response.headers.get('cf-ray');
      logAuthContainer(
        'WARN',
        `${activeImpitLabel}: FAILED on credential POST ${postRes.finalUrl} — blocked by Cloudflare challenge (HTTP ${postRes.response.status}${cfRay ? `, CF-Ray: ${cfRay}` : ''}); falling back to native curl`,
      );
      const curlFallback = await this.tryCurlLoginFallback(config, username, password, parentFormUrl, signal, log);
      if (curlFallback) {
        return curlFallback;
      }
      const msg = `Login request blocked by Cloudflare challenge (HTTP ${postRes.response.status}${cfRay ? ` · CF-Ray ${cfRay}` : ''}) at ${postRes.finalUrl}.`;
      logAuthContainer('ERROR', `All login approaches FAILED — ${msg}`);
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: postRes.response.status, message: msg };
    }

    const post$ = loadHtml(postBody);
    const blockError = post$('.blockMessage--error, #login_error, .errorPanel, .message--error, .formRow--error')
      .not('.u-noJsOnly, .blockMessage--important')
      .filter((_, el) => post$(el).closest('noscript, template').length === 0)
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const stillOnLoginForm = post$('input[type="password"]').length > 0;
    const preRepoCookies = await this.jar.getCookies(config.baseUrl);
    const hasSessionCookieBeforeRepo = preRepoCookies.some(
      (c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'),
    );

    const loginRejectedInPost =
      Boolean(blockError) ||
      postRes.response.status >= 400 ||
      (stillOnLoginForm && !hasSessionCookieBeforeRepo);

    // Step 2: Touch config.baseUrl (/repo/) so WordPress rgt_gate primes PHPSESSID cleanly,
    // only when the login POST response didn't already reject the submission.
    let repoReached = false;
    let repoTitle = '';
    if (!loginRejectedInPost && (postRes.response.ok || postRes.finalUrl.includes('/repo'))) {
      logAuthContainer(
        'INFO',
        `${activeImpitLabel}: Credential POST returned HTTP ${postRes.response.status} (finalUrl=${postRes.finalUrl}, cookies=[${this.getSafeCookieNames(config.baseUrl)}]); priming repository gate GET ${config.baseUrl}`,
      );
      try {
        const repoCheck = await this.fetchWithRedirects(config.baseUrl, config, { method: 'GET' }, signal, log);
        const repoHtml = await repoCheck.response.text();
        const repo$ = loadHtml(repoHtml);
        repoTitle = repo$('title').first().text().trim();
        repoReached =
          repoCheck.response.ok &&
          !repoCheck.finalUrl.includes('/login') &&
          repo$('input[name="login"]').length === 0 &&
          repo$('input[type="password"]').length === 0;
      } catch {
        repoReached = false;
      }
    }

    const cookies = await this.jar.getCookies(config.baseUrl);
    const hasXfUser = cookies.some((c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'));
    const authenticated = !loginRejectedInPost && (hasXfUser || repoReached);

    let message: string;
    if (authenticated) {
      message = `Authenticated as ${username} (${cookies.length} cookies${repoTitle ? ` · "${repoTitle}"` : ''})`;
      logAuthContainer(
        'INFO',
        `${activeImpitLabel}: SUCCEEDED — ${message} (cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
      );
    } else {
      if (blockError) {
        message = `Login rejected: ${blockError}`;
      } else if (postRes.response.status === 401 || postRes.response.status === 403) {
        message = `Login rejected (HTTP ${postRes.response.status}) at ${postRes.finalUrl}: invalid credentials or access denied.`;
      } else if (postRes.response.status >= 400) {
        message = `Login Endpoint URL returned HTTP ${postRes.response.status} at ${postRes.finalUrl}. Check that the Login Endpoint URL is valid.`;
      } else if (stillOnLoginForm) {
        message = `Invalid username or password: server returned the login form without establishing an authenticated session.`;
      } else {
        message = `Authentication failed (HTTP ${postRes.response.status}): no active session cookie returned from ${postRes.finalUrl}.`;
      }
      logAuthContainer(
        'WARN',
        `${activeImpitLabel}: FAILED — ${message} (HTTP ${postRes.response.status}, finalUrl=${postRes.finalUrl}, cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
      );
    }

    this.setAuthState({
      configured: true,
      authenticated,
      cookieCount: cookies.length,
      lastMessage: message,
    });

    if (authenticated) {
      log?.('info', message);
    }
    return {
      authenticated,
      statusCode: postRes.response.status,
      message,
    };
  }

  private buildLoginFormParams(
    $: ReturnType<typeof loadHtml>,
    form: ReturnType<ReturnType<typeof loadHtml>>,
    passwordInput: ReturnType<ReturnType<typeof loadHtml>>,
    formFinalUrl: string,
    config: ScraperConfigInternal,
    username: string,
    password: string,
  ): { actionUrl: string; params: URLSearchParams } {
    const rawAction = form.attr('action');
    const actionUrl = rawAction ? new URL(rawAction, formFinalUrl).href : config.loginUrl;
    const params = new URLSearchParams();
    let addedSubmit = false;

    form.find('input').each((_, el) => {
      const input = $(el);
      if (input.is(':disabled')) return;
      const name = input.attr('name');
      if (!name) return;

      const type = (input.attr('type') || 'text').toLowerCase();
      if (type === 'button' || type === 'reset' || type === 'file' || type === 'image') {
        return;
      }
      if (type === 'checkbox' || type === 'radio') {
        // Leave XenForo anti-bot honeypot checkboxes unchecked/omitted unless checked by default in markup
        if (input.attr('checked') !== undefined) {
          params.set(name, input.attr('value') ?? '1');
        }
        return;
      }
      if (type === 'submit') {
        if (!addedSubmit && input.attr('value') !== undefined) {
          params.set(name, input.attr('value')!);
          addedSubmit = true;
        }
        return;
      }

      // Hidden, text, password, email, etc. (preserves empty honeypot text fields like website_code="")
      params.set(name, input.attr('value') ?? '');
    });

    const userField =
      form
        .find('input')
        .filter((_, el) => {
          const input = $(el);
          if (input.is(':disabled')) return false;
          const type = (input.attr('type') || 'text').toLowerCase();
          if (type === 'checkbox' || type === 'radio' || type === 'hidden' || type === 'password' || type === 'submit') {
            return false;
          }
          const n = (input.attr('name') || '').toLowerCase();
          return n === 'login' || n === 'username' || n === 'user' || n === 'email' || n === 'log';
        })
        .first()
        .attr('name') || 'login';
    const passField = passwordInput.attr('name') || 'password';

    params.set(userField, username);
    params.set(passField, password);

    if (form.find('input[name="remember"]').length > 0) {
      params.set('remember', '1');
    }
    if (params.has('_xfRedirect')) {
      params.set('_xfRedirect', config.baseUrl);
    }

    return { actionUrl, params };
  }

  private async tryCurlLoginFallback(
    config: ScraperConfigInternal,
    username: string,
    password: string,
    parentFormUrl: string | null,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<{ authenticated: boolean; statusCode: number; message: string } | null> {
    const tmpId = crypto.randomUUID();
    const cookieFile = path.join(os.tmpdir(), `rgt-curl-${tmpId}.cookies`);
    const headerFile = path.join(os.tmpdir(), `rgt-curl-${tmpId}.headers`);

    const escapeCurlCfg = (val: string): string =>
      val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

    const parseLastCurlHeaders = (rawHeaders: string): Headers => {
      const headers = new Headers();
      const blocks = rawHeaders
        .split(/\r?\n\r?\n/)
        .map((b) => b.trim())
        .filter((b) => /^HTTP\//i.test(b));
      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock) return headers;
      const lines = lastBlock.split(/\r?\n/).slice(1);
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx <= 0) continue;
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        if (key.toLowerCase() === 'set-cookie') continue;
        try {
          headers.append(key, val);
        } catch {
          // Ignore invalid header lines
        }
      }
      return headers;
    };

    const importNetscapeCookies = async (fallbackOriginUrl: string): Promise<void> => {
      if (!fs.existsSync(cookieFile)) return;
      const raw = fs.readFileSync(cookieFile, 'utf8');
      let imported = 0;
      const fallbackProto = new URL(fallbackOriginUrl).protocol.replace(':', '');

      for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        let httpOnly = false;
        let payload = line;
        if (payload.startsWith('#HttpOnly_')) {
          httpOnly = true;
          payload = payload.slice('#HttpOnly_'.length);
        } else if (payload.startsWith('#')) {
          continue;
        }

        const parts = payload.split('\t');
        if (parts.length < 7) continue;
        const [rawDomain, includeSubdomains, cookiePath, secureFlag, expiresEpoch, name, ...valueParts] = parts;
        if (!name || isIgnoredTrackingCookie(name)) continue;
        const value = valueParts.join('\t');
        const cleanDomain = rawDomain.replace(/^\./, '');
        if (!cleanDomain) continue;

        const isSecure = secureFlag.toUpperCase() === 'TRUE';
        const isSubdomainCookie =
          includeSubdomains.toUpperCase() === 'TRUE' && !/^\d+\.\d+\.\d+\.\d+$/.test(cleanDomain);
        const normalizedPath = cookiePath?.startsWith('/') ? cookiePath : '/';

        let cookieStr = `${name}=${value}; Path=${normalizedPath}`;
        if (isSubdomainCookie) {
          cookieStr += `; Domain=${cleanDomain}`;
        }
        if (isSecure) {
          cookieStr += '; Secure';
        }
        if (httpOnly) {
          cookieStr += '; HttpOnly';
        }
        const expSec = Number(expiresEpoch);
        if (Number.isFinite(expSec) && expSec > 0) {
          cookieStr += `; Expires=${new Date(expSec * 1000).toUTCString()}`;
        }

        const scheme = isSecure ? 'https' : fallbackProto || 'https';
        const originUrl = `${scheme}://${cleanDomain}${normalizedPath}`;
        try {
          await this.jar.setCookie(cookieStr, originUrl, { ignoreError: true });
          imported += 1;
        } catch {
          // Ignore individual cookie parse issues
        }
      }

      if (imported > 0) {
        this.saveCookieJar();
      }
    };

    const runCurl = async (
      targetUrl: string,
      postParams?: URLSearchParams,
      referer?: string,
    ): Promise<{ status: number; finalUrl: string; headers: Headers; body: string } | null> => {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      fs.writeFileSync(headerFile, '', { mode: 0o600 });
      const timeoutSec = Math.max(8, Math.min(30, Math.ceil((config.requestTimeoutMs || 15000) / 1000)));
      const metaMarker = `\n__RGT_CURL_META_${tmpId}__:`;

      const cfgLines: string[] = [
        `url = "${escapeCurlCfg(targetUrl)}"`,
        `dump-header = "${escapeCurlCfg(headerFile)}"`,
        `cookie = "${escapeCurlCfg(cookieFile)}"`,
        `cookie-jar = "${escapeCurlCfg(cookieFile)}"`,
      ];
      if (referer) {
        cfgLines.push(`referer = "${escapeCurlCfg(referer)}"`);
      }
      if (postParams) {
        cfgLines.push('header = "Content-Type: application/x-www-form-urlencoded"');
        cfgLines.push(`data = "${escapeCurlCfg(postParams.toString())}"`);
      }

      return new Promise((resolve) => {
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(
            'curl',
            [
              '-sS',
              '-L',
              '--max-redirs',
              '8',
              '--max-time',
              String(timeoutSec),
              '-w',
              `${metaMarker}%{http_code}\t%{url_effective}`,
              '--config',
              '-',
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] },
          );
        } catch {
          resolve(null);
          return;
        }

        const stdoutChunks: Buffer[] = [];
        let spawnFailed = false;
        const onAbort = () => {
          child.kill('SIGTERM');
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        child.on('error', () => {
          spawnFailed = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(null);
        });

        child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(`${cfgLines.join('\n')}\n`);

        child.on('close', () => {
          signal?.removeEventListener('abort', onAbort);
          if (spawnFailed) return;

          const fullOut = Buffer.concat(stdoutChunks).toString('utf8');
          const markerIdx = fullOut.lastIndexOf(metaMarker);
          if (markerIdx === -1) {
            resolve(null);
            return;
          }

          const body = fullOut.slice(0, markerIdx);
          const metaPart = fullOut.slice(markerIdx + metaMarker.length).trim();
          const [statusStr, effectiveUrl] = metaPart.split('\t');
          const status = Number(statusStr) || 0;
          if (status === 0) {
            resolve(null);
            return;
          }

          let rawHeaders = '';
          try {
            rawHeaders = fs.readFileSync(headerFile, 'utf8');
          } catch {
            rawHeaders = '';
          }

          resolve({
            status,
            finalUrl: effectiveUrl || targetUrl,
            headers: parseLastCurlHeaders(rawHeaders),
            body,
          });
        });
      });
    };

    try {
      fs.writeFileSync(cookieFile, '', { mode: 0o600 });

      const hasSessionCookieInJar = async (): Promise<boolean> => {
        const jarCookies = await this.jar.getCookies(config.baseUrl);
        return jarCookies.some((c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'));
      };

      // Step A: Direct POST matching `curl -s -c cookies.txt -d 'username=...&password=...' <loginUrl>`
      let activeCurlLabel = 'Approach 3a [curl:direct-post]';
      logAuthContainer(
        'INFO',
        `${activeCurlLabel}: Attempting native curl direct POST ${config.loginUrl} (fields=[username, password])`,
      );
      const directRes = await runCurl(
        config.loginUrl,
        new URLSearchParams({ username, password }),
      );
      if (!directRes) {
        logAuthContainer(
          'ERROR',
          `${activeCurlLabel}: FAILED — native curl binary unavailable, timed out, or failed to connect`,
        );
        return null;
      }

      await importNetscapeCookies(config.loginUrl);
      let finalLoginRes = directRes;

      if (await hasSessionCookieInJar()) {
        logAuthContainer(
          'INFO',
          `${activeCurlLabel}: Session cookie acquired (HTTP ${directRes.status}, finalUrl=${directRes.finalUrl}, cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
        );
      } else {
        const directCf = this.isCloudflareChallenge(directRes.status, directRes.headers, directRes.body);
        const directCfRay = directRes.headers.get('cf-ray');
        if (directCf) {
          logAuthContainer(
            'WARN',
            `${activeCurlLabel}: FAILED — blocked by Cloudflare challenge (HTTP ${directRes.status}${directCfRay ? `, CF-Ray: ${directCfRay}` : ''}); trying Approach 3b [curl:csrf-form]`,
          );
        } else {
          logAuthContainer(
            'INFO',
            `${activeCurlLabel}: Completed without session cookie (HTTP ${directRes.status}, finalUrl=${directRes.finalUrl}, cookies=[${this.getSafeCookieNames(config.baseUrl)}]); trying Approach 3b [curl:csrf-form]`,
          );
        }

        // Step B: If direct POST needed XenForo CSRF (_xfToken + login field), load form via curl and submit
        activeCurlLabel = 'Approach 3b [curl:csrf-form]';
        const formUrlToFetch = parentFormUrl || config.loginUrl;
        logAuthContainer('INFO', `${activeCurlLabel}: Requesting login form via curl GET ${formUrlToFetch}`);
        const formRes = await runCurl(formUrlToFetch);
        if (!formRes) {
          logAuthContainer('ERROR', `${activeCurlLabel}: FAILED — curl GET ${formUrlToFetch} returned no response`);
          if (directCf) return null;
        } else if (this.isCloudflareChallenge(formRes.status, formRes.headers, formRes.body)) {
          const formCfRay = formRes.headers.get('cf-ray');
          logAuthContainer(
            'WARN',
            `${activeCurlLabel}: FAILED on GET ${formUrlToFetch} — blocked by Cloudflare challenge (HTTP ${formRes.status}${formCfRay ? `, CF-Ray: ${formCfRay}` : ''})`,
          );
          return null;
        } else {
          await importNetscapeCookies(formRes.finalUrl);
          const form$ = loadHtml(formRes.body);
          const pwInput = form$('input[type="password"]').first();
          const loginForm = pwInput.closest('form');
          if (loginForm.length > 0 && pwInput.length > 0) {
            const { actionUrl, params } = this.buildLoginFormParams(
              form$,
              loginForm,
              pwInput,
              formRes.finalUrl,
              config,
              username,
              password,
            );
            logAuthContainer(
              'INFO',
              `${activeCurlLabel}: Loaded login form (HTTP ${formRes.status}, cookies=[${this.getSafeCookieNames(config.baseUrl)}]); submitting POST ${actionUrl} (fields=[${Array.from(params.keys()).join(', ')}])`,
            );
            const csrfPostRes = await runCurl(actionUrl, params, formRes.finalUrl);
            if (csrfPostRes) {
              await importNetscapeCookies(csrfPostRes.finalUrl);
              finalLoginRes = csrfPostRes;
            } else {
              logAuthContainer('ERROR', `${activeCurlLabel}: FAILED — curl POST ${actionUrl} returned no response`);
            }
          } else {
            logAuthContainer(
              'WARN',
              `${activeCurlLabel}: No password form found at ${formRes.finalUrl} (HTTP ${formRes.status})`,
            );
          }
        }
      }

      if (this.isCloudflareChallenge(finalLoginRes.status, finalLoginRes.headers, finalLoginRes.body)) {
        const finalCfRay = finalLoginRes.headers.get('cf-ray');
        logAuthContainer(
          'WARN',
          `${activeCurlLabel}: FAILED — blocked by Cloudflare challenge (HTTP ${finalLoginRes.status}${finalCfRay ? `, CF-Ray: ${finalCfRay}` : ''})`,
        );
        return null;
      }

      const post$ = loadHtml(finalLoginRes.body);
      const blockError = post$('.blockMessage--error, #login_error, .errorPanel, .message--error, .formRow--error')
        .not('.u-noJsOnly, .blockMessage--important')
        .filter((_, el) => post$(el).closest('noscript, template').length === 0)
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const stillOnLoginForm = post$('input[type="password"]').length > 0;
      const hasSessionBeforeRepo = await hasSessionCookieInJar();
      const loginRejected =
        Boolean(blockError) ||
        finalLoginRes.status >= 400 ||
        (stillOnLoginForm && !hasSessionBeforeRepo);

      let repoReached = false;
      let repoTitle = '';
      if (!loginRejected && (hasSessionBeforeRepo || finalLoginRes.status < 400)) {
        logAuthContainer('INFO', `${activeCurlLabel}: Priming repository gate via curl GET ${config.baseUrl}`);
        const repoRes = await runCurl(config.baseUrl, undefined, finalLoginRes.finalUrl);
        if (repoRes && !this.isCloudflareChallenge(repoRes.status, repoRes.headers, repoRes.body)) {
          await importNetscapeCookies(repoRes.finalUrl);
          const repo$ = loadHtml(repoRes.body);
          repoTitle = repo$('title').first().text().trim();
          repoReached =
            repoRes.status >= 200 &&
            repoRes.status < 400 &&
            !repoRes.finalUrl.includes('/login') &&
            repo$('input[name="login"]').length === 0 &&
            repo$('input[type="password"]').length === 0;
        }
      }

      const cookies = await this.jar.getCookies(config.baseUrl);
      const hasXfUser = cookies.some((c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'));
      const authenticated = !loginRejected && (hasXfUser || repoReached);

      let message: string;
      if (authenticated) {
        message = `Authenticated as ${username} (${cookies.length} cookies${repoTitle ? ` · "${repoTitle}"` : ''})`;
        logAuthContainer(
          'INFO',
          `${activeCurlLabel}: SUCCEEDED — ${message} (cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
        );
      } else {
        const bodySnippet = (() => {
          const msg = post$('.blockMessage--error, .blockMessage, #login_error, h1')
            .first()
            .text()
            .replace(/\s+/g, ' ')
            .trim();
          const t = (msg || post$('title').first().text() || finalLoginRes.body.replace(/<[^>]+>/g, ' '))
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180);
          return t || '';
        })();
        if (blockError) {
          message = `Login rejected: ${blockError}`;
        } else if (finalLoginRes.status === 401 || finalLoginRes.status === 403) {
          message = `Login rejected (HTTP ${finalLoginRes.status}) at ${finalLoginRes.finalUrl}: invalid credentials or access denied.`;
        } else if (finalLoginRes.status >= 400) {
          message = `Login Endpoint URL returned HTTP ${finalLoginRes.status} (${finalLoginRes.finalUrl}${bodySnippet ? ` · ${bodySnippet}` : ''}). Check that the Login Endpoint URL is valid.`;
        } else if (stillOnLoginForm) {
          message = `Invalid username or password: server returned the login form without establishing an authenticated session.`;
        } else {
          message = `Authentication failed (HTTP ${finalLoginRes.status}): no active session cookie returned from ${finalLoginRes.finalUrl}.`;
        }
        const serverHdr = finalLoginRes.headers.get('server') || 'unknown';
        logAuthContainer(
          'WARN',
          `${activeCurlLabel}: FAILED — ${message} (HTTP ${finalLoginRes.status}, server=${serverHdr}, finalUrl=${finalLoginRes.finalUrl}, cookies=[${this.getSafeCookieNames(config.baseUrl)}])`,
        );
      }

      this.setAuthState({
        configured: true,
        authenticated,
        cookieCount: cookies.length,
        lastMessage: message,
      });

      if (authenticated) {
        log?.('info', message);
      }

      return {
        authenticated,
        statusCode: finalLoginRes.status,
        message,
      };
    } finally {
      try {
        if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);
      } catch {
        // Ignore temp cleanup errors
      }
      try {
        if (fs.existsSync(headerFile)) fs.unlinkSync(headerFile);
      } catch {
        // Ignore temp cleanup errors
      }
    }
  }

  async testAuthAndDiscovery(config: ScraperConfigInternal, signal?: AbortSignal): Promise<AuthTestResult> {
    const started = performance.now();
    // Use bounded retries/timeout during interactive test probes so dead servers/bad URLs fail fast with real diagnostics
    const probeConfig: ScraperConfigInternal = {
      ...config,
      maxRetries: Math.min(config.maxRetries, 1),
      requestTimeoutMs: Math.min(config.requestTimeoutMs, 12000),
    };

    const username = (probeConfig.username || '').trim();
    const password = probeConfig.password || '';
    logAuthContainer(
      'INFO',
      `=== Test Login & Discover Consoles triggered (user="${username || '<anonymous>'}", loginUrl="${probeConfig.loginUrl}", baseUrl="${probeConfig.baseUrl}", cachedCookies=[${this.getSafeCookieNames(probeConfig.baseUrl)}]) ===`,
    );

    try {
      this.validateHttpUrlOrExplain(probeConfig.baseUrl, 'Repository Base URL');

      let authMessage = 'Anonymous repository probe';
      let authenticated = false;

      if (username || password) {
        this.validateHttpUrlOrExplain(probeConfig.loginUrl, 'Login Endpoint URL');
        const loginRes = await this.login(probeConfig, signal);
        authenticated = loginRes.authenticated;
        authMessage = loginRes.message;

        if (!authenticated) {
          const latencyMs = Math.round(performance.now() - started);
          logAuthContainer(
            'ERROR',
            `=== Test Login & Discover Consoles FAILED during login (${latencyMs}ms): ${loginRes.message} ===`,
          );
          return {
            success: false,
            statusCode: loginRes.statusCode || null,
            authenticated: false,
            cookieCount: this.getSafeCookieCount(probeConfig.baseUrl),
            discoveredSystems: [],
            sampleReleaseUrls: [],
            message: loginRes.message,
            latencyMs,
          };
        }
      }

      logAuthContainer(
        'INFO',
        `Console discovery [impit:${this.activeBrowserProfile}]: Requesting repository index GET ${probeConfig.baseUrl} (cookies=[${this.getSafeCookieNames(probeConfig.baseUrl)}])`,
      );

      let repoRes: { response: ImpitResponse; finalUrl: string; latencyMs: number };
      try {
        repoRes = await this.fetchWithRedirects(probeConfig.baseUrl, probeConfig, { method: 'GET' }, signal);
      } catch (err) {
        const msg = `Cannot reach Repository Base URL (${probeConfig.baseUrl}): ${this.formatNetworkError(err, probeConfig.baseUrl)}`;
        const latencyMs = Math.round(performance.now() - started);
        logAuthContainer('ERROR', `=== Test Login & Discover Consoles FAILED (${latencyMs}ms): ${msg} ===`);
        this.setAuthState({
          configured: Boolean(username && password),
          authenticated: false,
          cookieCount: this.getSafeCookieCount(probeConfig.baseUrl),
          lastMessage: msg,
        });
        return {
          success: false,
          statusCode: null,
          authenticated: false,
          cookieCount: this.getSafeCookieCount(probeConfig.baseUrl),
          discoveredSystems: [],
          sampleReleaseUrls: [],
          message: msg,
          latencyMs,
        };
      }

      const html = await repoRes.response.text();
      const cookiesCount = this.getSafeCookieCount(probeConfig.baseUrl);
      const latencyMs = Math.round(performance.now() - started);

      if (this.isCloudflareChallenge(repoRes.response.status, repoRes.response.headers, html)) {
        const cfRay = repoRes.response.headers.get('cf-ray');
        const msg = `Blocked by Cloudflare bot protection (HTTP ${repoRes.response.status}${cfRay ? ` · CF-Ray ${cfRay}` : ''}) at Repository Base URL (${repoRes.finalUrl}).`;
        logAuthContainer('ERROR', `=== Test Login & Discover Consoles FAILED (${latencyMs}ms): ${msg} ===`);
        this.setAuthState({
          configured: Boolean(username && password),
          authenticated: false,
          cookieCount: cookiesCount,
          lastMessage: msg,
        });
        return {
          success: false,
          statusCode: repoRes.response.status,
          authenticated: false,
          cookieCount: cookiesCount,
          discoveredSystems: [],
          sampleReleaseUrls: [],
          message: msg,
          latencyMs,
        };
      }

      if (repoRes.response.status >= 400) {
        const msg = `Repository Base URL returned HTTP ${repoRes.response.status} at ${repoRes.finalUrl}. Verify the Repository Base URL is correct.`;
        logAuthContainer('ERROR', `=== Test Login & Discover Consoles FAILED (${latencyMs}ms): ${msg} ===`);
        this.setAuthState({
          configured: Boolean(username && password),
          authenticated: false,
          cookieCount: cookiesCount,
          lastMessage: msg,
        });
        return {
          success: false,
          statusCode: repoRes.response.status,
          authenticated: false,
          cookieCount: cookiesCount,
          discoveredSystems: [],
          sampleReleaseUrls: [],
          message: msg,
          latencyMs,
        };
      }

      const redirectedToLogin =
        repoRes.finalUrl.includes('/login') ||
        repoRes.finalUrl.includes('wp-login.php') ||
        loadHtml(html)('input[type="password"]').length > 0;

      if (redirectedToLogin) {
        const reason = !username && !password
          ? `Credentials missing: enter both Repository Username and Repository Password (target redirected to ${repoRes.finalUrl}).`
          : `Access rejected: Repository Base URL redirected back to login (${repoRes.finalUrl}). Check your credentials and Login Endpoint URL.`;
        logAuthContainer('ERROR', `=== Test Login & Discover Consoles FAILED (${latencyMs}ms): ${reason} ===`);
        this.setAuthState({
          configured: Boolean(username && password),
          authenticated: false,
          cookieCount: cookiesCount,
          lastMessage: reason,
        });
        return {
          success: false,
          statusCode: repoRes.response.status,
          authenticated: false,
          cookieCount: cookiesCount,
          discoveredSystems: [],
          sampleReleaseUrls: [],
          message: reason,
          latencyMs,
        };
      }

      const { systems, releasePages, downloads } = this.extractLinksFromHtml(
        html,
        repoRes.finalUrl,
        { ...probeConfig, systemFilter: '' },
      );

      const sortedSystems = await this.filterLiveSystems(systems, probeConfig);
      if (!username && !password && sortedSystems.length === 0 && releasePages.length === 0) {
        const msg = `Credentials missing (username and password are empty) and no consoles were discovered at ${repoRes.finalUrl}.`;
        logAuthContainer('WARN', `=== Test Login & Discover Consoles FAILED (${latencyMs}ms): ${msg} ===`);
        this.setAuthState({
          configured: false,
          authenticated: false,
          cookieCount: cookiesCount,
          lastMessage: msg,
        });
        return {
          success: false,
          statusCode: repoRes.response.status,
          authenticated: false,
          cookieCount: cookiesCount,
          discoveredSystems: [],
          sampleReleaseUrls: [],
          message: msg,
          latencyMs,
        };
      }

      logAuthContainer(
        'INFO',
        `=== Test Login & Discover Consoles SUCCEEDED (${latencyMs}ms): HTTP ${repoRes.response.status}, discovered ${sortedSystems.length} consoles, ${releasePages.length} sample releases, cookies=[${this.getSafeCookieNames(probeConfig.baseUrl)}] ===`,
      );

      return {
        success: true,
        statusCode: repoRes.response.status,
        authenticated,
        cookieCount: cookiesCount,
        discoveredSystems: sortedSystems,
        sampleReleaseUrls: [...releasePages.slice(0, 8), ...downloads.slice(0, 4).map((d) => d.remoteUrl)],
        message: `${authMessage} · Repo HTTP ${repoRes.response.status} (${sortedSystems.length} systems, ${releasePages.length} release pages found on index)`,
        latencyMs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const latencyMs = Math.round(performance.now() - started);
      logAuthContainer('ERROR', `=== Test Login & Discover Consoles FAILED (${latencyMs}ms): ${msg} ===`);
      this.setAuthState({
        configured: Boolean(probeConfig.username && probeConfig.password),
        authenticated: false,
        cookieCount: this.getSafeCookieCount(probeConfig.baseUrl),
        lastMessage: msg,
      });
      return {
        success: false,
        statusCode: null,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(probeConfig.baseUrl),
        discoveredSystems: [],
        sampleReleaseUrls: [],
        message: msg,
        latencyMs,
      };
    }
  }

  /**
   * Extract navigation links, pagination pages, release detail pages, and direct archive links.
   */
  extractLinksFromHtml(
    html: string,
    pageUrl: string,
    config: ScraperConfigInternal,
  ): {
    subPages: string[];
    releasePages: string[];
    systems: string[];
    downloads: DiscoveredRelease[];
    releaseTimes: Map<string, string>;
  } {
    const $ = loadHtml(html);
    const base = new URL(config.baseUrl);
    const current = new URL(pageUrl);

    const subPages = new Set<string>();
    const releasePages = new Set<string>();
    const systems = new Set<string>();
    const downloads: DiscoveredRelease[] = [];
    const seenDownloads = new Set<string>();
    const releaseTimes = new Map<string, string>();

    const systemFilters = expandSystemFilterAliases(
      config.systemFilter
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );

    const pageTime =
      $('time[datetime]').first().attr('datetime') ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[property="article:modified_time"]').attr('content') ||
      null;

    const pageTitle = $('h1').first().text().trim() || $('title').first().text().trim();

    $('a[href]').each((_, el) => {
      const rawHref = $(el).attr('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('javascript:')) {
        return;
      }

      let resolved: URL;
      try {
        resolved = new URL(rawHref, current);
      } catch {
        return;
      }

      // Allow main host AND download subdomains (e.g. squall.retrogametalk.com, rinoa.retrogametalk.com)
      if (!isSameRootDomain(resolved.hostname, base.hostname)) return;
      resolved.hash = '';

      // Skip XenForo comment query links and asset files
      if (resolved.searchParams.has('xf-comments')) return;
      const pathLower = resolved.pathname.toLowerCase();
      if (/\.(png|jpg|jpeg|gif|svg|ico|css|js|webp|woff2?)$/i.test(pathLower)) return;

      const anchorText = $(el).text().trim();
      const hasDownloadAttr = $(el).attr('download') !== undefined;

      const baseSegs = base.pathname.split('/').filter(Boolean);
      const targetSegs = resolved.pathname.split('/').filter(Boolean);
      const isUnderRepo =
        resolved.hostname.toLowerCase() === base.hostname.toLowerCase() &&
        (baseSegs.length === 0 ||
          baseSegs.every((seg, i) => targetSegs[i]?.toLowerCase() === seg.toLowerCase()));

      const relSegs = isUnderRepo ? targetSegs.slice(baseSegs.length) : targetSegs;
      const firstSegLower = (relSegs[0] || '').toLowerCase();

      if (isUnderRepo && (IGNORED_REPO_PREFIXES.has(firstSegLower) || isNonSystemSlug(firstSegLower))) return;

      const paramPlatform = resolved.searchParams.get('platform');
      const rawSystemCandidate = paramPlatform
        ? sanitizePathSegment(paramPlatform)
        : relSegs[0]
          ? sanitizePathSegment(relSegs[0])
          : 'uncategorized';
      const systemCandidate = canonicalizeSystemSlug(rawSystemCandidate) || rawSystemCandidate;

      if (
        systemFilters.size > 0 &&
        (isUnderRepo || Boolean(paramPlatform)) &&
        relSegs.length > 0 &&
        firstSegLower !== 'page' &&
        !systemFilters.has(rawSystemCandidate.toLowerCase()) &&
        !systemFilters.has(systemCandidate.toLowerCase())
      ) {
        return;
      }

      const cardContainer = $(el).closest('article, tr, li, .post, .entry, .rgt-card, .game-card');
      const cardTimeEl = cardContainer.find('time[datetime]').first();
      const cardSpecificTime =
        cardContainer.attr('data-modified') ||
        cardTimeEl.attr('data-modified') ||
        cardTimeEl.attr('datetime') ||
        null;
      const containerTime = cardSpecificTime || pageTime;

      if (isDownloadCandidateUrl(resolved, anchorText, hasDownloadAttr)) {
        const hrefStr = resolved.toString();
        if (seenDownloads.has(hrefStr)) return;
        seenDownloads.add(hrefStr);

        const paramFile = resolved.searchParams.get('file');
        const rawPathFilename = paramFile || path.basename(resolved.pathname);
        const ext = path.extname(rawPathFilename).toLowerCase();
        const fallbackFilename = ARCHIVE_EXTENSIONS.has(ext)
          ? rawPathFilename
          : `${sanitizePathSegment(anchorText || pageTitle || 'release')}.zip`;

        const pathSourceUrl = isUnderRepo ? resolved.toString() : current.toString();
        const mirrored = resolveMirroredPaths(
          config.baseUrl,
          pathSourceUrl,
          config.downloadDir,
          fallbackFilename,
        );

        const cleanLabel = anchorText && anchorText.toLowerCase() !== 'download'
          ? anchorText
          : mirrored.filename;
        downloads.push({
          remoteUrl: hrefStr,
          pageUrl: current.toString(),
          downloadUrl: hrefStr,
          remotePath: mirrored.remotePath,
          filename: mirrored.filename,
          displayLabel: cleanLabel,
          systemName: canonicalizeSystemSlug(
            resolved.searchParams.get('platform')
              ? sanitizePathSegment(resolved.searchParams.get('platform')!)
              : mirrored.systemName,
          ),
          releaseType: inferReleaseType(`${anchorText} ${pageTitle}`, hrefStr),
          title: anchorText && anchorText.toLowerCase() !== 'download'
            ? anchorText
            : pageTitle || mirrored.filename,
          publishedAt: containerTime,
        });
        return;
      }

      const hasPagingParam =
        resolved.searchParams.has('paged') ||
        resolved.searchParams.has('fwp_paged') ||
        resolved.searchParams.has('page');

      if (isUnderRepo && (resolved.pathname !== current.pathname || (hasPagingParam && resolved.href !== current.href))) {
        const isPagination =
          firstSegLower === 'page' ||
          (relSegs.length >= 2 && relSegs[1].toLowerCase() === 'page') ||
          hasPagingParam;

        let cleanUrl = `${resolved.origin}${resolved.pathname}`;
        if (hasPagingParam) {
          const pagingParams = new URLSearchParams();
          for (const key of ['paged', 'fwp_paged', 'page']) {
            const val = resolved.searchParams.get(key);
            if (val) pagingParams.set(key, val);
          }
          const qs = pagingParams.toString();
          if (qs) cleanUrl = `${cleanUrl}?${qs}`;
        }

        if (cardSpecificTime) {
          releaseTimes.set(cleanUrl, cardSpecificTime);
        }

        // Pagination or top-level system directory (/repo/page/2/, /repo/nes-roms/, /repo/nes-roms/page/2/)
        if (relSegs.length === 1 && firstSegLower !== 'page' && !hasPagingParam) {
          if (!isNonSystemSlug(systemCandidate)) {
            systems.add(systemCandidate);
            subPages.add(cleanUrl);
          }
        } else if (isPagination) {
          subPages.add(cleanUrl);
        } else if (relSegs.length >= 2) {
          // Release detail page: /repo/<system>/<release-slug>/
          releasePages.add(cleanUrl);
        }
      }
    });

    return {
      subPages: Array.from(subPages),
      releasePages: Array.from(releasePages),
      systems: Array.from(systems),
      downloads,
      releaseTimes,
    };
  }

  /**
   * Resolves dynamic RetroGameTalk download links via WordPress cdr-main ajax.php
   * (`#acf-content-wrapper` or `.dlc-button`) when visiting a release detail page.
   */
  async extractDynamicReleaseDownloads(
    html: string,
    pageUrl: string,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
    allowReauthRetry = true,
  ): Promise<DiscoveredRelease[]> {
    const $ = loadHtml(html);
    const wrapper = $('#acf-content-wrapper[data-id]').first();
    const dlcButtons = $('.dlc-button[data-id]');

    if (wrapper.length === 0 && dlcButtons.length === 0) {
      return [];
    }

    const pageTitle = $('h1').first().text().trim() || $('title').first().text().trim();
    const pageTime =
      $('time[datetime]').first().attr('datetime') ||
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[property="article:modified_time"]').attr('content') ||
      null;

    // Parse cdrData script config if present
    const repoBase = ensureTrailingSlash(config.baseUrl);
    let ajaxUrl = new URL('wp-content/plugins/cdr-main/public/ajax.php', repoBase).toString();
    let nonceUrl = new URL('wp-admin/admin-ajax.php?action=cdr_nonce', repoBase).toString();
    const extraScript = $('#cdr-download-script-js-extra').html() || '';
    const cdrMatch = extraScript.match(/var\s+cdrData\s*=\s*(\{[^;]+\})/);
    if (cdrMatch?.[1]) {
      try {
        const parsed = JSON.parse(cdrMatch[1]) as { ajaxUrl?: string; nonceUrl?: string };
        if (parsed.ajaxUrl) ajaxUrl = parsed.ajaxUrl;
        if (parsed.nonceUrl) nonceUrl = parsed.nonceUrl;
      } catch {
        // Use default endpoints
      }
    }

    const results: DiscoveredRelease[] = [];
    let authFailureDetected = false;
    let sawCloudflareChallenge = false;

    const looksLikeAuthWall = (status: number, finalUrl: string, bodyText: string): boolean => {
      if (status === 401 || status === 403) return true;
      if (finalUrl.includes('/login') || finalUrl.includes('wp-login.php')) return true;
      const trimmed = bodyText.trim();
      if (trimmed === '0' || trimmed === '-1') return true;
      const lower = trimmed.toLowerCase();
      return (
        lower.includes('type="password"') ||
        lower.includes("type='password'") ||
        lower.includes('must be logged in') ||
        lower.includes('please log in') ||
        lower.includes('login to download')
      );
    };

    // Standard release page (#acf-content-wrapper)
    if (wrapper.length > 0) {
      const postId = String(wrapper.attr('data-id') || '');
      let nonce = String(wrapper.attr('data-nonce') || '');

      const fetchAjaxHtml = async (currentNonce: string): Promise<string> => {
        const res = await this.fetchWithRedirects(
          ajaxUrl,
          config,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: pageUrl,
              Origin: new URL(pageUrl).origin,
            },
            body: new URLSearchParams({ post_id: postId, _wpnonce: currentNonce }).toString(),
          },
          signal,
          log,
        );
        const body = await res.response.text();
        if (this.isCloudflareChallenge(res.response.status, res.response.headers, body)) {
          sawCloudflareChallenge = true;
          log?.('debug', `[Scrape] Cloudflare challenge detected on dynamic download AJAX (${ajaxUrl})`, `status=${res.response.status}, postId=${postId}`);
        } else if (looksLikeAuthWall(res.response.status, res.finalUrl, body)) {
          authFailureDetected = true;
          log?.('debug', `[Scrape] Auth wall detected on dynamic download AJAX (${ajaxUrl})`, `status=${res.response.status}, finalUrl=${res.finalUrl}, snippet=${body.trim().slice(0, 140)}`);
        } else if (!body.includes('download.php') && !body.includes('dl-btn-')) {
          log?.('debug', `[Scrape] Dynamic AJAX returned HTTP ${res.response.status} without download links`, `postId=${postId}, len=${body.length}, snippet=${body.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
        }
        return body;
      };

      let ajaxHtml = await fetchAjaxHtml(nonce);
      if (!ajaxHtml.includes('download.php') && !ajaxHtml.includes('dl-btn-') && !sawCloudflareChallenge) {
        // Refresh cached nonce via cdr_nonce endpoint
        log?.('debug', `[Scrape] Initial nonce produced no links for postId=${postId}; refreshing via cdr_nonce`, nonceUrl);
        const nonceRes = await this.fetchWithRedirects(
          `${nonceUrl}${nonceUrl.includes('?') ? '&' : '?'}post_id=${encodeURIComponent(postId)}`,
          config,
          { method: 'GET', headers: { Referer: pageUrl, 'X-Requested-With': 'XMLHttpRequest' } },
          signal,
          log,
        );
        const freshNonce = (await nonceRes.response.text()).trim();
        if (this.isCloudflareChallenge(nonceRes.response.status, nonceRes.response.headers, freshNonce)) {
          sawCloudflareChallenge = true;
          log?.('debug', `[Scrape] Cloudflare challenge on cdr_nonce endpoint`, `status=${nonceRes.response.status}`);
        } else if (looksLikeAuthWall(nonceRes.response.status, nonceRes.finalUrl, freshNonce)) {
          authFailureDetected = true;
          log?.('debug', `[Scrape] Auth wall on cdr_nonce endpoint`, `status=${nonceRes.response.status}, body=${freshNonce.slice(0, 80)}`);
        } else if (freshNonce && freshNonce !== '0' && freshNonce !== '-1') {
          nonce = freshNonce;
          ajaxHtml = await fetchAjaxHtml(nonce);
        } else {
          log?.('debug', `[Scrape] cdr_nonce returned empty/rejected token for postId=${postId}`, `status=${nonceRes.response.status}, body="${freshNonce.slice(0, 80)}"`);
        }
      }

      const ajax$ = loadHtml(ajaxHtml);
      ajax$('a[href]').each((_, a) => {
        const href = ajax$(a).attr('href');
        if (!href) return;
        let dlUrl: URL;
        try {
          dlUrl = new URL(href, pageUrl);
        } catch {
          return;
        }
        const filenameAttr = ajax$(a).siblings('[data-filename]').attr('data-filename');
        const paramFile = dlUrl.searchParams.get('file');
        const anchorText = ajax$(a).text().replace(/\s+/g, ' ').trim();
        const filename = sanitizePathSegment(
          filenameAttr || paramFile || anchorText || `${pageTitle}.zip`,
        );

        const mirrored = resolveMirroredPaths(config.baseUrl, pageUrl, config.downloadDir, filename);
        const platformParam = dlUrl.searchParams.get('platform');
        const canonicalRemoteUrl = `${pageUrl.split('#')[0]}#${encodeURIComponent(filename)}`;

        results.push({
          remoteUrl: canonicalRemoteUrl,
          pageUrl,
          downloadUrl: dlUrl.toString(),
          remotePath: mirrored.remotePath,
          filename: mirrored.filename,
          displayLabel: anchorText && !/^download$/i.test(anchorText) ? anchorText : mirrored.filename,
          systemName: canonicalizeSystemSlug(
            platformParam ? sanitizePathSegment(platformParam) : mirrored.systemName,
          ),
          releaseType: inferReleaseType(`${pageTitle} ${anchorText}`, filename),
          title: pageTitle || mirrored.filename,
          publishedAt: pageTime,
        });
      });
    }

    // DLC / BIOS row buttons (.dlc-button)
    if (results.length === 0 && dlcButtons.length > 0 && !sawCloudflareChallenge) {
      for (let i = 0; i < dlcButtons.length; i += 1) {
        if (signal?.aborted) break;
        const btn = dlcButtons.eq(i);
        const postId = String(btn.attr('data-id') || '');
        const row = String(btn.attr('data-row') || '');
        if (!postId) continue;

        const nonceRes = await this.fetchWithRedirects(
          `${nonceUrl}${nonceUrl.includes('?') ? '&' : '?'}post_id=${encodeURIComponent(postId)}`,
          config,
          { method: 'GET', headers: { Referer: pageUrl, 'X-Requested-With': 'XMLHttpRequest' } },
          signal,
          log,
        );
        const freshNonce = (await nonceRes.response.text()).trim();
        if (this.isCloudflareChallenge(nonceRes.response.status, nonceRes.response.headers, freshNonce)) {
          sawCloudflareChallenge = true;
          break;
        }
        if (looksLikeAuthWall(nonceRes.response.status, nonceRes.finalUrl, freshNonce)) {
          authFailureDetected = true;
          continue;
        }
        const urlRes = await this.fetchWithRedirects(
          ajaxUrl,
          config,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: pageUrl,
            },
            body: new URLSearchParams({ post_id: postId, row, _wpnonce: freshNonce }).toString(),
          },
          signal,
          log,
        );
        const dlHref = (await urlRes.response.text()).trim();
        if (this.isCloudflareChallenge(urlRes.response.status, urlRes.response.headers, dlHref)) {
          sawCloudflareChallenge = true;
          break;
        }
        if (looksLikeAuthWall(urlRes.response.status, urlRes.finalUrl, dlHref)) {
          authFailureDetected = true;
          log?.('debug', `[Scrape] DLC button postId=${postId} row=${row} hit auth wall`, `status=${urlRes.response.status}`);
          continue;
        }
        if (!dlHref.startsWith('http')) {
          log?.('debug', `[Scrape] DLC button postId=${postId} row=${row} returned non-URL response`, `status=${urlRes.response.status}, body="${dlHref.slice(0, 120)}"`);
          continue;
        }

        const dlUrl = new URL(dlHref);
        const btnLabel = btn.text().replace(/\s+/g, ' ').trim();
        const filename = sanitizePathSegment(
          dlUrl.searchParams.get('file') || btnLabel || `row-${row}.zip`,
        );
        const mirrored = resolveMirroredPaths(config.baseUrl, pageUrl, config.downloadDir, filename);
        results.push({
          remoteUrl: `${pageUrl.split('#')[0]}#${encodeURIComponent(filename)}`,
          pageUrl,
          downloadUrl: dlUrl.toString(),
          remotePath: mirrored.remotePath,
          filename: mirrored.filename,
          displayLabel: btnLabel || mirrored.filename,
          systemName: canonicalizeSystemSlug(mirrored.systemName),
          releaseType: inferReleaseType(`${pageTitle} ${btnLabel}`, filename),
          title: pageTitle || mirrored.filename,
          publishedAt: pageTime,
        });
      }
    }

    if (
      results.length === 0 &&
      allowReauthRetry &&
      !sawCloudflareChallenge &&
      !signal?.aborted &&
      (authFailureDetected || wrapper.length > 0 || dlcButtons.length > 0) &&
      config.username &&
      config.password
    ) {
      log?.(
        'warn',
        `Download link resolution returned no links for ${pageUrl}; re-authenticating and retrying`,
      );
      const auth = await this.login(config, signal, log);
      if (auth.authenticated) {
        const refreshed = await this.fetchPageHtml(pageUrl, config, signal, log);
        if (refreshed.status < 400) {
          return this.extractDynamicReleaseDownloads(
            refreshed.html,
            refreshed.finalUrl,
            config,
            signal,
            log,
            false,
          );
        }
      }
    }

    return results;
  }

  async fetchPageHtml(
    url: string,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<{ html: string; finalUrl: string; status: number }> {
    const { response, finalUrl } = await this.fetchWithRedirects(url, config, { method: 'GET' }, signal, log);

    const initialRedirectedToLogin =
      finalUrl.includes('/login') || finalUrl.includes('wp-login.php');
    let html = '';
    if (initialRedirectedToLogin) {
      await response.body?.cancel().catch(() => undefined);
    } else {
      html = await response.text();
    }

    if (!initialRedirectedToLogin && this.isCloudflareChallenge(response.status, response.headers, html)) {
      const msg = `Blocked by Cloudflare bot protection (HTTP ${response.status}) at ${finalUrl}`;
      this.setAuthState({
        configured: Boolean(config.username && config.password),
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      throw new Error(msg);
    }

    const htmlLooksLikeLoginGate =
      !initialRedirectedToLogin &&
      (response.status === 401 ||
        response.status === 403 ||
        (loadHtml(html)('input[type="password"]').length > 0 && !html.includes('acf-content-wrapper')));

    // If redirected to /login/, HTTP 401/403, or served an inline login form mid-crawl, refresh session and retry once
    if ((initialRedirectedToLogin || htmlLooksLikeLoginGate) && config.username && config.password) {
      log?.(
        'debug',
        `[Auth] Mid-crawl auth gate detected fetching ${url}`,
        `status=${response.status}, finalUrl=${finalUrl}, redirectedToLogin=${initialRedirectedToLogin}, inlineForm=${htmlLooksLikeLoginGate}`,
      );
      log?.('warn', 'Session expired or unauthorized mid-crawl; re-authenticating');
      const auth = await this.login(config, signal, log);
      if (!auth.authenticated) {
        throw new Error(`Re-authentication failed mid-crawl: ${auth.message}`);
      }
      const retry = await this.fetchWithRedirects(url, config, { method: 'GET' }, signal, log);
      const retryHtml = await retry.response.text();
      if (this.isCloudflareChallenge(retry.response.status, retry.response.headers, retryHtml)) {
        const msg = `Blocked by Cloudflare bot protection (HTTP ${retry.response.status}) at ${retry.finalUrl}`;
        this.setAuthState({
          configured: Boolean(config.username && config.password),
          authenticated: false,
          cookieCount: this.getSafeCookieCount(config.baseUrl),
          lastMessage: msg,
        });
        throw new Error(msg);
      }
      if (retry.finalUrl.includes('/login') || retry.finalUrl.includes('wp-login.php')) {
        const msg = `Authentication expired or rejected: ${url} redirected to ${retry.finalUrl}`;
        this.setAuthState({
          configured: Boolean(config.username && config.password),
          authenticated: false,
          cookieCount: this.getSafeCookieCount(config.baseUrl),
          lastMessage: msg,
        });
        throw new Error(msg);
      }
      return { html: retryHtml, finalUrl: retry.finalUrl, status: retry.response.status };
    }

    if (initialRedirectedToLogin) {
      const msg = `Authentication required or expired: ${url} redirected to ${finalUrl}`;
      this.setAuthState({
        configured: Boolean(config.username && config.password),
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      throw new Error(msg);
    }

    return { html, finalUrl, status: response.status };
  }

  private async fetchRangeSlice(
    targetUrl: string,
    refererUrl: string,
    slice: ByteRange,
    ifRangeValidator: string | null,
    config: ScraperConfigInternal,
    signal: AbortSignal,
    timeoutMs: number,
    log?: LoggerFn,
  ): Promise<{ response: ImpitResponse; finalUrl: string; latencyMs: number }> {
    // Respect any active global 429/503 cooldown before issuing sibling range traffic
    await this.rateLimiter.waitForCooldown(signal);

    const started = performance.now();
    let cookieHeader = await this.jar.getCookieString(targetUrl);
    try {
      if (!cookieHeader && isSameRootDomain(new URL(targetUrl).hostname, new URL(config.baseUrl).hostname)) {
        cookieHeader = await this.jar.getCookieString(config.baseUrl);
      }
    } catch {
      // Ignore malformed URL during fallback cookie lookup
    }

    const headers = new Headers();
    headers.set('Range', `bytes=${slice[0]}-${slice[1]}`);
    if (ifRangeValidator) {
      headers.set('If-Range', ifRangeValidator);
    }
    if (refererUrl) {
      headers.set('Referer', refererUrl);
      try {
        const refOrigin = new URL(refererUrl).origin;
        const curOrigin = new URL(targetUrl).origin;
        headers.set('Sec-Fetch-Site', refOrigin === curOrigin ? 'same-origin' : 'cross-site');
      } catch {
        // Keep default Sec-Fetch-Site
      }
    }
    const trimmedUa = (config.userAgent || '').trim();
    if (trimmedUa && !DEFAULT_BROWSER_USER_AGENTS.has(trimmedUa)) {
      headers.set('User-Agent', trimmedUa);
    }
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }

    let res: ImpitResponse;
    try {
      res = await this.httpClient.fetch(targetUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        timeout: timeoutMs,
        signal,
      });
    } catch (err) {
      const latency = performance.now() - started;
      if (!signal.aborted) {
        this.rateLimiter.recordError(latency);
      }
      throw err;
    }

    const latency = performance.now() - started;
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    let storedCookies = 0;
    for (const rawCookie of setCookies) {
      const cookieName = rawCookie.split('=', 1)[0]?.trim() || '';
      if (isIgnoredTrackingCookie(cookieName)) continue;
      try {
        await this.jar.setCookie(rawCookie, targetUrl);
        storedCookies += 1;
      } catch {
        // Ignore malformed Set-Cookie on range chunk
      }
    }
    if (storedCookies > 0) {
      this.saveCookieJar();
    }

    if (res.status === 429 || res.status === 503) {
      await res.body?.cancel().catch(() => undefined);
      const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
      const cooldownMs = this.rateLimiter.recordThrottle(retryAfterSec, latency);
      throw new RangeThrottleError(res.status, cooldownMs, retryAfterSec, safeHostname(targetUrl));
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const redirectLocation = new URL(res.headers.get('location')!, targetUrl).toString();
      await res.body?.cancel().catch(() => undefined);
      if (isThrottleErrorPageUrl(redirectLocation)) {
        const inferredStatus = inferThrottleStatusFromUrl(redirectLocation);
        const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
        const cooldownMs = this.rateLimiter.recordThrottle(retryAfterSec, latency);
        throw new RangeThrottleError(inferredStatus, cooldownMs, retryAfterSec, safeHostname(targetUrl));
      }
      logServer('HTTP', 'debug', `Redirect HTTP ${res.status} -> ${redirectLocation}`, `from=${targetUrl}`);
      const redirected = await this.fetchWithRedirects(
        redirectLocation,
        config,
        {
          method: 'GET',
          headers: {
            Referer: refererUrl || config.baseUrl,
            Range: `bytes=${slice[0]}-${slice[1]}`,
            ...(ifRangeValidator ? { 'If-Range': ifRangeValidator } : {}),
          },
        },
        signal,
        log,
        6,
        timeoutMs,
      );
      if (isThrottleErrorPageUrl(redirected.finalUrl)) {
        await redirected.response.body?.cancel().catch(() => undefined);
        const inferredStatus = inferThrottleStatusFromUrl(redirected.finalUrl);
        const cooldownMs = this.rateLimiter.recordThrottle(undefined, redirected.latencyMs);
        throw new RangeThrottleError(inferredStatus, cooldownMs, undefined, safeHostname(redirected.finalUrl));
      }
      return redirected;
    }

    this.rateLimiter.recordSuccess(latency);
    return { response: res, finalUrl: targetUrl, latencyMs: latency };
  }

  async downloadFileAtomic(
    release: DiscoveredRelease,
    config: ScraperConfigInternal,
    signal: AbortSignal,
    onProgress: (p: DownloadProgress) => void,
    log?: LoggerFn,
  ): Promise<{
    outcome: 'downloaded' | 'skipped';
    localPath: string;
    remotePath: string;
    filename: string;
    bytes: number;
  }> {
    // 1. Pre-request filename deduplication check at mirrored local path
    const expectedLocalPath = path.resolve(config.downloadDir, release.remotePath);
    if (fs.existsSync(expectedLocalPath)) {
      const stat = fs.statSync(expectedLocalPath);
      if (stat.size > 0) {
        log?.('debug', `[Download] Deduplicated existing archive before request: ${release.remotePath}`, `${stat.size} bytes at "${expectedLocalPath}"`);
        return {
          outcome: 'skipped',
          localPath: expectedLocalPath,
          remotePath: release.remotePath,
          filename: path.basename(expectedLocalPath),
          bytes: stat.size,
        };
      }
    }

    // Decouple binary archive transfer timeout from short API/page requestTimeoutMs
    const streamTimeoutMs = Math.min(600_000, Math.max(config.requestTimeoutMs * 6, 180_000));
    const maxStreamAttempts = Math.min(4, Math.max(1, (config.maxRetries ?? 2) + 1));
    const configuredChunkConcurrency = Math.max(1, Math.min(4, Math.round(config.downloadChunkConcurrency ?? 3)));
    const chunkThresholdBytes = Math.max(4, Math.min(64, Math.round(config.downloadChunkMinSizeMb ?? 8))) * 1024 * 1024;
    let effectiveChunks = this.getEffectiveHostChunkConcurrency(release.downloadUrl, configuredChunkConcurrency);
    let disableResumeForFreshRestart = false;

    for (let streamAttempt = 1; streamAttempt <= maxStreamAttempts; streamAttempt += 1) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let partPath: string | null = null;
      let keepPartialOnError = false;

      try {
        const expectedPartPath = `${expectedLocalPath}.part`;
        const preExistingMeta = disableResumeForFreshRestart
          ? null
          : loadPartialTransferMeta(expectedPartPath);
        disableResumeForFreshRestart = false;

        let initialRangeHeader: string | null = null;
        let initialIfRangeHeader: string | null = null;

        if (preExistingMeta && preExistingMeta.totalBytes && preExistingMeta.totalBytes > 0) {
          const missing = findMissingByteRanges(preExistingMeta.totalBytes, preExistingMeta.completedRanges);
          if (missing.length === 0) {
            const partStat = fs.statSync(expectedPartPath);
            if (partStat.size === preExistingMeta.totalBytes) {
              await fs.promises.rename(expectedPartPath, expectedLocalPath);
              await removePartialTransferFiles(expectedPartPath, { keepPartial: true });
              return {
                outcome: 'downloaded',
                localPath: expectedLocalPath,
                remotePath: release.remotePath,
                filename: path.basename(expectedLocalPath),
                bytes: partStat.size,
              };
            }
          } else {
            const firstMissing = missing[0]!;
            const probeEnd =
              effectiveChunks > 1
                ? Math.min(firstMissing[1], firstMissing[0] + chunkThresholdBytes - 1)
                : firstMissing[1];
            initialRangeHeader = `bytes=${firstMissing[0]}-${probeEnd}`;
            initialIfRangeHeader = pickIfRangeValidator(preExistingMeta);
          }
        } else if (effectiveChunks > 1) {
          initialRangeHeader = `bytes=0-${chunkThresholdBytes - 1}`;
        }

        log?.(
          'debug',
          `[Download] Starting transfer attempt ${streamAttempt}/${maxStreamAttempts} for "${release.filename}"`,
          `url=${release.downloadUrl}, chunks=${effectiveChunks}${effectiveChunks < configuredChunkConcurrency ? ` (mirror-capped from ${configuredChunkConcurrency})` : ''}, thresholdMb=${Math.round(chunkThresholdBytes / (1024 * 1024))}, initialRange=${initialRangeHeader ?? 'none'}`,
        );

        const requestHeaders: Record<string, string> = {
          Referer: release.pageUrl || config.baseUrl,
        };
        if (initialRangeHeader) {
          requestHeaders.Range = initialRangeHeader;
          if (initialIfRangeHeader) {
            requestHeaders['If-Range'] = initialIfRangeHeader;
          }
        }

        const { response, finalUrl } = await this.fetchWithRedirects(
          release.downloadUrl,
          config,
          {
            method: 'GET',
            headers: requestHeaders,
          },
          signal,
          log,
          8,
          streamTimeoutMs,
        );

        // Stale resume range (e.g. remote file shrunk): discard .part and restart cleanly
        if (response.status === 416 && initialRangeHeader) {
          await response.body?.cancel().catch(() => undefined);
          await removePartialTransferFiles(expectedPartPath);
          disableResumeForFreshRestart = true;
          log?.('warn', `Resume offset rejected (HTTP 416) for ${release.filename}; restarting cleanly from byte 0`);
          continue;
        }

        if (!response.ok) {
          const bodySnippet = await response.text().catch(() => '');
          log?.(
            'debug',
            `[Download] Non-OK HTTP ${response.status} for "${release.filename}"`,
            `finalUrl=${finalUrl}, body=${bodySnippet.replace(/\s+/g, ' ').trim().slice(0, 180)}`,
          );
          if (this.isCloudflareChallenge(response.status, response.headers, bodySnippet)) {
            const msg = `Blocked by Cloudflare bot protection (HTTP ${response.status}) downloading ${release.downloadUrl}`;
            this.setAuthState({
              configured: Boolean(config.username && config.password),
              authenticated: false,
              cookieCount: this.getSafeCookieCount(config.baseUrl),
              lastMessage: msg,
            });
            throw new Error(msg);
          }
          if (response.status === 401 || response.status === 403) {
            this.setAuthState({
              configured: Boolean(config.username && config.password),
              authenticated: false,
              cookieCount: this.getSafeCookieCount(config.baseUrl),
              lastMessage: `Download access denied (HTTP ${response.status}) at ${finalUrl}`,
            });
          }
          throw new Error(`HTTP ${response.status} downloading ${release.downloadUrl}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html') && !contentType.includes('octet-stream')) {
          const htmlSnippet = await response.text().catch(() => '');
          log?.(
            'debug',
            `[Download] Received HTML instead of archive binary for "${release.filename}"`,
            `status=${response.status}, finalUrl=${finalUrl}, contentType=${contentType}, snippet=${htmlSnippet.replace(/\s+/g, ' ').trim().slice(0, 180)}`,
          );
          if (isThrottleErrorPageUrl(finalUrl) || isHtmlThrottleBody(htmlSnippet)) {
            const inferredStatus = inferThrottleStatusFromUrl(finalUrl);
            const retryAfterSec = parseRetryAfter(response.headers.get('retry-after'));
            const cooldownMs = this.rateLimiter.recordThrottle(retryAfterSec, 0);
            effectiveChunks = 1;
            this.recordHostChunkCap(finalUrl, 1);
            if (fs.existsSync(expectedPartPath)) {
              partPath = expectedPartPath;
              keepPartialOnError = true;
            }
            throw new RangeThrottleError(inferredStatus, cooldownMs, retryAfterSec, safeHostname(finalUrl));
          }
          if (
            finalUrl.includes('/login') ||
            finalUrl.includes('wp-login.php') ||
            /type=['"]password['"]|must be logged in|please log in/i.test(htmlSnippet.slice(0, 4000))
          ) {
            this.setAuthState({
              configured: Boolean(config.username && config.password),
              authenticated: false,
              cookieCount: this.getSafeCookieCount(config.baseUrl),
              lastMessage: `Session expired while downloading (${finalUrl})`,
            });
          }
          if (fs.existsSync(expectedPartPath)) {
            partPath = expectedPartPath;
            keepPartialOnError = true;
          }
          throw new Error(`Expected archive binary but received HTML (${finalUrl}); session or nonce may have expired`);
        }

        // 2. Resolve exact filename from Content-Disposition or query param/path
        const rawDisposition = response.headers.get('content-disposition');
        const headerFilename = parseContentDispositionFilename(rawDisposition);
        const finalFilename = headerFilename
          ? sanitizePathSegment(headerFilename)
          : release.filename;

        const dirRel = path.dirname(release.remotePath);
        const finalRemotePath = dirRel === '.' ? finalFilename : `${dirRel}/${finalFilename}`;
        const resolvedRoot = path.resolve(config.downloadDir);
        const finalLocalPath = path.resolve(resolvedRoot, finalRemotePath);

        if (!finalLocalPath.startsWith(resolvedRoot + path.sep)) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`Resolved download path escapes root: ${finalRemotePath}`);
        }

        // 3. Filename-only deduplication after Content-Disposition resolution
        if (fs.existsSync(finalLocalPath)) {
          const stat = fs.statSync(finalLocalPath);
          if (stat.size > 0) {
            await response.body?.cancel().catch(() => undefined);
            await removePartialTransferFiles(`${finalLocalPath}.part`);
            log?.('debug', `[Download] Deduplicated existing archive after Content-Disposition: ${finalRemotePath}`, `${stat.size} bytes`);
            return {
              outcome: 'skipped',
              localPath: finalLocalPath,
              remotePath: finalRemotePath,
              filename: finalFilename,
              bytes: stat.size,
            };
          }
        }

        // 4. Prepare .part path & inspect Range / resume capabilities
        const targetDir = path.dirname(finalLocalPath);
        try {
          fs.mkdirSync(targetDir, { recursive: true });
        } catch (mkdirErr) {
          log?.('debug', `[Download] Failed creating target directory "${targetDir}"`, formatErrorDetails(mkdirErr));
          throw mkdirErr;
        }
        const activePartPath = `${finalLocalPath}.part`;
        partPath = activePartPath;

        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');
        const acceptRanges = (response.headers.get('accept-ranges') || '').toLowerCase();
        const contentRange = response.status === 206
          ? parseContentRange(response.headers.get('content-range'))
          : null;

        // If Content-Disposition resolved to a different filename, load that path's sidecar if present
        const savedMeta = loadPartialTransferMeta(activePartPath);
        let isResuming = false;
        if (response.status === 206 && contentRange && savedMeta) {
          const validatorOk = isValidatorCompatibleForResume(savedMeta, {
            etag,
            lastModified,
            totalBytes: contentRange.total,
          });
          const expectedResumeMissing = savedMeta.totalBytes
            ? findMissingByteRanges(savedMeta.totalBytes, savedMeta.completedRanges)
            : [];
          const matchesMissingStart = expectedResumeMissing.some(
            ([ms]) => ms === contentRange.start,
          );
          if (validatorOk && matchesMissingStart) {
            isResuming = true;
          } else {
            // Upstream asset changed or wrong offset: discard stale .part and restart cleanly
            await response.body?.cancel().catch(() => undefined);
            await removePartialTransferFiles(activePartPath);
            disableResumeForFreshRestart = true;
            log?.('info', `Remote archive validator changed for ${finalFilename}; restarting transfer cleanly`);
            continue;
          }
        }

        if (!response.body) {
          throw new Error(`Empty response stream for ${release.downloadUrl}`);
        }

        const meter = new RollingThroughputMeter();
        const startedAt = Date.now();

        // Determine single-stream vs Range-capable multi-chunk mode
        if (response.status === 206 && contentRange && contentRange.total !== null && contentRange.total > 0) {
          const totalBytes = contentRange.total;
          const priorCompletedRanges: ByteRange[] = isResuming && savedMeta ? savedMeta.completedRanges : [];
          let committedRanges: ByteRange[] = mergeByteRanges(priorCompletedRanges);
          const inFlightWritten = new Map<number, [number, number]>();
          let activeWorkersCount = 1;
          effectiveChunks = this.getEffectiveHostChunkConcurrency(finalUrl, effectiveChunks);
          let lastEmitAt = 0;
          let lastMetaFlushBytes = 0;

          const metaState: PartialTransferMeta = {
            version: 1,
            finalUrl,
            etag: etag ?? savedMeta?.etag ?? null,
            lastModified: lastModified ?? savedMeta?.lastModified ?? null,
            totalBytes,
            completedRanges: committedRanges,
            updatedAt: new Date().toISOString(),
          };

          const computeReceivedBytes = (): number => {
            const combined: ByteRange[] = [...committedRanges];
            for (const pair of inFlightWritten.values()) {
              combined.push(pair);
            }
            return Math.min(totalBytes, sumByteRanges(combined));
          };

          const emitProgressThrottled = (force = false) => {
            const now = Date.now();
            if (!force && now - lastEmitAt < 180) return;
            lastEmitAt = now;
            onProgress({
              bytesReceived: computeReceivedBytes(),
              totalBytes,
              bytesPerSec: meter.getBytesPerSec(),
              activeChunks: activeWorkersCount,
              resumed: isResuming,
            });
          };

          let fileHandle: fs.promises.FileHandle;
          if (isResuming && fs.existsSync(activePartPath)) {
            fileHandle = await fs.promises.open(activePartPath, 'r+');
            const st = await fileHandle.stat();
            if (st.size !== totalBytes) {
              await fileHandle.truncate(totalBytes);
            }
          } else {
            await removePartialTransferFiles(activePartPath);
            fileHandle = await fs.promises.open(activePartPath, 'w+');
            await fileHandle.truncate(totalBytes);
          }

          let metaFlushChain: Promise<void> = Promise.resolve();
          const flushMeta = (sync = false) => {
            const snapshotRanges: ByteRange[] = [...committedRanges];
            for (const pair of inFlightWritten.values()) {
              snapshotRanges.push(pair);
            }
            committedRanges = mergeByteRanges(snapshotRanges);
            metaState.completedRanges = committedRanges;
            metaFlushChain = metaFlushChain.then(async () => {
              if (sync) {
                await fileHandle.sync().catch(() => undefined);
              }
              await savePartialTransferMeta(activePartPath, metaState);
            });
            return metaFlushChain;
          };

          if (!isResuming) {
            await savePartialTransferMeta(activePartPath, metaState);
          }
          keepPartialOnError = true;

          const commitSliceProgress = (workerId: number, sliceStart: number, writtenInSlice: number, delta: number) => {
            if (writtenInSlice > 0) {
              inFlightWritten.set(workerId, [sliceStart, sliceStart + writtenInSlice - 1]);
            }
            meter.recordBytes(delta);
            lastMetaFlushBytes += delta;
            if (lastMetaFlushBytes >= 2 * 1024 * 1024) {
              lastMetaFlushBytes = 0;
              void flushMeta(false);
            }
            emitProgressThrottled(false);
          };

          const finalizeSlice = (workerId: number, sliceStart: number, writtenInSlice: number) => {
            inFlightWritten.delete(workerId);
            if (writtenInSlice > 0) {
              committedRanges = mergeByteRanges([
                ...committedRanges,
                [sliceStart, sliceStart + writtenInSlice - 1],
              ]);
            }
          };

          try {
            let firstResponseConsumed = false;
            let currentWaveThrottleRetries = 0;
            const maxWaveThrottleRetries = Math.max(2, config.maxRetries + 1);

            while (true) {
              const allMissing = findMissingByteRanges(totalBytes, committedRanges);
              if (allMissing.length === 0) {
                break;
              }

              const { controller: waveController, dispose: disposeWave } = createLinkedAbortController(signal);
              let waveThrottleError: RangeThrottleError | null = null;
              let firstWaveError: unknown = null;

              const initialSlice: ByteRange | null = !firstResponseConsumed
                ? [contentRange.start, contentRange.end]
                : null;

              // Exclude the initial in-flight 206 probe slice from sibling work queue
              const remainingRangesForQueue = initialSlice
                ? findMissingByteRanges(totalBytes, mergeByteRanges([...committedRanges, initialSlice]))
                : allMissing;

              const canFanOut =
                effectiveChunks > 1 &&
                (initialSlice === null || totalBytes >= chunkThresholdBytes) &&
                remainingRangesForQueue.length > 0;

              const minSliceBytes = Math.max(2 * 1024 * 1024, Math.floor(chunkThresholdBytes / 2));
              const totalQueueBytes = sumByteRanges(remainingRangesForQueue);
              const queueBudget = Math.max(1, effectiveChunks - (initialSlice ? 1 : 0));
              const queueWorkerCount = canFanOut
                ? Math.min(queueBudget, Math.max(1, Math.ceil(totalQueueBytes / minSliceBytes)))
                : 1;

              const sliceQueue = remainingRangesForQueue.length > 0
                ? splitMissingRangesIntoSlices(
                    remainingRangesForQueue,
                    minSliceBytes,
                    queueWorkerCount,
                  )
                : [];

              activeWorkersCount = canFanOut
                ? Math.min(effectiveChunks, sliceQueue.length + (initialSlice ? 1 : 0))
                : 1;

              if (isResuming || activeWorkersCount > 1) {
                log?.(
                  'debug',
                  `[Download] Transfer "${finalFilename}" wave active`,
                  `totalBytes=${totalBytes}, resumedBytes=${sumByteRanges(committedRanges)}, workers=${activeWorkersCount}, queuedSlices=${sliceQueue.length}`,
                );
              }
              emitProgressThrottled(true);

              const runRangeSlice = async (
                workerId: number,
                slice: ByteRange,
                preloadedBody?: ReadableStream<Uint8Array>,
              ) => {
                const expectedLen = slice[1] - slice[0] + 1;
                let sliceWritten = 0;

                if (preloadedBody) {
                  try {
                    sliceWritten = await streamResponseToFileOffset(
                      preloadedBody,
                      fileHandle,
                      slice[0],
                      expectedLen,
                      waveController.signal,
                      (delta, totalWritten) => {
                        commitSliceProgress(workerId, slice[0], totalWritten, delta);
                      },
                    );
                    finalizeSlice(workerId, slice[0], sliceWritten);
                    if (sliceWritten < expectedLen) {
                      throw new Error(`Unexpected EOF in range ${slice[0]}-${slice[1]} (${sliceWritten}/${expectedLen} bytes)`);
                    }
                  } catch (err) {
                    finalizeSlice(workerId, slice[0], sliceWritten);
                    throw err;
                  }
                  return;
                }

                const ifRangeVal = pickIfRangeValidator(metaState);
                const { response: sliceRes, finalUrl: sliceFinalUrl, latencyMs: sliceLatency } = await this.fetchRangeSlice(
                  finalUrl,
                  release.pageUrl || config.baseUrl,
                  slice,
                  ifRangeVal,
                  config,
                  waveController.signal,
                  streamTimeoutMs,
                  log,
                );

                const sliceContentType = (sliceRes.headers.get('content-type') || '').toLowerCase();
                if (sliceContentType.includes('text/html') && !sliceContentType.includes('octet-stream')) {
                  const htmlSnippet = await sliceRes.text().catch(() => '');
                  log?.(
                    'debug',
                    `[Download] Slice ${slice[0]}-${slice[1]} received HTML instead of binary`,
                    `status=${sliceRes.status}, finalUrl=${sliceFinalUrl}, snippet=${htmlSnippet.replace(/\s+/g, ' ').trim().slice(0, 160)}`,
                  );
                  if (isThrottleErrorPageUrl(sliceFinalUrl) || isHtmlThrottleBody(htmlSnippet)) {
                    const inferredStatus = inferThrottleStatusFromUrl(sliceFinalUrl);
                    const retryAfterSec = parseRetryAfter(sliceRes.headers.get('retry-after'));
                    const cooldownMs = this.rateLimiter.recordThrottle(retryAfterSec, sliceLatency);
                    throw new RangeThrottleError(inferredStatus, cooldownMs, retryAfterSec, safeHostname(sliceFinalUrl));
                  }
                  throw new Error(`Expected archive binary on range slice but received HTML (${sliceFinalUrl}); session or nonce may have expired`);
                }

                if (sliceRes.status === 200) {
                  await sliceRes.body?.cancel().catch(() => undefined);
                  effectiveChunks = 1;
                  this.recordHostChunkCap(finalUrl, 1);
                  throw new Error(`Range request downgraded to HTTP 200 (If-Range mismatch or unsupported)`);
                }
                if (!sliceRes.ok || !sliceRes.body) {
                  await sliceRes.body?.cancel().catch(() => undefined);
                  throw new Error(`HTTP ${sliceRes.status} on byte range ${slice[0]}-${slice[1]}`);
                }

                const sliceCr = parseContentRange(sliceRes.headers.get('content-range'));
                if (!sliceCr || sliceCr.start !== slice[0] || (sliceCr.total !== null && sliceCr.total !== totalBytes)) {
                  await sliceRes.body.cancel().catch(() => undefined);
                  throw new Error(`Mismatched Content-Range for slice ${slice[0]}-${slice[1]}`);
                }

                const effectiveExpectedLen = Math.min(expectedLen, sliceCr.end - sliceCr.start + 1);
                try {
                  sliceWritten = await streamResponseToFileOffset(
                    sliceRes.body,
                    fileHandle,
                    slice[0],
                    effectiveExpectedLen,
                    waveController.signal,
                    (delta, totalWritten) => {
                      commitSliceProgress(workerId, slice[0], totalWritten, delta);
                    },
                  );
                  finalizeSlice(workerId, slice[0], sliceWritten);
                  if (sliceWritten < effectiveExpectedLen) {
                    throw new Error(`Unexpected EOF in range ${slice[0]}-${slice[1]} (${sliceWritten}/${effectiveExpectedLen} bytes)`);
                  }
                } catch (err) {
                  finalizeSlice(workerId, slice[0], sliceWritten);
                  throw err;
                }
              };

              const spawnWorker = async (workerId: number, useInitialBody: boolean) => {
                try {
                  if (useInitialBody && initialSlice && !firstResponseConsumed) {
                    firstResponseConsumed = true;
                    await runRangeSlice(workerId, initialSlice, response.body!);
                  }
                  while (!waveController.signal.aborted) {
                    const nextSlice = sliceQueue.shift();
                    if (!nextSlice) break;
                    await runRangeSlice(workerId, nextSlice);
                  }
                } catch (err) {
                  if (err instanceof RangeThrottleError) {
                    if (!waveThrottleError) {
                      waveThrottleError = err;
                      waveController.abort(err);
                    }
                    return;
                  }
                  if (!waveController.signal.aborted && !firstWaveError) {
                    firstWaveError = err;
                    waveController.abort(err);
                  }
                }
              };

              const workers: Promise<void>[] = [];
              for (let w = 0; w < activeWorkersCount; w += 1) {
                workers.push(spawnWorker(w, w === 0 && initialSlice !== null && !firstResponseConsumed));
              }
              await Promise.all(workers);
              disposeWave();

              // Flush all partial progress before deciding next step
              await flushMeta(false);

              if (signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
              }

              if (waveThrottleError) {
                const throttleErr = waveThrottleError as RangeThrottleError;
                currentWaveThrottleRetries += 1;
                effectiveChunks = activeWorkersCount > 2 ? 2 : 1;
                this.recordHostChunkCap(finalUrl, effectiveChunks);
                this.recordHostChunkCap(release.downloadUrl, effectiveChunks);
                log?.(
                  'throttle',
                  `HTTP ${throttleErr.status} limit on chunk transfer for ${finalFilename}; pausing all chunks (${Math.round(throttleErr.cooldownMs / 1000)}s, stepping down to ${effectiveChunks}x)`,
                  `Wave throttle ${currentWaveThrottleRetries}/${maxWaveThrottleRetries}${throttleErr.retryAfterSec ? ` · Retry-After: ${throttleErr.retryAfterSec}s` : ''}`,
                );
                if (currentWaveThrottleRetries > maxWaveThrottleRetries) {
                  throw throttleErr;
                }
                await this.rateLimiter.waitForCooldown(signal);
                continue;
              }

              if (firstWaveError) {
                throw firstWaveError;
              }
            }

            await fileHandle.sync().catch(() => undefined);
            await fileHandle.close();

            await fs.promises.rename(activePartPath, finalLocalPath);
            await fs.promises.unlink(getPartialMetaPath(activePartPath)).catch(() => undefined);
            partPath = null;
            keepPartialOnError = false;

            onProgress({
              bytesReceived: totalBytes,
              totalBytes,
              bytesPerSec: meter.getBytesPerSec(),
              activeChunks: effectiveChunks,
              resumed: isResuming,
            });

            log?.(
              'debug',
              `[Download] Completed Range transfer "${finalLocalPath}" (${totalBytes} bytes in ${Date.now() - startedAt}ms, chunks=${effectiveChunks}, resumed=${isResuming})`,
            );

            return {
              outcome: 'downloaded',
              localPath: finalLocalPath,
              remotePath: finalRemotePath,
              filename: finalFilename,
              bytes: totalBytes,
            };
          } catch (rangeErr) {
            await flushMeta(false).catch(() => undefined);
            await fileHandle.close().catch(() => undefined);
            // If server downgraded a slice to 200 OK (upstream changed), wipe .part & retry cleanly
            if (rangeErr instanceof Error && /downgraded to HTTP 200/i.test(rangeErr.message)) {
              keepPartialOnError = false;
              disableResumeForFreshRestart = true;
            }
            throw rangeErr;
          }
        }

        // Single-stream fallback (200 OK, unknown total length, or Range unsupported)
        const totalBytesHeader = response.headers.get('content-length');
        const parsedLen = totalBytesHeader ? Number(totalBytesHeader) : NaN;
        const totalBytes = Number.isFinite(parsedLen) && parsedLen > 0 ? parsedLen : null;
        const canResumeLater = acceptRanges.includes('bytes') && totalBytes !== null;

        await removePartialTransferFiles(activePartPath);
        const fileHandle = await fs.promises.open(activePartPath, 'w+');
        keepPartialOnError = canResumeLater;

        let bytesReceived = 0;
        let lastEmitAt = 0;
        log?.(
          'debug',
          `[Download] Writing single stream to disk "${activePartPath}"`,
          `final="${finalLocalPath}", contentLength=${totalBytes ?? 'unknown'}, acceptRanges="${acceptRanges || 'none'}", contentType="${contentType || 'unset'}"`,
        );

        try {
          bytesReceived = await streamResponseToFileOffset(
            response.body,
            fileHandle,
            0,
            null,
            signal,
            (delta, totalWritten) => {
              bytesReceived = totalWritten;
              meter.recordBytes(delta);
              const now = Date.now();
              if (now - lastEmitAt >= 180) {
                lastEmitAt = now;
                onProgress({
                  bytesReceived,
                  totalBytes,
                  bytesPerSec: meter.getBytesPerSec(),
                  activeChunks: 1,
                  resumed: false,
                });
              }
            },
          );

          await fileHandle.sync().catch(() => undefined);
          await fileHandle.close();

          if (totalBytes !== null && bytesReceived > 0 && bytesReceived < totalBytes) {
            throw new Error(`Unexpected EOF for "${finalFilename}" after ${bytesReceived}/${totalBytes} bytes`);
          }

          await fs.promises.rename(activePartPath, finalLocalPath);
          await fs.promises.unlink(getPartialMetaPath(activePartPath)).catch(() => undefined);
          partPath = null;
          keepPartialOnError = false;

          onProgress({
            bytesReceived,
            totalBytes: totalBytes ?? bytesReceived,
            bytesPerSec: meter.getBytesPerSec(),
            activeChunks: 1,
            resumed: false,
          });

          log?.(
            'debug',
            `[Download] Completed atomic write "${finalLocalPath}" (${bytesReceived} bytes in ${Date.now() - startedAt}ms)`,
          );

          return {
            outcome: 'downloaded',
            localPath: finalLocalPath,
            remotePath: finalRemotePath,
            filename: finalFilename,
            bytes: bytesReceived,
          };
        } catch (streamErr) {
          await fileHandle.close().catch(() => undefined);
          if (canResumeLater && bytesReceived > 0 && totalBytes !== null) {
            await savePartialTransferMeta(activePartPath, {
              version: 1,
              finalUrl,
              etag,
              lastModified,
              totalBytes,
              completedRanges: [[0, bytesReceived - 1]],
              updatedAt: new Date().toISOString(),
            }).catch(() => undefined);
            keepPartialOnError = true;
          } else {
            keepPartialOnError = false;
          }
          throw streamErr;
        }
      } catch (err) {
        if (partPath && !keepPartialOnError) {
          await removePartialTransferFiles(partPath).catch((unlinkErr) => {
            log?.('debug', `[Download] Failed cleaning up partial file "${partPath}"`, formatErrorDetails(unlinkErr));
          });
        }
        if (signal.aborted) {
          throw err;
        }
        const canRetryStream =
          streamAttempt < maxStreamAttempts &&
          (this.isRetryableStreamError(err) ||
            err instanceof RangeThrottleError ||
            (err instanceof Error && /downgraded to HTTP 200/i.test(err.message)));
        log?.(
          'debug',
          `[Download] Stream attempt ${streamAttempt}/${maxStreamAttempts} caught error for "${release.filename}"`,
          `retryable=${canRetryStream}, keptPartial=${Boolean(partPath && keepPartialOnError)}, ${formatErrorDetails(err)}`,
        );
        if (!canRetryStream) {
          throw err;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.(
          'warn',
          `Stream interrupted for ${release.filename}; ${keepPartialOnError ? 'resuming' : 'retrying'} (${streamAttempt}/${maxStreamAttempts - 1})`,
          errMsg,
        );
        if (err instanceof RangeThrottleError) {
          await this.rateLimiter.waitForCooldown(signal);
        }
        const retryWaitMs = Math.min(2000, Math.max(100, config.minDelayMs) * streamAttempt);
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, retryWaitMs);
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
    }

    throw new Error(`Exceeded max stream retries for ${release.downloadUrl}`);
  }

  /**
   * Filters HTML-extracted top-level repo slugs against static non-system rules and live
   * WordPress `/wp-json/wp/v2/pages` entries so informational pages never appear as ROM consoles.
   */
  async filterLiveSystems(
    systems: Iterable<string>,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<string[]> {
    const valid = filterValidSystemSlugs(systems);
    if (valid.length === 0) return [];

    const wpStaticPageSlugs = new Set<string>();
    try {
      const pagesUrl = new URL(
        'wp-json/wp/v2/pages?per_page=100&_fields=slug',
        ensureTrailingSlash(config.baseUrl),
      ).toString();
      const { response } = await this.fetchWithRedirects(
        pagesUrl,
        config,
        { method: 'GET', headers: { Accept: 'application/json' } },
        signal,
        log,
      );
      if (response.ok) {
        const json = (await response.json()) as unknown;
        if (Array.isArray(json)) {
          for (const item of json) {
            if (item && typeof item === 'object' && 'slug' in item) {
              const slug = String((item as { slug?: unknown }).slug || '').trim().toLowerCase();
              if (slug) wpStaticPageSlugs.add(slug);
            }
          }
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }

    if (wpStaticPageSlugs.size === 0) {
      return valid;
    }

    const wpTypes = await this.getWpRestTypes(config, signal, log);
    return valid.filter((slug) => {
      const lower = slug.trim().toLowerCase();
      if (!wpStaticPageSlugs.has(lower)) return true;
      // Preserve if explicitly backed by a registered ROM Custom Post Type
      return (
        wpTypes.has(lower) ||
        wpTypes.has(lower.replace(/-/g, '_')) ||
        wpTypes.has(lower.replace(/_/g, '-'))
      );
    });
  }

  private async getWpRestTypes(
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<Map<string, string>> {
    const normalizedBase = config.baseUrl.trim().replace(/\/+$/, '');
    if (this.wpTypesCache && this.wpTypesCacheBaseUrl === normalizedBase) {
      return this.wpTypesCache;
    }
    const map = new Map<string, string>();
    const registerAlias = (alias: string, restBase: string) => {
      const clean = alias.trim().toLowerCase();
      if (!clean) return;
      if (!map.has(clean)) map.set(clean, restBase);
      const hyphenated = clean.replace(/_/g, '-');
      if (!map.has(hyphenated)) map.set(hyphenated, restBase);
      const underscored = clean.replace(/-/g, '_');
      if (!map.has(underscored)) map.set(underscored, restBase);
      for (const group of CANONICAL_SYSTEM_ALIAS_GROUPS) {
        if (group.includes(clean)) {
          for (const extra of group) {
            if (!map.has(extra)) map.set(extra, restBase);
          }
        }
      }
    };

    try {
      const typesUrl = new URL('wp-json/wp/v2/types', ensureTrailingSlash(config.baseUrl)).toString();
      const { response } = await this.fetchWithRedirects(
        typesUrl,
        config,
        { method: 'GET', headers: { Accept: 'application/json' } },
        signal,
        log,
      );
      if (response.ok) {
        const json = (await response.json()) as Record<string, { slug?: string; rest_base?: string }>;
        for (const [key, def] of Object.entries(json)) {
          if (def?.rest_base) {
            map.set(key.toLowerCase(), def.rest_base);
            map.set(def.rest_base.toLowerCase(), def.rest_base);
            if (def.slug) map.set(def.slug.toLowerCase(), def.rest_base);
            registerAlias(key, def.rest_base);
            registerAlias(def.rest_base, def.rest_base);
            if (def.slug) registerAlias(def.slug, def.rest_base);
          }
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }

    if (map.size > 0) {
      this.wpTypesCache = map;
      this.wpTypesCacheBaseUrl = normalizedBase;
    }
    return map;
  }

  async resolveWpRestBaseForSystem(
    systemSlug: string,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<string | null> {
    const cleanSlug = systemSlug.trim().toLowerCase();
    if (!cleanSlug) return null;

    const typeMap = await this.getWpRestTypes(config, signal, log);
    const direct =
      typeMap.get(cleanSlug) ||
      typeMap.get(cleanSlug.replace(/-/g, '_')) ||
      typeMap.get(cleanSlug.replace(/_/g, '-')) ||
      null;
    if (direct) return direct;

    // Fallback for any future RGT system whose permalink slug differs from its WP CPT slug:
    // inspect the archive HTML body/card classes (e.g. post-type-archive-gb_roms, type-gb_roms)
    // or alternate JSON link once and cache the mapping.
    try {
      const archiveUrl = new URL(`${encodeURIComponent(cleanSlug)}/`, ensureTrailingSlash(config.baseUrl)).toString();
      const page = await this.fetchPageHtml(archiveUrl, config, signal, log);
      if (page.status < 400 && page.html) {
        const altMatch = page.html.match(/wp-json\/wp\/v2\/([a-z0-9_-]+)/i);
        const bodyMatch = page.html.match(/post-type-archive-([a-z0-9_-]+)/i);
        const typeCardMatch = page.html.match(/\btype-([a-z0-9_-]+)\b/i);
        for (const candidate of [altMatch?.[1], bodyMatch?.[1], typeCardMatch?.[1]]) {
          if (!candidate) continue;
          const mapped = typeMap.get(candidate.toLowerCase());
          if (mapped && mapped !== 'pages' && mapped !== 'posts' && mapped !== 'media' && mapped !== 'blocks') {
            typeMap.set(cleanSlug, mapped);
            return mapped;
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }

    return null;
  }

  private parseWpPostObject(post: Record<string, unknown>, fallbackRestBase: string): WpPostMetadata | null {
    if (!post || typeof post !== 'object' || !post.id) return null;

    const acf = (post.acf && typeof post.acf === 'object' ? post.acf : {}) as Record<string, unknown>;
    const titleRendered =
      post.title && typeof post.title === 'object' && 'rendered' in post.title
        ? decodeHtmlEntities(String((post.title as { rendered?: string }).rendered || ''))
        : '';
    const acfGameName = typeof acf.game_name === 'string' ? acf.game_name.trim() : '';

    const genres = new Set<string>();
    const regions = new Set<string>();
    const languages = new Set<string>();
    const sources = new Set<string>();
    const formats = new Set<string>();
    const publishers = new Set<string>();
    const developers = new Set<string>();
    let releaseYear: string | null = null;

    const embedded = post._embedded as
      | {
          'wp:term'?: unknown[];
          'wp:featuredmedia'?: unknown[];
        }
      | undefined;
    const termGroups = Array.isArray(embedded?.['wp:term']) ? embedded!['wp:term']! : [];
    for (const group of termGroups) {
      if (!Array.isArray(group)) continue;
      for (const term of group) {
        if (!term || typeof term !== 'object') continue;
        const t = term as { taxonomy?: string; name?: string };
        const tax = String(t.taxonomy || '').toLowerCase();
        const name = decodeHtmlEntities(String(t.name || '').trim());
        if (!name) continue;
        if (tax === 'genre') genres.add(name);
        else if (tax === 'region') regions.add(name);
        else if (tax === 'language') languages.add(name);
        else if (tax === 'source') sources.add(name);
        else if (tax === 'format') formats.add(name);
        else if (tax === 'publisher') publishers.add(name);
        else if (tax === 'developer') developers.add(name);
        else if (tax === 'release-year' && !releaseYear) releaseYear = name;
      }
    }

    const extractWpMediaUrl = (val: unknown): string | null => {
      if (typeof val === 'string' && val.trim().startsWith('http')) {
        return val.trim();
      }
      if (val && typeof val === 'object') {
        const obj = val as {
          url?: unknown;
          source_url?: unknown;
          media_details?: { sizes?: { full?: { source_url?: unknown } } };
          sizes?: Record<string, unknown>;
        };
        const fullEmbedded = obj.media_details?.sizes?.full?.source_url;
        if (typeof fullEmbedded === 'string' && fullEmbedded.trim().startsWith('http')) {
          return fullEmbedded.trim();
        }
        if (typeof obj.url === 'string' && obj.url.trim().startsWith('http')) {
          return obj.url.trim();
        }
        if (typeof obj.source_url === 'string' && obj.source_url.trim().startsWith('http')) {
          return obj.source_url.trim();
        }
        if (obj.sizes && typeof obj.sizes === 'object' && typeof obj.sizes.full === 'string') {
          return obj.sizes.full.trim();
        }
      }
      return null;
    };

    let wpCoverUrl: string | null = null;
    if (Array.isArray(embedded?.['wp:featuredmedia']) && embedded!['wp:featuredmedia']!.length > 0) {
      wpCoverUrl = extractWpMediaUrl(embedded!['wp:featuredmedia']![0]);
    }
    if (!wpCoverUrl) {
      for (const key of ['cover', 'cover_art', 'cover_image', 'box_art', 'featured_image']) {
        wpCoverUrl = extractWpMediaUrl(acf[key]);
        if (wpCoverUrl) break;
      }
    }

    const wpScreenshotUrls: string[] = [];
    for (const key of ['screenshots', 'game_screenshots', 'screenshot_gallery', 'gallery', 'images', 'shots']) {
      const rawGallery = acf[key];
      if (!Array.isArray(rawGallery)) continue;
      for (const entry of rawGallery) {
        const direct = extractWpMediaUrl(entry);
        if (direct && !wpScreenshotUrls.includes(direct)) {
          wpScreenshotUrls.push(direct);
          continue;
        }
        if (entry && typeof entry === 'object') {
          const nested =
            extractWpMediaUrl((entry as Record<string, unknown>).image) ||
            extractWpMediaUrl((entry as Record<string, unknown>).screenshot) ||
            extractWpMediaUrl((entry as Record<string, unknown>).full_image);
          if (nested && !wpScreenshotUrls.includes(nested)) {
            wpScreenshotUrls.push(nested);
          }
        }
      }
    }

    const downloadHints: { filename: string; fileSize: string }[] = [];
    if (Array.isArray(acf.download_links)) {
      for (const entry of acf.download_links) {
        if (entry && typeof entry === 'object') {
          const e = entry as { file_name?: string; file_size?: string };
          if (e.file_name) {
            downloadHints.push({
              filename: String(e.file_name),
              fileSize: String(e.file_size || ''),
            });
          }
        }
      }
    }

    const contentRendered =
      post.content && typeof post.content === 'object' && 'rendered' in post.content
        ? String((post.content as { rendered?: string }).rendered || '')
        : '';

    const rawLink = typeof post.link === 'string' && post.link.trim() ? post.link.trim().split('#')[0] : null;
    const dateGmt = normalizeWpGmtIso(post.date_gmt) ?? normalizeIsoTimestamp(post.date);
    const modifiedGmt = normalizeWpGmtIso(post.modified_gmt) ?? normalizeIsoTimestamp(post.modified) ?? dateGmt;

    return {
      wpPostId: Number(post.id),
      wpPostType: String(post.type || fallbackRestBase),
      link: rawLink,
      dateGmt,
      modifiedGmt,
      title: acfGameName || titleRendered || null,
      originalTitle:
        typeof acf.original_title === 'string' && acf.original_title.trim() ? acf.original_title.trim() : null,
      publisher: publishers.size > 0 ? Array.from(publishers).join(', ') : null,
      developer: developers.size > 0 ? Array.from(developers).join(', ') : null,
      releaseYear,
      genres: Array.from(genres),
      regions: Array.from(regions),
      languages: Array.from(languages),
      sources: Array.from(sources),
      formats: Array.from(formats),
      descriptionHtml: contentRendered,
      coverUrl: wpCoverUrl,
      screenshotUrls: wpScreenshotUrls,
      downloadHints,
    };
  }

  /**
   * Lists releases for a console via RetroGameTalk's WordPress REST API (`wp-json/wp/v2/<rest_base>`).
   * Supports both uncapped Full Sync pagination and timestamp-gated Incremental Sync (`modified_after`).
   */
  async listConsoleReleasesViaWpRest(
    systemSlug: string,
    config: ScraperConfigInternal,
    options: {
      modifiedAfterIso?: string | null;
      signal?: AbortSignal;
      log?: LoggerFn;
      onPageFetched?: (page: number, totalPages: number) => void;
    } = {},
  ): Promise<{ supported: boolean; posts: WpPostMetadata[] }> {
    const { modifiedAfterIso, signal, log, onPageFetched } = options;
    const cleanSlug = systemSlug.trim().toLowerCase();
    if (!cleanSlug) return { supported: false, posts: [] };

    const restBase = await this.resolveWpRestBaseForSystem(cleanSlug, config, signal, log);

    // Built-in core types ('posts', 'pages', 'media') are not console CPTs unless explicitly requested
    if (!restBase || restBase === 'pages' || restBase === 'media' || restBase === 'blocks') {
      return { supported: false, posts: [] };
    }

    if (restBase.toLowerCase() !== cleanSlug) {
      log?.('info', `Resolved ${cleanSlug} -> WordPress post type "${restBase}"`);
    }

    const cutoffMs =
      modifiedAfterIso && !Number.isNaN(Date.parse(modifiedAfterIso)) ? Date.parse(modifiedAfterIso) : null;
    // Subtract 1s for WP's whole-second SQL date comparison, then enforce exact ms comparison in JS
    const wpAfterParam =
      cutoffMs !== null
        ? new Date(Math.max(0, cutoffMs - 1000)).toISOString().replace(/\.\d{3}Z$/, 'Z')
        : null;

    let useModifiedAfterParam = wpAfterParam !== null;
    let fallbackClientCutoffMode = false;
    let fallbackOrderBy: 'modified' | 'date' = 'modified';
    let reauthedOnce = false;

    const collected: WpPostMetadata[] = [];
    const seenIds = new Set<number>();
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      if (signal?.aborted) break;

      const params = new URLSearchParams({
        per_page: '100',
        _embed: '1',
        page: String(page),
      });
      if (useModifiedAfterParam && wpAfterParam) {
        params.set('modified_after', wpAfterParam);
      } else if (fallbackClientCutoffMode) {
        params.set('orderby', fallbackOrderBy);
        params.set('order', 'desc');
      }

      const endpoint = new URL(
        `wp-json/wp/v2/${encodeURIComponent(restBase)}?${params.toString()}`,
        ensureTrailingSlash(config.baseUrl),
      ).toString();

      const { response, finalUrl } = await this.fetchWithRedirects(
        endpoint,
        config,
        { method: 'GET', headers: { Accept: 'application/json' } },
        signal,
        log,
      );

      if (
        !reauthedOnce &&
        (response.status === 401 || finalUrl.includes('/login') || finalUrl.includes('wp-login.php')) &&
        config.username &&
        config.password
      ) {
        reauthedOnce = true;
        await response.body?.cancel().catch(() => undefined);
        const auth = await this.login(config, signal, log);
        if (!auth.authenticated) {
          throw new Error(`Re-authentication failed during WP REST scan: ${auth.message}`);
        }
        continue;
      }

      if (response.status === 400 && page === 1 && useModifiedAfterParam) {
        await response.body?.cancel().catch(() => undefined);
        log?.('debug', `[WP REST] "${restBase}" rejected modified_after parameter (HTTP 400); falling back to orderby=modified`);
        useModifiedAfterParam = false;
        fallbackClientCutoffMode = true;
        continue;
      }

      if (response.status === 400 && page === 1 && fallbackClientCutoffMode && fallbackOrderBy === 'modified') {
        await response.body?.cancel().catch(() => undefined);
        log?.('debug', `[WP REST] "${restBase}" rejected orderby=modified (HTTP 400); falling back to orderby=date`);
        fallbackOrderBy = 'date';
        continue;
      }

      if (response.status === 400 && page > 1) {
        await response.body?.cancel().catch(() => undefined);
        log?.('debug', `[WP REST] "${restBase}" reached pagination end at page ${page} (HTTP 400)`);
        break;
      }

      if (response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        if (page === 1) {
          log?.('debug', `[WP REST] "${restBase}" endpoint returned HTTP 404 on page 1; marking unsupported`);
          return { supported: false, posts: [] };
        }
        log?.('warn', `WP REST pagination for ${restBase} stopped early at page ${page}/${totalPages} (HTTP 404)`);
        break;
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        if (this.isCloudflareChallenge(response.status, response.headers, errBody)) {
          throw new Error(`Blocked by Cloudflare bot protection (HTTP ${response.status}) at ${finalUrl}`);
        }
        if (page === 1) {
          log?.('debug', `[WP REST] "${restBase}" returned HTTP ${response.status} on page 1; marking unsupported`, errBody.replace(/\s+/g, ' ').trim().slice(0, 140));
          return { supported: false, posts: [] };
        }
        log?.('warn', `WP REST pagination for ${restBase} stopped early at page ${page}/${totalPages} (HTTP ${response.status})`);
        break;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('json')) {
        await response.body?.cancel().catch(() => undefined);
        if (page === 1) {
          log?.('debug', `[WP REST] "${restBase}" returned non-JSON content-type "${contentType}" on page 1`);
          return { supported: false, posts: [] };
        }
        log?.('warn', `WP REST pagination for ${restBase} returned non-JSON at page ${page}/${totalPages}`);
        break;
      }

      const headerTotalPages = Number(response.headers.get('x-wp-totalpages') || '0');
      if (Number.isFinite(headerTotalPages) && headerTotalPages >= 1) {
        totalPages = headerTotalPages;
      }

      const rawList = (await response.json()) as unknown;
      onPageFetched?.(page, totalPages);

      if (!Array.isArray(rawList) || rawList.length === 0) {
        break;
      }

      let anyNewerOnThisPage = false;
      for (const entry of rawList) {
        if (!entry || typeof entry !== 'object') continue;
        const parsed = this.parseWpPostObject(entry as Record<string, unknown>, restBase);
        if (!parsed || seenIds.has(parsed.wpPostId)) continue;

        if (cutoffMs !== null) {
          const createdMs = parsed.dateGmt ? Date.parse(parsed.dateGmt) : NaN;
          const modifiedMs = parsed.modifiedGmt ? Date.parse(parsed.modifiedGmt) : NaN;
          const latestMs = Math.max(
            Number.isNaN(createdMs) ? -Infinity : createdMs,
            Number.isNaN(modifiedMs) ? -Infinity : modifiedMs,
          );
          if (!Number.isFinite(latestMs) || latestMs <= cutoffMs) {
            continue;
          }
          anyNewerOnThisPage = true;
        }

        seenIds.add(parsed.wpPostId);
        collected.push(parsed);
      }

      if (fallbackClientCutoffMode && cutoffMs !== null && fallbackOrderBy === 'modified' && !anyNewerOnThisPage) {
        break;
      }

      if (!response.headers.get('x-wp-totalpages')) {
        if (rawList.length < 100) {
          break;
        }
        totalPages = page + 1;
      }

      page += 1;
    }

    return { supported: true, posts: collected };
  }

  /**
   * Queries RetroGameTalk's WordPress REST API (`wp/v2/<postType>?slug=...&_embed`)
   * for authoritative taxonomies (genre, language, source, region, developer, publisher, format)
   * and ACF fields (`game_name`, `download_links`).
   */
  async fetchReleaseWpMetadata(
    pageUrl: string,
    wpPostIdHint: number | null | undefined,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<WpPostMetadata | null> {
    try {
      const base = new URL(config.baseUrl);
      const target = new URL(pageUrl);
      if (!isSameRootDomain(target.hostname, base.hostname)) return null;

      const baseSegs = base.pathname.split('/').filter(Boolean);
      const targetSegs = target.pathname.split('/').filter(Boolean);
      const relSegs = targetSegs.slice(
        baseSegs.every((s, i) => targetSegs[i]?.toLowerCase() === s.toLowerCase()) ? baseSegs.length : 0,
      );
      if (relSegs.length === 0) return null;

      const typeMap = await this.getWpRestTypes(config, signal, log);
      const systemSeg = relSegs[0].toLowerCase();
      const slug = relSegs[relSegs.length - 1];
      const restBase =
        typeMap.get(systemSeg) ||
        typeMap.get(systemSeg.replace(/-/g, '_')) ||
        typeMap.get(systemSeg.replace(/_/g, '-')) ||
        (relSegs.length === 1 ? 'pages' : null);
      if (!restBase) return null;

      const repoBase = ensureTrailingSlash(config.baseUrl);
      const endpoint =
        wpPostIdHint && wpPostIdHint > 0
          ? new URL(`wp-json/wp/v2/${encodeURIComponent(restBase)}/${wpPostIdHint}?_embed`, repoBase).toString()
          : new URL(
              `wp-json/wp/v2/${encodeURIComponent(restBase)}?slug=${encodeURIComponent(slug)}&_embed`,
              repoBase,
            ).toString();

      const { response } = await this.fetchWithRedirects(
        endpoint,
        config,
        { method: 'GET', headers: { Accept: 'application/json' } },
        signal,
        log,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        log?.('debug', `[WP REST] Metadata lookup failed (HTTP ${response.status}) for ${endpoint}`);
        return null;
      }

      const raw = (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
      const post = Array.isArray(raw) ? raw[0] : raw;
      if (!post || typeof post !== 'object' || !post.id) {
        log?.('debug', `[WP REST] Metadata lookup returned empty payload for ${endpoint}`);
        return null;
      }

      return this.parseWpPostObject(post, restBase);
    } catch (err) {
      if (signal?.aborted) throw err;
      log?.('debug', `[WP REST] Metadata lookup exception for ${pageUrl}`, formatErrorDetails(err));
      return null;
    }
  }

  private sanitizeDescriptionHtml(rawHtml: string): { descriptionHtml: string; descriptionText: string } {
    if (!rawHtml.trim()) return { descriptionHtml: '', descriptionText: '' };
    const $ = loadHtml(`<div id="__desc_root">${rawHtml}</div>`);
    const root = $('#__desc_root');
    root.find('h2').each((_, h2) => {
      if ($(h2).text().toLowerCase().includes('game description')) {
        $(h2).remove();
      }
    });
    root.find('script, style, iframe, object, embed, form, input, button').remove();
    root.find('*').each((_, node) => {
      const attribs = (node as unknown as { attribs?: Record<string, string> }).attribs;
      if (!attribs) return;
      for (const attr of Object.keys(attribs)) {
        const lower = attr.toLowerCase();
        if (lower.startsWith('on')) {
          $(node).removeAttr(attr);
        } else if (
          (lower === 'href' || lower === 'src') &&
          attribs[attr]?.trim().toLowerCase().startsWith('javascript:')
        ) {
          $(node).removeAttr(attr);
        }
      }
      if (node.tagName === 'a') {
        $(node).attr('target', '_blank');
        $(node).attr('rel', 'noopener noreferrer');
      }
    });

    return {
      descriptionHtml: (root.html() || '').trim(),
      descriptionText: root.text().replace(/\s+/g, ' ').trim(),
    };
  }

  extractWpPostIdHint(html: string): number | null {
    const $ = loadHtml(html);
    const acfId = Number($('#acf-content-wrapper[data-id]').first().attr('data-id'));
    if (Number.isInteger(acfId) && acfId > 0) return acfId;
    const dlcId = Number($('.dlc-button[data-id]').first().attr('data-id'));
    if (Number.isInteger(dlcId) && dlcId > 0) return dlcId;
    const bodyMatch = html.match(/\bpostid-(\d+)\b/);
    if (bodyMatch?.[1]) {
      const id = Number(bodyMatch[1]);
      if (Number.isInteger(id) && id > 0) return id;
    }
    return null;
  }

  /**
   * Extract structured metadata, cover art URL, full-res screenshot URLs, and sanitized description
   * from a RetroGameTalk release detail page, enriched with WP REST API taxonomies when available.
   */
  extractReleaseMetadata(
    html: string,
    pageUrl: string,
    wpData?: WpPostMetadata | null,
    fileRoles: string[] = [],
  ): ReleaseMetadata {
    const $ = loadHtml(html);

    const htmlTitle =
      $('.rgt-title-name').first().text().trim() ||
      $('h1.entry-title').first().text().trim() ||
      $('h1').first().text().trim();

    const title = wpData?.title || htmlTitle || 'Untitled Release';

    const subtitleRaw = $('.rgt-title-sub').first().text().replace(/\s+/g, ' ').trim();
    const subtitle = subtitleRaw || null;

    let publisher: string | null = wpData?.publisher || null;
    let releaseYear: string | null = wpData?.releaseYear || null;
    if (subtitle) {
      const parts = subtitle.split('·').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        if (!publisher) publisher = parts[0] || null;
        if (!releaseYear && /^\d{4}$/.test(parts[parts.length - 1])) {
          releaseYear = parts[parts.length - 1];
        }
      } else if (parts.length === 1) {
        if (!releaseYear && /^\d{4}$/.test(parts[0])) releaseYear = parts[0];
        else if (!publisher) publisher = parts[0];
      }
    }

    let downloadsCount: string | null = null;
    let releasedAgo: string | null = null;
    let updatedDate: string | null = null;
    $('.rgt-title-stats > div').each((_, div) => {
      const label = $(div).find('dt').first().text().trim().toLowerCase();
      const val = $(div).find('dd').first().text().replace(/\s+/g, ' ').trim();
      if (!val) return;
      if (label.includes('download')) downloadsCount = val;
      else if (label.includes('release')) releasedAgo = val;
      else if (label.includes('update')) updatedDate = val;
    });

    const specs: { label: string; value: string }[] = [];
    let consoleName: string | null = null;
    let genres: string[] = [...(wpData?.genres || [])];
    let regions: string[] = [...(wpData?.regions || [])];
    let languages: string[] = [...(wpData?.languages || [])];
    let sources: string[] = [...(wpData?.sources || [])];
    let formats: string[] = [...(wpData?.formats || [])];
    let developer: string | null = wpData?.developer || null;

    $('table.rom-info tbody tr').each((_, tr) => {
      const label = $(tr).find('th').first().text().replace(/\s+/g, ' ').trim();
      const td = $(tr).find('td').first();
      const value = td.text().replace(/\s+/g, ' ').trim();
      if (!label || !value) return;
      specs.push({ label, value });

      const linkValues = td
        .find('a')
        .map((__, a) => $(a).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean);
      const splitValues =
        linkValues.length > 0
          ? linkValues
          : value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);

      const lower = label.toLowerCase();
      if (lower.includes('console') || lower.includes('platform') || lower.includes('system')) {
        consoleName = value;
      } else if (lower.includes('genre')) {
        genres = Array.from(new Set([...genres, ...splitValues]));
      } else if (lower.includes('region')) {
        regions = Array.from(new Set([...regions, ...splitValues]));
      } else if (lower.includes('language')) {
        languages = Array.from(new Set([...languages, ...splitValues]));
      } else if (lower.includes('source')) {
        sources = Array.from(new Set([...sources, ...splitValues]));
      } else if (lower.includes('format')) {
        formats = Array.from(new Set([...formats, ...splitValues]));
      } else if (lower.includes('developer') && !developer) {
        developer = value;
      } else if (lower.includes('publisher') && !publisher) {
        publisher = value;
      } else if ((lower === 'year' || lower.includes('release year')) && !releaseYear) {
        releaseYear = value;
      }
    });

    // Cover art URL (prioritize full-res zoom links, WP featured media, largest srcset, and unresized originals)
    const rawCoverUrls: (string | null | undefined)[] = [];
    if (wpData?.coverUrl) rawCoverUrls.push(wpData.coverUrl);

    const coverZoomHref = $('.rgt-cover a.rgt-cover-zoom, .rgt-cover a[href]').first().attr('href');
    if (isLikelyImageAssetUrl(coverZoomHref, pageUrl)) {
      rawCoverUrls.push(coverZoomHref);
    }
    const coverDataSrc = $('.rgt-cover [data-src]').first().attr('data-src');
    if (coverDataSrc) rawCoverUrls.push(coverDataSrc);

    const coverImg = $(
      '.rgt-cover img, .post-thumbnail img, article.rgt-game img.wp-post-image',
    ).first();
    if (coverImg.length) {
      rawCoverUrls.push(
        coverImg.attr('data-orig-file'),
        coverImg.attr('data-full-url'),
        coverImg.attr('data-large_image'),
        coverImg.attr('data-zoom-image'),
      );
      rawCoverUrls.push(
        ...parseSrcsetCandidates(coverImg.attr('data-srcset') || coverImg.attr('srcset'), pageUrl),
      );
      rawCoverUrls.push(
        coverImg.attr('data-src'),
        coverImg.attr('data-lazy-src'),
        coverImg.attr('data-original'),
        coverImg.attr('src'),
      );
    }
    const coverCandidates = expandFullResImageCandidates(rawCoverUrls, pageUrl);
    const coverUrl: string | null = coverCandidates[0] ?? null;

    // Full-resolution screenshot URLs
    const screenshotByCanonicalKey = new Map<string, string[]>();
    const addScreenshotCandidates = (rawList: (string | null | undefined)[]) => {
      const expanded = expandFullResImageCandidates(rawList, pageUrl);
      if (expanded.length === 0) return;
      const key = canonicalImageAssetKey(expanded[0]);
      const existing = screenshotByCanonicalKey.get(key);
      if (!existing) {
        screenshotByCanonicalKey.set(key, expanded);
      } else {
        for (const u of expanded) {
          if (!existing.includes(u)) existing.push(u);
        }
      }
    };

    if (wpData?.screenshotUrls?.length) {
      for (const wpShot of wpData.screenshotUrls) {
        addScreenshotCandidates([wpShot]);
      }
    }

    const gallerySelector =
      '#lightgallery, .rgt-shots, .rgt-screenshots, .game-screenshots, .screenshots-gallery, article.rgt-game .gallery';
    const galleryRoots = $(gallerySelector);

    const collectFromImgElement = (imgEl: Parameters<typeof $>[0]) => {
      const $img = $(imgEl);
      const rawShotUrls: (string | null | undefined)[] = [
        $img.attr('data-orig-file'),
        $img.attr('data-full-url'),
        $img.attr('data-large_image'),
        $img.attr('data-zoom-image'),
      ];

      // Check enclosing <a href="..."> (e.g. <a href="FULL"><div class="game-box-layout"><img src="THUMB"></div></a>)
      const enclosingHref = $img.closest('a[href]').attr('href');
      if (isLikelyImageAssetUrl(enclosingHref, pageUrl)) {
        rawShotUrls.push(enclosingHref);
      }

      // Check sibling/descendant <a href="..."> inside the same card/figure
      const cardContainer = $img.closest('.game-box-layout, figure, .gallery-item, .lg-item');
      if (cardContainer.length) {
        const innerHref = cardContainer.find('a[itemprop="screenshot"], a[href]').first().attr('href');
        if (isLikelyImageAssetUrl(innerHref, pageUrl)) {
          rawShotUrls.push(innerHref);
        }
      }

      // Walk ancestors up to (but not including) the gallery root for LightGallery slide data-src
      let cursor = $img.parent();
      let depth = 0;
      while (cursor.length && depth < 6 && !cursor.is(gallerySelector) && !cursor.is('body, html')) {
        for (const attrName of ['data-src', 'data-large', 'data-full', 'data-url']) {
          const val = cursor.attr(attrName);
          if (val) rawShotUrls.push(val);
        }
        cursor = cursor.parent();
        depth += 1;
      }

      // Parse <picture><source srcset> and <img srcset / data-srcset> sorted largest-first
      const pictureEl = $img.closest('picture');
      if (pictureEl.length) {
        pictureEl.find('source').each((__, srcNode) => {
          rawShotUrls.push(
            ...parseSrcsetCandidates($(srcNode).attr('data-srcset') || $(srcNode).attr('srcset'), pageUrl),
          );
        });
      }
      rawShotUrls.push(
        ...parseSrcsetCandidates($img.attr('data-srcset') || $img.attr('srcset'), pageUrl),
      );

      rawShotUrls.push(
        $img.attr('data-src'),
        $img.attr('data-lazy-src'),
        $img.attr('data-original'),
        $img.attr('src'),
      );

      addScreenshotCandidates(rawShotUrls);
    };

    if (galleryRoots.length > 0) {
      galleryRoots.find('img').each((_, imgEl) => {
        collectFromImgElement(imgEl);
      });

      // Also catch LightGallery / anchor items that use CSS background-image without an <img> tag
      galleryRoots.find('[data-src], a[href]').each((_, el) => {
        const $el = $(el);
        if ($el.is(gallerySelector) || $el.find('img').length > 0) return;
        const rawDataSrc = $el.attr('data-src');
        const rawHref = $el.attr('href');
        const candidates: (string | null | undefined)[] = [];
        if (rawDataSrc) candidates.push(rawDataSrc);
        if (isLikelyImageAssetUrl(rawHref, pageUrl)) candidates.push(rawHref);
        if (candidates.length > 0) {
          addScreenshotCandidates(candidates);
        }
      });
    }

    if (screenshotByCanonicalKey.size === 0) {
      $('[itemprop="screenshot"]').each((_, el) => {
        const $el = $(el);
        if ($el.is('img')) {
          collectFromImgElement(el);
        } else {
          const innerImg = $el.find('img').first();
          if (innerImg.length) {
            collectFromImgElement(innerImg[0]);
          } else {
            const href = $el.attr('href') || $el.attr('content') || $el.attr('data-src');
            if (isLikelyImageAssetUrl(href, pageUrl)) {
              addScreenshotCandidates([href]);
            }
          }
        }
      });
    }

    const screenshotCandidates = Array.from(screenshotByCanonicalKey.values());
    const screenshotUrls = screenshotCandidates.map((cands) => cands[0]);

    // Description HTML sanitization (prefer HTML #custom-description, fallback to WP content.rendered)
    const descNode = $('#custom-description').first().length
      ? $('#custom-description').first()
      : $('.game-description').first();
    const rawDescHtml = (descNode.length ? descNode.html() : '') || wpData?.descriptionHtml || '';
    const { descriptionHtml, descriptionText } = this.sanitizeDescriptionHtml(rawDescHtml);

    const htmlPublishedRaw =
      $('meta[property="article:published_time"]').attr('content') ||
      $('time[datetime]').first().attr('datetime') ||
      null;
    const htmlModifiedRaw =
      $('meta[property="article:modified_time"]').attr('content') ||
      $('time[datetime][data-modified]').first().attr('data-modified') ||
      null;

    const publishedAt = wpData?.dateGmt ?? normalizeIsoTimestamp(htmlPublishedRaw) ?? null;
    const remoteUpdatedAt = wpData?.modifiedGmt ?? normalizeIsoTimestamp(htmlModifiedRaw) ?? publishedAt ?? null;

    const wpPostId = wpData?.wpPostId ?? this.extractWpPostIdHint(html);
    const releaseTags = deriveReleaseTags(
      { genres, languages, sources, systemName: consoleName },
      fileRoles,
    );

    return {
      wpPostId,
      wpPostType: wpData?.wpPostType ?? null,
      title,
      subtitle,
      consoleName,
      publisher,
      developer,
      releaseYear,
      genres,
      regions,
      languages,
      sources,
      formats,
      releaseTags,
      downloadsCount,
      releasedAgo,
      updatedDate,
      publishedAt,
      remoteUpdatedAt,
      specs,
      descriptionHtml,
      descriptionText,
      coverUrl,
      coverLocalRelPath: null,
      screenshotUrls,
      screenshotLocalRelPaths: [],
      coverCandidates,
      screenshotCandidates,
      sourcePageUrl: pageUrl,
      fetchedAt: new Date().toISOString(),
    };
  }

  private getSafeImageExtension(urlStr: string, contentType = ''): string {
    const ct = contentType.toLowerCase();
    if (ct.includes('image/png')) return '.png';
    if (ct.includes('image/webp')) return '.webp';
    if (ct.includes('image/avif')) return '.avif';
    if (ct.includes('image/gif')) return '.gif';
    if (ct.includes('image/bmp')) return '.bmp';
    if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg';

    try {
      const ext = path.extname(new URL(urlStr).pathname).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp'].includes(ext)) {
        return ext === '.jpeg' ? '.jpg' : ext;
      }
    } catch {
      // Default to .jpg
    }
    return '.jpg';
  }

  private async downloadAssetWithFallback(
    candidateUrls: string[],
    targetBasePathWithoutExt: string,
    refererUrl: string,
    config: ScraperConfigInternal,
    options: {
      forceRefresh?: boolean;
      signal?: AbortSignal;
      log?: LoggerFn;
    } = {},
  ): Promise<{ filePath: string; resolvedUrl: string; downloadedOrVerified: boolean } | null> {
    const { forceRefresh = false, signal, log } = options;
    const knownExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp'];

    if (!forceRefresh) {
      for (const ext of knownExts) {
        const candidate = `${targetBasePathWithoutExt}${ext}`;
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
          return { filePath: candidate, resolvedUrl: candidateUrls[0] || '', downloadedOrVerified: true };
        }
      }
    }

    let lastFailureDetail: string | null = null;
    for (const assetUrl of candidateUrls) {
      if (signal?.aborted) break;
      if (!assetUrl) continue;

      try {
        const { response } = await this.fetchWithRedirects(
          assetUrl,
          config,
          {
            method: 'GET',
            headers: {
              Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
              Referer: refererUrl,
            },
          },
          signal,
          log,
        );

        if (!response.ok) {
          lastFailureDetail = `HTTP ${response.status} for ${assetUrl}`;
          await response.body?.cancel().catch(() => undefined);
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        const lowerCt = contentType.toLowerCase();
        if (lowerCt.includes('text/html') || lowerCt.includes('application/json')) {
          lastFailureDetail = `Unexpected content-type "${contentType}" for ${assetUrl}`;
          await response.body?.cancel().catch(() => undefined);
          continue;
        }

        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length === 0) {
          lastFailureDetail = `Empty body for ${assetUrl}`;
          continue;
        }

        const ext = this.getSafeImageExtension(assetUrl, contentType);
        const finalPath = `${targetBasePathWithoutExt}${ext}`;
        const partPath = `${finalPath}.part`;

        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        await fs.promises.writeFile(partPath, buf);
        await fs.promises.rename(partPath, finalPath);

        // Remove stale sibling image files if extension changed (e.g. .jpg thumbnail -> .png full-res)
        for (const otherExt of knownExts) {
          const sibling = `${targetBasePathWithoutExt}${otherExt}`;
          if (sibling !== finalPath && fs.existsSync(sibling)) {
            await fs.promises.unlink(sibling).catch(() => undefined);
          }
        }

        return { filePath: finalPath, resolvedUrl: assetUrl, downloadedOrVerified: true };
      } catch (err) {
        if (signal?.aborted) throw err;
        lastFailureDetail = formatErrorDetails(err);
        log?.('debug', `[Asset] Failed candidate artwork ${assetUrl}`, lastFailureDetail);
      }
    }

    if (lastFailureDetail && candidateUrls[0]) {
      log?.('warn', `Failed to mirror artwork ${candidateUrls[0]}`, lastFailureDetail);
    }

    // If forceRefresh failed (e.g. offline), preserve any existing local file on disk
    for (const ext of knownExts) {
      const existing = `${targetBasePathWithoutExt}${ext}`;
      if (fs.existsSync(existing) && fs.statSync(existing).size > 0) {
        return { filePath: existing, resolvedUrl: candidateUrls[0] || '', downloadedOrVerified: false };
      }
    }

    return null;
  }

  async mirrorReleaseAssets(
    metadata: ReleaseMetadata,
    releaseDir: string,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
    options: { forceRefresh?: boolean } = {},
  ): Promise<{ metadata: ReleaseMetadata; coverAbsPath: string | null; screenshotAbsPaths: string[] }> {
    const resolvedRoot = path.resolve(config.downloadDir);
    const resolvedReleaseDir = path.resolve(releaseDir);
    if (!resolvedReleaseDir.startsWith(resolvedRoot + path.sep) && resolvedReleaseDir !== resolvedRoot) {
      throw new Error(`Unsafe metadata directory rejected: ${releaseDir}`);
    }

    fs.mkdirSync(resolvedReleaseDir, { recursive: true });

    // Automatically upgrade legacy thumbnail assets on disk if sidecar predates SCREENSHOT_FULLRES_VERSION
    let existingSidecarVersion = metadata.screenshotsFullResVersion ?? 0;
    const metaPath = path.join(resolvedReleaseDir, 'metadata.json');
    if (existingSidecarVersion < SCREENSHOT_FULLRES_VERSION && fs.existsSync(metaPath)) {
      try {
        const parsedSidecar = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
          screenshotsFullResVersion?: number;
        };
        if (typeof parsedSidecar.screenshotsFullResVersion === 'number') {
          existingSidecarVersion = parsedSidecar.screenshotsFullResVersion;
        }
      } catch (sidecarErr) {
        log?.('debug', `[Asset] Ignoring malformed sidecar "${metaPath}"`, formatErrorDetails(sidecarErr));
      }
    }
    const shouldForceRefresh =
      Boolean(options.forceRefresh) || existingSidecarVersion < SCREENSHOT_FULLRES_VERSION;

    let anyStaleFallback = false;
    let coverAbsPath: string | null = null;
    let coverLocalRelPath: string | null = null;
    let resolvedCoverUrl: string | null = metadata.coverUrl;
    const coverCandidateList = expandFullResImageCandidates(
      metadata.coverCandidates?.length ? metadata.coverCandidates : [metadata.coverUrl],
      metadata.sourcePageUrl,
    );
    if (coverCandidateList.length > 0) {
      const coverSaved = await this.downloadAssetWithFallback(
        coverCandidateList,
        path.join(resolvedReleaseDir, 'cover'),
        metadata.sourcePageUrl,
        config,
        { forceRefresh: shouldForceRefresh, signal, log },
      );
      if (coverSaved) {
        if (!coverSaved.downloadedOrVerified) anyStaleFallback = true;
        coverAbsPath = coverSaved.filePath;
        if (coverSaved.resolvedUrl) resolvedCoverUrl = coverSaved.resolvedUrl;
        coverLocalRelPath = path.relative(resolvedReleaseDir, coverAbsPath).split(path.sep).join('/');
      }
    }

    const screenshotAbsPaths: string[] = [];
    const screenshotLocalRelPaths: string[] = [];
    const resolvedScreenshotUrls: string[] = [];
    const shotCount = Math.max(
      metadata.screenshotUrls.length,
      metadata.screenshotCandidates?.length ?? 0,
    );
    if (shotCount > 0) {
      const shotsDir = path.join(resolvedReleaseDir, 'screenshots');
      const shotResults: ({
        filePath: string | null;
        relPath: string | null;
        resolvedUrl: string;
        staleFallback: boolean;
      } | null)[] = new Array(shotCount).fill(null);

      let nextShotIdx = 0;
      const workerCount = Math.max(1, Math.min(shotCount, Math.min(config.maxConcurrency || 1, 3)));
      const runShotWorker = async () => {
        while (!signal?.aborted) {
          const i = nextShotIdx;
          nextShotIdx += 1;
          if (i >= shotCount) break;
          const cands = expandFullResImageCandidates(
            metadata.screenshotCandidates?.[i]?.length
              ? metadata.screenshotCandidates[i]
              : [metadata.screenshotUrls[i]],
            metadata.sourcePageUrl,
          );
          if (cands.length === 0) continue;
          const indexName = String(i + 1).padStart(2, '0');
          const shotSaved = await this.downloadAssetWithFallback(
            cands,
            path.join(shotsDir, indexName),
            metadata.sourcePageUrl,
            config,
            { forceRefresh: shouldForceRefresh, signal, log },
          );
          if (shotSaved) {
            shotResults[i] = {
              filePath: shotSaved.filePath,
              relPath: path.relative(resolvedReleaseDir, shotSaved.filePath).split(path.sep).join('/'),
              resolvedUrl: shotSaved.resolvedUrl || cands[0],
              staleFallback: !shotSaved.downloadedOrVerified,
            };
          } else {
            shotResults[i] = {
              filePath: null,
              relPath: null,
              resolvedUrl: cands[0],
              staleFallback: true,
            };
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => runShotWorker()));
      for (const res of shotResults) {
        if (!res) continue;
        if (res.staleFallback) anyStaleFallback = true;
        if (res.filePath && res.relPath) {
          screenshotAbsPaths.push(res.filePath);
          screenshotLocalRelPaths.push(res.relPath);
        }
        resolvedScreenshotUrls.push(res.resolvedUrl);
      }
    }

    const { coverCandidates: _cc, screenshotCandidates: _sc, ...cleanMeta } = metadata;
    void _cc;
    void _sc;

    const upgradedToFullRes =
      !anyStaleFallback && (shotCount === 0 || screenshotAbsPaths.length > 0);

    const enriched: ReleaseMetadata = {
      ...cleanMeta,
      coverUrl: resolvedCoverUrl,
      coverLocalRelPath,
      screenshotUrls: resolvedScreenshotUrls.length > 0 ? resolvedScreenshotUrls : metadata.screenshotUrls,
      screenshotLocalRelPaths,
      ...(upgradedToFullRes
        ? { screenshotsFullResVersion: SCREENSHOT_FULLRES_VERSION }
        : existingSidecarVersion >= SCREENSHOT_FULLRES_VERSION
          ? { screenshotsFullResVersion: existingSidecarVersion }
          : {}),
      fetchedAt: new Date().toISOString(),
    };

    try {
      await fs.promises.writeFile(metaPath, JSON.stringify(enriched, null, 2), 'utf8');
    } catch (metaWriteErr) {
      log?.('debug', `[Asset] Failed writing metadata sidecar "${metaPath}"`, formatErrorDetails(metaWriteErr));
    }

    return {
      metadata: enriched,
      coverAbsPath,
      screenshotAbsPaths,
    };
  }
}
