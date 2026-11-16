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

  recordSuccess(latencyMs: number): void {
    this.totalRequests += 1;
    this.totalLatencyMs += latencyMs;
    this.consecutiveSuccesses += 1;

    // Gentle additive tightening after sustained healthy responses
    if (this.consecutiveSuccesses >= 5 && this.currentDelayMs > this.minDelayMs) {
      const step = Math.max(50, Math.round((this.currentDelayMs - this.minDelayMs) * 0.15));
      this.currentDelayMs = Math.max(this.minDelayMs, this.currentDelayMs - step);
      this.consecutiveSuccesses = 0;
    }

    this.pushSample(latencyMs, false);
  }

  recordThrottle(retryAfterSeconds?: number, latencyMs = 0): number {
    this.totalRequests += 1;
    this.totalLatencyMs += latencyMs;
    this.consecutiveSuccesses = 0;
    this.rateLimitHits += 1;

    const multiplied = Math.round(Math.max(this.baseDelayMs, this.currentDelayMs) * this.backoffMultiplier);
    const retryMs = retryAfterSeconds ? Math.round(retryAfterSeconds * 1000) : 0;
    const nextDelay = Math.min(this.maxDelayMs, Math.max(multiplied, retryMs));

    this.currentDelayMs = nextDelay;
    const cooldownMs = Math.max(nextDelay, retryMs || nextDelay);
    this.cooldownUntilMs = Date.now() + cooldownMs;

    this.pushSample(latencyMs, true);
    return cooldownMs;
  }

  recordError(latencyMs = 0): void {
    this.totalRequests += 1;
    this.totalLatencyMs += latencyMs;
    this.consecutiveSuccesses = 0;
    this.currentDelayMs = Math.min(this.maxDelayMs, Math.round(this.currentDelayMs * 1.4));
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
