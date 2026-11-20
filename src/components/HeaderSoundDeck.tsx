import { type CSSProperties, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Disc3,
  Lock,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { SoundtrackController } from '../hooks/useSoundtrackPlayer';
import type { CrtUiMotionLevel } from '../shared/crtDisplay';
import {
  isMusicTrackUnlocked,
  type MusicPlaybackMode,
  type MusicTrackId,
} from '../shared/soundtrack';

interface HeaderSoundDeckProps {
  controller: SoundtrackController;
  uiMotion: CrtUiMotionLevel;
  onOpenRewards: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Matches wide deck layout windows where 12-bar equalizer + 2-line LCD readout have ample width:
 * - Wide desktop (xl+ >= 1280px) where center-stage slot is 360px-440px
 * - Tablet/small-row full-width deck (640px..1023px) where deck spans its own row
 */
function useWideDeckVisualizer(): boolean {
  const query = '(min-width: 1280px), (min-width: 640px) and (max-width: 1023px)';
  const [isWide, setIsWide] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    const onChange = (ev: MediaQueryListEvent) => setIsWide(ev.matches);
    setIsWide(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isWide;
}

const STATIC_PLAYING_BARS_6 = [0.38, 0.72, 0.56, 0.86, 0.48, 0.64];
const STATIC_IDLE_BARS_6 = [0.22, 0.34, 0.26, 0.38, 0.24, 0.3];
const STATIC_PLAYING_BARS_12 = [0.35, 0.58, 0.78, 0.64, 0.9, 0.72, 0.54, 0.82, 0.66, 0.48, 0.62, 0.38];
const STATIC_IDLE_BARS_12 = [0.16, 0.22, 0.18, 0.26, 0.2, 0.28, 0.22, 0.24, 0.18, 0.22, 0.16, 0.14];

function SpectrumBars({
  barCount,
  isPlaying,
  muted,
  volume,
  animate,
  heightClass,
  barWidthClass,
  getSpectrumLevels,
}: {
  barCount: 6 | 12;
  isPlaying: boolean;
  muted: boolean;
  volume: number;
  animate: boolean;
  heightClass: string;
  barWidthClass: string;
  getSpectrumLevels: (count: number) => number[];
}) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const audible = isPlaying && !muted && volume > 0;
  const fallbackIdle = barCount === 6 ? STATIC_IDLE_BARS_6 : STATIC_IDLE_BARS_12;
  const fallbackPlaying = barCount === 6 ? STATIC_PLAYING_BARS_6 : STATIC_PLAYING_BARS_12;

  useEffect(() => {
    const applyLevels = (levels: readonly number[]) => {
      for (let i = 0; i < barCount; i += 1) {
        const el = barRefs.current[i];
        if (!el) continue;
        const clamped = Math.max(0.14, Math.min(1, levels[i] ?? 0.14));
        el.style.transform = `scaleY(${clamped.toFixed(3)})`;
      }
    };

    if (!audible) {
      applyLevels(fallbackIdle);
      return;
    }

    if (!animate) {
      applyLevels(fallbackPlaying);
      return;
    }

    let rafId = 0;
    const tick = () => {
      const levels = getSpectrumLevels(barCount);
      applyLevels(levels);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [audible, animate, barCount, fallbackIdle, fallbackPlaying, getSpectrumLevels]);

  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-end gap-[2px] ${heightClass} shrink-0`}
    >
      {Array.from({ length: barCount }).map((_, idx) => {
        const initialScale = audible ? fallbackPlaying[idx] : fallbackIdle[idx];
        return (
          <span
            key={idx}
            ref={(el) => {
              barRefs.current[idx] = el;
            }}
            style={{ transform: `scaleY(${initialScale})` }}
            className={`${barWidthClass} h-full origin-bottom rounded-[1px] will-change-transform transition-colors ${
              audible
                ? 'bg-crt-phosphor shadow-[0_0_6px_rgba(var(--crt-phosphor-rgb,56,229,107),0.45)]'
                : 'bg-crt-muted/45'
            }`}
          />
        );
      })}
    </span>
  );
}

function getPlaybackModeMeta(mode: MusicPlaybackMode): {
  label: string;
  hint: string;
} {
  switch (mode) {
    case 'loop':
      return {
        label: 'Loop',
        hint: 'Loop current track continuously (click to switch to Cycle Unlocked)',
      };
    case 'cycle':
      return {
        label: 'Cycle',
        hint: 'Cycle through unlocked tracks in order (click to switch to Shuffle)',
      };
    case 'shuffle':
      return {
        label: 'Shuffle',
        hint: 'Shuffle randomly across unlocked tracks (click to switch to Loop)',
      };
  }
}

export function HeaderSoundDeck({
  controller,
  uiMotion,
  onOpenRewards,
}: HeaderSoundDeckProps) {
  const [open, setOpen] = useState(false);
  const [sessionHighlightedNewIds, setSessionHighlightedNewIds] = useState<MusicTrackId[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const isWideDeck = useWideDeckVisualizer();
  const animateVisualizer = uiMotion !== 'off' && !prefersReducedMotion();
  const canStepTracks = controller.unlockedTracks.length > 1;
  const modeMeta = getPlaybackModeMeta(controller.playbackMode);
  const effectiveVolumePct = controller.muted ? 0 : controller.volume;
  const unseenCount = controller.unseenUnlockedTrackIds.length;

  const handleTogglePopover = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        if (controller.unseenUnlockedTrackIds.length > 0) {
          setSessionHighlightedNewIds([...controller.unseenUnlockedTrackIds]);
          controller.markAllUnlockedTracksSeen();
        } else {
          setSessionHighlightedNewIds([]);
        }
      } else {
        setSessionHighlightedNewIds([]);
      }
      return next;
    });
  };

  // Close popover on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
        setSessionHighlightedNewIds([]);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        setOpen(false);
        setSessionHighlightedNewIds([]);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const lcdSubline = controller.muted
    ? `MUTED · ${controller.activeTrack.genre} · ${controller.activeTrack.bpm} BPM`
    : controller.autoPausedForTab
      ? `PAUSED · ${controller.activeTrack.genre} · ${controller.activeTrack.bpm} BPM`
      : `${controller.activeTrack.genre} · ${controller.activeTrack.bpm} BPM`;

  return (
    <div
      ref={containerRef}
      className="relative w-full lg:max-w-[360px] xl:max-w-[436px] min-w-0"
    >
      {/* Center-Stage Recessed CRT Stereo Receiver Deck */}
      <div
        role="region"
        aria-label="CRT Stereo Sound Deck"
        data-playing={controller.isPlaying ? 'true' : 'false'}
        data-has-new={unseenCount > 0 ? 'true' : 'false'}
        className="crt-sound-deck flex items-stretch w-full rounded-[6px] border p-1 gap-1.5 font-mono text-xs"
      >
        {/* Left Bay: Tactile Inline Transport Controls (Prev / Play-Pause / Next) */}
        <div
          role="group"
          aria-label="Soundtrack transport controls"
          className="flex items-stretch shrink-0 rounded-[4px] border border-crt-border/80 bg-crt-bg/90 overflow-hidden divide-x divide-crt-border/70"
        >
          <button
            type="button"
            disabled={!canStepTracks}
            onClick={controller.prevTrack}
            aria-label="Previous unlocked track"
            title={
              canStepTracks
                ? 'Previous unlocked track'
                : 'Unlock more tracks via Trophy Points to skip'
            }
            className="inline-flex items-center justify-center w-7 text-crt-muted hover:text-crt-text hover:bg-crt-elevated/80 transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-crt-phosphor"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={controller.togglePlay}
            aria-label={
              controller.isPlaying
                ? `Pause soundtrack: ${controller.activeTrack.title}`
                : `Play soundtrack: ${controller.activeTrack.title}`
            }
            title={
              controller.isPlaying
                ? `Pause ${controller.activeTrack.title} (${controller.activeTrack.genre})`
                : `Play ${controller.activeTrack.title} (${controller.activeTrack.genre})`
            }
            className={`inline-flex items-center justify-center w-8 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-crt-phosphor ${
              controller.isPlaying
                ? 'bg-crt-phosphor/18 text-crt-phosphor hover:bg-crt-phosphor/28'
                : 'text-crt-text hover:bg-crt-phosphor/15 hover:text-crt-phosphor'
            }`}
          >
            {controller.isPlaying ? (
              <Pause className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </button>

          <button
            type="button"
            disabled={!canStepTracks}
            onClick={controller.nextTrack}
            aria-label="Next unlocked track"
            title={
              canStepTracks
                ? 'Next unlocked track'
                : 'Unlock more tracks via Trophy Points to skip'
            }
            className="inline-flex items-center justify-center w-7 text-crt-muted hover:text-crt-text hover:bg-crt-elevated/80 transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-crt-phosphor"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right Bay: Recessed CRT LCD Track Readout + Live Spectrum Visualizer + Track Selector Trigger */}
        <button
          type="button"
          onClick={handleTogglePopover}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Open CRT Sound Deck track list (${controller.activeTrack.title}, ${controller.unlockedTracks.length} of ${controller.allTracks.length} tracks unlocked${unseenCount > 0 ? `, ${unseenCount} newly unlocked` : ''})`}
          title={`Open Sound Deck · ${controller.activeTrack.title} (${controller.activeTrack.genre} · ${controller.activeTrack.bpm} BPM · ${controller.unlockedTracks.length}/${controller.allTracks.length} unlocked)`}
          className="crt-sound-deck-lcd flex-1 min-w-0 flex items-center justify-between gap-2.5 px-2.5 py-1 rounded-[4px] text-left cursor-pointer group focus:outline-none focus-visible:ring-1 focus-visible:ring-crt-phosphor"
        >
          {/* LCD Now Playing Readout */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <Disc3
                className={`h-3 w-3 shrink-0 transition-colors ${
                  controller.isPlaying
                    ? 'text-crt-phosphor'
                    : 'text-crt-muted/80 group-hover:text-crt-text'
                }`}
              />
              <span
                className={`font-display text-[12px] sm:text-[13px] font-semibold leading-tight tracking-wide truncate transition-colors ${
                  controller.isPlaying
                    ? 'text-crt-phosphor'
                    : 'text-crt-text group-hover:text-crt-phosphor'
                }`}
              >
                {controller.activeTrack.title}
              </span>
              {unseenCount > 0 && (
                <span className="px-1.5 py-[1px] rounded-[3px] border border-crt-phosphor/70 bg-crt-phosphor/15 text-[9px] font-mono font-semibold uppercase tracking-wider text-crt-phosphor tabular-nums whitespace-nowrap shrink-0">
                  {unseenCount === 1 ? 'NEW' : `+${unseenCount} NEW`}
                </span>
              )}
            </div>

            <div className="hidden sm:block lg:hidden xl:block text-[10px] font-mono text-crt-muted/90 tabular-nums leading-tight truncate mt-0.5 uppercase tracking-wider">
              {lcdSubline}
            </div>
          </div>

          {/* Live CRT Spectrum Equalizer + Drawer Chevron */}
          <div className="flex items-center gap-2 shrink-0">
            <SpectrumBars
              barCount={isWideDeck ? 12 : 6}
              isPlaying={controller.isPlaying}
              muted={controller.muted}
              volume={controller.volume}
              animate={animateVisualizer}
              heightClass={isWideDeck ? 'h-5' : 'h-4'}
              barWidthClass={isWideDeck ? 'w-[3px]' : 'w-[2px]'}
              getSpectrumLevels={controller.getSpectrumLevels}
            />
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
                open
                  ? 'rotate-180 text-crt-phosphor'
                  : 'text-crt-muted group-hover:text-crt-text'
              }`}
            />
          </div>
        </button>
      </div>

      {/* Anchored CRT Sound Deck Popover */}
      {open && (
        <div
          role="dialog"
          aria-label="CRT Sound Deck"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-[340px] max-w-[calc(100vw-1.5rem)] rounded-[6px] border border-crt-border-strong bg-crt-surface shadow-2xl overflow-hidden"
        >
          {/* Now Playing LCD Strip */}
          <div className="px-4 py-3 bg-crt-bg/90 border-b border-crt-border flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <Disc3
                  className={`h-3.5 w-3.5 shrink-0 ${
                    controller.isPlaying ? 'text-crt-phosphor' : 'text-crt-muted'
                  }`}
                />
                <span className="font-display text-sm font-semibold text-crt-text truncate">
                  {controller.activeTrack.title}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-crt-muted tabular-nums truncate">
                <span>{controller.activeTrack.genre}</span>
                <span aria-hidden="true">·</span>
                <span>{controller.activeTrack.bpm} BPM</span>
                <span aria-hidden="true">·</span>
                <span>
                  {controller.unlockedTracks.length}/{controller.allTracks.length} unlocked
                </span>
              </div>
            </div>

            <SpectrumBars
              barCount={12}
              isPlaying={controller.isPlaying}
              muted={controller.muted}
              volume={controller.volume}
              animate={animateVisualizer}
              heightClass="h-7"
              barWidthClass="w-[3px]"
              getSpectrumLevels={controller.getSpectrumLevels}
            />
          </div>

          {/* Transport Controls & Playback Mode */}
          <div className="px-4 py-2.5 border-b border-crt-border flex items-center justify-between gap-2 bg-crt-surface">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!canStepTracks}
                onClick={controller.prevTrack}
                aria-label="Previous unlocked track"
                title={canStepTracks ? 'Previous unlocked track' : 'Unlock more tracks to skip'}
                className="p-1.5 rounded border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={controller.togglePlay}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  controller.isPlaying
                    ? 'border-crt-phosphor/75 bg-crt-phosphor/15 text-crt-phosphor hover:bg-crt-phosphor/25'
                    : 'border-crt-phosphor bg-crt-phosphor text-crt-bg hover:brightness-110'
                }`}
              >
                {controller.isPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5 fill-current" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>Play</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!canStepTracks}
                onClick={controller.nextTrack}
                aria-label="Next unlocked track"
                title={canStepTracks ? 'Next unlocked track' : 'Unlock more tracks to skip'}
                className="p-1.5 rounded border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={controller.cyclePlaybackMode}
              title={modeMeta.hint}
              aria-label={`Playback mode: ${modeMeta.label}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                controller.playbackMode === 'loop'
                  ? 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                  : 'border-crt-phosphor/60 bg-crt-phosphor/12 text-crt-phosphor'
              }`}
            >
              {controller.playbackMode === 'shuffle' ? (
                <Shuffle className="h-3 w-3 shrink-0" />
              ) : controller.playbackMode === 'cycle' ? (
                <Repeat className="h-3 w-3 shrink-0" />
              ) : (
                <Repeat1 className="h-3 w-3 shrink-0" />
              )}
              <span>{modeMeta.label}</span>
            </button>
          </div>

          {/* Volume Slider Row */}
          <div className="px-4 py-2.5 border-b border-crt-border flex items-center gap-2.5 bg-crt-bg/45">
            <button
              type="button"
              onClick={controller.toggleMute}
              aria-label={controller.muted ? 'Unmute soundtrack' : 'Mute soundtrack'}
              title={controller.muted ? 'Unmute background music' : 'Mute background music'}
              className="p-1 rounded text-crt-muted hover:text-crt-text transition-colors shrink-0 cursor-pointer"
            >
              {controller.muted || controller.volume === 0 ? (
                <VolumeX className="h-3.5 w-3.5 text-crt-amber" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-crt-phosphor" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={effectiveVolumePct}
              aria-label="Soundtrack volume"
              onChange={(e) => controller.setVolume(Number(e.target.value))}
              style={
                {
                  '--slider-pct': `${effectiveVolumePct}%`,
                  '--crt-range-fill':
                    effectiveVolumePct > 0
                      ? 'var(--color-crt-phosphor)'
                      : 'var(--color-crt-border-strong)',
                  '--crt-range-thumb':
                    effectiveVolumePct > 0
                      ? 'var(--color-crt-phosphor)'
                      : 'var(--color-crt-muted)',
                } as CSSProperties
              }
              className="crt-range flex-1 block"
            />
            <span className="w-8 text-right text-[11px] font-mono text-crt-muted tabular-nums shrink-0">
              {effectiveVolumePct}%
            </span>
          </div>

          {/* Soundtrack Track List */}
          <ul
            aria-label="Unlockable soundtrack tracks"
            className="max-h-[252px] overflow-y-auto divide-y divide-crt-border/65 bg-crt-bg/30"
          >
            {controller.allTracks.map((track) => {
              const unlocked = isMusicTrackUnlocked(track.id, controller.earnedPoints);
              const isSelected = controller.activeTrackId === track.id;
              const isCurrentlyPlaying = isSelected && controller.isPlaying;
              const isNewlyUnlocked = unlocked && sessionHighlightedNewIds.includes(track.id);

              return (
                <li key={track.id}>
                  <button
                    type="button"
                    disabled={!unlocked}
                    onClick={() => {
                      if (isCurrentlyPlaying) {
                        controller.pause();
                      } else {
                        controller.playTrack(track.id);
                      }
                    }}
                    title={
                      unlocked
                        ? track.description
                        : `Unlock at ${track.requiredPoints.toLocaleString()} trophy pts · ${track.description}`
                    }
                    className={`w-full px-4 py-2 text-left flex items-center justify-between gap-2.5 transition-colors ${
                      !unlocked
                        ? 'opacity-55 cursor-not-allowed'
                        : isSelected
                          ? 'bg-crt-phosphor/10 cursor-pointer'
                          : isNewlyUnlocked
                            ? 'bg-crt-phosphor/[0.06] hover:bg-crt-phosphor/12 cursor-pointer'
                            : 'hover:bg-crt-elevated/70 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`h-5 w-5 rounded-[4px] border flex items-center justify-center shrink-0 ${
                          !unlocked
                            ? 'border-crt-border bg-crt-bg text-crt-muted/60'
                            : isCurrentlyPlaying
                              ? 'border-crt-phosphor/70 bg-crt-phosphor/15 text-crt-phosphor'
                              : isSelected
                                ? 'border-crt-phosphor/45 bg-crt-surface text-crt-phosphor'
                                : isNewlyUnlocked
                                  ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor'
                                  : 'border-crt-border bg-crt-surface text-crt-muted'
                        }`}
                      >
                        {!unlocked ? (
                          <Lock className="h-2.5 w-2.5" />
                        ) : isCurrentlyPlaying ? (
                          <Pause className="h-2.5 w-2.5 fill-current" />
                        ) : (
                          <Play className="h-2.5 w-2.5 fill-current" />
                        )}
                      </span>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`font-display text-xs font-semibold truncate ${
                              isSelected
                                ? 'text-crt-phosphor'
                                : unlocked
                                  ? 'text-crt-text'
                                  : 'text-crt-muted'
                            }`}
                          >
                            {track.title}
                          </span>
                          {isNewlyUnlocked && (
                            <span className="px-1 py-[1px] rounded-[3px] border border-crt-phosphor/70 bg-crt-phosphor/15 text-[9px] font-mono font-semibold uppercase tracking-wider text-crt-phosphor shrink-0">
                              New
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-crt-muted truncate">
                          {track.genre} · {track.bpm} BPM
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-mono tabular-nums whitespace-nowrap shrink-0 ${
                        !unlocked
                          ? 'text-crt-amber/85'
                          : isCurrentlyPlaying
                            ? 'text-crt-phosphor font-semibold'
                            : isNewlyUnlocked
                              ? 'text-crt-phosphor'
                              : 'text-crt-muted/80'
                      }`}
                    >
                      {!unlocked
                        ? `${track.requiredPoints.toLocaleString()} pts`
                        : isCurrentlyPlaying
                          ? 'Playing'
                          : isNewlyUnlocked
                            ? 'Unlocked'
                            : track.requiredPoints === 0
                              ? 'Starter'
                              : 'Ready'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Footer Link to Trophy Case Rewards */}
          <div className="px-4 py-2 bg-crt-bg/85 border-t border-crt-border flex items-center justify-between gap-2 text-[11px] font-mono">
            <span className="text-crt-muted truncate">Auto-ducks for chimes &amp; arcade</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSessionHighlightedNewIds([]);
                onOpenRewards();
              }}
              className="inline-flex items-center gap-1 text-crt-amber hover:text-crt-phosphor transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trophy className="h-3 w-3 shrink-0" />
              <span>Rewards</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
