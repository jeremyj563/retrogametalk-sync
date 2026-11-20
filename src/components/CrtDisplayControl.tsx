import { type CSSProperties, useState } from 'react';
import { Lock, Monitor, RotateCcw, Waves } from 'lucide-react';
import {
  BVM_PRESET_REQUIRED_POINTS,
  isBvmPresetUnlocked,
  isPaletteUnlocked,
  PALETTE_REQUIRED_POINTS,
} from '../shared/achievementRewards';
import {
  clampCrtPct,
  CRT_BONUS_PALETTES,
  CRT_CORE_PALETTES,
  CRT_PALETTES,
  CRT_PRESETS,
  CRT_UI_MOTION_LEVELS,
  type CrtDisplaySettings,
  type CrtFxValues,
  type CrtPalette,
  type CrtPresetId,
  DEFAULT_CRT_DISPLAY_SETTINGS,
  detectActiveCrtPreset,
  extractCrtFxValues,
} from '../shared/crtDisplay';

interface CrtDisplayControlProps {
  settings: CrtDisplaySettings;
  earnedPoints?: number;
  onChange: (next: CrtDisplaySettings) => void;
}

const ALL_CRT_PALETTES: readonly CrtPalette[] = [
  ...CRT_CORE_PALETTES,
  ...CRT_BONUS_PALETTES,
];

const PALETTE_POINTS_BY_ID: Partial<Record<CrtPalette, number>> = PALETTE_REQUIRED_POINTS;

const SLIDER_FIELDS: {
  key: keyof CrtFxValues;
  label: string;
  hint: string;
}[] = [
  { key: 'scanlines', label: 'Scanlines', hint: 'Horizontal CRT raster lines' },
  { key: 'gaussGlow', label: 'Gauss Glow', hint: 'Phosphor halo bloom on accents & display type' },
  { key: 'vignette', label: 'Vignette', hint: 'Curved monitor corner & edge falloff' },
  { key: 'apertureGrille', label: 'Aperture Grille', hint: 'Vertical RGB phosphor triad mask' },
  { key: 'chromaticAberration', label: 'RGB Fringe', hint: 'Subtle horizontal beam convergence shift' },
];

function formatCustomSummary(values: CrtFxValues): string {
  return `Scan ${values.scanlines}% · Glow ${values.gaussGlow}% · Vig ${values.vignette}% · Grille ${values.apertureGrille}% · RGB ${values.chromaticAberration}%`;
}

export function CrtDisplayControl({
  settings,
  earnedPoints = 0,
  onChange,
}: CrtDisplayControlProps) {
  const [previewPalette, setPreviewPalette] = useState<CrtPalette | null>(null);
  const bvmUnlocked = isBvmPresetUnlocked(earnedPoints);
  const activePreset = detectActiveCrtPreset(settings);
  const savedCustom =
    activePreset === 'custom' ? extractCrtFxValues(settings) : settings.customValues;
  const canRestoreCustom = activePreset !== 'custom' && Boolean(savedCustom);
  const headerPaletteId = previewPalette ?? settings.palette;
  const headerPalette = CRT_PALETTES[headerPaletteId];
  const headerPaletteUnlocked = isPaletteUnlocked(headerPaletteId, earnedPoints);
  const headerPaletteReqPts = PALETTE_POINTS_BY_ID[headerPaletteId] ?? 0;

  const presetStatus = !settings.enabled
    ? 'Bypassed'
    : activePreset === 'custom'
      ? 'Custom'
      : CRT_PRESETS[activePreset].label;

  const handleToggleMaster = () => {
    onChange({ ...settings, enabled: !settings.enabled });
  };

  const handleRestoreCustom = () => {
    if (!savedCustom) return;
    onChange({
      ...settings,
      enabled: true,
      ...savedCustom,
      customValues: savedCustom,
    });
  };

  const handleSelectPreset = (id: CrtPresetId) => {
    if (id === 'bvm' && !bvmUnlocked) return;
    const isCurrentlySelected = settings.enabled && activePreset === id;
    if (isCurrentlySelected && savedCustom) {
      handleRestoreCustom();
      return;
    }

    onChange({
      ...settings,
      enabled: true,
      ...CRT_PRESETS[id].values,
      ...(savedCustom ? { customValues: savedCustom } : {}),
    });
  };

  const handleResetDefault = () => {
    onChange({ ...DEFAULT_CRT_DISPLAY_SETTINGS });
  };

  const handleSelectPalette = (palette: CrtPalette) => {
    if (!isPaletteUnlocked(palette, earnedPoints)) return;
    onChange({
      ...settings,
      palette,
    });
  };

  const handleSliderChange = (key: keyof CrtFxValues, raw: number) => {
    const nextVal = clampCrtPct(raw, settings[key]);
    const nextSettings: CrtDisplaySettings = {
      ...settings,
      enabled: nextVal > 0 ? true : settings.enabled,
      [key]: nextVal,
    };
    const nextFx = extractCrtFxValues(nextSettings);
    if (detectActiveCrtPreset(nextFx) === 'custom') {
      nextSettings.customValues = nextFx;
    }
    onChange(nextSettings);
  };

  return (
    <div className="hidden lg:block border-t border-crt-border pt-4 space-y-3">
      {/* Permanent Section Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 min-w-0 text-xs font-medium text-crt-muted">
          <Monitor className="h-3.5 w-3.5 shrink-0 text-crt-phosphor" />
          <span className="truncate">CRT Display</span>
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono text-crt-muted/85 whitespace-nowrap">
            {presetStatus}
          </span>
          <button
            type="button"
            aria-pressed={settings.enabled}
            onClick={handleToggleMaster}
            title={settings.enabled ? 'Bypass all CRT visual effects' : 'Enable CRT visual effects'}
            className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              settings.enabled
                ? 'border-crt-phosphor/50 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20'
                : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text'
            }`}
          >
            {settings.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Always-Open Hardware Tuner Card */}
      <div className="crt-tuner-card relative rounded border border-crt-border bg-crt-bg/80 p-2.5 space-y-3">
        {/* Quick Presets & Reset */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-crt-muted">
            <span>Presets</span>
            <div className="flex items-center gap-1.5">
              {canRestoreCustom && savedCustom && (
                <>
                  <button
                    type="button"
                    onClick={handleRestoreCustom}
                    title={`Restore saved Custom settings (${formatCustomSummary(savedCustom)}) — or click the active preset again to untoggle`}
                    className="text-crt-phosphor/85 hover:text-crt-phosphor transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Custom
                  </button>
                  <span aria-hidden="true" className="text-crt-border-strong">
                    ·
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={handleResetDefault}
                title="Reset palette, motion, and sliders back to Subtle defaults"
                className="inline-flex items-center gap-1 text-crt-muted hover:text-crt-phosphor transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(['subtle', 'pvm', 'arcade', 'bvm'] as const).map((id) => {
              const locked = id === 'bvm' && !bvmUnlocked;
              const isSelected = !locked && settings.enabled && activePreset === id;
              const canUntoggle = isSelected && Boolean(savedCustom);
              const tooltip = locked
                ? `Broadcast BVM monitor preset · Unlock at ${BVM_PRESET_REQUIRED_POINTS.toLocaleString()} trophy pts`
                : canUntoggle && savedCustom
                  ? `${CRT_PRESETS[id].description} — click again to untoggle back to Custom (${formatCustomSummary(savedCustom)})`
                  : CRT_PRESETS[id].description;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={locked}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectPreset(id)}
                  title={tooltip}
                  className={`inline-flex items-center justify-center gap-0.5 px-1 py-1 text-[10px] font-mono rounded border transition-colors whitespace-nowrap ${
                    locked
                      ? 'border-crt-border/70 bg-crt-bg/50 text-crt-muted/50 cursor-not-allowed'
                      : isSelected
                        ? 'border-crt-phosphor/60 bg-crt-elevated text-crt-phosphor font-medium cursor-pointer'
                        : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong cursor-pointer'
                  }`}
                >
                  {locked && <Lock className="h-2.5 w-2.5 shrink-0" />}
                  <span>{CRT_PRESETS[id].label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Phosphor Palette Selector — Uniform 7-Swatch Hardware Strip */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-crt-muted">
            <span className="shrink-0">Phosphor Palette</span>
            <span
              className={`inline-flex items-center gap-1 min-w-0 truncate ${
                headerPaletteUnlocked ? 'text-crt-text/85' : 'text-crt-muted/75'
              }`}
            >
              {!headerPaletteUnlocked && <Lock className="h-2.5 w-2.5 shrink-0" />}
              <span className="truncate">
                {headerPaletteUnlocked
                  ? headerPalette.label
                  : `${headerPalette.label} · ${headerPaletteReqPts.toLocaleString()} pts`}
              </span>
            </span>
          </div>
          <div
            className="grid grid-cols-7 gap-1"
            role="group"
            aria-label="CRT Phosphor Palette"
          >
            {ALL_CRT_PALETTES.map((id) => {
              const pal = CRT_PALETTES[id];
              const reqPts = PALETTE_POINTS_BY_ID[id] ?? 0;
              const unlocked = isPaletteUnlocked(id, earnedPoints);
              const active = unlocked && settings.palette === id;
              const swatchStyle = {
                '--crt-swatch-rgb': pal.rgb,
              } as CSSProperties;
              const tooltip = unlocked
                ? reqPts > 0
                  ? `${pal.label} · Collector phosphor palette`
                  : `${pal.label} phosphor palette`
                : `${pal.label} · Unlock at ${reqPts.toLocaleString()} trophy pts`;

              return (
                <button
                  key={id}
                  type="button"
                  data-crt-palette={id}
                  aria-pressed={active}
                  aria-disabled={!unlocked}
                  aria-label={
                    unlocked
                      ? `${pal.label} phosphor palette`
                      : `${pal.label} phosphor palette, locked until ${reqPts.toLocaleString()} trophy points`
                  }
                  onClick={() => handleSelectPalette(id)}
                  onMouseEnter={() => setPreviewPalette(id)}
                  onMouseLeave={() => setPreviewPalette((curr) => (curr === id ? null : curr))}
                  onFocus={() => setPreviewPalette(id)}
                  onBlur={() => setPreviewPalette((curr) => (curr === id ? null : curr))}
                  title={tooltip}
                  style={swatchStyle}
                  className={`group relative inline-flex h-7 w-full items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-crt-phosphor/80 focus-visible:ring-offset-1 focus-visible:ring-offset-crt-bg ${
                    !unlocked
                      ? 'border-crt-border/65 bg-crt-bg/45 text-crt-muted/65 hover:border-crt-border-strong/75 cursor-not-allowed'
                      : active
                        ? 'crt-palette-key-active border-crt-phosphor/75 bg-crt-elevated cursor-pointer'
                        : 'border-crt-border bg-crt-surface hover:border-crt-border-strong hover:bg-crt-elevated/65 cursor-pointer'
                  }`}
                >
                  <span className="sr-only">{pal.shortLabel}</span>
                  {unlocked ? (
                    <span
                      aria-hidden="true"
                      className={`w-2.5 h-2.5 rounded-full shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
                        pal.swatchClass
                      } ${active ? 'crt-palette-swatch-active scale-110' : 'group-hover:scale-110'}`}
                    />
                  ) : (
                    <>
                      <span
                        aria-hidden="true"
                        className={`w-3.5 h-3.5 rounded-full opacity-25 ${pal.swatchClass}`}
                      />
                      <Lock
                        aria-hidden="true"
                        className="absolute h-2.5 w-2.5 text-crt-muted/80"
                      />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Living UI Motion Presets */}
        <div className="space-y-1.5 pt-2 border-t border-crt-border/70">
          <div className="flex items-center justify-between text-[10px] font-mono text-crt-muted">
            <span>Living UI Motion</span>
            <span
              className={
                settings.uiMotion === 'ultra'
                  ? 'text-crt-phosphor font-semibold'
                  : 'text-crt-text/85'
              }
            >
              {settings.uiMotion === 'ultra'
                ? 'Ultra · Boosted'
                : CRT_UI_MOTION_LEVELS[settings.uiMotion].label}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1" role="group" aria-label="Living UI animation level">
            {(['off', 'low', 'medium', 'high', 'ultra'] as const).map((level) => {
              const info = CRT_UI_MOTION_LEVELS[level];
              const active = settings.uiMotion === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={active}
                  title={info.description}
                  onClick={() => onChange({ ...settings, uiMotion: level })}
                  className={`px-0.5 py-1 text-[10px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? level === 'off'
                        ? 'border-crt-border-strong bg-crt-elevated text-crt-text font-medium'
                        : level === 'ultra'
                          ? 'crt-ultra-pill-active border-crt-phosphor bg-crt-phosphor/15 text-crt-phosphor font-semibold'
                          : 'border-crt-phosphor/60 bg-crt-elevated text-crt-phosphor font-medium'
                      : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                  }`}
                >
                  {info.shortLabel}
                </button>
              );
            })}
          </div>

          {/* Independent Sync Status Speed Wave toggle */}
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span
              title={
                settings.uiMotion === 'off'
                  ? 'Requires Living UI Motion set to Low or higher'
                  : 'Oscilloscope & transfer bar wave in Sync Status that speeds up with live download throughput'
              }
              className={`inline-flex items-center gap-1.5 min-w-0 text-[10px] font-mono ${
                settings.uiMotion === 'off' ? 'text-crt-muted/55' : 'text-crt-muted'
              }`}
            >
              <Waves
                className={`h-3 w-3 shrink-0 ${
                  settings.uiMotion !== 'off' && settings.syncSpeedWave
                    ? 'text-crt-phosphor'
                    : 'text-crt-muted/60'
                }`}
              />
              <span className="truncate">Sync Speed Wave</span>
            </span>
            <button
              type="button"
              disabled={settings.uiMotion === 'off'}
              aria-pressed={settings.uiMotion !== 'off' && settings.syncSpeedWave}
              onClick={() =>
                onChange({
                  ...settings,
                  syncSpeedWave: !settings.syncSpeedWave,
                })
              }
              title={
                settings.uiMotion === 'off'
                  ? 'Set Living UI Motion to Low or higher to activate the Sync Speed Wave'
                  : settings.syncSpeedWave
                    ? 'Disable Sync Status speed wave without turning off other Living UI Motion effects'
                    : 'Enable speed-reactive Sync Status wave effect'
              }
              className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border transition-colors whitespace-nowrap shrink-0 ${
                settings.uiMotion === 'off'
                  ? 'border-crt-border/60 bg-crt-bg/50 text-crt-muted/45 cursor-not-allowed'
                  : settings.syncSpeedWave
                    ? 'border-crt-phosphor/55 bg-crt-phosphor/12 text-crt-phosphor hover:bg-crt-phosphor/20 cursor-pointer'
                    : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong cursor-pointer'
              }`}
            >
              {settings.uiMotion === 'off'
                ? 'OFF'
                : settings.syncSpeedWave
                  ? 'ON'
                  : 'OFF'}
            </button>
          </div>
        </div>

        {/* Real-Time FX Sliders */}
        <div className="space-y-2 pt-2 border-t border-crt-border/70">
          {SLIDER_FIELDS.map(({ key, label, hint }) => {
            const value = settings[key];
            const pctDisplay = settings.enabled ? value : 0;
            return (
              <div key={key} className="space-y-1" title={hint}>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className={settings.enabled ? 'text-crt-muted' : 'text-crt-muted/60'}>
                    {label}
                  </span>
                  <span
                    className={`tabular-nums ${
                      settings.enabled && value > 0 ? 'text-crt-text' : 'text-crt-muted/60'
                    }`}
                  >
                    {value}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  aria-label={`${label} intensity`}
                  onChange={(e) => handleSliderChange(key, Number(e.target.value))}
                  style={
                    {
                      '--slider-pct': `${pctDisplay}%`,
                      '--crt-range-fill': settings.enabled
                        ? 'var(--color-crt-phosphor)'
                        : 'var(--color-crt-border-strong)',
                      '--crt-range-thumb': settings.enabled
                        ? 'var(--color-crt-phosphor)'
                        : 'var(--color-crt-muted)',
                    } as CSSProperties
                  }
                  className="crt-range w-full block"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
