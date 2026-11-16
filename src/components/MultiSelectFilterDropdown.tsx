import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { FilterMatchMode } from '../types';

export interface FilterDropdownOption {
  value: string;
  label: string;
  count?: number;
}

interface MultiSelectFilterDropdownProps {
  id: string;
  label: string;
  allLabel: string;
  options: FilterDropdownOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  matchMode?: FilterMatchMode;
  onMatchModeChange?: (mode: FilterMatchMode) => void;
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  showTotalOptionCount?: boolean;
  searchPlaceholder?: string;
}

export function MultiSelectFilterDropdown({
  id,
  label,
  allLabel,
  options,
  selected,
  onChange,
  matchMode,
  onMatchModeChange,
  open,
  onOpenChange,
  showTotalOptionCount = true,
  searchPlaceholder,
}: MultiSelectFilterDropdownProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [alignRight, setAlignRight] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Merge any persisted/active values that are not currently in `options` so users can always inspect & uncheck them
  const mergedOptions = useMemo<FilterDropdownOption[]>(() => {
    const known = new Set(options.map((o) => o.value));
    const missingSelected: FilterDropdownOption[] = selected
      .filter((val) => !known.has(val))
      .map((val) => ({ value: val, label: val }));
    return missingSelected.length > 0 ? [...missingSelected, ...options] : options;
  }, [options, selected]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mergedOptions;
    return mergedOptions.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q),
    );
  }, [mergedOptions, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    if (containerRef.current && typeof window !== 'undefined') {
      const rect = containerRef.current.getBoundingClientRect();
      const panelWidth = 288; // w-72
      setAlignRight(rect.left + panelWidth > window.innerWidth - 16 && rect.right >= panelWidth);
    }

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    }, 20);

    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onOpenChange]);

  const toggleValue = (val: string) => {
    if (selectedSet.has(val)) {
      onChange(selected.filter((item) => item !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const allVisibleSelected =
    filteredOptions.length > 0 && filteredOptions.every((opt) => selectedSet.has(opt.value));

  const handleToggleVisible = () => {
    if (filteredOptions.length === 0) return;
    if (allVisibleSelected) {
      const visibleValues = new Set(filteredOptions.map((o) => o.value));
      onChange(selected.filter((val) => !visibleValues.has(val)));
    } else {
      const next = [...selected];
      for (const opt of filteredOptions) {
        if (!selectedSet.has(opt.value)) {
          next.push(opt.value);
        }
      }
      onChange(next);
    }
  };

  const singleSelectedLabel = useMemo(() => {
    if (selected.length !== 1) return null;
    const found = mergedOptions.find((o) => o.value === selected[0]);
    return found ? found.label : selected[0];
  }, [mergedOptions, selected]);

  const isActive = selected.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={`catalog-filter-${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:border-crt-phosphor cursor-pointer ${
          isActive
            ? 'border-crt-phosphor/60 bg-crt-phosphor/10 text-crt-phosphor'
            : open
              ? 'border-crt-border-strong bg-crt-elevated text-crt-text'
              : 'border-crt-border bg-crt-bg hover:border-crt-border-strong text-crt-text'
        }`}
      >
        {selected.length === 0 ? (
          <span className="inline-flex items-center gap-1">
            <span>{allLabel}</span>
            {showTotalOptionCount && options.length > 0 && (
              <span className="font-mono text-[11px] text-crt-muted tabular-nums">({options.length})</span>
            )}
          </span>
        ) : selected.length === 1 ? (
          <span className="inline-flex items-center gap-1 max-w-[11.5rem]">
            <span className="text-crt-muted font-normal">{label}:</span>
            <span className="font-medium truncate">{singleSelectedLabel}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <span className="font-sans font-medium">{label}</span>
            <span>({selected.length})</span>
            {matchMode === 'all' && <span className="text-[10px] text-crt-amber">· ALL</span>}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180 text-crt-phosphor' : 'text-crt-muted'
          }`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${label} multi-select filter`}
          className={`absolute top-full mt-1.5 z-40 w-72 border border-crt-border-strong bg-crt-surface rounded-md shadow-2xl overflow-hidden ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
          {/* Search & Match Mode Header */}
          <div className="p-2.5 border-b border-crt-border bg-crt-bg/80 space-y-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-crt-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-crt-surface border border-crt-border rounded text-crt-text placeholder:text-crt-muted focus:outline-none focus:border-crt-phosphor"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear option search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-crt-muted hover:text-crt-text p-0.5 rounded"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {matchMode && onMatchModeChange && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[11px] font-mono text-crt-muted whitespace-nowrap shrink-0">
                  Match mode
                </span>
                <div className="inline-flex items-center p-0.5 bg-crt-surface border border-crt-border rounded">
                  <button
                    type="button"
                    onClick={() => onMatchModeChange('any')}
                    title="Include releases matching ANY selected value (OR)"
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      matchMode === 'any'
                        ? 'bg-crt-elevated text-crt-phosphor border border-crt-border-strong'
                        : 'text-crt-muted hover:text-crt-text border border-transparent'
                    }`}
                  >
                    Any (OR)
                  </button>
                  <button
                    type="button"
                    onClick={() => onMatchModeChange('all')}
                    title="Require releases to have ALL selected values (AND)"
                    className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      matchMode === 'all'
                        ? 'bg-crt-elevated text-crt-amber border border-crt-amber/50'
                        : 'text-crt-muted hover:text-crt-text border border-transparent'
                    }`}
                  >
                    All (AND)
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 text-[11px] font-mono pt-0.5">
              <button
                type="button"
                disabled={filteredOptions.length === 0}
                onClick={handleToggleVisible}
                className="text-crt-muted hover:text-crt-phosphor transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
              >
                {allVisibleSelected
                  ? `Unselect visible (${filteredOptions.length})`
                  : `Select visible (${filteredOptions.length})`}
              </button>
              {selected.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-crt-amber hover:underline transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Clear ({selected.length})
                </button>
              ) : (
                <span className="text-crt-muted/70 tabular-nums whitespace-nowrap shrink-0">
                  0 selected
                </span>
              )}
            </div>
          </div>

          {/* Options List */}
          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto divide-y divide-crt-border/40">
            {mergedOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-crt-muted">
                No indexed {label.toLowerCase()} available yet
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center space-y-1.5">
                <p className="text-xs text-crt-muted">No options match &ldquo;{query}&rdquo;</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-[11px] font-mono text-crt-phosphor hover:underline cursor-pointer"
                >
                  Reset option search
                </button>
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleValue(opt.value)}
                    className={`w-full px-3 py-2 flex items-center justify-between gap-2.5 text-left text-xs transition-colors cursor-pointer ${
                      checked ? 'bg-crt-phosphor/10 text-crt-phosphor' : 'hover:bg-crt-elevated text-crt-text'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${
                          checked
                            ? 'border-crt-phosphor bg-crt-phosphor text-crt-bg'
                            : 'border-crt-border-strong bg-crt-bg'
                        }`}
                      >
                        {checked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                      </span>
                      <span className={`truncate ${checked ? 'font-medium' : ''}`} title={opt.label}>
                        {opt.label}
                      </span>
                    </span>
                    {opt.count !== undefined && (
                      <span
                        className={`font-mono text-[11px] tabular-nums shrink-0 ${
                          checked ? 'text-crt-phosphor' : 'text-crt-muted'
                        }`}
                      >
                        {opt.count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
