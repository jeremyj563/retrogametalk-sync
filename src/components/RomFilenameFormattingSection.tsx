import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
} from 'lucide-react';
import {
  findActiveNamingPreset,
  insertNamingTokenAtSelection,
  ROM_NAMING_TOKEN_HELPERS,
  summarizeNamingOptions,
  type NamingTokenGroup,
  type NamingTokenHelper,
} from '../shared/deviceExportUi';
import {
  BUILT_IN_NAMING_PREVIEW_SAMPLES,
  DEFAULT_ROM_NAMING_TEMPLATE,
  formatPreparedRomNameDetailed,
  LEGACY_ROM_NAMING_TEMPLATE,
  ROM_NAMING_PRESETS,
  ROM_NAMING_PREVIEW_TYPE_KEYS,
  ROM_NAMING_TYPE_CATALOG,
  validateRomNamingTemplate,
  type RomNamingConfig,
  type RomNamingPreviewSample,
  type RomNamingSegment,
  type RomNamingTypeKey,
  type RomNamingTypeOverrides,
} from '../shared/romNaming';

interface NamingSamplesApiResponse {
  seed: number;
  samples: Partial<Record<RomNamingTypeKey, RomNamingPreviewSample>>;
  candidateCounts: Partial<Record<RomNamingTypeKey, number>>;
  matchedCount: number;
}

interface RomFilenameFormattingSectionProps {
  sectionRef: RefObject<HTMLElement | null>;
  spotlightNonce: number | null;
  romNamingTemplate: string;
  romNamingTypeOverrides: RomNamingTypeOverrides;
  romSanitizeFat32: boolean;
  romMaxFilenameLen: number;
  showAdvancedNaming: boolean;
  onToggleAdvancedNaming: () => void;
  onOpenAdvancedNaming: () => void;
  onChangeTemplate: (next: string) => void;
  onChangeTypeOverrides: (next: RomNamingTypeOverrides) => void;
  onChangeSanitizeFat32: (next: boolean) => void;
  onChangeMaxFilenameLen: (next: number) => void;
}

const TOKEN_GROUPS: readonly { id: NamingTokenGroup; label: string }[] = [
  { id: 'core', label: 'Core' },
  { id: 'hybrid', label: 'Type-Aware' },
  { id: 'legacy', label: 'Legacy' },
] as const;

const MAX_LEN_PRESETS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Unlimited' },
  { value: 64, label: '64' },
  { value: 128, label: '128' },
  { value: 255, label: '255' },
] as const;

function renderHighlightedSegments(segments: readonly RomNamingSegment[]) {
  return segments.map((seg, idx) => {
    if (seg.kind === 'bracket') {
      return (
        <span key={idx} className="text-crt-phosphor">
          {seg.text}
        </span>
      );
    }
    if (seg.kind === 'paren') {
      return (
        <span key={idx} className="text-crt-muted">
          {seg.text}
        </span>
      );
    }
    if (seg.kind === 'ext') {
      return (
        <span key={idx} className="text-crt-muted/75">
          {seg.text}
        </span>
      );
    }
    return (
      <span key={idx} className="text-crt-text">
        {seg.text}
      </span>
    );
  });
}

export function RomFilenameFormattingSection({
  sectionRef,
  spotlightNonce,
  romNamingTemplate,
  romNamingTypeOverrides,
  romSanitizeFat32,
  romMaxFilenameLen,
  showAdvancedNaming,
  onToggleAdvancedNaming,
  onOpenAdvancedNaming,
  onChangeTemplate,
  onChangeTypeOverrides,
  onChangeSanitizeFat32,
  onChangeMaxFilenameLen,
}: RomFilenameFormattingSectionProps) {
  const [previewSource, setPreviewSource] = useState<'builtin' | 'catalog'>('builtin');
  const [catalogSamples, setCatalogSamples] = useState<
    Partial<Record<RomNamingTypeKey, RomNamingPreviewSample>>
  >({});
  const [catalogMatchedCount, setCatalogMatchedCount] = useState<number>(0);
  const [catalogSeed, setCatalogSeed] = useState<number>(0);
  const [catalogLoadedOnce, setCatalogLoadedOnce] = useState<boolean>(false);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [selectedSampleType, setSelectedSampleType] = useState<RomNamingTypeKey>('translation');
  const [hoveredToken, setHoveredToken] = useState<NamingTokenHelper | null>(null);
  const [activeEditorTarget, setActiveEditorTarget] = useState<'global' | RomNamingTypeKey>(
    'global',
  );
  const [addOverrideSelection, setAddOverrideSelection] = useState<string>('');

  const globalInputRef = useRef<HTMLInputElement | null>(null);
  const overrideInputRefs = useRef<Partial<Record<RomNamingTypeKey, HTMLInputElement | null>>>({});

  const namingConfig = useMemo<RomNamingConfig>(
    () => ({
      romNamingTemplate,
      romNamingTypeOverrides,
      romSanitizeFat32,
      romMaxFilenameLen,
    }),
    [romNamingTemplate, romNamingTypeOverrides, romSanitizeFat32, romMaxFilenameLen],
  );

  const activeNamingPreset = useMemo(
    () => findActiveNamingPreset(romNamingTemplate),
    [romNamingTemplate],
  );

  const namingOptionsSummary = useMemo(
    () => summarizeNamingOptions(namingConfig),
    [namingConfig],
  );

  const globalValidation = useMemo(
    () => validateRomNamingTemplate(romNamingTemplate),
    [romNamingTemplate],
  );

  const typeMetaById = useMemo(() => {
    const map = new Map<RomNamingTypeKey, (typeof ROM_NAMING_TYPE_CATALOG)[number]>();
    for (const meta of ROM_NAMING_TYPE_CATALOG) {
      map.set(meta.id, meta);
    }
    return map;
  }, []);

  const fetchCatalogSamples = useCallback(async (seed: number) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(`/api/device-export/naming-samples?seed=${encodeURIComponent(String(seed))}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Could not load catalog samples (HTTP ${res.status})`);
      }
      const data = (await res.json()) as NamingSamplesApiResponse;
      setCatalogSamples(data.samples || {});
      setCatalogMatchedCount(Number(data.matchedCount || 0));
      setCatalogLoadedOnce(true);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Failed to load catalog samples.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (previewSource === 'catalog' && !catalogLoadedOnce && !catalogLoading) {
      void fetchCatalogSamples(catalogSeed);
    }
  }, [previewSource, catalogLoadedOnce, catalogLoading, catalogSeed, fetchCatalogSamples]);

  const handleShuffleCatalogSamples = () => {
    const nextSeed = catalogSeed + 1;
    setCatalogSeed(nextSeed);
    void fetchCatalogSamples(nextSeed);
  };

  // Evaluate all 10 preview rows live (<1ms client-side)
  const previewRows = useMemo(() => {
    const builtInByType = new Map<RomNamingTypeKey, RomNamingPreviewSample>();
    for (const sample of BUILT_IN_NAMING_PREVIEW_SAMPLES) {
      builtInByType.set(sample.typeKey, sample);
    }

    return ROM_NAMING_PREVIEW_TYPE_KEYS.map((typeKey) => {
      const meta = typeMetaById.get(typeKey)!;
      const catalogMatch = previewSource === 'catalog' ? catalogSamples[typeKey] : undefined;
      const sample = catalogMatch ?? builtInByType.get(typeKey)!;
      const isCatalogFallback = previewSource === 'catalog' && !catalogMatch;
      const result = formatPreparedRomNameDetailed(sample.context, sample.extension, namingConfig);
      return {
        typeKey,
        meta,
        sample,
        isCatalogFallback,
        result,
      };
    });
  }, [previewSource, catalogSamples, namingConfig, typeMetaById]);

  const activePreviewRow = useMemo(
    () => previewRows.find((r) => r.typeKey === selectedSampleType) ?? previewRows[0]!,
    [previewRows, selectedSampleType],
  );

  const previewImpactStats = useMemo(() => {
    let sanitizedCount = 0;
    let truncatedCount = 0;
    for (const row of previewRows) {
      if (row.result.wasSanitized) sanitizedCount += 1;
      if (row.result.wasTruncated) truncatedCount += 1;
    }
    return { sanitizedCount, truncatedCount };
  }, [previewRows]);

  const activeOverrideEntries = useMemo(() => {
    const entries: Array<{ typeKey: RomNamingTypeKey; template: string }> = [];
    for (const meta of ROM_NAMING_TYPE_CATALOG) {
      const val = romNamingTypeOverrides[meta.id];
      if (typeof val === 'string') {
        entries.push({ typeKey: meta.id, template: val });
      }
    }
    return entries;
  }, [romNamingTypeOverrides]);

  const availableOverrideTypes = useMemo(
    () => ROM_NAMING_TYPE_CATALOG.filter((m) => romNamingTypeOverrides[m.id] === undefined),
    [romNamingTypeOverrides],
  );

  const handleStartTypeOverride = (typeKey: RomNamingTypeKey) => {
    onOpenAdvancedNaming();
    setSelectedSampleType(typeKey);
    if (romNamingTypeOverrides[typeKey] === undefined) {
      onChangeTypeOverrides({
        ...romNamingTypeOverrides,
        [typeKey]: romNamingTemplate.trim() || DEFAULT_ROM_NAMING_TEMPLATE,
      });
    }
    setActiveEditorTarget(typeKey);
    window.requestAnimationFrame(() => {
      const el = overrideInputRefs.current[typeKey];
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  const handleUpdateTypeOverride = (typeKey: RomNamingTypeKey, value: string) => {
    onChangeTypeOverrides({
      ...romNamingTypeOverrides,
      [typeKey]: value,
    });
  };

  const handleClearTypeOverride = (typeKey: RomNamingTypeKey) => {
    const next = { ...romNamingTypeOverrides };
    delete next[typeKey];
    onChangeTypeOverrides(next);
    if (activeEditorTarget === typeKey) {
      setActiveEditorTarget('global');
    }
  };

  const handleClearAllOverrides = () => {
    onChangeTypeOverrides({});
    setActiveEditorTarget('global');
  };

  const handleInsertToken = (token: string) => {
    if (activeEditorTarget !== 'global' && romNamingTypeOverrides[activeEditorTarget] !== undefined) {
      const inputEl = overrideInputRefs.current[activeEditorTarget];
      const currentVal = romNamingTypeOverrides[activeEditorTarget] ?? '';
      const { value, caret } = insertNamingTokenAtSelection(
        currentVal,
        token,
        inputEl?.selectionStart,
        inputEl?.selectionEnd,
      );
      handleUpdateTypeOverride(activeEditorTarget, value);
      window.requestAnimationFrame(() => {
        if (inputEl) {
          inputEl.focus();
          inputEl.setSelectionRange(caret, caret);
        }
      });
      return;
    }

    const inputEl = globalInputRef.current;
    const { value, caret } = insertNamingTokenAtSelection(
      romNamingTemplate,
      token,
      inputEl?.selectionStart,
      inputEl?.selectionEnd,
    );
    onChangeTemplate(value);
    window.requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(caret, caret);
      }
    });
  };

  const isLegacyTemplate = romNamingTemplate.trim() === LEGACY_ROM_NAMING_TEMPLATE;
  const activeTargetLabel =
    activeEditorTarget === 'global'
      ? 'Global Base Template'
      : `${typeMetaById.get(activeEditorTarget)?.label ?? activeEditorTarget} Override`;

  return (
    <section
      ref={sectionRef}
      className="relative crt-panel-living scroll-mt-24 border border-crt-border bg-crt-surface rounded-md p-6 space-y-5"
    >
      <div aria-hidden="true" className="crt-edge-beam">
        <span />
      </div>
      {spotlightNonce !== null && (
        <div
          key={`romNaming-${spotlightNonce}`}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px rounded-md crt-section-spotlight"
        />
      )}

      {/* Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-crt-border pb-4">
        <div className="flex items-start gap-3 min-w-0">
          <FileText className="h-5 w-5 text-crt-phosphor crt-section-icon mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h2 className="font-display text-lg font-semibold text-crt-text">
                02. ROM Filename Formatting
              </h2>
              <span className="text-xs font-mono text-crt-muted">
                · {activeNamingPreset ? activeNamingPreset.label : 'Custom Pattern'} ·{' '}
                {namingOptionsSummary}
              </span>
            </div>
            <p className="text-xs text-crt-muted max-w-3xl leading-relaxed">
              Choose how extracted ROM files are named when downloaded or installed to your storage device. Raw mirrored archives on disk remain untouched.
            </p>
          </div>
        </div>

        {isLegacyTemplate && (
          <button
            type="button"
            onClick={() => onChangeTemplate(DEFAULT_ROM_NAMING_TEMPLATE)}
            className="text-xs font-mono text-crt-phosphor hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Upgrade to No-Intro + T-En Hybrid
          </button>
        )}
      </div>

      {/* 4-Preset Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {ROM_NAMING_PRESETS.map((preset) => {
          const active = romNamingTemplate.trim() === preset.template;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChangeTemplate(preset.template)}
              className={`p-3 text-left border rounded transition-colors space-y-1.5 cursor-pointer ${
                active
                  ? 'border-crt-phosphor bg-crt-phosphor/10'
                  : 'border-crt-border bg-crt-bg hover:border-crt-border-strong'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-xs font-medium ${
                    active ? 'text-crt-phosphor' : 'text-crt-text'
                  }`}
                >
                  {preset.label}
                </span>
                {preset.recommended && (
                  <span className="text-[10px] font-mono text-crt-phosphor/90 whitespace-nowrap shrink-0">
                    Recommended
                  </span>
                )}
              </div>
              <div className="text-[11px] text-crt-muted leading-snug">
                {preset.shortDesc}
              </div>
              <div className="font-mono text-[11px] text-crt-muted/90 truncate pt-0.5">
                {preset.exampleStatus}
              </div>
            </button>
          );
        })}
      </div>

      {/* Live All-Type Preview Matrix (Always Visible Inside Step 02) */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-xs font-medium text-crt-text">
              Live All-Type Filename Preview
            </h3>
            <span className="text-[11px] font-mono text-crt-muted">
              {previewSource === 'catalog'
                ? catalogLoading
                  ? 'Loading indexed catalog samples…'
                  : `${catalogMatchedCount}/${ROM_NAMING_PREVIEW_TYPE_KEYS.length} from your catalog${
                      catalogMatchedCount < ROM_NAMING_PREVIEW_TYPE_KEYS.length
                        ? ` · ${ROM_NAMING_PREVIEW_TYPE_KEYS.length - catalogMatchedCount} example fallback`
                        : ''
                    }`
                : `${ROM_NAMING_PREVIEW_TYPE_KEYS.length} ROM types · Parentheses ( ) for origin/status, brackets [ ] for patches`}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {previewSource === 'catalog' && (
              <button
                type="button"
                onClick={handleShuffleCatalogSamples}
                disabled={catalogLoading}
                title="Cycle through different indexed games from your catalog"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text hover:border-crt-border-strong rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Shuffle className="h-3 w-3 shrink-0" />
                <span>Shuffle</span>
              </button>
            )}

            <div
              role="group"
              aria-label="Preview sample source"
              className="inline-flex items-center p-0.5 border border-crt-border bg-crt-bg rounded"
            >
              <button
                type="button"
                onClick={() => setPreviewSource('builtin')}
                className={`px-2.5 py-1 text-[11px] font-mono rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  previewSource === 'builtin'
                    ? 'bg-crt-surface text-crt-phosphor'
                    : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                Built-in Examples
              </button>
              <button
                type="button"
                onClick={() => setPreviewSource('catalog')}
                className={`px-2.5 py-1 text-[11px] font-mono rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  previewSource === 'catalog'
                    ? 'bg-crt-surface text-crt-phosphor'
                    : 'text-crt-muted hover:text-crt-text'
                }`}
              >
                Real Catalog Games
              </button>
            </div>
          </div>
        </div>

        {catalogError && previewSource === 'catalog' && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 border border-crt-amber/40 bg-crt-amber/5 rounded text-xs text-crt-amber">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{catalogError} Showing built-in examples instead.</span>
            </div>
            <button
              type="button"
              onClick={() => void fetchCatalogSamples(catalogSeed)}
              className="font-mono text-[11px] underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        <div className="border border-crt-border rounded bg-crt-bg/60 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-crt-border text-[11px] font-mono text-crt-muted">
                <th className="py-2 pl-3 pr-2 font-normal w-44 whitespace-nowrap">ROM Type</th>
                <th className="py-2 px-2 font-normal">Exported Filename</th>
                <th className="py-2 px-2 font-normal text-right whitespace-nowrap w-32">Length / FAT32</th>
                <th className="py-2 pl-2 pr-3 font-normal text-right whitespace-nowrap w-24">Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-crt-border/60">
              {previewSource === 'catalog' && catalogLoading && !catalogLoadedOnce
                ? ROM_NAMING_PREVIEW_TYPE_KEYS.map((key) => (
                    <tr key={key} className="h-9">
                      <td className="py-2 pl-3 pr-2">
                        <div className="h-3 w-28 bg-crt-surface animate-pulse rounded-sm" />
                      </td>
                      <td className="py-2 px-2">
                        <div className="h-3 w-72 bg-crt-surface animate-pulse rounded-sm" />
                      </td>
                      <td className="py-2 px-2">
                        <div className="h-3 w-14 ml-auto bg-crt-surface animate-pulse rounded-sm" />
                      </td>
                      <td className="py-2 pl-2 pr-3">
                        <div className="h-3 w-12 ml-auto bg-crt-surface animate-pulse rounded-sm" />
                      </td>
                    </tr>
                  ))
                : previewRows.map(({ typeKey, meta, sample, isCatalogFallback, result }) => {
                    const isSelected = selectedSampleType === typeKey;
                    const hasOverride = romNamingTypeOverrides[typeKey] !== undefined;
                    return (
                      <tr
                        key={typeKey}
                        onClick={() => setSelectedSampleType(typeKey)}
                        className={`transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-crt-phosphor/5'
                            : 'hover:bg-crt-surface/60'
                        }`}
                      >
                        <td className="py-2 pl-3 pr-2 align-middle whitespace-nowrap">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-xs font-medium text-crt-text">
                              {meta.label}
                            </span>
                            {hasOverride && (
                              <span className="text-[10px] font-mono text-crt-phosphor">
                                Custom
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-crt-muted">
                            {sample.systemLabel}
                            {previewSource === 'catalog' && (
                              <>
                                {' · '}
                                {isCatalogFallback ? 'Example' : 'Catalog'}
                              </>
                            )}
                          </div>
                        </td>

                        <td
                          className="py-2 px-2 align-middle font-mono text-xs break-all"
                          title={`Title: ${sample.context.title}${
                            sample.context.innerFilename
                              ? ` · Source: ${sample.context.innerFilename}`
                              : ''
                          }`}
                        >
                          {renderHighlightedSegments(result.segments)}
                        </td>

                        <td className="py-2 px-2 align-middle text-right font-mono text-[11px] tabular-nums whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {result.wasTruncated ? (
                              <span
                                title={`Truncated from ${result.rawFilename.length} chars by Max Filename Length (${romMaxFilenameLen})`}
                                className="inline-flex items-center gap-1 text-crt-amber"
                              >
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>Truncated</span>
                              </span>
                            ) : result.wasSanitized ? (
                              <span
                                title={`FAT32 sanitized from "${result.rawFilename}"`}
                                className="text-crt-amber/90"
                              >
                                Sanitized
                              </span>
                            ) : null}
                            <span
                              className={
                                result.wasTruncated
                                  ? 'text-crt-amber'
                                  : result.charLength > 128
                                    ? 'text-crt-text'
                                    : 'text-crt-muted'
                              }
                            >
                              {result.charLength} ch
                            </span>
                          </div>
                        </td>

                        <td
                          className="py-2 pl-2 pr-3 align-middle text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {hasOverride ? (
                            <button
                              type="button"
                              onClick={() => handleClearTypeOverride(typeKey)}
                              className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted hover:text-crt-text transition-colors cursor-pointer"
                            >
                              <RotateCcw className="h-3 w-3 shrink-0" />
                              <span>Reset</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartTypeOverride(typeKey)}
                              className="text-[11px] font-mono text-crt-muted hover:text-crt-phosphor transition-colors cursor-pointer"
                            >
                              Override
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Progressive Disclosure: Pattern Builder, Per-Type Overrides & FAT32 Rules */}
      <div className="border-t border-crt-border pt-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={showAdvancedNaming}
            onClick={onToggleAdvancedNaming}
            className={`inline-flex items-center gap-1.5 text-xs font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showAdvancedNaming || !activeNamingPreset || activeOverrideEntries.length > 0
                ? 'text-crt-phosphor'
                : 'text-crt-muted hover:text-crt-text'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span>Pattern Builder, Type Overrides &amp; FAT32 Rules</span>
            {showAdvancedNaming ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            )}
          </button>

          {!showAdvancedNaming && (
            <span className="text-[11px] font-mono text-crt-muted">
              {namingOptionsSummary}
            </span>
          )}
        </div>

        {showAdvancedNaming && (
          <div className="space-y-5 pt-1">
            {/* Top Grid: Global Template + FAT32 / Length Controls */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
              <div className="md:col-span-8 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="device-export-naming-template"
                    className="text-xs font-medium text-crt-text"
                  >
                    Global Base Filename Pattern
                  </label>
                  <span className="text-[11px] font-mono text-crt-muted">
                    Inserting into:{' '}
                    <span className="text-crt-phosphor">{activeTargetLabel}</span>
                  </span>
                </div>

                <input
                  ref={globalInputRef}
                  id="device-export-naming-template"
                  type="text"
                  value={romNamingTemplate}
                  onFocus={() => setActiveEditorTarget('global')}
                  onChange={(e) => onChangeTemplate(e.target.value)}
                  placeholder={DEFAULT_ROM_NAMING_TEMPLATE}
                  className={`w-full px-3 py-2 text-xs font-mono bg-crt-bg border rounded text-crt-text focus:outline-none ${
                    !globalValidation.valid
                      ? 'border-crt-amber focus:border-crt-amber'
                      : 'border-crt-border focus:border-crt-phosphor'
                  }`}
                />

                {/* Inline Syntax Validation */}
                {globalValidation.issues.length > 0 && (
                  <div className="space-y-1">
                    {globalValidation.issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 text-[11px] font-mono text-crt-amber"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Grouped Cursor-Aware Token Insertion Bar */}
                <div className="space-y-2 pt-1">
                  {TOKEN_GROUPS.map((group) => {
                    const helpers = ROM_NAMING_TOKEN_HELPERS.filter((h) => h.group === group.id);
                    return (
                      <div
                        key={group.id}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <span className="text-[11px] font-mono text-crt-muted w-20 shrink-0">
                          {group.label}:
                        </span>
                        {helpers.map((helper) => (
                          <button
                            key={helper.token}
                            type="button"
                            title={`${helper.label} — ${helper.description}`}
                            onMouseEnter={() => setHoveredToken(helper)}
                            onMouseLeave={() => setHoveredToken(null)}
                            onFocus={() => setHoveredToken(helper)}
                            onBlur={() => setHoveredToken(null)}
                            onClick={() => handleInsertToken(helper.token)}
                            className="px-2 py-0.5 text-[11px] font-mono border border-crt-border bg-crt-bg text-crt-muted hover:text-crt-phosphor hover:border-crt-phosphor/60 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {helper.token}
                          </button>
                        ))}
                      </div>
                    );
                  })}

                  {/* Live Token Value Inspector (grounded in selected preview row) */}
                  <div className="text-[11px] font-mono text-crt-muted pt-0.5 min-h-[1.25rem]">
                    {hoveredToken ? (
                      <span>
                        <span className="text-crt-phosphor">{hoveredToken.token}</span>
                        {' → '}
                        <span className="text-crt-text">
                          {activePreviewRow.result.tokens[hoveredToken.token]
                            ? `"${activePreviewRow.result.tokens[hoveredToken.token]}"`
                            : '(empty for this type)'}
                        </span>
                        {' · '}
                        <span>
                          {hoveredToken.description} (for {activePreviewRow.meta.shortLabel})
                        </span>
                      </span>
                    ) : (
                      <span>
                        Click any token to insert at cursor · Hover a token or click any preview row above to inspect its resolved value.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* FAT32 & Length Rules */}
              <div className="md:col-span-4 space-y-2.5">
                <label
                  htmlFor="device-export-max-filename-len"
                  className="block text-xs font-medium text-crt-text"
                >
                  Max Filename Length (0 = unlimited)
                </label>
                <input
                  id="device-export-max-filename-len"
                  type="number"
                  min={0}
                  max={255}
                  value={romMaxFilenameLen}
                  onChange={(e) =>
                    onChangeMaxFilenameLen(Math.max(0, Math.min(255, Number(e.target.value) || 0)))
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {MAX_LEN_PRESETS.map((preset) => {
                    const active = romMaxFilenameLen === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => onChangeMaxFilenameLen(preset.value)}
                        className={`px-2 py-0.5 text-[11px] font-mono tabular-nums border rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'border-crt-phosphor bg-crt-phosphor/10 text-crt-phosphor'
                            : 'border-crt-border bg-crt-bg text-crt-muted hover:text-crt-text'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <label className="inline-flex items-center gap-2 pt-1 text-xs text-crt-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={romSanitizeFat32}
                    onChange={(e) => onChangeSanitizeFat32(e.target.checked)}
                    className="accent-crt-phosphor"
                  />
                  <span>FAT32 / device-safe characters</span>
                </label>

                <div className="text-[11px] font-mono text-crt-muted leading-relaxed">
                  {previewImpactStats.sanitizedCount} of {previewRows.length} preview rows sanitized ·{' '}
                  <span
                    className={
                      previewImpactStats.truncatedCount > 0 ? 'text-crt-amber' : 'text-crt-muted'
                    }
                  >
                    {previewImpactStats.truncatedCount} truncated
                  </span>
                </div>
              </div>
            </div>

            {/* Optional Per-Type Template Overrides */}
            <div className="border-t border-crt-border/80 pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-baseline gap-2">
                    <h4 className="text-xs font-medium text-crt-text">
                      Optional Per-Type Template Overrides
                    </h4>
                    <span className="text-[11px] font-mono text-crt-muted">
                      {activeOverrideEntries.length === 0
                        ? 'All types inherit Global Base Pattern'
                        : `${activeOverrideEntries.length} custom override${
                            activeOverrideEntries.length === 1 ? '' : 's'
                          } active`}
                    </span>
                  </div>
                  <p className="text-[11px] text-crt-muted">
                    Override the pattern for individual ROM categories (for example, omitting regions on Homebrew or using a custom tag layout on Translations).
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {availableOverrideTypes.length > 0 && (
                    <div className="inline-flex items-center gap-1.5">
                      <select
                        aria-label="Add per-type filename override"
                        value={addOverrideSelection}
                        onChange={(e) => {
                          const selected = e.target.value as RomNamingTypeKey | '';
                          if (selected) {
                            handleStartTypeOverride(selected);
                            setAddOverrideSelection('');
                          }
                        }}
                        className="px-2.5 py-1.5 text-xs font-mono bg-crt-bg border border-crt-border rounded text-crt-text focus:outline-none focus:border-crt-phosphor cursor-pointer"
                      >
                        <option value="">+ Add type override…</option>
                        {availableOverrideTypes.map((meta) => (
                          <option key={meta.id} value={meta.id}>
                            {meta.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {activeOverrideEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllOverrides}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono text-crt-muted hover:text-crt-text border border-crt-border bg-crt-bg rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3 shrink-0" />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
              </div>

              {activeOverrideEntries.length > 0 && (
                <div className="divide-y divide-crt-border/70 border border-crt-border rounded bg-crt-bg/50">
                  {activeOverrideEntries.map(({ typeKey, template }) => {
                    const meta = typeMetaById.get(typeKey)!;
                    const validation = validateRomNamingTemplate(template);
                    const matchingRow = previewRows.find((r) => r.typeKey === typeKey);
                    const isFocusedTarget = activeEditorTarget === typeKey;

                    return (
                      <div key={typeKey} className="p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <label
                              htmlFor={`rom-naming-override-${typeKey}`}
                              className="text-xs font-medium text-crt-text"
                            >
                              {meta.label}
                            </label>
                            <span className="text-[11px] font-mono text-crt-muted">
                              {meta.conventionHint}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleClearTypeOverride(typeKey)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-crt-muted hover:text-crt-text whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3 shrink-0" />
                            <span>Inherit Global</span>
                          </button>
                        </div>

                        <input
                          ref={(el) => {
                            overrideInputRefs.current[typeKey] = el;
                          }}
                          id={`rom-naming-override-${typeKey}`}
                          type="text"
                          value={template}
                          onFocus={() => {
                            setActiveEditorTarget(typeKey);
                            if (ROM_NAMING_PREVIEW_TYPE_KEYS.includes(typeKey)) {
                              setSelectedSampleType(typeKey);
                            }
                          }}
                          onChange={(e) => handleUpdateTypeOverride(typeKey, e.target.value)}
                          placeholder={romNamingTemplate || DEFAULT_ROM_NAMING_TEMPLATE}
                          className={`w-full px-3 py-1.5 text-xs font-mono bg-crt-bg border rounded text-crt-text focus:outline-none ${
                            !validation.valid
                              ? 'border-crt-amber focus:border-crt-amber'
                              : isFocusedTarget
                                ? 'border-crt-phosphor'
                                : 'border-crt-border focus:border-crt-phosphor'
                          }`}
                        />

                        {matchingRow && (
                          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] font-mono">
                            <span className="text-crt-muted">Preview:</span>
                            <span className="break-all">
                              {renderHighlightedSegments(matchingRow.result.segments)}
                            </span>
                          </div>
                        )}

                        {validation.issues.length > 0 && (
                          <div className="space-y-0.5">
                            {validation.issues.map((issue, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-1.5 text-[11px] font-mono text-crt-amber"
                              >
                                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                <span>{issue.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {activeOverrideEntries.length === 0 && availableOverrideTypes.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-crt-muted">
                  <Plus className="h-3 w-3 shrink-0" />
                  <span>
                    Tip: Click <span className="text-crt-text">Override</span> on any row in the preview matrix above or choose a type from the dropdown to customize it independently.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
