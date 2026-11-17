export type ScheduleVisualMode = 'interval' | 'daily' | 'weekly' | 'custom';

export interface ParsedScheduleState {
  mode: ScheduleVisualMode;
  everyHours: number;
  minute: number;
  hour: number;
  daysOfWeek: number[];
}

export const INTERVAL_HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;

export const MINUTE_PRESET_OPTIONS = [0, 15, 30, 45] as const;

export const DAILY_TIME_PRESETS: { label: string; hour: number; minute: number }[] = [
  { label: '00:00 Midnight', hour: 0, minute: 0 },
  { label: '03:00 Overnight', hour: 3, minute: 0 },
  { label: '06:00 Morning', hour: 6, minute: 0 },
  { label: '12:00 Noon', hour: 12, minute: 0 },
  { label: '18:00 Evening', hour: 18, minute: 0 },
];

export const WEEKDAY_OPTIONS: { value: number; shortLabel: string; fullLabel: string }[] = [
  { value: 0, shortLabel: 'Sun', fullLabel: 'Sunday' },
  { value: 1, shortLabel: 'Mon', fullLabel: 'Monday' },
  { value: 2, shortLabel: 'Tue', fullLabel: 'Tuesday' },
  { value: 3, shortLabel: 'Wed', fullLabel: 'Wednesday' },
  { value: 4, shortLabel: 'Thu', fullLabel: 'Thursday' },
  { value: 5, shortLabel: 'Fri', fullLabel: 'Friday' },
  { value: 6, shortLabel: 'Sat', fullLabel: 'Saturday' },
];

function pad2(n: number): string {
  return String(Math.max(0, Math.min(59, Math.trunc(n)))).padStart(2, '0');
}

export function formatUtcTime(hour: number, minute: number): string {
  const h = String(Math.max(0, Math.min(23, Math.trunc(hour)))).padStart(2, '0');
  return `${h}:${pad2(minute)} UTC`;
}

function normalizeDaysOfWeek(days: number[]): number[] {
  const unique = new Set<number>();
  for (const d of days) {
    const normalized = d === 7 ? 0 : d;
    if (Number.isInteger(normalized) && normalized >= 0 && normalized <= 6) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
}

export function parseCronToVisualState(rawCron: string): ParsedScheduleState {
  const trimmed = rawCron.trim();
  const parts = trimmed.split(/\s+/);

  const fallback: ParsedScheduleState = {
    mode: 'custom',
    everyHours: 6,
    minute: 0,
    hour: 3,
    daysOfWeek: [0],
  };

  if (parts.length !== 5) {
    return fallback;
  }

  const [minPart, hourPart, domPart, monthPart, dowPart] = parts;

  if (!/^\d{1,2}$/.test(minPart)) {
    return fallback;
  }
  const minute = Number(minPart);
  if (minute < 0 || minute > 59) {
    return fallback;
  }

  // Hourly or Every N Hours: M * * * * or M */N * * *
  if (domPart === '*' && monthPart === '*' && dowPart === '*') {
    if (hourPart === '*' || hourPart === '*/1') {
      return {
        mode: 'interval',
        everyHours: 1,
        minute,
        hour: 0,
        daysOfWeek: [0],
      };
    }

    const stepMatch = hourPart.match(/^\*\/(\d{1,2})$/);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      if ((INTERVAL_HOUR_OPTIONS as readonly number[]).includes(step)) {
        return {
          mode: 'interval',
          everyHours: step,
          minute,
          hour: 0,
          daysOfWeek: [0],
        };
      }
    }
  }

  // Daily or Weekly at specific hour:minute
  if (/^\d{1,2}$/.test(hourPart) && domPart === '*' && monthPart === '*') {
    const hour = Number(hourPart);
    if (hour >= 0 && hour <= 23) {
      if (dowPart === '*') {
        return {
          mode: 'daily',
          everyHours: 6,
          minute,
          hour,
          daysOfWeek: [0],
        };
      }

      if (/^[0-7](?:,[0-7])*$/.test(dowPart)) {
        const parsedDays = normalizeDaysOfWeek(dowPart.split(',').map(Number));
        if (parsedDays.length > 0 && parsedDays.length < 7) {
          return {
            mode: 'weekly',
            everyHours: 6,
            minute,
            hour,
            daysOfWeek: parsedDays,
          };
        }
        if (parsedDays.length === 7) {
          return {
            mode: 'daily',
            everyHours: 6,
            minute,
            hour,
            daysOfWeek: [0],
          };
        }
      }
    }
  }

  return fallback;
}

export function buildCronFromVisualState(state: ParsedScheduleState): string {
  const minute = Math.max(0, Math.min(59, Math.trunc(state.minute)));
  const hour = Math.max(0, Math.min(23, Math.trunc(state.hour)));

  if (state.mode === 'interval') {
    const every = Math.max(1, Math.min(23, Math.trunc(state.everyHours)));
    return every === 1 ? `${minute} * * * *` : `${minute} */${every} * * *`;
  }

  if (state.mode === 'daily') {
    return `${minute} ${hour} * * *`;
  }

  if (state.mode === 'weekly') {
    const days = normalizeDaysOfWeek(state.daysOfWeek);
    const dowField = days.length > 0 ? days.join(',') : '0';
    return `${minute} ${hour} * * ${dowField}`;
  }

  return '0 */6 * * *';
}

function validateCronField(field: string, min: number, max: number): boolean {
  if (!field) return false;
  const segments = field.split(',');
  for (const seg of segments) {
    if (!seg) return false;
    const [rangePart, stepPart, extra] = seg.split('/');
    if (extra !== undefined) return false;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) <= 0) return false;
    }

    if (rangePart === '*') continue;

    if (rangePart.includes('-')) {
      const [startStr, endStr, extraDash] = rangePart.split('-');
      if (extraDash !== undefined || !/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        return false;
      }
      const start = Number(startStr);
      const end = Number(endStr);
      if (start < min || end > max || start > end) return false;
      continue;
    }

    if (!/^\d+$/.test(rangePart)) return false;
    const val = Number(rangePart);
    if (val < min || val > max) return false;
  }
  return true;
}

export function validateCronExpression(rawCron: string): { valid: boolean; error: string | null } {
  const trimmed = rawCron.trim();
  if (!trimmed) {
    return { valid: false, error: 'Enter a 5-field cron expression (for example: 0 */6 * * *).' };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day month weekday), found ${parts.length}.`,
    };
  }

  const [minF, hourF, domF, monthF, dowF] = parts;
  if (!validateCronField(minF, 0, 59)) {
    return { valid: false, error: 'Minute field must be between 0 and 59.' };
  }
  if (!validateCronField(hourF, 0, 23)) {
    return { valid: false, error: 'Hour field must be between 0 and 23.' };
  }
  if (!validateCronField(domF, 1, 31)) {
    return { valid: false, error: 'Day-of-month field must be between 1 and 31.' };
  }
  if (!validateCronField(monthF, 1, 12)) {
    return { valid: false, error: 'Month field must be between 1 and 12.' };
  }
  if (!validateCronField(dowF, 0, 7)) {
    return { valid: false, error: 'Day-of-week field must be between 0 and 7 (0 or 7 = Sunday).' };
  }

  return { valid: true, error: null };
}

export function describeCronExpression(rawCron: string): string {
  const validation = validateCronExpression(rawCron);
  if (!validation.valid) {
    return 'Invalid cron expression';
  }

  const parsed = parseCronToVisualState(rawCron);
  if (parsed.mode === 'interval') {
    const minSuffix =
      parsed.minute === 0 ? 'on the hour' : `at :${pad2(parsed.minute)} past the hour`;
    if (parsed.everyHours === 1) {
      return `Every hour ${minSuffix} (UTC)`;
    }
    return `Every ${parsed.everyHours} hours ${minSuffix} (UTC)`;
  }

  if (parsed.mode === 'daily') {
    return `Daily at ${formatUtcTime(parsed.hour, parsed.minute)}`;
  }

  if (parsed.mode === 'weekly') {
    const dayLabels = parsed.daysOfWeek
      .map((d) => WEEKDAY_OPTIONS.find((w) => w.value === d)?.shortLabel ?? String(d))
      .join(', ');
    return `Every ${dayLabels} at ${formatUtcTime(parsed.hour, parsed.minute)}`;
  }

  // Handle */N minute schedules gracefully in custom mode
  const parts = rawCron.trim().split(/\s+/);
  const minStep = parts[0]?.match(/^\*\/(\d{1,2})$/);
  if (minStep && parts[1] === '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    return `Every ${Number(minStep[1])} minutes (UTC)`;
  }

  return `Custom schedule (${rawCron.trim()} UTC)`;
}
