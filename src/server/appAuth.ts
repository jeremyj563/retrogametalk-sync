import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppAuthStatus } from './types.ts';

export const APP_AUTH_COOKIE_NAME = 'rgt_sync_session';

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_TRACKED_RATE_LIMIT_KEYS = 2048;

export interface AppAuthOptions {
  /** Override password (defaults to process.env.APP_AUTH_PASSWORD). */
  password?: string;
  /** Override username (defaults to process.env.APP_AUTH_USERNAME). */
  username?: string;
  /** Override HMAC signing secret (defaults to process.env.APP_AUTH_SESSION_SECRET or random per-process key). */
  sessionSecret?: string;
  /** Session lifetime in milliseconds (default 7 days). */
  sessionTtlMs?: number;
  /** Max failed login attempts per IP within the sliding window (default 10). */
  rateLimitMaxAttempts?: number;
  /** Sliding rate-limit window in milliseconds (default 15 min). */
  rateLimitWindowMs?: number;
  /** Clock provider for deterministic tests. */
  now?: () => number;
}

interface SessionPayload {
  v: 1;
  iat: number;
  exp: number;
  fp: string;
}

interface CachedPasswordHash {
  source: string;
  salt: Buffer;
  derivedKey: Buffer;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSec: number;
  remainingAttempts: number;
}

export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(maxAttempts: number, windowMs: number, now: () => number = Date.now) {
    this.maxAttempts = Math.max(1, maxAttempts);
    this.windowMs = Math.max(1000, windowMs);
    this.now = now;
  }

  private prune(key: string, currentMs: number): number[] {
    const cutoff = currentMs - this.windowMs;
    const existing = this.attempts.get(key);
    if (!existing || existing.length === 0) {
      return [];
    }
    const fresh = existing.filter((ts) => ts > cutoff);
    if (fresh.length === 0) {
      this.attempts.delete(key);
    } else if (fresh.length !== existing.length) {
      this.attempts.set(key, fresh);
    }
    return fresh;
  }

  private evictIfNeeded(currentMs: number): void {
    if (this.attempts.size < MAX_TRACKED_RATE_LIMIT_KEYS) return;
    const cutoff = currentMs - this.windowMs;
    for (const [key, list] of this.attempts.entries()) {
      const fresh = list.filter((ts) => ts > cutoff);
      if (fresh.length === 0) {
        this.attempts.delete(key);
      } else {
        this.attempts.set(key, fresh);
      }
    }
    if (this.attempts.size >= MAX_TRACKED_RATE_LIMIT_KEYS) {
      const oldestKey = this.attempts.keys().next().value;
      if (oldestKey !== undefined) {
        this.attempts.delete(oldestKey);
      }
    }
  }

  check(key: string): RateLimitCheckResult {
    const currentMs = this.now();
    const fresh = this.prune(key, currentMs);
    if (fresh.length >= this.maxAttempts) {
      const oldestInWindow = fresh[0] ?? currentMs;
      const retryAfterMs = Math.max(1000, oldestInWindow + this.windowMs - currentMs);
      return {
        allowed: false,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
        remainingAttempts: 0,
      };
    }
    return {
      allowed: true,
      retryAfterSec: 0,
      remainingAttempts: Math.max(0, this.maxAttempts - fresh.length),
    };
  }

  recordFailure(key: string): RateLimitCheckResult {
    const currentMs = this.now();
    this.evictIfNeeded(currentMs);
    const fresh = this.prune(key, currentMs);
    fresh.push(currentMs);
    this.attempts.set(key, fresh);
    if (fresh.length >= this.maxAttempts) {
      const oldestInWindow = fresh[0] ?? currentMs;
      const retryAfterMs = Math.max(1000, oldestInWindow + this.windowMs - currentMs);
      return {
        allowed: false,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
        remainingAttempts: 0,
      };
    }
    return {
      allowed: true,
      retryAfterSec: 0,
      remainingAttempts: Math.max(0, this.maxAttempts - fresh.length),
    };
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

function timingSafeStringDigestEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(val);
    } catch {
      result[name] = val;
    }
  }
  return result;
}

export function isRequestSecure(req: Pick<Request, 'secure' | 'headers'>): boolean {
  if (req.secure) return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    const first = forwardedProto.split(',')[0]?.trim().toLowerCase();
    if (first === 'https') return true;
  }
  return false;
}

export function buildSessionCookieHeader(
  token: string,
  options: { secure: boolean; maxAgeSec: number },
): string {
  const parts = [
    `${APP_AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSec))}`,
  ];
  if (options.secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(options: { secure: boolean }): string {
  const parts = [
    `${APP_AUTH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (options.secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

function extractRequestHost(req: Pick<Request, 'headers'>): string | null {
  const forwardedHost = req.headers['x-forwarded-host'];
  if (typeof forwardedHost === 'string' && forwardedHost.trim()) {
    return forwardedHost.split(',')[0]!.trim().toLowerCase();
  }
  const host = req.headers.host;
  if (typeof host === 'string' && host.trim()) {
    return host.trim().toLowerCase();
  }
  return null;
}

/**
 * Verifies same-origin intent on cookie-authenticated state-changing requests
 * (`POST`, `PUT`, `PATCH`, `DELETE`) to defend against cross-site request forgery.
 */
export function verifyCsrfProtection(req: Pick<Request, 'method' | 'headers'>): boolean {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const expectedHost = extractRequestHost(req);
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader) {
    if (!expectedHost) return false;
    try {
      const originUrl = new URL(originHeader);
      return originUrl.host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  const secFetchSite =
    typeof req.headers['sec-fetch-site'] === 'string'
      ? req.headers['sec-fetch-site'].trim().toLowerCase()
      : '';
  if (secFetchSite === 'same-origin') {
    return true;
  }

  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer.trim() : '';
  if (refererHeader && expectedHost) {
    try {
      const refererUrl = new URL(refererHeader);
      if (refererUrl.host.toLowerCase() === expectedHost) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const requestedWith =
    typeof req.headers['x-requested-with'] === 'string'
      ? req.headers['x-requested-with'].trim()
      : '';
  if (requestedWith.length > 0) {
    return true;
  }

  return false;
}

function getClientIp(req: Pick<Request, 'ip' | 'socket'>): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  return String(raw).trim() || 'unknown';
}

export class AppAuthManager {
  private readonly options: AppAuthOptions;
  private readonly fallbackSecret: Buffer;
  private readonly now: () => number;
  private readonly sessionTtlMs: number;
  private readonly rateLimiter: SlidingWindowRateLimiter;
  private cachedPasswordHash: CachedPasswordHash | null = null;

  constructor(options: AppAuthOptions = {}) {
    this.options = options;
    this.fallbackSecret = crypto.randomBytes(32);
    this.now = options.now ?? Date.now;
    this.sessionTtlMs = Math.max(60_000, options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS);
    this.rateLimiter = new SlidingWindowRateLimiter(
      options.rateLimitMaxAttempts ?? DEFAULT_RATE_LIMIT_MAX_ATTEMPTS,
      options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
      this.now,
    );
  }

  private getConfiguredPassword(): string {
    const raw =
      this.options.password !== undefined
        ? this.options.password
        : (process.env.APP_AUTH_PASSWORD ?? '');
    return raw;
  }

  private getConfiguredUsername(): string {
    const raw =
      this.options.username !== undefined
        ? this.options.username
        : (process.env.APP_AUTH_USERNAME ?? '');
    return raw.trim();
  }

  private getSigningKey(): Buffer {
    const envSecret =
      this.options.sessionSecret !== undefined
        ? this.options.sessionSecret
        : (process.env.APP_AUTH_SESSION_SECRET ?? '');
    if (envSecret.trim().length > 0) {
      return crypto.createHash('sha256').update(envSecret.trim(), 'utf8').digest();
    }
    return this.fallbackSecret;
  }

  private getCredentialFingerprint(): string {
    return crypto
      .createHash('sha256')
      .update(`${this.getConfiguredUsername()}\0${this.getConfiguredPassword()}`, 'utf8')
      .digest('hex')
      .slice(0, 16);
  }

  isEnabled(): boolean {
    return this.getConfiguredPassword().length > 0;
  }

  isUsernameRequired(): boolean {
    return this.getConfiguredUsername().length > 0;
  }

  verifyCredentials(candidateUsername: string | undefined, candidatePassword: string): boolean {
    const configuredPassword = this.getConfiguredPassword();
    if (!configuredPassword) return false;
    if (typeof candidatePassword !== 'string' || candidatePassword.length === 0) {
      return false;
    }

    if (!this.cachedPasswordHash || this.cachedPasswordHash.source !== configuredPassword) {
      const salt = crypto.randomBytes(16);
      const derivedKey = crypto.scryptSync(configuredPassword, salt, 32);
      this.cachedPasswordHash = { source: configuredPassword, salt, derivedKey };
    }

    const candidateDerived = crypto.scryptSync(
      candidatePassword,
      this.cachedPasswordHash.salt,
      32,
    );
    const passwordMatches = crypto.timingSafeEqual(
      candidateDerived,
      this.cachedPasswordHash.derivedKey,
    );

    const configuredUsername = this.getConfiguredUsername();
    if (!configuredUsername) {
      return passwordMatches;
    }

    const submittedUsername = typeof candidateUsername === 'string' ? candidateUsername.trim() : '';
    const usernameMatches = timingSafeStringDigestEqual(submittedUsername, configuredUsername);
    return passwordMatches && usernameMatches;
  }

  issueSessionToken(): string {
    const nowMs = this.now();
    const payload: SessionPayload = {
      v: 1,
      iat: nowMs,
      exp: nowMs + this.sessionTtlMs,
      fp: this.getCredentialFingerprint(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getSigningKey())
      .update(encodedPayload, 'utf8')
      .digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  verifySessionToken(token: string | undefined): boolean {
    if (!this.isEnabled()) return true;
    if (!token || typeof token !== 'string') return false;
    const dotIndex = token.indexOf('.');
    if (dotIndex <= 0 || dotIndex !== token.lastIndexOf('.')) return false;

    const encodedPayload = token.slice(0, dotIndex);
    const receivedSig = token.slice(dotIndex + 1);
    if (!encodedPayload || !receivedSig) return false;

    const expectedSig = crypto
      .createHmac('sha256', this.getSigningKey())
      .update(encodedPayload, 'utf8')
      .digest('base64url');

    const receivedBuf = Buffer.from(receivedSig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (receivedBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(receivedBuf, expectedBuf)) return false;

    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<SessionPayload>;
      if (parsed.v !== 1) return false;
      if (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return false;
      if (parsed.exp <= this.now()) return false;
      if (typeof parsed.fp !== 'string' || parsed.fp !== this.getCredentialFingerprint()) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  isRequestAuthenticated(req: Pick<Request, 'headers'>): boolean {
    if (!this.isEnabled()) return true;
    const cookies = parseCookieHeader(req.headers.cookie);
    return this.verifySessionToken(cookies[APP_AUTH_COOKIE_NAME]);
  }

  getStatus(req: Pick<Request, 'headers'>): AppAuthStatus {
    const enabled = this.isEnabled();
    return {
      enabled,
      authenticated: enabled ? this.isRequestAuthenticated(req) : true,
      usernameRequired: enabled ? this.isUsernameRequired() : false,
    };
  }

  checkLoginRateLimit(clientKey: string): RateLimitCheckResult {
    return this.rateLimiter.check(clientKey);
  }

  recordLoginFailure(clientKey: string): RateLimitCheckResult {
    return this.rateLimiter.recordFailure(clientKey);
  }

  resetLoginRateLimit(clientKey: string): void {
    this.rateLimiter.reset(clientKey);
  }

  handleStatus = (req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(this.getStatus(req));
  };

  handleLogin = (req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.isEnabled()) {
      res.status(200).json({
        ok: true,
        enabled: false,
        authenticated: true,
        usernameRequired: false,
      });
      return;
    }

    if (!verifyCsrfProtection(req)) {
      res.status(403).json({ error: 'Cross-site sign-in request blocked' });
      return;
    }

    const clientIp = getClientIp(req);
    const limitStatus = this.checkLoginRateLimit(clientIp);
    if (!limitStatus.allowed) {
      res.setHeader('Retry-After', String(limitStatus.retryAfterSec));
      res.status(429).json({
        error: `Too many failed sign-in attempts. Try again in ${Math.ceil(limitStatus.retryAfterSec / 60)} minute(s).`,
        retryAfterSec: limitStatus.retryAfterSec,
      });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!this.verifyCredentials(username, password)) {
      const afterFailure = this.recordLoginFailure(clientIp);
      if (!afterFailure.allowed) {
        res.setHeader('Retry-After', String(afterFailure.retryAfterSec));
        res.status(429).json({
          error: `Too many failed sign-in attempts. Try again in ${Math.ceil(afterFailure.retryAfterSec / 60)} minute(s).`,
          retryAfterSec: afterFailure.retryAfterSec,
        });
        return;
      }
      res.status(401).json({
        error: this.isUsernameRequired()
          ? 'Invalid username or password.'
          : 'Invalid password.',
        remainingAttempts: afterFailure.remainingAttempts,
      });
      return;
    }

    this.resetLoginRateLimit(clientIp);
    const token = this.issueSessionToken();
    const secure = isRequestSecure(req);
    res.setHeader(
      'Set-Cookie',
      buildSessionCookieHeader(token, {
        secure,
        maxAgeSec: Math.floor(this.sessionTtlMs / 1000),
      }),
    );
    res.status(200).json({
      ok: true,
      enabled: true,
      authenticated: true,
      usernameRequired: this.isUsernameRequired(),
    });
  };

  handleLogout = (req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    if (this.isEnabled() && !verifyCsrfProtection(req)) {
      res.status(403).json({ error: 'Cross-site sign-out request blocked' });
      return;
    }
    const secure = isRequestSecure(req);
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader({ secure }));
    res.status(200).json({
      ok: true,
      enabled: this.isEnabled(),
      authenticated: !this.isEnabled(),
      usernameRequired: this.isEnabled() ? this.isUsernameRequired() : false,
    });
  };

  requireAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!this.isEnabled()) {
      next();
      return;
    }

    if (!this.isRequestAuthenticated(req)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json({
        error: 'Authentication required',
        authRequired: true,
      });
      return;
    }

    if (!verifyCsrfProtection(req)) {
      res.status(403).json({
        error: 'Cross-site state-changing request blocked',
      });
      return;
    }

    next();
  };
}
