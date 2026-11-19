import { useEffect, useState } from 'react';
import { Gamepad2, Lock, Play, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import {
  ARCADE_CABINET_STYLE_META,
  type ArcadeCabinetStyleId,
  isArcadeCabinetStyleUnlocked,
} from '../../shared/achievementRewards';
import { ARCADE_CARTRIDGES } from '../../utils/arcadeGames';
import type { ArcadeCartridgeId } from '../../utils/easterEggs';
import { retroSynth } from '../../utils/retroSynth';

export interface ArcadeMultiCartLauncherProps {
  konamiBonus: boolean;
  muted: boolean;
  highScores: Record<ArcadeCartridgeId, number>;
  earnedPoints?: number;
  cabinetStyle?: ArcadeCabinetStyleId;
  onSelectCabinetStyle?: (style: ArcadeCabinetStyleId) => void;
  onToggleMute: () => void;
  onSelectCartridge: (cartId: ArcadeCartridgeId) => void;
  onClose: () => void;
}

function CartridgeArtwork({ id }: { id: ArcadeCartridgeId }) {
  if (id === 'breakout') {
    return (
      <svg viewBox="0 0 88 52" className="w-full h-full" aria-hidden="true">
        <rect x="6" y="7" width="16" height="6" rx="1" className="fill-crt-amber" />
        <rect x="26" y="7" width="16" height="6" rx="1" className="fill-crt-amber" />
        <rect x="46" y="7" width="16" height="6" rx="1" className="fill-crt-amber" />
        <rect x="66" y="7" width="16" height="6" rx="1" className="fill-crt-amber" />
        <rect x="6" y="16" width="16" height="6" rx="1" className="fill-crt-crimson/85" />
        <rect x="26" y="16" width="16" height="6" rx="1" className="fill-crt-crimson/85" />
        <rect x="66" y="16" width="16" height="6" rx="1" className="fill-crt-crimson/85" />
        <rect x="6" y="25" width="16" height="6" rx="1" className="fill-crt-phosphor/75" />
        <rect x="46" y="25" width="16" height="6" rx="1" className="fill-crt-phosphor/75" />
        <circle cx="52" cy="36" r="3" className="fill-crt-text" />
        <rect x="30" y="43" width="28" height="4" rx="1" className="fill-crt-phosphor" />
      </svg>
    );
  }
  if (id === 'invaders') {
    return (
      <svg viewBox="0 0 88 52" className="w-full h-full" aria-hidden="true">
        {/* Classic pixel crab invader */}
        <g className="fill-crt-phosphor">
          <rect x="30" y="7" width="4" height="4" />
          <rect x="54" y="7" width="4" height="4" />
          <rect x="34" y="11" width="4" height="4" />
          <rect x="50" y="11" width="4" height="4" />
          <rect x="30" y="15" width="28" height="4" />
          <rect x="26" y="19" width="8" height="4" />
          <rect x="38" y="19" width="12" height="4" />
          <rect x="54" y="19" width="8" height="4" />
          <rect x="22" y="23" width="44" height="4" />
          <rect x="22" y="27" width="4" height="4" />
          <rect x="30" y="27" width="28" height="4" />
          <rect x="62" y="27" width="4" height="4" />
          <rect x="34" y="31" width="6" height="4" />
          <rect x="48" y="31" width="6" height="4" />
        </g>
        {/* Laser bolt & player turret */}
        <rect x="43" y="36" width="2" height="6" className="fill-crt-amber" />
        <rect x="36" y="44" width="16" height="4" className="fill-crt-text" />
        <rect x="42" y="41" width="4" height="3" className="fill-crt-text" />
      </svg>
    );
  }
  if (id === 'snake') {
    return (
      <svg viewBox="0 0 88 52" className="w-full h-full" aria-hidden="true">
        {/* Phosphor serpent path */}
        <rect x="14" y="32" width="8" height="8" rx="1" className="fill-crt-phosphor/35" />
        <rect x="24" y="32" width="8" height="8" rx="1" className="fill-crt-phosphor/50" />
        <rect x="34" y="32" width="8" height="8" rx="1" className="fill-crt-phosphor/65" />
        <rect x="34" y="22" width="8" height="8" rx="1" className="fill-crt-phosphor/80" />
        <rect x="34" y="12" width="8" height="8" rx="1" className="fill-crt-phosphor/90" />
        <rect x="44" y="12" width="8" height="8" rx="1" className="fill-crt-phosphor" />
        <rect x="54" y="12" width="9" height="8" rx="1" className="fill-crt-text" />
        {/* Eyes */}
        <rect x="60" y="14" width="1.5" height="1.5" className="fill-crt-bg" />
        <rect x="60" y="17" width="1.5" height="1.5" className="fill-crt-bg" />
        {/* Glowing ROM packet */}
        <rect x="70" y="28" width="8" height="8" rx="1" className="fill-crt-amber" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 88 52" className="w-full h-full" aria-hidden="true">
      {/* Falling T-piece */}
      <g className="fill-crt-amber">
        <rect x="40" y="7" width="8" height="8" rx="1" />
        <rect x="31" y="16" width="8" height="8" rx="1" />
        <rect x="40" y="16" width="8" height="8" rx="1" />
        <rect x="49" y="16" width="8" height="8" rx="1" />
      </g>
      {/* Stacked bottom blocks */}
      <rect x="22" y="38" width="8" height="8" rx="1" className="fill-crt-phosphor/70" />
      <rect x="31" y="38" width="8" height="8" rx="1" className="fill-crt-phosphor/85" />
      <rect x="40" y="38" width="8" height="8" rx="1" className="fill-crt-phosphor" />
      <rect x="49" y="38" width="8" height="8" rx="1" className="fill-crt-crimson/85" />
      <rect x="58" y="38" width="8" height="8" rx="1" className="fill-crt-crimson/85" />
      <rect x="22" y="29" width="8" height="8" rx="1" className="fill-crt-phosphor/55" />
      <rect x="58" y="29" width="8" height="8" rx="1" className="fill-crt-crimson/65" />
    </svg>
  );
}

export function ArcadeMultiCartLauncher({
  konamiBonus,
  muted,
  highScores,
  earnedPoints = 0,
  cabinetStyle = 'standard',
  onSelectCabinetStyle,
  onToggleMute,
  onSelectCartridge,
  onClose,
}: ArcadeMultiCartLauncherProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();

      if (key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (lower === 'm') {
        e.preventDefault();
        onToggleMute();
        return;
      }

      if (key === '1' || key === '2' || key === '3' || key === '4') {
        e.preventDefault();
        const idx = Number(key) - 1;
        const cart = ARCADE_CARTRIDGES[idx];
        if (cart) {
          retroSynth.cartBoot();
          onSelectCartridge(cart.id);
        }
        return;
      }

      if (key === 'ArrowRight' || lower === 'd') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev + 1) % ARCADE_CARTRIDGES.length;
          retroSynth.menuSelect();
          return next;
        });
        return;
      }
      if (key === 'ArrowLeft' || lower === 'a') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev - 1 + ARCADE_CARTRIDGES.length) % ARCADE_CARTRIDGES.length;
          retroSynth.menuSelect();
          return next;
        });
        return;
      }
      if (key === 'ArrowDown' || lower === 's') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev + 2) % ARCADE_CARTRIDGES.length;
          retroSynth.menuSelect();
          return next;
        });
        return;
      }
      if (key === 'ArrowUp' || lower === 'w') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev - 2 + ARCADE_CARTRIDGES.length) % ARCADE_CARTRIDGES.length;
          retroSynth.menuSelect();
          return next;
        });
        return;
      }

      if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        const cart = ARCADE_CARTRIDGES[selectedIndex];
        if (cart) {
          retroSynth.cartBoot();
          onSelectCartridge(cart.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onToggleMute, onSelectCartridge, selectedIndex]);

  const totalBest = Object.values(highScores).reduce((sum, n) => sum + n, 0);

  return (
    <>
      {/* Top Cabinet Header */}
      <div className="px-3.5 py-2.5 bg-crt-bg/95 border-b border-crt-border flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Gamepad2 className="h-4 w-4 text-crt-phosphor shrink-0" />
          <h2
            id="crt-arcade-title"
            className="font-display text-sm font-bold tracking-[0.06em] text-crt-phosphor uppercase whitespace-nowrap"
          >
            4-in-1 CRT Multi-Cart
          </h2>
          {konamiBonus && (
            <span className="inline-flex items-center text-[10px] font-mono font-semibold text-crt-amber border border-crt-amber/50 bg-crt-amber/10 px-1.5 py-0.5 rounded-[3px] whitespace-nowrap">
              KONAMI MODE ACTIVE
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 text-xs font-mono tabular-nums ml-auto">
          {totalBest > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 text-crt-amber">
              <Trophy className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider text-crt-muted">Combined</span>
              <span className="font-semibold">{totalBest.toLocaleString()}</span>
            </div>
          )}

          <div className="flex items-center gap-1 border-l border-crt-border pl-2.5">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'Unmute 8-bit sound effects' : 'Mute 8-bit sound effects'}
              title={muted ? 'Unmute SFX (M)' : 'Mute SFX (M)'}
              className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close CRT Arcade"
              title="Close (Esc)"
              className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-crimson hover:border-crt-crimson/50 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Cart Shelf Viewport */}
      <div className="relative bg-crt-bg p-3.5 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-crt-border/80 pb-2.5">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-crt-amber">
              Select Cartridge Bank
            </p>
            <p className="text-xs text-crt-muted mt-0.5">
              Pick a classic ROM cartridge below—each stores its own personal best score.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 ml-auto">
            {onSelectCabinetStyle && (
              <div className="flex items-center gap-1" role="group" aria-label="Cabinet trim style">
                <span className="text-[10px] font-mono text-crt-muted mr-0.5">Trim</span>
                {(['standard', 'cabinet_gold', 'cabinet_overdrive'] as const).map((styleId) => {
                  const meta = ARCADE_CABINET_STYLE_META[styleId];
                  const unlocked = isArcadeCabinetStyleUnlocked(styleId, earnedPoints);
                  const active = cabinetStyle === styleId;
                  return (
                    <button
                      key={styleId}
                      type="button"
                      disabled={!unlocked}
                      onClick={() => {
                        if (!unlocked) return;
                        retroSynth.menuSelect();
                        onSelectCabinetStyle(styleId);
                      }}
                      title={
                        unlocked
                          ? `${meta.label} cabinet bezel`
                          : `${meta.label} · Unlock at ${meta.requiredPoints.toLocaleString()} trophy pts`
                      }
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border transition-colors whitespace-nowrap ${
                        !unlocked
                          ? 'border-crt-border/60 bg-crt-surface/40 text-crt-muted/45 cursor-not-allowed'
                          : active
                            ? styleId === 'cabinet_gold'
                              ? 'border-crt-amber/75 bg-crt-amber/15 text-crt-amber font-semibold cursor-pointer'
                              : 'border-crt-phosphor/75 bg-crt-phosphor/15 text-crt-phosphor font-semibold cursor-pointer'
                            : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text cursor-pointer'
                      }`}
                    >
                      {!unlocked && <Lock className="h-2.5 w-2.5" />}
                      <span>{meta.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <span className="text-[11px] font-mono text-crt-muted tabular-nums">
              KEYS 1–4 · ARROWS + ENTER
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ARCADE_CARTRIDGES.map((cart, index) => {
            const isSelected = index === selectedIndex;
            const best = highScores[cart.id] ?? 0;
            return (
              <button
                key={cart.id}
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onFocus={() => setSelectedIndex(index)}
                onClick={() => {
                  retroSynth.cartBoot();
                  onSelectCartridge(cart.id);
                }}
                className={`group text-left rounded-md border p-3.5 transition-all cursor-pointer flex flex-col gap-3 ${
                  isSelected
                    ? 'border-crt-phosphor bg-crt-elevated shadow-[0_0_24px_-10px_var(--color-crt-phosphor)]'
                    : 'border-crt-border bg-crt-surface hover:border-crt-border-strong'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em]">
                      <span
                        className={`px-1.5 py-0.5 rounded-[3px] border ${
                          isSelected
                            ? 'border-crt-phosphor/60 bg-crt-phosphor/15 text-crt-phosphor'
                            : 'border-crt-border bg-crt-bg text-crt-muted'
                        }`}
                      >
                        {cart.slot}
                      </span>
                      {konamiBonus && (
                        <span className="text-crt-amber truncate">★ {cart.konamiPerk}</span>
                      )}
                    </div>
                    <h3
                      className={`font-display text-base font-bold tracking-[0.04em] uppercase transition-colors ${
                        isSelected ? 'text-crt-phosphor' : 'text-crt-text group-hover:text-crt-phosphor'
                      }`}
                    >
                      {cart.title}
                    </h3>
                    <p className="text-xs text-crt-muted leading-snug">{cart.subtitle}</p>
                  </div>

                  <div className="w-[84px] h-[52px] shrink-0 rounded-[4px] border border-crt-border bg-crt-bg/95 p-1 flex items-center justify-center">
                    <CartridgeArtwork id={cart.id} />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-crt-border/70 text-[11px] font-mono tabular-nums">
                  <span className="text-crt-muted truncate">{cart.controlsHint}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {best > 0 ? (
                      <span className="inline-flex items-center gap-1 text-crt-amber font-semibold">
                        <Trophy className="h-3 w-3" />
                        {best.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-crt-muted/75">NO SCORE</span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] font-display text-[10px] font-bold uppercase tracking-[0.08em] ${
                        isSelected
                          ? 'bg-crt-phosphor text-crt-bg'
                          : 'border border-crt-border bg-crt-bg text-crt-muted group-hover:text-crt-text'
                      }`}
                    >
                      <Play className="h-2.5 w-2.5 fill-current" />
                      Boot
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono text-crt-muted/85">
          <span>Press 1–4 to boot directly · M mute SFX · Esc close cabinet</span>
          <span className="text-crt-phosphor/80">SYNCED TO ACTIVE CRT PHOSPHOR</span>
        </div>
      </div>
    </>
  );
}
