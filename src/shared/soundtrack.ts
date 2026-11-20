export type MusicTrackId =
  | 'phosphor_idle'
  | 'bitplane_bounce'
  | 'outrun_crt'
  | 'fm_cartridge_drive'
  | 'subcarrier_pulse'
  | 'cyberdeck_horizon'
  | 'broadcast_finale';

export type MusicPlaybackMode = 'loop' | 'cycle' | 'shuffle';

export interface MusicTrackDefinition {
  id: MusicTrackId;
  title: string;
  shortTitle: string;
  genre: string;
  bpm: number;
  requiredPoints: number;
  description: string;
  /** Number of 4-bar loops to play before auto-advancing in Cycle or Shuffle mode */
  loopsBeforeAdvance: number;
}

export interface SoundtrackPrefs {
  trackId: MusicTrackId;
  volume: number;
  muted: boolean;
  playbackMode: MusicPlaybackMode;
}

export const SOUNDTRACK_PREFS_STORAGE_KEY = 'rgt_soundtrack_prefs_v1';
export const SOUNDTRACK_SEEN_TRACKS_STORAGE_KEY = 'rgt_soundtrack_seen_tracks_v1';
export const STARTER_TRACK_ID: MusicTrackId = 'phosphor_idle';

export const DEFAULT_SOUNDTRACK_PREFS: SoundtrackPrefs = {
  trackId: STARTER_TRACK_ID,
  volume: 45,
  muted: false,
  playbackMode: 'loop',
};

export const SOUNDTRACK_TRACKS: readonly MusicTrackDefinition[] = [
  {
    id: 'phosphor_idle',
    title: 'Neon Corridor',
    shortTitle: 'Corridor',
    genre: 'Chiptune Breakbeat',
    bpm: 128,
    requiredPoints: 0,
    description:
      'Starter soundtrack (Corpse Party PSP Ch. 1 vibe): rapid 8-bit chiptune arps dropping into funky electro-breakbeat bass and lush arcade synth-funk.',
    loopsBeforeAdvance: 2,
  },
  {
    id: 'bitplane_bounce',
    title: 'Velvet Machinery',
    shortTitle: 'Machinery',
    genre: '90s FM Jazz-Fusion',
    bpm: 118,
    requiredPoints: 150,
    description:
      'Escape Goat: Machinery vibe — punchy slap-bass pocket, warm DX7 electric piano minor-9ths, sparkly bells, and soulful gliding FM lead.',
    loopsBeforeAdvance: 2,
  },
  {
    id: 'outrun_crt',
    title: 'Celestial Assembly',
    shortTitle: 'Assembly',
    genre: 'Cosmic Synthwave',
    bpm: 120,
    requiredPoints: 400,
    description:
      'Sea of Stars (Assembly Line vibe): rubbery electro-funk bass, 80s gated snare & claps, machine-break fills, and soaring cosmic synth pads.',
    loopsBeforeAdvance: 2,
  },
  {
    id: 'fm_cartridge_drive',
    title: 'Ironworks Sector',
    shortTitle: 'Ironworks',
    genre: '16-Bit Industrial',
    bpm: 130,
    requiredPoints: 650,
    description:
      'DKC Fear Factory vibe — hypnotic D-minor resonant industrial bass, metallic clanks & rimshots, sweeping SNES strings climax, and ethereal bell breakdown.',
    loopsBeforeAdvance: 2,
  },
  {
    id: 'subcarrier_pulse',
    title: 'Ultra Combo',
    shortTitle: 'Ultra Combo',
    genre: 'Arcade Industrial',
    bpm: 110,
    requiredPoints: 950,
    description:
      'Killer Instinct vibe — swaggering 110 BPM breakbeat, cab-filtered distorted power-chord riffs, bold brass stabs, and dark sci-fi synth pads.',
    loopsBeforeAdvance: 2,
  },
  {
    id: 'cyberdeck_horizon',
    title: 'Phobos Gate',
    shortTitle: 'Phobos Gate',
    genre: 'Heavy Thrash Metal',
    bpm: 120,
    requiredPoints: 1300,
    description:
      'Doom E1M1 vibe — razor-tight cab-shaped 16th-note pedal-E power-chord chugs, subdominant A-minor shift, roaring drums, and twin-lead harmonies.',
    loopsBeforeAdvance: 2,
  },
  {
    id: 'broadcast_finale',
    title: 'Lunar Core: Final Phase',
    shortTitle: 'Final Phase',
    genre: '16-Bit Boss Anthem',
    bpm: 152,
    requiredPoints: 1650,
    description:
      'FFIV Zeromus vibe — gothic drawbar pipe-organ prelude, blazing 16th-note fanfare, heroic SNES brass & strings, and syncopated bass/timpani break.',
    loopsBeforeAdvance: 2,
  },
];

export const SOUNDTRACK_TRACK_BY_ID: Record<MusicTrackId, MusicTrackDefinition> =
  SOUNDTRACK_TRACKS.reduce(
    (acc, track) => {
      acc[track.id] = track;
      return acc;
    },
    {} as Record<MusicTrackId, MusicTrackDefinition>,
  );

export function isValidMusicTrackId(val: unknown): val is MusicTrackId {
  return typeof val === 'string' && val in SOUNDTRACK_TRACK_BY_ID;
}

export function isValidPlaybackMode(val: unknown): val is MusicPlaybackMode {
  return val === 'loop' || val === 'cycle' || val === 'shuffle';
}

export function clampMusicVolume(raw: unknown, fallback = DEFAULT_SOUNDTRACK_PREFS.volume): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function isMusicTrackUnlocked(trackId: MusicTrackId, earnedPoints: number): boolean {
  const track = SOUNDTRACK_TRACK_BY_ID[trackId];
  if (!track) return false;
  return earnedPoints >= track.requiredPoints;
}

export function getUnlockedTracks(earnedPoints: number): MusicTrackDefinition[] {
  return SOUNDTRACK_TRACKS.filter((track) => earnedPoints >= track.requiredPoints);
}

export function resolveEffectiveTrackId(
  selectedTrackId: MusicTrackId,
  earnedPoints: number,
  achievementsLoaded: boolean,
): MusicTrackId {
  if (!isValidMusicTrackId(selectedTrackId)) {
    return STARTER_TRACK_ID;
  }
  if (!achievementsLoaded) {
    return selectedTrackId;
  }
  return isMusicTrackUnlocked(selectedTrackId, earnedPoints) ? selectedTrackId : STARTER_TRACK_ID;
}

export function pickNextTrackId(
  currentTrackId: MusicTrackId,
  unlockedTrackIds: readonly MusicTrackId[],
  mode: MusicPlaybackMode,
  direction: 'next' | 'prev' = 'next',
  rng: () => number = Math.random,
): MusicTrackId {
  if (unlockedTrackIds.length === 0) {
    return STARTER_TRACK_ID;
  }
  if (unlockedTrackIds.length === 1) {
    return unlockedTrackIds[0];
  }

  if (mode === 'shuffle' && direction === 'next') {
    const candidates = unlockedTrackIds.filter((id) => id !== currentTrackId);
    const pool = candidates.length > 0 ? candidates : unlockedTrackIds;
    const rawIdx = Math.floor(Math.max(0, Math.min(0.999999, rng())) * pool.length);
    return pool[rawIdx] ?? pool[0];
  }

  const currentIdx = unlockedTrackIds.indexOf(currentTrackId);
  if (currentIdx === -1) {
    return unlockedTrackIds[0];
  }
  const delta = direction === 'prev' ? -1 : 1;
  const nextIdx = (currentIdx + delta + unlockedTrackIds.length) % unlockedTrackIds.length;
  return unlockedTrackIds[nextIdx];
}

export function loadSoundtrackPrefs(): SoundtrackPrefs {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SOUNDTRACK_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(SOUNDTRACK_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SOUNDTRACK_PREFS };
    const parsed = JSON.parse(raw) as Partial<SoundtrackPrefs>;
    return {
      trackId: isValidMusicTrackId(parsed.trackId)
        ? parsed.trackId
        : DEFAULT_SOUNDTRACK_PREFS.trackId,
      volume: clampMusicVolume(parsed.volume, DEFAULT_SOUNDTRACK_PREFS.volume),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SOUNDTRACK_PREFS.muted,
      playbackMode: isValidPlaybackMode(parsed.playbackMode)
        ? parsed.playbackMode
        : DEFAULT_SOUNDTRACK_PREFS.playbackMode,
    };
  } catch {
    return { ...DEFAULT_SOUNDTRACK_PREFS };
  }
}

export function saveSoundtrackPrefs(prefs: SoundtrackPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOUNDTRACK_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

export function normalizeTrackIdList(raw: unknown): MusicTrackId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<MusicTrackId>();
  const out: MusicTrackId[] = [];
  for (const item of raw) {
    if (isValidMusicTrackId(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Returns milestone-unlocked track IDs that the user has not yet seen.
 * When `seenTrackIds` is `null` (first-time baseline initialization), returns `[]`
 * so already-owned starter/baseline tracks are not falsely flagged as newly unlocked.
 */
export function computeUnseenUnlockedTrackIds(
  unlockedTrackIds: readonly MusicTrackId[],
  seenTrackIds: readonly MusicTrackId[] | null,
): MusicTrackId[] {
  if (seenTrackIds === null) return [];
  const seenSet = new Set<MusicTrackId>(seenTrackIds);
  return unlockedTrackIds.filter((id) => {
    const meta = SOUNDTRACK_TRACK_BY_ID[id];
    return Boolean(meta && meta.requiredPoints > 0 && !seenSet.has(id));
  });
}

export function mergeSeenTrackIds(
  currentSeen: readonly MusicTrackId[] | null,
  additionalIds: readonly MusicTrackId[],
): MusicTrackId[] {
  const merged = new Set<MusicTrackId>(currentSeen ?? []);
  for (const id of additionalIds) {
    if (isValidMusicTrackId(id)) {
      merged.add(id);
    }
  }
  return Array.from(merged);
}

export function loadSeenTrackIds(): MusicTrackId[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SOUNDTRACK_SEEN_TRACKS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return normalizeTrackIdList(parsed);
  } catch {
    return null;
  }
}

export function saveSeenTrackIds(trackIds: readonly MusicTrackId[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SOUNDTRACK_SEEN_TRACKS_STORAGE_KEY,
      JSON.stringify(normalizeTrackIdList(trackIds)),
    );
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

