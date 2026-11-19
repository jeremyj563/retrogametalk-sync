import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clampMusicVolume,
  getUnlockedTracks,
  isMusicTrackUnlocked,
  loadSoundtrackPrefs,
  type MusicPlaybackMode,
  type MusicTrackDefinition,
  type MusicTrackId,
  pickNextTrackId,
  resolveEffectiveTrackId,
  saveSoundtrackPrefs,
  SOUNDTRACK_TRACK_BY_ID,
  SOUNDTRACK_TRACKS,
  type SoundtrackPrefs,
} from '../shared/soundtrack';
import { retroMusicPlayer } from '../utils/retroMusicPlayer';
import { retroSynth } from '../utils/retroSynth';

export interface SoundtrackController {
  isPlaying: boolean;
  /** True if paused solely because the browser tab was hidden */
  autoPausedForTab: boolean;
  activeTrackId: MusicTrackId;
  activeTrack: MusicTrackDefinition;
  allTracks: readonly MusicTrackDefinition[];
  unlockedTracks: MusicTrackDefinition[];
  volume: number;
  muted: boolean;
  playbackMode: MusicPlaybackMode;
  earnedPoints: number;
  togglePlay: () => void;
  playTrack: (trackId: MusicTrackId) => void;
  selectTrack: (trackId: MusicTrackId, autoPlay?: boolean) => void;
  pause: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setVolume: (next: number) => void;
  toggleMute: () => void;
  cyclePlaybackMode: () => void;
  setPlaybackMode: (mode: MusicPlaybackMode) => void;
  getSpectrumLevels: (barCount: number) => number[];
}

interface UseSoundtrackPlayerOptions {
  earnedPoints: number;
  achievementsLoaded: boolean;
  arcadeOpen: boolean;
}

const MODE_ORDER: readonly MusicPlaybackMode[] = ['loop', 'cycle', 'shuffle'];

export function useSoundtrackPlayer({
  earnedPoints,
  achievementsLoaded,
  arcadeOpen,
}: UseSoundtrackPlayerOptions): SoundtrackController {
  const [prefs, setPrefs] = useState<SoundtrackPrefs>(() => loadSoundtrackPrefs());
  // Strictly OFF by default until the user explicitly clicks Play
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoPausedForTab, setAutoPausedForTab] = useState(false);

  const unlockedTracks = useMemo(() => getUnlockedTracks(earnedPoints), [earnedPoints]);
  const unlockedTrackIds = useMemo(() => unlockedTracks.map((t) => t.id), [unlockedTracks]);

  const activeTrackId = useMemo(
    () => resolveEffectiveTrackId(prefs.trackId, earnedPoints, achievementsLoaded),
    [prefs.trackId, earnedPoints, achievementsLoaded],
  );
  const activeTrack = SOUNDTRACK_TRACK_BY_ID[activeTrackId];

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const autoPausedRef = useRef(autoPausedForTab);
  autoPausedRef.current = autoPausedForTab;
  const activeTrackIdRef = useRef(activeTrackId);
  activeTrackIdRef.current = activeTrackId;
  const unlockedIdsRef = useRef<MusicTrackId[]>(unlockedTrackIds);
  unlockedIdsRef.current = unlockedTrackIds;
  const playbackModeRef = useRef<MusicPlaybackMode>(prefs.playbackMode);
  playbackModeRef.current = prefs.playbackMode;

  const updatePrefs = useCallback((patch: Partial<SoundtrackPrefs>) => {
    setPrefs((prev) => {
      const next: SoundtrackPrefs = {
        ...prev,
        ...patch,
        volume:
          patch.volume !== undefined ? clampMusicVolume(patch.volume, prev.volume) : prev.volume,
      };
      saveSoundtrackPrefs(next);
      return next;
    });
  }, []);

  // Sync volume & mute to audio engine
  useEffect(() => {
    retroMusicPlayer.setVolume(prefs.volume);
    retroMusicPlayer.setMuted(prefs.muted);
  }, [prefs.volume, prefs.muted]);

  // If a locked persisted track fell back to starter after achievements loaded, sync engine
  useEffect(() => {
    if (retroMusicPlayer.getTrackId() !== activeTrackId) {
      retroMusicPlayer.switchTrack(activeTrackId);
    }
  }, [activeTrackId]);

  // Duck music smoothly whenever the hidden 4-in-1 CRT Arcade modal is open
  useEffect(() => {
    retroMusicPlayer.setSustainedDuck(arcadeOpen);
  }, [arcadeOpen]);

  // Duck music smoothly whenever retroSynth fires a Trophy unlock chime or major SFX
  useEffect(() => {
    return retroSynth.subscribeDuckRequests((durationMs) => {
      retroMusicPlayer.duckFor(durationMs);
    });
  }, []);

  // Auto-advance on loop completion when in Cycle or Shuffle mode
  useEffect(() => {
    retroMusicPlayer.setLoopCompleteHandler((completedTrackId, loopsCompleted) => {
      const mode = playbackModeRef.current;
      if (mode === 'loop') return;
      const meta = SOUNDTRACK_TRACK_BY_ID[completedTrackId];
      const unlocked = unlockedIdsRef.current;
      if (!meta || unlocked.length <= 1) return;
      if (loopsCompleted >= meta.loopsBeforeAdvance) {
        const nextId = pickNextTrackId(completedTrackId, unlocked, mode, 'next');
        if (nextId !== completedTrackId) {
          retroMusicPlayer.switchTrack(nextId);
          updatePrefs({ trackId: nextId });
        }
      }
    });
    return () => {
      retroMusicPlayer.setLoopCompleteHandler(null);
    };
  }, [updatePrefs]);

  // Auto-pause when the browser tab becomes hidden, and resume smoothly when visible again
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (isPlayingRef.current) {
          retroMusicPlayer.pause();
          setIsPlaying(false);
          setAutoPausedForTab(true);
        }
      } else if (document.visibilityState === 'visible') {
        if (autoPausedRef.current) {
          setAutoPausedForTab(false);
          const started = retroMusicPlayer.play(activeTrackIdRef.current);
          setIsPlaying(started);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Cleanly stop audio if root unmounts
  useEffect(() => {
    return () => {
      retroMusicPlayer.pause();
      retroMusicPlayer.setSustainedDuck(false);
    };
  }, []);

  const pause = useCallback(() => {
    setAutoPausedForTab(false);
    retroMusicPlayer.pause();
    setIsPlaying(false);
  }, []);

  const playTrack = useCallback(
    (trackId: MusicTrackId) => {
      if (!isMusicTrackUnlocked(trackId, earnedPoints)) return;
      setAutoPausedForTab(false);
      updatePrefs({ trackId, muted: false });
      retroMusicPlayer.setMuted(false);
      const started = retroMusicPlayer.play(trackId);
      setIsPlaying(started);
    },
    [earnedPoints, updatePrefs],
  );

  const selectTrack = useCallback(
    (trackId: MusicTrackId, autoPlay = true) => {
      if (!isMusicTrackUnlocked(trackId, earnedPoints)) return;
      setAutoPausedForTab(false);
      updatePrefs({ trackId });
      if (autoPlay) {
        if (prefs.muted) {
          updatePrefs({ trackId, muted: false });
          retroMusicPlayer.setMuted(false);
        }
        const started = retroMusicPlayer.play(trackId);
        setIsPlaying(started);
      } else if (isPlayingRef.current) {
        retroMusicPlayer.switchTrack(trackId);
      }
    },
    [earnedPoints, prefs.muted, updatePrefs],
  );

  const togglePlay = useCallback(() => {
    setAutoPausedForTab(false);
    if (isPlayingRef.current) {
      retroMusicPlayer.pause();
      setIsPlaying(false);
      return;
    }
    if (prefs.muted) {
      updatePrefs({ muted: false });
      retroMusicPlayer.setMuted(false);
    }
    const started = retroMusicPlayer.play(activeTrackIdRef.current);
    setIsPlaying(started);
  }, [prefs.muted, updatePrefs]);

  const stepTrack = useCallback(
    (direction: 'next' | 'prev') => {
      const unlocked = unlockedIdsRef.current;
      if (unlocked.length <= 1) return;
      const nextId = pickNextTrackId(
        activeTrackIdRef.current,
        unlocked,
        playbackModeRef.current,
        direction,
      );
      updatePrefs({ trackId: nextId });
      if (isPlayingRef.current) {
        retroMusicPlayer.switchTrack(nextId);
      } else {
        retroMusicPlayer.switchTrack(nextId);
      }
    },
    [updatePrefs],
  );

  const nextTrack = useCallback(() => stepTrack('next'), [stepTrack]);
  const prevTrack = useCallback(() => stepTrack('prev'), [stepTrack]);

  const setVolume = useCallback(
    (next: number) => {
      const clamped = clampMusicVolume(next, prefs.volume);
      updatePrefs({ volume: clamped, muted: clamped === 0 ? true : false });
    },
    [prefs.volume, updatePrefs],
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !prefs.muted;
    const nextVol = !nextMuted && prefs.volume === 0 ? 45 : prefs.volume;
    updatePrefs({ muted: nextMuted, volume: nextVol });
  }, [prefs.muted, prefs.volume, updatePrefs]);

  const setPlaybackMode = useCallback(
    (mode: MusicPlaybackMode) => {
      updatePrefs({ playbackMode: mode });
    },
    [updatePrefs],
  );

  const cyclePlaybackMode = useCallback(() => {
    const idx = MODE_ORDER.indexOf(playbackModeRef.current);
    const nextMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    updatePrefs({ playbackMode: nextMode });
  }, [updatePrefs]);

  const getSpectrumLevels = useCallback((barCount: number) => {
    return retroMusicPlayer.getSpectrumLevels(barCount);
  }, []);

  return {
    isPlaying,
    autoPausedForTab,
    activeTrackId,
    activeTrack,
    allTracks: SOUNDTRACK_TRACKS,
    unlockedTracks,
    volume: prefs.volume,
    muted: prefs.muted,
    playbackMode: prefs.playbackMode,
    earnedPoints,
    togglePlay,
    playTrack,
    selectTrack,
    pause,
    nextTrack,
    prevTrack,
    setVolume,
    toggleMute,
    cyclePlaybackMode,
    setPlaybackMode,
    getSpectrumLevels,
  };
}
