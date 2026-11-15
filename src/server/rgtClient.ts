import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { load as loadHtml } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { getCookieJarPath } from './db.ts';
import type { AdaptiveRateLimiter } from './rateLimiter.ts';
import { classifyFileRole, decodeHtmlEntities, deriveReleaseTags } from './releaseTags.ts';
import type {
  AuthSessionStatus,
  AuthTestResult,
  LogLevel,
  ReleaseMetadata,
  ScraperConfigInternal,
} from './types.ts';

export { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';

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

export interface WpPostMetadata {
  wpPostId: number;
  wpPostType: string;
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
  downloadHints: { filename: string; fileSize: string }[];
}

export interface DownloadProgress {
  bytesReceived: number;
  totalBytes: number | null;
  bytesPerSec: number;
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
    systemName: relativeSegments[0] || 'uncategorized',
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

export class RetroGameTalkClient {
  private jar: CookieJar;
  private rateLimiter: AdaptiveRateLimiter;
  private wpTypesCache: Map<string, string> | null = null;
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
  }

  private loadCookieJar(): CookieJar {
    const jarPath = getCookieJarPath();
    try {
      if (fs.existsSync(jarPath)) {
        const raw = fs.readFileSync(jarPath, 'utf8');
        return CookieJar.deserializeSync(JSON.parse(raw));
      }
    } catch {
      // Ignore corrupt cookie jar and start fresh
    }
    return new CookieJar();
  }

  private saveCookieJar(): void {
    const jarPath = getCookieJarPath();
    try {
      fs.mkdirSync(path.dirname(jarPath), { recursive: true });
      fs.writeFileSync(jarPath, JSON.stringify(this.jar.serializeSync()), { mode: 0o600 });
    } catch {
      // Non-fatal
    }
  }

  private getSafeCookieCount(urlStr: string): number {
    try {
      return this.jar.getCookiesSync(urlStr).length;
    } catch {
      return 0;
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
    const anyErr = err as { code?: string; cause?: { code?: string } } | null;
    const code = String(anyErr?.cause?.code || anyErr?.code || '');
    return (
      code === 'ENOTFOUND' ||
      code === 'ECONNREFUSED' ||
      code === 'ERR_INVALID_URL' ||
      code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code.startsWith('CERT_')
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

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return `Cannot resolve hostname "${anyErr?.cause?.hostname || host}" — verify the URL spelling and DNS/network access.`;
    }
    if (code === 'ECONNREFUSED') {
      return `Connection refused by "${host}" — the target server appears to be down or unreachable on that port.`;
    }
    if (anyErr?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      return `Connection to "${host}" timed out — server may be down, firewalled, or unreachable.`;
    }
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
      return `Connection reset by "${host}" before a response was received.`;
    }
    if (code.startsWith('CERT_') || code.startsWith('ERR_TLS_') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      return `TLS/SSL certificate error connecting to "${host}": ${causeMsg}`;
    }
    return causeMsg || `Network error connecting to "${host}"`;
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
  ): Promise<{ response: Response; finalUrl: string; latencyMs: number }> {
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
      headers.set('User-Agent', config.userAgent);
      headers.set('Accept', headers.get('Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      if (!headers.has('Accept-Language')) {
        headers.set('Accept-Language', 'en-US,en;q=0.9');
      }
      if (cookieHeader) {
        headers.set('Cookie', cookieHeader);
      }

      const timeoutCtrl = AbortSignal.timeout(config.requestTimeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutCtrl]) : timeoutCtrl;

      let res: Response;
      try {
        res = await fetch(currentUrl, {
          ...init,
          headers,
          redirect: 'manual',
          signal: combinedSignal,
        });
      } catch (err) {
        const latency = performance.now() - started;
        if (signal?.aborted) throw err;
        this.rateLimiter.recordError(latency);
        if (this.isNonRetryableNetworkError(err)) {
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

      // Capture Set-Cookie headers
      const setCookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
      for (const rawCookie of setCookies) {
        try {
          await this.jar.setCookie(rawCookie, currentUrl);
        } catch {
          // Skip malformed cookie
        }
      }
      if (setCookies.length > 0) {
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
        if (maxRedirects <= 0) {
          throw new Error(`Too many redirects while fetching ${url}`);
        }
        const nextUrl = new URL(res.headers.get('location')!, currentUrl).toString();
        currentUrl = nextUrl;
        maxRedirects -= 1;
        if (res.status === 301 || res.status === 302 || res.status === 303) {
          init = { method: 'GET' };
        }
        this.rateLimiter.recordSuccess(latency);
        continue;
      }

      if (res.status >= 500) {
        await res.body?.cancel().catch(() => undefined);
        this.rateLimiter.recordError(latency);
        attempt += 1;
        if (attempt > config.maxRetries) {
          throw new Error(`Target server error HTTP ${res.status} at ${currentUrl}`);
        }
        log?.('warn', `Server HTTP ${res.status}; retrying (${attempt}/${config.maxRetries})`, currentUrl);
        continue;
      }

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
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: 0,
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }

    log?.('info', `Authenticating XenForo + Repo gate at ${config.loginUrl}`);

    // Step 1: GET the configured Login Endpoint URL directly first so configured paths (e.g. /login/login) are honored and reported accurately
    let formPage: { response: Response; finalUrl: string; latencyMs: number };
    try {
      formPage = await this.fetchWithRedirects(config.loginUrl, config, { method: 'GET' }, signal, log);
    } catch (err) {
      const msg = `Cannot reach Login Endpoint URL (${config.loginUrl}): ${this.formatNetworkError(err, config.loginUrl)}`;
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: 0, message: msg };
    }

    let html = await formPage.response.text();
    if (this.isCloudflareChallenge(formPage.response.status, formPage.response.headers, html)) {
      const msg = `Blocked by Cloudflare bot protection (HTTP ${formPage.response.status}) at Login Endpoint URL (${formPage.finalUrl}). Cloudflare is requiring an interactive JS/Turnstile browser challenge for this server IP, so automated login cannot complete from this host.`;
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: formPage.response.status, message: msg };
    }

    // Optional XenForo fallback: if GET /login/login returns 404/405 or no form, try parent /login/ to fetch CSRF _xfToken
    if (
      config.loginUrl.endsWith('/login/login') &&
      (formPage.response.status === 404 ||
        formPage.response.status === 405 ||
        (formPage.response.ok && loadHtml(html)('input[type="password"]').length === 0))
    ) {
      const parentFormUrl = config.loginUrl.replace(/\/login\/login$/, '/login/');
      try {
        const fallbackPage = await this.fetchWithRedirects(parentFormUrl, config, { method: 'GET' }, signal, log);
        const fallbackHtml = await fallbackPage.response.text();
        if (this.isCloudflareChallenge(fallbackPage.response.status, fallbackPage.response.headers, fallbackHtml)) {
          const msg = `Blocked by Cloudflare bot protection (HTTP ${fallbackPage.response.status}) at Login Endpoint URL (${fallbackPage.finalUrl}). Cloudflare is requiring an interactive JS/Turnstile browser challenge for this server IP.`;
          this.setAuthState({
            configured: true,
            authenticated: false,
            cookieCount: this.getSafeCookieCount(config.baseUrl),
            lastMessage: msg,
          });
          return { authenticated: false, statusCode: fallbackPage.response.status, message: msg };
        }
        if (fallbackPage.response.ok && loadHtml(fallbackHtml)('input[type="password"]').length > 0) {
          formPage = fallbackPage;
          html = fallbackHtml;
        }
      } catch {
        // Keep original response error reporting below
      }
    }

    if (formPage.response.status >= 400) {
      const msg = `Login Endpoint URL returned HTTP ${formPage.response.status} (${formPage.finalUrl}). Check that the Login Endpoint URL is correct.`;
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: formPage.response.status, message: msg };
    }

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
        this.setAuthState({
          configured: true,
          authenticated: false,
          cookieCount: preCookies.length,
          lastMessage: msg,
        });
        return { authenticated: false, statusCode: formPage.response.status, message: msg };
      }

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
      this.setAuthState({
        configured: true,
        authenticated: false,
        cookieCount: preCookies.length,
        lastMessage: msg,
      });
      return { authenticated: false, statusCode: formPage.response.status, message: msg };
    }

    let actionUrl = config.loginUrl;
    const params = new URLSearchParams();

    if (form.length > 0) {
      const rawAction = form.attr('action');
      if (rawAction) {
        actionUrl = new URL(rawAction, formPage.finalUrl).toString();
      }
      form.find('input').each((_, el) => {
        const name = $(el).attr('name');
        const type = ($(el).attr('type') || 'text').toLowerCase();
        if (!name) return;
        if (type === 'hidden') {
          params.set(name, $(el).attr('value') || '');
        } else if (type === 'submit' && !params.has(name)) {
          params.set(name, $(el).attr('value') || 'Log in');
        } else if (type === 'checkbox' && name.toLowerCase().includes('remember')) {
          params.set(name, $(el).attr('value') || '1');
        }
      });

      const userField = form
        .find('input[name="login"], input[name="username"], input[name="log"], input[type="text"], input[type="email"]')
        .first()
        .attr('name') || 'login';
      const passField = passwordInput.attr('name') || 'password';

      params.set(userField, username);
      params.set(passField, password);
      params.set('remember', '1');
      if (params.has('_xfRedirect')) {
        params.set('_xfRedirect', config.baseUrl);
      }
    } else {
      params.set('login', username);
      params.set('username', username);
      params.set('password', password);
      params.set('remember', '1');
    }

    let postRes: { response: Response; finalUrl: string; latencyMs: number };
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
      const msg = `Login request blocked by Cloudflare challenge (HTTP ${postRes.response.status}) at ${postRes.finalUrl}. Cloudflare is requiring an interactive JS/Turnstile browser challenge for this server IP.`;
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
    } else if (blockError) {
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

  async testAuthAndDiscovery(config: ScraperConfigInternal, signal?: AbortSignal): Promise<AuthTestResult> {
    const started = performance.now();
    // Use bounded retries/timeout during interactive test probes so dead servers/bad URLs fail fast with real diagnostics
    const probeConfig: ScraperConfigInternal = {
      ...config,
      maxRetries: Math.min(config.maxRetries, 1),
      requestTimeoutMs: Math.min(config.requestTimeoutMs, 12000),
    };

    try {
      this.validateHttpUrlOrExplain(probeConfig.baseUrl, 'Repository Base URL');

      const username = (probeConfig.username || '').trim();
      const password = probeConfig.password || '';
      let authMessage = 'Anonymous repository probe';
      let authenticated = false;

      if (username || password) {
        this.validateHttpUrlOrExplain(probeConfig.loginUrl, 'Login Endpoint URL');
        const loginRes = await this.login(probeConfig, signal);
        authenticated = loginRes.authenticated;
        authMessage = loginRes.message;

        if (!authenticated) {
          return {
            success: false,
            statusCode: loginRes.statusCode || null,
            authenticated: false,
            cookieCount: this.getSafeCookieCount(probeConfig.baseUrl),
            discoveredSystems: [],
            sampleReleaseUrls: [],
            message: loginRes.message,
            latencyMs: Math.round(performance.now() - started),
          };
        }
      }

      let repoRes: { response: Response; finalUrl: string; latencyMs: number };
      try {
        repoRes = await this.fetchWithRedirects(probeConfig.baseUrl, probeConfig, { method: 'GET' }, signal);
      } catch (err) {
        const msg = `Cannot reach Repository Base URL (${probeConfig.baseUrl}): ${this.formatNetworkError(err, probeConfig.baseUrl)}`;
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
          latencyMs: Math.round(performance.now() - started),
        };
      }

      const html = await repoRes.response.text();
      const cookiesCount = this.getSafeCookieCount(probeConfig.baseUrl);
      const latencyMs = Math.round(performance.now() - started);

      if (this.isCloudflareChallenge(repoRes.response.status, repoRes.response.headers, html)) {
        const msg = `Blocked by Cloudflare bot protection (HTTP ${repoRes.response.status}) at Repository Base URL (${repoRes.finalUrl}).`;
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

      const sortedSystems = [...systems].sort((a, b) => a.localeCompare(b));
      if (!username && !password && sortedSystems.length === 0 && releasePages.length === 0) {
        const msg = `Credentials missing (username and password are empty) and no consoles were discovered at ${repoRes.finalUrl}.`;
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
        latencyMs: Math.round(performance.now() - started),
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

    const systemFilters = config.systemFilter
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

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

      if (isUnderRepo && IGNORED_REPO_PREFIXES.has(firstSegLower)) return;

      const systemCandidate = relSegs[0] ? sanitizePathSegment(relSegs[0]) : 'uncategorized';

      if (
        systemFilters.length > 0 &&
        relSegs.length > 0 &&
        firstSegLower !== 'page' &&
        !systemFilters.includes(systemCandidate.toLowerCase())
      ) {
        return;
      }

      const containerTime =
        $(el).closest('article, tr, li, .post, .entry').find('time[datetime]').first().attr('datetime') ||
        pageTime;

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
          systemName: resolved.searchParams.get('platform')
            ? sanitizePathSegment(resolved.searchParams.get('platform')!)
            : mirrored.systemName,
          releaseType: inferReleaseType(`${anchorText} ${pageTitle}`, hrefStr),
          title: anchorText && anchorText.toLowerCase() !== 'download'
            ? anchorText
            : pageTitle || mirrored.filename,
          publishedAt: containerTime,
        });
        return;
      }

      if (isUnderRepo && resolved.pathname !== current.pathname) {
        const cleanUrl = `${resolved.origin}${resolved.pathname}`;
        if (containerTime) {
          releaseTimes.set(cleanUrl, containerTime);
        }

        // Pagination or top-level system directory (/repo/page/2/, /repo/nes-roms/, /repo/nes-roms/page/2/)
        const isPagination = firstSegLower === 'page' || (relSegs.length >= 2 && relSegs[1].toLowerCase() === 'page');
        if (relSegs.length === 1 && firstSegLower !== 'page') {
          systems.add(systemCandidate);
          subPages.add(cleanUrl);
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
    let ajaxUrl = new URL('wp-content/plugins/cdr-main/public/ajax.php', config.baseUrl).toString();
    let nonceUrl = new URL('wp-admin/admin-ajax.php?action=cdr_nonce', config.baseUrl).toString();
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
        return res.response.text();
      };

      let ajaxHtml = await fetchAjaxHtml(nonce);
      if (!ajaxHtml.includes('download.php') && !ajaxHtml.includes('dl-btn-')) {
        // Refresh cached nonce via cdr_nonce endpoint
        const nonceRes = await this.fetchWithRedirects(
          `${nonceUrl}${nonceUrl.includes('?') ? '&' : '?'}post_id=${encodeURIComponent(postId)}`,
          config,
          { method: 'GET', headers: { Referer: pageUrl, 'X-Requested-With': 'XMLHttpRequest' } },
          signal,
          log,
        );
        const freshNonce = (await nonceRes.response.text()).trim();
        if (freshNonce && freshNonce !== '0' && freshNonce !== '-1') {
          nonce = freshNonce;
          ajaxHtml = await fetchAjaxHtml(nonce);
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
          systemName: platformParam ? sanitizePathSegment(platformParam) : mirrored.systemName,
          releaseType: inferReleaseType(`${pageTitle} ${anchorText}`, filename),
          title: pageTitle || mirrored.filename,
          publishedAt: pageTime,
        });
      });
    }

    // DLC / BIOS row buttons (.dlc-button)
    if (results.length === 0 && dlcButtons.length > 0) {
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
        if (!dlHref.startsWith('http')) continue;

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
          systemName: mirrored.systemName,
          releaseType: inferReleaseType(`${pageTitle} ${btnLabel}`, filename),
          title: pageTitle || mirrored.filename,
          publishedAt: pageTime,
        });
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

    // If redirected to /login/ mid-crawl, refresh session and retry once
    if (
      (finalUrl.includes('/login') || finalUrl.includes('wp-login.php')) &&
      config.username &&
      config.password
    ) {
      await response.body?.cancel().catch(() => undefined);
      log?.('warn', 'Session expired mid-crawl; re-authenticating');
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

    const html = await response.text();
    if (this.isCloudflareChallenge(response.status, response.headers, html)) {
      const msg = `Blocked by Cloudflare bot protection (HTTP ${response.status}) at ${finalUrl}`;
      this.setAuthState({
        configured: Boolean(config.username && config.password),
        authenticated: false,
        cookieCount: this.getSafeCookieCount(config.baseUrl),
        lastMessage: msg,
      });
      throw new Error(msg);
    }

    if (finalUrl.includes('/login') || finalUrl.includes('wp-login.php')) {
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
        return {
          outcome: 'skipped',
          localPath: expectedLocalPath,
          remotePath: release.remotePath,
          filename: path.basename(expectedLocalPath),
          bytes: stat.size,
        };
      }
    }

    const { response, finalUrl } = await this.fetchWithRedirects(
      release.downloadUrl,
      config,
      {
        method: 'GET',
        headers: {
          Referer: release.pageUrl || config.baseUrl,
        },
      },
      signal,
      log,
    );

    if (!response.ok) {
      const bodySnippet = await response.text().catch(() => '');
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
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Expected archive binary but received HTML (${finalUrl}); session or nonce may have expired`);
    }

    // 2. Resolve exact filename from Content-Disposition or query param/path
    const headerFilename = parseContentDispositionFilename(response.headers.get('content-disposition'));
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
        return {
          outcome: 'skipped',
          localPath: finalLocalPath,
          remotePath: finalRemotePath,
          filename: finalFilename,
          bytes: stat.size,
        };
      }
    }

    // 4. Atomic streaming write to .part -> rename
    fs.mkdirSync(path.dirname(finalLocalPath), { recursive: true });
    const partPath = `${finalLocalPath}.part`;
    const totalBytesHeader = response.headers.get('content-length');
    const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null;

    if (!response.body) {
      throw new Error(`Empty response stream for ${release.downloadUrl}`);
    }

    let bytesReceived = 0;
    const startedAt = Date.now();
    let lastEmitAt = 0;

    const writeStream = fs.createWriteStream(partPath);
    const nodeReadable = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);

    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          nodeReadable.destroy();
          writeStream.destroy();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        nodeReadable.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length;
          const now = Date.now();
          if (now - lastEmitAt >= 200) {
            lastEmitAt = now;
            const elapsedSec = Math.max(0.1, (now - startedAt) / 1000);
            onProgress({
              bytesReceived,
              totalBytes,
              bytesPerSec: Math.round(bytesReceived / elapsedSec),
            });
          }
        });

        nodeReadable.on('error', (err) => {
          signal.removeEventListener('abort', onAbort);
          writeStream.destroy();
          reject(err);
        });

        writeStream.on('error', (err) => {
          signal.removeEventListener('abort', onAbort);
          nodeReadable.destroy();
          reject(err);
        });

        writeStream.on('finish', () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });

        nodeReadable.pipe(writeStream);
      });

      await fs.promises.rename(partPath, finalLocalPath);
      onProgress({
        bytesReceived,
        totalBytes: totalBytes ?? bytesReceived,
        bytesPerSec: Math.round(bytesReceived / Math.max(0.1, (Date.now() - startedAt) / 1000)),
      });

      return {
        outcome: 'downloaded',
        localPath: finalLocalPath,
        remotePath: finalRemotePath,
        filename: finalFilename,
        bytes: bytesReceived,
      };
    } catch (err) {
      await fs.promises.unlink(partPath).catch(() => undefined);
      throw err;
    }
  }

  private async getWpRestTypes(
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<Map<string, string>> {
    if (this.wpTypesCache) return this.wpTypesCache;
    const map = new Map<string, string>();
    try {
      const typesUrl = new URL('wp-json/wp/v2/types', config.baseUrl).toString();
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
          }
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    this.wpTypesCache = map;
    return map;
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
      const restBase = typeMap.get(systemSeg) || (relSegs.length === 1 ? 'pages' : null);
      if (!restBase) return null;

      const endpoint =
        wpPostIdHint && wpPostIdHint > 0
          ? new URL(`wp-json/wp/v2/${encodeURIComponent(restBase)}/${wpPostIdHint}?_embed`, config.baseUrl).toString()
          : new URL(
              `wp-json/wp/v2/${encodeURIComponent(restBase)}?slug=${encodeURIComponent(slug)}&_embed`,
              config.baseUrl,
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
        return null;
      }

      const raw = (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
      const post = Array.isArray(raw) ? raw[0] : raw;
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

      const embedded = post._embedded as { 'wp:term'?: unknown[] } | undefined;
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

      return {
        wpPostId: Number(post.id),
        wpPostType: String(post.type || restBase),
        title: acfGameName || titleRendered || null,
        originalTitle: typeof acf.original_title === 'string' && acf.original_title.trim() ? acf.original_title.trim() : null,
        publisher: publishers.size > 0 ? Array.from(publishers).join(', ') : null,
        developer: developers.size > 0 ? Array.from(developers).join(', ') : null,
        releaseYear,
        genres: Array.from(genres),
        regions: Array.from(regions),
        languages: Array.from(languages),
        sources: Array.from(sources),
        formats: Array.from(formats),
        descriptionHtml: contentRendered,
        downloadHints,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
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

    // Cover art URL
    let coverUrl: string | null = null;
    const rawCover =
      $('.rgt-cover a.rgt-cover-zoom').first().attr('href') ||
      $('.rgt-cover img').first().attr('src') ||
      $('.post-thumbnail img').first().attr('src') ||
      $('article.rgt-game img.wp-post-image').first().attr('src');
    if (rawCover) {
      try {
        coverUrl = new URL(rawCover, pageUrl).toString();
      } catch {
        coverUrl = null;
      }
    }

    // Full-resolution screenshot URLs
    const shotSet = new Set<string>();
    $('#lightgallery .game-box-layout, .rgt-shots .game-box-layout').each((_, el) => {
      const raw =
        $(el).attr('data-src') ||
        $(el).find('a[itemprop="screenshot"], a').first().attr('href') ||
        $(el).find('img').first().attr('src');
      if (!raw) return;
      try {
        shotSet.add(new URL(raw, pageUrl).toString());
      } catch {
        // Ignore invalid screenshot URL
      }
    });

    // Description HTML sanitization (prefer HTML #custom-description, fallback to WP content.rendered)
    const descNode = $('#custom-description').first().length
      ? $('#custom-description').first()
      : $('.game-description').first();
    const rawDescHtml = (descNode.length ? descNode.html() : '') || wpData?.descriptionHtml || '';
    const { descriptionHtml, descriptionText } = this.sanitizeDescriptionHtml(rawDescHtml);

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
      specs,
      descriptionHtml,
      descriptionText,
      coverUrl,
      coverLocalRelPath: null,
      screenshotUrls: Array.from(shotSet),
      screenshotLocalRelPaths: [],
      sourcePageUrl: pageUrl,
      fetchedAt: new Date().toISOString(),
    };
  }

  private getSafeImageExtension(urlStr: string, contentType = ''): string {
    const ct = contentType.toLowerCase();
    if (ct.includes('image/png')) return '.png';
    if (ct.includes('image/webp')) return '.webp';
    if (ct.includes('image/gif')) return '.gif';
    if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg';

    try {
      const ext = path.extname(new URL(urlStr).pathname).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        return ext === '.jpeg' ? '.jpg' : ext;
      }
    } catch {
      // Default to .jpg
    }
    return '.jpg';
  }

  private async downloadAssetIfMissing(
    assetUrl: string,
    targetBasePathWithoutExt: string,
    refererUrl: string,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<string | null> {
    // Check if any valid image extension already exists on disk
    for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
      const candidate = `${targetBasePathWithoutExt}${ext}`;
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
        return candidate;
      }
    }

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
        await response.body?.cancel().catch(() => undefined);
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.toLowerCase().includes('text/html')) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }

      const ext = this.getSafeImageExtension(assetUrl, contentType);
      const finalPath = `${targetBasePathWithoutExt}${ext}`;
      const partPath = `${finalPath}.part`;

      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.length === 0) return null;

      await fs.promises.writeFile(partPath, buf);
      await fs.promises.rename(partPath, finalPath);
      return finalPath;
    } catch (err) {
      if (signal?.aborted) throw err;
      log?.('warn', `Failed to mirror artwork ${assetUrl}`, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async mirrorReleaseAssets(
    metadata: ReleaseMetadata,
    releaseDir: string,
    config: ScraperConfigInternal,
    signal?: AbortSignal,
    log?: LoggerFn,
  ): Promise<{ metadata: ReleaseMetadata; coverAbsPath: string | null; screenshotAbsPaths: string[] }> {
    const resolvedRoot = path.resolve(config.downloadDir);
    const resolvedReleaseDir = path.resolve(releaseDir);
    if (!resolvedReleaseDir.startsWith(resolvedRoot + path.sep) && resolvedReleaseDir !== resolvedRoot) {
      throw new Error(`Unsafe metadata directory rejected: ${releaseDir}`);
    }

    fs.mkdirSync(resolvedReleaseDir, { recursive: true });

    let coverAbsPath: string | null = null;
    let coverLocalRelPath: string | null = null;
    if (metadata.coverUrl) {
      coverAbsPath = await this.downloadAssetIfMissing(
        metadata.coverUrl,
        path.join(resolvedReleaseDir, 'cover'),
        metadata.sourcePageUrl,
        config,
        signal,
        log,
      );
      if (coverAbsPath) {
        coverLocalRelPath = path.relative(resolvedReleaseDir, coverAbsPath).split(path.sep).join('/');
      }
    }

    const screenshotAbsPaths: string[] = [];
    const screenshotLocalRelPaths: string[] = [];
    if (metadata.screenshotUrls.length > 0) {
      const shotsDir = path.join(resolvedReleaseDir, 'screenshots');
      for (let i = 0; i < metadata.screenshotUrls.length; i += 1) {
        if (signal?.aborted) break;
        const shotUrl = metadata.screenshotUrls[i];
        const indexName = String(i + 1).padStart(2, '0');
        const shotAbs = await this.downloadAssetIfMissing(
          shotUrl,
          path.join(shotsDir, indexName),
          metadata.sourcePageUrl,
          config,
          signal,
          log,
        );
        if (shotAbs) {
          screenshotAbsPaths.push(shotAbs);
          screenshotLocalRelPaths.push(path.relative(resolvedReleaseDir, shotAbs).split(path.sep).join('/'));
        }
      }
    }

    const enriched: ReleaseMetadata = {
      ...metadata,
      coverLocalRelPath,
      screenshotLocalRelPaths,
      fetchedAt: new Date().toISOString(),
    };

    try {
      const metaPath = path.join(resolvedReleaseDir, 'metadata.json');
      await fs.promises.writeFile(metaPath, JSON.stringify(enriched, null, 2), 'utf8');
    } catch {
      // Non-fatal if metadata sidecar write fails
    }

    return {
      metadata: enriched,
      coverAbsPath,
      screenshotAbsPaths,
    };
  }
}
