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
    title: 'Phosphor Idle',
    shortTitle: 'Phosphor Idle',
    genre: 'CRT Ambient',
    bpm: 92,
    requiredPoints: 0,
    description:
      'Starter soundtrack: warm electric-piano chords, soft analog bass pulse, and brushed lo-fi hats.',
    loopsBeforeAdvance: 3,
  },
  {
    id: 'bitplane_bounce',
    title: 'Bitplane Bounce',
    shortTitle: 'Bitplane',
    genre: '8-Bit Chiptune',
    bpm: 132,
    requiredPoints: 150,
    description:
      'Upbeat dual pulse-wave arcade melody, bouncy arpeggio shimmer, triangle bass, and crisp 8-bit drums.',
    loopsBeforeAdvance: 4,
  },
  {
    id: 'outrun_crt',
    title: 'Outrun CRT',
    shortTitle: 'Outrun CRT',
    genre: '80s Synthwave',
    bpm: 116,
    requiredPoints: 400,
    description:
      'Driving sawtooth octave bassline, resonant filter sweeps, lush detuned pads, and gated retro snare.',
    loopsBeforeAdvance: 3,
  },
  {
    id: 'fm_cartridge_drive',
    title: 'FM Cartridge Drive',
    shortTitle: 'FM Drive',
    genre: '16-Bit FM',
    bpm: 128,
    requiredPoints: 650,
    description:
      'Metallic 16-bit FM slap bass, crystalline bell chords, and energetic console-era stage breakbeats.',
    loopsBeforeAdvance: 4,
  },
  {
    id: 'subcarrier_pulse',
    title: 'Subcarrier Pulse',
    shortTitle: 'Subcarrier',
    genre: 'Acid Techno',
    bpm: 130,
    requiredPoints: 950,
    description:
      'Four-on-the-floor sub kick, squelchy resonant 303-style acid filter bass, and hypnotic warehouse stabs.',
    loopsBeforeAdvance: 4,
  },
  {
    id: 'cyberdeck_horizon',
    title: 'Cyberdeck Horizon',
    shortTitle: 'Cyberdeck',
    genre: 'Dark Synth',
    bpm: 108,
    requiredPoints: 1300,
    description:
      'Brooding 16th-note sub-bass arpeggios, atmospheric chorus pads, and half-time cyber-synth percussion.',
    loopsBeforeAdvance: 3,
  },
  {
    id: 'broadcast_finale',
    title: 'Broadcast Finale',
    shortTitle: 'Finale',
    genre: 'Euro-Synth',
    bpm: 138,
    requiredPoints: 1650,
    description:
      'Flagship late-game anthem blending euphoric synth chord stabs, soaring 16-bit arps, and driving energy.',
    loopsBeforeAdvance: 4,
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
