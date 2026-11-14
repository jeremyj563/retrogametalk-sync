import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { load as loadHtml } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { getCookieJarPath } from './db.ts';
import type { AdaptiveRateLimiter } from './rateLimiter.ts';
import type {
  AuthSessionStatus,
  AuthTestResult,
  LogLevel,
  ScraperConfigInternal,
} from './types.ts';

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
  systemName: string;
  releaseType: string;
  title: string;
  publishedAt: string | null;
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
  const combined = `${text} ${urlStr}`.toLowerCase();
  if (combined.includes('translation') || combined.includes('english') || combined.includes('t-en')) {
    return 'translation';
  }
  if (combined.includes('hack') || combined.includes('romhack') || combined.includes('redux') || combined.includes('msu')) {
    return 'hack';
  }
  if (combined.includes('port') || combined.includes('homebrew')) {
    return 'port';
  }
  if (combined.includes('patch') || /\.(ips|bps|ups|xdelta)(\?|$)/i.test(urlStr)) {
    return 'patch';
  }
  return 'rom';
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
  private authStatus: AuthSessionStatus = {
    configured: false,
    authenticated: false,
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

  getAuthStatus(config: ScraperConfigInternal): AuthSessionStatus {
    const cookies = this.jar.getCookiesSync(config.baseUrl);
    return {
      ...this.authStatus,
      configured: Boolean(config.username && config.password),
      cookieCount: cookies.length,
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
      if (!cookieHeader && isSameRootDomain(new URL(currentUrl).hostname, new URL(config.baseUrl).hostname)) {
        cookieHeader = await this.jar.getCookieString(config.baseUrl);
      }

      const headers = new Headers(init.headers || {});
      headers.set('User-Agent', config.userAgent);
      headers.set('Accept', headers.get('Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
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
        attempt += 1;
        if (attempt > config.maxRetries) {
          throw err;
        }
        log?.('warn', `Network retry (${attempt}/${config.maxRetries}) for ${currentUrl}`, String(err));
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
          throw new Error(`Exceeded max retries (${config.maxRetries}) after HTTP ${res.status}`);
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
          throw new Error(`Upstream HTTP ${res.status} at ${currentUrl}`);
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
    if (!config.username || !config.password) {
      this.authStatus = {
        configured: false,
        authenticated: false,
        cookieCount: this.jar.getCookiesSync(config.baseUrl).length,
        lastCheckedAt: new Date().toISOString(),
        lastMessage: 'No repository credentials configured; proceeding anonymously.',
      };
      return {
        authenticated: false,
        statusCode: 0,
        message: 'No repository credentials configured.',
      };
    }

    log?.('info', `Authenticating XenForo + Repo gate at ${config.loginUrl}`);

    // Step 1: GET the login form (for XenForo /login/ or /login/login, fetch CSRF cookie + _xfToken)
    const formUrl = config.loginUrl.endsWith('/login/login')
      ? config.loginUrl.replace(/\/login\/login$/, '/login/')
      : config.loginUrl;

    const formPage = await this.fetchWithRedirects(formUrl, config, { method: 'GET' }, signal, log);
    const html = await formPage.response.text();
    const $ = loadHtml(html);

    const passwordInput = $('input[type="password"]').first();
    const form = passwordInput.closest('form');

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

      params.set(userField, config.username);
      params.set(passField, config.password);
      params.set('remember', '1');
      if (params.has('_xfRedirect')) {
        params.set('_xfRedirect', config.baseUrl);
      }
    } else {
      // Direct fallback payload
      params.set('login', config.username);
      params.set('username', config.username);
      params.set('password', config.password);
      params.set('remember', '1');
    }

    const postRes = await this.fetchWithRedirects(
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

    const postBody = await postRes.response.text();

    // Step 2: Touch config.baseUrl (/repo/) so WordPress rgt_gate primes PHPSESSID cleanly
    let repoReached = false;
    let repoTitle = '';
    if (postRes.response.ok || postRes.finalUrl.includes('/repo')) {
      try {
        const repoCheck = await this.fetchWithRedirects(config.baseUrl, config, { method: 'GET' }, signal, log);
        const repoHtml = await repoCheck.response.text();
        const repo$ = loadHtml(repoHtml);
        repoTitle = repo$('title').first().text().trim();
        repoReached = repoCheck.response.ok && !repoCheck.finalUrl.includes('/login') && repo$('input[name="login"]').length === 0;
      } catch {
        repoReached = false;
      }
    }

    const cookies = await this.jar.getCookies(config.baseUrl);
    const hasXfUser = cookies.some((c) => c.key === 'xf_user' || c.key.startsWith('wordpress_logged_in_'));
    const post$ = loadHtml(postBody);
    const blockError = post$('.blockMessage--error, #login_error').text().trim();
    const authenticated = hasXfUser || repoReached;

    const message = authenticated
      ? `Authenticated as ${config.username} (${cookies.length} cookies${repoTitle ? ` · "${repoTitle}"` : ''})`
      : blockError
        ? `Login rejected: ${blockError}`
        : `HTTP ${postRes.response.status}; authentication did not yield an active xf_user/repo session`;

    this.authStatus = {
      configured: true,
      authenticated,
      cookieCount: cookies.length,
      lastCheckedAt: new Date().toISOString(),
      lastMessage: message,
    };

    log?.(authenticated ? 'info' : 'warn', message);
    return {
      authenticated,
      statusCode: postRes.response.status,
      message,
    };
  }

  async testAuthAndDiscovery(config: ScraperConfigInternal, signal?: AbortSignal): Promise<AuthTestResult> {
    const started = performance.now();
    try {
      let authMessage = 'Anonymous repository probe';
      let authenticated = false;

      if (config.username && config.password) {
        const loginRes = await this.login(config, signal);
        authenticated = loginRes.authenticated;
        authMessage = loginRes.message;
      }

      const repoRes = await this.fetchWithRedirects(config.baseUrl, config, { method: 'GET' }, signal);
      const html = await repoRes.response.text();
      const { systems, releasePages, downloads } = this.extractLinksFromHtml(
        html,
        repoRes.finalUrl,
        { ...config, systemFilter: '' },
      );

      const cookies = await this.jar.getCookies(config.baseUrl);
      const latencyMs = Math.round(performance.now() - started);
      const sortedSystems = [...systems].sort((a, b) => a.localeCompare(b));

      return {
        success: repoRes.response.ok && !repoRes.finalUrl.includes('/login'),
        statusCode: repoRes.response.status,
        authenticated,
        cookieCount: cookies.length,
        discoveredSystems: sortedSystems,
        sampleReleaseUrls: [...releasePages.slice(0, 8), ...downloads.slice(0, 4).map((d) => d.remoteUrl)],
        message: `${authMessage} · Repo HTTP ${repoRes.response.status} (${sortedSystems.length} systems, ${releasePages.length} release pages found on index)`,
        latencyMs,
      };
    } catch (err) {
      return {
        success: false,
        statusCode: null,
        authenticated: false,
        cookieCount: this.jar.getCookiesSync(config.baseUrl).length,
        discoveredSystems: [],
        sampleReleaseUrls: [],
        message: err instanceof Error ? err.message : String(err),
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

        downloads.push({
          remoteUrl: hrefStr,
          pageUrl: current.toString(),
          downloadUrl: hrefStr,
          remotePath: mirrored.remotePath,
          filename: mirrored.filename,
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
        const filename = sanitizePathSegment(
          filenameAttr || paramFile || ajax$(a).text().trim() || `${pageTitle}.zip`,
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
          systemName: platformParam ? sanitizePathSegment(platformParam) : mirrored.systemName,
          releaseType: inferReleaseType(`${pageTitle} ${filename}`, pageUrl),
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
        const filename = sanitizePathSegment(
          dlUrl.searchParams.get('file') || btn.text().trim() || `row-${row}.zip`,
        );
        const mirrored = resolveMirroredPaths(config.baseUrl, pageUrl, config.downloadDir, filename);
        results.push({
          remoteUrl: `${pageUrl.split('#')[0]}#${encodeURIComponent(filename)}`,
          pageUrl,
          downloadUrl: dlUrl.toString(),
          remotePath: mirrored.remotePath,
          filename: mirrored.filename,
          systemName: mirrored.systemName,
          releaseType: inferReleaseType(`${pageTitle} ${filename}`, pageUrl),
          title: `${pageTitle} · ${filename}`,
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
      if (auth.authenticated) {
        const retry = await this.fetchWithRedirects(url, config, { method: 'GET' }, signal, log);
        const html = await retry.response.text();
        return { html, finalUrl: retry.finalUrl, status: retry.response.status };
      }
    }

    const html = await response.text();
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
      await response.body?.cancel().catch(() => undefined);
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
}
