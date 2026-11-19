import { useEffect, useRef, useState } from 'react';
import { Award, Crown, Medal, Trophy, X } from 'lucide-react';
import {
  type AchievementTier,
  TIER_LABELS,
  type TrophyToastItem,
} from '../shared/achievements';
import { retroSynth } from '../utils/retroSynth';

export function getTierVisuals(tier: AchievementTier): {
  label: string;
  textClass: string;
  borderClass: string;
  bgClass: string;
  glowStyle: string;
} {
  switch (tier) {
    case 'bronze':
      return {
        label: TIER_LABELS.bronze,
        textClass: 'text-[#d9915b]',
        borderClass: 'border-[#d9915b]/55',
        bgClass: 'bg-[#d9915b]/12',
        glowStyle: '0 0 18px -6px rgba(217, 145, 91, 0.45)',
      };
    case 'silver':
      return {
        label: TIER_LABELS.silver,
        textClass: 'text-[#cfdbe6]',
        borderClass: 'border-[#cfdbe6]/55',
        bgClass: 'bg-[#cfdbe6]/12',
        glowStyle: '0 0 18px -6px rgba(207, 219, 230, 0.45)',
      };
    case 'gold':
      return {
        label: TIER_LABELS.gold,
        textClass: 'text-crt-amber',
        borderClass: 'border-crt-amber/65',
        bgClass: 'bg-crt-amber/14',
        glowStyle: '0 0 22px -6px rgba(245, 158, 11, 0.55)',
      };
    case 'platinum':
      return {
        label: TIER_LABELS.platinum,
        textClass: 'text-crt-phosphor',
        borderClass: 'border-crt-phosphor/75',
        bgClass: 'bg-crt-phosphor/15',
        glowStyle: '0 0 26px -6px rgba(var(--crt-phosphor-rgb, 56, 229, 107), 0.65)',
      };
  }
}

export function TrophyTierMedallion({
  tier,
  unlocked = true,
  size = 'md',
}: {
  tier: AchievementTier;
  unlocked?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const vis = getTierVisuals(tier);
  const boxClass =
    size === 'lg'
      ? 'h-11 w-11'
      : size === 'sm'
        ? 'h-7 w-7'
        : 'h-9 w-9';
  const iconClass =
    size === 'lg'
      ? 'h-5 w-5'
      : size === 'sm'
        ? 'h-3.5 w-3.5'
        : 'h-4 w-4';

  const Icon =
    tier === 'platinum'
      ? Crown
      : tier === 'gold'
        ? Trophy
        : tier === 'silver'
          ? Award
          : Medal;

  return (
    <div
      aria-hidden="true"
      style={unlocked ? { boxShadow: vis.glowStyle } : undefined}
      className={`${boxClass} rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${
        unlocked
          ? `${vis.borderClass} ${vis.bgClass} ${vis.textClass}`
          : 'border-crt-border bg-crt-bg text-crt-muted/45'
      }`}
    >
      <Icon className={iconClass} />
    </div>
  );
}

interface TrophyToastStackProps {
  queue: TrophyToastItem[];
  onConsumeCurrent: () => void;
  onSelectTrophy: (trophyId?: string) => void;
}

export function TrophyToastStack({
  queue,
  onConsumeCurrent,
  onSelectTrophy,
}: TrophyToastStackProps) {
  const current = queue[0] ?? null;
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering');
  const playedKeyRef = useRef<string | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!current) {
      playedKeyRef.current = null;
      return;
    }

    setPhase('entering');
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setPhase('open');
      });
    });

    if (playedKeyRef.current !== current.key) {
      playedKeyRef.current = current.key;
      const tier = current.trophy?.tier ?? 'bronze';
      retroSynth.trophyUnlock(tier);
    }

    dismissTimerRef.current = window.setTimeout(() => {
      setPhase('closing');
      exitTimerRef.current = window.setTimeout(() => {
        onConsumeCurrent();
      }, 320);
    }, 4300);

    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [current, onConsumeCurrent]);

  if (!current) return null;

  const isSummary = current.kind === 'summary';
  const tier: AchievementTier = current.trophy?.tier ?? 'bronze';
  const vis = getTierVisuals(tier);

  const handleDismiss = () => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setPhase('closing');
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
    }
    exitTimerRef.current = window.setTimeout(() => {
      onConsumeCurrent();
    }, 220);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-trophy-toast-state={phase}
      className="crt-trophy-toast fixed bottom-5 right-5 z-[76] w-[min(360px,calc(100vw-2rem))] pointer-events-auto"
    >
      <div
        onClick={() => {
          onSelectTrophy(isSummary ? undefined : current.trophy?.id);
          handleDismiss();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectTrophy(isSummary ? undefined : current.trophy?.id);
            handleDismiss();
          }
        }}
        style={{ boxShadow: `0 18px 44px -14px rgba(0,0,0,0.92), ${vis.glowStyle}` }}
        className={`w-full text-left border ${vis.borderClass} bg-crt-surface/96 backdrop-blur rounded-md px-3.5 py-3 flex items-center gap-3 cursor-pointer hover:bg-crt-elevated transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-crt-phosphor`}
      >
        <TrophyTierMedallion tier={tier} unlocked size="md" />

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className={`font-semibold ${vis.textClass}`}>
              {isSummary ? 'Trophies Unlocked' : `${vis.label} Trophy`}
            </span>
            <span aria-hidden="true" className="text-crt-muted">
              ·
            </span>
            <span className="text-crt-muted tabular-nums">
              +{isSummary ? (current.extraPoints ?? 0) : (current.trophy?.points ?? 0)} pts
            </span>
          </div>

          <div className="font-display text-sm font-semibold text-crt-text truncate">
            {isSummary
              ? `+${current.extraCount ?? 1} More Trophies Earned`
              : current.trophy?.title}
          </div>

          <p className="text-xs text-crt-muted truncate">
            {isSummary
              ? 'Open Trophy Case to inspect your new unlocks'
              : current.trophy?.description}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          aria-label="Dismiss trophy notification"
          className="self-start p-1 rounded text-crt-muted hover:text-crt-text transition-colors shrink-0 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
