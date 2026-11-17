import type { CSSProperties } from 'react';
import { Monitor, RotateCcw } from 'lucide-react';
import {
  clampCrtPct,
  CRT_PALETTES,
  CRT_PRESETS,
  CRT_UI_MOTION_LEVELS,
  type CrtDisplaySettings,
  type CrtFxValues,
  type CrtPalette,
  type CrtPresetId,
  DEFAULT_CRT_DISPLAY_SETTINGS,
  detectActiveCrtPreset,
} from '../shared/crtDisplay';

interface CrtDisplayControlProps {
  settings: CrtDisplaySettings;
  onChange: (next: CrtDisplaySettings) => void;
}

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

export function CrtDisplayControl({ settings, onChange }: CrtDisplayControlProps) {
  const activePreset = detectActiveCrtPreset(settings);
  const presetStatus = !settings.enabled
    ? 'Bypassed'
    : activePreset === 'custom'
      ? 'Custom'
      : CRT_PRESETS[activePreset].label;

  const handleToggleMaster = () => {
    onChange({ ...settings, enabled: !settings.enabled });
  };

  const handleSelectPreset = (id: CrtPresetId) => {
    onChange({
      ...settings,
      enabled: true,
      ...CRT_PRESETS[id].values,
    });
  };

  const handleResetDefault = () => {
    onChange({ ...DEFAULT_CRT_DISPLAY_SETTINGS });
  };

  const handleSelectPalette = (palette: CrtPalette) => {
    onChange({
      ...settings,
      palette,
    });
  };

  const handleSliderChange = (key: keyof CrtFxValues, raw: number) => {
    const nextVal = clampCrtPct(raw, settings[key]);
    onChange({
      ...settings,
      enabled: nextVal > 0 ? true : settings.enabled,
      [key]: nextVal,
    });
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
          <div className="flex items-center justify-between text-[10px] font-mono text-crt-muted">
            <span>Presets</span>
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
          <div className="grid grid-cols-3 gap-1">
            {(['subtle', 'pvm', 'arcade'] as const).map((id) => {
              const isSelected = settings.enabled && activePreset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectPreset(id)}
                  title={CRT_PRESETS[id].description}
                  className={`px-1.5 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'border-crt-phosphor/60 bg-crt-elevated text-crt-phosphor font-medium'
                      : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                  }`}
                >
                  {CRT_PRESETS[id].label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Phosphor Palette Selector */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono text-crt-muted">Phosphor Palette</div>
          <div className="grid grid-cols-3 gap-1">
            {(['green', 'amber', 'cyan'] as const).map((id) => {
              const pal = CRT_PALETTES[id];
              const active = settings.palette === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleSelectPalette(id)}
                  className={`inline-flex items-center justify-center gap-1.5 px-1.5 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-crt-phosphor/60 bg-crt-elevated text-crt-text font-medium'
                      : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text hover:border-crt-border-strong'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full shrink-0 ${pal.swatchClass}`}
                  />
                  <span>{pal.label}</span>
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
