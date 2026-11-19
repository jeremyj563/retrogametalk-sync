import { logServer } from './logger.ts';
import type { RateLimitSample, RateLimiterTelemetry } from './types.ts';

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Adaptive AIMD (Additive Increase / Multiplicative Decrease) rate limiter
 * with jittered token pacing and Retry-After cooldown honoring.
 */
export class AdaptiveRateLimiter {
  private currentDelayMs: number;
  private minDelayMs: number;
  private maxDelayMs: number;
  private baseDelayMs: number;
  private backoffMultiplier: number;

  private consecutiveSuccesses = 0;
  private rateLimitHits = 0;
  private cooldownUntilMs: number | null = null;
  private lastThrottleEscalationAt = 0;
  private lastErrorEscalationAt = 0;
  private lastRequestAt = 0;
  private totalRequests = 0;
  private totalLatencyMs = 0;
  private history: RateLimitSample[] = [];
  private gatePromise: Promise<void> = Promise.resolve();

  constructor(opts: {
    baseDelayMs: number;
    minDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  }) {
    this.baseDelayMs = opts.baseDelayMs;
    this.minDelayMs = opts.minDelayMs;
    this.maxDelayMs = opts.maxDelayMs;
    this.backoffMultiplier = opts.backoffMultiplier;
    this.currentDelayMs = opts.baseDelayMs;
  }

  updateBounds(opts: {
    baseDelayMs: number;
    minDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  }): void {
    this.baseDelayMs = opts.baseDelayMs;
    this.minDelayMs = opts.minDelayMs;
    this.maxDelayMs = opts.maxDelayMs;
    this.backoffMultiplier = opts.backoffMultiplier;
    this.currentDelayMs = Math.max(this.minDelayMs, Math.min(this.maxDelayMs, this.currentDelayMs));
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    // Serialize gate checks across concurrent workers so spacing is strictly honored
    const prev = this.gatePromise;
    let release!: () => void;
    this.gatePromise = new Promise<void>((res) => {
      release = res;
    });

    try {
      await prev;
      const now = Date.now();
      let waitMs = 0;

      if (this.cooldownUntilMs && this.cooldownUntilMs > now) {
        waitMs = Math.max(waitMs, this.cooldownUntilMs - now);
      }

      if (this.lastRequestAt > 0) {
        const jitterFactor = 0.85 + Math.random() * 0.3; // ±15% polite jitter
        const targetGap = Math.round(this.currentDelayMs * jitterFactor);
        const elapsed = now - this.lastRequestAt;
        if (elapsed < targetGap) {
          waitMs = Math.max(waitMs, targetGap - elapsed);
        }
      }

      if (waitMs > 0) {
        if (waitMs >= 1500) {
          logServer(
            'RATE_LIMITER',
            'debug',
            `Pacing request for ${waitMs}ms`,
            `currentDelayMs=${this.currentDelayMs}, cooldownActive=${Boolean(this.cooldownUntilMs && this.cooldownUntilMs > now)}`,
          );
        }
        await sleepWithAbort(waitMs, signal);
      }

      this.lastRequestAt = Date.now();
      if (this.cooldownUntilMs && this.cooldownUntilMs <= this.lastRequestAt) {
        this.cooldownUntilMs = null;
      }
    } finally {
      release();
    }
  }

  getCooldownRemainingMs(): number {
    if (!this.cooldownUntilMs) return 0;
    const remaining = this.cooldownUntilMs - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Shared cooldown barrier for sibling byte-range workers once an origin URL
   * has already passed the main acquire() gate. Waits cleanly if any sibling or
   * worker triggered an upstream 429/503 cooldown.
   */
  async waitForCooldown(signal?: AbortSignal): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const remaining = this.getCooldownRemainingMs();
      if (remaining <= 0) {
        return;
      }
      await sleepWithAbort(remaining, signal);
    }
  }

  recordSuccess(latencyMs: number): void {
    this.totalRequests += 1;
    this.totalLatencyMs += latencyMs;
    this.consecutiveSuccesses += 1;

    const recoveryThreshold = this.currentDelayMs > this.baseDelayMs * 2 ? 3 : 4;
    if (this.consecutiveSuccesses >= recoveryThreshold && this.currentDelayMs > this.minDelayMs) {
      const prevDelay = this.currentDelayMs;
      const decayRatio = this.currentDelayMs > this.baseDelayMs * 2 ? 0.25 : 0.18;
      const step = Math.max(60, Math.round((this.currentDelayMs - this.minDelayMs) * decayRatio));
      this.currentDelayMs = Math.max(this.minDelayMs, this.currentDelayMs - step);
      this.consecutiveSuccesses = 0;
      logServer(
        'RATE_LIMITER',
        'debug',
        `AIMD delay tightened ${prevDelay}ms -> ${this.currentDelayMs}ms`,
        `latency=${Math.round(latencyMs)}ms`,
      );
    }

    this.pushSample(latencyMs, false);
  }

  recordThrottle(
    retryAfterSeconds?: number,
    latencyMs = 0,
    options: { escalateGlobalDelay?: boolean; localSettleMs?: number } = {},
  ): number {
    this.totalRequests += 1;
    this.totalLatencyMs += latencyMs;
    const now = Date.now();
    const retryMs = retryAfterSeconds ? Math.round(retryAfterSeconds * 1000) : 0;

    // Mirror multi-connection 503 rejections (e.g. parallel HTTP Range slices) and post-burst
    // mirror cooldown windows should step down/settle locally without poisoning global WordPress API pacing.
    if (options.escalateGlobalDelay === false) {
      const localCooldownMs = Math.min(
        20_000,
        Math.max(2000, retryMs || options.localSettleMs || 2500),
      );
      logServer(
        'RATE_LIMITER',
        'debug',
        `Mirror connection limit detected; keeping API delay at ${this.currentDelayMs}ms (local settle=${localCooldownMs}ms)`,
        `retryAfter=${retryAfterSeconds ?? 'none'}s`,
      );
      this.pushSample(latencyMs, true);
      return localCooldownMs;
    }

    this.consecutiveSuccesses = 0;
    this.rateLimitHits += 1;

    // Deduplicate overlapping 429/503 rejections from concurrent workers within an active
    // cooldown or 2.5s burst window so delay never multiplies exponentially (e.g. 1.8^N).
    const withinCooldownBurst =
      (this.cooldownUntilMs !== null && now < this.cooldownUntilMs) ||
      now - this.lastThrottleEscalationAt < 2500;

    if (withinCooldownBurst) {
      const remaining = this.getCooldownRemainingMs();
      const cooldownMs = Math.max(remaining, retryMs, this.currentDelayMs);
      this.cooldownUntilMs = Math.max(this.cooldownUntilMs ?? 0, now + cooldownMs);
      logServer(
        'RATE_LIMITER',
        'debug',
        `Coalesced concurrent throttle burst (delay steady at ${this.currentDelayMs}ms, cooldown=${cooldownMs}ms)`,
        `retryAfter=${retryAfterSeconds ?? 'none'}s, hits=${this.rateLimitHits}`,
      );
      this.pushSample(latencyMs, true);
      return cooldownMs;
    }

    const prevDelay = this.currentDelayMs;
    const multiplied = Math.round(
      Math.max(this.baseDelayMs, this.currentDelayMs) * this.backoffMultiplier,
    );
    const nextDelay = Math.min(this.maxDelayMs, Math.max(multiplied, retryMs));

    this.currentDelayMs = nextDelay;
    this.lastThrottleEscalationAt = now;
    const cooldownMs = Math.min(this.maxDelayMs, Math.max(nextDelay, retryMs || nextDelay));
    this.cooldownUntilMs = now + cooldownMs;

    logServer(
      'RATE_LIMITER',
      'debug',
      `AIMD throttle backoff ${prevDelay}ms -> ${this.currentDelayMs}ms (cooldown=${cooldownMs}ms)`,
      `retryAfter=${retryAfterSeconds ?? 'none'}s, hits=${this.rateLimitHits}`,
    );

    this.pushSample(latencyMs, true);
    return cooldownMs;
  }

  recordError(latencyMs = 0): void {
    this.totalRequests += 1;
    this.totalLatencyMs += latencyMs;
    this.consecutiveSuccesses = 0;
    const now = Date.now();
    if (now - this.lastErrorEscalationAt >= 2500) {
      const prevDelay = this.currentDelayMs;
      const errorCap = Math.min(this.maxDelayMs, Math.max(this.baseDelayMs * 4, 8000));
      this.currentDelayMs = Math.min(errorCap, Math.max(this.currentDelayMs, Math.round(this.currentDelayMs * 1.25)));
      this.lastErrorEscalationAt = now;
      logServer(
        'RATE_LIMITER',
        'debug',
        `AIMD error backoff ${prevDelay}ms -> ${this.currentDelayMs}ms`,
        `latency=${Math.round(latencyMs)}ms`,
      );
    }
    this.pushSample(latencyMs, false);
  }

  private pushSample(latencyMs: number, throttled: boolean): void {
    this.history.push({
      timestamp: new Date().toISOString(),
      delayMs: this.currentDelayMs,
      latencyMs: Math.round(latencyMs),
      throttled,
    });
    if (this.history.length > 120) {
      this.history.shift();
    }
  }

  getTelemetry(): RateLimiterTelemetry {
    return {
      currentDelayMs: this.currentDelayMs,
      minDelayMs: this.minDelayMs,
      maxDelayMs: this.maxDelayMs,
      baseDelayMs: this.baseDelayMs,
      backoffMultiplier: this.backoffMultiplier,
      consecutiveSuccesses: this.consecutiveSuccesses,
      rateLimitHits: this.rateLimitHits,
      cooldownUntilMs: this.cooldownUntilMs && this.cooldownUntilMs > Date.now() ? this.cooldownUntilMs : null,
      avgLatencyMs: this.totalRequests > 0 ? Math.round(this.totalLatencyMs / this.totalRequests) : 0,
      totalRequests: this.totalRequests,
      history: [...this.history],
    };
  }
}
