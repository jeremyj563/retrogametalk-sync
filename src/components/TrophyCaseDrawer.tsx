import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Eye,
  EyeOff,
  Lock,
  Search,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  type AchievementCategory,
  type AchievementRecord,
  type AchievementsSnapshot,
  CATEGORY_LABELS,
} from '../shared/achievements';
import { formatDateTime } from '../utils/format';
import { retroSynth } from '../utils/retroSynth';
import { getTierVisuals, TrophyTierMedallion } from './TrophyToastStack';

interface TrophyCaseDrawerProps {
  open: boolean;
  snapshot: AchievementsSnapshot | null;
  loading: boolean;
  focusedTrophyId: string | null;
  quietMode: boolean;
  onToggleQuietMode: (next: boolean) => void;
  onClose: () => void;
}

type StatusFilter = 'all' | 'unlocked' | 'locked';
type DrawerPhase = 'entering' | 'open' | 'closing';

const CATEGORY_ORDER: AchievementCategory[] = [
  'preservation',
  'collector',
  'catalog',
  'handheld',
  'crt_ops',
  'resilience',
  'secret',
];

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TrophyCaseDrawer({
  open,
  snapshot,
  loading,
  focusedTrophyId,
  quietMode,
  onToggleQuietMode,
  onClose,
}: TrophyCaseDrawerProps) {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<DrawerPhase>(open ? 'entering' : 'closing');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AchievementCategory>('all');
  const [search, setSearch] = useState('');
  const [revealedHints, setRevealedHints] = useState<Set<string>>(() => new Set());
  const [muted, setMuted] = useState<boolean>(() => retroSynth.isMuted());

  const phaseRef = useRef<DrawerPhase>(phase);
  phaseRef.current = phase;
  const openRaf1Ref = useRef<number | null>(null);
  const openRaf2Ref = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const itemRowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const clearOpenRafs = useCallback(() => {
    if (openRaf1Ref.current !== null) {
      window.cancelAnimationFrame(openRaf1Ref.current);
      openRaf1Ref.current = null;
    }
    if (openRaf2Ref.current !== null) {
      window.cancelAnimationFrame(openRaf2Ref.current);
      openRaf2Ref.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (open) {
      clearCloseTimer();
      setRendered(true);
      setMuted(retroSynth.isMuted());
      if (phaseRef.current !== 'open') {
        setPhase('entering');
        clearOpenRafs();
        openRaf1Ref.current = window.requestAnimationFrame(() => {
          openRaf1Ref.current = null;
          openRaf2Ref.current = window.requestAnimationFrame(() => {
            openRaf2Ref.current = null;
            setPhase('open');
          });
        });
      }
    } else if (rendered) {
      clearOpenRafs();
      setPhase('closing');
      clearCloseTimer();
      const durationMs = prefersReducedMotion() ? 110 : 270;
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setRendered(false);
      }, durationMs);
    }
  }, [open, rendered, clearCloseTimer, clearOpenRafs]);

  useEffect(() => {
    return () => {
      clearOpenRafs();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenRafs]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Reset filters & scroll to focused trophy when opened from a toast click
  useEffect(() => {
    if (!open || !focusedTrophyId) return;
    setStatusFilter('all');
    setCategoryFilter('all');
    setSearch('');
    const timer = window.setTimeout(() => {
      const node = itemRowRefs.current.get(focusedTrophyId);
      if (node) {
        node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, focusedTrophyId]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    retroSynth.setMuted(next);
    if (!next) {
      retroSynth.trophyUnlock('bronze');
    }
  };

  const toggleHint = (id: string) => {
    setRevealedHints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredItems = useMemo<AchievementRecord[]>(() => {
    const all = snapshot?.items ?? [];
    const q = search.trim().toLowerCase();

    return all.filter((item) => {
      if (statusFilter === 'unlocked' && !item.unlocked) return false;
      if (statusFilter === 'locked' && item.unlocked) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

      if (q) {
        const isMasked = item.hidden && !item.unlocked;
        const searchable = isMasked
          ? `hidden trophy secret ${CATEGORY_LABELS[item.category]} ${item.tier}`
          : `${item.title} ${item.description} ${CATEGORY_LABELS[item.category]} ${item.tier}`;
        if (!searchable.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [snapshot, statusFilter, categoryFilter, search]);

  const groupedByCategory = useMemo(() => {
    const groups = new Map<AchievementCategory, AchievementRecord[]>();
    for (const cat of CATEGORY_ORDER) {
      groups.set(cat, []);
    }
    for (const item of filteredItems) {
      groups.get(item.category)?.push(item);
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      items: groups.get(cat) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [filteredItems]);

  if (!rendered) return null;

  const summary = snapshot?.summary;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trophy-case-title"
      data-drawer-state={phase}
      onClick={onClose}
      className="crt-detail-backdrop fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex justify-end"
    >
      <div
        data-drawer-state={phase}
        onClick={(e) => e.stopPropagation()}
        className="crt-detail-sheet crt-drawer-panel w-full max-w-2xl h-full bg-crt-surface border-l border-crt-border-strong shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Top Drawer Header */}
        <div className="px-5 py-4 bg-crt-bg/95 border-b border-crt-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-[5px] border border-crt-amber/50 bg-crt-amber/12 text-crt-amber flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="trophy-case-title"
                className="font-display text-base font-bold text-crt-text tracking-[0.02em] truncate"
              >
                Trophy Case
              </h2>
              <div className="flex items-center gap-2 text-xs font-mono text-crt-muted tabular-nums">
                <span>
                  {summary ? `${summary.unlockedCount} / ${summary.totalCount} unlocked` : 'Loading...'}
                </span>
                {summary && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-crt-phosphor">{summary.completionPercent}%</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-crt-amber">
                      {summary.earnedPoints.toLocaleString()} / {summary.maxPoints.toLocaleString()} pts
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              title={muted ? 'Unmute trophy chimes' : 'Mute trophy chimes'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors whitespace-nowrap cursor-pointer"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{muted ? 'SFX Off' : 'SFX On'}</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleQuietMode(!quietMode)}
              aria-pressed={quietMode}
              title={
                quietMode
                  ? 'Quiet Mode ON: trophy popups paused (unlocks still recorded)'
                  : 'Quiet Mode OFF: console popups active'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border rounded transition-colors whitespace-nowrap cursor-pointer ${
                quietMode
                  ? 'border-crt-amber/60 bg-crt-amber/12 text-crt-amber'
                  : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
              }`}
            >
              {quietMode ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{quietMode ? 'Quiet' : 'Popups'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Trophy Case"
              className="p-1.5 rounded border border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Unboxed Progress & Tier Breakdown Strip */}
        {summary && (
          <div className="px-5 py-3.5 bg-crt-bg/55 border-b border-crt-border space-y-2.5 shrink-0">
            <div className="h-2 w-full rounded-[3px] bg-crt-bg border border-crt-border overflow-hidden">
              <div
                style={{ width: `${summary.completionPercent}%` }}
                className="h-full bg-crt-phosphor transition-all duration-300"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[#d9915b]">
                  Bronze {summary.byTier.bronze.unlocked}/{summary.byTier.bronze.total}
                </span>
                <span aria-hidden="true" className="text-crt-border-strong">
                  ·
                </span>
                <span className="text-[#cfdbe6]">
                  Silver {summary.byTier.silver.unlocked}/{summary.byTier.silver.total}
                </span>
                <span aria-hidden="true" className="text-crt-border-strong">
                  ·
                </span>
                <span className="text-crt-amber">
                  Gold {summary.byTier.gold.unlocked}/{summary.byTier.gold.total}
                </span>
                <span aria-hidden="true" className="text-crt-border-strong">
                  ·
                </span>
                <span className="text-crt-phosphor">
                  Platinum {summary.byTier.platinum.unlocked}/{summary.byTier.platinum.total}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Filter & Search Toolbar */}
        <div className="px-5 py-3 bg-crt-surface border-b border-crt-border flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-[170px]">
            <Search className="h-3.5 w-3.5 text-crt-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trophies..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear trophy search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="Filter by unlock status"
            className="flex items-center gap-0.5 p-0.5 bg-crt-bg border border-crt-border rounded-[5px] shrink-0"
          >
            {(['all', 'unlocked', 'locked'] as const).map((mode) => {
              const active = statusFilter === mode;
              const label = mode === 'all' ? 'All' : mode === 'unlocked' ? 'Unlocked' : 'Locked';
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStatusFilter(mode)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-[4px] transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                      : 'text-crt-muted hover:text-crt-text border border-transparent'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | AchievementCategory)}
            className="px-2.5 py-1.5 text-xs bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor cursor-pointer"
          >
            <option value="all">All Categories</option>
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>

        {/* Scrollable Trophy List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading && !snapshot ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-[74px] border border-crt-border bg-crt-bg/60 rounded-[5px] animate-pulse"
                />
              ))}
            </div>
          ) : groupedByCategory.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-crt-muted">No trophies match your current filter.</p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setCategoryFilter('all');
                  setSearch('');
                }}
                className="px-3.5 py-1.5 text-xs font-mono border border-crt-border bg-crt-bg text-crt-text hover:border-crt-phosphor rounded transition-colors cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            groupedByCategory.map((group) => {
              const unlockedInGroup = group.items.filter((i) => i.unlocked).length;
              return (
                <section key={group.category} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-crt-border/80">
                    <h3 className="font-display text-xs font-semibold tracking-[0.04em] text-crt-text">
                      {group.label}
                    </h3>
                    <span className="text-[11px] font-mono text-crt-muted tabular-nums">
                      {unlockedInGroup} / {group.items.length}
                    </span>
                  </div>

                  <ul className="divide-y divide-crt-border/70 border border-crt-border rounded-[5px] bg-crt-bg/45 overflow-hidden">
                    {group.items.map((item) => {
                      const vis = getTierVisuals(item.tier);
                      const isMasked = item.hidden && !item.unlocked;
                      const hintShown = revealedHints.has(item.id);
                      const isFocused = focusedTrophyId === item.id;
                      const pct =
                        item.progressTarget > 0
                          ? Math.min(100, Math.round((item.progressCurrent / item.progressTarget) * 100))
                          : 0;

                      return (
                        <li
                          key={item.id}
                          ref={(node) => {
                            if (node) {
                              itemRowRefs.current.set(item.id, node);
                            } else {
                              itemRowRefs.current.delete(item.id);
                            }
                          }}
                          className={`px-3.5 py-3 flex items-start gap-3 transition-colors ${
                            isFocused
                              ? 'bg-crt-phosphor/10'
                              : item.unlocked
                                ? 'bg-crt-surface/65'
                                : 'bg-transparent'
                          }`}
                        >
                          <div className="pt-0.5">
                            {isMasked ? (
                              <div className="h-9 w-9 rounded-[5px] border border-crt-border bg-crt-bg text-crt-muted/55 flex items-center justify-center shrink-0">
                                <Lock className="h-4 w-4" />
                              </div>
                            ) : (
                              <TrophyTierMedallion tier={item.tier} unlocked={item.unlocked} size="md" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div className="flex items-baseline gap-2 min-w-0">
                                <span
                                  className={`font-display text-sm font-semibold truncate ${
                                    item.unlocked ? 'text-crt-text' : 'text-crt-text/80'
                                  }`}
                                >
                                  {isMasked ? 'Hidden Trophy' : item.title}
                                </span>
                                <span
                                  className={`text-[11px] font-mono ${
                                    item.unlocked ? vis.textClass : 'text-crt-muted'
                                  }`}
                                >
                                  {vis.label}
                                </span>
                              </div>

                              <span className="text-[11px] font-mono text-crt-muted tabular-nums shrink-0">
                                {item.unlocked ? `+${item.points} pts` : `${item.points} pts`}
                              </span>
                            </div>

                            {isMasked ? (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs text-crt-muted leading-relaxed">
                                  {hintShown && item.hint
                                    ? item.hint
                                    : 'Details hidden until unlocked.'}
                                </p>
                                {item.hint && (
                                  <button
                                    type="button"
                                    onClick={() => toggleHint(item.id)}
                                    className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted hover:text-crt-phosphor transition-colors shrink-0 cursor-pointer"
                                  >
                                    {hintShown ? (
                                      <>
                                        <EyeOff className="h-3 w-3" />
                                        Hide Hint
                                      </>
                                    ) : (
                                      <>
                                        <Eye className="h-3 w-3" />
                                        Reveal Hint
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-crt-muted leading-relaxed">
                                {item.description}
                              </p>
                            )}

                            {/* Progress Bar for multi-step locked trophies */}
                            {!item.unlocked && !isMasked && item.progressTarget > 1 && (
                              <div className="pt-1 flex items-center gap-2.5">
                                <div className="flex-1 h-1.5 rounded-[2px] bg-crt-bg border border-crt-border overflow-hidden">
                                  <div
                                    style={{ width: `${pct}%` }}
                                    className="h-full bg-crt-phosphor/70 transition-all duration-300"
                                  />
                                </div>
                                <span className="text-[11px] font-mono text-crt-muted tabular-nums shrink-0">
                                  {item.progressCurrent.toLocaleString()} /{' '}
                                  {item.progressTarget.toLocaleString()}
                                  {item.progressUnit ? ` ${item.progressUnit}` : ''}
                                </span>
                              </div>
                            )}

                            {/* Unlock timestamp */}
                            {item.unlocked && item.unlockedAt && (
                              <div className="pt-0.5 text-[11px] font-mono text-crt-muted/85 tabular-nums">
                                Unlocked {formatDateTime(item.unlockedAt)}
                                {item.silent ? ' · Synced from existing library' : ''}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
