export type CatalogRatingFilterMode = 'all' | 'rated' | 'unrated';

export const MIN_USER_RATING_FILTER = 0.5;
export const MAX_USER_RATING_FILTER = 5.0;

export const RATING_PRESET_THRESHOLDS: readonly number[] = [4.8, 4.5, 4.0, 3.5, 3.0] as const;

/**
 * Normalizes a raw RGT Users Score into a 1-decimal number in [0.1, 5.0],
 * or null when unrated ("0", empty, N/A, non-finite, out of range).
 */
export function normalizeUserRating(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let numeric: number;
  if (typeof raw === 'number') {
    numeric = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Match leading rating number such as "4.9", "5", "4.8 / 5", "4.7 out of 5"
    const match = trimmed.match(/(\d+(?:\.\d+)?)/);
    if (!match?.[1]) return null;
    numeric = Number(match[1]);
  } else {
    return null;
  }

  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 5.0) return null;
  const rounded = Math.round(numeric * 10) / 10;
  return rounded > 0 && rounded <= 5.0 ? rounded : null;
}

/**
 * Normalizes a user-chosen minimum rating filter threshold (down to the tenth, 0.5–5.0).
 */
export function normalizeMinRatingFilter(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < MIN_USER_RATING_FILTER) return null;
  const clamped = Math.min(MAX_USER_RATING_FILTER, Math.max(MIN_USER_RATING_FILTER, n));
  return Math.round(clamped * 10) / 10;
}

export function normalizeCatalogRatingMode(raw: unknown): CatalogRatingFilterMode {
  if (raw === 'rated' || raw === 'unrated') return raw;
  return 'all';
}

export function normalizeVoteCount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Formats a Users Score consistently to one decimal place (e.g. 5 -> "5.0", 4.7 -> "4.7").
 */
export function formatUserRating(rating: number | null | undefined): string {
  const clean = normalizeUserRating(rating);
  if (clean === null) return '—';
  return clean.toFixed(1);
}

/**
 * Parses compact human counters like "11.8k", "854", "1.2M", or "12,480" into an integer.
 */
export function parseCompactCount(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.replace(/,/g, '').trim();
  if (!clean) return null;
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!match?.[1]) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base < 0) return null;
  const unit = (match[2] || '').toLowerCase();
  const mult = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : unit === 'b' ? 1_000_000_000 : 1;
  return Math.round(base * mult);
}

export function formatRatingFilterButtonLabel(
  minRating: number | null,
  ratingMode: CatalogRatingFilterMode,
): string {
  if (ratingMode === 'unrated') return 'Unrated';
  if (minRating !== null) return `≥ ${minRating.toFixed(1)}★`;
  if (ratingMode === 'rated') return 'Rated';
  return 'Score';
}
