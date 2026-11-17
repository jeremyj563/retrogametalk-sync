export type PacingProfileId = 'gentle' | 'balanced' | 'brisk';

export interface PacingNumericValues {
  baseDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxRetries: number;
  maxConcurrency: number;
  requestTimeoutMs: number;
}

export interface PacingProfileDefinition {
  id: PacingProfileId;
  label: string;
  recommended?: boolean;
  rateLabel: string;
  tagline: string;
  description: string;
  values: PacingNumericValues;
}

export const PACING_PROFILES: PacingProfileDefinition[] = [
  {
    id: 'gentle',
    label: 'Gentle',
    rateLabel: '~20–35 req/min',
    tagline: 'Extra polite single-stream pacing',
    description:
      'Waits ~2.5s between page requests (never faster than 1.5s) using 1 sequential worker. Ideal for 24/7 background NAS mirrors or shared connections.',
    values: {
      baseDelayMs: 2500,
      minDelayMs: 1500,
      maxDelayMs: 90000,
      backoffMultiplier: 2.2,
      maxRetries: 5,
      maxConcurrency: 1,
      requestTimeoutMs: 45000,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    recommended: true,
    rateLabel: '~40–80 req/min',
    tagline: 'Site-friendly default pacing',
    description:
      'Starts at 1.5s spacing and smoothly speeds up to 0.75s during clean streaks. Automatically pauses and cools down if RetroGameTalk signals busy traffic.',
    values: {
      baseDelayMs: 1500,
      minDelayMs: 750,
      maxDelayMs: 60000,
      backoffMultiplier: 2.0,
      maxRetries: 4,
      maxConcurrency: 1,
      requestTimeoutMs: 30000,
    },
  },
  {
    id: 'brisk',
    label: 'Brisk',
    rateLabel: '~75–130 req/min',
    tagline: 'Faster multi-page catalog scans',
    description:
      'Uses 2 parallel page workers starting at 0.9s spacing (down to 0.45s on clean streaks) while keeping automatic busy-server cooldowns active.',
    values: {
      baseDelayMs: 900,
      minDelayMs: 450,
      maxDelayMs: 45000,
      backoffMultiplier: 1.8,
      maxRetries: 4,
      maxConcurrency: 2,
      requestTimeoutMs: 30000,
    },
  },
];

export function detectPacingProfile(values: PacingNumericValues): PacingProfileId | 'custom' {
  for (const profile of PACING_PROFILES) {
    const v = profile.values;
    if (
      values.baseDelayMs === v.baseDelayMs &&
      values.minDelayMs === v.minDelayMs &&
      values.maxDelayMs === v.maxDelayMs &&
      Math.abs(values.backoffMultiplier - v.backoffMultiplier) < 0.001 &&
      values.maxRetries === v.maxRetries &&
      values.maxConcurrency === v.maxConcurrency &&
      values.requestTimeoutMs === v.requestTimeoutMs
    ) {
      return profile.id;
    }
  }
  return 'custom';
}

export function formatSecondsCompact(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const sec = ms / 1000;
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(2).replace(/0$/, '')}s`;
}

export function describeCurrentPacing(values: PacingNumericValues): {
  spacingSummary: string;
  workersSummary: string;
  cooldownSummary: string;
} {
  const spacingSummary =
    values.baseDelayMs <= values.minDelayMs
      ? `${formatSecondsCompact(values.minDelayMs)} steady spacing`
      : `Starts at ${formatSecondsCompact(values.baseDelayMs)}, speeds up to ${formatSecondsCompact(values.minDelayMs)} on clean streaks`;

  const workersSummary =
    values.maxConcurrency === 1
      ? '1 sequential worker'
      : `${values.maxConcurrency} parallel workers`;

  const cooldownSummary = `Auto-cools down (${values.backoffMultiplier}x up to ${formatSecondsCompact(values.maxDelayMs)}, ${values.maxRetries} ${values.maxRetries === 1 ? 'retry' : 'retries'}) on HTTP 429/503`;

  return {
    spacingSummary,
    workersSummary,
    cooldownSummary,
  };
}
