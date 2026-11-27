export type CatalogSortOption =
  | 'submitted_desc'
  | 'submitted_asc'
  | 'rating_desc'
  | 'rating_asc'
  | 'votes_desc'
  | 'title_asc'
  | 'title_desc'
  | 'size_desc'
  | 'size_asc'
  | 'downloaded_desc'
  | 'installed_desc'
  | 'discovered_desc'
  | 'year_desc'
  | 'year_asc'
  | 'system_asc'
  | 'system_desc';

export const DEFAULT_CATALOG_SORT: CatalogSortOption = 'submitted_desc';

export interface CatalogSortChoice {
  value: CatalogSortOption;
  label: string;
}

export const CATALOG_SORT_OPTIONS: readonly CatalogSortChoice[] = [
  { value: 'submitted_desc', label: 'Sort: Newest Submissions' },
  { value: 'submitted_asc', label: 'Sort: Oldest Submissions' },
  { value: 'rating_desc', label: 'Sort: Users Score (Highest)' },
  { value: 'rating_asc', label: 'Sort: Users Score (Lowest)' },
  { value: 'votes_desc', label: 'Sort: Most Voted' },
  { value: 'title_asc', label: 'Sort: Title (A → Z)' },
  { value: 'title_desc', label: 'Sort: Title (Z → A)' },
  { value: 'size_desc', label: 'Sort: File Size (Largest)' },
  { value: 'size_asc', label: 'Sort: File Size (Smallest)' },
  { value: 'downloaded_desc', label: 'Sort: Recently Downloaded' },
  { value: 'installed_desc', label: 'Sort: Recently Installed' },
  { value: 'discovered_desc', label: 'Sort: Recently Discovered' },
  { value: 'year_desc', label: 'Sort: Release Year (Newest)' },
  { value: 'year_asc', label: 'Sort: Release Year (Oldest)' },
  { value: 'system_asc', label: 'Sort: System (A → Z)' },
  { value: 'system_desc', label: 'Sort: System (Z → A)' },
] as const;

const VALID_SORT_SET = new Set<string>(CATALOG_SORT_OPTIONS.map((o) => o.value));

export function normalizeCatalogSort(raw: unknown): CatalogSortOption {
  if (typeof raw === 'string' && VALID_SORT_SET.has(raw)) {
    return raw as CatalogSortOption;
  }
  return DEFAULT_CATALOG_SORT;
}
