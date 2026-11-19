import type {
  AchievementRecord,
  AchievementsSnapshot,
  AchievementsSummary,
  ClientAchievementEventType,
} from '../shared/achievements';
import { readJsonSafely } from './http';

const QUIET_MODE_STORAGE_KEY = 'rgt_achievements_quiet_mode_v1';

// One-shot UI interaction events that only need to be reported once per page session
const SESSION_ONCE_EVENTS = new Set<ClientAchievementEventType>([
  'detail_view',
  'lightbox_view',
  'filter_combo',
  'view_mode_grid',
  'view_mode_table',
  'catalog_stats_view',
  'crt_palette_amber',
  'crt_palette_cyan',
  'crt_motion_ultra',
  'crt_slider_tuned',
  'arcade_opened',
  'arcade_konami',
  'arcade_stage_clear',
  'arcade_invaders_milestone',
  'arcade_snake_milestone',
  'arcade_tetromino_quad',
  'easter_barrel_roll',
  'easter_blow_cartridge',
]);

const reportedThisSession = new Set<string>();

type AchievementEventListener = (payload: {
  newlyUnlocked: AchievementRecord[];
  snapshot: AchievementsSnapshot;
}) => void;

const listeners = new Set<AchievementEventListener>();

export function subscribeAchievementClientUpdates(
  listener: AchievementEventListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadAchievementsQuietMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(QUIET_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAchievementsQuietMode(quiet: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUIET_MODE_STORAGE_KEY, quiet ? '1' : '0');
  } catch {
    // Ignore private-mode storage errors
  }
}

export async function fetchAchievementsSnapshot(): Promise<AchievementsSnapshot | null> {
  try {
    const res = await fetch('/api/achievements');
    const parsed = await readJsonSafely<AchievementsSnapshot>(res);
    return parsed.ok && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function markAchievementsSeenApi(
  ids?: string[],
): Promise<AchievementsSummary | null> {
  try {
    const res = await fetch('/api/achievements/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    const parsed = await readJsonSafely<{ ok?: boolean; summary?: AchievementsSummary }>(res);
    return parsed.ok && parsed.data?.summary ? parsed.data.summary : null;
  } catch {
    return null;
  }
}

export function reportAchievementEvent(
  type: ClientAchievementEventType,
  value?: number,
): void {
  if (typeof window === 'undefined') return;
  if (SESSION_ONCE_EVENTS.has(type)) {
    if (reportedThisSession.has(type)) return;
    reportedThisSession.add(type);
  } else if (type === 'arcade_cart_played' && typeof value === 'number') {
    const key = `${type}:${value}`;
    if (reportedThisSession.has(key)) return;
    reportedThisSession.add(key);
  }

  const localHour = new Date().getHours();
  void fetch('/api/achievements/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      value,
      localHour,
    }),
  })
    .then(async (res) => {
      const parsed = await readJsonSafely<{
        newlyUnlocked?: AchievementRecord[];
        snapshot?: AchievementsSnapshot;
      }>(res);
      if (parsed.ok && parsed.data?.snapshot) {
        const newlyUnlocked = Array.isArray(parsed.data.newlyUnlocked)
          ? parsed.data.newlyUnlocked
          : [];
        for (const listener of listeners) {
          listener({ newlyUnlocked, snapshot: parsed.data.snapshot });
        }
      }
    })
    .catch(() => {
      // Never surface background achievement telemetry failures to UI
    });
}
