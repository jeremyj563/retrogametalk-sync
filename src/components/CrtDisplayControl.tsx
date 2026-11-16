import type { CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Monitor, RotateCcw } from 'lucide-react';
import {
  clampCrtPct,
  CRT_PALETTES,
  CRT_PRESETS,
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
  const presetBadge = !settings.enabled
    ? 'Bypassed'
    : activePreset === 'custom'
      ? 'Custom'
      : CRT_PRESETS[activePreset].label;

  const handleToggleMaster = () => {
    onChange({ ...settings, enabled: !settings.enabled });
  };

  const handleToggleExpanded = () => {
    onChange({ ...settings, panelOpen: !settings.panelOpen });
  };

  const handleSelectPreset = (id: CrtPresetId) => {
    onChange({
      ...settings,
      enabled: true,
      ...CRT_PRESETS[id].values,
    });
  };

  const handleResetDefault = () => {
    onChange({
      ...DEFAULT_CRT_DISPLAY_SETTINGS,
      panelOpen: settings.panelOpen,
    });
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
    <div className="border border-crt-border bg-crt-bg rounded overflow-hidden">
      {/* Collapsible Header Bar */}
      <div className="px-2.5 py-2 flex items-center justify-between gap-1.5">
        <button
          type="button"
          aria-expanded={settings.panelOpen}
          onClick={handleToggleExpanded}
          title={settings.panelOpen ? 'Collapse CRT display controls' : 'Expand CRT display controls'}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-xs font-mono text-crt-muted hover:text-crt-text transition-colors cursor-pointer"
        >
          <Monitor className="h-3.5 w-3.5 shrink-0 text-crt-phosphor" />
          <span className="truncate font-medium text-crt-text">CRT Display</span>
          {settings.panelOpen ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-crt-muted" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-crt-muted" />
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {!settings.panelOpen && (
            <span className="text-[10px] font-mono text-crt-muted whitespace-nowrap">
              {presetBadge}
            </span>
          )}
          <button
            type="button"
            aria-pressed={settings.enabled}
            onClick={handleToggleMaster}
            title={settings.enabled ? 'Bypass all CRT visual effects' : 'Enable CRT visual effects'}
            className={`px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              settings.enabled
                ? 'border-crt-phosphor/50 bg-crt-phosphor/10 text-crt-phosphor hover:bg-crt-phosphor/20'
                : 'border-crt-border bg-crt-surface text-crt-muted hover:text-crt-text'
            }`}
          >
            {settings.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Expandable Display Tuner Controls */}
      {settings.panelOpen && (
        <div className="px-2.5 pb-2.5 pt-2 border-t border-crt-border space-y-3">
          {/* Quick Presets & Reset */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-crt-muted">
              <span>Presets</span>
              <button
                type="button"
                onClick={handleResetDefault}
                title="Reset palette and sliders back to Subtle defaults"
                className="inline-flex items-center gap-1 text-crt-muted hover:text-crt-phosphor transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                <span>Reset Default</span>
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
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: pal.swatch }}
                    />
                    <span>{pal.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Real-Time FX Sliders */}
          <div className="space-y-2.5 pt-1 border-t border-crt-border/70">
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
      )}
    </div>
  );
}
